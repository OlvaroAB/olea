import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    // The same redirect tsconfig.json's `paths` and build.mjs's esbuild alias do.
    // Nothing under packages/workbench imports `obsidian`; the plugin sources this
    // package pulls in do, and they resolve to the chrome shim here too.
    alias: {
      obsidian: fileURLToPath(new URL('./src/obsidian-shim/index.ts', import.meta.url)),
    },
  },
  test: {
    include: ['test/**/*.spec.ts'],
    exclude: ['**/node_modules/**', '**/dist/**'],
    /**
     * Vitest's 5s default is wrong for this package specifically, and the failure
     * it produced was the expensive kind: a load-sensitive red that says nothing
     * about the code under test.
     *
     * `test/build-stamp.spec.ts` asserts on `build.mjs` by SPAWNING it — that is
     * the point of it, since a stamp only the test harness could produce would not
     * be evidence about the real build. Several cases spawn it two or three times
     * (a production build, a development build, then `verify`). Each spawn is a
     * fresh node process doing a real esbuild bundle and a 52-file fixture copy, so
     * the cost is seconds, not milliseconds, and it scales with whatever else the
     * machine is doing.
     *
     * Run 15 hit exactly that: the two heaviest cases (three spawns each) timed out
     * at 5s under a full `pnpm -r test`, while the same cases pass in isolation.
     * Nothing was broken. But `pnpm -r` stops at the first failing package, so a
     * spurious red here hides every later package's result — and these two had in
     * fact been invisible behind an unrelated stale-bundle failure in
     * `packages/plugin` until that one was fixed.
     *
     * 60s is deliberately far above the observed cost rather than tuned close to
     * it: a timeout set near the real duration reintroduces the same flake on a
     * busier machine. This weakens no assertion — a genuine hang still fails, just
     * later. Same family as ol-hrmw and ol-q77r.
     */
    testTimeout: 60_000,
  },
});
