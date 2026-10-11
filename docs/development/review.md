# Review and public test reports

Prepare changes on a feature branch and open a PR against `main`. Split independent changes when that makes review clearer; use dependent PRs when a later change requires the earlier interface. Coordinate branch changes in a shared checkout with any running build or agent. Register each opened PR with the active work thread when that integration is available.

Before handoff, run `bun run verify` and inspect the affected flow. Native dependencies require a rebuilt APK with bundled JavaScript, signature/alignment checks, and a review of Google-free location and permissions. Ask an independent reviewer to inspect the final diff for the requested behavior, regressions, data freshness and privacy boundaries. Resolve findings and rerun checks affected by fixes. Record commands, results and device checks still outstanding in the PR.

Signing keys remain outside Git and release artifacts; CI verifies source and receives no release credentials. Dataset licences and notices remain separate from the application-source licence.

## Reporting a device failure

Use a public destination or stop for reproduction. Include app version/build, Android version, approximate/precise/denied location permission, online/offline state, steps, expected behavior and actual behavior. Reports and PR comments are public. Keep home/work locations, favourites, private searches, personal screenshots, device identifiers and credentials out of the report. Full device logs are unnecessary.

In builds with **Diagnostica locale**, open **Privacy e fonti**, preview the report and copy it only when you choose to share it. The report contains bounded local status events and public build metadata; it excludes searches, coordinates, destinations, raw errors, request URLs/headers and device identifiers. Copying sends no network request. Review the visible text before pasting into an issue. The switch and clear action control the local history. Version 0.1.1 predates this diagnostics UI.

Device evidence must distinguish a successful install from a successful launch, a route planning preview from navigation, and an emulator check from physical-device behavior. Request outcomes and retrieval timestamps do not prove provider freshness or location accuracy.
