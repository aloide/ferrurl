// Protocolo entre el runner y el motor de scripts (serializable por postMessage).

import type { RequestDraft } from '../core/build';
import type { SendRequestSpec } from '../core/sendRequest';
import type { ScopeName } from '../core/variables';
import type { HttpError, ParsedResponse } from '../core/wire';

export type ScopeSnapshot = Record<ScopeName, [string, unknown][]>;

export interface ScriptInfo {
  requestName: string;
  requestId: string;
  eventName: 'prerequest' | 'test';
  iteration: number;
  iterationCount: number;
  collectionName: string;
  environmentName: string;
}

export interface ScriptInput {
  kind: 'prerequest' | 'test';
  code: string;
  /** donde esta definido el script: "colección", "carpeta: X", "request" */
  location: string;
  scopes: ScopeSnapshot;
  request: RequestDraft;
  response?: ParsedResponse;
  info: ScriptInfo;
  timeoutMs: number;
}

export interface TestResult {
  name: string;
  passed: boolean;
  skipped?: boolean;
  error?: string;
  location?: string;
}

export type LogLevel = 'log' | 'info' | 'warn' | 'error' | 'debug';

export interface LogEntry {
  level: LogLevel;
  message: string;
  time: number;
  location?: string;
}

export interface ScriptErrorInfo {
  name: string;
  message: string;
  stack?: string;
}

export interface ScriptOutput {
  scopes: ScopeSnapshot;
  request: RequestDraft;
  tests: TestResult[];
  logs: LogEntry[];
  errors: ScriptErrorInfo[];
  /** undefined = no se llamo setNextRequest; null = detener la corrida */
  nextRequest?: string | null;
  nextRequestSet: boolean;
  skipRequest: boolean;
  durationMs: number;
}

export interface SendResult {
  response?: ParsedResponse;
  error?: HttpError;
}

export interface ScriptBridge {
  sendRequest(spec: SendRequestSpec): Promise<SendResult>;
  log?(entry: LogEntry): void;
}

export interface ScriptHost {
  run(input: ScriptInput, bridge: ScriptBridge): Promise<ScriptOutput>;
}

// Mensajes Worker <-> host
export type ToWorker =
  | { type: 'run'; input: ScriptInput }
  | { type: 'sendResult'; callId: number; result: SendResult };

export type FromWorker =
  | { type: 'send'; callId: number; spec: SendRequestSpec }
  | { type: 'log'; entry: LogEntry }
  | { type: 'done'; output: ScriptOutput }
  | { type: 'fatal'; error: ScriptErrorInfo };
