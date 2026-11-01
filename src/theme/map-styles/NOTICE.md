# Bundled basemap style

The app's two basemaps, `avoid-dark` and `avoid-light`, are derivative works of OpenFreeMap Liberty. The upstream document is bundled verbatim so a remote style edit cannot change the app's map, and both brand styles are generated from it in code at startup. Vector tiles, sprites, glyphs and the TileJSON attribution string still come from the public OpenFreeMap service at `tiles.openfreemap.org`; the map's attribution control continues to show **OpenFreeMap © OpenMapTiles Data from OpenStreetMap**.

| File | Source URL | Retrieved | SHA-256 |
| --- | --- | --- | --- |
| `openfreemap-liberty.json` | https://tiles.openfreemap.org/styles/liberty | 2026-11-01 | `408245464e76791801a64393c403433d09e8110eb9516040f8dc2b62584eee2a` |

The file is the unmodified response body. At retrieval, [hyperknot/openfreemap-styles](https://github.com/hyperknot/openfreemap-styles) `main` was commit `006ea5796803ba2df4330888836cb0a8f17473b4`. `map-style.test.ts` checks this hash.

**Modifications.** `brandRecipe` in [`../brand-basemap.ts`](../brand-basemap.ts) describes every change and `transformStyle` in [`../map-style-transform.ts`](../map-style-transform.ts) applies it. The recipe must account for every upstream layer (patched, kept or removed), and every property it replaces or drops must exist upstream, so a refreshed document with added, renamed or missing layers, or with changes to the properties the recipe touches, fails to build. Properties the recipe does not mention pass through; `map-style.test.ts` therefore also fails if any colour in the derived styles is outside the greyscale bound or any layer draws a sprite icon or pattern. The derived styles:

- replace Liberty's colours with greyscale palettes (`basemapInks`), with a faint green hint on parks;
- use local OpenStreetMap names instead of English names;
- replace POI sprite icons with small circle layers and text, and transit icons with stop and station rings and text; key amenities show an Italian category word;
- remove the place-dot, airport and road-shield sprite icons, keeping their text;
- remove the shaded-relief raster, one-way arrows, 3D building extrusions and United States shield layers; flat building footprints continue at all zooms;
- add dedicated stop and station layers for OpenMapTiles' `railway` POI class, which Liberty's transit layer does not match.

Sources, tile URLs, sprite and glyph endpoints are unchanged.

## Licences

- **OpenFreeMap styles repository:** MIT License, Copyright (c) 2023 Zsolt Ero.
- **Liberty:** fork of [maputnik/osm-liberty](https://github.com/maputnik/osm-liberty), itself a fork of OSM Bright, derived from Mapbox Open Styles. Code: BSD 3-Clause. Design: [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/), with the look and feel inherited from Mapbox Open Styles under [CC BY 3.0](https://creativecommons.org/licenses/by/3.0/). The avoid maps styles adapt this design as described above.
- **OpenMapTiles schema:** code BSD 3-Clause, design CC BY 4.0.
- **Map data:** © OpenStreetMap contributors, [ODbL](https://www.openstreetmap.org/copyright).
- **Fonts:** Noto Sans, SIL Open Font License 1.1. **Sprite:** Maki icons, CC0 1.0 (still referenced by the style; the derived layers draw no sprite images). **Natural Earth:** public domain (the derived styles no longer draw its raster).

The complete upstream licence texts, including copyright notices, redistribution conditions and disclaimers, are reproduced verbatim in [`LICENSES/`](LICENSES): `openfreemap-styles.md` (MIT), `osm-liberty.md` and `mapbox-gl-styles.md` (Liberty's BSD code licence, Mapbox Open Styles copyright (c) 2014 Mapbox, and its inherited CC BY 3.0 design notice). Retrieved 2026-11-01 from each repository's default branch. The app bundles this notice and these texts unchanged in `notices.json` and shows them offline under **Privacy e fonti › Fonti e licenze › Stili della mappa**; `map-style.test.ts` checks that the copies match these files.

These notices are separate from the application-source licence.
