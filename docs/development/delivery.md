# Android build verification

Application id: `quest.avoid.maps`. Version `0.1.1` / Android code `2`. Signed arm64 APK: 42,070,368 bytes; SHA-256 `ca7fb44e4b9eafc6d900f9014a0462cea785dcfaa7532537100b56fd0555c7d7`.

## Verified implementation and packaging

- Expo SDK 54, RN 0.81.5 and MapLibre React Native 11.5 compile into a locally signed arm64 APK with bundled Hermes JavaScript.
- APK signature verification and 16 KB ZIP alignment pass. All 18 arm64 shared libraries have ELF LOAD alignment of at least 16 KB.
- The release runtime classpath contains no Google Play services, Google Mobile Services or Firebase dependencies. MapLibre uses Android's default platform location engine.
- The manifest requests foreground approximate/precise location, Internet, network/Wi-Fi state and AndroidX's application-private receiver permission. Storage, microphone, overlay and vibration permissions are removed; Android cloud backup is disabled.
- Native Bun typechecking, zero-warning Expo ESLint with React Hooks rules and all 24 fixture tests passed for the baseline. Browser checks rendered real map data; browser results do not prove native runtime behavior.

The APK audit checked all ZIP entries for signing material and declared personal metadata. Native libraries can retain ordinary build-source paths even when debug symbols are stripped; compiler path mapping is useful release hygiene. Keep release credentials outside Git and preserve the signing key across upgrades.

## Device checks outstanding

A bounded Google-free AOSP software-emulator attempt reached ADB and system-service initialization, but installation and launch were attempted before boot completed. No successful Android launch or physical-device runtime test is claimed.

Use the acceptance list in [android.md](android.md). Location acquisition, approximate permission, background/foreground transitions, actual map rendering, favourites after upgrade and battery use require device evidence. Neither spoken navigation nor background location is implemented.

## Artifacts

The build script produces `artifacts/avoid-maps.apk` and its SHA-256 companion. Build outputs and signing secrets are excluded from Git. Publish only inspected arm64 artifacts in [releases](https://github.com/avoid-quest/maps/releases); x86_64 builds are emulator artifacts. Release version and checksum identify the inspected download.
