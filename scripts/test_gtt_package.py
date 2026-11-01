"""Offline checks for GTT timetable compaction, validation and the publication pipeline."""

import contextlib
import importlib.util
import io
import json
import pathlib
import sys
import tempfile
import unittest
import unittest.mock
import urllib.error
import zipfile

import gtt_package as gtt

ROOT = pathlib.Path(__file__).resolve().parent.parent


def synthetic_zip(path, *, trips=5000, mutate=None, version="20261021"):
    """A small but valid GTFS zip satisfying the production size floors."""
    files = {
        "feed_info.txt": f"feed_publisher_name,feed_version,feed_start_date,feed_end_date\nGTT,{version},20261020,20261130\n",
        "agency.txt": "agency_id,agency_name,agency_url,agency_timezone\nU,GTT Servizio Urbano,https://www.gtt.to.it,Europe/Rome\n",
        "routes.txt": "route_id,agency_id,route_short_name,route_long_name,route_type\n4U,U,4,Tram 4,0\nMETROU,U,M1,Metro,1\n"
                      + "".join(f"R{i},U,R{i},Filler,3\n" for i in range(50)),
        "stops.txt": "stop_id,stop_code,stop_name,stop_lat,stop_lon,location_type,parent_station\n"
                     "A,101,Alfa,45.07,7.68,,\nB,102,Beta,45.071,7.681,,\nC,103,Gamma,45.072,7.682,,\nST,900,Station,45.07,7.68,1,\n"
                     + "".join(f"F{i},9{i},Filler {i},45.{i:04d},7.5,,\n" for i in range(1000)),
        "calendar.txt": "service_id,monday,tuesday,wednesday,thursday,friday,saturday,sunday,start_date,end_date\n"
                        "ALL,1,1,1,1,1,1,1,20261020,20261130\n" + "".join(f"S{i},0,0,0,0,0,0,0,20261020,20261130\n" for i in range(10)),
        "calendar_dates.txt": "service_id,date,exception_type\nALL,20261102,2\nHOL,20261102,1\n",
        "trips.txt": "route_id,service_id,trip_id,trip_headsign,direction_id\n4U,ALL,T1,Gamma,0\n4U,ALL,TLATE,Gamma,0\n4U,HOL,LOOP,Alfa,1\n"
                     + "".join(f"R{i % 50},S{i % 10},X{i:05d},Filler,0\n" for i in range(trips)),
        "stop_times.txt": "trip_id,arrival_time,departure_time,stop_id,stop_sequence,pickup_type,drop_off_type\n"
                          "T1,08:00:00,08:00:00,A,1,0,0\nT1,08:02:00,08:02:30,B,3,0,0\nT1,08:05:00,08:05:00,C,7,0,1\n"
                          "TLATE,25:30:00,25:30:00,A,1,0,0\nTLATE,25:32:00,25:32:30,B,3,0,0\nTLATE,25:35:00,25:35:00,C,7,0,1\n"
                          "LOOP,09:00:00,09:00:00,A,1,0,0\nLOOP,09:01:00,09:01:00,B,2,1,0\nLOOP,09:02:00,09:02:00,A,3,0,0\n"
                          + "".join(f"X{i:05d},06:00:00,06:00:00,F0,1,0,0\nX{i:05d},06:01:00,06:01:00,F1,2,0,0\n" for i in range(trips)),
        "frequencies.txt": "trip_id,start_time,end_time,headway_secs,exact_times\nT1,12:00:00,13:00:00,600,0\n",
    }
    if mutate:
        mutate(files)
    with zipfile.ZipFile(path, "w") as archive:
        for name, data in files.items():
            archive.writestr(name, data)
    return path


def load_pipeline():
    spec = importlib.util.spec_from_file_location("gtt_pipeline", pathlib.Path(__file__).with_name("gtt-pipeline.py"))
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


class CompactionTests(unittest.TestCase):
    def setUp(self):
        self.folder = tempfile.TemporaryDirectory()
        self.dir = pathlib.Path(self.folder.name)

    def tearDown(self):
        self.folder.cleanup()

    def build(self, **options):
        return gtt.build_package(synthetic_zip(self.dir / "gtfs.zip", **options))

    def trip(self, package, trip_id):
        index = package["trips"]["trip_id"].index(trip_id)
        pattern = package["patterns"][package["trips"]["pattern"][index]]
        arrivals, departures = gtt.decode_vector(package["vectors"][package["trips"]["vector"][index]])
        start = package["trips"]["start"][index]
        stops = [package["stops"][ref][0] for ref in pattern[0]]
        return stops, pattern[1], pattern[2], [start + value for value in arrivals], [start + value for value in departures]

    def test_round_trip_preserves_sequences_repeated_visits_and_after_midnight_times(self):
        package = self.build()
        stops, sequences, codes, arrivals, departures = self.trip(package, "T1")
        self.assertEqual((stops, sequences, codes), (["A", "B", "C"], [1, 3, 7], [0, 0, 1]))
        self.assertEqual(arrivals, [28800, 28920, 29100])
        self.assertEqual(departures, [28800, 28950, 29100])
        late = self.trip(package, "TLATE")
        self.assertEqual(late[3], [91800, 91920, 92100], "times above 24:00 are kept, not wrapped")
        loop = self.trip(package, "LOOP")
        self.assertEqual((loop[0], loop[1], loop[2]), (["A", "B", "A"], [1, 2, 3], [0, 4, 0]))
        self.assertEqual(package["frequencies"], [[package["trips"]["trip_id"].index("T1"), 43200, 46800, 600, 0]])
        services = {entry[0]: entry for entry in package["services"]}
        self.assertEqual(services["ALL"][5], ["20261102"])
        self.assertEqual(services["HOL"][1:5], [0, "", "", ["20261102"]])
        self.assertEqual(package["feed"]["valid_from"], "20261020")
        self.assertEqual(len(package["patterns"]), 3, "T1/TLATE share a pattern; 5000 filler trips share one")

    def test_shapes_and_source_crcs_support_identity_joins(self):
        zip_path = synthetic_zip(self.dir / "shapes.zip", mutate=lambda files: files.update(
            {"trips.txt": files["trips.txt"].replace("route_id,service_id,trip_id,trip_headsign,direction_id\n", "route_id,service_id,trip_id,trip_headsign,direction_id,shape_id\n")
                          .replace("4U,ALL,T1,Gamma,0\n", "4U,ALL,T1,Gamma,0,4A\n").replace("4U,ALL,TLATE,Gamma,0\n", "4U,ALL,TLATE,Gamma,0,4A\n")}))
        package = gtt.build_package(zip_path)
        index = package["trips"]["trip_id"].index("T1")
        self.assertEqual(package["shapes"][package["trips"]["shape"][index]], "4A")
        self.assertEqual(package["schema_version"], 2)
        crcs = gtt.source_crcs(zip_path)
        with zipfile.ZipFile(zip_path) as archive:
            self.assertEqual(crcs["trips.txt"], f"{archive.getinfo('trips.txt').CRC:08x}")
        manifest = gtt.manifest_for(gtt.encode(package), package, {"sha256": "0" * 64, "crc32": crcs}, None, "2026-10-21T03:15:00Z")
        self.assertEqual(manifest["source_crc32"], crcs)

    def test_encoding_is_deterministic_ascii(self):
        first = gtt.encode(self.build())
        second = gtt.encode(gtt.build_package(synthetic_zip(self.dir / "again.zip")))
        self.assertEqual(first, second)
        first.decode("ascii")

    def test_invalid_sources_are_rejected(self):
        def blank_time(files):
            files["stop_times.txt"] = files["stop_times.txt"].replace("T1,08:02:00,08:02:30", "T1,,")
        def unknown_stop(files):
            files["stop_times.txt"] = files["stop_times.txt"].replace("T1,08:05:00,08:05:00,C", "T1,08:05:00,08:05:00,ZZ")
        def duplicate_sequence(files):
            files["stop_times.txt"] = files["stop_times.txt"].replace("B,3,0,0\nT1", "B,1,0,0\nT1", 1)
        def wrong_timezone(files):
            files["agency.txt"] = files["agency.txt"].replace("Europe/Rome", "Europe/London")
        for mutate, message in ((blank_time, "never interpolated"), (unknown_stop, "unknown stop"),
                                (duplicate_sequence, "repeats a stop_sequence"), (wrong_timezone, "Europe/Rome")):
            with self.subTest(message), self.assertRaisesRegex(gtt.PackageError, message):
                self.build(mutate=mutate)
        with self.assertRaisesRegex(gtt.PackageError, "expected at least"):
            self.build(trips=100)

    def test_duplicate_and_dangling_source_rows_are_rejected(self):
        for mutate, message in (
            (lambda files: files.update({"trips.txt": files["trips.txt"] + "4U,ALL,T1,Gamma,0\n"}), "duplicate trip_id"),
            (lambda files: files.update({"calendar.txt": files["calendar.txt"] + "ALL,1,1,1,1,1,1,1,20261020,20261130\n"}), "duplicate calendar service_id"),
            (lambda files: files.update({"frequencies.txt": files["frequencies.txt"] + "NOPE,12:00:00,13:00:00,600,0\n"}), "unknown trips"),
            (lambda files: files.update({"frequencies.txt": "trip_id,start_time,end_time,headway_secs,exact_times\nT1,12:00:00,13:00:00,1,0\n"}), "invalid frequency"),
        ):
            with self.subTest(message), self.assertRaisesRegex(gtt.PackageError, message):
                self.build(mutate=mutate)

    def test_validation_rejects_broken_references(self):
        package = self.build()
        package["trips"]["pattern"][0] = len(package["patterns"])
        with self.assertRaisesRegex(gtt.PackageError, "out of range"):
            gtt.validate_package(package)
        package = self.build()
        package["patterns"][0][1] = [3, 2, 1][: len(package["patterns"][0][1])]
        with self.assertRaisesRegex(gtt.PackageError, "increasing"):
            gtt.validate_package(package)

    def test_bundle_files_share_one_package_hash(self):
        package = self.build()
        payload = gtt.encode(package)
        manifest = gtt.manifest_for(payload, package, {"sha256": "0" * 64}, "2026-10-21T03:15:00Z", "2026-10-21T03:15:00Z")
        files = gtt.bundle_files(payload, package, manifest)
        stops = json.loads(files["gtt-stops.json"])
        self.assertEqual(stops["package_hash"], gtt.sha256(payload))
        self.assertEqual(json.loads(files["gtt-timetable.manifest.json"])["package_path"], f"packages/gtt-{gtt.sha256(payload)}.json")
        alfa = next(stop for stop in stops["stops"] if stop["id"] == "A")
        self.assertEqual(alfa["lines"], ["4"])
        self.assertEqual(stops["stop_routes"]["A"], ["4U"])
        self.assertFalse(any(stop["id"] == "ST" for stop in stops["stops"]), "stations are not boardable stops")


class PipelineTests(unittest.TestCase):
    SITE = "https://example.test/gtt/"

    def setUp(self):
        self.folder = tempfile.TemporaryDirectory()
        self.dir = pathlib.Path(self.folder.name)
        self.pipeline = load_pipeline()
        self.published = {}

    def tearDown(self):
        self.folder.cleanup()

    def run_pipeline(self, *, previous, source_zip=None, not_modified=False, extra=()):
        output = self.dir / f"site-{len(list(self.dir.iterdir()))}"
        pipeline = self.pipeline
        pipeline.fetch_previous = lambda site: previous
        pipeline.fetch_bytes = lambda url: self.published[url]

        def download(prev, destination):
            if not_modified:
                return None
            data = source_zip.read_bytes()
            destination.write_bytes(data)
            return {"sha256": gtt.sha256(data), "etag": '"e2"', "last_modified": "2026-10-21T02:26:59Z"}
        pipeline.download_source = download
        if source_zip is None and not not_modified and "--zip" not in extra:
            raise AssertionError("no source")
        argv = ["gtt-pipeline.py", "--site-url", self.SITE, "--output", str(output), *extra]
        stdout = io.StringIO()
        with unittest.mock.patch.object(sys, "argv", argv), contextlib.redirect_stdout(stdout):
            pipeline.main()
        return output, stdout.getvalue()

    def publish(self, output):
        for path in output.rglob("*.json"):
            self.published[self.SITE + path.relative_to(output).as_posix()] = path.read_bytes()
        return json.loads((output / "manifest.json").read_text())

    def test_publishes_only_on_change_or_heartbeat_and_carries_previous_packages(self):
        first_zip = synthetic_zip(self.dir / "first.zip")
        output, log = self.run_pipeline(previous=None, source_zip=first_zip)
        self.assertIn("publish=true", log)
        first = self.publish(output)
        self.assertTrue((output / first["package_path"]).exists())
        self.assertEqual(gtt.sha256((output / first["package_path"]).read_bytes()), first["package_hash"])

        output, log = self.run_pipeline(previous=first, not_modified=True)
        self.assertIn("publish=false", log)
        self.assertEqual(list(output.iterdir()), [], "nothing written when unchanged")
        output, log = self.run_pipeline(previous=first, source_zip=first_zip)
        self.assertIn("publish=false", log, "same package from new bytes is not republished")

        old = dict(first, upstream_checked_at="2026-10-01T00:00:00Z")
        output, log = self.run_pipeline(previous=old, not_modified=True)
        self.assertIn("publish=true", log)
        heartbeat = json.loads((output / "manifest.json").read_text())
        self.assertEqual(heartbeat["package_hash"], first["package_hash"])
        self.assertNotEqual(heartbeat["upstream_checked_at"], old["upstream_checked_at"])
        self.assertTrue((output / first["package_path"]).exists(), "heartbeat republishes the verified package")

        changed_zip = synthetic_zip(self.dir / "second.zip", version="20261022")
        output, log = self.run_pipeline(previous=first, source_zip=changed_zip)
        second = json.loads((output / "manifest.json").read_text())
        self.assertNotEqual(second["package_hash"], first["package_hash"])
        self.assertEqual([entry["package_hash"] for entry in second["previous"]], [first["package_hash"]])
        self.assertTrue((output / first["package_path"]).exists() and (output / second["package_path"]).exists())

    def test_local_zip_records_no_upstream_confirmation_without_evidence(self):
        zip_path = synthetic_zip(self.dir / "old.zip")
        output, _ = self.run_pipeline(previous=None, extra=("--zip", str(zip_path)))
        manifest = json.loads((output / "manifest.json").read_text())
        self.assertIsNone(manifest["upstream_checked_at"], "an old local file is not a fresh check against GTT")
        self.assertIsNone(manifest["source_last_modified"])
        output, _ = self.run_pipeline(previous=None, extra=("--zip", str(zip_path), "--zip-checked-at", "2026-10-21T04:00:00+02:00",
                                                           "--zip-last-modified", "2026-10-21T02:26:59Z"))
        preserved = json.loads((output / "manifest.json").read_text())
        self.assertEqual(preserved["upstream_checked_at"], "2026-10-21T02:00:00Z")
        self.assertEqual(preserved["source_last_modified"], "2026-10-21T02:26:59Z")
        # With no confirmation published, an unchanged local rebuild does not invent one either.
        self.publish(output)
        output, log = self.run_pipeline(previous=manifest, extra=("--zip", str(zip_path)))
        self.assertIn("publish=true", log)
        self.assertIsNone(json.loads((output / "manifest.json").read_text())["upstream_checked_at"])

    def test_release_mirror_output_is_flat_with_the_same_manifest(self):
        zip_path = synthetic_zip(self.dir / "flat.zip")
        release = self.dir / "release"
        output, _ = self.run_pipeline(previous=None, extra=("--zip", str(zip_path), "--release-output", str(release)))
        manifest = json.loads((output / "manifest.json").read_text())
        self.assertEqual((release / "manifest.json").read_bytes(), (output / "manifest.json").read_bytes())
        self.assertEqual(sorted(path.name for path in release.iterdir()), sorted(["manifest.json", f"gtt-{manifest['package_hash']}.json"]))
        self.assertEqual((release / f"gtt-{manifest['package_hash']}.json").read_bytes(), (output / manifest["package_path"]).read_bytes())

    def test_rejected_source_publishes_nothing(self):
        def blank_time(files):
            files["stop_times.txt"] = files["stop_times.txt"].replace("T1,08:02:00,08:02:30", "T1,,")
        broken = synthetic_zip(self.dir / "broken.zip", mutate=blank_time)
        before = set(self.dir.iterdir())
        with self.assertRaises(gtt.PackageError):
            self.run_pipeline(previous=None, source_zip=broken)
        created = [path for path in set(self.dir.iterdir()) - before if path.name.startswith("site-")]
        self.assertTrue(created and all(not any(path.iterdir()) for path in created), "nothing is written for a rejected source")

    def test_older_sources_and_transient_errors_fail_closed(self):
        newer = self.publish(self.run_pipeline(previous=None, source_zip=synthetic_zip(self.dir / "new.zip", version="20261102"))[0])
        older = synthetic_zip(self.dir / "old.zip", version="20261101")
        with self.assertRaisesRegex(SystemExit, "older than the published"):
            self.run_pipeline(previous=newer, source_zip=older)
        def offline(url, *args, **kwargs):
            raise urllib.error.HTTPError(url, 503, "unavailable", {}, None)
        fresh = load_pipeline()
        with unittest.mock.patch.object(fresh.urllib.request, "urlopen", offline):
            with self.assertRaises(urllib.error.HTTPError):
                fresh.fetch_previous(self.SITE)
        fresh.fetch_bytes = offline
        with self.assertRaises(urllib.error.HTTPError, msg="a transient error never drops rollback packages"):
            fresh.carried_packages(newer, self.SITE, 2)
        def gone(url, *args, **kwargs):
            raise urllib.error.HTTPError(url, 404, "gone", {}, None)
        fresh.fetch_bytes = gone
        self.assertEqual(fresh.carried_packages(newer, self.SITE, 2), [])

    def test_changed_source_that_cannot_be_ordered_fails_closed(self):
        first = self.publish(self.run_pipeline(previous=None, source_zip=synthetic_zip(self.dir / "a.zip"))[0])
        same_version = synthetic_zip(self.dir / "b.zip", trips=5001)
        with self.assertRaisesRegex(SystemExit, "cannot be ordered"):
            self.run_pipeline(previous=first, source_zip=same_version)

    def test_published_package_paths_are_validated_before_use(self):
        first = self.publish(self.run_pipeline(previous=None, source_zip=synthetic_zip(self.dir / "a.zip"))[0])
        bad_hash = "../" + "0" * 61
        tampered = dict(first, previous=[{"package_hash": bad_hash, "package_path": f"packages/gtt-{bad_hash}.json", "feed_version": "1"}])
        with self.assertRaises(gtt.PackageError):
            self.pipeline.gtt_manifest(tampered)
        fetched = []
        self.pipeline.fetch_bytes = lambda url: fetched.append(url) or b""
        with self.assertRaises(gtt.PackageError):
            self.pipeline.carried_packages(tampered, self.SITE, 3)
        self.assertEqual(fetched, [], "nothing is fetched or written for an invalid path")

    def test_last_modified_round_trips_between_http_and_iso(self):
        self.assertEqual(self.pipeline.http_date_to_iso("Sun, 01 Nov 2026 02:26:59 GMT"), "2026-11-01T02:26:59Z")
        self.assertEqual(self.pipeline.iso_to_http_date("2026-11-01T02:26:59Z"), "Sun, 01 Nov 2026 02:26:59 GMT")


class ShippedBundleTests(unittest.TestCase):
    def test_bundled_package_matches_its_manifest_and_stop_index(self):
        data = ROOT / "src/data"
        payload = (data / "gtt-timetable.gttpkg").read_bytes()
        manifest = json.loads((data / "gtt-timetable.manifest.json").read_text())
        self.assertEqual(gtt.sha256(payload), manifest["package_hash"])
        self.assertEqual(len(payload), manifest["package_bytes"])
        package = gtt.validate_package(json.loads(payload))
        self.assertEqual(json.loads((data / "gtt-stops.json").read_text()), gtt.stops_index(package, manifest["package_hash"]),
                         "the stop index content matches the package, not just its hash")
        self.assertEqual(json.loads((data / "manifest.json").read_text())["gtt"]["packageSha256"], manifest["package_hash"])
        self.assertEqual(package["feed"]["feed_version"], manifest["feed_version"])
        self.assertFalse((data / "gtt-trips.json").exists(), "the old trip lookup is gone")


if __name__ == "__main__":
    unittest.main()
