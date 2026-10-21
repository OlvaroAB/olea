/**
 * `[MOM-8.1 / BD-1]` (`ol-3ux7.5.57.9.1`) — the second half of component
 * register row 2.2's health check: **does the classification actually reach
 * selection?**
 *
 * `./instrument-mix-coverage.ts` (CHK-2) already answers row 2.2's first
 * question — the TABLE's own shape, "the resulting mix must not collapse
 * onto one instrument type for the overwhelming majority, and no type may be
 * structurally unreachable." It runs over the routing table alone, so it
 * stays green whether or not any production path ever consults the table.
 * That is exactly the failure mode this directory's own doc warns about:
 * "every algorithm here returns a plausible answer whether or not it is
 * working" (`./types.ts`). A routing policy that is never consulted is
 * indistinguishable, from CHK-2's vantage point, from one that is.
 *
 * This check closes that gap. It takes the SELECTION path's own record of
 * what it did — one observation per candidate that reached the point where
 * component 2.2 is supposed to be consulted — and fails on the two ways the
 * wiring can be present-but-inert:
 *
 * 1. **Bypassed.** A candidate reached selection with routing not consulted
 *    at all (`consulted: false`). In the production sweep that is what an
 *    omitted `deps.routing` looks like: drafting proceeds unconditionally
 *    and `concepts.classify.v1`'s label reaches nothing a student meets.
 * 2. **Consulted and made a veto.** `[D-549]`: the format chooses a concept's
 *    first instrument and routing never decides whether that first call is
 *    made; it orders the follow-on practice by the groups' deficits. A
 *    zero-deficit first call is therefore RULED behaviour, never a finding.
 *    The defect is the reverse: a candidate that consulted routing and was
 *    then NOT asked (`generated: false`) is the removed gate come back —
 *    routing deciding "no first call" from its own deficit.
 *
 * **An empty batch is RED, not green.** `n === 0` means nothing was
 * observed, which is precisely the state a silently-unwired selection path
 * produces — a check returning `ok: true` for it would report health it has
 * no evidence for. Fail closed, the same posture every other guard here
 * takes.
 *
 * **Content-free by construction (INV-3).** An observation carries a
 * knowledge-kind LABEL (`'fact'`, `'category'`, `'principle'`, or `null` for
 * unclassified), one integer and two booleans. No concept name, no concept
 * key, no course code, no vault path — nothing that identifies what she is
 * studying. The same rule `./types.ts` states for every check in this
 * directory.
 *
 * **Pure.** No I/O, no clock, no vault read. The caller (a test, a harness,
 * or a production wiring point reading `GenerationSweepReport
 * .routingObservations`) does the observing; this function only judges.
 */
import type { CheckVerdict } from './types.js';

/**
 * One candidate's passage through the selection path — what the sweep did,
 * not what it should have done.
 */
export interface RoutingSelectionObservation {
  /**
   * Was component 2.2's routing consulted for this candidate at all?
   * `false` is the bypass this check exists to catch.
   */
  readonly consulted: boolean;
  /**
   * The knowledge-kind label routing decided on, or `null` for the
   * unclassified/degraded reading (routing policy §2 rule 4). `null` also
   * when `consulted` is `false` — there is no label to report.
   */
  readonly kind: string | null;
  /**
   * The deficit routing reported for the group the selection path is about
   * to spend its generative capability on (it orders the follow-on practice;
   * it does not gate this call, `[D-549]`). `null` when not consulted.
   */
  readonly deficit: number | null;
  /** Did selection go on to spend the generative capability on this candidate? */
  readonly generated: boolean;
}

export interface RoutingSelectionMeasured {
  /** Candidates observed at the selection point. */
  readonly n: number;
  /** Of those, how many consulted routing. */
  readonly consulted: number;
  /** Of those, how many did NOT — the bypass. */
  readonly bypassed: number;
  /** Consulted and then not asked — routing used as a veto on the first call, which `[D-549]` rules out. */
  readonly vetoed: number;
  /** Consulted, reported a zero deficit, and were asked anyway — ruled behaviour under `[D-549]`; reported, never failed on. */
  readonly askedAtZeroDeficit: number;
  /**
   * Distinct routing labels observed, the unclassified reading counted as
   * its own value. Reported, never failed on: a sweep over one course's
   * material can legitimately see one label.
   */
  readonly distinctKinds: number;
}

/** The key `distinctKinds` counts the unclassified reading under — never a `KnowledgeKind` literal, so it cannot collide with a real label. */
const UNCLASSIFIED_KEY = '(unclassified)';

/**
 * Fails when routing never reached selection, or reached it and vetoed a
 * first call (`[D-549]`). See the module doc for why an empty batch is red.
 */
export function checkRoutingReachesSelection(
  observations: readonly RoutingSelectionObservation[],
): CheckVerdict<RoutingSelectionMeasured> {
  const n = observations.length;
  let consulted = 0;
  let bypassed = 0;
  let vetoed = 0;
  let askedAtZeroDeficit = 0;
  const kinds = new Set<string>();

  for (const observation of observations) {
    if (!observation.consulted) {
      bypassed += 1;
      continue;
    }
    consulted += 1;
    kinds.add(observation.kind ?? UNCLASSIFIED_KEY);
    if (!observation.generated) vetoed += 1;
    else if (observation.deficit === 0) askedAtZeroDeficit += 1;
  }

  const measured: RoutingSelectionMeasured = {
    n,
    consulted,
    bypassed,
    vetoed,
    askedAtZeroDeficit,
    distinctKinds: kinds.size,
  };

  if (n === 0) {
    return {
      ok: false,
      measured,
      detail:
        'no selection decisions observed — component 2.2 cannot be shown to reach selection from an empty batch',
    };
  }
  if (bypassed > 0) {
    return {
      ok: false,
      measured,
      detail: `${bypassed} of ${n} candidates reached selection without consulting routing — the classification reaches nothing`,
    };
  }
  if (vetoed > 0) {
    return {
      ok: false,
      measured,
      detail: `${vetoed} of ${consulted} consulted candidates were not asked — routing vetoed a first call, which [D-549] rules out`,
    };
  }
  return {
    ok: true,
    measured,
    detail: `all ${n} candidates consulted routing and none was vetoed (${askedAtZeroDeficit} asked at a zero deficit, ${measured.distinctKinds} distinct labels)`,
  };
}
