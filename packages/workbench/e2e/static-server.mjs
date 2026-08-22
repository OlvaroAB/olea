#!/usr/bin/env node
/**
 * Minimal, READ-ONLY static file server for Playwright's `webServer`.
 *
 * Deliberately NOT `build.mjs serve`. That mode owns `dist/`: it watches
 * sources and rewrites the directory on every edit, and a forgotten instance
 * of exactly that process is what overwrote a production bundle after
 * running unnoticed for three days (`ol-m34c`, see the package README's
 * "build stamp" section). This script cannot repeat that failure by
 * construction — it never writes to the directory it serves, never watches
 * anything, and exits the moment Playwright stops it. It also binds a
 * different default port (4322) than `build.mjs`'s dev server (4321), so the
 * two cannot collide even if both were somehow left running.
 *
 * Serves `WB_E2E_DIR` (default `../dist-e2e`, the throwaway artifact
 * `pnpm run e2e:build` writes via `WB_DIST` — never the deployable `dist/`)
 * on `WB_E2E_PORT` (default 4322).
 */
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { dirname, extname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const dir = resolve(here, '..', process.env.WB_E2E_DIR ?? './dist-e2e');
const port = Number(process.env.WB_E2E_PORT ?? 4322);

if (!existsSync(dir)) {
  console.error(
    `workbench e2e server: ${dir} does not exist. Run \`pnpm run e2e:build\` (and ` +
      '`pnpm run e2e:verify`) first — this script only reads an already-built artifact.',
  );
  process.exit(1);
}

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.md': 'text/markdown; charset=utf-8',
};

async function handle(req, res) {
  const url = new URL(req.url ?? '/', 'http://localhost');
  // Fixture paths contain spaces and an ampersand (see the fixture vault
  // README) so the request path arrives percent-encoded.
  const requested = url.pathname === '/' ? '/index.html' : decodeURIComponent(url.pathname);
  const file = join(dir, requested.replace(/^\/+/, ''));
  if (!file.startsWith(dir)) {
    res.writeHead(403).end('forbidden');
    return;
  }
  try {
    const body = await readFile(file);
    res.writeHead(200, { 'content-type': MIME[extname(file)] ?? 'application/octet-stream' });
    res.end(body);
  } catch {
    res.writeHead(404).end('not found');
  }
}

const server = createServer((req, res) => {
  handle(req, res).catch((error) => {
    res.writeHead(500).end('internal error');
    console.error('workbench e2e server:', error);
  });
});

server.listen(port, () => {
  console.log(`workbench e2e server: serving ${dir} at http://127.0.0.1:${String(port)}`);
});
