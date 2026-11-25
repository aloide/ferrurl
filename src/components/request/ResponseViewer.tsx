import { useMemo, useState } from 'react';
import { base64ToBytes, formatBytes, isProbablyBinary } from '../../core/encoding';
import { detectBodyLanguage, prettyBody } from '../../core/format';
import type { ItemRunResult } from '../../core/runner';
import { ERROR_LABELS } from '../../core/wire';
import { fsWriteBase64, pickSaveFile } from '../../platform/tauri';
import { useAppStore } from '../../store/appStore';
import { CodeEditor } from '../shared/CodeEditor';

interface Props {
  running?: boolean;
  result?: ItemRunResult;
}

type RespTab = 'body' | 'headers' | 'tests' | 'sent';
type ViewMode = 'pretty' | 'raw' | 'preview' | 'hex';

function toHexDump(bytes: Uint8Array, limit = 8192): string {
  const slice = bytes.subarray(0, limit);
  const lines: string[] = [];
  for (let i = 0; i < slice.length; i += 16) {
    const row = slice.subarray(i, i + 16);
    const hex = [...row].map((b) => b.toString(16).padStart(2, '0')).join(' ');
    const ascii = [...row].map((b) => (b >= 32 && b < 127 ? String.fromCharCode(b) : '.')).join('');
    lines.push(`${i.toString(16).padStart(6, '0')}  ${hex.padEnd(47, ' ')}  ${ascii}`);
  }
  if (bytes.length > limit) lines.push(`... (${bytes.length - limit} bytes más)`);
  return lines.join('\n');
}

export function ResponseViewer({ running, result }: Props) {
  const [respTab, setRespTab] = useState<RespTab>('body');
  const [viewMode, setViewMode] = useState<ViewMode>('pretty');
  const [search, setSearch] = useState('');
  const { settings, setSettingsOpen } = useAppStore();

  const resp = result?.response;
  const tests = result?.tests ?? [];
  const passedCount = tests.filter((t) => t.passed && !t.skipped).length;
  const failedCount = tests.filter((t) => !t.passed && !t.skipped).length;

  const lang = useMemo(() => (resp ? detectBodyLanguage(resp.headers, resp.body) : 'text'), [resp]);
  const bytes = useMemo(() => (resp ? base64ToBytes(resp.bodyBase64) : new Uint8Array()), [resp]);
  const isBin = useMemo(() => (resp ? isProbablyBinary(resp.headers.find(([k]) => k.toLowerCase() === 'content-type')?.[1], bytes) : false), [resp, bytes]);

  const displayBody = useMemo(() => {
    if (!resp) return '';
    if (viewMode === 'hex') return toHexDump(bytes);
    const capped = resp.body.length > settings.maxResponseViewBytes ? resp.body.slice(0, settings.maxResponseViewBytes) + '\n… (truncado por tamaño)' : resp.body;
    const text = viewMode === 'pretty' ? prettyBody(capped, lang) : capped;
    if (!search.trim()) return text;
    const q = search.toLowerCase();
    return text.split('\n').filter((l) => l.toLowerCase().includes(q)).join('\n');
  }, [resp, viewMode, bytes, lang, search, settings.maxResponseViewBytes]);

  if (running) {
    return (
      <div className="response-section">
        <div className="empty-state">Enviando petición…</div>
      </div>
    );
  }

  if (!result) {
    return (
      <div className="response-section">
        <div className="empty-state">Presioná <strong>Enviar</strong> (o Ctrl+Enter) para ver la respuesta.</div>
      </div>
    );
  }

  const statusColor = !resp ? 'err' : resp.code < 300 ? 'ok' : resp.code < 400 ? 'warn' : 'err';

  const saveBody = async () => {
    if (!resp) return;
    const p = await pickSaveFile('respuesta.txt');
    if (p) await fsWriteBase64(p, resp.bodyBase64);
  };

  return (
    <div className="response-section">
      <div className="response-header">
        <div style={{ display: 'flex', gap: 4 }}>
          <button className={respTab === 'body' ? 'secondary' : ''} onClick={() => setRespTab('body')}>Body</button>
          <button className={respTab === 'headers' ? 'secondary' : ''} onClick={() => setRespTab('headers')}>
            Headers ({resp?.headers.length ?? 0})
          </button>
          <button className={respTab === 'tests' ? 'secondary' : ''} onClick={() => setRespTab('tests')}>
            Tests ({passedCount}/{tests.length})
            {failedCount > 0 && <span className="badge err">{failedCount} ✗</span>}
          </button>
          <button className={respTab === 'sent' ? 'secondary' : ''} onClick={() => setRespTab('sent')}>
            Enviado
          </button>
        </div>

        <div style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: 12 }}>
          {resp && (
            <>
              <span className={`badge ${statusColor}`}>
                {resp.code} {resp.status}
              </span>
              <span style={{ color: 'var(--text-muted)' }}>{resp.responseTime} ms</span>
              <span style={{ color: 'var(--text-muted)' }}>{formatBytes(resp.responseSize + resp.headersSize)}</span>
              {resp.sent.proxy && (
                <span className="badge" title={`Proxy: ${resp.sent.proxy}`}>via proxy</span>
              )}
            </>
          )}
          {result.error && <span className="badge err">{ERROR_LABELS[result.error.kind]}</span>}
        </div>
      </div>

      <div className="response-body">
        {result.scriptErrors.map((se, i) => (
          <div key={i} className="alert err">
            Error en script {se.phase} ({se.location}): <strong>{se.error.message}</strong>
          </div>
        ))}

        {result.error && (
          <div className="alert err">
            <div><strong>{ERROR_LABELS[result.error.kind]}</strong></div>
            <div style={{ marginTop: 4 }}>{result.error.message}</div>
            {(result.error.kind === 'proxyAuthRequired' || result.error.kind === 'proxyConnect' || result.error.kind === 'tls') && (
              <div style={{ marginTop: 8 }}>
                <button className="secondary" onClick={() => setSettingsOpen(true)}>Abrir configuración de Proxy / TLS</button>
              </div>
            )}
          </div>
        )}

        {resp && respTab === 'body' && (
          <div>
            <div style={{ display: 'flex', gap: 6, marginBottom: 8, alignItems: 'center', flexWrap: 'wrap' }}>
              {(['pretty', 'raw', 'preview', 'hex'] as ViewMode[]).map((m) => (
                <button key={m} className={viewMode === m ? 'secondary icon-btn' : 'icon-btn'} onClick={() => setViewMode(m)}>
                  {m === 'pretty' ? 'Pretty' : m === 'raw' ? 'Raw' : m === 'preview' ? 'Preview' : 'Hex'}
                </button>
              ))}
              <input
                placeholder="Filtrar líneas…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                style={{ width: 180, marginLeft: 'auto' }}
              />
              <button className="secondary icon-btn" onClick={() => navigator.clipboard.writeText(resp.body)}>Copiar</button>
              <button className="secondary icon-btn" onClick={saveBody}>Guardar…</button>
            </div>

            {isBin && viewMode !== 'hex' ? (
              <div className="alert warn">
                El contenido parece binario ({formatBytes(resp.responseSize)}). Cambiá a vista Hex o guardalo en disco.
              </div>
            ) : viewMode === 'preview' ? (
              <iframe
                title="Preview HTML"
                sandbox=""
                srcDoc={resp.body}
                style={{ width: '100%', height: 240, border: '1px solid var(--border)', borderRadius: 5, background: '#fff' }}
              />
            ) : (
              <CodeEditor
                value={displayBody}
                language={viewMode === 'pretty' ? lang : 'text'}
                readOnly
                height="240px"
              />
            )}
          </div>
        )}

        {resp && respTab === 'headers' && (
          <table className="kv-table">
            <thead>
              <tr><th>Header</th><th>Valor</th></tr>
            </thead>
            <tbody>
              {resp.headers.map(([k, v], i) => (
                <tr key={i}>
                  <td className="mono" style={{ fontWeight: 600 }}>{k}</td>
                  <td className="mono">{v}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}

        {respTab === 'tests' && (
          <div>
            {tests.length === 0 ? (
              <div style={{ color: 'var(--text-muted)' }}>No se ejecutaron aserciones <code>pm.test</code>.</div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                {tests.map((t, i) => (
                  <div key={i} className={`alert ${t.skipped ? 'warn' : t.passed ? 'ok' : 'err'}`} style={{ marginBottom: 0 }}>
                    <strong>{t.skipped ? '⊘ OMITIDO' : t.passed ? '✓ PASS' : '✗ FAIL'}</strong> — {t.name}
                    {t.location && <span style={{ opacity: 0.7, marginLeft: 8, fontSize: 11 }}>({t.location})</span>}
                    {t.error && <div className="mono" style={{ marginTop: 4, fontSize: 12 }}>{t.error}</div>}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {respTab === 'sent' && result.wire && (
          <div>
            <div className="mono" style={{ marginBottom: 8 }}>
              <strong>{result.wire.method}</strong> {result.wire.url}
              {resp?.sent.proxy && <span style={{ color: 'var(--text-muted)' }}> (via {resp.sent.proxy})</span>}
            </div>
            <table className="kv-table">
              <thead><tr><th>Header enviado</th><th>Valor</th></tr></thead>
              <tbody>
                {(resp?.sent.headers ?? result.wire.headers).map(([k, v], i) => (
                  <tr key={i}><td className="mono">{k}</td><td className="mono">{v}</td></tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
