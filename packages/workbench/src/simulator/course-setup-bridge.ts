/**
 * Bridges `packages/plugin/src/main.ts`'s in-memory-only `courseSetupSeenCodes`
 * across the simulator's remounts (`ol-3ux7.64.11` [WBX-9]).
 *
 * **The bug.** `courseSetupSeenCodes`' own module doc (`main.ts:376-382`) calls
 * it "session-only memory, not a store" and names the gap explicitly: "empty
 * on every plugin load." That is correct for a real Obsidian host, which only
 * reloads a plugin on an actual restart. `SimulatorController.remountPane`
 * constructs a BRAND NEW `OleaPlugin` on every day-advance/rate/reset
 * (`controller.ts`'s own module doc: "matching what a real Obsidian host does
 * on reload") — so the field is empty again on every single control click,
 * and the plugin's cold-start scan (`checkForCourseSetupProposals`,
 * `main.ts:1340`) reopens `CourseSetupModal` for every course-shaped folder,
 * every time.
 *
 * **Why this lives here, outside the plugin.** `packages/plugin` is not on
 * this bead's `owns` list (another lane owns `packages/plugin/src/ingestion`
 * concurrently), and `courseSetupSeenCodes` is a private field with no
 * injection seam: `obsidian-shim/mount-plugin.ts`'s `mountPlugin` constructs
 * the plugin and awaits its whole `onload()` as one call this package has no
 * hook inside — by the time `mountPlugin` resolves back to `controller.ts`,
 * the cold-start scan has already run (or is running a fire-and-forget async
 * chain neither `onload` nor `mountPlugin` waits on), so there is no
 * synchronous window in which to seed the field before it is read.
 *
 * **Where this works from instead.** The one place course-setup state is
 * ever observable from OUTSIDE the plugin: the real `CourseSetupModal`'s own
 * DOM. `.olea-course-setup-name-input`'s initial value IS `next.code`
 * (`main.ts`'s `suggestedName: next.code`, `confirmation-view.ts`'s
 * `nameInput.value = proposal.suggestedName`), and the modal always renders
 * into the TOP document's `[data-wb-modal-host]` — `obsidian-shim`'s
 * `Modal.open()`'s own doc: "never into the host iframe" — so it is reachable
 * regardless of where the mounted plugin's own chrome lives.
 *
 * **The persistence seam.** Read-modify-write against the SAME shared
 * `data.json` blob `ensureDeviceId` already uses
 * (`simulator/plugin-data-host.ts`'s `ObsidianDataHost`, backed by
 * `SimulatorStore.loadPluginData`/`savePluginData`), under its own top-level
 * key — the identical non-clobbering pattern
 * `packages/plugin/src/device/device-id.ts` documents for exactly this
 * reason ("cannot clobber `keywordIndex` or `ingestionQueue` sharing the same
 * blob"). Because `SimulatorStore.resetAll` clears that same blob in the SAME
 * transaction as the vault overlay and the clock offset (`store.ts`'s own
 * doc), `SimulatorController.reset()` clears this key for free.
 *
 * **The choice this bead's brief asked to be named: reset DOES clear the seen
 * set, and that is the one legitimate reopen.** No special-casing was added
 * to make this happen — it falls out of storing the seen set in the same blob
 * `ensureDeviceId` already uses, which `resetAll` already clears atomically
 * with the vault overlay. The alternative (surviving a reset) would need a
 * SEPARATE store outside that transaction, which risks the device id and the
 * course-setup memory falling out of step after a reset — exactly the
 * failure mode `store.ts`'s own doc says the single-transaction reset exists
 * to prevent. A reset really is meant to read as "a fresh device"
 * (`SimulatorController.reset`'s own doc: "a fresh device id is minted on the
 * next mount"), and a fresh device has never seen any course-setup proposal
 * either — so a reset reopening the proposals once is the honest behaviour,
 * not a bug this bridge needs to suppress. `e2e/simulator/helpers.ts`'s
 * `resetSimulator` accounts for this with its own guarded dismiss, the same
 * one `gotoSimulator` uses for the real cold start.
 *
 * **The watcher.** {@link installCourseSetupSeenBridge} installs one
 * `MutationObserver` on `[data-wb-modal-host]` for the CONTROLLER'S WHOLE
 * LIFETIME, not per-remount. A fresh plugin instance's own confirm/dismiss
 * chain (`openNextCourseSetupProposal`) can present a second proposal well
 * after `remountPane()`'s own promise has already resolved — that chain only
 * continues once something actually resolves the first modal (a real click,
 * or this bridge's own dismiss), and neither is on `remountPane()`'s own
 * critical path. A poll bounded to one `remountPane()` call would miss that.
 * The observer instead reacts to every course-setup modal AS IT OPENS, for as
 * long as the controller lives: it records the shown code immediately —
 * matching the plugin's own semantics, where `courseSetupSeenCodes.add(next
 * .code)` happens at proposal-OPEN time, not at resolution time
 * (`main.ts:1584`) — and if that code was already recorded in an EARLIER
 * mount (the snapshot `SimulatorController.remountPane` refreshes at the top
 * of every call, via {@link loadCourseSetupSeenCodes}), dismisses it
 * immediately via the one dismissal Obsidian's real `Modal` offers here:
 * Escape (`setup-modal.ts`'s own doc: "Dismissing this modal (the Escape key,
 * clicking outside) is not a 'no' answer to anything"). A genuinely new code
 * is left open — this bridge only ever suppresses a REPEAT.
 */

import type { ObsidianDataHost } from './plugin-data-host.js';

/**
 * The top-level key this module owns inside the plugin's shared `data.json`
 * blob — same blob, same read-modify-write posture as `DEVICE_ID_STORAGE_KEY`
 * (`packages/plugin/src/device/device-id.ts`). Prefixed `wbSimulator` so it
 * reads unambiguously as simulator-only state if anyone ever inspects a real
 * `data.json` dump next to this key.
 */
export const COURSE_SETUP_SEEN_STORAGE_KEY = 'wbSimulatorCourseSetupSeenCodes';

const COURSE_SETUP_NAME_INPUT_SELECTOR = '.olea-course-setup-name-input';
const MODAL_HOST_SELECTOR = '[data-wb-modal-host]';

function readSeenCodes(blob: unknown): Set<string> {
  const record = typeof blob === 'object' && blob !== null ? (blob as Record<string, unknown>) : {};
  const stored = record[COURSE_SETUP_SEEN_STORAGE_KEY];
  if (!Array.isArray(stored)) return new Set();
  return new Set(stored.filter((entry): entry is string => typeof entry === 'string'));
}

/**
 * Reads the persisted seen-code set — empty (never a throw) for missing or
 * malformed data, the same tolerant-read posture `ensureDeviceId` takes on
 * its own key. Called at the top of every `remountPane()`: THIS mount's
 * "already seen in an earlier mount" snapshot.
 */
export async function loadCourseSetupSeenCodes(
  host: ObsidianDataHost,
): Promise<ReadonlySet<string>> {
  return readSeenCodes(await host.loadData());
}

/**
 * Read-modify-write: adds one code to the persisted set without clobbering
 * any other top-level key in the shared blob (`device-id.ts`'s own pattern).
 * A no-op write (still a read, no `saveData`) when the code is already
 * recorded, so repeated calls for the same code across a long session cost
 * nothing beyond the one read.
 */
export async function recordCourseSetupSeenCode(
  host: ObsidianDataHost,
  code: string,
): Promise<void> {
  const existing = await host.loadData();
  const current = readSeenCodes(existing);
  if (current.has(code)) return;
  current.add(code);
  const blob: Record<string, unknown> =
    typeof existing === 'object' && existing !== null
      ? { ...(existing as Record<string, unknown>) }
      : {};
  blob[COURSE_SETUP_SEEN_STORAGE_KEY] = [...current];
  await host.saveData(blob);
}

/** The code the currently-open course-setup modal (if any) is proposing — `null` when none is open. */
function currentCourseSetupCode(): string | null {
  const modalHost = document.querySelector<HTMLElement>(MODAL_HOST_SELECTOR);
  if (modalHost === null) return null;
  const nameInput = modalHost.querySelector<HTMLInputElement>(COURSE_SETUP_NAME_INPUT_SELECTOR);
  return nameInput === null ? null : nameInput.value;
}

/**
 * Escape-to-close, real Obsidian `Modal` behaviour this shim's own `Modal`
 * reproduces (`obsidian-shim/index.ts`'s `escapeHandler`) and
 * `CourseSetupModal`'s own doc names as a non-answer dismissal. Dispatched on
 * `document` because that is exactly what the shim's own listener is
 * attached to.
 */
function dismissOpenModal(): void {
  document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
}

export interface CourseSetupSeenBridge {
  /** Stops observing — call once, from `SimulatorController.dispose()`. */
  dispose(): void;
}

const NOOP_BRIDGE: CourseSetupSeenBridge = { dispose(): void {} };

/**
 * Installs the watcher described in this module's own doc.
 * `getBeforeMountSeenCodes` is a THUNK rather than a fixed snapshot: this
 * bridge is installed once, for the controller's whole lifetime, spanning
 * many remounts, so the observer must always read whatever the CURRENT
 * mount's "seen before this mount" snapshot is — the caller
 * (`SimulatorController.remountPane`) refreshes what that thunk returns at
 * the top of every call.
 *
 * A no-op on a host with no `document`/`MutationObserver` (this package's own
 * plain-Node Vitest suite) or no `[data-wb-modal-host]` element yet — the
 * same degrade-quietly posture `missingWholePluginGlobals` already takes for
 * the whole-plugin mount this bridge only ever matters alongside.
 */
export function installCourseSetupSeenBridge(
  pluginDataHost: ObsidianDataHost,
  getBeforeMountSeenCodes: () => ReadonlySet<string>,
): CourseSetupSeenBridge {
  if (typeof document === 'undefined' || typeof MutationObserver === 'undefined')
    return NOOP_BRIDGE;
  const modalHost = document.querySelector<HTMLElement>(MODAL_HOST_SELECTOR);
  if (modalHost === null) return NOOP_BRIDGE;

  let lastObservedCode: string | null = null;

  const react = (): void => {
    const code = currentCourseSetupCode();
    if (code === lastObservedCode) return;
    lastObservedCode = code;
    if (code === null) return;
    void recordCourseSetupSeenCode(pluginDataHost, code).catch((error: unknown) => {
      console.error('simulator: could not persist a course-setup seen code', error);
    });
    if (getBeforeMountSeenCodes().has(code)) dismissOpenModal();
  };

  const observer = new MutationObserver(react);
  observer.observe(modalHost, { childList: true, subtree: true });

  return {
    dispose(): void {
      observer.disconnect();
    },
  };
}
