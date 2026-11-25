// Utilidades de base64 / texto que funcionan en navegador, worker y Node.

export function bytesToBase64(bytes: Uint8Array): string {
  let bin = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    bin += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(bin);
}

export function base64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export function utf8ToBase64(s: string): string {
  return bytesToBase64(new TextEncoder().encode(s));
}

export function charsetOf(contentType: string | undefined): string {
  const m = /charset\s*=\s*"?([^;"\s]+)/i.exec(contentType ?? '');
  return (m?.[1] ?? 'utf-8').toLowerCase();
}

export function decodeBody(bytes: Uint8Array, contentType?: string): string {
  const cs = charsetOf(contentType);
  try {
    return new TextDecoder(cs).decode(bytes);
  } catch {
    return new TextDecoder('utf-8').decode(bytes);
  }
}

export function isProbablyBinary(contentType: string | undefined, bytes: Uint8Array): boolean {
  const ct = (contentType ?? '').toLowerCase();
  if (/^(text\/|application\/(json|xml|javascript|x-www-form-urlencoded|.*\+json|.*\+xml))/.test(ct)) return false;
  if (/^(image|audio|video|font)\/|application\/(octet-stream|pdf|zip|gzip)/.test(ct)) return true;
  const n = Math.min(bytes.length, 512);
  for (let i = 0; i < n; i++) if (bytes[i] === 0) return true;
  return false;
}

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(2)} KB`;
  return `${(n / 1024 / 1024).toFixed(2)} MB`;
}

export function uid(): string {
  const c = globalThis.crypto as Crypto | undefined;
  if (c?.randomUUID) return c.randomUUID();
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (ch) => {
    const r = (Math.random() * 16) | 0;
    return (ch === 'x' ? r : (r & 0x3) | 0x8).toString(16);
  });
}
