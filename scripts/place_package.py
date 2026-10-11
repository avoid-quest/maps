"""Deterministic, lossless application encoding for bounded Overture extracts.

This normalizes the existing application fields, not every raw Overture property.
Source objects retain every property, including explicit nulls and absent fields.
No network access or transit-data writes occur in this module.
"""

import datetime
import hashlib
import json
import math
import pathlib
import re

SCHEMA_VERSION = 1
TRANSFORM_VERSION = "1"
INPUT_SCHEMA = "overture-places-2026-09"
COLUMNS = ["id", "name", "latitude", "longitude", "categoryRef", "confidence",
           "operatingStatus", "address", "website", "phone", "sourceRefs"]
OPTIONAL_FIELDS = ["address", "website", "phone"]
MAIN_CATEGORIES = ["food_and_drink", "shopping"]
LICENSES = {
    "AllThePlaces": "CC0-1.0", "BrightQuery": "CDLA-Permissive-2.0",
    "DAC": "CDLA-Permissive-2.0", "Foursquare": "Apache-2.0",
    "Microsoft": "CDLA-Permissive-2.0", "Overture": "CDLA-Permissive-2.0",
    "PinMeTo": "CDLA-Permissive-2.0", "meta": "CDLA-Permissive-2.0",
}


class ValidationError(ValueError):
    pass


def require(condition, message):
    if not condition:
        raise ValidationError(message)


def encoded(value):
    return (json.dumps(value, ensure_ascii=False, separators=(",", ":"),
                       allow_nan=False) + "\n").encode("utf-8")


def sha256(data):
    return hashlib.sha256(data).hexdigest()


def read_json(path):
    def reject_constant(value):
        raise ValidationError(f"non-finite JSON number: {value}")

    def reject_duplicate_keys(pairs):
        result = {}
        for key, value in pairs:
            require(key not in result, f"duplicate JSON key: {key}")
            result[key] = value
        return result

    return json.loads(pathlib.Path(path).read_bytes(), parse_constant=reject_constant,
                      object_pairs_hook=reject_duplicate_keys)


def checked_json(path, expected_hash, label):
    require(isinstance(expected_hash, str) and re.fullmatch(r"[0-9a-f]{64}", expected_hash),
            f"invalid {label} SHA-256")
    require(sha256(pathlib.Path(path).read_bytes()) == expected_hash,
            f"{label} SHA-256 mismatch")
    return read_json(path)


def number(value):
    return type(value) in (int, float) and math.isfinite(value)


def validate_bounds(bounds):
    require(isinstance(bounds, list) and len(bounds) == 4 and all(map(number, bounds)),
            "bounds must contain four finite numbers")
    require(-180 <= bounds[0] < bounds[2] <= 180 and -90 <= bounds[1] < bounds[3] <= 90,
            "bounds must be an ordered geographic rectangle")


def validate_config(config):
    require(config.get("schemaVersion") == SCHEMA_VERSION, "unsupported package schemaVersion")
    require(config.get("transformVersion") == TRANSFORM_VERSION, "unsupported transformVersion")
    require(config.get("inputSchema") == INPUT_SCHEMA, "unsupported inputSchema")
    release = config.get("release")
    require(isinstance(release, str) and re.fullmatch(r"\d{4}-\d{2}-\d{2}\.\d+", release),
            "release must be an explicit dated Overture release")
    try:
        datetime.date.fromisoformat(release.split(".")[0])
        for field in ("retrievedAt", "preparedAt"):
            datetime.date.fromisoformat(config[field])
    except (ValueError, KeyError, TypeError) as error:
        raise ValidationError("invalid release/retrievedAt/preparedAt date") from error
    require(config["retrievedAt"] >= release.split(".")[0], "retrieval predates release")
    require(config["preparedAt"] >= config["retrievedAt"], "preparation predates retrieval")
    validate_bounds(config.get("bounds"))
    require(config.get("mainCategories") == MAIN_CATEGORIES, "unsupported main category filter")
    for field in ("rawCount", "mainCount", "count"):
        require(type(config.get(field)) is int and config[field] >= 0, f"invalid {field}")
    licenses = config.get("licenses")
    require(isinstance(licenses, list) and licenses and all(
        isinstance(pair, list) and len(pair) == 2 and isinstance(pair[0], str)
        and pair[0] in LICENSES and LICENSES[pair[0]] == pair[1] for pair in licenses),
        "declared contributors/licenses must belong to the supported attribution set")
    require(licenses == sorted(map(list, set(map(tuple, licenses)))),
            "declared contributors/licenses must be unique and sorted")


def validate_coordinate(latitude, longitude, bounds):
    require(number(latitude) and number(longitude), "coordinates must be finite numbers")
    require(bounds[0] <= longitude <= bounds[2] and bounds[1] <= latitude <= bounds[3],
            "coordinate outside declared bounds")


def validate_confidence(value):
    require(value is None or number(value) and 0 <= value <= 1, "invalid confidence")


def validate_provenance(provenance):
    require(isinstance(provenance, list) and len(provenance) > 0, "missing source provenance")
    for source in provenance:
        require(isinstance(source, dict), "source must be an object")
        dataset, license_id = source.get("dataset"), source.get("license")
        require(dataset in LICENSES and LICENSES[dataset] == license_id,
                f"unsupported contributor/license: {dataset}/{license_id}")
        if "record_id" in source:
            require(source["record_id"] is None or isinstance(source["record_id"], str),
                    "invalid source record_id")
        if "confidence" in source:
            validate_confidence(source["confidence"])
        if source.get("update_time") not in (None, ""):
            require(isinstance(source["update_time"], str), "invalid source update_time")
            try:
                # Some upstream contributors supply a date or a naive timestamp.
                # Preserve it exactly instead of inventing a timezone.
                datetime.datetime.fromisoformat(source["update_time"].replace("Z", "+00:00"))
            except ValueError as error:
                raise ValidationError("invalid source update_time") from error


def source_fields(provenance, corrections=None):
    return {
        "source": "Overture Places",
        "attributions": [f"{source['dataset']} · {source['license']}" for source in provenance] +
                        [f"Telefono corretto da sito ufficiale · {correction['url']} · {correction['checkedAt'][:10]}"
                         for correction in corrections or []],
        "provenance": provenance,
        "dataUpdatedAt": max((source.get("update_time") or "" for source in provenance), default=""),
    }


def validate_place(place, bounds):
    require(isinstance(place, dict), "place must be an object")
    require(isinstance(place.get("id"), str) and place["id"].startswith("overture:")
            and len(place["id"]) > 9, "invalid place ID")
    require(isinstance(place.get("name"), str) and bool(place["name"].strip()), "invalid place name")
    coordinate = place.get("coordinate")
    require(isinstance(coordinate, dict), "missing coordinate")
    validate_coordinate(coordinate.get("latitude"), coordinate.get("longitude"), bounds)
    require("category" in place and (place["category"] is None or isinstance(place["category"], str)),
            "invalid category")
    require(isinstance(place.get("hierarchy"), list)
            and all(isinstance(value, str) for value in place["hierarchy"]), "invalid hierarchy")
    require("confidence" in place and "operatingStatus" in place, "missing nullable place fields")
    validate_confidence(place["confidence"])
    require(place["operatingStatus"] is None or place["operatingStatus"] in
            ("open", "temporarily_closed", "permanently_closed"), "invalid operatingStatus")
    require(place["operatingStatus"] != "permanently_closed", "closed place in package")
    for field in OPTIONAL_FIELDS:
        require(field not in place or place[field] is None or isinstance(place[field], str),
                f"invalid {field}")
    validate_provenance(place.get("provenance"))
    corrections = place.get("fieldCorrections")
    if corrections is not None:
        require(isinstance(corrections, list) and len(corrections) == 1, "invalid phone correction provenance")
        validate_phone_correction(corrections[0])
        require(place.get("phone") == corrections[0]["value"], "phone differs from correction provenance")
    require(all(place.get(key) == value for key, value in source_fields(place["provenance"], corrections).items()),
            "source attribution or source date differs from provenance")
    require(set(place) <= {"id", "name", "coordinate", "category", "hierarchy", "confidence",
                           "operatingStatus", "fieldCorrections", *OPTIONAL_FIELDS, *source_fields(place["provenance"])},
            "unsupported normalized field would be lost")


def normalize_raw(raw, bounds):
    require(isinstance(raw, list), "raw input must be an array")
    seen, closed, places = set(), set(), []
    for row in raw:
        require(isinstance(row, dict), "raw record must be an object")
        identity = row.get("id")
        require(isinstance(identity, str) and bool(identity) and not identity.startswith("overture:"),
                "invalid raw ID")
        require(identity not in seen, "duplicate raw ID")
        seen.add(identity)
        bbox = row.get("bbox")
        require(isinstance(bbox, dict), "missing raw bbox")
        validate_coordinate(bbox.get("ymin"), bbox.get("xmin"), bounds)
        taxonomy = row.get("taxonomy")
        require(isinstance(taxonomy, dict) and isinstance(taxonomy.get("hierarchy"), list),
                "raw input must use the pinned taxonomy schema")
        require(all(isinstance(value, str) for value in taxonomy["hierarchy"]), "invalid raw hierarchy")
        require(set(MAIN_CATEGORIES).intersection(taxonomy["hierarchy"]), "raw record outside main category filter")
        validate_provenance(row.get("sources"))
        if row.get("operating_status") == "permanently_closed":
            closed.add("overture:" + identity)
            continue
        names = row.get("names")
        require(isinstance(names, dict), "raw input must use the pinned names schema")
        name = names.get("primary")
        if name is None or name == "":
            continue
        place = {
            "id": "overture:" + identity, "name": name,
            "coordinate": {"latitude": bbox["ymin"], "longitude": bbox["xmin"]},
            "category": taxonomy.get("primary"), "hierarchy": taxonomy["hierarchy"],
            "confidence": row.get("confidence"), "operatingStatus": row.get("operating_status"),
            **source_fields(row["sources"]),
        }
        addresses = row.get("addresses")
        require(addresses is None or isinstance(addresses, list), "invalid raw addresses")
        if addresses:
            require(isinstance(addresses[0], dict), "invalid raw address")
            address = [addresses[0].get(field) for field in ("freeform", "locality")]
            require(all(value is None or isinstance(value, str) for value in address), "invalid address parts")
            place["address"] = ", ".join(filter(None, address))
        for raw_field, field in (("websites", "website"), ("phones", "phone")):
            values = row.get(raw_field)
            require(values is None or isinstance(values, list), f"invalid raw {raw_field}")
            if values:
                place[field] = values[0]
        validate_place(place, bounds)
        places.append(place)
    return sorted(places, key=lambda place: place["id"]), closed


def merge_places(main, supplements, closed, bounds, baseline_ids):
    require(isinstance(supplements, list), "supplements must be an array")
    by_id = {}
    for place in supplements:
        validate_place(place, bounds)
        require(place["id"] not in by_id, "duplicate supplemental ID")
        by_id[place["id"]] = place
    by_id.update({place["id"]: place for place in main})
    for identity in closed:
        by_id.pop(identity, None)
    require(set(baseline_ids) <= set(by_id) | closed,
            "baseline IDs removed without an explicit permanently_closed record")
    return sorted(by_id.values(), key=lambda place: place["id"])


def apply_exclusions(places, exclusions):
    """Apply reviewed source conflicts only when the recorded original fields match."""
    require(isinstance(exclusions, dict) and exclusions.get("schemaVersion") == 1,
            "unsupported exclusions schemaVersion")
    require(isinstance(exclusions.get("version"), str) and exclusions["version"], "missing exclusions version")
    require(isinstance(exclusions.get("records"), list), "invalid exclusions records")
    by_id = {place["id"]: place for place in places}
    excluded = set()
    for exclusion in exclusions["records"]:
        require(isinstance(exclusion, dict), "exclusion must be an object")
        identity = exclusion.get("id")
        require(isinstance(identity, str) and identity not in excluded, "invalid/duplicate exclusion ID")
        require(identity in by_id, "excluded record absent; review exclusion for the new source")
        expected = exclusion.get("expected")
        require(isinstance(expected, dict) and expected and set(expected) <=
                {"name", "address", "phone", "website", "coordinate"}, "invalid exclusion expected fields")
        require(all(key in by_id[identity] and by_id[identity][key] == value for key, value in expected.items()),
                "excluded record changed; review the source conflict")
        require(isinstance(exclusion.get("reason"), str) and exclusion["reason"].strip(), "missing exclusion reason")
        source = exclusion.get("source")
        require(isinstance(source, dict) and isinstance(source.get("url"), str) and
                source["url"].startswith("https://") and isinstance(source.get("checkedAt"), str),
                "missing exclusion evidence URL/date")
        try:
            checked = datetime.datetime.fromisoformat(source["checkedAt"].replace("Z", "+00:00"))
        except ValueError as error:
            raise ValidationError("invalid exclusion checkedAt") from error
        require(checked.tzinfo is not None, "exclusion checkedAt must include timezone")
        excluded.add(identity)
    return [place for place in places if place["id"] not in excluded], excluded


def validate_phone_correction(correction):
    require(isinstance(correction, dict) and correction.get("field") == "phone", "unsupported correction field")
    require(set(correction) == {"field", "originalValue", "value", "url", "checkedAt", "reason"},
            "invalid phone correction fields")
    require(isinstance(correction.get("originalValue"), str) and correction["originalValue"], "missing original phone")
    require(isinstance(correction.get("value"), str) and re.fullmatch(r"\+?[0-9]{6,15}", correction["value"]),
            "invalid corrected phone")
    require(isinstance(correction.get("url"), str) and correction["url"].startswith("https://") and
            isinstance(correction.get("checkedAt"), str) and isinstance(correction.get("reason"), str)
            and correction["reason"].strip(), "missing phone correction evidence")
    try:
        checked = datetime.datetime.fromisoformat(correction["checkedAt"].replace("Z", "+00:00"))
    except ValueError as error:
        raise ValidationError("invalid phone correction checkedAt") from error
    require(checked.tzinfo is not None, "phone correction checkedAt must include timezone")


def phone_corrections(overrides):
    require(isinstance(overrides, dict) and overrides.get("schemaVersion") == 1, "unsupported phone overrides schemaVersion")
    require(isinstance(overrides.get("version"), str) and overrides["version"], "missing phone overrides version")
    require(isinstance(overrides.get("records"), list), "invalid phone overrides records")
    corrections = {}
    for record in overrides["records"]:
        require(isinstance(record, dict), "invalid phone override record")
        identity = record.get("id")
        require(isinstance(identity, str) and identity.startswith("overture:") and identity not in corrections,
                "invalid/duplicate phone override ID")
        correction = {key: value for key, value in record.items() if key != "id"}
        validate_phone_correction(correction)
        corrections[identity] = correction
    return corrections


def apply_phone_overrides(places, overrides):
    corrections = phone_corrections(overrides)
    require(set(corrections) <= {place["id"] for place in places}, "phone override record absent")
    result = []
    for place in places:
        correction = corrections.get(place["id"])
        if correction:
            require(place.get("phone") == correction["originalValue"], "original phone changed; review correction")
            place = {**place, "phone": correction["value"], "fieldCorrections": [correction],
                     **source_fields(place["provenance"], [correction])}
        result.append(place)
    return result


def intern(value, values, lookup):
    key = json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":"), allow_nan=False)
    if key not in lookup:
        lookup[key] = len(values)
        values.append(value)
    return lookup[key]


def compact_places(places, metadata):
    categories, templates, sources, rows = [], [], [], []
    category_map, template_map, source_map = {}, {}, {}
    for place in sorted(places, key=lambda item: item["id"]):
        category = intern([place["category"], place["hierarchy"]], categories, category_map)
        refs = []
        for source in place["provenance"]:
            template = intern({key: source[key] for key in sorted(source)
                               if key not in ("record_id", "confidence")}, templates, template_map)
            entry = [template, source.get("record_id"), source.get("confidence")]
            mask = int("record_id" in source) | (int("confidence" in source) << 1)
            if mask != 3:
                entry.append(mask)
            refs.append(intern(entry, sources, source_map))
        row = [place["id"].removeprefix("overture:"), place["name"],
               place["coordinate"]["latitude"], place["coordinate"]["longitude"],
               category, place["confidence"], place["operatingStatus"],
               *(place.get(field) for field in OPTIONAL_FIELDS), refs]
        if any(field in place and place[field] is None for field in OPTIONAL_FIELDS):
            row.append(sum(1 << index for index, field in enumerate(OPTIONAL_FIELDS) if field in place))
        rows.append(row)
    return {**metadata, "columns": COLUMNS, "categories": categories,
            "sourceTemplates": templates, "sources": sources, "places": rows}


def reference(value, array, label):
    require(type(value) is int and 0 <= value < len(array), f"invalid {label} dictionary reference")
    return array[value]


def decode_package(package):
    require(package.get("schemaVersion") == SCHEMA_VERSION, "unsupported package schemaVersion")
    require(package.get("transformVersion") == TRANSFORM_VERSION, "unsupported transformVersion")
    require(package.get("columns") == COLUMNS, "invalid compact columns")
    validate_bounds(package.get("bounds"))
    for field in ("categories", "sourceTemplates", "sources", "places"):
        require(isinstance(package.get(field), list), f"invalid compact {field}")
    for category in package["categories"]:
        require(isinstance(category, list) and len(category) == 2 and
                (category[0] is None or isinstance(category[0], str)) and
                isinstance(category[1], list) and all(isinstance(value, str) for value in category[1]),
                "invalid category dictionary")
    for template in package["sourceTemplates"]:
        require(isinstance(template, dict) and "record_id" not in template and "confidence" not in template,
                "invalid source template")
        validate_provenance([template])
    decoded_sources = []
    for source in package["sources"]:
        require(isinstance(source, list) and len(source) in (3, 4), "invalid source tuple")
        template = reference(source[0], package["sourceTemplates"], "source template")
        mask = source[3] if len(source) == 4 else 3
        require(type(mask) is int and 0 <= mask <= 3, "invalid source presence mask")
        provenance = dict(template)
        for index, field in enumerate(("record_id", "confidence")):
            if mask & (1 << index):
                provenance[field] = source[index + 1]
            else:
                require(source[index + 1] is None, "absent source value must be null")
        validate_provenance([provenance])
        decoded_sources.append(provenance)
    corrections = phone_corrections(package["phoneOverrides"]) if "phoneOverrides" in package else {}
    places, ids = [], set()
    for row in package["places"]:
        require(isinstance(row, list) and len(row) in (11, 12), "invalid place tuple")
        require(isinstance(row[0], str) and row[0] and not row[0].startswith("overture:"), "invalid compact ID")
        require(row[0] not in ids, "duplicate compact ID")
        ids.add(row[0])
        category, hierarchy = reference(row[4], package["categories"], "category")
        require(isinstance(row[10], list), "invalid source reference array")
        provenance = [reference(index, decoded_sources, "source") for index in row[10]]
        place = {"id": "overture:" + row[0], "name": row[1],
                 "coordinate": {"latitude": row[2], "longitude": row[3]},
                 "category": category, "hierarchy": hierarchy, "confidence": row[5],
                 "operatingStatus": row[6], **source_fields(provenance)}
        mask = row[11] if len(row) == 12 else sum(1 << index for index in range(3) if row[7 + index] is not None)
        require(type(mask) is int and 0 <= mask <= 7, "invalid contact presence mask")
        for index, field in enumerate(OPTIONAL_FIELDS):
            if mask & (1 << index):
                place[field] = row[7 + index]
            else:
                require(row[7 + index] is None, "absent contact value must be null")
        correction = corrections.get(place["id"])
        if correction:
            place.update(fieldCorrections=[correction], **source_fields(provenance, [correction]))
        validate_place(place, package["bounds"])
        places.append(place)
    require(type(package.get("count")) is int and package["count"] == len(places), "package count mismatch")
    require(set(corrections) <= {place["id"] for place in places}, "phone override record absent from package")
    require([place["id"] for place in places] == sorted(place["id"] for place in places),
            "compact IDs must be sorted")
    licenses = sorted({(source["dataset"], source["license"])
                       for place in places for source in place["provenance"]})
    require(package.get("licenses") == list(map(list, licenses)), "package contributors/licenses mismatch")
    return places


def prepare_places(raw_path, config_path):
    config_path = pathlib.Path(config_path)
    config = read_json(config_path)
    validate_config(config)
    raw = checked_json(raw_path, config.get("inputSha256"), "raw input")
    supplement_meta = checked_json(config_path.parent / config["supplementMetadata"],
                                   config.get("supplementMetadataSha256"), "supplement metadata")
    require(supplement_meta.get("schemaVersion") == 1, "unsupported supplement schemaVersion")
    require(isinstance(supplement_meta.get("version"), str) and supplement_meta["version"], "missing supplement version")
    require(supplement_meta.get("sha256") == config.get("supplementSha256"), "supplement metadata hash mismatch")
    supplements = checked_json(config_path.parent / config["supplements"], config["supplementSha256"], "supplement")
    require(len(supplements) == supplement_meta.get("recordCount"), "supplement count mismatch")
    baseline = checked_json(config_path.parent / config["baseline"], config.get("baselineSha256"), "baseline")
    require(baseline.get("schemaVersion") == 1 and isinstance(baseline.get("ids"), list), "invalid baseline schema")
    baseline_ids = baseline["ids"]
    require(all(isinstance(identity, str) and identity.startswith("overture:") for identity in baseline_ids)
            and len(set(baseline_ids)) == len(baseline_ids), "invalid baseline IDs")
    require(baseline.get("count") == len(baseline_ids), "baseline count mismatch")
    require(baseline.get("originalPackageSha256") == supplement_meta.get("originalPackageSha256"),
            "baseline/supplement original package mismatch")
    main, closed = normalize_raw(raw, config["bounds"])
    places = merge_places(main, supplements, closed, config["bounds"], baseline_ids)
    exclusions = checked_json(config_path.parent / config["exclusions"], config.get("exclusionsSha256"), "exclusions")
    places, excluded = apply_exclusions(places, exclusions)
    overrides = checked_json(config_path.parent / config["phoneOverrides"], config.get("phoneOverridesSha256"), "phone overrides")
    places = apply_phone_overrides(places, overrides)
    require(len(raw) == config["rawCount"], "raw count mismatch")
    require(len(main) == config["mainCount"], "main count mismatch")
    require(len(places) == config["count"], "merged count mismatch")
    dates = [source["update_time"] for place in places for source in place["provenance"] if source.get("update_time")]
    metadata = {key: config[key] for key in ("schemaVersion", "transformVersion", "inputSchema", "release", "bounds",
                "retrievedAt", "preparedAt", "inputSha256", "mainCategories", "rawCount", "mainCount", "count", "licenses")}
    metadata.update(supplement=supplement_meta,
                    exclusions={**exclusions, "sha256": config["exclusionsSha256"], "recordCount": len(excluded)},
                    phoneOverrides={**overrides, "sha256": config["phoneOverridesSha256"], "recordCount": len(overrides["records"])},
                    sourceDates={"earliest": min(dates, default=""), "latest": max(dates, default="")},
                    permanentlyClosedCount=len(closed), baseline={"count": len(baseline_ids), "sha256": config["baselineSha256"],
                    "retainedCount": len(set(baseline_ids).intersection(place["id"] for place in places)),
                    "explicitlyClosedCount": len(set(baseline_ids) & closed),
                    "explicitlyExcludedCount": len(set(baseline_ids) & excluded)})
    package = compact_places(places, metadata)
    require(decode_package(package) == places, "compact decode differs from normalized input")
    payload = encoded(package)
    manifest = {**metadata, "file": "places.compact.json", "sha256": sha256(payload), "bytes": len(payload),
                "url": "https://docs.overturemaps.org/attribution/",
                "coverage": "Named non-permanently-closed food and shopping records within the declared rectangle, plus separately versioned supplements and documented exclusions; incomplete coverage, not a municipal boundary."}
    return payload, manifest


def extraction_sql(config_path, output_path):
    config = read_json(config_path)
    validate_config(config)
    values = dict(zip(("minLongitude", "minLatitude", "maxLongitude", "maxLatitude"), config["bounds"]))
    values.update(release=config["release"], output=str(output_path).replace("'", "''"))
    template = pathlib.Path(__file__).with_name("data-places.sql").read_text()
    for key, value in values.items():
        template = template.replace("{{" + key + "}}", str(value))
    return template
