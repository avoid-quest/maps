# Android builds and installation

The application is an Expo native app. MapLibre requires a compiled native build; Expo Go cannot run it. Android uses MapLibre's `default` platform location engine, with foreground approximate or precise permission. Search and manual map browsing work without location access. Development version 0.1.8 adds an explicit Android navigation session using precise platform GPS, a location foreground service and an installed offline Italian voice. The integrated GPS/voice/service runtime remains unverified; read [navigation implementation and acceptance](navigation.md) before describing screen-off guidance as tested.

## Local prerequisites

Use Node 22, JDK 17, Android SDK platform 36, build-tools 36.0.0, NDK 27.1.12297006, and CMake 3.22.1. `scripts/toolchain-env.sh` selects the existing task-local tools in `~/.local/share/avoid-maps/toolchain`; otherwise set `JAVA_HOME` and `ANDROID_HOME` to your own installation. Dependencies are pinned by `bun.lock`; use the Bun version declared in `package.json`.

Source `scripts/toolchain-env.sh` if using the prepared local Node/Android tools, then run `bun install --frozen-lockfile`. Build commands are in `package.json`.

The minimum supported Android API is 25 (Android 7.1) for the navigation build. The [navigation dependency boundary](navigation.md#dependency-and-distribution-boundary) records the Kotlin/R8/desugaring pins.

The release build generates `android/` through Expo prebuild and invokes Gradle locally. It bundles JavaScript and assets into the APK, so installation requires neither Metro nor an Expo account. Generated native directories and build outputs are ignored by Git. Native customizations belong in config plugins; the tracked local Expo navigation module owns its Android source, service manifest and third-party notice assets.

The build script supplies a temporary Gradle init script that appends Clang `-ffile-prefix-map` flags for the checkout, Gradle cache and local home prefixes. These paths come from the current build environment and map to relative paths in C/C++ source strings. This removes local compiler-header paths without excluding native sources or packaging metadata. The init script is deleted on exit. Scan the resulting APK for local paths as part of release inspection; JavaScript and prebuilt dependencies require their own content checks.

## Signing and updates

The release signing key lives outside the checkout at `~/.local/share/avoid-maps/signing/release.jks`; its local password configuration is `release.properties` in the same directory. Back up both files privately. Keeping this key allows future APKs to update the app while retaining favourites. Losing it requires uninstalling the app before installing a newly signed build, which removes app data.

Set `AVOID_MAPS_SIGNING_PROPERTIES` to use a different properties file with `storeFile`, `storePassword`, `keyAlias`, and `keyPassword`. The build fails when this configuration is absent. Signing material must remain outside Git and APK artifacts.

`bun run build:android` produces `artifacts/avoid-maps.apk` and its SHA-256 file. The script verifies APK signatures and 16 KB zip alignment. The default is arm64; `AVOID_MAPS_ARCH=x86_64` selects an emulator build.

Install by copying the APK to the Android device and opening it in Files, or use `adb install -r artifacts/avoid-maps.apk` with USB debugging authorized. Grant the installer permission to install unknown apps when Android requests it. App id: `quest.avoid.maps`.

Public release downloads need no GitHub account or token. In Obtainium, add `https://github.com/avoid-quest/maps` as a GitHub source and select `avoid-maps.apk` if needed. Keep the existing installation when updating: compatible signing preserves favourites. Obtainium access and upgrade preservation require a device test.

Builds with local diagnostics read version/code from the embedded Expo configuration. The build script embeds the Git revision when the checkout has no uncommitted tracked changes or unignored untracked files. Any such change, including documentation, reports `development`. The diagnostics report uses these public build identifiers and excludes device identifiers. Native dependency changes such as the clipboard module require a new APK.

## Acceptance without Google Play services

1. Install into a profile without Google Play; launch with Metro stopped. The map renders over the network.
2. Deny location, search a public place and a food category, open a place and plan a route using the map center as origin.
3. Grant approximate location, then precise location outdoors. Confirm the locate button settles or gives a useful timeout and continues to work after background/foreground transitions.
4. Open transit stops and check live-feed timestamps; disconnect the network and confirm unavailable/stale wording remains honest.
5. Save a place, close the app, relaunch, and confirm it remains saved. Install a later APK signed with the same key to verify upgrade preservation.
6. Run the separate [navigation acceptance](navigation.md#android-acceptance) for walking, cycling, driving and transit. Verify current precise positioning, offline Italian speech or visible missing-voice state, bounded rerouting, manual transit confirmations, notification Stop and interrupted-session handling. Inspect foreground-service/location/notification permissions, absence of background-location permission and bundled third-party notices on the final APK.

Emulator checks prove Android packaging and runtime behaviour, not physical-device GPS accuracy, lifecycle behaviour, or battery consumption. Record those device checks separately.

## Position availability

Location permission authorizes a request; it does not guarantee a current fix. MapLibre's default Android engine requests platform positioning, including the network provider when available alongside GPS. A Google-free system may have no working Wi-Fi/cell positioning provider, so indoor browsing can time out even with precise permission and location enabled. Navigation separately requires a fresh GPS fix within its accuracy policy; an old cached position cannot start guidance.

Foreground browsing checks existing permission on launch and resume without prompting. Explicit Locate can request permission. Provider status is sampled before acquisition and after timeout: local diagnostics distinguish disabled services, GPS only, network only, both enabled, another active platform provider, and no enabled provider. These fixed codes contain no coordinates or device identifiers. An enabled provider does not establish that it can return a fix. Older native binaries without the status method continue acquisition with generic timeout wording; rebuild the APK to expose provider status.

Indoor timeouts after earlier successful fixes do not establish which platform provider stopped returning results. To diagnose missing fixes, verify a fresh outdoor fix, then compare indoor provider status and timeouts on the rebuilt APK. Browser and JVM checks cannot establish Android GPS reception or indoor positioning availability.

## Dependency review

The initial SDK 54 lockfile was checked with `npm audit` and compatible fixes applied. The web-only MapLibre renderer was updated to 6.13.0 and protobufjs to 8.8.0 to remove critical advisories; the native MapLibre package remains pinned separately. For the original v0.1.0 lockfile on 2026-10-11, npm reported 44 advisory paths (26 high, 16 moderate, 2 low), mostly inherited build/CLI CSS, image, glob, signing and source-map tooling. `npm audit fix --force` proposes incompatible framework changes, so those changes were not applied mechanically. Treat untrusted build input and development servers accordingly; this is not a claim that the entire dependency graph is vulnerability-free. These historical counts do not describe the later Bun lockfile. Recheck the active lockfile with `bun audit` when updating Expo or its toolchain.

## Browser preview

MapLibre GL JS 6 ships ESM workers separately. `bun install --frozen-lockfile` runs `scripts/prepare-web-assets.mjs` to copy the pinned worker into `public/vendor`, while the web map supplies its same-origin URL. The Expo Babel import-meta transform permits Metro's non-module bundle output. Keep these together when upgrading the browser renderer; an exported web bundle alone does not prove workers started. This browser dependency is separate from native MapLibre and is excluded from Android's platform-resolved bundle.
