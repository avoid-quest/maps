# Bundled fonts

| Files | Family | Source | Licence |
| --- | --- | --- | --- |
| `Geist-{Regular,Medium,SemiBold,Bold}.ttf` | Geist Sans | [vercel/geist-font](https://github.com/vercel/geist-font) release v1.9.0 (`geist-font-v1.9.0.zip`, SHA-256 `1f2dd9ea90e68d0358a1d234a5f156807b2c3e0e295d78d87980a6dbad1fa58c`) | SIL OFL 1.1, [`LICENSES/Geist-OFL.txt`](LICENSES/Geist-OFL.txt) |
| `GeistMono-{Regular,Medium,SemiBold,Bold}.ttf` | Geist Mono | same release | same licence |
| `MonaSans-{Bold,ExtraBold,Black}.ttf` | Mona Sans (normal width) | [github/mona-sans](https://github.com/github/mona-sans) release v2.0.27 (`mona-sans-static-v2.0.27.zip`, SHA-256 `aa44edb86d4848f071ff0b36bbb79041eacf23f5b6ea9b2ff65463e35281b4c3`) | SIL OFL 1.1 with Reserved Font Name "Mona", [`LICENSES/MonaSans-OFL.txt`](LICENSES/MonaSans-OFL.txt) |

The static TTFs are copied unmodified from the release archives. Android embeds them through the `expo-font` config plugin as XML font families (`Geist`, `GeistMono`, `MonaSans`), so `fontWeight` selects the file; the web build declares the same families with `@font-face` (`src/theme/fonts.web.ts`). The licence texts are shown offline under **Privacy e fonti › Fonti e licenze › Caratteri** (`src/theme/font-notices.json`, checked against these files by `src/theme/brand-assets.test.ts`). These notices are separate from the application-source licence.
