# Development checks

Bun is the package manager and the typecheck/test runner. Its version is pinned in `package.json`; `.tool-versions` selects the same version for mise. Install dependencies with `bun install --frozen-lockfile`. Commit `bun.lock` whenever dependencies change.

`bun check` is Bun 1.4.3's native TypeScript checker, introduced in the [official 1.4.3 release](https://bun.com/blog/bun-v1.4.3) and documented [here](https://bun.com/docs/runtime/check). It checks types; ESLint separately checks React Hooks and Expo code rules. Keep the aggregate command named `verify`: a package script named `check` shadows Bun's native command.

Use `bun run verify` before handing off code. It runs the native typecheck, ESLint with zero warnings permitted, and all fixture tests through Bun's native test runner. The package scripts also expose each check separately, a TypeScript compiler comparison and live service probes. Generated datasets, native output and research archives are excluded from linting.

Run `bun run doctor` after Expo dependency/configuration changes. It runs the SDK compatibility check without an interactive fix prompt, then the pinned Expo Doctor. Use Expo’s installer with Bun for intentional dependency updates.

The Bun suite also invokes the Python standard-library place-package regressions. Python 3 prepares data and renders extraction SQL; executing the Overture extract needs DuckDB with its `httpfs` extension. See [data preparation](data.md) for pinned inputs, independent place/GTT refreshes and package validation.

The tests retain their `node:test` imports and run successfully under Bun, including mock-timer checks for stalled network response bodies. No fixtures were weakened to migrate the runner. CSS side-effect imports have ambient declarations and the TypeScript configuration loads Node, React and NativeWind types explicitly for the native checker.

Node 22 remains required for Expo/Metro, native build tooling and the small worker-asset postinstall script. Select the toolchain before running development commands, following [Android prerequisites](android.md#local-prerequisites). Bun runs package scripts without `--bun`, allowing Node-shebang CLIs to use Node. Android prebuild uses `--no-install`, preserving Bun's lockfile. Read [android.md](android.md) for SDK and signing setup, and [navigation.md](navigation.md#dependency-and-distribution-boundary) when changing the pinned native core or Kotlin/R8/desugaring versions. Native JVM navigation policy tests run separately through Gradle; Bun fixtures and browser simulations do not execute Ferrostar/JNA, GPS, TTS or Android services.

Use `bun start` with the installed Expo development client for UI/JavaScript iteration on Android. Read the [development-build workflow](android.md#expo-development-build) for LAN connection, side-by-side installation, native rebuilds and debugger selection. Browser preview remains useful for layout and web behaviour; the development client runs the actual Android map and native module.

Metro's standard `resolver.blockList` excludes generated Android build/cache directories. This prevents a reproduced `ENOENT` watcher failure when Gradle replaces the local native module's build output while Metro is running. Native source remains available to the Android build; generated Gradle output is not JavaScript input.

Road guidance policy changes also require `cargo test --locked --manifest-path tests/navigation-core/Cargo.toml`. This [separate harness](../../tests/navigation-core/README.md) pins Ferrostar 0.57.0 source and a Cargo lockfile, and replays actual host-core trajectories using the packaged Android policy. Rust/Cargo is a test-only prerequisite; it does not replace Bun/Node or prove Android JNI/JNA, GPS, TTS or service behavior.

The GitHub workflow performs a frozen install and the same verification on pull requests, main pushes and manual dispatch. It has read-only repository permissions and uses neither signing secrets nor a cloud Android build service.
