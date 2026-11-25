// Conversion de la especificacion de pm.sendRequest a WireRequest.
// Igual que Postman, pm.sendRequest NO resuelve {{variables}}: el script arma los valores.

import { defaultHeaders, hasHeader } from './build';
import { uid } from './encoding';
import { DEFAULT_SETTINGS, type RequestSettings, type WireBody, type WireRequest } from './wire';

export type SendRequestSpec =
  | string
  | {
      url: string | { raw?: string; toString?: () => string };
      method?: string;
      header?: Record<string, unknown> | { key: string; value: unknown; disabled?: boolean }[] | string;
      headers?: Record<string, unknown>;
      body?: {
        mode?: string;
        raw?: unknown;
        urlencoded?: { key: string; value: unknown; disabled?: boolean }[];
        formdata?: { key: string; value?: unknown; type?: string; src?: string; disabled?: boolean }[];
        options?: { raw?: { language?: string } };
      };
      timeout?: number;
    };

function headerList(h: unknown): [string, string][] {
  if (!h) return [];
  if (typeof h === 'string') {
    return h
      .split(/\r?\n/)
      .filter((l) => l.includes(':'))
      .map((l) => [l.slice(0, l.indexOf(':')).trim(), l.slice(l.indexOf(':') + 1).trim()]);
  }
  if (Array.isArray(h)) {
    return h.filter((x) => x && !x.disabled && x.key).map((x) => [String(x.key), String(x.value ?? '')]);
  }
  if (typeof h === 'object') return Object.entries(h as Record<string, unknown>).map(([k, v]) => [k, String(v ?? '')]);
  return [];
}

export function specToWire(spec: SendRequestSpec, base: Partial<RequestSettings> = {}): WireRequest {
  const s = typeof spec === 'string' ? { url: spec } : spec;
  const url = typeof s.url === 'string' ? s.url : s.url?.raw ?? String(s.url);
  const headers = [...headerList(s.header), ...headerList(s.headers)];
  let body: WireBody = { type: 'none' };
  const b = s.body;
  if (b) {
    const mode = b.mode ?? (b.raw !== undefined ? 'raw' : undefined);
    if (mode === 'raw') {
      const raw = typeof b.raw === 'string' ? b.raw : JSON.stringify(b.raw);
      body = { type: 'text', text: raw };
      const lang = b.options?.raw?.language;
      if (lang === 'json' && !hasHeader(headers, 'content-type')) headers.push(['Content-Type', 'application/json']);
      if (lang === 'xml' && !hasHeader(headers, 'content-type')) headers.push(['Content-Type', 'application/xml']);
    } else if (mode === 'urlencoded') {
      body = { type: 'urlencoded', fields: (b.urlencoded ?? []).filter((f) => !f.disabled).map((f) => [String(f.key), String(f.value ?? '')]) };
    } else if (mode === 'formdata') {
      body = {
        type: 'form',
        parts: (b.formdata ?? [])
          .filter((f) => !f.disabled)
          .map((f) => (f.type === 'file' && f.src ? { type: 'file' as const, key: f.key, path: f.src } : { type: 'text' as const, key: f.key, value: String(f.value ?? '') })),
      };
    }
  }
  for (const [k, v] of defaultHeaders()) if (!hasHeader(headers, k)) headers.push([k, v]);
  return {
    id: uid(),
    method: (s.method ?? 'GET').toUpperCase(),
    url,
    headers,
    body,
    settings: { ...DEFAULT_SETTINGS, ...base, ...(s.timeout ? { timeoutMs: s.timeout } : {}) },
  };
}
