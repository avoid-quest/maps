# Development checks

Bun is the package manager and the typecheck/test runner. Its version is pinned in `package.json`; `.tool-versions` selects the same version for mise. Install dependencies with `bun install --frozen-lockfile`. Commit `bun.lock` whenever dependencies change.

`bun check` is Bun 1.4.3's native TypeScript checker, introduced in the [official 1.4.3 release](https://bun.com/blog/bun-v1.4.3) and documented [here](https://bun.com/docs/runtime/check). It checks types; ESLint separately checks React Hooks and Expo code rules. Keep the aggregate command named `verify`: a package script named `check` shadows Bun's native command.

Use `bun run verify` before handing off code. It runs the native typecheck, ESLint with zero warnings permitted, and all fixture tests through Bun's native test runner. The package scripts also expose each check separately, a TypeScript compiler comparison and live service probes. Generated datasets, native output and research archives are excluded from linting.

The Bun suite also invokes the Python standard-library place-package regressions. Python 3 prepares data and renders extraction SQL; executing the Overture extract needs DuckDB with its `httpfs` extension. See [data preparation](data.md) for pinned inputs, independent place/GTT refreshes and package validation.

The tests retain their `node:test` imports and run successfully under Bun, including mock-timer checks for stalled network response bodies. No fixtures were weakened to migrate the runner. CSS side-effect imports have ambient declarations and the TypeScript configuration loads Node, React and NativeWind types explicitly for the native checker.

Node 22 remains required for Expo/Metro, native build tooling and the small worker-asset postinstall script. Bun runs package scripts without `--bun`, allowing Node-shebang CLIs to use Node. Android prebuild explicitly invokes Node and uses `--no-install`, preserving Bun's lockfile. Read [android.md](android.md) for SDK and signing setup.

The GitHub workflow performs a frozen install and the same verification on pull requests, main pushes and manual dispatch. It has read-only repository permissions and uses neither signing secrets nor a cloud Android build service.
