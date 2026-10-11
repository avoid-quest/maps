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
export AVOID_MAPS_BUILD_REVISION=development
if git diff --quiet && git diff --cached --quiet && [[ -z "$(git ls-files --others --exclude-standard)" ]]; then
  AVOID_MAPS_BUILD_REVISION="$(git rev-parse HEAD)"
  export AVOID_MAPS_BUILD_REVISION
fi
node node_modules/expo/bin/cli prebuild --platform android --no-install
NATIVE_PATH_INIT="$(mktemp "${TMPDIR:-/tmp}/maps-native-paths.XXXXXX.gradle")"
trap 'rm -f "$NATIVE_PATH_INIT"' EXIT
cat > "$NATIVE_PATH_INIT" <<'GRADLE'
gradle.beforeProject { project ->
    project.plugins.withId('com.android.application') {
        project.extensions.getByName('androidComponents').finalizeDsl { android ->
            def prefixes = [project.rootDir.parentFile.canonicalPath,
                            gradle.gradleUserHomeDir.canonicalPath,
                            System.getProperty('user.home')].unique()
            def mappings = prefixes.collect { "-ffile-prefix-map=${it}=." }
            android.defaultConfig.externalNativeBuild.cmake.cFlags(*mappings)
            android.defaultConfig.externalNativeBuild.cmake.cppFlags(*mappings)
        }
    }
}
GRADLE
(cd android && ./gradlew assembleRelease -PreactNativeArchitectures="${AVOID_MAPS_ARCH:-arm64-v8a}" --init-script "$NATIVE_PATH_INIT" --no-daemon --max-workers=4)
mkdir -p artifacts
APK_PATH="artifacts/avoid-maps.apk"
if [[ "${AVOID_MAPS_ARCH:-arm64-v8a}" != "arm64-v8a" ]]; then APK_PATH="artifacts/avoid-maps-${AVOID_MAPS_ARCH}.apk"; fi
cp android/app/build/outputs/apk/release/app-release.apk "$APK_PATH"
(cd artifacts && sha256sum "$(basename "$APK_PATH")") > "$APK_PATH.sha256"
"$ANDROID_HOME/build-tools/36.0.0/apksigner" verify --verbose --print-certs "$APK_PATH"
"$ANDROID_HOME/build-tools/36.0.0/zipalign" -c -P 16 -v 4 "$APK_PATH" | tail -1
