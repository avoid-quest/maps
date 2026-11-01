#!/usr/bin/env python3
"""Extract the small identity-join replay fixture from archived GTT data (not run by tests).

usage: make-identity-fixture.py OLD_GTFS_DIR NEW_GTFS_DIR TRIP_UPDATES.pb OUT.json [OLD_STOPS.json]

OLD_STOPS.json: the app stop list of the older package, for stops since removed from stops.txt.

OLD_GTFS_DIR: an older GTT export (routes/trips/stop_times/calendar*/feed_info; stops.txt and
agency.txt may come from the newer export since stop IDs are stable). NEW_GTFS_DIR: the export
current when TRIP_UPDATES.pb was captured. The fixture keeps, from the old export, only the trips
whose schedule identity (route, direction, shape, first time) matches a live trip, plus — from the
new export — only the trips.txt and calendar rows a device would read for those live trip IDs.
"""
import csv, io, json, pathlib, sys, tempfile, zipfile
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))
import gtt_package as gtt

old_dir, new_dir, pb_path, out_path = map(pathlib.Path, sys.argv[1:5])

def varint(b, i):
    r = s = 0
    while True:
        c = b[i]; i += 1; r |= (c & 0x7f) << s; s += 7
        if c < 0x80: return r, i
def fields(b):
    i, out = 0, {}
    while i < len(b):
        k, i = varint(b, i); f, w = k >> 3, k & 7
        if w == 0: v, i = varint(b, i)
        elif w == 2: l, i = varint(b, i); v = b[i:i + l]; i += l
        elif w == 1: v = b[i:i + 8]; i += 8
        elif w == 5: v = b[i:i + 4]; i += 4
        out.setdefault(f, []).append(v)
    return out
feed = fields(pb_path.read_bytes())
live = []
for entity in feed.get(2, []):
    e = fields(entity)
    if 3 in e:
        d = fields(fields(e[3][0])[1][0])
        if not all(key in d for key in (1, 2, 3)):
            print("skipping a trip update without trip_id/start_time/start_date", file=sys.stderr)
            continue
        live.append((d[1][0].decode(), d[2][0].decode(), d[3][0].decode()))

def rows(directory, name):
    return list(csv.DictReader(open(directory / name, encoding="utf-8-sig")))
new_trips = {r["trip_id"]: r for r in rows(new_dir, "trips.txt")}
live_ids = {trip_id for trip_id, _, _ in live}
identities = set()
for trip_id, start, _ in live:
    r = new_trips.get(trip_id)
    if r: identities.add((r["route_id"], r["direction_id"] or "-1", r["shape_id"], gtt.seconds(start, "rt")))

with tempfile.TemporaryDirectory() as scratch:
    archive = pathlib.Path(scratch) / "old.zip"
    with zipfile.ZipFile(archive, "w") as z:
        for name in ("routes.txt", "trips.txt", "stop_times.txt", "calendar.txt", "calendar_dates.txt", "feed_info.txt"):
            z.write(old_dir / name, name)
        z.write((old_dir / "agency.txt") if (old_dir / "agency.txt").exists() else (new_dir / "agency.txt"), "agency.txt")
        stops = {r["stop_id"]: r for r in rows(old_dir if (old_dir / "stops.txt").exists() else new_dir, "stops.txt")}
        if len(sys.argv) > 5:
            for stop in json.load(open(sys.argv[5])):
                stops.setdefault(stop["id"], {"stop_id": stop["id"], "stop_code": stop["code"], "stop_name": stop["name"],
                                              "stop_lat": stop["coordinate"]["latitude"], "stop_lon": stop["coordinate"]["longitude"]})
        text = io.StringIO(); writer = csv.DictWriter(text, ["stop_id", "stop_code", "stop_name", "stop_lat", "stop_lon"], extrasaction="ignore")
        writer.writeheader(); writer.writerows(stops.values()); z.writestr("stops.txt", text.getvalue())
    package = gtt.build_package(archive)

t = package["trips"]
keep = [i for i in range(len(t["trip_id"]))
        if (package["routes"][t["route"][i]][0], str(t["direction"][i]), package["shapes"][t["shape"][i]], t["start"][i]) in identities]
patterns = sorted({t["pattern"][i] for i in keep}); vectors = sorted({t["vector"][i] for i in keep})
services = sorted({t["service"][i] for i in keep}); routes = sorted({t["route"][i] for i in keep}); shapes = sorted({t["shape"][i] for i in keep})
headsigns = sorted({t["headsign"][i] for i in keep})
stop_refs = sorted({ref for p in patterns for ref in package["patterns"][p][0]})
remap = lambda values: {old: new for new, old in enumerate(values)}
P, V, S, R, H, SH, ST = map(remap, (patterns, vectors, services, routes, headsigns, shapes, stop_refs))
subset = {
    "format": gtt.FORMAT, "schema_version": gtt.SCHEMA_VERSION, "feed": package["feed"], "agencies": package["agencies"],
    "routes": [package["routes"][i] for i in routes], "stops": [package["stops"][i] for i in stop_refs],
    "services": [package["services"][i] for i in services],
    "patterns": [[[ST[ref] for ref in package["patterns"][p][0]], package["patterns"][p][1], package["patterns"][p][2]] for p in patterns],
    "vectors": [package["vectors"][v] for v in vectors], "headsigns": [package["headsigns"][h] for h in headsigns],
    "shapes": [package["shapes"][s] for s in shapes],
    "trips": {"trip_id": [t["trip_id"][i] for i in keep], "route": [R[t["route"][i]] for i in keep], "service": [S[t["service"][i]] for i in keep],
              "pattern": [P[t["pattern"][i]] for i in keep], "vector": [V[t["vector"][i]] for i in keep], "start": [t["start"][i] for i in keep],
              "headsign": [H[t["headsign"][i]] for i in keep], "direction": [t["direction"][i] for i in keep], "shape": [SH[t["shape"][i]] for i in keep]},
    "frequencies": [],
}
new_services = {new_trips[i]["service_id"] for i in live_ids if i in new_trips}
import datetime
# The live dates plus the following fortnight: the calendar evidence a device compares.
dates = sorted({(datetime.date(int(d[:4]), int(d[4:6]), int(d[6:])) + datetime.timedelta(days=offset)).strftime("%Y%m%d")
                for _, _, d in live for offset in range(14)})
fixture = {
    "about": "GTT data (Data source: GTT S.p.A. – Gruppo Torinese Trasporti, https://www.gtt.to.it); identity-join replay subset",
    "liveTrips": len(live), "oldPackage": subset,
    "remapTrips": [[i, new_trips[i]["route_id"], new_trips[i]["direction_id"], new_trips[i]["shape_id"], new_trips[i]["service_id"]] for i in sorted(live_ids) if i in new_trips],
    "remapCalendar": [r for r in rows(new_dir, "calendar.txt") if r["service_id"] in new_services],
    "remapExceptions": [r for r in rows(new_dir, "calendar_dates.txt") if r["service_id"] in new_services and r["date"] in dates],
}
out_path.write_text(json.dumps(fixture, ensure_ascii=True, separators=(",", ":")) + "\n")
print(out_path, "live", len(live), "old trips kept", len(keep), "bytes", out_path.stat().st_size)
