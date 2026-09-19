/**
 * `buildPracticePaperGenerationPort` — F7.8's grey-out, applied to
 * `../oracle/paper-item-port.js`'s `createWorkerPaperItemGenerationPort`. Mirrors
 * `grading/wiring.ts`'s `buildGradingWiring` and `retrieval/wiring.ts`'s `buildRetrievalWiring`
 * exactly: load the persisted Worker config, build a real transport when (and only when) it is
 * usable, hand back `null` otherwise — a practice paper greys out the same way every other AI
 * feature does when no Worker token is pasted yet, never a caller doomed to fail on its first
 * real request.
 */

import type { PaperItemGenerationPort, WorkerTaskTransport } from 'olea-core';
import { createWorkerPaperItemGenerationPort } from '../oracle/paper-item-port.js';
import { isWorkerConfigured, ObsidianWorkerConfigStore } from '../worker/config-store.js';
import type { WorkerConfig } from '../worker/transport.js';

/** The `{ loadData, saveData }` slice of Obsidian's `Plugin` this module needs — same narrow-port pattern every other Worker-config reader in this plugin uses. */
export interface ObsidianDataHost {
  loadData(): Promise<unknown>;
  saveData(data: unknown): Promise<void>;
}

export interface BuildPracticePaperGenerationPortDeps {
  readonly dataHost: ObsidianDataHost;
  readonly createTransport: (config: WorkerConfig) => WorkerTaskTransport;
}

/** `null` when no Worker is configured yet (F7.8) — a caller checks this once, the same shape `main.ts` already uses for `this.retrieval`/`this.grading`. */
export async function buildPracticePaperGenerationPort(
  deps: BuildPracticePaperGenerationPortDeps,
): Promise<PaperItemGenerationPort | null> {
  const config = await new ObsidianWorkerConfigStore(deps.dataHost).load();
  if (!isWorkerConfigured(config)) return null;
  const transport = deps.createTransport({ baseUrl: config.baseUrl, token: config.token });
  return createWorkerPaperItemGenerationPort({ transport });
}
