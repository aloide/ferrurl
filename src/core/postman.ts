// Importacion / exportacion Postman (v2.0 y v2.1). Normaliza sin perder campos desconocidos.

import { uid } from './encoding';
import {
  COLLECTION_SCHEMA_V21,
  type Environment,
  type EnvVar,
  type KV,
  type PMAuth,
  type PMCollection,
  type PMEvent,
  type PMFolder,
  type PMItem,
  type PMNode,
  type PMRequest,
  type PMUrl,
  type PMVariable,
} from './types';

export class ImportError extends Error {}

// ---------------------------------------------------------------------------
// URL
// ---------------------------------------------------------------------------

export function parseQuery(qs: string): KV[] {
  if (!qs) return [];
  return qs.split('&').filter((p) => p.length > 0).map((pair) => {
    const i = pair.indexOf('=');
    return i === -1 ? { key: pair, value: '' } : { key: pair.slice(0, i), value: pair.slice(i + 1) };
  });
}

export function buildQuery(params: KV[]): string {
  return params
    .filter((p) => !p.disabled)
    .map((p) => (p.value === undefined || p.value === null || (p.value === '' && !String(p.key).length) ? p.key : `${p.key}=${p.value ?? ''}`))
    .join('&');
}

/** Separa raw en base, query y hash respetando {{variables}} (que pueden contener ? o #). */
export function splitRaw(raw: string): { base: string; query: string | null; hash: string | null } {
  let depth = 0;
  let qIdx = -1;
  let hIdx = -1;
  for (let i = 0; i < raw.length; i++) {
    if (raw.startsWith('{{', i)) {
      depth++;
      i++;
      continue;
    }
    if (raw.startsWith('}}', i) && depth > 0) {
      depth--;
      i++;
      continue;
    }
    if (depth > 0) continue;
    if (raw[i] === '?' && qIdx === -1 && hIdx === -1) qIdx = i;
    else if (raw[i] === '#' && hIdx === -1) hIdx = i;
  }
  const end = hIdx === -1 ? raw.length : hIdx;
  const base = qIdx === -1 ? raw.slice(0, end) : raw.slice(0, qIdx);
  const query = qIdx === -1 ? null : raw.slice(qIdx + 1, end);
  const hash = hIdx === -1 ? null : raw.slice(hIdx + 1);
  return { base, query, hash };
}

/** Construye un objeto url de Postman desde el raw, conservando params deshabilitados y variables de path. */
export function urlFromRaw(raw: string, previous?: PMUrl): PMUrl {
  const { base, query, hash } = splitRaw(raw);
  const url: PMUrl = { ...(previous ?? {}), raw } as PMUrl;
  let rest = base;
  const pm = /^([a-z][a-z0-9+.-]*):\/\//i.exec(rest);
  if (pm) {
    url.protocol = pm[1];
    rest = rest.slice(pm[0].length);
  } else {
    delete url.protocol;
  }
  const slash = rest.indexOf('/');
  const hostPart = slash === -1 ? rest : rest.slice(0, slash);
  const pathPart = slash === -1 ? '' : rest.slice(slash + 1);
  const portMatch = /^(.*?):(\d+|\{\{[^}]+\}\})$/.exec(hostPart);
  const hostOnly = portMatch ? portMatch[1] : hostPart;
  if (portMatch) url.port = portMatch[2];
  else delete url.port;
  url.host = hostOnly.startsWith('{{') ? [hostOnly] : hostOnly.split('.').filter((s) => s !== '');
  if (pathPart.length || slash !== -1) url.path = pathPart.split('/');
  else delete url.path;

  const enabled = query !== null ? parseQuery(query) : [];
  const disabled = (previous?.query ?? []).filter((q) => q.disabled);
  if (enabled.length || disabled.length) url.query = [...enabled, ...disabled];
  else delete url.query;
  if (hash) url.hash = hash;
  else delete url.hash;

  // variables de path (:id)
  const pathVars = (url.path ?? []).filter((s) => s.startsWith(':') && s.length > 1).map((s) => s.slice(1));
  if (pathVars.length) {
    const prev = new Map((previous?.variable ?? []).map((v) => [v.key, v]));
    url.variable = pathVars.map((k) => prev.get(k) ?? { key: k, value: '' });
  } else {
    delete url.variable;
  }
  return url;
}

/** Recompone raw a partir de la tabla de params (enabled) manteniendo base y hash. */
export function rawWithQuery(raw: string, params: KV[]): string {
  const { base, hash } = splitRaw(raw);
  const q = buildQuery(params);
  return base + (q.length ? `?${q}` : '') + (hash ? `#${hash}` : '');
}

function rawFromUrlObject(u: Partial<PMUrl>): string {
  const proto = u.protocol ? `${u.protocol}://` : '';
  const host = Array.isArray(u.host) ? u.host.join('.') : (u.host ?? '');
  const port = u.port ? `:${u.port}` : '';
  const path = Array.isArray(u.path) ? (u.path.length ? '/' + u.path.map((p) => (typeof p === 'string' ? p : (p as { value?: string }).value ?? '')).join('/') : '') : u.path ? `/${u.path}` : '';
  const q = buildQuery(u.query ?? []);
  return `${proto}${host}${port}${path}${q ? `?${q}` : ''}${u.hash ? `#${u.hash}` : ''}`;
}

export function normalizeUrl(input: unknown): PMUrl {
  if (input === undefined || input === null) return { raw: '' };
  if (typeof input === 'string') return urlFromRaw(input);
  const u = input as Partial<PMUrl>;
  const raw = typeof u.raw === 'string' ? u.raw : rawFromUrlObject(u);
  const out: PMUrl = { ...(u as PMUrl), raw };
  if (typeof out.host === 'string') out.host = [out.host as unknown as string];
  if (typeof out.path === 'string') out.path = (out.path as unknown as string).split('/');
  if (out.query) out.query = out.query.map(normalizeKV);
  if (out.variable) out.variable = out.variable.map(normalizeKV);
  return out;
}

// ---------------------------------------------------------------------------
// KV / headers / scripts / auth
// ---------------------------------------------------------------------------

function normalizeKV(kv: KV | Record<string, unknown>): KV {
  const k = kv as KV;
  return { ...k, key: String(k.key ?? ''), value: k.value === undefined || k.value === null ? '' : String(k.value) };
}

export function parseHeaderString(s: string): KV[] {
  return s
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith('//'))
    .map((l) => {
      const i = l.indexOf(':');
      return i === -1 ? { key: l, value: '' } : { key: l.slice(0, i).trim(), value: l.slice(i + 1).trim() };
    });
}

function normalizeHeaders(h: unknown): KV[] {
  if (!h) return [];
  if (typeof h === 'string') return parseHeaderString(h);
  if (Array.isArray(h)) return h.map((x) => normalizeKV(x as KV));
  return [];
}

export function normalizeExec(exec: unknown): string[] {
  if (Array.isArray(exec)) return exec.map(String);
  if (typeof exec === 'string') return exec.split(/\r?\n/);
  return [];
}

function normalizeEvents(events: unknown): PMEvent[] | undefined {
  if (!Array.isArray(events)) return undefined;
  return events.map((e: PMEvent) => ({
    ...e,
    script: { ...(e.script ?? {}), type: e.script?.type ?? 'text/javascript', exec: normalizeExec(e.script?.exec) },
  }));
}

/** v2.0 usaba objetos ({username, password}); v2.1 usa arrays de {key,value}. Normalizamos a v2.1. */
export function normalizeAuth(auth: unknown): PMAuth | undefined {
  if (!auth || typeof auth !== 'object') return undefined;
  const a = { ...(auth as PMAuth) };
  if (!a.type) return undefined;
  for (const [k, v] of Object.entries(a)) {
    if (k === 'type') continue;
    if (v && typeof v === 'object' && !Array.isArray(v)) {
      a[k] = Object.entries(v as Record<string, unknown>).map(([key, value]) => ({ key, value, type: 'string' }));
    }
  }
  return a;
}

function normalizeVariables(v: unknown): PMVariable[] | undefined {
  if (!Array.isArray(v)) return undefined;
  return v.map((x: PMVariable) => ({ ...x, key: String(x.key ?? (x as { id?: string }).id ?? '') }));
}

function normalizeRequest(r: unknown): PMRequest {
  if (typeof r === 'string') return { method: 'GET', header: [], url: urlFromRaw(r) };
  const req = (r ?? {}) as Partial<PMRequest>;
  const out: PMRequest = {
    ...(req as PMRequest),
    method: String(req.method ?? 'GET').toUpperCase(),
    header: normalizeHeaders(req.header),
    url: normalizeUrl(req.url),
  };
  const auth = normalizeAuth(req.auth);
  if (auth) out.auth = auth;
  else delete out.auth;
  if (req.body) {
    out.body = { ...req.body };
    if (out.body.urlencoded) out.body.urlencoded = out.body.urlencoded.map(normalizeKV);
    if (out.body.formdata) out.body.formdata = out.body.formdata.map((f) => ({ ...normalizeKV(f), type: f.type ?? 'text' }));
  }
  return out;
}

function normalizeNode(n: Record<string, unknown>): PMNode {
  if (Array.isArray(n.item)) {
    const f: PMFolder = {
      ...(n as unknown as PMFolder),
      id: String(n.id ?? n._postman_id ?? uid()),
      name: String(n.name ?? 'Carpeta'),
      item: (n.item as Record<string, unknown>[]).map(normalizeNode),
    };
    const ev = normalizeEvents(n.event);
    if (ev) f.event = ev;
    const auth = normalizeAuth(n.auth);
    if (auth) f.auth = auth;
    else delete f.auth;
    const vars = normalizeVariables(n.variable);
    if (vars) f.variable = vars;
    return f;
  }
  const it: PMItem = {
    ...(n as unknown as PMItem),
    id: String(n.id ?? n._postman_id ?? uid()),
    name: String(n.name ?? 'Request'),
    request: normalizeRequest(n.request),
  };
  const ev = normalizeEvents(n.event);
  if (ev) it.event = ev;
  return it;
}

// ---------------------------------------------------------------------------
// Coleccion / ambiente
// ---------------------------------------------------------------------------

export type ImportedFile =
  | { kind: 'collection'; collection: PMCollection; warnings: string[] }
  | { kind: 'environment'; environment: Environment; warnings: string[] }
  | { kind: 'globals'; values: EnvVar[]; warnings: string[] };

export function importCollection(data: unknown): { collection: PMCollection; warnings: string[] } {
  const warnings: string[] = [];
  const c = data as Record<string, unknown>;
  if (!c || typeof c !== 'object') throw new ImportError('El archivo no es un JSON de colección válido');
  // v1 (requests/folders planos)
  if (Array.isArray(c.requests) && !c.item) {
    throw new ImportError('Formato Postman v1 no soportado. Exportá la colección como v2.1 desde Postman.');
  }
  const info = (c.info ?? {}) as Record<string, unknown>;
  if (!c.item || !Array.isArray(c.item)) throw new ImportError('La colección no tiene "item"');
  const schema = String(info.schema ?? '');
  if (schema && !/v2\.(0|1)/.test(schema)) warnings.push(`Esquema no reconocido (${schema}); se intenta importar igual`);
  const collection: PMCollection = {
    ...(c as unknown as PMCollection),
    info: {
      ...(info as Record<string, unknown>),
      _postman_id: String(info._postman_id ?? uid()),
      name: String(info.name ?? 'Colección importada'),
      schema: COLLECTION_SCHEMA_V21,
    },
    item: (c.item as Record<string, unknown>[]).map(normalizeNode),
  };
  const ev = normalizeEvents(c.event);
  if (ev) collection.event = ev;
  const auth = normalizeAuth(c.auth);
  if (auth) collection.auth = auth;
  else delete collection.auth;
  const vars = normalizeVariables(c.variable);
  if (vars) collection.variable = vars;
  return { collection, warnings };
}

export function importEnvironment(data: unknown): Environment {
  const e = data as Record<string, unknown>;
  if (!e || !Array.isArray(e.values)) throw new ImportError('El archivo no es un ambiente de Postman');
  return {
    id: String(e.id ?? uid()),
    name: String(e.name ?? 'Ambiente'),
    values: (e.values as Record<string, unknown>[]).map((v) => ({
      key: String(v.key ?? ''),
      value: v.value === undefined || v.value === null ? '' : String(v.value),
      type: (v.type as string) ?? 'default',
      enabled: v.enabled !== false,
    })),
  };
}

/** Detecta automaticamente si el JSON es coleccion, ambiente o globals. */
export function importAny(text: string): ImportedFile {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch (e) {
    throw new ImportError(`JSON inválido: ${(e as Error).message}`);
  }
  const d = data as Record<string, unknown>;
  if (d && (d.info || Array.isArray(d.item) || Array.isArray(d.requests))) {
    const r = importCollection(d);
    return { kind: 'collection', ...r };
  }
  if (d && Array.isArray(d.values)) {
    if (d._postman_variable_scope === 'globals') {
      return { kind: 'globals', values: importEnvironment(d).values, warnings: [] };
    }
    return { kind: 'environment', environment: importEnvironment(d), warnings: [] };
  }
  throw new ImportError('No se reconoce el formato. Se esperaba una colección o un ambiente de Postman v2.x');
}

export function exportCollection(c: PMCollection): string {
  return JSON.stringify({ ...c, info: { ...c.info, schema: COLLECTION_SCHEMA_V21 } }, null, '\t');
}

export function exportEnvironment(env: Environment, opts: { includeSecrets?: boolean; secrets?: Record<string, string> } = {}): string {
  const { id, name } = env;
  return JSON.stringify(
    {
      id,
      name,
      values: env.values.map((v) => ({
        key: v.key,
        value: v.type === 'secret' ? (opts.includeSecrets ? opts.secrets?.[v.key] ?? v.value : '') : v.value,
        type: v.type ?? 'default',
        enabled: v.enabled !== false,
      })),
      _postman_variable_scope: 'environment',
      _postman_exported_at: new Date().toISOString(),
      _postman_exported_using: 'FerrURL',
    },
    null,
    '\t',
  );
}

// ---------------------------------------------------------------------------
// Fabricas
// ---------------------------------------------------------------------------

export function newRequestItem(name = 'Nuevo request'): PMItem {
  return { id: uid(), name, request: { method: 'GET', header: [], url: { raw: '' } }, event: [] };
}

export function newFolder(name = 'Nueva carpeta'): PMFolder {
  return { id: uid(), name, item: [] };
}

export function newCollection(name = 'Nueva colección'): PMCollection {
  return { info: { _postman_id: uid(), name, schema: COLLECTION_SCHEMA_V21 }, item: [], variable: [] };
}

export function scriptOf(events: PMEvent[] | undefined, listen: 'prerequest' | 'test'): string {
  const e = events?.find((x) => x.listen === listen);
  return e ? e.script.exec.join('\n') : '';
}

export function withScript(events: PMEvent[] | undefined, listen: 'prerequest' | 'test', code: string): PMEvent[] {
  const list = [...(events ?? [])];
  const i = list.findIndex((x) => x.listen === listen);
  const exec = code.length ? code.split(/\r?\n/) : [];
  if (i === -1) {
    if (!code.trim()) return list;
    list.push({ listen, script: { type: 'text/javascript', exec } });
  } else {
    list[i] = { ...list[i], script: { ...list[i].script, exec } };
  }
  return list;
}
