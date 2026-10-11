# Android build verification

Application id: `quest.avoid.maps`. Released [version 0.1.5](https://github.com/avoid-quest/maps/releases/tag/v0.1.5) / Android code `6`, built from `6770e25ae4289e1ba698f1e9bf30f489cac13893`. Signed arm64 APK: 47,969,588 bytes; SHA-256 `59f0fd2dd8b787d7843d6c49fe9048d571e13a13c7e367d71f01c5a0d4d0733d`. Packaging evidence below describes 0.1.5; the separate emulator runtime evidence belongs to 0.1.2. Version 0.1.6/code 7 is in preparation and has no inspected release APK yet.

## Verified implementation and packaging

- Expo SDK 54, RN 0.81.5 and MapLibre React Native 11.5 compile into a locally signed arm64 APK with bundled Hermes JavaScript.
- APK signature verification and 16 KB ZIP alignment pass. All 18 arm64 shared libraries have ELF LOAD alignment of at least 16 KB.
- The release runtime classpath contains no Google Play services, Google Mobile Services or Firebase dependencies. MapLibre uses Android's default platform location engine.
- The manifest requests foreground approximate/precise location, Internet, network/Wi-Fi state and AndroidX's application-private receiver permission. Storage, microphone, overlay and vibration permissions are removed; Android cloud backup is disabled.
- Native Bun typechecking, zero-warning Expo ESLint with React Hooks rules and all 99 Bun tests, including 23 Python pipeline regressions, passed for 0.1.5. Independent Standards and Spec/privacy reviews and PR-head/merged-main CI passed. Browser checks covered wider place discovery, distinct branches, result caps and coverage, excluded/corrected records, complete contributor provenance for merged contacts, persisted local-only search, offline details/save and reload persistence. Earlier transit and diagnostics checks remain browser/service evidence; they do not prove native interaction or clipboard behavior.
- Anonymous repository, source, latest-release, APK and checksum downloads passed. The downloaded digest matches the inspected arm64 artifact. The release is normal/latest for Obtainium's default GitHub source; an on-device Obtainium update remains unverified.

The APK audit checked all ZIP entries for signing material, declared private metadata and local path markers; none were found in the published artifact. The first candidate retained compiler header-path strings in two generated native libraries. A build-only generated CMake override added C/C++ `-ffile-prefix-map=<local-home>=.` and changed only those libraries; JavaScript/config and all other entries remained identical. The 0.1.5 source revision did not yet encode that override. The prepared 0.1.6 build script makes path mapping part of the normal build; its rebuilt artifact still requires inspection. Keep release credentials outside Git and preserve the signing key across upgrades.

## Native evidence and checks outstanding

On 2026-10-11, a Google-free AOSP API 36 x86_64 software emulator booted and installed the separately audited 0.1.2/code 3 APK. The installed version was confirmed; the Google Play services package was absent. With Metro stopped and no ADB reverse mappings, a cold ActivityManager launch exited successfully with `Status: ok`.

A usable screenshot showed the app's Italian main interface beneath Android's “Process system isn't responding” dialog; the map stayed gray/loading. This confirms bundled JavaScript rendered the main UI. The system-process ANR prevented healthy interaction checks, and the final UI-hierarchy capture timed out. Its root cause was not established. The older 0.1.0/code 1 install attempt timed out and supplies no accepted baseline or upgrade evidence.

Native discovery preference/coverage behavior, compact-package startup/search/memory, transit UI, keyboard/TalkBack, map rendering, diagnostics preview/copy/off/clear, permission denial and location acquisition, lifecycle recovery, favourites persistence and upgrade preservation remain unverified. The older emulator launch does not validate these controls or the released 0.1.5 package. Saved-travel changes prepared for 0.1.6 also require their own Android acceptance. Use the acceptance list in [android.md](android.md) and [data preparation](data.md); physical-device GPS accuracy, approximate permission behavior and battery use require separate device evidence. Neither spoken navigation nor background location is implemented. Private QA logs/screenshots stay outside Git and public reports.

## Artifacts

The build script produces `artifacts/avoid-maps.apk` and its SHA-256 companion. Build outputs and signing secrets are excluded from Git. Publish only inspected arm64 artifacts in [releases](https://github.com/avoid-quest/maps/releases); x86_64 builds are emulator artifacts. Release version and checksum identify the inspected download.
