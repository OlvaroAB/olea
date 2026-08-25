/**
 * `buildConceptWiring` / `readConceptsFromVault` — the plugin-side
 * composition root for the concept-reading stage (EXT-7, `ol-5nle`).
 *
 * Follows exactly the pattern `retrieval/wiring.ts` and `grading/wiring.ts`
 * already establish: load the persisted Worker config, build a real
 * transport when (and only when) it is usable, and hand back `null`
 * otherwise (F7.8 — AI features grey out, never half-work) rather than a
 * caller doomed to fail on its first real request.
 *
 * ===========================================================================
 * REACHABILITY, AND WHY THIS IS THE SAME SHAPE AS `gradeExplainBackAttempt`
 * ===========================================================================
 * `readConceptsFromVault` below is a genuine, non-test call to `readConcepts`
 * — real infrastructure, wired to a real `WorkerConceptReader` when the
 * Worker is configured — and it is what `docs/dev/wiring-register.md` names
 * as `ConceptReaderPort`'s production caller. Nothing calls THIS method yet,
 * and that is the same deliberate gap `grading/wiring.ts`'s module doc
 * records for `gradeExplainBackAttempt`: there is no command, view or
 * schedule in this plugin today that decides WHEN to read her vault for
 * concepts, and building one now would be inventing a trigger this bead was
 * not asked to design. `ol-2zfj.1`'s own reachability note calls this bead
 * "the wiring bead", not the UI bead — a caller answers a different question
 * ("what invokes this, and why now") this file leaves open.
 *
 * ===========================================================================
 * THE BUDGET (`ConceptReadBudget.maxPassages`) — DECLARED, NOT DERIVED
 * ===========================================================================
 * `readConcepts` requires a budget with no default, on purpose: the
 * component register rules a concept-extraction threshold DERIVED once one
 * exists, and a derived constant's derivation stays private while only the
 * number ships. Nobody has run that derivation yet, so the two numbers below
 * are declared placeholders with a stated, plain-English defence rather than
 * a guess dressed as one:
 *
 * - `DEFAULT_MAX_PASSAGES_PER_READ` (60) keeps one full read within the same
 *   rough order of magnitude as an existing Slot G bulk-generation call
 *   (`cards.generate.v1` / `quiz.generate.v1` already send whole documents'
 *   worth of chunks per call) — roughly two to three typical lecture-note
 *   documents' worth of prose blocks, so a first end-to-end read costs
 *   about as much as one existing generation call rather than an
 *   unbounded corpus walk.
 * - `DEFAULT_PASSAGES_PER_CALL` (20) keeps each individual model call to
 *   roughly one document's worth of blocks, which is `[D-082]`'s "several
 *   calls inside one stage" read literally, and keeps any one call's
 *   anchor/alsoIn index range small enough that a client-side accounting
 *   bug (see `workerConceptReader.ts`) surfaces on a small batch rather
 *   than a sprawling one.
 *
 * Neither number is fitted against measured cost, latency or extraction
 * quality — that measurement is real work this bead does not do, and this
 * comment says so rather than implying otherwise. A caller may override both
 * via `ReadConceptOptions.budget`; these are only what `readConceptsFromVault`
 * falls back to when a caller supplies none. Revising them is a Class B
 * threshold tuning (run charter), not a Class C stop.
 */

import {
  type ConceptReadBudget,
  type ConceptReaderPort,
  type ConceptReadResult,
  readConcepts,
  type VaultPath,
  type VaultSource,
  type WorkerTaskTransport,
} from 'olea-core';
import { isWorkerConfigured, ObsidianWorkerConfigStore } from '../worker/config-store.js';
import type { WorkerConfig } from '../worker/transport.js';
import { WorkerConceptReader } from './workerConceptReader.js';

/** See the module doc's "THE BUDGET" section. */
export const DEFAULT_MAX_PASSAGES_PER_READ = 60;
/** See the module doc's "THE BUDGET" section. */
export const DEFAULT_PASSAGES_PER_CALL = 20;

/** The `{ loadData, saveData }` slice of Obsidian's `Plugin` this module needs — same narrow-port pattern every other store in this plugin uses. */
export interface ObsidianDataHost {
  loadData(): Promise<unknown>;
  saveData(data: unknown): Promise<void>;
}

export interface ConceptWiringDeps {
  readonly dataHost: ObsidianDataHost;
  readonly createTransport: (config: WorkerConfig) => WorkerTaskTransport;
}

export interface ConceptWiring {
  /**
   * `null` when the Worker isn't configured yet (F7.8) — see the module doc.
   * A caller checks this exactly once, the same shape `main.ts` already uses
   * for `this.retrieval`/`this.grading`.
   */
  readonly conceptReader: ConceptReaderPort | null;
}

export async function buildConceptWiring(deps: ConceptWiringDeps): Promise<ConceptWiring> {
  const configStore = new ObsidianWorkerConfigStore(deps.dataHost);
  const config = await configStore.load();
  if (!isWorkerConfigured(config)) return { conceptReader: null };

  const transport = deps.createTransport({ baseUrl: config.baseUrl, token: config.token });
  return { conceptReader: new WorkerConceptReader({ transport }) };
}

export interface ReadConceptsFromVaultOptions {
  readonly under?: VaultPath;
  readonly zettelkastenFolder?: VaultPath;
  readonly coursesFolder?: VaultPath;
  /** Overrides the declared defaults above — see the module doc. */
  readonly budget?: ConceptReadBudget;
}

/**
 * The production caller `ol-5nle` exists to build: reaches `readConcepts`
 * through whatever `ConceptReaderPort` `buildConceptWiring` composed, over
 * the real Worker transport when one is configured. `null` when it is not
 * (F7.8) — the same grey-out contract every other AI-gated surface in this
 * plugin follows, propagated one level up rather than left for a caller to
 * rediscover.
 */
export async function readConceptsFromVault(
  wiring: ConceptWiring,
  vault: VaultSource,
  options: ReadConceptsFromVaultOptions = {},
): Promise<ConceptReadResult | null> {
  if (wiring.conceptReader === null) return null;

  const budget: ConceptReadBudget = options.budget ?? {
    maxPassages: DEFAULT_MAX_PASSAGES_PER_READ,
    passagesPerCall: DEFAULT_PASSAGES_PER_CALL,
  };

  return readConcepts(vault, wiring.conceptReader, {
    budget,
    ...(options.under !== undefined ? { under: options.under } : {}),
    ...(options.zettelkastenFolder !== undefined
      ? { zettelkastenFolder: options.zettelkastenFolder }
      : {}),
    ...(options.coursesFolder !== undefined ? { coursesFolder: options.coursesFolder } : {}),
  });
}
