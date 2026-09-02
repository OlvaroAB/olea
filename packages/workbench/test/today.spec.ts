/**
 * `today-scenarios.ts` — node-side checks, same scope note as
 * `workbench.spec.ts`: rendering is checked by looking at it (and later by
 * WB-2). What is worth asserting here without a DOM:
 *
 *  1. Every advertised Today state builds a scenario whose `deps.load()`
 *     resolves — the same "a state in the nav that throws is a failure a
 *     human finds late and a test finds instantly" reasoning `workbench.spec.ts`
 *     already applies to `REVIEW_STATES`.
 *  2. `today-nothing-due` and `today-unavailable` really are the two different
 *     edge inputs they claim to be (`due: { total: 0, ... }` vs `due: null`),
 *     not the same rendering reached two ways.
 *  3. **The discriminating claim for `ol-h3wy`.** Without this, "today-stale
 *     reproduces the bug" is unfalsifiable in exactly the shape
 *     `workbench.spec.ts`'s own persona test warns about: a scenario that
 *     wrote nothing and refreshed nothing would still pass every test that
 *     only checks `deps.load()` resolves. What has to be checked is the one
 *     thing that actually differs between the two states — whether
 *     `afterOpen` calls `view.refresh()` — using a minimal fake view, since
 *     `afterOpen`'s contract only ever touches that one method.
 */

import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join, posix, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createFsrsScheduler } from 'olea-core';
import { describe, expect, it, vi } from 'vitest';
import type { TodayView } from '../src/plugin-bridge.js';
import { deriveWorkbenchQueue, type WorkbenchQueue } from '../src/queue/derive.js';
import { WORKBENCH_DEVICE_ID } from '../src/scenarios.js';
import { buildTodayScenario, TODAY_STATES } from '../src/today-scenarios.js';
import { MemoryVaultSource } from '../src/vault/memory-source.js';

const FIXTURE_ROOT = resolve(
  dirname(fileURLToPath(import.meta.url)),
  '..',
  '..',
  'core',
  'fixtures',
  'vault',
);

function readFixtureBytes(): Map<string, Uint8Array> {
  const out = new Map<string, Uint8Array>();
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const absolute = join(dir, entry.name);
      if (entry.isDirectory()) walk(absolute);
      else if (entry.isFile()) {
        const vaultPath = relative(FIXTURE_ROOT, absolute).split(sep).join(posix.sep);
        out.set(vaultPath, new Uint8Array(readFileSync(absolute)));
      }
    }
  };
  walk(FIXTURE_ROOT);
  return out;
}

/** A vault nothing else has written to — every test below gets its own. */
function freshVault(): MemoryVaultSource {
  return MemoryVaultSource.fromBytes(readFixtureBytes());
}

async function composeFixtureSession(vault: MemoryVaultSource): Promise<WorkbenchQueue> {
  return deriveWorkbenchQueue({ vault, scheduler: createFsrsScheduler(), entries: [] });
}

/** Satisfies `afterOpen`'s contract (it only ever calls `.refresh()`), nothing more. */
function fakeTodayView(): TodayView & { readonly refresh: ReturnType<typeof vi.fn> } {
  return { refresh: vi.fn(async () => undefined) } as unknown as TodayView & {
    readonly refresh: ReturnType<typeof vi.fn>;
  };
}

describe('today-scenarios — every advertised Today state is reachable', () => {
  it('has exactly the eight states the README documents', () => {
    expect(TODAY_STATES.map((s) => s.id)).toEqual([
      'today-nothing-due',
      'today-due',
      'today-after-writing',
      'today-stale',
      'today-unavailable',
      'today-scope-not-declared',
      'today-rhythm-quiet',
      'today-rhythm-fresh',
    ]);
  });

  it('builds a scenario whose deps.load() resolves for every state', async () => {
    const vault = freshVault();
    const queue = await composeFixtureSession(vault);
    const scheduler = createFsrsScheduler();
    for (const state of TODAY_STATES) {
      const scenario = buildTodayScenario({ vault, scheduler, queue, stateId: state.id });
      const vm = await scenario.deps.load();
      expect(vm, state.id).toBeDefined();
      expect(vm.streak, state.id).toBeDefined();
    }
  });

  it('rejects an unknown state id rather than rendering something arbitrary', async () => {
    const vault = freshVault();
    const queue = await composeFixtureSession(vault);
    expect(() =>
      buildTodayScenario({
        vault,
        scheduler: createFsrsScheduler(),
        queue,
        stateId: 'no-such-today-state',
      }),
    ).toThrow(/unknown today state/);
  });
});

describe('today-nothing-due vs today-unavailable — two different claims, not one rendering', () => {
  it('today-nothing-due is a real, computed zero', async () => {
    const vault = freshVault();
    const queue = await composeFixtureSession(vault);
    const scenario = buildTodayScenario({
      vault,
      scheduler: createFsrsScheduler(),
      queue,
      stateId: 'today-nothing-due',
    });
    const vm = await scenario.deps.load();
    expect(vm.due).not.toBeNull();
    expect(vm.due?.total).toBe(0);
  });

  it('today-unavailable is null, never a substitute zero', async () => {
    const vault = freshVault();
    const queue = await composeFixtureSession(vault);
    const scenario = buildTodayScenario({
      vault,
      scheduler: createFsrsScheduler(),
      queue,
      stateId: 'today-unavailable',
    });
    const vm = await scenario.deps.load();
    expect(vm.due).toBeNull();
  });
});

describe('today-due — composed from the real vault, not a stub', () => {
  it('counts instruments the composer actually offered', async () => {
    const vault = freshVault();
    const queue = await composeFixtureSession(vault);
    const scenario = buildTodayScenario({
      vault,
      scheduler: createFsrsScheduler(),
      queue,
      stateId: 'today-due',
    });
    const vm = await scenario.deps.load();
    // Every instrument in the untouched fixture vault is a first exposure, so
    // it counts as due now (see olea-core's `today/due.ts`); the fixture vault
    // is never empty (`workbench.spec.ts` already asserts that).
    expect(vm.due).not.toBeNull();
    expect(vm.due?.total).toBeGreaterThan(0);
  });

  it('is unaffected by writes that never happened — logged stays empty', async () => {
    const vault = freshVault();
    const queue = await composeFixtureSession(vault);
    const scenario = buildTodayScenario({
      vault,
      scheduler: createFsrsScheduler(),
      queue,
      stateId: 'today-due',
    });
    expect(scenario.afterOpen).toBeUndefined();
    expect(scenario.logged).toEqual([]);
  });
});

describe('ol-h3wy — the discriminating claim: refresh() runs for one state and not the other', () => {
  it('today-after-writing calls view.refresh() after writing to the vault', async () => {
    const vault = freshVault();
    const queue = await composeFixtureSession(vault);
    const scenario = buildTodayScenario({
      vault,
      scheduler: createFsrsScheduler(),
      queue,
      stateId: 'today-after-writing',
    });
    expect(scenario.refreshedAfterWrite).toBe(true);
    const view = fakeTodayView();
    await scenario.afterOpen?.(view);
    expect(view.refresh).toHaveBeenCalledTimes(1);
    expect(scenario.logged.length).toBeGreaterThan(0);
  });

  it('today-stale writes the identical record and never calls refresh()', async () => {
    const vault = freshVault();
    const queue = await composeFixtureSession(vault);
    const scenario = buildTodayScenario({
      vault,
      scheduler: createFsrsScheduler(),
      queue,
      stateId: 'today-stale',
    });
    expect(scenario.refreshedAfterWrite).toBe(false);
    const view = fakeTodayView();
    await scenario.afterOpen?.(view);
    expect(view.refresh).not.toHaveBeenCalled();
    expect(scenario.logged.length).toBeGreaterThan(0);
  });

  it('both states write the same number of records — they differ only in the refresh call', async () => {
    const scheduler = createFsrsScheduler();

    const afterVault = freshVault();
    const afterQueue = await composeFixtureSession(afterVault);
    const after = buildTodayScenario({
      vault: afterVault,
      scheduler,
      queue: afterQueue,
      stateId: 'today-after-writing',
    });
    await after.afterOpen?.(fakeTodayView());

    const staleVault = freshVault();
    const staleQueue = await composeFixtureSession(staleVault);
    const stale = buildTodayScenario({
      vault: staleVault,
      scheduler,
      queue: staleQueue,
      stateId: 'today-stale',
    });
    await stale.afterOpen?.(fakeTodayView());

    expect(stale.logged.length).toBe(after.logged.length);
    expect(after.logged.length).toBeGreaterThan(0);
  });

  it('the write actually lands under .olea/reviews/, the real log path', async () => {
    const vault = freshVault();
    const queue = await composeFixtureSession(vault);
    const scenario = buildTodayScenario({
      vault,
      scheduler: createFsrsScheduler(),
      queue,
      stateId: 'today-stale',
    });
    const before = await vault.list({ under: '.olea/reviews' });
    expect(before.length).toBe(0);
    await scenario.afterOpen?.(fakeTodayView());
    const after = await vault.list({ under: '.olea/reviews' });
    expect(after.length).toBeGreaterThan(0);
    for (const path of after) {
      expect(path.includes(WORKBENCH_DEVICE_ID)).toBe(true);
    }
  });
});
