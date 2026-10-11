#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
source scripts/toolchain-env.sh
export AVOID_MAPS_SIGNING_PROPERTIES="${AVOID_MAPS_SIGNING_PROPERTIES:-$HOME/.local/share/avoid-maps/signing/release.properties}"
if [[ ! -f "$AVOID_MAPS_SIGNING_PROPERTIES" ]]; then
  echo "Missing local release signing configuration. See docs/development/android.md." >&2
  exit 1
fi
export EXPO_NO_TELEMETRY=1
node node_modules/expo/bin/cli prebuild --platform android --no-install
(cd android && ./gradlew assembleRelease -PreactNativeArchitectures="${AVOID_MAPS_ARCH:-arm64-v8a}" --no-daemon --max-workers=4)
mkdir -p artifacts
APK_PATH="artifacts/avoid-maps.apk"
if [[ "${AVOID_MAPS_ARCH:-arm64-v8a}" != "arm64-v8a" ]]; then APK_PATH="artifacts/avoid-maps-${AVOID_MAPS_ARCH}.apk"; fi
cp android/app/build/outputs/apk/release/app-release.apk "$APK_PATH"
(cd artifacts && sha256sum "$(basename "$APK_PATH")") > "$APK_PATH.sha256"
"$ANDROID_HOME/build-tools/36.0.0/apksigner" verify --verbose --print-certs "$APK_PATH"
"$ANDROID_HOME/build-tools/36.0.0/zipalign" -c -P 16 -v 4 "$APK_PATH" | tail -1
