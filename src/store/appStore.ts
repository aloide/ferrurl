// Store principal de FerrURL (Zustand) con persistencia en AppData/portable y Credential Manager.

import { create } from 'zustand';
import { DEFAULT_GLOBALS, type GlobalRequestDefaults } from '../core/build';
import { uid } from '../core/encoding';
import {
  exportCollection,
  importAny,
  newCollection,
  newFolder,
  newRequestItem,
} from '../core/postman';
import {
  chainFromState,
  runSingleItem,
  syncCollectionVariables,
  syncEnvironmentVariables,
  type ItemRunResult,
  type SubRequestLog,
} from '../core/runner';
import { findNode, insertNode, moveNode, removeNode, updateNode } from '../core/tree';
import { isFolder, type Environment, type PMCollection, type PMFolder, type PMItem, type PMNode, type PMVariable } from '../core/types';
import { type HttpError, type NetworkConfig, type ParsedResponse, type WireRequest } from '../core/wire';
import { WorkerScriptHost } from '../sandbox/workerHost';
import type { LogEntry } from '../sandbox/protocol';
import {
  getAppInfo,
  secretGet,
  secretSet,
  setNetworkConfig,
  storageDelete,
  storageList,
  storageRead,
  storageWrite,
  tauriTransport,
  type AppInfo,
} from '../platform/tauri';

export type TabKind = 'request' | 'container' | 'environment' | 'runner';

export interface OpenTab {
  id: string;
  kind: TabKind;
  title: string;
  method?: string;
  collectionId?: string;
  nodeId?: string; // request, folder, o environment id; para runner puede ser folderId
  dirty?: boolean;
}

export interface HistoryEntry {
  id: string;
  time: number;
  name: string;
  method: string;
  url: string;
  status?: number;
  statusText?: string;
  timeMs?: number;
  error?: string;
  item: PMItem;
}

export interface ConsoleEntry {
  id: string;
  time: number;
  kind: 'http' | 'log' | 'error';
  level?: LogEntry['level'];
  source: string;
  message?: string;
  wire?: WireRequest;
  response?: ParsedResponse;
  error?: HttpError;
}

export interface AppSettings {
  network: NetworkConfig;
  defaults: GlobalRequestDefaults;
  theme: 'dark' | 'light';
  scriptTimeoutMs: number;
  maxResponseViewBytes: number;
}

export const INITIAL_SETTINGS: AppSettings = {
  network: {
    proxy: { mode: 'off', httpHost: '', httpPort: 8080, httpsHost: '', httpsPort: 8080, username: '', password: '', bypass: 'localhost, 127.0.0.1' },
    tls: { verify: true, extraCaPaths: [] },
  },
  defaults: DEFAULT_GLOBALS,
  theme: 'dark',
  scriptTimeoutMs: 30000,
  maxResponseViewBytes: 2 * 1024 * 1024,
};

export interface RequestRunState {
  running: boolean;
  requestId?: string;
  result?: ItemRunResult;
}

interface WorkspaceState {
  collectionIds: string[];
  environmentIds: string[];
  activeEnvId: string | null;
  tabs: OpenTab[];
  activeTabId: string | null;
  globals: PMVariable[];
}

interface AppStore {
  ready: boolean;
  appInfo: AppInfo | null;
  collections: Record<string, PMCollection>;
  collectionOrder: string[];
  environments: Record<string, Environment>;
  environmentOrder: string[];
  /** secretos por envId -> { key: value } */
  secrets: Record<string, Record<string, string>>;
  activeEnvId: string | null;
  globals: PMVariable[];
  settings: AppSettings;
  tabs: OpenTab[];
  activeTabId: string | null;
  history: HistoryEntry[];
  consoleLogs: ConsoleEntry[];
  consoleOpen: boolean;
  settingsOpen: boolean;
  importOpen: boolean;
  quickLookOpen: boolean;
  runStates: Record<string, RequestRunState>;
  /** requests sueltos (scratch) guardados en el tab */
  scratchItems: Record<string, PMItem>;

  init: () => Promise<void>;
  setConsoleOpen: (v: boolean) => void;
  setSettingsOpen: (v: boolean) => void;
  setImportOpen: (v: boolean) => void;
  setQuickLookOpen: (v: boolean) => void;
  clearConsole: () => void;
  pushConsole: (entry: Omit<ConsoleEntry, 'id' | 'time'>) => void;

  // Settings / proxy
  updateSettings: (next: AppSettings) => Promise<void>;
  setTheme: (theme: 'dark' | 'light') => void;

  // Colecciones
  createCollection: (name?: string) => Promise<string>;
  importJsonText: (text: string) => Promise<{ kind: string; name: string; warnings: string[] }>;
  renameCollection: (colId: string, name: string) => void;
  deleteCollection: (colId: string) => Promise<void>;
  updateCollection: (colId: string, fn: (c: PMCollection) => PMCollection) => void;
  addRequest: (colId: string, parentId: string | null, name?: string) => string;
  addFolder: (colId: string, parentId: string | null, name?: string) => string;
  duplicateNode: (colId: string, nodeId: string) => void;
  deleteNode: (colId: string, nodeId: string) => void;
  moveCollectionNode: (colId: string, nodeId: string, targetFolderId: string | null, index?: number) => void;
  updateItem: (colId: string | undefined, itemId: string, fn: (item: PMItem) => PMItem) => void;
  updateFolder: (colId: string, folderId: string, fn: (f: PMFolder) => PMFolder) => void;

  // Ambientes y secretos
  createEnvironment: (name?: string) => Promise<string>;
  updateEnvironment: (envId: string, fn: (e: Environment) => Environment) => void;
  deleteEnvironment: (envId: string) => Promise<void>;
  setActiveEnv: (envId: string | null) => void;
  setEnvSecret: (envId: string, key: string, value: string) => Promise<void>;
  setGlobals: (vars: PMVariable[]) => void;

  // Tabs
  openRequestTab: (colId: string, itemId: string) => void;
  openScratchTab: (item?: PMItem) => string;
  openContainerTab: (colId: string, nodeId?: string) => void;
  openEnvironmentTab: (envId: string) => void;
  openRunnerTab: (colId: string, folderId?: string) => void;
  closeTab: (tabId: string) => void;
  setActiveTab: (tabId: string) => void;
  saveTab: (tabId: string) => Promise<void>;

  // Ejecucion
  sendTabRequest: (tabId: string) => Promise<void>;
  cancelTabRequest: (tabId: string) => Promise<void>;
  saveScratchToCollection: (tabId: string, colId: string, parentId: string | null) => void;
  clearHistory: () => Promise<void>;
}

const scriptHost = new WorkerScriptHost();

function persistCollection(col: PMCollection) {
  const id = col.info._postman_id!;
  void storageWrite(`collections/${id}.postman_collection.json`, exportCollection(col));
}

function persistEnv(env: Environment) {
  // No escribimos secretos en texto plano en el JSON del ambiente.
  const sanitized: Environment = {
    ...env,
    values: env.values.map((v) => (v.type === 'secret' ? { ...v, value: '', currentValue: undefined } : v)),
  };
  void storageWrite(`environments/${env.id}.json`, JSON.stringify(sanitized, null, 2));
}

function persistWorkspace(s: AppStore) {
  const ws: WorkspaceState = {
    collectionIds: s.collectionOrder,
    environmentIds: s.environmentOrder,
    activeEnvId: s.activeEnvId,
    tabs: s.tabs.filter((t) => !t.id.startsWith('scratch:') || s.scratchItems[t.id]),
    activeTabId: s.activeTabId,
    globals: s.globals,
  };
  void storageWrite('workspace.json', JSON.stringify(ws, null, 2));
}

async function loadEnvSecrets(env: Environment): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  for (const v of env.values) {
    if (v.type === 'secret' && v.key) {
      const saved = await secretGet(`env:${env.id}:${v.key}`);
      if (saved !== null) out[v.key] = saved;
      else if (v.value) {
        // Si venia de un archivo importado con valor, lo migramos a keyring
        out[v.key] = v.value;
        await secretSet(`env:${env.id}:${v.key}`, v.value);
      }
    }
  }
  return out;
}

export const useAppStore = create<AppStore>((set, get) => ({
  ready: false,
  appInfo: null,
  collections: {},
  collectionOrder: [],
  environments: {},
  environmentOrder: [],
  secrets: {},
  activeEnvId: null,
  globals: [],
  settings: INITIAL_SETTINGS,
  tabs: [],
  activeTabId: null,
  history: [],
  consoleLogs: [],
  consoleOpen: false,
  settingsOpen: false,
  importOpen: false,
  quickLookOpen: false,
  runStates: {},
  scratchItems: {},

  init: async () => {
    const info = await getAppInfo();
    let settings = INITIAL_SETTINGS;
    try {
      const sRaw = await storageRead('settings.json');
      if (sRaw) {
        const parsed = JSON.parse(sRaw) as Partial<AppSettings>;
        settings = {
          ...INITIAL_SETTINGS,
          ...parsed,
          network: {
            proxy: { ...INITIAL_SETTINGS.network.proxy, ...(parsed.network?.proxy ?? {}) },
            tls: { ...INITIAL_SETTINGS.network.tls, ...(parsed.network?.tls ?? {}) },
          },
          defaults: { ...INITIAL_SETTINGS.defaults, ...(parsed.defaults ?? {}) },
        };
      }
    } catch {
      /* defaults */
    }
    const proxyPass = await secretGet('proxy:password');
    if (proxyPass !== null) settings.network.proxy.password = proxyPass;
    await setNetworkConfig(settings.network).catch(() => {});

    let ws: Partial<WorkspaceState> = {};
    try {
      const wRaw = await storageRead('workspace.json');
      if (wRaw) ws = JSON.parse(wRaw);
    } catch {
      /* ignore */
    }

    const collections: Record<string, PMCollection> = {};
    const colFiles = await storageList('collections');
    for (const f of colFiles) {
      try {
        const txt = await storageRead(`collections/${f}`);
        if (!txt) continue;
        const parsed = importAny(txt);
        if (parsed.kind === 'collection') {
          const id = parsed.collection.info._postman_id!;
          collections[id] = parsed.collection;
        }
      } catch {
        /* ignore corrupt */
      }
    }

    const environments: Record<string, Environment> = {};
    const secrets: Record<string, Record<string, string>> = {};
    const envFiles = await storageList('environments');
    for (const f of envFiles) {
      try {
        const txt = await storageRead(`environments/${f}`);
        if (!txt) continue;
        const env = JSON.parse(txt) as Environment;
        environments[env.id] = env;
        secrets[env.id] = await loadEnvSecrets(env);
      } catch {
        /* ignore */
      }
    }

    let history: HistoryEntry[] = [];
    try {
      const hRaw = await storageRead('history.json');
      if (hRaw) history = JSON.parse(hRaw);
    } catch {
      /* ignore */
    }

    const colOrder = (ws.collectionIds ?? []).filter((id) => collections[id]);
    for (const id of Object.keys(collections)) if (!colOrder.includes(id)) colOrder.push(id);

    const envOrder = (ws.environmentIds ?? []).filter((id) => environments[id]);
    for (const id of Object.keys(environments)) if (!envOrder.includes(id)) envOrder.push(id);

    const validTabs = (ws.tabs ?? []).filter((t) => {
      if (t.kind === 'environment') return !!(t.nodeId && environments[t.nodeId]);
      if (t.kind === 'runner' || t.kind === 'container') return !!(t.collectionId && collections[t.collectionId]);
      if (t.kind === 'request') return !!(t.collectionId && t.nodeId && collections[t.collectionId] && findNode(collections[t.collectionId].item, t.nodeId));
      return false;
    });

    document.documentElement.dataset.theme = settings.theme;

    set({
      ready: true,
      appInfo: info,
      collections,
      collectionOrder: colOrder,
      environments,
      environmentOrder: envOrder,
      secrets,
      activeEnvId: ws.activeEnvId && environments[ws.activeEnvId] ? ws.activeEnvId : envOrder[0] ?? null,
      globals: ws.globals ?? [],
      settings,
      tabs: validTabs,
      activeTabId: ws.activeTabId && validTabs.some((t) => t.id === ws.activeTabId) ? ws.activeTabId : validTabs[0]?.id ?? null,
      history,
    });
  },

  setConsoleOpen: (v) => set({ consoleOpen: v }),
  setSettingsOpen: (v) => set({ settingsOpen: v }),
  setImportOpen: (v) => set({ importOpen: v }),
  setQuickLookOpen: (v) => set({ quickLookOpen: v }),
  clearConsole: () => set({ consoleLogs: [] }),
  pushConsole: (entry) =>
    set((s) => ({
      consoleLogs: [...s.consoleLogs.slice(-499), { ...entry, id: uid(), time: Date.now() }],
    })),

  updateSettings: async (next) => {
    await secretSet('proxy:password', next.network.proxy.password);
    await setNetworkConfig(next.network);
    const sanitized: AppSettings = {
      ...next,
      network: {
        ...next.network,
        proxy: { ...next.network.proxy, password: '' },
      },
    };
    await storageWrite('settings.json', JSON.stringify(sanitized, null, 2));
    document.documentElement.dataset.theme = next.theme;
    set({ settings: next });
  },

  setTheme: (theme) => {
    const next = { ...get().settings, theme };
    void get().updateSettings(next);
  },

  createCollection: async (name = 'Nueva colección') => {
    const col = newCollection(name);
    const id = col.info._postman_id!;
    persistCollection(col);
    set((s) => {
      const next = {
        collections: { ...s.collections, [id]: col },
        collectionOrder: [...s.collectionOrder, id],
      };
      persistWorkspace({ ...s, ...next });
      return next;
    });
    return id;
  },

  importJsonText: async (text) => {
    const imported = importAny(text);
    if (imported.kind === 'collection') {
      const col = imported.collection;
      const id = col.info._postman_id!;
      persistCollection(col);
      set((s) => {
        const order = s.collectionOrder.includes(id) ? s.collectionOrder : [...s.collectionOrder, id];
        const next = { collections: { ...s.collections, [id]: col }, collectionOrder: order };
        persistWorkspace({ ...s, ...next });
        return next;
      });
      return { kind: 'Colección', name: col.info.name, warnings: imported.warnings };
    }
    if (imported.kind === 'environment') {
      const env = imported.environment;
      const envSecrets = await loadEnvSecrets(env);
      persistEnv(env);
      set((s) => {
        const order = s.environmentOrder.includes(env.id) ? s.environmentOrder : [...s.environmentOrder, env.id];
        const next = {
          environments: { ...s.environments, [env.id]: env },
          environmentOrder: order,
          secrets: { ...s.secrets, [env.id]: { ...(s.secrets[env.id] ?? {}), ...envSecrets } },
          activeEnvId: s.activeEnvId ?? env.id,
        };
        persistWorkspace({ ...s, ...next });
        return next;
      });
      return { kind: 'Ambiente', name: env.name, warnings: imported.warnings };
    }
    set((s) => {
      const globals = imported.values.map((v) => ({ key: v.key, value: v.value, disabled: v.enabled === false }));
      persistWorkspace({ ...s, globals });
      return { globals };
    });
    return { kind: 'Globals', name: 'Variables globales', warnings: imported.warnings };
  },

  renameCollection: (colId, name) => {
    get().updateCollection(colId, (c) => ({ ...c, info: { ...c.info, name } }));
  },

  deleteCollection: async (colId) => {
    await storageDelete(`collections/${colId}.postman_collection.json`);
    set((s) => {
      const { [colId]: _, ...rest } = s.collections;
      const tabs = s.tabs.filter((t) => t.collectionId !== colId);
      const activeTabId = tabs.some((t) => t.id === s.activeTabId) ? s.activeTabId : tabs[0]?.id ?? null;
      const next = {
        collections: rest,
        collectionOrder: s.collectionOrder.filter((id) => id !== colId),
        tabs,
        activeTabId,
      };
      persistWorkspace({ ...s, ...next });
      return next;
    });
  },

  updateCollection: (colId, fn) => {
    const cur = get().collections[colId];
    if (!cur) return;
    const updated = fn(cur);
    persistCollection(updated);
    set((s) => ({
      collections: { ...s.collections, [colId]: updated },
      tabs: s.tabs.map((t) => (t.kind === 'container' && t.collectionId === colId && !t.nodeId ? { ...t, title: updated.info.name } : t)),
    }));
  },

  addRequest: (colId, parentId, name = 'Nuevo request') => {
    const item = newRequestItem(name);
    get().updateCollection(colId, (c) => insertNode(c, parentId, item));
    get().openRequestTab(colId, item.id);
    return item.id;
  },

  addFolder: (colId, parentId, name = 'Nueva carpeta') => {
    const folder = newFolder(name);
    get().updateCollection(colId, (c) => insertNode(c, parentId, folder));
    return folder.id;
  },

  duplicateNode: (colId, nodeId) => {
    const col = get().collections[colId];
    if (!col) return;
    const found = findNode(col.item, nodeId);
    if (!found) return;
    const reId = (n: PMNode): PMNode =>
      isFolder(n) ? { ...structuredClone(n), id: uid(), item: n.item.map(reId) } : { ...structuredClone(n), id: uid() };
    const clone = reId(found.node);
    clone.name = `${clone.name} (copia)`;
    const parentId = found.ancestors.length ? found.ancestors[found.ancestors.length - 1].id : null;
    get().updateCollection(colId, (c) => insertNode(c, parentId, clone));
  },

  deleteNode: (colId, nodeId) => {
    get().updateCollection(colId, (c) => removeNode(c, nodeId));
    set((s) => {
      const tabs = s.tabs.filter((t) => t.nodeId !== nodeId);
      const activeTabId = tabs.some((t) => t.id === s.activeTabId) ? s.activeTabId : tabs[0]?.id ?? null;
      const next = { tabs, activeTabId };
      persistWorkspace({ ...s, ...next });
      return next;
    });
  },

  moveCollectionNode: (colId, nodeId, targetFolderId, index) => {
    get().updateCollection(colId, (c) => moveNode(c, nodeId, targetFolderId, index));
  },

  updateItem: (colId, itemId, fn) => {
    if (!colId) {
      const cur = get().scratchItems[itemId];
      if (!cur) return;
      const updated = fn(cur);
      set((s) => ({
        scratchItems: { ...s.scratchItems, [itemId]: updated },
        tabs: s.tabs.map((t) =>
          t.id === itemId ? { ...t, title: updated.name, method: updated.request.method, dirty: true } : t,
        ),
      }));
      return;
    }
    get().updateCollection(colId, (c) =>
      updateNode(c, itemId, (n) => (isFolder(n) ? n : fn(n))),
    );
    const col = get().collections[colId];
    const found = col ? findNode(col.item, itemId) : null;
    if (found && !isFolder(found.node)) {
      const item = found.node;
      set((s) => ({
        tabs: s.tabs.map((t) =>
          t.kind === 'request' && t.nodeId === itemId ? { ...t, title: item.name, method: item.request.method } : t,
        ),
      }));
    }
  },

  updateFolder: (colId, folderId, fn) => {
    get().updateCollection(colId, (c) =>
      updateNode(c, folderId, (n) => (isFolder(n) ? fn(n) : n)),
    );
    const col = get().collections[colId];
    const found = col ? findNode(col.item, folderId) : null;
    if (found && isFolder(found.node)) {
      const f = found.node;
      set((s) => ({
        tabs: s.tabs.map((t) => (t.kind === 'container' && t.nodeId === folderId ? { ...t, title: f.name } : t)),
      }));
    }
  },

  createEnvironment: async (name = 'Nuevo ambiente') => {
    const env: Environment = { id: uid(), name, values: [] };
    persistEnv(env);
    set((s) => {
      const next = {
        environments: { ...s.environments, [env.id]: env },
        environmentOrder: [...s.environmentOrder, env.id],
        secrets: { ...s.secrets, [env.id]: {} },
        activeEnvId: s.activeEnvId ?? env.id,
      };
      persistWorkspace({ ...s, ...next });
      return next;
    });
    get().openEnvironmentTab(env.id);
    return env.id;
  },

  updateEnvironment: (envId, fn) => {
    const cur = get().environments[envId];
    if (!cur) return;
    const updated = fn(cur);
    persistEnv(updated);
    set((s) => ({
      environments: { ...s.environments, [envId]: updated },
      tabs: s.tabs.map((t) => (t.kind === 'environment' && t.nodeId === envId ? { ...t, title: updated.name } : t)),
    }));
  },

  deleteEnvironment: async (envId) => {
    await storageDelete(`environments/${envId}.json`);
    set((s) => {
      const { [envId]: _, ...rest } = s.environments;
      const envOrder = s.environmentOrder.filter((id) => id !== envId);
      const tabs = s.tabs.filter((t) => !(t.kind === 'environment' && t.nodeId === envId));
      const next = {
        environments: rest,
        environmentOrder: envOrder,
        activeEnvId: s.activeEnvId === envId ? envOrder[0] ?? null : s.activeEnvId,
        tabs,
        activeTabId: tabs.some((t) => t.id === s.activeTabId) ? s.activeTabId : tabs[0]?.id ?? null,
      };
      persistWorkspace({ ...s, ...next });
      return next;
    });
  },

  setActiveEnv: (envId) => {
    set((s) => {
      const next = { activeEnvId: envId };
      persistWorkspace({ ...s, ...next });
      return next;
    });
  },

  setEnvSecret: async (envId, key, value) => {
    await secretSet(`env:${envId}:${key}`, value);
    set((s) => ({
      secrets: {
        ...s.secrets,
        [envId]: { ...(s.secrets[envId] ?? {}), [key]: value },
      },
    }));
  },

  setGlobals: (globals) => {
    set((s) => {
      persistWorkspace({ ...s, globals });
      return { globals };
    });
  },

  openRequestTab: (colId, itemId) => {
    const col = get().collections[colId];
    const found = col ? findNode(col.item, itemId) : null;
    if (!found || isFolder(found.node)) return;
    const item = found.node;
    const id = `req:${colId}:${itemId}`;
    set((s) => {
      const exists = s.tabs.some((t) => t.id === id);
      const tabs = exists
        ? s.tabs
        : [...s.tabs, { id, kind: 'request' as const, title: item.name, method: item.request.method, collectionId: colId, nodeId: itemId }];
      const next = { tabs, activeTabId: id };
      persistWorkspace({ ...s, ...next });
      return next;
    });
  },

  openScratchTab: (item) => {
    const it = item ? structuredClone(item) : newRequestItem('Request rápido');
    const id = `scratch:${uid()}`;
    it.id = id;
    set((s) => {
      const tab: OpenTab = { id, kind: 'request', title: it.name, method: it.request.method, nodeId: id };
      const next = {
        scratchItems: { ...s.scratchItems, [id]: it },
        tabs: [...s.tabs, tab],
        activeTabId: id,
      };
      persistWorkspace({ ...s, ...next });
      return next;
    });
    return id;
  },

  openContainerTab: (colId, nodeId) => {
    const col = get().collections[colId];
    if (!col) return;
    const folder = nodeId ? findNode(col.item, nodeId)?.node : null;
    const title = folder ? folder.name : col.info.name;
    const id = nodeId ? `folder:${colId}:${nodeId}` : `col:${colId}`;
    set((s) => {
      const exists = s.tabs.some((t) => t.id === id);
      const tabs = exists ? s.tabs : [...s.tabs, { id, kind: 'container' as const, title, collectionId: colId, nodeId }];
      const next = { tabs, activeTabId: id };
      persistWorkspace({ ...s, ...next });
      return next;
    });
  },

  openEnvironmentTab: (envId) => {
    const env = get().environments[envId];
    if (!env) return;
    const id = `env:${envId}`;
    set((s) => {
      const exists = s.tabs.some((t) => t.id === id);
      const tabs = exists ? s.tabs : [...s.tabs, { id, kind: 'environment' as const, title: env.name, nodeId: envId }];
      const next = { tabs, activeTabId: id };
      persistWorkspace({ ...s, ...next });
      return next;
    });
  },

  openRunnerTab: (colId, folderId) => {
    const col = get().collections[colId];
    if (!col) return;
    const folder = folderId ? findNode(col.item, folderId)?.node : null;
    const id = `runner:${colId}:${folderId ?? 'all'}`;
    const title = folder ? `Runner: ${folder.name}` : `Runner: ${col.info.name}`;
    set((s) => {
      const exists = s.tabs.some((t) => t.id === id);
      const tabs = exists ? s.tabs : [...s.tabs, { id, kind: 'runner' as const, title, collectionId: colId, nodeId: folderId }];
      const next = { tabs, activeTabId: id };
      persistWorkspace({ ...s, ...next });
      return next;
    });
  },

  closeTab: (tabId) => {
    set((s) => {
      const idx = s.tabs.findIndex((t) => t.id === tabId);
      const tabs = s.tabs.filter((t) => t.id !== tabId);
      const activeTabId = s.activeTabId === tabId ? (tabs[Math.min(idx, tabs.length - 1)]?.id ?? null) : s.activeTabId;
      const { [tabId]: _, ...scratchItems } = s.scratchItems;
      const next = { tabs, activeTabId, scratchItems };
      persistWorkspace({ ...s, ...next });
      return next;
    });
  },

  setActiveTab: (tabId) => {
    set((s) => {
      const next = { activeTabId: tabId };
      persistWorkspace({ ...s, ...next });
      return next;
    });
  },

  saveTab: async (tabId) => {
    const tab = get().tabs.find((t) => t.id === tabId);
    if (!tab) return;
    if (tab.collectionId && get().collections[tab.collectionId]) {
      persistCollection(get().collections[tab.collectionId]);
    }
    set((s) => ({ tabs: s.tabs.map((t) => (t.id === tabId ? { ...t, dirty: false } : t)) }));
  },

  saveScratchToCollection: (tabId, colId, parentId) => {
    const item = get().scratchItems[tabId];
    if (!item) return;
    const saved: PMItem = { ...structuredClone(item), id: uid() };
    get().updateCollection(colId, (c) => insertNode(c, parentId, saved));
    get().closeTab(tabId);
    get().openRequestTab(colId, saved.id);
  },

  sendTabRequest: async (tabId) => {
    const s = get();
    const tab = s.tabs.find((t) => t.id === tabId);
    if (!tab || tab.kind !== 'request') return;

    let col: PMCollection;
    let item: PMItem;
    let ancestors: PMFolder[] = [];

    if (tab.collectionId && tab.nodeId) {
      col = s.collections[tab.collectionId];
      const found = col ? findNode(col.item, tab.nodeId) : null;
      if (!col || !found || isFolder(found.node)) return;
      item = found.node;
      ancestors = found.ancestors;
    } else {
      const scratch = s.scratchItems[tab.id];
      if (!scratch) return;
      col = newCollection('Rápido');
      item = scratch;
    }

    const reqId = uid();
    set((st) => ({ runStates: { ...st.runStates, [tabId]: { running: true, requestId: reqId, result: st.runStates[tabId]?.result } } }));

    const env = s.activeEnvId ? s.environments[s.activeEnvId] : null;
    const envSecrets = s.activeEnvId ? s.secrets[s.activeEnvId] ?? {} : {};
    const chain = chainFromState({ collection: col, environment: env, secrets: envSecrets, globals: s.globals });

    const result = await runSingleItem({ item, ancestors }, col, chain, tauriTransport, scriptHost, {
      environmentName: env?.name ?? '',
      scriptTimeoutMs: s.settings.scriptTimeoutMs,
      globals: s.settings.defaults,
      requestId: reqId,
      onLog: (entry) => get().pushConsole({ kind: entry.level === 'error' ? 'error' : 'log', level: entry.level, source: item.name, message: entry.message }),
      onSubRequest: (sub: SubRequestLog) =>
        get().pushConsole({
          kind: 'http',
          source: `pm.sendRequest (${item.name})`,
          wire: sub.wire,
          response: sub.response,
          error: sub.error,
        }),
    });

    if (result.wire) {
      get().pushConsole({ kind: 'http', source: item.name, wire: result.wire, response: result.response, error: result.error });
    }

    // Guardar cambios en variables de coleccion / ambiente / globals
    if (tab.collectionId && s.collections[tab.collectionId]) {
      get().updateCollection(tab.collectionId, (c) => syncCollectionVariables(c, chain.collection));
    }
    if (env) {
      const { env: nextEnv, secretUpdates } = syncEnvironmentVariables(env, chain.environment);
      get().updateEnvironment(env.id, () => nextEnv);
      for (const [k, v] of Object.entries(secretUpdates)) await get().setEnvSecret(env.id, k, v);
    }

    // Guardar en historial
    const hEntry: HistoryEntry = {
      id: uid(),
      time: Date.now(),
      name: item.name,
      method: result.wire?.method ?? item.request.method,
      url: result.wire?.url ?? item.request.url.raw,
      status: result.response?.code,
      statusText: result.response?.status,
      timeMs: result.response?.responseTime,
      error: result.error?.message,
      item: structuredClone(item),
    };

    set((st) => {
      const history = [hEntry, ...st.history].slice(0, 200);
      void storageWrite('history.json', JSON.stringify(history));
      return {
        history,
        runStates: { ...st.runStates, [tabId]: { running: false, result } },
      };
    });
  },

  cancelTabRequest: async (tabId) => {
    const reqId = get().runStates[tabId]?.requestId;
    if (reqId) await tauriTransport.cancel(reqId);
  },

  clearHistory: async () => {
    await storageWrite('history.json', '[]');
    set({ history: [] });
  },
}));
