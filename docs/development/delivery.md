# Android build verification

Application id: `quest.avoid.maps`. Released [version 0.1.3](https://github.com/avoid-quest/maps/releases/tag/v0.1.3) / Android code `4`, built from `d6cfc26742bff84f97f8eb1e01acf8b7fb4e7ead`. Signed arm64 APK: 42,132,924 bytes; SHA-256 `938b4b924bf18f932104401b8fa2a64f9c1c8f7a264b27e501645242c07bdfb8`. Discovery/search changes are prepared for 0.1.4/code 5 and require a new inspected APK. Packaging evidence below describes 0.1.3; the separate emulator runtime evidence belongs to 0.1.2.

## Verified implementation and packaging

- Expo SDK 54, RN 0.81.5 and MapLibre React Native 11.5 compile into a locally signed arm64 APK with bundled Hermes JavaScript.
- APK signature verification and 16 KB ZIP alignment pass. All 18 arm64 shared libraries have ELF LOAD alignment of at least 16 KB.
- The release runtime classpath contains no Google Play services, Google Mobile Services or Firebase dependencies. MapLibre uses Android's default platform location engine.
- The manifest requests foreground approximate/precise location, Internet, network/Wi-Fi state and AndroidX's application-private receiver permission. Storage, microphone, overlay and vibration permissions are removed; Android cloud backup is disabled.
- Native Bun typechecking, zero-warning Expo ESLint with React Hooks rules and all 67 fixture tests passed for 0.1.3. Independent Standards and Spec/privacy reviews and PR-head/merged-main CI passed for both the transit implementation and its narrow time/duration follow-up. Browser checks covered alternatives, leg details, explicit-time submission, midnight draft rollover, deliberate edits, duration rounding and failed/stale refresh behavior. Earlier diagnostic preview/copy/off/clear and failed-storage checks remain browser evidence; they do not prove native clipboard behavior.
- Anonymous repository, source, latest-release, APK and checksum downloads passed. The downloaded digest matches the inspected arm64 artifact. The release is normal/latest for Obtainium's default GitHub source; an on-device Obtainium update remains unverified.

The APK audit checked all ZIP entries for signing material and declared personal metadata. Native libraries can retain ordinary build-source paths even when debug symbols are stripped; compiler path mapping is useful release hygiene. Keep release credentials outside Git and preserve the signing key across upgrades.

## Native evidence and checks outstanding

On 2026-10-11, a Google-free AOSP API 36 x86_64 software emulator booted and installed the separately audited 0.1.2/code 3 APK. The installed version was confirmed; the Google Play services package was absent. With Metro stopped and no ADB reverse mappings, a cold ActivityManager launch exited successfully with `Status: ok`.

A usable screenshot showed the app's Italian main interface beneath Android's “Process system isn't responding” dialog; the map stayed gray/loading. This confirms bundled JavaScript rendered the main UI. The system-process ANR prevented healthy interaction checks, and the final UI-hierarchy capture timed out. Its root cause was not established. The older 0.1.0/code 1 install attempt timed out and supplies no accepted baseline or upgrade evidence.

The new 0.1.3 native transit UI, keyboard/TalkBack, map rendering, diagnostics preview/copy/off/clear, permission denial and location acquisition, lifecycle recovery, favourites persistence and upgrade preservation remain unverified. The older emulator launch does not validate the new transit controls. Use the acceptance list in [android.md](android.md); physical-device GPS accuracy, approximate permission behavior and battery use require separate device evidence. Neither spoken navigation nor background location is implemented. Private QA logs/screenshots stay outside Git and public reports.

## Artifacts

The build script produces `artifacts/avoid-maps.apk` and its SHA-256 companion. Build outputs and signing secrets are excluded from Git. Publish only inspected arm64 artifacts in [releases](https://github.com/avoid-quest/maps/releases); x86_64 builds are emulator artifacts. Release version and checksum identify the inspected download.
