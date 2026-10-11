# Current proposal: Expo maps app with online services and local useful data

Updated 2026-10-11. **The selected architecture uses Expo, online services, local data, and keyless providers where available.** The earlier [fork assessment](offline-fork-assessment.md) is superseded. Its technical evidence remains useful.

## Recommendation

**Build an Expo / React Native / TypeScript application using MapLibre React Native, with keyless public services where permitted and versioned local packages for place enrichment and transit lookups. The implemented path uses compact JSON and local AsyncStorage; SQLite remains a measured-scale or update requirement decision. No app fork and no mandatory backend.**

Expo supports rapid development of the map and search interface. MapLibre supplies native map rendering; online services remove the need to build or embed complete road/transit routing engines for the first version. Local favourites, cached information and regional business data improve privacy, responsiveness and resilience without making full offline navigation a requirement.

The earlier fork assessment prioritized retaining mature offline guidance. Expo supports a new interface while online computation reduces the initial native integration work.

Implementation requires prioritization: a strong map/search/transit experience is considerably easier than dependable screen-off spoken navigation. Do not make a custom on-device transit router, a server deployment, or a large data pipeline a prerequisite for the first useful build.

## Proposed stack and service choices

| Responsibility | Proposed default | Why / limitation |
|---|---|---|
| App and interface | Expo, React Native, TypeScript | Fresh UI, reusable Android tooling, local signed APK builds |
| Map rendering | MapLibre React Native | Native renderer; no Google Maps dependency |
| Basemap | OpenFreeMap public vector tiles | No account/key, published free public instance, OSM attribution; no SLA |
| Foreground position | MapLibre Android `default` location engine | Uses Android platform location rather than requiring Play services |
| Address/name geocoding | Photon public service with bounded usage | Keyless, multilingual/typo-tolerant OSM search; best effort and throttling possible |
| Food/shop discovery | Bundled compact Overture package with a local search catalog | Additional listings, category discovery and local query privacy; data quality and source licences still matter; native performance remains a gate |
| Walking/cycling/driving route calculation | FOSSGIS public OSRM routes initially | Keyless profiles, documented usage policy; calculated routes, not live traffic or a navigation SDK |
| Turin realtime | Direct GTT GTFS-RT + prepared static lookup data | Verified anonymous feeds; source/entity freshness and identity handling required |
| Turin door-to-door transit planning | Evaluate direct MATO/5T GraphQL adapter | Actual itinerary response verified; reuse policy and reliable coverage remain a gate |
| Favourites/preferences/diagnostics | Local AsyncStorage | No login/cloud account required; saved favourites currently retain place snapshots |
| Active navigation later | Native location service and navigation component via Expo module | Separate proof needed; route drawing does not establish safe reliable guidance |

These are swappable provider choices, not a requirement to install an elaborate plugin framework. A small typed adapter for each API is sufficient. If a public service becomes unsuitable, replace the adapter rather than rebuild the UI.

**No own server initially.** React Native can call these services directly; browser CORS is not a reason to add a proxy to a native phone app. Do not add a backend solely to hide an API key when the chosen defaults do not use keys. A future server may be justified for centralized data updates or controlled hosting, but it would introduce maintenance and operating costs.

For the local POI/transit data, begin with a developer-generated, versioned Turin package shipped or manually imported with the APK. This is a modest data-preparation step, not running a live backend. Automate convenient package delivery only when the experience is useful.

## Expo and Google-free Android compatibility

MapLibre has official Expo config-plugin support, but needs a **custom native development build**, not Expo Go. Expo supports local compilation and native modules; neither paid EAS builds nor a store listing is necessary. Select a mutually compatible Expo/RN/MapLibre version set and pin it. Declared compatibility is not a substitute for testing the device. [Platform source research](expo-platform.md).

The Android implementation of `expo-location` currently uses Google's fused-location client. Do not assume that the standard Expo location tutorial produces a Google-free app. MapLibre's plugin exposes a separate default engine which is documented as F-Droid-compatible and uses Android platform location. Start with that for foreground maps, nearby places and nearby stops.

For sustained screen-off navigation, verify foreground-service behaviour and consider a small Kotlin Expo module. This is ordinary native integration inside an Expo app, not a reason to abandon Expo. Keep GPS, animation and route-progress work out of unnecessary React rerenders; render pins and lines through native map layers rather than hundreds of React marker views.

This source research did not compile or test an APK. Device validation must establish map rendering, permissions, Google-free location and lifecycle behaviour on supported Android configurations.

## What keyless public services can and cannot provide

OpenFreeMap's official site explicitly offers free public vector maps with no registration, API key or request quota. It does not provide search or routing. Its privacy policy says access logs omit IP addresses by default, but error/security logging and CDN processing can still involve IP addresses. Online maps reveal requested areas to the service; no-account does not mean anonymous. [Service research](online-services.md).

Photon permits reasonable project use of its public demo, with no availability guarantee. Bounded probes demonstrated keyless technical access. Use debouncing, limited results and caching, and retain a provider switch. Do not use OSM's public Nominatim as an unrestricted autocomplete service.

FOSSGIS publishes car, bike and foot routing services and permits third-party use within its rules: identifiable User-Agent, attribution/fix-the-map link, connection limits, no bulk/heavy traffic, and **at most one route request per second**. The routing service warns that submitted locations reach the server and are logged. One synthetic walking request returned a 468.4-metre route with six steps. This demonstrates keyless technical access; it is not a route-quality or uptime benchmark. Avoid rerouting on every GPS update.

The specific prior-consent restriction in FOSSGIS's policy applies to its tile server; the selected basemap provider is OpenFreeMap. Do not mix the two policies or infer that the routing endpoints offer an SLA.

MATO successfully returned an itinerary in the earlier probe, and BusTO uses the same backend. However, a callable application backend is not automatically a documented public API licence. Validate this before depending on it for daily planning. If it is unsuitable, evaluate a permitted public transit service such as Transitous against its published-source/contact requirements, or revisit a small hosted engine. Neither fallback is silently assumed approved or already operational.

Keyless public services can support a **bounded-use first version** within their published policies. It does not provide guaranteed availability. Acceptable degradation, visible errors and a cached selected journey are necessary. Do not promise full offline road routing when the route engine is remote.

## Business search remains a first-class requirement

Expo fixes neither incomplete OSM coverage nor poor business ranking automatically. Evaluate independently sourced records against documented coverage and search cases. A small local index can combine names, brands, Italian category aliases, coordinates and available contact information. Merge search results with provenance-aware duplicate handling.

Examples worth supporting include “dove mangiare”, “hamburger”, “wine bar”, “supermercato”, “abbigliamento” and exact business names. An OSM bar/fast-food category may satisfy a broad food query. Distinct tenants must not become one business merely because they share an address.

Independent place-data enrichment can improve some missing results while retaining coverage gaps. Do not fabricate ratings, “open now” or completeness. Opening hours require actual hours data; Overture's operating status is not an opening-hours schedule. [Evidence](place-search-sample.md), [data sources](place-discovery.md), [reproducible probe](place-data-probe.md).

## Turn-by-turn navigation needs its own decision

Online route APIs return geometry and maneuver information. The app still needs route progress, map matching, spoken prompts, off-route detection, bounded rerouting, screen-off positioning and lifecycle recovery. These are not supplied by Expo or MapLibre alone.

Ferrostar is a relevant open-source navigation component, but its React Native integration is not a verified stable install-and-use solution: the official maturity page marks it pre-alpha, and the three package names in its current RN guide returned npm 404 during inspection. Native Android components or a pinned source integration may be usable; prove that separately. Do not copy a tutorial assuming a published RN SDK exists. [Detailed evidence](expo-platform.md).

This does not require abandoning the full-featured goal. It prevents a nice route preview from being mistaken for completed driving navigation. Start with route planning and clear directions, then explicitly complete guidance.

## Build sequence

1. **Prove the platform.** Produce a locally built Expo APK with MapLibre/OpenFreeMap, foreground platform location, permission-denied/manual search behaviour, and one successful keyless search/route/transit call. Test without Play services in the app's profile.
2. **Build the main everyday flow.** Place/category search, local enrichment, a useful place sheet, favourites, map/list interaction, and walk/bike/car route previews. Compare search and place-selection flows against documented acceptance cases.
3. **Integrate useful transit.** Nearby stops, line/direction information, live arrivals, relevant alerts, and door-to-door plans if the provider gate passes. Preserve scheduled/live/stale distinctions and cache the selected itinerary.
4. **Complete active guidance.** Prove foreground-service location and a navigation component, voice behaviour, rerouting, wrong-turn recovery, background operation and battery use. The final app remains Expo even if this part needs native code.
5. **Harden and extend.** Provider outage/quota handling, updated data packages, signing/upgrades, regional rail validation and additional cities. Add offline capabilities where daily use demonstrates their value.

The first milestone is a small working app, not a fork or an embedded routing-engine port. No nigiri/OTP/MOTIS deployment is required for this proposed starting point.

## When an account/key would actually help

Evaluate these optional services only when a benchmark establishes a concrete benefit:

- **Openrouteservice/HeiGIT:** a documented free account/key gives published routing/geocoding allowances (observed 2,000 directions/day and 40/minute). This offers a clear integration contract/quota, not Google traffic or better business listings by itself.
- **Geoapify:** one free account/key could consolidate geocoding, places and routing; the advertised free quota was 3,000 credits/day with no credit card. It is primarily OSM-derived and will not automatically fix missing businesses.
- **Foursquare OS Places:** developer-time portal access could add independently sourced businesses beyond Overture if a local comparison demonstrates that benefit. No phone account or location SDK is inherently required to consume a downloaded dataset.
- **Commercial place/traffic services:** only reconsider if measured coverage/traffic capability is valuable enough to justify proprietary-service privacy and quota terms. A free tier is not permission to clone the provider's data or a guarantee of indefinite free service.

No accounts were created, keys obtained, paid services enabled or backend provisioned. The architecture is now implemented in a public Expo application with signed releases, map/search, bundled place data, local favourites, road/transit planning, GTT stop information and local diagnostics. Released 0.1.5 replaces the small discovery sample with a wider bounded food/shop extract, compatibility supplements and documented source corrections. Shared dictionaries and materializing details only for selected results reduce desktop package/index cost; that evidence does not establish native startup, typing latency or memory. Shipped lookups use bundled JSON and local preferences/favourites/diagnostics use AsyncStorage; adopt SQLite when measured dataset scale or update requirements justify migration. The [data workflow](../development/data.md) records provenance, reproduction and acceptance limits. The research probes above retain their original limits and do not establish complete business coverage, device behaviour, provider reliability or permission to reuse MATO indefinitely. Current capability gaps and acceptance criteria live in [the roadmap](../development/roadmap.md); versioned APK and native evidence live in [delivery](../development/delivery.md).

## Supporting evidence

- [Expo/MapLibre/location/navigation feasibility](expo-platform.md)
- [Keyless online services, policies and live probes](online-services.md)
- [Turin transit sources](turin-transit-data.md)
- [Business discovery and coverage sample](place-discovery.md)
- [Google-free Android platform/privacy considerations](android-privacy.md)
- [Engine alternatives, if later needed](routing-components.md)
- [App-foundation comparisons](app-foundations.md), retained as reference; a direct fork is no longer proposed
