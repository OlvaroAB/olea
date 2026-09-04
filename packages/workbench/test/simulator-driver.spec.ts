/**
 * `ol-3ux7.64.18.3` [WBX-16c] — unit tests for the four `window.
 * __oleaSimulatorDriver` additions in `simulator/controller.ts`: `explain`,
 * `contest`, `openRegistry` and `runCommand`. Exercised as the exported free
 * functions (`driverExplain`/`driverContest`/`driverOpenRegistry`/
 * `driverRunCommand`), never through `window`, so these stay proper unit
 * tests with a MOCKED `MountedPlugin` rather than a real whole-plugin mount
 * — see `obsidian-shim-whole-plugin.spec.ts`'s own doc: this package's
 * Vitest suite runs under plain Node with no DOM at all, and DOM assembly is
 * proven only by the Playwright specs under `e2e/`.
 *
 * That "no DOM" fact is exactly what lets `contest()`'s "no gesture
 * rendered" case be a unit test at all: `queryShellDom`/`queryModalDom`
 * (`controller.ts`) read a missing `document`/`ownerDocument` as "no such
 * element", the same honest answer a real browser gives when the gesture
 * genuinely never rendered. No fixture/persona content is referenced here
 * (INV-3) — every mocked path/id below is coined for this file.
 */
import { describe, expect, it, vi } from 'vitest';
import type OleaPlugin from '../../plugin/src/main.js';
import type { MountedPlugin } from '../src/obsidian-shim/mount-plugin.js';
import {
  driverContest,
  driverExplain,
  driverOpenRegistry,
  driverRunCommand,
} from '../src/simulator/controller.js';

/** A minimal stand-in for `MountedPlugin<OleaPlugin>` — only the members any driver entry under test actually reads. Cast through `unknown` because a real `MountedPlugin` carries far more than these tests need. */
function fakeMountedPlugin(
  overrides: {
    readonly invokeCommand?: (id: string) => boolean;
    readonly getFiles?: () => readonly { readonly path: string }[];
    readonly getLeavesOfType?: (viewType: string) => readonly unknown[];
  } = {},
): MountedPlugin<OleaPlugin> {
  const invokeCommand = overrides.invokeCommand ?? (() => false);
  const getFiles = overrides.getFiles ?? (() => []);
  const getLeavesOfType = overrides.getLeavesOfType ?? (() => []);
  return {
    app: {
      vault: { getFiles, getFileByPath: () => null },
      workspace: { getLeavesOfType, setActiveFile: () => {} },
    },
    plugin: { invokeCommand },
    get hostEl() {
      throw new Error('fakeMountedPlugin: hostEl was never meant to be read by these tests.');
    },
    unmount: async () => {},
  } as unknown as MountedPlugin<OleaPlugin>;
}

/** A `shellRoot` whose `ownerDocument` reads as "no DOM here" — see this file's own module doc for why that is the honest stand-in for "nothing rendered", not a test-environment workaround. */
function noDomShellRoot(): HTMLElement {
  return { ownerDocument: null } as unknown as HTMLElement;
}

describe('driverRunCommand', () => {
  it('refuses an id the plugin never registered', () => {
    const invokeCommand = vi.fn((id: string) => id === 'coined-known-command');
    const mounted = fakeMountedPlugin({ invokeCommand });

    expect(driverRunCommand(mounted, 'coined-unknown-command')).toBe(false);
    expect(invokeCommand).toHaveBeenCalledWith('coined-unknown-command');
  });

  it('runs an id the plugin did register', () => {
    const invokeCommand = vi.fn((id: string) => id === 'coined-known-command');
    const mounted = fakeMountedPlugin({ invokeCommand });

    expect(driverRunCommand(mounted, 'coined-known-command')).toBe(true);
  });

  it('throws a clear error rather than a bare TypeError when the whole plugin is not mounted', () => {
    expect(() => driverRunCommand(null, 'coined-known-command')).toThrow(
      /whole plugin is not mounted/i,
    );
  });
});

describe('driverExplain', () => {
  it('rejects with a clear error in fallback mode, never touching the command registry', async () => {
    await expect(driverExplain(null, 'a coined explanation')).rejects.toThrow(
      /whole plugin is not mounted/i,
    );
  });

  it('resolves unavailable when OLEA_COMMAND_EXPLAIN_BACK is not registered, with no DOM touched', async () => {
    const mounted = fakeMountedPlugin({ invokeCommand: () => false });

    await expect(driverExplain(mounted, 'a coined explanation')).resolves.toEqual({
      outcome: 'unavailable',
      reason: expect.stringContaining('olea-explain-back') as unknown as string,
    });
  });
});

describe('driverContest', () => {
  it('rejects with a clear error in fallback mode', async () => {
    await expect(driverContest(null, noDomShellRoot(), 'today')).rejects.toThrow(
      /whole plugin is not mounted/i,
    );
  });

  it("resolves unavailable for 'today' when no contest gesture is rendered", async () => {
    const mounted = fakeMountedPlugin();

    await expect(driverContest(mounted, noDomShellRoot(), 'today')).resolves.toEqual({
      outcome: 'unavailable',
      reason: expect.stringContaining('olea-today-contest-gesture') as unknown as string,
    });
  });

  it("resolves unavailable for 'review' when no contest gesture is rendered", async () => {
    const mounted = fakeMountedPlugin();

    await expect(driverContest(mounted, noDomShellRoot(), 'review')).resolves.toEqual({
      outcome: 'unavailable',
      reason: expect.stringContaining('olea-review-contest') as unknown as string,
    });
  });
});

describe('driverOpenRegistry', () => {
  it('rejects with a clear error in fallback mode', async () => {
    await expect(driverOpenRegistry(null)).rejects.toThrow(/whole plugin is not mounted/i);
  });

  it('throws when OLEA_COMMAND_REGISTRY_OPEN is not registered right now', async () => {
    const mounted = fakeMountedPlugin({ invokeCommand: () => false });

    await expect(driverOpenRegistry(mounted)).rejects.toThrow(/olea-registry-open/i);
  });
});
