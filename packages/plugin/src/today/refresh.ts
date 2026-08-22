/**
 * The mechanism behind "the Today panel refreshes after a session" (F6.1,
 * `ol-h3wy`).
 *
 * `TodayView.refresh` (`./view.ts`) has carried a doc comment saying it is
 * "called by main.ts after a session" since it was written — and nothing
 * called it. The panel opened once, computed its counts, and never looked
 * again: a completed review appends log records and changes what is due, but
 * the pane kept showing whatever it had when it was constructed. This module
 * is the call that doc comment always claimed existed.
 *
 * **Obsidian-free on purpose, same reasoning as `commands/types.ts`'s
 * `CommandRegistrar`.** `main.ts` cannot be unit tested — it builds real
 * `ItemView`s against a real `App`, and `obsidian` has no runtime outside a
 * real host (see `today/view.ts`'s and `review/view.ts`'s module docs). So the
 * *decision* of which leaves get refreshed is kept here, behind two narrow
 * structural interfaces a plain object can satisfy, and `main.ts` becomes a
 * one-line call passing the real `Workspace` — which is a `TodayWorkspace`
 * already, with no adapter needed.
 */

/** The shape `TodayView.refresh` actually has — enough to call it, nothing more. */
export interface RefreshableView {
  refresh(): Promise<void>;
}

/** The shape a `WorkspaceLeaf` has that this module needs — its `view`, untyped. */
export interface RefreshTarget {
  readonly view: unknown;
}

/** The shape `Workspace` has that this module needs. Obsidian's real `Workspace` satisfies this without adaptation. */
export interface TodayWorkspace {
  getLeavesOfType(viewType: string): readonly RefreshTarget[];
}

function isRefreshable(view: unknown): view is RefreshableView {
  return (
    typeof view === 'object' &&
    view !== null &&
    typeof (view as { refresh?: unknown }).refresh === 'function'
  );
}

/**
 * Refreshes every currently open leaf of `viewType`. Used for exactly one
 * `viewType` in production (`VIEW_TYPE_OLEA_TODAY`), but takes it as a
 * parameter rather than importing the constant so this module stays
 * independent of `./view.ts` (which imports `obsidian`) and of `main.ts`.
 *
 * A leaf whose `view` is not yet constructed, or is some other view entirely,
 * is silently skipped rather than throwing — `getLeavesOfType` can return
 * leaves mid-construction, and a refresh sweep is not the place to surface
 * that.
 *
 * Never throws: a panel that fails to reload stays showing its last-good
 * state, which is the honest thing for it to do, rather than taking down
 * whatever called this (a review session closing, or the panel being
 * revealed).
 */
export async function refreshOpenTodayViews(
  workspace: TodayWorkspace,
  viewType: string,
): Promise<void> {
  const leaves = workspace.getLeavesOfType(viewType);
  await Promise.all(
    leaves.map(async (leaf) => {
      if (!isRefreshable(leaf.view)) return;
      try {
        await leaf.view.refresh();
      } catch {
        // Best effort — see module doc.
      }
    }),
  );
}
