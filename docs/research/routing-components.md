# Routing, maps, and search components for Android

Research date: 2026-10-11. Scope: road routing, place search, regional public transport, Google-free Android compatibility, and local versus hosted processing. This is source research, not a device benchmark or a completed integration. Upstream default branches were inspected; pin a release/commit before implementation because default-branch documentation can describe unreleased behavior.

## Decision supported by the evidence

Reuse a working offline Android maps application for rendering, road routing, navigation, map downloads, and local search. Adding a transit subsystem to that baseline is substantially less work than assembling all of those features around MapLibre. A new UI around reusable libraries is technically possible but does not become a Google Maps replacement merely by displaying vector tiles.

For transit, separate three deliverables:

1. Stop/route discovery and current departures, achievable with local static data plus a permitted operator API.
2. Door-to-door timetable routing, requiring a timetable router plus pedestrian access, egress, and transfers.
3. Realtime-aware journey selection and replanning, requiring trip-matched updates applied inside the routing calculation, not simply badges on a previously calculated static itinerary.

For the first usable version, a verified public local journey-planning API is a reasonable adapter if its terms, coverage, and reliability permit it. Query coordinates are disclosed to that service. An on-device timetable router is a separate feasibility gate. Of the investigated maintained cores, **nigiri is the most promising candidate to investigate for embedding**, but no supported Android build/SDK was found. Do not sell this as already solved.

For deployments with an available always-on computer and ongoing operational support, MOTIS 2 and OpenTripPlanner 2 are realistic self-hosted transit engines. Neither is a zero-maintenance on-phone dependency. A VPS adds recurring cost and is outside the stated requirements.

## Transit engine comparison

| Component | Verified capability | Android / operational reality | License | Fit here |
| --- | --- | --- | --- | --- |
| MOTIS 2 | GTFS and NeTEx, realtime feeds, door-to-door multimodal routing, HTTP/OpenAPI, optional geocoding/tiles | Supported server binaries and desktop build workflows; no supported Android SDK found | MIT | Strong optional self-hosted reference; investigate its smaller nigiri core for local routing |
| nigiri | Reusable C++ timetable/RAPTOR core, GTFS-RT updates, external walking offsets, compact serialized structures | C++23 and several dependencies; current CI lacks Android | MIT | Explicit NDK feasibility spike, not a promised feature |
| OpenTripPlanner 2 | Mature transit-focused server; GTFS/OSM and realtime updates alter itineraries | JVM server, GraphQL; memory-heavy; not an Android library | LGPL-3.0-or-later, with third-party notices | Excellent correctness reference and optional server; poor primary on-device plan |
| GraphHopper GTFS | GTFS route planning and actual GTFS-RT delay/skip/add-trip handling | Java server/library; current offline Android support explicitly discontinued | Apache-2.0 | Technically valid server alternative, not the obvious mobile transit foundation |
| Conveyal R5 | GTFS/OSM, accessibility analysis, many-to-many/time-window calculations | No stable API/SDK; maintainers explicitly warn third-party goals may not align | MIT | Wrong product fit for daily realtime navigation |
| Valhalla | Native road routing, maneuver generation, GTFS ingestion and multimodal transit code | Mobile use claimed, but turnkey maintained Android SDK and GTFS-RT transit pipeline not verified | MIT | Possible road engine for a greenfield build; not evidence of solved realtime transit |
| BRouter | Actual maintained Java/Android offline road router, especially cycling | Android app/library ecosystem and downloadable regional routing data | MIT | Good existing road component; no transit scheduler, place search, renderer, or complete navigation UI |
| RRRR | C RAPTOR core, compact timetable concept; historical Android fork | Upstream last push 2020; Android fork last push 2015 at inspection | BSD-2-Clause upstream | Historical reference, not a maintained modern Android shortcut |

Primary sources for this table and its limitations are detailed below. The latest releases reported by the GitHub releases API during research were [MOTIS v2.11.3](https://github.com/motis-project/motis/releases/tag/v2.11.3), [OTP v2.10.0](https://github.com/opentripplanner/OpenTripPlanner/releases/tag/v2.10.0), [GraphHopper 11.1](https://github.com/graphhopper/graphhopper/releases/tag/11.1), [Valhalla 3.9.1](https://github.com/valhalla/valhalla/releases/tag/3.9.1), [MapLibre Android 13.5.3](https://github.com/maplibre/maplibre-native/releases/tag/android-v13.5.3), [R5 v7.6](https://github.com/conveyal/r5/releases/tag/v7.6), and [BRouter 1.7.10](https://github.com/abrensch/brouter/releases/tag/v1.7.10). These are observations, not upgrade recommendations.

## MOTIS 2 and nigiri: the strongest new local-core investigation

[MOTIS's current README](https://github.com/motis-project/motis) documents:

- OSM street/address/indoor data; multiple GTFS and NeTEx static feeds.
- GTFS-RT, SIRI-ET/SX/FM, and VDV 454 AUS realtime sources for delays, cancellations, track changes, and service alerts.
- Walking, cycling, car, transit, and sharing mobility; geocoding, reverse geocoding, and a tile server.
- A REST API with an [OpenAPI schema](https://github.com/motis-project/motis/blob/master/openapi.yaml).
- A simple server lifecycle: config generation, import, server. This still requires downloading and refreshing source data and monitoring imports.

The [configuration documentation](https://github.com/motis-project/motis/blob/master/docs/setup.md) shows per-static-feed realtime source mapping, HTTP authorization headers, polling intervals, timeouts, optional routed footpaths, transfer durations, source attribution, and health handling. SIRI Lite support is explicitly marked work in progress: do not infer blanket support for every SIRI service/profile. `railviz`/moving vehicles are not themselves proof that positions were measured; distinguish predicted movement along a timetable from a live vehicle-location feed.

MOTIS's claimed low memory usage and planet-scale deployments are encouraging but are not a Turin benchmark. Measure import peak RAM, serving RSS, package size, cold start, and query latency with the actual Turin feeds; do not quote invented minimum server specifications. The full import includes optional tiles, search, and street routing which may have very different resource costs from transit alone.

**Current versus legacy:** [Transitous explicitly identifies its API as MOTIS 2](https://transitous.org/api/), its first stable/versioned API, incompatible with previous development APIs. Old tutorials referring to legacy module configuration or old request envelopes are not current integration instructions.

### What nigiri actually exposes

[nigiri](https://github.com/motis-project/nigiri) is MOTIS's separate MIT-licensed transit core. Its README explains compact data-oriented storage, serialization without reconstructing all structures, memory-mapped containers, GTFS/NeTEx trip identity, service-date and timezone treatment, and stay-seated transfers. These are useful reusable solutions to difficult timetable correctness problems.

Source-level evidence:

- [RAPTOR search interface](https://github.com/motis-project/nigiri/blob/master/include/nigiri/routing/raptor_search.h) takes the static timetable and an optional realtime timetable.
- [Query structure](https://github.com/motis-project/nigiri/blob/master/include/nigiri/routing/query.h) accepts start/destination stop offsets and travel durations, transfer limits, time windows, allowed modes, and other constraints.
- [Intermodal routing tests](https://github.com/motis-project/nigiri/blob/master/test/routing/raptor_intermodal_test.cc) exercise supplied walking/access durations around transit journeys.
- [GTFS-RT update interface](https://github.com/motis-project/nigiri/blob/master/include/nigiri/rt/gtfsrt_update.h) applies protobuf data to realtime timetables and reports parsing, unknown-trip, unmatched-stop, unsupported-relationship, vehicle, and alert statistics. Those statistics can support honest feed-health reporting.

This makes “reuse the timetable core and obtain walking durations from the map app's existing pedestrian router” a credible design hypothesis. It does **not** mean integration is a single dependency declaration. Querying a pedestrian engine separately for hundreds of stops may also be too slow; stop access/egress selection and precomputed transfer edges need a measured design.

### Why Android support remains unproven

The current [CMake build](https://github.com/motis-project/nigiri/blob/master/CMakeLists.txt) requires C++23 and links cista, geo, utl, fmt, date/date-tz, compression, protobuf, Boost, LuaJIT/sol2, XML/JSON support, and the OpenTelemetry API. It builds a `protoc` executable during code generation; cross-compiling that executable requires a host/toolchain strategy. Optional CUDA is disabled by default and is irrelevant for Android deployment.

The [.pkg dependency pins](https://github.com/motis-project/nigiri/blob/master/.pkg) and [CI workflow](https://github.com/motis-project/nigiri/blob/master/.github/workflows/ci.yml) show Linux x64/ARM64, Windows, and macOS builds. No Android build, Android CI, or JNI wrapper was found in the inspected tree. Linux ARM64 binaries are not Android binaries: Android uses a different runtime/libc and packaging model.

Proposed short, bounded feasibility gate before committing to local transit:

1. Pin nigiri plus dependencies. Build only the required static-query/GTFS-RT pieces for Android `arm64-v8a`; establish whether LuaJIT and other import-only dependencies can be excluded cleanly, with no permanent large fork.
2. Generate a Turin timetable on the development machine. Verify its serialized representation loads correctly on the device and define explicit format/version compatibility. Do not assume host serialization is universally portable.
3. Verify timezone data, Europe/Rome DST, after-midnight services, cancellation/skip behavior, and GTFS-to-realtime ID mapping on actual feeds.
4. Integrate minimal JNI lifecycle and cancellation; confirm native compatibility with the installed Android page size, standard native memory protections, and app background/process-death behavior. No blanket security compatibility toggle should be a design requirement.
5. Route a small fixed journey set with realistic walking access and transfers. Measure cold/warm latency, peak memory, package size, battery cost, and realtime-update application.
6. Audit network paths; an OpenTelemetry API dependency is not proof of telemetry export, but no exporter or network logging should be configured implicitly.

Pass only if a pinned reproducible build and real-device behavior are satisfactory. Failure is a reason to defer offline timetable routing or retain a permitted online adapter, not to rebuild a routing algorithm impulsively.

### Implementing RAPTOR/CSA directly

RAPTOR and CSA are algorithms, not complete applications. A tiny demonstration can find a route while omitting transfer restrictions, calendars, >24:00 stop times, DST, platform access, frequency trips, added/cancelled trips, accessibility, and ID/version migration. Owning those semantics would oppose the reliability requirement.

[RRRR](https://github.com/bliksemlabs/rrrr) is a real C implementation of RAPTOR designed for compact timetables and eventual mobile use; its README still phrases important goals as eventual and explicitly starts with stop-only routing. Its [Android fork](https://github.com/mosmieri/rrrr-android) is historical. The GitHub APIs reported upstream last push in December 2020 and the Android fork in September 2015. This is evidence that small on-device transit routing is possible, not a recommendation to base a modern Android app on that unmaintained stack. No maintained turnkey Android RAPTOR/CSA SDK was established by this investigation; this is not a claim that none can exist.

## OpenTripPlanner 2

[OTP's own overview](https://github.com/opentripplanner/OpenTripPlanner) states that it builds a transit/street network from GTFS and OSM, exposes GraphQL APIs, and applies realtime updates and alerts so itineraries reflect service changes. OTP 2 is the only supported major line.

The current [tutorial](https://github.com/opentripplanner/OpenTripPlanner/blob/dev-2.x/doc/user/Basic-Tutorial.md) describes a Java 25-or-newer JVM, at least 1GB memory for the Portland example, several GB for larger inputs, and more memory for graph building than serving. These are the documentation's examples, not estimates for Turin. Choose the Java version required by the pinned release, not blindly the default development branch.

[GTFS-RT configuration](https://github.com/opentripplanner/OpenTripPlanner/blob/dev-2.x/doc/user/GTFS-RT-Config.md) has separate trip update and vehicle position updaters, feed IDs, polling, headers, fuzzy matching, and delay propagation behavior. This is actual integration of realtime into planning. It also illustrates why “fetch bus positions” is not equivalent to “plan a reliable transfer.”

[License](https://github.com/opentripplanner/OpenTripPlanner/blob/dev-2.x/LICENSE): LGPL-3.0-or-later with incorporated third-party notices. A separate self-hosted service has a different linking relationship from copying its code into an app; retain the license analysis when choosing the architecture.

## GraphHopper, R5, and Valhalla

**GraphHopper:** the [GTFS README](https://github.com/graphhopper/graphhopper/blob/master/reader-gtfs/README.md) provides OSM+GTFS import and transit alternatives. The [realtime integration tests](https://github.com/graphhopper/graphhopper/blob/master/reader-gtfs/src/test/java/com/graphhopper/RealtimeIT.java) explicitly test delayed trips changing the preferred itinerary, skipped boarding/alighting/transfer stops, and added trips. The [feed loader](https://github.com/graphhopper/graphhopper/blob/master/web-bundle/src/main/java/com/graphhopper/http/RealtimeFeedLoadingCache.java) consumes protobuf realtime feeds. Do not dismiss its realtime capability as an arrivals-only feature.

However, its [main README](https://github.com/graphhopper/graphhopper#offline) explicitly says offline mobile routing is no longer officially supported, pointing to the old 1.0 demo. Current Java compatibility is not proof of current Android compatibility. The paid GraphHopper Directions API is separate from the Apache-licensed engine; no paid API is necessary for self-hosting, but hosting work remains.

**R5:** its [maintainer README](https://github.com/conveyal/r5) calls it the routing engine for Conveyal accessibility/scenario analysis, optimized for one-to-many/many-to-many work across time windows. It explicitly says no stable API/SDK is exposed and third-party deployments receive no support. MIT licensing alone does not make it the right library for a realtime navigation app. This research did not establish a supported production GTFS-RT journey-planning integration suitable for this use.

**Valhalla:** its [README](https://github.com/valhalla/valhalla) identifies a C++ engine used on Android/iOS, with tiled route data and maneuver generation. Current source includes a [GTFS importer](https://github.com/valhalla/valhalla/blob/master/src/mjolnir/ingest_transit.cc), [transit builder](https://github.com/valhalla/valhalla/blob/master/src/mjolnir/transitbuilder.cc), and [multimodal algorithm](https://github.com/valhalla/valhalla/blob/master/src/thor/multimodal_transit.cc). The actual license is [MIT in COPYING](https://github.com/valhalla/valhalla/blob/master/COPYING), even when GitHub's automatic license badge says “Other.”

Do not infer a complete GTFS-RT transit solution from its “real-time traffic” road-routing features. No supported GTFS-RT trip-update pipeline was verified here. Also, no current plug-and-play official Android SDK comparable to MapLibre's renderer was established; native embedding is engineering work.

## Rendering and offline packages

**MapLibre Native Android** is a maintained BSD-2-Clause renderer with a normal Android dependency and MapView integration; see its [README and license](https://github.com/maplibre/maplibre-native). It does not include a public transport timetable engine, a full geocoder, or road navigation by virtue of being a maps SDK.

Its current [Android PMTiles documentation](https://github.com/maplibre/maplibre-native/blob/main/platform/android/docs/data/PMTiles.md) is particularly relevant:

- Native PMTiles support starts at Android SDK 11.7.0.
- `pmtiles://https://…` reads remote files; `pmtiles://file://…` reads local device files, with asset paths also documented.
- Sources can be vector, raster, or terrain.
- **PMTiles sources do not support the offline-pack downloader or caching.** For reliable offline use, explicitly download/verify a region archive, then point at the local file. A streamed archive is not an offline download plan.
- Package the style, sprite images, glyph/fonts, attribution, and all referenced assets locally as well; a local map file alone does not prove zero network requests.

[Protomaps basemap downloads](https://docs.protomaps.com/basemaps/downloads) provide a genuinely available no-paid-service route to vector map data: daily planet builds and [CLI extraction](https://docs.protomaps.com/pmtiles/cli) for a bounded region. The docs discourage hotlinking to the download URLs and explain that URLs may change; use a downloaded regional archive, not those URLs as a permanent tile CDN. The current whole-planet file is approximately 120GB, so extract a region rather than fetching the planet. No Turin archive size was measured here. The basemap is described as an ODbL Produced Work and requires OSM attribution.

[Planetiler](https://github.com/onthegomap/planetiler) can independently generate PMTiles/MBTiles from OSM extracts on a development machine. Its reference basemap build requires additional sources and significant disk; the README quotes disk needs of 1GB plus 5–10 times the PBF size and RAM around half the PBF size. Generating regional Turin maps is feasible tooling, but a separate pipeline to maintain.

[Mapsforge](https://github.com/mapsforge/mapsforge) is another proven Android offline vector renderer with compact map files, downloadable maps, and a POI library/data format. It has LGPLv3 with documented Android linking exceptions. It is worth considering if its map style/feature model fits, but it still is not an entire routing application.

## Road routing, navigation, and search are separate work

[BRouter](https://github.com/abrensch/brouter) is a real Android offline routing project, MIT-licensed, emphasizing bicycles and energy-based car routing. It supplies 5×5-degree `.rd5` segments generated weekly and documents generating them from OSM yourself. Existing integration with OsmAnd is documented. Its advantages are proven Android operation and no need for an online road-routing API; it does not provide timetable routing or replace address search and the navigation interface.

[Ferrostar](https://github.com/stadiamaps/ferrostar) is an open-source navigation SDK with Android/iOS examples. It is a reusable navigation layer worth investigating for a greenfield product; no claim is made here that it bundles free map data or a local road-routing engine. Provider selection and offline routing remain separate decisions. Buying a commercial API is not implied by using an open-source SDK, and neither is free hosted service guaranteed.

[Photon](https://github.com/komoot/photon) is an Apache-2.0 geocoder with autocomplete, typo tolerance, bounding-box filters, reverse geocoding, and location bias. It is a Java/OpenSearch server, not an Android local search package. Its public demo expressly has no availability guarantee and can throttle/ban heavy use; self-hosting requires data, RAM, and updates. The current README's planet resource figures must not be mistaken for requirements for Turin, but they demonstrate why full-planet search is not a phone dependency.

For an existing-app fork, reuse the app's local map/POI/address indexes. For a greenfield Turin prototype, a local SQLite/FTS index of selected OSM addresses/POIs and GTFS stops is a possible implementation choice, not an already integrated equivalent of Google's ranked place search. Search quality, synonyms, civic addresses, duplicate places, and relevance need acceptance cases.

## Public service policies: open data is not unlimited free infrastructure

**OSM standard raster tiles:** the [official policy](https://operations.osmfoundation.org/policies/tiles/) explicitly forbids offline/prefetch/bulk download features, requires visible attribution, identifiable requests, and caching, and provides only best-effort availability. Do not implement “download Turin” by crawling `tile.openstreetmap.org`. Use region packages or build/extract legally reusable datasets.

**Public Nominatim:** the [official policy](https://operations.osmfoundation.org/policies/nominatim/) caps use at one request per second per application, requires identification and attribution, prohibits client-side autocomplete and systematic POI harvesting, and requires a swappable endpoint. It also explicitly limits generic auto-generated/vibe-coding integrations without an informed responsible developer decision. It is not an appropriate invisible default for a full search-as-you-type maps app. These restrictions concern the donated public service, not the ability to run the open-source software yourself.

**Transitous:** the [official API policy](https://transitous.org/api/) says the service is volunteer-run and best effort, for open-source noncommercial applications, with identifying User-Agent/contact information and source attribution. Published source is required, with a narrow allowance for light prototype testing. It asks developers to contact the operators before potentially resource-intensive endpoints, including routing/isochrones, or many requests. No contact was made in this research. An unpublished repository does not automatically satisfy the ongoing-use policy. Public availability also does not imply an SLA or local Turin feed completeness.

This does not rule out any of these services for properly permitted narrow use. It rules out pretending they are an unlimited no-cost backend owned by the app.

## Offline transit topology and data correctness limitations

OSM bus/metro route geometry and nearby stop markers are topology. They do not establish which service runs on a holiday, actual departure time, trip cancellation, or a feasible timed transfer. A “public transport mode” in a map app must be checked against those semantics before assuming timetable functionality.

The static GTFS model and realtime model are distinct; see the [GTFS Schedule reference](https://gtfs.org/documentation/schedule/reference/) and [GTFS Realtime reference](https://gtfs.org/documentation/realtime/reference/). GTFS-RT complements static feed identities; it is not a replacement for a full timetable. Vehicles, trip updates, and alerts are different entities. A feed may supply one without the others.

For this project, a reliable offline package and live adapter need:

- Versioned source attribution, licenses, validity interval, timezone, feed hash, import version, and schema version.
- Explicit matching of source/feed/trip/stop identifiers and measurement of unmatched realtime entities.
- Pedestrian access/egress and transfer paths from a routable street network. Straight-line proximity can incorrectly connect opposite platforms, fenced stops, or sites separated by railways/rivers.
- Departure-after and arrive-by behavior; service exceptions, night trips with times above 24:00, DST, transfers, and minimum change times.
- Distinct statuses for scheduled, live, stale, cancelled, no prediction, and offline; an HTTP success is not evidence that the prediction itself is fresh.
- Feed timestamp checks, last-known-good retention, atomic replacement, failed-update rollback, and expiration handling. An outdated timetable must not silently invent continued service.
- Bounded data polling while relevant UI/navigation is active; no continuous all-city polling by default just because an endpoint exists.

For local realtime routing, apply updates before comparing journey alternatives. Merely annotating a static route with “+10 minutes” can miss a now-impossible connection or a better alternative. If the initial feature is arrivals-only, name it that way and retain static itinerary labeling.

## Licensing and architecture notes

Keep three inventories distinct: code licenses, dataset licenses, and hosted-service usage policies. MIT/Apache/BSD code does not make a GTFS feed redistributable. An open GTFS format does not itself license a feed. OSM's [copyright/ODbL page](https://www.openstreetmap.org/copyright) governs OSM data; imported transit feed terms must be checked individually before publishing combined download packages.

The application's own source license need not equal a data license. ODbL is about the database/use of database-derived works, not a blanket requirement to open every application. Conversely, a public-data claim does not erase database attribution/share-alike duties. An MIT nigiri component can normally fit within a GPL application while retaining notices; distributing a combined app must follow the host application's and dependency licenses. Sideloading still requires following applicable source/data obligations when the project or artifacts are distributed.

Practical boundary: keep the offline map app functional independently; add a narrow transit data/routing subsystem with explicit source identity and freshness, and keep provider-specific API translation out of the general route UI. This preserves the possibility of replacing a public API with a local core after the feasibility gate passes.

## Concrete next research/validation gates

1. Select the existing-app baseline after actually comparing offline search, car/walk/bike routing, navigation UX, map updates, and buildability. This component research supports reuse but does not substitute for that app audit.
2. Validate Turin's real feeds and APIs first: present coverage, matching IDs, allowed client use, observation freshness, and actual plan/realtime behavior. Do not choose a router around assumed feeds.
3. Trial a direct departures adapter and, if available/permitted, a direct journey API while keeping on-device street maps/search/navigation.
4. Run the nigiri NDK feasibility gate if offline timetable routing is a priority. Desktop MOTIS/OTP can serve as comparison/reference tools without becoming production hosting commitments.
5. Define a small real journey acceptance set: direct tram, bus-to-metro, change with a tight connection, regional rail, night/holiday, disrupted/cancelled trip, wrong-platform walking, and offline/stale feed states. Use measured device and field results to decide the next architecture step.

No engine was built or benchmarked on an Android device during this research. No public routing service was put under load, no paid service was purchased, and no always-on infrastructure was provisioned.
