/**
 * `today/refresh.ts` tests — the mechanism behind ol-h3wy's "the Today panel
 * refreshes after a session" fix. Runs against fake `TodayWorkspace`/leaf
 * objects, never against `obsidian`: same reasoning as
 * `test/commands/register-commands.spec.ts`'s `FakeCommandRegistrar`.
 *
 * The defect this guards against is not "the function is wrong" — it did not
 * exist before this bead — it is "nothing calls it". `test/main-wiring.spec.ts`
 * has the source-level check that main.ts actually wires this in; this file
 * covers the dispatch logic itself.
 */
import { describe, expect, it, vi } from 'vitest';
import { refreshOpenTodayViews, type TodayWorkspace } from '../../src/today/refresh.js';

const VIEW_TYPE = 'olea-today';

function fakeWorkspace(leaves: readonly { view: unknown }[]): TodayWorkspace {
  return {
    getLeavesOfType: vi.fn((viewType: string) => (viewType === VIEW_TYPE ? leaves : [])),
  };
}

describe('refreshOpenTodayViews', () => {
  it('calls refresh() on every leaf of the given view type', async () => {
    const a = { refresh: vi.fn().mockResolvedValue(undefined) };
    const b = { refresh: vi.fn().mockResolvedValue(undefined) };
    const workspace = fakeWorkspace([{ view: a }, { view: b }]);

    await refreshOpenTodayViews(workspace, VIEW_TYPE);

    expect(a.refresh).toHaveBeenCalledTimes(1);
    expect(b.refresh).toHaveBeenCalledTimes(1);
  });

  it('asks the workspace for exactly the requested view type', async () => {
    const workspace = fakeWorkspace([]);
    await refreshOpenTodayViews(workspace, VIEW_TYPE);
    expect(workspace.getLeavesOfType).toHaveBeenCalledWith(VIEW_TYPE);
  });

  it('does nothing when no leaf of that type is open', async () => {
    const workspace = fakeWorkspace([]);
    await expect(refreshOpenTodayViews(workspace, VIEW_TYPE)).resolves.toBeUndefined();
  });

  it('skips a leaf whose view has no refresh method, rather than throwing', async () => {
    const notRefreshable = { somethingElse: () => {} };
    const refreshable = { refresh: vi.fn().mockResolvedValue(undefined) };
    const workspace = fakeWorkspace([{ view: notRefreshable }, { view: refreshable }]);

    await expect(refreshOpenTodayViews(workspace, VIEW_TYPE)).resolves.toBeUndefined();
    expect(refreshable.refresh).toHaveBeenCalledTimes(1);
  });

  it('skips a leaf whose view is null, rather than throwing', async () => {
    const workspace = fakeWorkspace([{ view: null }]);
    await expect(refreshOpenTodayViews(workspace, VIEW_TYPE)).resolves.toBeUndefined();
  });

  it('a refresh that rejects does not stop the others, and does not reject the sweep', async () => {
    const failing = { refresh: vi.fn().mockRejectedValue(new Error('vault read failed')) };
    const succeeding = { refresh: vi.fn().mockResolvedValue(undefined) };
    const workspace = fakeWorkspace([{ view: failing }, { view: succeeding }]);

    await expect(refreshOpenTodayViews(workspace, VIEW_TYPE)).resolves.toBeUndefined();
    expect(succeeding.refresh).toHaveBeenCalledTimes(1);
  });
});
