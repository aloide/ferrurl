// Generacion de comandos cURL a partir del request ya resuelto.

import type { WireRequest } from './wire';

export type CurlFlavor = 'bash' | 'cmd' | 'powershell';

export interface CurlProxy {
  url: string;
  username?: string;
  password?: string;
}

function quoteBash(s: string): string {
  return `'${s.replace(/'/g, `'\\''`)}'`;
}
function quoteCmd(s: string): string {
  return `"${s.replace(/"/g, '\\"').replace(/%/g, '%%')}"`;
}
function quotePs(s: string): string {
  return `'${s.replace(/'/g, "''")}'`;
}

export function toCurl(w: WireRequest, flavor: CurlFlavor = 'bash', proxy?: CurlProxy | null, includeDefaults = false): string {
  const q = flavor === 'bash' ? quoteBash : flavor === 'cmd' ? quoteCmd : quotePs;
  const exe = flavor === 'powershell' ? 'curl.exe' : 'curl';
  const cont = flavor === 'bash' ? ' \\\n  ' : flavor === 'cmd' ? ' ^\n  ' : ' `\n  ';
  const parts: string[] = [`${exe} --location`];
  if (w.method !== 'GET') parts.push(`--request ${w.method}`);
  parts.push(q(w.url));
  const skip = includeDefaults ? new Set<string>() : new Set(['user-agent', 'accept-encoding', 'connection', 'cache-control', 'accept']);
  for (const [k, v] of w.headers) {
    if (skip.has(k.toLowerCase())) continue;
    parts.push(`--header ${q(`${k}: ${v}`)}`);
  }
  switch (w.body.type) {
    case 'text':
      if (w.body.text.length) parts.push(`--data-raw ${q(w.body.text)}`);
      break;
    case 'urlencoded':
      for (const [k, v] of w.body.fields) parts.push(`--data-urlencode ${q(`${k}=${v}`)}`);
      break;
    case 'form':
      for (const p of w.body.parts) {
        parts.push(p.type === 'file' ? `--form ${q(`${p.key}=@"${p.path}"`)}` : `--form ${q(`${p.key}=${p.value}`)}`);
      }
      break;
    case 'file':
      parts.push(`--data-binary ${q('@' + w.body.path)}`);
      break;
    case 'base64':
      parts.push('--data-binary @archivo.bin');
      break;
    default:
      break;
  }
  if (!w.settings.verifyTls) parts.push('--insecure');
  if (!w.settings.followRedirects) parts.splice(0, 1, exe);
  if (w.settings.timeoutMs > 0) parts.push(`--max-time ${Math.ceil(w.settings.timeoutMs / 1000)}`);
  if (proxy && w.settings.useProxy) {
    parts.push(`--proxy ${q(proxy.url)}`);
    if (proxy.username) parts.push(`--proxy-user ${q(`${proxy.username}:${proxy.password ?? ''}`)}`);
  }
  return parts.join(cont);
}
