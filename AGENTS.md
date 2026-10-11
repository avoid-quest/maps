# Avoid Maps

Android maps app with public source and signed releases. Keep signing material and private user data outside Git. Public docs describe product capabilities, never user-specific motivations, device ownership, private paths or personal identity. Prefer direct keyless public services and local state; explain measured benefits before introducing accounts or paid providers.

- **Local context:** read `.local/project-context.md` when present before planning changes; keep its content out of public files.
- **Scope:** read `docs/research/recommendation.md` when changing capabilities or providers. It supersedes the earlier fork proposal.
- **Services:** read `docs/research/online-services.md` for search/routing policy, `docs/research/turin-transit-data.md` for arrivals, and `docs/research/place-discovery.md` for business data. Preserve attribution, source timestamps, and uncertainty in results.
- **Tooling:** read `docs/development/tooling.md` when changing dependencies, validation commands, or CI. Use the pinned Bun lockfile and preserve Node for Expo native tooling.
- **Android:** read `docs/development/android.md` before changing native dependencies, location, signing, or APK delivery. Verify Google-free location and bundled release JavaScript.
- **UI:** use NativeWind for routine layout and styling, with native map layers for geographic rendering. Keep Italian copy clear and distinguish live, scheduled, stale, and unavailable data.
- **Review:** read `docs/development/review.md` before preparing a branch or PR. Deliver changes through reviewable PRs; use a stack when changes require dependent branches.

Before handing off a change, run `bun run verify` and any change-specific checks and inspect affected user flows. Report the commands run, unresolved failures, and device-only checks explicitly. Describe route previews as planning until spoken guidance and background navigation are independently implemented and tested.
