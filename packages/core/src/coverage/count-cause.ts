/**
 * Count causes and receipts over the population record (`ol-egov.141.89.11.4`;
 * the chain spec's section 2.1, `[D-184]`, `[D-272]`, `[D-309]`; case classes
 * C15, C19).
 *
 * The population (`./population.ts`) is pure and in-memory, recomputed fresh
 * on every read — nothing here diffs stored state. A caller replays one
 * course's own sequence of population reads (a document registered,
 * reclassified, revised, or re-read) and this module answers, per adjacent
 * pair: did the counted-unit set move, and if so, was the move named and
 * receipted?
 *
 * **A cause and a receipt are not the same claim.** A cause says WHY a step
 * may differ from the one before it — one of the four kinds section 2.1
 * names. This module never checks WHICH kind is named, only that one was —
 * the same division `checks/scope-count-cause.ts` already draws for the
 * grove's own count, and for the identical reason: a shrink from a
 * reclassification and a growth from a newly registered source are the same
 * event structurally (section 2.1's "registered, reclassified, revised or
 * re-read" is one list, not two).
 *
 * A receipt says WHAT changed — C19's own words: "the receipt names the
 * document and the units that left or returned." This module computes that
 * receipt itself, from the two population reads' own declared-unit lists, so
 * a receipt is never something a caller merely asserts alongside a silent
 * move: {@link countReceiptsBetween} derives it from the same
 * `DeclaredUnitCoverage.documentId` and `declarationId` fields `./population.ts`
 * already carries.
 *
 * **The `[D-381]` re-read case (section 7's open question) is left open on
 * purpose.** Whether a re-read with no revision is a named cause under
 * `[D-184]`, or held until the next revision, is unruled (`[D-385]`: nothing
 * waits on it). This module admits `'re-read'` as one of the four named
 * kinds — consistent with section 2.1's own list — without taking a side: it
 * asks only whether a cause was named, exactly as `checks/scope-count-cause.ts`
 * asks only whether one was, never which.
 */

import type { CoursePopulation, DeclaredUnitCoverage } from './types.js';

/**
 * The four events section 2.1 recognises as a legitimate cause for the
 * counted-unit set to move. Present only to keep a caller from attaching some
 * third, unrecognised kind by accident — the check below never inspects
 * which of the four a given step names (see the module doc).
 */
export type CountCauseKind = 'registered' | 'reclassified' | 'revised' | 're-read';

/** The named cause a caller attaches to one population read, if any. */
export interface CountCauseEvent {
  readonly kind: CountCauseKind;
}

/**
 * One document's receipt for a transition between two population reads: the
 * declared units (by `declarationId`) that were present before and are gone,
 * and those absent before and now present. A unit id kept across both reads
 * — even across a revision that replaced others — is named on neither side
 * (C19: "the receipt names ... the units that left or returned", not every
 * unit that merely persisted).
 */
export interface CountReceiptLine {
  readonly documentId: string;
  readonly unitsLeft: readonly string[];
  readonly unitsReturned: readonly string[];
}

/** One already-computed population read in a replayed sequence, plus its named cause, if any. */
export interface PopulationCountStep {
  /** Opaque step id (INV-3) — never a real course, source or concept name. */
  readonly id: string;
  readonly population: CoursePopulation;
  readonly cause?: CountCauseEvent;
}

/** Fewer reads than this cannot show a transition at all. */
export const COUNT_CAUSE_MIN_STEPS = 2;

export interface CountCauseMeasured {
  /** `steps.length`, kept even when the check is rejected below the floor. */
  readonly n: number;
  /** `n - 1` once past the floor, `0` otherwise. */
  readonly transitions: number;
  /** Transitions where at least one document's receipt named a left or returned unit. */
  readonly movedTransitions: number;
  /** Step ids where the counted-unit set moved with `cause` absent — the defect this check exists to catch. */
  readonly silentMoves: readonly string[];
  /** Every moved step's receipt, by step id, one line per document whose units changed on that read. */
  readonly receiptsByStep: ReadonlyMap<string, readonly CountReceiptLine[]>;
}

export interface CountCauseVerdict {
  readonly ok: boolean;
  readonly measured: CountCauseMeasured;
  readonly detail: string;
}

function byString(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/**
 * The receipt between two declared-unit lists (`CoursePopulation.units`, in
 * `declarationId` order): which document's units left, which returned. A
 * document with no change contributes no line. Pure — the same two reads
 * always produce the same receipt, in the same order (INV-1).
 */
export function countReceiptsBetween(
  before: readonly DeclaredUnitCoverage[],
  after: readonly DeclaredUnitCoverage[],
): readonly CountReceiptLine[] {
  const beforeById = new Map(before.map((u) => [u.declarationId, u]));
  const afterById = new Map(after.map((u) => [u.declarationId, u]));
  const byDocument = new Map<string, { left: string[]; returned: string[] }>();

  const entryFor = (documentId: string): { left: string[]; returned: string[] } => {
    const existing = byDocument.get(documentId);
    if (existing !== undefined) return existing;
    const fresh = { left: [] as string[], returned: [] as string[] };
    byDocument.set(documentId, fresh);
    return fresh;
  };

  for (const [id, unit] of beforeById) {
    if (!afterById.has(id)) entryFor(unit.documentId).left.push(id);
  }
  for (const [id, unit] of afterById) {
    if (!beforeById.has(id)) entryFor(unit.documentId).returned.push(id);
  }

  return [...byDocument.entries()]
    .sort(([a], [b]) => byString(a, b))
    .map(([documentId, { left, returned }]) => ({
      documentId,
      unitsLeft: left.sort(byString),
      unitsReturned: returned.sort(byString),
    }));
}

function rejected(n: number, detail: string): CountCauseVerdict {
  return {
    ok: false,
    measured: {
      n,
      transitions: 0,
      movedTransitions: 0,
      silentMoves: [],
      receiptsByStep: new Map(),
    },
    detail,
  };
}

/**
 * Replay one course's population-read series (section 2.1's "a count
 * changes only with a named cause") and fail on any adjacent pair whose
 * receipt names a left or returned unit with no cause attached to the later
 * read. Every moved transition's receipt is reported regardless of verdict,
 * so a caller can see WHAT moved even when the check fails on WHETHER it was
 * named (C19 never gates on C15 passing).
 */
export function checkCountCauseAttribution(
  steps: readonly PopulationCountStep[],
): CountCauseVerdict {
  if (steps.length < COUNT_CAUSE_MIN_STEPS) {
    return rejected(
      steps.length,
      `checkCountCauseAttribution: need at least ${COUNT_CAUSE_MIN_STEPS} reads to test a ` +
        `transition, got ${steps.length} — a check that ran nothing cannot report a pass.`,
    );
  }

  const silentMoves: string[] = [];
  const receiptsByStep = new Map<string, readonly CountReceiptLine[]>();
  let movedTransitions = 0;

  for (let i = 1; i < steps.length; i += 1) {
    const prev = steps[i - 1];
    const cur = steps[i];
    if (prev === undefined || cur === undefined) continue;

    const receipts = countReceiptsBetween(prev.population.units, cur.population.units);
    const moved = receipts.some((r) => r.unitsLeft.length > 0 || r.unitsReturned.length > 0);
    if (!moved) continue;

    movedTransitions += 1;
    receiptsByStep.set(cur.id, receipts);
    if (cur.cause === undefined) silentMoves.push(cur.id);
  }

  const measured: CountCauseMeasured = {
    n: steps.length,
    transitions: steps.length - 1,
    movedTransitions,
    silentMoves,
    receiptsByStep,
  };

  if (silentMoves.length > 0) {
    return {
      ok: false,
      measured,
      detail:
        `${silentMoves.length} of ${measured.transitions} read(s) moved the counted-unit set with ` +
        `no named cause attached (${silentMoves.join(', ')}) — a document registered, reclassified, ` +
        'revised or re-read must always be named; silence is the defect.',
    };
  }

  return {
    ok: true,
    measured,
    detail:
      `every count change across ${measured.transitions} read(s) — ${movedTransitions} moved — ` +
      'carried a named cause and a receipt naming the document and its units.',
  };
}
