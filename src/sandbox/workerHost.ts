// Hosts para ejecutar scripts:
// - WorkerScriptHost: usa Web Worker real (en la app Tauri / navegador).
// - DirectScriptHost: ejecuta runScript en el mismo contexto (para tests unitarios y Node).

import { parseResponse } from '../core/build';
import type { SendRequestSpec } from '../core/sendRequest';
import { toHttpError, type Transport, type WireRequest } from '../core/wire';
import { runScript } from './engine';
import type { FromWorker, ScriptBridge, ScriptHost, ScriptInput, ScriptOutput, SendResult } from './protocol';

export function makeBridge(
  transport: Transport,
  onSendLog?: (wire: WireRequest, result: SendResult) => void,
  onConsoleLog?: ScriptBridge['log'],
): ScriptBridge {
  return {
    async sendRequest(spec: SendRequestSpec): Promise<SendResult> {
      // worker/engine ya convirtio el spec a WireRequest antes de enviarlo por bridge
      const wire = spec as unknown as WireRequest;
      try {
        const wResp = await transport.send(wire);
        const parsed = parseResponse(wResp);
        const result: SendResult = { response: parsed };
        onSendLog?.(wire, result);
        return result;
      } catch (e) {
        const result: SendResult = { error: toHttpError(e) };
        onSendLog?.(wire, result);
        return result;
      }
    },
    log: onConsoleLog,
  };
}

export class DirectScriptHost implements ScriptHost {
  run(input: ScriptInput, bridge: ScriptBridge): Promise<ScriptOutput> {
    return runScript(input, bridge);
  }
}

export class WorkerScriptHost implements ScriptHost {
  private worker: Worker | null = null;

  private ensureWorker(): Worker {
    if (!this.worker) {
      this.worker = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' });
    }
    return this.worker;
  }

  run(input: ScriptInput, bridge: ScriptBridge): Promise<ScriptOutput> {
    const w = this.ensureWorker();
    return new Promise<ScriptOutput>((resolve, reject) => {
      const cleanup = () => {
        w.removeEventListener('message', onMsg);
        w.removeEventListener('error', onErr);
      };

      const onMsg = (ev: MessageEvent<FromWorker>) => {
        const msg = ev.data;
        if (msg.type === 'log') {
          bridge.log?.(msg.entry);
        } else if (msg.type === 'send') {
          bridge.sendRequest(msg.spec).then((result) => {
            w.postMessage({ type: 'sendResult', callId: msg.callId, result });
          });
        } else if (msg.type === 'done') {
          cleanup();
          resolve(msg.output);
        } else if (msg.type === 'fatal') {
          cleanup();
          reject(new Error(`${msg.error.name}: ${msg.error.message}`));
        }
      };

      const onErr = (ev: ErrorEvent) => {
        cleanup();
        this.terminate();
        reject(new Error(ev.message || 'Error inesperado en el Web Worker'));
      };

      w.addEventListener('message', onMsg);
      w.addEventListener('error', onErr);
      w.postMessage({ type: 'run', input });
    });
  }

  terminate(): void {
    this.worker?.terminate();
    this.worker = null;
  }
}
