import { useEffect, useState } from 'react';
import { ConsoleDrawer } from './components/ConsoleDrawer';
import { ContainerEditor } from './components/ContainerEditor';
import { EnvironmentEditor } from './components/EnvironmentEditor';
import { CurlModal } from './components/modals/CurlModal';
import { ImportModal } from './components/modals/ImportModal';
import { QuickLookModal } from './components/modals/QuickLookModal';
import { SettingsModal } from './components/modals/SettingsModal';
import { RequestEditor } from './components/request/RequestEditor';
import { RunnerView } from './components/RunnerView';
import { Sidebar } from './components/Sidebar';
import { TabBar } from './components/TabBar';
import { TopBar } from './components/TopBar';
import { useAppStore } from './store/appStore';

export function App() {
  const [curlTabId, setCurlTabId] = useState<string | null>(null);
  const {
    ready,
    init,
    tabs,
    activeTabId,
    consoleOpen,
    settingsOpen,
    importOpen,
    quickLookOpen,
    sendTabRequest,
    saveTab,
    closeTab,
    openScratchTab,
    setImportOpen,
    setSettingsOpen,
    createCollection,
  } = useAppStore();

  useEffect(() => {
    void init();
  }, [init]);

  // Atajos de teclado globales (Ctrl+Enter, Ctrl+S, Ctrl+W)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!e.ctrlKey && !e.metaKey) return;
      const tab = useAppStore.getState().tabs.find((t) => t.id === useAppStore.getState().activeTabId);
      if (!tab) return;
      if (e.key === 'Enter' && tab.kind === 'request') {
        e.preventDefault();
        void sendTabRequest(tab.id);
      } else if (e.key.toLowerCase() === 's') {
        e.preventDefault();
        void saveTab(tab.id);
      } else if (e.key.toLowerCase() === 'w') {
        e.preventDefault();
        closeTab(tab.id);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [sendTabRequest, saveTab, closeTab]);

  if (!ready) {
    return <div className="empty-state">Iniciando FerrURL…</div>;
  }

  const activeTab = tabs.find((t) => t.id === activeTabId) ?? null;
  const curlTab = curlTabId ? tabs.find((t) => t.id === curlTabId) ?? null : null;

  return (
    <div className="app-shell">
      <TopBar />

      <div className="workspace-body">
        <Sidebar />

        <main className="main-area">
          <TabBar />

          <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
            {!activeTab && (
              <div className="empty-state">
                <div style={{ fontSize: 18, fontWeight: 700, color: 'var(--text)' }}>Bienvenido a FerrURL</div>
                <div>Cliente HTTP de escritorio compatible con colecciones y ambientes de Postman v2.1.</div>
                <div style={{ display: 'flex', gap: 8, marginTop: 6 }}>
                  <button className="primary" onClick={() => setImportOpen(true)}>Importar colección / ambiente</button>
                  <button className="secondary" onClick={() => openScratchTab()}>Nuevo request rápido</button>
                  <button className="secondary" onClick={() => createCollection()}>Nueva colección</button>
                  <button className="secondary" onClick={() => setSettingsOpen(true)}>Configurar Proxy</button>
                </div>
              </div>
            )}

            {activeTab?.kind === 'request' && (
              <RequestEditor tab={activeTab} onOpenCurl={() => setCurlTabId(activeTab.id)} />
            )}
            {activeTab?.kind === 'container' && <ContainerEditor tab={activeTab} />}
            {activeTab?.kind === 'environment' && <EnvironmentEditor tab={activeTab} />}
            {activeTab?.kind === 'runner' && <RunnerView tab={activeTab} />}
          </div>

          {consoleOpen && <ConsoleDrawer />}
        </main>
      </div>

      {settingsOpen && <SettingsModal />}
      {importOpen && <ImportModal />}
      {quickLookOpen && <QuickLookModal />}
      {curlTab && <CurlModal tab={curlTab} onClose={() => setCurlTabId(null)} />}
    </div>
  );
}

export default App;
