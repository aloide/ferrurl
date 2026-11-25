// Ejecucion automatica E2E dentro de la aplicacion Tauri real (WebView2 + Worker + Rust HttpEngine + Proxy).

import { importCollection, importEnvironment } from './core/postman';
import { chainFromState, runCollection, type ItemRunResult } from './core/runner';
import type { NetworkConfig } from './core/wire';
import { autorunConfig, autorunFinish, fsReadText, setNetworkConfig, tauriTransport } from './platform/tauri';
import { WorkerScriptHost } from './sandbox/workerHost';

interface AutorunSpec {
  collectionPath: string;
  environmentPath: string;
  secrets: Record<string, string>;
  envOverrides?: Record<string, string>;
  network: NetworkConfig;
  folderIndices?: number[];
  outputPath: string;
}

export async function maybeRunAutorun(): Promise<boolean> {
  const raw = await autorunConfig();
  if (!raw) return false;
  const spec = JSON.parse(raw) as AutorunSpec;
  const host = new WorkerScriptHost();
  try {
    await setNetworkConfig(spec.network);
    const colText = await fsReadText(spec.collectionPath);
    const envText = await fsReadText(spec.environmentPath);
    const { collection } = importCollection(JSON.parse(colText));
    const environment = importEnvironment(JSON.parse(envText));
    const chain = chainFromState({ collection, environment, secrets: spec.secrets });
    if (spec.envOverrides) {
      for (const [k, v] of Object.entries(spec.envOverrides)) chain.environment.set(k, v);
    }

    const indices = spec.folderIndices ?? collection.item.map((_, i) => i);
    const results: ItemRunResult[] = [];
    for (const idx of indices) {
      const folder = collection.item[idx];
      if (!folder) continue;
      for await (const ev of runCollection(collection, chain, tauriTransport, host, {
        folderId: folder.id,
        environmentName: environment.name,
      })) {
        if (ev.type === 'itemDone') results.push(ev.result);
      }
    }

    const report = {
      ok: true,
      collectionName: collection.info.name,
      totalItems: results.length,
      results: results.map((r) => ({
        itemName: r.itemName,
        path: r.path,
        status: r.response?.code,
        proxy: r.response?.sent.proxy,
        error: r.error,
        scriptErrors: r.scriptErrors,
        subRequestsCount: r.subRequests.length,
        tests: r.tests,
      })),
    };
    await autorunFinish(spec.outputPath, JSON.stringify(report, null, 2), 0);
  } catch (e) {
    await autorunFinish(
      spec.outputPath,
      JSON.stringify({ ok: false, error: e instanceof Error ? e.message : String(e) }, null, 2),
      1,
    );
  } finally {
    host.terminate();
  }
  return true;
}
