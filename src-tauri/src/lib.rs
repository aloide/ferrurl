pub mod http;
pub mod secrets;
pub mod storage;

use serde::Serialize;
use tauri::{Manager, State};

use http::{HttpEngine, HttpError, NetworkConfig, WireRequest, WireResponse};
use secrets::Secrets;
use storage::Storage;

pub struct AppState {
    pub http: HttpEngine,
    pub storage: Storage,
    pub secrets: Secrets,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct AppInfo {
    version: String,
    data_dir: String,
    portable: bool,
    secrets_backend: String,
}

#[tauri::command]
async fn send_request(state: State<'_, AppState>, req: WireRequest) -> Result<WireResponse, HttpError> {
    state.http.send(req).await
}

#[tauri::command]
async fn cancel_request(state: State<'_, AppState>, id: String) -> Result<bool, ()> {
    Ok(state.http.cancel(&id).await)
}

#[tauri::command]
async fn set_network_config(state: State<'_, AppState>, config: NetworkConfig) -> Result<(), HttpError> {
    state.http.set_config(config).await
}

#[tauri::command]
fn app_info(state: State<'_, AppState>) -> AppInfo {
    AppInfo {
        version: env!("CARGO_PKG_VERSION").into(),
        data_dir: state.storage.root.display().to_string(),
        portable: state.storage.portable,
        secrets_backend: state.secrets.backend().into(),
    }
}

#[tauri::command]
fn storage_read(state: State<'_, AppState>, path: String) -> Result<Option<String>, String> {
    state.storage.read(&path)
}

#[tauri::command]
fn storage_write(state: State<'_, AppState>, path: String, content: String) -> Result<(), String> {
    state.storage.write(&path, &content)
}

#[tauri::command]
fn storage_delete(state: State<'_, AppState>, path: String) -> Result<(), String> {
    state.storage.delete(&path)
}

#[tauri::command]
fn storage_list(state: State<'_, AppState>, dir: String) -> Result<Vec<String>, String> {
    state.storage.list(&dir)
}

#[tauri::command]
fn secret_get(state: State<'_, AppState>, key: String) -> Result<Option<String>, String> {
    state.secrets.get(&key)
}

#[tauri::command]
fn secret_set(state: State<'_, AppState>, key: String, value: String) -> Result<(), String> {
    state.secrets.set(&key, &value)
}

#[tauri::command]
fn secret_delete(state: State<'_, AppState>, key: String) -> Result<(), String> {
    state.secrets.delete(&key)
}

/// Lectura de archivos elegidos por el usuario (importar colecciones, data files, CA).
#[tauri::command]
fn fs_read_text(path: String) -> Result<String, String> {
    std::fs::read_to_string(&path).map_err(|e| format!("{path}: {e}"))
}

/// Escritura de archivos elegidos por el usuario (exportar colecciones, resultados).
#[tauri::command]
fn fs_write_text(path: String, content: String) -> Result<(), String> {
    storage::write_atomic(std::path::Path::new(&path), &content)
}

#[tauri::command]
fn fs_write_base64(path: String, data: String) -> Result<(), String> {
    use base64::Engine;
    let bytes = base64::engine::general_purpose::STANDARD.decode(data).map_err(|e| e.to_string())?;
    std::fs::write(&path, bytes).map_err(|e| format!("{path}: {e}"))
}

// --- Modo de ejecucion automatica (pruebas E2E) -----------------------------
// Si FERRURL_AUTORUN apunta a un JSON, el frontend importa la coleccion/ambiente,
// ejecuta el runner con el motor real (worker + Rust + proxy) y escribe los resultados.

#[tauri::command]
fn autorun_config() -> Result<Option<String>, String> {
    match std::env::var("FERRURL_AUTORUN") {
        Ok(p) if !p.trim().is_empty() => std::fs::read_to_string(&p).map(Some).map_err(|e| format!("{p}: {e}")),
        _ => Ok(None),
    }
}

#[tauri::command]
fn autorun_finish(app: tauri::AppHandle, output: String, content: String, exit_code: i32) -> Result<(), String> {
    storage::write_atomic(std::path::Path::new(&output), &content)?;
    app.exit(exit_code);
    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .setup(|app| {
            let app_data = app.path().app_data_dir().unwrap_or_else(|_| std::env::temp_dir().join("ferrurl"));
            let storage = Storage::resolve(app_data);
            std::fs::create_dir_all(&storage.root).ok();
            let secrets = Secrets::new(storage.clone());
            app.manage(AppState { http: HttpEngine::default(), storage, secrets });
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            send_request,
            cancel_request,
            set_network_config,
            app_info,
            storage_read,
            storage_write,
            storage_delete,
            storage_list,
            secret_get,
            secret_set,
            secret_delete,
            fs_read_text,
            fs_write_text,
            fs_write_base64,
            autorun_config,
            autorun_finish
        ])
        .run(tauri::generate_context!())
        .expect("error al iniciar FerrURL");
}
