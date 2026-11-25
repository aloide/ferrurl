import { useState } from 'react';
import { fsReadText, pickOpenFile } from '../../platform/tauri';
import { useAppStore } from '../../store/appStore';

export function ImportModal() {
  const { setImportOpen, importJsonText } = useAppStore();
  const [text, setText] = useState('');
  const [error, setError] = useState('');
  const [done, setDone] = useState('');

  const pickFile = async () => {
    setError('');
    const p = await pickOpenFile([{ name: 'Postman JSON', extensions: ['json'] }]);
    if (!p) return;
    try {
      const content = await fsReadText(p);
      const res = await importJsonText(content);
      setDone(`${res.kind} "${res.name}" importada.`);
      setTimeout(() => setImportOpen(false), 600);
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const importPaste = async () => {
    setError('');
    try {
      const res = await importJsonText(text);
      setDone(`${res.kind} "${res.name}" importada.`);
      setTimeout(() => setImportOpen(false), 600);
    } catch (e) {
      setError((e as Error).message);
    }
  };

  return (
    <div className="modal-backdrop" onClick={() => setImportOpen(false)}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <span>Importar colección o ambiente (Postman v2.0 / v2.1)</span>
          <button className="icon-btn" onClick={() => setImportOpen(false)}>×</button>
        </div>
        <div className="modal-body" style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {error && <div className="alert err">{error}</div>}
          {done && <div className="alert ok">{done}</div>}
          <div>
            <button className="primary" onClick={pickFile}>Elegir archivo .json…</button>
          </div>
          <div style={{ color: 'var(--text-muted)', fontSize: 12 }}>O pegá el JSON directamente:</div>
          <textarea
            className="mono"
            rows={10}
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder='{ "info": { "name": "...", "schema": "...v2.1.0..." }, "item": [...] }'
          />
        </div>
        <div className="modal-footer">
          <button className="secondary" onClick={() => setImportOpen(false)}>Cerrar</button>
          <button className="primary" onClick={importPaste} disabled={!text.trim()}>Importar texto</button>
        </div>
      </div>
    </div>
  );
}
