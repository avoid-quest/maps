# Bundled data preparation

Use this workflow when changing the bundled place package, its source selection or corrections, or the GTT realtime lookup. Python 3 prepares and validates the packages; DuckDB runs the public Overture extraction. No data service, account or native database dependency is required. Runtime delivery is a reviewed APK, not an in-app package replacement.

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

## Refresh GTT independently

```sh
curl -q -fL https://www.gtt.to.it/open_data/gtt_gtfs.zip -o /path/to/gtt_gtfs.zip
python3 -B scripts/data-prepare.py --gtfs /path/to/gtt_gtfs.zip --validate-only
python3 -B scripts/data-prepare.py --gtfs /path/to/gtt_gtfs.zip
```

`--gtfs` may also be combined with `--places` after both input sets are ready. GTFS-only preparation preserves place metadata and data. GTT output contains stops and trip patterns for joining realtime predictions, not an offline timetable; changed trip IDs can require a new APK. Retain attribution, feed version, validity dates and archive hash.

## Evidence and acceptance

Run `bun run verify`; its Bun wrapper also runs the Python regressions. For an isolated pipeline check, run:

```sh
python3 -B -m unittest discover -s scripts -p test_place_package.py -v
```

Check deterministic regeneration and that an independent place refresh leaves GTT bytes/metadata unchanged. Inspect exact-name, category, typo, numeric-token, address, cap and coverage flows with online search enabled and with persisted **Solo ricerca locale**. The runtime catalog shares taxonomy membership and materializes full provenance/details after limiting results. Native map layers continue to render geographic results.

The desktop prototype compared 23,238 normalized main records: expanded JSON was 24,867,733 bytes versus 5,653,387 bytes compact; fresh Bun-process index/import took 543.5 ms versus 150.2 ms and whole-process RSS was 163.8 MB versus 105.9 MB. Compatibility records and reviewed corrections change the shipped size. These measurements support trying the compact path; they do not establish Android performance or justify a native SQLite dependency by themselves. Measure release startup, repeated typing/category queries and memory on supported Android configurations before accepting native performance.

A separate final-runtime desktop probe measured catalog loading at 154.2 ms and search-module loading/index creation at 110.4 ms, with 24.33 MB heap after catalog loading. The preceding mutable-surface version measured 132.6 ms, 109.4 ms and 23.42 MB respectively. This single fresh-process comparison includes module loading and records the cost of freezing exposed entries, coordinates, shared arrays and metadata while retaining compact dictionary sharing. It is distinct from the earlier prototype comparison and is not native startup, typing or memory acceptance. The catalog takes ownership of its retained compact inputs; materialized details remain fresh mutable copies.

Twenty source-selected search cases and 40 exact/category comparisons matched the expanded encoding; that checks encoding/ranking, not real-world coverage. A separate 14-business source-selected spot check found contact/locality conflicts and incomplete evidence. It established no businesses as currently operating and is not a representative accuracy estimate. Field/first-party acceptance must distinguish source presence, correct branch/contact, storefront/entrance, current operation and usable opening hours. Missing locator results alone do not prove closure. Strict same-name duplicate handling preserves branches and tenants but intentionally leaves potential differently named duplicates for later evidence-based review.

Existing favourites save full place snapshots and do not automatically adopt new package contacts or exclusions. Test persistence/upgrades separately; reconciliation belongs to a future dataset-refresh feature. Follow [Android acceptance](android.md), [the roadmap](roadmap.md) and [review delivery](review.md) before publishing a signed release. Report browser evidence, unresolved provider results and device-only checks separately. Route previews remain planning.
