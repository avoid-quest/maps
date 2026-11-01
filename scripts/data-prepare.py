#!/usr/bin/env python3
"""Prepare independently versioned GTT and compact Overture packages; see --help."""

import argparse
import datetime
import pathlib
import zipfile

import gtt_package
from place_package import ValidationError, encoded, extraction_sql, prepare_places, read_json, sha256

ROOT = pathlib.Path(__file__).resolve().parent.parent


def prepare_gtfs(path):
    """Compact the GTT timetable package for the APK; see scripts/gtt_package.py."""
    payload = pathlib.Path(path).read_bytes()
    package = gtt_package.build_package(path)
    encoded_package = gtt_package.encode(package)
    now = datetime.datetime.now(datetime.timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")
    source = {"sha256": sha256(payload), "etag": None, "last_modified": None}
    manifest = gtt_package.manifest_for(encoded_package, package, source, now, now)
    return gtt_package.bundle_files(encoded_package, package, manifest), gtt_package.bundle_metadata(manifest)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--gtfs", help="official GTT GTFS zip; optional for a place-only update")
    parser.add_argument("--places", help="raw Overture JSON array matching the pinned source metadata")
    parser.add_argument("--places-metadata", default=str(ROOT / "src/data/places.source.json"),
                        help="versioned source metadata with release, bounds, schema, hashes and counts")
    parser.add_argument("--places-sql", metavar="RAW_OUTPUT", help="print extraction SQL using pinned metadata, then exit; does not download")
    parser.add_argument("--validate-only", action="store_true", help="validate and round-trip the supplied inputs without writing any files")
    parser.add_argument("--output", default=str(ROOT / "src/data"), help="generated data directory")
    args = parser.parse_args()
    if args.places_sql:
        if args.gtfs or args.places or args.validate_only:
            parser.error("--places-sql cannot be combined with data preparation")
        try:
            print(extraction_sql(args.places_metadata, args.places_sql), end="")
        except (ValidationError, OSError, ValueError, KeyError, TypeError) as error:
            parser.error(str(error))
        return
    if not args.gtfs and not args.places:
        parser.error("provide --places and/or --gtfs")
    output = pathlib.Path(args.output)
    files = {}
    try:
        manifest = read_json(output / "manifest.json") if (output / "manifest.json").exists() else {}
        if args.places:
            payload, metadata = prepare_places(args.places, args.places_metadata)
            files["places.compact.json"] = payload
            manifest["places"] = metadata
        if args.gtfs:
            transit_files, metadata = prepare_gtfs(args.gtfs)
            files.update(transit_files)
            manifest["gtt"] = metadata
            manifest["preparedAt"] = metadata["builtAt"]
        files["manifest.json"] = encoded(manifest)
    except (ValidationError, gtt_package.PackageError, OSError, ValueError, KeyError, TypeError, zipfile.BadZipFile) as error:
        parser.error(str(error))
    if not args.validate_only:
        output.mkdir(parents=True, exist_ok=True)
        # All inputs have passed validation before the first output is replaced.
        for name, payload in files.items():
            target = output / name
            temporary = target.with_suffix(target.suffix + ".tmp")
            temporary.write_bytes(payload)
            temporary.replace(target)
        if args.gtfs and (output / "gtt-trips.json").exists():
            (output / "gtt-trips.json").unlink()
    action = "Validated" if args.validate_only else "Prepared"
    if args.places:
        data = manifest["places"]
        print(f"{action} {data['count']} places ({data['mainCount']} main), "
              f"{data['bytes']} bytes, SHA-256 {data['sha256']}")
    if args.gtfs:
        data = manifest["gtt"]
        print(f"{action} GTT package {data['packageSha256']}: {data['stops']} stops, {data['trips']} trips, "
              f"{data['patterns']} stop patterns, {data['vectors']} timing vectors")


if __name__ == "__main__":
    main()
