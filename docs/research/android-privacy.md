# Android privacy and APK delivery

Research date: 2026-10-11. Scope: Android location permissions, native libraries, local state, direct public-data access, and signed APK delivery. These are documented platform facts and acceptance criteria, not a claim that an APK has already been tested. The selected online/local architecture is documented in [recommendation.md](recommendation.md).

## Location and permissions

Use Android platform location APIs for operation without Google Play services. Inspect the native dependency graph and built APK: an open-source licence does not establish that a particular build avoids proprietary location clients. [Platform integration evidence](expo-platform.md).

Use foreground location for nearby stops and route planning. Denied or approximate location must leave manual place/stop search usable. Continuous, explicitly started navigation can use a location foreground service with its persistent notification and the appropriate permissions. Android restricts starting location foreground services from the background. Background guidance remains a separate implementation and validation task. [A1, A2]

Respect the configured system location service. Keep source accuracy and timestamps visible when relevant. Underground reception and tall buildings can produce low-accuracy fixes; allow manual correction rather than confidently selecting a platform entrance or bus stop from an uncertain position. GNSS and screen use can dominate battery drain independently of rendering efficiency.

## Native libraries and page-size compatibility

Android documents 16 KB page-size support and testing configurations. Inspect the page size on each test device and verify native dependencies against the applicable configuration. Native map/routing libraries must package correctly aligned binaries and avoid fixed 4 KB assumptions. [A3]

## Local state and network disclosure

The selected architecture uses online map/search/route services and local favourites, optional recent places, caches and regional data. Download regional packages where supported to reduce per-query disclosure. Store favourites in app-private storage; optional history should be easy to erase. Use Android's file picker for exports instead of requesting broad storage access.

Direct HTTPS transit APIs expose request information to providers. A stop-specific request reveals that stop and the client's IP address to the operator; a remote itinerary request reveals its origin, destination and departure time. A city-wide realtime feed avoids sending the exact journey, at the cost of more data transfer. Providers still see download times and IP addresses. A relay changes which operator receives the client IP and adds hosting responsibilities; it does not eliminate network disclosure.

Keep these modes explicit:

| Mode | Sent off-device | Local capability |
|---|---|---|
| Online maps/search/routes | Provider-specific viewport, query or route requests and client IP | Local display, selected-result cache and saved state |
| Direct live transit | Provider-specific feed/stop requests and client IP | Local lookup and live observations over a local timetable |
| No network | No successful provider requests | Saved state and available cached data; new remote searches/routes/live updates are unavailable |

Inspect runtime requests, including map style fonts/sprites, geocoders, online speech and update checks. A library's permissive licence does not establish the behaviour of its default servers. Diagnostics should remain local and intentionally exportable.

## Efficiency and freshness

Use cached data immediately; refresh only the active transit view or active journey at a frequency justified by the provider's terms and actual update cadence. Coalesce requests, apply conditional requests where supported, honour retry/backoff responses, and stop refreshes when no longer needed. Keep source timestamps separate from fetch timestamps. A newly downloaded old prediction is still old.

Android WorkManager is suitable for deferred package/timetable updates, not a live arrival clock: periodic work has a minimum interval of 15 minutes and execution is not exact. Use lifecycle-bound work for visible arrivals and an appropriately scoped foreground service only when an active journey needs it. [A4]

Offline operation cannot provide new disruptions or true live arrivals. Label timetable estimates as scheduled. Once realtime observations exceed a tested freshness threshold, show their age and downgrade their status; never silently present stale observations as live.

## APK distribution and maintenance

Build a signed release APK with a stable application ID. Preserve a stable signing key outside the repository and back it up securely: future installs must have a compatible signing identity to update the existing app. Maintain explicit app/data format versions and verify upgrades without losing favourites or saved data. Android documents signing and non-store distribution. [A5, A6]

Manual signed APK installation can use local builds or a release channel. Dependency and source-data licence obligations continue to apply to distributed source, binaries and datasets. Android Auto and background spoken guidance are separate capabilities that require independent implementation and testing.

## Device acceptance checks

- Install and upgrade a signed release on supported Android configurations, including operation without Google Play services.
- Test network loss, location denial, approximate location and permission revocation; retain manual search and clear unavailable-data states.
- Record cold start, map frame times, route-query latency, peak memory, downloaded storage, transferred bytes and battery use on representative journeys. Establish a baseline before setting numerical pass thresholds.
- Exercise battery saver, process death, airplane mode, underground loss of GPS, network handover and rejected/expired feed updates. Test screen-off operation only for independently implemented guidance.
- Inspect a runtime destination log/network capture using an appropriate debug build or trusted local tooling; compare with an explicit endpoint allowlist. Distinguish OS location traffic from app traffic.
- Verify service-date/timezone edge cases independently of the UI: after-midnight trips and clock changes.

## Primary sources

- [A1] Android location permissions: https://developer.android.com/develop/sensors-and-location/location/permissions
- [A2] Android foreground service types: https://developer.android.com/develop/background-work/services/fgs/service-types#location
- [A3] Android 16 KB page-size support: https://developer.android.com/guide/practices/page-sizes
- [A4] WorkManager periodic scheduling: https://developer.android.com/develop/background-work/background-tasks/persistent/getting-started/define-work
- [A5] Android app signing: https://developer.android.com/studio/publish/app-signing
- [A6] Alternative distribution: https://developer.android.com/distribute/marketing-tools/alternative-distribution
