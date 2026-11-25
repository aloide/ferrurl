// Adaptador de plataforma: IPC con Tauri en produccion y fallback en navegador para dev.

import { invoke } from '@tauri-apps/api/core';
import { open, save } from '@tauri-apps/plugin-dialog';
import type { NetworkConfig, Transport, WireRequest, WireResponse } from '../core/wire';

export interface AppInfo {
  version: string;
  dataDir: string;
  portable: boolean;
  secretsBackend: string;
}

export function isTauri(): boolean {
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
}

export const tauriTransport: Transport = {
  async send(req: WireRequest): Promise<WireResponse> {
    if (!isTauri()) throw { kind: 'other', message: 'El envío HTTP requiere ejecutar FerrURL como app de escritorio (Tauri).' };
    return invoke<WireResponse>('send_request', { req });
  },
  async cancel(id: string): Promise<void> {
    if (isTauri()) await invoke('cancel_request', { id });
  },
};

export async function setNetworkConfig(config: NetworkConfig): Promise<void> {
  if (isTauri()) await invoke('set_network_config', { config });
}

export async function getAppInfo(): Promise<AppInfo> {
  if (!isTauri()) return { version: '0.1.0-web', dataDir: 'localStorage', portable: false, secretsBackend: 'memoria' };
  return invoke<AppInfo>('app_info');
}

const LS_PREFIX = 'ferrurl:';

export async function storageRead(path: string): Promise<string | null> {
  if (!isTauri()) return localStorage.getItem(LS_PREFIX + path);
  return invoke<string | null>('storage_read', { path });
}

export async function storageWrite(path: string, content: string): Promise<void> {
  if (!isTauri()) {
    localStorage.setItem(LS_PREFIX + path, content);
    return;
  }
  await invoke('storage_write', { path, content });
}

export async function storageDelete(path: string): Promise<void> {
  if (!isTauri()) {
    localStorage.removeItem(LS_PREFIX + path);
    return;
  }
  await invoke('storage_delete', { path });
}

export async function storageList(dir: string): Promise<string[]> {
  if (!isTauri()) {
    const prefix = LS_PREFIX + dir + '/';
    return Object.keys(localStorage)
      .filter((k) => k.startsWith(prefix))
      .map((k) => k.slice(prefix.length))
      .sort();
  }
  return invoke<string[]>('storage_list', { dir });
}

export async function secretGet(key: string): Promise<string | null> {
  if (!isTauri()) return localStorage.getItem(LS_PREFIX + 'secret:' + key);
  return invoke<string | null>('secret_get', { key });
}

export async function secretSet(key: string, value: string): Promise<void> {
  if (!isTauri()) {
    if (!value) localStorage.removeItem(LS_PREFIX + 'secret:' + key);
    else localStorage.setItem(LS_PREFIX + 'secret:' + key, value);
    return;
  }
  await invoke('secret_set', { key, value });
}

export async function secretDelete(key: string): Promise<void> {
  if (!isTauri()) {
    localStorage.removeItem(LS_PREFIX + 'secret:' + key);
    return;
  }
  await invoke('secret_delete', { key });
}

export async function pickOpenFile(filters?: { name: string; extensions: string[] }[]): Promise<string | null> {
  if (!isTauri()) return null;
  const r = await open({ multiple: false, filters });
  return typeof r === 'string' ? r : null;
}

export async function pickSaveFile(defaultPath?: string, filters?: { name: string; extensions: string[] }[]): Promise<string | null> {
  if (!isTauri()) return null;
  const r = await save({ defaultPath, filters });
  return typeof r === 'string' ? r : null;
}

export async function fsReadText(path: string): Promise<string> {
  return invoke<string>('fs_read_text', { path });
}

export async function fsWriteText(path: string, content: string): Promise<void> {
  if (!isTauri()) {
    const blob = new Blob([content], { type: 'text/plain;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = path.split(/[\\/]/).pop() || 'export.json';
    a.click();
    return;
  }
  await invoke('fs_write_text', { path, content });
}

export async function fsWriteBase64(path: string, data: string): Promise<void> {
  await invoke('fs_write_base64', { path, data });
}

export async function autorunConfig(): Promise<string | null> {
  if (!isTauri()) return null;
  return invoke<string | null>('autorun_config');
}

export async function autorunFinish(output: string, content: string, exitCode: number): Promise<void> {
  if (!isTauri()) return;
  await invoke('autorun_finish', { output, content, exitCode });
}
