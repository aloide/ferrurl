import { useState } from 'react';
import { toCurl, type CurlFlavor } from '../../core/codegen';
import { buildCurlWire } from '../request/RequestEditor';
import { useAppStore, type OpenTab } from '../../store/appStore';

export function CurlModal({ tab, onClose }: { tab: OpenTab; onClose: () => void }) {
  const [flavor, setFlavor] = useState<CurlFlavor>('bash');
  const [includeDefaults, setIncludeDefaults] = useState(false);
  const proxy = useAppStore((s) => s.settings.network.proxy);

  const wire = buildCurlWire(tab);
  const curlProxy =
    proxy.mode === 'manual' && proxy.httpHost
      ? {
          url: `http://${proxy.httpHost}:${proxy.httpPort || 8080}`,
          username: proxy.username || undefined,
          password: proxy.password || undefined,
        }
      : null;

  const snippet = wire ? toCurl(wire, flavor, curlProxy, includeDefaults) : 'No se pudo generar el comando.';

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <span>Generar código cURL</span>
          <button className="icon-btn" onClick={onClose}>×</button>
        </div>
        <div className="modal-body" style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
            <select value={flavor} onChange={(e) => setFlavor(e.target.value as CurlFlavor)}>
              <option value="bash">cURL (Bash / Git Bash)</option>
              <option value="powershell">cURL (PowerShell)</option>
              <option value="cmd">cURL (Windows CMD)</option>
            </select>
            <label style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
              <input type="checkbox" checked={includeDefaults} onChange={(e) => setIncludeDefaults(e.target.checked)} />
              Incluir headers automáticos
            </label>
          </div>
          <textarea className="mono" rows={12} readOnly value={snippet} />
        </div>
        <div className="modal-footer">
          <button className="secondary" onClick={onClose}>Cerrar</button>
          <button className="primary" onClick={() => navigator.clipboard.writeText(snippet)}>Copiar</button>
        </div>
      </div>
    </div>
  );
}
