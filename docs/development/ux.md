# Map and interaction contract

The map is the starting point. Search, discovery, transport and saved places are deliberate tasks; regional data coverage does not define the user's destination or interests.

## Launch and location

- Start with an unselected map, a search field, a location control and access to transport, saved places and settings. Show result pins, category choices and result sheets after the corresponding action.
- Until a usable location is available, reopen the last map view stored on the device (rounded to about 100 m, removable in Privacy e fonti), else a Turin overview labelled **Panoramica di Torino**. A fallback center is a viewport, never an inferred user position, favourite place or route origin labelled as the user's position.
- Locate centres the camera on the first fix it produces, including a fix that arrives after Android's permission dialog suspended the request. Panning, opening a place or stop, or searching withdraws that intent.
- When location is already authorized, acquire a fresh foreground fix. Keep manual map browsing available during acquisition and after failure. Preserve an intentional map movement while a request is pending.
- Distinguish permission denied, device location disabled, acquisition in progress, unavailable fix and stale or inaccurate navigation fixes. An absent coordinate alone does not establish that GPS is disabled. Pair failures with a relevant retry or settings action.
- Request additional precision only for a task that needs it. Navigation requires its own fresh precise fix; a browsing coordinate or map center cannot satisfy that requirement.

## Search and sheets

- An empty search has no selected category or automatic discovery results. Put category shortcuts inside the search interaction. Category selection, typed search, transport and saved places reveal their own results and pins.
- Clearing or closing a search returns to the unselected map. Map movement alone does not begin discovery; searching a changed area is explicit.
- Submitting a search or choosing a category frames its leading nearby results once, above the sheet. Panning before they arrive keeps the user's view; typing alone never moves the map.
- Route planning starts from a fresh position or a deliberately chosen origin. Cancelling origin selection returns to the destination; a fallback viewport never silently becomes the departure point.
- Give one task the sheet at a time: results, place, stop, route planning or settings. Keep the map usable alongside it and provide a clear return to the map. Sheet titles and actions take precedence over explanatory text. Keep transport and saved shortcuts on the neutral map; task cards replace that chrome. Empty search uses a horizontal shortcut row.
- List distances are measured from the device when its fix is under five minutes old; otherwise they are measured from the centre the map currently shows and say **dal centro mappa**. A selected stop or place shows a distance only from the device. Show OpenStreetMap and Overture categories with Italian labels and a generic fallback, never a raw tag.
- Show coverage boundaries, result limits and data warnings with the results they explain. Keep mandatory map attribution accessible. Preserve place provenance, source timestamps, and live, scheduled, stale and unavailable distinctions in their relevant detail views.
- Keep Italian action names stable and direct. Use compact system typography and restrained surfaces; the geographic content supplies the visual detail. Maintain accessible text contrast and touch targets when reducing chrome.

## Appearance

Appearance offers **Sistema**, **Chiaro** and **Scuro**; Sistema is the default and follows Android's dark theme. The choice is stored on the device. An unreadable saved choice falls back to Sistema without overwriting it until the user chooses again. `src/theme` resolves the choice once. On Android, the colours come from the `:root` and `prefers-color-scheme: dark` variables in `global.css`. NativeWind binds them to the scheme set through `Appearance`, so a live switch repaints every view. Web sets the same variables inline. Components use semantic NativeWind colours (`bg-surface`, `bg-surface-raised`, `text-primary`, `text-secondary`, `border-divider`, `bg-action`/`text-on-action`, `text-caution`, `text-danger`, `text-success`, and transit `text-live`, `text-scheduled`, `text-stale`, `text-cancelled`), never literal hex classes or `dark:` variants. Native props, icons and map layers read the same values from `useTheme()`. Tests hold every text role to WCAG AA (4.5:1) on every surface in both palettes. Live, scheduled, stale and cancelled states keep their text labels; colour supports them but never carries them alone.

The basemap follows the resolved appearance: `avoid-light` or `avoid-dark`, both generated from the bundled OpenFreeMap Liberty document ([notice](../../src/theme/map-styles/NOTICE.md)). The basemap is nearly greyscale: hierarchy comes from lightness and width, with a faint green hint on parks. POIs are small grey dots with text, transit stops are rings and stations bold rings. Colour on the map belongs to app overlays: the route (white in dark, black in light, with a contrasting casing), selection rings in the same ink, the position dot and live states in green, and caution in amber. Key amenities name their category in words, never by colour. Status bar icons, navigation bar buttons and the window background follow the same choice.

## Sheet and shared components

`src/ui/Sheet.tsx` is the only importer of the sheet library (`@gorhom/bottom-sheet`). The task sheet rests at **peek**, **half** or **full**; heights are fixed per task and window (`sheet-model.ts`), so loading content never moves it. Lists, stops and routes open at half, a place and the empty search peek, Privacy e fonti opens full. Drag, the header expand/collapse button and the handle (an adjustable control for TalkBack) move between the same snaps. Android Back lowers a sheet the user raised above its resting height, then unwinds the task stack. The header shows Close (to the map) and adds Back only when the task beneath is not the map. Camera padding follows the sheet's target height, re-centred on the camera's actual centre. When a short window gives two snaps the same height, the sheet library sees one detent and the logical snap stays consistent. The sheet is clipped above the navigation bar. Long lists use the sheet's virtualized list.

Build screens from `src/ui`: Button (primary, secondary, quiet), IconButton (48 dp, required label), ListRow, Chip and SegmentedControl, SectionHeader, SheetHeader, Notice (info, caution, danger, success; icon and wording, never colour alone) and TransitLineBadge. Line badges use the operator's route colour when supplied, with an AA text fallback, and distinct shapes and glyphs for metro, tram, bus and rail. GTT departures carry only line names, so only the metro (`M1`) is classified. Body text is 16 sp; departure times are larger tabular numerals. In a stop sheet, departures come first and saving is an icon action.

## Brand

The app belongs to the avoid.quest family. Launcher name: **avoid maps** (development: **avoid maps dev**). Wordmark: `maps.avoid.quest` in Geist Mono, lowercase, in About within Privacy e fonti.

- **Colour:** pure black chrome (`chrome`, the window, system bars and guidance bar) over near-black zinc surfaces. White is the only accent: the primary action is a white pill with black text. Light mirrors this with off-white surfaces and a black pill. Colour carries meaning only: signal green for live/verified, amber for caution and stale data, red for disruption and cancellations. Everything else is greyscale; transit line colours appear only on small badges. Every state keeps its text label.
- **Type:** Geist Sans for UI text (16 sp body), Geist Mono with tabular figures for times, minutes, distances, stop codes and accuracy, and Mona Sans (heavy, letter-spacing about −0.04 em) for sheet titles, departure minutes and the next-turn distance. Use `Text`, `Num` and `Display` from `src/ui`; a test rejects `Text` imported directly from React Native. Font scaling stays enabled.
- **Minimalism:** hairline dividers instead of cards, few filled surfaces and no decorative shadows. Lists read like a departure board: badge or glyph, then name, then a right-aligned mono value.
- **Live switches:** pressable surfaces and dividers take colours inline from `useThemeColors()` (`src/ui/control-styles.ts`, `useHairlines()`). Android did not repaint NativeWind colour classes on `Pressable` after a live scheme change. A test rejects colour classes on pressables and `border-divider`.
- **Mark:** `assets/brand/mark.svg` adapts the avoid.quest sun disc cut by two horizon lines, bolder for launcher sizes. `scripts/render-brand-assets.mjs` renders the icon, adaptive foreground, Android 13+ themed (monochrome) layer, splash icon and favicon reproducibly. The Android 12+ splash masks its icon to a circle, so the splash shows the mark only, on black.

## Stable geometry and camera intent

Keep one map mounted across browsing, sheet expansion and navigation. Small inset task cards overlay that viewport at a compact height or an explicitly expanded height; keyboard resizing may reduce the sheet's available space while preserving the map. Status, loading and error updates change content inside reserved regions. Anchor route actions outside scrolling details, and keep navigation instruction, trip summary, Retry and Stop geometry independent of position quality.

Frame a planning route once for the requested origin, destination and mode, or when the user selects an alternative or requests the full route. Refreshes update its line without reframing. Panning consumes any pending frame so a late response respects the chosen view. Camera padding must leave visible map space on narrow, expanded and side-sheet layouts. Navigation follows accepted positions until the user pans; Locate deliberately resumes following.

Keep current quality separate from retained coordinates. The native snapshot supplies the last accepted accuracy and current usability/problem, not the accuracy of rejected samples. Label retained numbers **Ultima posizione accettata** and paused maneuvers **Ultima indicazione**; keep their geometry while guidance is suspended. Provider selection and accuracy/age policy are separate concerns.

## Active guidance

Prioritize the next instruction, map, current problem and Stop action. Present recovery beside the problem. Keep voice status and setup in navigation details. Anchor the active transit confirmation beside Stop. Preserve transit confirmation controls and uncertainty when simplifying the layout. Route previews remain planning; native voice, position and background behavior require the separate [navigation acceptance checks](navigation.md).

## Task model and modules

`src/features/app/task-model.ts` is the source of truth for which task owns the sheet: one root (map, search, Trasporti or Salvati), the detail tasks opened from it (place, stop, planner, journey stop) and Privacy e fonti on top. The sheet's back arrow closes the top task and returns to the task beneath with its context. Android Back first dismisses the keyboard and lets active guidance confirm Stop. Then it cancels origin picking as its own step, unwinds one task, and at a root collapses an expanded sheet before returning to the map. The reducer holds task choices: the selected place, stop and destination, and the planner's chosen origin with its step. Typed text, location requests and their status, fetched payloads and refresh timing stay in feature hooks.

Each feature under `src/features/` exposes a hook and context with intent-level actions such as `openPlace`, `openStop`, `beginRoute` and `startGuidance`. Request controllers react to task transitions synchronously: a task moved behind another task suspends, and a closed or replaced planner resets. `AppProviders` composes features in dependency order; `AppShell` lays out the map, controls and sheet. Shared primitives live in `src/ui/`.

## Acceptance

1. Cold launch with authorized, denied and disabled location. Confirm the neutral map and accurate acquisition/failure states; verify no category selection, discovery pins or result sheet before an action. Repeat without a usable fix.
2. Pan while location acquisition is pending. Confirm the user's chosen view remains stable, then use the location control to recenter explicitly.
3. Open search, choose a category, type a place/address, select a result, and close or clear search. Confirm pins and sheets follow those actions and the idle map returns cleanly. Repeat with Android Back and the keyboard open.
4. Open transport, saved places and route planning. Confirm each remains reachable, manual origin selection works without location, and relevant source/freshness information survives the compact layout.
5. Replay navigating → inaccurate → stale → navigating, route loading → success → refresh failure, and expand/collapse. Compare map, sheet and primary-action bounds; asynchronous changes must not move them. Pan before a route response and after a result, then refresh; confirm the camera stays put. Verify explicit route framing and recentering still work.
6. Inspect narrow screens, large text and screen-reader labels. Confirm search, recenter, back/close and navigation Stop remain reachable without covering required attribution. Record browser and device evidence separately.
7. Switch Sistema/Chiaro/Scuro while browsing, with a route preview, and during navigation, then change the Android theme with Sistema selected. Confirm the map keeps its camera, route, markers and position, the system bars stay legible, and the choice survives a restart.
