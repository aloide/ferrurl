// Tipos del IPC con Rust (src-tauri/src/http.rs) y respuesta parseada para la UI/scripts.

export type ProxyMode = 'off' | 'system' | 'manual';

export interface ProxyConfig {
  mode: ProxyMode;
  httpHost: string;
  httpPort: number;
  httpsHost: string;
  httpsPort: number;
  username: string;
  password: string;
  bypass: string;
}

export interface TlsConfig {
  verify: boolean;
  extraCaPaths: string[];
}

export interface NetworkConfig {
  proxy: ProxyConfig;
  tls: TlsConfig;
}

export type FormPart =
  | { type: 'text'; key: string; value: string; contentType?: string | null }
  | { type: 'file'; key: string; path: string; contentType?: string | null };

export type WireBody =
  | { type: 'none' }
  | { type: 'text'; text: string }
  | { type: 'base64'; data: string }
  | { type: 'file'; path: string }
  | { type: 'urlencoded'; fields: [string, string][] }
  | { type: 'form'; parts: FormPart[] };

export interface RequestSettings {
  timeoutMs: number;
  followRedirects: boolean;
  maxRedirects: number;
  useProxy: boolean;
  verifyTls: boolean;
}

export interface WireRequest {
  id: string;
  method: string;
  url: string;
  headers: [string, string][];
  body: WireBody;
  settings: RequestSettings;
}

export interface SentRequest {
  method: string;
  url: string;
  headers: [string, string][];
  bodySize: number;
  proxy: string | null;
}

export interface WireResponse {
  status: number;
  statusText: string;
  headers: [string, string][];
  bodyBase64: string;
  timeMs: number;
  bodySize: number;
  headersSize: number;
  httpVersion: string;
  remoteAddr: string | null;
  finalUrl: string;
  request: SentRequest;
}

export type HttpErrorKind =
  | 'invalidUrl'
  | 'invalidRequest'
  | 'proxyAuthRequired'
  | 'proxyConnect'
  | 'dns'
  | 'tls'
  | 'timeout'
  | 'connectionRefused'
  | 'connect'
  | 'cancelled'
  | 'config'
  | 'other';

export interface HttpError {
  kind: HttpErrorKind;
  message: string;
}

export interface Transport {
  send(req: WireRequest): Promise<WireResponse>;
  cancel(id: string): Promise<void> | void;
}

/** Respuesta serializable que consumen los scripts y la UI. */
export interface ParsedResponse {
  code: number;
  status: string;
  headers: [string, string][];
  body: string;
  bodyBase64: string;
  responseTime: number;
  responseSize: number;
  headersSize: number;
  httpVersion: string;
  finalUrl: string;
  remoteAddr: string | null;
  sent: SentRequest;
}

export const DEFAULT_SETTINGS: RequestSettings = {
  timeoutMs: 0,
  followRedirects: true,
  maxRedirects: 10,
  useProxy: true,
  verifyTls: true,
};

export function isHttpError(e: unknown): e is HttpError {
  return !!e && typeof e === 'object' && 'kind' in e && 'message' in e;
}

export function toHttpError(e: unknown): HttpError {
  if (isHttpError(e)) return e;
  if (e instanceof Error) return { kind: 'other', message: e.message };
  return { kind: 'other', message: String(e) };
}

export const ERROR_LABELS: Record<HttpErrorKind, string> = {
  invalidUrl: 'URL inválida',
  invalidRequest: 'Request inválido',
  proxyAuthRequired: 'El proxy requiere autenticación (407)',
  proxyConnect: 'No se pudo conectar con el proxy',
  dns: 'No se pudo resolver el nombre (DNS)',
  tls: 'Error TLS/SSL',
  timeout: 'Tiempo de espera agotado',
  connectionRefused: 'Conexión rechazada',
  connect: 'Error de conexión',
  cancelled: 'Cancelado',
  config: 'Configuración inválida',
  other: 'Error',
};
