import { useState } from 'react';
import { toHttpError, type ProxyMode } from '../../core/wire';
import { pickOpenFile, tauriTransport } from '../../platform/tauri';
import { useAppStore, type AppSettings } from '../../store/appStore';

type Tab = 'proxy' | 'tls' | 'general';

export function SettingsModal() {
  const { settings, updateSettings, setSettingsOpen, appInfo } = useAppStore();
  const [tab, setTab] = useState<Tab>('proxy');
  const [draft, setDraft] = useState<AppSettings>(() => structuredClone(settings));
  const [showPass, setShowPass] = useState(false);
  const [testUrl, setTestUrl] = useState('http://example.com');
  const [testResult, setTestResult] = useState<{ ok: boolean; msg: string } | null>(null);
  const [testing, setTesting] = useState(false);
  const [saving, setSaving] = useState(false);

  const px = draft.network.proxy;
  const tls = draft.network.tls;

  const save = async () => {
    setSaving(true);
    try {
      await updateSettings(draft);
      setSettingsOpen(false);
    } catch (e) {
      setTestResult({ ok: false, msg: toHttpError(e).message });
    } finally {
      setSaving(false);
    }
  };

  const testProxy = async () => {
    setTesting(true);
    setTestResult(null);
    try {
      await updateSettings(draft);
      const r = await tauriTransport.send({
        id: 'proxy-test',
        method: 'GET',
        url: testUrl,
        headers: [['User-Agent', 'FerrURL-ProxyCheck/1.0']],
        body: { type: 'none' },
        settings: { timeoutMs: 10000, followRedirects: true, maxRedirects: 5, useProxy: true, verifyTls: tls.verify },
      });
      setTestResult({ ok: true, msg: `Conexión OK: ${r.status} ${r.statusText} (${r.timeMs} ms) — proxy: ${r.request.proxy ?? 'directo'}` });
    } catch (e) {
      const err = toHttpError(e);
      setTestResult({ ok: false, msg: `${err.kind}: ${err.message}` });
    } finally {
      setTesting(false);
    }
  };

  return (
    <div className="modal-backdrop" onClick={() => setSettingsOpen(false)}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <span>Configuración de FerrURL</span>
          <button className="icon-btn" onClick={() => setSettingsOpen(false)}>×</button>
        </div>

        <div className="subtabs" style={{ marginTop: 4 }}>
          <button className={tab === 'proxy' ? 'active' : ''} onClick={() => setTab('proxy')}>Proxy corporativo</button>
          <button className={tab === 'tls' ? 'active' : ''} onClick={() => setTab('tls')}>Certificados TLS / SSL</button>
          <button className={tab === 'general' ? 'active' : ''} onClick={() => setTab('general')}>General</button>
        </div>

        <div className="modal-body">
          {tab === 'proxy' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              <div className="form-grid">
                <label>Modo de proxy</label>
                <select
                  value={px.mode}
                  onChange={(e) =>
                    setDraft({ ...draft, network: { ...draft.network, proxy: { ...px, mode: e.target.value as ProxyMode } } })
                  }
                >
                  <option value="off">Sin proxy (conexión directa)</option>
                  <option value="system">Usar proxy del sistema (HTTP_PROXY / Windows)</option>
                  <option value="manual">Proxy HTTP / HTTPS manual</option>
                </select>
              </div>

              {px.mode === 'manual' && (
                <div className="form-grid">
                  <label>Host HTTP</label>
                  <div style={{ display: 'flex', gap: 6 }}>
                    <input
                      style={{ flex: 1 }}
                      placeholder="proxy.empresa.local"
                      value={px.httpHost}
                      onChange={(e) => setDraft({ ...draft, network: { ...draft.network, proxy: { ...px, httpHost: e.target.value } } })}
                    />
                    <input
                      type="number"
                      style={{ width: 95 }}
                      placeholder="8080"
                      value={px.httpPort || ''}
                      onChange={(e) => setDraft({ ...draft, network: { ...draft.network, proxy: { ...px, httpPort: Number(e.target.value) || 0 } } })}
                    />
                  </div>

                  <label>Host HTTPS (opcional)</label>
                  <div style={{ display: 'flex', gap: 6 }}>
                    <input
                      style={{ flex: 1 }}
                      placeholder="Si queda vacío usa el mismo HTTP"
                      value={px.httpsHost}
                      onChange={(e) => setDraft({ ...draft, network: { ...draft.network, proxy: { ...px, httpsHost: e.target.value } } })}
                    />
                    <input
                      type="number"
                      style={{ width: 95 }}
                      placeholder="Puerto"
                      value={px.httpsPort || ''}
                      onChange={(e) => setDraft({ ...draft, network: { ...draft.network, proxy: { ...px, httpsPort: Number(e.target.value) || 0 } } })}
                    />
                  </div>

                  <label>Usuario del proxy</label>
                  <input
                    value={px.username}
                    placeholder="Opcional (Basic auth)"
                    onChange={(e) => setDraft({ ...draft, network: { ...draft.network, proxy: { ...px, username: e.target.value } } })}
                  />

                  <label>Contraseña del proxy</label>
                  <div style={{ display: 'flex', gap: 6 }}>
                    <input
                      type={showPass ? 'text' : 'password'}
                      style={{ flex: 1 }}
                      value={px.password}
                      placeholder="Se guarda en Credential Manager"
                      onChange={(e) => setDraft({ ...draft, network: { ...draft.network, proxy: { ...px, password: e.target.value } } })}
                    />
                    <button className="secondary icon-btn" onClick={() => setShowPass(!showPass)}>👁</button>
                  </div>

                  <label>Omitir proxy para (bypass)</label>
                  <input
                    className="mono"
                    value={px.bypass}
                    placeholder="localhost, 127.0.0.1, *.interno.local"
                    onChange={(e) => setDraft({ ...draft, network: { ...draft.network, proxy: { ...px, bypass: e.target.value } } })}
                  />
                </div>
              )}

              <div style={{ borderTop: '1px solid var(--border)', paddingTop: 10 }}>
                <div style={{ fontWeight: 600, marginBottom: 6 }}>Probar proxy</div>
                <div style={{ display: 'flex', gap: 6 }}>
                  <input className="mono" style={{ flex: 1 }} value={testUrl} onChange={(e) => setTestUrl(e.target.value)} />
                  <button className="secondary" onClick={testProxy} disabled={testing}>
                    {testing ? 'Probando…' : 'Probar conexión'}
                  </button>
                </div>
                {testResult && (
                  <div className={`alert ${testResult.ok ? 'ok' : 'err'}`} style={{ marginTop: 8, marginBottom: 0 }}>
                    {testResult.msg}
                  </div>
                )}
              </div>
            </div>
          )}

          {tab === 'tls' && (
            <div className="form-grid">
              <label>Verificar certificados SSL</label>
              <input
                type="checkbox"
                style={{ justifySelf: 'start' }}
                checked={tls.verify}
                onChange={(e) => setDraft({ ...draft, network: { ...draft.network, tls: { ...tls, verify: e.target.checked } } })}
              />

              <label>CA corporativa (.pem / .crt)</label>
              <div>
                <button
                  className="secondary icon-btn"
                  onClick={async () => {
                    const p = await pickOpenFile([{ name: 'Certificados', extensions: ['pem', 'crt', 'cer', 'der'] }]);
                    if (p) {
                      setDraft({
                        ...draft,
                        network: { ...draft.network, tls: { ...tls, extraCaPaths: [...tls.extraCaPaths, p] } },
                      });
                    }
                  }}
                >
                  + Agregar certificado…
                </button>
                <div style={{ marginTop: 6, display: 'flex', flexDirection: 'column', gap: 4 }}>
                  {tls.extraCaPaths.map((p, i) => (
                    <div key={i} style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                      <span className="mono" style={{ flex: 1, fontSize: 12 }}>{p}</span>
                      <button
                        className="icon-btn danger"
                        onClick={() =>
                          setDraft({
                            ...draft,
                            network: { ...draft.network, tls: { ...tls, extraCaPaths: tls.extraCaPaths.filter((_, idx) => idx !== i) } },
                          })
                        }
                      >
                        ×
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}

          {tab === 'general' && (
            <div className="form-grid">
              <label>Tema</label>
              <select value={draft.theme} onChange={(e) => setDraft({ ...draft, theme: e.target.value as 'dark' | 'light' })}>
                <option value="dark">Oscuro</option>
                <option value="light">Claro</option>
              </select>
              <label>Enviar headers automáticos</label>
              <input
                type="checkbox"
                style={{ justifySelf: 'start' }}
                checked={draft.defaults.sendDefaultHeaders}
                onChange={(e) => setDraft({ ...draft, defaults: { ...draft.defaults, sendDefaultHeaders: e.target.checked } })}
              />
              <label>Seguir redirecciones por defecto</label>
              <input
                type="checkbox"
                style={{ justifySelf: 'start' }}
                checked={draft.defaults.followRedirects}
                onChange={(e) => setDraft({ ...draft, defaults: { ...draft.defaults, followRedirects: e.target.checked } })}
              />
              <label>Timeout global (ms, 0 = sin límite)</label>
              <input
                type="number"
                value={draft.defaults.timeoutMs}
                onChange={(e) => setDraft({ ...draft, defaults: { ...draft.defaults, timeoutMs: Number(e.target.value) || 0 } })}
              />
              <label>Timeout de scripts (ms)</label>
              <input
                type="number"
                value={draft.scriptTimeoutMs}
                onChange={(e) => setDraft({ ...draft, scriptTimeoutMs: Number(e.target.value) || 30000 })}
              />
              <label>Carpeta de datos</label>
              <span className="mono" style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                {appInfo?.dataDir} {appInfo?.portable ? '(modo portable)' : ''} · Secretos: {appInfo?.secretsBackend}
              </span>
            </div>
          )}
        </div>

        <div className="modal-footer">
          <button className="secondary" onClick={() => setSettingsOpen(false)}>Cancelar</button>
          <button className="primary" onClick={save} disabled={saving}>{saving ? 'Guardando…' : 'Guardar'}</button>
        </div>
      </div>
    </div>
  );
}
