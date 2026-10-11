# Android app foundations: maps and regional transit

Research date: 2026-10-11. Sources were read from official project sites, current source, release APIs and F-Droid's distribution metadata. This is a source-level assessment, not a successful build or device test. Release dates below are observed release/distribution dates, not promises of support.

## Earlier offline-engine assessment

This assessment compares complete offline map/navigation engines with a renderer-based application. Reusing a complete engine retains offline guidance but requires native integration and upstream maintenance. CoMaps shares Organic Maps' ancestry and much of its interaction model. The selected Expo architecture is documented in [recommendation.md](recommendation.md); the comparisons below remain reference material.

This is conditional on an integration experiment. CoMaps' `:sdk` provides a useful internal separation, but it is not evidence of a stable published routing SDK. Native route rendering, pedestrian access legs, and a replacement search/place/navigation UI need demonstrated integration before committing to the fork. A stock app comparison and a precise inventory of the interactions to replace remain essential.

## Candidate comparison

| Foundation | Already supplies | Transit reality | Assessment for this project |
|---|---|---|---|
| CoMaps | Offline maps and POI/address/category search, car/walk/bike voice navigation, saved places, map downloads, offline Wikipedia, tracks, subway layer/directions | Existing subway/transit graph is not verified as Turin bus timetables or GTFS-RT; experimental GTFS conversion exists but routing code uses approximate frequency waits | Best initial engine/full-app candidate; redesign Android surfaces and add transit as a new subsystem. Significant JNI/C++ integration and ongoing upstream merge work |
| Organic Maps | Mature offline map/search/navigation base | README's “public transport routes” does not establish time-aware Turin transit | Technically credible, but compiled-data and rebranding terms complicate an independently branded fork; interface changes require implementation |
| OsmAnd | Very broad offline POI/search/navigation, many travel profiles, overlays and plugins | Official docs: OSM PTv2 relations, configured vehicle speeds; testing-stage route viewing without full transit navigation. This is not schedule/realtime journey planning | Strong capability baseline to try, but larger UI/feature surface to maintain, mixed assets licensing, download identifier privacy issue; not a shortcut to GTT real-time transit |
| Libre BusTO | Actual Turin stop arrivals, nearby stops, favorites, line maps, live vehicles and service alerts | Direct local integrations, static GTFS and real-time endpoints in source | Excellent real-world baseline and integration reference; lacks complete car/walk/bike/POI navigation product. Not the full-app foundation for a general maps application |
| Transportr | Transit-oriented trip planning, departures, station maps, favorites | Online transport-provider adapters; realtime only where providers support it. Current source has no Italy-specific network entry; website coverage is broader/staler than source | Useful UX and adapter reference, not verified Turin support and not an offline general maps engine |
| Öffi | Door-to-door public transport planning, live departures, nearby stations, network plans | Provider-driven, online. Official site lists Italy including several cities, but does not establish Turin GTT live coverage | Useful benchmark. Not a complete offline general maps replacement |
| New Android app with MapLibre | Flexible map rendering and arbitrary visual layers | No transit planner, pedestrian/car router, offline geocoder or map package pipeline supplied by the renderer | Maximum UI freedom but must integrate/rebuild many mature features. Keep as fallback if engine integration proves impractical, not as the default cheapest solution |

Sources: [CoMaps README](https://codeberg.org/comaps/comaps/src/branch/main/README.md), [Organic Maps README](https://github.com/organicmaps/organicmaps/blob/master/README.md), [OsmAnd transport documentation](https://osmand.net/docs/user/navigation/routing/public-transport-navigation/), [BusTO official introduction](https://gitpull.it/w/librebusto/en/), [Transportr official site](https://transportr.app/), [Transportr network registry](https://github.com/grote/Transportr/blob/master/app/src/main/java/de/grobox/transportr/networks/TransportNetworks.kt), [Öffi official site](https://oeffi.schildbach.de/), [MapLibre Native](https://github.com/maplibre/maplibre-native).

## Maintenance and licenses observed

| Project | Recent evidence | License detail relevant to reuse |
|---|---|---|
| CoMaps | Official Codeberg release `v2026.10.05-19`, published 2026-10-06 local offset; GitHub mirror pushed 2026-10-10 | Apache-2.0 code, dependency exceptions; map attribution identifies OSM ODbL, plus separate source-data licenses |
| Organic Maps | Android `2026.09.29-32-android`, published 2026-09-29; repo pushed 2026-10-11 | Apache-2.0 code; separate `DATA_LICENSE.txt` for compiled `.mwm`/`.bin` files adds attribution and written-permission condition for rebranding/white-labeling |
| OsmAnd | F-Droid advertises 5.3.10; main repository pushed 2026-10-11 | GPLv3 core source, but UI/layouts/icons CC-BY-NC-ND 4.0 and further voice/assets exceptions. Do not call the whole product unrestricted GPL |
| BusTO | Official source HEAD `80ff75172fe807e0f4d61af1b32fc330f44ee44f`, 2026-10-09, “Release new version 2.6.6”; F-Droid currently offers 2.6.5 added 2026-09-26 | GPL-3.0-or-later |
| Transportr | GitHub latest release 2.2.7, 2025-12-03; repository push 2026-05-28 | GPL-3.0-or-later (README); older Android dependencies remain despite recent maintenance |
| Öffi | Official download 14.0.9; F-Droid added 2026-09-14 | F-Droid records GPL-3.0-only; source hosted on GitLab, not `schildbach/oeffi` on GitHub |

Release sources: [CoMaps](https://codeberg.org/comaps/comaps/releases/tag/v2026.10.05-19), [Organic Maps](https://github.com/organicmaps/organicmaps/releases/tag/2026.09.29-32-android), [Transportr](https://github.com/grote/Transportr/releases/tag/2.2.7), [BusTO source](https://gitpull.it/source/libre-busto/), [BusTO F-Droid](https://f-droid.org/en/packages/it.reyboz.bustorino/), [Öffi download](https://oeffi.schildbach.de/download.html), [Öffi F-Droid](https://f-droid.org/en/packages/de.schildbach.oeffi/), [OsmAnd F-Droid](https://f-droid.org/en/packages/net.osmand.plus/).

License sources: [CoMaps LICENSE](https://codeberg.org/comaps/comaps/src/branch/main/LICENSE), [CoMaps NOTICE](https://codeberg.org/comaps/comaps/src/branch/main/NOTICE), [CoMaps map and third-party copyrights](https://codeberg.org/comaps/comaps/src/branch/main/data/copyright.html), [Organic Maps binary-data terms](https://github.com/organicmaps/organicmaps/blob/master/DATA_LICENSE.txt), [OsmAnd LICENSE](https://github.com/osmandapp/OsmAnd/blob/master/LICENSE), [BusTO license statement](https://gitpull.it/w/librebusto/en/), [Transportr license statement](https://github.com/grote/Transportr#license).

CoMaps and Organic Maps are separate projects. No equivalent Organic Maps `DATA_LICENSE.txt` or rebranding clause was found in the inspected CoMaps tree/NOTICE/copyright materials. That is not proof that arbitrary downstream use of community download servers has guaranteed permission, capacity or uptime. Verify download-server expectations before wiring a custom branded build to them. Data licensing and entitlement to free hosted distribution are separate questions. APK distribution and hosted-data access retain their separate third-party obligations. Copying BusTO GPL code into an Apache-based fork requires a deliberate compatible licensing decision for the combined work; do not silently relabel it Apache.

## CoMaps architecture: what can actually be reused

Current source splits an Android app and an Android library `:sdk`. The library builds native `organicmaps` through CMake from the repository root, includes data/assets and Android bindings, and depends on the broader source tree. Build documentation requires recursive submodules, Android SDK/NDK/CMake, and supports an ARM64-only build. No stable independently versioned Maven distribution or contractual third-party SDK API was verified.

Source evidence:

- [`android/sdk/build.gradle.kts`](https://codeberg.org/comaps/comaps/src/branch/main/android/sdk/build.gradle.kts): Android library, native CMake build, NDK 28.2, ABI selection.
- [`MapView.java`](https://codeberg.org/comaps/comaps/src/branch/main/android/sdk/src/main/java/app/organicmaps/sdk/MapView.java): custom `SurfaceView` binds native map rendering and touch/lifecycle handling. This is not a MapLibre map.
- [`RoutingController.java`](https://codeberg.org/comaps/comaps/src/branch/main/android/sdk/src/main/java/app/organicmaps/sdk/routing/RoutingController.java): current Android routing state machine; ultimately calls native engine.
- [`Router.java`](https://codeberg.org/comaps/comaps/src/branch/main/android/sdk/src/main/java/app/organicmaps/sdk/Router.java): enum `Vehicle`, `Pedestrian`, `Bicycle`, `Transit`, `Ruler` and native router selection; no arbitrary provider plugin contract.
- [`Framework.java`](https://codeberg.org/comaps/comaps/src/branch/main/android/sdk/src/main/java/app/organicmaps/sdk/Framework.java): `nativeBuildRoute`, route-progress listener, following information, route steps, transit info. `nativeGetRoutePoints` means selected route waypoints, **not the full route geometry**.
- [`routing_manager.hpp`](https://codeberg.org/comaps/comaps/src/branch/main/libs/map/routing_manager.hpp): `GetRoutePolyline()` available at C++ level; `InsertRoute()` is private. Existing route session and matching logic are native-owned.

Consequences for an implementation plan:

1. Begin with the working whole-app fork and preserve map download, search, current-location lifecycle and walking/driving/biking navigation. Replace the highest-value Android interaction surfaces first (search, place sheet, saved places, route choice), after defining measurable interaction goals.
2. Put GTFS import, service calendars, realtime state and itinerary search behind a separate transit interface. Return a typed itinerary: legs, stops, times, provenance, validity, realtime freshness, and geometries. Avoid forcing scheduled buses into the existing approximate subway route model.
3. Prototype a dedicated transient map-overlay bridge for transit line geometries, stop markers and live vehicles. Native user marks/line rendering provide plausible building blocks, but a convenient Java arbitrary-layer API was not established by this research. Treat JNI/C++ work as required until demonstrated otherwise.
4. Prototype local pedestrian access/egress calculations without corrupting the active turn-by-turn route session. The existing router is session-oriented; many parallel transfer-distance queries are not a demonstrated supported API. A batch walking-network interface or separately prepared transfer graph may be needed.
5. Transit guidance needs its own journey state: leave now, walk to stop, board the correct line/direction, alight, transfer, missed service/replan. Native car guidance cannot be assumed to cover this by accepting a polyline.
6. A new Android application module reusing `:sdk` inside the same checkout is technically plausible and can give broader UI freedom. It also requires reimplementing glue currently owned by `:app`, including onboarding, permissions, downloads and navigation lifecycle. Prove a tiny complete flow before choosing this over incremental UI replacement.
7. A MapLibre frontend plus CoMaps routing is not a clean drop-in alternative: it combines two rendering/data stacks, `.mwm` routing/search data plus vector tiles, additional geometry bindings, and lost native guidance/rendering integration. Only choose it if the benefits justify that cost.

The fork must periodically track upstream rendering, Android permission/API and native security changes. Keep a small seam patch, new transit module and focused UI changes reviewable separately. Avoid modifying the `.mwm` format in the first release: that would couple the fork to a custom map-generation/distribution pipeline.

### Existing GTFS code is not a ready timetable engine

CoMaps source contains [`gtfs_converter.cpp`](https://codeberg.org/comaps/comaps/src/branch/main/libs/transit/world_feed/gtfs_converter/gtfs_converter.cpp), experimental transit data and [`transit_schedule.hpp`](https://codeberg.org/comaps/comaps/src/branch/main/libs/transit/transit_schedule.hpp). The converter produces data for an experimental compiled-map section. However, [`transit_graph.cpp`](https://codeberg.org/comaps/comaps/src/branch/main/libs/routing/transit_graph.cpp) uses half of line frequency as a transfer wait and has an explicit TODO about knowing the exact trip start time to get a more precise headway. A schedule class or GTFS parser in a repository does **not** establish production-quality depart-at/arrive-by, cancellations, after-midnight trips, or GTFS-RT integration. Explore reuse only after correctness tests against actual Turin timetables.

## Google-free Android and privacy findings

CoMaps current Android build links the open-source microG location **client library** rather than proprietary Play location code. Its [`LocationProviderFactoryImpl`](https://codeberg.org/comaps/comaps/src/branch/main/android/app/src/google/java/app/organicmaps/location/LocationProviderFactoryImpl.java) falls back to `AndroidNativeProvider` when Play services are unavailable or disabled; [`LocationHelper`](https://codeberg.org/comaps/comaps/src/branch/main/android/sdk/src/main/java/app/organicmaps/sdk/location/LocationHelper.java) also handles provider downgrade. This does not require installing microG as an OS service. It is source-level evidence for Google-free operation, not a measured device result. Current build properties target/compile Android API 36 and support ARM64.

Organic Maps' current [`app/build.gradle`](https://github.com/organicmaps/organicmaps/blob/master/android/app/build.gradle) uses proprietary Google location integration for web/Google/Huawei flavors and a FOSS flavor for F-Droid; Firebase is conditional for beta builds. Flavor selection matters. Do not generalize one build's dependencies to all builds.

BusTO's inspected source uses MapLibre 12.0.1, Android native components, Room, protobuf and an optional email/dialog crash report path (ACRA); `com.google.*` group names for protobuf, Guava or Material do not mean Google Play Services. Its main manifest still declares phone-state/storage permissions, so auditing/reducing permissions is worthwhile if reusing the app. Its F-Droid non-free-network warning refers to dependence on 5T servers, not proof of advertising surveillance.

OsmAnd's F-Droid page explicitly flags a unique installation identifier sent on map-download requests, non-free artwork/layouts/voices, and Google/upstream components removed by the F-Droid build. [Issue 15058](https://github.com/osmandapp/OsmAnd/issues/15058) is linked by the package. An open-source/F-Droid label does not automatically mean zero identifying requests.

Direct transport calls expose an IP address and requested stops/routes to the operator. Local full-feed processing can reduce query disclosure; it does not make network refreshes anonymous. Measure outgoing requests and disable unnecessary logs/analytics in the selected build. Full offline testing should include downloads already present, network permission denied, and no Google services installed. Android Auto is a separate proprietary integration; core phone navigation should not depend on it.

## BusTO: particularly valuable Turin reference

BusTO's official feature list explicitly includes realtime vehicles, stop-name/number search, location suggestions and favorites; it says users request operator data directly from their own devices. Its May/June 2026 F-Droid release notes mention broken GTFS realtime endpoints and a later restoration of live locations and service alerts. This is concrete evidence to design degraded behavior, stale-data badges and adapter health checks rather than treating a successful HTTP request as reliable service.

Source inspected at commit `80ff75172fe807e0f4d61af1b32fc330f44ee44f`; [`GtfsUtils.java`](https://gitpull.it/source/libre-busto/browse/master/app/src/main/java/it/reyboz/bustorino/backend/gtfs/GtfsUtils.java) declares:

- Static: `https://www.gtt.to.it/open_data/gtt_gtfs.zip` (in `GtfsDataParser.java`).
- Vehicles: `https://percorsieorari.gtt.to.it/das_gtfsrt/vehicle_position.aspx`.
- Trips: `https://percorsieorari.gtt.to.it/das_gtfsrt/trip_update.aspx`.
- Alerts: `https://percorsieorari.gtt.to.it/das_gtfsrt/alerts.aspx`.

The repository also retains older HTTP 5T scrapers and a GTT JSON stop-arrivals adapter. Existence of legacy code does not establish which fallback is operational today. The separate transport-data research should probe official endpoints and current response semantics. BusTO code and its historical experience are useful even if no BusTO code is copied.

## Provider coverage caution: Transportr and Öffi

Transportr's website lists Italy and a Bologna marker, but its inspected current `TransportNetworks.kt` has no Italy-specific country/provider entry. Europe-wide DB/RT entries are not proof of GTT local timetable or realtime coverage. Current build pins a particular `opentransitmap/public-transport-enabler` commit; it does not automatically receive all fixes in Andreas Schildbach's separate [PTE repository](https://github.com/schildbach/public-transport-enabler). PTE's own README says some provider integrations require secrets requested from the provider. A provider abstraction is useful, but a self-contained GTFS router and an online provider adapter solve different problems.

Öffi's official Italy claim should be evaluated with actual Turin stop and journey queries. Its listed integrations with external Google navigation/maps are not a native offline street-navigation engine. Neither app's claimed multi-country coverage should be presented as verified Turin live support.

## Decision experiment before implementation commitment

### Additional requirement: restaurants, stores and businesses

Restaurant and shop discovery requires separate coverage and search benchmarks. Organic Maps already advertises offline map search, and CoMaps explicitly lists restaurants, shops, name/address/category search. OsmAnd similarly lists places and category search. It would be inaccurate to say Organic Maps has no business search, or to promise CoMaps finds more Turin businesses merely because it is a different app.

Diagnose failures in four stages: (1) is the business in the source OSM data, with usable name/brand/category/address tags; (2) did it reach the installed map package; (3) does the local index/tokenization/ranking retrieve it for the benchmark query and map position; (4) does the UI make it discoverable and present useful details. A place missing from OSM cannot be recovered by rearranging the search screen. A correctly indexed place hidden by filters or ranking may require no new external dataset.

Use a fixed, independently verifiable Turin corpus of actual restaurants, chain branches and independent stores, with common Italian spellings, abbreviations, street addresses and categories. Compare current Organic Maps, CoMaps and OsmAnd on identical updated regional data where possible; distinguish exact-name recall, category exploration, distance relevance and opening-hours completeness. No such comparative device benchmark was performed here, so **no measured search superiority is claimed**. The CoMaps latest release adds review ratings in search and fixes some category-language problems; those release notes prove features/fixes, not comprehensive local business coverage. Evaluate place-data enrichment separately before making business-discovery promises.

Sources: [Organic Maps feature list](https://github.com/organicmaps/organicmaps#features), [CoMaps feature list](https://codeberg.org/comaps/comaps/src/branch/main/README.md), [CoMaps October release](https://codeberg.org/comaps/comaps/releases/tag/v2026.10.05-19), [OsmAnd feature listing](https://f-droid.org/en/packages/net.osmand.plus/).

The research supports a short CoMaps-based feasibility phase, with these pass/fail outcomes:

- Build and sideload a self-signed ARM64 Google-free baseline on a supported Android device; verify unchanged offline search and three street navigation modes.
- Prototype the search/place/route-selection interaction without replacing the map renderer.
- Draw one externally computed transit itinerary and mutable vehicle markers through an explicit native overlay seam.
- Compute pedestrian access/egress locally and confirm it does not disrupt the visible journey/session.
- Show schedule-only, fresh realtime, stale realtime and failed-refresh states correctly.
- Demonstrate map package updates under clearly understood licenses and download-service conditions.
- Record cold/warm startup, query latency, memory, battery and storage on the actual device. No source reading can justify performance numbers in advance.

If native seams or the remaining UI coupling make these disproportionately costly, compare an in-tree new Android shell using `:sdk` against MapLibre plus independently selected local search/street/transit engines. A full greenfield Google Maps equivalent remains a much larger program, particularly for place-data quality, address completeness, live traffic, reviews and street imagery; an app fork cannot create missing public data.
