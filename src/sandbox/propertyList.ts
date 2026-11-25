// Listas de propiedades estilo postman-collection (HeaderList, QueryParam list).

import type { KV } from '../core/types';

export interface PropertyLike {
  key: string;
  value: string;
  disabled?: boolean;
}

/** Lista mutable respaldada por un array de KV (los cambios se reflejan en el draft). */
export class PropertyList {
  constructor(
    private readonly items: () => KV[],
    private readonly onChange: () => void = () => {},
    private readonly caseInsensitive = true,
    private readonly readonly = false,
  ) {}

  private match(a: string, b: string) {
    return this.caseInsensitive ? a.toLowerCase() === b.toLowerCase() : a === b;
  }

  private guard() {
    if (this.readonly) throw new TypeError('La lista es de solo lectura');
  }

  private active(): KV[] {
    return this.items().filter((i) => !i.disabled);
  }

  get(key: string): string | undefined {
    const list = this.active();
    for (let i = list.length - 1; i >= 0; i--) if (this.match(list[i].key, key)) return list[i].value;
    return undefined;
  }
  one(key: string): PropertyLike | undefined {
    return this.active().find((i) => this.match(i.key, key));
  }
  has(key: string | PropertyLike, value?: string): boolean {
    const k = typeof key === 'string' ? key : key.key;
    return this.active().some((i) => this.match(i.key, k) && (value === undefined || i.value === value));
  }
  all(): PropertyLike[] {
    return this.active().map((i) => ({ key: i.key, value: i.value }));
  }
  toObject(): Record<string, string> {
    const o: Record<string, string> = {};
    for (const i of this.active()) o[i.key] = i.value;
    return o;
  }
  toJSON(): PropertyLike[] {
    return this.all();
  }
  count(): number {
    return this.active().length;
  }
  idx(n: number): PropertyLike | undefined {
    return this.all()[n];
  }
  each(fn: (p: PropertyLike) => void): void {
    this.all().forEach(fn);
  }
  map<T>(fn: (p: PropertyLike) => T): T[] {
    return this.all().map(fn);
  }
  filter(fn: (p: PropertyLike) => boolean): PropertyLike[] {
    return this.all().filter(fn);
  }
  find(fn: (p: PropertyLike) => boolean): PropertyLike | undefined {
    return this.all().find(fn);
  }
  reduce<T>(fn: (acc: T, p: PropertyLike) => T, init: T): T {
    return this.all().reduce(fn, init);
  }
  toString(): string {
    return this.all().map((p) => `${p.key}: ${p.value}`).join('\n');
  }

  add(p: PropertyLike | string): void {
    this.guard();
    const item = typeof p === 'string' ? parseLine(p) : p;
    this.items().push({ key: item.key, value: String(item.value ?? ''), ...(item.disabled ? { disabled: true } : {}) });
    this.onChange();
  }
  upsert(p: PropertyLike | string): void {
    this.guard();
    const item = typeof p === 'string' ? parseLine(p) : p;
    const list = this.items();
    const i = list.findIndex((x) => !x.disabled && this.match(x.key, item.key));
    if (i === -1) list.push({ key: item.key, value: String(item.value ?? '') });
    else list[i] = { ...list[i], value: String(item.value ?? '') };
    this.onChange();
  }
  remove(predicate: string | ((p: PropertyLike) => boolean)): void {
    this.guard();
    const list = this.items();
    for (let i = list.length - 1; i >= 0; i--) {
      const hit = typeof predicate === 'string' ? this.match(list[i].key, predicate) : predicate(list[i]);
      if (hit) list.splice(i, 1);
    }
    this.onChange();
  }
  clear(): void {
    this.guard();
    this.items().length = 0;
    this.onChange();
  }
  populate(items: PropertyLike[]): void {
    items.forEach((i) => this.add(i));
  }
  repopulate(items: PropertyLike[]): void {
    this.clear();
    this.populate(items);
  }
}

function parseLine(s: string): PropertyLike {
  const i = s.indexOf(':');
  return i === -1 ? { key: s.trim(), value: '' } : { key: s.slice(0, i).trim(), value: s.slice(i + 1).trim() };
}
