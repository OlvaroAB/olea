/**
 * IL-D9 (`ol-2zfj.148`) — the coverage denominator's population record
 * (`docs/dev/intelligence-build/pipelines/vew.json`'s `population` step,
 * feeding the `coverage` step, VEW's row 4.1 consumer, service repo): a
 * declared counted unit, containment deduplicated, and an unknown
 * denominator withheld rather than fabricated when her declared scope is
 * absent.
 *
 * Same division of labour as every check in this directory (`./types.ts`'s
 * module doc): assembling a course's population record — resolving
 * `scp.declaredScope`, running the C7.9 containment fold over the counted
 * set, and deciding a real value or `"unknown"` — is the caller's job (a
 * harness script or a spec). This function only audits an
 * ALREADY-ASSEMBLED population record for three properties row 4.1's own
 * requirement text names: "every number carries the population it counts
 * and the source of its denominator, an unknown denominator reads as
 * unknown and never as zero."
 *
 * ## The counted unit's own grain is not this check's call
 *
 * `pipelines/vew.json`'s coverage step says plainly, in its own comment on
 * this exact row: "whether the counted unit is a declaration or an aligned
 * concept is open [IL-D9] (ol-2zfj.148); this model does not choose it."
 * No decision bead rules it as of this check (a search across closed and
 * open decisions for the counted unit, the coverage denominator or IL-D9
 * turns up nothing but this bead's own request) — so {@link CountedUnitKind}
 * is a two-member type this check accepts EITHER member of, never a
 * preference for one. What this check enforces instead is orthogonal to
 * that open choice: whichever grain a caller declares a case's counted unit
 * at, it must be NAMED on the record, never left implicit. An undeclared
 * unit on a case whose scope is present is exactly the silent-default
 * failure mode the requirement text forbids, independent of which grain
 * eventually gets ruled.
 *
 * ## Containment dedup, audited at this row's own artifact
 *
 * The container/part question here is the same shape `./size-denominator.ts`
 * (register row 1.3) already asks — a broad concept and one of its own
 * declared parts must never both land in the counted set — but audited at
 * a DIFFERENT already-assembled artifact: row 4.1's coverage population
 * record (`countedNames`, `denominatorValue`, `denominatorFrom`) rather
 * than a `GroveCourseSummary`. A caller auditing `GroveCourseSummary`
 * itself should use `checkSizeDenominatorFold` directly; this function
 * exists because row 4.1's record carries two further facts that check
 * does not: the counted-unit's declared grain, and the scope-absent state.
 * This check deliberately does not import or re-run the fold itself, for
 * the identical reason `./size-denominator.ts`'s module doc gives: a bug
 * duplicated into both the fold and its own audit would agree with itself
 * and never fail.
 *
 * ## Unknown withheld, never fabricated
 *
 * When a case's scope is absent (`scopeDeclared: false` — `scp.declaredScope`
 * returned nothing), the population record's value and its denominator
 * source must both read `"unknown"`. Any other value on an absent-scope
 * case is a fabricated count — the render step's own rule
 * ("unknown never draws as zero") pushed back one step earlier, to the
 * point where the number is first decided rather than only where it is
 * drawn.
 */
import type { CheckVerdict } from './types.js';

/**
 * The two grains `pipelines/vew.json`'s coverage step names for the counted
 * unit — a concept at its own declared grain, or a concept aligned to the
 * examiner's own declared unit. Which one is correct is `[IL-D9]`'s open
 * question (see module doc); this type exists so a caller cannot omit
 * naming a choice by accident, never to prefer one member over the other.
 */
export type CountedUnitKind = 'declaredConcept' | 'alignedConcept';

/**
 * One already-assembled coverage population record for one course, as
 * `pipelines/vew.json`'s `population`/`coverage` steps would produce it.
 * All names are opaque case material (INV-3) — never a real concept,
 * course or note name.
 */
export interface CoverageDenominatorCase {
  /** Opaque case id, never a real concept/course/note name (INV-3). */
  readonly id: string;
  /** Whether `scp.declaredScope(course)` returned a scope for this case. */
  readonly scopeDeclared: boolean;
  /**
   * Which grain this case's counted unit was declared at. Required
   * whenever `scopeDeclared` is `true` — its absence there is the defect
   * this check flags (see module doc); never inspected, and never
   * required, when `scopeDeclared` is `false`.
   */
  readonly countedUnitKind?: CountedUnitKind;
  /**
   * The broad-area concept name being tested for containment dedup, when
   * this case carries a container/part question. Omitted on a case with
   * nothing to ask (no declared parts, or scope absent).
   */
  readonly containerName?: string;
  /**
   * `containerName`'s own declared parts in this case's scope — a
   * `part-of` edge's `from` side when its `to` side is `containerName`.
   * Omitted or empty when this case carries no container/part question.
   */
  readonly partNames?: readonly string[];
  /**
   * The denominator's actual membership, as already assembled by the
   * caller. This is the one thing the containment half of this check
   * reads to decide pass/fail for a case with declared parts — it never
   * recomputes it.
   */
  readonly countedNames?: ReadonlySet<string>;
  /** The population record's `Num.value` — a real count, or `"unknown"`. */
  readonly denominatorValue: number | 'unknown';
  /** The population record's `Num.denominatorFrom` — a named source, or `"unknown"`. */
  readonly denominatorFrom: string | 'unknown';
}

export interface CoverageDenominatorMeasured {
  readonly n: number;
  /** Cases whose scope was declared present. */
  readonly withDeclaredScope: number;
  /** Of those, cases with at least one declared part — the only ones a containment question applies to. */
  readonly withDeclaredParts: number;
  /**
   * Case ids where `scopeDeclared` is `true` but `countedUnitKind` is
   * absent — the counted unit was never named, regardless of which grain
   * it would have named.
   */
  readonly undeclaredUnit: readonly string[];
  /**
   * Case ids where `containerName` AND at least one of `partNames` both
   * landed in `countedNames` — the broad area and one of its own parts
   * counted as separate peers (N+1).
   */
  readonly offending: readonly string[];
  /**
   * Case ids where `scopeDeclared` is `false` but the value or the
   * denominator source is anything other than `"unknown"` — a fabricated
   * count where the honest reading is "unknown".
   */
  readonly fabricatedWhenAbsent: readonly string[];
}

/**
 * Audit an already-assembled set of row 4.1 coverage population records for
 * IL-D9's three properties: a declared counted unit on every scope-present
 * case, containment deduplicated wherever a container/part pair is in
 * play, and "unknown" (never a fabricated value) on every scope-absent
 * case. Fails if any case exhibits any of the three defects, or if zero
 * cases were supplied (N-013: a check that ran nothing cannot report a
 * pass).
 */
export function checkCoverageDenominator(
  cases: readonly CoverageDenominatorCase[],
): CheckVerdict<CoverageDenominatorMeasured> {
  const undeclaredUnit: string[] = [];
  const offending: string[] = [];
  const fabricatedWhenAbsent: string[] = [];
  let withDeclaredScope = 0;
  let withDeclaredParts = 0;

  for (const denominatorCase of cases) {
    if (denominatorCase.scopeDeclared) {
      withDeclaredScope += 1;

      if (denominatorCase.countedUnitKind === undefined) {
        undeclaredUnit.push(denominatorCase.id);
      }

      const partNames = denominatorCase.partNames ?? [];
      if (partNames.length > 0) {
        withDeclaredParts += 1;
        const countedNames = denominatorCase.countedNames ?? new Set<string>();
        const containerCounted =
          denominatorCase.containerName !== undefined &&
          countedNames.has(denominatorCase.containerName);
        const anyPartCounted = partNames.some((part) => countedNames.has(part));
        if (containerCounted && anyPartCounted) offending.push(denominatorCase.id);
      }
    } else if (
      denominatorCase.denominatorValue !== 'unknown' ||
      denominatorCase.denominatorFrom !== 'unknown'
    ) {
      fabricatedWhenAbsent.push(denominatorCase.id);
    }
  }

  const measured: CoverageDenominatorMeasured = {
    n: cases.length,
    withDeclaredScope,
    withDeclaredParts,
    undeclaredUnit,
    offending,
    fabricatedWhenAbsent,
  };

  if (cases.length === 0) {
    return {
      ok: false,
      measured,
      detail: 'zero coverage-denominator cases supplied — nothing was checked',
    };
  }

  const defects: string[] = [];
  if (undeclaredUnit.length > 0) {
    defects.push(
      `${undeclaredUnit.length} scope-present case(s) named no counted-unit kind (${undeclaredUnit.join(', ')})`,
    );
  }
  if (offending.length > 0) {
    defects.push(
      `${offending.length} of ${withDeclaredParts} scope(s) with declared parts counted a broad area ` +
        `alongside at least one of its own declared parts (${offending.join(', ')})`,
    );
  }
  if (fabricatedWhenAbsent.length > 0) {
    defects.push(
      `${fabricatedWhenAbsent.length} scope-absent case(s) reported a fabricated count — a value or ` +
        `denominator source other than 'unknown' (${fabricatedWhenAbsent.join(', ')})`,
    );
  }

  if (defects.length > 0) {
    return {
      ok: false,
      measured,
      detail: `${defects.join('; ')} — IL-D9's denominator discipline did not hold.`,
    };
  }

  return {
    ok: true,
    measured,
    detail:
      `${withDeclaredScope} of ${cases.length} case(s) declared their counted unit, ` +
      `${withDeclaredParts} scope(s) with declared parts folded cleanly, and every scope-absent ` +
      "case read 'unknown' rather than a fabricated count.",
  };
}
