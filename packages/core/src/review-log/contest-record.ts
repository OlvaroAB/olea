/**
 * The persisted dispute record — `[D-046]` clause 4's "recorded either way",
 * shaped by `[D-095]` (`ol-egov.19`). Built for `ol-fgba` [DISP-1].
 *
 * ==========================================================================
 * WHERE THIS SCHEMA BELONGS, AND WHY IT IS HERE FOR NOW
 * ==========================================================================
 * A new persisted review-log event kind is a **Class C** move: it changes a
 * persisted schema. The other four kinds (`review`, `suspend`/`unsuspend`,
 * `verdict`, `succession`) all live in `packages/contracts/src/review-log.ts`
 * and this one belongs beside them — as a fifth `kind` literal, additive to
 * `reviewLogEntryV5`, needing no version bump for exactly the reason
 * `successionLogRecordV5`'s own doc gives ("a new literal `kind` value is
 * what additive means here").
 *
 * `ol-fgba`'s lane does not own `packages/contracts/`, so the shape is
 * defined here and the verbatim additive zod diff for `contracts` is handed
 * back on the bead. **Nothing about the wire shape changes when it moves** —
 * the relocation is a paste plus a union member, and `parseReviewLog` already
 * reads dispute lines out of the same daily file every other kind lives in
 * (`./parse.ts`, `disputes`).
 *
 * **Why the validator below is hand-written rather than zod.** `olea-core`
 * does not depend on `zod` — every schema in this codebase lives in
 * `olea-contracts`, which is exactly the argument for the record moving
 * there. Adding the dependency here to hold a schema that is leaving would
 * make the temporary arrangement harder to undo than the thing it stands in
 * for. `safeParseDisputeLogRecord` therefore mirrors zod's `safeParse` return
 * shape field for field, so `./write.ts` and `./parse.ts` need no edit beyond
 * swapping the import when the contracts schema lands.
 *
 * Until it moves, `parseReviewLog` validates dispute lines against THIS
 * validator and returns them in a **separate `disputes` field** rather than
 * widening `ReviewLogEntry` — deliberately, so no consumer switching
 * exhaustively over `kind` outside this module breaks, and so INV-2's
 * byte-identical round trip is unaffected (a dispute line parses, so it is
 * never an `invalidLine`).
 *
 * ==========================================================================
 * WHAT IT RECORDS — AND WHAT IT NEVER DOES
 * ==========================================================================
 * **No content, per D-005.** What she disputed, which kind of claim it was,
 * which concepts and instrument it concerned, what the contest did, and an
 * opaque fingerprint of the evidence the claim rested on. Never her wording,
 * never the rendered sentence, never a reason she typed — and deliberately
 * **no reason field at all**, because `[D-095]` fixes the effect by what she
 * touched and never by what she picked. A stored reason would be the first
 * thing a later build branched on.
 *
 * **Append-only, like every other record in this file family.** A resolution
 * is a SECOND dispute record carrying `resolves` (the opening event's id) and
 * `outcome` — never an edit to the first. That is what makes the compensating
 * event `[D-095]` §2 requires able to *name her contest as its catalyst*: the
 * catalyst is a real, durable event id, written where she can see it.
 */

/** `[D-095]`'s three kinds. The effect is fixed by this and nothing else. */
export type ContestedClaimKind = 'reading' | 'structural' | 'grade';
export const CONTESTED_CLAIM_KINDS: readonly ContestedClaimKind[] = [
  'reading',
  'structural',
  'grade',
];

/**
 * What the contest did at the moment she made it. Stored rather than derived
 * so a record stays readable if the routing table ever changes: what happened
 * to her claim is a fact about that moment.
 *
 * `returned-to-candidate` is deliberately not called deletion or removal —
 * vocabulary registry §3's hard clamp, and the ruled mechanic besides: the
 * claim entered service through her confirmation and a contest withdraws that
 * confirmation.
 */
export type ContestEffect = 'held' | 'returned-to-candidate' | 'quarantined';
export const CONTEST_EFFECTS: readonly ContestEffect[] = [
  'held',
  'returned-to-candidate',
  'quarantined',
];

/** The six routed renderings, matching `./contest.ts`'s `CLAIM_ROUTING`. */
export type ContestedClaimRendering =
  | 'mastery-reading'
  | 'cross-term-recognition'
  | 'retrospective-reading'
  | 'concept-relation-edge'
  | 'cross-course-match'
  | 'explain-back-grade';
export const CONTESTED_CLAIM_RENDERINGS: readonly ContestedClaimRendering[] = [
  'mastery-reading',
  'cross-term-recognition',
  'retrospective-reading',
  'concept-relation-edge',
  'cross-course-match',
  'explain-back-grade',
];

/**
 * One dispute event, schema version 5 — a fifth `kind` in the review log's
 * daily file (C5.2), append-only.
 */
export interface DisputeLogRecord {
  readonly schemaVersion: 5;
  /** Discriminator. Required, never defaulted — the file family's rule. */
  readonly kind: 'dispute';
  /** Stable unique id; makes two-device merges idempotent, and is the catalyst id. */
  readonly eventId: string;
  /** ISO-8601 with offset. The offset matters: "when did she disagree" is local. */
  readonly timestamp: string;
  readonly claimKind: ContestedClaimKind;
  readonly claimRendering: ContestedClaimRendering;
  /**
   * Every concept the claim was about. Non-empty for the same reason
   * `verdictLogRecordV5.conceptIds` is: a dispute naming no concept is
   * invisible to every later question.
   */
  readonly conceptIds: readonly string[];
  /** Present for a grade, and for a structural claim that names an instrument. */
  readonly instrumentId?: string;
  /**
   * Opaque fingerprint of the evidence the claim rested on when she disputed
   * it — the hinge of evidence-relative aging (`[D-095]` §3). Never a copy of
   * the evidence, and never her text.
   */
  readonly evidenceBasis: string;
  readonly effect: ContestEffect;
  /** The opening dispute this record resolves. Absent on an opening dispute. */
  readonly resolves?: string;
  /** How the re-derivation landed. Present exactly when `resolves` is. */
  readonly outcome?: 'upheld' | 'corrected';
}

/** Alias kept so the file family's `*V5` naming reads consistently. */
export type DisputeLogRecordV5 = DisputeLogRecord;

/** What a caller supplies; the writer stamps `schemaVersion`, `kind` and `eventId`. */
export type DisputeLogRecordInput = Omit<DisputeLogRecord, 'schemaVersion' | 'kind' | 'eventId'>;

/** Mirrors zod's `safeParse` return, so the eventual contracts swap is an import change. */
export type SafeParseDisputeResult =
  | { readonly success: true; readonly data: DisputeLogRecord }
  | { readonly success: false; readonly error: { readonly message: string } };

const ISO_WITH_OFFSET = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})$/;

function nonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}

/**
 * Validates one candidate dispute record. Fails closed on every way of not
 * knowing: an unrecognised enum value, a missing id, a timestamp without an
 * offset, an empty concept list, or a half-formed resolution.
 */
export function safeParseDisputeLogRecord(input: unknown): SafeParseDisputeResult {
  const fail = (message: string): SafeParseDisputeResult => ({
    success: false,
    error: { message },
  });

  if (typeof input !== 'object' || input === null) return fail('not an object');
  const value = input as Record<string, unknown>;

  if (value.schemaVersion !== 5) return fail('schemaVersion must be the literal 5');
  if (value.kind !== 'dispute') return fail("kind must be the literal 'dispute'");
  if (!nonEmptyString(value.eventId)) return fail('eventId must be a non-empty string');
  if (!nonEmptyString(value.timestamp) || !ISO_WITH_OFFSET.test(value.timestamp)) {
    return fail('timestamp must be ISO-8601 with an offset');
  }
  if (!CONTESTED_CLAIM_KINDS.includes(value.claimKind as ContestedClaimKind)) {
    return fail(`claimKind must be one of ${CONTESTED_CLAIM_KINDS.join(', ')}`);
  }
  if (!CONTESTED_CLAIM_RENDERINGS.includes(value.claimRendering as ContestedClaimRendering)) {
    return fail(`claimRendering must be one of ${CONTESTED_CLAIM_RENDERINGS.join(', ')}`);
  }
  if (
    !Array.isArray(value.conceptIds) ||
    value.conceptIds.length === 0 ||
    !value.conceptIds.every(nonEmptyString)
  ) {
    return fail('conceptIds must be a non-empty array of non-empty strings');
  }
  if (value.instrumentId !== undefined && !nonEmptyString(value.instrumentId)) {
    return fail('instrumentId, when present, must be a non-empty string');
  }
  if (!nonEmptyString(value.evidenceBasis)) {
    return fail('evidenceBasis must be a non-empty string');
  }
  if (!CONTEST_EFFECTS.includes(value.effect as ContestEffect)) {
    return fail(`effect must be one of ${CONTEST_EFFECTS.join(', ')}`);
  }

  const hasResolves = value.resolves !== undefined;
  const hasOutcome = value.outcome !== undefined;
  if (hasResolves !== hasOutcome) {
    return fail(
      'a resolving dispute record carries both `resolves` and `outcome`, and an opening one ' +
        'carries neither — a resolution with no outcome, or an outcome resolving nothing, ' +
        'would leave the acknowledgment [D-095] §2 requires with nothing to point at',
    );
  }
  if (hasResolves && !nonEmptyString(value.resolves)) {
    return fail('resolves must be a non-empty event id');
  }
  if (hasOutcome && value.outcome !== 'upheld' && value.outcome !== 'corrected') {
    return fail("outcome must be 'upheld' or 'corrected'");
  }

  return { success: true, data: value as unknown as DisputeLogRecord };
}
