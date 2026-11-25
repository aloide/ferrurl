import { useState } from 'react';
import { AUTH_TYPES, authParams, setAuthParam } from '../../core/auth';
import type { PMAuth } from '../../core/types';
import type { ScopeChain } from '../../core/variables';
import { VarText } from '../shared/VarInput';

interface Props {
  auth: PMAuth | undefined;
  onChange: (auth: PMAuth) => void;
  allowInherit?: boolean;
  inheritedLabel?: string;
  chain?: ScopeChain;
}

export function AuthEditor({ auth, onChange, allowInherit = true, inheritedLabel, chain }: Props) {
  const [showPass, setShowPass] = useState(false);
  const current: PMAuth = auth ?? { type: allowInherit ? 'inherit' : 'noauth' };
  const params = authParams(current);

  const types = allowInherit ? AUTH_TYPES : AUTH_TYPES.filter((t) => t.type !== 'inherit');

  return (
    <div style={{ maxWidth: 620 }}>
      <div className="form-grid" style={{ marginBottom: 14 }}>
        <label>Tipo de autenticación</label>
        <select
          value={current.type}
          onChange={(e) => onChange({ type: e.target.value })}
        >
          {types.map((t) => (
            <option key={t.type} value={t.type}>{t.label}</option>
          ))}
        </select>
      </div>

      {current.type === 'inherit' && (
        <div className="alert">
          Hereda la autenticación configurada en la carpeta padre o colección
          {inheritedLabel ? ` (${inheritedLabel})` : ''}.
        </div>
      )}

      {current.type === 'noauth' && (
        <div style={{ color: 'var(--text-muted)' }}>
          Este request no envía encabezado de autenticación automático. Podés escribir uno manual en Headers.
        </div>
      )}

      {current.type === 'basic' && (
        <div className="form-grid">
          <label>Usuario</label>
          <VarText
            value={params.username ?? ''}
            placeholder="{{usuario}}"
            chain={chain}
            showPills
            onChange={(v) => onChange(setAuthParam(current, 'username', v))}
          />
          <label>Contraseña</label>
          <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
            <input
              type={showPass ? 'text' : 'password'}
              className="mono"
              style={{ flex: 1 }}
              value={params.password ?? ''}
              placeholder="{{password}}"
              onChange={(e) => onChange(setAuthParam(current, 'password', e.target.value))}
            />
            <button className="secondary icon-btn" onClick={() => setShowPass(!showPass)}>
              {showPass ? 'Ocultar' : '👁'}
            </button>
          </div>
        </div>
      )}

      {current.type === 'bearer' && (
        <div className="form-grid">
          <label>Token</label>
          <VarText
            value={params.token ?? ''}
            placeholder="{{token}}"
            chain={chain}
            showPills
            onChange={(v) => onChange(setAuthParam(current, 'token', v))}
          />
        </div>
      )}

      {current.type === 'apikey' && (
        <div className="form-grid">
          <label>Clave</label>
          <VarText
            value={params.key ?? ''}
            placeholder="X-API-Key"
            chain={chain}
            onChange={(v) => onChange(setAuthParam(current, 'key', v))}
          />
          <label>Valor</label>
          <VarText
            value={params.value ?? ''}
            placeholder="{{apiKey}}"
            chain={chain}
            showPills
            onChange={(v) => onChange(setAuthParam(current, 'value', v))}
          />
          <label>Enviar en</label>
          <select
            value={params.in ?? 'header'}
            onChange={(e) => onChange(setAuthParam(current, 'in', e.target.value))}
          >
            <option value="header">Header</option>
            <option value="query">Query Param</option>
          </select>
        </div>
      )}
    </div>
  );
}
