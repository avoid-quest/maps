export const USER_AGENT = 'AvoidMaps/0.1 (https://github.com/avoid-quest/maps)';
export class ServiceError extends Error {
  constructor(message: string, public readonly kind: 'network' | 'unavailable' | 'rate-limit' | 'invalid' = 'network') { super(message); this.name = 'ServiceError'; }
}
export function checkAbort(signal?: AbortSignal) { if (signal?.aborted) { const error = new Error('Request cancelled'); error.name = 'AbortError'; throw error; } }
export function wait(ms: number, signal?: AbortSignal): Promise<void> {
  checkAbort(signal);
  return new Promise((resolve, reject) => {
    const abort = () => { clearTimeout(timer); reject(Object.assign(new Error('Request cancelled'), { name: 'AbortError' })); };
    const timer = setTimeout(() => { signal?.removeEventListener('abort', abort); resolve(); }, Math.max(0, ms));
    signal?.addEventListener('abort', abort, { once: true });
  });
}
/** Serialize provider requests and impose start-to-start spacing, including failures. */
export function requestQueue(intervalMs: number) {
  let tail: Promise<unknown> = Promise.resolve(); let nextAt = 0; let blockedUntil = 0;
  return <T>(request: () => Promise<T>, signal?: AbortSignal): Promise<T> => {
    const task = tail.catch(() => undefined).then(async () => {
      checkAbort(signal); await wait(Math.max(nextAt, blockedUntil) - Date.now(), signal); checkAbort(signal);
      nextAt = Date.now() + intervalMs;
      try { return await request(); } catch (error) {
        if (error instanceof ServiceError && error.kind === 'rate-limit') blockedUntil = Date.now() + 60_000;
        throw error;
      }
    });
    tail = task; return task;
  };
}
/** Resolve only after the complete body arrives, so the request deadline covers JSON and protobuf alike. */
export async function fetchResponse(url: string, options: RequestInit = {}): Promise<Response> {
  checkAbort(options.signal ?? undefined);
  const controller = new AbortController(); let timedOut = false;
  let rejectAbort!: (error: Error) => void;
  const aborted = new Promise<never>((_, reject) => { rejectAbort = reject; });
  const cancel = () => {
    controller.abort();
    // Some fetch implementations do not reject a pending body read when aborted.
    rejectAbort(Object.assign(new Error('Request cancelled'), { name: 'AbortError' }));
  };
  options.signal?.addEventListener('abort', cancel, { once: true });
  const timer = setTimeout(() => { timedOut = true; cancel(); }, 18_000);
  try {
    return await Promise.race([aborted, (async () => {
      const response = await fetch(url, { ...options, signal: controller.signal, headers: { 'User-Agent': USER_AGENT, ...options.headers } });
      if (response.status === 429) throw new ServiceError('Il servizio ha limitato le richieste. Riprova tra un minuto.', 'rate-limit');
      if (!response.ok) throw new ServiceError(`Servizio temporaneamente non disponibile (HTTP ${response.status}).`, 'unavailable');
      const body = await response.arrayBuffer();
      return new Response(response.status === 204 || response.status === 205 ? null : body, {
        status: response.status, statusText: response.statusText, headers: response.headers,
      });
    })()]);
  } catch (error) {
    if (options.signal?.aborted) checkAbort(options.signal);
    if (error instanceof ServiceError) throw error;
    throw new ServiceError(timedOut ? 'Il servizio non ha risposto in tempo. Riprova.' : 'Connessione non disponibile. Controlla la rete e riprova.');
  } finally { clearTimeout(timer); options.signal?.removeEventListener('abort', cancel); }
}
export async function fetchJSON<T>(url: string, options?: RequestInit): Promise<T> {
  const response = await fetchResponse(url, options);
  try { return await response.json() as T; } catch { throw new ServiceError('Il servizio ha restituito dati non validi.', 'invalid'); }
}
