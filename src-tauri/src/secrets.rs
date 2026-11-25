//! Secretos en el Administrador de credenciales de Windows (keyring).
//! Si el almacen del sistema no esta disponible, se usa un archivo local como respaldo.

use std::collections::HashMap;
use std::sync::Mutex;

use crate::storage::Storage;

const SERVICE: &str = "FerrURL";
const FALLBACK_FILE: &str = "secrets.fallback.json";

pub struct Secrets {
    storage: Storage,
    /// En modo portable los secretos viajan con la carpeta `data` (no en el equipo).
    use_file: bool,
    lock: Mutex<()>,
}

impl Secrets {
    pub fn new(storage: Storage) -> Self {
        let use_file = storage.portable || std::env::var("FERRURL_SECRETS_FILE").is_ok();
        Self { storage, use_file, lock: Mutex::new(()) }
    }

    pub fn backend(&self) -> &'static str {
        if self.use_file {
            "archivo"
        } else {
            "credential-manager"
        }
    }

    fn file_map(&self) -> HashMap<String, String> {
        self.storage
            .read(FALLBACK_FILE)
            .ok()
            .flatten()
            .and_then(|s| serde_json::from_str(&s).ok())
            .unwrap_or_default()
    }

    fn save_map(&self, m: &HashMap<String, String>) -> Result<(), String> {
        self.storage.write(FALLBACK_FILE, &serde_json::to_string_pretty(m).unwrap())
    }

    pub fn get(&self, key: &str) -> Result<Option<String>, String> {
        let _g = self.lock.lock().unwrap();
        if !self.use_file {
            match keyring::Entry::new(SERVICE, key).and_then(|e| e.get_password()) {
                Ok(v) => return Ok(Some(v)),
                Err(keyring::Error::NoEntry) => {}
                Err(_) => {}
            }
        }
        Ok(self.file_map().get(key).cloned())
    }

    pub fn set(&self, key: &str, value: &str) -> Result<(), String> {
        let _g = self.lock.lock().unwrap();
        if !self.use_file {
            if value.is_empty() {
                let _ = keyring::Entry::new(SERVICE, key).and_then(|e| e.delete_credential());
                return Ok(());
            }
            match keyring::Entry::new(SERVICE, key).and_then(|e| e.set_password(value)) {
                Ok(_) => return Ok(()),
                Err(e) => eprintln!("keyring no disponible ({e}); usando archivo"),
            }
        }
        let mut m = self.file_map();
        if value.is_empty() {
            m.remove(key);
        } else {
            m.insert(key.to_string(), value.to_string());
        }
        self.save_map(&m)
    }

    pub fn delete(&self, key: &str) -> Result<(), String> {
        self.set(key, "")
    }
}
