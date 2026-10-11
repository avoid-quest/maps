#!/usr/bin/env python3
"""Prepare independently versioned GTT and compact Overture packages; see --help."""

import argparse
import collections
import csv
import datetime
import io
import pathlib
import zipfile

from place_package import ValidationError, encoded, extraction_sql, prepare_places, read_json, sha256

ROOT = pathlib.Path(__file__).resolve().parent.parent


def prepare_gtfs(path):
    """Keep the existing realtime lookup, without claiming an offline timetable."""
    with zipfile.ZipFile(path) as archive:
        def rows(name):
            return csv.DictReader(io.TextIOWrapper(archive.open(name), encoding="utf-8-sig"))

        routes = {row["route_id"]: row["route_short_name"] for row in rows("routes.txt")}
        trips = {row["trip_id"]: [routes.get(row["route_id"], row["route_id"]),
                                row["trip_headsign"], row["route_id"]] for row in rows("trips.txt")}
        trip_stops, stop_lines = collections.defaultdict(list), collections.defaultdict(set)
        for row in rows("stop_times.txt"):
            trip_stops[row["trip_id"]].append((int(row["stop_sequence"]), row["stop_id"]))
            if row["trip_id"] in trips:
                stop_lines[row["stop_id"]].add(trips[row["trip_id"]][0])
        patterns, intern, lookup = [], {}, {}
        for trip_id, sequence in trip_stops.items():
            key = tuple(sorted(sequence))
            if key not in intern:
                intern[key] = len(patterns)
                patterns.append(dict(key))
            lookup[trip_id] = [*trips[trip_id], intern[key]]
        stops = [{"id": row["stop_id"], "code": row["stop_code"], "name": row["stop_name"],
                  "coordinate": {"latitude": float(row["stop_lat"]), "longitude": float(row["stop_lon"])},
                  "lines": sorted(stop_lines[row["stop_id"]])} for row in rows("stops.txt")]
        info = next(iter(rows("feed_info.txt")))
    metadata = {"version": info.get("feed_version"), "validFrom": info.get("feed_start_date"),
                "validTo": info.get("feed_end_date"), "sha256": sha256(pathlib.Path(path).read_bytes()),
                "url": "https://www.gtt.to.it/open_data/gtt_gtfs.zip",
                "license": "https://www.gtt.to.it/gtt_gtfs_license.html",
                "attribution": "Data source: GTT S.p.A. – Gruppo Torinese Trasporti",
                "stops": len(stops), "trips": len(lookup), "patterns": len(patterns)}
    return {"gtt-stops.json": encoded(stops), "gtt-trips.json": encoded({"patterns": patterns, "trips": lookup})}, metadata


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
            manifest["preparedAt"] = datetime.datetime.now(datetime.timezone.utc).isoformat()
        files["manifest.json"] = encoded(manifest)
    except (ValidationError, OSError, ValueError, KeyError, TypeError, zipfile.BadZipFile) as error:
        parser.error(str(error))
    if not args.validate_only:
        output.mkdir(parents=True, exist_ok=True)
        # All inputs have passed validation before the first output is replaced.
        for name, payload in files.items():
            target = output / name
            temporary = target.with_suffix(target.suffix + ".tmp")
            temporary.write_bytes(payload)
            temporary.replace(target)
    action = "Validated" if args.validate_only else "Prepared"
    if args.places:
        data = manifest["places"]
        print(f"{action} {data['count']} places ({data['mainCount']} main), "
              f"{data['bytes']} bytes, SHA-256 {data['sha256']}")
    if args.gtfs:
        data = manifest["gtt"]
        print(f"{action} {data['stops']} stops, {data['trips']} trips / {data['patterns']} stop patterns")


if __name__ == "__main__":
    main()
