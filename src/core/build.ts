// Construccion del request final: draft (editable por pre-request scripts) -> WireRequest.

import { applyAuth, effectiveAuth } from './auth';
import { base64ToBytes, decodeBody, uid } from './encoding';
import { parseQuery, splitRaw } from './postman';
import type { KV, PMAuth, PMBody, PMCollection, PMFolder, PMItem, ProtocolProfileBehavior } from './types';
import { resolve, type ScopeChain } from './variables';
import { DEFAULT_SETTINGS, type FormPart, type ParsedResponse, type RequestSettings, type WireBody, type WireRequest, type WireResponse } from './wire';

export const APP_VERSION = '0.1.0';
export const USER_AGENT = `FerrURL/${APP_VERSION}`;

/** Representacion mutable del request durante la ejecucion (lo que ve pm.request). */
export interface RequestDraft {
  id: string;
  name: string;
  method: string;
  url: string;
  headers: KV[];
  body?: PMBody;
  auth: PMAuth;
  urlVariables: KV[];
  settings: RequestSettings;
  disableBodyPruning?: boolean;
}

export interface GlobalRequestDefaults {
  timeoutMs: number;
  followRedirects: boolean;
  maxRedirects: number;
  verifyTls: boolean;
  sendDefaultHeaders: boolean;
}

export const DEFAULT_GLOBALS: GlobalRequestDefaults = {
  timeoutMs: 0,
  followRedirects: true,
  maxRedirects: 10,
  verifyTls: true,
  sendDefaultHeaders: true,
};

function mergedBehavior(item: PMItem, ancestors: PMFolder[], c: PMCollection): ProtocolProfileBehavior {
  return Object.assign(
    {},
    c.protocolProfileBehavior ?? {},
    ...ancestors.map((a) => a.protocolProfileBehavior ?? {}),
    item.protocolProfileBehavior ?? {},
  );
}

export function settingsFor(item: PMItem, ancestors: PMFolder[], c: PMCollection, g: GlobalRequestDefaults = DEFAULT_GLOBALS): RequestSettings {
  const b = mergedBehavior(item, ancestors, c);
  const tm = b.ferrurlTimeoutMs ?? b.wurlTimeoutMs;
  const px = b.ferrurlUseProxy ?? b.wurlUseProxy ?? true;
  return {
    timeoutMs: tm && tm > 0 ? tm : g.timeoutMs,
    followRedirects: b.followRedirects ?? g.followRedirects,
    maxRedirects: b.maxRedirects ?? g.maxRedirects,
    verifyTls: b.strictSSL ?? g.verifyTls,
    useProxy: px,
  };
}

export function createDraft(item: PMItem, ancestors: PMFolder[], c: PMCollection, g: GlobalRequestDefaults = DEFAULT_GLOBALS): RequestDraft {
  const r = item.request;
  const { auth } = effectiveAuth(item, ancestors, c);
  return {
    id: item.id,
    name: item.name,
    method: r.method || 'GET',
    url: r.url?.raw ?? '',
    headers: (r.header ?? []).map((h) => ({ ...h })),
    body: r.body ? structuredClone(r.body) : undefined,
    auth: structuredClone(auth),
    urlVariables: (r.url?.variable ?? []).map((v) => ({ ...v })),
    settings: settingsFor(item, ancestors, c, g),
    disableBodyPruning: mergedBehavior(item, ancestors, c).disableBodyPruning,
  };
}

const RAW_CONTENT_TYPES: Record<string, string> = {
  json: 'application/json',
  xml: 'application/xml',
  html: 'text/html',
  javascript: 'application/javascript',
  text: 'text/plain',
};

export function hasHeader(headers: KV[] | [string, string][], name: string): boolean {
  const n = name.toLowerCase();
  return (headers as (KV | [string, string])[]).some((h) =>
    Array.isArray(h) ? h[0].toLowerCase() === n : !h.disabled && h.key.toLowerCase() === n,
  );
}

export function defaultHeaders(): [string, string][] {
  return [
    ['User-Agent', USER_AGENT],
    ['Accept', '*/*'],
    ['Cache-Control', 'no-cache'],
    ['Accept-Encoding', 'gzip, deflate, br'],
    ['Connection', 'keep-alive'],
  ];
}

export function substitutePathVariables(url: string, vars: KV[], chain: Partial<ScopeChain>): string {
  if (!vars.length) return url;
  const { base, query, hash } = splitRaw(url);
  const m = /^([a-z][a-z0-9+.-]*:\/\/)?([^/]*)(.*)$/i.exec(base);
  if (!m) return url;
  const path = m[3].replace(/\/:([A-Za-z_][\w.-]*)(?=\/|$)/g, (whole, name: string) => {
    const v = vars.find((x) => x.key === name && !x.disabled);
    return v ? '/' + resolve(v.value ?? '', chain) : whole;
  });
  return (m[1] ?? '') + m[2] + path + (query !== null ? `?${query}` : '') + (hash ? `#${hash}` : '');
}

export interface BuildResult {
  wire: WireRequest;
  unresolved: string[];
}

export function buildWire(draft: RequestDraft, chain: Partial<ScopeChain>, g: GlobalRequestDefaults = DEFAULT_GLOBALS, id = uid()): BuildResult {
  const missing = new Set<string>();
  const r = (s: string | undefined | null) => resolve(s ?? '', chain, { onMissing: (n) => missing.add(n) });

  // URL
  let url = r(substitutePathVariables(draft.url, draft.urlVariables, chain)).trim();
  const authQuery: KV[] = [];
  const headers: KV[] = draft.headers.filter((h) => !h.disabled && h.key.trim() !== '').map((h) => ({ key: r(h.key), value: r(h.value) }));
  applyAuth(draft.auth, chain, headers, authQuery);
  if (authQuery.length) {
    const { base, query, hash } = splitRaw(url);
    const qs = [...(query ? parseQuery(query) : []), ...authQuery].map((q) => `${q.key}=${encodeURIComponent(q.value)}`).join('&');
    url = `${base}?${qs}${hash ? `#${hash}` : ''}`;
  }

  // Body
  const method = (draft.method || 'GET').toUpperCase();
  let body: WireBody = { type: 'none' };
  const b = draft.body;
  const pruned = (method === 'GET' || method === 'HEAD') && !draft.disableBodyPruning;
  if (b && !b.disabled && !pruned) {
    switch (b.mode) {
      case 'raw': {
        const text = r(b.raw ?? '');
        const lang = b.options?.raw?.language;
        if (lang && RAW_CONTENT_TYPES[lang] && !hasHeader(headers, 'content-type')) {
          headers.push({ key: 'Content-Type', value: RAW_CONTENT_TYPES[lang] });
        }
        body = { type: 'text', text };
        break;
      }
      case 'urlencoded': {
        const fields = (b.urlencoded ?? []).filter((f) => !f.disabled && f.key !== '').map((f) => [r(f.key), r(f.value)] as [string, string]);
        body = { type: 'urlencoded', fields };
        break;
      }
      case 'formdata': {
        const parts: FormPart[] = [];
        for (const f of b.formdata ?? []) {
          if (f.disabled || f.key === '') continue;
          if (f.type === 'file') {
            const srcs = Array.isArray(f.src) ? f.src : f.src ? [f.src] : [];
            srcs.forEach((p) => parts.push({ type: 'file', key: r(f.key), path: p, contentType: f.contentType || null }));
          } else {
            parts.push({ type: 'text', key: r(f.key), value: r(f.value), contentType: f.contentType || null });
          }
        }
        // multipart define su propio Content-Type con boundary
        for (let i = headers.length - 1; i >= 0; i--) if (headers[i].key.toLowerCase() === 'content-type') headers.splice(i, 1);
        body = { type: 'form', parts };
        break;
      }
      case 'file': {
        if (b.file?.src) body = { type: 'file', path: b.file.src };
        else if (b.file?.content) body = { type: 'text', text: b.file.content };
        break;
      }
      case 'graphql': {
        let variables: unknown = undefined;
        try {
          variables = b.graphql?.variables ? JSON.parse(r(b.graphql.variables)) : undefined;
        } catch {
          variables = undefined;
        }
        body = { type: 'text', text: JSON.stringify({ query: r(b.graphql?.query ?? ''), variables }) };
        if (!hasHeader(headers, 'content-type')) headers.push({ key: 'Content-Type', value: 'application/json' });
        break;
      }
      default:
        break;
    }
  }

  const finalHeaders: [string, string][] = headers.map((h) => [h.key, h.value]);
  if (g.sendDefaultHeaders) {
    for (const [k, v] of defaultHeaders()) if (!hasHeader(finalHeaders, k)) finalHeaders.push([k, v]);
  }

  return {
    wire: { id, method, url, headers: finalHeaders, body, settings: { ...DEFAULT_SETTINGS, ...draft.settings } },
    unresolved: [...missing],
  };
}

export function parseResponse(w: WireResponse): ParsedResponse {
  const bytes = base64ToBytes(w.bodyBase64);
  const ct = w.headers.find(([k]) => k.toLowerCase() === 'content-type')?.[1];
  return {
    code: w.status,
    status: w.statusText,
    headers: w.headers,
    body: decodeBody(bytes, ct),
    bodyBase64: w.bodyBase64,
    responseTime: w.timeMs,
    responseSize: w.bodySize,
    headersSize: w.headersSize,
    httpVersion: w.httpVersion,
    finalUrl: w.finalUrl,
    remoteAddr: w.remoteAddr,
    sent: w.request,
  };
}
