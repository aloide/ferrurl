// Web Worker aislado para ejecutar scripts pre-request y test.
// No tiene acceso al DOM ni a invoke() de Tauri; todo pm.sendRequest sale via postMessage al Runner -> Rust.

import { runScript } from './engine';
import type { FromWorker, SendResult, ToWorker } from './protocol';
import type { SendRequestSpec } from '../core/sendRequest';

let callCounter = 1;
const pendingSends = new Map<number, (r: SendResult) => void>();

function post(msg: FromWorker) {
  self.postMessage(msg);
}

self.onmessage = async (ev: MessageEvent<ToWorker>) => {
  const msg = ev.data;
  if (msg.type === 'sendResult') {
    const resolve = pendingSends.get(msg.callId);
    if (resolve) {
      pendingSends.delete(msg.callId);
      resolve(msg.result);
    }
    return;
  }

  if (msg.type === 'run') {
    try {
      const output = await runScript(msg.input, {
        sendRequest(spec: SendRequestSpec) {
          const callId = callCounter++;
          return new Promise<SendResult>((resolve) => {
            pendingSends.set(callId, resolve);
            post({ type: 'send', callId, spec });
          });
        },
        log(entry) {
          post({ type: 'log', entry });
        },
      });
      post({ type: 'done', output });
    } catch (err) {
      const e = err instanceof Error ? err : new Error(String(err));
      post({ type: 'fatal', error: { name: e.name, message: e.message, stack: e.stack } });
    }
  }
};
