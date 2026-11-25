// Snippets de scripts estilo Postman + autocompletado basico para Monaco/CodeMirror.

export interface ScriptSnippet {
  id: string;
  label: string;
  kind: 'prerequest' | 'test' | 'both';
  code: string;
}

export const SCRIPT_SNIPPETS: ScriptSnippet[] = [
  {
    id: 'status-200',
    label: 'Código de estado es 200',
    kind: 'test',
    code: `pm.test('Responde 200', () => {\n  pm.response.to.have.status(200);\n});`,
  },
  {
    id: 'status-oneof',
    label: 'Código de estado está en lista',
    kind: 'test',
    code: `pm.test('Estado esperado', () => {\n  pm.expect(pm.response.code).to.be.oneOf([200, 201]);\n});`,
  },
  {
    id: 'json-check',
    label: 'Verificar propiedad en JSON',
    kind: 'test',
    code: `pm.test('JSON contiene campo', () => {\n  const body = pm.response.json();\n  pm.expect(body.success).to.eql(true);\n});`,
  },
  {
    id: 'response-time',
    label: 'Tiempo de respuesta menor a X ms',
    kind: 'test',
    code: `pm.test('Responde en menos de 2000 ms', () => {\n  pm.expect(pm.response.responseTime).to.be.below(2000);\n});`,
  },
  {
    id: 'header-exists',
    label: 'Encabezado presente en respuesta',
    kind: 'test',
    code: `pm.test('Content-Type es JSON', () => {\n  pm.response.to.have.header('Content-Type');\n});`,
  },
  {
    id: 'set-env',
    label: 'Guardar variable de ambiente',
    kind: 'both',
    code: `pm.environment.set('clave', 'valor');`,
  },
  {
    id: 'set-col',
    label: 'Guardar variable de colección',
    kind: 'both',
    code: `pm.collectionVariables.set('token', pm.response.json().data.token);`,
  },
  {
    id: 'get-var',
    label: 'Leer variable (cualquier scope)',
    kind: 'both',
    code: `const valor = pm.variables.get('miVariable');`,
  },
  {
    id: 'send-request',
    label: 'Enviar petición auxiliar (pm.sendRequest)',
    kind: 'both',
    code: `pm.sendRequest({\n  url: pm.variables.get('baseUrl') + '/auth/login',\n  method: 'POST',\n  header: { Authorization: 'Basic ' + CryptoJS.enc.Base64.stringify(CryptoJS.enc.Utf8.parse(pm.variables.get('apiUser') + ':' + pm.variables.get('apiPassword'))) }\n}, (err, res) => {\n  if (!err && res.code === 200) {\n    pm.variables.set('token', res.json().data.token);\n  }\n});`,
  },
  {
    id: 'next-req',
    label: 'Definir siguiente request (Runner)',
    kind: 'test',
    code: `pm.execution.setNextRequest('Nombre del request');`,
  },
];

export const PM_COMPLETIONS = [
  { label: 'pm.test', detail: 'pm.test(nombre, fn)', info: 'Define una aserción de test' },
  { label: 'pm.expect', detail: 'pm.expect(valor)', info: 'Aserción Chai' },
  { label: 'pm.response.to.have.status', detail: '(code: number)', info: 'Verifica el código HTTP' },
  { label: 'pm.response.to.have.header', detail: '(key, value?)', info: 'Verifica un header de respuesta' },
  { label: 'pm.response.to.have.jsonBody', detail: '(path?, value?)', info: 'Verifica el cuerpo JSON' },
  { label: 'pm.response.json()', detail: 'any', info: 'Parsea la respuesta como JSON' },
  { label: 'pm.response.text()', detail: 'string', info: 'Cuerpo de respuesta como texto' },
  { label: 'pm.response.code', detail: 'number', info: 'Código de estado HTTP' },
  { label: 'pm.response.responseTime', detail: 'number', info: 'Duración en ms' },
  { label: 'pm.variables.get', detail: '(key: string)', info: 'Lee una variable respetando la prioridad' },
  { label: 'pm.variables.set', detail: '(key: string, val)', info: 'Asigna una variable local' },
  { label: 'pm.environment.get', detail: '(key: string)', info: 'Lee del ambiente activo' },
  { label: 'pm.environment.set', detail: '(key: string, val)', info: 'Escribe en el ambiente activo' },
  { label: 'pm.collectionVariables.get', detail: '(key: string)', info: 'Lee variable de colección' },
  { label: 'pm.collectionVariables.set', detail: '(key: string, val)', info: 'Escribe variable de colección' },
  { label: 'pm.globals.get', detail: '(key: string)', info: 'Lee variable global' },
  { label: 'pm.globals.set', detail: '(key: string, val)', info: 'Escribe variable global' },
  { label: 'pm.sendRequest', detail: '(req, callback)', info: 'Ejecuta un request HTTP pasando por el proxy' },
  { label: 'pm.request.headers.add', detail: '({key, value})', info: 'Agrega un header en pre-request' },
  { label: 'pm.request.headers.upsert', detail: '({key, value})', info: 'Agrega o reemplaza un header' },
  { label: 'pm.info.requestName', detail: 'string', info: 'Nombre del request actual' },
  { label: 'pm.execution.setNextRequest', detail: '(name | null)', info: 'Cambia el siguiente request del Runner' },
  { label: 'pm.execution.skipRequest', detail: '()', info: 'Omite el request actual en pre-request' },
  { label: 'CryptoJS.enc.Base64.stringify', detail: '(words)', info: 'Codifica a Base64' },
  { label: 'CryptoJS.enc.Utf8.parse', detail: '(str)', info: 'Convierte string UTF-8 a WordArray' },
  { label: 'xml2Json', detail: '(xmlString)', info: 'Convierte XML a objeto JS' },
];
