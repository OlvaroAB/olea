/**
 * Playwright config for WB-2 (`ol-z6x2`): `@auto-web` scenarios and visual
 * regression against the built workbench.
 *
 * CHROMIUM ONLY, DELIBERATELY. The alpha user's actual runtime is Obsidian,
 * which is Electron, which is Chromium — a golden screenshot from a
 * different rendering engine would record what that engine draws, not what
 * her app draws. See the run's decision record for the full argument; this
 * file just encodes the conclusion by declaring exactly one project.
 *
 * WHAT THIS RUNS AGAINST. `pnpm run e2e:build` builds a throwaway production
 * artifact into `./dist-e2e` (via `WB_DIST`, the seam `build.mjs` already
 * exposes for exactly this — see `test/build-stamp.spec.ts` for the same
 * pattern) so this suite never touches the deployable `dist/`. `pnpm run
 * e2e:verify` then reads that artifact's own build stamp back and refuses to
 * proceed unless it is a complete, untampered PRODUCTION build (exit 0) —
 * "build before test", and verified, not merely built.
 *
 * WHO SERVES IT. `e2e/static-server.mjs`, not `build.mjs serve`. `serve`
 * mode watches and rebuilds `dist/` on every source edit, and owning a
 * directory that way is the exact mechanism that once overwrote a
 * production bundle after being left running for three days (`ol-m34c`,
 * see the package README). The e2e server does none of that: it only reads
 * files out of `./dist-e2e`, never writes, never watches, and binds a
 * different default port (4322) than `build.mjs`'s dev server (4321) so the
 * two cannot collide even if both were somehow left running at once.
 */
import { defineConfig, devices } from '@playwright/test';

const PORT = Number(process.env.WB_E2E_PORT ?? 4322);
const DIST_DIR = process.env.WB_DIST ?? './dist-e2e';

export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  ...(process.env.CI ? { workers: 2 } : {}),
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : [['list']],
  timeout: 30_000,
  expect: {
    // A little slack for anti-aliasing / sub-pixel font hinting differences
    // between machines rendering the same Chromium build. NOT slack for a
    // real regression: a broken theme or an unreadable keycap (ol-ro57's
    // shape) changes far more than 1% of the frame. See the harness README
    // note on cross-architecture goldens before trusting a red diff blindly,
    // and before trusting a green one on a machine that never generated the
    // baseline it is compared against.
    toHaveScreenshot: { maxDiffPixelRatio: 0.01, threshold: 0.2 },
  },
  use: {
    baseURL: `http://127.0.0.1:${String(PORT)}`,
    trace: 'retain-on-failure',
    viewport: { width: 1280, height: 832 },
    // The workbench has a fixed clock and fixed content by construction
    // (scenarios.ts / today-scenarios.ts); nothing here needs a real one.
    colorScheme: 'light',
  },
  projects: [
    {
      name: 'chromium',
      // The viewport is repeated here, AFTER the spread, because `devices`
      // carries its own (1280x720) and a spread later in the object wins —
      // so the 832 declared in `use` above had never once taken effect, and
      // every screenshot was really taken at 720 (ol-wzar). 900 rather than
      // 832 because the height has to earn its number: the tallest review
      // state needs 542px of pane, and pane = viewport - inspector - padding.
      // At 832 that arrives at 544, a two-pixel margin that the next slightly
      // longer card would eat silently. pane-fit.spec.ts is the check.
      use: { ...devices['Desktop Chrome'], viewport: { width: 1280, height: 900 } },
    },
  ],
  webServer: {
    command: 'node e2e/static-server.mjs',
    url: `http://127.0.0.1:${String(PORT)}/index.html`,
    reuseExistingServer: !process.env.CI,
    timeout: 15_000,
    env: {
      WB_E2E_DIR: DIST_DIR,
      WB_E2E_PORT: String(PORT),
    },
  },
});
