# Bundled data preparation

Use this workflow when changing the bundled place package, its source selection or corrections, or the GTT timetable package. Python 3 prepares and validates the packages; DuckDB runs the public Overture extraction. Places are delivered only in a reviewed APK. The GTT timetable ships in the APK and can also be replaced on device by a newer hashed package published by CI (see below); no account or paid service is involved.

## Place inputs and preservation rules

`src/data/places.source.json` pins the Overture release, extraction rectangle, input/schema/transform versions, raw hash and counts, contributor licences, and hashes of the companion policy files. `scripts/data-places.sql` is a template rendered from those pins, not a runnable moving-latest query. Raw extracts stay outside Git; `places.compact.json` and `manifest.json` identify the generated runtime package.

The released 0.1.5 package contains 23,274 records: 23,238 named food/shop records selected from release `2026-09-23.1`, minus one evidence-backed exclusion, plus 37 compatibility supplements. The raw selection has 25,347 records; 2,109 explicitly permanently closed records are excluded. The bounds `[7.60, 45.00, 7.77, 45.14]` are an extraction rectangle, not a municipal boundary or a complete business inventory.

- `places.supplements.json` and its metadata retain the earlier package's 37 records outside the main category selection, with their original source dates. A main record wins an identical ID; explicit raw permanent closure removes that ID from both sources.
- `places.baseline.json` pins the earlier 1,252 IDs. Preparation retains 1,251; the documented exclusion accounts for the remaining ID. Any other disappearance requires an explicit permanent-closure record and review.
- `places.exclusions.json` records evidence URL/date, reason and expected original fields. Its one locality conflict is excluded without invented replacement coordinates. Changed source fields require reviewing that exclusion again.
- `places.phone-overrides.json` records one first-party branch phone correction, its original value, evidence and checked date. The original phone must still match before applying the correction. Source objects and dates remain intact; correction provenance is separately visible in the place details.

Compact dictionaries/tuples round-trip every normalized application field, full source objects, coordinates and the distinction between absent and explicit null values. Normalization selects the primary name and first address/website/phone entries; it does not preserve every raw Overture property or select a later contact entry. Changing that selection requires a reviewed transform change. Invalid references, schema, dates, hashes, counts, coordinates, unsupported contributors/licences and unexplained baseline loss fail preparation. All supplied inputs validate before the first output file is replaced.

`manifest.json` is the authoritative generated size/hash/count record. Keep `licenses.json` consistent with every actual contributor, including DAC, and preserve CDLA-Permissive-2.0, Apache-2.0 and CC0 notices. Source update timestamps, retrieval date and package preparation date describe different events; preparation is not business verification or source freshness.

## Reproduce or update places

Use your own external working paths in these examples:

```sh
python3 -B scripts/data-prepare.py --places-sql /path/to/overture-places.raw.json > /path/to/overture-places.sql
duckdb < /path/to/overture-places.sql
python3 -B scripts/data-prepare.py --places /path/to/overture-places.raw.json --validate-only
python3 -B scripts/data-prepare.py --places /path/to/overture-places.raw.json
```

The rendered SQL downloads only the pinned release, bounds and food/shop hierarchy. The exact raw bytes must match the pinned SHA-256. A later release or different extraction serialization is an explicit source-metadata change: record its retrieval/preparation dates, schema, raw hash/counts, expected union count and complete contributor set, then review companion files and update their hashes. A hash mismatch is a failed reproduction; changing the pin merely to suppress the error is not validation. Keep evidence for the source change and explain any changed IDs or fields in the PR.

`--places-metadata /path/to/source.json` selects a separately reviewed source configuration. Companion file paths resolve beside that configuration. `--output /path/to/data` selects a generated directory. A place-only refresh preserves existing GTT files, metadata and preparation timestamp; it needs no GTFS download. Repeating preparation from the same pinned inputs must produce identical compact and place-manifest bytes.

A fresh output directory contains only the requested components and their manifest sections; this is an isolated preparation artifact, not a complete app dataset. To deliver it in the app, prepare both components or update an existing complete output, then verify that the compact places, GTT stops/trips and both manifest sections are present and consistent. Independent refreshes of the checked-in complete package preserve the other component.

After the runtime catalog switches to the compact file, remove the obsolete expanded `places.json` and check for stale imports. Keep the separate policy/supplement inputs; they are not runtime duplicate dumps.

## GTT timetable package

GTT rotates trip IDs between daily exports while stop IDs stay stable, and most GTT predictions are delay-only (`arrival.delay` with `stop_sequence`). Boards therefore need the current timetable, not just a trip lookup. `scripts/gtt_package.py` compacts the official ZIP without expanding `stop_times` on device:

- **Format** `avoid-maps.gtt-timetable`, schema 1, deterministic ASCII JSON. `stops`, `routes`, `agencies`, `services` (weekday mask, range, added/removed dates), `patterns` (stop indexes, real `stop_sequence` values, pickup×4+drop-off codes), `vectors` (arrival increments and dwell seconds), `headsigns`, column-oriented `trips` (route, service, pattern, vector, start seconds, headsign, direction) and `frequencies`. Times above 24:00 and repeated visits are kept; missing times fail the build instead of being interpolated.
- **Validation** (Python and `src/transit-data/package-format.ts`) checks every reference, monotonic times, unique IDs, Europe/Rome, coverage dates and size floors, so a truncated export cannot replace a usable package.
- **Manifest** (`manifest.json`): `schema_version`, `package_hash` (SHA-256 of the package bytes), `package_bytes`, `package_path` (`packages/gtt-<hash>.json`), `source_zip_hash`, `feed_version`, `source_url`, `source_last_modified`, `source_etag`, `upstream_checked_at`, `built_at`, `valid_from`, `valid_to`, `attribution`, `attribution_url`, `licence_url`, counts and up to two previous packages. Packages are **hashed, not signed**: the hash detects corruption or truncation; trust comes from HTTPS and the repository's workflow.

### Publication

`.github/workflows/gtt-timetable.yml` runs at 03:15, 06:15, 12:15 and 18:15 UTC and on manual dispatch. `scripts/gtt-pipeline.py` downloads the ZIP with `If-None-Match`/`If-Modified-Since` from the published manifest, builds and validates the package, and publishes to GitHub Pages only when the package hash changed, or when the published upstream confirmation is older than 20 hours (a manifest-only heartbeat, so devices can tell an unchanged upstream from a stalled pipeline). Previous packages are re-downloaded, re-verified and kept beside the current one. The workflow uses no secrets and never receives signing credentials. One-time repository setting: **Settings → Pages → Build and deployment → Source: GitHub Actions**.

Local reproduction, writing the APK bundle (`gtt-timetable.json`, `gtt-timetable.manifest.json`, `gtt-stops.json` and the `gtt` section of `manifest.json`) from the same build:

```sh
python3 -B scripts/gtt-pipeline.py --site-url https://avoid-quest.github.io/maps/gtt/ --output /path/to/empty-site --no-previous --bundle-dir src/data
python3 -B scripts/data-prepare.py --gtfs /path/to/gtt_gtfs.zip   # offline ZIP; no Last-Modified/ETag recorded
```

`gtt-stops.json` is the synchronous stop list for map and search, derived from the same package and tagged with its hash. Place-only refreshes leave the GTT files untouched.

### On device

`src/transit-data/` imports a package into a new candidate SQLite database (expo-sqlite), checks references and compares representative board queries against the parsed package, then switches the active package in one registry transaction. The previous package is retained for rollback; a failed download, hash mismatch, invalid package, full storage or process death leaves the active database in place, and leftovers are removed on the next start. A corrupt active database rolls back to the previous package, then to the bundled one. Indexes: `pattern_stop(stop_id, pattern_id)` and `trip(pattern_id, service_id, start_seconds)`; only the vectors needed by a board are decoded.

The manifest is checked when a board opens or resumes and the last successful check is older than 6 hours, on **Aggiorna orari**, and once per hour at most when a nonempty realtime feed joins zero trips. Failures back off from 5 minutes to 6 hours. Any connection is used by default; an optional preference restricts checks to Wi-Fi. There is no background task. Boards warn when the active package has not been confirmed by a manifest for 48 hours, and outside the package calendar they say schedules are unavailable instead of extrapolating. Requests carry no identifiers, stop, location or query parameters; GitHub Pages sees the device IP and request time.

On a desktop (Bun's SQLite) the 20261101 package imported, validated and switched in about 0.7 s, produced a 9.3 MB database, and a Castello (472) board took about 3.5 ms with or without the realtime join. Android timing and memory remain device checks.

## Evidence and acceptance

Run `bun run verify`; its Bun wrapper also runs the Python regressions. For an isolated pipeline check, run:

```sh
python3 -B -m unittest discover -s scripts -p 'test_*_package.py' -v
```

Check deterministic regeneration and that an independent place refresh leaves GTT bytes/metadata unchanged. Inspect exact-name, category, typo, numeric-token, address, cap and coverage flows with online search enabled and with persisted **Solo ricerca locale**. The runtime catalog shares taxonomy membership and materializes full provenance/details after limiting results. Native map layers continue to render geographic results.

The desktop prototype compared 23,238 normalized main records: expanded JSON was 24,867,733 bytes versus 5,653,387 bytes compact; fresh Bun-process index/import took 543.5 ms versus 150.2 ms and whole-process RSS was 163.8 MB versus 105.9 MB. Compatibility records and reviewed corrections change the shipped size. These measurements support trying the compact path; they do not establish Android performance or justify a native SQLite dependency by themselves. Measure release startup, repeated typing/category queries and memory on supported Android configurations before accepting native performance.

A separate final-runtime desktop probe measured catalog loading at 154.2 ms and search-module loading/index creation at 110.4 ms, with 24.33 MB heap after catalog loading. The preceding mutable-surface version measured 132.6 ms, 109.4 ms and 23.42 MB respectively. This single fresh-process comparison includes module loading and records the cost of freezing exposed entries, coordinates, shared arrays and metadata while retaining compact dictionary sharing. It is distinct from the earlier prototype comparison and is not native startup, typing or memory acceptance. The catalog takes ownership of its retained compact inputs; materialized details remain fresh mutable copies.

Twenty source-selected search cases and 40 exact/category comparisons matched the expanded encoding; that checks encoding/ranking, not real-world coverage. A separate 14-business source-selected spot check found contact/locality conflicts and incomplete evidence. It established no businesses as currently operating and is not a representative accuracy estimate. Field/first-party acceptance must distinguish source presence, correct branch/contact, storefront/entrance, current operation and usable opening hours. Missing locator results alone do not prove closure. Strict same-name duplicate handling preserves branches and tenants but intentionally leaves potential differently named duplicates for later evidence-based review.

Existing favourites save full place snapshots and do not automatically adopt new package contacts or exclusions. Test persistence/upgrades separately; reconciliation belongs to a future dataset-refresh feature. Follow [Android acceptance](android.md), [the roadmap](roadmap.md) and [review delivery](review.md) before publishing a signed release. Report browser evidence, unresolved provider results and device-only checks separately. Route previews remain planning.
