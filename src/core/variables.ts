// Scopes de variables y resolucion de {{variables}} con la prioridad de Postman:
// local (pm.variables) > data (iteracion) > environment > collection > globals

import { uid } from './encoding';

export type ScopeName = 'local' | 'data' | 'environment' | 'collection' | 'globals';
export const SCOPE_PRIORITY: ScopeName[] = ['local', 'data', 'environment', 'collection', 'globals'];

export class VariableScope {
  private map = new Map<string, unknown>();

  constructor(init?: Record<string, unknown> | [string, unknown][]) {
    if (Array.isArray(init)) init.forEach(([k, v]) => this.map.set(k, v));
    else if (init) Object.entries(init).forEach(([k, v]) => this.map.set(k, v));
  }

  get(key: string): unknown {
    return this.map.get(key);
  }
  set(key: string, value: unknown): void {
    this.map.set(String(key), value);
  }
  unset(key: string): void {
    this.map.delete(key);
  }
  has(key: string): boolean {
    return this.map.has(key);
  }
  clear(): void {
    this.map.clear();
  }
  keys(): string[] {
    return [...this.map.keys()];
  }
  toObject(): Record<string, unknown> {
    return Object.fromEntries(this.map);
  }
  entries(): [string, unknown][] {
    return [...this.map.entries()];
  }
  clone(): VariableScope {
    return new VariableScope(this.entries());
  }
}

export type ScopeChain = Record<ScopeName, VariableScope>;

export function emptyChain(): ScopeChain {
  return {
    local: new VariableScope(),
    data: new VariableScope(),
    environment: new VariableScope(),
    collection: new VariableScope(),
    globals: new VariableScope(),
  };
}

export interface Lookup {
  found: boolean;
  value?: unknown;
  scope?: ScopeName;
}

export function lookup(chain: Partial<ScopeChain>, key: string): Lookup {
  for (const s of SCOPE_PRIORITY) {
    const scope = chain[s];
    if (scope && scope.has(key)) return { found: true, value: scope.get(key), scope: s };
  }
  return { found: false };
}

export function stringifyValue(v: unknown): string {
  if (v === undefined || v === null) return '';
  if (typeof v === 'string') return v;
  if (typeof v === 'object') {
    try {
      return JSON.stringify(v);
    } catch {
      return String(v);
    }
  }
  return String(v);
}

// --- Variables dinamicas -----------------------------------------------------

const FIRST = ['Juan', 'María', 'Lucía', 'Pedro', 'Sofía', 'Martín', 'Ana', 'Diego'];
const LAST = ['García', 'Pérez', 'López', 'Gómez', 'Díaz', 'Romero', 'Sosa', 'Álvarez'];
const pick = <T,>(a: T[]) => a[Math.floor(Math.random() * a.length)];
const randInt = (min: number, max: number) => Math.floor(Math.random() * (max - min + 1)) + min;
const alnum = 'abcdefghijklmnopqrstuvwxyz0123456789';

export const DYNAMIC_VARIABLES: Record<string, () => string> = {
  $guid: () => uid(),
  $randomUUID: () => uid(),
  $timestamp: () => String(Math.floor(Date.now() / 1000)),
  $isoTimestamp: () => new Date().toISOString(),
  $randomInt: () => String(randInt(0, 1000)),
  $randomBoolean: () => String(Math.random() < 0.5),
  $randomAlphaNumeric: () => alnum[randInt(0, alnum.length - 1)],
  $randomFirstName: () => pick(FIRST),
  $randomLastName: () => pick(LAST),
  $randomFullName: () => `${pick(FIRST)} ${pick(LAST)}`,
  $randomEmail: () => `${pick(FIRST).toLowerCase()}.${randInt(1, 9999)}@example.com`.normalize('NFD').replace(/[\u0300-\u036f]/g, ''),
  $randomPhoneNumber: () => `${randInt(100, 999)}-${randInt(100, 999)}-${randInt(1000, 9999)}`,
  $randomIP: () => `${randInt(1, 254)}.${randInt(0, 255)}.${randInt(0, 255)}.${randInt(1, 254)}`,
  $randomColor: () => pick(['red', 'green', 'blue', 'yellow', 'black', 'white']),
  $randomWord: () => pick(['alfa', 'beta', 'gamma', 'delta', 'epsilon']),
  $randomPrice: () => (Math.random() * 1000).toFixed(2),
  $randomDateFuture: () => new Date(Date.now() + randInt(1, 365) * 864e5).toISOString(),
  $randomDatePast: () => new Date(Date.now() - randInt(1, 365) * 864e5).toISOString(),
};

const VAR_RE = /\{\{([^{}]+?)\}\}/g;

export interface ResolveOptions {
  /** callback cuando una variable no se encuentra */
  onMissing?: (name: string) => void;
}

/** Reemplaza {{var}} (incluye anidadas como {{a_{{b}}}} y dinamicas {{$guid}}). Las no resueltas quedan literales. */
export function resolve(template: string, chain: Partial<ScopeChain>, opts: ResolveOptions = {}): string {
  if (typeof template !== 'string' || !template.includes('{{')) return template;
  let current = template;
  const unresolved = new Set<string>();
  for (let depth = 0; depth < 20; depth++) {
    let changed = false;
    current = current.replace(VAR_RE, (_whole, rawName: string) => {
      const name = rawName.trim();
      const l = lookup(chain, name);
      if (l.found) {
        changed = true;
        return stringifyValue(l.value);
      }
      if (name.startsWith('$') && DYNAMIC_VARIABLES[name]) {
        changed = true;
        return DYNAMIC_VARIABLES[name]();
      }
      unresolved.add(name);
      // marcador temporal para no volver a procesarla
      return `\u0000${rawName}\u0001`;
    });
    if (!changed) break;
  }
  unresolved.forEach((n) => opts.onMissing?.(n));
  return current.replace(/\u0000([^\u0001]*)\u0001/g, '{{$1}}');
}

/** Lista las variables referenciadas en un texto (sin anidadas). */
export function referencedVariables(text: string): string[] {
  const out: string[] = [];
  for (const m of text.matchAll(VAR_RE)) out.push(m[1].trim());
  return out;
}
