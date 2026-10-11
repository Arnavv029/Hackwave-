import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ProviderClient } from '../../src/observation/provider-client.js';

/** Raw HTTP fixtures the Express mocks cannot produce (chunked bodies, non-JSON). */
let server: Server;
let base: string;
beforeAll(async () => {
  server = createServer((req, res) => {
    if (req.url === '/chunked') {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.write('{"padding":"');
      let sent = 0;
      const push = (): void => {
        if (sent >= 300_000) {
          res.end('"}');
          return;
        }
        sent += 10_000;
        res.write('x'.repeat(10_000), push);
      };
      push();
      return;
    }
    if (req.url === '/html') {
      res.writeHead(200, { 'content-type': 'text/html' });
      res.end('<html>Bearer abcdef123456</html>');
      return;
    }
    if (req.url === '/empty') {
      res.writeHead(204);
      res.end();
      return;
    }
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end('{"ok":true}');
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(async () => {
  server.closeAllConnections();
  await new Promise<void>((r) => server.close(() => r()));
});

const client = new ProviderClient();
const call = (path: string, maxResponseBytes = 64 * 1024, timeoutMs = 1_000) =>
  client.call({ method: 'GET', url: `${base}${path}`, timeoutMs, maxResponseBytes });

describe('ProviderClient', () => {
  it('returns status, headers and body for a normal response', async () => {
    const r = await call('/ok');
    expect(r.status).toBe(200);
    expect(r.failure).toBeNull();
    expect(r.bodyText).toBe('{"ok":true}');
    expect(r.bodyBytes).toBe(11);
    expect(Object.fromEntries(r.headers)['content-type']).toBe('application/json');
  });

  it('stops reading a chunked body at the byte cap', async () => {
    const r = await call('/chunked', 50_000);
    expect(r.status).toBe(200);
    expect(r.truncated).toBe(true);
    expect(r.bodyText).toBe('');
    expect(r.bodyBytes).toBe(50_000);
    expect(r.failure?.category).toBe('RESPONSE_TOO_LARGE');
  });

  it('reads non-JSON and empty bodies without failing', async () => {
    expect((await call('/html')).bodyText).toContain('<html>');
    const empty = await call('/empty');
    expect(empty.status).toBe(204);
    expect(empty.bodyText).toBe('');
  });

  it('reports connection refusal with a null status and never throws', async () => {
    const r = await client.call({ method: 'GET', url: 'http://127.0.0.1:9/x', timeoutMs: 1_000, maxResponseBytes: 1_024 });
    expect(r.status).toBeNull();
    expect(r.failure?.category).toBe('CONNECTION_ERROR');
    expect(r.headers).toEqual([]);
  });
});
