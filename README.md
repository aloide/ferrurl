# FerrURL

Cliente HTTP de escritorio construido con **Tauri 2 + Rust + React/TypeScript**, compatible con colecciones y ambientes de **Postman v2.0 / v2.1** y pensado para correr suites de pruebas detrás de un **proxy corporativo**.

## Características principales

- **Proxy corporativo en Rust (`reqwest` + `native-tls`)**:
  - Modos: `Sin proxy`, `Sistema (HTTP_PROXY / Windows)` y `Manual` (HTTP/HTTPS, usuario y contraseña Basic en Windows Credential Manager, lista de bypass).
  - Botón **Probar proxy** para diagnosticar `407`, timeouts o certificados TLS.
  - Todo el tráfico HTTP —incluido `pm.sendRequest(...)` dentro de los scripts— pasa por Rust y respeta el proxy.
  - Soporte para CA corporativa (`.pem` / `.crt` / `.der`) y opción de desactivar verificación SSL (global o por request).
- **Compatibilidad Postman v2.1**:
  - Importación y exportación lossless de colecciones y ambientes.
  - Jerarquía `Colección -> Carpeta -> Request` con herencia de `Authorization` (`Basic`, `Bearer`, `API Key`) y ejecución encadenada de scripts `pre-request` y `test`.
  - Variables por orden de prioridad: `local (pm.variables)` > `data` > `environment` > `collection` > `globals`, más variables dinámicas (`{{$guid}}`, `{{$timestamp}}`, `{{$isoTimestamp}}`, etc.).
  - Variables tipo `secret` editables inline estilo Postman (con botón `👁`), almacenadas en el **Administrador de credenciales de Windows** (`keyring`).
- **Sandbox de scripts `pm.*` en Web Worker aislado**:
  - `pm.test` (síncrono y asíncrono), `pm.expect` (Chai real con aserciones `pm.response.to.have.status`, `jsonBody`, `header`, etc.), `CryptoJS`, `lodash (_)`, `xml2Json`, `pm.sendRequest` (incluyendo ráfagas paralelas).
- **Herramientas**:
  - Runner por colección o carpeta con iteraciones, archivo de datos CSV/JSON, aviso previo en carpetas marcadas para ejecución separada, filtros y exportación de reporte JSON / HTML.
  - Pestañas múltiples, historial, consola de tráfico real, y generador de código **cURL** (Bash, PowerShell y CMD) con proxy incluido.

## Desarrollo y pruebas

```powershell
pnpm install
pnpm test         # Tests unitarios (colecciones, variables, auth, sandbox pm.*)
pnpm test:rust    # Tests unitarios e integración de Rust (proxy + 407 + storage)
pnpm mock:proxy   # Levanta un proxy HTTP local en :3128 para pruebas en dev
pnpm tauri dev    # App en modo desarrollo
```

## Build y distribución (Windows)

```powershell
pnpm tauri build  # Genera instaladores NSIS/MSI en src-tauri/target/release/bundle/
pnpm portable     # Empaqueta la versión portable sin admin en dist-portable/FerrURL-portable/
```
