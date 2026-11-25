//! Motor HTTP de FerrURL: todo el trafico (incluido pm.sendRequest) pasa por aca,
//! asi siempre respeta la configuracion de proxy y TLS.

use std::{
    collections::HashMap,
    time::{Duration, Instant},
};

use base64::{engine::general_purpose::STANDARD as B64, Engine};
use reqwest::{
    header::{HeaderMap, HeaderName, HeaderValue, CONTENT_TYPE},
    redirect::Policy,
    Certificate, Client, Method, NoProxy, Proxy,
};
use serde::{Deserialize, Serialize};
use tokio::sync::{Mutex, RwLock};

// ---------------------------------------------------------------------------
// Configuracion de red
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq, Hash, Default)]
#[serde(rename_all = "lowercase")]
pub enum ProxyMode {
    #[default]
    Off,
    System,
    Manual,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default, PartialEq)]
#[serde(rename_all = "camelCase", default)]
pub struct ProxyConfig {
    pub mode: ProxyMode,
    pub http_host: String,
    pub http_port: u16,
    /// Si esta vacio se usa el mismo proxy que para HTTP.
    pub https_host: String,
    pub https_port: u16,
    pub username: String,
    pub password: String,
    /// Lista separada por comas: "localhost, 127.0.0.1, .interno.local"
    pub bypass: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", default)]
pub struct TlsConfig {
    pub verify: bool,
    pub extra_ca_paths: Vec<String>,
}

impl Default for TlsConfig {
    fn default() -> Self {
        Self { verify: true, extra_ca_paths: vec![] }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, Default, PartialEq)]
#[serde(rename_all = "camelCase", default)]
pub struct NetworkConfig {
    pub proxy: ProxyConfig,
    pub tls: TlsConfig,
}

// ---------------------------------------------------------------------------
// Request / Response que viajan por IPC
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase", tag = "type")]
pub enum FormPart {
    Text { key: String, value: String, content_type: Option<String> },
    File { key: String, path: String, content_type: Option<String> },
}

#[derive(Debug, Clone, Deserialize, Default)]
#[serde(rename_all = "camelCase", tag = "type")]
pub enum WireBody {
    #[default]
    None,
    Text { text: String },
    Base64 { data: String },
    File { path: String },
    Urlencoded { fields: Vec<(String, String)> },
    Form { parts: Vec<FormPart> },
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct RequestSettings {
    pub timeout_ms: u64,
    pub follow_redirects: bool,
    pub max_redirects: u32,
    pub use_proxy: bool,
    pub verify_tls: bool,
}

impl Default for RequestSettings {
    fn default() -> Self {
        Self { timeout_ms: 0, follow_redirects: true, max_redirects: 10, use_proxy: true, verify_tls: true }
    }
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WireRequest {
    #[serde(default)]
    pub id: String,
    pub method: String,
    pub url: String,
    #[serde(default)]
    pub headers: Vec<(String, String)>,
    #[serde(default)]
    pub body: WireBody,
    #[serde(default)]
    pub settings: RequestSettings,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SentRequest {
    pub method: String,
    pub url: String,
    pub headers: Vec<(String, String)>,
    pub body_size: u64,
    pub proxy: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WireResponse {
    pub status: u16,
    pub status_text: String,
    pub headers: Vec<(String, String)>,
    pub body_base64: String,
    pub time_ms: u64,
    pub body_size: u64,
    pub headers_size: u64,
    pub http_version: String,
    pub remote_addr: Option<String>,
    pub final_url: String,
    pub request: SentRequest,
}

// ---------------------------------------------------------------------------
// Errores
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Serialize, thiserror::Error, PartialEq)]
#[serde(rename_all = "camelCase", tag = "kind", content = "message")]
pub enum HttpError {
    #[error("URL invalida: {0}")]
    InvalidUrl(String),
    #[error("Request invalido: {0}")]
    InvalidRequest(String),
    #[error("El proxy requiere autenticacion (407). Revisa usuario y clave del proxy. {0}")]
    ProxyAuthRequired(String),
    #[error("No se pudo conectar con el proxy: {0}")]
    ProxyConnect(String),
    #[error("No se pudo resolver el nombre (DNS): {0}")]
    Dns(String),
    #[error("Error TLS/SSL: {0}")]
    Tls(String),
    #[error("Tiempo de espera agotado: {0}")]
    Timeout(String),
    #[error("Conexion rechazada: {0}")]
    ConnectionRefused(String),
    #[error("Error de conexion: {0}")]
    Connect(String),
    #[error("Request cancelado")]
    Cancelled(String),
    #[error("Configuracion invalida: {0}")]
    Config(String),
    #[error("{0}")]
    Other(String),
}

fn error_chain(e: &(dyn std::error::Error + 'static)) -> String {
    let mut parts = vec![e.to_string()];
    let mut cur = e.source();
    while let Some(s) = cur {
        let t = s.to_string();
        if !parts.contains(&t) {
            parts.push(t);
        }
        cur = s.source();
    }
    parts.join(": ")
}

pub fn classify(e: &reqwest::Error, via_proxy: bool) -> HttpError {
    let msg = error_chain(e);
    let low = msg.to_lowercase();
    if e.is_timeout() || low.contains("timed out") || low.contains("deadline") {
        return HttpError::Timeout(msg);
    }
    if low.contains("407") || low.contains("proxy authentication") || low.contains("proxy authorization") {
        return HttpError::ProxyAuthRequired(msg);
    }
    if low.contains("certificate") || low.contains("tls") || low.contains("ssl") || low.contains("schannel") || low.contains("handshake") {
        return HttpError::Tls(msg);
    }
    if low.contains("dns") || low.contains("lookup") || low.contains("no such host") || low.contains("nodename") || low.contains("name or service") {
        return HttpError::Dns(msg);
    }
    if e.is_connect() && via_proxy {
        if low.contains("refused") || low.contains("10061") {
            return HttpError::ProxyConnect(msg);
        }
        if low.contains("tunnel") || low.contains("proxy") {
            return HttpError::ProxyConnect(msg);
        }
    }
    if low.contains("refused") || low.contains("10061") {
        return HttpError::ConnectionRefused(msg);
    }
    if e.is_connect() {
        return HttpError::Connect(msg);
    }
    if e.is_builder() {
        return HttpError::InvalidRequest(msg);
    }
    HttpError::Other(msg)
}

// ---------------------------------------------------------------------------
// Motor
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
struct ClientKey {
    follow: bool,
    max_redirects: u32,
    use_proxy: bool,
    verify: bool,
}

pub struct HttpEngine {
    config: RwLock<NetworkConfig>,
    clients: Mutex<HashMap<ClientKey, Client>>,
    inflight: Mutex<HashMap<String, tokio::task::AbortHandle>>,
}

impl Default for HttpEngine {
    fn default() -> Self {
        Self::new(NetworkConfig::default())
    }
}

fn split_host(input: &str, default_port: u16) -> Option<(String, u16)> {
    let t = input.trim();
    if t.is_empty() {
        return None;
    }
    let t = t.trim_start_matches("http://").trim_start_matches("https://").trim_end_matches('/');
    if let Some((h, p)) = t.rsplit_once(':') {
        if let Ok(port) = p.parse::<u16>() {
            return Some((h.to_string(), port));
        }
    }
    Some((t.to_string(), default_port))
}

pub fn proxy_url(host: &str, port: u16) -> Option<String> {
    split_host(host, if port == 0 { 8080 } else { port })
        .map(|(h, p)| format!("http://{}:{}", h, if port != 0 { port } else { p }))
}

/// Describe que proxy se usara para una URL (para la consola).
pub fn describe_proxy(cfg: &NetworkConfig, url: &url::Url, use_proxy: bool) -> Option<String> {
    if !use_proxy {
        return None;
    }
    match cfg.proxy.mode {
        ProxyMode::Off => None,
        ProxyMode::System => Some("sistema".into()),
        ProxyMode::Manual => {
            let host = url.host_str().unwrap_or("");
            if is_bypassed(&cfg.proxy.bypass, host) {
                return None;
            }
            let p = &cfg.proxy;
            if url.scheme() == "https" && !p.https_host.trim().is_empty() {
                proxy_url(&p.https_host, p.https_port)
            } else {
                proxy_url(&p.http_host, p.http_port)
            }
        }
    }
}

pub fn is_bypassed(bypass: &str, host: &str) -> bool {
    let host = host.to_lowercase();
    bypass
        .split([',', ';', ' ', '\n'])
        .map(|s| s.trim().to_lowercase())
        .filter(|s| !s.is_empty())
        .any(|rule| {
            if rule == "*" {
                return true;
            }
            let r = rule.trim_start_matches("*.").trim_start_matches('.');
            host == r || host.ends_with(&format!(".{}", r))
        })
}

fn load_certificates(paths: &[String]) -> Result<Vec<Certificate>, HttpError> {
    let mut out = vec![];
    for p in paths.iter().filter(|p| !p.trim().is_empty()) {
        let data = std::fs::read(p).map_err(|e| HttpError::Config(format!("No se pudo leer el certificado {p}: {e}")))?;
        if data.windows(10).any(|w| w == b"-----BEGIN") {
            let certs = Certificate::from_pem_bundle(&data)
                .map_err(|e| HttpError::Config(format!("Certificado PEM invalido {p}: {e}")))?;
            out.extend(certs);
        } else {
            out.push(Certificate::from_der(&data).map_err(|e| HttpError::Config(format!("Certificado DER invalido {p}: {e}")))?);
        }
    }
    Ok(out)
}

fn build_client(cfg: &NetworkConfig, key: ClientKey) -> Result<Client, HttpError> {
    let mut b = Client::builder()
        .http1_title_case_headers()
        .redirect(if key.follow { Policy::limited(key.max_redirects as usize) } else { Policy::none() })
        .connect_timeout(Duration::from_secs(30))
        .danger_accept_invalid_certs(!key.verify)
        .danger_accept_invalid_hostnames(!key.verify)
        .gzip(true)
        .brotli(true)
        .deflate(true);

    for c in load_certificates(&cfg.tls.extra_ca_paths)? {
        b = b.add_root_certificate(c);
    }

    let mode = if key.use_proxy { cfg.proxy.mode } else { ProxyMode::Off };
    match mode {
        ProxyMode::Off => b = b.no_proxy(),
        ProxyMode::System => { /* reqwest lee HTTP(S)_PROXY / NO_PROXY y el proxy de Windows */ }
        ProxyMode::Manual => {
            let p = &cfg.proxy;
            let http = proxy_url(&p.http_host, p.http_port)
                .ok_or_else(|| HttpError::Config("Falta el host del proxy HTTP".into()))?;
            let https = if p.https_host.trim().is_empty() {
                http.clone()
            } else {
                proxy_url(&p.https_host, p.https_port).unwrap_or_else(|| http.clone())
            };
            let no_proxy = NoProxy::from_string(&p.bypass.replace([';', '\n'], ","));
            let mk = |u: &str, https_scheme: bool| -> Result<Proxy, HttpError> {
                let mut px = if https_scheme { Proxy::https(u) } else { Proxy::http(u) }
                    .map_err(|e| HttpError::Config(format!("Proxy invalido {u}: {e}")))?;
                if !p.username.is_empty() {
                    px = px.basic_auth(&p.username, &p.password);
                }
                Ok(px.no_proxy(no_proxy.clone()))
            };
            b = b.no_proxy().proxy(mk(&http, false)?).proxy(mk(&https, true)?);
        }
    }
    b.build().map_err(|e| HttpError::Config(error_chain(&e)))
}

fn normalize_url(raw: &str) -> Result<url::Url, HttpError> {
    let t = raw.trim();
    if t.is_empty() {
        return Err(HttpError::InvalidUrl("la URL esta vacia".into()));
    }
    let with_scheme = if t.contains("://") { t.to_string() } else { format!("http://{t}") };
    let u = url::Url::parse(&with_scheme).map_err(|e| HttpError::InvalidUrl(format!("{t}: {e}")))?;
    match u.scheme() {
        "http" | "https" => Ok(u),
        s => Err(HttpError::InvalidUrl(format!("esquema no soportado: {s}"))),
    }
}

fn reason(status: u16) -> String {
    reqwest::StatusCode::from_u16(status)
        .ok()
        .and_then(|s| s.canonical_reason())
        .unwrap_or("")
        .to_string()
}

impl HttpEngine {
    pub fn new(cfg: NetworkConfig) -> Self {
        Self { config: RwLock::new(cfg), clients: Mutex::new(HashMap::new()), inflight: Mutex::new(HashMap::new()) }
    }

    pub async fn config(&self) -> NetworkConfig {
        self.config.read().await.clone()
    }

    /// Valida y aplica una nueva configuracion de red. Descarta los clientes cacheados.
    pub async fn set_config(&self, cfg: NetworkConfig) -> Result<(), HttpError> {
        // valida construyendo un cliente de prueba
        build_client(&cfg, ClientKey { follow: true, max_redirects: 10, use_proxy: true, verify: cfg.tls.verify })?;
        *self.config.write().await = cfg;
        self.clients.lock().await.clear();
        Ok(())
    }

    async fn client(&self, key: ClientKey) -> Result<Client, HttpError> {
        let mut clients = self.clients.lock().await;
        if let Some(c) = clients.get(&key) {
            return Ok(c.clone());
        }
        let cfg = self.config.read().await.clone();
        let c = build_client(&cfg, key)?;
        clients.insert(key, c.clone());
        Ok(c)
    }

    pub async fn cancel(&self, id: &str) -> bool {
        if let Some(h) = self.inflight.lock().await.remove(id) {
            h.abort();
            true
        } else {
            false
        }
    }

    pub async fn send(&self, req: WireRequest) -> Result<WireResponse, HttpError> {
        let cfg = self.config.read().await.clone();
        let s = &req.settings;
        let key = ClientKey {
            follow: s.follow_redirects,
            max_redirects: s.max_redirects.max(1),
            use_proxy: s.use_proxy,
            verify: s.verify_tls && cfg.tls.verify,
        };
        let client = self.client(key).await?;
        let url = normalize_url(&req.url)?;
        let proxy_desc = describe_proxy(&cfg, &url, s.use_proxy);
        let method = Method::from_bytes(req.method.trim().to_uppercase().as_bytes())
            .map_err(|_| HttpError::InvalidRequest(format!("metodo invalido: {}", req.method)))?;

        let mut headers = HeaderMap::new();
        for (k, v) in &req.headers {
            if k.trim().is_empty() {
                continue;
            }
            let name = HeaderName::from_bytes(k.trim().as_bytes())
                .map_err(|_| HttpError::InvalidRequest(format!("nombre de header invalido: {k}")))?;
            let value = HeaderValue::from_bytes(v.as_bytes())
                .map_err(|_| HttpError::InvalidRequest(format!("valor de header invalido en {k}")))?;
            headers.append(name, value);
        }

        let mut rb = client.request(method.clone(), url.clone());
        if s.timeout_ms > 0 {
            rb = rb.timeout(Duration::from_millis(s.timeout_ms));
        }

        let mut body_size: u64 = 0;
        match req.body.clone() {
            WireBody::None => {}
            WireBody::Text { text } => {
                body_size = text.len() as u64;
                rb = rb.body(text);
            }
            WireBody::Base64 { data } => {
                let bytes = B64.decode(data).map_err(|e| HttpError::InvalidRequest(format!("body base64 invalido: {e}")))?;
                body_size = bytes.len() as u64;
                rb = rb.body(bytes);
            }
            WireBody::File { path } => {
                let bytes = tokio::fs::read(&path)
                    .await
                    .map_err(|e| HttpError::InvalidRequest(format!("no se pudo leer el archivo {path}: {e}")))?;
                body_size = bytes.len() as u64;
                if !headers.contains_key(CONTENT_TYPE) {
                    let mime = mime_guess::from_path(&path).first_or_octet_stream();
                    headers.insert(CONTENT_TYPE, HeaderValue::from_str(mime.as_ref()).unwrap());
                }
                rb = rb.body(bytes);
            }
            WireBody::Urlencoded { fields } => {
                let encoded = url::form_urlencoded::Serializer::new(String::new()).extend_pairs(fields.iter()).finish();
                body_size = encoded.len() as u64;
                if !headers.contains_key(CONTENT_TYPE) {
                    headers.insert(CONTENT_TYPE, HeaderValue::from_static("application/x-www-form-urlencoded"));
                }
                rb = rb.body(encoded);
            }
            WireBody::Form { parts } => {
                headers.remove(CONTENT_TYPE);
                let mut form = reqwest::multipart::Form::new();
                for part in parts {
                    match part {
                        FormPart::Text { key, value, content_type } => {
                            body_size += value.len() as u64;
                            let mut p = reqwest::multipart::Part::text(value);
                            if let Some(ct) = content_type.filter(|c| !c.is_empty()) {
                                p = p.mime_str(&ct).map_err(|e| HttpError::InvalidRequest(e.to_string()))?;
                            }
                            form = form.part(key, p);
                        }
                        FormPart::File { key, path, content_type } => {
                            let bytes = tokio::fs::read(&path)
                                .await
                                .map_err(|e| HttpError::InvalidRequest(format!("no se pudo leer el archivo {path}: {e}")))?;
                            body_size += bytes.len() as u64;
                            let name = std::path::Path::new(&path)
                                .file_name()
                                .map(|n| n.to_string_lossy().to_string())
                                .unwrap_or_else(|| "file".into());
                            let mime = content_type
                                .filter(|c| !c.is_empty())
                                .unwrap_or_else(|| mime_guess::from_path(&path).first_or_octet_stream().to_string());
                            let p = reqwest::multipart::Part::bytes(bytes)
                                .file_name(name)
                                .mime_str(&mime)
                                .map_err(|e| HttpError::InvalidRequest(e.to_string()))?;
                            form = form.part(key, p);
                        }
                    }
                }
                rb = rb.multipart(form);
            }
        }

        let request = rb.headers(headers).build().map_err(|e| classify(&e, proxy_desc.is_some()))?;
        let sent = SentRequest {
            method: method.to_string(),
            url: url.to_string(),
            headers: request
                .headers()
                .iter()
                .map(|(k, v)| (k.to_string(), String::from_utf8_lossy(v.as_bytes()).to_string()))
                .collect(),
            body_size,
            proxy: proxy_desc.clone(),
        };

        let via_proxy = proxy_desc.is_some();
        let fut = async move {
            let start = Instant::now();
            let resp = client.execute(request).await.map_err(|e| classify(&e, via_proxy))?;
            let status = resp.status().as_u16();
            let http_version = format!("{:?}", resp.version());
            let remote_addr = resp.remote_addr().map(|a| a.to_string());
            let final_url = resp.url().to_string();
            let headers: Vec<(String, String)> = resp
                .headers()
                .iter()
                .map(|(k, v)| (k.to_string(), String::from_utf8_lossy(v.as_bytes()).to_string()))
                .collect();
            let headers_size = headers.iter().map(|(k, v)| (k.len() + v.len() + 4) as u64).sum::<u64>();
            let bytes = resp.bytes().await.map_err(|e| classify(&e, via_proxy))?;
            let time_ms = start.elapsed().as_millis() as u64;
            Ok::<_, HttpError>(WireResponse {
                status,
                status_text: reason(status),
                body_size: bytes.len() as u64,
                body_base64: B64.encode(&bytes),
                headers,
                headers_size,
                time_ms,
                http_version,
                remote_addr,
                final_url,
                request: sent,
            })
        };

        let handle = tokio::spawn(fut);
        let id = req.id.clone();
        if !id.is_empty() {
            self.inflight.lock().await.insert(id.clone(), handle.abort_handle());
        }
        let res = handle.await;
        if !id.is_empty() {
            self.inflight.lock().await.remove(&id);
        }
        match res {
            Ok(r) => r,
            Err(e) if e.is_cancelled() => Err(HttpError::Cancelled("cancelado por el usuario".into())),
            Err(e) => Err(HttpError::Other(e.to_string())),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn bypass_rules() {
        assert!(is_bypassed("localhost, 127.0.0.1", "localhost"));
        assert!(is_bypassed("*.corp.local", "api.test.corp.local"));
        assert!(is_bypassed(".corp.local", "x.corp.local"));
        assert!(is_bypassed("corp.local", "corp.local"));
        assert!(!is_bypassed("corp.local", "notcorp.local"));
        assert!(!is_bypassed("", "localhost"));
        assert!(is_bypassed("*", "anything"));
    }

    #[test]
    fn proxy_url_parsing() {
        assert_eq!(proxy_url("proxy.corp", 3128).unwrap(), "http://proxy.corp:3128");
        assert_eq!(proxy_url("http://proxy.corp:8080", 0).unwrap(), "http://proxy.corp:8080");
        assert_eq!(proxy_url("proxy.corp:9000", 0).unwrap(), "http://proxy.corp:9000");
        assert!(proxy_url("  ", 80).is_none());
    }

    #[test]
    fn url_normalization() {
        assert_eq!(normalize_url("example.com/x").unwrap().as_str(), "http://example.com/x");
        assert!(normalize_url("").is_err());
        assert!(normalize_url("ftp://x").is_err());
    }

    #[test]
    fn manual_proxy_requires_host() {
        let cfg = NetworkConfig {
            proxy: ProxyConfig { mode: ProxyMode::Manual, ..Default::default() },
            ..Default::default()
        };
        let r = build_client(&cfg, ClientKey { follow: true, max_redirects: 5, use_proxy: true, verify: true });
        assert!(matches!(r, Err(HttpError::Config(_))));
    }

    #[test]
    fn describe_manual_proxy() {
        let cfg = NetworkConfig {
            proxy: ProxyConfig {
                mode: ProxyMode::Manual,
                http_host: "p".into(),
                http_port: 3128,
                https_host: "ps".into(),
                https_port: 3129,
                bypass: "localhost".into(),
                ..Default::default()
            },
            ..Default::default()
        };
        let u = url::Url::parse("http://api/x").unwrap();
        assert_eq!(describe_proxy(&cfg, &u, true).unwrap(), "http://p:3128");
        let u = url::Url::parse("https://api/x").unwrap();
        assert_eq!(describe_proxy(&cfg, &u, true).unwrap(), "http://ps:3129");
        let u = url::Url::parse("http://localhost/x").unwrap();
        assert!(describe_proxy(&cfg, &u, true).is_none());
        assert!(describe_proxy(&cfg, &url::Url::parse("http://a").unwrap(), false).is_none());
    }

    #[tokio::test]
    async fn sends_request_through_authenticated_proxy_and_handles_407() {
        use tokio::io::{AsyncReadExt, AsyncWriteExt};
        use tokio::net::TcpListener;

        // Servidor destino minimo
        let target = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let target_port = target.local_addr().unwrap().port();
        tokio::spawn(async move {
            while let Ok((mut sock, _)) = target.accept().await {
                tokio::spawn(async move {
                    let mut buf = [0u8; 2048];
                    let _ = sock.read(&mut buf).await;
                    let body = r#"{"ok":true}"#;
                    let resp = format!(
                        "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
                        body.len(),
                        body
                    );
                    let _ = sock.write_all(resp.as_bytes()).await;
                });
            }
        });

        // Proxy HTTP minimo que exige Basic user:pass
        let proxy = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let proxy_port = proxy.local_addr().unwrap().port();
        let expected_auth = format!("Basic {}", B64.encode(b"corp:secret"));
        tokio::spawn(async move {
            while let Ok((mut client, _)) = proxy.accept().await {
                let auth_hdr = expected_auth.clone();
                tokio::spawn(async move {
                    let mut buf = [0u8; 4096];
                    let n = client.read(&mut buf).await.unwrap_or(0);
                    let raw = String::from_utf8_lossy(&buf[..n]).to_string();
                    if !raw.contains(&format!("Proxy-Authorization: {auth_hdr}"))
                        && !raw.to_lowercase().contains(&format!("proxy-authorization: {}", auth_hdr.to_lowercase()))
                    {
                        let _ = client
                            .write_all(b"HTTP/1.1 407 Proxy Authentication Required\r\nProxy-Authenticate: Basic\r\nContent-Length: 3\r\nConnection: close\r\n\r\n407")
                            .await;
                        return;
                    }
                    let mut up = tokio::net::TcpStream::connect(("127.0.0.1", target_port)).await.unwrap();
                    let _ = up.write_all(&buf[..n]).await;
                    let mut out = vec![];
                    let _ = up.read_to_end(&mut out).await;
                    let _ = client.write_all(&out).await;
                });
            }
        });

        // 1) Proxy con credenciales correctas
        let engine = HttpEngine::new(NetworkConfig {
            proxy: ProxyConfig {
                mode: ProxyMode::Manual,
                http_host: "127.0.0.1".into(),
                http_port: proxy_port,
                username: "corp".into(),
                password: "secret".into(),
                ..Default::default()
            },
            ..Default::default()
        });

        let req = WireRequest {
            id: "r1".into(),
            method: "GET".into(),
            url: format!("http://127.0.0.1:{target_port}/test"),
            headers: vec![("X-Custom-Header".into(), "val".into())],
            body: WireBody::None,
            settings: RequestSettings::default(),
        };
        let res = engine.send(req.clone()).await.unwrap();
        assert_eq!(res.status, 200);
        assert_eq!(B64.decode(&res.body_base64).unwrap(), br#"{"ok":true}"#);
        assert!(res.request.proxy.is_some());

        // 2) Proxy con clave incorrecta -> 407
        engine
            .set_config(NetworkConfig {
                proxy: ProxyConfig {
                    mode: ProxyMode::Manual,
                    http_host: "127.0.0.1".into(),
                    http_port: proxy_port,
                    username: "corp".into(),
                    password: "wrong".into(),
                    ..Default::default()
                },
                ..Default::default()
            })
            .await
            .unwrap();
        let res407 = engine.send(req).await;
        match res407 {
            Ok(r) => assert_eq!(r.status, 407),
            Err(HttpError::ProxyAuthRequired(_)) => {}
            Err(other) => panic!("se esperaba 407 o ProxyAuthRequired, llego: {other:?}"),
        }
    }
}
