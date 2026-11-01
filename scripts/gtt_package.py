"""Compact, validate and describe GTT GTFS timetable packages.

A package keeps every stop visit of every trip without expanding stop_times:
trips reference a stop pattern (stop IDs, real stop_sequence values and
pickup/drop-off codes) and a timing vector (offsets from the trip start).
The same compact JSON is bundled in the APK and published by CI; devices
import it into SQLite. Packages are content-addressed by SHA-256 ("hashed",
not signed). Standard library only.
"""

import csv
import datetime
import hashlib
import io
import json
import re
import zipfile

FORMAT = "avoid-maps.gtt-timetable"
SCHEMA_VERSION = 1
BUILDER_VERSION = "1"
SOURCE_URL = "https://www.gtt.to.it/open_data/gtt_gtfs.zip"
LICENCE_URL = "https://www.gtt.to.it/gtt_gtfs_license.html"
ATTRIBUTION = "Data source: GTT S.p.A. – Gruppo Torinese Trasporti"
ATTRIBUTION_URL = "https://www.gtt.to.it"
TIMEZONE = "Europe/Rome"
# Sanity floors: a truncated or empty upstream export must never replace a usable package.
MINIMUMS = {"stops": 1000, "trips": 5000, "routes": 50, "services": 10}
DATE = re.compile(r"^\d{8}$")
TIME = re.compile(r"^\s*(\d{1,3}):([0-5]\d):([0-5]\d)\s*$")


class PackageError(ValueError):
    """The source or package cannot be used; the previous package must stay active."""


def check(condition, message):
    if not condition:
        raise PackageError(message)


def seconds(value, label):
    match = TIME.match(value or "")
    check(match, f"{label}: missing or invalid GTFS time {value!r}; times are never interpolated")
    return int(match.group(1)) * 3600 + int(match.group(2)) * 60 + int(match.group(3))


def valid_date(value, label):
    check(isinstance(value, str) and DATE.match(value), f"{label}: invalid date {value!r}")
    try:
        datetime.date(int(value[:4]), int(value[4:6]), int(value[6:]))
    except ValueError as error:
        raise PackageError(f"{label}: invalid date {value!r}") from error
    return value


def encode(package):
    """Deterministic ASCII JSON, so the SHA-256 of the bytes equals the hash of the decoded string."""
    return (json.dumps(package, ensure_ascii=True, separators=(",", ":"), allow_nan=False) + "\n").encode("ascii")


def sha256(data):
    return hashlib.sha256(data).hexdigest()


def build_package(zip_path):
    """Return the compact package dict for a GTFS zip, or raise PackageError."""
    with zipfile.ZipFile(zip_path) as archive:
        names = set(archive.namelist())

        def rows(name, required=True):
            if name not in names:
                check(not required, f"GTFS file {name} is missing")
                return []
            return list(csv.DictReader(io.TextIOWrapper(archive.open(name), encoding="utf-8-sig")))

        feed = (rows("feed_info.txt", required=False) or [{}])[0]
        agencies = sorted((row["agency_id"], row["agency_name"]) for row in rows("agency.txt"))
        for row in rows("agency.txt"):
            check(row.get("agency_timezone", TIMEZONE) == TIMEZONE, f"agency {row['agency_id']} is not in {TIMEZONE}")
        route_rows = sorted(rows("routes.txt"), key=lambda row: row["route_id"])
        route_index = {row["route_id"]: index for index, row in enumerate(route_rows)}
        routes = [[row["route_id"], row.get("agency_id", ""), int(row["route_type"]),
                   row.get("route_short_name", ""), row.get("route_long_name", "")] for row in route_rows]

        stop_rows = sorted(rows("stops.txt"), key=lambda row: row["stop_id"])
        stop_index = {row["stop_id"]: index for index, row in enumerate(stop_rows)}
        check(len(stop_index) == len(stop_rows), "duplicate stop_id")
        stops = [[row["stop_id"], row.get("stop_code", ""), row["stop_name"],
                  round(float(row["stop_lat"]), 6), round(float(row["stop_lon"]), 6),
                  row.get("parent_station", ""), int(row.get("location_type") or 0)] for row in stop_rows]

        services = {}
        for row in rows("calendar.txt", required=False):
            mask = sum(1 << bit for bit, day in enumerate(
                ("monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday")) if row[day] == "1")
            services[row["service_id"]] = [row["service_id"], mask, valid_date(row["start_date"], "calendar"),
                                           valid_date(row["end_date"], "calendar"), [], []]
        for row in rows("calendar_dates.txt", required=False):
            entry = services.setdefault(row["service_id"], [row["service_id"], 0, "", "", [], []])
            check(row["exception_type"] in ("1", "2"), f"invalid exception_type {row['exception_type']!r}")
            entry[4 if row["exception_type"] == "1" else 5].append(valid_date(row["date"], "calendar_dates"))
        service_ids = sorted(services)
        service_index = {service: index for index, service in enumerate(service_ids)}
        service_list = [[*services[service][:4], sorted(set(services[service][4])), sorted(set(services[service][5]))]
                        for service in service_ids]

        trip_rows = {row["trip_id"]: row for row in rows("trips.txt")}
        visits = {trip_id: [] for trip_id in trip_rows}
        for row in rows("stop_times.txt"):
            trip_id = row["trip_id"]
            check(trip_id in visits, f"stop_times references unknown trip {trip_id}")
            check(row["stop_id"] in stop_index, f"stop_times references unknown stop {row['stop_id']}")
            arrival = seconds(row["arrival_time"], f"trip {trip_id}")
            departure = seconds(row["departure_time"], f"trip {trip_id}")
            pickup = int(row.get("pickup_type") or 0)
            drop_off = int(row.get("drop_off_type") or 0)
            visits[trip_id].append((int(row["stop_sequence"]), stop_index[row["stop_id"]],
                                    pickup * 4 + drop_off, arrival, departure))

        frequencies = [row for row in rows("frequencies.txt", required=False)]
        patterns, pattern_ids, vectors, vector_ids, headsigns, headsign_ids = [], {}, [], {}, [], {}
        columns = {key: [] for key in ("trip_id", "route", "service", "pattern", "vector", "start", "headsign", "direction")}
        trip_position = {}
        for trip_id in sorted(trip_rows):
            row, stop_visits = trip_rows[trip_id], sorted(visits[trip_id])
            check(len(stop_visits) >= 2, f"trip {trip_id} has fewer than two stop visits")
            sequences = [visit[0] for visit in stop_visits]
            check(len(set(sequences)) == len(sequences), f"trip {trip_id} repeats a stop_sequence")
            check(row["route_id"] in route_index, f"trip {trip_id} references unknown route {row['route_id']}")
            check(row["service_id"] in service_index, f"trip {trip_id} references unknown service {row['service_id']}")
            codes = [visit[2] for visit in stop_visits]
            pattern_key = (tuple(visit[1] for visit in stop_visits), tuple(sequences),
                           tuple(codes) if any(codes) else None)
            if pattern_key not in pattern_ids:
                pattern_ids[pattern_key] = len(patterns)
                patterns.append([list(pattern_key[0]), list(pattern_key[1]),
                                 list(pattern_key[2]) if pattern_key[2] else None])
            start = stop_visits[0][3]
            arrivals = tuple(visit[3] - start for visit in stop_visits)
            departures = tuple(visit[4] - start for visit in stop_visits)
            vector_key = (arrivals, None if arrivals == departures else departures)
            if vector_key not in vector_ids:
                vector_ids[vector_key] = len(vectors)
                vectors.append(encode_vector(arrivals, departures))
            headsign = row.get("trip_headsign", "")
            if headsign not in headsign_ids:
                headsign_ids[headsign] = len(headsigns)
                headsigns.append(headsign)
            trip_position[trip_id] = len(columns["trip_id"])
            for key, value in (("trip_id", trip_id), ("route", route_index[row["route_id"]]),
                               ("service", service_index[row["service_id"]]), ("pattern", pattern_ids[pattern_key]),
                               ("vector", vector_ids[vector_key]), ("start", start),
                               ("headsign", headsign_ids[headsign]),
                               ("direction", int(row["direction_id"]) if row.get("direction_id", "") != "" else -1)):
                columns[key].append(value)

        frequency_rows = sorted([trip_position[row["trip_id"]], seconds(row["start_time"], "frequencies"),
                                 seconds(row["end_time"], "frequencies"), int(row["headway_secs"]),
                                 int(row.get("exact_times") or 0)] for row in frequencies if row["trip_id"] in trip_position)

    valid_from = valid_date(feed.get("feed_start_date") or min_service_date(service_list), "feed_start_date")
    valid_to = valid_date(feed.get("feed_end_date") or max_service_date(service_list), "feed_end_date")
    package = {
        "format": FORMAT, "schema_version": SCHEMA_VERSION,
        "feed": {"feed_version": feed.get("feed_version", ""), "valid_from": valid_from, "valid_to": valid_to,
                 "timezone": TIMEZONE, "publisher": feed.get("feed_publisher_name", "")},
        "agencies": [list(agency) for agency in agencies], "routes": routes, "stops": stops,
        "services": service_list, "patterns": patterns, "vectors": vectors, "headsigns": headsigns,
        "trips": columns, "frequencies": frequency_rows,
    }
    validate_package(package)
    return package


def encode_vector(arrivals, departures):
    """Arrival increments between consecutive visits, plus dwell times (null when all zero)."""
    increments = [arrivals[0]] + [b - a for a, b in zip(arrivals, arrivals[1:])]
    dwell = [d - a for a, d in zip(arrivals, departures)]
    return [increments, dwell if any(dwell) else None]


def decode_vector(vector):
    arrivals, total = [], 0
    for increment in vector[0]:
        total += increment
        arrivals.append(total)
    dwell = vector[1] or [0] * len(arrivals)
    return arrivals, [a + d for a, d in zip(arrivals, dwell)]


def min_service_date(services):
    dates = [entry[2] for entry in services if entry[2]] + [date for entry in services for date in entry[4]]
    check(dates, "no service dates")
    return min(dates)


def max_service_date(services):
    dates = [entry[3] for entry in services if entry[3]] + [date for entry in services for date in entry[4]]
    check(dates, "no service dates")
    return max(dates)


def validate_package(package):
    """Structural and referential validation; mirrors src/transit-data/package-format.ts."""
    check(package.get("format") == FORMAT and package.get("schema_version") == SCHEMA_VERSION, "unsupported package format")
    feed = package["feed"]
    check(valid_date(feed["valid_from"], "valid_from") <= valid_date(feed["valid_to"], "valid_to"), "empty validity range")
    check(feed["timezone"] == TIMEZONE, "unsupported timezone")
    stops, routes, services = package["stops"], package["routes"], package["services"]
    patterns, vectors, trips = package["patterns"], package["vectors"], package["trips"]
    for key, minimum in MINIMUMS.items():
        count = len(trips["trip_id"]) if key == "trips" else len(package[key])
        check(count >= minimum, f"only {count} {key}; expected at least {minimum}")
    check(len({stop[0] for stop in stops}) == len(stops), "duplicate stop_id")
    for stop in stops:
        check(-90 <= stop[3] <= 90 and -180 <= stop[4] <= 180 and (stop[3], stop[4]) != (0, 0), f"stop {stop[0]} has invalid coordinates")
    check(len({route[0] for route in routes}) == len(routes), "duplicate route_id")
    for service in services:
        check(0 <= service[1] < 128, f"service {service[0]} has invalid weekday mask")
        if service[1]:
            check(service[2] and service[3] and service[2] <= service[3], f"service {service[0]} has invalid date range")
    for pattern in patterns:
        stop_refs, sequences, codes = pattern
        check(len(stop_refs) == len(sequences) >= 2, "pattern length mismatch")
        check(all(0 <= ref < len(stops) for ref in stop_refs), "pattern references unknown stop")
        check(all(b > a for a, b in zip(sequences, sequences[1:])), "pattern stop_sequence is not increasing")
        check(codes is None or len(codes) == len(stop_refs), "pattern pickup/drop-off length mismatch")
    for increments, dwell in vectors:
        check(increments[0] == 0 and all(step >= 0 for step in increments), "timing vector is not monotonic")
        check(dwell is None or (len(dwell) == len(increments) and all(step >= 0 for step in dwell)), "invalid dwell times")
        arrivals, departures = decode_vector([increments, dwell])
        check(all(b >= a for a, b in zip(departures, arrivals[1:])) and departures[-1] <= 48 * 3600, "departure after next arrival")
    count = len(trips["trip_id"])
    check(all(len(column) == count for column in trips.values()), "trip column length mismatch")
    check(len(set(trips["trip_id"])) == count, "duplicate trip_id")
    for index in range(count):
        pattern, vector = trips["pattern"][index], trips["vector"][index]
        check(0 <= trips["route"][index] < len(routes) and 0 <= trips["service"][index] < len(services), "trip reference out of range")
        check(0 <= pattern < len(patterns) and 0 <= vector < len(vectors) and 0 <= trips["headsign"][index] < len(package["headsigns"]), "trip reference out of range")
        check(len(vectors[vector][0]) == len(patterns[pattern][0]), f"trip {trips['trip_id'][index]} vector/pattern length mismatch")
        check(0 <= trips["start"][index] <= 48 * 3600, f"trip {trips['trip_id'][index]} starts outside 0-48h")
    for frequency in package["frequencies"]:
        check(0 <= frequency[0] < count and frequency[1] < frequency[2] and frequency[3] > 0 and frequency[4] in (0, 1), "invalid frequency")
    return package


def manifest_for(payload, package, source, checked_at, built_at, previous=()):
    """The small current manifest devices poll; timestamps describe different events."""
    return {
        "schema_version": SCHEMA_VERSION,
        "package_format": FORMAT,
        "package_hash": sha256(payload),
        "package_bytes": len(payload),
        "package_path": f"packages/gtt-{sha256(payload)}.json",
        "feed_version": package["feed"]["feed_version"],
        "valid_from": package["feed"]["valid_from"],
        "valid_to": package["feed"]["valid_to"],
        "source_url": SOURCE_URL,
        "source_zip_hash": source["sha256"],
        "source_last_modified": source.get("last_modified"),
        "source_etag": source.get("etag"),
        "upstream_checked_at": checked_at,
        "built_at": built_at,
        "attribution": ATTRIBUTION,
        "attribution_url": ATTRIBUTION_URL,
        "licence_url": LICENCE_URL,
        "builder_version": BUILDER_VERSION,
        "counts": {"stops": len(package["stops"]), "routes": len(package["routes"]),
                   "trips": len(package["trips"]["trip_id"]), "patterns": len(package["patterns"]),
                   "vectors": len(package["vectors"]), "services": len(package["services"])},
        "previous": list(previous),
    }


def stops_index(package, package_hash):
    """Small synchronous stop list for the app, derived from the same package."""
    stop_lines = [set() for _ in package["stops"]]
    stop_routes = [set() for _ in package["stops"]]
    trips, routes = package["trips"], package["routes"]
    for pattern_index, route_index in sorted(set(zip(trips["pattern"], trips["route"]))):
        for stop in package["patterns"][pattern_index][0]:
            stop_lines[stop].add(routes[route_index][3] or routes[route_index][0])
            stop_routes[stop].add(routes[route_index][0])
    regular = [index for index, stop in enumerate(package["stops"]) if stop[6] == 0]
    return {
        "package_hash": package_hash, "feed_version": package["feed"]["feed_version"],
        "stops": [{"id": package["stops"][index][0], "code": package["stops"][index][1], "name": package["stops"][index][2],
                   "coordinate": {"latitude": package["stops"][index][3], "longitude": package["stops"][index][4]},
                   "lines": sorted(stop_lines[index])} for index in regular],
        "stop_routes": {package["stops"][index][0]: sorted(stop_routes[index]) for index in regular if stop_routes[index]},
    }


def bundle_files(payload, package, manifest):
    """Files shipped in the APK: the package, its manifest and a stop index from the same package."""
    check(manifest["package_hash"] == sha256(payload), "bundle manifest does not describe the payload")
    return {
        "gtt-timetable.json": payload,
        "gtt-timetable.manifest.json": encode(manifest),
        "gtt-stops.json": encode(stops_index(package, manifest["package_hash"])),
    }


def bundle_metadata(manifest):
    """Summary kept in src/data/manifest.json for diagnostics and saved-travel versioning."""
    return {
        "version": manifest["feed_version"], "validFrom": manifest["valid_from"], "validTo": manifest["valid_to"],
        "sha256": manifest["source_zip_hash"], "packageSha256": manifest["package_hash"],
        "url": SOURCE_URL, "license": LICENCE_URL, "attribution": ATTRIBUTION,
        "sourceLastModified": manifest["source_last_modified"], "upstreamCheckedAt": manifest["upstream_checked_at"],
        "builtAt": manifest["built_at"], **{key: manifest["counts"][key] for key in ("stops", "trips", "patterns", "vectors")},
    }
