// Motor de ejecucion de scripts compatible con Postman (pm.* + chai + CryptoJS + async).
// Corre tanto dentro de un Web Worker como en Node (vitest) usando el mismo codigo.

import * as chai from 'chai';
import CryptoJS from 'crypto-js';
import _ from 'lodash';
import { buildQuery, parseQuery, rawWithQuery, splitRaw, urlFromRaw } from '../core/postman';
import { specToWire, type SendRequestSpec } from '../core/sendRequest';
import type { KV } from '../core/types';
import { emptyChain, lookup, resolve, VariableScope, type ScopeChain, type ScopeName } from '../core/variables';
import type { ParsedResponse } from '../core/wire';
import { installPostmanChai, type ResponseLike } from './chaiPostman';
import { PropertyList } from './propertyList';
import type {
  LogEntry,
  LogLevel,
  ScopeSnapshot,
  ScriptBridge,
  ScriptErrorInfo,
  ScriptInput,
  ScriptOutput,
  TestResult,
} from './protocol';
import { xml2Json } from './xml2json';

installPostmanChai(chai);

export function chainToSnapshot(chain: ScopeChain): ScopeSnapshot {
  return {
    local: chain.local.entries(),
    data: chain.data.entries(),
    environment: chain.environment.entries(),
    collection: chain.collection.entries(),
    globals: chain.globals.entries(),
  };
}

export function snapshotToChain(snap: ScopeSnapshot): ScopeChain {
  return {
    local: new VariableScope(snap.local),
    data: new VariableScope(snap.data),
    environment: new VariableScope(snap.environment),
    collection: new VariableScope(snap.collection),
    globals: new VariableScope(snap.globals),
  };
}

function formatArgs(args: unknown[]): string {
  return args
    .map((a) => {
      if (typeof a === 'string') return a;
      if (a instanceof Error) return `${a.name}: ${a.message}`;
      try {
        return JSON.stringify(a);
      } catch {
        return String(a);
      }
    })
    .join(' ');
}

function buildResponseObj(resp: ParsedResponse): ResponseLike & Record<string, unknown> {
  const headerKVs: KV[] = resp.headers.map(([key, value]) => ({ key, value }));
  const headers = new PropertyList(() => headerKVs, () => {}, true, true);
  let parsedJson: unknown;
  let jsonTried = false;
  let jsonError: Error | null = null;

  const obj: ResponseLike & Record<string, unknown> = {
    __pmResponse: true,
    code: resp.code,
    status: resp.status,
    responseTime: resp.responseTime,
    responseSize: resp.responseSize,
    headers,
    text() {
      return resp.body;
    },
    json() {
      if (!jsonTried) {
        jsonTried = true;
        try {
          parsedJson = JSON.parse(resp.body);
        } catch (e) {
          jsonError = e as Error;
        }
      }
      if (jsonError) throw jsonError;
      return parsedJson;
    },
    size() {
      return { body: resp.responseSize, header: resp.headersSize, total: resp.responseSize + resp.headersSize };
    },
    get to() {
      return chai.expect(obj).to;
    },
  };
  return obj;
}

function makeScopeApi(scope: VariableScope, chain: ScopeChain) {
  return {
    get: (key: string) => scope.get(key),
    set: (key: string, value: unknown) => scope.set(key, value),
    unset: (key: string) => scope.unset(key),
    has: (key: string) => scope.has(key),
    clear: () => scope.clear(),
    toObject: () => scope.toObject(),
    replaceIn: (tpl: string) => resolve(tpl, chain),
    toJSON: () => scope.entries().map(([key, value]) => ({ key, value })),
  };
}

function makeVariablesApi(chain: ScopeChain) {
  return {
    get: (key: string) => lookup(chain, key).value,
    set: (key: string, value: unknown) => chain.local.set(key, value),
    unset: (key: string) => chain.local.unset(key),
    has: (key: string) => lookup(chain, key).found,
    toObject: () => ({
      ...chain.globals.toObject(),
      ...chain.collection.toObject(),
      ...chain.environment.toObject(),
      ...chain.data.toObject(),
      ...chain.local.toObject(),
    }),
    replaceIn: (tpl: string) => resolve(tpl, chain),
  };
}

function parseUrlParts(raw: string) {
  const { base, query, hash } = splitRaw(raw);
  const m = /^([a-z][a-z0-9+.-]*):\/\/([^/:]+)(?::([^/]+))?(\/.*)?$/i.exec(base);
  const protocol = m?.[1] ?? '';
  const host = m ? m[2].split('.') : [];
  const port = m?.[3] ?? '';
  const pathStr = m?.[4] ?? '';
  const path = pathStr ? pathStr.replace(/^\//, '').split('/') : [];
  return { protocol, host, port, path, query: query ? parseQuery(query) : [], hash: hash ?? '' };
}

export async function runScript(input: ScriptInput, bridge: ScriptBridge): Promise<ScriptOutput> {
  const started = Date.now();
  const chain = snapshotToChain(input.scopes ?? emptyChain());
  const draft = structuredClone(input.request);
  const tests: TestResult[] = [];
  const legacyTests: Record<string, boolean> = {};
  const logs: LogEntry[] = [];
  const errors: ScriptErrorInfo[] = [];

  let nextRequest: string | null | undefined = undefined;
  let nextRequestSet = false;
  let skipRequest = false;

  const pushLog = (level: LogLevel, args: unknown[]) => {
    const entry: LogEntry = { level, message: formatArgs(args), time: Date.now(), location: input.location };
    logs.push(entry);
    bridge.log?.(entry);
  };

  const scriptConsole = {
    log: (...a: unknown[]) => pushLog('log', a),
    info: (...a: unknown[]) => pushLog('info', a),
    warn: (...a: unknown[]) => pushLog('warn', a),
    error: (...a: unknown[]) => pushLog('error', a),
    debug: (...a: unknown[]) => pushLog('debug', a),
  };

  const recordError = (e: unknown) => {
    const err = e instanceof Error ? e : new Error(String(e));
    errors.push({ name: err.name || 'Error', message: err.message, stack: err.stack });
    pushLog('error', [`${err.name}: ${err.message}`]);
  };

  // Seguimiento de operaciones asincronas (pm.sendRequest, timers, pm.test async)
  let pending = 1; // 1 = ejecucion sincrona inicial
  let finished = false;
  const activeTimers = new Set<ReturnType<typeof setTimeout>>();
  const activeIntervals = new Set<ReturnType<typeof setInterval>>();

  let resolveDone!: () => void;
  const donePromise = new Promise<void>((res) => {
    resolveDone = res;
  });

  const settle = () => {
    if (finished) return;
    finished = true;
    activeTimers.forEach((t) => clearTimeout(t));
    activeIntervals.forEach((t) => clearInterval(t));
    activeTimers.clear();
    activeIntervals.clear();
    // Convertir tests[] legacy (si el script uso tests['...'] = true/false)
    for (const [name, ok] of Object.entries(legacyTests)) {
      tests.push({
        name,
        passed: Boolean(ok),
        error: ok ? undefined : `Se esperaba verdadero para "${name}"`,
        location: input.location,
      });
    }
    resolveDone();
  };

  const decPending = () => {
    pending--;
    if (pending <= 0) {
      // Esperar un microtick por si una Promise encadenada registra otra cosa
      Promise.resolve().then(() => {
        if (pending <= 0) settle();
      });
    }
  };

  const timeoutTimer = setTimeout(() => {
    if (!finished) {
      recordError(new Error(`Tiempo máximo de script agotado (${input.timeoutMs} ms)`));
      settle();
    }
  }, Math.max(100, input.timeoutMs || 30000));

  // API pm.request
  const isPre = input.kind === 'prerequest';
  const reqHeaders = new PropertyList(
    () => draft.headers,
    () => {},
    true,
    !isPre,
  );
  let urlQueryItems = parseQuery(splitRaw(draft.url).query ?? '');
  const reqQueryList = new PropertyList(
    () => urlQueryItems,
    () => {
      draft.url = rawWithQuery(draft.url, urlQueryItems);
    },
    false,
    !isPre,
  );

  const pmRequest = {
    get url() {
      const parts = parseUrlParts(draft.url);
      return {
        ...parts,
        query: reqQueryList,
        toString: () => draft.url,
        getHost: () => parts.host.join('.'),
        getPath: () => '/' + parts.path.join('/'),
        getPathWithQuery: () => {
          const q = buildQuery(urlQueryItems);
          return '/' + parts.path.join('/') + (q ? `?${q}` : '');
        },
        getQueryString: () => buildQuery(urlQueryItems),
        update: (u: string) => {
          if (!isPre) throw new TypeError('pm.request.url es de solo lectura fuera de pre-request');
          const norm = urlFromRaw(u);
          draft.url = norm.raw;
          urlQueryItems = parseQuery(splitRaw(draft.url).query ?? '');
        },
        addQueryParams: (params: KV[] | string) => {
          const list = typeof params === 'string' ? parseQuery(params) : params;
          list.forEach((p) => reqQueryList.add(p));
        },
        removeQueryParams: (keys: string | string[]) => {
          const arr = Array.isArray(keys) ? keys : [keys];
          arr.forEach((k) => reqQueryList.remove(k));
        },
      };
    },
    set url(val: unknown) {
      if (!isPre) throw new TypeError('pm.request.url es de solo lectura fuera de pre-request');
      draft.url = typeof val === 'string' ? val : String(val);
      urlQueryItems = parseQuery(splitRaw(draft.url).query ?? '');
    },
    get method() {
      return draft.method;
    },
    set method(m: string) {
      if (!isPre) throw new TypeError('pm.request.method es de solo lectura fuera de pre-request');
      draft.method = String(m).toUpperCase();
    },
    headers: reqHeaders,
    get body() {
      const b = draft.body;
      return {
        mode: b?.mode ?? 'none',
        raw: b?.raw ?? '',
        urlencoded: b?.urlencoded ?? [],
        formdata: b?.formdata ?? [],
        toString: () => b?.raw ?? '',
        update: (next: { mode?: string; raw?: string }) => {
          if (!isPre) throw new TypeError('pm.request.body es de solo lectura fuera de pre-request');
          draft.body = { ...(draft.body ?? {}), ...(next as NonNullable<typeof draft.body>) };
        },
      };
    },
    addHeader: (h: { key: string; value: string } | string) => reqHeaders.add(h),
    removeHeader: (key: string) => reqHeaders.remove(key),
    upsertHeader: (h: { key: string; value: string } | string) => reqHeaders.upsert(h),
  };

  // pm.response
  const pmResponse = input.response ? buildResponseObj(input.response) : undefined;

  // pm.test
  const pmTest = Object.assign(
    (name: string, fn: (done?: (err?: unknown) => void) => unknown) => {
      if (typeof fn !== 'function') {
        tests.push({ name: String(name), passed: false, error: 'El segundo argumento de pm.test debe ser una función', location: input.location });
        return;
      }
      if (fn.length > 0) {
        pending++;
        let doneCalled = false;
        const done = (err?: unknown) => {
          if (doneCalled) return;
          doneCalled = true;
          if (err) {
            const e = err instanceof Error ? err : new Error(String(err));
            tests.push({ name: String(name), passed: false, error: e.message, location: input.location });
          } else {
            tests.push({ name: String(name), passed: true, location: input.location });
          }
          decPending();
        };
        try {
          fn(done);
        } catch (err) {
          done(err);
        }
        return;
      }
      try {
        const ret = fn();
        if (ret && typeof (ret as Promise<unknown>).then === 'function') {
          pending++;
          (ret as Promise<unknown>).then(
            () => {
              tests.push({ name: String(name), passed: true, location: input.location });
              decPending();
            },
            (err) => {
              const e = err instanceof Error ? err : new Error(String(err));
              tests.push({ name: String(name), passed: false, error: e.message, location: input.location });
              decPending();
            },
          );
        } else {
          tests.push({ name: String(name), passed: true, location: input.location });
        }
      } catch (err) {
        const e = err instanceof Error ? err : new Error(String(err));
        tests.push({ name: String(name), passed: false, error: e.message, location: input.location });
      }
    },
    {
      skip: (name: string) => {
        tests.push({ name: String(name), passed: true, skipped: true, location: input.location });
      },
    },
  );

  // pm.sendRequest
  const pmSendRequest = (spec: SendRequestSpec, cb?: (err: unknown, res?: unknown) => void) => {
    pending++;
    let wire;
    try {
      wire = specToWire(spec, draft.settings);
    } catch (err) {
      const e = err instanceof Error ? err : new Error(String(err));
      if (cb) {
        try {
          cb(e);
        } catch (cbErr) {
          recordError(cbErr);
        }
        decPending();
        return;
      }
      decPending();
      return Promise.reject(e);
    }

    const p = bridge.sendRequest(wire as unknown as SendRequestSpec).then(
      (res) => {
        if (res.error) {
          const err = new Error(res.error.message);
          if (cb) {
            try {
              cb(err);
            } catch (cbErr) {
              recordError(cbErr);
            }
            decPending();
            return undefined;
          }
          decPending();
          throw err;
        }
        const respObj = res.response ? buildResponseObj(res.response) : undefined;
        if (cb) {
          try {
            cb(null, respObj);
          } catch (cbErr) {
            recordError(cbErr);
          }
          decPending();
          return respObj;
        }
        decPending();
        return respObj;
      },
      (err) => {
        const e = err instanceof Error ? err : new Error(String(err));
        if (cb) {
          try {
            cb(e);
          } catch (cbErr) {
            recordError(cbErr);
          }
          decPending();
          return undefined;
        }
        decPending();
        throw e;
      },
    );
    return cb ? undefined : p;
  };

  // Timers rastreados
  const trackedSetTimeout = (fn: (...a: unknown[]) => void, ms = 0, ...args: unknown[]) => {
    pending++;
    const t = setTimeout(() => {
      activeTimers.delete(t);
      try {
        fn(...args);
      } catch (e) {
        recordError(e);
      }
      decPending();
    }, ms);
    activeTimers.add(t);
    return t;
  };
  const trackedClearTimeout = (t: ReturnType<typeof setTimeout>) => {
    if (activeTimers.delete(t)) {
      clearTimeout(t);
      decPending();
    }
  };
  const trackedSetInterval = (fn: (...a: unknown[]) => void, ms = 100, ...args: unknown[]) => {
    const t = setInterval(() => {
      try {
        fn(...args);
      } catch (e) {
        recordError(e);
      }
    }, ms);
    activeIntervals.add(t);
    return t;
  };
  const trackedClearInterval = (t: ReturnType<typeof setInterval>) => {
    activeIntervals.delete(t);
    clearInterval(t);
  };

  // Cookies de respuesta (Set-Cookie)
  const responseCookies = (input.response?.headers ?? [])
    .filter(([k]) => k.toLowerCase() === 'set-cookie')
    .map(([, v]) => {
      const first = v.split(';')[0] ?? '';
      const eq = first.indexOf('=');
      return { name: eq === -1 ? first.trim() : first.slice(0, eq).trim(), value: eq === -1 ? '' : first.slice(eq + 1).trim() };
    });

  const pm = {
    variables: makeVariablesApi(chain),
    collectionVariables: makeScopeApi(chain.collection, chain),
    environment: makeScopeApi(chain.environment, chain),
    globals: makeScopeApi(chain.globals, chain),
    iterationData: {
      get: (k: string) => chain.data.get(k),
      has: (k: string) => chain.data.has(k),
      toObject: () => chain.data.toObject(),
    },
    info: { ...input.info },
    request: pmRequest,
    response: pmResponse,
    test: pmTest,
    expect: chai.expect,
    sendRequest: pmSendRequest,
    execution: {
      location: [input.info.collectionName, input.info.requestName],
      setNextRequest: (name: string | null) => {
        nextRequest = name;
        nextRequestSet = true;
      },
      skipRequest: () => {
        if (!isPre) throw new TypeError('pm.execution.skipRequest() solo se puede usar en pre-request');
        skipRequest = true;
      },
    },
    cookies: {
      has: (n: string) => responseCookies.some((c) => c.name === n),
      get: (n: string) => responseCookies.find((c) => c.name === n)?.value,
      toObject: () => Object.fromEntries(responseCookies.map((c) => [c.name, c.value])),
    },
  };

  const postman = {
    setNextRequest: (name: string | null) => {
      nextRequest = name;
      nextRequestSet = true;
    },
    setEnvironmentVariable: (k: string, v: unknown) => chain.environment.set(k, v),
    getEnvironmentVariable: (k: string) => chain.environment.get(k),
    clearEnvironmentVariable: (k: string) => chain.environment.unset(k),
    setGlobalVariable: (k: string, v: unknown) => chain.globals.set(k, v),
    getGlobalVariable: (k: string) => chain.globals.get(k),
    clearGlobalVariable: (k: string) => chain.globals.unset(k),
  };

  const scriptRequire = (mod: string) => {
    switch (mod) {
      case 'crypto-js':
        return CryptoJS;
      case 'chai':
        return chai;
      case 'lodash':
        return _;
      default:
        throw new Error(`Módulo no disponible en FerrURL: "${mod}"`);
    }
  };

  // Variables legacy de Postman
  const responseBody = input.response?.body;
  const responseCode = input.response ? { code: input.response.code, name: input.response.status } : undefined;
  const responseHeaders = input.response ? Object.fromEntries(input.response.headers) : undefined;
  const responseTime = input.response?.responseTime;

  const envBindings: Record<string, unknown> = {
    pm,
    postman,
    CryptoJS,
    chai,
    _,
    xml2Json,
    console: scriptConsole,
    require: scriptRequire,
    setTimeout: trackedSetTimeout,
    clearTimeout: trackedClearTimeout,
    setInterval: trackedSetInterval,
    clearInterval: trackedClearInterval,
    atob: globalThis.atob.bind(globalThis),
    btoa: globalThis.btoa.bind(globalThis),
    tests: legacyTests,
    responseBody,
    responseCode,
    responseHeaders,
    responseTime,
  };

  if (input.code.trim()) {
    try {
      const names = Object.keys(envBindings);
      const values = names.map((k) => envBindings[k]);
      const fn = new Function(...names, `"use strict";\n${input.code}`);
      fn(...values);
    } catch (e) {
      recordError(e);
    }
  }

  decPending();
  await donePromise;
  clearTimeout(timeoutTimer);

  return {
    scopes: chainToSnapshot(chain),
    request: draft,
    tests,
    logs,
    errors,
    nextRequest,
    nextRequestSet,
    skipRequest,
    durationMs: Date.now() - started,
  };
}

export function applyScopeSnapshot(target: ScopeChain, snap: ScopeSnapshot, scopes: ScopeName[]): void {
  for (const s of scopes) {
    target[s].clear();
    for (const [k, v] of snap[s]) target[s].set(k, v);
  }
}
