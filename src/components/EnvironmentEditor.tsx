import { useState } from 'react';
import { exportEnvironment } from '../core/postman';
import type { EnvVar } from '../core/types';
import { fsWriteText, pickSaveFile } from '../platform/tauri';
import { useAppStore, type OpenTab } from '../store/appStore';

export function EnvironmentEditor({ tab }: { tab: OpenTab }) {
  const { environments, secrets, activeEnvId, setActiveEnv, updateEnvironment, setEnvSecret } = useAppStore();
  const [reveal, setReveal] = useState<Record<string, boolean>>({});
  const [includeSecretsOnExport, setIncludeSecretsOnExport] = useState(false);

  const env = tab.nodeId ? environments[tab.nodeId] : undefined;
  if (!env) return <div className="empty-state">Ambiente no encontrado.</div>;

  const envSecrets = secrets[env.id] ?? {};
  const isAct = activeEnvId === env.id;

  const updateRow = (idx: number, patch: Partial<EnvVar>) => {
    updateEnvironment(env.id, (e) => ({
      ...e,
      values: e.values.map((v, i) => (i === idx ? { ...v, ...patch } : v)),
    }));
  };

  const handleExport = async () => {
    const json = exportEnvironment(env, { includeSecrets: includeSecretsOnExport, secrets: envSecrets });
    const filename = `${env.name.replace(/[^\w.-]+/g, '_')}.postman_environment.json`;
    const dest = await pickSaveFile(filename, [{ name: 'Postman Environment', extensions: ['json'] }]);
    await fsWriteText(dest || filename, json);
  };

  const resetAll = () => {
    updateEnvironment(env.id, (e) => ({
      ...e,
      values: e.values.map((v) => ({ ...v, currentValue: undefined })),
    }));
  };

  const persistAll = () => {
    updateEnvironment(env.id, (e) => ({
      ...e,
      values: e.values.map((v) => (v.type === 'secret' ? v : { ...v, value: v.currentValue ?? v.value })),
    }));
  };

  return (
    <div className="editor-pane" style={{ padding: 14, overflow: 'auto' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12, gap: 10, flexWrap: 'wrap' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <input
            style={{ fontSize: 15, fontWeight: 700, minWidth: 260 }}
            value={env.name}
            onChange={(e) => updateEnvironment(env.id, (cur) => ({ ...cur, name: e.target.value }))}
          />
          <button className={isAct ? 'primary' : 'secondary'} onClick={() => setActiveEnv(isAct ? null : env.id)}>
            {isAct ? '● Activo' : 'Activar ambiente'}
          </button>
        </div>

        <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
          <button className="secondary" onClick={resetAll} title="Restablecer valor actual al inicial">Restablecer</button>
          <button className="secondary" onClick={persistAll} title="Copiar valores actuales a iniciales">Persistir</button>
          <label style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 12 }}>
            <input type="checkbox" checked={includeSecretsOnExport} onChange={(e) => setIncludeSecretsOnExport(e.target.checked)} />
            Incluir secretos
          </label>
          <button className="secondary" onClick={handleExport}>Exportar</button>
        </div>
      </div>

      <div className="alert" style={{ fontSize: 12 }}>
        Las variables marcadas como <strong>secret</strong> se almacenan en el Administrador de credenciales de Windows (y no se exportan en el JSON salvo que marques "Incluir secretos").
      </div>

      <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 6 }}>
        <button
          className="secondary icon-btn"
          onClick={() => updateEnvironment(env.id, (e) => ({ ...e, values: [...e.values, { key: '', value: '', type: 'default', enabled: true }] }))}
        >
          + Agregar variable
        </button>
      </div>

      <table className="kv-table">
        <thead>
          <tr>
            <th style={{ width: 28 }}></th>
            <th>Variable</th>
            <th style={{ width: 95 }}>Tipo</th>
            <th>Valor inicial</th>
            <th>Valor actual (local / secreto)</th>
            <th style={{ width: 32 }}></th>
          </tr>
        </thead>
        <tbody>
          {env.values.map((v, idx) => {
            const isSecret = v.type === 'secret';
            const shown = Boolean(reveal[v.key || String(idx)]);
            const secretVal = envSecrets[v.key] ?? '';
            return (
              <tr key={idx} style={{ opacity: v.enabled === false ? 0.5 : 1 }}>
                <td style={{ textAlign: 'center' }}>
                  <input
                    type="checkbox"
                    checked={v.enabled !== false}
                    onChange={(e) => updateRow(idx, { enabled: e.target.checked })}
                  />
                </td>
                <td>
                  <input
                    className="mono"
                    value={v.key}
                    onChange={(e) => updateRow(idx, { key: e.target.value })}
                    placeholder="nombreVariable"
                  />
                </td>
                <td>
                  <select
                    value={isSecret ? 'secret' : 'default'}
                    onChange={(e) => updateRow(idx, { type: e.target.value })}
                  >
                    <option value="default">default</option>
                    <option value="secret">secret</option>
                  </select>
                </td>
                <td>
                  {isSecret ? (
                    <span style={{ color: 'var(--text-muted)', fontSize: 12 }}>No guardado en JSON</span>
                  ) : (
                    <input
                      className="mono"
                      value={v.value}
                      onChange={(e) => updateRow(idx, { value: e.target.value })}
                    />
                  )}
                </td>
                <td>
                  {isSecret ? (
                    <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
                      <input
                        type={shown ? 'text' : 'password'}
                        className="mono"
                        value={secretVal}
                        placeholder="Escribir secreto…"
                        onChange={(e) => {
                          if (v.key) void setEnvSecret(env.id, v.key, e.target.value);
                        }}
                      />
                      <button
                        className="icon-btn"
                        onClick={() => setReveal((r) => ({ ...r, [v.key || String(idx)]: !shown }))}
                        title="Mostrar/ocultar"
                      >
                        👁
                      </button>
                    </div>
                  ) : (
                    <input
                      className="mono"
                      value={v.currentValue ?? v.value}
                      onChange={(e) => updateRow(idx, { currentValue: e.target.value })}
                    />
                  )}
                </td>
                <td>
                  <button
                    className="icon-btn danger"
                    onClick={() => updateEnvironment(env.id, (e) => ({ ...e, values: e.values.filter((_, i) => i !== idx) }))}
                  >
                    ×
                  </button>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
