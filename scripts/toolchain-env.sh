# Source this file to select the task-local toolchain, when present.
TOOLCHAIN_DIR="${AVOID_MAPS_TOOLCHAIN:-$HOME/.local/share/avoid-maps/toolchain}"
if [[ -d "$TOOLCHAIN_DIR/node-v22.23.3-linux-x64/bin" ]]; then
  export PATH="$TOOLCHAIN_DIR/node-v22.23.3-linux-x64/bin:$PATH"
fi
if [[ -z "${JAVA_HOME:-}" ]]; then
  JAVA_HOME="$(find "$TOOLCHAIN_DIR" -maxdepth 1 -type d -name 'jdk-*' | sort | tail -1)"
  export JAVA_HOME
fi
export ANDROID_HOME="${ANDROID_HOME:-$TOOLCHAIN_DIR/android-sdk}"
export PATH="$JAVA_HOME/bin:$ANDROID_HOME/platform-tools:$PATH"
export EXPO_NO_TELEMETRY=1
