// Renders the app icon, Android adaptive/themed icon layers, splash image and web favicon from
// assets/brand/mark.svg. Deterministic: resvg with bundled fonts only (no system fonts), fixed sizes.
// Usage: node scripts/render-brand-assets.mjs [--check]   (--check fails if committed PNGs differ)
import { Resvg } from '@resvg/resvg-js';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const brand = `${root}assets/brand/`;
const mark = readFileSync(`${brand}mark.svg`, 'utf8');
const inner = mark.replace(/^[\s\S]*?<svg[^>]*>/, '').replace(/<\/svg>\s*$/, '').replace(/<!--[\s\S]*?-->/g, '');

/** The mark placed in a square canvas: `scale` is the mark box as a fraction of the canvas. */
function compose(size, { background = null, scale = 1 } = {}) {
  const box = size * scale;
  const offset = (size - box) / 2;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">`
    + (background ? `<rect width="${size}" height="${size}" fill="${background}"/>` : '')
    + `<svg x="${offset}" y="${offset}" width="${box}" height="${box}" viewBox="0 0 200 200">${inner}</svg></svg>`;
}

const outputs = {
  // Legacy/web icon: the full square is the artwork; launchers apply their own mask.
  'icon.png': compose(1024, { background: '#000000', scale: 1 }),
  // Adaptive layers: 108 dp canvas; the whole mark (horizon lines span 80% of its box) stays inside
  // the 66 dp safe zone: 0.76 × 0.8 × 108 dp ≈ 65.7 dp, so no launcher mask clips the lines.
  'adaptive-foreground.png': compose(1024, { scale: 0.76 }),
  // Android 13+ themed icon: alpha only; the launcher tints it.
  'adaptive-monochrome.png': compose(1024, { scale: 0.76 }),
  // Android 12+ splash icon: drawn inside a circular mask, so the mark only (no wordmark).
  'splash-icon.png': compose(1024, { scale: 0.9 }),
  'favicon.png': compose(48, { background: '#000000', scale: 1 }),
};

const check = process.argv.includes('--check');
let stale = 0;
for (const [file, svg] of Object.entries(outputs)) {
  const png = new Resvg(svg, { font: { loadSystemFonts: false }, shapeRendering: 2, background: undefined }).render().asPng();
  const path = `${brand}${file}`;
  if (check) {
    let current = null;
    try { current = readFileSync(path); } catch {}
    const same = current && createHash('sha256').update(current).digest('hex') === createHash('sha256').update(png).digest('hex');
    if (!same) { stale += 1; console.error(`stale: assets/brand/${file}`); }
  } else {
    writeFileSync(path, png);
    console.log(`wrote assets/brand/${file} (${png.length} bytes)`);
  }
}
if (stale) process.exit(1);
