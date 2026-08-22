import type { z } from 'zod';

/**
 * olea-contracts: the shared zod schema registry for every Worker API
 * request/response, the study-plan artifact (A2.5), and the review-log
 * record (D7.1) — per plan §2.4. `olea-service` vendors a copy of this
 * package; a CI job there diffs the vendored copy against the pinned
 * upstream commit and fails on drift.
 *
 * This is the P0 stub: the registry mechanism, empty of contracts. Worker
 * contracts land in P3 (task-id routing, structured output) — see plan
 * §3 P3-T02. Contracts are versioned per D-011: each entry is keyed by a
 * stable contract id, and callers stamp/consult `SUPPORTED_CONTRACT_VERSIONS`
 * once real contracts exist.
 */

/** A stable identifier for one versioned contract, e.g. "study-plan.v1". */
export type ContractId = string;

/** One registered contract: its zod schema plus a human label for diagnostics. */
export interface ContractEntry<TSchema extends z.ZodTypeAny = z.ZodTypeAny> {
  readonly id: ContractId;
  readonly schema: TSchema;
  readonly description: string;
}

export class SchemaRegistry {
  private readonly entries = new Map<ContractId, ContractEntry>();

  register<TSchema extends z.ZodTypeAny>(entry: ContractEntry<TSchema>): void {
    if (this.entries.has(entry.id)) {
      throw new Error(`olea-contracts: duplicate registration for contract id "${entry.id}"`);
    }
    this.entries.set(entry.id, entry);
  }

  get<TSchema extends z.ZodTypeAny = z.ZodTypeAny>(
    id: ContractId,
  ): ContractEntry<TSchema> | undefined {
    return this.entries.get(id) as ContractEntry<TSchema> | undefined;
  }

  has(id: ContractId): boolean {
    return this.entries.has(id);
  }

  /** All registered contract ids, sorted for stable diffs/golden output. */
  ids(): ContractId[] {
    return [...this.entries.keys()].sort();
  }
}

/**
 * The single, shared registry. Empty at P0 by design — P3's Worker contracts
 * (auth, task routing, structured output) and the study-plan/review-log
 * artifacts register into this instance.
 */
export const contracts = new SchemaRegistry();
