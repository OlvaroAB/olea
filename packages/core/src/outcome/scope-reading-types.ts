/**
 * Stored shapes of the examiner-scope reading (`[D-429]`, ruled 2026-09-29, decision sheet row 16,
 * option a): three stores in Olea's own layer — each document revision's processing state, the
 * paper-structure reading with demand per part, and alignment results — plus the vocabulary they
 * share. Design authority: `olea-service/docs/dev/intelligence-build/scp.md` sections 2.1, 2.2, 3.1
 * and 3.2, and S.3 (results), S.4 (aggregation) and S.6 (operational end states).
 *
 * **What the ruling asked for, and where each part lives.**
 *
 * - *Processing state, paper structure and alignment results in Olea's own layer, by the
 *   established persistence pattern*: `./scope-reading-log.ts` (per-device append-only files, a
 *   logical clock, content-hash identity) and `./scope-reading-store.ts`.
 * - *Source and reader-version provenance*: `ScopeSourceRef` (which document revision) and
 *   `ScopeReaderProvenance` (task, prompt version, model id — D7.3, INV-4) on every record a model
 *   produced.
 * - *Pending distinct from empty*: `DocumentProcessingState` keeps "extraction owed" (`pending`)
 *   and "read, and the document states nothing" (`read-states-nothing`) as different kinds, and
 *   `./scope-reading-project.ts` keeps "no record at all" as a third thing again.
 * - *Stale readings invalidated*: every record is keyed to a revision digest (alignment results also
 *   to the closed-list, coverage, batch-plan and frozen-configuration digests), and the projection
 *   labels a reading current only against the digests the caller says are current.
 * - *No server-side student state*: nothing here is sent anywhere. These are client-side records of
 *   what the client computed from transient Worker answers (boundary section 1: the Worker is a
 *   calculator).
 *
 * **What these types deliberately do not carry.** Her content beyond what the reading itself is: a
 * group's or section's label is the paper's own heading, local content, never logged (D-005), and is
 * kept because the reading is meaningless without it; nothing else quotes her documents. Passage
 * text is never stored — an anchor is an ordinal into the document's own landed units.
 *
 * **Shapes that mirror the contract to come.** The paper-structure reading carries the target of
 * `[D-431]` (sections with unknown marks, per-part instruction anchors, marks, dependency cues, a
 * paper total and time allowance) while `parts` stays optional: absent means the reader that
 * produced this record did not carry parts (today's `outcomes.extract.v1` at 1.1.0 does not), which
 * is not the same as a paper with no parts — the same "absent is not empty" convention
 * `PaperQuestionGroup`'s reader already keeps.
 */

import type {
  PaperDemand,
  PaperMarks,
  PaperQuestionGroup,
  PaperTimeAllowance,
} from '../oracle/paper-types.js';

/** Bumped only on a breaking change to any stored shape below. */
export const SCOPE_READING_SCHEMA_VERSION = 1;

/** The kind of document a reading is about. `'stated-scope'` is an assessment's stated-scope entries (scp.md 2.5): its `sourcePath` is an opaque assessment scope key, not a file. */
export type ScopeDocumentKind = 'objectives' | 'past-paper' | 'stated-scope';

/**
 * Which document, at which revision — the source provenance on every record. `sourcePath` is the
 * registered document's vault path (an assessment scope key for stated scope); `revisionDigest` is
 * the content digest of the text the reading was made from, supplied by the caller. A reading is
 * about exactly this revision and no other.
 */
export interface ScopeSourceRef {
  readonly sourcePath: string;
  readonly revisionDigest: string;
  readonly documentKind: ScopeDocumentKind;
}

/**
 * D7.3 / INV-4: task id, prompt version and model identity, on every stored model output. A record
 * no model produced (a code-decided state, an owed extraction) carries none: there is nothing to
 * attribute, and a placeholder would read as provenance it is not.
 */
export interface ScopeReaderProvenance {
  readonly task: string;
  readonly promptVersion: string;
  readonly modelId: string;
}

// --------------------------------------------------------------------------------------------
// Store 1: a document revision's processing state (scp.md 3.1)
// --------------------------------------------------------------------------------------------

/** Why extraction is owed: the service could not be reached or answered unusably, the run's budget was reached, or the extraction failed and will be retried. Never a claim about the document. */
export type ScopePendingReason = 'unavailable' | 'over-budget' | 'failed';

/**
 * A document revision's processing state, the five states of scp.md 3.1, kept apart:
 *
 * - `registered` — registered, not yet read;
 * - `partly-read` — some units read, more owed (`unitsRead` of `unitsTotal`, counts only);
 * - `pending` — extraction owed, with the reason; retried on the next run;
 * - `read-states-nothing` — fully read, extraction ran, and the document states no scope or
 *   structure: an EMPTY result, and the only state that says so;
 * - `recorded` — read, and a reading was recorded (declarations and, for a paper, structure).
 *
 * A revision with NO record of any state is a sixth thing the projection reports as unknown, never
 * as `read-states-nothing`.
 */
export type DocumentProcessingState =
  | { readonly kind: 'registered' }
  | { readonly kind: 'partly-read'; readonly unitsRead: number; readonly unitsTotal: number }
  | { readonly kind: 'pending'; readonly reason: ScopePendingReason }
  | { readonly kind: 'read-states-nothing' }
  | { readonly kind: 'recorded' };

export interface DocumentStatePayload {
  readonly source: ScopeSourceRef;
  readonly state: DocumentProcessingState;
  /** Present when a model produced the state (`recorded`, `read-states-nothing`); absent for a code-decided or owed one. */
  readonly provenance?: ScopeReaderProvenance;
  /** The perception chain's coverage-record digest the reading was made under, when known. */
  readonly coverageDigest?: string;
}

// --------------------------------------------------------------------------------------------
// Store 2: the paper-structure reading, and demand per part (scp.md 2.2, 2.3)
// --------------------------------------------------------------------------------------------

/** Where the reader found something: the document's own landed-unit ordinal, the same per-document key an Outcome's source reference carries (`OutcomeSourceReference.blockIndex`). Never text. */
export interface ScopeReadingAnchor {
  readonly unitIndex: number;
}

export interface ScopeStructureSection {
  readonly label: string;
  readonly questionForm: string;
  readonly itemCount: number;
  readonly marks: PaperMarks;
  readonly anchor: ScopeReadingAnchor;
}

/** A dependency cue between parts of one reading, by part id. Unknown is never independent. */
export type ScopePartDependency =
  | { readonly status: 'stated'; readonly onPartIds: readonly string[] }
  | { readonly status: 'unknown' };

export interface ScopeStructurePart {
  /** A handle unique within this reading (the reader's own), never derived from the part's text. */
  readonly id: string;
  /** How the paper numbers the part, local content. */
  readonly label: string;
  /** The group the part sits in (`PaperQuestionGroup.id` of this reading). */
  readonly groupId: string;
  /** Where the part's own instruction sits — a reference, so the original instruction stays in her document. */
  readonly instructionAnchor: ScopeReadingAnchor;
  readonly questionForm: string;
  readonly marks: PaperMarks;
  readonly dependsOn: ScopePartDependency;
}

/**
 * The paper-structure reading. `groups` and `parts` are absent when the reader that produced this
 * record did not carry them: absent is not empty (see the module doc). `totalMarks` and
 * `timeAllowance` are `unknown` when the paper states none.
 */
export interface ScopePaperStructure {
  readonly sections: readonly ScopeStructureSection[];
  readonly groups?: readonly PaperQuestionGroup<ScopeReadingAnchor>[];
  readonly parts?: readonly ScopeStructurePart[];
  readonly totalMarks: PaperMarks;
  readonly timeAllowance: PaperTimeAllowance;
}

/** One reading of one past paper revision by one reader. Its identity (`eventId`) is the structure digest a part-demand record is read against. */
export interface PaperStructurePayload {
  readonly source: ScopeSourceRef;
  readonly provenance: ScopeReaderProvenance;
  readonly reading: ScopePaperStructure;
}

/**
 * A part's demand verdict (scp.md 2.3): a decided demand of `[D-262]`'s five, a compound of two in
 * the order the part asks them, an operation outside the vocabulary (`unsupported`, with its command
 * word kept verbatim — never coerced into a demand), or cannot-tell. `refs` are the unit ordinals the
 * verdict cites. **Not yet read has no record**: absence, never a verdict; an unavailable call is
 * operational and is never stored as a verdict.
 */
export type ScopePartDemand =
  | {
      readonly status: 'decided';
      readonly demand: PaperDemand;
      readonly commandWord?: string;
      readonly refs: readonly number[];
    }
  | {
      readonly status: 'compound';
      readonly demands: readonly [PaperDemand, PaperDemand];
      readonly commandWord?: string;
      readonly refs: readonly number[];
    }
  | {
      readonly status: 'unsupported';
      readonly commandWord?: string;
      readonly refs: readonly number[];
    }
  | { readonly status: 'cannot-tell'; readonly reason: string };

export interface PartDemandPayload {
  readonly source: ScopeSourceRef;
  readonly partId: string;
  /** The `eventId` of the structure record this part was read against: a demand read against a structure that has since been replaced is stale. */
  readonly structureId: string;
  readonly demand: ScopePartDemand;
  readonly provenance: ScopeReaderProvenance;
}

// --------------------------------------------------------------------------------------------
// Store 3: alignment results (scp.md S.3, S.4, S.6)
// --------------------------------------------------------------------------------------------

/**
 * The digests a result is only current against (S.3, "provenance on every result"). A result whose
 * digests do not match the current revision, list, coverage, batch plan and frozen configuration
 * reads **unverified**, never current.
 */
export interface AlignmentDigests {
  readonly closedList: string;
  readonly coverage: string;
  readonly batchPlan: string;
  readonly frozenConfiguration: string;
}

/** Why a concept was not sent for a record, from the omission ledger's closed list (S.4). */
export type AlignmentOmissionReason =
  | 'run-cap'
  | 'no-stable-key'
  | 'over-call-budget'
  | 'group-over-budget';

/**
 * One result per (course, document revision, concept). Three verdicts and one operational state,
 * apart (S.3):
 *
 * - `aligned` — at least one record judged within scope with a surviving passage ref (`refs`, unit
 *   ordinals actually sent) and the ids of the records that did (`recordIds`);
 * - `not-aligned` — every pair was sent and judged, none puts the concept in scope, and every unit
 *   was read (`searched`), or the document was read and states no scope (`states-no-scope`);
 * - `cannot-tell` — a pair came back cannot-tell, a check voided a verdict, or the document was
 *   only partly read;
 * - `pending` — operational: the work is owed (an outage, an omitted pair, a failed alignment).
 *   Never read as `not-aligned`.
 */
export type AlignmentResult =
  | {
      readonly kind: 'aligned';
      readonly recordIds: readonly string[];
      readonly refs: readonly number[];
    }
  | { readonly kind: 'not-aligned'; readonly reason: 'searched' | 'states-no-scope' }
  | {
      readonly kind: 'cannot-tell';
      readonly reason:
        | 'ambiguous'
        | 'depends-on-unread-unit'
        | 'depends-on-figure'
        | 'partly-read'
        | 'voided-by-check';
    }
  | {
      readonly kind: 'pending';
      readonly reason: 'unavailable' | 'failed-alignment' | AlignmentOmissionReason;
    };

/** What a result must show beside itself so "not aligned" is never read without what was not read or not sent (S.3). Counts and reasons only. */
export interface AlignmentCoverageNote {
  readonly unitsNotRead: readonly { readonly unit: string; readonly reason: string }[];
  readonly pairsNotSent: readonly {
    readonly reason: AlignmentOmissionReason;
    readonly count: number;
  }[];
}

export interface AlignmentResultPayload {
  readonly source: ScopeSourceRef;
  readonly courseId: string;
  /** The concept's opaque persisted key (`concept-key1:`), never a name (C7.11). */
  readonly conceptKey: string;
  readonly result: AlignmentResult;
  readonly digests: AlignmentDigests;
  readonly coverage: AlignmentCoverageNote;
  /** A pending result no model produced carries none. */
  readonly provenance?: ScopeReaderProvenance;
}

// --------------------------------------------------------------------------------------------
// Freshness, as the projection labels it
// --------------------------------------------------------------------------------------------

/**
 * How a reading stands against what the caller says is current:
 *
 * - `current` — same revision, and a reader version the caller accepts;
 * - `stale-revision` — made from a revision that is no longer the current one;
 * - `stale-reader` — the right revision, made by a reader version outside the accepted set (a prompt
 *   or contract bump since).
 *
 * A stale reading is kept (append-only) and never served as current.
 */
export type ScopeReadingFreshness = 'current' | 'stale-revision' | 'stale-reader';

/** An alignment result's standing: `current`, or `unverified` with the digests that no longer match. */
export type AlignmentFreshness =
  | { readonly status: 'current' }
  | {
      readonly status: 'unverified';
      readonly stale: readonly (
        | 'revision'
        | 'closedList'
        | 'coverage'
        | 'batchPlan'
        | 'frozenConfiguration'
      )[];
    };
