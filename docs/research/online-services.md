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

Transitous is another public-service candidate, but its [API policy](https://transitous.org/api/) requires open-source published applications for ongoing use (with a narrow prototype allowance), identifying requests, attribution, and contact for potentially intensive endpoints including routing. No contact occurred and Turin completeness was not benchmarked. It is not an invisible automatic failover.

## Optional account-based services

The [HeiGIT/openrouteservice plan page](https://account.heigit.org/info/plans), inspected through its browser-rendered interface, lists a €0 Standard account with 2,000 Directions V2/day and 40/minute, plus 3,000 geocoding/day and 100/minute. Its [terms](https://account.heigit.org/info/tos) require attribution, one account/person, respect for limits and current licences. They prohibit sending personal data outside account management; do not attach personal identifiers or assume a continuous identifiable location-tracking workload is within scope without clarifying that clause. No account/key or live routing request was made.

[Geoapify pricing](https://www.geoapify.com/pricing/) advertises a free plan with 3,000 credits/day, up to five requests/second, no credit card and attribution requirements. Credits are not synonymous with arbitrary requests across every endpoint. No account was created. Coverage/quality and data terms need evaluation before substitution; most OSM-derived search services will retain OSM's underlying gaps.

The benefit of such accounts is usually a documented service interface and quota or additional data, not automatic privacy or perfect reliability. Stay keyless initially; reconsider a specific service only when it solves a measured problem.
