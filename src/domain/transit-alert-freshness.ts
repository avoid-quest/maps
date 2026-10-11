const STALE_SOURCE = 'Il feed degli avvisi GTT non è aggiornato: la loro applicabilità attuale non è confermata.';
const UNCERTAIN_SOURCE = 'La data di aggiornamento degli avvisi GTT non è verificabile.';

/** Reevaluate source age without changing retrieval age or other provider warnings. */
export function transitAlertWarnings(sourceUpdatedAt: number | undefined, now: number, warnings: readonly string[] = []): string[] {
  const current = warnings.filter(warning => warning !== STALE_SOURCE && warning !== UNCERTAIN_SOURCE);
  if (sourceUpdatedAt === undefined || !Number.isFinite(sourceUpdatedAt) || sourceUpdatedAt <= 0 || sourceUpdatedAt > now + 60_000) {
    current.push(UNCERTAIN_SOURCE);
  } else if (now - sourceUpdatedAt > 300_000) {
    current.push(STALE_SOURCE);
  }
  return current;
}
