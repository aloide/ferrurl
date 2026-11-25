import { useState } from 'react';
import type { KV } from '../../core/types';
import type { ScopeChain } from '../../core/variables';
import { VarText } from './VarInput';

interface Props {
  items: KV[];
  onChange: (next: KV[]) => void;
  chain?: ScopeChain;
  keyPlaceholder?: string;
  valuePlaceholder?: string;
  showBulk?: boolean;
}

export function KeyValueTable({
  items,
  onChange,
  chain,
  keyPlaceholder = 'Clave',
  valuePlaceholder = 'Valor',
  showBulk = true,
}: Props) {
  const [bulk, setBulk] = useState(false);
  const [bulkText, setBulkText] = useState('');

  const updateRow = (idx: number, patch: Partial<KV>) => {
    const next = items.map((r, i) => (i === idx ? { ...r, ...patch } : r));
    onChange(next);
  };

  const removeRow = (idx: number) => {
    onChange(items.filter((_, i) => i !== idx));
  };

  const addRow = () => {
    onChange([...items, { key: '', value: '' }]);
  };

  const toggleBulk = () => {
    if (!bulk) {
      setBulkText(
        items
          .map((r) => `${r.disabled ? '// ' : ''}${r.key}: ${r.value}`)
          .join('\n'),
      );
      setBulk(true);
    } else {
      const next: KV[] = bulkText
        .split(/\r?\n/)
        .filter((l) => l.trim().length > 0)
        .map((line) => {
          const disabled = line.trimStart().startsWith('//');
          const clean = disabled ? line.trimStart().slice(2).trimStart() : line;
          const idx = clean.indexOf(':');
          return idx === -1
            ? { key: clean.trim(), value: '', ...(disabled ? { disabled: true } : {}) }
            : { key: clean.slice(0, idx).trim(), value: clean.slice(idx + 1).trim(), ...(disabled ? { disabled: true } : {}) };
        });
      onChange(next);
      setBulk(false);
    }
  };

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 6, marginBottom: 6 }}>
        <button className="secondary icon-btn" onClick={addRow}>+ Agregar fila</button>
        {showBulk && (
          <button className="secondary icon-btn" onClick={toggleBulk}>
            {bulk ? 'Vista tabla' : 'Edición masiva'}
          </button>
        )}
      </div>
      {bulk ? (
        <textarea
          className="mono"
          rows={8}
          style={{ width: '100%' }}
          value={bulkText}
          onChange={(e) => setBulkText(e.target.value)}
          placeholder="Clave: Valor (usa // al inicio para deshabilitar)"
        />
      ) : (
        <table className="kv-table">
          <thead>
            <tr>
              <th style={{ width: 28 }}></th>
              <th>{keyPlaceholder}</th>
              <th>{valuePlaceholder}</th>
              <th>Descripción</th>
              <th style={{ width: 32 }}></th>
            </tr>
          </thead>
          <tbody>
            {items.map((row, idx) => (
              <tr key={idx} style={{ opacity: row.disabled ? 0.5 : 1 }}>
                <td style={{ textAlign: 'center' }}>
                  <input
                    type="checkbox"
                    checked={!row.disabled}
                    onChange={(e) => updateRow(idx, { disabled: !e.target.checked })}
                  />
                </td>
                <td>
                  <input
                    className="mono"
                    value={row.key}
                    placeholder={keyPlaceholder}
                    onChange={(e) => updateRow(idx, { key: e.target.value })}
                  />
                </td>
                <td>
                  <VarText
                    value={row.value}
                    placeholder={valuePlaceholder}
                    chain={chain}
                    onChange={(value) => updateRow(idx, { value })}
                  />
                </td>
                <td>
                  <input
                    value={row.description ?? ''}
                    placeholder="Opcional"
                    onChange={(e) => updateRow(idx, { description: e.target.value })}
                  />
                </td>
                <td>
                  <button className="icon-btn danger" onClick={() => removeRow(idx)} title="Eliminar">×</button>
                </td>
              </tr>
            ))}
            {items.length === 0 && (
              <tr>
                <td colSpan={5} style={{ textAlign: 'center', color: 'var(--text-muted)', padding: 10 }}>
                  Sin elementos. <button className="secondary icon-btn" onClick={addRow}>Agregar</button>
                </td>
              </tr>
            )}
          </tbody>
        </table>
      )}
    </div>
  );
}
