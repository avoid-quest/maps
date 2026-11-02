import { browserCivil, pickedCivil, type CivilChoice } from './transit-time-control';

/**
 * Browser fallback for the web preview: the browser's own date/time input. Its value is already a
 * Rome civil date or minute, returned as typed so validation can refuse nonexistent or ambiguous
 * daylight-saving minutes. Android uses the platform dialogs (civil-picker.native.ts).
 */
export function openCivilPicker(mode: 'date' | 'time', value: Date): Promise<CivilChoice | null> {
  const doc = (globalThis as { document?: Document }).document;
  if (!doc) return Promise.resolve(null);
  const current = pickedCivil(value);
  return new Promise(resolve => {
    const input = doc.createElement('input');
    input.type = mode;
    input.value = mode === 'date' ? current.date : current.time;
    Object.assign(input.style, { position: 'fixed', opacity: '0', pointerEvents: 'none', bottom: '0', left: '0' });
    let settled = false;
    const finish = (result: CivilChoice | null) => { if (settled) return; settled = true; input.remove(); resolve(result); };
    input.addEventListener('change', () => finish(browserCivil(mode, input.value)));
    input.addEventListener('blur', () => setTimeout(() => finish(null), 300));
    doc.body.appendChild(input);
    try { input.showPicker(); } catch { input.focus(); }
  });
}
