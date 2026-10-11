"""Offline production/fixture checks for the independently regenerable place package."""

import copy
import json
import os
import pathlib
import subprocess
import sys
import tempfile
import unittest
import zipfile

from place_package import (
    COLUMNS, INPUT_SCHEMA, LICENSES, MAIN_CATEGORIES, ValidationError, compact_places,
    apply_exclusions, apply_phone_overrides, decode_package, encoded, extraction_sql, merge_places, normalize_raw, prepare_places,
    read_json, sha256, source_fields, validate_config,
)

ROOT = pathlib.Path(__file__).resolve().parent.parent
BOUNDS = [7.6, 45.0, 7.77, 45.14]


def raw_place(identity="a", name="Fixture restaurant"):
    return {
        "id": identity, "names": {"primary": name},
        "taxonomy": {"primary": "restaurant", "hierarchy": ["food_and_drink", "restaurant"]},
        "bbox": {"xmin": 7.68, "ymin": 45.07}, "confidence": 0.9, "operating_status": "open",
        "addresses": [{"freeform": "Via Esempio 1", "locality": "Torino"}],
        "websites": ["https://example.org"], "phones": ["+390110000000"],
        "sources": [{"dataset": "Foursquare", "license": "Apache-2.0", "record_id": identity,
                     "confidence": None, "update_time": "2025-01-03T00:00:00.000", "between": None}],
    }


def normalized(identity="a", name="Fixture restaurant"):
    return normalize_raw([raw_place(identity, name)], BOUNDS)[0][0]


def package_for(places):
    return compact_places(places, {"schemaVersion": 1, "transformVersion": "1", "bounds": BOUNDS,
                                  "count": len(places), "licenses": [["Foursquare", "Apache-2.0"]]})


def fixture(directory, rows=None, supplements=None, baseline_ids=None):
    rows = rows if rows is not None else [raw_place()]
    supplements = supplements if supplements is not None else [normalized("supplement", "Fixture library")]
    supplements = copy.deepcopy(supplements)
    for item in supplements:
        item["category"], item["hierarchy"] = "library", ["education", "library"]
    directory = pathlib.Path(directory)
    def write(name, value):
        payload = encoded(value)
        (directory / name).write_bytes(payload)
        return sha256(payload)
    original_hash = "0" * 64
    supplement_hash = write("supplements.json", supplements)
    supplement_meta_hash = write("supplement-meta.json", {
        "schemaVersion": 1, "version": "2026-10-11.1", "recordCount": len(supplements),
        "sha256": supplement_hash, "originalPackageSha256": original_hash,
        "originalRelease": "2026-09-23.1", "originalPreparedAt": "2026-10-11T14:21:02.601179+00:00",
    })
    ids = baseline_ids if baseline_ids is not None else [place["id"] for place in supplements]
    baseline_hash = write("baseline.json", {"schemaVersion": 1, "count": len(ids), "ids": ids,
                                           "originalPackageSha256": original_hash})
    exclusions_hash = write("exclusions.json", {"schemaVersion": 1, "version": "2026-10-11.1", "records": []})
    overrides_hash = write("phone-overrides.json", {"schemaVersion": 1, "version": "2026-10-11.1", "records": []})
    config = {"schemaVersion": 1, "transformVersion": "1", "inputSchema": INPUT_SCHEMA,
              "release": "2026-09-23.1", "bounds": BOUNDS, "retrievedAt": "2026-10-11",
              "preparedAt": "2026-10-11", "inputSha256": write("raw.json", rows),
              "mainCategories": MAIN_CATEGORIES, "rawCount": len(rows),
              "mainCount": sum(bool(row["names"]["primary"]) and row["operating_status"] != "permanently_closed" for row in rows),
              "count": len({"overture:" + row["id"] for row in rows if row["names"]["primary"]
                            and row["operating_status"] != "permanently_closed"} |
                           {place["id"] for place in supplements}) -
                       len({"overture:" + row["id"] for row in rows if row["operating_status"] == "permanently_closed"} &
                           {place["id"] for place in supplements}),
              "licenses": [["Foursquare", "Apache-2.0"]], "supplements": "supplements.json",
              "supplementMetadata": "supplement-meta.json", "supplementSha256": supplement_hash,
              "supplementMetadataSha256": supplement_meta_hash,
              "baseline": "baseline.json", "baselineSha256": baseline_hash,
              "exclusions": "exclusions.json", "exclusionsSha256": exclusions_hash,
              "phoneOverrides": "phone-overrides.json", "phoneOverridesSha256": overrides_hash}
    write("source.json", config)
    return config


class PlacePackageTests(unittest.TestCase):
    def test_package_schema_headers_require_integer_version_one(self):
        place = normalized()
        package = package_for([place])
        package.update(supplement={"schemaVersion": 1}, exclusions={"schemaVersion": 1},
                       phoneOverrides={"schemaVersion": 1, "version": "2026-10-11.1", "records": []})
        self.assertEqual(decode_package(package), [place])
        for field in (None, "supplement", "exclusions", "phoneOverrides"):
            for version in (True, False, 1.0, "1", 0, 2):
                with self.subTest(header=field or "package", version=repr(version)):
                    malformed = copy.deepcopy(package)
                    header = malformed if field is None else malformed[field]
                    header["schemaVersion"] = version
                    with self.assertRaisesRegex(ValidationError, "schemaVersion"):
                        decode_package(malformed)

    def test_source_and_companion_schema_headers_fail_before_cli_output(self):
        companions = {
            "source.json": None,
            "supplement-meta.json": "supplementMetadataSha256",
            "baseline.json": "baselineSha256",
            "exclusions.json": "exclusionsSha256",
            "phone-overrides.json": "phoneOverridesSha256",
        }
        with tempfile.TemporaryDirectory() as directory:
            folder = pathlib.Path(directory)
            config = fixture(folder)
            validate_config(config)
            self.assertEqual(len(decode_package(json.loads(prepare_places(folder / "raw.json", folder / "source.json")[0]))), 2)
            for filename, hash_field in companions.items():
                for version in (True, False, 1.0, "1", 0, 2):
                    with self.subTest(header=filename, version=repr(version)):
                        config = fixture(folder)
                        header = read_json(folder / filename)
                        header["schemaVersion"] = version
                        payload = encoded(header)
                        (folder / filename).write_bytes(payload)
                        if hash_field:
                            # Keep integrity pins valid so rejection exercises header validation.
                            config[hash_field] = sha256(payload)
                            (folder / "source.json").write_bytes(encoded(config))
                        output = folder / "output"
                        output.mkdir(exist_ok=True)
                        sentinel = output / "places.compact.json"
                        sentinel.write_bytes(b"unchanged existing package\n")
                        result = self.cli(folder, "--places", str(folder / "raw.json"), "--output", str(output))
                        self.assertNotEqual(result.returncode, 0)
                        self.assertIn("schemaVersion", result.stderr)
                        self.assertEqual(sentinel.read_bytes(), b"unchanged existing package\n")
                        self.assertEqual(list(output.iterdir()), [sentinel])

    def test_evidenced_exclusion_requires_exact_original_fields_and_preserves_other_records(self):
        a, b = normalized(), normalized("b")
        exclusions = {"schemaVersion": 1, "version": "2026-10-11.1", "records": [{
            "id": a["id"], "expected": {"phone": a["phone"], "coordinate": a["coordinate"]},
            "reason": "Independent source establishes a locality conflict.",
            "source": {"url": "https://example.org/pharmacy", "checkedAt": "2026-10-11T17:00:00Z"}}]}
        remaining, removed = apply_exclusions([a, b], exclusions)
        self.assertEqual(remaining, [b]); self.assertEqual(removed, {a["id"]})
        a["phone"] = "+390110000001"
        with self.assertRaisesRegex(ValidationError, "excluded record changed"):
            apply_exclusions([a, b], exclusions)

    def test_phone_override_asserts_original_and_round_trips_separate_correction_provenance(self):
        a, b = normalized(), normalized("b")
        record = {"id": a["id"], "field": "phone", "originalValue": a["phone"], "value": "3939524597",
                  "url": "https://example.org/branches", "checkedAt": "2026-10-11T17:00:00Z",
                  "reason": "First-party site identifies the correct branch phone."}
        overrides = {"schemaVersion": 1, "version": "2026-10-11.1", "records": [record]}
        corrected = apply_phone_overrides([a, b], overrides)
        self.assertEqual(corrected[0]["phone"], "3939524597")
        self.assertEqual(corrected[0]["provenance"], a["provenance"])
        self.assertEqual(corrected[0]["dataUpdatedAt"], a["dataUpdatedAt"])
        self.assertEqual(corrected[1], b)
        self.assertIn("Telefono corretto da sito ufficiale", corrected[0]["attributions"][-1])
        metadata = {"schemaVersion": 1, "transformVersion": "1", "bounds": BOUNDS,
                    "count": 2, "licenses": [["Foursquare", "Apache-2.0"]], "phoneOverrides": overrides}
        first = compact_places(corrected, metadata)
        self.assertEqual(decode_package(first), corrected)
        self.assertEqual(encoded(first), encoded(compact_places(apply_phone_overrides([a, b], overrides), metadata)))
        a["phone"] = "+390110000001"
        with self.assertRaisesRegex(ValidationError, "original phone changed"):
            apply_phone_overrides([a, b], overrides)

    def test_compact_is_lossless_deterministic_and_preserves_missing_null(self):
        a, b = normalized("a"), normalized("b")
        a["website"] = None
        del a["phone"]
        del a["provenance"][0]["record_id"]
        a["provenance"][0]["new_source_property"] = {"optional": None, "value": 4}
        a.update(source_fields(a["provenance"]))
        b["provenance"][0] = dict(reversed(list(b["provenance"][0].items())))
        package = package_for([b, a])
        self.assertEqual(decode_package(package), [a, b])
        self.assertEqual(encoded(package), encoded(package_for([a, b])))
        self.assertEqual(package["places"][0][-1], 3)
        self.assertEqual(package["sources"][0][-1], 2)

    def test_main_wins_but_explicit_closure_removes_supplement_and_baseline(self):
        closure = raw_place("closed")
        closure["operating_status"] = "permanently_closed"
        main, closed = normalize_raw([raw_place(), closure], BOUNDS)
        supplements = [normalized("a", "Stale name"), normalized("closed"), normalized("library")]
        merged = merge_places(main, supplements, closed, BOUNDS, [place["id"] for place in supplements])
        self.assertEqual([place["id"] for place in merged], ["overture:a", "overture:library"])
        self.assertEqual(merged[0]["name"], "Fixture restaurant")
        self.assertEqual(merged[1]["dataUpdatedAt"], "2025-01-03T00:00:00.000")

    def test_baseline_disappearance_requires_explicit_closure(self):
        with self.assertRaisesRegex(ValidationError, "baseline IDs removed"):
            merge_places([normalized()], [], set(), BOUNDS, ["overture:missing"])

    def test_raw_validation_rejects_duplicates_bounds_nonfinite_categories_and_license(self):
        cases = []
        row = raw_place(); row["bbox"]["xmin"] = 7.8; cases.append(([row], "outside declared bounds"))
        row = raw_place(); row["bbox"]["ymin"] = float("nan"); cases.append(([row], "finite"))
        row = raw_place(); row["bbox"]["ymin"] = True; cases.append(([row], "finite"))
        row = raw_place(); row["taxonomy"]["hierarchy"] = ["library"]; cases.append(([row], "main category"))
        row = raw_place(); row["sources"][0]["license"] = "unknown"; cases.append(([row], "contributor/license"))
        row = raw_place(); row["names"] = "old-schema"; cases.append(([row], "names schema"))
        cases.append(([raw_place(), raw_place()], "duplicate raw ID"))
        for rows, error in cases:
            with self.subTest(error=error), self.assertRaisesRegex(ValidationError, error):
                normalize_raw(rows, BOUNDS)

    def test_unnamed_records_are_excluded_without_inventing_names(self):
        rows = [raw_place("a", ""), raw_place("b", None), raw_place("c")]
        self.assertEqual([place["id"] for place in normalize_raw(rows, BOUNDS)[0]], ["overture:c"])

    def test_compact_validation_rejects_invalid_references_types_masks_counts_and_license(self):
        package = package_for([normalized(), normalized("b")])
        mutations = [
            lambda p: p.update(schemaVersion=2),
            lambda p: p.update(transformVersion="unknown"),
            lambda p: p.update(columns=list(reversed(COLUMNS))),
            lambda p: p["places"][0].__setitem__(4, -1),
            lambda p: p["places"][0].__setitem__(4, True),
            lambda p: p["places"][0].__setitem__(10, [999]),
            lambda p: p["places"][0].__setitem__(10, [False]),
            lambda p: p["places"][0].append(8),
            lambda p: p["sources"][0].__setitem__(0, 999),
            lambda p: p["sources"][0].append(4),
            lambda p: p["places"][1].__setitem__(0, "a"),
            lambda p: p["places"].reverse(),
            lambda p: p.update(count=999),
            lambda p: p.update(licenses=[]),
            lambda p: p["sourceTemplates"][0].update(dataset="Unknown"),
            lambda p: p["categories"][0].__setitem__(1, "restaurant"),
        ]
        for index, mutate in enumerate(mutations):
            bad = copy.deepcopy(package); mutate(bad)
            with self.subTest(mutation=index), self.assertRaises(ValidationError):
                decode_package(bad)

    def test_supplements_do_not_silently_drop_fields_or_change_source_dates(self):
        for field, value in (("unexpected", "would be dropped"), ("dataUpdatedAt", "2026-10-11")):
            supplemental = normalized("library"); supplemental[field] = value
            with self.subTest(field=field), self.assertRaises(ValidationError):
                merge_places([], [supplemental], set(), BOUNDS, [])

    def test_preparation_is_reproducible_with_distinct_source_and_package_dates(self):
        with tempfile.TemporaryDirectory() as directory:
            folder = pathlib.Path(directory); fixture(folder)
            first, manifest = prepare_places(folder / "raw.json", folder / "source.json")
            second, second_manifest = prepare_places(folder / "raw.json", folder / "source.json")
            self.assertEqual(first, second)
            self.assertEqual(manifest, second_manifest)
            self.assertEqual(manifest["sha256"], sha256(first))
            self.assertEqual(manifest["sourceDates"]["latest"], "2025-01-03T00:00:00.000")
            self.assertEqual(manifest["retrievedAt"], "2026-10-11")

    def test_pins_reject_bad_dates_schema_transform_counts_hashes_and_supplement(self):
        cases = [("release", "latest"), ("release", "2026-13-45.1"), ("bounds", [7.8, 45, 7.6, 45.14]),
                 ("inputSchema", "legacy"), ("schemaVersion", 99), ("transformVersion", "2"),
                 ("retrievedAt", "2026-01-01"), ("preparedAt", "2026-01-01"), ("count", 999),
                 ("rawCount", 999), ("mainCount", 999), ("inputSha256", "0" * 64),
                 ("supplementSha256", "0" * 64), ("supplementMetadataSha256", "0" * 64),
                 ("baselineSha256", "0" * 64), ("exclusionsSha256", "0" * 64),
                 ("phoneOverridesSha256", "0" * 64), ("licenses", [["Foursquare", "CC0-1.0"]])]
        for field, value in cases:
            with self.subTest(field=field), tempfile.TemporaryDirectory() as directory:
                folder = pathlib.Path(directory); config = fixture(folder)
                config[field] = value; (folder / "source.json").write_bytes(encoded(config))
                with self.assertRaises(ValidationError):
                    prepare_places(folder / "raw.json", folder / "source.json")

    def test_json_rejects_nonfinite_constants_and_duplicate_keys(self):
        with tempfile.TemporaryDirectory() as directory:
            file = pathlib.Path(directory) / "bad.json"
            for value in ('{"count":1,"count":2}', '{"latitude":NaN}'):
                file.write_text(value)
                with self.assertRaises(ValidationError):
                    read_json(file)

    def test_sql_uses_pinned_bounds_release_and_escapes_output_path(self):
        with tempfile.TemporaryDirectory() as directory:
            folder = pathlib.Path(directory); fixture(folder)
            sql = extraction_sql(folder / "source.json", "/tmp/a'b.json")
            self.assertIn("release/2026-09-23.1/", sql)
            self.assertIn("BETWEEN 7.6 AND 7.77", sql)
            self.assertIn("'/tmp/a''b.json'", sql)
            self.assertNotIn("{{", sql)

    def cli(self, folder, *extra):
        return subprocess.run([sys.executable, "-B", str(ROOT / "scripts/data-prepare.py"),
                               "--places-metadata", str(folder / "source.json"), *extra],
                              text=True, capture_output=True, env={**os.environ, "PYTHONDONTWRITEBYTECODE": "1"})

    def test_cli_place_only_is_deterministic_and_does_not_touch_gtt(self):
        with tempfile.TemporaryDirectory() as directory:
            folder = pathlib.Path(directory); fixture(folder)
            output = folder / "output"; output.mkdir()
            gtt = {"version": "fixture", "sha256": "unchanged"}
            (output / "manifest.json").write_bytes(encoded({"gtt": gtt, "preparedAt": "old transit preparation"}))
            (output / "gtt-stops.json").write_bytes(b"stops must remain byte-identical\n")
            (output / "gtt-trips.json").write_bytes(b"trips must remain byte-identical\n")
            snapshots = {file.name: (file.read_bytes(), file.stat().st_mtime_ns)
                         for file in output.glob("gtt-*.json")}
            args = ("--places", str(folder / "raw.json"), "--output", str(output))
            result = self.cli(folder, *args)
            self.assertEqual(result.returncode, 0, result.stderr)
            first = {file.name: file.read_bytes() for file in output.iterdir()}
            self.assertEqual(self.cli(folder, *args).returncode, 0)
            self.assertEqual(first, {file.name: file.read_bytes() for file in output.iterdir()})
            self.assertEqual(read_json(output / "manifest.json")["gtt"], gtt)
            self.assertEqual(read_json(output / "manifest.json")["preparedAt"], "old transit preparation")
            for name, (payload, modified) in snapshots.items():
                self.assertEqual((output / name).read_bytes(), payload)
                self.assertEqual((output / name).stat().st_mtime_ns, modified)

    def test_cli_validate_only_does_not_create_output(self):
        with tempfile.TemporaryDirectory() as directory:
            folder = pathlib.Path(directory); fixture(folder)
            output = folder / "missing"
            result = self.cli(folder, "--places", str(folder / "raw.json"), "--output", str(output), "--validate-only")
            self.assertEqual(result.returncode, 0, result.stderr)
            self.assertFalse(output.exists())

    def test_cli_out_of_bounds_fails_before_touching_existing_outputs(self):
        with tempfile.TemporaryDirectory() as directory:
            folder = pathlib.Path(directory)
            row = raw_place(); row["bbox"]["xmin"] = 7.99
            fixture(folder, rows=[row])
            output = folder / "output"; output.mkdir()
            sentinel = output / "places.compact.json"; sentinel.write_bytes(b"keep this package\n")
            result = self.cli(folder, "--places", str(folder / "raw.json"), "--output", str(output))
            self.assertNotEqual(result.returncode, 0)
            self.assertIn("outside declared bounds", result.stderr)
            self.assertEqual(sentinel.read_bytes(), b"keep this package\n")
            self.assertEqual(list(output.iterdir()), [sentinel])

    def test_gtfs_only_preserves_place_package_and_builds_realtime_lookups(self):
        with tempfile.TemporaryDirectory() as directory:
            folder = pathlib.Path(directory); output = folder / "output"; output.mkdir()
            place_meta = {"release": "fixture", "count": 2}
            (output / "manifest.json").write_bytes(encoded({"places": place_meta}))
            (output / "places.compact.json").write_bytes(b"do not regenerate places")
            archive = folder / "gtfs.zip"
            with zipfile.ZipFile(archive, "w") as file:
                for name, data in {
                    "routes.txt": "route_id,route_short_name\nr,4\n",
                    "trips.txt": "trip_id,route_id,trip_headsign\nt,r,Centro\nu,r,Centro\n",
                    "stop_times.txt": "trip_id,stop_sequence,stop_id\nt,2,s2\nt,1,s1\nu,1,s1\nu,2,s2\n",
                    "stops.txt": "stop_id,stop_code,stop_name,stop_lat,stop_lon\ns1,1,Primo,45.07,7.68\ns2,2,Secondo,45.08,7.69\n",
                    "feed_info.txt": "feed_version,feed_start_date,feed_end_date\n20261011,20261010,20270131\n",
                }.items():
                    file.writestr(name, data)
            result = self.cli(folder, "--gtfs", str(archive), "--output", str(output))
            self.assertEqual(result.returncode, 0, result.stderr)
            self.assertEqual((output / "places.compact.json").read_bytes(), b"do not regenerate places")
            self.assertEqual(read_json(output / "manifest.json")["places"], place_meta)
            self.assertEqual(read_json(output / "gtt-trips.json"), {"patterns": [{"1": "s1", "2": "s2"}],
                             "trips": {"t": ["4", "Centro", "r", 0], "u": ["4", "Centro", "r", 0]}})

    def test_shipped_package_hash_sources_licenses_and_baseline(self):
        data = ROOT / "src/data"
        config, manifest = read_json(data / "places.source.json"), read_json(data / "manifest.json")["places"]
        validate_config(config)
        payload = (data / "places.compact.json").read_bytes()
        package = read_json(data / "places.compact.json")
        places = decode_package(package)
        self.assertEqual(manifest["sha256"], sha256(payload))
        self.assertEqual(manifest["bytes"], len(payload))
        self.assertEqual(len(places), 23274)
        self.assertEqual(package["mainCount"], 23238)
        self.assertEqual(package["permanentlyClosedCount"], 2109)
        self.assertEqual(package["licenses"], sorted(map(list, LICENSES.items())))
        for key in ("release", "bounds", "inputSha256", "retrievedAt", "preparedAt", "transformVersion", "inputSchema"):
            self.assertEqual(package[key], config[key])
            self.assertEqual(package[key], manifest[key])
        baseline = read_json(data / config["baseline"])
        self.assertEqual(config["baselineSha256"], sha256((data / config["baseline"]).read_bytes()))
        self.assertEqual(len(baseline["ids"]), 1252)
        excluded_ids = {record["id"] for record in package["exclusions"]["records"]}
        self.assertEqual(excluded_ids, {"overture:5461a9a5-2b94-41d2-97de-8f583288f42b"})
        self.assertEqual(set(baseline["ids"]) - {place["id"] for place in places}, excluded_ids)
        self.assertEqual(package["baseline"]["retainedCount"], 1251)
        self.assertEqual(package["baseline"]["explicitlyExcludedCount"], 1)
        self.assertEqual(config["supplementSha256"], sha256((data / config["supplements"]).read_bytes()))
        self.assertEqual(config["supplementMetadataSha256"], sha256((data / config["supplementMetadata"]).read_bytes()))
        self.assertEqual(config["exclusionsSha256"], sha256((data / config["exclusions"]).read_bytes()))
        self.assertEqual(config["phoneOverridesSha256"], sha256((data / config["phoneOverrides"]).read_bytes()))
        supplemental = read_json(data / config["supplements"])
        by_id = {place["id"]: place for place in places}
        self.assertEqual(len(supplemental), 37)
        for place in supplemental:
            self.assertEqual(by_id[place["id"]], place)
        corrected = by_id["overture:6a3d87f2-cd27-40e8-891f-d6050da6f4b0"]
        self.assertEqual(corrected["phone"], "3939524597")
        self.assertEqual(corrected["fieldCorrections"][0]["originalValue"], "339 447 7306")
        self.assertLess(corrected["dataUpdatedAt"], corrected["fieldCorrections"][0]["checkedAt"])
        notice_ids = {notice["id"] for notice in read_json(data / "licenses.json")}
        self.assertTrue({license_id for _, license_id in package["licenses"]} <= notice_ids)
        self.assertIn("Foursquare Places NOTICE", notice_ids)


if __name__ == "__main__":
    unittest.main()
