# Online services for an Expo app without API keys

Research date: 2026-10-11. This documents keyless map, search, routing and transit services, their privacy behavior, and their usage limits. Recommendations depend on bounded traffic and provider policies.

## OpenFreeMap: basemap

The [official site](https://openfreemap.org/) and [source README](https://github.com/hyperknot/openfreemap) say the public instance is free, without registration, API keys, cookies or limits on map views/requests. It supplies vector maps and styles; it explicitly does **not** supply geocoding, directions, navigation or satellite imagery. The underlying map data is OpenStreetMap; attribution must remain visible. The site says there is no SLA or personalized support.

The [privacy policy](https://openfreemap.org/privacy/), updated October 8, 2026, explicitly covers the public tile service. Access logs omit IP addresses by default; error logs may include IP/URL and are deleted after seven days. Security investigations can temporarily enable IP logging for up to 30 days. Cloudflare may be used as CDN and has its own processing. Do not equate “no API key” with no network disclosure.

Direct HTTP page reads returned 403 during research, but the official site/privacy policy loaded in a browser. This is not an observed failure of map tiles. Integration instructions: https://openfreemap.org/quick_start/ . Actual native rendering remains a build test.

## Photon: geocoding

The [official README](https://github.com/komoot/photon) documents multilingual OSM search, typo tolerance, location bias, tag/bounding-box filters and reverse geocoding. Its public endpoint is `https://photon.komoot.io`.

The README permits use in projects while request volume remains reasonable, reserves throttling/banning for extensive use, and disclaims availability or change guarantees. This is more appropriate for bounded request volumes than assuming an unlimited hosted service. Debounce, cancel obsolete queries, cap results, cache appropriately and make the provider replaceable. A private instance is possible but adds substantial data/hosting work; it is not the proposed starting point.

A single bounded synthetic query returned HTTP 200 and matching OSM objects. This demonstrates technical access, not comprehensive business discovery. Photon cannot retrieve businesses absent from the data it indexes.

## FOSSGIS public routing: car, bike and foot

The [service overview](https://routing.openstreetmap.de/about.html) documents worldwide car/bike/foot profiles and routing-data updates roughly every two days. This is OSRM route calculation; it does not establish live road traffic, public-transport timetables, navigation speech or route-progress tracking.

Read the [full operator usage policy](https://www.fossgis.de/arbeitsgruppen/osm-server/nutzungsbedingungen/), not only a demo-page example. It applies to routing.openstreetmap.de and valhalla1.openstreetmap.de, among other services. Requirements include:

- Correct source attribution and a link to https://www.openstreetmap.org/fixthemap .
- A User-Agent identifying the actual app; generic library agents and impersonation are insufficient.
- A correct referrer where technically possible; at most two download connections, scripts limited to one.
- Routing at **one request per second maximum**; no mass downloads, high traffic or heavy usage.
- Operator contact information on app websites/store listings where present.
- Services may change, stop or withdraw usage permission; no availability guarantee.

The special prior-consent rule for apps automatically fetching tiles applies to **tile.openstreetmap.de**; it is not stated as a blanket prohibition on routing clients. The selected basemap provider is OpenFreeMap. Commercial use and higher traffic require separate evaluation against the routing operator's terms.

The overview explicitly says submitted start/destination/via coordinates are processed on the server and saved in logs; see [FOSSGIS privacy policy](https://www.fossgis.de/datenschutzerklärung). This is keyless, not local or anonymous routing.

One bounded synthetic walking probe returned HTTP 200 and `code=Ok`, with distance **468.4 metres**, duration **374.8 seconds**, and **six maneuver steps**. The service's profile selection must follow its documented endpoint rather than assuming the generic OSRM path segment identifies the travel mode. This probe did not validate route quality on the ground.

Avoid sending every GPS update to the route server. Compute progress on the existing route locally, and requery only when materially off-route or explicitly requested, with debouncing/backoff. Map matching, spoken guidance and background execution remain app/navigation-engine responsibilities.

## Transit services

See [the earlier transit probes](turin-transit-data.md): GTT static/realtime feeds are keyless; reuse is limited by the documented non-commercial and attribution terms. MATO's GraphQL returned a working itinerary, but public API reuse terms/quotas/SLA remain unverified. Do not present it as an assured long-term planning contract.

Transitous is not an invisible automatic failover; its verified, explicitly invoked role is described below.

## Transitous: rail station boards and explicit stop fallback

Verified 2026-11-01 against the [API policy](https://transitous.org/api/), [privacy policy](https://transitous.org/privacy/), [sources page](https://transitous.org/sources/) and the MOTIS OpenAPI specification linked from the policy ([v2.10.2](https://raw.githubusercontent.com/motis-project/motis/refs/tags/v2.10.2/openapi.yaml); the production server also returned the newer `departureTimestampReason`/`arrivalTimestampReason` fields documented on MOTIS `master`).

**Policy.** Transitous is a volunteer, best-effort MOTIS 2 service for open-source, non-commercial projects. Requirements: published source; an HTTP User-Agent on every request with the application name, client version and a contact (e-mail or website); a visible link to https://transitous.org/sources/ and compliance with the listed source conditions, including OpenStreetMap attribution; coordination in the project's Matrix channel for heavy use. More than about 720 requests per 24 hours of `/plan`, `/one-to-many` or `/one-to-all`, many users and automated requests are the named high-cost cases. Commercial use is not allowed. Staging and internal hosts must not be used by applications.

**Privacy.** Server logs store IP address, request time, requested URL and User-Agent for up to two days. The URL contains whatever the request sends, so the app sends only the selected stop/station/trip identifier or the typed search text plus fixed parameters identical for every user. It never sends the device position, a place bias, language preference or device data. The User-Agent is `AvoidMaps/<version> (+https://github.com/avoid-quest/maps)`.

**Endpoints used** (all `GET https://api.transitous.org`, keyless, JSON):

| Endpoint | Parameters sent | Purpose |
|---|---|---|
| `/api/v6/stoptimes` | `stopId`, `n=12` (arrivals add `arriveBy=true&direction=LATER`; MOTIS otherwise defaults arrivals to `EARLIER`, i.e. past events) | Rail pilot station board |
| `/api/v6/stoptimes` | `stopId`, `n=10`, `radius=0`, `exactRadius=true` | Explicit GTT stop fallback; restricts results to the selected pole |
| `/api/v6/trip` | `tripId`, `detailedLegs=false` | Intermediate stops of a selected trip, without geometry |
| `/api/v1/geocode` | `text`, `type=STOP`, `numResults=8`, fixed Turin box `min`/`max` | Stop search by typed name |
| `/api/v6/map/stops` | ~300 m box around a bundled public stop | Mapping maintenance only |

`/plan` is not used, so the 720/day coordination threshold does not apply to this integration. Requests are serialized with one-second spacing; a 429 blocks the provider queue for 60 seconds; identical requests within 60 seconds of monotonic elapsed time return the cached snapshot (wall-clock corrections neither extend nor shorten it); nothing polls automatically.

**Measured behaviour (one bounded sample each).** Responses took 0.22–0.54 s. Porta Susa returned Trenitalia FR/RV/SFM/ICN departures, several with `realTime=true` and `PREDICTED` times (for example +2 and +7 minutes), plus an SNCF TGV through MOTIS's same-name station equivalence. Porta Nuova returned 20 departures, none with realtime data, which is consistent with predictions starting after a train leaves its origin. A GTT tram stop returned `PREDICTED` and `NO_RT_DATA` rows and one `INCONSISTENT_RT` row whose time MOTIS adjusted while reporting `realTime=false`. No event in the samples was cancelled. Platforms appeared only as `track` without a separate `scheduledTrack`.

**Interpretation rules.** MOTIS publishes no feed or entity timestamp. A `realTime=true` row is therefore labelled “Dichiarato in tempo reale · aggiornamento origine non disponibile”; age is never derived from retrieval time. `NO_RT_DATA` is a timetable time, not punctuality. `INCONSISTENT_RT` or a contradiction between `realTime` and the timestamp reason is unknown. `cancelled`/`tripCancelled` distinguish a skipped stop from a cancelled trip. A `realTime=true` event whose time cannot be parsed is unknown, never silently shown with its timetable time. A `track` without `scheduledTrack` is shown as published, not as a confirmed platform change. Boards drop events whose every known time is more than two minutes before retrieval. The trip-level `realTime` flag of `/trip` describes only the first departure and last arrival; the trip summary is derived from the stops' own timestamp reasons, and the leg flag is kept separately.

**Identifiers.** Transitous GTT stop IDs are `it-Piemonte-Gruppo-Torinese-Trasporti_<GTT stop_id>`, with the GTT `stop_code` as `stopCode`; the fallback derives the ID locally, rejects a response whose stop ID, code or coordinate (150 m) does not match the bundled stop, and drops individual events at any other stop. Rail boards accept events at the station's own ID or at a MOTIS same-station equivalent within 300 m (for example SNCF and Trenitalia France IDs at Porta Susa) and drop the rest. Rail pilot stations use `it-trenitalia_*` IDs verified by one regional `map/stops` request and a `stoptimes` request per station; see `src/data/transitous-rail-stations.json`. Torino Dora, Zappata and San Paolo had no rail stop in Transitous and are excluded.

**Attribution.** The sources page lists both Turin datasets as published by BusOne: “BusOne (https://busone.app) and Trenitalia” (`it_trenitalia.gtfs.zip`) and “BusOne (https://busone.app) and GTT” (`it_Piemonte-Gruppo-Torinese-Trasporti.gtfs.zip`), free only for non-commercial use by individuals, nonprofits and NGOs, with original source terms continuing to apply. Rows from other datasets keep their dataset identifier and refer to the sources page.

**Data quirks.** Ciriè is published as “Ciri” (stop `it-trenitalia_00090` and SFM headsigns). The app corrects only that exact whole string within the Trenitalia dataset and keeps the supplied text. Other names are shown as supplied, including mixed case and abbreviations such as “Torino Reb.Foss.”.

## Optional account-based services

The [HeiGIT/openrouteservice plan page](https://account.heigit.org/info/plans), inspected through its browser-rendered interface, lists a €0 Standard account with 2,000 Directions V2/day and 40/minute, plus 3,000 geocoding/day and 100/minute. Its [terms](https://account.heigit.org/info/tos) require attribution, one account/person, respect for limits and current licences. They prohibit sending personal data outside account management; do not attach personal identifiers or assume a continuous identifiable location-tracking workload is within scope without clarifying that clause. No account/key or live routing request was made.

[Geoapify pricing](https://www.geoapify.com/pricing/) advertises a free plan with 3,000 credits/day, up to five requests/second, no credit card and attribution requirements. Credits are not synonymous with arbitrary requests across every endpoint. No account was created. Coverage/quality and data terms need evaluation before substitution; most OSM-derived search services will retain OSM's underlying gaps.

The benefit of such accounts is usually a documented service interface and quota or additional data, not automatic privacy or perfect reliability. Stay keyless initially; reconsider a specific service only when it solves a measured problem.
