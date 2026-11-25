import { useState } from 'react';
import { exportCollection } from '../core/postman';
import { isFolder, type PMCollection, type PMFolder, type PMNode } from '../core/types';
import { fsWriteText, pickSaveFile } from '../platform/tauri';
import { useAppStore } from '../store/appStore';

type SideTab = 'collections' | 'environments' | 'history';

export function Sidebar() {
  const [sideTab, setSideTab] = useState<SideTab>('collections');
  const [filter, setFilter] = useState('');
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [dragInfo, setDragInfo] = useState<{ colId: string; nodeId: string } | null>(null);

  const {
    collections,
    collectionOrder,
    environments,
    environmentOrder,
    activeEnvId,
    history,
    createCollection,
    deleteCollection,
    renameCollection,
    addRequest,
    addFolder,
    duplicateNode,
    deleteNode,
    moveCollectionNode,
    updateFolder,
    updateItem,
    openRequestTab,
    openContainerTab,
    openRunnerTab,
    createEnvironment,
    openEnvironmentTab,
    deleteEnvironment,
    setActiveEnv,
    openScratchTab,
    clearHistory,
    setImportOpen,
    tabs,
    activeTabId,
  } = useAppStore();

  const activeTab = tabs.find((t) => t.id === activeTabId);
  const q = filter.trim().toLowerCase();

  const toggle = (id: string) => setExpanded((e) => ({ ...e, [id]: e[id] === false ? true : !(e[id] ?? true) }));
  const isOpen = (id: string) => (q ? true : (expanded[id] ?? true));

  const matchesFilter = (node: PMNode): boolean => {
    if (!q) return true;
    if (node.name.toLowerCase().includes(q)) return true;
    if (isFolder(node)) return node.item.some(matchesFilter);
    return node.request.url.raw.toLowerCase().includes(q);
  };

  const handleExportCollection = async (c: PMCollection) => {
    const json = exportCollection(c);
    const filename = `${c.info.name.replace(/[^\w.-]+/g, '_')}.postman_collection.json`;
    const dest = await pickSaveFile(filename, [{ name: 'Postman Collection', extensions: ['json'] }]);
    if (dest) await fsWriteText(dest, json);
    else await fsWriteText(filename, json);
  };

  const renderNode = (colId: string, node: PMNode, depth: number) => {
    if (!matchesFilter(node)) return null;
    if (isFolder(node)) {
      const open = isOpen(node.id);
      const selected = activeTab?.kind === 'container' && activeTab.nodeId === node.id;
      return (
        <div key={node.id}>
          <div
            className={`tree-row ${selected ? 'selected' : ''}`}
            style={{ paddingLeft: 6 + depth * 14 }}
            draggable
            onDragStart={(e) => {
              e.stopPropagation();
              setDragInfo({ colId, nodeId: node.id });
            }}
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => {
              e.preventDefault();
              e.stopPropagation();
              if (dragInfo && dragInfo.colId === colId && dragInfo.nodeId !== node.id) {
                moveCollectionNode(colId, dragInfo.nodeId, node.id);
              }
              setDragInfo(null);
            }}
            onClick={() => toggle(node.id)}
            onDoubleClick={() => openContainerTab(colId, node.id)}
          >
            <span style={{ width: 14, color: 'var(--text-muted)' }}>{open ? '▾' : '▸'}</span>
            <span>📁</span>
            <span className="tree-name">{node.name}</span>
            <div className="tree-actions" onClick={(e) => e.stopPropagation()}>
              <button className="icon-btn" title="Ejecutar carpeta" onClick={() => openRunnerTab(colId, node.id)}>▶</button>
              <button className="icon-btn" title="Nuevo request" onClick={() => addRequest(colId, node.id)}>+</button>
              <button className="icon-btn" title="Configurar carpeta" onClick={() => openContainerTab(colId, node.id)}>⚙</button>
              <button
                className="icon-btn"
                title="Renombrar"
                onClick={() => {
                  const name = window.prompt('Nuevo nombre de carpeta:', node.name);
                  if (name?.trim()) updateFolder(colId, node.id, (f: PMFolder) => ({ ...f, name: name.trim() }));
                }}
              >
                ✎
              </button>
              <button className="icon-btn danger" title="Eliminar" onClick={() => deleteNode(colId, node.id)}>×</button>
            </div>
          </div>
          {open && node.item.map((child) => renderNode(colId, child, depth + 1))}
        </div>
      );
    }

    const selected = activeTab?.kind === 'request' && activeTab.nodeId === node.id;
    return (
      <div
        key={node.id}
        className={`tree-row ${selected ? 'selected' : ''}`}
        style={{ paddingLeft: 12 + depth * 14 }}
        draggable
        onDragStart={(e) => {
          e.stopPropagation();
          setDragInfo({ colId, nodeId: node.id });
        }}
        onClick={() => openRequestTab(colId, node.id)}
      >
        <span className={`method-tag m-${node.request.method}`}>{node.request.method}</span>
        <span className="tree-name">{node.name}</span>
        <div className="tree-actions" onClick={(e) => e.stopPropagation()}>
          <button
            className="icon-btn"
            title="Renombrar"
            onClick={() => {
              const name = window.prompt('Nuevo nombre:', node.name);
              if (name?.trim()) updateItem(colId, node.id, (it) => ({ ...it, name: name.trim() }));
            }}
          >
            ✎
          </button>
          <button className="icon-btn" title="Duplicar" onClick={() => duplicateNode(colId, node.id)}>⧉</button>
          <button className="icon-btn danger" title="Eliminar" onClick={() => deleteNode(colId, node.id)}>×</button>
        </div>
      </div>
    );
  };

  return (
    <aside className="sidebar">
      <div className="sidebar-tabs">
        <button className={sideTab === 'collections' ? 'active' : ''} onClick={() => setSideTab('collections')}>
          Colecciones
        </button>
        <button className={sideTab === 'environments' ? 'active' : ''} onClick={() => setSideTab('environments')}>
          Ambientes
        </button>
        <button className={sideTab === 'history' ? 'active' : ''} onClick={() => setSideTab('history')}>
          Historial
        </button>
      </div>

      {sideTab === 'collections' && (
        <>
          <div className="sidebar-toolbar">
            <input placeholder="Filtrar requests..." value={filter} onChange={(e) => setFilter(e.target.value)} />
            <button className="secondary icon-btn" onClick={() => createCollection()} title="Nueva colección">+</button>
          </div>
          <div className="sidebar-list">
            {collectionOrder.map((cid) => {
              const col = collections[cid];
              if (!col) return null;
              const open = isOpen(cid);
              return (
                <div key={cid} style={{ marginBottom: 6 }}>
                  <div
                    className={`tree-row ${activeTab?.kind === 'container' && activeTab.collectionId === cid && !activeTab.nodeId ? 'selected' : ''}`}
                    style={{ fontWeight: 600 }}
                    onDragOver={(e) => e.preventDefault()}
                    onDrop={(e) => {
                      e.preventDefault();
                      if (dragInfo && dragInfo.colId === cid) moveCollectionNode(cid, dragInfo.nodeId, null);
                      setDragInfo(null);
                    }}
                    onClick={() => toggle(cid)}
                    onDoubleClick={() => openContainerTab(cid)}
                  >
                    <span style={{ width: 14, color: 'var(--text-muted)' }}>{open ? '▾' : '▸'}</span>
                    <span className="tree-name">{col.info.name}</span>
                    <div className="tree-actions" onClick={(e) => e.stopPropagation()}>
                      <button className="icon-btn" title="Ejecutar colección (Runner)" onClick={() => openRunnerTab(cid)}>▶</button>
                      <button className="icon-btn" title="Nuevo request" onClick={() => addRequest(cid, null)}>+R</button>
                      <button className="icon-btn" title="Nueva carpeta" onClick={() => addFolder(cid, null)}>+C</button>
                      <button className="icon-btn" title="Editar colección" onClick={() => openContainerTab(cid)}>⚙</button>
                      <button className="icon-btn" title="Exportar JSON" onClick={() => handleExportCollection(col)}>⤓</button>
                      <button
                        className="icon-btn"
                        title="Renombrar"
                        onClick={() => {
                          const name = window.prompt('Nombre de la colección:', col.info.name);
                          if (name?.trim()) renameCollection(cid, name.trim());
                        }}
                      >
                        ✎
                      </button>
                      <button
                        className="icon-btn danger"
                        title="Eliminar colección"
                        onClick={() => {
                          if (window.confirm(`¿Eliminar la colección "${col.info.name}"?`)) void deleteCollection(cid);
                        }}
                      >
                        ×
                      </button>
                    </div>
                  </div>
                  {open && col.item.map((node) => renderNode(cid, node, 1))}
                </div>
              );
            })}
            {collectionOrder.length === 0 && (
              <div className="empty-state" style={{ height: 'auto', marginTop: 24 }}>
                <div>Sin colecciones todavía.</div>
                <div style={{ display: 'flex', gap: 6 }}>
                  <button className="secondary" onClick={() => setImportOpen(true)}>Importar Postman</button>
                  <button className="secondary" onClick={() => createCollection()}>Crear nueva</button>
                </div>
              </div>
            )}
          </div>
        </>
      )}

      {sideTab === 'environments' && (
        <>
          <div className="sidebar-toolbar">
            <button className="secondary" style={{ flex: 1, justifyContent: 'center' }} onClick={() => createEnvironment()}>
              + Nuevo ambiente
            </button>
          </div>
          <div className="sidebar-list">
            {environmentOrder.map((id) => {
              const env = environments[id];
              if (!env) return null;
              const isAct = activeEnvId === id;
              return (
                <div key={id} className={`tree-row ${activeTab?.nodeId === id ? 'selected' : ''}`} onClick={() => openEnvironmentTab(id)}>
                  <span
                    style={{ color: isAct ? 'var(--green)' : 'var(--text-muted)' }}
                    title={isAct ? 'Ambiente activo' : 'Activar ambiente'}
                    onClick={(e) => {
                      e.stopPropagation();
                      setActiveEnv(isAct ? null : id);
                    }}
                  >
                    {isAct ? '●' : '○'}
                  </span>
                  <span className="tree-name">{env.name}</span>
                  <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>{env.values.length}</span>
                  <div className="tree-actions" onClick={(e) => e.stopPropagation()}>
                    <button
                      className="icon-btn danger"
                      title="Eliminar ambiente"
                      onClick={() => {
                        if (window.confirm(`¿Eliminar el ambiente "${env.name}"?`)) void deleteEnvironment(id);
                      }}
                    >
                      ×
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </>
      )}

      {sideTab === 'history' && (
        <>
          <div className="sidebar-toolbar">
            <span style={{ flex: 1, color: 'var(--text-muted)', fontSize: 12 }}>Últimos {history.length} envíos</span>
            <button className="secondary icon-btn" onClick={() => clearHistory()}>Limpiar</button>
          </div>
          <div className="sidebar-list">
            {history.map((h) => (
              <div
                key={h.id}
                className="tree-row"
                style={{ alignItems: 'flex-start', flexDirection: 'column', gap: 2, padding: '6px 8px' }}
                onClick={() => openScratchTab(h.item)}
              >
                <div style={{ display: 'flex', width: '100%', gap: 6, alignItems: 'center' }}>
                  <span className={`method-tag m-${h.method}`}>{h.method}</span>
                  <span className="tree-name" style={{ fontWeight: 600 }}>{h.name}</span>
                  {h.status && <span className={`badge ${h.status < 400 ? 'ok' : 'err'}`}>{h.status}</span>}
                </div>
                <div className="mono" style={{ fontSize: 11, color: 'var(--text-muted)', width: '100%', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {h.url}
                </div>
              </div>
            ))}
          </div>
        </>
      )}
    </aside>
  );
}
