import { useAppStore } from '../store/appStore';

export function TopBar() {
  const {
    environments,
    environmentOrder,
    activeEnvId,
    setActiveEnv,
    settings,
    setTheme,
    setImportOpen,
    setSettingsOpen,
    setQuickLookOpen,
    openScratchTab,
    consoleOpen,
    setConsoleOpen,
    consoleLogs,
  } = useAppStore();

  const proxyMode = settings.network.proxy.mode;
  const proxyLabel =
    proxyMode === 'manual'
      ? `Manual (${settings.network.proxy.httpHost || '?'}:${settings.network.proxy.httpPort})`
      : proxyMode === 'system'
        ? 'Sistema'
        : 'Sin proxy';

  return (
    <header className="topbar">
      <div className="topbar-group">
        <div className="brand">
          <span className="brand-dot" />
          <span>FerrURL</span>
        </div>
        <button className="secondary" onClick={() => openScratchTab()} title="Nuevo request rápido">
          + Request
        </button>
        <button className="secondary" onClick={() => setImportOpen(true)}>
          Importar
        </button>
      </div>

      <div className="topbar-group">
        <label style={{ color: 'var(--text-muted)', fontSize: 12 }}>Ambiente:</label>
        <select
          aria-label="Ambiente activo"
          value={activeEnvId ?? ''}
          onChange={(e) => setActiveEnv(e.target.value || null)}
          style={{ minWidth: 190 }}
        >
          <option value="">Sin ambiente</option>
          {environmentOrder.map((id) => (
            <option key={id} value={id}>
              {environments[id]?.name}
            </option>
          ))}
        </select>
        <button className="secondary icon-btn" onClick={() => setQuickLookOpen(true)} title="Ver variables efectivas (Quick Look)">
          👁
        </button>
        <button
          className="secondary"
          onClick={() => setSettingsOpen(true)}
          title="Configuración de proxy y TLS"
        >
          <span style={{ color: proxyMode === 'off' ? 'var(--text-muted)' : 'var(--green)' }}>●</span>
          Proxy: {proxyLabel}
        </button>
        <button
          className="secondary icon-btn"
          onClick={() => setConsoleOpen(!consoleOpen)}
          title="Consola de red y scripts"
        >
          Consola ({consoleLogs.length})
        </button>
        <button
          className="secondary icon-btn"
          onClick={() => setTheme(settings.theme === 'dark' ? 'light' : 'dark')}
          title="Cambiar tema claro/oscuro"
        >
          {settings.theme === 'dark' ? '☀' : '🌙'}
        </button>
      </div>
    </header>
  );
}
