/**
 * Exit number size for a glyph box: in proportion to the glyph (about a third), never below 11 sp.
 * It is laid out beside the glyph, not over it, so it never collides with neighbouring text at any
 * font scale.
 */
export const exitNumberSize = (glyphSize: number) => Math.max(11, Math.round(glyphSize * 0.36));
