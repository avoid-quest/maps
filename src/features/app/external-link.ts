export const LINK_FAILURE = 'Impossibile aprire questo collegamento.';

/** Only web and telephone links leave the app; anything else is reported, never silently ignored. */
export async function openExternalLink(url: string, open: (url: string) => Promise<unknown>, report: (message: string) => void) {
  if (!/^(https?:|tel:)/i.test(url)) { report(LINK_FAILURE); return; }
  try {
    await open(url);
  } catch {
    report(LINK_FAILURE);
  }
}
