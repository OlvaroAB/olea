import { tmpdir } from 'node:os';
import { basename, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

const here = dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  // `ol-ppxj.11` [HOST-1]: cacheDir off the virtiofs mount (measured host
  // defect ol-63et). Does NOT fix the separate `.vite-temp` config-load race
  // — that has no config-file-reachable knob; see the full explanation and
  // residual risk in `packages/core/vitest.config.ts`.
  cacheDir: join(tmpdir(), 'olea-vitest-cache', basename(here)),
  test: {
    include: ['src/**/*.spec.ts'],
    exclude: ['**/node_modules/**', '**/dist/**'],
  },
});
