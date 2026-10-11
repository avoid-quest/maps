# Avoid Maps

An Android maps app built with Expo, React Native, NativeWind and native MapLibre. It uses direct public services and local data, with no app account, API key, analytics SDK, or paid service required.

The interface is Italian. Local discovery uses a limited bundled place dataset; online geocoding supplements it.

## Available in this version

- Native vector map, manual map browsing and optional foreground Android location without Google Play services.
- Local restaurant/shop discovery from 23,274 bundled Overture records in a declared regional rectangle, with separately versioned supplements and documented corrections. This is incomplete coverage; online Photon address/name search supplements it when enabled.
- Place details, available contact links, provenance, and locally saved favourites.
- Walking, cycling and driving route previews with directions through FOSSGIS; experimental MATO transit journeys when choosing Mezzi.
- Nearby GTT stops, direct live departures and service alerts with freshness and missing-data states.
- Local favourites, persisted **Solo ricerca locale** search policy and bundled regional lookup data. Network outages retain local discovery and show honest unavailable states for online functions.

This is an early test build. It does **not** yet provide spoken turn-by-turn guidance, background navigation, live road traffic, full offline routing, Google-equivalent reviews, comprehensive business hours, or all-Italy transit coverage. A route preview is not an active navigation system. MATO's access/reuse policy remains unresolved. Choosing Mezzi requests its experimental journey planner and sends route coordinates to MATO/5T.

## Install on Android

When a signed APK is available, download `avoid-maps.apk` from the [public releases](https://github.com/avoid-quest/maps/releases), or copy `artifacts/avoid-maps.apk` from a local build. Open it in Android's Files app and permit that installer to install unknown apps when asked. The arm64 release bundles its JavaScript and runs without Metro, Expo Go, an Expo login, or Google Play.

For updates through Obtainium, add `https://github.com/avoid-quest/maps` as a GitHub source. Repository and release access require no GitHub account or token. Select `avoid-maps.apk` if asked to choose an asset. Updates use the same signing key; install over the existing app to retain favourites. Obtainium installation and upgrade preservation still require a device test.

Only grant location if you want the locate button. Denying it leaves map browsing and manual-origin search available. Read [Android installation and device checks](docs/development/android.md) before testing upgrades or rebuilding. Keep the signing key backed up privately so later APKs preserve app data.

## Develop

Use the pinned Bun version and Node 22, then `bun install --frozen-lockfile`. Run `bun check` for native typechecking, `bun run lint` for Expo/React Hooks checks, `bun test` for fixtures, or `bun run verify` for all three. See [development tooling](docs/development/tooling.md) for CI and the Node/Expo boundary. Native dependencies require a compiled Android app; Expo Go is unsupported. The browser version helps iterate on UI and may encounter provider CORS restrictions that do not apply to Android.

For the prepared local SDK/JDK/Node tools, run `source scripts/toolchain-env.sh`, then `bun run build:android`. See [Android build instructions](docs/development/android.md) for other toolchains and signing.

Prepare changes through feature branches and PRs following the [review workflow](docs/development/review.md).

## Data refresh and privacy

Public map/search/routing/transit providers receive the requests sent to them and the user's IP address. Route providers receive route coordinates. Favorites remain on-device; no account or cloud history is created. Online services are best effort and may be unavailable. Full provider attribution, data terms, and transit-provider information are available in the app's information screen and [bundled licences and notices](src/data/licenses.json).

Bundled GTT data contains stops and trip patterns for joining live predictions, **not** an offline timetable. Changed trip IDs can require a fresh package and APK. Place and transit preparation are independent. Follow the [data preparation workflow](docs/development/data.md) to render the pinned extraction SQL, validate inputs, preserve provenance and prepare a reviewed package. New data ships through a rebuilt APK; the app has no in-app dataset updater.

`bun run data:smoke` performs bounded live provider checks using public sample coordinates; ordinary unit tests use fixtures. Research and architectural tradeoffs are recorded in [the proposal](docs/research/recommendation.md).

[Feature gaps and the next device milestone](docs/development/roadmap.md) distinguish the current test build from the broader maps capability goal.

## Source and data terms

No licence has yet been selected for the original application source. Public visibility does not grant a general reuse licence. Bundled datasets retain their separate [licences and notices](src/data/licenses.json): GTT permits non-commercial use and redistribution with attribution; Overture place records retain their source-specific terms. Repository visibility does not change those data terms.
