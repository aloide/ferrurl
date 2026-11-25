import { describe, expect, it } from 'vitest';
import { toCurl } from '../src/core/codegen';
import { buildWire, createDraft } from '../src/core/build';
import { newCollection, newRequestItem } from '../src/core/postman';
import { runCollection } from '../src/core/runner';
import { emptyChain } from '../src/core/variables';
import type { Transport, WireRequest, WireResponse } from '../src/core/wire';
import { runScript } from '../src/sandbox/engine';
import { DirectScriptHost } from '../src/sandbox/workerHost';
import { xml2Json } from '../src/sandbox/xml2json';

describe('Sandbox pm.* y helpers', () => {
  it('xml2Json convierte atributos, texto y arrays como Postman', () => {
    const res = xml2Json('<root id="1"><item>a</item><item>b</item><tag k="x">hola</tag></root>');
    expect(res).toEqual({
      root: {
        $: { id: '1' },
        item: ['a', 'b'],
        tag: { $: { k: 'x' }, _: 'hola' },
      },
    });
  });

  it('soporta pm.request mutable en pre-request, CryptoJS y console', async () => {
    const item = newRequestItem('Test');
    item.request.url.raw = 'http://example.com/a';
    const col = newCollection('C');
    const draft = createDraft(item, [], col);
    const chain = emptyChain();

    const out = await runScript(
      {
        kind: 'prerequest',
        code: `
          pm.request.headers.add({ key: 'X-Sign', value: CryptoJS.MD5('abc').toString() });
          pm.request.method = 'POST';
          pm.variables.set('v', '123');
          console.log('hola', 42);
        `,
        location: 'request',
        scopes: { local: [], data: [], environment: [], collection: [], globals: [] },
        request: draft,
        info: {
          requestName: 'Test',
          requestId: '1',
          eventName: 'prerequest',
          iteration: 0,
          iterationCount: 1,
          collectionName: 'C',
          environmentName: '',
        },
        timeoutMs: 5000,
      },
      { sendRequest: async () => ({}) },
    );

    expect(out.errors).toEqual([]);
    expect(out.request.method).toBe('POST');
    expect(out.request.headers).toContainEqual({ key: 'X-Sign', value: '900150983cd24fb0d6963f7d28e17f72' });
    expect(out.logs.map((l) => l.message)).toEqual(['hola 42']);
    expect(out.scopes.local).toContainEqual(['v', '123']);
  });

  it('soporta pm.response aserciones, async pm.test y legacy tests[]', async () => {
    const item = newRequestItem('Test');
    const draft = createDraft(item, [], newCollection('C'));
    const out = await runScript(
      {
        kind: 'test',
        code: `
          pm.test('ok', () => {
            pm.response.to.be.ok;
            pm.response.to.have.status(200);
            pm.response.to.have.header('Content-Type', 'application/json');
            pm.response.to.have.jsonBody('data.id', 7);
          });
          pm.test('async', async () => {
            await new Promise((r) => setTimeout(r, 10));
            pm.expect(1 + 1).to.eql(2);
          });
          pm.test.skip('omitido', () => {});
          tests['legacy ok'] = responseCode.code === 200;
        `,
        location: 'request',
        scopes: { local: [], data: [], environment: [], collection: [], globals: [] },
        request: draft,
        response: {
          code: 200,
          status: 'OK',
          headers: [['Content-Type', 'application/json']],
          body: '{"data":{"id":7}}',
          bodyBase64: '',
          responseTime: 12,
          responseSize: 18,
          headersSize: 30,
          httpVersion: 'HTTP/1.1',
          finalUrl: 'http://x',
          remoteAddr: null,
          sent: { method: 'GET', url: 'http://x', headers: [], bodySize: 0, proxy: null },
        },
        info: {
          requestName: 'Test',
          requestId: '1',
          eventName: 'test',
          iteration: 0,
          iterationCount: 1,
          collectionName: 'C',
          environmentName: '',
        },
        timeoutMs: 5000,
      },
      { sendRequest: async () => ({}) },
    );

    expect(out.errors).toEqual([]);
    expect(out.tests.find((t) => t.name === 'ok')?.passed).toBe(true);
    expect(out.tests.find((t) => t.name === 'async')?.passed).toBe(true);
    expect(out.tests.find((t) => t.name === 'omitido')?.skipped).toBe(true);
    expect(out.tests.find((t) => t.name === 'legacy ok')?.passed).toBe(true);
  });

  it('runner respeta setNextRequest y skipRequest', async () => {
    const col = newCollection('C');
    const a = newRequestItem('A');
    a.request.url.raw = 'http://x/a';
    a.event = [{ listen: 'test', script: { exec: ["pm.execution.setNextRequest('C');"] } }];
    const b = newRequestItem('B');
    b.request.url.raw = 'http://x/b';
    const c = newRequestItem('C');
    c.request.url.raw = 'http://x/c';
    c.event = [{ listen: 'prerequest', script: { exec: ['pm.execution.skipRequest();'] } }];
    col.item = [a, b, c];

    const visited: string[] = [];
    const transport: Transport = {
      async send(req: WireRequest): Promise<WireResponse> {
        visited.push(req.url);
        return {
          status: 200,
          statusText: 'OK',
          headers: [],
          bodyBase64: '',
          timeMs: 1,
          bodySize: 0,
          headersSize: 0,
          httpVersion: 'HTTP/1.1',
          remoteAddr: null,
          finalUrl: req.url,
          request: { method: req.method, url: req.url, headers: [], bodySize: 0, proxy: null },
        };
      },
      cancel() {},
    };

    const doneNames: string[] = [];
    for await (const ev of runCollection(col, emptyChain(), transport, new DirectScriptHost())) {
      if (ev.type === 'itemDone') doneNames.push(ev.result.itemName + (ev.result.skipped ? '(skip)' : ''));
    }
    expect(visited).toEqual(['http://x/a']);
    expect(doneNames).toEqual(['A', 'C(skip)']);
  });

  it('genera comando cURL con proxy y body', () => {
    const item = newRequestItem('R');
    item.request.method = 'POST';
    item.request.url.raw = 'http://api.test/login';
    item.request.body = { mode: 'raw', raw: '<xml/>', options: { raw: { language: 'xml' } } };
    const wire = buildWire(createDraft(item, [], newCollection('C')), emptyChain()).wire;
    const cmd = toCurl(wire, 'bash', { url: 'http://127.0.0.1:3128', username: 'u', password: 'p' });
    expect(cmd).toContain('--request POST');
    expect(cmd).toContain("--proxy 'http://127.0.0.1:3128'");
    expect(cmd).toContain("--proxy-user 'u:p'");
    expect(cmd).toContain("--data-raw '<xml/>'");
  });
});
