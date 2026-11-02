export const TRANSITOUS_CONSENT_KEY = '@avoid-maps/transitous-consent-v1';
export interface ConsentStorage {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
  removeItem?(key: string): Promise<void>;
}
export interface TransitousConsentSnapshot {
  /** The stored choice has been read (or found unreadable). */
  ready: boolean;
  /** The disclosure was acknowledged; until then no Transitous request is issued. */
  accepted: boolean;
}

/**
 * The Transitous disclosure is shown before the first request. Acknowledging it is stored on the
 * device only; an unreadable record counts as not acknowledged, so the disclosure is shown again.
 */
export function createTransitousConsent() {
  let snapshot: TransitousConsentSnapshot = { ready: false, accepted: false };
  let storage: ConsentStorage | undefined;
  let initialization: Promise<void> | undefined;
  const listeners = new Set<() => void>();
  const update = (next: TransitousConsentSnapshot) => { snapshot = next; listeners.forEach(listener => listener()); };
  return {
    getSnapshot: () => snapshot,
    subscribe(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener); }; },
    initialize(target: ConsentStorage): Promise<void> {
      if (initialization) return initialization;
      storage = target;
      initialization = (async () => {
        try {
          const raw = await target.getItem(TRANSITOUS_CONSENT_KEY);
          const value: unknown = raw === null || raw.length > 256 ? null : JSON.parse(raw);
          const accepted = !!value && typeof value === 'object' && 'version' in value && value.version === 1 && 'accepted' in value && value.accepted === true;
          // A choice made before storage finished loading stands.
          update({ ready: true, accepted: snapshot.accepted || accepted });
        } catch { update({ ready: true, accepted: snapshot.accepted }); }
      })();
      return initialization;
    },
    /** Applies at once for this session; persistence failure only means the disclosure returns next launch. */
    async accept(): Promise<void> {
      update({ ready: true, accepted: true });
      try { await storage?.setItem(TRANSITOUS_CONSENT_KEY, JSON.stringify({ version: 1, accepted: true })); } catch { /* Session-only acknowledgement. */ }
    },
    async revoke(): Promise<void> {
      update({ ready: snapshot.ready, accepted: false });
      try { await storage?.removeItem?.(TRANSITOUS_CONSENT_KEY); } catch { /* Next launch still reads a stale record; acceptance is re-shown only then. */ }
    },
  };
}

export const transitousConsent = createTransitousConsent();
