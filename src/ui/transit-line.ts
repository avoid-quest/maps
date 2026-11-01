import { AA_TEXT, contrastRatio } from "../theme/contrast";

export type TransitMode = "metro" | "tram" | "bus" | "rail";

export const TRANSIT_MODE_LABELS: Record<TransitMode, string> = { metro: "Metro", tram: "Tram", bus: "Bus", rail: "Treno" };

/** Maps an OpenTripPlanner/GTFS leg mode to a badge family; unknown modes stay unclassified. */
export function transitModeFromLeg(mode: string | undefined): TransitMode | undefined {
  switch (mode?.toLowerCase()) {
    case "subway": case "metro": return "metro";
    case "tram": case "streetcar": case "cable_car": return "tram";
    case "bus": case "trolleybus": case "coach": return "bus";
    case "rail": case "train": case "monorail": case "funicular": return "rail";
    default: return undefined;
  }
}

/**
 * GTT departures carry only the public line name. Its metro line is published as `M1`; every other
 * name is left unclassified because trams and buses share numeric names and replacements occur.
 */
export function transitModeFromLineName(line: string): TransitMode | undefined {
  return /^M\d+$/i.test(line.trim()) ? "metro" : undefined;
}

function normalizeHex(value: string | undefined | null): string | null {
  if (!value) return null;
  const hex = value.trim().replace(/^#/, "");
  return /^[0-9a-f]{6}$/i.test(hex) ? `#${hex.toUpperCase()}` : null;
}

export interface LineBadgeColors { background: string; text: string; source: "route" | "fallback" }

/**
 * Uses the operator's route colour when supplied. A supplied text colour is kept only when it reaches
 * WCAG AA on that fill; otherwise black or white is chosen, whichever contrasts more (always ≥ 4.5:1).
 */
export function lineBadgeColors(color: string | undefined | null, textColor: string | undefined | null, fallback: { background: string; text: string }): LineBadgeColors {
  const background = normalizeHex(color);
  if (!background) return { ...fallback, source: "fallback" };
  const text = normalizeHex(textColor);
  if (text && contrastRatio(text, background) >= AA_TEXT) return { background, text, source: "route" };
  const best = contrastRatio("#FFFFFF", background) >= contrastRatio("#000000", background) ? "#FFFFFF" : "#000000";
  return { background, text: best, source: "route" };
}

export function lineAccessibilityLabel(line: string, mode: TransitMode | undefined): string {
  if (!mode) return `Linea ${line}`;
  return mode === "metro" && /^M/i.test(line) ? `Metro ${line.replace(/^M/i, "linea ")}` : `${TRANSIT_MODE_LABELS[mode]} ${line}`;
}
