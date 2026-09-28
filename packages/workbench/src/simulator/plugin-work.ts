/**
 * The simulator's "the plugin's own async work has finished" signal
 * (`ol-egov.141.89.51`).
 *
 * ## Why this exists
 *
 * `[data-wb-remount]` used to be bumped right after `remountPane()` called
 * `mounted.plugin.invokeCommand(OLEA_COMMAND_TODAY_OPEN)` — and every reveal
 * command in `packages/plugin/src/main.ts` is fire-and-forget by design
 * (`() => { void this.revealTodayView(); }`: a command returns before its
 * view has finished loading). So "the remount has settled" could be announced
 * while Today was still awaiting its first `load()`, and again while its
 * second pass (`revealTodayView` refreshes on the way out, after `onOpen`
 * already refreshed once) was in flight. The same holds for the plugin's
 * cold-start course-detection chain (`checkForCourseSetupProposals` →
 * `openNextCourseSetupProposal`, also `void`-called), which the e2e helpers
 * could only wait out with a bounded number of fixed 150ms sleeps.
 *
 * The command's own promise is voided inside the plugin, so it cannot be
 * awaited from here without editing `packages/plugin`. What CAN be observed
 * without changing a line of production code is the work itself: this
 * module wraps the named async methods (a view's `onOpen`/`refresh`, the
 * plugin's proposal step) on their PROTOTYPES, counting calls in flight. The
 * wrapper forwards `this`, the arguments, the return value and any rejection
 * unchanged — it only counts.
 *
 * ## Settled means "idle across a macrotask", not "idle for a moment"
 *
 * A reveal's awaits are chained through microtasks: `revealTodayView`'s
 * `onOpen` refresh resolves, then `revealLeaf`, then the second refresh
 * starts — with the in-flight count briefly at zero in between. A task
 * queued with `setTimeout(0)` runs only after the microtask queue drains, so
 * the count is re-read there: still zero, and no call started since, is
 * settled. No duration is involved anywhere — nothing here sleeps for a
 * fixed time or polls a clock.
 *
 * ## What it writes
 *
 * On `root` (`SimulatorShellElements.root`, the same element that carries
 * `[data-wb-remount]`):
 * - `data-wb-plugin-busy` — the number of tracked calls in flight right now;
 * - `data-wb-plugin-settled` — bumped once per confirmed busy→idle
 *   transition, so an e2e helper can read it before a click and wait for it
 *   to move (the same before/after shape `waitForRemount` uses);
 * - `data-wb-plugin-untracked` — present only if a named method was missing
 *   when this installed (a rename in `packages/plugin`), listing which; the
 *   e2e helpers fail on it, so a rename breaks the suite loudly instead of
 *   silently reopening the race. The page itself keeps working.
 */

/** One prototype and the async methods on it whose calls count as the plugin's pending work. */
export interface TrackedMethods {
  /** A label for `data-wb-plugin-untracked` when a method is missing. */
  readonly label: string;
  readonly prototype: object;
  readonly methods: readonly string[];
}

export interface PluginWorkTracker {
  /**
   * Resolves at the first moment no tracked call is in flight and none
   * started during the macrotask that confirmed it. Called with nothing in
   * flight, it still waits one macrotask, so work a caller's synchronous code
   * just queued on a microtask is seen before it resolves.
   */
  whenSettled(): Promise<void>;
  /** Restores every wrapped method and stops writing attributes. */
  dispose(): void;
}

export const PLUGIN_BUSY_ATTR = 'data-wb-plugin-busy';
export const PLUGIN_SETTLED_ATTR = 'data-wb-plugin-settled';
export const PLUGIN_UNTRACKED_ATTR = 'data-wb-plugin-untracked';

type AnyMethod = (this: unknown, ...args: unknown[]) => unknown;

export function installPluginWorkTracker(
  root: HTMLElement,
  targets: readonly TrackedMethods[],
  scheduleMacrotask: (callback: () => void) => void = (callback) => {
    setTimeout(callback, 0);
  },
): PluginWorkTracker {
  let inFlight = 0;
  let started = 0;
  let settledGeneration = 0;
  let disposed = false;
  let checkQueued = false;
  const waiters: Array<() => void> = [];

  const write = (): void => {
    if (disposed) return;
    root.setAttribute(PLUGIN_BUSY_ATTR, String(inFlight));
    root.setAttribute(PLUGIN_SETTLED_ATTR, String(settledGeneration));
  };

  const queueIdleCheck = (): void => {
    if (checkQueued) return;
    checkQueued = true;
    const startedAtQueue = started;
    scheduleMacrotask(() => {
      checkQueued = false;
      if (inFlight !== 0) return;
      if (started !== startedAtQueue) {
        queueIdleCheck();
        return;
      }
      settledGeneration += 1;
      write();
      for (const resolve of waiters.splice(0)) resolve();
    });
  };

  const begin = (): void => {
    inFlight += 1;
    started += 1;
    write();
  };

  const end = (): void => {
    inFlight -= 1;
    write();
    if (inFlight === 0) queueIdleCheck();
  };

  const restores: Array<() => void> = [];
  const untracked: string[] = [];
  for (const target of targets) {
    const proto = target.prototype as Record<string, unknown>;
    for (const name of target.methods) {
      const original = proto[name];
      if (typeof original !== 'function') {
        untracked.push(`${target.label}.${name}`);
        continue;
      }
      const hadOwn = Object.hasOwn(proto, name);
      const wrapped = function (this: unknown, ...args: unknown[]): unknown {
        begin();
        let result: unknown;
        try {
          result = (original as AnyMethod).apply(this, args);
        } catch (error) {
          end();
          throw error;
        }
        return Promise.resolve(result).finally(end);
      };
      proto[name] = wrapped;
      restores.push(() => {
        if (hadOwn) proto[name] = original;
        else delete proto[name];
      });
    }
  }

  if (untracked.length > 0) {
    root.setAttribute(PLUGIN_UNTRACKED_ATTR, untracked.join(','));
    console.error(
      `[simulator] plugin-work tracker: ${untracked.join(', ')} not found — the settle signal cannot see that work (ol-egov.141.89.51).`,
    );
  }
  write();

  return {
    whenSettled(): Promise<void> {
      return new Promise<void>((resolve) => {
        waiters.push(resolve);
        if (inFlight === 0) queueIdleCheck();
      });
    },
    dispose(): void {
      for (const restore of restores) restore();
      disposed = true;
      for (const resolve of waiters.splice(0)) resolve();
    },
  };
}
