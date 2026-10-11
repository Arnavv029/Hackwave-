/// <reference types="vitest/config" />
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';
import { defineConfig, loadEnv } from 'vite';

// All /api traffic is proxied to the DriftGuard backend in development, so the
// browser talks to a single origin and no token ever lives in this bundle.
// One throttled line when the backend is down instead of a stack trace per request;
// the dashboard itself shows a "backend unreachable" banner with a retry button.
let lastProxyWarning = 0;
const quietProxy = (proxy: { on: (event: 'error', handler: (err: Error, req: { url?: string }, res: { writableEnded?: boolean; headersSent?: boolean; writeHead?: (code: number, headers: Record<string, string>) => void; end?: (body: string) => void }) => void) => void }) => {
  proxy.on('error', (err, req, res) => {
    const now = Date.now();
    if (now - lastProxyWarning > 5_000) {
      lastProxyWarning = now;
      console.warn(`[proxy] backend unreachable (${err.message}); is it running on 3000? Start it with \`npm run dev\` in Hackwave/Backend. Will keep retrying.`);
    }
    if (res && !res.headersSent && res.writeHead && res.end) {
      res.writeHead(503, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ error: { code: 'BACKEND_UNREACHABLE', message: `Backend unreachable at ${req.url ?? ''}: ${err.message}` } }));
    }
  });
};

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, '.', '');
  const backend = env['VITE_BACKEND_PROXY_TARGET'] || 'http://127.0.0.1:3000';
  return {
    plugins: [react(), tailwindcss()],
    resolve: { alias: { '@': path.resolve(import.meta.dirname, '.') } },
    server: {
      port: 5173,
      host: '0.0.0.0',
      proxy: {
        '/api': { target: backend, changeOrigin: true, configure: quietProxy },
        '/health': { target: backend, changeOrigin: true, configure: quietProxy },
      },
    },
    build: { sourcemap: true },
    test: { environment: 'jsdom', setupFiles: ['./tests/setup.ts'], include: ['tests/**/*.test.{ts,tsx}'], css: false },
  };
});
