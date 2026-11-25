// Modelo interno = Postman Collection v2.1 (normalizado). Los campos desconocidos se conservan.

export type HttpMethod = string;

export interface KV {
  key: string;
  value: string;
  disabled?: boolean;
  description?: string;
  type?: string;
  [extra: string]: unknown;
}

export interface FormDataKV extends KV {
  type?: 'text' | 'file' | string;
  src?: string | string[] | null;
  contentType?: string;
}

export interface PMVariable {
  key: string;
  value?: unknown;
  type?: string;
  disabled?: boolean;
  description?: string;
  [extra: string]: unknown;
}

export interface PMUrl {
  raw: string;
  protocol?: string;
  host?: string[];
  port?: string;
  path?: string[];
  query?: KV[];
  variable?: KV[];
  hash?: string;
  [extra: string]: unknown;
}

export type AuthType = 'noauth' | 'inherit' | 'basic' | 'bearer' | 'apikey' | string;

export interface AuthParam {
  key: string;
  value: unknown;
  type?: string;
}

export interface PMAuth {
  type: AuthType;
  [type: string]: unknown;
}

export type BodyMode = 'none' | 'raw' | 'urlencoded' | 'formdata' | 'file' | 'graphql';

export interface PMBody {
  mode?: BodyMode;
  raw?: string;
  urlencoded?: KV[];
  formdata?: FormDataKV[];
  file?: { src?: string | null; content?: string };
  graphql?: { query?: string; variables?: string };
  options?: { raw?: { language?: string } } & Record<string, unknown>;
  disabled?: boolean;
  [extra: string]: unknown;
}

export interface PMScript {
  id?: string;
  type?: string;
  exec: string[];
  [extra: string]: unknown;
}

export interface PMEvent {
  listen: 'prerequest' | 'test' | string;
  script: PMScript;
  disabled?: boolean;
  [extra: string]: unknown;
}

export interface PMRequest {
  method: HttpMethod;
  header: KV[];
  url: PMUrl;
  body?: PMBody;
  auth?: PMAuth;
  description?: unknown;
  [extra: string]: unknown;
}

export interface ProtocolProfileBehavior {
  followRedirects?: boolean;
  maxRedirects?: number;
  strictSSL?: boolean;
  disableBodyPruning?: boolean;
  /** Extension FerrURL: false = no usar proxy en este request */
  ferrurlUseProxy?: boolean;
  wurlUseProxy?: boolean;
  /** Extension FerrURL: timeout en ms (0 = el global) */
  ferrurlTimeoutMs?: number;
  wurlTimeoutMs?: number;
  [extra: string]: unknown;
}

export interface PMItem {
  id: string;
  name: string;
  request: PMRequest;
  event?: PMEvent[];
  response?: unknown[];
  protocolProfileBehavior?: ProtocolProfileBehavior;
  description?: unknown;
  [extra: string]: unknown;
}

export interface PMFolder {
  id: string;
  name: string;
  item: PMNode[];
  event?: PMEvent[];
  auth?: PMAuth;
  variable?: PMVariable[];
  description?: unknown;
  protocolProfileBehavior?: ProtocolProfileBehavior;
  [extra: string]: unknown;
}

export type PMNode = PMItem | PMFolder;

export interface PMInfo {
  _postman_id?: string;
  name: string;
  description?: unknown;
  schema: string;
  [extra: string]: unknown;
}

export interface PMCollection {
  info: PMInfo;
  item: PMNode[];
  event?: PMEvent[];
  variable?: PMVariable[];
  auth?: PMAuth;
  protocolProfileBehavior?: ProtocolProfileBehavior;
  [extra: string]: unknown;
}

export interface EnvVar {
  key: string;
  /** Valor inicial (se exporta/comparte) */
  value: string;
  /** Valor actual (local). undefined = igual al inicial */
  currentValue?: string;
  type?: 'default' | 'secret' | string;
  enabled?: boolean;
}

export interface Environment {
  id: string;
  name: string;
  values: EnvVar[];
  [extra: string]: unknown;
}

export const isFolder = (n: PMNode): n is PMFolder => Array.isArray((n as PMFolder).item);

export const COLLECTION_SCHEMA_V21 = 'https://schema.getpostman.com/json/collection/v2.1.0/collection.json';
