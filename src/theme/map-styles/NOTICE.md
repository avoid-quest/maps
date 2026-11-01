# Bundled basemap styles

These style documents are bundled so a remote style edit cannot change the app's map. Vector tiles, sprites, glyphs, Natural Earth raster tiles and the TileJSON attribution string still come from the public OpenFreeMap service at `tiles.openfreemap.org`; the map's attribution control continues to show **OpenFreeMap © OpenMapTiles Data from OpenStreetMap**.

| File | Source URL | Retrieved | SHA-256 |
| --- | --- | --- | --- |
| `openfreemap-liberty.json` | https://tiles.openfreemap.org/styles/liberty | 2026-11-01 | `408245464e76791801a64393c403433d09e8110eb9516040f8dc2b62584eee2a` |
| `openfreemap-dark.json` | https://tiles.openfreemap.org/styles/dark | 2026-11-01 | `c90dbfd0e428f7ea40740c29e789167c24f79e91327761960e08c44ca8f7795e` |

The files are unmodified response bodies. At retrieval, [hyperknot/openfreemap-styles](https://github.com/hyperknot/openfreemap-styles) `main` was commit `006ea5796803ba2df4330888836cb0a8f17473b4`. `map-style.test.ts` checks these hashes.

**Modifications.** The light map uses Liberty unchanged. The dark map applies paint-colour overrides and a motorway-label halo at runtime (`darkPaintOverrides` and `darkPaintAdditions` in `../map-style.ts`): a lifted neutral background, lighter roads, buildings and boundaries, and higher-contrast labels. Layer structure, filters, sources and fonts are unchanged.

## Licences

- **OpenFreeMap styles repository:** MIT License, Copyright (c) 2023 Zsolt Ero.
- **Liberty:** fork of [maputnik/osm-liberty](https://github.com/maputnik/osm-liberty), itself a fork of OSM Bright, derived from Mapbox Open Styles. Code: BSD 3-Clause. Design: [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/).
- **Dark:** OpenFreeMap's copy of [openmaptiles/dark-matter-gl-style](https://github.com/openmaptiles/dark-matter-gl-style) with fonts set to Noto Sans. Copyright (c) MapTiler.com & OpenMapTiles contributors; Copyright (c) 2015 CartoDB Inc. Derived from CartoDB Basemaps designed by Stamen and Paul Norman for CartoDB Inc. (CC BY 3.0). Code: BSD 3-Clause. Design: CC BY 4.0. This app modifies its colours as described above.
- **OpenMapTiles schema:** code BSD 3-Clause, design CC BY 4.0.
- **Map data:** © OpenStreetMap contributors, [ODbL](https://www.openstreetmap.org/copyright).
- **Fonts:** Noto Sans, SIL Open Font License 1.1. **Icons:** Maki, CC0 1.0. **Natural Earth:** public domain.

The complete upstream licence texts, including copyright notices, redistribution conditions and disclaimers, are reproduced verbatim in [`LICENSES/`](LICENSES): `openfreemap-styles.md` (MIT), `osm-liberty.md` and `mapbox-gl-styles.md` (Liberty's BSD code licence, Mapbox Open Styles copyright (c) 2014 Mapbox, and its inherited CC BY 3.0 design notice), and `dark-matter-gl-style.md` (BSD 3-Clause, CC BY 4.0 design, CartoDB Basemaps CC BY 3.0). Retrieved 2026-11-01 from each repository's default branch. These texts must also reach users of APK distributions through the in-app notices once the styles are wired into the map.

These notices are separate from the application-source licence.
