# Ferrostar core trajectory regressions

Run from the repository root with a Rust toolchain and Cargo installed:

```sh
cargo test --locked --manifest-path tests/navigation-core/Cargo.toml
```

Rust is a test-only prerequisite, separate from the Bun/Node application toolchain. The manifest declares Rust 1.88 or later; the recorded host run used 1.98.1. The first run downloads the pinned Git source and locked crates. Generated build output is ignored.

The harness executes the actual Ferrostar **0.57.0** Rust navigation controller, pinned to the tag's source commit `4e2d7f647952c0a4060efd584e6edfc6148092b9`. It consumes the same [road guidance policy](../../modules/avoid-navigation/android/src/main/assets/road-guidance-policy.json) embedded in the Android module's `BuildConfig`.

Synthetic trajectories cover sparse bicycle/car fixes around a corner, pedestrian sidewalk offset, step/deviation analysis at accepted accuracy boundaries, and a three-metre final step that must finish without travelling beyond the destination. Kotlin policy tests independently check rejection of fixes above the shared accuracy limit; TypeScript tests check that retained positions cannot be reused for transit replanning after native confidence is lost.

These host-core regressions do not load the published Android library through JNA, exercise the Android bridge, or validate physical GPS, voice timing or service lifetime. Keep those acceptance checks separate, as described in [navigation.md](../../docs/development/navigation.md).
