/**
 * The closest thing to an install test that exists without Obsidian.
 *
 * `main-wiring.spec.ts` asserts the *source* of `main.ts`, because `main.ts`
 * imports `obsidian`, whose published `package.json` has `"main": ""` — there is
 * nothing to load, so the module cannot be imported under Vitest at all. That
 * constraint holds for the TypeScript source and only for the TypeScript source.
 * The thing that actually ships is `main.js`, the esbuild bundle, and it does not
 * import `obsidian`: `obsidian` is an esbuild **external** (`esbuild.config.mjs`),
 * so the bundle reaches it through a plain CommonJS `require("obsidian")` that a
 * `Module._load` hook can answer. What follows is therefore a real load and a real
 * `onload()`, against the built artifact BRAT installs.
 *
 * What that buys, beyond what a source-level regex can see:
 *
 * - the bundle is syntactically valid CommonJS that Node can evaluate at all — a
 *   broken or truncated build fails here rather than in her vault;
 * - its default export really is a class extending Obsidian's `Plugin`, which is
 *   the one contract Obsidian itself checks when it loads a plugin;
 * - `onload()` runs to completion and registers all five view types and all
 *   seven commands (P2-T10's acceptance criterion, plus `ol-f77commands`,
 *   `ol-2tyj`, `ol-p5t06b` and `ol-jie3`'s later additions), through the
 *   *bundled* code path rather than the source one, so a tree-shaking or
 *   bundling regression that dropped a registration would be caught.
 *
 * What it still cannot check stays `@manual` — whether Obsidian's real workspace
 * then does what its API documents, and whether BRAT's download-and-install path
 * works in a real vault (`ol-bratverify`).
 *
 * The stub below is deliberately small. The bundle touches exactly seven
 * `obsidian` exports (`Plugin`, `PluginSettingTab`, `ItemView`, `Notice`,
 * `Setting`, `TFile`, `Platform`), which is why this is a fake worth having;
 * if that surface grows into something that has to imitate Obsidian's
 * behaviour rather than merely exist, this test should be deleted rather
 * than grown. `Modal` briefly belonged to this list (`ol-odb0`'s
 * `DraftCardsModal`) and left it when that command was withdrawn — F4.5
 * rules out a student-invoked draft verb by name, and the command and its
 * modal shipped contrary to that clause and were struck (wave-2 round-2
 * correction).
 *
 * **Never skipped.** This was `describe.skipIf(!bundleBuilt)` until run 11. `main.js`
 * is gitignored, so on a clean checkout there was nothing to load and the whole
 * file skipped — silently, exit 0, green. Reproduced before the change: moving
 * `main.js` aside left the plugin suite at `26 passed | 1 skipped`. The one check
 * that distinguishes a real plugin from scaffolding therefore could not fail, which
 * is N-013 exactly, and it stayed that way for weeks because `ci.yml` also ran
 * `test` before `build`. CI builds first now; a missing bundle is an assertion
 * failure in `bundle-freshness.spec.ts` naming the remedy, not a skip.
 *
 * **What this file still cannot see on its own:** whether `main.js` is the CURRENT
 * build. It loads whatever is on disk, so every assertion below is a claim about
 * that artifact and not about the source it was built from — edit `src/` without
 * rebuilding and these two tests happily certify yesterday's bundle. That is the
 * remaining half of ol-wfze and it is held down next door, in
 * `bundle-freshness.spec.ts`, which fails when any bundled source is newer than
 * the bundle. The two files are one guard: this one asks "is the artifact right?",
 * that one asks "is it the artifact you think?".
 */

import { existsSync } from 'node:fs';
import Module from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const bundlePath = join(dirname(fileURLToPath(import.meta.url)), '..', 'main.js');

/** Minimal stand-ins for the seven `obsidian` exports the bundle actually names. */
class FakePlugin {
  data: unknown = null;
  readonly views: { type: string; factory: (leaf: unknown) => unknown }[] = [];
  readonly commands: { id: string; name: string }[] = [];
  readonly settingTabs: unknown[] = [];
  readonly intervals: number[] = [];
  readonly registeredCleanups: (() => unknown)[] = [];

  constructor(
    readonly app: unknown,
    readonly manifest: unknown,
  ) {}

  addSettingTab(tab: unknown): void {
    this.settingTabs.push(tab);
  }
  registerView(type: string, factory: (leaf: unknown) => unknown): void {
    this.views.push({ type, factory });
  }
  addCommand(command: { id: string; name: string }): void {
    this.commands.push(command);
  }
  registerInterval(id: number): number {
    this.intervals.push(id);
    return id;
  }
  // `Component.register` (real Obsidian): an arbitrary teardown callback run
  // on unload — `main.ts` uses it for the keyword index's vault-event
  // unsubscribe (`ol-tuvx`).
  register(cb: () => unknown): void {
    this.registeredCleanups.push(cb);
  }
  async loadData(): Promise<unknown> {
    return this.data;
  }
  async saveData(data: unknown): Promise<void> {
    this.data = data;
  }
}

class FakePluginSettingTab {
  constructor(
    readonly app: unknown,
    readonly plugin: unknown,
  ) {}
}
class FakeItemView {
  constructor(readonly leaf: unknown) {}
}
const notices: string[] = [];
class FakeNotice {
  constructor(message: string) {
    notices.push(message);
  }
}
class FakeSetting {}
class FakeTFile {}

const obsidianStub = {
  Plugin: FakePlugin,
  PluginSettingTab: FakePluginSettingTab,
  ItemView: FakeItemView,
  Notice: FakeNotice,
  Setting: FakeSetting,
  TFile: FakeTFile,
  Platform: { isMobile: false },
};

/** An `App` that answers "empty vault, no open leaves" to everything `onload` asks it. */
function fakeApp(): unknown {
  return {
    vault: {
      getFiles: () => [],
      getMarkdownFiles: () => [],
      getAbstractFileByPath: () => null,
      read: async () => '',
      create: async () => ({}),
      modify: async () => {},
      adapter: {
        exists: async () => false,
        read: async () => '',
        write: async () => {},
      },
      // `ObsidianSource.watch` (`ol-tuvx`'s keyword-index wiring calls it at
      // onload) subscribes to all four vault events and later unrefs them —
      // never fired by this fake (empty vault), but both methods must exist.
      on: () => ({}),
      offref: () => {},
    },
    workspace: {
      getLeavesOfType: () => [],
      getLeaf: () => null,
      getRightLeaf: () => null,
      revealLeaf: async () => {},
    },
    metadataCache: { getFileCache: () => null },
  };
}

type LoadHook = (request: string, parent: unknown, isMain: boolean) => unknown;
interface ModuleInternals {
  _load: LoadHook;
  createRequire: typeof Module.createRequire;
}

/** Loads the built bundle with `require("obsidian")` answered by the stub, then restores Node's loader. */
function loadBundle(): { default: new (app: unknown, manifest: unknown) => FakePlugin } {
  // A plain `require` of a missing file raises MODULE_NOT_FOUND, which reads like
  // a broken test rather than an unbuilt tree. Say what actually happened.
  if (!existsSync(bundlePath)) {
    throw new Error(
      'packages/plugin/main.js does not exist, so the built bundle cannot be tested — ' +
        'run `pnpm run build` from the repo root, then re-run the tests. ' +
        'This used to be a silent skip (ol-wfze).',
    );
  }
  const internals = Module as unknown as ModuleInternals;
  const original = internals._load;
  internals._load = function patched(request, parent, isMain) {
    if (request === 'obsidian') return obsidianStub;
    return original.call(this, request, parent, isMain);
  };
  try {
    const requireFromHere = internals.createRequire(import.meta.url);
    return requireFromHere(bundlePath);
  } finally {
    internals._load = original;
  }
}

describe('the built bundle is what Obsidian can load', () => {
  it('is valid CommonJS and default-exports a class extending Plugin', () => {
    const exported = loadBundle();
    expect(typeof exported.default).toBe('function');
    expect(exported.default.prototype).toBeInstanceOf(FakePlugin);
  });

  it('registers all five view types and all seven commands when onload runs', async () => {
    const OleaPlugin = loadBundle().default;
    // `registerInterval(window.setInterval(...))` — Obsidian's host is a browser
    // window; Node's is not, so this is the one global the bundle needs supplied.
    const previousWindow = (globalThis as { window?: unknown }).window;
    (globalThis as { window?: unknown }).window = {
      setInterval: () => 1,
      clearInterval: () => {},
    };
    try {
      const plugin = new OleaPlugin(fakeApp(), { id: 'olea', version: '0.9.0-alpha.2' });
      await (plugin as unknown as { onload(): Promise<void> }).onload();

      expect(plugin.views.map((view) => view.type).sort()).toEqual([
        // `ol-jie3`: F3.3's bulk-review triage path, list density over the
        // same accept/edit/reject resolution `olea-review` offers.
        'olea-bulk-review',
        'olea-gap',
        'olea-review',
        // `ol-p5t06b`: the session builder (F4.6/F4.7/F4.8), the destination
        // the gap view's `build-session` affordance had been advertising and
        // not reaching since P5-T06a.
        'olea-session-builder',
        'olea-today',
      ]);
      // `olea-open` is D-033's front door: "open Olea" and "open today" are two
      // palette doors onto the same Today panel, deliberately sharing a handler.
      // Asserting the exact set rather than a count is what makes this fail if a
      // command is added without a decision behind it — which is how it caught
      // `olea-open` arriving in the same run this spec first ran, and `olea-gap-
      // open` (`ol-2tyj`) here.
      expect(plugin.commands.map((command) => command.id).sort()).toEqual([
        // `ol-jie3`: F3.3's bulk-review triage path, click-only this round
        // (`ol-uxk9` is the keyboard-bindings follow-up).
        'olea-bulk-review-open',
        'olea-create-card',
        // 'olea-draft-cards' was withdrawn (F4.5, wave-2 round-2 correction):
        // no student-invoked draft verb, because Olea is already drafting.
        'olea-gap-open',
        'olea-open',
        'olea-review-start',
        // `ol-p5t06b`, and F4.6 is the decision behind it: "Build a 20-minute
        // session" is a thing she asks for directly, not only a follow-on from
        // reading the gap view.
        'olea-session-build',
        'olea-today-open',
      ]);
      // No command promises contextual AI before it exists (D-033).
      expect(plugin.commands.map((command) => command.name).join(' ')).not.toMatch(/explain/i);
      expect(plugin.settingTabs).toHaveLength(1);
      // The ingestion tick (D-002) is registered through `registerInterval`, so
      // Obsidian clears it on unload rather than it outliving the plugin.
      expect(plugin.intervals).toHaveLength(1);
      // Both registered views construct — a factory that throws would leave her
      // with an empty tab and no error she could act on.
      for (const view of plugin.views) {
        expect(view.factory({})).toBeInstanceOf(FakeItemView);
      }
    } finally {
      (globalThis as { window?: unknown }).window = previousWindow;
    }
  });
});
