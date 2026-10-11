# Place-search validation method

Research date: 2026-10-11. This method separates source-data coverage from indexing, ranking and interface failures. It does not claim a statistically representative coverage study or measured superiority between applications.

## Diagnose a missing result

1. Record the application/map version, query, viewport and expected result from an independently verifiable source.
2. Check whether the place is present in raw source data with usable name, brand, category and address fields.
3. Check whether the place reached the downloaded package and local index.
4. Test exact-name retrieval, category retrieval and ranking at the recorded viewport.
5. Inspect the place sheet, entrance placement, contact details and unsupported or stale fields.

A geocoder query miss does not establish absence from the underlying map data. A place absent from the source cannot be recovered by rearranging the search interface. Name aliases, category normalization and ranking can improve retrieval of existing records.

## Compare independent datasets

Keep source IDs, release versions, coordinates and licences for each record. Match by more than a single name or shared street address: multi-tenant buildings and nearby chain branches can contain distinct businesses. Confirm operating status through business-owned sources or field observation before adding a correction.

Compare exact-name and generic category queries across the same supported region and dataset revision. Food discovery should consider applicable bars, fast-food venues and restaurants. Report incremental verified records and duplicate/closed-record errors separately from raw counts.

Google listings can serve as a bounded manual comparator, subject to their terms; they are not a reusable application dataset or business-existence ground truth. Do not import reviews, ratings or listing details into an open-data index without applicable rights.

## Acceptance checks

- Exact-name, address and broad category queries retrieve independently verified records.
- Ranking makes the intended branch selectable within a documented result limit.
- Shared addresses and nearby coordinates do not merge distinct venues.
- Unknown hours remain unknown; operating status does not create an “open now” badge.
- Source timestamps, licences and uncertainty survive enrichment and duplicate handling.
- Search latency and cached/offline behavior are measured on supported Android configurations.

## References

- [Business-data sources and licensing](place-discovery.md)
- [Bounded dataset-access method](place-data-probe.md)
- OpenStreetMap API: https://wiki.openstreetmap.org/wiki/API_v0.6
- Overture Places guide: https://docs.overturemaps.org/guides/places/
- Google Places policies: https://developers.google.com/maps/documentation/places/web-service/policies
