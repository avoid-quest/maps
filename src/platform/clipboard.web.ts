/** Avoid legacy execCommand fallbacks that can claim success when copying was denied. */
export async function copyText(text: string): Promise<boolean> {
  if (!navigator.clipboard?.writeText) return false;
  await navigator.clipboard.writeText(text);
  return true;
}
