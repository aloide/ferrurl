import { chainFromState } from '../../core/runner';
import { SCOPE_PRIORITY, stringifyValue } from '../../core/variables';
import { useAppStore } from '../../store/appStore';

export function QuickLookModal() {
  const { setQuickLookOpen, tabs, activeTabId, collections, environments, secrets, activeEnvId, globals } = useAppStore();
  const activeTab = tabs.find((t) => t.id === activeTabId);
  const col = activeTab?.collectionId ? collections[activeTab.collectionId] : undefined;
  const env = activeEnvId ? environments[activeEnvId] : null;
  const chain = chainFromState({
    collection: col,
    environment: env,
    secrets: activeEnvId ? secrets[activeEnvId] ?? {} : {},
    globals,
  });

  const rows: { scope: string; key: string; val: string; secret?: boolean }[] = [];
  for (const s of SCOPE_PRIORITY) {
    for (const [k, v] of chain[s].entries()) {
      const isSecret = s === 'environment' && env?.values.some((ev) => ev.key === k && ev.type === 'secret');
      rows.push({ scope: s, key: k, val: isSecret ? '••••••••' : stringifyValue(v), secret: isSecret });
    }
  }

  return (
    <div className="modal-backdrop" onClick={() => setQuickLookOpen(false)}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <span>Variables activas (Quick Look)</span>
          <button className="icon-btn" onClick={() => setQuickLookOpen(false)}>×</button>
        </div>
        <div className="modal-body">
          <table className="kv-table">
            <thead><tr><th>Scope</th><th>Variable</th><th>Valor</th></tr></thead>
            <tbody>
              {rows.map((r, i) => (
                <tr key={i}>
                  <td><span className="badge">{r.scope}</span></td>
                  <td className="mono">{r.key}</td>
                  <td className="mono">{r.val}</td>
                </tr>
              ))}
              {rows.length === 0 && (
                <tr><td colSpan={3} style={{ textAlign: 'center', color: 'var(--text-muted)', padding: 14 }}>Sin variables definidas.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
