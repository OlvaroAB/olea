/**
 * CHK-2 (`ol-3ux7.15`) — component register row 2.2's health check.
 *
 * Row 2.2 ("Choose which type suits which concept") names it in plain
 * terms: **"the resulting mix must not collapse onto one instrument type
 * for the overwhelming majority, and no type may be structurally
 * unreachable."**
 *
 * ## The register undersells how built this row already is
 *
 * Row 2.2's own text says "1.3 ... and the instrument inventory remain
 * unbuilt." That is stale: `../concept/size.ts` (row 1.3) is a real, shipped
 * module (its own doc calls itself "the honest floor" for the eventual
 * design), and `../routing/instrument-mix.ts` — this check's actual
 * subject — is itself a complete, pure, tested implementation of the
 * KC-type-to-emphasis table the row describes. Only the instrument
 * inventory input is genuinely still missing. So the health check row 2.2
 * names is buildable TODAY against real, shipped policy, not a fixture
 * standing in for something unbuilt.
 *
 * `routeKnowledgeKind` (`../routing/instrument-mix.ts`) is a pure,
 * synchronous lookup over a small, enumerable domain — the three real
 * `KnowledgeKind` values — so this check can run EVERY possible input, not
 * a sample. That makes "collapse" and "unreachable" exact facts about the
 * whole domain rather than statistics over a batch.
 */
import type { CheckVerdict } from './types.js';

export type RoutingGroupName = 'retrieval' | 'quiz' | 'explainBack';
export const ROUTING_GROUP_NAMES: readonly RoutingGroupName[] = [
  'retrieval',
  'quiz',
  'explainBack',
];

export interface InstrumentMixLike {
  readonly retrieval: string;
  readonly quiz: string;
  readonly explainBack: string;
}

export interface RoutedMix {
  /** Opaque label id — the knowledge-kind name, never a concept name (INV-3; a knowledge-kind label is not content, but this keeps the shape consistent with every other check here). */
  readonly kind: string;
  readonly mix: InstrumentMixLike;
}

export interface InstrumentMixCoverageMeasured {
  readonly n: number;
  readonly distinctMixes: number;
  /** Routing groups that read `'none'` for EVERY supplied kind — structurally unreachable. */
  readonly unreachableGroups: readonly RoutingGroupName[];
}

function mixKey(mix: InstrumentMixLike): string {
  return `${mix.retrieval}|${mix.quiz}|${mix.explainBack}`;
}

/**
 * One `{ kind, mix }` per real knowledge-kind label the routing table
 * covers — a caller runs `routeKnowledgeKind` over the whole domain and
 * hands the results here. Fails if every mix collapses onto the same
 * emphasis triple (the "overwhelming majority" failure, made exact at this
 * domain's size: with every real kind covered, "collapse" is "all of them
 * identical," not a threshold), or if some routing group never rises above
 * `'none'` across the whole domain — the "structurally unreachable"
 * failure. Also fails if zero mixes were supplied (N-013).
 */
export function checkInstrumentMixCoverage(
  routed: readonly RoutedMix[],
): CheckVerdict<InstrumentMixCoverageMeasured> {
  const distinctMixes = new Set(routed.map((r) => mixKey(r.mix))).size;
  const unreachableGroups = ROUTING_GROUP_NAMES.filter((group) =>
    routed.every((r) => r.mix[group] === 'none'),
  );

  const measured: InstrumentMixCoverageMeasured = {
    n: routed.length,
    distinctMixes,
    unreachableGroups,
  };

  if (routed.length === 0) {
    return { ok: false, measured, detail: 'zero knowledge kinds supplied — nothing was checked' };
  }
  if (distinctMixes <= 1 && routed.length > 1) {
    return {
      ok: false,
      measured,
      detail: `all ${routed.length} knowledge kinds route to the identical instrument mix — the routing table is decorative`,
    };
  }
  if (unreachableGroups.length > 0) {
    return {
      ok: false,
      measured,
      detail: `${unreachableGroups.length} routing group(s) never rise above 'none' across any kind: ${unreachableGroups.join(', ')}`,
    };
  }
  return {
    ok: true,
    measured,
    detail: `${distinctMixes} distinct mix(es) across ${routed.length} kinds, every routing group reachable`,
  };
}
