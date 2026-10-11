# Turin, Piedmont and Italy transit data: verified research

Research date: **2026-10-11**. Endpoint probes were bounded anonymous HTTPS requests; the three GTT real-time feeds were sampled once at about **13:29 UTC / 15:29 Europe/Rome**. Counts below describe that snapshot, not guaranteed coverage, uptime or prediction accuracy. Large downloads stayed outside the repository. This note evaluates regional transit sources for an Android application with local data processing and direct public-data access; each source retains its documented usage terms.

## Findings that affect the decision

1. **A useful Turin transit system is feasible without a paid API or a hosted server.** GTT supplies directly downloadable static GTFS plus three working GTFS-Realtime feeds: predicted arrivals, vehicle positions and service alerts. Anonymous requests succeeded, and sampled predictions joined perfectly to the same day's static timetable. This is substantially more useful than merely finding bus dots on a map. [GTT static][gtt-static], [trip updates][gtt-tu], [vehicles][gtt-vp], [alerts][gtt-sa]
2. **Do not confuse public accessibility with unrestricted open licensing.** GTT's current first-party license says **non-commercial use only**, requires attribution, and promises neither reliability nor continuing access. Reuse requires compliance with those non-commercial and attribution terms. An older Transitland record says CC-BY-4.0, while MobilityData links the current GTT terms; retain the discrepancy and use the current first-party terms conservatively. [GTT license][gtt-license], [Transitland record][atlas-gtt], [MobilityData record][mdb-gtt]
3. **GTT does not solve all rail or all Piedmont.** The actual GTT static snapshot has no `route_type=2` rail route despite containing an agency named “GTT Servizio Ferroviario.” It does have metro M1, bus, tram and a type-7 route. No metro real-time entity appeared in the sample; metro real-time support remains unproven. [GTT static][gtt-static]
4. **A current-looking regional feed can be unsuitable for navigation.** The official Piemonte bus catalog explicitly says its contract-planning export is **not recommended for infomobility**, because it omits temporary service changes, can aggregate nearby stops, can list only main stops, and excludes Turin urban services and some smaller contracts. The “updated” catalog date is not the timetable publication date. [Piemonte bus catalog][pie-bus-catalog]
5. **Italy-wide rail deserves a separate proof of concept, not an assumption of impossibility.** The official CCISS National Access Point now exposes a national Trenitalia NeTEx dataset. Its anonymous gzip download worked; the XML header was published 2026-10-05 and declared validity 2026-10-03–2027-06-12. Importing the Italian NeTEx profile, auditing completeness and resolving ambiguous license metadata remain work. This is static data; it establishes no national real-time API. [NAP Trenitalia][nap-treni], [NAP asset][nap-treni-asset]

## GTT: endpoints, payloads and practical quality

### Static timetable

`GET https://www.gtt.to.it/open_data/gtt_gtfs.zip` returned HTTP 200, approximately 11.7 MiB compressed, without a key or account.

Inspected ZIP contents:

- `feed_info.txt`: version **20261011**, start **20261010**, end **20270131**; publisher GTT, language Italian.
- **215 routes**: 204 type 3 (bus), 9 type 0 (tram), 1 type 1 (metro), 1 type 7 (funicular).
- **7,052 stops**, **32,436 trips**, **269 calendar rows**, **12,504 calendar exceptions**.
- Both calendar and exception date ranges reached **2027-01-31**. This is a global range, not proof that each route runs through that date.
- Four agency records: urban, extraurban, tourist and railway. Agency names alone do not establish operational coverage.
- M1 is route `METROU`, described as Fermi–Bengasi. No type-2 railway route exists in this snapshot.
- ZIP includes shapes, stop times, fares-v1 tables, wheelchair fields and some GTT-specific extra files. Presence of a fare or accessibility field does not certify that all tickets or all station accessibility conditions are modeled accurately.
- Example identifier mismatch that an importer must respect: static `stop_id=6` has public `stop_code=10`. Never join prediction data using the printed stop code by assumption.

Source: direct inspection of [GTT's ZIP][gtt-static]. SHA-256 of the inspected file: `c9bce9ef574521f5091d889bc9c5f3f5a1bd4247b62d1fd91746f9752e15e4c1`.

### Real-time availability and sample

All returned HTTP 200 with `application/octet-stream`, protobuf GTFS-RT **2.0**, `FULL_DATASET`, no credentials, and `Cache-Control: no-cache`. HTTPS works even though some registries still publish HTTP links.

| Data | Actual working endpoint | Sample size / entities | Header timestamp UTC |
|---|---|---|---|
| Predicted arrivals | `https://percorsieorari.gtt.to.it/das_gtfsrt/trip_update.aspx` | 49,497 bytes; 264 trip updates | 2026-10-11 13:29:49 |
| Vehicle locations | `https://percorsieorari.gtt.to.it/das_gtfsrt/vehicle_position.aspx` | 20,650 bytes; 247 vehicles | 2026-10-11 13:29:48 |
| Disruptions / alerts | `https://percorsieorari.gtt.to.it/das_gtfsrt/alerts.aspx` | 152,420 bytes; 146 alert entities | 2026-10-11 13:29:48 |

Sources: direct [trip][gtt-tu], [vehicle][gtt-vp], [alert][gtt-sa] payloads; interpretation checked against the [official protobuf schema][gtfs-proto].

**Predictions are real stop-level data.** All 264 trip IDs matched the static ZIP. Across their **1,697 StopTimeUpdates**, all 1,697 used `stop_sequence`, none contained `stop_id`, all contained an arrival event and none a departure event. Every `(trip_id, stop_sequence)` matched `stop_times.txt`. The trip descriptors omitted route IDs in this sample, so route information also requires a static join. These fields allow arrival boards and delay-aware trip planning; extrapolating vehicle coordinates is unnecessary for basic ETAs.

**Feed freshness is not entity freshness.** TripUpdate timestamps ranged from **1 to 1,758 seconds** behind the feed header; **118/264 exceeded 120 seconds** and **74/264 exceeded 300 seconds**. An older entity may be a retained/completed trip; this does not alone prove a bad prediction. It does mean that “HTTP succeeded just now” cannot justify calling every displayed result live. Apply freshness to relevant upcoming events and expose stale/unknown status. Vehicle timestamps were **37–286 seconds** behind the header, with four over two minutes.

**Vehicle-to-trip matching is incomplete.** 214/247 vehicle entries had a trip ID and all 214 matched the ZIP; **33 had no trip ID**. A vehicle can still be shown with the available route/location data, but must not silently become a trip-specific ETA. The schema explicitly allows partially identified vehicle trips.

**Alerts are useful but not universally joinable.** The sample includes an Italian textual diversion for line 17 on **12 October**, demonstrating that future planned disruptions are mixed with other messages. Of **8,840 stop references**, **8,744** matched static stop IDs; of **150 route references**, **147** matched static route IDs. These are reference counts, not distinct-stop counts. An alert may reference an obsolete or otherwise absent stop/route; retain its human-readable content and avoid dropping the entire alert because one reference fails. Evaluate its active period instead of marking every returned alert as currently active.

**Coverage is not proven by a single Sunday sample.** All sampled trip updates belonged to urban-suffixed route IDs. No metro trip update or metro vehicle was present. This research did not establish realtime coverage for extraurban services, every tram/bus route, metro, replacement buses, or railway operators. This research did not measure prediction accuracy against real observed arrivals.

### Licensing, service guarantees and operating cost

[GTT's first-party license][gtt-license] explicitly permits non-commercial academic, educational and civic uses, requires:

> Data source: GTT S.p.A. – Gruppo Torinese Trasporti

and a link to `https://www.gtt.to.it`. It prohibits commercial uses, including paid services and advertising-based applications, without prior written authorization. It allows suspension or modification without notice and provides the dataset as-is. It is not a standard unrestricted open-data license.

The GTT page says “GTFS dataset”; the [MobilityData realtime records][mdb-rt] link the same license for all three feeds. This is the best located licensing trail for those endpoints, but the first-party page does not enumerate their URLs. Preserve that provenance if later redistribution or a different business model is contemplated.

The [Transitland GTT record][atlas-gtt] instead points at Torino catalog CC-BY-4.0 entries. Direct attempts to read the old `aperto.comune.torino.it` catalog and CKAN API returned HTTP 403 during research. Do not silently select the more permissive catalog label. Record this discrepancy and apply the current first-party terms conservatively.

No published request-rate quota or SLA was established from the located first-party material. Anonymous availability in this sample is evidence of technical access, not permission to poll without bounds. A prudent initial design is foreground-only bounded refresh, backoff, conditional static downloads where supported, slower alert refresh than arrivals, and no always-on background location/vehicle polling. Exact intervals are implementation defaults to tune with provider guidance and field testing, not documented provider limits.

## MATO / Muoversi a Torino / 5T

### Working query endpoint, broader coverage

BusTO uses:

`POST https://mapi.5t.torino.it/routing/v1/routers/mat/index/graphql`

An anonymous JSON GraphQL request succeeded on 2026-10-11:

```graphql
query {
  feeds {
    feedId
    agencies { gtfsId name url }
  }
}
```

Returned feeds included:

- `gtt`: GTT agency records.
- `2`: Trenitalia.
- `3`: Arriva Italia.
- `4`: multiple Piedmont operators, including Bus Company, GrandaBus, Giors, SAV, SAC, Autolinee Acquesi, Allasia and others.

A second bounded query `routes(feeds:["2"]) { gtfsId shortName longName type }` returned **REG, RV, SFM, IC, ICN, FR**, and rail-replacement BUS route categories. This confirms actual loaded rail data, including an SFM category, but does not establish train-by-train completeness, static-feed download rights, or rail real-time support.

A third bounded anonymous query also confirmed **actual journey planning**, not just feed listings. Using synthetic public locations near Porta Susa and Bengasi for 2026-10-11 16:30 returned HTTP 200 and one 1,513-second itinerary: walk 83 seconds → SFM rail Porta Susa–Lingotto 420 seconds → walk 1,010 seconds. All legs reported `realTime=false`, with zero delay fields. Those zero values are not evidence of on-time live rail; the `realTime` flag governs interpretation. This one journey proves that the backend can return a usable rail/walk plan, not that its routing is complete or optimal. The exact read-only query was:

```graphql
query {
  plan(
    from: {lat: 45.0729, lon: 7.6664}
    to: {lat: 45.0122, lon: 7.6516}
    date: "2026-10-11"
    time: "16:30:00"
    numItineraries: 1
  ) {
    itineraries {
      duration
      legs {
        mode duration realTime departureDelay arrivalDelay
        route { shortName }
        from { name }
        to { name }
      }
    }
  }
}
```

The official [MATO web application's][mato] public HTML identifies its Digitransit platform and includes OTP configuration. It also contains analytics integrations. A native app can call narrowly selected APIs directly, not embed the website and thereby inherit its entire tracking/network behavior.

The [BusTO source][busto-mato] implements stops, patterns, lines, scheduled/realtime stop arrivals and trip details with this GraphQL endpoint, supplying content type and normal HTTP headers, not a secret token. Its [MQTT client][busto-mqtt] also connects to `wss://mapi.5t.torino.it/scre` with route subscriptions for live vehicles. The official MATO page's own configuration references the same broker. MQTT was **not** opened during this research; current broker access, allowed usage and rate behavior were not verified.

**Classification:** a publicly callable first-party application backend, with a working open-source consumer, but no independently verified general-purpose public API contract, quota, SLA or reuse license located here. It is a useful optional adapter/fallback and a reference oracle; it is a weaker foundation for guaranteed reliability than a documented feed contract. Availability, licensing and dependence on upstream implementation must be resolved before making it the sole route-planning system. Sending origin/destination to MATO discloses them to 5T; city-wide GTT downloads do not need to contain those coordinates.

### The published 5T “open data” page is not a transit license blanket

The official [Muoversi a Torino open-data page][mato-open] says the listed city datasets are IODL v2.0 and currently lists parking availability, traffic flows and ZTL boundaries/access times. It reserves the right to change/suspend service. **Do not apply that page's license automatically to the separate GraphQL/MQTT transit backend.** It can nevertheless support future parking/traffic/ZTL features when their individual schemas and coverage are assessed.

### BusTO as integration evidence

Research inspected the read-only [GitHub mirror][busto] at commit `80ff75172fe807e0f4d61af1b32fc330f44ee44f`, dated **2026-10-09**, “Release new version 2.6.6”; its authoritative project points to [gitpull.it][busto-upstream]. This is current maintained integration evidence, not an abandoned snippet.

Relevant source paths:

- `backend/gtfs/GtfsUtils.java`: three GTT realtime URLs.
- `backend/gtfs/GtfsDataParser.java`: GTT static ZIP.
- `backend/mato/MapiVolleyRequest.java`, `MatoQueries.kt`, `MatoAPIFetcher.kt`: MATO GraphQL queries.
- `backend/mato/MQTTMatoClient.kt`: broker and subscriptions.
- `backend/GTTJSONFetcher.java`: GTT website `palina.getTransitiOld` integration.
- `backend/FiveTScraperFetcher.java` and `FiveTStopsFetcher.java`: older HTML/HTTP integrations.

Do not choose HTML scraping or those historical cleartext endpoints as the primary path when the standard HTTPS feeds already work. BusTO code is generally GPL-3.0-or-later according to the inspected source headers; adopting its source requires the corresponding source-license review, distinct from transit-data licensing.

## Piedmont: current static data and BIP pitfalls

### Regional bus GTFS

The current official [catalog record][pie-bus-catalog] points to [this ZIP][pie-bus]. Its catalog description explicitly states:

- It excludes Turin urban services and some minor contracts.
- Stop points may be aggregate “Nodi Omnibus,” positioned at a centroid rather than the actual pole.
- Trips may contain only the principal stops.
- Geometry can be calculated over a simplified road graph and may not exactly follow the bus.
- It reflects contractual operating programs managed by AMP/5T and published through CSI.
- Updates reflect structural changes; temporary service changes are absent.
- **“l’uso del file non è consigliato per servizi di infomobilità.”**

The anonymous download returned HTTP 200. A bounded 50,000,000-byte inspection fully decompressed the ZIP's metadata/calendar entries (and stopped before the complete archive ended). `feed_info.txt` says version **20260919**, validity **20260101–20261231**; the 802 calendar rows and 29,384 exception rows agree with a 2026 range. `agency.txt` has 16 agencies. `licence.txt` explicitly says **CC BY 4.0**.

Meanwhile, the catalog reported `dataModified=2026-10-10T23:00:00Z`, `metadataModified=2023-01-17`, and daily update rate. These facts coexist: catalog modification, file generation, and timetable validity are different concepts. The file is not “September-only”; neither is it evidence of yesterday's operational changes.

The [old regional bus dataset ending `_5186`][pie-old-bus] explicitly says **updated January 2020 / pre-COVID** and points users to the newer dataset. It still appears in search engines and older registries. Avoid it.

### Regional rail GTFS

The official [rail catalog][pie-rail-catalog] says it covers region-subsidized Trenitalia services, excludes other operators and non-subsidized services such as high-speed trains, derives from RFI data and is nominally updated weekly.

Its [direct ZIP][pie-rail] returned HTTP 200 anonymously, **98,013 bytes**. Actual contents:

- `feed_version=20260824`, valid **20260824–20261212**.
- **192 trips, 74 stations, 48 route IDs**, one Trenitalia agency.
- `calendar.txt` is empty; service exceptions are in `calendar_dates.txt` with dates **20251214–20261212**.
- The inspected route descriptions include Torino–Milano, Torino–Genova, Torino–Cuneo and others, but these small counts do not establish complete suburban/SFM coverage.
- ZIP `licence.txt` says **CC Attribution 2.5 Italy**, while the current catalog says **CC BY 4.0**. Preserve both attributions and clarify this version discrepancy if necessary; do not erase the embedded license.

The catalog again reported `dataModified=2026-10-10T23:00:00Z`, which is newer than the actual August feed version. Thus a daily catalog timestamp is not an adequate freshness signal.

### BIP is not automatically a live feed

The present [BIP website][bip] is a ticketing/card portal. The historical `/open-data/` path returned the same SPA shell, not verified developer data documentation. The modern NAP offers Piemonte assets and lists 5T as a partner (see below). Historic “BIP open data” references are leads; they do not by themselves prove a current downloadable API, authenticated access arrangement or live transport stream.

## National Access Point and national rail

The European Commission's [NAP directory][eu-nap] points Italy to CCISS. The working public multimodal entry point is [CCISS NAP MMTIS][nap], which explicitly describes **NeTEx** static data, **SIRI** data exchange, regional access points and provider participation. The portal lists Piemonte, Trenitalia, Italo, FlixBus and many regional providers. This describes an exchange/catalog framework, not a verified unified nationwide journey-planning or realtime API.

Public [Piemonte dataset search][nap-pie] returned NeTEx levels 1–4. For example the [Piemonte Trenitalia asset][nap-pie-rail] was last validated **2026-02-18**, despite being labeled valid by the portal. Schema validation status is not timetable currency.

More promising: [Trenitalia's national dataset][nap-treni], created January 2026, has [asset 1080596][nap-treni-asset], “IT-IT-TRENITALIA - Profilo NeTEx (Italia) livello 1.” Metadata:

- Imported 2026-10-06; last validation 2026-10-06; revision 61.
- “Up to monthly” at dataset level.
- Anonymous [validated gzip download][nap-treni-download] succeeded without login.
- Decompressed XML header: `PublicationTimestamp=2026-10-05T15:07:02Z`, `FromDate=2026-10-03T00:00:00+02:00`, `ToDate=2027-06-12T23:59:59.999+02:00`.
- Contains a Torino Porta Susa stop place. Inspection was bounded to an initial XML prefix and then the first **64 MiB uncompressed**; it did **not** validate the entire asset or establish all service journeys/timetable completeness. Do not interpret “L1” or metadata categories as a tested working routing dataset.
- License enum says literally **“No licence – No contract.”** This should not be translated into CC0, unrestricted redistribution, or an established prohibition. Resolve applicable portal/provider terms for the intended use before making it a required distributed resource.

This is a worthwhile no-fee rail ingestion candidate. Its size, Italian profile semantics, changing IDs, calendar rules and actual timetable content need a separate import and sampled-route comparison. A desktop build step can generate a compact on-device timetable without requiring a permanently running or paid server. Confirm that the source terms permit the chosen redistribution path.

No first-party freely reusable nationwide **live rail** API/GTFS-RT/SIRI endpoint was verified in this research. Do not treat a public ViaggiaTreno webpage or an unofficial reverse-engineered API library as an SLA-backed open data contract. They can be investigated separately if live regional trains become an acceptance criterion. Likewise, a reference to SIRI on the NAP home page does not prove a current Piemonte or Trenitalia SIRI feed is exposed anonymously.

## Proposed data architecture and validation gates

These are engineering recommendations derived from the observations, not guarantees from providers.

1. **Build the first Turin feed path around GTT GTFS + GTFS-RT.** Import the static schedule transactionally on device or prepare a compact package on a workstation. Keep the last known-good schedule. Namespace IDs per provider, pin real-time joins to a known static revision, and update static data when matching deteriorates.
2. **Keep all ordinary user state local.** Search history, saved locations and favorite stops need no account or analytics. Whole-city realtime downloads reveal IP and access time to GTT, but require neither GPS coordinates nor destination. Direct third-party routing queries reveal more; make that tradeoff explicit in settings.
3. **Represent scheduled, predicted, stale and unavailable separately.** No realtime entity means “no prediction,” not “on time” and not “cancelled.” Do not turn a bus's coordinates into a certified arrival estimate. Unmatched data must degrade visibly and safely.
4. **Separate vehicle positions, arrival predictions, alerts and route geometry.** Textual diversions do not automatically provide a replacement route geometry suitable for navigation. Do not redraw a detour by guessing.
5. **Poll only the needed signals while in use.** Stop boards need trip updates; vehicle-map mode additionally needs positions; alerts generally need a slower cadence. Use bounded retries/backoff and cancel jobs when screens/background states no longer need them. No push service or Google Play service is required merely to fetch these HTTPS feeds.
6. **Prove metro and railway coverage independently.** Start with published schedules and clear live-data absence. Use MATO as an optional reference or explicitly enabled remote adapter; evaluate national Trenitalia NeTEx for offline rail. Do not merge the contractual Piemonte bus feed into trustworthy directions without route-specific validation.
7. **Run meaningful fixtures and field acceptance checks.** Cover current/next-day schedules, after-midnight times above 24:00, Europe/Rome DST, holiday/school calendars, cancellations, unmatched stop IDs, missing trip IDs, stale predictions, failed downloads, and offline fallback. On-device field comparisons should include fixed Turin route cases, a bus/tram transfer, M1, and a Porta Susa/airport railway journey.
8. **Maintain an explicit source manifest.** For each provider: exact URLs, license text/date, attribution, payload revision, validity window, coverage, supported RT types, polling configuration and health. Register new Italian cities as separate adapters/data packages. A country-wide download button must not imply country-wide realtime or uniform data quality.

Acceptance before calling this reliable: sampled live predictions match the physical stop and direction, transfers use actual pedestrian access rather than stop-centroid distance alone, invalid/currently unavailable data never appears as confirmed live, and a week's daily journeys work under network interruptions without retaining misleading predictions. The precise test period and prediction-error targets should be chosen against a documented journey corpus; one successful HTTP sample cannot settle them.

## Sources

All links accessed or source-inspected 2026-10-11 unless a different date is explicitly identified above. Registry entries are used to discover primary URLs and expose discrepancies, not override publisher terms.

[gtt-static]: https://www.gtt.to.it/open_data/gtt_gtfs.zip
[gtt-tu]: https://percorsieorari.gtt.to.it/das_gtfsrt/trip_update.aspx
[gtt-vp]: https://percorsieorari.gtt.to.it/das_gtfsrt/vehicle_position.aspx
[gtt-sa]: https://percorsieorari.gtt.to.it/das_gtfsrt/alerts.aspx
[gtt-license]: https://www.gtt.to.it/gtt_gtfs_license.html
[gtfs-proto]: https://github.com/google/transit/blob/master/gtfs-realtime/proto/gtfs-realtime.proto
[atlas-gtt]: https://github.com/transitland/transitland-atlas/blob/master/feeds/gtt.to.it.dmfr.json
[mdb-gtt]: https://github.com/MobilityData/mobility-database-catalogs/blob/main/catalogs/sources/gtfs/schedule/it-piedmont-turin-gruppo-torinese-trasporti-gtfs-2687.json
[mdb-rt]: https://github.com/MobilityData/mobility-database-catalogs/blob/main/catalogs/sources/gtfs/realtime/it-piedmont-turin-gruppo-torinese-trasporti-gtfs-rt-tu-2695.json
[mato]: https://mato.muoversiatorino.it/
[mato-open]: https://www.muoversiatorino.it/it/open-data/
[busto]: https://github.com/valerio-bozzolan/bus-torino/tree/80ff75172fe807e0f4d61af1b32fc330f44ee44f
[busto-upstream]: https://gitpull.it/source/libre-busto/
[busto-mato]: https://github.com/valerio-bozzolan/bus-torino/blob/80ff75172fe807e0f4d61af1b32fc330f44ee44f/app/src/main/java/it/reyboz/bustorino/backend/mato/MatoQueries.kt
[busto-mqtt]: https://github.com/valerio-bozzolan/bus-torino/blob/80ff75172fe807e0f4d61af1b32fc330f44ee44f/app/src/main/java/it/reyboz/bustorino/backend/mato/MQTTMatoClient.kt
[pie-bus-catalog]: https://www.dati.piemonte.it/catalogodetail/regpie_ckan_ckan2_yucca_sdp_smartdatanet.it_Servizioprogrammatodeltrasportopubblicoregionepiemonteautobus_22942
[pie-bus]: https://api.smartdatanet.it/api/Servizioprogrammatodeltrasportopubblicoregionepiemonteautobus_22942/attachment/22941/1/GTFS_BUS_IT_PIE.zip
[pie-old-bus]: https://www.dati.piemonte.it/catalogodetail/regpie_ckan_ckan2_yucca_sdp_smartdatanet.it_ServizioProgrammatoDelTrasportoPubblicoRegionePiemonteAutobus_5186
[pie-rail-catalog]: https://www.dati.piemonte.it/catalogodetail/regpie_ckan_ckan2_yucca_sdp_smartdatanet.it_ServizioProgrammatoDelTrasportoPubblicoRegionePiemonteTreniRegionali_5188
[pie-rail]: https://api.smartdatanet.it/api/ServizioProgrammatoDelTrasportoPubblicoRegionePiemonteTreniRegionali_5188/attachment/5187/1/GTFS_RAIL_IT_PIE.zip
[bip]: https://www.bip.piemonte.it/
[eu-nap]: https://transport.ec.europa.eu/transport-themes/smart-mobility/road/its-directive-and-action-plan/national-access-points_en
[nap]: https://www.cciss.it/nap/mmtis/public/static/multimodal
[nap-pie]: https://www.cciss.it/nap/mmtis/public/catalog/Dataset?query=Piemonte&maxRows=25
[nap-pie-rail]: https://www.cciss.it/nap/mmtis/public/catalog/Asset/194547
[nap-treni]: https://www.cciss.it/nap/mmtis/public/catalog/Dataset/1077621
[nap-treni-asset]: https://www.cciss.it/nap/mmtis/public/catalog/Asset/1080596
[nap-treni-download]: https://www.cciss.it/nap/mmtis/public/api/v1/download/blob/Asset/1080596/checkedResource
