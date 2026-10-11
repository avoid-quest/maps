# Earlier offline/fork assessment — superseded recommendation

**The selected architecture is documented in [recommendation.md](recommendation.md). This document preserves the earlier offline-engine assessment and its technical evidence.**

**Research date: 2026-10-11. Status: proposal, not an architecture commitment or working app.**

## Recommendation

**Start by testing a CoMaps-based fork, retaining its offline map/search/road-navigation engine, but redesigning the everyday Android interactions and adding independent place-discovery and transit subsystems. Do not start a complete maps/navigation stack from scratch. Interface changes and data enrichment require separate implementation and validation.**

The recommendation is conditional on three short experiments: can the native app expose the required map/search/navigation seams without a large permanent patch; does a source-aware OSM + Overture place index materially improve local discovery; and can a maintained timetable engine be embedded efficiently on Android? Make those results reviewable before selecting the long-term foundation.

This is the best current route to the stated combination of broad functionality, privacy, bounded operating cost and maintainability. It is not a promise of complete Google Maps parity. Google-scale reviews, merchant-maintained business details, live traffic and street imagery are data/network products as much as app features. The sources examined do not provide an equivalent free, complete offline corpus.

## Earlier architecture criteria

- Google-free Android compatibility and signed APK distribution.
- A full everyday Google Maps alternative: useful place discovery plus walking, driving, cycling and public transport, rather than only an arrival-board app.
- Independently designed search, place-selection and route-planning interactions.
- Restaurants, particular shops and business details are core functionality, not polish to add after navigation.
- Regional transit support and independently verified place-discovery cases.
- Prefer on-device processing; direct public transit requests are acceptable.
- No paid services. No required VPS, paid routing/search API or subscription. Development-machine preparation and APK/data sideloading are viable defaults.

Detailed priorities within “full featured” remain adjustable: offline transit planning versus live arrivals first, driving traffic, reviews/photos, Android Auto, accessibility and regional rail. The roadmap below does not silently mark them all solved.

## Verified evidence

Three research tracks examined current app source/releases, transit endpoints, and routing components. A separate platform review checked Android documentation. Business-data documentation, a manual Google Maps/raw OSM comparison, and a bounded Overture extract provide the place-discovery evidence.

This investigation includes real network/data probes and source-code inspection. It does **not** include an APK build, an attached Android device test, an Organic Maps Android search benchmark, measured battery use, a week of feed monitoring, or field-verified bus arrivals. Those are explicit next gates, not conclusions inferred from project descriptions.

### Turin transit is viable, with significant edges

GTT's anonymous HTTPS endpoints returned a current static GTFS file and all three GTFS-RT types: trip predictions, vehicle positions and service alerts. The inspected static feed had 215 routes, 7,052 stops and a validity envelope reaching 2027-01-31. At one Sunday-afternoon snapshot, all **264** predicted trip IDs and **1,697** `(trip_id, stop_sequence)` arrival updates matched the static data. This supports actual live departures and eventually delay-aware planning, not just moving vehicle dots. [Detailed evidence and endpoints](turin-transit-data.md).

The same sample exposed reliability issues worth designing around: some entities were much older than the fresh feed header; 33 vehicles omitted trip IDs; some alert references did not match current stops/routes. Results must distinguish scheduled, live, stale, cancelled and unknown. A fresh HTTP response is not sufficient evidence of a fresh prediction.

GTT's current [first-party data licence](https://www.gtt.to.it/gtt_gtfs_license.html) permits non-commercial use with attribution and offers no availability warranty. Reuse must remain within those terms; this is not unrestricted open data. The licence trail for realtime is documented separately in the source report.

Metro M1 exists in the static data; metro realtime was not established. GTT's static file contains no rail-type routes. The Piemonte regional bus file explicitly warns that it is not recommended for infomobility because it represents contract planning and omits operational details/temporary changes. Do not build reliable travel advice from a dataset just because it is called GTFS and its catalog was updated yesterday.

MATO/5T's anonymous GraphQL backend returned an actual walk–SFM–walk itinerary for a synthetic public-location test. Its wider feeds include Trenitalia and Arriva. This is a useful optional online-planner lead; general API reuse terms, quotas and guarantees remain unverified, and the sampled rail legs were explicitly not realtime. It must not be the unacknowledged sole foundation.

Current national Trenitalia NeTEx is downloadable from Italy's National Access Point. The inspected XML header is fresh, but full timetable completeness, import compatibility, realtime pairing and ambiguous licensing still need investigation. Italy expansion should be operator-by-operator, not “load one national file and assume it works.”

### Source data and search behavior need separate validation

Manual source comparisons and a bounded Overture extract showed that category/name normalization can affect discovery even when a source record exists. A failed geocoder query alone does not establish source-data absence. Supplemental datasets can add some records while leaving coverage gaps.

Overture supplied 3,701 raw records in the query rectangle, including 464 food/drink and 838 shopping records. Those numbers include poor-quality and closed records and must not be marketed as unique operating businesses. Among the food/shop records, 87 were marked permanently closed and 802 had no website. Use the dataset selectively, with duplicate handling, source attribution and independent verification.

See [the validation method](place-search-sample.md) and [dataset probe](place-data-probe.md). Manual commercial-map comparisons are not permission to copy listings into application data.

## Fork versus new app

| Option | Advantages | Main problem | Decision |
|---|---|---|---|
| CoMaps fork + focused UI replacement + new subsystems | Keeps offline downloads, renderer, local search and car/walk/bike guidance; permissive main code licence | Same UI ancestry as Organic; internal SDK/native route state require real integration work | **First experiment** |
| Organic Maps fork | Known working baseline, mature offline core | Shared interaction model, plus extra compiled-data/rebranding terms | Technically viable alternative, not first choice |
| OsmAnd fork/customization | Broad navigation and search tools, mature Android ecosystem | Much larger interaction surface; existing transit is not GTFS-RT; mixed asset licences and download identifier need review | Baseline to compare; not automatically a usability/privacy improvement |
| BusTO fork | Current Turin arrivals, vehicles, alerts and maintained adapters | Does not supply full road navigation and place discovery | Reference and benchmark, not full-app foundation |
| New Kotlin app + MapLibre | Maximum UI freedom, conventional custom layers | Must integrate offline search, road routing, map packages, navigation state, voice, rerouting and transit separately | Fallback if native fork seams fail |

Source/release/licence details: [app foundations](app-foundations.md). Transportr and Öffi are useful transit UX/provider references but neither was verified as a complete Turin solution or a general offline maps foundation.

CoMaps has an internal Android `:sdk`, not a verified stable standalone library that can simply be dropped into any app. Its native routing session does not expose arbitrary external itineraries as a plugin contract. Plan explicit native overlay and walking-query adapters. Existing experimental GTFS code uses approximate frequency waiting; do not mistake that for correct scheduled transfer routing.

Keep the first fork's map format unchanged. Avoid “MapLibre renderer + CoMaps route engine” initially: that creates two map-data stacks and new geometry/guidance integration work. If broader UI replacement is needed, compare an in-tree Android shell using the same engine with incremental changes before taking on the full greenfield alternative.

## Proposed architecture

The phone owns the interaction and local data. A development computer can prepare regional packages; no always-on server is required.

**Existing map/navigation core:** retain offline road graph, base map, address search, map download/update logic and working car/walk/bike guidance. Audit its actual network requests and download-service expectations. OSM data licensing does not guarantee indefinite free access to someone else's download servers.

**New discovery interface and local place index:** query existing map search and a separate SQLite/FTS/spatial index built from permitted regional place data. Normalize Italian names, aliases and categories; merge duplicates while keeping source IDs. Rank exact names/brands, relevant categories and nearby reachable places. Show useful detail sheets with source-supported opening hours, cuisine, phone and website; unknown hours remain unknown. A place's existence score is never a user rating, and `operating_status=open` is never an “open now” claim.

Start enrichment with Overture, whose direct regional access was demonstrated. Consider Foursquare OS Places only if it adds verified local value: its current download workflow uses a portal account/token and Iceberg, while the old public S3 release listing no longer contains datasets. AllThePlaces is a useful chain-store supplement, often already upstream of those products. Hosted free tiers such as Geoapify/TomTom are optional comparisons, not required infrastructure; a free quota is not an open offline database. [Place-data options](place-discovery.md).

**Transit subsystem:** store a versioned GTT timetable locally, including service exceptions and the distinction between public stop code and internal stop ID. Apply direct city-level GTFS-RT downloads locally when the transit screen or journey needs them. Scope realtime queries and refreshes to the task, preserve entity timestamps, and retain the last valid static package. Live arrivals and alerts can be useful before local journey planning is complete.

**Timetable routing:** investigate the maintained MIT-licensed **nigiri** core used by MOTIS. It has real timetable/RAPTOR routing and GTFS-RT application, plus interfaces for externally computed walking access durations. However, the inspected build uses C++23 and substantial dependencies; Android/JNI support was not established. Run a bounded NDK build/load/query experiment, including serialization, timezone data, realtime updates, memory and Android compatibility, before choosing it. Reuse proven algorithms and semantics rather than writing a miniature untested planner from scratch.

If local embedding fails, choose deliberately between a permitted MATO adapter for online planning, postponing offline transit planning, or evaluating a self-hosted engine if operational requirements justify it. Do not silently introduce a paid VPS or promise that OTP/MOTIS server binaries run as Android libraries. OTP and MOTIS are good desktop correctness references during development. [Engine research](routing-components.md).

**Updates:** import/validate GTFS and place packages on the development machine initially; sideload versioned files or use an explicitly permitted distribution mechanism later. Keep source release/hash, licence, validity and application schema version with every package. Atomically replace good packages and roll back failed updates. Manual package transfers add a measurable usability cost that should be compared with automatic delivery.

## Privacy and Google-free Android behaviour

No Google services, account, telemetry SDK or push service is necessary for the phone app. Use OS location APIs and respect the configured system location service. Request precise location only where it improves the current task; manual search works without permission. Use a foreground service only for active guidance. [Platform evidence and test plan](android-privacy.md).

Local map/search/routes keep destinations off servers. Direct operator downloads still expose IP address and request time; stop-specific requests reveal stops, and remote planning reveals origin/destination. City-level realtime downloads can avoid transmitting the actual journey while using somewhat more data. No claim of network anonymity is warranted.

The default should have no continuous idle tracking/polling, no cloud history, and optional local recents. Network-denied mode must still support downloaded map/search/road routes and available timetables. No network means no new live arrivals or disruptions. Audit native arm64 libraries and the applicable page-size configuration on supported Android devices; retain standard OS protections.

## Roadmap with decision gates

### 1. Establish the baseline and three decisive experiments

Build an unchanged Google-free CoMaps baseline and verify signed sideload/update on supported Android devices. Compare current Organic Maps, CoMaps, OsmAnd and BusTO against fixed local search/journey tasks. Record cold start, query time, storage, memory, battery and outgoing destinations; set performance targets from that evidence, not invented numbers.

In the same first feasibility phase:

- **UI/core seam:** replace one search-to-place-to-walking-route flow, display external POIs and one transit itinerary, and confirm upstream navigation/lifecycle still work.
- **Discovery:** prepare a bounded Overture index, deduplicate the known examples, and prove Italian food/shop queries improve useful top results without flooding them with stale records. Validate a modest 30–50-place corpus from business-owned sources/local knowledge across chains and independent stores.
- **Transit core:** compile/load nigiri on Android or document the concrete blocker. Query real GTT timetables with walking access and apply a live/replayed update. No claim of local transit feasibility until this passes.

**Exit:** choose the fork/shell strategy and transit-planning mode based on these measured results. If the revised UI does not meet the benchmark interaction goals, resolve that before months of integration.

### 2. Deliver a useful benchmark build

Preserve offline walking/driving/cycling navigation. Replace daily search, category exploration, place details, saved places and route selection. Add the independent place package, nearby stops, line/direction details, live stop departures and applicable alerts. Avoid a giant settings interface.

**Exit:** the independently verified shops/food places are discoverable, route selection works, and the fixed GTT journey cases pass. Correct offline/stale/error states are required. This milestone is valuable but is not yet full transit journey planning if the engine gate has not passed.

### 3. Complete scheduled door-to-door transit

Implement depart-at/arrive-by, walking access/egress, transfers, service exceptions, after-midnight trips and Europe/Rome DST. Prevent transfers across fences, railways or inaccessible platforms using real walking paths; do not substitute straight-line distance as if it were walkable. Preserve stop/line/direction clarity.

**Exit:** a fixed journey corpus covers direct tram, bus–metro, multi-transfer, late-night, Sunday/holiday and boundary cases. Results are compared with reference tools and field knowledge. The app clearly states which operators/modes are supported.

### 4. Make realtime affect choices and guidance

Apply delays/cancellations/skipped stops before comparing itineraries, so a missed connection produces a different recommendation. Add current-journey guidance, replan, alert relevance and confidence/freshness handling. Only then treat realtime routing as done; adding delay labels to static routes is insufficient.

**Exit:** replayed disruptions/mismatched IDs/expired feeds and real field trips degrade safely. Run a multi-day, provider-respectful observation period against a fixed journey corpus and measure prediction error against observed arrivals. Test screen-off, battery saver, process death, tunnel GPS loss and network handover.

### 5. Expand based on value, not feature count

Add SFM/regional rail only after source completeness, service dates, rights and realtime status are established. Consider other Italian cities via independent operator adapters. Evaluate 5T parking/traffic/ZTL datasets separately: their existence is not proof of citywide traffic-aware driving ETAs. Add accessibility/fare advice only where sufficiently reliable data exists. Photos, community reviews and richer business data require separate credible sources and attribution.

Android Auto and national live traffic are separate projects; they are not hidden prerequisites for a usable Google-free phone app. Reassess priority with actual daily use.

## Reliability and maintenance requirements

- Field quality takes precedence over map animations and feature count. An incorrect platform, closed venue or impossible transfer is a product failure even when the UI is fast.
- Retain attribution and source provenance separately for code, map data, business data and transit data. Distribution must preserve the obligations of each licence.
- Keep provider adapters replaceable, with parsing fixtures and bounded retries; endpoints have changed historically in BusTO.
- Keep a small upstream patch series and periodically merge fixes. Prefer new isolated modules over changes to the native map format.
- Use stable release signing, safe favourites/export migration and package checksums. Keep secrets/signing keys out of the repository.
- No unattended personal-location uploads or external crash reporting. Diagnostics should be local and intentionally exportable.
- Local corrections and favourite places are useful even when public datasets lag; verify upstream edits independently rather than copying another map provider's database.

No precise delivery date is defensible before the native/UI experiments. An incremental maps app is a smaller goal than production-quality all-mode Google Maps parity; the latter is a sustained multi-month engineering and maintenance effort, with some data gaps no amount of app code alone resolves. This plan is designed to discover the expensive blockers before that investment.

## Repository and reviewable outputs

Keep platform, place-data and transit integration changes reviewable separately, with source provenance recorded.

After selecting the foundation, preserve upstream history and provenance. Keep the platform/POI/transit work reviewable separately. Initial structure can place the forked app/SDK where upstream expects, with new feature modules and desktop import tools; do not commit to a new monorepo layout before inspecting the pinned build.

Supporting reports:

- [App foundations, code seams, licences and maintenance](app-foundations.md)
- [Turin/Piedmont/Italy transit data and actual endpoint probes](turin-transit-data.md)
- [Routing, maps, geocoding components and public-service policies](routing-components.md)
- [Business discovery sources, access and search design](place-discovery.md)
- [Place-search validation method](place-search-sample.md)
- [Overture dataset probe](place-data-probe.md)
- [Google-free Android/privacy constraints and device acceptance checks](android-privacy.md)
