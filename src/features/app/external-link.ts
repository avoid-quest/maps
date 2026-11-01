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
