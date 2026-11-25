import { useMemo, useState } from 'react';
import { effectiveAuth } from '../../core/auth';
import { buildWire, createDraft, defaultHeaders, hasHeader } from '../../core/build';
import { parseQuery, rawWithQuery, scriptOf, splitRaw, urlFromRaw, withScript } from '../../core/postman';
import { chainFromState } from '../../core/runner';
import { findNode } from '../../core/tree';
import { isFolder, type PMFolder, type PMItem } from '../../core/types';
import { useAppStore, type OpenTab } from '../../store/appStore';
import { KeyValueTable } from '../shared/KeyValueTable';
import { VarText } from '../shared/VarInput';
import { AuthEditor } from './AuthEditor';
import { BodyEditor } from './BodyEditor';
import { ResponseViewer } from './ResponseViewer';
import { ScriptEditor } from './ScriptEditor';

type SubTab = 'params' | 'auth' | 'headers' | 'body' | 'prerequest' | 'tests' | 'settings';

const METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS'];

interface Props {
  tab: OpenTab;
  onOpenCurl: () => void;
}

export function RequestEditor({ tab, onOpenCurl }: Props) {
  const [sub, setSub] = useState<SubTab>('params');
  const [showAutoHeaders, setShowAutoHeaders] = useState(false);

  const {
    collections,
    collectionOrder,
    scratchItems,
    environments,
    secrets,
    activeEnvId,
    globals,
    settings,
    runStates,
    updateItem,
    sendTabRequest,
    cancelTabRequest,
    saveTab,
    saveScratchToCollection,
  } = useAppStore();

  const col = tab.collectionId ? collections[tab.collectionId] : undefined;
  let item: PMItem | undefined;
  let ancestors: PMFolder[] = [];

  if (col && tab.nodeId) {
    const found = findNode(col.item, tab.nodeId);
    if (found && !isFolder(found.node)) {
      item = found.node;
      ancestors = found.ancestors;
    }
  } else {
    item = scratchItems[tab.id];
  }

  const activeEnv = activeEnvId ? environments[activeEnvId] : null;
  const envSecrets = activeEnvId ? secrets[activeEnvId] ?? {} : {};
  const chain = useMemo(
    () => chainFromState({ collection: col, environment: activeEnv, secrets: envSecrets, globals }),
    [col, activeEnv, envSecrets, globals],
  );

  if (!item) return <div className="empty-state">Request no encontrado.</div>;

  const req = item.request;
  const runState = runStates[tab.id];
  const queryParams = req.url.query ?? parseQuery(splitRaw(req.url.raw).query ?? '');
  const inherited = col ? effectiveAuth({ request: { auth: { type: 'inherit' } } }, ancestors, col) : undefined;
  const preCode = scriptOf(item.event, 'prerequest');
  const testCode = scriptOf(item.event, 'test');

  const patchItem = (fn: (it: PMItem) => PMItem) => updateItem(tab.collectionId, item!.id, fn);

  const setUrlRaw = (raw: string) => {
    patchItem((it) => ({
      ...it,
      request: { ...it.request, url: urlFromRaw(raw, it.request.url) },
    }));
  };

  const setParams = (params: typeof queryParams) => {
    patchItem((it) => ({
      ...it,
      request: {
        ...it.request,
        url: { ...it.request.url, raw: rawWithQuery(it.request.url.raw, params), query: params },
      },
    }));
  };

  const ppb = item.protocolProfileBehavior ?? {};
  const autoHeaders = settings.defaults.sendDefaultHeaders
    ? defaultHeaders().filter(([k]) => !hasHeader(req.header, k))
    : [];

  return (
    <div className="editor-pane">
      <div className="url-bar">
        <select
          value={METHODS.includes(req.method) ? req.method : 'CUSTOM'}
          onChange={(e) => {
            const val = e.target.value === 'CUSTOM' ? window.prompt('Método HTTP personalizado:', req.method) || req.method : e.target.value;
            patchItem((it) => ({ ...it, request: { ...it.request, method: val.toUpperCase() } }));
          }}
          style={{ width: 110, fontWeight: 700 }}
        >
          {METHODS.map((m) => <option key={m} value={m}>{m}</option>)}
          {!METHODS.includes(req.method) && <option value={req.method}>{req.method}</option>}
          <option value="CUSTOM">Otro…</option>
        </select>

        <VarText
          value={req.url.raw}
          placeholder="https://api.ejemplo.com/recurso o {{baseUrl}}/api/login"
          chain={chain}
          showPills
          onChange={setUrlRaw}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && (e.ctrlKey || !e.shiftKey)) void sendTabRequest(tab.id);
          }}
        />

        {runState?.running ? (
          <button className="danger" onClick={() => cancelTabRequest(tab.id)}>Cancelar</button>
        ) : (
          <button className="primary" onClick={() => sendTabRequest(tab.id)}>Enviar</button>
        )}

        {tab.collectionId ? (
          <button className="secondary" onClick={() => saveTab(tab.id)} title="Guardar (Ctrl+S)">Guardar</button>
        ) : (
          collectionOrder.length > 0 && (
            <button
              className="secondary"
              onClick={() => {
                const cid = collectionOrder[0];
                saveScratchToCollection(tab.id, cid, null);
              }}
              title="Guardar en colección"
            >
              Guardar en…
            </button>
          )
        )}

        <button className="secondary" onClick={onOpenCurl} title="Generar comando cURL">cURL</button>
      </div>

      <div className="subtabs">
        <button className={sub === 'params' ? 'active' : ''} onClick={() => setSub('params')}>
          Params {queryParams.length > 0 ? `(${queryParams.length})` : ''}
        </button>
        <button className={sub === 'auth' ? 'active' : ''} onClick={() => setSub('auth')}>
          Authorization
        </button>
        <button className={sub === 'headers' ? 'active' : ''} onClick={() => setSub('headers')}>
          Headers ({req.header.filter((h) => !h.disabled).length})
        </button>
        <button className={sub === 'body' ? 'active' : ''} onClick={() => setSub('body')}>
          Body {req.body?.mode && req.body.mode !== 'none' ? '●' : ''}
        </button>
        <button className={sub === 'prerequest' ? 'active' : ''} onClick={() => setSub('prerequest')}>
          Pre-request {preCode.trim() ? '●' : ''}
        </button>
        <button className={sub === 'tests' ? 'active' : ''} onClick={() => setSub('tests')}>
          Tests {testCode.trim() ? '●' : ''}
        </button>
        <button className={sub === 'settings' ? 'active' : ''} onClick={() => setSub('settings')}>
          Settings
        </button>
      </div>

      <div className="panel-split">
        <div className="request-section">
          {sub === 'params' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              <div>
                <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 6 }}>Query Params</div>
                <KeyValueTable items={queryParams} chain={chain} onChange={setParams} />
              </div>
              {(req.url.variable?.length ?? 0) > 0 && (
                <div>
                  <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 6 }}>Variables de Path (:nombre)</div>
                  <KeyValueTable
                    items={req.url.variable ?? []}
                    chain={chain}
                    showBulk={false}
                    onChange={(variable) =>
                      patchItem((it) => ({ ...it, request: { ...it.request, url: { ...it.request.url, variable } } }))
                    }
                  />
                </div>
              )}
            </div>
          )}

          {sub === 'auth' && (
            <AuthEditor
              auth={req.auth}
              chain={chain}
              inheritedLabel={inherited ? `${inherited.auth.type} desde ${inherited.source}` : undefined}
              onChange={(auth) => patchItem((it) => ({ ...it, request: { ...it.request, auth } }))}
            />
          )}

          {sub === 'headers' && (
            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
                <button className="secondary icon-btn" onClick={() => setShowAutoHeaders(!showAutoHeaders)}>
                  {showAutoHeaders ? 'Ocultar' : 'Mostrar'} {autoHeaders.length} headers automáticos
                </button>
              </div>
              {showAutoHeaders && autoHeaders.length > 0 && (
                <table className="kv-table" style={{ marginBottom: 10, opacity: 0.75 }}>
                  <thead><tr><th>Header automático</th><th>Valor</th></tr></thead>
                  <tbody>
                    {autoHeaders.map(([k, v]) => (
                      <tr key={k}><td className="mono">{k}</td><td className="mono">{v}</td></tr>
                    ))}
                  </tbody>
                </table>
              )}
              <KeyValueTable
                items={req.header}
                chain={chain}
                onChange={(header) => patchItem((it) => ({ ...it, request: { ...it.request, header } }))}
              />
            </div>
          )}

          {sub === 'body' && (
            <BodyEditor
              body={req.body}
              chain={chain}
              onChange={(body) => patchItem((it) => ({ ...it, request: { ...it.request, body } }))}
            />
          )}

          {sub === 'prerequest' && (
            <ScriptEditor
              kind="prerequest"
              code={preCode}
              onChange={(code) => patchItem((it) => ({ ...it, event: withScript(it.event, 'prerequest', code) }))}
            />
          )}

          {sub === 'tests' && (
            <ScriptEditor
              kind="test"
              code={testCode}
              onChange={(code) => patchItem((it) => ({ ...it, event: withScript(it.event, 'test', code) }))}
            />
          )}

          {sub === 'settings' && (
            <div className="form-grid" style={{ maxWidth: 520 }}>
              <label>Usar proxy en este request</label>
              <input
                type="checkbox"
                style={{ justifySelf: 'start' }}
                checked={ppb.ferrurlUseProxy ?? ppb.wurlUseProxy ?? true}
                onChange={(e) =>
                  patchItem((it) => ({
                    ...it,
                    protocolProfileBehavior: { ...ppb, ferrurlUseProxy: e.target.checked },
                  }))
                }
              />
              <label>Seguir redirecciones</label>
              <input
                type="checkbox"
                style={{ justifySelf: 'start' }}
                checked={ppb.followRedirects ?? settings.defaults.followRedirects}
                onChange={(e) =>
                  patchItem((it) => ({
                    ...it,
                    protocolProfileBehavior: { ...ppb, followRedirects: e.target.checked },
                  }))
                }
              />
              <label>Verificar certificado SSL</label>
              <input
                type="checkbox"
                style={{ justifySelf: 'start' }}
                checked={ppb.strictSSL ?? settings.defaults.verifyTls}
                onChange={(e) =>
                  patchItem((it) => ({
                    ...it,
                    protocolProfileBehavior: { ...ppb, strictSSL: e.target.checked },
                  }))
                }
              />
              <label>Timeout (ms, 0 = global)</label>
              <input
                type="number"
                value={ppb.ferrurlTimeoutMs ?? ppb.wurlTimeoutMs ?? 0}
                onChange={(e) =>
                  patchItem((it) => ({
                    ...it,
                    protocolProfileBehavior: { ...ppb, ferrurlTimeoutMs: Number(e.target.value) || 0 },
                  }))
                }
              />
              <label>Enviar body incluso en GET/HEAD</label>
              <input
                type="checkbox"
                style={{ justifySelf: 'start' }}
                checked={ppb.disableBodyPruning ?? false}
                onChange={(e) =>
                  patchItem((it) => ({
                    ...it,
                    protocolProfileBehavior: { ...ppb, disableBodyPruning: e.target.checked },
                  }))
                }
              />
            </div>
          )}
        </div>

        <ResponseViewer running={runState?.running} result={runState?.result} />
      </div>
    </div>
  );
}

/** Helper para construir un WireRequest del tab activo (para modal cURL). */
export function buildCurlWire(tab: OpenTab) {
  const s = useAppStore.getState();
  const col = tab.collectionId ? s.collections[tab.collectionId] : undefined;
  let item: PMItem | undefined;
  let ancestors: PMFolder[] = [];
  if (col && tab.nodeId) {
    const found = findNode(col.item, tab.nodeId);
    if (found && !isFolder(found.node)) {
      item = found.node;
      ancestors = found.ancestors;
    }
  } else {
    item = s.scratchItems[tab.id];
  }
  if (!item) return null;
  const env = s.activeEnvId ? s.environments[s.activeEnvId] : null;
  const chain = chainFromState({
    collection: col,
    environment: env,
    secrets: s.activeEnvId ? s.secrets[s.activeEnvId] ?? {} : {},
    globals: s.globals,
  });
  const fakeCol = col ?? { info: { name: 'Rápido', schema: '' }, item: [] };
  return buildWire(createDraft(item, ancestors, fakeCol, s.settings.defaults), chain, s.settings.defaults).wire;
}
