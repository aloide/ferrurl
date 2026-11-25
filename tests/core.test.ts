import { describe, expect, it } from 'vitest';
import { buildWire, createDraft } from '../src/core/build';
import { exportCollection, exportEnvironment, importAny, importCollection, importEnvironment, urlFromRaw } from '../src/core/postman';
import { itemsForTarget } from '../src/core/tree';
import { emptyChain, resolve } from '../src/core/variables';

const sampleCollection = {
  info: {
    name: 'API Demo',
    schema: 'https://schema.getpostman.com/json/collection/v2.1.0/collection.json',
  },
  event: [
    {
      listen: 'prerequest',
      script: { type: 'text/javascript', exec: ["pm.variables.set('ts', Date.now());"] },
    },
  ],
  variable: [{ key: 'token', value: '' }],
  item: [
    {
      name: 'Auth',
      item: [
        {
          name: 'Login correcto',
          request: {
            method: 'POST',
            header: [],
            auth: {
              type: 'basic',
              basic: [
                { key: 'username', value: '{{apiUser}}', type: 'string' },
                { key: 'password', value: '{{apiPassword}}', type: 'string' },
              ],
            },
            url: { raw: '{{baseUrl}}/auth/login', host: ['{{baseUrl}}'], path: ['auth', 'login'] },
          },
        },
        {
          name: 'Basic mal formado',
          request: {
            method: 'POST',
            header: [{ key: 'Authorization', value: 'Basic esto-no-es-base64!!' }],
            auth: { type: 'noauth' },
            url: { raw: '{{baseUrl}}/auth/login', host: ['{{baseUrl}}'], path: ['auth', 'login'] },
          },
        },
      ],
    },
  ],
};

const sampleEnvironment = {
  name: 'Demo - Test',
  values: [
    { key: 'baseUrl', value: 'http://localhost:8080', type: 'default', enabled: true },
    { key: 'apiUser', value: '', type: 'secret', enabled: true },
    { key: 'apiPassword', value: '', type: 'secret', enabled: true },
  ],
  _postman_variable_scope: 'environment',
};

const colRaw = JSON.stringify(sampleCollection);
const envRaw = JSON.stringify(sampleEnvironment);

describe('Postman import/export y compatibilidad', () => {
  it('detecta coleccion y ambiente automaticamente', () => {
    const c = importAny(colRaw);
    expect(c.kind).toBe('collection');
    const e = importAny(envRaw);
    expect(e.kind).toBe('environment');
  });

  it('importa y exporta una coleccion manteniendo estructura y scripts', () => {
    const { collection } = importCollection(sampleCollection);
    expect(collection.info.name).toBe('API Demo');
    expect(collection.item).toHaveLength(1);
    expect(itemsForTarget(collection)).toHaveLength(2);

    const exported = JSON.parse(exportCollection(collection));
    expect(exported.info.name).toBe(sampleCollection.info.name);
    expect(exported.variable).toEqual(sampleCollection.variable);
    expect(exported.event[0].script.exec).toEqual(sampleCollection.event[0].script.exec);
    expect(exported.item[0].item[0].name).toBe('Login correcto');
  });

  it('exporta ambiente sin secretos por defecto y los incluye si se pide', () => {
    const env = importEnvironment(sampleEnvironment);
    const withoutSecrets = JSON.parse(exportEnvironment(env, { secrets: { apiPassword: '123' } }));
    const pw = withoutSecrets.values.find((v: { key: string }) => v.key === 'apiPassword');
    expect(pw.value).toBe('');

    const withSecrets = JSON.parse(exportEnvironment(env, { includeSecrets: true, secrets: { apiPassword: '123' } }));
    const pw2 = withSecrets.values.find((v: { key: string }) => v.key === 'apiPassword');
    expect(pw2.value).toBe('123');
  });

  it('parsea URLs con {{variables}} que contienen query', () => {
    const u = urlFromRaw('{{baseUrl}}/api/{{version}}/items?a=1&b=2');
    expect(u.query).toEqual([
      { key: 'a', value: '1' },
      { key: 'b', value: '2' },
    ]);
    expect(u.path).toEqual(['api', '{{version}}', 'items']);
  });
});

describe('Variables y resolucion', () => {
  it('respeta la prioridad local > data > environment > collection > globals', () => {
    const c = emptyChain();
    c.globals.set('x', 'global');
    c.collection.set('x', 'col');
    c.environment.set('x', 'env');
    c.data.set('x', 'data');
    c.local.set('x', 'local');
    expect(resolve('{{x}}', c)).toBe('local');
    c.local.unset('x');
    expect(resolve('{{x}}', c)).toBe('data');
    c.data.unset('x');
    expect(resolve('{{x}}', c)).toBe('env');
    c.environment.unset('x');
    expect(resolve('{{x}}', c)).toBe('col');
    c.collection.unset('x');
    expect(resolve('{{x}}', c)).toBe('global');
  });

  it('resuelve anidadas, dinamicas y deja literales las faltantes', () => {
    const c = emptyChain();
    c.environment.set('env', 'test');
    c.environment.set('url_test', 'http://localhost');
    const missing: string[] = [];
    expect(resolve('{{url_{{env}}}}/{{nope}}', c, { onMissing: (n) => missing.push(n) })).toBe('http://localhost/{{nope}}');
    expect(missing).toEqual(['nope']);
    expect(resolve('{{$guid}}', c)).toMatch(/^[0-9a-f-]{36}$/i);
  });

  it('aplica Basic Auth UTF-8 y mantiene header manual en noauth', () => {
    const { collection } = importCollection(sampleCollection);
    const items = itemsForTarget(collection);
    const loginOk = items.find((r) => r.item.name === 'Login correcto')!;
    const badBasic = items.find((r) => r.item.name === 'Basic mal formado')!;

    const c = emptyChain();
    c.environment.set('baseUrl', 'http://127.0.0.1:8080');
    c.environment.set('apiUser', 'user');
    c.environment.set('apiPassword', 'ñandú');

    const w1 = buildWire(createDraft(loginOk.item, loginOk.ancestors, collection), c).wire;
    const auth1 = w1.headers.find(([k]) => k === 'Authorization')?.[1];
    expect(auth1).toBe('Basic ' + Buffer.from('user:ñandú', 'utf8').toString('base64'));

    const w2 = buildWire(createDraft(badBasic.item, badBasic.ancestors, collection), c).wire;
    const auth2 = w2.headers.find(([k]) => k === 'Authorization')?.[1];
    expect(auth2).toBe('Basic esto-no-es-base64!!');
  });
});
