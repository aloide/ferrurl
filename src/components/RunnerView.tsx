import { useMemo, useRef, useState } from 'react';
import { parseDataFile, runnerReportHtml, runnerReportJson } from '../core/format';
import {
  chainFromState,
  runCollection,
  syncCollectionVariables,
  syncEnvironmentVariables,
  type ItemRunResult,
} from '../core/runner';
import { findNode, itemsForTarget, pathOf } from '../core/tree';
import { isFolder } from '../core/types';
import { fsReadText, fsWriteText, pickOpenFile, pickSaveFile, tauriTransport } from '../platform/tauri';
import { WorkerScriptHost } from '../sandbox/workerHost';
import { useAppStore, type OpenTab } from '../store/appStore';

export function RunnerView({ tab }: { tab: OpenTab }) {
  const {
    collections,
    environments,
    secrets,
    activeEnvId,
    globals,
    settings,
    updateCollection,
    updateEnvironment,
    setEnvSecret,
    pushConsole,
  } = useAppStore();

  const col = tab.collectionId ? collections[tab.collectionId] : undefined;
  const [folderId, setFolderId] = useState<string>(tab.nodeId ?? '');
  const [iterations, setIterations] = useState(1);
  const [delayMs, setDelayMs] = useState(0);
  const [stopOnError, setStopOnError] = useState(false);
  const [dataRows, setDataRows] = useState<Record<string, unknown>[] | undefined>();
  const [dataName, setDataName] = useState('');
  const [running, setRunning] = useState(false);
  const [results, setResults] = useState<ItemRunResult[]>([]);
  const [filter, setFilter] = useState<'all' | 'passed' | 'failed'>('all');
  const [durationMs, setDurationMs] = useState(0);
  const abortRef = useRef<AbortController | null>(null);

  const items = useMemo(() => (col ? itemsForTarget(col, folderId || null) : []), [col, folderId]);
  const [deselected, setDeselected] = useState<Set<string>>(new Set());

  if (!col) return <div className="empty-state">Colección no encontrada.</div>;

  const folders = col.item.filter(isFolder);
  const targetFolder = folderId ? findNode(col.item, folderId)?.node : null;
  const folderDesc = targetFolder && isFolder(targetFolder) && typeof targetFolder.description === 'string' ? targetFolder.description : '';

  const allTests = results.flatMap((r) => r.tests);
  const passedCount = allTests.filter((t) => t.passed && !t.skipped).length;
  const failedCount = allTests.filter((t) => !t.passed && !t.skipped).length;

  const pickData = async () => {
    const p = await pickOpenFile([{ name: 'Datos (JSON / CSV)', extensions: ['json', 'csv'] }]);
    if (!p) return;
    try {
      const txt = await fsReadText(p);
      const rows = parseDataFile(p, txt);
      setDataRows(rows);
      setDataName(`${p.split(/[\\/]/).pop()} (${rows.length} filas)`);
      if (rows.length > 0) setIterations(rows.length);
    } catch (e) {
      window.alert(`No se pudo cargar el archivo de datos: ${(e as Error).message}`);
    }
  };

  const start = async () => {
    // Aviso explicito para carpetas de limite/bloqueo (ej. carpeta 4)
    if (/bloquea|aparte|límite|limite|429/i.test(`${targetFolder?.name ?? ''} ${folderDesc}`)) {
      const ok = window.confirm(
        `Aviso sobre "${targetFolder?.name}":\n\n${folderDesc || 'Esta carpeta puede generar bloqueo temporal o límite de solicitudes.'}\n\n¿Querés continuar?`,
      );
      if (!ok) return;
    }

    const env = activeEnvId ? environments[activeEnvId] : null;
    const chain = chainFromState({
      collection: col,
      environment: env,
      secrets: activeEnvId ? secrets[activeEnvId] ?? {} : {},
      globals,
    });
    const selectedItemIds = new Set(items.filter((r) => !deselected.has(r.item.id)).map((r) => r.item.id));
    const ac = new AbortController();
    abortRef.current = ac;
    setRunning(true);
    setResults([]);
    setDurationMs(0);

    const host = new WorkerScriptHost();
    try {
      for await (const ev of runCollection(col, chain, tauriTransport, host, {
        folderId: folderId || null,
        selectedItemIds,
        iterations,
        delayMs,
        stopOnError,
        dataRows,
        scriptTimeoutMs: settings.scriptTimeoutMs,
        globals: settings.defaults,
        environmentName: env?.name ?? '',
        signal: ac.signal,
      })) {
        if (ev.type === 'itemDone') {
          setResults((prev) => [...prev, ev.result]);
          if (ev.result.wire) {
            pushConsole({
              kind: 'http',
              source: `Runner: ${ev.result.itemName}`,
              wire: ev.result.wire,
              response: ev.result.response,
              error: ev.result.error,
            });
          }
        } else if (ev.type === 'done') {
          setDurationMs(ev.durationMs);
        }
      }
    } finally {
      host.terminate();
      setRunning(false);
      abortRef.current = null;
      updateCollection(col.info._postman_id!, (c) => syncCollectionVariables(c, chain.collection));
      if (env) {
        const { env: nextEnv, secretUpdates } = syncEnvironmentVariables(env, chain.environment);
        updateEnvironment(env.id, () => nextEnv);
        for (const [k, v] of Object.entries(secretUpdates)) await setEnvSecret(env.id, k, v);
      }
    }
  };

  const exportReport = async (kind: 'json' | 'html') => {
    const env = activeEnvId ? environments[activeEnvId] : null;
    const meta = { collectionName: col.info.name, environmentName: env?.name ?? '', durationMs };
    const content = kind === 'json' ? runnerReportJson(meta, results) : runnerReportHtml(meta, results);
    const filename = `runner-${col.info.name.replace(/[^\w.-]+/g, '_')}.${kind}`;
    const dest = await pickSaveFile(filename, [{ name: kind.toUpperCase(), extensions: [kind] }]);
    await fsWriteText(dest || filename, content);
  };

  const visibleResults = results.filter((r) => {
    if (filter === 'all') return true;
    const hasFail = Boolean(r.error) || r.scriptErrors.length > 0 || r.tests.some((t) => !t.passed && !t.skipped);
    return filter === 'failed' ? hasFail : !hasFail;
  });

  return (
    <div className="editor-pane" style={{ padding: 14, overflow: 'auto', gap: 12 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8 }}>
        <div style={{ fontSize: 16, fontWeight: 700 }}>▶ Runner — {col.info.name}</div>
        <div style={{ display: 'flex', gap: 6 }}>
          {results.length > 0 && (
            <>
              <button className="secondary" onClick={() => exportReport('json')}>Exportar JSON</button>
              <button className="secondary" onClick={() => exportReport('html')}>Exportar HTML</button>
            </>
          )}
          {running ? (
            <button className="danger" onClick={() => abortRef.current?.abort()}>Detener</button>
          ) : (
            <button className="primary" onClick={start} disabled={items.length === 0}>
              Ejecutar ({items.filter((i) => !deselected.has(i.item.id)).length})
            </button>
          )}
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
        <div style={{ border: '1px solid var(--border)', borderRadius: 6, padding: 10, background: 'var(--bg-elev)' }}>
          <div style={{ fontWeight: 600, marginBottom: 8 }}>Orden de ejecución</div>
          <div style={{ maxHeight: 210, overflowY: 'auto' }}>
            {items.map((ref) => {
              const checked = !deselected.has(ref.item.id);
              return (
                <label key={ref.item.id} style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '3px 0', cursor: 'pointer' }}>
                  <input
                    type="checkbox"
                    checked={checked}
                    onChange={(e) => {
                      const next = new Set(deselected);
                      if (e.target.checked) next.delete(ref.item.id);
                      else next.add(ref.item.id);
                      setDeselected(next);
                    }}
                  />
                  <span className={`method-tag m-${ref.item.request.method}`}>{ref.item.request.method}</span>
                  <span>{pathOf(ref)}</span>
                </label>
              );
            })}
          </div>
        </div>

        <div style={{ border: '1px solid var(--border)', borderRadius: 6, padding: 10, background: 'var(--bg-elev)' }}>
          <div style={{ fontWeight: 600, marginBottom: 8 }}>Configuración de la corrida</div>
          <div className="form-grid">
            <label>Carpeta objetivo</label>
            <select value={folderId} onChange={(e) => setFolderId(e.target.value)}>
              <option value="">Toda la colección</option>
              {folders.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}
            </select>
            <label>Iteraciones</label>
            <input type="number" min={1} value={iterations} onChange={(e) => setIterations(Math.max(1, Number(e.target.value) || 1))} />
            <label>Pausa entre requests (ms)</label>
            <input type="number" min={0} value={delayMs} onChange={(e) => setDelayMs(Math.max(0, Number(e.target.value) || 0))} />
            <label>Archivo de datos</label>
            <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
              <button className="secondary icon-btn" onClick={pickData}>Elegir CSV / JSON…</button>
              {dataName && <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>{dataName}</span>}
            </div>
            <label>Detener ante error</label>
            <input type="checkbox" style={{ justifySelf: 'start' }} checked={stopOnError} onChange={(e) => setStopOnError(e.target.checked)} />
          </div>
        </div>
      </div>

      {results.length > 0 && (
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
            <span className="badge">Requests: {results.length}</span>
            <span className="badge ok">Tests OK: {passedCount}</span>
            <span className={`badge ${failedCount > 0 ? 'err' : ''}`}>Fallidos: {failedCount}</span>
            {durationMs > 0 && <span style={{ color: 'var(--text-muted)' }}>{durationMs} ms</span>}
            <div style={{ marginLeft: 'auto', display: 'flex', gap: 4 }}>
              <button className={filter === 'all' ? 'secondary icon-btn' : 'icon-btn'} onClick={() => setFilter('all')}>Todos</button>
              <button className={filter === 'passed' ? 'secondary icon-btn' : 'icon-btn'} onClick={() => setFilter('passed')}>OK</button>
              <button className={filter === 'failed' ? 'secondary icon-btn' : 'icon-btn'} onClick={() => setFilter('failed')}>Fallidos</button>
            </div>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {visibleResults.map((r, i) => (
              <div key={i} style={{ border: '1px solid var(--border)', borderRadius: 6, padding: 8, background: 'var(--bg-elev)' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span className={`method-tag m-${r.wire?.method ?? 'GET'}`}>{r.wire?.method ?? '-'}</span>
                  <strong>{r.path}</strong>
                  {r.subRequests.length > 0 && (
                    <span className="badge">+{r.subRequests.length} pm.sendRequest</span>
                  )}
                  <span style={{ marginLeft: 'auto', display: 'flex', gap: 8, alignItems: 'center' }}>
                    {r.error ? (
                      <span className="badge err">{r.error.message}</span>
                    ) : r.response ? (
                      <>
                        <span className={`badge ${r.response.code < 400 ? 'ok' : 'err'}`}>{r.response.code} {r.response.status}</span>
                        <span style={{ color: 'var(--text-muted)', fontSize: 12 }}>{r.response.responseTime} ms</span>
                      </>
                    ) : r.skipped ? (
                      <span className="badge warn">Omitido</span>
                    ) : null}
                  </span>
                </div>
                {r.tests.length > 0 && (
                  <div style={{ marginTop: 6, display: 'flex', flexDirection: 'column', gap: 3, paddingLeft: 14 }}>
                    {r.tests.map((t, j) => (
                      <div key={j} style={{ fontSize: 12, color: t.passed ? 'var(--green)' : 'var(--red)' }}>
                        {t.passed ? '✓' : '✗'} {t.name} {t.error ? `— ${t.error}` : ''}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
