/**
 * Calls the composer. That is now the whole of this file's job.
 *
 * ## What used to be here
 *
 * Until the session pipeline landed, `[P2-T07]` queue composition did not
 * exist, so this module **synthesised** review instruments out of the fixture
 * vault: it walked question-headed headings, invented a Q&A card from each, cut
 * a cloze at the first wikilink, and built MCQ distractors out of other
 * answers in the same course. `ReviewQueueItem`'s own doc said callers had to
 * construct the array by hand, and the workbench was the harness that did.
 *
 * That was scaffolding with a deletion date (README ledger row 3, `ol-mtpn`),
 * and this is the deletion. `olea-core` now enumerates the real instruments in
 * her vault — the actual `::` cards, the actual `==…==` clozes, the actual
 * `olea-mcq` blocks — replays the review log into per-instrument scheduling
 * state, and composes a session. `packages/plugin`'s `adaptReviewQueue` turns
 * that into the `ReviewQueueItem[]` the view renders. Nothing in this package
 * decides `priorState`, `selectionContext`, or what a card says any more.
 *
 * ## Two things a harness needs that a session does not give it for free
 *
 * **One instrument per concept (F2.17).** A concept holding a card and a cloze
 * offers only one of them, and over the fixture corpus that is enough to make
 * every cloze state unreachable from a single composition. The fix is the seam
 * F2.17 already has, not a relaxation of the cap: `formatPreference` is where
 * `ComposeQueueInput` takes F2.17's tie-break — favour the instrument whose
 * format matches the closest upcoming assessment (F4.8) — and *which* format to
 * prefer is explicitly the caller's decision. A workbench asking "show me the cloze states" is a caller with a
 * format preference. So three compositions run over **one** enumeration and one
 * replay, differing only in that preference.
 *
 * What is deliberately **not** done: `dedupeByConcept: false`. That flag is
 * F2.17's named exam-proximity relaxation, nothing in v1 passes it, and a
 * harness turning it on to make its screenshots easier would be the workbench
 * asserting a product behaviour to suit itself.
 *
 * **Nothing is due on an arbitrary day.** With a persona loaded, her deck has
 * real FSRS due dates, and at any one instant most of it is scheduled into the
 * future — the queue never draws early (F2.8, Phase A), so several personas
 * compose to an empty or one-item session at `WORKBENCH_NOW`. That is correct
 * product behaviour and a useless design harness: eleven of the twelve states
 * would have no item to render.
 *
 * So the workbench composes at `sessionInstant(...)` — `WORKBENCH_NOW`, or the
 * day her latest-scheduled instrument comes due, whichever is later. Every
 * instrument is then genuinely due or overdue and the composer offers on its
 * own terms. The instant is **derived from her replayed state**, so it is
 * deterministic, it is reported on the counts strip rather than hidden, and no
 * item's `dueState`, `priorState` or ordering is fabricated to reach it. A
 * screenshot taken at that instant is a screenshot of a real session; it is
 * simply not a session on 15 January.
 */

import type { ReviewLogEntry } from 'olea-contracts';
import type {
  ComposedQueue,
  QueueCandidate,
  RandomSource,
  ReviewSession,
  SchedulableInstrumentType,
  Scheduler,
  VaultInstrumentRecord,
  VaultSource,
} from 'olea-core';
import { buildReviewSession, composeQueue, enumerateVaultInstruments } from 'olea-core';
import { WORKBENCH_NOW } from '../clock.js';
import { createDeterministicRandom } from '../deterministic-random.js';
import { adaptReviewQueue, type ReviewQueueItem } from '../plugin-bridge.js';

/**
 * The vault's own index file documents the card separators it documents, so a
 * parser reads real cards out of its prose. Excluded by name, exactly as
 * `packages/core`'s fixture suites exclude it and for the same reason.
 */
const NOT_A_FIXTURE_NOTE = ['README.md'];

export interface WorkbenchQueue {
  /** Offered items whose instrument is a Q&A card, in composition order. */
  readonly qa: readonly ReviewQueueItem[];
  readonly cloze: readonly ReviewQueueItem[];
  readonly mcq: readonly ReviewQueueItem[];
  /** The plain session — no format preference — for the inspector and the counts line. */
  readonly session: ReviewSession;
  /** The queue composed at `at`, with no format preference. */
  readonly offered: ComposedQueue;
  /** The instant every composition above was run at. See the module doc. */
  readonly at: Date;
}

/**
 * `WORKBENCH_NOW`, or the day her latest-scheduled instrument comes due,
 * whichever is later.
 *
 * A vault nobody has reviewed has no scheduled instrument and therefore no
 * later instant, so `?persona=none` composes at `WORKBENCH_NOW` exactly as it
 * always has.
 */
export function sessionInstant(candidates: readonly QueueCandidate[]): Date {
  let latest = WORKBENCH_NOW.getTime();
  for (const candidate of candidates) {
    if (candidate.state === null) continue;
    const due = Date.parse(candidate.state.due);
    if (!Number.isNaN(due) && due > latest) latest = due;
  }
  return new Date(latest);
}

export interface DeriveWorkbenchQueueOptions {
  readonly vault: VaultSource;
  readonly scheduler: Scheduler;
  /**
   * The loaded persona's history, as parsed records — either a literal list, or
   * a function of the instruments this vault turned out to hold, which is what
   * `persona/history.ts`'s `entriesFor` is. An empty list is `?persona=none`: a
   * vault whose every instrument is a first exposure.
   *
   * Handed over as records rather than read from a folder, which is the half of
   * the README's open question that keeps `.olea-synthetic/` a fact about this
   * package: core never learns the namespace exists, and the generator's guard
   * against `.olea/` is untouched because nothing here writes.
   */
  readonly entries:
    | readonly ReviewLogEntry[]
    | ((records: readonly VaultInstrumentRecord[]) => readonly ReviewLogEntry[]);
}

function itemsOfType(
  queue: ComposedQueue,
  recordsById: ReadonlyMap<string, VaultInstrumentRecord>,
  type: SchedulableInstrumentType,
  random: RandomSource,
): readonly ReviewQueueItem[] {
  const filtered: ComposedQueue = {
    items: queue.items.filter((item) => item.instrumentType === type),
    deferred: queue.deferred,
  };
  // `random` is threaded through explicitly (see ../deterministic-random.ts):
  // MCQ presentation (F2.15) samples and shuffles at adaptation time, and a
  // caller that leaves this at its `Math.random` default gets a different
  // option set on every page load — which WB-2's visual-regression harness
  // found by loading the same URL twice and diffing the DOM.
  return adaptReviewQueue({ queue: filtered, recordsById, random });
}

/** One walk, one replay, four compositions at one derived instant. */
export async function deriveWorkbenchQueue(
  options: DeriveWorkbenchQueueOptions,
): Promise<WorkbenchQueue> {
  // The persona's join needs to know which instruments exist before it can map
  // her stream onto them, and the composer needs her stream before it can
  // replay. So the walk happens first and its result is handed to both.
  const entries =
    typeof options.entries === 'function'
      ? options.entries(
          (await enumerateVaultInstruments(options.vault, { excludePaths: NOT_A_FIXTURE_NOTE }))
            .records,
        )
      : options.entries;

  const session = await buildReviewSession({
    vault: options.vault,
    scheduler: options.scheduler,
    now: WORKBENCH_NOW,
    entries,
    instruments: { excludePaths: NOT_A_FIXTURE_NOTE },
  });

  const at = sessionInstant(session.candidates);
  const compose = (formatPreference: readonly SchedulableInstrumentType[]): ComposedQueue =>
    composeQueue({
      candidates: session.candidates,
      now: at,
      suspended: session.suspended,
      formatPreference,
    });

  // One fixed-seed source, threaded through every adaptation this call makes,
  // in the same fixed call order every time — so MCQ presentation (F2.15) is
  // reproducible across page loads, the same as everything else this module
  // composes at a deterministic instant. See ../deterministic-random.ts.
  const random = createDeterministicRandom();

  const offered = compose([]);
  return {
    qa: itemsOfType(compose(['qa']), session.recordsById, 'qa', random),
    cloze: itemsOfType(compose(['cloze']), session.recordsById, 'cloze', random),
    mcq: itemsOfType(compose(['mcq']), session.recordsById, 'mcq', random),
    session,
    offered,
    at,
  };
}

/** One line for the workbench's counts strip: what the corpus produced, honestly. */
export function describeWorkbenchQueue(queue: WorkbenchQueue, fixtureFileCount: number): string {
  const { records } = queue.session.instruments;
  const composedAt = queue.at.toISOString().slice(0, 10);
  const shifted = queue.at.getTime() !== WORKBENCH_NOW.getTime();
  return (
    `${String(records.length)} instruments in ${String(fixtureFileCount)} fixture files · ` +
    `${String(queue.offered.items.length)} offered, ${String(queue.offered.deferred.length)} deferred by per-concept dedupe (F2.17) · ` +
    `${String(queue.qa.length)} Q&A · ${String(queue.cloze.length)} cloze · ${String(queue.mcq.length)} MCQ reachable · ` +
    (shifted
      ? `composed as of ${composedAt}, the day her latest-scheduled instrument comes due`
      : `composed as of ${composedAt}`)
  );
}
