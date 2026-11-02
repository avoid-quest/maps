/**
 * Fixed guidance chrome geometry. Every banner row has a height that depends only on the font
 * scale, so no instruction, status or pause changes the banner height (and with it the camera
 * anchor). Text in the banner is capped at `MAX_FONT_SCALE`. These linear reserves are an upper
 * bound used until `BannerReserveProbe` measures the real heights (Android scales large text
 * non-linearly, so measured rows are usually smaller).
 */
export const MAX_FONT_SCALE = 2;

export interface BannerMetrics {
  /** Glyph box (dp). */
  glyph: number;
  /** Distance line: 42 sp heavy, line height 1.15. */
  firstRow: number;
  /** Street (28 dp lines) and action (24 dp): two street lines, or one street line plus the action. */
  lines: number;
  /** The "Poi …" row. */
  thenRow: number;
}

export function bannerMetrics(fontScale: number): BannerMetrics {
  const scale = Math.max(1, Math.min(MAX_FONT_SCALE, Number.isFinite(fontScale) ? fontScale : 1));
  return {
    glyph: Math.round(44 * Math.min(scale, 1.3)),
    firstRow: Math.ceil(42 * 1.15 * scale),
    lines: Math.ceil(Math.max(2 * 28, 28 + 24, 2 * 24) * scale),
    thenRow: Math.ceil(26 * scale),
  };
}

/**
 * Bottom strip: one row (summary, voice, overview, Interrompi) when the summary has room for
 * "arrivo stimato / senza traffico" and the remaining time and distance; otherwise the summary
 * takes a full row above the controls, so no label or number is truncated.
 */
export function stripLayout(width: number, fontScale: number): 'row' | 'stacked' {
  const scale = Math.max(1, Number.isFinite(fontScale) ? fontScale : 1);
  return width >= 400 * scale ? 'row' : 'stacked';
}
