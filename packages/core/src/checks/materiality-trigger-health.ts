/**
 * `CHK-2` (`ol-tqy3`) — component register row 1.4's health check.
 *
 * Row 1.4 ("Notice when material says something new") names it verbatim:
 * **"a formatting-only edit produces zero triggers; a genuinely new
 * statement always triggers."** Same shape as every check in this directory
 * (`types.ts`'s `CheckVerdict`): pure, takes the ALREADY-COMPUTED output of
 * the trigger (`packages/plugin/src/ingestion/materiality/trigger.ts`'s
 * `evaluateMaterialityGate`, composed with a judge in that package's
 * `wiring.ts`), and answers a yes/no question about a batch of it. This
 * function does no I/O, calls no model, and reads no clock — a caller (a
 * harness script, a test, or eventually a production sweep over recent
 * trigger history) supplies the cases.
 *
 * Content-free by construction (INV-3): a case is named by an opaque id —
 * never a vault path, a concept name, or her wording — and carries only the
 * two booleans the row's health check is actually about: was the underlying
 * edit formatting-only or a genuine content change, and did the trigger
 * fire (surface a `'verdict'` with `material: true`, in the caller's terms).
 *
 * **The planted-failure self-test lives in this module's `.spec.ts`**: it
 * proves the check can actually report `ok: false` on a case that should
 * have failed, not only ever pass — the same self-test discipline
 * `check-privacy-guards.mjs` (`olea-service`) applies to its own guards, and
 * the same shape `checkGroundingRefusalOnAdversarial` above already
 * established for row 1.8's absolute-gate check.
 */
import type { CheckVerdict } from './types.js';

/** One already-evaluated case: what kind of edit it was, and whether the trigger fired. */
export interface MaterialityTriggerCase {
  /** Opaque case id — never a vault path or note content (INV-3). */
  readonly id: string;
  /** Whether the edit behind this case was formatting-only or a genuine content change, established independently of the trigger (e.g. by construction, in a fixture). */
  readonly editKind: 'formatting-only' | 'genuine-change';
  /** Whether the trigger under test surfaced a material verdict for this case. */
  readonly triggered: boolean;
}

export interface MaterialityTriggerHealthMeasured {
  readonly n: number;
  readonly formattingOnlyCount: number;
  readonly genuineChangeCount: number;
  /** Case ids where a formatting-only edit fired anyway — a false trigger. */
  readonly falseTriggers: readonly string[];
  /** Case ids where a genuine content change failed to fire — a missed trigger. */
  readonly missedTriggers: readonly string[];
}

/**
 * One case per already-run trigger evaluation in, a verdict out. Fails if
 * any formatting-only case fired, if any genuine-change case did not fire,
 * or if zero cases were supplied at all (N-013 — a sweep that ran nothing
 * cannot report a clean bill, the same rule `checkGroundingRefusalOnAdversarial`
 * enforces for row 1.8).
 */
export function checkMaterialityTriggerHealth(
  cases: readonly MaterialityTriggerCase[],
): CheckVerdict<MaterialityTriggerHealthMeasured> {
  const falseTriggers = cases
    .filter((c) => c.editKind === 'formatting-only' && c.triggered)
    .map((c) => c.id);
  const missedTriggers = cases
    .filter((c) => c.editKind === 'genuine-change' && !c.triggered)
    .map((c) => c.id);
  const formattingOnlyCount = cases.filter((c) => c.editKind === 'formatting-only').length;
  const genuineChangeCount = cases.filter((c) => c.editKind === 'genuine-change').length;

  const measured: MaterialityTriggerHealthMeasured = {
    n: cases.length,
    formattingOnlyCount,
    genuineChangeCount,
    falseTriggers,
    missedTriggers,
  };

  if (cases.length === 0) {
    return { ok: false, measured, detail: 'zero cases supplied — nothing was checked' };
  }
  if (falseTriggers.length > 0 || missedTriggers.length > 0) {
    const parts: string[] = [];
    if (falseTriggers.length > 0) {
      parts.push(
        `${falseTriggers.length} formatting-only case(s) fired: ${falseTriggers.join(', ')}`,
      );
    }
    if (missedTriggers.length > 0) {
      parts.push(
        `${missedTriggers.length} genuine-change case(s) did not fire: ${missedTriggers.join(', ')}`,
      );
    }
    return { ok: false, measured, detail: parts.join('; ') };
  }
  return {
    ok: true,
    measured,
    detail: `${formattingOnlyCount} formatting-only case(s) silent, ${genuineChangeCount} genuine-change case(s) fired — ${cases.length} total`,
  };
}
