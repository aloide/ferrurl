// Proxy HTTP + CONNECT (HTTPS) con autenticacion Basic opcional y registro de trafico.
// Sirve para verificar que TODO el trafico (incluido pm.sendRequest) pasa por el proxy.

import http from 'node:http';
import net from 'node:net';

const PORT = Number(process.env.PROXY_PORT ?? 3128);
const HOST = process.env.PROXY_HOST ?? '127.0.0.1';
const PROXY_USER = process.env.PROXY_USER ?? 'corp_user';
const PROXY_PASS = process.env.PROXY_PASS ?? 'corp_pass';

export function createMockProxy(opts = {}) {
  const requireAuth = opts.requireAuth ?? true;
  const user = opts.user ?? PROXY_USER;
  const pass = opts.pass ?? PROXY_PASS;
  const traffic = [];

  function checkAuth(headers) {
    if (!requireAuth) return true;
    const h = headers['proxy-authorization'] || '';
    if (!h.startsWith('Basic ')) return false;
    const decoded = Buffer.from(h.slice(6).trim(), 'base64').toString('utf8');
    return decoded === `${user}:${pass}`;
  }

  const server = http.createServer((req, res) => {
    if (!checkAuth(req.headers)) {
      res.writeHead(407, { 'Proxy-Authenticate': 'Basic realm="FerrURLMockProxy"', 'Content-Type': 'text/plain' });
      res.end('Proxy Authentication Required');
      return;
    }

    let target;
    try {
      target = new URL(req.url);
    } catch {
      res.writeHead(400);
      res.end('Bad proxy request URL');
      return;
    }

    traffic.push({ kind: 'http', method: req.method, url: target.toString(), time: Date.now() });

    const outHeaders = { ...req.headers };
    delete outHeaders['proxy-authorization'];
    delete outHeaders['proxy-connection'];

    const upstream = http.request(
      {
        hostname: target.hostname,
        port: target.port || (target.protocol === 'https:' ? 443 : 80),
        path: `${target.pathname}${target.search}`,
        method: req.method,
        headers: outHeaders,
      },
      (uRes) => {
        res.writeHead(uRes.statusCode || 502, uRes.headers);
        uRes.pipe(res);
      },
    );

    upstream.on('error', (err) => {
      if (!res.headersSent) res.writeHead(502, { 'Content-Type': 'text/plain' });
      res.end(`Bad Gateway: ${err.message}`);
    });

    req.pipe(upstream);
  });

  server.on('connect', (req, clientSocket, head) => {
    if (!checkAuth(req.headers)) {
      clientSocket.write('HTTP/1.1 407 Proxy Authentication Required\r\nProxy-Authenticate: Basic realm="FerrURLMockProxy"\r\n\r\n');
      clientSocket.destroy();
      return;
    }
    const [host, portStr] = (req.url || '').split(':');
    const port = Number(portStr) || 443;
    traffic.push({ kind: 'connect', method: 'CONNECT', url: req.url, time: Date.now() });
    const serverSocket = net.connect(port, host, () => {
      clientSocket.write('HTTP/1.1 200 Connection Established\r\n\r\n');
      if (head?.length) serverSocket.write(head);
      serverSocket.pipe(clientSocket);
      clientSocket.pipe(serverSocket);
    });
    serverSocket.on('error', () => clientSocket.destroy());
    clientSocket.on('error', () => serverSocket.destroy());
  });

  server.traffic = traffic;
  return server;
}

if (import.meta.url === `file://${process.argv[1].replace(/\\/g, '/')}` || process.argv[1]?.endsWith('mock-proxy\\proxy.mjs') || process.argv[1]?.endsWith('mock-proxy/proxy.mjs')) {
  const srv = createMockProxy();
  srv.listen(PORT, HOST, () => {
    console.log(`[mock-proxy] escuchando en http://${HOST}:${PORT} (user=${PROXY_USER})`);
  });
}
