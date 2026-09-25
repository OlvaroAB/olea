/**
 * The Writing stage contract (`ol-egov.141.89.20`; design `[D-300]`'s
 * review, envelope in the intelligence build's pipelines README, "Shared
 * stage contracts"): a draft, then the checks the step names, then a
 * receipt.
 *
 * **The receipt lists every check by what became of it**: passed, repaired
 * (failed, fixed by the step's repair, passed again), failed, inconclusive
 * (ran and could not tell), and not run. A check the step names but could
 * not run is listed as not run, never left out, so an absent check is never
 * mistaken for a passed one.
 *
 * **A code-only receipt never implies semantic correctness.** A code check
 * tests a property of the draft's form (a shape, a count, that a cited
 * passage exists); it cannot tell whether the draft is right. So the receipt
 * never says "correct" or "sound". Its `disposition` says only what the
 * checks allowed, and its `assurance` says `code-checks-only` unless a check
 * of kind `semantic` passed. Even then it names a check, not correctness.
 *
 * **A draft that fails its checks never reaches her as if it were sound.** A
 * failed check makes the outcome `refused`, and a refused outcome carries the
 * receipt only, not the draft, so there is no draft on it to deliver by
 * mistake. A draft with a check inconclusive or not run is `written` with
 * disposition `unverified`: the step's own policy decides whether it may
 * reach her, and if so it must be labelled as unchecked.
 *
 * **Never content (D-005).** A check's `note` is content-free: a count or a
 * structural reason, never text from the draft or her material.
 */

import { isNonEmptyString, isRecord } from './guards.js';
import {
  type StageProvenance,
  type StageUnavailable,
  stageProvenanceProblems,
  stageUnavailableProblems,
} from './provenance.js';

/** `code`: a deterministic check of the draft's form. `semantic`: a check of its meaning, by a model or a rater who is not the writer. */
export type WritingCheckKind = 'code' | 'semantic';

export type WritingCheckStatus = 'passed' | 'repaired' | 'failed' | 'inconclusive' | 'not-run';

export const WRITING_CHECK_STATUSES: readonly WritingCheckStatus[] = [
  'passed',
  'repaired',
  'failed',
  'inconclusive',
  'not-run',
];

/** One check as the receipt lists it. `check` is the step's stable name for it. */
export interface WritingCheckEntry {
  readonly check: string;
  readonly kind: WritingCheckKind;
  /** Content-free: a count or a structural reason, never draft text. */
  readonly note?: string;
}

/** One check's result, as a step hands it to `buildWritingReceipt`. */
export interface WritingCheckResult extends WritingCheckEntry {
  readonly status: WritingCheckStatus;
}

/**
 * What the checks allowed, and no more.
 *
 * - `checks-passed`: every check ran and passed; at least one check ran.
 * - `repaired`: every check ran and passed, some only after the step's repair.
 * - `unverified`: no check failed, but at least one was inconclusive or not
 *   run, or there were no checks at all. Not refused, and not checked either.
 * - `refused`: at least one check failed. The draft does not reach her.
 */
export type WritingDisposition = 'checks-passed' | 'repaired' | 'unverified' | 'refused';

/** `code-checks-only` unless a `semantic` check passed or was repaired. Neither value states correctness. */
export type WritingAssurance = 'code-checks-only' | 'includes-semantic-checks';

export interface WritingReceipt {
  readonly passed: readonly WritingCheckEntry[];
  readonly repaired: readonly WritingCheckEntry[];
  readonly failed: readonly WritingCheckEntry[];
  readonly inconclusive: readonly WritingCheckEntry[];
  readonly notRun: readonly WritingCheckEntry[];
  readonly disposition: WritingDisposition;
  readonly assurance: WritingAssurance;
  /** Who wrote the draft, from what: task, seat, prompt and model stamp, evidence digests. */
  readonly provenance: StageProvenance;
}

function entryOf(result: WritingCheckResult): WritingCheckEntry {
  return {
    check: result.check,
    kind: result.kind,
    ...(result.note !== undefined ? { note: result.note } : {}),
  };
}

function dispositionOf(
  lists: Pick<WritingReceipt, 'passed' | 'repaired' | 'failed' | 'inconclusive' | 'notRun'>,
): WritingDisposition {
  if (lists.failed.length > 0) return 'refused';
  if (lists.inconclusive.length > 0 || lists.notRun.length > 0) return 'unverified';
  if (lists.passed.length === 0 && lists.repaired.length === 0) return 'unverified';
  if (lists.repaired.length > 0) return 'repaired';
  return 'checks-passed';
}

/**
 * The receipt for one draft's check results. Pure. Each result lands in the
 * list its status names, in the order given; `disposition` and `assurance`
 * are derived from the lists, never supplied, so they cannot disagree with
 * them. A check named twice is a caller defect and throws.
 */
export function buildWritingReceipt(
  results: readonly WritingCheckResult[],
  provenance: StageProvenance,
): WritingReceipt {
  const seen = new Set<string>();
  const passed: WritingCheckEntry[] = [];
  const repaired: WritingCheckEntry[] = [];
  const failed: WritingCheckEntry[] = [];
  const inconclusive: WritingCheckEntry[] = [];
  const notRun: WritingCheckEntry[] = [];
  for (const result of results) {
    if (seen.has(result.check)) {
      throw new Error(`buildWritingReceipt: check "${result.check}" is listed twice`);
    }
    seen.add(result.check);
    const entry = entryOf(result);
    switch (result.status) {
      case 'passed':
        passed.push(entry);
        break;
      case 'repaired':
        repaired.push(entry);
        break;
      case 'failed':
        failed.push(entry);
        break;
      case 'inconclusive':
        inconclusive.push(entry);
        break;
      case 'not-run':
        notRun.push(entry);
        break;
    }
  }
  const lists = { passed, repaired, failed, inconclusive, notRun };
  const semanticHeld = [...passed, ...repaired].some((entry) => entry.kind === 'semantic');
  return {
    ...lists,
    disposition: dispositionOf(lists),
    assurance: semanticHeld ? 'includes-semantic-checks' : 'code-checks-only',
    provenance,
  };
}

/** Why a writing step wrote nothing, when the reason is its input rather than the run. */
export type WritingDeclineBasis =
  /** There was nothing to write from (an empty input, nothing citable), so nothing was written (INV-5). */
  | 'nothing-to-write-from'
  /** A step this one depends on refused on its own grounds (for example, the evidence was judged not enough). */
  | 'upstream-refused'
  /** The producer ran and declined to write (for example, a model returning no artefact as its refusal). */
  | 'producer-declined';

export const WRITING_DECLINE_BASES: readonly WritingDeclineBasis[] = [
  'nothing-to-write-from',
  'upstream-refused',
  'producer-declined',
];

/** A draft and its receipt. The receipt's disposition is never `refused` on this arm. */
export interface WritingWritten<D> {
  readonly kind: 'written';
  readonly draft: D;
  readonly receipt: WritingReceipt;
}

/** A draft failed its checks. The receipt says which; the draft is not carried, so it cannot be delivered. */
export interface WritingRefused {
  readonly kind: 'refused';
  readonly receipt: WritingReceipt;
}

/** Nothing was written, because of the input, not the run. */
export interface WritingDeclined {
  readonly kind: 'declined';
  readonly basis: WritingDeclineBasis;
  readonly provenance: StageProvenance;
}

/** The operational-failure arm, shared with the Decision contract. */
export type WritingUnavailable = StageUnavailable;

/** One writing step's result. */
export type WritingOutcome<D> =
  | WritingWritten<D>
  | WritingRefused
  | WritingDeclined
  | WritingUnavailable;

/**
 * The outcome for a draft and its check results: `refused` when any check
 * failed, `written` otherwise. The one place the "failed draft never
 * carried" rule is applied, so every adapter gets it the same way.
 */
export function writingFromChecks<D>(
  draft: D,
  results: readonly WritingCheckResult[],
  provenance: StageProvenance,
): WritingWritten<D> | WritingRefused {
  const receipt = buildWritingReceipt(results, provenance);
  if (receipt.disposition === 'refused') return { kind: 'refused', receipt };
  return { kind: 'written', draft, receipt };
}

/**
 * Whether a receipt allows its draft to be shown as having passed its
 * checks: `checks-passed` or `repaired`. An `unverified` draft may still be
 * shown where the step's policy allows it, but only labelled as unchecked.
 */
export function passedItsChecks(receipt: WritingReceipt): boolean {
  return receipt.disposition === 'checks-passed' || receipt.disposition === 'repaired';
}

const DISPOSITIONS: ReadonlySet<string> = new Set<WritingDisposition>([
  'checks-passed',
  'repaired',
  'unverified',
  'refused',
]);
const CHECK_KINDS: ReadonlySet<string> = new Set<WritingCheckKind>(['code', 'semantic']);
const DECLINE_BASES: ReadonlySet<string> = new Set(WRITING_DECLINE_BASES);
const RECEIPT_LISTS = ['passed', 'repaired', 'failed', 'inconclusive', 'notRun'] as const;

/**
 * Every way `value` fails to be a `WritingReceipt`, as content-free
 * messages; empty when it is one. Checks that each list holds well-formed
 * entries, that no check appears twice, and that `disposition` and
 * `assurance` are the ones the lists imply.
 */
export function writingReceiptProblems(value: unknown, at = 'receipt'): string[] {
  if (!isRecord(value)) return [`${at} is not an object`];
  const problems: string[] = [];
  const seen = new Set<string>();
  const lists: Record<(typeof RECEIPT_LISTS)[number], WritingCheckEntry[]> = {
    passed: [],
    repaired: [],
    failed: [],
    inconclusive: [],
    notRun: [],
  };
  for (const name of RECEIPT_LISTS) {
    const list = value[name];
    if (!Array.isArray(list)) {
      problems.push(`${at}.${name} is not a list`);
      continue;
    }
    list.forEach((entry: unknown, index) => {
      const where = `${at}.${name}[${index}]`;
      if (!isRecord(entry) || !isNonEmptyString(entry.check)) {
        problems.push(`${where} has no check name`);
        return;
      }
      if (typeof entry.kind !== 'string' || !CHECK_KINDS.has(entry.kind)) {
        problems.push(`${where}.kind is not code or semantic`);
      }
      if (entry.note !== undefined && typeof entry.note !== 'string') {
        problems.push(`${where}.note is present but not a string`);
      }
      if (seen.has(entry.check)) problems.push(`${where} names a check listed elsewhere`);
      seen.add(entry.check);
      lists[name].push(entry as unknown as WritingCheckEntry);
    });
  }
  if (typeof value.disposition !== 'string' || !DISPOSITIONS.has(value.disposition)) {
    problems.push(`${at}.disposition is not a known disposition`);
  } else if (value.disposition !== dispositionOf(lists)) {
    problems.push(`${at}.disposition does not match its check lists`);
  }
  const semanticHeld = [...lists.passed, ...lists.repaired].some((e) => e.kind === 'semantic');
  const expectedAssurance = semanticHeld ? 'includes-semantic-checks' : 'code-checks-only';
  if (value.assurance !== expectedAssurance) {
    problems.push(`${at}.assurance does not match its check lists`);
  }
  problems.push(...stageProvenanceProblems(value.provenance, `${at}.provenance`));
  return problems;
}

/**
 * Every way `value` fails to be a `WritingOutcome`, as content-free
 * messages; empty when it is one. The contract test for a writing step's
 * result at a producer-consumer boundary. Envelope only: the draft belongs
 * to the step.
 */
export function writingEnvelopeProblems(value: unknown): string[] {
  if (!isRecord(value)) return ['outcome is not an object'];
  switch (value.kind) {
    case 'written': {
      const problems = writingReceiptProblems(value.receipt, 'outcome.receipt');
      if (!('draft' in value)) problems.push('outcome.draft is missing');
      if (isRecord(value.receipt) && value.receipt.disposition === 'refused') {
        problems.push('outcome is written but its receipt is refused');
      }
      return problems;
    }
    case 'refused': {
      const problems = writingReceiptProblems(value.receipt, 'outcome.receipt');
      if ('draft' in value) problems.push('outcome is refused but still carries a draft');
      if (isRecord(value.receipt) && value.receipt.disposition !== 'refused') {
        problems.push('outcome is refused but its receipt is not');
      }
      return problems;
    }
    case 'declined': {
      const problems: string[] = [];
      if (typeof value.basis !== 'string' || !DECLINE_BASES.has(value.basis)) {
        problems.push('outcome.basis is not a known decline basis');
      }
      problems.push(...stageProvenanceProblems(value.provenance, 'outcome.provenance'));
      return problems;
    }
    case 'unavailable':
      return stageUnavailableProblems(value, 'outcome');
    default:
      return ['outcome.kind is not written, refused, declined or unavailable'];
  }
}
