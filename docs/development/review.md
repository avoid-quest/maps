# Review and public test reports

Prepare changes on a feature branch and open a PR against `main`. Split independent changes when that makes review clearer; use dependent PRs when a later change requires the earlier interface. Coordinate branch changes in a shared checkout with any running build or agent. Register each opened PR with the active work thread when that integration is available.

Before handoff, run `bun run verify` and inspect the affected flow. Native dependencies require a rebuilt APK with bundled JavaScript, signature/alignment checks, and a review of Google-free location and permissions. Ask an independent reviewer to inspect the final diff for the requested behavior, regressions, data freshness and privacy boundaries. Resolve findings and rerun checks affected by fixes. Record commands, results and device checks still outstanding in the PR.

Signing keys remain outside Git and release artifacts; CI verifies source and receives no release credentials. Dataset licences and notices remain separate from the application-source licence.

## Reporting a device failure

Use a public destination or stop for reproduction. Include app version/build, Android version, approximate/precise/denied location permission, online/offline state, steps, expected behavior and actual behavior. Reports and PR comments are public. Keep home/work locations, favourites, private searches, personal screenshots, device identifiers and credentials out of the report. Avoid full device logs; share a previewed local diagnostic report when that feature is available.

Device evidence must distinguish a successful install from a successful launch, a route planning preview from navigation, and an emulator check from physical-device behavior. Request outcomes and retrieval timestamps do not prove provider freshness or location accuracy.
