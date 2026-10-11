# Restaurant, shop, and business discovery

Research date: 2026-10-11. Restaurant and shop discovery requires testing data coverage and search behavior independently of transit. Sources below were read directly; no Google business data was scraped or copied into a proposed dataset in this research.

## What would actually improve the current experience

A different map renderer cannot create missing businesses. Search can fail because the place is absent from the data, the offline map package is old, the name/category is normalized badly, the app limits the search area, or ranking hides the match. These require different fixes.

The strongest no-recurring-fee, on-device path is:

1. Preserve the existing offline app's OSM map, address/POI search, road routing, and navigation.
2. Build a **separate local place index** from a bounded Overture Places extract, alongside the app's map files (for CoMaps, alongside `.mwm`, not by immediately modifying the entire map-generation format).
3. Search both indexes and merge results locally with source IDs, provenance, category mappings, duplicate handling, and freshness visible where relevant.
4. Consider the full Foursquare OS Places dataset only if a measured benchmark shows useful additional local coverage and its current token-based download workflow is acceptable.

This is a proposed architecture, not an existing CoMaps plugin proven in this research. Overture's data and regional extraction are verified. Actual Turin recall must be measured; worldwide record counts are not evidence that a specific restaurant or shop is present.

## Sources and their practical tradeoffs

| Source | Useful contribution | Access / license | Important limits |
| --- | --- | --- | --- |
| OpenStreetMap | Base geography, addresses, shops, restaurants, opening hours/cuisine/accessibility where contributed | Region extracts, ODbL, attribution | Uneven completeness and update lag in app packages; changing OSM search software does not add absent places |
| Overture Places | Independently sourced business/POI records, names/categories/contact/address data, persistent identity | Monthly public GeoParquet, geographic extraction; source-dependent CDLA-Permissive-2.0 / Apache-2.0 / CC0 | Duplicates, junk, incomplete attributes; confidence is not “open now”; no promised Google-like reviews |
| Foursquare OS Places | Additional independent business records, category IDs, contact data, refresh/closed dates and quality flags | Apache-2.0 + NOTICE; current portal requires account/access token for Iceberg queries | Current bulk access workflow changed; no anonymous old-S3 feed observed; local coverage and current update cadence unmeasured |
| AllThePlaces | Store-locator data from businesses, especially chains | Published downloads, CC0 data, MIT crawler code | Coverage depends on supported business websites; often overlaps Overture/Foursquare |
| Geoapify Places | Convenient hosted OSM-based POI category/location queries | Free quota, API key; permits storing/redistributing results with attribution | Primarily OSM, so may improve querying without fixing missing businesses; search context leaves phone |
| TomTom Places Search | Commercial-source search/discovery, optional coverage comparison | Published free monthly API allowances with account/key | Proprietary service/data terms, online dependency, no demonstrated right to make an offline dataset |
| HERE | Commercial place search ecosystem | Free-start marketing verified; current quota details not established here | Requires separate terms/quota/privacy validation; not an offline open dataset |

## Overture Places: verified, suitable to benchmark first

The [current official Places guide](https://docs.overturemaps.org/guides/places/) gives the September 2026 release as **2026-09-23.1**, with roughly 81 million worldwide records and monthly updates. Most are from Meta; other sources include Microsoft, Foursquare, BrightQuery, AllThePlaces, and several providers. Crucially, the guide says **the places theme contains no OpenStreetMap data**. This makes it a meaningful complementary dataset, rather than another query service over the same OSM records.

Source-specific licenses are documented in the [attribution page](https://docs.overturemaps.org/attribution/): CDLA-Permissive-2.0 for several contributors, Apache-2.0 for Foursquare, CC0-1.0 for AllThePlaces. Do not assign the licenses from Overture's OSM-derived transportation/base themes to all places records, and do not assume one license covers all Overture themes.

The current [place schema](https://docs.overturemaps.org/schema/reference/places/place/) contains:

- Point geometry, ID/GERS identity, version, source records.
- Names, `basic_category`, and structured `taxonomy`.
- `operating_status` and `confidence`.
- Websites, social URLs, emails, phones, brand, addresses, where supplied.

**Schema migration:** the older `categories` property was removed in the September 2026 release. New queries should use `taxonomy.primary`, `taxonomy.hierarchy`, and `basic_category`. Many older tutorials will fail or silently omit data if copied without checking the actual schema.

The guide makes unusually useful quality disclosures: known duplicates, a high junk rate, and low property completeness. Matching promotes one provider's record rather than merging every attribute from all providers. An Overture place is therefore not automatically the richest union of the same business's information.

`confidence` describes estimated existence, not whether a business is currently open. Scores are not strictly calibrated across providers. `operating_status = open` means continuing operation, not open at this hour. The inspected schema does not expose a reviews/ratings corpus or an opening-hours schedule. Do not invent “open now,” rating, or recent-verification claims from these fields.

### Regional extraction without a paid API

The [official Python client](https://docs.overturemaps.org/getting-data/overturemaps-py/) reads the public cloud-hosted GeoParquet, discovers releases via STAC, and transfers data for a bounding box. It outputs GeoJSON, GeoJSONSeq, or GeoParquet. An illustrative broad Turin urban rectangle is:

```bash
uvx overturemaps download --bbox=7.60,45.00,7.77,45.14 -f geojson --type=place -o torino-places.geojson
```

This rectangle is not a municipal boundary. For reproducibility, record the actual discovered release, chosen bounds, retrieval date, schema, and hash; do not rely on an unrecorded moving “latest.” For a field benchmark, use a fixed region and document its data-selection coordinates. A local SQLite FTS/spatial index can then be built on the development machine and sideloaded as a data package. This avoids per-query disclosure to a search provider and requires no always-on server.

For addresses, the [Overture attribution page](https://docs.overturemaps.org/attribution/) currently lists Italy's ANNCSU, via OpenAddresses, under CC BY 4.0. That is a separate addresses theme with separate attribution. It may improve civic-address lookup, but a civic address is not proof of which shop currently occupies it.

## Foursquare OS Places: current access verified, old tutorials are misleading

The [official OS Places homepage](https://opensource.foursquare.com/os-places/) advertises a worldwide open dataset and links its Download button to the new [Places Portal](https://places.foursquare.com/). Those worldwide counts are marketing scope, not Turin coverage measurements.

Live verification on 2026-10-11:

- The historical public S3 bucket [root listing](https://fsq-os-places-us-east-1.s3.amazonaws.com/?list-type=2&delimiter=/) returned exactly two objects, `LICENSE.txt` and `NOTICE.txt`, and no release directories. Do not use old “download anonymous S3 release” instructions as a guaranteed current pipeline.
- The accessible [LICENSE](https://fsq-os-places-us-east-1.s3.amazonaws.com/LICENSE.txt) and [NOTICE](https://fsq-os-places-us-east-1.s3.amazonaws.com/NOTICE.txt) identify Apache-2.0, require retaining attribution/notice and license, and require marking modified data.
- The [current portal schema](https://places.foursquare.com/dataset/OS%20Places/details) was read in a browser without signing in.
- The [Access Data tab](https://places.foursquare.com/dataset/OS%20Places/code) explicitly requires **Login or Signup to generate an access token**. It provides DuckDB, PySpark, PyIceberg, and FSQ Spatial Desktop instructions against the Iceberg REST endpoint `https://catalog.h3-hub.foursquare.com/iceberg`, with the table `places.datasets.places_os`.
- No account was created, token obtained, or dataset queried through authenticated access. A stable update cadence, quota, and cost-free download conditions beyond the public open-data description were not established. The older documentation URLs returned HTTP 403 in direct reads; the portal supplied the schema/access evidence instead.

The current OS schema includes `fsq_place_id`, name, coordinates, address components, contact fields, category IDs/labels, `date_created`, `date_refreshed`, `date_closed`, and `unresolved_flags`.

Its own field descriptions are important:

- `date_created` means entered the database, not when the business opened.
- `date_refreshed` means **any single reference** was refreshed from a source/user/validation, not that all details were verified.
- `date_closed` means marked closed in the database, not the exact real closure date.
- `unresolved_flags` may include suspected closure, duplicate, deletion, private venue, inappropriate content, or nonexistent place; these require handling, not blind display.

The displayed OS schema has no review/rating corpus or regular opening-hours fields. Do not conflate it with Foursquare's paid Places products.

The fact that some Foursquare records are included in Overture does not make Overture a complete mirror of OS Places. The September Overture guide reports approximately 4.1 million promoted Foursquare-source records worldwide versus the much larger full OS product. Conversely, ingesting both without source-aware deduplication can create duplicates.

If worthwhile, obtain an account/token for **development-time regional extraction** and package data locally. Do not put a proprietary analytics/location SDK on the phone merely to consume an open bulk dataset. The dataset is independent of the portal's own web analytics; the portal session's network activity is not a requirement for the resulting local app.

## AllThePlaces and Wikidata

[AllThePlaces's own README](https://github.com/alltheplaces/alltheplaces) describes extraction from first-party store-locator pages and published regular/weekly runs. It specifically discourages users from rerunning all spiders when published outputs exist. Data is CC0 and scraper code MIT. It is a sensible source for missing chain branches and authoritative store coordinates/links, subject to checking each supported brand and update output. Because both Overture and Foursquare can already ingest it, evaluate incremental benefit before adding another pipeline.

Wikidata is useful for stable entity/brand identifiers, multilingual names, heritage and landmark context. It should be treated as optional enrichment, not assumed to be a complete fresh restaurant/shop inventory. Wikidata licensing pages returned HTTP 403 during this particular direct-read session; retain a primary-license verification step if it becomes an actual imported dataset. No Wikidata coverage or dataset was queried here.

## Search engines do not manufacture business coverage

[Photon](https://github.com/komoot/photon) provides autocomplete, typo tolerance, location bias, and OSM-derived indexing. [Pelias](https://github.com/pelias/pelias) supports multiple open/custom data importers, autocomplete, and address/name search over Elasticsearch. [Nominatim](https://nominatim.org/) is OSM geocoding software. These can improve discoverability of records they index; none can return a genuine missing restaurant record without another data source.

All are principally server stacks rather than drop-in local Android business search libraries. Their public endpoints have service-specific restrictions; notably [public Nominatim](https://operations.osmfoundation.org/policies/nominatim/) disallows autocomplete and systematic POI harvesting. Replacing Organic Maps' search with repeated Nominatim calls is neither an offline strategy nor a solution to missing source records.

A separate local SQLite/FTS index is a practical candidate for Turin. It must be evaluated for:

- Accent/case/punctuation normalization, alternative names, token prefixes, typos, and Italian vocabulary.
- Explicit Italian category aliases: e.g. “mangiare,” “ristorante,” “pizzeria,” “pizza,” “bar,” “alimentari,” “supermercato,” “ferramenta,” plus cuisine/store categories.
- Current map viewport, selected neighborhood, distance, exact brand/name matches, category relevance, and reachable entrance placement.
- Source-aware duplicate clustering using proximity plus name/address/phone/website; avoid merging distinct nearby chain branches.
- Ranking with transparent evidence, not fabricated ratings; favorites/manual corrections remain local.
- Atomic monthly data replacement, rollback, source/version retention, bounded package size and fast query benchmarks on supported Android devices.

Keep raw source IDs and provenance even if results are clustered. A sibling index preserves the existing map download/update mechanism; precise integration into native search and the place panel remains a build/prototype gate.

## Hosted free tiers: optional comparisons, not the core plan

**Geoapify:** [current pricing](https://www.geoapify.com/pricing/) states 3,000 credits/day, no credit card, up to five requests/second on the free plan, and required attribution. Its [Places API page](https://www.geoapify.com/places-api/) says OSM is the primary data source, permits caching/storage/redistribution with attribution, and says each group of 20 returned items counts as a request/credit unit. Thus 3,000 credits is not necessarily 3,000 arbitrary huge POI result sets. This is a convenient API, but absent OSM businesses can remain absent; requests reveal search location/context to a vendor.

**TomTom:** [current pricing](https://developer.tomtom.com/store/maps-api) lists free monthly allowances with no upfront card: Places Search Suggest 10,000; Details 5,000; Discover 5,000. These October 2026 observations differ from older daily-allowance tutorials. Free usage is not an open data license or a guarantee against future pricing/terms changes. Do not assume bulk offline caching rights. If tested, use a free account with no paid conversion and explicit request caps only after deciding the vendor/privacy tradeoff is acceptable.

**HERE:** [the official pricing page](https://www.here.com/get-started/pricing) showed a free-start/Base Plan entry, but did not expose a verifiable quota in the retrieved content, and the detailed free-plan page returned 403. Therefore no precise “free N calls” claim is supported by this research. It is not the default recommendation under a no-paid-services, local-first requirement.

## Google, Yelp, and web wrappers

[Google Places policies](https://developers.google.com/maps/documentation/places/web-service/policies) restrict prefetching/caching/storage except specified exceptions such as place IDs, and impose attribution and service terms. They explicitly distinguish EEA billing customers, relevant to Italy. Do not apply outdated blanket map-display rules without checking the applicable current EEA terms; none of this establishes permission to clone Google's business/review corpus into an offline OSM application.

Yelp's developer terms page returned 403 in this session. No permission to bulk reuse Yelp data was established, so Yelp cannot be presented as a verified open-data source. No Google/Yelp scraping plan is proposed.

[GMaps WV's own README](https://github.com/woheller69/maps) calls it a Google Maps WebView wrapper, notes clearing private data, blocking trackers, and location permission controls, and lists limitations including no navigation beyond a direction list and retained cache that may allow tracking. It can reduce aspects of exposure compared with the full Google app, but searches still reach Google and it is not an on-device/open-data replacement. It is at most a conscious external fallback, not fulfillment of the privacy/local-first goal.

## The acceptance benchmark that should decide whether enrichment is worthwhile

Run exact-name, address and category search cases for supported regions. Add a modest fixed set of independently verifiable local businesses and generic queries. Do not use a world dataset count as a success metric.

Record for each case:

1. Current app/map version and query/viewport; whether the expected place is absent, hidden, stale, or mislabeled.
2. Presence in raw OSM, Overture, and optional full Foursquare; exact source identifiers, source release, category and coordinates.
3. Correct storefront/entrance, current operation confirmed from first-party website or field knowledge, duplicate/closed-record errors, and contact completeness.
4. Ranking within the first few results for both exact name and generic Italian category queries; latency and offline success on the phone.

Separate **data recall** from **search/ranking recall**, and separate “exists” from “currently operating” and “open now.” Report overlap and incremental valid places, not just raw hit counts. A dataset containing more stale duplicates can look numerically better while making discovery worse.

A bounded direct DuckDB query of Overture release 2026-09-23.1 returned **3,701 raw records**, including **464 food-and-drink** and **838 shopping** records. These are neither unique businesses nor verified-open/complete coverage counts.

See the accompanying [place-data probe](place-data-probe.md) and [place-search sample](place-search-sample.md) for the query and comparison evidence. This supports doing a real enrichment experiment but does not establish Overture as complete or as uniformly better than OSM. It also demonstrates why independently verified acceptance cases matter before selecting a source or promising a fix.
