// Renders the navigation puck and maneuver glyphs from the SVG sources below into PNGs at 1×/2×/3×.
// Deterministic: resvg, no system fonts, fixed sizes. Original artwork in the brand's black/white
// with signal green only for the live position centre.
// Usage: node scripts/render-navigation-assets.mjs [--check]   (--check fails if committed PNGs differ)
import { Resvg } from '@resvg/resvg-js';
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const out = `${root}assets/navigation/`;

// Brand inks (src/theme/palette.ts): light map ink/casing and live green, dark the same inverted.
const inks = {
  light: { ink: '#09090B', edge: '#FFFFFF', live: '#066F44', muted: '#8A8A93' },
  dark: { ink: '#FFFFFF', edge: '#000000', live: '#3DDC97', muted: '#8E8E96' },
};

/** 48 dp canvas; the image centre is the position, so map rotation pivots on it. */
const puck = {
  // A broad wedge with a notched tail: heading is readable at a glance and under pitch.
  wedge: ({ ink, edge, live }) => `<path d="M24 5 L39.5 39 L24 31.5 L8.5 39 Z" fill="${ink}" stroke="${edge}" stroke-width="3.2" stroke-linejoin="round"/>`
    + `<circle cx="24" cy="25" r="4.6" fill="${live}" stroke="${edge}" stroke-width="1.6"/>`,
  // Direction unknown: a disc, never a guessed heading.
  dot: ({ ink, edge, live }) => `<circle cx="24" cy="24" r="12" fill="${ink}" stroke="${edge}" stroke-width="3.2"/>`
    + `<circle cx="24" cy="24" r="5.2" fill="${live}" stroke="${edge}" stroke-width="1.6"/>`,
  // Last accepted position while guidance is paused: hollow, grey, no live green.
  retained: ({ edge, muted }) => `<circle cx="24" cy="24" r="11" fill="${edge}" fill-opacity="0.75" stroke="${muted}" stroke-width="3" stroke-dasharray="5 3.4"/>`
    + `<circle cx="24" cy="24" r="3.4" fill="${muted}"/>`,
};

const outputs = {};
for (const [name, draw] of Object.entries(puck)) {
  for (const [scheme, colors] of Object.entries(inks)) {
    for (const scale of [1, 2, 3]) {
      const size = 48 * scale;
      outputs[`puck-${name}-${scheme}${scale === 1 ? '' : `@${scale}x`}.png`] =
        `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 48 48">${draw(colors)}</svg>`;
    }
  }
}

/**
 * Maneuver glyphs: single-ink (tinted at runtime), 48 dp, drawn for left turns and right-hand
 * traffic; the interface mirrors them for right turns and left-hand circulation.
 */
const W = 'stroke="#FFFFFF" fill="none" stroke-linecap="round" stroke-linejoin="round"';
const head = (x, y, angle) => `<path transform="translate(${x} ${y}) rotate(${angle})" d="M0 -7 L8 5 L-8 5 Z" fill="#FFFFFF" stroke="#FFFFFF" stroke-width="2" stroke-linejoin="round"/>`;
const thick = d => `<path d="${d}" ${W} stroke-width="5.5"/>`;
const thin = d => `<path d="${d}" ${W} stroke-width="3" stroke-opacity="0.45"/>`;
// Roundabout ring centre and entry; the exit arm leaves at `exitAngle` (compass degrees, screen).
const ring = { x: 24, y: 23, r: 7.5 };
function roundabout(exitAngle) {
  const rad = deg => (deg - 90) * Math.PI / 180;
  const on = deg => [ring.x + ring.r * Math.cos(rad(deg)), ring.y + ring.r * Math.sin(rad(deg))];
  const [ex, ey] = on(exitAngle);
  const [ox, oy] = [ring.x + (ring.r + 8) * Math.cos(rad(exitAngle)), ring.y + (ring.r + 8) * Math.sin(rad(exitAngle))];
  // Counter-clockwise from the entry to the exit: decreasing compass angle.
  // Right-hand traffic enters on the right of the approach (160°), so a U-turn exit stays apart.
  const entry = 160;
  const sweep = ((entry - exitAngle) % 360 + 360) % 360 || 360;
  const large = sweep > 180 ? 1 : 0;
  const [sx, sy] = on(entry);
  return `<circle cx="${ring.x}" cy="${ring.y}" r="${ring.r}" ${W} stroke-width="3" stroke-opacity="0.45"/>`
    + thick(`M${sx.toFixed(2)} 45 L${sx.toFixed(2)} ${sy.toFixed(2)} A${ring.r} ${ring.r} 0 ${large} 0 ${ex.toFixed(2)} ${ey.toFixed(2)} L${ox.toFixed(2)} ${oy.toFixed(2)}`)
    + head(ox, oy, exitAngle);
}
const glyphs = {
  straight: thick('M24 45 L24 12') + head(24, 9, 0),
  'slight-left': thick('M28 45 L28 28 L16 14') + head(14, 11.5, -40),
  left: thick('M30 45 L30 26 Q30 20 24 20 L12 20') + head(9, 20, -90),
  'sharp-left': thick('M32 45 L32 16 L15 33') + head(13, 35, -135),
  'uturn-left': thick('M31 45 L31 18 A7.5 7.5 0 0 0 16 18 L16 30') + head(16, 33, 180),
  'fork-left': thin('M24 45 L24 30 L34 12') + thick('M24 45 L24 30 L14 14') + head(12.5, 11.5, -30),
  'merge-left': thin('M16 45 L16 6') + thick('M34 45 L34 32 Q34 24 24 18 L24 12') + head(24, 9, 0),
  'ramp-left': thin('M30 45 L30 6') + thick('M30 45 L30 30 L16 16') + head(14, 13.5, -45),
  'roundabout-right': roundabout(90),
  'roundabout-slight-right': roundabout(45),
  'roundabout-straight': roundabout(0),
  'roundabout-slight-left': roundabout(315),
  'roundabout-left': roundabout(270),
  'roundabout-sharp-left': roundabout(225),
  'roundabout-uturn': roundabout(210),
  arrive: thick('M24 45 L24 26') + '<circle cx="24" cy="16" r="8.5" fill="none" stroke="#FFFFFF" stroke-width="5"/><circle cx="24" cy="16" r="2.5" fill="#FFFFFF"/>',
  'arrive-left': thick('M30 45 L30 18') + '<circle cx="15" cy="20" r="7.5" fill="none" stroke="#FFFFFF" stroke-width="4.5"/><circle cx="15" cy="20" r="2.2" fill="#FFFFFF"/>',
  // Unknown maneuver: a neutral marker; the supplied text carries the instruction.
  unknown: '<circle cx="24" cy="24" r="13" fill="none" stroke="#FFFFFF" stroke-width="5"/><circle cx="24" cy="24" r="4.5" fill="#FFFFFF"/>',
};
for (const [name, body] of Object.entries(glyphs)) {
  for (const scale of [1, 2, 3]) {
    const size = 48 * scale;
    outputs[`maneuver-${name}${scale === 1 ? '' : `@${scale}x`}.png`] =
      `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 48 48">${body}</svg>`;
  }
}

// Map symbols: the turn arrowhead (inverse of the route ink, so it reads on top of the route) and
// the one-way chevron restored for driving. Both point up and are rotated on the map.
const arrowhead = { light: ['#FFFFFF', '#09090B'], dark: ['#000000', '#FFFFFF'] };
const oneway = { light: '#71717A', dark: '#8E8E96' };
for (const scheme of ['light', 'dark']) {
  const [fill, edge] = arrowhead[scheme];
  for (const scale of [1, 2, 3]) {
    const suffix = scale === 1 ? '' : `@${scale}x`;
    outputs[`arrowhead-${scheme}${suffix}.png`] = `<svg xmlns="http://www.w3.org/2000/svg" width="${32 * scale}" height="${32 * scale}" viewBox="0 0 32 32">`
      + `<path d="M16 3 L29 26 L16 21 L3 26 Z" fill="${fill}" stroke="${edge}" stroke-width="2.5" stroke-linejoin="round"/></svg>`;
    outputs[`oneway-${scheme}${suffix}.png`] = `<svg xmlns="http://www.w3.org/2000/svg" width="${16 * scale}" height="${16 * scale}" viewBox="0 0 16 16">`
      + `<path d="M4 11 L8 5 L12 11" fill="none" stroke="${oneway[scheme]}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
  }
}

const check = process.argv.includes('--check');
mkdirSync(out, { recursive: true });
let stale = 0;
for (const [file, svg] of Object.entries(outputs)) {
  const png = new Resvg(svg, { font: { loadSystemFonts: false }, shapeRendering: 2, background: undefined }).render().asPng();
  const path = `${out}${file}`;
  if (check) {
    let current = null;
    try { current = readFileSync(path); } catch {}
    const same = current && createHash('sha256').update(current).digest('hex') === createHash('sha256').update(png).digest('hex');
    if (!same) { stale += 1; console.error(`stale: assets/navigation/${file}`); }
  } else {
    writeFileSync(path, png);
  }
}
if (!check) console.log(`wrote ${Object.keys(outputs).length} files to assets/navigation/`);
if (stale) process.exit(1);
