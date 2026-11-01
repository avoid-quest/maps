export const LINK_FAILURE = 'Impossibile aprire questo collegamento.';

/** A bare host such as `example.it/menu` (common in place data) is a web address; give it https. */
export function normalizeExternalLink(url: string): string {
  const trimmed = url.trim();
  if (/^[a-z][a-z0-9+.-]*:/i.test(trimmed)) return trimmed;
  return /^(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,}(?::\d+)?(?:[/?#]\S*)?$/i.test(trimmed) ? `https://${trimmed}` : trimmed;
}

/** Only web and telephone links leave the app; anything else is reported, never silently ignored. */
export async function openExternalLink(rawUrl: string, open: (url: string) => Promise<unknown>, report: (message: string) => void) {
  const url = normalizeExternalLink(rawUrl);
  if (!/^(https?:|tel:)/i.test(url)) { report(LINK_FAILURE); return; }
  try {
    await open(url);
  } catch {
    report(LINK_FAILURE);
  }
}

export const GEO_HANDOFF_FAILURE = 'Nessuna app sul dispositivo può aprire questo luogo.';

/**
 * An Android `geo:` URI for the system chooser: `geo:lat,lon?q=lat,lon(Name)`. Organic Maps reads the
 * coordinates and the percent-encoded label from `q` (its geo URL parser tests cover this form); other
 * map apps read at least the coordinates. Parentheses in the name would end the label, so they become spaces.
 */
export function geoUri(place: { name: string; coordinate: { latitude: number; longitude: number } }): string {
  const lat = place.coordinate.latitude.toFixed(6);
  const lon = place.coordinate.longitude.toFixed(6);
  const label = encodeURIComponent(place.name.replace(/[()]/g, ' ').replace(/\s+/g, ' ').trim());
  return `geo:${lat},${lon}?q=${lat},${lon}${label ? `(${label})` : ''}`;
}

/** Hands one place to another app on this device; nothing is sent to any service by this app. */
export async function openInOtherApp(place: Parameters<typeof geoUri>[0], open: (url: string) => Promise<unknown>, report: (message: string) => void) {
  try {
    await open(geoUri(place));
  } catch {
    report(GEO_HANDOFF_FAILURE);
  }
}
