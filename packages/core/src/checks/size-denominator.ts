/**
 * CHK-1 (`ol-3ux7.1`, foundation item 34) — component register row 1.3's
 * health check: **"a broad area plus N of its parts must never sum to N+1
 * independent items against the examiner's denominator"** (`docs/
 * Olea_component_register.md` row 1.3, C7.9; `ol-3ux7.37`, discovered from
 * `ol-3ux7.1`).
 *
 * Row 1.3 names two consumers of concept size (`../concept/size.js`'s own
 * module doc): honest scope counting (F8.1/F8.3) and session composition
 * (F2.17). This check is scope counting's half — the C7.9 fold
 * `../scope/coverage.js`'s `containerNamesToFold` already implements and
 * `../scope/grove.js` already applies before assembling a course's
 * denominator (`ol-5phn`, `ol-a83u`).
 *
 * Same division of labour as every check in this directory (`./types.ts`'s
 * module doc): assembling a scope's actual denominator membership —
 * declared names, `part-of` edges, and whatever fold logic a caller did or
 * did not run over them — is the caller's (harness or spec's) job. This
 * function only answers a yes/no question about the ALREADY-ASSEMBLED
 * result: for every declared broad area with at least one declared part in
 * the same scope, did the area and one of its own parts BOTH land in the
 * set actually counted?
 *
 * **This check deliberately does not import or re-run `containerNamesToFold`
 * itself.** Calling the real fold to build a case's `countedNames` — and,
 * for a regression fixture, skipping it — is the spec/harness's job, the
 * same "port of the fixture, not the algorithm" split
 * `./floor-load-linearity.ts` uses. Duplicating the fold's own logic here
 * would let a bug in both copies agree with itself and never fail; this
 * check instead audits whatever `countedNames` a real pipeline produced,
 * which is the only way it can catch a fold that silently stopped running.
 */
import type { CheckVerdict } from './types.js';

/**
 * One scope's denominator-fold observation: a broad-area concept name, the
 * names of its own declared parts in that scope (the `from` side of a
 * `part-of` edge whose `to` is `containerName`), and the denominator
 * membership the caller actually assembled for the scope. All names are
 * opaque case material (INV-3) — never a real concept, course or note name.
 */
export interface SizeDenominatorScopeCase {
  /** Opaque case id, never a real concept/course/note name (INV-3). */
  readonly id: string;
  /** The broad-area concept name being tested for this scope. */
  readonly containerName: string;
  /**
   * `containerName`'s own declared parts in this scope — a `part-of` edge's
   * `from` side, when its `to` side is `containerName`. Empty when this
   * concept has no declared parts in the scope under test — such a case
   * carries no fold question to ask, and is counted in `n` but never in
   * `offending`.
   */
  readonly partNames: readonly string[];
  /**
   * The denominator's actual membership for this scope, as already
   * assembled by the caller (e.g. `GroveCourseSummary`'s `cells` plus
   * `materialGaps` names, or `containerNamesToFold`'s untouched
   * `declaredNames` when a fixture deliberately skips the fold). This is
   * the one thing this check reads to decide pass/fail — it never
   * recomputes it.
   */
  readonly countedNames: ReadonlySet<string>;
}

export interface SizeDenominatorMeasured {
  readonly n: number;
  /** Cases with at least one declared part — the only ones a fold question applies to. */
  readonly withDeclaredParts: number;
  /**
   * Case ids where `containerName` AND at least one of `partNames` both
   * landed in `countedNames` — the broad area and one of its own parts
   * counted as separate peers (N+1), meaning the C7.9 fold did not run, or
   * ran and still let this pair through.
   */
  readonly offending: readonly string[];
}

/**
 * One scope-observation per case in, a verdict out. Fails on any case whose
 * broad area and at least one of its own declared parts both landed in the
 * counted set, or if zero cases were supplied (N-013: a check that ran
 * nothing cannot report a pass). A case with no declared parts never fails
 * on its own — there is no container/part pair yet to ask the fold question
 * about — but is still counted in `n`, never silently dropped.
 */
export function checkSizeDenominatorFold(
  cases: readonly SizeDenominatorScopeCase[],
): CheckVerdict<SizeDenominatorMeasured> {
  const offending: string[] = [];
  let withDeclaredParts = 0;

  for (const scopeCase of cases) {
    if (scopeCase.partNames.length === 0) continue;
    withDeclaredParts += 1;
    const containerCounted = scopeCase.countedNames.has(scopeCase.containerName);
    const anyPartCounted = scopeCase.partNames.some((part) => scopeCase.countedNames.has(part));
    if (containerCounted && anyPartCounted) offending.push(scopeCase.id);
  }

  const measured: SizeDenominatorMeasured = {
    n: cases.length,
    withDeclaredParts,
    offending,
  };

  if (cases.length === 0) {
    return { ok: false, measured, detail: 'zero scope cases supplied — nothing was checked' };
  }
  if (offending.length > 0) {
    return {
      ok: false,
      measured,
      detail:
        `${offending.length} of ${withDeclaredParts} scope(s) with declared parts counted a ` +
        `broad area alongside at least one of its own declared parts — the C7.9 part-of fold ` +
        `did not hold: ${offending.join(', ')}`,
    };
  }
  return {
    ok: true,
    measured,
    detail:
      `every scope with declared parts (${withDeclaredParts} of ${cases.length} case(s)) folded ` +
      'its broad area out of the denominator whenever one of its own parts was also counted',
  };
}
