/**
 * Routing a practice need's ask to a generator, with an outcome for every ask (`[D-437]`; design
 * `docs/dev/intelligence-build/demand-carriage.md` §4.1, in the `olea-service` repo, cited by path;
 * rows 35 and 37 of the 2026-09-29 rulings).
 *
 * **The source survives every outcome, and an ask no generator serves is recorded as unmet, never
 * dropped and never counted as fulfilled (row 37).** `routeDemandAsk` resolves a {@link DemandAsk}
 * against the routed generator's declared served demands (`PAPER_GENERATOR_DECLARED_DEMANDS`,
 * pinned equal to the authoring contract's `AUTHORING_SERVED_DEMANDS` by `demand-vocabulary.spec.ts`)
 * and returns one of four outcomes, each carrying the ask's source:
 *
 * - `served`: a mapped word the generator declares. The only outcome that sends a demand.
 * - `deferred`: a mapped word no generator declares yet. Recorded as unmet.
 * - `unsupported`: an operation outside the vocabulary. Recorded as unmet.
 * - `unspecified`: nothing was asked (`none-asked`), or the words alone fix no operation
 *   (`underspecified`). The source is kept; it is neither served nor called unsupported.
 *
 * Those stay distinct from each other and from `unavailable` (`pra.md` §3, the service could not be
 * reached), which is a different fact at a different layer.
 *
 * **What an unmet ask never becomes.** It is never turned into an instrument's `declaredDemand`,
 * never sent to a generator that does not serve it (`authoringDemandFields` is empty for every
 * outcome but `served`), and nothing counts the drafts made for another purpose as meeting it: the
 * counter below files it under its own reason, apart from `served`. A narrower practice may be
 * offered for it only as an explicitly labelled alternative while the original demand stays unmet;
 * **no such label exists (no clause, no registry wording), so nothing here builds one**, and today's
 * presentation is unchanged (design Open question 1).
 *
 * **Counting is per concept and per reason** ({@link DemandRoutingCounter}). It is local and in
 * memory: it is never persisted, never sent anywhere, and keyed by the opaque concept key, never a
 * name or her wording (D-005, INV-3). A stored or transmitted count would be a new shape and is not
 * built here.
 *
 * Pure apart from the counter, which is the one deliberately stateful class in this file.
 */

import { demandServedByGenerator } from '../oracle/paper-blueprint.js';
import type { PaperDemand, PaperGeneratorTaskId } from '../oracle/paper-types.js';
import type { AskSource, DemandAsk } from './demand-ask.js';

export type DemandRouting =
  | { readonly kind: 'served'; readonly demand: PaperDemand; readonly source: AskSource | null }
  /** A word no generator declares yet. */
  | { readonly kind: 'deferred'; readonly demand: PaperDemand; readonly source: AskSource | null }
  /** An operation outside the vocabulary. `operation` is the taxonomy ruling's label, absent until it exists. */
  | {
      readonly kind: 'unsupported';
      readonly source: AskSource | null;
      readonly operation?: string;
    }
  | {
      readonly kind: 'unspecified';
      readonly source: AskSource | null;
      readonly reason: 'none-asked' | 'underspecified';
    };

/** An ask no generator serves, kept with the source it was read from: the two outcomes that are recorded as unmet. */
export type UnmetAsk = Extract<DemandRouting, { readonly kind: 'deferred' | 'unsupported' }>;

/**
 * Resolves `ask` against `taskId`'s declared served demands. Pure: the same ask and task always
 * give the same outcome, and the source is copied through unchanged.
 */
export function routeDemandAsk(ask: DemandAsk, taskId: PaperGeneratorTaskId): DemandRouting {
  const { source, mapping } = ask;
  switch (mapping.kind) {
    case 'mapped':
      return demandServedByGenerator(taskId, mapping.demand)
        ? { kind: 'served', demand: mapping.demand, source }
        : { kind: 'deferred', demand: mapping.demand, source };
    case 'unmapped':
      return mapping.reason === 'outside-vocabulary'
        ? {
            kind: 'unsupported',
            source,
            ...(mapping.operation === undefined ? {} : { operation: mapping.operation }),
          }
        : { kind: 'unspecified', source, reason: 'underspecified' };
    case 'none':
      return { kind: 'unspecified', source, reason: 'none-asked' };
  }
}

/** The routing as an unmet ask, or `null` when the ask was served or unspecified. The value returned is the routing itself: the source heading is intact on it. */
export function unmetAskOf(routing: DemandRouting): UnmetAsk | null {
  return routing.kind === 'deferred' || routing.kind === 'unsupported' ? routing : null;
}

/**
 * The two optional fields the authoring request carries for a demand (the wire fragment
 * `packages/contracts/src/authoring-demand.ts`): the PRIMARY `requestedAsk` (the heading exactly as
 * written and its question word) and the SECONDARY `intendedDemand` (the mapping).
 */
export interface AuthoringDemandFields {
  readonly intendedDemand?: PaperDemand;
  readonly requestedAsk?: { readonly heading: string; readonly questionWord?: string };
}

/**
 * What a routing puts on the drafting request. Only a `served` ask sends anything: `intendedDemand`
 * always, and `requestedAsk` when the need came from a heading. A deferred, unsupported or
 * unspecified ask sends neither, so its alternative, if one is ever offered, is authored exactly as
 * an unspecified need is today (no demand and no heading sent), and the source survives in the
 * outcome, not in the request.
 */
export function authoringDemandFields(routing: DemandRouting): AuthoringDemandFields {
  if (routing.kind !== 'served') return {};
  const { source } = routing;
  return {
    intendedDemand: routing.demand,
    ...(source !== null && source.heading.trim() !== ''
      ? {
          requestedAsk: {
            heading: source.heading,
            ...(source.questionWord === null ? {} : { questionWord: source.questionWord }),
          },
        }
      : {}),
  };
}

/**
 * Why a routing came out as it did, one value each: `served`, `no-generator-serves` (`deferred`),
 * `outside-vocabulary` (`unsupported`), `underspecified` and `none-asked` (the two `unspecified`
 * reasons). The counting dimension.
 */
export type DemandRoutingReason =
  | 'served'
  | 'no-generator-serves'
  | 'outside-vocabulary'
  | 'underspecified'
  | 'none-asked';

/** Every reason, in a fixed order, for a reader that wants a zero row for a reason that never fired. */
export const DEMAND_ROUTING_REASONS: readonly DemandRoutingReason[] = Object.freeze([
  'served',
  'no-generator-serves',
  'outside-vocabulary',
  'underspecified',
  'none-asked',
]);

export function demandRoutingReasonOf(routing: DemandRouting): DemandRoutingReason {
  switch (routing.kind) {
    case 'served':
      return 'served';
    case 'deferred':
      return 'no-generator-serves';
    case 'unsupported':
      return 'outside-vocabulary';
    case 'unspecified':
      return routing.reason;
  }
}

export interface DemandRoutingCount {
  /** The opaque concept key. Never a name (INV-3). */
  readonly conceptKey: string;
  readonly reason: DemandRoutingReason;
  readonly count: number;
}

/**
 * Counts routing outcomes per concept and per reason (design §4.1, item 4). In memory and local:
 * the count is ours, never a sentence for her, and it is never persisted or sent (D-005). One
 * instance is meant to live as long as whatever composes the callers does (the plugin session), the
 * same lifetime argument `retrieval/gateStageRecorder.ts` makes for its recorder; where that
 * instance is held is the composition root's call, not this class's.
 */
export class DemandRoutingCounter {
  private readonly counts_ = new Map<string, Map<DemandRoutingReason, number>>();

  /** Counts one routing against `conceptKey`, and returns it unchanged so a caller can record inline. */
  record(conceptKey: string, routing: DemandRouting): DemandRouting {
    const reason = demandRoutingReasonOf(routing);
    let byReason = this.counts_.get(conceptKey);
    if (byReason === undefined) {
      byReason = new Map();
      this.counts_.set(conceptKey, byReason);
    }
    byReason.set(reason, (byReason.get(reason) ?? 0) + 1);
    return routing;
  }

  /** Every non-zero count, ordered by concept key and then by the reason order above. */
  counts(): readonly DemandRoutingCount[] {
    const out: DemandRoutingCount[] = [];
    for (const conceptKey of [...this.counts_.keys()].sort()) {
      const byReason = this.counts_.get(conceptKey);
      if (byReason === undefined) continue;
      for (const reason of DEMAND_ROUTING_REASONS) {
        const count = byReason.get(reason);
        if (count !== undefined) out.push({ conceptKey, reason, count });
      }
    }
    return out;
  }

  /** The count for one reason across every concept. An unmet ask is under its own reason, never under `served`. */
  total(reason: DemandRoutingReason): number {
    let total = 0;
    for (const byReason of this.counts_.values()) total += byReason.get(reason) ?? 0;
    return total;
  }
}
