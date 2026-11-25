// Formateo simple de JSON/XML/HTML y exportacion de resultados del Runner.

import type { ItemRunResult } from './runner';

export function formatJson(raw: string): string {
  return JSON.stringify(JSON.parse(raw), null, 2);
}

export function formatXml(raw: string): string {
  const cleaned = raw.replace(/>\s+</g, '><').trim();
  const tokens = cleaned.replace(/(>)(<)(\/*)/g, '$1\n$2$3').split('\n');
  let indent = 0;
  const out: string[] = [];
  for (const line of tokens) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    if (/^<\/\w/.test(trimmed)) indent = Math.max(0, indent - 1);
    out.push('  '.repeat(indent) + trimmed);
    if (/^<[^!?/][^>]*[^/]>$/.test(trimmed) && !/<\/[^>]+>$/.test(trimmed)) indent++;
  }
  return out.join('\n');
}

export function detectBodyLanguage(headers: [string, string][], body: string): 'json' | 'xml' | 'html' | 'text' {
  const ct = headers.find(([k]) => k.toLowerCase() === 'content-type')?.[1]?.toLowerCase() ?? '';
  if (ct.includes('json')) return 'json';
  if (ct.includes('html')) return 'html';
  if (ct.includes('xml')) return 'xml';
  const t = body.trimStart();
  if (t.startsWith('{') || t.startsWith('[')) return 'json';
  if (t.startsWith('<!doctype html') || t.startsWith('<html')) return 'html';
  if (t.startsWith('<')) return 'xml';
  return 'text';
}

export function prettyBody(body: string, lang: 'json' | 'xml' | 'html' | 'text'): string {
  if (!body) return '';
  if (lang === 'json') {
    try {
      return formatJson(body);
    } catch {
      return body;
    }
  }
  if (lang === 'xml' || lang === 'html') {
    try {
      return formatXml(body);
    } catch {
      return body;
    }
  }
  return body;
}

export function runnerReportJson(meta: { collectionName: string; environmentName: string; durationMs: number }, results: ItemRunResult[]): string {
  const passed = results.flatMap((r) => r.tests).filter((t) => t.passed && !t.skipped).length;
  const failed = results.flatMap((r) => r.tests).filter((t) => !t.passed && !t.skipped).length;
  return JSON.stringify(
    {
      ...meta,
      exportedAt: new Date().toISOString(),
      summary: { totalRequests: results.length, passedTests: passed, failedTests: failed },
      results,
    },
    null,
    2,
  );
}

function esc(s: string): string {
  return s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]!));
}

export function runnerReportHtml(meta: { collectionName: string; environmentName: string; durationMs: number }, results: ItemRunResult[]): string {
  const allTests = results.flatMap((r) => r.tests);
  const passed = allTests.filter((t) => t.passed && !t.skipped).length;
  const failed = allTests.filter((t) => !t.passed && !t.skipped).length;
  const rows = results
    .map((r) => {
      const status = r.error ? `Error: ${r.error.message}` : r.response ? `${r.response.code} ${r.response.status}` : r.skipped ? 'Omitido' : '-';
      const testsHtml = r.tests
        .map((t) => `<li class="${t.passed ? 'ok' : 'fail'}">${t.passed ? '✓' : '✗'} ${esc(t.name)}${t.error ? ` — <span>${esc(t.error)}</span>` : ''}</li>`)
        .join('');
      return `<tr><td>${esc(r.path)}</td><td>${esc(r.wire?.method ?? '')}</td><td>${esc(status)}</td><td>${r.response?.responseTime ?? r.durationMs} ms</td><td><ul>${testsHtml}</ul></td></tr>`;
    })
    .join('');

  return `<!doctype html><html lang="es"><head><meta charset="utf-8"><title>Reporte Runner — ${esc(meta.collectionName)}</title>
<style>body{font-family:system-ui,sans-serif;margin:24px;color:#1f2937}table{border-collapse:collapse;width:100%;margin-top:16px}th,td{border:1px solid #d1d5db;padding:8px;text-align:left;vertical-align:top;font-size:13px}th{background:#f3f4f6}ul{margin:0;padding-left:18px}.ok{color:#15803d}.fail{color:#b91c1c;font-weight:600}</style>
</head><body><h1>FerrURL — Reporte de ejecución</h1>
<p><strong>Colección:</strong> ${esc(meta.collectionName)} | <strong>Ambiente:</strong> ${esc(meta.environmentName || 'Ninguno')} | <strong>Duración:</strong> ${meta.durationMs} ms</p>
<p><strong>Requests:</strong> ${results.length} | <strong class="ok">Tests OK:</strong> ${passed} | <strong class="fail">Fallidos:</strong> ${failed}</p>
<table><thead><tr><th>Request</th><th>Método</th><th>Estado</th><th>Tiempo</th><th>Tests</th></tr></thead><tbody>${rows}</tbody></table></body></html>`;
}

export function parseDataFile(filename: string, text: string): Record<string, unknown>[] {
  if (filename.toLowerCase().endsWith('.json')) {
    const parsed = JSON.parse(text);
    if (!Array.isArray(parsed)) throw new Error('El archivo JSON debe ser un array de objetos');
    return parsed;
  }
  // CSV basico con soporte de comillas
  const lines = text.split(/\r?\n/).filter((l) => l.trim().length > 0);
  if (lines.length < 2) return [];
  const parseLine = (line: string): string[] => {
    const cells: string[] = [];
    let cur = '';
    let inQ = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (inQ) {
        if (ch === '"' && line[i + 1] === '"') {
          cur += '"';
          i++;
        } else if (ch === '"') inQ = false;
        else cur += ch;
      } else if (ch === '"') inQ = true;
      else if (ch === ',') {
        cells.push(cur);
        cur = '';
      } else cur += ch;
    }
    cells.push(cur);
    return cells;
  };
  const headers = parseLine(lines[0]).map((h) => h.trim());
  return lines.slice(1).map((line) => {
    const cols = parseLine(line);
    const row: Record<string, unknown> = {};
    headers.forEach((h, i) => (row[h] = cols[i] ?? ''));
    return row;
  });
}
