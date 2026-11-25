import { formatJson, formatXml } from '../../core/format';
import type { BodyMode, FormDataKV, PMBody } from '../../core/types';
import type { ScopeChain } from '../../core/variables';
import { pickOpenFile } from '../../platform/tauri';
import { CodeEditor } from '../shared/CodeEditor';
import { KeyValueTable } from '../shared/KeyValueTable';
import { VarText } from '../shared/VarInput';

interface Props {
  body: PMBody | undefined;
  onChange: (b: PMBody) => void;
  chain?: ScopeChain;
}

const MODES: { id: BodyMode; label: string }[] = [
  { id: 'none', label: 'none' },
  { id: 'raw', label: 'raw' },
  { id: 'urlencoded', label: 'x-www-form-urlencoded' },
  { id: 'formdata', label: 'form-data' },
  { id: 'file', label: 'binary' },
  { id: 'graphql', label: 'GraphQL' },
];

export function BodyEditor({ body, onChange, chain }: Props) {
  const cur: PMBody = body ?? { mode: 'none' };
  const mode: BodyMode = cur.mode ?? 'none';
  const rawLang = (cur.options?.raw?.language ?? 'text') as 'text' | 'json' | 'xml' | 'html' | 'javascript';

  const setMode = (m: BodyMode) => onChange({ ...cur, mode: m });

  const prettify = () => {
    const raw = cur.raw ?? '';
    try {
      const next = rawLang === 'json' ? formatJson(raw) : rawLang === 'xml' || rawLang === 'html' ? formatXml(raw) : raw;
      onChange({ ...cur, raw: next });
    } catch {
      /* ignorar si esta mal formado */
    }
  };

  const formRows: FormDataKV[] = cur.formdata ?? [];

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 10, flexWrap: 'wrap' }}>
        {MODES.map((m) => (
          <label key={m.id} style={{ display: 'inline-flex', alignItems: 'center', gap: 4, cursor: 'pointer' }}>
            <input type="radio" name="bodyMode" checked={mode === m.id} onChange={() => setMode(m.id)} />
            <span>{m.label}</span>
          </label>
        ))}

        {mode === 'raw' && (
          <div style={{ marginLeft: 'auto', display: 'flex', gap: 6, alignItems: 'center' }}>
            <select
              value={rawLang}
              onChange={(e) =>
                onChange({ ...cur, options: { ...(cur.options ?? {}), raw: { language: e.target.value } } })
              }
            >
              <option value="text">Text</option>
              <option value="json">JSON</option>
              <option value="xml">XML</option>
              <option value="html">HTML</option>
              <option value="javascript">JavaScript</option>
            </select>
            {(rawLang === 'json' || rawLang === 'xml' || rawLang === 'html') && (
              <button className="secondary icon-btn" onClick={prettify}>Formatear</button>
            )}
          </div>
        )}
      </div>

      {mode === 'none' && <div style={{ color: 'var(--text-muted)' }}>Este request no envía cuerpo.</div>}

      {mode === 'raw' && (
        <CodeEditor
          value={cur.raw ?? ''}
          language={rawLang}
          height="240px"
          onChange={(raw) => onChange({ ...cur, raw })}
        />
      )}

      {mode === 'urlencoded' && (
        <KeyValueTable
          items={cur.urlencoded ?? []}
          chain={chain}
          onChange={(urlencoded) => onChange({ ...cur, urlencoded })}
        />
      )}

      {mode === 'formdata' && (
        <div>
          <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 6 }}>
            <button
              className="secondary icon-btn"
              onClick={() => onChange({ ...cur, formdata: [...formRows, { key: '', value: '', type: 'text' }] })}
            >
              + Agregar campo
            </button>
          </div>
          <table className="kv-table">
            <thead>
              <tr>
                <th style={{ width: 28 }}></th>
                <th>Clave</th>
                <th style={{ width: 88 }}>Tipo</th>
                <th>Valor / Archivo</th>
                <th style={{ width: 32 }}></th>
              </tr>
            </thead>
            <tbody>
              {formRows.map((row, idx) => (
                <tr key={idx}>
                  <td style={{ textAlign: 'center' }}>
                    <input
                      type="checkbox"
                      checked={!row.disabled}
                      onChange={(e) =>
                        onChange({
                          ...cur,
                          formdata: formRows.map((r, i) => (i === idx ? { ...r, disabled: !e.target.checked } : r)),
                        })
                      }
                    />
                  </td>
                  <td>
                    <input
                      className="mono"
                      value={row.key}
                      onChange={(e) =>
                        onChange({
                          ...cur,
                          formdata: formRows.map((r, i) => (i === idx ? { ...r, key: e.target.value } : r)),
                        })
                      }
                    />
                  </td>
                  <td>
                    <select
                      value={row.type ?? 'text'}
                      onChange={(e) =>
                        onChange({
                          ...cur,
                          formdata: formRows.map((r, i) => (i === idx ? { ...r, type: e.target.value } : r)),
                        })
                      }
                    >
                      <option value="text">Texto</option>
                      <option value="file">Archivo</option>
                    </select>
                  </td>
                  <td>
                    {row.type === 'file' ? (
                      <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                        <input
                          className="mono"
                          style={{ flex: 1 }}
                          value={typeof row.src === 'string' ? row.src : ''}
                          placeholder="Ruta al archivo"
                          onChange={(e) =>
                            onChange({
                              ...cur,
                              formdata: formRows.map((r, i) => (i === idx ? { ...r, src: e.target.value } : r)),
                            })
                          }
                        />
                        <button
                          className="secondary icon-btn"
                          onClick={async () => {
                            const p = await pickOpenFile();
                            if (p) {
                              onChange({
                                ...cur,
                                formdata: formRows.map((r, i) => (i === idx ? { ...r, src: p } : r)),
                              });
                            }
                          }}
                        >
                          Elegir…
                        </button>
                      </div>
                    ) : (
                      <VarText
                        value={row.value}
                        chain={chain}
                        onChange={(value) =>
                          onChange({
                            ...cur,
                            formdata: formRows.map((r, i) => (i === idx ? { ...r, value } : r)),
                          })
                        }
                      />
                    )}
                  </td>
                  <td>
                    <button
                      className="icon-btn danger"
                      onClick={() => onChange({ ...cur, formdata: formRows.filter((_, i) => i !== idx) })}
                    >
                      ×
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {mode === 'file' && (
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', maxWidth: 620 }}>
          <input
            className="mono"
            style={{ flex: 1 }}
            value={cur.file?.src ?? ''}
            placeholder="Ruta del archivo binario"
            onChange={(e) => onChange({ ...cur, file: { ...(cur.file ?? {}), src: e.target.value } })}
          />
          <button
            className="secondary"
            onClick={async () => {
              const p = await pickOpenFile();
              if (p) onChange({ ...cur, file: { ...(cur.file ?? {}), src: p } });
            }}
          >
            Seleccionar archivo…
          </button>
        </div>
      )}

      {mode === 'graphql' && (
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
          <div>
            <div style={{ marginBottom: 4, color: 'var(--text-muted)', fontSize: 12 }}>Query</div>
            <CodeEditor
              value={cur.graphql?.query ?? ''}
              language="text"
              height="200px"
              onChange={(query) => onChange({ ...cur, graphql: { ...(cur.graphql ?? {}), query } })}
            />
          </div>
          <div>
            <div style={{ marginBottom: 4, color: 'var(--text-muted)', fontSize: 12 }}>Variables (JSON)</div>
            <CodeEditor
              value={cur.graphql?.variables ?? ''}
              language="json"
              height="200px"
              onChange={(variables) => onChange({ ...cur, graphql: { ...(cur.graphql ?? {}), variables } })}
            />
          </div>
        </div>
      )}
    </div>
  );
}
