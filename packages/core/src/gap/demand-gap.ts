/**
 * The demand-grain gap (`[D-414]`, `ol-egov.141.89.48`; functional scope F4.10, "At demand grain"):
 * a concept whose material is present and supports some demands but not the one its assessment
 * evidence asks for. **Data only.** This module reads and folds facts; it words nothing. The
 * sentence's shape is the vocabulary registry's section 25 and its copy is a design question that
 * ruling leaves open, so no gap-view line reads anything defined here
 * (`demand-gap-registry-25.spec.ts` and `demand-gap-surfaces.spec.ts` pin that).
 *
 * ## The one stored fact, and what is not built here
 *
 * `[D-414]` point 1 allows one new stored field: the last sufficiency verdict with its evidence
 * fingerprint, in Olea's layer of her vault, never on the Worker (C6). {@link SufficiencyRecord} is
 * that fact and nothing else: the concept, the demand the verdict was asked at, the verdict, and the
 * fingerprint. **Its persisted shape is Class C and is not persisted by this module.** The record
 * store, its registration with privacy discovery and full delete, and the first writer (the
 * sufficiency question asked at a demand, which needs a demand per concept from the examiner-scope
 * chain) are recorded on `ol-egov.141.89.5.26`. Everything here takes the store as functions in a
 * deps bag, so the reading, the fold and the re-ask are complete and tested without one.
 *
 * ## The row exists for one reason only
 *
 * {@link readDemandGap} gives a `'material-gap'` reading only when the asked demand is KNOWN and the
 * last verdict cached at that same demand is not sufficient. The 2026-09-29 rulings keep three
 * different causes apart, and this is where the type makes them three:
 *
 *  - the assessment's scope or demand is not established (`'assessment-scope-unknown'`);
 *  - an attested operation the demand vocabulary cannot carry (`'operation-unsupported'`);
 *  - insufficient material for a known operation (`'material-gap'`).
 *
 * Neither of the first two is ever a claim about her material, so neither carries a verdict, a
 * fingerprint or a demand: nothing a sentence like "your notes are insufficient" could be built from.
 *
 * ## The fold: only a sufficient verdict at the asked demand removes the row
 *
 * {@link foldSufficiencyAnswer} is the whole of "asked again". A verdict answer replaces the record;
 * every other answer (evidence unchanged, or a re-check that could not run) hands back the SAME
 * record, so a threshold, a retrieval failure or an outage can never flip a row to sufficient and can
 * never write anything. A re-check that could not run keeps its own reason
 * ({@link RECHECK_NOT_RUN_REASONS}), which mirrors the evidence gate's outcomes (client c4cb3e4,
 * `[D-441]`): only `judge-rejected` is an insufficiency; `below-composite-threshold` and `below-band`
 * are threshold-blocked and not assessed; `no-hits` and `below-relevance-threshold` are a retrieval
 * failure; the two unavailable reasons are an outage.
 *
 * **A cached `conflicting` verdict is treated like `partial` and `insufficient`**: the row stays and
 * the arrival re-asks. The ruling names partial and insufficient; `findings/moment-f-preregistration.md`
 * G2 says the row goes "only when the verdict at the asked demand is sufficient", so a conflicting
 * verdict cannot remove it, and a row that could never be re-asked could never go. One predicate,
 * {@link holdsOpenVerdict}, if David rules otherwise.
 *
 * ## Which arrival re-asks which record
 *
 * {@link reaskOnArrival}: an arrival names the courses the new revision counts for; a record whose
 * concept resolves to one of those courses and holds an open verdict is asked again, one at a time,
 * at the demand it was asked at. "Bearing on the concept" is the course, a plain declared rule (Class
 * B, reversible). Whether anything new actually reached the judge is the ask's answer
 * (`'evidence-unchanged'`, decided by comparing the stored fingerprint with the one just computed), so
 * an arrival that adds nothing relevant costs a retrieval and no judge call. Never throws.
 *
 * **Untouched by construction (G4, `attainment-corpus-invariance.spec.ts`'s sibling
 * `demand-gap-invariance.spec.ts`).** Nothing in this module reads or writes a review-log entry, an
 * instrument or a readiness, need or vitality reading; the reading it produces never enters
 * `gapScore`, `need`, `readiness`, or `unmetDemands` (practice evidence, `./demand.ts`, a different
 * signal that this one never touches and never replaces).
 *
 * **INV-1 / section 7.1.** Pure but for the injected functions. No `obsidian`, no vault I/O, no
 * clock, no network of its own.
 */

import type { PaperDemand } from '../oracle/paper-types.js';
import type {
  AssessSupportVerdict,
  GroundingResult,
  JudgeRequestRecord,
} from '../retrieval/groundedContext.js';

// ---------------------------------------------------------------------------
// The stored fact
// ---------------------------------------------------------------------------

/**
 * The last sufficiency verdict for a concept at the demand its assessment asks for, with the
 * fingerprint of the evidence it was asked over (`[D-414]` point 1). **Proposed shape, Class C, not
 * persisted here** (module doc). Carries no wording of hers, no path and no passage: a concept key
 * (opaque), one of five demand words, a verdict word, and a digest.
 */
export interface SufficiencyRecord {
  /** The opaque join key (`ol-63e1`), never a display name. */
  readonly conceptKey: string;
  /** The demand the assessment asks for, which `verdict` was asked at. */
  readonly demand: PaperDemand;
  /** The last verdict at that demand. `sufficient` is kept so a cleared row can be told from one never asked. */
  readonly verdict: AssessSupportVerdict;
  /** {@link fingerprintJudgedEvidence} of what the judge read when it gave `verdict`. */
  readonly evidenceFingerprint: string;
}

/** A verdict that keeps the row: everything but sufficient. */
export type DemandGapVerdict = Exclude<AssessSupportVerdict, 'sufficient'>;

/** Whether the record's row is standing, and so whether an arrival may re-ask it. */
export function holdsOpenVerdict(record: SufficiencyRecord): boolean {
  return record.verdict !== 'sufficient';
}

// ---------------------------------------------------------------------------
// The reading
// ---------------------------------------------------------------------------

/**
 * What is known about the demand the assessment asks for, before any sufficiency question. Three
 * states, not one: they are three different reasons a case can be unresolved, and none of the last
 * two is ever a claim about her material.
 */
export type AskedDemand =
  | { readonly kind: 'known'; readonly demand: PaperDemand }
  /** Assessment evidence does not establish what, or whether, the assessment asks (an unresolved scope or demand). */
  | { readonly kind: 'scope-unknown' }
  /** An operation the assessment evidence attests that the demand vocabulary cannot carry (for example one broad "explain" word standing for several operations). */
  | { readonly kind: 'operation-unsupported' };

/** Why a case is unresolved, apart from insufficient material. */
export type UnresolvedDemandCause = 'assessment-scope-unknown' | 'operation-unsupported';

/**
 * Why a re-check did not produce a verdict, each its own word and each unable to flip a row.
 *
 *  - `threshold-blocked`: decided from numbers, nothing sent, not assessed (`below-composite-threshold`,
 *    `below-band`). Not an insufficiency (`[D-441]`).
 *  - `retrieval-failed`: retrieval returned nothing usable (`no-hits`, `below-relevance-threshold`,
 *    an empty package). Not a statement about her material (`[D-441]`, `[D-289]`).
 *  - `check-unavailable`: the check could not run (outage, timeout, an unusable answer).
 *  - `could-not-decide`: the judge ran and could not settle it.
 *  - `demand-not-askable`: the demand has no operation the judge's request can carry today (a
 *    printed-result reading), so the question cannot be asked at it. Answering it as a general
 *    question would let evidence for no particular demand stand in for this one (G3).
 */
export const RECHECK_NOT_RUN_REASONS = [
  'threshold-blocked',
  'retrieval-failed',
  'check-unavailable',
  'could-not-decide',
  'demand-not-askable',
] as const;
export type RecheckNotRunReason = (typeof RECHECK_NOT_RUN_REASONS)[number];

/** The last re-check that could not run, kept beside a row and apart from its verdict. */
export interface RecheckNotRun {
  readonly reason: RecheckNotRunReason;
}

/**
 * One concept's demand-grain reading, as data. Absent is not empty: a concept with no reading has
 * none of these facts, and no `GapRow` field says otherwise.
 */
export type DemandGapReading =
  | {
      readonly kind: 'material-gap';
      readonly demand: PaperDemand;
      readonly verdict: DemandGapVerdict;
      readonly evidenceFingerprint: string;
      /** Present only while the last re-check could not run; the verdict and fingerprint above are then the ones from before. */
      readonly recheck?: RecheckNotRun;
    }
  | { readonly kind: 'unresolved'; readonly cause: UnresolvedDemandCause };

export interface ReadDemandGapInput {
  readonly asked: AskedDemand;
  /** The cached verdict for this concept, if any. Read only when `asked` is known and names the same demand. */
  readonly record?: SufficiencyRecord;
  /** The last re-check that could not run, if any. Attached only to a reading that has a row. */
  readonly recheck?: RecheckNotRun;
}

/** Pure. See the module doc: the row exists only for a known demand whose last verdict, at that demand, is not sufficient. */
export function readDemandGap(input: ReadDemandGapInput): DemandGapReading | undefined {
  const { asked, record, recheck } = input;
  switch (asked.kind) {
    case 'scope-unknown':
      return { kind: 'unresolved', cause: 'assessment-scope-unknown' };
    case 'operation-unsupported':
      return { kind: 'unresolved', cause: 'operation-unsupported' };
    case 'known': {
      if (record === undefined || record.demand !== asked.demand) return undefined;
      if (record.verdict === 'sufficient') return undefined;
      return {
        kind: 'material-gap',
        demand: asked.demand,
        verdict: record.verdict,
        evidenceFingerprint: record.evidenceFingerprint,
        ...(recheck !== undefined ? { recheck } : {}),
      };
    }
  }
}

// ---------------------------------------------------------------------------
// The fold
// ---------------------------------------------------------------------------

/**
 * What asking the sufficiency question again produced. Exactly one of four, and only the first
 * carries a verdict.
 */
export type SufficiencyAnswer =
  | {
      readonly kind: 'verdict';
      readonly verdict: AssessSupportVerdict;
      /** {@link fingerprintJudgedEvidence} of the evidence this verdict was asked over. */
      readonly evidenceFingerprint: string;
    }
  /** The evidence that would reach the judge is the evidence the stored verdict was asked over: nothing new bears on it, and the judge was not asked. */
  | { readonly kind: 'evidence-unchanged' }
  | { readonly kind: 'not-run'; readonly reason: RecheckNotRunReason };

/** What the fold did to the row. */
export type RecheckOutcome =
  /** A sufficient verdict at the asked demand: the row goes. */
  | { readonly outcome: 'cleared' }
  /** Asked again and still not sufficient: the row stays with its verdict and fingerprint updated. */
  | { readonly outcome: 'stays'; readonly verdict: DemandGapVerdict }
  | { readonly outcome: 'evidence-unchanged' }
  | { readonly outcome: 'not-run'; readonly reason: RecheckNotRunReason };

export interface FoldedSufficiency {
  /** The record after the answer: the SAME object when nothing changed. */
  readonly record: SufficiencyRecord;
  readonly outcome: RecheckOutcome;
}

/**
 * Pure. Folds one answer into the record it re-asked. Only a `'verdict'` answer can change the
 * record; every other answer returns the very same object, so no threshold, no retrieval failure and
 * no outage can flip a row to sufficient, and callers can skip the write on `result.record ===
 * record`.
 */
export function foldSufficiencyAnswer(
  record: SufficiencyRecord,
  answer: SufficiencyAnswer,
): FoldedSufficiency {
  switch (answer.kind) {
    case 'evidence-unchanged':
      return { record, outcome: { outcome: 'evidence-unchanged' } };
    case 'not-run':
      return { record, outcome: { outcome: 'not-run', reason: answer.reason } };
    case 'verdict': {
      const outcome: RecheckOutcome =
        answer.verdict === 'sufficient'
          ? { outcome: 'cleared' }
          : { outcome: 'stays', verdict: answer.verdict };
      if (
        answer.verdict === record.verdict &&
        answer.evidenceFingerprint === record.evidenceFingerprint
      ) {
        return { record, outcome };
      }
      return {
        record: {
          ...record,
          verdict: answer.verdict,
          evidenceFingerprint: answer.evidenceFingerprint,
        },
        outcome,
      };
    }
  }
}

/**
 * Pure. The evidence gate's result (`resolveGroundedContext`'s `GroundingResult`) as a sufficiency
 * answer, keeping the gate's outcomes apart (client c4cb3e4, `[D-441]`, `[D-442]`):
 *
 *  - `grounded` is a sufficient verdict, and `judge-rejected` is an insufficient one: the only two
 *    outcomes that follow a judge reading the passages. Each needs `judgedFingerprint`, the
 *    fingerprint of what the judge read; without one the verdict cannot be recorded against its
 *    evidence, so it is a check that could not be completed.
 *  - `below-composite-threshold` and `below-band` are threshold-blocked: not assessed.
 *  - `no-hits` and `below-relevance-threshold` are a retrieval failure.
 *  - `composite-check-unavailable` and `judge-unavailable` are an outage.
 *
 * A refusal reason this function does not know is an outage too, never an insufficiency: an
 * insufficiency is only ever something the judge said.
 */
export function sufficiencyAnswerFromGrounding(
  result: GroundingResult,
  judgedFingerprint: string | undefined,
): SufficiencyAnswer {
  if (result.status === 'grounded') {
    return judgedFingerprint === undefined
      ? { kind: 'not-run', reason: 'check-unavailable' }
      : { kind: 'verdict', verdict: 'sufficient', evidenceFingerprint: judgedFingerprint };
  }
  switch (result.reason) {
    case 'judge-rejected':
      return judgedFingerprint === undefined
        ? { kind: 'not-run', reason: 'check-unavailable' }
        : { kind: 'verdict', verdict: 'insufficient', evidenceFingerprint: judgedFingerprint };
    case 'below-composite-threshold':
    case 'below-band':
      return { kind: 'not-run', reason: 'threshold-blocked' };
    case 'no-hits':
    case 'below-relevance-threshold':
      return { kind: 'not-run', reason: 'retrieval-failed' };
    case 'composite-check-unavailable':
    case 'judge-unavailable':
      return { kind: 'not-run', reason: 'check-unavailable' };
    default:
      return { kind: 'not-run', reason: 'check-unavailable' };
  }
}

// ---------------------------------------------------------------------------
// The evidence fingerprint
// ---------------------------------------------------------------------------

/**
 * One digest over exactly what the sufficiency judge was sent: which passages, in what order
 * (`JudgeRequestRecord.refs`), and the text they carried (`GroundingJudgeRequest.context`). The
 * re-ask compares this with the stored value: equal means the same evidence would be judged again,
 * different means something bearing on the concept moved.
 *
 * **A target-shape default for retroactive review**, one of the two shapes `evd.md` section 11 leaves
 * open ("a single hash over the ordered passage digests and revisions"): it hashes the judged context
 * as a whole rather than per passage, because the judge seam carries the joined context and not the
 * passages. Whoever writes the first verdict must compute it the same way (this function), or the
 * first re-ask compares two different things. The `hash` is injected (production passes `hashText`)
 * exactly as `buildEvidencePackage`'s is. Returns a digest only: no path and none of her text.
 */
export async function fingerprintJudgedEvidence(
  evidence: {
    readonly refs: JudgeRequestRecord['refs'];
    readonly context: string;
  },
  hash: (text: string) => Promise<string>,
): Promise<string> {
  const refs = evidence.refs.map((ref) => [ref.path, ref.blockIndex] as const);
  const contextDigest = await hash(evidence.context);
  return hash(JSON.stringify({ v: 1, refs, context: contextDigest }));
}

// ---------------------------------------------------------------------------
// The re-ask on arrival
// ---------------------------------------------------------------------------

/** A concept as the re-ask needs to ask about it. */
export interface ReaskConcept {
  readonly conceptKey: string;
  /** The retrieval query, as the drafting path uses it. */
  readonly conceptName: string;
  readonly course: string;
}

export interface ReaskRequest {
  readonly concept: ReaskConcept;
  /** The demand the stored verdict was asked at, and so the demand to ask again at. */
  readonly demand: PaperDemand;
  /** The fingerprint the stored verdict was asked over; an ask that finds the same evidence answers `'evidence-unchanged'` without a judge call. */
  readonly previousFingerprint: string;
}

/**
 * What an arrival needs. A bag of functions rather than a store type: the record store is not built
 * here (module doc), and `ask` is the one place a production caller reaches the service, through the
 * evidence gate's existing path.
 */
export interface ReaskOnArrivalDeps {
  readonly listRecords: () => Promise<readonly SufficiencyRecord[]>;
  readonly saveRecord: (record: SufficiencyRecord) => Promise<void>;
  /** `undefined` for a concept that no longer resolves (removed, or never known). */
  readonly resolveConcept: (
    conceptKey: string,
  ) => ReaskConcept | undefined | Promise<ReaskConcept | undefined>;
  readonly ask: (request: ReaskRequest) => Promise<SufficiencyAnswer>;
}

export interface ReaskArrival {
  /** The courses the arriving revision counts for. */
  readonly courses: readonly string[];
}

export type ReaskReport = {
  readonly conceptKey: string;
  readonly demand: PaperDemand;
} & (
  | RecheckOutcome
  /** The verdict was reached and could not be stored: the row is as it was. */
  | { readonly outcome: 'save-failed' }
  /** The concept no longer resolves: skipped, never asked. */
  | { readonly outcome: 'concept-unresolved' }
);

/**
 * An arrival re-asks the sufficiency question, at the same demand, for each record that holds an
 * open verdict and whose concept belongs to one of the arriving courses. One at a time, in the order
 * the records were listed. **Never throws**: a record store that cannot be listed is no re-check, an
 * ask that throws is an outage for that record alone (`check-unavailable`, the record untouched), and
 * a save that throws leaves the record as it was. A record is written only when the fold changed it.
 */
export async function reaskOnArrival(
  deps: ReaskOnArrivalDeps,
  arrival: ReaskArrival,
): Promise<readonly ReaskReport[]> {
  if (arrival.courses.length === 0) return [];
  let records: readonly SufficiencyRecord[];
  try {
    records = await deps.listRecords();
  } catch {
    return [];
  }

  const reports: ReaskReport[] = [];
  for (const record of records) {
    if (!holdsOpenVerdict(record)) continue;
    const identity = { conceptKey: record.conceptKey, demand: record.demand };

    let concept: ReaskConcept | undefined;
    try {
      concept = await deps.resolveConcept(record.conceptKey);
    } catch {
      concept = undefined;
    }
    if (concept === undefined) {
      reports.push({ ...identity, outcome: 'concept-unresolved' });
      continue;
    }
    if (!arrival.courses.includes(concept.course)) continue;

    let answer: SufficiencyAnswer;
    try {
      answer = await deps.ask({
        concept,
        demand: record.demand,
        previousFingerprint: record.evidenceFingerprint,
      });
    } catch {
      answer = { kind: 'not-run', reason: 'check-unavailable' };
    }

    const folded = foldSufficiencyAnswer(record, answer);
    if (folded.record !== record) {
      try {
        await deps.saveRecord(folded.record);
      } catch {
        reports.push({ ...identity, outcome: 'save-failed' });
        continue;
      }
    }
    reports.push({ ...identity, ...folded.outcome });
  }
  return reports;
}
