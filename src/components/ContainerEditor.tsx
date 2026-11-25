import { useState } from 'react';
import { scriptOf, withScript } from '../core/postman';
import { findNode } from '../core/tree';
import { isFolder, type PMFolder } from '../core/types';
import { useAppStore, type OpenTab } from '../store/appStore';
import { AuthEditor } from './request/AuthEditor';
import { ScriptEditor } from './request/ScriptEditor';
import { KeyValueTable } from './shared/KeyValueTable';

type Tab = 'auth' | 'prerequest' | 'tests' | 'variables';

export function ContainerEditor({ tab }: { tab: OpenTab }) {
  const [sub, setSub] = useState<Tab>('prerequest');
  const { collections, updateCollection, updateFolder, openRunnerTab } = useAppStore();
  const col = tab.collectionId ? collections[tab.collectionId] : undefined;
  if (!col) return <div className="empty-state">Colección no encontrada.</div>;

  const found = tab.nodeId ? findNode(col.item, tab.nodeId) : null;
  const folder: PMFolder | null = found && isFolder(found.node) ? found.node : null;
  if (tab.nodeId && !folder) return <div className="empty-state">Carpeta no encontrada.</div>;

  const events = folder ? folder.event : col.event;
  const auth = folder ? folder.auth : col.auth;
  const title = folder ? folder.name : col.info.name;
  const desc = typeof (folder ? folder.description : col.info.description) === 'string'
    ? String(folder ? folder.description : col.info.description)
    : '';

  const setEvents = (listen: 'prerequest' | 'test', code: string) => {
    if (folder) updateFolder(col.info._postman_id!, folder.id, (f) => ({ ...f, event: withScript(f.event, listen, code) }));
    else updateCollection(col.info._postman_id!, (c) => ({ ...c, event: withScript(c.event, listen, code) }));
  };

  const setAuth = (next: NonNullable<typeof auth>) => {
    if (folder) updateFolder(col.info._postman_id!, folder.id, (f) => ({ ...f, auth: next }));
    else updateCollection(col.info._postman_id!, (c) => ({ ...c, auth: next }));
  };

  return (
    <div className="editor-pane" style={{ padding: 14, overflow: 'auto' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
        <div>
          <div style={{ fontSize: 16, fontWeight: 700 }}>{folder ? `📁 ${title}` : `📦 ${title}`}</div>
          {desc && <div style={{ color: 'var(--text-muted)', marginTop: 4, whiteSpace: 'pre-wrap' }}>{desc}</div>}
        </div>
        <button className="primary" onClick={() => openRunnerTab(col.info._postman_id!, folder?.id)}>
          ▶ Ejecutar en Runner
        </button>
      </div>

      <div className="subtabs" style={{ paddingLeft: 0, marginBottom: 12 }}>
        <button className={sub === 'prerequest' ? 'active' : ''} onClick={() => setSub('prerequest')}>
          Pre-request {scriptOf(events, 'prerequest').trim() ? '●' : ''}
        </button>
        <button className={sub === 'tests' ? 'active' : ''} onClick={() => setSub('tests')}>
          Tests {scriptOf(events, 'test').trim() ? '●' : ''}
        </button>
        <button className={sub === 'auth' ? 'active' : ''} onClick={() => setSub('auth')}>Authorization</button>
        {!folder && (
          <button className={sub === 'variables' ? 'active' : ''} onClick={() => setSub('variables')}>
            Variables ({col.variable?.length ?? 0})
          </button>
        )}
      </div>

      {sub === 'prerequest' && (
        <ScriptEditor kind="prerequest" code={scriptOf(events, 'prerequest')} onChange={(c) => setEvents('prerequest', c)} />
      )}
      {sub === 'tests' && (
        <ScriptEditor kind="test" code={scriptOf(events, 'test')} onChange={(c) => setEvents('test', c)} />
      )}
      {sub === 'auth' && (
        <AuthEditor auth={auth} allowInherit={Boolean(folder)} onChange={setAuth} />
      )}
      {sub === 'variables' && !folder && (
        <KeyValueTable
          items={(col.variable ?? []).map((v) => ({ key: v.key, value: String(v.value ?? ''), disabled: v.disabled }))}
          onChange={(rows) =>
            updateCollection(col.info._postman_id!, (c) => ({
              ...c,
              variable: rows.map((r) => ({ key: r.key, value: r.value, ...(r.disabled ? { disabled: true } : {}) })),
            }))
          }
        />
      )}
    </div>
  );
}
