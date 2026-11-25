import { useAppStore } from '../store/appStore';

export function TabBar() {
  const { tabs, activeTabId, setActiveTab, closeTab, openScratchTab } = useAppStore();

  return (
    <div className="tabbar">
      {tabs.map((tab) => {
        const active = tab.id === activeTabId;
        return (
          <div
            key={tab.id}
            className={`tab ${active ? 'active' : ''}`}
            onClick={() => setActiveTab(tab.id)}
            title={tab.title}
          >
            {tab.kind === 'request' && tab.method && (
              <span className={`method-tag m-${tab.method}`}>{tab.method}</span>
            )}
            {tab.kind === 'environment' && <span>🌐</span>}
            {tab.kind === 'runner' && <span>▶</span>}
            {tab.kind === 'container' && <span>📁</span>}
            <span className="tab-title">{tab.title}</span>
            {tab.dirty && <span style={{ color: 'var(--accent)' }}>●</span>}
            <button
              className="icon-btn"
              onClick={(e) => {
                e.stopPropagation();
                closeTab(tab.id);
              }}
              title="Cerrar pestaña (Ctrl+W)"
            >
              ×
            </button>
          </div>
        );
      })}
      <button className="icon-btn" style={{ margin: '0 6px' }} onClick={() => openScratchTab()} title="Nueva pestaña">
        +
      </button>
    </div>
  );
}
