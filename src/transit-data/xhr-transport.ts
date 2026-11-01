import { ZipRangeError, type RangeTransport } from './zip-range';

/**
 * Ranged GET over XMLHttpRequest, because fetch() in React Native resolves only after the whole
 * body has arrived. The status is checked when headers arrive: anything unexpected (a server that
 * ignores Range, or If-Range reporting a changed archive) is aborted before the body downloads.
 * `withCredentials = false` makes React Native use OkHttp's NO_COOKIES jar: cookies are neither
 * sent nor stored. No custom headers beyond the range validators.
 */
export const xhrRangeTransport: RangeTransport = (url, headers, accept) => new Promise((resolve, reject) => {
  const xhr = new XMLHttpRequest();
  let settled = false;
  const fail = (error: Error) => { if (!settled) { settled = true; reject(error); } };
  xhr.open('GET', url);
  xhr.responseType = 'arraybuffer';
  xhr.withCredentials = false;
  xhr.timeout = 30_000;
  for (const [name, value] of Object.entries(headers)) xhr.setRequestHeader(name, value);
  xhr.onreadystatechange = () => {
    if (xhr.readyState === 2 && !accept.includes(xhr.status)) {
      xhr.abort();
      fail(new ZipRangeError(`Risposta GTT inattesa (HTTP ${xhr.status}).`, xhr.status === 200 ? 'changed' : 'unsupported'));
    }
  };
  xhr.onload = () => {
    if (settled) return;
    if (!accept.includes(xhr.status)) { fail(new ZipRangeError(`Risposta GTT inattesa (HTTP ${xhr.status}).`, 'unsupported')); return; }
    settled = true;
    resolve({ status: xhr.status, header: name => xhr.getResponseHeader(name) ?? undefined, body: new Uint8Array((xhr.response as ArrayBuffer | null) ?? new ArrayBuffer(0)) });
  };
  xhr.onerror = () => fail(new ZipRangeError('Connessione a GTT non riuscita.', 'network'));
  xhr.ontimeout = () => fail(new ZipRangeError('GTT non ha risposto in tempo.', 'network'));
  xhr.send();
});
