//! Persistencia en disco (AppData o carpeta portable) con escritura atomica.

use std::path::{Component, Path, PathBuf};

#[derive(Debug, Clone)]
pub struct Storage {
    pub root: PathBuf,
    pub portable: bool,
}

impl Storage {
    /// Modo portable si existe `portable.flag` o una carpeta `data` junto al ejecutable.
    pub fn resolve(app_data: PathBuf) -> Self {
        if let Ok(exe) = std::env::current_exe() {
            if let Some(dir) = exe.parent() {
                if dir.join("portable.flag").exists() || dir.join("data").is_dir() {
                    return Self { root: dir.join("data"), portable: true };
                }
            }
        }
        if let Ok(custom) = std::env::var("FERRURL_DATA_DIR") {
            if !custom.trim().is_empty() {
                return Self { root: PathBuf::from(custom), portable: false };
            }
        }
        Self { root: app_data, portable: false }
    }

    /// Resuelve una ruta relativa dentro del directorio de datos, rechazando `..` y rutas absolutas.
    pub fn path(&self, rel: &str) -> Result<PathBuf, String> {
        let p = Path::new(rel);
        if p.is_absolute() {
            return Err("ruta absoluta no permitida".into());
        }
        for c in p.components() {
            match c {
                Component::Normal(_) | Component::CurDir => {}
                _ => return Err(format!("ruta no permitida: {rel}")),
            }
        }
        Ok(self.root.join(p))
    }

    pub fn read(&self, rel: &str) -> Result<Option<String>, String> {
        let p = self.path(rel)?;
        match std::fs::read_to_string(&p) {
            Ok(s) => Ok(Some(s)),
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(None),
            Err(e) => Err(format!("{}: {e}", p.display())),
        }
    }

    pub fn write(&self, rel: &str, content: &str) -> Result<(), String> {
        let p = self.path(rel)?;
        write_atomic(&p, content)
    }

    pub fn delete(&self, rel: &str) -> Result<(), String> {
        let p = self.path(rel)?;
        match std::fs::remove_file(&p) {
            Ok(_) => Ok(()),
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(()),
            Err(e) => Err(e.to_string()),
        }
    }

    pub fn list(&self, rel_dir: &str) -> Result<Vec<String>, String> {
        let p = self.path(rel_dir)?;
        let mut out = vec![];
        match std::fs::read_dir(&p) {
            Ok(rd) => {
                for e in rd.flatten() {
                    if e.path().is_file() {
                        out.push(e.file_name().to_string_lossy().to_string());
                    }
                }
            }
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => {}
            Err(e) => return Err(e.to_string()),
        }
        out.sort();
        Ok(out)
    }
}

pub fn write_atomic(p: &Path, content: &str) -> Result<(), String> {
    if let Some(dir) = p.parent() {
        std::fs::create_dir_all(dir).map_err(|e| format!("{}: {e}", dir.display()))?;
    }
    let tmp = p.with_extension(format!(
        "{}.tmp",
        p.extension().map(|e| e.to_string_lossy().to_string()).unwrap_or_default()
    ));
    std::fs::write(&tmp, content).map_err(|e| format!("{}: {e}", tmp.display()))?;
    std::fs::rename(&tmp, p).map_err(|e| format!("{}: {e}", p.display()))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rejects_traversal_and_roundtrips() {
        let dir = std::env::temp_dir().join(format!("ferrurl-test-{}", std::process::id()));
        let s = Storage { root: dir.clone(), portable: false };
        assert!(s.path("../x").is_err());
        assert!(s.path("C:\\x").is_err() || cfg!(not(windows)));
        s.write("collections/a.json", "{\"a\":1}").unwrap();
        assert_eq!(s.read("collections/a.json").unwrap().unwrap(), "{\"a\":1}");
        assert_eq!(s.list("collections").unwrap(), vec!["a.json".to_string()]);
        s.delete("collections/a.json").unwrap();
        assert!(s.read("collections/a.json").unwrap().is_none());
        let _ = std::fs::remove_dir_all(dir);
    }
}
