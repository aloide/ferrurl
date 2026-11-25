// Autenticacion estilo Postman (herencia carpeta -> coleccion).

import type { AuthParam, KV, PMAuth, PMCollection, PMFolder, PMItem } from './types';
import { resolve, type ScopeChain } from './variables';

export const AUTH_TYPES: { type: string; label: string }[] = [
  { type: 'inherit', label: 'Heredar del padre' },
  { type: 'noauth', label: 'Sin autenticación' },
  { type: 'basic', label: 'Basic Auth' },
  { type: 'bearer', label: 'Bearer Token' },
  { type: 'apikey', label: 'API Key' },
];

export function authParams(auth: PMAuth | undefined): Record<string, string> {
  if (!auth) return {};
  const raw = auth[auth.type];
  if (Array.isArray(raw)) {
    return Object.fromEntries((raw as AuthParam[]).map((p) => [p.key, p.value === undefined || p.value === null ? '' : String(p.value)]));
  }
  if (raw && typeof raw === 'object') {
    return Object.fromEntries(Object.entries(raw as Record<string, unknown>).map(([k, v]) => [k, String(v ?? '')]));
  }
  return {};
}

export function setAuthParam(auth: PMAuth, key: string, value: string): PMAuth {
  const list = Array.isArray(auth[auth.type]) ? [...(auth[auth.type] as AuthParam[])] : [];
  const i = list.findIndex((p) => p.key === key);
  if (i === -1) list.push({ key, value, type: 'string' });
  else list[i] = { ...list[i], value };
  return { ...auth, [auth.type]: list };
}

/** Auth efectiva: request -> carpetas (de la mas cercana a la raiz) -> coleccion. */
export function effectiveAuth(
  item: Pick<PMItem, 'request'> | { request: { auth?: PMAuth } },
  ancestors: PMFolder[],
  collection: Pick<PMCollection, 'auth'>,
): { auth: PMAuth; source: string } {
  const own = item.request.auth;
  if (own && own.type !== 'inherit') return { auth: own, source: 'request' };
  for (let i = ancestors.length - 1; i >= 0; i--) {
    const a = ancestors[i].auth;
    if (a && a.type !== 'inherit') return { auth: a, source: ancestors[i].name };
  }
  if (collection.auth && collection.auth.type !== 'inherit') return { auth: collection.auth, source: 'colección' };
  return { auth: { type: 'noauth' }, source: own ? 'request' : 'ninguna' };
}

export function base64Utf8(s: string): string {
  const bytes = new TextEncoder().encode(s);
  let bin = '';
  bytes.forEach((b) => (bin += String.fromCharCode(b)));
  return btoa(bin);
}

function upsertHeader(headers: KV[], key: string, value: string) {
  const i = headers.findIndex((h) => !h.disabled && h.key.toLowerCase() === key.toLowerCase());
  if (i === -1) headers.push({ key, value });
  else headers[i] = { ...headers[i], key, value };
}

/** Aplica la auth sobre headers/query (mutandolos). Las variables se resuelven aca. */
export function applyAuth(auth: PMAuth, chain: Partial<ScopeChain>, headers: KV[], query: KV[]): void {
  const p = authParams(auth);
  const r = (s: string | undefined) => resolve(s ?? '', chain);
  switch (auth.type) {
    case 'basic': {
      upsertHeader(headers, 'Authorization', 'Basic ' + base64Utf8(`${r(p.username)}:${r(p.password)}`));
      break;
    }
    case 'bearer': {
      upsertHeader(headers, 'Authorization', `Bearer ${r(p.token)}`);
      break;
    }
    case 'apikey': {
      const key = r(p.key);
      const value = r(p.value);
      if (!key) break;
      if ((p.in ?? 'header') === 'query') query.push({ key, value });
      else upsertHeader(headers, key, value);
      break;
    }
    default:
      break; // noauth / inherit / no soportado: no agrega nada
  }
}
