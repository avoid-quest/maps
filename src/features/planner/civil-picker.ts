import { pickedCivil, romeInstant } from './transit-time-control';

/**
 * Browser fallback for the web preview: the browser's own date/time input, read as Rome civil time.
 * Android uses the platform dialogs (civil-picker.native.ts).
 */
export function openCivilPicker(mode: 'date' | 'time', value: Date): Promise<Date | null> {
  const doc = (globalThis as { document?: Document }).document;
  if (!doc) return Promise.resolve(null);
  const current = pickedCivil(value);
  return new Promise(resolve => {
    const input = doc.createElement('input');
    input.type = mode;
    input.value = mode === 'date' ? current.date : current.time;
    Object.assign(input.style, { position: 'fixed', opacity: '0', pointerEvents: 'none', bottom: '0', left: '0' });
    let settled = false;
    const finish = (result: Date | null) => { if (settled) return; settled = true; input.remove(); resolve(result); };
    input.addEventListener('change', () => {
      if (!input.value) { finish(null); return; }
      finish(mode === 'date' ? romeInstant(input.value, current.time) : romeInstant(current.date, input.value));
    });
    input.addEventListener('blur', () => setTimeout(() => finish(null), 300));
    doc.body.appendChild(input);
    try { input.showPicker(); } catch { input.focus(); }
  });
}
