import { Asset } from 'expo-asset';

/** Web: declare the bundled brand fonts per weight so `font-semibold` etc. select the right file. */
const faces: [family: string, weight: number, module: number][] = [
  ['Geist', 400, require('../../assets/fonts/Geist-Regular.ttf')],
  ['Geist', 500, require('../../assets/fonts/Geist-Medium.ttf')],
  ['Geist', 600, require('../../assets/fonts/Geist-SemiBold.ttf')],
  ['Geist', 700, require('../../assets/fonts/Geist-Bold.ttf')],
  ['GeistMono', 400, require('../../assets/fonts/GeistMono-Regular.ttf')],
  ['GeistMono', 500, require('../../assets/fonts/GeistMono-Medium.ttf')],
  ['GeistMono', 600, require('../../assets/fonts/GeistMono-SemiBold.ttf')],
  ['GeistMono', 700, require('../../assets/fonts/GeistMono-Bold.ttf')],
  ['MonaSans', 700, require('../../assets/fonts/MonaSans-Bold.ttf')],
  ['MonaSans', 800, require('../../assets/fonts/MonaSans-ExtraBold.ttf')],
  ['MonaSans', 900, require('../../assets/fonts/MonaSans-Black.ttf')],
];

export function registerBrandFonts(): void {
  if (typeof document === 'undefined' || document.getElementById('brand-fonts')) return;
  const style = document.createElement('style');
  style.id = 'brand-fonts';
  style.textContent = faces.map(([family, weight, module]) =>
    `@font-face{font-family:${family};font-weight:${weight};font-style:normal;font-display:swap;src:url(${JSON.stringify(Asset.fromModule(module).uri)}) format("truetype");}`).join('\n');
  document.head.appendChild(style);
}
