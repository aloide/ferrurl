// Navegacion del arbol de la coleccion.

import { isFolder, type PMCollection, type PMFolder, type PMItem, type PMNode } from './types';

export interface ItemRef {
  item: PMItem;
  /** carpetas desde la raiz hasta el padre inmediato */
  ancestors: PMFolder[];
}

export function findNode(nodes: PMNode[], id: string, ancestors: PMFolder[] = []): { node: PMNode; ancestors: PMFolder[] } | null {
  for (const n of nodes) {
    if (n.id === id) return { node: n, ancestors };
    if (isFolder(n)) {
      const r = findNode(n.item, id, [...ancestors, n]);
      if (r) return r;
    }
  }
  return null;
}

export function flattenItems(nodes: PMNode[], ancestors: PMFolder[] = []): ItemRef[] {
  const out: ItemRef[] = [];
  for (const n of nodes) {
    if (isFolder(n)) out.push(...flattenItems(n.item, [...ancestors, n]));
    else out.push({ item: n, ancestors });
  }
  return out;
}

/** Items a ejecutar para un objetivo (coleccion completa o una carpeta). */
export function itemsForTarget(c: PMCollection, folderId?: string | null): ItemRef[] {
  if (!folderId) return flattenItems(c.item);
  const r = findNode(c.item, folderId);
  if (!r) return [];
  if (!isFolder(r.node)) return [{ item: r.node as PMItem, ancestors: r.ancestors }];
  return flattenItems(r.node.item, [...r.ancestors, r.node]);
}

export function mapNodes(nodes: PMNode[], fn: (n: PMNode) => PMNode | null): PMNode[] {
  const out: PMNode[] = [];
  for (const n of nodes) {
    const m = fn(n);
    if (!m) continue;
    if (isFolder(m)) out.push({ ...m, item: mapNodes(m.item, fn) });
    else out.push(m);
  }
  return out;
}

export function updateNode(c: PMCollection, id: string, update: (n: PMNode) => PMNode): PMCollection {
  return { ...c, item: mapNodes(c.item, (n) => (n.id === id ? update(n) : n)) };
}

export function removeNode(c: PMCollection, id: string): PMCollection {
  return { ...c, item: mapNodes(c.item, (n) => (n.id === id ? null : n)) };
}

/** Inserta un nodo dentro de una carpeta (o en la raiz si parentId es null). */
export function insertNode(c: PMCollection, parentId: string | null, node: PMNode, index?: number): PMCollection {
  const put = (list: PMNode[]) => {
    const copy = [...list];
    copy.splice(index ?? copy.length, 0, node);
    return copy;
  };
  if (!parentId) return { ...c, item: put(c.item) };
  return {
    ...c,
    item: mapNodes(c.item, (n) => (n.id === parentId && isFolder(n) ? { ...n, item: put(n.item) } : n)),
  };
}

/** Mueve un nodo a otra carpeta/posicion. */
export function moveNode(c: PMCollection, id: string, parentId: string | null, index?: number): PMCollection {
  const found = findNode(c.item, id);
  if (!found) return c;
  if (parentId && (parentId === id || (isFolder(found.node) && findNode(found.node.item, parentId)))) return c;
  return insertNode(removeNode(c, id), parentId, found.node, index);
}

export function parentOf(c: PMCollection, id: string): PMFolder | null {
  const r = findNode(c.item, id);
  return r && r.ancestors.length ? r.ancestors[r.ancestors.length - 1] : null;
}

export function pathOf(ref: ItemRef): string {
  return [...ref.ancestors.map((a) => a.name), ref.item.name].join(' / ');
}
