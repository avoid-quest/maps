#!/usr/bin/env python3
"""Build the published GTT timetable site (manifest + content-addressed packages).

Downloads the official GTT GTFS zip with a conditional request, compacts and
validates it, and writes a static directory for GitHub Pages:

  manifest.json                        small current manifest polled by the app
  packages/gtt-<sha256>.json           immutable hashed packages (current + previous)
  README.txt                           attribution and licence notice

Publication is needed only when the package changed, or when the published
upstream confirmation is older than --heartbeat-hours (so devices can tell an
unchanged upstream from a stalled pipeline). Writes publish=true|false to
$GITHUB_OUTPUT when set. Packages are hashed, not signed; no credentials used.
"""

import argparse
import datetime
import email.utils
import json
import os
import pathlib
import sys
import tempfile
import urllib.error
import urllib.request

import gtt_package as gtt

USER_AGENT = "AvoidMaps-data-pipeline (https://github.com/avoid-quest/maps)"
TIMEOUT = 120


def utc_now():
    return datetime.datetime.now(datetime.timezone.utc).replace(microsecond=0)


def iso(moment):
    return moment.isoformat().replace("+00:00", "Z")


def http_date_to_iso(value):
    if not value:
        return None
    try:
        return iso(email.utils.parsedate_to_datetime(value).astimezone(datetime.timezone.utc))
    except (TypeError, ValueError):
        return None


def iso_to_http_date(value):
    try:
        return email.utils.format_datetime(datetime.datetime.fromisoformat(value.replace("Z", "+00:00")), usegmt=True)
    except (AttributeError, ValueError):
        return None


def request(url, headers=None):
    return urllib.request.Request(url, headers={"User-Agent": USER_AGENT, **(headers or {})})


def fetch_previous(site_url):
    """The currently published manifest, or None on first publication."""
    try:
        with urllib.request.urlopen(request(site_url + "manifest.json"), timeout=TIMEOUT) as response:
            return json.loads(response.read())
    except urllib.error.HTTPError as error:
        # Only "not found" means first publication; anything else fails closed so rollback
        # packages are never dropped because of a transient error.
        if error.code == 404:
            return None
        raise


def fetch_bytes(url):
    with urllib.request.urlopen(request(url), timeout=TIMEOUT) as response:
        return response.read()


def download_source(previous, destination):
    """Conditional GET of the GTT zip. Returns source metadata, or None when upstream answered 304."""
    headers = {}
    if previous and previous.get("source_etag"):
        headers["If-None-Match"] = previous["source_etag"]
    if previous and previous.get("source_last_modified"):
        since = iso_to_http_date(previous["source_last_modified"])
        if since:
            headers["If-Modified-Since"] = since
    try:
        with urllib.request.urlopen(request(gtt.SOURCE_URL, headers), timeout=TIMEOUT) as response:
            data = response.read()
            destination.write_bytes(data)
            return {"sha256": gtt.sha256(data), "etag": response.headers.get("ETag"),
                    "last_modified": http_date_to_iso(response.headers.get("Last-Modified"))}
    except urllib.error.HTTPError as error:
        if error.code == 304:
            return None
        raise


def carried_packages(previous, site_url, keep):
    """Previously published packages, re-verified by hash so the site stays self-contained."""
    if not previous:
        return []
    entries = [{"package_hash": previous["package_hash"], "package_path": previous["package_path"],
                "feed_version": previous["feed_version"]}] + list(previous.get("previous", []))
    carried, seen = [], set()
    for entry in entries:
        if len(carried) >= keep or entry["package_hash"] in seen:
            continue
        seen.add(entry["package_hash"])
        try:
            data = fetch_bytes(site_url + entry["package_path"])
        except urllib.error.HTTPError as error:
            if error.code != 404:
                raise
            # A package already gone from the site cannot be carried; report it, do not fail forever.
            print(f"previous package {entry['package_hash']} no longer published; dropped", file=sys.stderr)
            continue
        gtt.check(gtt.sha256(data) == entry["package_hash"], f"published package {entry['package_hash']} fails its hash")
        carried.append((entry, data))
    return carried


def write_site(output, manifest, packages):
    (output / "packages").mkdir(parents=True, exist_ok=True)
    for path, data in packages.items():
        (output / path).write_bytes(data)
    (output / "manifest.json").write_bytes(gtt.encode(manifest))
    (output / ".nojekyll").write_bytes(b"")
    (output / "README.txt").write_text(
        "Avoid Maps GTT timetable packages.\n"
        f"{gtt.ATTRIBUTION} ({gtt.ATTRIBUTION_URL}).\n"
        f"Licence: {gtt.LICENCE_URL} (non-commercial use with attribution).\n"
        "Packages are derived (compacted) from the official GTFS export and identified by SHA-256.\n"
        "They are hashed for integrity, not signed.\n", encoding="utf-8")


def write_flat(directory, manifest, packages):
    """Release assets cannot contain '/': same manifest bytes, packages under their file names."""
    directory.mkdir(parents=True, exist_ok=True)
    gtt.check(not any(directory.iterdir()), "--release-output must be empty")
    for path, data in packages.items():
        (directory / pathlib.PurePosixPath(path).name).write_bytes(data)
    (directory / "manifest.json").write_bytes(gtt.encode(manifest))


def set_output(name, value):
    path = os.environ.get("GITHUB_OUTPUT")
    if path:
        with open(path, "a", encoding="utf-8") as handle:
            handle.write(f"{name}={value}\n")
    print(f"{name}={value}")


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--site-url", required=True, help="published base URL ending in /, e.g. https://owner.github.io/repo/gtt/")
    parser.add_argument("--output", required=True, help="empty directory for the site")
    parser.add_argument("--zip", help="use a local GTFS zip instead of downloading (no conditional request)")
    parser.add_argument("--zip-last-modified", help="preserved Last-Modified (ISO 8601) from the --zip download response")
    parser.add_argument("--zip-checked-at", help="preserved time (ISO 8601) the --zip was retrieved from GTT; "
                        "without it the manifest records no upstream confirmation")
    parser.add_argument("--release-output", help="also write a flat copy (manifest.json + gtt-<sha256>.json) for the GitHub Releases mirror")
    parser.add_argument("--bundle-dir", help="also write the APK bundle files (gtt-timetable*.json, gtt-stops.json, manifest.json gtt section)")
    parser.add_argument("--heartbeat-hours", type=float, default=20)
    parser.add_argument("--keep", type=int, default=2, help="previous packages kept beside the current one")
    parser.add_argument("--no-previous", action="store_true", help="ignore the published site (first publication or local runs)")
    args = parser.parse_args()
    site_url = args.site_url if args.site_url.endswith("/") else args.site_url + "/"
    output = pathlib.Path(args.output)
    output.mkdir(parents=True, exist_ok=True)
    check_empty = [path for path in output.iterdir()]
    if check_empty:
        parser.error("--output must be empty")
    previous = None if args.no_previous else fetch_previous(site_url)
    if previous:
        try:
            previous = gtt_manifest(previous)
        except gtt.PackageError as error:
            print(f"ignoring invalid published manifest: {error}", file=sys.stderr)
            previous = None
    built_at = iso(utc_now())
    # Upstream confirmation is evidence of a real request to GTT, never the local build time.
    checked_at = built_at
    with tempfile.TemporaryDirectory() as scratch:
        if args.zip:
            data = pathlib.Path(args.zip).read_bytes()
            source = {"sha256": gtt.sha256(data), "etag": None, "last_modified": evidence_time(parser, args.zip_last_modified)}
            checked_at = evidence_time(parser, args.zip_checked_at)
            zip_path = pathlib.Path(args.zip)
        else:
            zip_path = pathlib.Path(scratch) / "gtt_gtfs.zip"
            source = download_source(previous, zip_path)
        package = payload = None
        if source is not None:
            package = gtt.build_package(zip_path)
            payload = gtt.encode(package)
            source["crc32"] = gtt.source_crcs(zip_path)

    # Never publish an older GTT source over a newer one, whatever the build time.
    if source is not None and previous is not None and gtt.compare_source(
            {"feed_version": package["feed"]["feed_version"], "source_zip_hash": source["sha256"], "source_last_modified": source.get("last_modified")}, previous) < 0:
        raise SystemExit(f"refusing to publish source {package['feed']['feed_version']} older than the published {previous['feed_version']}")
    unchanged = source is None or (previous is not None and gtt.sha256(payload) == previous["package_hash"])
    if unchanged:
        if previous is None:
            raise SystemExit("upstream unchanged but no published manifest exists; rerun with --no-previous")
        confirmed = previous.get("upstream_checked_at")
        age = utc_now() - datetime.datetime.fromisoformat(confirmed.replace("Z", "+00:00")) if confirmed else None
        if age is not None and age < datetime.timedelta(hours=args.heartbeat_hours) and not args.bundle_dir:
            print(f"package {previous['package_hash']} unchanged; confirmation {age} old, no publication")
            set_output("publish", "false")
            return
        manifest = dict(previous, upstream_checked_at=checked_at or confirmed)
        if source is not None:
            manifest.update(source_zip_hash=source["sha256"], source_etag=source["etag"], source_crc32=source["crc32"],
                            source_last_modified=source["last_modified"] or previous.get("source_last_modified"))
        carried = carried_packages(previous, site_url, args.keep + 1)
        if not carried or carried[0][0]["package_hash"] != manifest["package_hash"]:
            raise SystemExit("current package could not be re-verified from the published site")
        packages = {entry["package_path"]: data for entry, data in carried}
        manifest["previous"] = [entry for entry, _ in carried[1:]]
        print(f"package unchanged; upstream confirmation {manifest['upstream_checked_at']}")
    else:
        carried = carried_packages(previous, site_url, args.keep)
        manifest = gtt.manifest_for(payload, package, source, checked_at, built_at, [entry for entry, _ in carried])
        packages = {manifest["package_path"]: payload, **{entry["package_path"]: data for entry, data in carried}}
        print(f"built {manifest['package_path']} ({len(payload)} bytes) from feed {manifest['feed_version']}: {manifest['counts']}")
    write_site(output, manifest, packages)
    if args.release_output:
        write_flat(pathlib.Path(args.release_output), manifest, packages)
    if args.bundle_dir:
        write_bundle(pathlib.Path(args.bundle_dir), manifest, packages[manifest["package_path"]], package)
    set_output("publish", "true")
    set_output("package_hash", manifest["package_hash"])


def evidence_time(parser, value):
    """Normalise an optional ISO 8601 evidence time to UTC 'Z', or None."""
    if not value:
        return None
    try:
        moment = datetime.datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError:
        parser.error(f"invalid ISO 8601 time: {value}")
    if moment.tzinfo is None:
        parser.error(f"time needs a UTC offset: {value}")
    return iso(moment.astimezone(datetime.timezone.utc).replace(microsecond=0))


def gtt_manifest(manifest):
    """Minimal structural validation of a published manifest before trusting its validators."""
    for key in ("package_hash", "package_path", "feed_version"):
        gtt.check(isinstance(manifest.get(key), str) and manifest[key], f"published manifest lacks {key}")
    gtt.check(manifest["package_path"] == f"packages/gtt-{manifest['package_hash']}.json", "published manifest path mismatch")
    gtt.check(manifest.get("upstream_checked_at") is None or isinstance(manifest["upstream_checked_at"], str), "published manifest has an invalid confirmation time")
    return manifest


def write_bundle(directory, manifest, payload, package):
    if package is None:
        package = gtt.validate_package(json.loads(payload))
    files = gtt.bundle_files(payload, package, manifest)
    directory.mkdir(parents=True, exist_ok=True)
    app_manifest_path = directory / "manifest.json"
    app_manifest = json.loads(app_manifest_path.read_text("utf-8")) if app_manifest_path.exists() else {}
    app_manifest["gtt"] = gtt.bundle_metadata(manifest)
    app_manifest["preparedAt"] = manifest["built_at"]
    files["manifest.json"] = (json.dumps(app_manifest, ensure_ascii=False, separators=(",", ":"), allow_nan=False) + "\n").encode("utf-8")
    for name, data in files.items():
        temporary = directory / (name + ".tmp")
        temporary.write_bytes(data)
        temporary.replace(directory / name)
    obsolete = directory / "gtt-trips.json"
    if obsolete.exists():
        obsolete.unlink()
    print(f"bundled {manifest['package_hash']} into {directory}")


if __name__ == "__main__":
    try:
        main()
    except gtt.PackageError as error:
        raise SystemExit(f"package rejected, nothing published: {error}")
