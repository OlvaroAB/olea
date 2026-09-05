/**
 * `ol-3ux7.64.3` [WBX-2] — unit tests for the whole-plugin-mount additions to
 * `src/obsidian-shim/` (`docs/dev/simulator-design.md` §4 in olea-service).
 *
 * **Scope note, since it looks like a gap otherwise.** This package's vitest
 * config runs under plain Node with no DOM (verified: `packages/workbench`
 * has no `jsdom`/`happy-dom` dependency, and no existing spec here ever
 * touches `document` — `today.spec.ts`'s own doc calls this "node-side
 * checks... rendering is checked by looking at it, and later by WB-2").
 * `docs/dev/simulator-design.md` §6 and `features/F9-simulator.md` agree:
 * F9.S3's own scenarios are tagged `@auto-web` (a Playwright spec over a real
 * browser, WBX-5's job), never `@auto` — DOM assembly was never meant to be
 * proven by this file. So every shim class below was deliberately built with
 * its DOM construction LAZY (see `Plugin.rootEl`'s and `Workspace.containerEl`'s
 * own doc comments): what follows exercises the bookkeeping — commands,
 * views, vault index, event lifecycle, `loadData`/`saveData` — with zero
 * `document` access, and is honest about the one thing it does NOT prove
 * (rendered pixels, palette DOM, tab strip DOM).
 */

import { describe, expect, it, vi } from 'vitest';
import OleaPlugin from '../../plugin/src/main.js';
import {
  App,
  type Command,
  Component,
  createInMemoryPluginDataStore,
  DEFAULT_MANIFEST,
  type EventRef,
  type ItemView,
  MetadataCache,
  Notice,
  Plugin,
  type ShimVaultEvent,
  type ShimVaultSource,
  TFile,
  TFolder,
  Vault,
  type ViewFactory,
  type WorkspaceLeaf,
} from '../src/obsidian-shim/index.js';
import { mountPlugin } from '../src/obsidian-shim/mount-plugin.js';

void Notice; // re-exported and used elsewhere in this package — imported here only to prove `export *` still carries it.

/** A tiny in-memory `ShimVaultSource`, independent of `MemoryVaultSource` (that class lives outside this bead's owned paths) — exactly the shape `Vault`/`adapter` need, built for these tests only. */
function createTestVaultSource(seed: Record<string, string> = {}): ShimVaultSource & {
  readonly writes: string[];
} {
  const files = new Map<string, string>(Object.entries(seed));
  const watchers = new Set<(event: ShimVaultEvent) => void>();
  const writes: string[] = [];
  const emit = (event: ShimVaultEvent) => {
    for (const watcher of watchers) watcher(event);
  };
  return {
    writes,
    list: ({ under, extensions } = {}) => {
      const results = [...files.keys()]
        .filter((path) => under === undefined || path === under || path.startsWith(`${under}/`))
        .filter((path) => {
          if (extensions === undefined) return true;
          const dot = path.lastIndexOf('.');
          const ext = dot > 0 ? path.slice(dot + 1).toLowerCase() : undefined;
          return ext !== undefined && extensions.includes(ext);
        })
        .sort();
      return Promise.resolve(results);
    },
    read: (path) => {
      const content = files.get(path);
      return content === undefined
        ? Promise.reject(new Error(`no such file: ${path}`))
        : Promise.resolve(content);
    },
    readBinary: (path) => {
      const content = files.get(path);
      if (content === undefined) return Promise.reject(new Error(`no such file: ${path}`));
      return Promise.resolve(new TextEncoder().encode(content));
    },
    write: (path, content) => {
      const existed = files.has(path);
      files.set(path, content);
      writes.push(path);
      emit({ kind: existed ? 'modify' : 'create', path });
      return Promise.resolve();
    },
    exists: (path) => Promise.resolve(files.has(path)),
    delete: (path) => {
      const existed = files.delete(path);
      if (existed) emit({ kind: 'delete', path });
      return Promise.resolve();
    },
    watch: (handler) => {
      watchers.add(handler);
      return () => watchers.delete(handler);
    },
  };
}

describe('Vault (over an injected ShimVaultSource)', () => {
  it('seeds getFileByPath/getFiles synchronously once ready() resolves', async () => {
    const source = createTestVaultSource({ 'a.md': 'one', 'folder/b.md': 'two' });
    const vault = new Vault(source);
    expect(vault.getFileByPath('a.md')).toBeNull(); // cold before ready()
    await vault.ready();
    expect(vault.getFileByPath('a.md')).toBeInstanceOf(TFile);
    expect(
      vault
        .getFiles()
        .map((file) => file.path)
        .sort(),
    ).toEqual(['a.md', 'folder/b.md']);
    expect(vault.getFolderByPath('folder')).toBeInstanceOf(TFolder);
    expect(vault.getFolderByPath('nonexistent')).toBeNull();
    expect(vault.getFolderByPath('')).toBeInstanceOf(TFolder); // root always exists
  });

  it('read/modify/create round-trip through the injected source, and getFileByPath sees a create immediately (watch is synchronous)', async () => {
    const source = createTestVaultSource();
    const vault = new Vault(source);
    await vault.ready();

    const created = await vault.create('new.md', 'hello');
    expect(await vault.read(created)).toBe('hello');
    expect(vault.getFileByPath('new.md')).toBe(created); // same identity, not a second TFile

    await vault.modify(created, 'hello again');
    expect(await vault.read(created)).toBe('hello again');
  });

  it('on()/offref() fire create/modify/delete and never fire for a rename (declared for typecheck parity, never emitted)', async () => {
    const source = createTestVaultSource();
    const vault = new Vault(source);
    await vault.ready();

    const seen: string[] = [];
    const createRef = vault.on('create', (file) => seen.push(`create:${file.path}`));
    vault.on('modify', (file) => seen.push(`modify:${file.path}`));
    vault.on('delete', (file) => seen.push(`delete:${file.path}`));
    vault.on('rename', () => seen.push('rename'));

    await vault.create('x.md', '1');
    await vault.modify(vault.getFileByPath('x.md') as TFile, '2');
    await source.delete('x.md');
    vault.offref(createRef);
    await vault.create('y.md', '3'); // create handler was unsubscribed — should not appear

    expect(seen).toEqual(['create:x.md', 'modify:x.md', 'delete:x.md']);
  });

  it('adapter.exists/adapter.list answer for an implicit dot-folder, matching what ObsidianSource.listUnder needs', async () => {
    const source = createTestVaultSource({
      '.olea/reviews/device-a.jsonl': '{}',
      '.olea/reviews/device-b.jsonl': '{}',
      '.olea/misconceptions/x.json': '{}',
      'ordinary.md': 'content',
    });
    const vault = new Vault(source);
    await vault.ready();

    await expect(vault.adapter.exists('.olea/reviews')).resolves.toBe(true);
    await expect(vault.adapter.exists('.olea/nonexistent')).resolves.toBe(false);

    const listing = await vault.adapter.list('.olea');
    expect(listing.folders.sort()).toEqual(['.olea/misconceptions', '.olea/reviews']);
    expect(listing.files).toEqual([]);

    const reviews = await vault.adapter.list('.olea/reviews');
    expect(reviews.files.sort()).toEqual([
      '.olea/reviews/device-a.jsonl',
      '.olea/reviews/device-b.jsonl',
    ]);

    await vault.adapter.remove('.olea/reviews/device-a.jsonl');
    await expect(source.exists('.olea/reviews/device-a.jsonl')).resolves.toBe(false);
  });

  it('a dot-path (.olea/…) never surfaces as a TFile via getFiles() and never fires create/modify/delete — matching real Obsidian (ol-3ux7.64.21)', async () => {
    const source = createTestVaultSource({
      '.olea/reviews/device-a.jsonl': '{}',
      'ordinary.md': 'content',
    });
    const vault = new Vault(source);
    await vault.ready();

    // Seeded at construction: getFiles() must already exclude it, same as
    // a fresh mount that reuses persisted .olea/ content from a prior day.
    expect(vault.getFiles().map((file) => file.path)).toEqual(['ordinary.md']);

    const seen: string[] = [];
    vault.on('create', (file) => seen.push(`create:${file.path}`));
    vault.on('modify', (file) => seen.push(`modify:${file.path}`));
    vault.on('delete', (file) => seen.push(`delete:${file.path}`));

    // A second "rating" appending to the same review-log path (create, then
    // modify) must not grow getFiles() and must not emit either event — the
    // old behaviour (pre-ol-3ux7.64.21) tracked every written path in
    // filesByPath and emitted for it unconditionally, which is exactly what
    // made a review rating look like a plugin-visible vault change.
    await vault.create('.olea/reviews/device-b.jsonl', '{"a":1}\n');
    await vault.modify(
      vault.getFileByPath('.olea/reviews/device-b.jsonl') as TFile,
      '{"a":1}\n{"b":2}\n',
    );
    await source.delete('.olea/reviews/device-a.jsonl');

    expect(vault.getFiles().map((file) => file.path)).toEqual(['ordinary.md']);
    expect(seen).toEqual([]);

    // Read/write correctness through the TFile-based API (what
    // ObsidianSource.read/.write/.exists — the plugin's only mechanism for
    // .olea/ content — actually calls) must still work: getFileByPath keeps
    // resolving a dot-path so a second write appends rather than silently
    // overwriting.
    const file = vault.getFileByPath('.olea/reviews/device-b.jsonl');
    expect(file).toBeInstanceOf(TFile);
    expect(await vault.read(file as TFile)).toBe('{"a":1}\n{"b":2}\n');

    // An ordinary file is unaffected: still tracked, still emits.
    await vault.create('ordinary2.md', 'x');
    expect(seen).toEqual(['create:ordinary2.md']);
  });

  it('dispose() unsubscribes from the source — a watch fired after dispose never reaches a listener', async () => {
    const source = createTestVaultSource();
    const vault = new Vault(source);
    await vault.ready();
    const seen: string[] = [];
    vault.on('create', (file) => seen.push(file.path));
    vault.dispose();
    await source.write('after-dispose.md', 'x');
    expect(seen).toEqual([]);
  });
});

describe('MetadataCache', () => {
  it("reads a plain scalar frontmatter block and exposes it via getCache(path)?.frontmatter, matching classify-passage.ts's roleFromFrontmatter", async () => {
    const source = createTestVaultSource({
      'instructor-note.md': '---\nrole: instructor\n---\n\nBody text.',
      'no-frontmatter.md': 'Just a body.',
    });
    const vault = new Vault(source);
    await vault.ready();
    const metadataCache = new MetadataCache(vault);
    await metadataCache.warm();

    expect(metadataCache.getCache('instructor-note.md')?.frontmatter?.role).toBe('instructor');
    expect(metadataCache.getCache('no-frontmatter.md')).toBeNull();
    expect(metadataCache.getCache('never-seen.md')).toBeNull();
  });

  it('updates on modify and clears on delete', async () => {
    const source = createTestVaultSource({ 'note.md': '---\nrole: hers\n---\n' });
    const vault = new Vault(source);
    await vault.ready();
    const metadataCache = new MetadataCache(vault);
    await metadataCache.warm();
    expect(metadataCache.getCache('note.md')?.frontmatter?.role).toBe('hers');

    await vault.modify(vault.getFileByPath('note.md') as TFile, '---\nrole: instructor\n---\n');
    // `MetadataCache.refresh` is fire-and-forget off the `modify` event — flush microtasks.
    await Promise.resolve();
    await Promise.resolve();
    expect(metadataCache.getCache('note.md')?.frontmatter?.role).toBe('instructor');

    await source.delete('note.md');
    await Promise.resolve();
    expect(metadataCache.getCache('note.md')).toBeNull();
  });
});

describe('App', () => {
  it('the two pre-existing zero-arg call sites keep working: new App() over an empty vault never throws', async () => {
    const app = new App();
    expect(app.vault.getFileByPath('anything.md')).toBeNull();
    // Never calling ready() (as plugin-surface-scenarios.ts/explain-back-scenarios.ts do today) is fine — an unready Vault just answers "nothing here".
    await expect(app.vault.read(new TFile('missing.md'))).rejects.toThrow();
  });
});

describe('Component (register/registerEvent/registerInterval/onunload)', () => {
  it('unloadComponent() calls onunload() then drains every register()/registerEvent()/registerInterval() cleanup', async () => {
    class TestComponent extends Component {
      unloaded = false;
      override onunload(): void {
        this.unloaded = true;
      }
    }
    const component = new TestComponent();
    const registerCleanup = vi.fn();
    component.register(registerCleanup);

    let unsubscribed = false;
    const ref: EventRef = { unsubscribe: () => (unsubscribed = true) };
    component.registerEvent(ref);

    // A real timer, so clearing it is independently verifiable (no `window` reference needed — see `Component.unloadComponent`'s own comment).
    let fired = false;
    const intervalId = setInterval(() => {
      fired = true;
    }, 10);
    component.registerInterval(intervalId as unknown as number);

    component.unloadComponent();

    expect(component.unloaded).toBe(true);
    expect(registerCleanup).toHaveBeenCalledOnce();
    expect(unsubscribed).toBe(true);
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(fired).toBe(false); // the interval was cleared at teardown
  });

  it('a cleanup that throws does not stop the rest from running', () => {
    class TestComponent extends Component {}
    const component = new TestComponent();
    const second = vi.fn();
    component.register(() => {
      throw new Error('boom');
    });
    component.register(second);
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(() => component.unloadComponent()).not.toThrow();
    expect(second).toHaveBeenCalledOnce();
    consoleSpy.mockRestore();
  });
});

describe('Plugin (commands/palette bookkeeping, registerView, settings tab, loadData/saveData) — no DOM touched', () => {
  function buildPlugin(): Plugin {
    return new Plugin(new App(), DEFAULT_MANIFEST, createInMemoryPluginDataStore());
  }

  it('addCommand + invokeCommand runs the callback, pure bookkeeping (no document access)', () => {
    const plugin = buildPlugin();
    const callback = vi.fn();
    const command: Command = { id: 'olea-test', name: 'Olea: Test', callback };
    plugin.addCommand(command);

    expect(plugin.invokeCommand('olea-test')).toBe(true);
    expect(callback).toHaveBeenCalledOnce();
    expect(plugin.invokeCommand('no-such-command')).toBe(false);
  });

  it("a checkCallback returning false hides the command from invocation, matching Obsidian's own checking semantics", () => {
    const plugin = buildPlugin();
    let visible = false;
    const checkCallback = vi.fn((checking: boolean) => {
      if (checking) return visible;
      return true;
    });
    plugin.addCommand({ id: 'olea-conditional', name: 'Olea: Conditional', checkCallback });

    expect(plugin.invokeCommand('olea-conditional')).toBe(false);
    visible = true;
    expect(plugin.invokeCommand('olea-conditional')).toBe(true);
    // Real Obsidian calls checkCallback(true) then checkCallback(false) on an actual invocation.
    expect(checkCallback).toHaveBeenCalledWith(true);
    expect(checkCallback).toHaveBeenCalledWith(false);
  });

  it("registerView + a leaf's setViewState mounts the registered view and getLeavesOfType/detachLeavesOfType see it — a fake ItemView stands in for a real one so this needs no DOM", async () => {
    const plugin = buildPlugin();
    const opened: string[] = [];
    const closed: string[] = [];

    function fakeView(leaf: WorkspaceLeaf): ItemView {
      return {
        leaf,
        containerEl: { remove: () => {} } as unknown as HTMLElement,
        contentEl: {} as HTMLElement,
        navigation: true,
        getViewType: () => 'olea-test-view',
        getDisplayText: () => 'Test view',
        getIcon: () => 'document',
        onOpen: () => {
          opened.push('open');
          return Promise.resolve();
        },
        onClose: () => {
          closed.push('close');
          return Promise.resolve();
        },
        registerDomEvent: () => {},
        register: () => {},
        registerEvent: () => {},
        registerInterval: (id: number) => id,
        onload: () => {},
        onunload: () => {},
        unloadComponent: () => {},
      } as unknown as ItemView;
    }
    const factory: ViewFactory = (leaf) => fakeView(leaf);
    plugin.registerView('olea-test-view', factory);

    const leaf = plugin.app.workspace.getLeaf('tab');
    expect(plugin.app.workspace.getLeavesOfType('olea-test-view')).toEqual([]);
    await leaf.setViewState({ type: 'olea-test-view', active: true });
    expect(opened).toEqual(['open']);
    expect(plugin.app.workspace.getLeavesOfType('olea-test-view')).toEqual([leaf]);

    await plugin.app.workspace.revealLeaf(leaf);
    expect(plugin.app.workspace.revealedCount).toBe(1);

    plugin.app.workspace.detachLeavesOfType('olea-test-view');
    expect(closed).toEqual(['close']);
    expect(plugin.app.workspace.getLeavesOfType('olea-test-view')).toEqual([]);
  });

  it("loadData/saveData round-trip through the injected PluginDataStore, matching ensureDeviceId's narrow ObsidianDataHost port", async () => {
    const plugin = buildPlugin();
    expect(await plugin.loadData()).toBeNull();
    await plugin.saveData({ deviceId: 'olea-abc123' });
    expect(await plugin.loadData()).toEqual({ deviceId: 'olea-abc123' });
  });

  it('addSettingTab stores the tab without touching DOM until openSettingsRoute is called', () => {
    const plugin = buildPlugin();
    const display = vi.fn();
    plugin.addSettingTab({
      display,
      hide: () => {},
      app: plugin.app,
      containerEl: {} as HTMLElement,
    });
    // No `document` access happened above — `display()` is only called once DOM is actually requested.
    expect(display).not.toHaveBeenCalled();
  });
});

describe("mountPlugin (plugin-bridge.ts's exported entry point)", () => {
  class FakePlugin extends Plugin {
    loaded = false;
    unloaded = false;

    override async onload(): Promise<void> {
      this.loaded = true;
      this.addCommand({ id: 'fake-command', name: 'Fake command', callback: () => {} });
      await this.saveData({ minted: true });
    }

    override onunload(): void {
      this.unloaded = true;
    }
  }

  it('constructs the app, warms the vault + metadata cache before onload, awaits onload, and unmount() tears down cleanly', async () => {
    const source = createTestVaultSource({ 'seed.md': '---\nrole: hers\n---\n' });
    const mounted = await mountPlugin(FakePlugin, { vault: source });

    expect(mounted.plugin.loaded).toBe(true);
    // The vault was warm BEFORE onload ran, matching a real Obsidian host.
    expect(mounted.app.vault.getFileByPath('seed.md')).toBeInstanceOf(TFile);
    expect(mounted.app.metadataCache.getCache('seed.md')?.frontmatter?.role).toBe('hers');
    expect(await mounted.plugin.loadData()).toEqual({ minted: true });
    expect(mounted.plugin.invokeCommand('fake-command')).toBe(true);

    await mounted.unmount();
    expect(mounted.plugin.unloaded).toBe(true);

    // The injected source is reused (§3's persisted-vault reuse across a remount) —
    // unmount() must have unsubscribed, or this write would still reach the old Vault's index.
    await source.write('after-unmount.md', 'x');
    expect(mounted.app.vault.getFileByPath('after-unmount.md')).toBeNull();
  });

  it('mounts over an empty vault when no deps are given at all', async () => {
    const mounted = await mountPlugin(FakePlugin);
    expect(mounted.plugin.loaded).toBe(true);
    expect(mounted.app.vault.getFiles()).toEqual([]);
  });
});

describe('the real OleaPlugin constructs over this shim (type + basic construction proof)', () => {
  it("new OleaPlugin(app, manifest, dataStore) does not throw — proves the shim's App/Plugin/Vault/TFile/Platform surface is what packages/plugin/src/main.ts compiles against", () => {
    const app = new App();
    const plugin = new OleaPlugin(app, DEFAULT_MANIFEST, createInMemoryPluginDataStore());
    expect(plugin).toBeInstanceOf(Plugin);
    expect(plugin.manifest.id).toBe('olea');
  });

  // `onload()` itself is NOT exercised here: `main.ts` calls the bare global
  // `window.setInterval`/`navigator.onLine` directly (not through this
  // shim — grep confirmed before writing this test), and this package's
  // vitest config runs under plain Node with neither global defined. That is
  // an environment gap between "plain Node" and "a real browser," not a gap
  // in this shim: `docs/dev/simulator-design.md` §6 and F9.S3's own
  // `@auto-web` tag already route the full-mount-and-onload proof to WBX-5's
  // Playwright suite, which runs in a real browser where both globals exist.
});
