/**
 * `reloadPluginAfterFullDelete` tests (`ol-ppxj.26`, discovered from
 * `ol-1ttf`). No `obsidian` runtime import here — only `import type { App }`,
 * which is erased at compile time — so, unlike `settings-section.ts`, this
 * module IS unit-testable against a plain fake shaped like the undocumented
 * `app.plugins` surface.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { App } from 'obsidian';
import { describe, expect, it, vi } from 'vitest';
import { PLUGIN_ID, reloadPluginAfterFullDelete } from '../../src/privacy/reload-plugin.js';

function fakeApp(plugins?: {
  disablePlugin?: (id: string) => Promise<void>;
  enablePlugin?: (id: string) => Promise<void>;
}): App {
  return { plugins } as unknown as App;
}

describe('PLUGIN_ID', () => {
  it('matches manifest.json — the two must never drift apart', () => {
    const manifestPath = fileURLToPath(new URL('../../manifest.json', import.meta.url));
    const manifest: { id: string } = JSON.parse(readFileSync(manifestPath, 'utf8'));
    expect(PLUGIN_ID).toBe(manifest.id);
  });
});

describe('reloadPluginAfterFullDelete', () => {
  it('disables then enables this plugin, by id, in order', async () => {
    const calls: string[] = [];
    const disablePlugin = vi.fn(async (id: string) => {
      calls.push(`disable:${id}`);
    });
    const enablePlugin = vi.fn(async (id: string) => {
      calls.push(`enable:${id}`);
    });

    await reloadPluginAfterFullDelete(fakeApp({ disablePlugin, enablePlugin }));

    expect(calls).toEqual([`disable:${PLUGIN_ID}`, `enable:${PLUGIN_ID}`]);
  });

  it('uses an explicitly passed plugin id over the default', async () => {
    const disablePlugin = vi.fn(async () => {});
    const enablePlugin = vi.fn(async () => {});

    await reloadPluginAfterFullDelete(fakeApp({ disablePlugin, enablePlugin }), 'some-other-id');

    expect(disablePlugin).toHaveBeenCalledWith('some-other-id');
    expect(enablePlugin).toHaveBeenCalledWith('some-other-id');
  });

  it('resolves without throwing when app.plugins is absent (host removed/renamed the internal API)', async () => {
    await expect(reloadPluginAfterFullDelete(fakeApp(undefined))).resolves.toBeUndefined();
  });

  it('resolves without throwing when disablePlugin/enablePlugin are missing', async () => {
    await expect(reloadPluginAfterFullDelete(fakeApp({}))).resolves.toBeUndefined();
  });

  it('resolves without throwing when disablePlugin itself rejects — a failed reload must never surface as an error out of an already-completed delete', async () => {
    const disablePlugin = vi.fn(async () => {
      throw new Error('boom');
    });
    const enablePlugin = vi.fn(async () => {});

    await expect(
      reloadPluginAfterFullDelete(fakeApp({ disablePlugin, enablePlugin })),
    ).resolves.toBeUndefined();
    expect(enablePlugin).not.toHaveBeenCalled();
  });

  it('resolves without throwing when enablePlugin rejects after a successful disable', async () => {
    const disablePlugin = vi.fn(async () => {});
    const enablePlugin = vi.fn(async () => {
      throw new Error('boom');
    });

    await expect(
      reloadPluginAfterFullDelete(fakeApp({ disablePlugin, enablePlugin })),
    ).resolves.toBeUndefined();
    expect(disablePlugin).toHaveBeenCalled();
  });
});
