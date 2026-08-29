/**
 * The contest mechanism — principle 12's fourth part, mechanised by `[D-095]`
 * (`ol-egov.19`) and required by `[D-046]` (`ol-lsx2`). Built for `ol-fgba`
 * [DISP-1] against the approved DSN-1 drawing (`[D-136]`, `ol-bzmb`;
 * `docs/design/dsn1-contestability/` in `olea-service`, cited by path per
 * INV-3).
 *
 * **The ruling in one line.** Every claim Olea asserts about her knowledge is
 * contestable in place. A contest is ONE gesture and ONE event, and what it
 * does is fixed by *what she touched*, never by *what she picked*:
 *
 * - a contested **reading** HOLDS — nothing moves, nothing is discounted, and
 *   the contest routes her to the events the reading was folded from. A
 *   reading is contested *through* its evidence, never around it. A one-tap
 *   discount here would be the snooze button `[D-095]` names, on exactly the
 *   class of claim whose value is that it does not flatter her;
 * - a contested **structural claim** RETURNS TO CANDIDATE — it entered service
 *   through her confirmation, so a contest is that confirmation withdrawn.
 *   Abstention is automatic because candidates are never served. Never called
 *   deletion (vocabulary registry §3);
 * - a contested **grade** QUARANTINES — consumers treat it as thin evidence
 *   until a heavier, async re-derivation lands. It does not disappear.
 *
 * **Both endings live across the three kinds, not inside any one of them.** A
 * reading always holds; a structural claim always moves; a grade holds
 * provisionally and then moves or does not once the re-derivation lands. That
 * is how `[D-046]`'s "a contest has two possible endings and both must exist"
 * is satisfied without asking a single kind to carry both — see
 * `contestOutcomeShapes()` below, which states it as data a test can assert.
 *
 * **Recording is not garnish.** The dispute is recorded either way; that is
 * what makes the affordance more than a dismiss button. The record is
 * `DisputeLogRecord` in `./contest-record.ts`, appended by
 * `appendDisputeRecord` in `./write.ts` and read back by `parseReviewLog`.
 *
 * **Routing is a table, never a guess.** `[D-095]` fixes the effect for three
 * kinds; it does NOT enumerate which of the product's claim renderings belong
 * to each kind. The drawing's frame 03a is reproduced here in
 * `CLAIM_ROUTING` because routing silently at build time is how "every claim
 * contestable" becomes "every claim contestable, and the ones we were not
 * sure about behave however the first implementer guessed". Five rows are
 * `open` and this module REFUSES to contest them rather than picking a
 * plausible kind — `routeClaimRendering` returns the open status and the
 * open-question number, and `contestClaim` throws on it.
 *
 * **No content, per D-005.** Nothing in this module or its record carries her
 * text, a note title, or a rendered sentence. Concept and instrument ids are
 * opaque join keys; the evidence "basis" is an opaque fingerprint of what the
 * claim was computed from, not a copy of it.
 *
 * Pure: reads no clock, writes nothing. Every function takes its `now` and
 * its records.
 */

import type { ReviewLogEntry } from 'olea-contracts';
import {
  CONTESTED_CLAIM_RENDERINGS,
  type ContestEffect,
  type ContestedClaimKind,
  type ContestedClaimRendering,
  type DisputeLogRecord,
} from './contest-record.js';

export type {
  ContestEffect,
  ContestedClaimKind,
  ContestedClaimRendering,
  DisputeLogRecord,
} from './contest-record.js';

/**
 * Whether a rendering is one of the six `[D-095]` routes. The persisted record
 * only ever carries one of those six, so this guard is what keeps the open
 * rows out of the log rather than a cast at the write site.
 */
export function isRoutedRendering(rendering: ClaimRendering): rendering is ContestedClaimRendering {
  return (CONTESTED_CLAIM_RENDERINGS as readonly string[]).includes(rendering);
}

/**
 * The gesture's own string, ratified by `[D-136]` (`ol-bzmb`) as drawn in
 * DSN-1 — the one string that appears on every claim-bearing surface in the
 * product, so it lives in exactly one place.
 *
 * It reads as hers rather than as a verdict; it does not use *wrong*,
 * *dismiss* or *override* (the last of which misdescribes the ruled mechanic).
 * The forbidden alternatives are enumerated in `FORBIDDEN_CONTEST_STRINGS`
 * so a copy test can assert against them rather than against a reviewer's
 * memory of frame 09.
 */
export const CONTEST_GESTURE_LABEL = "This doesn't match what I see";

/**
 * Frame 09 — strings and interactions this mechanism may never use. Lowercased
 * fragments; a copy test asserts no rendered string contains one.
 *
 * Each is banned by a clause, not by taste: a confidence figure is principle
 * 12 part 2 (position, never a score); "got it, updated" on an un-re-derived
 * reading is a lie about the mechanic; a verdict on her in either direction is
 * principle 12 part 1; snooze/dismiss/mute in place of a contest is the
 * one-tap discount `[D-095]` rules out; effort and streak framing near a
 * dispute is registry §9's voice charter.
 */
export const FORBIDDEN_CONTEST_STRINGS: readonly string[] = [
  'dispute submitted',
  'snooze',
  'dismiss',
  'mute',
  'override',
  '% confident',
  'confidence',
  'probability',
  'got it, updated',
  'you were wrong',
  'streak',
];

/**
 * Every claim rendering the product puts on a surface that asserts something,
 * as enumerated by the drawing's frame 03a. The union is closed on purpose: a
 * new rendering must be added here, which is the moment its routing gets
 * decided in the open rather than inside whichever view happened to build it.
 */
export type ClaimRendering =
  /** Stage and vitality on a concept (F2.11, F6.2). */
  | 'mastery-reading'
  /** Cross-term recognition — "you've met this before" (F8.7). */
  | 'cross-term-recognition'
  /** Post-assessment retrospective — what held, what faded (F8.8). */
  | 'retrospective-reading'
  /** A confirmed concept-relation edge (F8.4 / `[D-121]`). */
  | 'concept-relation-edge'
  /** A confirmed cross-course concept match (F8.6). */
  | 'cross-course-match'
  /** An explain-back verdict or instrument grade (`[D-104]`). */
  | 'explain-back-grade'
  /** A trend sentence over review events (F6.5). OQ 6. */
  | 'trend-sentence'
  /** A study-plan ranking and its named factors (F4.2). OQ 7. */
  | 'study-plan-ranking'
  /** A refusal — "your material does not cover this" (C4.7 / `[D-089]`). OQ 8. */
  | 'refusal'
  /** A freshness or arrival line about the vault (F6.9). OQ 9. */
  | 'vault-freshness-line'
  /** An on-demand generated explanation (F2.7). OQ 10. */
  | 'generated-explanation'
  /** A fact she declared — a course, a document's role. Not a contest at all. */
  | 'declared-fact';

/** How a rendering routes: to a ruled kind, to an open question, or out of scope. */
export type ClaimRouting =
  | { readonly status: 'routed'; readonly kind: ContestedClaimKind; readonly ruledBy: string }
  | { readonly status: 'open'; readonly openQuestion: number; readonly why: string }
  | { readonly status: 'not-a-contest'; readonly why: string };

/**
 * Frame 03a, verbatim in structure: six rows routed by clause, five left
 * visibly open, one held apart as a different mechanism.
 *
 * **The empty cells are the substantive part.** An `open` row is a decision
 * bead, never a judgement made at build time. `[D-095]` enumerates three kinds
 * and does not name a trend sentence, a ranking, a refusal, a vault-freshness
 * line or a generated explanation — and DSN-1's open questions 6–10 are one
 * question wearing five hats (does *every claim* mean every sentence on
 * screen, or every claim about her knowledge?). Ruling it once settles all
 * five; routing them one at a time as each surface is built is how the
 * mechanism acquires five undocumented behaviours.
 *
 * The last row is here for the reason the drawing gives: "contest a claim Olea
 * made" and "correct a fact you declared" land next to each other on the same
 * screens and are different mechanisms with different records. A build that
 * routed a mis-registered document through the contest gesture would produce a
 * dispute record about a claim Olea never made.
 */
export const CLAIM_ROUTING: Readonly<Record<ClaimRendering, ClaimRouting>> = {
  'mastery-reading': {
    status: 'routed',
    kind: 'reading',
    ruledBy: '[D-095]; F2.11 is the position it states',
  },
  'cross-term-recognition': {
    status: 'routed',
    kind: 'reading',
    ruledBy: 'F8.7, which names itself a reading and contestable in place',
  },
  'retrospective-reading': {
    status: 'routed',
    kind: 'reading',
    ruledBy: 'F8.8, same two words',
  },
  'concept-relation-edge': {
    status: 'routed',
    kind: 'structural',
    ruledBy: '[D-095]; F8.4 / [D-121] is the confirmation it withdraws',
  },
  'cross-course-match': {
    status: 'routed',
    kind: 'structural',
    ruledBy: '[D-095]; F8.6 is the confirmation',
  },
  'explain-back-grade': {
    status: 'routed',
    kind: 'grade',
    ruledBy: '[D-095]; [D-104] keeps the rating a scheduling input, never sole mastery evidence',
  },
  'trend-sentence': {
    status: 'open',
    openQuestion: 6,
    why: 'Reads like a reading — asserts a position, moves nothing — but [D-095] does not enumerate it.',
  },
  'study-plan-ranking': {
    status: 'open',
    openQuestion: 7,
    why: 'The rank may be a reading while a wrong factor is a source correction, not a contest.',
  },
  refusal: {
    status: 'open',
    openQuestion: 8,
    why: 'An assertion about her material with a stated reason; not a claim about her knowledge.',
  },
  'vault-freshness-line': {
    status: 'open',
    openQuestion: 9,
    why: 'Asserts a fact about the vault, not about her.',
  },
  'generated-explanation': {
    status: 'open',
    openQuestion: 10,
    why: 'Neither reading, structural claim, nor grade.',
  },
  'declared-fact': {
    status: 'not-a-contest',
    why: 'Corrected by editing the declaration (course setup), never by disputing Olea.',
  },
};

/** The routing for one rendering. Total over the union — there is no default arm. */
export function routeClaimRendering(rendering: ClaimRendering): ClaimRouting {
  return CLAIM_ROUTING[rendering];
}

/**
 * `[D-095]`'s effect table. The whole of "what happens depends on what she
 * touched, never on what she picked" is these three lines, and nothing else in
 * the codebase may branch on a reason she selected.
 */
export function contestEffectFor(kind: ContestedClaimKind): ContestEffect {
  switch (kind) {
    case 'reading':
      return 'held';
    case 'structural':
      return 'returned-to-candidate';
    case 'grade':
      return 'quarantined';
  }
}

/**
 * The proof that both endings exist, as data rather than as prose — `[D-046]`
 * clause 4's "a contest has two possible endings and both must exist" asserted
 * across the three kinds, which is where the drawing says the pair lives.
 *
 * `moves` is whether the state moves at the moment of contest; `mayMoveLater`
 * is whether it can move afterwards, on evidence. A reading is (false, true) —
 * it holds now, and moves only when a grade beneath it is re-derived. A
 * structural claim is (true, false) — it always moves, immediately, and that
 * is a withdrawal rather than a re-judgement. A grade is (false, true): it
 * dims now and is answered when the re-derivation lands.
 */
export function contestOutcomeShapes(): Readonly<
  Record<ContestedClaimKind, { readonly moves: boolean; readonly mayMoveLater: boolean }>
> {
  return {
    reading: { moves: false, mayMoveLater: true },
    structural: { moves: true, mayMoveLater: false },
    grade: { moves: false, mayMoveLater: true },
  };
}

/**
 * What a contest needs to know about the claim it is contesting. Deliberately
 * id- and fingerprint-shaped: nothing here is her text (D-005).
 */
export interface ContestedClaim {
  readonly rendering: ClaimRendering;
  /** The concepts the claim is about. Non-empty — a claim about no concept is uncontestable. */
  readonly conceptIds: readonly string[];
  /** Present for grades and for structural claims that name an instrument. */
  readonly instrumentId?: string;
  /**
   * An opaque fingerprint of the evidence this claim was computed from — the
   * hinge of evidence-relative aging (`[D-095]` §3). A held dispute rides its
   * claim until the claim is recomputed on substantially new evidence, at
   * which point the fingerprint changes and the dispute retires. A calendar is
   * arbitrary, and forever lets one bad day shadow a concept.
   */
  readonly evidenceBasis: string;
}

/** The input side of one contest gesture. One gesture, one event. */
export interface ContestInput {
  readonly claim: ContestedClaim;
  readonly timestamp: string;
}

/** What a contest produced: the record to append, and the effect on the state. */
export interface ContestOutcome {
  readonly kind: ContestedClaimKind;
  readonly effect: ContestEffect;
  /** Everything but `eventId`, which the writer mints. */
  readonly record: Omit<DisputeLogRecord, 'schemaVersion' | 'kind' | 'eventId'>;
}

/**
 * Thrown when a contest is attempted on a rendering nothing has routed. It is
 * an error rather than a silent default precisely because a default here is
 * the failure this module exists to prevent — see `CLAIM_ROUTING`'s doc.
 */
export class UnroutedClaimError extends Error {
  constructor(
    readonly rendering: ClaimRendering,
    readonly routing: ClaimRouting,
  ) {
    const detail =
      routing.status === 'open'
        ? `open question ${routing.openQuestion}: ${routing.why}`
        : routing.status === 'not-a-contest'
          ? routing.why
          : 'routed';
    super(
      `contestClaim: "${rendering}" has no ruled claim kind — ${detail}. ` +
        'Routing it here would invent a behaviour [D-095] did not rule.',
    );
    this.name = 'UnroutedClaimError';
  }
}

/**
 * One gesture, one event. Produces the dispute record and names the effect;
 * appending is `appendDisputeRecord`'s job and applying the effect is the
 * consumers' (`quarantinedGradeInstrumentIds`, `withdrawnStructuralClaims`,
 * `standingDissent` below).
 *
 * Throws `UnroutedClaimError` for the five open rows and for a declared fact.
 */
export function contestClaim(input: ContestInput): ContestOutcome {
  const routing = routeClaimRendering(input.claim.rendering);
  if (routing.status !== 'routed' || !isRoutedRendering(input.claim.rendering)) {
    throw new UnroutedClaimError(input.claim.rendering, routing);
  }
  const rendering: ContestedClaimRendering = input.claim.rendering;
  if (input.claim.conceptIds.length === 0) {
    throw new Error('contestClaim: a contested claim must name at least one concept');
  }
  const effect = contestEffectFor(routing.kind);
  return {
    kind: routing.kind,
    effect,
    record: {
      timestamp: input.timestamp,
      claimKind: routing.kind,
      claimRendering: rendering,
      conceptIds: [...input.claim.conceptIds],
      ...(input.claim.instrumentId === undefined ? {} : { instrumentId: input.claim.instrumentId }),
      evidenceBasis: input.claim.evidenceBasis,
      effect,
    },
  };
}

/**
 * The resolution record for a contested GRADE, once the async re-derivation
 * lands (`[D-095]` §2). Two outcomes, both recorded:
 *
 * - `corrected` — the tool was wrong. A compensating event is appended NAMING
 *   HER CONTEST AS ITS CATALYST (`resolves`), written where she can see it,
 *   because that is the proof the channel works.
 * - `upheld` — the tool holds. Acknowledged ONCE, then genuinely let rest;
 *   `shouldAcknowledgeDispute` below is the "exactly once" half.
 */
export function resolveDispute(input: {
  readonly dispute: DisputeLogRecord;
  readonly outcome: 'upheld' | 'corrected';
  readonly timestamp: string;
}): Omit<DisputeLogRecord, 'schemaVersion' | 'kind' | 'eventId'> {
  const { dispute } = input;
  return {
    timestamp: input.timestamp,
    claimKind: dispute.claimKind,
    claimRendering: dispute.claimRendering,
    conceptIds: [...dispute.conceptIds],
    ...(dispute.instrumentId === undefined ? {} : { instrumentId: dispute.instrumentId }),
    evidenceBasis: dispute.evidenceBasis,
    effect: dispute.effect,
    resolves: dispute.eventId,
    outcome: input.outcome,
  };
}

// ------------------------------------------------------------------------------------------
// Reading the disputes back — projections, never stored state
// ------------------------------------------------------------------------------------------

/** An opening dispute is one that is not itself a resolution of another. */
function isOpening(record: DisputeLogRecord): boolean {
  return record.resolves === undefined;
}

/**
 * Evidence-relative aging (`[D-095]` §3), and the reason no date appears in
 * this function. A dispute rides its claim while the claim still rests on the
 * evidence it rested on when she disputed it. Once the claim is recomputed on
 * substantially new evidence the fingerprint differs, and the claim ARRIVES
 * FRESH — the old dispute retires with the reading it was about.
 */
export function isDisputeCurrent(dispute: DisputeLogRecord, currentEvidenceBasis: string): boolean {
  return dispute.evidenceBasis === currentEvidenceBasis;
}

/** Every dispute in the log, oldest first, in file order. */
export function reviewLogDisputes(
  records: readonly (ReviewLogEntry | DisputeLogRecord)[],
): readonly DisputeLogRecord[] {
  return records.filter(
    (record): record is DisputeLogRecord => (record as DisputeLogRecord).kind === 'dispute',
  );
}

/** The state one claim is in, folded from the log. Nothing here is stored. */
export interface ClaimContestState {
  /** Whether a dispute is standing against this claim on its current evidence. */
  readonly disputed: boolean;
  /** `null` until she contests. */
  readonly effect: ContestEffect | null;
  /** The opening dispute, when one stands. */
  readonly dispute: DisputeLogRecord | null;
  /** `null` while a contested grade's re-derivation has not landed. */
  readonly resolution: 'upheld' | 'corrected' | null;
  /**
   * Whether the surface should show the acknowledgment this render.
   *
   * `[D-095]` §2: acknowledged exactly once, then genuinely let rest. Silence
   * teaches her the channel is a void; repetition teaches her it is an
   * argument. Once a resolution exists, the acknowledgment is due until she
   * has seen it (`acknowledgedDisputeIds`) and never again.
   */
  readonly acknowledgementDue: boolean;
}

/**
 * Folds every dispute record about one claim into its current state.
 *
 * A dispute whose `evidenceBasis` no longer matches the claim's is not counted
 * — that is the aging rule, applied at read time rather than by a sweep, which
 * is what "the claim arrives fresh" means mechanically.
 */
export function contestStateForClaim(input: {
  readonly records: readonly (ReviewLogEntry | DisputeLogRecord)[];
  readonly claim: Pick<ContestedClaim, 'rendering' | 'conceptIds' | 'evidenceBasis'> & {
    readonly instrumentId?: string;
  };
  /** Dispute event ids whose acknowledgment she has already seen. */
  readonly acknowledgedDisputeIds?: readonly string[];
}): ClaimContestState {
  const disputes = reviewLogDisputes(input.records).filter(
    (record) =>
      record.claimRendering === input.claim.rendering &&
      record.instrumentId === input.claim.instrumentId &&
      sameConceptSet(record.conceptIds, input.claim.conceptIds),
  );

  const opening = disputes
    .filter(isOpening)
    .filter((record) => isDisputeCurrent(record, input.claim.evidenceBasis))
    .at(-1);

  if (opening === undefined) {
    return {
      disputed: false,
      effect: null,
      dispute: null,
      resolution: null,
      acknowledgementDue: false,
    };
  }

  const resolution = disputes.find((record) => record.resolves === opening.eventId);
  const seen = new Set(input.acknowledgedDisputeIds ?? []);

  return {
    disputed: true,
    effect: opening.effect,
    dispute: opening,
    resolution: resolution?.outcome ?? null,
    acknowledgementDue: resolution !== undefined && !seen.has(opening.eventId),
  };
}

function sameConceptSet(a: readonly string[], b: readonly string[]): boolean {
  if (a.length !== b.length) return false;
  const left = [...a].sort();
  const right = [...b].sort();
  return left.every((value, index) => value === right[index]);
}

/**
 * Instruments whose grade is quarantined — consumers treat these as THIN
 * EVIDENCE, never as absent evidence. It dims with a badge saying why; it does
 * not disappear, and it is not deleted from any rollup input.
 *
 * A quarantine ends when a resolution lands, either way: `corrected` because
 * the compensating event now carries the truth, `upheld` because the original
 * grading was checked and holds.
 */
export function quarantinedGradeInstrumentIds(
  records: readonly (ReviewLogEntry | DisputeLogRecord)[],
): readonly string[] {
  const disputes = reviewLogDisputes(records);
  const resolved = new Set(
    disputes.map((record) => record.resolves).filter((id): id is string => id !== undefined),
  );
  const ids = new Set<string>();
  for (const record of disputes) {
    if (record.claimKind !== 'grade') continue;
    if (!isOpening(record)) continue;
    if (resolved.has(record.eventId)) continue;
    if (record.instrumentId !== undefined) ids.add(record.instrumentId);
  }
  return [...ids];
}

/**
 * Structural claims she has withdrawn — returned to candidate, and never
 * served. Keyed by the concept set the confirmation joined, because that is
 * what a match or an edge IS.
 *
 * There is no un-withdraw here: re-confirming is the ordinary confirmation
 * flow (F8.6), not a second contest — DSN-1 open question 3 notes this is
 * presumed rather than stated, and this module presumes nothing beyond
 * declining to serve.
 */
export function withdrawnStructuralClaims(
  records: readonly (ReviewLogEntry | DisputeLogRecord)[],
): readonly (readonly string[])[] {
  return reviewLogDisputes(records)
    .filter((record) => record.claimKind === 'structural' && isOpening(record))
    .map((record) => record.conceptIds);
}

/**
 * Readings standing with her dissent beside them — the mark the surface shows
 * next to a claim that did not move. Nothing here discounts anything: this is
 * the whole of what a contested reading does to the state, and it is
 * deliberately a rendering fact rather than an arithmetic one.
 */
export function standingDissent(
  records: readonly (ReviewLogEntry | DisputeLogRecord)[],
): readonly DisputeLogRecord[] {
  return reviewLogDisputes(records).filter(
    (record) => record.claimKind === 'reading' && isOpening(record),
  );
}

// ------------------------------------------------------------------------------------------
// The aggregate health check (`[D-095]` §4)
// ------------------------------------------------------------------------------------------

/**
 * Contest clustering by claim kind and rendering — `[D-095]` §4's NAMED health
 * check, with a threshold that can fire.
 *
 * **Counts only; content never leaves.** The return carries a kind, a
 * rendering and an integer, and nothing else — no concept id, no instrument
 * id, no text. Computed where the events live (on her device, over her own
 * log), which is why it is in `olea-core` and not in the Worker.
 *
 * Slow at n=1 by construction and fine: the check exists from day one so that
 * a contest-rate spike on one grader or one reading has somewhere to be seen
 * the moment there is enough history to see it.
 */
export interface ContestRateReading {
  readonly claimKind: ContestedClaimKind;
  readonly claimRendering: ClaimRendering;
  readonly disputes: number;
  readonly claimsAsserted: number;
  /** True when `disputes / claimsAsserted` reaches `threshold` on a sufficient denominator. */
  readonly firing: boolean;
}

/**
 * The threshold at which a contest rate is worth a look, and the smallest
 * denominator on which it may fire.
 *
 * **DECLARED, not derived** (component register's constant rule): one claim in
 * four disputed is defensible in plain English as "she disagrees with this
 * pipeline more often than she agrees is plausible", and the floor of eight
 * exists so a single dispute against two claims cannot fire it. Neither number
 * is fitted against any corpus, and both are here in public client source for
 * exactly that reason. Moving either is a threshold tuning (Class B) with a
 * measurement behind it, not an edit.
 */
export const CONTEST_RATE_THRESHOLD = 0.25;
export const CONTEST_RATE_MIN_CLAIMS = 8;

export function contestRateHealthCheck(input: {
  readonly records: readonly (ReviewLogEntry | DisputeLogRecord)[];
  /** How many claims of each rendering the surfaces asserted over the same window. */
  readonly claimsAsserted: Readonly<Partial<Record<ClaimRendering, number>>>;
}): readonly ContestRateReading[] {
  const counts = new Map<ClaimRendering, number>();
  for (const record of reviewLogDisputes(input.records)) {
    if (!isOpening(record)) continue;
    counts.set(record.claimRendering, (counts.get(record.claimRendering) ?? 0) + 1);
  }

  const readings: ContestRateReading[] = [];
  for (const [rendering, asserted] of Object.entries(input.claimsAsserted) as [
    ClaimRendering,
    number,
  ][]) {
    const routing = routeClaimRendering(rendering);
    if (routing.status !== 'routed') continue;
    const disputes = counts.get(rendering) ?? 0;
    readings.push({
      claimKind: routing.kind,
      claimRendering: rendering,
      disputes,
      claimsAsserted: asserted,
      firing: asserted >= CONTEST_RATE_MIN_CLAIMS && disputes / asserted >= CONTEST_RATE_THRESHOLD,
    });
  }
  return readings.sort((a, b) => (a.claimRendering < b.claimRendering ? -1 : 1));
}
