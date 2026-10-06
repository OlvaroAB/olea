/**
 * `createLocalPracticePaperProvider` — the practice-paper command/view's own composition root
 * (F4.11, `[D-250]`/`[D-252]`/`[D-262]`, `[PAPER-8]` / `ol-egov.141.6.1`).
 *
 * Follows the same shape `gap/provider.ts` and `session-builder/provider.ts` already establish:
 * no cache (`load`/`requestPaper` both recompute from the live vault every call — C6, D-002/D-004/
 * D-005/D-008), and every AI-dependent step greys out honestly (F7.8) rather than half-working.
 *
 * **What this composes, and on what basis** — see `assemble.ts` and `unlock.ts`'s own module docs
 * for exactly which of F4.11's four blueprint inputs are read from real, already-wired production
 * data today (course-scoped `ConceptRecord`s via `enumerateVaultInstruments`, real assignments via
 * `resolveAssessments` — F1.2's Base-or-manual-fallback choice, `ol-egov.141.8.10` — and, since
 * `ol-2zfj.172`, real Outcome coverage and Outcome labels via
 * `listOutcomeRecords`/`outcomeConceptCoverage`) and which are still honestly degraded because no
 * production reader exists yet anywhere in this repo (taughtSignal, mastery, past-paper
 * structure/demand recovery). Composing those remaining readers is a separate, multi-bead effort
 * this bead's own `owns` (`packages/plugin/src/paper/`) does not cover.
 *
 * **F1.2's fallback now reaches this provider (`ol-egov.141.8.10`).** `loadCourseState` no longer
 * exits to `'assignments-not-configured'` on a blank/unreadable Base alone — it reads through
 * `resolveAssessments` first and only reports that state when NEITHER a real Base NOR any manual
 * entry (any course) produced a record; a single manual entry is enough to graduate past it, even
 * for a different course than the one being loaded (that course then reads its own, ordinary
 * `'no-assessment-ahead'`/`'locked'`/`'unlocked-not-pulled'` state off whatever `records` it has).
 */

import {
  buildPaperBlueprint,
  enumerateVaultInstruments,
  handOffPaperItem,
  isEligiblePaperConcept,
  listOutcomeRecords,
  outcomeConceptCoverage,
  type PaperEmptySlot,
  type PaperGroundingLabel,
  type PaperHandoffResult,
  type PaperRecord,
  paperDaysUntilDue,
  resolveAssessments,
  type VaultSource,
  writeInstrumentCitation,
} from 'olea-core';
import { ensureHomeNoteForConcept } from '../generation/home-note.js';
import type { PaperSlotOutcomePort } from '../oracle/paper-item-port.js';
import type { PersistedStudyPlanConfig } from '../plan/settings-store.js';
import { buildBlueprintInputForCourse } from './assemble.js';
import type { IncompletePaperStatement, PartialPaperStatement } from './copy.js';
import {
  AUTHORING_SPEC_CHANGED_SENTENCE,
  buildIncompletePaperStatement,
  buildPartialPaperStatement,
  UNFINISHED_PAPER_SENTENCE,
} from './copy.js';
import type { PaperDemand } from './demand.js';
import { composePaperThroughJournal } from './journal-composition.js';
import { evaluatePracticePaperUnlockForCourse } from './unlock.js';

/**
 * Where a handed-off item's instrument enters the vault (`[D-391]`/`[D-407]`'s `PaperHandoffTarget.
 * notePath`, "the caller's" per that type's own doc) — `ol-0r92.135`'s own Class B default, not a
 * ruling: F4.11/`[D-252]`/`[D-367]`/`[D-391]`/`[D-407]` say WHAT the hand-off is and WHAT it
 * stamps, never WHICH note a fresh instrument is entered into.
 *
 * **Why a course-scoped Olea home note, not one of her own authored notes.** The item must land
 * where the ordinary review queue can actually find it: `enumerateVaultInstruments` binds an
 * instrument to a concept only through its note's own `topic:` frontmatter
 * (`generation/home-note.ts`'s module doc), so the destination note MUST carry `item.conceptName`
 * in `topic:` or the handed-off item would be entered but never queued — silently defeating the
 * whole point of the act. Reusing `ensureHomeNoteForConcept` unmodified (this module's existing
 * `[D-179]` mechanism) gets that binding for free and keeps the destination in Olea's own layer
 * (INV-6 Part Two, `[D-097]`) — no consent question about WHOSE note is written into, only about
 * the hand-off act itself, which her button press already supplies. A synthetic, extension-less
 * "source path" under this folder (never a real document) makes `homeNotePathForSource` derive one
 * stable note per course, reusing every existing collision/marker/topic-growth guarantee that
 * module already has tests for.
 *
 * **Reversible, non-persisted.** Nothing durable names this folder: `[D-407]`'s own `paper-origin:`
 * field on the entered block carries only `paperId`/`slotId`, never a path, and
 * `paperItemInstrumentId` derives the instrument id from those two ids alone — so moving this
 * folder, or replacing it with a different destination rule entirely, changes where a FUTURE
 * hand-off's note lands and nothing about any hand-off already made. Flagged for retroactive
 * review, per `CLAUDE.md`'s Class B ladder.
 */
const PRACTICE_PAPER_HANDOFF_FOLDER = 'Practice paper hand-offs';

/** One face-ready item — the labels the view renders alongside her response, never the blueprint's internal weight/rank fields she has no reason to see. */
export interface PracticePaperFaceItem {
  readonly slotId: string;
  readonly conceptName: string;
  readonly intendedDemand: PaperDemand;
  readonly groundingLabel: PaperGroundingLabel;
  readonly response: unknown;
}

/** What the view renders once a paper has been composed. `partialStatement` is placed BEFORE `items` by the view — ruling 4: "before she opens it" — never a footnote after them. */
export interface PracticePaperReadyState {
  readonly kind: 'ready';
  readonly course: string;
  readonly record: PaperRecord;
  readonly partial: boolean;
  readonly partialStatement: PartialPaperStatement | null;
  /** `[D-457]`: derived from the record's own completion and empty slots, never persisted. Null for a complete or flat paper. */
  readonly incompleteStatement: IncompletePaperStatement | null;
  readonly items: readonly PracticePaperFaceItem[];
  readonly emptySlots: readonly PaperEmptySlot[];
  /** `[D-532]`: saved progress was discarded because her material changed; the view shows the ruled sentence once, above the paper. */
  readonly materialChanged: boolean;
}

/** The coverage counts a locked paper may state (F4.11, `[D-252]`): counts and whether known, never a share. */
export interface LockedCoverageCounts {
  readonly outcomeCount: number;
  /** Declared outcomes with at least one attached concept: the count the unlock gate reads. */
  readonly attachedOutcomeCount: number;
  readonly outcomeCoverageKnown: boolean;
  readonly conceptCount: number;
  readonly conceptCoverageKnown: boolean;
  readonly attachedConceptCount: number;
}

export type PracticePaperCourseState =
  /** F4.11: "the affordance is absent" — never present with a reason when nothing is ahead. */
  | {
      readonly kind: 'no-assessment-ahead';
      readonly course: string;
      /** `[D-532]`: the course has an assessment record with no usable date (and none ahead), so the view explains it rather than saying there is none. */
      readonly undatedAssessment: boolean;
    }
  /** Present, with a reason (`copy.ts`'s `buildLockedCopy`) — see that function's doc for the F8.3 gap this composition cannot yet fill honestly. */
  | {
      readonly kind: 'locked';
      readonly course: string;
      readonly daysUntilNearest: number;
      readonly nearestAssessmentDue: string;
      /**
       * ol-egov.141.89.7.61: the counts the locked reason states, with whether each is known (a
       * course with no active declaration is unknown, never a measured zero). Counts only: the
       * share the unlock rule reads is internal and never carried here (F8.3). The sentence that
       * states them is held for a ruling.
       */
      readonly coverage: LockedCoverageCounts;
      /** `[D-532]`: the smallest declared-topic count with her material behind it that unlocks the paper, computed from the unlock gate; null when no scope is declared. */
      readonly topicsNeeded: number | null;
      /** `[D-532]`: the proximity window in days, read from the unlock gate. */
      readonly windowDays: number;
    }
  /** Unlocked, not yet pulled — she has not yet invoked the one affordance. */
  | { readonly kind: 'unlocked-not-pulled'; readonly course: string }
  /** F7.8's grey-out: unlocked, but no Worker configured to generate items with. */
  | { readonly kind: 'ai-unavailable'; readonly course: string }
  /** The assignments Base itself is not configured — same precondition every other course-scoped screen in this plugin already gates on. */
  | { readonly kind: 'assignments-not-configured' }
  | PracticePaperReadyState;

export interface CreateLocalPracticePaperProviderDeps {
  readonly vault: VaultSource;
  readonly settingsStore: { load(): Promise<PersistedStudyPlanConfig> };
  /**
   * The three-outcome port (`[D-430]`): a slot's call ends `generated`, `refused` or `unavailable`
   * and never throws, so the journal can keep an outage apart from a refusal. `null` is F7.8's
   * grey-out (no Worker configured).
   */
  readonly generationPort: () => Promise<PaperSlotOutcomePort | null>;
  readonly now: () => Date;
}

/**
 * The smallest whole number of declared topics that unlocks the paper: the least `t` with
 * `t / topicCount >= gateShare`, using the gate's own comparison (`paper-unlock.ts`), never a float
 * multiplication. Computed from the gate so a moved gate moves the sentence ([D-532], [D-255]).
 */
export function topicsNeededToUnlock(topicCount: number, gateShare: number): number {
  for (let t = 1; t <= topicCount; t += 1) {
    if (t / topicCount >= gateShare) return t;
  }
  return topicCount;
}

function isoToday(now: Date): string {
  return now.toISOString().slice(0, 10);
}

/**
 * Reads real assignments-table records for `course` (F1.2's Base-or-manual fallback,
 * `resolveAssessments`), real Outcome coverage (`ol-2zfj.172`) and evaluates the unlock rule
 * against them (`unlock.ts`). No cache — recomputed on every call, same as `requestPaper` (module
 * doc).
 */
async function loadCourseState(
  deps: CreateLocalPracticePaperProviderDeps,
  course: string,
): Promise<PracticePaperCourseState> {
  const config = await deps.settingsStore.load();

  const [assessmentsRead, enumeration, outcomeRecords] = await Promise.all([
    resolveAssessments(deps.vault, config.assignmentsBasePath),
    // `[D-357]`: the permanent concept key, the one her review log carries.
    enumerateVaultInstruments(deps.vault, { concepts: { stampConceptKeys: true } }),
    listOutcomeRecords(deps.vault),
  ]);
  const { records } = assessmentsRead;
  // F1.2: "not configured" now means neither a real Base NOR any manual entry produced anything
  // to work from — `resolveAssessments`'s own `source: 'manual'` with zero records is exactly
  // that state (a blank OR unreadable Base, and she has typed nothing by hand either).
  if (assessmentsRead.source === 'manual' && records.length === 0) {
    return { kind: 'assignments-not-configured' };
  }

  const courseAssessments = records.filter((record) => record.course === course);
  const asOf = isoToday(deps.now());

  const courseConceptKeys = enumeration.concepts
    .filter((concept) => concept.courses.includes(course))
    .map((concept) => concept.key);
  const courseOutcomes = outcomeRecords
    .map((entry) => entry.record)
    .filter((record) => record.courses.includes(course));
  const coverage = outcomeConceptCoverage(courseOutcomes, courseConceptKeys);

  const unlock = evaluatePracticePaperUnlockForCourse(
    asOf,
    courseAssessments
      .filter((record) => record.type !== undefined && record.due !== undefined)
      .map((record) => ({ type: record.type as string, due: record.due as string })),
    coverage,
  );

  if (unlock.nearestAssessment === null) {
    // `[D-532]`: a record with no readable date is not the same as none ahead.
    const undatedAssessment = courseAssessments.some(
      (record) => record.due === undefined || paperDaysUntilDue(asOf, record.due) === null,
    );
    return { kind: 'no-assessment-ahead', course, undatedAssessment };
  }
  if (!unlock.fires) {
    return {
      kind: 'locked',
      course,
      daysUntilNearest: unlock.daysUntilNearest ?? 0,
      nearestAssessmentDue: unlock.nearestAssessment.due,
      topicsNeeded:
        coverage.outcomeCoverageKnown === true
          ? topicsNeededToUnlock(coverage.outcomeCount, unlock.coverageGateShare)
          : null,
      windowDays: unlock.proximityWindowDays,
      coverage: {
        outcomeCount: coverage.outcomeCount,
        attachedOutcomeCount: coverage.attachedOutcomeCount,
        outcomeCoverageKnown: coverage.outcomeCoverageKnown === true,
        conceptCount: coverage.conceptCount,
        conceptCoverageKnown: coverage.conceptCoverageKnown === true,
        attachedConceptCount: coverage.attachedConceptCount,
      },
    };
  }
  return { kind: 'unlocked-not-pulled', course };
}

/**
 * Pure: `PaperRecord` → the view's ready-state, including ruling 4's face statement. Pulled out of
 * `requestPaper` so it is directly testable against a hand-built `PaperRecord` — see
 * `test/paper/provider.spec.ts`'s "face states the gap" scenarios, which construct a record with
 * `compositionAccount.unbuiltDemand` set rather than driving the whole vault/Worker pipeline to
 * reach one (this composition's own `structure: null` default means a REAL course can never reach
 * `unbuiltDemand !== null` today — see `assemble.ts`'s module doc — so this is the only way to
 * exercise the render honestly until a real past-paper structure reader exists).
 */
export function buildReadyStateFromRecord(
  course: string,
  record: PaperRecord,
  options: { readonly materialChanged?: boolean } = {},
): PracticePaperReadyState {
  const partialStatement =
    record.compositionAccount.unbuiltDemand === null
      ? null
      : buildPartialPaperStatement(
          record.compositionAccount.unbuiltDemand.demand,
          record.compositionAccount.unbuiltDemand.pointerSourceRefs,
        );

  return {
    kind: 'ready',
    course,
    record,
    partial: record.compositionAccount.partial,
    partialStatement,
    incompleteStatement: buildIncompletePaperStatement(record.completion, record.emptySlots),
    items: record.items.map((item) => ({
      slotId: item.slotId,
      conceptName: item.conceptName,
      intendedDemand: item.intendedDemand,
      groundingLabel: item.groundingLabel,
      response: item.response,
    })),
    emptySlots: record.emptySlots,
    materialChanged: options.materialChanged === true,
  };
}

/**
 * `[D-430]`: thrown by `requestPaper` when work is owed and no paper was created. The unfinished
 * paper is KEPT in the resumable journal (`./journal-composition.ts`) and the next request resumes
 * it, drafting only the missing parts; nothing is handed over in the meantime, because a paper with
 * holes because the service was down does not exist (only an explicitly qualified partial, a source
 * or capability gap, is ever handed over, and that is a `ready` state).
 *
 * **Data only.** This error carries counts and an id and no words for her; the view reads her
 * sentence from `unfinishedPaperNotice` (`[D-457]`, `[D-532]`), and a request that ends in any error
 * never leaves the composing pane (ol-egov.141.89.7.63). Content-free (D-005): no concept, note or
 * reason string.
 */
export class PracticePaperUnfinishedError extends Error {
  readonly course: string;
  /** `'service-unavailable'`: a part stayed unavailable after its retry. `'authoring-spec-changed'`: a resumed part came back under another prompt version, so the journal was set aside and the next request starts afresh. */
  readonly reason: 'service-unavailable' | 'authoring-spec-changed';
  readonly journalId: string;
  readonly plannedSlotCount: number;
  readonly owedSlotCount: number;

  constructor(params: {
    readonly course: string;
    readonly reason: 'service-unavailable' | 'authoring-spec-changed';
    readonly journalId: string;
    readonly plannedSlotCount: number;
    readonly owedSlotCount: number;
  }) {
    super(
      `The practice paper is not finished: ${params.owedSlotCount} of ${params.plannedSlotCount} parts are still owed, so nothing was handed over.`,
    );
    this.name = 'PracticePaperUnfinishedError';
    this.course = params.course;
    this.reason = params.reason;
    this.journalId = params.journalId;
    this.plannedSlotCount = params.plannedSlotCount;
    this.owedSlotCount = params.owedSlotCount;
  }
}

/**
 * `[D-457]`: the sentence she reads when a request ended unfinished, or null when the error is not
 * one she should be told that about. Only an outage (`'service-unavailable'`) keeps a paper that
 * "Ask again" continues; a journal set aside for another authoring specification starts afresh, so
 * the continue sentence would be untrue and she reads `[D-532]`'s own sentence for it instead.
 */
export function unfinishedPaperNotice(error: unknown): string | null {
  if (!(error instanceof PracticePaperUnfinishedError)) return null;
  return error.reason === 'service-unavailable'
    ? UNFINISHED_PAPER_SENTENCE
    : AUTHORING_SPEC_CHANGED_SENTENCE;
}

export interface PracticePaperViewDeps {
  /** Loads the CURRENT state for `course` — locked/unlocked/absent, never a composed paper (that only happens on `requestPaper`, F4.11 ruling 5: "she pulls it"). */
  readonly load: (course: string) => Promise<PracticePaperCourseState>;
  /** Composes and persists a fresh paper for `course`. Never called unless `load` already returned `unlocked-not-pulled` — the view's own job, not this provider's, mirroring every other command-gated affordance in this plugin. */
  readonly requestPaper: (
    course: string,
  ) => Promise<
    PracticePaperReadyState | { readonly kind: 'ai-unavailable'; readonly course: string }
  >;
  /**
   * Hands ONE item to ordinary review (F4.11 ruling 1, `[D-252]`) — never the whole paper; the
   * view's per-item control is the only caller, and it is never asked to hand off more than one
   * `slotId` per call. Idempotent: a repeat for a `slotId` already on `record.handoffs` writes no
   * new instrument and returns the SAME `instrumentId` (`[D-391]`) — the view relies on this rather
   * than tracking "already pressed" itself. See `PRACTICE_PAPER_HANDOFF_FOLDER`'s doc for where
   * `notePath` and `questionIndex` (always `0`) come from.
   */
  readonly handOffItem: (
    course: string,
    paperId: string,
    slotId: string,
    conceptName: string,
  ) => Promise<PaperHandoffResult>;
}

type RequestedPaper =
  | PracticePaperReadyState
  | { readonly kind: 'ai-unavailable'; readonly course: string };

/**
 * One `requestPaper`: the blueprint from the live vault, then the paper composed through the
 * resumable journal (`./journal-composition.ts`, `[D-430]`). Finished (complete or an explicitly
 * qualified partial) becomes the ready state; work owed throws `PracticePaperUnfinishedError`.
 */
async function composeRequestedPaper(
  deps: CreateLocalPracticePaperProviderDeps,
  course: string,
): Promise<RequestedPaper> {
  const port = await deps.generationPort();
  if (port === null) return { kind: 'ai-unavailable', course };

  const config = await deps.settingsStore.load();
  const asOf = isoToday(deps.now());
  const [{ records }, enumeration, outcomeRecords] = await Promise.all([
    resolveAssessments(deps.vault, config.assignmentsBasePath),
    // `[D-357]`: the permanent concept key, the one her review log carries.
    enumerateVaultInstruments(deps.vault, { concepts: { stampConceptKeys: true } }),
    listOutcomeRecords(deps.vault),
  ]);

  const input = await buildBlueprintInputForCourse(
    deps.vault,
    enumeration.concepts,
    records,
    course,
    asOf,
    outcomeRecords.map((entry) => entry.record),
  );
  const blueprint = buildPaperBlueprint(input);

  const composed = await composePaperThroughJournal({
    vault: deps.vault,
    blueprint,
    scope: {
      eligibleConceptKeys: input.concepts
        .filter(isEligiblePaperConcept)
        .map((concept) => concept.conceptKey),
      outcomes: (input.outcomes ?? []).map((outcome) => ({
        outcomeId: outcome.outcomeId,
        conceptKeys: outcome.conceptKeys,
      })),
    },
    port,
  });
  if (composed.kind === 'unfinished') {
    throw new PracticePaperUnfinishedError({
      course,
      reason: composed.reason,
      journalId: composed.journalId,
      plannedSlotCount: composed.plannedSlotCount,
      owedSlotCount: composed.owedSlotCount,
    });
  }
  return buildReadyStateFromRecord(course, composed.record, {
    materialChanged: composed.materialChanged,
  });
}

/** The production `PracticePaperViewDeps` — see the module doc. */
export function createLocalPracticePaperProvider(
  deps: CreateLocalPracticePaperProviderDeps,
): PracticePaperViewDeps {
  const inFlight = new Map<string, Promise<RequestedPaper>>();
  return {
    load: (course) => loadCourseState(deps, course),

    requestPaper(course) {
      // One composition per course at a time: a second press while the first is composing shares
      // its work (the journal is single-writer, and two runs over one journal would spend twice
      // and race each other's whole-file rewrites). Cleared when the request settles, so the next
      // press, after a finished paper, composes a fresh one (F4.11 ruling 5).
      const running = inFlight.get(course);
      if (running !== undefined) return running;
      const request = composeRequestedPaper(deps, course).finally(() => {
        inFlight.delete(course);
      });
      inFlight.set(course, request);
      return request;
    },

    async handOffItem(course, paperId, slotId, conceptName) {
      // Synthetic, extension-less "source path": never a real document, just a stable per-course
      // key `homeNotePathForSource` turns into one reused note (`PRACTICE_PAPER_HANDOFF_FOLDER`'s
      // doc). `ensureHomeNoteForConcept` grows the note's `topic:` to include `conceptName`
      // idempotently, so review-queue binding holds whether this is the note's first item or its
      // fifth.
      const notePath = await ensureHomeNoteForConcept(
        deps.vault,
        `${PRACTICE_PAPER_HANDOFF_FOLDER}/${course}`,
        conceptName,
      );
      if (notePath === null) {
        throw new Error(
          `handOffItem: a note already sits at "${PRACTICE_PAPER_HANDOFF_FOLDER}/${course}.md" ` +
            "and is not one of Olea's own home notes — refusing to write into it (INV-6).",
        );
      }
      // Ruling: the paper view is "the item's" own reader (`paper-items.ts`'s
      // `paperItemMcqCandidate` doc) — see `ol-0r92.135`'s copy-pass notes for why index 0, always,
      // is the only choice consistent with an id that carries no index information.
      const result = await handOffPaperItem(deps.vault, paperId, slotId, {
        notePath,
        questionIndex: 0,
      });
      // `[D-181]`'s citation sidecar, self-referential (`materialize-mcq.ts`'s own precedent for a
      // generated instrument with no separately-citable unit) — written only on the write that
      // actually created the block, never on a repeat hand-off, since `writeInstrumentCitation`
      // itself refuses to overwrite an existing record and a repeat's `instrumentWritten` is
      // `false` by construction (`PaperHandoffResult`'s own doc).
      if (result.instrumentWritten) {
        await writeInstrumentCitation(deps.vault, result.instrumentId, { sourcePath: notePath });
      }
      return result;
    },
  };
}
