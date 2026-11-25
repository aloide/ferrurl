// Plugin de chai con las aserciones de Postman (equivalente a chai-postman):
// pm.response.to.have.status(200), .to.be.ok, .to.have.header('X'), .to.have.jsonBody('a.b', 1), ...

import _ from 'lodash';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Chai = any;

let installed = false;

export interface ResponseLike {
  __pmResponse: true;
  code: number;
  status: string;
  headers: { get(name: string): string | undefined; has(name: string): boolean };
  text(): string;
  json(): unknown;
  responseTime: number;
}

const isResp = (o: unknown): o is ResponseLike => !!o && (o as ResponseLike).__pmResponse === true;

const STATUS_PROPS: Record<string, [string, (c: number) => boolean]> = {
  info: ['informational (1XX)', (c) => c >= 100 && c < 200],
  success: ['successful (2XX)', (c) => c >= 200 && c < 300],
  redirection: ['redirection (3XX)', (c) => c >= 300 && c < 400],
  clientError: ['client error (4XX)', (c) => c >= 400 && c < 500],
  serverError: ['server error (5XX)', (c) => c >= 500 && c < 600],
  error: ['error (4XX or 5XX)', (c) => c >= 400 && c < 600],
  ok: ['200 OK', (c) => c === 200],
  accepted: ['202 Accepted', (c) => c === 202],
  withoutContent: ['204 No Content', (c) => c === 204],
  badRequest: ['400 Bad Request', (c) => c === 400],
  unauthorized: ['401 Unauthorized', (c) => c === 401],
  forbidden: ['403 Forbidden', (c) => c === 403],
  notFound: ['404 Not Found', (c) => c === 404],
  notAcceptable: ['406 Not Acceptable', (c) => c === 406],
  rateLimited: ['429 Too Many Requests', (c) => c === 429],
};

export function installPostmanChai(chai: Chai): void {
  if (installed) return;
  installed = true;
  const { Assertion } = chai;
  const flag = chai.util.flag;

  Assertion.addMethod('status', function (this: Chai, expected: number | string) {
    const r = flag(this, 'object');
    if (!isResp(r)) throw new chai.AssertionError('expected a response object to assert status');
    if (typeof expected === 'number') {
      this.assert(
        r.code === expected,
        'expected response to have status code #{exp} but got #{act}',
        'expected response to not have status code #{act}',
        expected,
        r.code,
      );
    } else {
      this.assert(
        r.status === expected,
        'expected response to have status reason #{exp} but got #{act}',
        'expected response to not have status reason #{act}',
        expected,
        r.status,
      );
    }
  });

  Assertion.addMethod('header', function (this: Chai, key: string, value?: string) {
    const r = flag(this, 'object');
    if (!isResp(r)) throw new chai.AssertionError('expected a response object to assert headers');
    if (value === undefined) {
      this.assert(r.headers.has(key), `expected response to have header with key '${key}'`, `expected response to not have header with key '${key}'`);
    } else {
      const actual = r.headers.get(key);
      this.assert(
        actual === value,
        `expected '${key}' response header to be #{exp} but got #{act}`,
        `expected '${key}' response header to not be #{act}`,
        value,
        actual,
      );
    }
  });

  Assertion.addMethod('body', function (this: Chai, expected?: unknown) {
    const r = flag(this, 'object');
    if (!isResp(r)) throw new chai.AssertionError('expected a response object to assert body');
    const text = r.text();
    if (expected === undefined) {
      this.assert(text.length > 0, 'expected response to have content in body', 'expected response to not have content in body');
    } else if (expected instanceof RegExp) {
      this.assert(expected.test(text), 'expected response body to match #{exp}', 'expected response body to not match #{exp}', expected);
    } else if (typeof expected === 'string') {
      this.assert(text === expected, 'expected response body to equal #{exp} but got #{act}', 'expected response body to not equal #{exp}', expected, text);
    } else {
      let json: unknown;
      try {
        json = JSON.parse(text);
      } catch {
        json = undefined;
      }
      this.assert(_.isEqual(json, expected), 'expected response body json to equal #{exp} but got #{act}', 'expected response body json to not equal #{exp}', expected, json);
    }
  });

  Assertion.addMethod('jsonBody', function (this: Chai, path?: string | object, value?: unknown) {
    const r = flag(this, 'object');
    if (!isResp(r)) throw new chai.AssertionError('expected a response object to assert jsonBody');
    let json: unknown;
    try {
      json = JSON.parse(r.text());
    } catch {
      this.assert(false, 'expected response body to be a valid json but got error', 'expected response body not to be a valid json');
      return;
    }
    if (path === undefined) {
      this.assert(true, '', 'expected response body not to be a valid json');
    } else if (typeof path === 'object') {
      this.assert(_.isEqual(json, path), 'expected response body json to equal #{exp} but got #{act}', 'expected response body json to not equal #{exp}', path, json);
    } else if (arguments.length < 2) {
      this.assert(_.has(json, path), `expected #{act} to have property '${path}'`, `expected #{act} to not have property '${path}'`, undefined, json);
    } else {
      const actual = _.get(json, path);
      this.assert(_.isEqual(actual, value), `expected response body json at '${path}' to contain #{exp} but got #{act}`, `expected response body json at '${path}' to not contain #{exp}`, value, actual);
    }
  });

  Assertion.addProperty('json', function (this: Chai) {
    const r = flag(this, 'object');
    if (!isResp(r)) throw new chai.AssertionError('expected a response object to assert json');
    let ok = true;
    try {
      JSON.parse(r.text());
    } catch {
      ok = false;
    }
    this.assert(ok, 'expected response body to be a valid json', 'expected response body not to be a valid json');
  });

  Assertion.addProperty('withBody', function (this: Chai) {
    const r = flag(this, 'object');
    if (!isResp(r)) throw new chai.AssertionError('expected a response object');
    this.assert(r.text().length > 0, 'expected response to have content in body', 'expected response to not have content in body');
  });

  Assertion.addProperty('response', function (this: Chai) {
    const r = flag(this, 'object');
    this.assert(isResp(r), 'expected #{this} to be a postman response', 'expected #{this} to not be a postman response');
  });

  for (const [name, [label, test]] of Object.entries(STATUS_PROPS)) {
    const fn = function (this: Chai) {
      const r = flag(this, 'object');
      this.assert(
        test(r.code),
        `expected response code to be ${label} but found #{act}`,
        `expected response code to not be ${label} but found #{act}`,
        label,
        r.code,
      );
    };
    if (name in Assertion.prototype) {
      Assertion.overwriteProperty(name, function (_super: () => void) {
        return function (this: Chai) {
          if (isResp(flag(this, 'object'))) fn.call(this);
          else _super.call(this);
        };
      });
    } else {
      Assertion.addProperty(name, function (this: Chai) {
        if (!isResp(flag(this, 'object'))) throw new chai.AssertionError(`'${name}' solo aplica a pm.response`);
        fn.call(this);
      });
    }
  }
}
