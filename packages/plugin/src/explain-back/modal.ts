/**
 * `ExplainBackModal` — the ONE dedicated "Explain it back" view (F5.1,
 * `[D-163]`, `ol-12gs`). Single rendering implementation: every one of the
 * four ruled entry points (on-demand F5, confusion routing F2.12, session
 * assembly F4.6, Today's suggestion F6.4) constructs and opens exactly this
 * class — there is no second inline copy of this exchange anywhere in the
 * plugin. Typed input is the ship floor (F5.1); voice is a later, second
 * input method on this SAME view, not built here.
 *
 * ===========================================================================
 * WHAT THIS VIEW DOES AND DOES NOT DO (scope, disclosed per DF-20)
 * ===========================================================================
 * Wires the two ports `ol-12gs` names as "the waiting pipeline this finally
 * makes reachable": `gradeExplainBackAttempt` and
 * `acceptExplainBackGradingWithObservation` (`../grading/wiring.ts`).
 *
 * `ol-cqz8` UPDATE: `acceptGrading` below now ALSO runs the SOLO depth
 * pipeline and appends the subject's own review-log event, via
 * `deps.recordSoloGradeAndReview` — see `./solo-review.ts`'s module doc for
 * the full chain (`gradeSoloAttempt` → `acceptSoloGrading` →
 * `recordGradedExplainBackReview`) and for why this settles as ONE review
 * event, not two. That dep is optional and best-effort (mirrors
 * `acceptWithObservation`'s own failure-isolation posture): `originReview
 * EventId` stays `null` below for the unrelated reason it already was
 * (nothing here reads a PRIOR review event's id — `recordSoloGradeAndReview`
 * writes a fresh one).
 *
 * `ol-0r92.48` UPDATE (`[D-217]`): the graded phase's old three-verdict
 * heading is gone — `renderGradedPhase` below never renders a heading at
 * all, because the SOLO depth level `[D-217]` requires it to read is not
 * known yet at that point in the exchange (it grades later, inside
 * `acceptGrading`, per the paragraph above). `deps.recordSoloGradeAndReview`
 * now optionally returns the `SoloLevel` it graded — `void`/`undefined` when
 * nothing was written (no concept id, the Worker unconfigured, a caught
 * failure) — and `renderAcceptedPhase` renders `explainBackDepthHeading`
 * when one comes back, never a placeholder when it does not. The return
 * type is widened rather than changed (`SoloLevel | void`) so `main.ts`'s
 * existing `Promise<void>`-returning wrapper (outside this bead's `owns`)
 * keeps satisfying the interface unmodified; that wrapper does not yet
 * forward the level `solo-review.ts`'s own `recordSoloGradeAndReview`
 * computes internally (via `acceptSoloGrading`) but never returns — closing
 * that is a small, disclosed follow-up in two files this bead does not own
 * (`solo-review.ts`, `main.ts`), not a gap in this render path itself.
 *
 * `ol-yj0k` UPDATE: `durationMs` on that same review-log write is now real,
 * not a hardcoded `null` — this view is the only place that can observe
 * both endpoints of "presentation to answer" for explain-back (they are UI
 * state transitions, not anything `solo-review.ts` resolves), so it times
 * itself (`presentedAtMs`/`now`, both above `render()`) and passes the
 * result through `acceptGrading` into `recordSoloGradeAndReview`. See
 * `submitAnswer`'s own doc for exactly which two moments are measured.
 *
 * It does NOT:
 * - Support relation-context prompts (F5.2a's neighbour-concept retrieval) —
 *   see `./request.ts`'s module doc for why this view is concept-only.
 * - Fold an accepted attempt into F4.6's session time accounting
 *   (`study-session/explain-back.ts`'s own "Reachability" section already
 *   names this as separate, unstarted work: recognising a live acceptance
 *   and durably attributing it to "this session").
 *
 * ===========================================================================
 * HAND-OFF + RESUME, NEVER A SECOND INLINE COPY
 * ===========================================================================
 * This is a `Modal`, not an `ItemView`: whatever screen was open underneath
 * it (a review session, the session builder, Today) is untouched while this
 * is open and simply still there — unfocused, not torn down — the moment it
 * closes. That IS the hand-off-and-resume `[D-163]` asks for: there is
 * nothing to "return to" because nothing else was ever replaced. `onClose`
 * calls `deps.onClosed?.()` purely so a caller can clear its own transient
 * banner/offer state (F2.12's confusion banner, specifically) — never to
 * rebuild or re-render the surface underneath, which needed no rebuilding.
 */

import type { App } from 'obsidian';
import { Modal } from 'obsidian';
import type { MasteryState, SoloLevel, SupportLevel } from 'olea-contracts';
import {
  buildGradingSourceMaterial,
  type CitedIssue,
  type ConceptDefiningPassages,
  type ConceptRelation,
  discardExplainBackGrading,
  type ExplainBackPromptContext,
  formatSourceCitation,
  type GradeExplainBackInput,
  type GradingRelationContext,
  type GroundedGrading,
  type PendingExplainBackGrading,
  type ResolvedRelationEdge,
  resolveGradingRelationContext,
} from 'olea-core';
import type {
  AcceptExplainBackGradingWithObservationContext,
  AcceptExplainBackGradingWithObservationResult,
} from '../grading/wiring.js';
import { openRegistryEntryFor } from '../registry/obsidian-ports.js';
import {
  EXPLAIN_BACK_CHECK_FAILED_REFUSAL,
  EXPLAIN_WHY_UNAVAILABLE,
  explainBackFullDepthEncouragement,
  explainBackInsufficientNotesRefusal,
} from '../review/copy.js';
import type { ReviewInstrument } from '../review/types.js';
import { renderSprig } from '../sprig/render-sprig.js';
import {
  EXPLAIN_BACK_ACCEPT_LABEL,
  EXPLAIN_BACK_ANSWER_PLACEHOLDER,
  EXPLAIN_BACK_CITED_HEADING,
  EXPLAIN_BACK_COULD_NOT_CHECK_EYEBROW,
  EXPLAIN_BACK_DISCARD_LABEL,
  EXPLAIN_BACK_FOUND_LIST_CAPTION,
  EXPLAIN_BACK_GRADING_LABEL,
  EXPLAIN_BACK_MISCONCEPTION_HEADING,
  EXPLAIN_BACK_MISSED_HEADING,
  EXPLAIN_BACK_MODAL_TITLE,
  EXPLAIN_BACK_NOTHING_MATCHED_EYEBROW,
  EXPLAIN_BACK_QUESTION_LABEL,
  EXPLAIN_BACK_REGISTRY_ENTRY_ACTION,
  EXPLAIN_BACK_SUBMIT_LABEL,
  EXPLAIN_BACK_TOPIC_CONTINUE_LABEL,
  EXPLAIN_BACK_TOPIC_PROMPT,
  explainBackDepthHeading,
} from './copy.js';
import {
  buildExplainBackPromptContextFromInstrument,
  buildExplainBackPromptContextFromTopic,
  buildGradeExplainBackInputFromTypedAnswer,
  type ExplainBackSourceBlock,
} from './request.js';
import { type ExplainBackSupportShown, supportLevelShownForExplainBack } from './solo-review.js';

/**
 * `ol-l7ew` [DOS-C5a] — what this view has on screen while she composes an
 * answer, which `[D-094]`'s ladder reads to say how much help she had, and
 * which `[D-281]` item 3 makes one of the four pieces of evidence the top
 * growth stage requires.
 *
 * Both false, and both are a statement about `renderAnsweringPhase` below,
 * which any reader can check against it in one screen: it renders the
 * question, a textarea and a submit button. No hint is offered, and the
 * cited source appears only AFTER grading (`renderGradedPhase`'s regions,
 * `renderFoundList`'s refusal), never open beside her while she writes.
 *
 * This is not a default standing in for a value nobody resolved — it is the
 * resolved value, recorded where the render method it describes can be read
 * next to it. Adding either affordance means flipping the flag in the same
 * change, and the recorded level follows without anything else moving. The
 * flags are NOT a control she can see or set: nothing renders them, and this
 * bead adds no affordance (that would be David's call, not a lane's).
 */
const EXPLAIN_BACK_ANSWERING_SUPPORT_SHOWN: ExplainBackSupportShown = {
  hintOffered: false,
  sourceShownWhileAnswering: false,
};

/**
 * `ol-0r92.98`: an empty or whitespace-only typed answer, exported so the
 * guard on the submit button (`renderAnsweringPhase`) can be asserted
 * directly rather than only by matching source text — the same emptiness
 * rule `renderTopicPhase`'s own continue button already applies inline.
 * Deliberately NOT a "skip": it only says whether a submit is a no-op, and
 * carries no meaning about an explicit skip action (`[DOS-I9]`, SKIP-2/3/4).
 */
export function isBlankExplainBackAnswer(answer: string): boolean {
  return answer.trim().length === 0;
}

/** What opened this view, and therefore whether the question is already known. */
export type ExplainBackSeed =
  | { readonly kind: 'instrument'; readonly instrument: ReviewInstrument }
  | { readonly kind: 'freeform' };

export interface ExplainBackModalDeps {
  readonly grade: (input: GradeExplainBackInput) => Promise<PendingExplainBackGrading | null>;
  readonly acceptWithObservation: (
    pending: PendingExplainBackGrading,
    context: AcceptExplainBackGradingWithObservationContext,
  ) => Promise<AcceptExplainBackGradingWithObservationResult | null>;
  readonly retrieveSourceBlocks: (query: string) => Promise<readonly ExplainBackSourceBlock[]>;
  /**
   * `ol-egov.141.89.6.33`: resolves the subject concept's live "causes"
   * partner (rel.md section 1's "Explain-back partner (causes)" row) from
   * the plugin's in-memory relation graph — `main.ts`'s wrapper around
   * `explain-back/request.ts`'s `resolveExplainBackRelationEdge`, already
   * gated on rel.md section 3 Default 4 freshness (a stale or absent edge
   * resolves `undefined`, never served). `resolveGradingSourceBlocks` below
   * is the one caller. Optional and absent by default, same posture as
   * `getMasteryState`/`recordSoloGradeAndReview`: an omitted dep keeps the
   * pre-existing concept-only path exactly as it was.
   */
  readonly resolveCausesPartner?: (subjectConceptId: string) => ConceptRelation | undefined;
  readonly buildObservationContext: (params: {
    readonly subjectConceptId: string | null;
    readonly originInstrumentId: string;
    readonly sourceBlocks: readonly ExplainBackSourceBlock[];
    /**
     * `ol-gavc`: the same query `sourceBlocks` was originally retrieved
     * against (`retrieveSourceBlocks`'s own argument at prompt-resolution
     * time) — a real caller re-retrieves against this at accept time and
     * compares, to detect a source that changed while grading was
     * outstanding. `acceptGrading` below passes `prompt.query`, the exact
     * string frozen on `ResolvedPrompt` at the `retrieveSourceBlocks` call
     * site that produced `prompt.sourceBlocks` — never `prompt.context
     * .question`, which is a DIFFERENT string for a cloze instrument
     * (`questionQuery` joins `before`/`after` with a space;
     * `questionAndReferenceAnswerForCloze` in `./request.ts` joins them with
     * a literal `____` blank marker) and, independently, for every
     * topic-seeded prompt (`resolveTopicPrompt` retrieves against the bare
     * topic string but `buildExplainBackPromptContextFromTopic` wraps it in
     * "In your own words: explain …."). Rebuilding the query two ways made
     * accept-time retrieval read notes that were never part of the graded
     * prompt, which can misreport a false stale (silently dropping a
     * correct answer from the record) or miss a real change
     * (`ol-egov.141.89.6.16`). Freezing the one string used for the real
     * retrieval, once, closes both divergences for every instrument kind
     * without re-deriving a query a second way anywhere.
     */
    readonly query: string;
  }) => Promise<AcceptExplainBackGradingWithObservationContext>;
  /**
   * `ol-cqz8`: runs the SOLO depth pipeline and appends the subject's own
   * review-log event — see `./solo-review.ts`'s `recordSoloGradeAndReview`,
   * which this normally wraps. Optional and best-effort, same posture as
   * `acceptWithObservation`'s own embedding step: a rejection is caught in
   * `acceptGrading` below and never fails the correctness accept it rode on.
   * `undefined` until a caller wires a real `RecordSoloGradeAndReviewDeps`
   * instance — see this file's module doc and `./solo-review.ts`'s own
   * "reachability" section for exactly what that needs and where it goes.
   *
   * `ol-0r92.48` (`[D-217]`): the return type is now `SoloLevel | void`,
   * never a required `SoloLevel` — a caller that resolves `void` (today's
   * `main.ts` wrapper does) still satisfies this type unchanged, so widening
   * it needed no edit to a file this bead does not own. `acceptGrading`
   * below reads whatever comes back and passes it straight to
   * `renderAcceptedPhase`; a `void`/`undefined` result renders no heading at
   * all (`[D-217]`: never a placeholder), exactly as it did before this
   * field could report a level.
   */
  readonly recordSoloGradeAndReview?: (params: {
    readonly instrumentId: string;
    /** `ol-0r92.94` [DOS-C1]: forwarded to `solo-review.ts`'s `RecordSoloGradeAndReviewParams.attemptId` — see that field's own doc for the fallback a not-yet-updated caller gets when it omits this. */
    readonly attemptId: string;
    readonly subjectConceptId: string | null;
    readonly context: ExplainBackPromptContext;
    readonly answer: string;
    /** See this file's `now`/`presentedAtMs` doc just below for the definition. */
    readonly durationMs: number | null;
    /**
     * `ol-l7ew` [DOS-C5a]: the support level this view actually showed on
     * this attempt, forwarded to `solo-review.ts`'s
     * `RecordSoloGradeAndReviewParams.supportLevelShown` and persisted onto
     * the same review record the depth grade lands on. `undefined` only
     * where the presentation is genuinely unobservable — `[D-281]` reads
     * that as unknown and refuses the top growth stage, which is the honest
     * outcome and never to be papered over with `'independent'`.
     */
    readonly supportLevelShown?: SupportLevel;
  }) => Promise<SoloLevel | undefined>;
  /** A stable id for this attempt (`../grading/wiring.ts`'s "distinct from any card/MCQ id space"). Injected so this view never mints its own id-generation policy. */
  readonly generateInstrumentId: () => string;
  /** Fires once, on close, however the modal was resolved — see the module doc's "hand-off" section. */
  readonly onClosed?: () => void;
  /**
   * `ol-yj0k`: the clock this view times an attempt's `durationMs` against —
   * same INV-1 discipline `review/session.ts`'s injected `Clock` and
   * `solo-review.ts`'s own `now` already use, never `Date.now()`/`new Date()`
   * called inline at a measurement site. Optional because `main.ts`'s
   * existing `openExplainBackModal` construction call (outside this bead's
   * `owns`) does not wire one yet; the constructor falls back to the real
   * wall clock so production behaviour is unchanged, and a test can still
   * inject a fake. Wiring a real clock through from `main.ts` is a Class A
   * follow-up, not required for correctness.
   */
  readonly now?: () => Date;
  /**
   * `[STY-0d]`, `ol-l5og.18.4`: the mastery tag (sprig + word) the design kit
   * (`docs/design/pass3-explainback-sprig`) places on every explain-back
   * screen — see `renderMasteryTag` below for exactly where and why it
   * renders. Optional and best-effort, the same posture as
   * `recordSoloGradeAndReview` above: `main.ts`'s existing
   * `openExplainBackModal` construction call (outside this bead's `owns`) does
   * not wire one yet, so the tag renders nothing today rather than a
   * placeholder — never a fabricated stage for a concept whose real mastery
   * state this view has no way to ask for. Wiring a real lookup through from
   * `main.ts` (`packages/core/src/mastery/rollup.ts` already computes
   * `MasteryState` per concept) is a small, disclosed follow-up in a file
   * this bead does not own.
   */
  readonly getMasteryState?: (conceptId: string) => MasteryState | null;
  /**
   * `ol-2zfj.75` (C7.9/F5.6): loads the transient misconception digest
   * (`olea-core`'s `buildMisconceptionDigest`) for the instrument's own
   * concept ids, so the judge sees "has she raised this specific confusion
   * before, on this concept" per D-008/M4 — the same digest field
   * `ExplainBackPromptContext.misconceptionDigest` already carries and
   * `buildGradeExplainBackInputFromTypedAnswer` already forwards verbatim
   * (`./request.ts`). Optional and best-effort, same posture as
   * `getMasteryState`/`recordSoloGradeAndReview`: a caller that omits it (or
   * whose load fails) gets the pre-existing `[]` default, never a thrown
   * error mid-prompt. Called only from `resolveInstrumentPrompt` — a topic
   * prompt (`resolveTopicPrompt`) has no known `subjectConceptId` to key a
   * digest by, so it stays `[]` there, unchanged.
   */
  readonly loadMisconceptionDigest?: (
    conceptIds: readonly string[],
  ) => Promise<GradeExplainBackInput['misconceptionDigest']>;
}

/**
 * `ol-egov.141.89.6.33`: widens a subject's retrieved source blocks into the
 * real grading source material, threading a live 'causes' partner through
 * the two core functions `explain-back/request.ts`'s own module doc names
 * as the missing half (`olea-core`'s `resolveGradingRelationContext`/
 * `buildGradingSourceMaterial`) — never reimplemented here. Exported and
 * pure (no `Modal`, no `App`) so it is directly unit-testable, unlike the
 * class below (`obsidian`'s `package.json` `main` is `""`, so `Modal`
 * cannot be instantiated under Vitest — see this file's sibling specs).
 *
 * **Always runs through both core functions, concept-only or not.** The
 * concept-only branch is `buildGradingSourceMaterial`'s identity case
 * (`sourceBlocks` returned unchanged) — so a call that finds no resolvable
 * neighbour changes nothing observable. That is what keeps the judge's wire
 * shape unchanged for `causes`'s current, `RELATION_EMISSION_STATUS`
 * `'blocked-on-deferred-reader'` state (`concept/relation.ts`): a real
 * `no-op` outcome, not a bypass that skips calling either function.
 *
 * **A `null` subjectConceptId (the free-form topic entry point) never
 * builds a `GradingSourceMaterial`.** `buildGradingSourceMaterial` requires
 * `GradingSubject.subjectConceptId`, and a topic she typed herself
 * genuinely has none (`resolveTopicPrompt`'s own `subjectConceptId: null`).
 * `resolveGradingRelationContext(undefined)` still runs, so both entry
 * points share one code path through it; its `{kind: 'concept-only'}`
 * result is simply not acted on further, and `sourceBlocks` returns
 * unchanged — this path's exact pre-existing behaviour.
 *
 * **The neighbour's defining passages are retrieved through
 * `deps.retrieveSourceBlocks`, keyed by the neighbour's own concept
 * name.** The same retrieval port every entry point already uses for an
 * arbitrary natural-language string (`resolveTopicPrompt` already retrieves
 * against a topic she typed) — no second reader is invented.
 * `ConceptRelation.from`/`.to` (`olea-core`) are concept NAMES, its own
 * doc's wording — the identical vocabulary `subjectConceptId` already
 * carries everywhere else in this file (the mastery tag, the misconception
 * digest, the accept-time observation context all key on it the same way),
 * so this is consistent with every other consumer of that field, not a new
 * convention.
 *
 * **The edge's own introducing-passage text is not resolved here.**
 * `ConceptRelation.introducingPassages` is a `Provenance` (a source path
 * plus a location) on each endpoint, never a `SourceBlockRef` (no `text`
 * field) — turning one into cited passage text needs a targeted vault read
 * this view has no port for. `evidence: 'current'` is asserted directly
 * rather than left for `resolveRelationProvenance` to re-derive, because
 * `deps.resolveCausesPartner` (main.ts's wrapper around
 * `resolveExplainBackRelationEdge`) already applies rel.md Default 4's
 * freshness gate before ever returning an edge — one reaching this function
 * is, by construction, already current. With no introducing passages and no
 * linking note, `resolveRelationProvenance` degrades this to
 * `{kind: 'no-edge'}` (F5.2a's own third, "written nowhere" case) — which
 * still includes the neighbour's defining passages in `sourceBlocks`
 * (`buildGradingSourceMaterial`'s `'no-edge'` branch), the one observable
 * effect a real 'causes' edge has here today. Resolving the edge's own
 * provenance text for the richer `'edge-provenance'` case is a disclosed
 * follow-up, not silently absorbed.
 */
export async function resolveGradingSourceBlocks(
  deps: Pick<ExplainBackModalDeps, 'retrieveSourceBlocks' | 'resolveCausesPartner'>,
  subjectConceptId: string | null,
  sourceBlocks: readonly ExplainBackSourceBlock[],
): Promise<readonly ExplainBackSourceBlock[]> {
  const edge =
    subjectConceptId !== null ? deps.resolveCausesPartner?.(subjectConceptId) : undefined;

  let named:
    | { readonly neighbourConceptId: string; readonly edge: ResolvedRelationEdge }
    | undefined;
  let neighbourBlocks: readonly ExplainBackSourceBlock[] = [];
  if (edge !== undefined && subjectConceptId !== null) {
    const neighbourConceptId = edge.from === subjectConceptId ? edge.to : edge.from;
    neighbourBlocks = await deps.retrieveSourceBlocks(neighbourConceptId);
    named = {
      neighbourConceptId,
      edge: { evidence: 'current', provenance: edge.provenance, introducingPassages: [] },
    };
  }

  const relation: GradingRelationContext = resolveGradingRelationContext(named);
  if (subjectConceptId === null) return sourceBlocks;

  const subjectDefiningPassages: ConceptDefiningPassages = {
    conceptId: subjectConceptId,
    passages: sourceBlocks.map((entry) => entry.block),
  };
  const material = buildGradingSourceMaterial({
    subject: { subjectConceptId },
    subjectDefiningPassages,
    relation,
    ...(named
      ? {
          neighbourDefiningPassages: {
            conceptId: named.neighbourConceptId,
            passages: neighbourBlocks.map((entry) => entry.block),
          },
        }
      : {}),
  });

  const lookup = new Map<string, ExplainBackSourceBlock>();
  for (const entry of [...sourceBlocks, ...neighbourBlocks]) lookup.set(entry.block.blockId, entry);
  return material.sourceBlocks.flatMap((block) => {
    const entry = lookup.get(block.blockId);
    return entry ? [entry] : [];
  });
}

interface ResolvedPrompt {
  readonly context: ExplainBackPromptContext;
  readonly subjectConceptId: string | null;
  readonly originInstrumentId: string;
  readonly sourceBlocks: readonly ExplainBackSourceBlock[];
  /**
   * `ol-egov.141.89.6.16`: the EXACT string passed to
   * `deps.retrieveSourceBlocks` to produce `sourceBlocks` above — frozen
   * here, at the retrieval call site, rather than re-derived from
   * `context.question` at accept time (see `buildObservationContext`'s own
   * `query` param doc on `ExplainBackModalDeps` for why the two can
   * differ). `computeAcceptGrading` reads this field, never
   * `context.question`, when it re-retrieves to check staleness.
   */
  readonly query: string;
}

type ModalState =
  | { readonly phase: 'topic'; readonly topic: string }
  | { readonly phase: 'loading' }
  | { readonly phase: 'answering'; readonly prompt: ResolvedPrompt; readonly answer: string }
  | {
      readonly phase: 'grading';
      readonly prompt: ResolvedPrompt;
      readonly answer: string;
      /** `ol-yj0k`: computed once at submission, carried through to `acceptGrading` — see `submitAnswer`'s doc. */
      readonly durationMs: number | null;
      /** `ol-0r92.94` [DOS-C1]: minted once per genuine attempt at submit time — see `submitAnswer`'s doc. */
      readonly attemptId: string;
    }
  | {
      readonly phase: 'graded';
      readonly prompt: ResolvedPrompt;
      readonly answer: string;
      readonly pending: PendingExplainBackGrading;
      readonly durationMs: number | null;
      readonly attemptId: string;
    }
  | {
      readonly phase: 'refused';
      readonly prompt: ResolvedPrompt;
      readonly answer: string;
      readonly reason: 'unavailable' | 'check-failed' | 'insufficient-notes';
      readonly durationMs: number | null;
      readonly attemptId: string;
    }
  | {
      readonly phase: 'accepted';
      readonly message: string | null;
      /** `[D-217]`: the SOLO depth level `deps.recordSoloGradeAndReview` reported, if any — `null` renders no heading (see `renderAcceptedPhase`), never a placeholder. */
      readonly soloLevel: SoloLevel | null;
    };

const SVG_NS = 'http://www.w3.org/2000/svg';

/**
 * The retry mark (`docs/design/pass5-refusal-trends-shell/ui_kits/olea-
 * plugin/Pass5Kit.jsx`'s `RetryGlyph`, `olea-service`), reproduced
 * coordinate-for-coordinate — the same "copied, not reinterpreted"
 * discipline `sprig/render-sprig.ts` documents for its own SVG. Built via
 * `createElementNS` rather than Obsidian's `setIcon`: `setIcon` has no
 * export in the workbench's `obsidian-shim` (confirmed by a failed `esbuild`
 * bundle), and `gap/view.ts` carries the identical helper for the same
 * reason — small enough, and local enough to each file's own render method,
 * that duplicating it beat adding a new cross-package module for one glyph.
 */
function renderRetryGlyph(container: HTMLElement): void {
  const doc = container.ownerDocument;
  const svg = doc.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('width', '13');
  svg.setAttribute('height', '13');
  svg.setAttribute('viewBox', '0 0 13 13');
  for (const d of ['M11 6.5a4.5 4.5 0 1 1-1.5-3.35', 'M11.2 1.2v2.6H8.6']) {
    const path = doc.createElementNS(SVG_NS, 'path');
    path.setAttribute('d', d);
    path.setAttribute('fill', 'none');
    path.setAttribute('stroke', 'currentColor');
    path.setAttribute('stroke-width', '1.3');
    path.setAttribute('stroke-linecap', 'round');
    path.setAttribute('stroke-linejoin', 'round');
    svg.appendChild(path);
  }
  container.appendChild(svg);
}

export class ExplainBackModal extends Modal {
  private readonly deps: ExplainBackModalDeps;
  private readonly seed: ExplainBackSeed;
  private state: ModalState;
  private readonly now: () => Date;
  /**
   * `ol-yj0k`: the moment the current prompt became visible to her, in the
   * SAME sense `review/session.ts`'s own `presentedAtMs` field uses for
   * QA/cloze/MCQ — set whenever a prompt enters the `'answering'` phase
   * (first resolution, or re-entry after discarding a grading to retry), and
   * read once, at the top of `submitAnswer`, to produce `durationMs`. An
   * instance field rather than part of `ModalState.answering` for the same
   * reason `session.ts` keeps it off `ReviewQueueItem`: it is timing
   * bookkeeping for the CURRENT attempt, not state the render tree needs.
   */
  private presentedAtMs: number | null = null;

  /**
   * `ol-0r92.94` [DOS-C1]: the in-flight-memo half of the idempotency
   * guarantee — see `acceptGrading`'s own doc for why this is a SEPARATE
   * guarantee from `recordGradedExplainBackReview`'s durable, restart-safe
   * check, not a substitute for it. Keyed on `attemptId`, never
   * `prompt.originInstrumentId`: two GENUINE attempts at the same instrument
   * must never share a memo entry, only two calls for the identical attempt
   * (a double-click before the first `acceptGrading` call resolves) may.
   */
  private readonly acceptInFlightByAttempt = new Map<string, Promise<void>>();

  constructor(app: App, deps: ExplainBackModalDeps, seed: ExplainBackSeed) {
    super(app);
    this.deps = deps;
    this.seed = seed;
    this.now = deps.now ?? (() => new Date());
    this.state = seed.kind === 'freeform' ? { phase: 'topic', topic: '' } : { phase: 'loading' };
  }

  override onOpen(): void {
    this.titleEl.setText(EXPLAIN_BACK_MODAL_TITLE);
    if (this.seed.kind === 'instrument') {
      void this.resolveInstrumentPrompt(this.seed.instrument);
    }
    this.render();
  }

  override onClose(): void {
    this.contentEl.empty();
    this.deps.onClosed?.();
  }

  private async resolveInstrumentPrompt(instrument: ReviewInstrument): Promise<void> {
    const query = questionQuery(instrument);
    const sourceBlocks = await this.deps.retrieveSourceBlocks(query);
    const subjectConceptId = instrument.conceptIds[0] ?? null;
    // `ol-egov.141.89.6.33`: widened ONLY for what the judge is sent
    // (`context` below) — `prompt.sourceBlocks` a few lines down stays the
    // plain retrieval, unchanged, because it also feeds the accept-time
    // staleness comparison (`main.ts`'s `buildExplainBackObservationContextFor`,
    // re-retrieving against `prompt.query`, frozen below to this exact
    // `query` — never re-derived from `context.question`, which can be a
    // different string; see `ResolvedPrompt.query`'s own doc,
    // `ol-egov.141.89.6.16`) and a comparison against a widened list would
    // misreport every relation-aware accept as stale. See
    // `resolveGradingSourceBlocks`'s own doc for why concept-only (today,
    // always, until a `causes` reader ships) leaves this identical to
    // `sourceBlocks` regardless.
    const gradingSourceBlocks = await resolveGradingSourceBlocks(
      this.deps,
      subjectConceptId,
      sourceBlocks,
    );
    // `ol-2zfj.75` (C7.9/F5.6): a real digest when the concept(s) this
    // instrument targets have prior misconception history, `[]` otherwise —
    // never thrown into the prompt-resolution path (see the dep's own doc).
    const misconceptionDigest =
      instrument.conceptIds.length > 0 && this.deps.loadMisconceptionDigest
        ? await this.deps.loadMisconceptionDigest(instrument.conceptIds)
        : [];
    const context = buildExplainBackPromptContextFromInstrument(
      instrument,
      gradingSourceBlocks,
      misconceptionDigest,
    );
    const prompt: ResolvedPrompt = {
      context,
      subjectConceptId,
      originInstrumentId: instrument.instrumentId,
      sourceBlocks,
      query,
    };
    this.presentedAtMs = this.now().getTime();
    this.state = { phase: 'answering', prompt, answer: '' };
    this.render();
  }

  private async resolveTopicPrompt(topic: string): Promise<void> {
    this.state = { phase: 'loading' };
    this.render();
    const sourceBlocks = await this.deps.retrieveSourceBlocks(topic);
    // `ol-egov.141.89.6.33`: a topic prompt's `subjectConceptId` is always
    // `null` below — there is genuinely no concept id for a topic she typed
    // herself — so `resolveGradingSourceBlocks` always returns `sourceBlocks`
    // unchanged here (see that function's own doc); called anyway so both
    // entry points share the one code path through
    // `resolveGradingRelationContext`, never a second, divergent one.
    const gradingSourceBlocks = await resolveGradingSourceBlocks(this.deps, null, sourceBlocks);
    const context = buildExplainBackPromptContextFromTopic(topic, gradingSourceBlocks);
    if (context.referenceAnswer.trim() === '') {
      const prompt: ResolvedPrompt = {
        context,
        subjectConceptId: null,
        originInstrumentId: this.deps.generateInstrumentId(),
        sourceBlocks,
        query: topic,
      };
      // Never shown an answer box — insufficient-notes is a refusal before
      // any prompt existed to present, so no `presentedAtMs` is set here,
      // and this `attemptId` is minted but never used for an accept (there
      // is nothing to accept from this state — `renderRefusedPhase` offers
      // no accept action for it).
      this.state = {
        phase: 'refused',
        prompt,
        answer: '',
        reason: 'insufficient-notes',
        durationMs: null,
        attemptId: this.deps.generateInstrumentId(),
      };
      this.render();
      return;
    }
    const prompt: ResolvedPrompt = {
      context,
      subjectConceptId: null,
      originInstrumentId: this.deps.generateInstrumentId(),
      sourceBlocks,
      query: topic,
    };
    this.presentedAtMs = this.now().getTime();
    this.state = { phase: 'answering', prompt, answer: '' };
    this.render();
  }

  /**
   * `ol-yj0k`: `durationMs` is computed HERE, at the moment she submits —
   * matching `contracts/review-log.ts`'s own field doc for every other
   * instrument type, "milliseconds from presentation to answer" — never at
   * write time (`acceptGrading`/`solo-review.ts`), which can run long after
   * this, following the Worker's grading round-trip and however long she
   * takes to read the verdict before clicking Accept. `Math.max(0, …)`
   * mirrors `review/session.ts`'s own `logAndAdvance` guard against a clock
   * that runs backwards between the two reads.
   */
  private async submitAnswer(prompt: ResolvedPrompt, answer: string): Promise<void> {
    const durationMs =
      this.presentedAtMs !== null ? Math.max(0, this.now().getTime() - this.presentedAtMs) : null;
    // `ol-0r92.94` [DOS-C1]: minted HERE, once per genuine attempt at
    // submit — never `prompt.originInstrumentId`, which is the instrument's
    // own id and is the SAME value across every attempt she makes at it
    // (real instruments) or a per-prompt id that still does not distinguish
    // a retry-after-discard from the attempt it replaces (topic prompts).
    // `deps.generateInstrumentId` is reused rather than adding a new
    // required dep field — it is already "a stable id... distinct from any
    // card/MCQ id space" (its own doc), which is exactly what an attempt id
    // needs, and reusing it keeps `main.ts`'s existing deps literal
    // (outside this bead's `owns`) unchanged.
    const attemptId = this.deps.generateInstrumentId();
    this.state = { phase: 'grading', prompt, answer, durationMs, attemptId };
    this.render();

    const input = buildGradeExplainBackInputFromTypedAnswer(answer, prompt.context);
    try {
      const pending = await this.deps.grade(input);
      if (pending === null) {
        this.state = {
          phase: 'refused',
          prompt,
          answer,
          reason: 'unavailable',
          durationMs,
          attemptId,
        };
        this.render();
        return;
      }
      this.state = { phase: 'graded', prompt, answer, pending, durationMs, attemptId };
      this.render();
    } catch (error) {
      // `UnusableGradingInputError` (empty referenceAnswer) reads as
      // insufficient-notes; anything else reads as the transient
      // check-failed refusal — the same two-reason posture C4.7/`[D-089]`
      // rules for the folded path (see this file's module doc).
      const isUnusableInput = error instanceof Error && error.name === 'UnusableGradingInputError';
      this.state = {
        phase: 'refused',
        prompt,
        answer,
        reason: isUnusableInput ? 'insufficient-notes' : 'check-failed',
        durationMs,
        attemptId,
      };
      this.render();
    }
  }

  /**
   * `ol-0r92.94` [DOS-C1]: the in-flight-memo guard. A double-click before
   * the first accept resolves is the concrete failure this closes — the
   * graded phase's Accept button (`renderGradedPhase`) has no `disabled`
   * state while `acceptGrading`'s promise is outstanding, so two clicks
   * before the state transitions to `'accepted'` previously fired two
   * independent runs: two `acceptWithObservation` calls (one guarded
   * against by `wiring.ts`'s own attempt-keyed memo, see that file) AND,
   * with no equivalent guard here before this bead, two
   * `recordSoloGradeAndReview` calls each minting their own SOLO grade and
   * appending their own review-log event. Memoizing HERE, by `attemptId`,
   * makes a second concurrent call for the SAME attempt share the first
   * call's one in-flight `Promise` rather than starting a second run —
   * distinct from `recordGradedExplainBackReview`'s own durable check
   * (`explain-back-grade-write.ts`'s doc), which is what protects a
   * SEQUENTIAL retry after a restart, when no in-flight `Promise` survives
   * to be shared.
   */
  private acceptGrading(
    prompt: ResolvedPrompt,
    answer: string,
    pending: PendingExplainBackGrading,
    durationMs: number | null,
    attemptId: string,
  ): Promise<void> {
    const inFlight = this.acceptInFlightByAttempt.get(attemptId);
    if (inFlight) return inFlight;
    const promise = this.computeAcceptGrading(prompt, answer, pending, durationMs, attemptId);
    this.acceptInFlightByAttempt.set(attemptId, promise);
    return promise;
  }

  private async computeAcceptGrading(
    prompt: ResolvedPrompt,
    answer: string,
    pending: PendingExplainBackGrading,
    durationMs: number | null,
    attemptId: string,
  ): Promise<void> {
    const context = {
      ...(await this.deps.buildObservationContext({
        subjectConceptId: prompt.subjectConceptId,
        originInstrumentId: prompt.originInstrumentId,
        sourceBlocks: prompt.sourceBlocks,
        // `ol-egov.141.89.6.16`: the frozen retrieval query, never
        // `prompt.context.question` — see `ResolvedPrompt.query`'s own doc
        // for why the two can differ (cloze's blank marker, every topic
        // prompt's "In your own words: explain …" wrapper).
        query: prompt.query,
      })),
      // `ol-0r92.94` [DOS-C1]: attached here, after `buildObservationContext`
      // resolves, rather than threaded through that dep's own params —
      // widening those params would require `main.ts`'s real implementation
      // (outside this bead's `owns`) to supply a field it has no reason to
      // know about yet. `attemptId` is never the instrument id this context
      // already carries; see `wiring.ts`'s `AcceptExplainBackGradingWithObser
      // vationContext.attemptId` doc for what it keys.
      attemptId,
    };
    const result = await this.deps.acceptWithObservation(pending, context);
    // `[D-217]`: whatever level comes back (or doesn't) is what
    // `renderAcceptedPhase` renders the depth heading from — see this file's
    // module doc and the deps field's own doc for why `void`/`undefined`
    // here means "no heading", never a fabricated one.
    let soloLevel: SoloLevel | null = null;
    // `ol-egov.141.89.6.15`: the depth write is gated on the SAME
    // `result` the correctness accept just produced, never run
    // unconditionally whenever `recordSoloGradeAndReview` happens to be
    // wired. `result === null` or `result.status === 'stale'` both mean
    // `acceptWithObservation` (`grading/wiring.ts`'s own `ol-0r92.89`
    // doc, "REJECTS ON A STALE SOURCE, NEVER ACCEPTS SILENTLY") recorded
    // nothing at all for the correctness half of this accept — a stale
    // accept must write no review event of any kind, correctness or
    // depth-only, so the depth write is skipped on exactly the same
    // condition rather than running unconditionally and leaving a
    // depth-only event as the sole trace of a source that had already
    // changed underneath her.
    if (result !== null && result.status === 'accepted' && this.deps.recordSoloGradeAndReview) {
      // `ol-l7ew` [DOS-C5a]: resolved from what this view rendered for this
      // attempt — see `EXPLAIN_BACK_ANSWERING_SUPPORT_SHOWN` above.
      const supportLevelShown = supportLevelShownForExplainBack(
        EXPLAIN_BACK_ANSWERING_SUPPORT_SHOWN,
      );
      try {
        const depthOutcome = await this.deps.recordSoloGradeAndReview({
          instrumentId: prompt.originInstrumentId,
          attemptId,
          subjectConceptId: prompt.subjectConceptId,
          context: prompt.context,
          answer,
          durationMs,
          // `ol-l7ew` [DOS-C5a]: resolved from what this view rendered for
          // THIS attempt, on the same call and the same `attemptId` the
          // depth grade and the correctness verdict already travel on, so
          // the fold can never read an assistance fact from one attempt
          // against a demonstration from another.
          // Spread conditionally rather than passed as a possibly-`undefined`
          // value: under `exactOptionalPropertyTypes`, an absent key and a key
          // set to `undefined` are different things, and "absent" is the one
          // that means unknown all the way down to the persisted record.
          ...(supportLevelShown !== undefined ? { supportLevelShown } : {}),
        });
        if (depthOutcome) soloLevel = depthOutcome;
      } catch (error) {
        // Mirrors `acceptWithObservation`'s own isolation
        // (`grading/wiring.ts`'s `acceptExplainBackGradingWithObservation`
        // doc): the SOLO depth grading and its review-log write are
        // additional evidence, never a precondition for the correctness
        // accept she is already looking at. D-005: a content-free line only.
        console.error('Olea: SOLO grade/review-log write failed (grade acceptance unaffected)', {
          error,
        });
      }
    }
    // `ol-0r92.89`: a `'stale'` result — the source this grading cited has
    // changed since the request went out — is treated the same as `null`
    // here: no encouragement banner, and (per `acceptWithObservation`'s own
    // doc) nothing was recorded, never a silent accept dressed up as one.
    const message =
      result === null || result.status !== 'accepted'
        ? null
        : explainBackFullDepthEncouragement(result.accepted);
    this.state = { phase: 'accepted', message, soloLevel };
    this.render();
  }

  private discardGrading(
    prompt: ResolvedPrompt,
    answer: string,
    pending: PendingExplainBackGrading,
  ): void {
    discardExplainBackGrading(pending);
    // `ol-yj0k`: a fresh presentation for a fresh attempt — she is looking at
    // the question again, about to compose (or edit) another answer to it,
    // so the clock for THIS attempt's `durationMs` restarts here rather than
    // accumulating time already spent on the discarded one.
    this.presentedAtMs = this.now().getTime();
    this.state = { phase: 'answering', prompt, answer };
    this.render();
  }

  private render(): void {
    const root = this.contentEl;
    root.empty();
    root.addClass('olea-explain-back');

    switch (this.state.phase) {
      case 'topic':
        this.renderTopicPhase(root, this.state.topic);
        return;
      case 'loading':
        root.createDiv({ cls: 'olea-explain-back-loading', text: EXPLAIN_BACK_GRADING_LABEL });
        return;
      case 'answering':
        this.renderAnsweringPhase(root, this.state.prompt, this.state.answer);
        return;
      case 'grading':
        this.renderQuestion(root, this.state.prompt);
        root.createDiv({ cls: 'olea-explain-back-loading', text: EXPLAIN_BACK_GRADING_LABEL });
        return;
      case 'graded':
        this.renderGradedPhase(
          root,
          this.state.prompt,
          this.state.answer,
          this.state.pending,
          this.state.durationMs,
          this.state.attemptId,
        );
        return;
      case 'refused':
        this.renderRefusedPhase(root, this.state.prompt, this.state.answer, this.state.reason);
        return;
      case 'accepted':
        this.renderAcceptedPhase(root, this.state.message, this.state.soloLevel);
        return;
    }
  }

  private renderTopicPhase(root: HTMLElement, topic: string): void {
    root.createEl('p', { text: EXPLAIN_BACK_TOPIC_PROMPT });
    const input = root.createEl('input', { type: 'text', cls: 'olea-explain-back-topic' });
    input.value = topic;
    const button = root.createEl('button', { text: EXPLAIN_BACK_TOPIC_CONTINUE_LABEL });
    button.addEventListener('click', () => {
      const value = input.value.trim();
      if (value.length === 0) return;
      void this.resolveTopicPrompt(value);
    });
  }

  private renderQuestion(root: HTMLElement, prompt: ResolvedPrompt): void {
    const header = root.createDiv({ cls: 'olea-explain-back-header' });
    header.createDiv({
      cls: 'olea-explain-back-question-label',
      text: EXPLAIN_BACK_QUESTION_LABEL,
    });
    this.renderMasteryTag(header, prompt.subjectConceptId);
    root.createDiv({ cls: 'olea-explain-back-question', text: prompt.context.question });
  }

  /**
   * `[STY-0d]`: the sprig-plus-word tag the kit places on every explain-back
   * screen — same shape as `gap/view.ts`'s `.olea-gap-mastery`
   * (`renderSprig` for the mark, a plain text span for the word), reused
   * rather than reinvented. Renders nothing for a free-form, topic-seeded
   * attempt (`subjectConceptId === null` — there is no concept to show
   * evidence for) and nothing until `deps.getMasteryState` is actually wired
   * (see that field's own doc) — an absent tag, never a fabricated stage.
   */
  private renderMasteryTag(parent: HTMLElement, subjectConceptId: string | null): void {
    if (subjectConceptId === null) return;
    const state = this.deps.getMasteryState?.(subjectConceptId) ?? null;
    if (state === null) return;
    const tag = parent.createSpan({ cls: 'olea-explain-back-mastery' });
    tag.appendChild(renderSprig({ state, size: 14, container: tag }));
    tag.createSpan({ text: state });
  }

  private renderAnsweringPhase(root: HTMLElement, prompt: ResolvedPrompt, answer: string): void {
    this.renderQuestion(root, prompt);
    const textarea = root.createEl('textarea', {
      cls: 'olea-explain-back-answer',
      attr: { placeholder: EXPLAIN_BACK_ANSWER_PLACEHOLDER },
    });
    textarea.value = answer;
    const button = root.createEl('button', { text: EXPLAIN_BACK_SUBMIT_LABEL });
    button.addEventListener('click', () => {
      // `ol-0r92.98`: mirrors `renderTopicPhase`'s own guard above — an empty
      // or whitespace-only answer is a no-op, not a graded attempt. This is
      // deliberately NOT the explicit "skip" action (`[DOS-I9]`, SKIP-2/3/4):
      // it only stops an accidental empty submit from reaching `deps.grade`,
      // it does not add a new named skip event or persist anything.
      if (isBlankExplainBackAnswer(textarea.value)) return;
      void this.submitAnswer(prompt, textarea.value);
    });
  }

  private renderGradedPhase(
    root: HTMLElement,
    prompt: ResolvedPrompt,
    answer: string,
    pending: PendingExplainBackGrading,
    durationMs: number | null,
    attemptId: string,
  ): void {
    this.renderQuestion(root, prompt);
    const grading = pending.grading;

    // `[D-217]`: no heading here. The correctness verdict this phase used to
    // print as a heading ("This holds up." etc.) is rejected wording — the
    // registry vocabulary the ruling replaces it with is the five-level SOLO
    // depth phrase, and that depth is not known yet at this point in the
    // exchange (it grades later, best-effort, inside `acceptGrading`). This
    // phase shows the fact-based detail below with no heading at all rather
    // than a verdict-shaped placeholder — see `explainBackDepthHeading`'s own
    // doc (`./copy.ts`) and `renderAcceptedPhase` below, where the heading
    // renders once a depth level actually comes back.
    root.createEl('p', { cls: 'olea-explain-back-feedback', text: grading.feedback });

    this.renderGradedRegions(root, prompt, grading);

    if (grading.misconceptionCandidates.length > 0) {
      root.createDiv({
        cls: 'olea-explain-back-heading',
        text: EXPLAIN_BACK_MISCONCEPTION_HEADING,
      });
      const lookup = sourceBlockPathLookup(prompt.sourceBlocks);
      const list = root.createDiv({ cls: 'olea-explain-back-region-items' });
      for (const candidate of grading.misconceptionCandidates) {
        const row = list.createDiv({ cls: 'olea-explain-back-item' });
        row.createDiv({ cls: 'olea-explain-back-item-text', text: candidate.correction });
        const citation = citationLabelFor(candidate.correctionSourceBlockIds, lookup);
        if (citation !== null) row.createDiv({ cls: 'olea-explain-back-cite', text: citation });
      }
    }

    const actions = root.createDiv({ cls: 'olea-explain-back-actions' });
    const accept = actions.createEl('button', { text: EXPLAIN_BACK_ACCEPT_LABEL });
    accept.addEventListener(
      'click',
      () => void this.acceptGrading(prompt, answer, pending, durationMs, attemptId),
    );
    const discard = actions.createEl('button', { text: EXPLAIN_BACK_DISCARD_LABEL });
    discard.addEventListener('click', () => this.discardGrading(prompt, answer, pending));
  }

  /**
   * `[STY-0d]` (`ol-l5og.18.4`): the graded phase's three edge-differentiated
   * regions — covered / omission / confusion — `docs/design/pass3-
   * explainback-sprig`'s `ExplainBack.jsx` `Region` component, told apart by
   * left-edge style and heading colour rather than a red-to-green scale (no
   * third hue for "partly right" — `styles.css`'s own Pass-3 header repeats
   * this). **`covered` never renders today**: `GroundedGrading` (`olea-
   * core`) carries no positive-evidence field — `verdict`/`feedback` are the
   * only holistic signals, and there is no per-point "what she got right"
   * list anywhere in the grading pipeline. Rendering it from nothing would
   * be exactly the fabrication INV-5 exists to forbid, so this method omits
   * the region entirely rather than drawing an empty box or inventing
   * content — `.olea-explain-back-region-covered`'s CSS rule stays in
   * `styles.css`, ready for the day `gradingPipeline.ts` grows that field,
   * same "disclosed deferral" posture as `render-sprig.ts`'s own wilt
   * overlay. Filed as a discovered-from gap, not silently absorbed here
   * (this bead's `owns` is this file, `copy.ts` and `styles.css` — not
   * `packages/core`).
   *
   * `omission` combines two sources that were previously rendered as two
   * separate flat lists under two different headings: `missedPoints`
   * (uncited — E2a's own gate, never grounded to a block) and any
   * `citedIssues` entry the grader classified `kind: 'omission'` (grounded,
   * so it carries a citation chip the uncited ones cannot). Both describe
   * the same thing — something her notes have that her explanation did not
   * — so `EXPLAIN_BACK_MISSED_HEADING`'s existing, voice-charter-reviewed
   * wording covers both without a new string. `confusion` is every
   * `citedIssues` entry classified `'error'` or `'confusion'` — where her
   * explanation actively conflicts with a cited passage — reusing
   * `EXPLAIN_BACK_CITED_HEADING` for the same reason. `[D-171]`'s shared
   * "See in registry" control still fires once, for the whole `citedIssues`
   * list regardless of which region an entry landed in — every entry is
   * grounded in the same `prompt.originInstrumentId` either way.
   */
  private renderGradedRegions(
    root: HTMLElement,
    prompt: ResolvedPrompt,
    grading: GroundedGrading,
  ): void {
    const lookup = sourceBlockPathLookup(prompt.sourceBlocks);
    const omissionItems: ExplainBackRegionItem[] = [
      ...grading.missedPoints.map((text) => ({ text, citation: null })),
      ...citedIssuesOfKind(grading.citedIssues, 'omission').map((issue) => ({
        text: issue.description,
        citation: citationLabelFor(issue.sourceBlockIds, lookup),
      })),
    ];
    const confusionItems: ExplainBackRegionItem[] = [
      ...citedIssuesOfKind(grading.citedIssues, 'error'),
      ...citedIssuesOfKind(grading.citedIssues, 'confusion'),
    ].map((issue) => ({
      text: issue.description,
      citation: citationLabelFor(issue.sourceBlockIds, lookup),
    }));

    if (omissionItems.length > 0) {
      this.renderRegion(root, 'omission', EXPLAIN_BACK_MISSED_HEADING, omissionItems);
    }
    if (confusionItems.length > 0) {
      this.renderRegion(root, 'confusion', EXPLAIN_BACK_CITED_HEADING, confusionItems);
    }
    if (grading.citedIssues.length > 0) {
      // `[D-171]`'s one-step affordance (F8.4): ONE control for the whole
      // cited-issues list, not one per issue or one per region — every
      // cited issue in this attempt is grounded in the same originating
      // instrument (`prompt.originInstrumentId`) — leading to that
      // instrument's registry entry. Never a source path, heading or page
      // printed here. `[D-175]`/F8.4b: that same registry entry now also
      // carries this instrument's explain-back history, so this click
      // target needed no change to also satisfy F8.4b's own one-step-
      // affordance clause — see `./copy.ts`'s
      // `EXPLAIN_BACK_REGISTRY_ENTRY_ACTION` doc.
      const registryAction = root.createEl('button', {
        cls: 'olea-explain-back-registry-action',
        text: EXPLAIN_BACK_REGISTRY_ENTRY_ACTION,
      });
      registryAction.addEventListener('click', () => {
        void openRegistryEntryFor(this.app, { instrumentId: prompt.originInstrumentId });
      });
    }
  }

  private renderRegion(
    root: HTMLElement,
    kind: ExplainBackRegionKind,
    heading: string,
    items: readonly ExplainBackRegionItem[],
  ): void {
    const region = root.createDiv({
      cls: `olea-explain-back-region olea-explain-back-region-${kind}`,
    });
    region.createDiv({ cls: 'olea-explain-back-region-head', text: heading });
    const list = region.createDiv({ cls: 'olea-explain-back-region-items' });
    for (const item of items) {
      const row = list.createDiv({ cls: 'olea-explain-back-item' });
      row.createDiv({ cls: 'olea-explain-back-item-text', text: item.text });
      if (item.citation !== null) {
        row.createDiv({ cls: 'olea-explain-back-cite', text: item.citation });
      }
    }
  }

  /**
   * [STY-0h] (`ol-l5og.18.8`): the two `[D-089]`/C4.7 refusal reasons
   * ('insufficient-notes', 'check-failed') render as the two-cue-coded family
   * `docs/design/pass5-refusal-trends-shell/ui_kits/olea-plugin/
   * Pass5Refusal.jsx` (`olea-service`) draws — told apart by where the
   * evidence goes (a found-list of what retrieval actually returned, or
   * nothing at all), the edge (dashed absence vs. solid host wash) and the
   * mark (a dashed rule vs. a retry glyph), never by a new colour.
   *
   * **`'unavailable'` is deliberately NOT drawn in either cue family.** It
   * means no AI Worker is configured at all — F7.8's degradation posture
   * (`AI_NOT_CONFIGURED_NOTICE`'s "honestly absent, not broken-looking"),
   * not a check that ran and came back thin or a check that failed to run.
   * Folding it into "couldn't check" would be the identical conflation C4.7
   * forbids the other direction: a permanent, non-retryable absence wearing
   * a transient refusal's clothes. It keeps the plain paragraph this surface
   * always gave it, with no retry action, because retrying without a Worker
   * fails the same way again.
   */
  private renderRefusedPhase(
    root: HTMLElement,
    prompt: ResolvedPrompt,
    answer: string,
    reason: 'unavailable' | 'check-failed' | 'insufficient-notes',
  ): void {
    this.renderQuestion(root, prompt);
    if (reason === 'unavailable') {
      root.createEl('p', { cls: 'olea-explain-back-refusal', text: EXPLAIN_WHY_UNAVAILABLE });
      return;
    }
    if (reason === 'insufficient-notes') {
      this.renderNothingMatchedRefusal(root, prompt);
      return;
    }
    this.renderCouldNotCheckRefusal(root, prompt, answer);
  }

  /**
   * `reason: 'insufficient-notes'` — the search ran; what it returned does
   * not reach far enough to grade against. Dashed edge (this system's mark
   * for absence since Pass 3) and, whenever retrieval returned anything at
   * all, the found-list itself: C4.7's permitted content, exactly what was
   * returned and nothing claimed about the vault beyond it.
   */
  private renderNothingMatchedRefusal(root: HTMLElement, prompt: ResolvedPrompt): void {
    const box = root.createDiv({
      cls: 'olea-explain-back-refusal-box olea-explain-back-refusal-box--absent',
    });
    const eyebrow = box.createDiv({ cls: 'olea-explain-back-refusal-eyebrow' });
    eyebrow.createSpan({ cls: 'olea-explain-back-refusal-eyebrow-mark--dashed' });
    eyebrow.createSpan({
      cls: 'olea-explain-back-refusal-eyebrow-text',
      text: EXPLAIN_BACK_NOTHING_MATCHED_EYEBROW,
    });
    box.createEl('p', {
      cls: 'olea-explain-back-refusal',
      text: explainBackInsufficientNotesRefusal(prompt.sourceBlocks.length),
    });
    if (prompt.sourceBlocks.length > 0) this.renderFoundList(box, prompt.sourceBlocks);
  }

  /**
   * The found-list `renderNothingMatchedRefusal` shows when retrieval
   * returned at least one block — read-only (the note path and the passage
   * text itself, never a summary of it), same restraint the kit's own
   * `FoundList` states: "checkable in one click" is the goal, opening the
   * note itself is a follow-up this bead does not wire.
   */
  private renderFoundList(parent: HTMLElement, blocks: readonly ExplainBackSourceBlock[]): void {
    const wrap = parent.createDiv({ cls: 'olea-explain-back-found-list' });
    wrap.createDiv({
      cls: 'olea-explain-back-found-list-caption',
      text: EXPLAIN_BACK_FOUND_LIST_CAPTION,
    });
    const rows = wrap.createDiv({ cls: 'olea-explain-back-found-list-rows' });
    for (const block of blocks) {
      const row = rows.createDiv({ cls: 'olea-explain-back-found-list-row' });
      row.createSpan({ cls: 'olea-explain-back-found-list-path', text: block.path });
      row.createSpan({ cls: 'olea-explain-back-found-list-text', text: block.block.text });
    }
  }

  /**
   * `reason: 'check-failed'` — the check itself did not run, so nothing was
   * decided either way. Solid edge on the host's own wash (established
   * shapes, nothing drawn as found), a retry glyph rather than a dashed
   * rule, and the one action a transient failure earns: try again, wired to
   * the same `submitAnswer` the original attempt used, over the same
   * `answer` so nothing she wrote is lost.
   */
  private renderCouldNotCheckRefusal(
    root: HTMLElement,
    prompt: ResolvedPrompt,
    answer: string,
  ): void {
    const box = root.createDiv({
      cls: 'olea-explain-back-refusal-box olea-explain-back-refusal-box--weather',
    });
    const eyebrow = box.createDiv({ cls: 'olea-explain-back-refusal-eyebrow' });
    const mark = eyebrow.createSpan({ cls: 'olea-explain-back-refusal-eyebrow-mark' });
    renderRetryGlyph(mark);
    eyebrow.createSpan({
      cls: 'olea-explain-back-refusal-eyebrow-text',
      text: EXPLAIN_BACK_COULD_NOT_CHECK_EYEBROW,
    });
    box.createEl('p', {
      cls: 'olea-explain-back-refusal',
      text: EXPLAIN_BACK_CHECK_FAILED_REFUSAL,
    });
    const button = box.createEl('button', {
      cls: 'olea-explain-back-refusal-retry',
      text: EXPLAIN_BACK_SUBMIT_LABEL,
    });
    button.addEventListener('click', () => void this.submitAnswer(prompt, answer));
  }

  private renderAcceptedPhase(
    root: HTMLElement,
    message: string | null,
    soloLevel: SoloLevel | null,
  ): void {
    // `[D-217]`: the depth heading renders here, once accepting has actually
    // produced a level — never on the graded phase above, and never a
    // placeholder when none came back (see this file's module doc and
    // `deps.recordSoloGradeAndReview`'s own doc for why that is the common
    // case in production today).
    if (soloLevel !== null) {
      root.createDiv({
        cls: 'olea-explain-back-outcome',
        text: explainBackDepthHeading(soloLevel),
      });
    }
    if (message !== null)
      root.createEl('p', { cls: 'olea-explain-back-encouragement', text: message });
    const button = root.createEl('button', { text: 'Done' });
    button.addEventListener('click', () => this.close());
  }
}

/** `renderGradedRegions`' three edge styles — never a fourth, never a "partly right" hue (see that method's doc). `'covered'` has no live caller yet; kept so `styles.css`'s rule for it and this file's own doc stay pointed at the same name. */
type ExplainBackRegionKind = 'covered' | 'omission' | 'confusion';

interface ExplainBackRegionItem {
  readonly text: string;
  /** `null` for an uncited `missedPoints` entry — never a fabricated source. */
  readonly citation: string | null;
}

function citedIssuesOfKind(
  issues: readonly CitedIssue[],
  kind: CitedIssue['kind'],
): readonly CitedIssue[] {
  return issues.filter((issue) => issue.kind === kind);
}

/** `blockId -> notePath`, built fresh per render from the SAME `ExplainBackSourceBlock[]` the request that produced this grading was built from — the only place this view can resolve a grounded `sourceBlockIds` entry back to something showable. */
function sourceBlockPathLookup(
  sourceBlocks: readonly ExplainBackSourceBlock[],
): ReadonlyMap<string, string> {
  return new Map(sourceBlocks.map((entry) => [entry.block.blockId, entry.path]));
}

/**
 * The first citable block among `sourceBlockIds` that this view actually
 * retrieved, formatted the same way the registry's own citation chips are
 * (`olea-core`'s `formatSourceCitation` — never a second, re-typed basename
 * routine). `null` when none resolve — grounding guarantees at least one id
 * in `sourceBlockIds` came from the caller's own `sourceBlocks`
 * (`gradingPipeline.ts`'s `groundCitations`), so this is a defensive
 * fallback, not the expected path.
 */
function citationLabelFor(
  sourceBlockIds: readonly string[],
  lookup: ReadonlyMap<string, string>,
): string | null {
  for (const id of sourceBlockIds) {
    const sourcePath = lookup.get(id);
    if (sourcePath !== undefined) return formatSourceCitation({ sourcePath });
  }
  return null;
}

function questionQuery(instrument: ReviewInstrument): string {
  switch (instrument.type) {
    case 'qa':
      return instrument.question;
    case 'cloze':
      return `${instrument.before} ${instrument.after}`;
    case 'mcq':
      return instrument.stem;
  }
}
