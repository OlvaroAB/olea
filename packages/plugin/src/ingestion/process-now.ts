/**
 * `createProcessNowAction` — the `[D-152]` manual "process this note now"
 * timing override (F3.3 as amended, `ol-0r92.21`; home ruled by `ol-0r92.19`,
 * clause ratified on `ol-egov.52`).
 *
 * **What this is, in one line, quoting the ratified clause:** "it runs the
 * same ingestion the debounce would eventually run, immediately, for that
 * note alone — same extraction, same events, same INV-2 discipline, nothing
 * extra." It is a TIMING override, never a second generation pipeline —
 * every branch below hands off to the exact same machinery the relevant
 * debounce already drives, never a parallel one:
 *
 *   - **An authored markdown note** reaches F3.3's generation sweep through
 *     TRG-1's free-gates debounce (`[AUTH-1b]`, `ol-0r92.12`,
 *     `main.ts`'s `triggerAuthoredNoteGenerationIfObserved`) — a direct,
 *     synchronous call into `onUnitsLanded` with one synthesized unit, no
 *     job queue involved. `buildAuthoredNoteUnit` below is the exact unit
 *     shape that method builds, factored out here so both callers use one
 *     function rather than two copies drifting apart; `main.ts` was updated
 *     to call it too, in the same commit.
 *   - **A known non-markdown source** (pdf/pptx/docx/image,
 *     `formatFromExtension`'s KNOWN_FORMATS) reaches `IngestionQueueEngine`
 *     through the ENQUEUE debounce (`ol-84my`, `ingestion/arrival-watch.ts`).
 *     The override enqueues with NO `lastChangedAt` — `EngineDeps
 *     .enqueueDebounce` only ever evaluates when a call supplies one
 *     (`engine.ts`'s own doc: "both sides must opt in") — so this call is
 *     structurally exempt from that debounce rather than racing it, and then
 *     calls the engine's own `tick()` once (when online) so "immediately"
 *     is a property of THIS call rather than of the next periodic interval.
 *     Content-hash idempotency (D-002) is untouched: a hash the queue
 *     already holds as `done` is reported `already-processed`, never
 *     re-enqueued or re-run.
 *
 * **Why this cannot literally "jump the queue."** `IngestionQueueEngine.tick`
 * drains its `jobs` array in FIFO order with no public "run this one job
 * now" seam (`engine.ts`, `packages/core` — outside this bead's owned
 * paths). A single `tick()` call runs whichever job is FIRST eligible, which
 * is usually the one this action just enqueued (nothing else is normally
 * mid-flight for one student's manual action) but is not guaranteed to be
 * when other jobs are already queued ahead of it. That is disclosed here,
 * not hidden: the override still does exactly what the ratified clause asks
 * — it removes the ENQUEUE-side wait and forces an immediate drain attempt
 * — and it does so without inventing a second run path or touching
 * `packages/core`. `EngineDeps` — one API call at a time, so accelerating
 * one note honestly costs draining whatever (if anything) already precedes
 * it, exactly as an ordinary tick would.
 *
 * **Offline (F3.3: "Offline it queues with the other client work
 * (reconnection semantics unchanged) and says so").** `deps.isOnline`
 * defaults to `() => true` for tests; `main.ts` supplies `navigator.onLine`.
 * Offline, a source file is enqueued (still bypassing the debounce — the
 * override always applies) and the action stops there, deliberately never
 * attempting a drain that would only fail against a Worker it cannot reach.
 * An authored note has no queue step to fall back to, so its offline
 * behaviour is whatever `onAuthoredNoteUnits` itself already does when the
 * Worker is unconfigured or unreachable (F7.8's existing grey-out /
 * refusal handling one level up in the generation pipeline) — this module
 * adds nothing on top of that.
 *
 * **In-flight coalescing** ("repeated invocation ... coalesces to one
 * run — the affordance must not become a refresh-spam surface"). One
 * `Set<VaultPath>` per action instance, keyed on the exact path: a second
 * call for a path already being processed is a no-op, reported
 * `'coalesced'`, and never touches the vault, the hash or the queue.
 * Different paths never coalesce with each other.
 *
 * **INV-6.** Nothing in this module writes to the vault. Both branches stop
 * at "cache holds a fresh draft" — acceptance still happens only at first
 * presentation, through the review flow this module never touches.
 *
 * **No `obsidian` import (INV-1)** — same portability posture as
 * `arrival-watch.ts` one file over: every host-specific piece (the real
 * vault, the real engine, `navigator.onLine`) is injected, so this runs
 * under plain Vitest against fakes.
 */

import {
  type EnqueueInput,
  type ExtractedUnit,
  formatFromExtension,
  hashContent,
  type JobEnqueuer,
  type TickResult,
  type VaultPath,
  type VaultSource,
} from 'olea-core';

/** Whether `path` is something this action knows how to process at all — a markdown note, or a format `formatFromExtension` claims. Exported so a menu/command host can decide whether to offer the affordance at all, without duplicating this rule. */
export function isProcessNowSupported(path: VaultPath): boolean {
  return isMarkdownPath(path) || formatFromExtension(path) !== null;
}

function isMarkdownPath(path: VaultPath): boolean {
  return path.toLowerCase().endsWith('.md');
}

/**
 * The exact single-unit shape `main.ts`'s `triggerAuthoredNoteGenerationIfObserved`
 * builds for TRG-1's authored-note consumer (`[AUTH-1b]`) — factored out here so
 * the debounce-driven path and this manual override share one function rather
 * than two copies of the same shape.
 *
 * **`[D-214]` (`ol-0r92.45`): `embeddedIn` is deliberately ABSENT, not the
 * note's own path.** Before this bead, `embeddedIn.notePath` was set to the
 * note itself, which made `runGenerationSweep` (`generation/pipeline.ts`)
 * treat the authored note as F1.6's "embedded" case — the note she wrote is
 * the drafting target, and an accepted draft is materialized straight into
 * it. That is exactly the write `[D-214]` rules out: nothing lands inside an
 * authored note, ever, without her consent, and drafting is not consent.
 *
 * Omitting `embeddedIn` instead routes this unit through the SAME bare-drop
 * branch `[D-179]` already built for a standalone PDF/PPTX/DOCX/image with no
 * embedding note (`standaloneSourcePaths`/`ensureHomeNoteForConcept`,
 * `generation/pipeline.ts`/`generation/home-note.ts` — outside this bead's
 * own `owns`, touched only for the one-line naming-collision fix
 * `homeNotePathForSource`'s own doc explains: a source that is itself
 * already `.md` would otherwise derive a home-note path identical to
 * itself). The effect: Olea creates or reuses a home note BESIDE this note,
 * in her own layer, never this note, and that sibling is the drafting
 * target — `sourcePath` below stays the note's own path, which is what
 * `runGenerationSweep`'s `citationFromUnit` cites, so the drafted
 * instrument's provenance still opens HER note at the passage (`[D-171]`),
 * even though it is materialized somewhere else. `location` is the same
 * `page: 1`, whole-text placeholder range this call site has always used —
 * nothing downstream reads it for anything beyond that citation today; the
 * passage-scoped revision path (`ol-0r92.46`) is a separate, later bead.
 */
export function buildAuthoredNoteUnit(path: VaultPath, currentText: string): ExtractedUnit {
  return {
    text: currentText,
    provenance: {
      sourcePath: path,
      location: { page: 1, charRange: { start: 0, end: currentText.length } },
    },
  };
}

/** Every way `processNow` can resolve. See this module's doc for what each means and why. */
export type ProcessNowOutcome =
  | { readonly kind: 'coalesced' }
  | { readonly kind: 'unsupported' }
  | { readonly kind: 'ran' }
  | { readonly kind: 'already-processed' }
  | { readonly kind: 'processed' }
  | { readonly kind: 'queued'; readonly offline: boolean }
  | { readonly kind: 'failed' }
  | { readonly kind: 'error' };

export interface ProcessNowDeps {
  readonly vault: VaultSource;
  /** `IngestionQueueEngine` satisfies this structurally — see `arrival-watch.ts`'s own doc for the same shape. */
  readonly enqueuer: JobEnqueuer;
  /** The same engine's `tick`, bound. Called at most once per `processNow` call — see the module doc's "cannot jump the queue" note. */
  readonly tick: () => Promise<TickResult>;
  /** `main.ts`'s `onUnitsLanded` — the SAME hook the debounce-driven authored-note path calls. */
  readonly onAuthoredNoteUnits: (units: readonly ExtractedUnit[]) => Promise<void> | void;
  /** Defaults to `() => true`. Production supplies `() => navigator.onLine`. */
  readonly isOnline?: () => boolean;
}

export interface ProcessNowAction {
  /** Runs (or coalesces into an already-running) the process-now override for `path`. Never throws — see this module's doc. */
  processNow(path: VaultPath): Promise<ProcessNowOutcome>;
}

async function runAuthoredNote(
  path: VaultPath,
  vault: VaultSource,
  onAuthoredNoteUnits: ProcessNowDeps['onAuthoredNoteUnits'],
): Promise<ProcessNowOutcome> {
  const currentText = await vault.read(path);
  await onAuthoredNoteUnits([buildAuthoredNoteUnit(path, currentText)]);
  return { kind: 'ran' };
}

async function runSource(
  path: VaultPath,
  format: NonNullable<ReturnType<typeof formatFromExtension>>,
  vault: VaultSource,
  enqueuer: JobEnqueuer,
  tick: ProcessNowDeps['tick'],
  isOnline: () => boolean,
): Promise<ProcessNowOutcome> {
  const bytes = await vault.readBinary(path);
  const contentHash = await hashContent(bytes);
  // Deliberately NO `lastChangedAt` — see the module doc: this is what
  // makes the ENQUEUE debounce (`ol-84my`) structurally never evaluate for
  // this call, rather than racing its quiet window.
  const input: EnqueueInput = {
    contentHash,
    label: path,
    payload: { kind: 'source', sourcePath: path, format },
  };
  const enqueueResult = await enqueuer.enqueue(input);
  if (enqueueResult.status === 'duplicate' && enqueueResult.existingStatus === 'done') {
    return { kind: 'already-processed' };
  }

  if (!isOnline()) {
    return { kind: 'queued', offline: true };
  }

  const result = await tick();
  if (result.kind === 'ran' && result.contentHash === contentHash) {
    if (result.outcome === 'done') return { kind: 'processed' };
    if (result.outcome === 'failed') return { kind: 'failed' };
    // 'deferred' — a retryable transient error; the job stays on the queue
    // for a later tick, exactly the "queues with the other client work"
    // reading extended to a transient failure rather than only to offline.
    return { kind: 'queued', offline: false };
  }
  // Either nothing ran this tick (idle/blocked — paused, budget-exhausted,
  // device cannot drain) or a different, earlier-queued job ran instead:
  // ours is still honestly queued, not processed, not failed.
  return { kind: 'queued', offline: false };
}

/**
 * Builds one process-now action, holding its own in-flight set so repeat
 * invocations for the SAME path coalesce (F3.3: "the affordance must not
 * become a refresh-spam surface"). Construct once per plugin session — a
 * fresh instance per call would defeat coalescing entirely.
 */
export function createProcessNowAction(deps: ProcessNowDeps): ProcessNowAction {
  const inFlight = new Set<VaultPath>();
  const isOnline = deps.isOnline ?? (() => true);

  return {
    async processNow(path: VaultPath): Promise<ProcessNowOutcome> {
      if (inFlight.has(path)) return { kind: 'coalesced' };
      inFlight.add(path);
      try {
        if (isMarkdownPath(path)) {
          return await runAuthoredNote(path, deps.vault, deps.onAuthoredNoteUnits);
        }
        const format = formatFromExtension(path);
        if (format === null) return { kind: 'unsupported' };
        return await runSource(path, format, deps.vault, deps.enqueuer, deps.tick, isOnline);
      } catch (error) {
        console.error('Olea: process-now failed', error);
        return { kind: 'error' };
      } finally {
        inFlight.delete(path);
      }
    },
  };
}

/**
 * The Notice text for each outcome — `[D-096]`'s voice charter (Olea or no
 * actor, never apologises, states the fact) applied to this small, static
 * surface, the same posture `gap/copy.ts`'s empty states already take.
 */
export function processNowNotice(outcome: ProcessNowOutcome): string {
  switch (outcome.kind) {
    case 'coalesced':
      return 'Olea is already processing this note.';
    case 'unsupported':
      return "Olea doesn't process this kind of file.";
    case 'ran':
      return 'Olea processed this note now.';
    case 'already-processed':
      return 'Olea already processed this note — nothing new to do.';
    case 'processed':
      return 'Olea processed this note now.';
    case 'failed':
      return 'Olea could not process this note this time.';
    case 'error':
      return 'Olea could not process this note just now.';
    case 'queued':
      return outcome.offline
        ? "You're offline. Olea has queued this note and will process it once you reconnect."
        : 'Olea has queued this note and will process it shortly.';
  }
}
