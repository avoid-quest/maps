# Bounded Overture dataset probe

Observed 2026-10-11. This is a bounded data-access probe, not a statistically representative provider comparison or an Android device test. See [place-discovery.md](place-discovery.md) for source options and policies and [place-search-sample.md](place-search-sample.md) for the validation method.

## Method

Downloaded the official DuckDB CLI v1.5.6 from its GitHub release, loaded its HTTP extension, and queried the public Overture GeoParquet dataset directly without an account or API key. The [official Overture guide](https://docs.overturemaps.org/guides/places/) identified release `2026-09-23.1` at research time.

Bounded queries use a documented rectangle as a data-selection parameter; a rectangle is not an administrative boundary or evidence of complete regional coverage. Record bounds, source release and query fields when reproducing a probe. Filtering on the point bounding-box minimum can introduce small edge rounding differences. Source extracts are not committed application datasets.

## Observed record quality

The query returned **3,701 raw place records**, including **464** with `food_and_drink` in their taxonomy hierarchy and **838** with `shopping`. These are records, not independently verified unique or currently trading businesses.

Among those 1,302 food/shopping records:

- 595 had existence confidence at or below 0.5.
- 802 had no website field.
- 542 had no operating-status value.
- 87 were explicitly marked permanently closed.

Those groups overlap. A low confidence is not proof of an incorrect listing. A high confidence is not a guarantee that a venue is operating, its address is correct, or its hours are current. Overture describes confidence as an existence signal, not a calibrated cross-provider probability or operational-status verification.

## Integration implications

Direct regional place-data access is demonstrated. A desktop-generated SQLite package is plausible, but requires name/category search, duplicate handling, closed-place filtering, source attribution, updates and field verification. Importing every record and sorting by distance is insufficient.

Keep opening-hour availability separate from `operating_status`: “open” in a dataset may mean an operating business, not open at the current time. Do not convert existence confidence into a customer rating. Preserve source identities and aliases so distinct businesses sharing a building or address remain separate.

## Sources and reuse

- Dataset guide, quality limitations and per-source licensing: https://docs.overturemaps.org/guides/places/
- Official download/query instructions: https://docs.overturemaps.org/getting-data/
- Release queried: `s3://overturemaps-us-west-2/release/2026-09-23.1/theme=places/type=place/*`
- DuckDB CLI release: https://github.com/duckdb/duckdb/releases/tag/v1.5.6
- Overture attribution: https://docs.overturemaps.org/attribution/

Preserve each record's source/licence identity and the distribution's provenance/notice requirements. Overture Places is not OSM data. Combining it with OSM requires assessing the resulting database under ODbL rather than assuming the application code licence determines data rights.
