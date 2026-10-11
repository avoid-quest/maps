# Expo, MapLibre and Google-free Android feasibility

Research date: 2026-10-11. This assesses Expo, native map rendering, Google-free Android location, and signed APK delivery for a new application using online services and local state. This is source and package-registry research, not a tested APK.

## Recommendation

Expo + React Native + MapLibre React Native is a credible, relatively straightforward foundation for a fresh interface. Use Expo's native development-build workflow and local Android builds. Expo does not require an EAS subscription, Expo-hosted runtime, Google Maps, or a store release. Native Kotlin modules remain available for the few responsibilities needing tight Android integration. [E1–E3, M1–M3]

This reduces interface-development work; it does not supply places, transit routing, street routing or full turn-by-turn guidance. Keep those choices separate. A map with a route line is achievable much earlier than dependable spoken guidance, route progress, off-route detection, rerouting and screen-off operation. Ferrostar can help with the latter, but its React Native distribution is not yet a safe plug-and-play assumption. [F1–F3]

## MapLibre integration

- The official setup supports Expo through a config plugin. It requires rebuilding the native application and does not run inside the standard Expo Go application. [M1, M2]
- Version 11 supports React Native's New Architecture only. At inspection, npm's `latest` was `11.5.0`, with peer ranges Expo `>=54.0.0`, React Native `>=0.80.0`, React `>=19.1.0`. These ranges establish declared compatibility, not an instruction to blindly install every newest dependency. Select and pin an Expo-supported React/RN combination, then compile and test MapLibre against it. [M1, M3]
- MapLibre renders the native map; the React Native interface does not mean a web page must render map frames. Its default demonstration tiles are for development. Production styles, tiles, glyphs and sprites need an actual provider or self-managed data. [M1]
- Use the MapLibre package rather than assuming Android `react-native-maps` supplies a Google-independent renderer.

## Google-free Android location

**Do not assume `expo-location` is Google-free just because Expo itself is open source.** Its Android Gradle file explicitly depends on `com.google.android.gms:play-services-location`, and current foreground location acquisition/subscription code instantiates and calls `FusedLocationProviderClient`. It does use Android `LocationManager` for some status/last-known-location operations; that does not establish a complete foreground-watch fallback when Play services are absent. The safe conclusion is that stock `expo-location` is not an established choice for the Google-free requirement. [E4, E5]

There is an easier first option than writing all location code:

1. MapLibre React Native has an explicit `android.locationEngine: "default"` plugin setting. Its type documentation describes this as F-Droid-compatible; `"google"` is a separate opt-in. The Gradle default is `default`, and the Google location dependency is conditional on choosing `google`. [M4–M6]
2. The default provider selects MapLibre Native's own fused implementation. That implementation uses Android `LocationManager` and describes itself as a replacement for Google's fused client. “Fused” here does not imply Play services. [M7, M8]
3. Its exposed React Native `LocationManager` supports obtaining a current/last position and subscribing to updates. This can feed the map, nearby-place search and nearby-stop discovery without `expo-location`. [M9]

For the initial foreground experience, start with MapLibre's default location engine. Request Android permissions independently if necessary: the convenience helper currently reports success only when both requested permission results are granted, so handle approximate-location and denial deliberately. Its foreground native source requests high-accuracy updates at a one-second interval; subscribe only while needed and stop subscriptions when the relevant experience ends. [M9, M10]

**Foreground maps do not establish screen-off navigation reliability.** MapLibre's own fused-engine source cautions that fusion will not work in background mode. For active navigation, evaluate an Android location foreground service and a small local Expo/Kotlin module, potentially integrating native Ferrostar. Expo officially supports local native modules; this does not require abandoning Expo. Test lifecycle, process death, approximate location, OS permission revocation and battery consumption on supported Android devices. [M8, E3]

## Ferrostar: useful, but distinguish native SDK from RN packaging

The official introduction describes native Android/iOS as usable in production but still beta without API-stability guarantees. It labels React Native pre-alpha, with unpublished packages and incomplete UI/voice support. [F1]

Repository `main` is further along in concrete implementation: a dedicated React Native getting-started guide describes three packages, an Expo demo, a MapLibre navigation interface, manual location injection, speech interfaces and foreground-service adapters. This is encouraging but currently inconsistent with the introductory maturity table. [F2, F3]

The research checked the public npm `latest` endpoints for all three names on 2026-10-11:

- `@stadiamaps/ferrostar-uniffi-react-native`: HTTP 404.
- `@stadiamaps/ferrostar-core-react-native`: HTTP 404.
- `@stadiamaps/ferrostar-maplibre-react-native`: HTTP 404.

Therefore, do not present its documented `npm install` instructions as a proven released integration. A pinned source build or wrapper around the published Android SDK could work, but that requires a dedicated build/navigation experiment. [F4]

Ferrostar's RN foreground-service adapter coordinates start/update/stop callbacks; its guide explicitly says the adapter does not itself grant background execution. Its example location integration uses `expo-location`, which requires replacement for Google-free operation. Example Stadia URLs/API keys are examples, not a mandatory dependency: Ferrostar supports configurable routing providers and does not itself supply route computation, a basemap or search. [F1, F2]

## Cost and delivery

Use a local Android SDK/JDK and `npx expo run:android` for development; Expo generates native directories when required. JavaScript/TypeScript changes can then use Metro without rebuilding native code every time. Native dependencies/config-plugin changes require a rebuild. [E1]

For release builds, configure Android signing locally and produce a signed APK using Gradle. Expo's production guide focuses on an AAB for stores, but a generated Android project remains a normal Gradle project; use its APK assembly task for sideloading. Keep a stable signing key outside the repository and preserve it for updates. No paid Expo service is necessary. [E2]

“No paid services” is still a separate constraint for tiles, search, road routing and journey planning. A free SDK does not make the endpoints in a sample application free, available indefinitely, or suitable for heavy use. MapLibre and Expo leave those choices open.

## First implementation gate

Before extensive UI work, produce a minimal signed APK which:

1. Renders a chosen legitimate basemap through MapLibre.
2. Obtains foreground position with MapLibre's default location engine on Android without Play services.
3. Shows manually searchable places/stops when location is denied and supports approximate location.
4. Calls one direct GTT feed and displays its freshness.
5. Survives navigation between screens without leaking GPS subscriptions.

Then independently prove screen-off guidance before committing to a Ferrostar RN implementation. This keeps the easy initial application easy while making the difficult navigation work explicit.

## Primary sources

- [E1] Expo local app compilation: https://docs.expo.dev/guides/local-app-development/ ; inspected official source because the documentation site returned HTTP 403: https://github.com/expo/expo/blob/main/docs/pages/guides/local-app-development.mdx
- [E2] Expo local release builds and signing: https://github.com/expo/expo/blob/main/docs/pages/guides/local-app-production.mdx
- [E3] Expo local native modules: https://github.com/expo/expo/blob/main/docs/pages/modules/get-started.mdx
- [E4] Expo Location Android dependencies: https://github.com/expo/expo/blob/main/packages/expo-location/android/build.gradle
- [E5] Expo Location Android implementation: https://github.com/expo/expo/blob/main/packages/expo-location/android/src/main/java/expo/modules/location/LocationModule.kt
- [M1] MapLibre RN requirements: https://maplibre.org/maplibre-react-native/docs/setup/getting-started/
- [M2] Expo setup: https://maplibre.org/maplibre-react-native/docs/setup/expo/
- [M3] Published npm package metadata: https://registry.npmjs.org/@maplibre/maplibre-react-native/latest ; source manifest: https://github.com/maplibre/maplibre-react-native/blob/main/package/package.json
- [M4] Plugin options: https://github.com/maplibre/maplibre-react-native/blob/main/package/src/plugin/MapLibrePluginProps.ts
- [M5] Default Gradle settings: https://github.com/maplibre/maplibre-react-native/blob/main/package/android/gradle.properties
- [M6] Conditional Google dependency: https://github.com/maplibre/maplibre-react-native/blob/main/package/android/build.gradle
- [M7] Default engine selection: https://github.com/maplibre/maplibre-native/blob/main/platform/android/MapLibreAndroid/src/main/java/org/maplibre/android/location/engine/LocationEngineDefault.kt
- [M8] Platform-location engine and background limitation: https://github.com/maplibre/maplibre-native/blob/main/platform/android/MapLibreAndroid/src/main/java/org/maplibre/android/location/engine/MapLibreFusedLocationEngineImpl.java
- [M9] RN location API/permissions: https://github.com/maplibre/maplibre-react-native/blob/main/package/src/modules/location/LocationManager.ts
- [M10] RN native location lifecycle/update interval: https://github.com/maplibre/maplibre-react-native/blob/main/package/android/src/main/java/org/maplibre/reactnative/location/LocationManager.kt
- [F1] Ferrostar official maturity and scope: https://stadiamaps.github.io/ferrostar/ ; source https://github.com/stadiamaps/ferrostar/blob/main/guide/src/intro.md
- [F2] React Native implementation guide on main: https://github.com/stadiamaps/ferrostar/blob/main/guide/src/react-native-getting-started.md
- [F3] RN implementation and Expo example: https://github.com/stadiamaps/ferrostar/tree/main/react-native
- [F4] Registry probes: https://registry.npmjs.org/@stadiamaps/ferrostar-uniffi-react-native/latest ; https://registry.npmjs.org/@stadiamaps/ferrostar-core-react-native/latest ; https://registry.npmjs.org/@stadiamaps/ferrostar-maplibre-react-native/latest
