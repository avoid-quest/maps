# Map and interaction contract

The map is the starting point. Search, discovery, transport and saved places are deliberate tasks; regional data coverage does not define the user's destination or interests.

## Launch and location

- Start with an unselected map, a search field, a location control and access to transport, saved places and settings. Show result pins, category choices and result sheets after the corresponding action.
- Use a broad geographic overview until a usable location is available. A fallback center is a viewport, never an inferred user position, favourite place or route origin labelled as the user's position.
- When location is already authorized, acquire a fresh foreground fix. Keep manual map browsing available during acquisition and after failure. Preserve an intentional map movement while a request is pending.
- Distinguish permission denied, device location disabled, acquisition in progress, unavailable fix and stale or inaccurate navigation fixes. An absent coordinate alone does not establish that GPS is disabled. Pair failures with a relevant retry or settings action.
- Request additional precision only for a task that needs it. Navigation requires its own fresh precise fix; a browsing coordinate or map center cannot satisfy that requirement.

## Search and sheets

- An empty search has no selected category or automatic discovery results. Put category shortcuts inside the search interaction. Category selection, typed search, transport and saved places reveal their own results and pins.
- Clearing or closing a search returns to the unselected map. Map movement alone does not begin discovery; searching a changed area is explicit.
- Route planning starts from a fresh position or a deliberately chosen origin. Cancelling origin selection returns to the destination; a fallback viewport never silently becomes the departure point.
- Give one task the sheet at a time: results, place, stop, route planning or settings. Keep the map usable alongside it and provide a clear return to the map. Sheet titles and actions take precedence over explanatory text.
- Show coverage boundaries, result limits and data warnings with the results they explain. Keep mandatory map attribution accessible. Preserve place provenance, source timestamps, and live, scheduled, stale and unavailable distinctions in their relevant detail views.
- Keep Italian action names stable and direct. Use compact system typography and restrained surfaces; the geographic content supplies the visual detail. Maintain accessible text contrast and touch targets when reducing chrome.

## Stable geometry and camera intent

Keep one map mounted across browsing, sheet expansion and navigation. Sheets overlay that viewport at a compact height or an explicitly expanded height; keyboard resizing may reduce the sheet's available space while preserving the map. Status, loading and error updates change content inside reserved regions. Anchor route actions outside scrolling details, and keep navigation instruction, trip summary, Retry and Stop geometry independent of position quality.

Frame a planning route once for the requested origin, destination and mode, or when the user selects an alternative or requests the full route. Refreshes update its line without reframing. Panning consumes any pending frame so a late response respects the chosen view. Camera padding must leave visible map space on narrow, expanded and side-sheet layouts. Navigation follows accepted positions until the user pans; Locate deliberately resumes following.

Keep current quality separate from retained coordinates. The native snapshot supplies the last accepted accuracy and current usability/problem, not the accuracy of rejected samples. Label retained numbers **Ultima posizione accettata** and paused maneuvers **Ultima indicazione**; keep their geometry while guidance is suspended. Provider selection and accuracy/age policy are separate concerns.

## Active guidance

Prioritize the next instruction, map, current problem and Stop action. Present recovery beside the problem. Keep voice availability visible, with longer setup explanations available on demand. Preserve transit confirmation controls and uncertainty when simplifying the layout. Route previews remain planning; native voice, position and background behavior require the separate [navigation acceptance checks](navigation.md).

## Acceptance

1. Cold launch with authorized, denied and disabled location. Confirm the neutral map and accurate acquisition/failure states; verify no category selection, discovery pins or result sheet before an action. Repeat without a usable fix.
2. Pan while location acquisition is pending. Confirm the user's chosen view remains stable, then use the location control to recenter explicitly.
3. Open search, choose a category, type a place/address, select a result, and close or clear search. Confirm pins and sheets follow those actions and the idle map returns cleanly. Repeat with Android Back and the keyboard open.
4. Open transport, saved places and route planning. Confirm each remains reachable, manual origin selection works without location, and relevant source/freshness information survives the compact layout.
5. Replay navigating → inaccurate → stale → navigating, route loading → success → refresh failure, and expand/collapse. Compare map, sheet and primary-action bounds; asynchronous changes must not move them. Pan before a route response and after a result, then refresh; confirm the camera stays put. Verify explicit route framing and recentering still work.
6. Inspect narrow screens, large text and screen-reader labels. Confirm search, recenter, back/close and navigation Stop remain reachable without covering required attribution. Record browser and device evidence separately.
