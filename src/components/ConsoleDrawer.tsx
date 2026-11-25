import { useState } from 'react';
import { useAppStore } from '../store/appStore';

export function ConsoleDrawer() {
  const { consoleLogs, clearConsole, setConsoleOpen } = useAppStore();
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});

  return (
    <div className="console-drawer">
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '5px 10px', borderBottom: '1px solid var(--border)' }}>
        <strong>Consola ({consoleLogs.length})</strong>
        <div style={{ display: 'flex', gap: 6 }}>
          <button className="secondary icon-btn" onClick={clearConsole}>Limpiar</button>
          <button className="icon-btn" onClick={() => setConsoleOpen(false)}>×</button>
        </div>
      </div>
      <div style={{ flex: 1, overflowY: 'auto' }}>
        {[...consoleLogs].reverse().map((c) => {
          const open = Boolean(expanded[c.id]);
          return (
            <div key={c.id} className="console-item">
              <div
                style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: c.wire ? 'pointer' : 'default' }}
                onClick={() => c.wire && setExpanded((e) => ({ ...e, [c.id]: !open }))}
              >
                <span style={{ color: 'var(--text-muted)', fontSize: 11 }}>{new Date(c.time).toLocaleTimeString()}</span>
                <span className="badge">{c.source}</span>
                {c.kind === 'http' && c.wire && (
                  <>
                    <span className={`method-tag m-${c.wire.method}`}>{c.wire.method}</span>
                    <span className="mono" style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{c.wire.url}</span>
                    {c.response?.sent.proxy && <span className="badge">proxy: {c.response.sent.proxy}</span>}
                    {c.response && <span className={`badge ${c.response.code < 400 ? 'ok' : 'err'}`}>{c.response.code} · {c.response.responseTime} ms</span>}
                    {c.error && <span className="badge err">{c.error.message}</span>}
                  </>
                )}
                {c.kind !== 'http' && (
                  <span className="mono" style={{ color: c.kind === 'error' ? 'var(--red)' : 'var(--text)' }}>{c.message}</span>
                )}
              </div>
              {open && c.wire && (
                <div className="mono" style={{ marginTop: 6, paddingLeft: 18, fontSize: 11, color: 'var(--text-muted)' }}>
                  <div>Headers enviados: {c.wire.headers.map(([k, v]) => `${k}: ${v}`).join(' | ')}</div>
                  {c.response && <div>Headers recibidos: {c.response.headers.map(([k, v]) => `${k}: ${v}`).join(' | ')}</div>}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
