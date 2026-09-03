/**
 * Shapes the review view (P2-T08, F2.2/F2.4/F2.6/F2.13/F2.16/Q6.5) renders and
 * mutates. These are deliberately **not** the same types `packages/core`'s
 * `Scheduler`/`review-log` own — `ReviewInstrument` is a presentation shape
 * (question text, options, note path), not a persisted or schedulable one.
 * Nothing here is exported from `olea-core`; nothing here is a schema.
 *
 * `ReviewQueueItem` is the seam this view actually depends on. Composing the
 * day's queue in the right order, with per-session concept dedupe and
 * course/topic filtering, is `ol-p2t07`'s job (not this bead's — see this
 * file's own doc header and the P2-T08 report for why); this type is what
 * that composer is expected to hand the view once it exists. Until then,
 * callers (tests, and any manual harness) construct `ReviewQueueItem[]`
 * directly.
 */

import type { InstrumentType, Rating, SelectionContextV4 } from 'olea-contracts';
import type { SchedulerState, SupportLevelPresentation } from 'olea-core';

/** The three instrument types the review view actually renders (F2.14: `explain-back` is never queued/rated here — F2.12/F5 territory, not this bead). */
export type ReviewInstrumentType = Extract<InstrumentType, 'qa' | 'cloze' | 'mcq'>;

export interface ReviewInstrumentCommon {
  readonly instrumentId: string;
  /**
   * Every concept this instrument is evidence for, in her authored `topic:`
   * order — passed straight through to the v3 review-log write (`ol-t3sd`).
   * Not rendered: the meta line shows a course and a note title, never a
   * concept list.
   */
  readonly conceptIds: readonly string[];
  /** Invented course code shown in the meta line (e.g. `COGS214`) — never a real course name (INV-3; see this package's review/README notes in the P2-T08 report). */
  readonly courseCode: string;
  /** The note title shown faint, beside the course code. Fixture/synthetic only — never sourced from a real vault. */
  readonly noteTitle: string;
  /** Vault path of the source note, for `EditPort` and the "source note deleted" scenario (F2.6). */
  readonly sourcePath: string;
  /** Block id the card was anchored to (C1.4), if any — used to jump the editor to the right line. */
  readonly blockId: string | null;
  /**
   * `null` for an ordinary, already-scheduled instrument. Non-`null` means
   * this item is a cached, unreviewed draft (F3.3, `[CACHE-1]`, `ol-p3t07a`)
   * being served for the FIRST time — the value is the cache record's own
   * id, which `generation/accept.ts`'s `DraftAcceptPort` resolves the moment
   * she answers, edits, or rejects it. `instrumentId` on a draft item is a
   * transient stand-in (the draft id itself) until that resolution mints
   * the real one — see `generation/review-adapter.ts`'s module doc.
   */
  readonly draftId: string | null;
  /**
   * Row 3.9's chooser decision for this instrument ([SUPP-3], `ol-lpl4`) —
   * mirrors `olea-core`'s `StudySessionItem.supportLevel` ([SUPP-2],
   * `ol-95vv.4`), threaded here rather than left off this queue's own item
   * shape entirely: `session.ts`'s `logAndAdvance` reads it straight off
   * `item.instrument` to fill `RecordReviewInput.supportLevel` (`ports.ts`),
   * which is the write seam that turns it into `supportLevelShown`.
   * `undefined` when no decision was made — an `'mcq'` item (`[D-094]`'s
   * ladder has no recognition tier) or a caller that supplied no
   * `supportHistory` to `queue-adapter.ts`'s `adaptReviewQueue`/
   * `adaptExecutedReviewQueue` at all. Never a fabricated `'independent'`/
   * `'not-offered'` value standing in for "we did not ask" — same discipline
   * `StudySessionItem.supportLevel`'s own doc states.
   */
  readonly supportLevel?: SupportLevelPresentation;
}

export interface QaCard extends ReviewInstrumentCommon {
  readonly type: 'qa';
  readonly question: string;
  /** The answer block, rendered under "From your own note" (matches `ReviewStates.jsx`'s `PluginCardReveal`). */
  readonly answer: string;
}

export interface ClozeCard extends ReviewInstrumentCommon {
  readonly type: 'cloze';
  readonly before: string;
  /** The blanked span — hidden pre-reveal, highlighted post-reveal. */
  readonly clozeText: string;
  readonly after: string;
  /** Optional note-derived context line under the sentence (matches `MobileStates.jsx`'s `PluginMobileReveal`). */
  readonly noteContext: string | null;
}

export interface McqOption {
  readonly id: string;
  readonly label: string;
  readonly correct: boolean;
  /**
   * `[D-202]` (`ol-egov.92`, `ol-0r92.44`) — this distractor's wrong belief
   * and correcting source, present only when it survived generation through
   * to review time. `undefined` for a correct option always, and for every
   * distractor today: `[D-195]`'s per-distractor grounding
   * (`packages/plugin/src/generation/types.ts`'s `DraftDistractorGrounding`)
   * is currently in-memory/cache-scoped only — nothing yet persists it onto
   * the vault's MCQ block or a sidecar `queue-adapter.ts` could read it back
   * from, so no production composer sets these two fields yet. They exist
   * here, ahead of that plumbing, so `session.ts`'s `mcqNext` has somewhere
   * to read provenance from the moment a later bead wires it — see that
   * follow-up's filing on `ol-0r92.44`'s close notes. Never a fabricated
   * value: absence here means "not carried forward", not "no misconception".
   */
  readonly believes?: string;
  /** Paired with `believes` above — see that field's own doc. */
  readonly source_says?: string;
}

export interface McqItem extends ReviewInstrumentCommon {
  readonly type: 'mcq';
  readonly stem: string;
  /** Already sampled-and-shuffled by whatever composed the queue (F2.15) — this view renders them in the order given, never reorders. */
  readonly options: readonly McqOption[];
  /** Shown once she answers, regardless of correctness (matches `PluginMcqAnswered`). */
  readonly feedback: string;
}

export type ReviewInstrument = QaCard | ClozeCard | McqItem;

/**
 * One queue entry. `priorState` and `selectionContext` are owned by queue
 * composition (C5.5/D7.1) — this view only ever reads them (interval preview,
 * review-log stamping), never derives or persists them itself.
 */
export interface ReviewQueueItem {
  readonly instrument: ReviewInstrument;
  /** This instrument's scheduling state before today's review, or `null` before its first-ever review. */
  readonly priorState: SchedulerState | null;
  /** D7.1's "why was this offered" record — passed straight through to the review-log write. */
  readonly selectionContext: SelectionContextV4;
}

export type { Rating, SelectionContextV4 };
