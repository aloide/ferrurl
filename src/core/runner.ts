// Ejecutor de requests individuales y colecciones/carpetas (Runner).
// Sigue el orden de Postman:
//   prerequest (coleccion -> carpetas -> request)
//   -> resolver variables + auth -> HTTP (via Transport)
//   -> test (coleccion -> carpetas -> request)

import { buildWire, createDraft, DEFAULT_GLOBALS, parseResponse, type GlobalRequestDefaults } from './build';
import { scriptOf } from './postman';
import { itemsForTarget, pathOf, type ItemRef } from './tree';
import type { Environment, PMCollection, PMFolder, PMItem, PMVariable } from './types';
import { emptyChain, VariableScope, type ScopeChain, type ScopeName } from './variables';
import { toHttpError, type HttpError, type ParsedResponse, type Transport, type WireRequest } from './wire';
import { applyScopeSnapshot, chainToSnapshot } from '../sandbox/engine';
import { makeBridge } from '../sandbox/workerHost';
import type { LogEntry, ScriptErrorInfo, ScriptHost, SendResult, TestResult } from '../sandbox/protocol';

export interface SubRequestLog {
  wire: WireRequest;
  response?: ParsedResponse;
  error?: HttpError;
}

export interface ItemRunResult {
  itemId: string;
  itemName: string;
  path: string;
  iteration: number;
  skipped: boolean;
  wire?: WireRequest;
  response?: ParsedResponse;
  error?: HttpError;
  tests: TestResult[];
  logs: LogEntry[];
  scriptErrors: { location: string; phase: 'prerequest' | 'test'; error: ScriptErrorInfo }[];
  subRequests: SubRequestLog[];
  unresolvedVariables: string[];
  nextRequest?: string | null;
  nextRequestSet: boolean;
  durationMs: number;
}

export interface RunnerOptions {
  folderId?: string | null;
  selectedItemIds?: Set<string>;
  iterations?: number;
  delayMs?: number;
  stopOnError?: boolean;
  stopOnScriptError?: boolean;
  scriptTimeoutMs?: number;
  dataRows?: Record<string, unknown>[];
  globals?: GlobalRequestDefaults;
  environmentName?: string;
  signal?: AbortSignal;
}

export type RunEvent =
  | { type: 'start'; totalItems: number; iterations: number }
  | { type: 'itemStart'; itemId: string; itemName: string; path: string; iteration: number; index: number }
  | { type: 'log'; itemId: string; entry: LogEntry }
  | { type: 'subRequest'; itemId: string; log: SubRequestLog }
  | { type: 'itemDone'; result: ItemRunResult }
  | { type: 'done'; stopped: boolean; durationMs: number };

export function chainFromState(opts: {
  collection?: PMCollection;
  environment?: Environment | null;
  secrets?: Record<string, string>;
  globals?: PMVariable[];
}): ScopeChain {
  const chain = emptyChain();
  for (const v of opts.globals ?? []) {
    if (!v.disabled && v.key) chain.globals.set(v.key, v.value ?? '');
  }
  for (const v of opts.collection?.variable ?? []) {
    if (!v.disabled && v.key) chain.collection.set(v.key, v.value ?? '');
  }
  if (opts.environment) {
    for (const v of opts.environment.values) {
      if (v.enabled === false || !v.key) continue;
      const val =
        v.type === 'secret'
          ? opts.secrets?.[v.key] ?? v.currentValue ?? v.value ?? ''
          : v.currentValue !== undefined
            ? v.currentValue
            : v.value ?? '';
      chain.environment.set(v.key, val);
    }
  }
  return chain;
}

/** Escribe los cambios de collection y environment de vuelta a los modelos (sin perder metadatos). */
export function syncCollectionVariables(collection: PMCollection, scope: VariableScope): PMCollection {
  const existing = [...(collection.variable ?? [])];
  const seen = new Set<string>();
  const updated = existing.map((v) => {
    if (!v.key) return v;
    seen.add(v.key);
    if (scope.has(v.key)) return { ...v, value: String(scope.get(v.key) ?? '') };
    return v;
  });
  for (const [k, val] of scope.entries()) {
    if (!seen.has(k)) updated.push({ key: k, value: String(val ?? '') });
  }
  return { ...collection, variable: updated };
}

export function syncEnvironmentVariables(
  env: Environment,
  scope: VariableScope,
): { env: Environment; secretUpdates: Record<string, string> } {
  const secretUpdates: Record<string, string> = {};
  const existing = [...env.values];
  const seen = new Set<string>();
  const values = existing.map((v) => {
    if (!v.key) return v;
    seen.add(v.key);
    if (!scope.has(v.key)) return v;
    const next = String(scope.get(v.key) ?? '');
    if (v.type === 'secret') {
      secretUpdates[v.key] = next;
      return v;
    }
    return { ...v, currentValue: next };
  });
  for (const [k, val] of scope.entries()) {
    if (!seen.has(k)) values.push({ key: k, value: '', currentValue: String(val ?? ''), type: 'default', enabled: true });
  }
  return { env: { ...env, values }, secretUpdates };
}

interface ScriptStage {
  location: string;
  code: string;
}

function collectStages(collection: PMCollection, ancestors: PMFolder[], item: PMItem, kind: 'prerequest' | 'test'): ScriptStage[] {
  const stages: ScriptStage[] = [];
  const colCode = scriptOf(collection.event, kind);
  if (colCode.trim()) stages.push({ location: 'colección', code: colCode });
  for (const f of ancestors) {
    const fc = scriptOf(f.event, kind);
    if (fc.trim()) stages.push({ location: `carpeta "${f.name}"`, code: fc });
  }
  const itemCode = scriptOf(item.event, kind);
  if (itemCode.trim()) stages.push({ location: 'request', code: itemCode });
  return stages;
}

const PERSISTED_SCOPES: ScopeName[] = ['local', 'data', 'environment', 'collection', 'globals'];

export async function runSingleItem(
  ref: ItemRef,
  collection: PMCollection,
  chain: ScopeChain,
  transport: Transport,
  scriptHost: ScriptHost,
  opts: {
    iteration?: number;
    iterationCount?: number;
    environmentName?: string;
    scriptTimeoutMs?: number;
    stopOnScriptError?: boolean;
    globals?: GlobalRequestDefaults;
    requestId?: string;
    onLog?: (entry: LogEntry) => void;
    onSubRequest?: (log: SubRequestLog) => void;
  } = {},
): Promise<ItemRunResult> {
  const started = Date.now();
  const { item, ancestors } = ref;
  const path = pathOf(ref);
  const iteration = opts.iteration ?? 0;
  const iterationCount = opts.iterationCount ?? 1;
  const timeoutMs = opts.scriptTimeoutMs ?? 30000;
  const globals = opts.globals ?? DEFAULT_GLOBALS;

  // Cada ejecucion arranca con local limpio (las variables de coleccion/ambiente/globals persisten en `chain`).
  chain.local.clear();

  let draft = createDraft(item, ancestors, collection, globals);
  const tests: TestResult[] = [];
  const logs: LogEntry[] = [];
  const scriptErrors: ItemRunResult['scriptErrors'] = [];
  const subRequests: SubRequestLog[] = [];
  let nextRequest: string | null | undefined;
  let nextRequestSet = false;
  let skipRequest = false;

  const bridge = makeBridge(
    transport,
    (wire, result: SendResult) => {
      const log: SubRequestLog = { wire, response: result.response, error: result.error };
      subRequests.push(log);
      opts.onSubRequest?.(log);
    },
    (entry) => {
      logs.push(entry);
      opts.onLog?.(entry);
    },
  );

  // 1. Pre-request scripts (coleccion -> carpetas -> request)
  for (const stage of collectStages(collection, ancestors, item, 'prerequest')) {
    const out = await scriptHost.run(
      {
        kind: 'prerequest',
        code: stage.code,
        location: stage.location,
        scopes: chainToSnapshot(chain),
        request: draft,
        info: {
          requestName: item.name,
          requestId: item.id,
          eventName: 'prerequest',
          iteration,
          iterationCount,
          collectionName: collection.info.name,
          environmentName: opts.environmentName ?? '',
        },
        timeoutMs,
      },
      bridge,
    );
    applyScopeSnapshot(chain, out.scopes, PERSISTED_SCOPES);
    draft = out.request;
    tests.push(...out.tests);
    logs.push(...out.logs);
    out.errors.forEach((error) => scriptErrors.push({ location: stage.location, phase: 'prerequest', error }));
    if (out.nextRequestSet) {
      nextRequest = out.nextRequest;
      nextRequestSet = true;
    }
    if (out.skipRequest) skipRequest = true;
  }

  if (skipRequest || (opts.stopOnScriptError && scriptErrors.length > 0)) {
    return {
      itemId: item.id,
      itemName: item.name,
      path,
      iteration,
      skipped: skipRequest,
      tests,
      logs,
      scriptErrors,
      subRequests,
      unresolvedVariables: [],
      nextRequest,
      nextRequestSet,
      durationMs: Date.now() - started,
    };
  }

  // 2. Construir request final y enviar por Rust/Transport
  const { wire, unresolved } = buildWire(draft, chain, globals, opts.requestId);
  let response: ParsedResponse | undefined;
  let error: HttpError | undefined;

  try {
    const rawResp = await transport.send(wire);
    response = parseResponse(rawResp);
  } catch (e) {
    error = toHttpError(e);
  }

  // 3. Test scripts (coleccion -> carpetas -> request) solo si hubo respuesta
  if (response) {
    for (const stage of collectStages(collection, ancestors, item, 'test')) {
      const out = await scriptHost.run(
        {
          kind: 'test',
          code: stage.code,
          location: stage.location,
          scopes: chainToSnapshot(chain),
          request: draft,
          response,
          info: {
            requestName: item.name,
            requestId: item.id,
            eventName: 'test',
            iteration,
            iterationCount,
            collectionName: collection.info.name,
            environmentName: opts.environmentName ?? '',
          },
          timeoutMs,
        },
        bridge,
      );
      applyScopeSnapshot(chain, out.scopes, PERSISTED_SCOPES);
      tests.push(...out.tests);
      logs.push(...out.logs);
      out.errors.forEach((err) => scriptErrors.push({ location: stage.location, phase: 'test', error: err }));
      if (out.nextRequestSet) {
        nextRequest = out.nextRequest;
        nextRequestSet = true;
      }
    }
  }

  return {
    itemId: item.id,
    itemName: item.name,
    path,
    iteration,
    skipped: false,
    wire,
    response,
    error,
    tests,
    logs,
    scriptErrors,
    subRequests,
    unresolvedVariables: unresolved,
    nextRequest,
    nextRequestSet,
    durationMs: Date.now() - started,
  };
}

export async function* runCollection(
  collection: PMCollection,
  chain: ScopeChain,
  transport: Transport,
  scriptHost: ScriptHost,
  opts: RunnerOptions = {},
): AsyncGenerator<RunEvent> {
  const started = Date.now();
  let items = itemsForTarget(collection, opts.folderId);
  if (opts.selectedItemIds) {
    items = items.filter((r) => opts.selectedItemIds!.has(r.item.id));
  }
  const rows = opts.dataRows?.length ? opts.dataRows : [undefined];
  const iterations = opts.iterations ?? rows.length;

  yield { type: 'start', totalItems: items.length, iterations };

  let stopped = false;
  for (let it = 0; it < iterations; it++) {
    if (opts.signal?.aborted) {
      stopped = true;
      break;
    }
    chain.data.clear();
    const row = rows[it % rows.length];
    if (row) Object.entries(row).forEach(([k, v]) => chain.data.set(k, v));

    let idx = 0;
    let steps = 0;
    const maxSteps = Math.max(items.length * 10, 500);

    while (idx >= 0 && idx < items.length) {
      if (opts.signal?.aborted || steps++ >= maxSteps) {
        stopped = true;
        break;
      }
      const ref = items[idx];
      const path = pathOf(ref);
      yield { type: 'itemStart', itemId: ref.item.id, itemName: ref.item.name, path, iteration: it, index: idx };

      const result = await runSingleItem(ref, collection, chain, transport, scriptHost, {
        iteration: it,
        iterationCount: iterations,
        environmentName: opts.environmentName,
        scriptTimeoutMs: opts.scriptTimeoutMs,
        stopOnScriptError: opts.stopOnScriptError,
        globals: opts.globals,
      });

      yield { type: 'itemDone', result };

      if (opts.stopOnError && (result.error || result.tests.some((t) => !t.passed && !t.skipped))) {
        stopped = true;
        break;
      }

      if (result.nextRequestSet) {
        if (result.nextRequest === null) break;
        const target = items.findIndex((r) => r.item.id === result.nextRequest || r.item.name === result.nextRequest);
        if (target === -1) break;
        idx = target;
      } else {
        idx++;
      }

      if (opts.delayMs && opts.delayMs > 0 && idx < items.length) {
        await new Promise((r) => setTimeout(r, opts.delayMs));
      }
    }
    if (stopped) break;
  }

  yield { type: 'done', stopped, durationMs: Date.now() - started };
}
