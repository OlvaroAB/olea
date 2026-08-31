/**
 * `buildTranscriptionWiring` — the plugin-side composition root for the
 * transcription pipeline (`ol-p4t01`'s `audio.transcribe.v1`), following
 * exactly the pattern `grading/wiring.ts` established for
 * `buildGradingWiring`: load the persisted Worker config, build a real
 * `TranscriptionCaller` when (and only when) the Worker is usable, and hand
 * back `null` otherwise rather than a caller doomed to fail on its first
 * real request (F7.8: grey out, never half-work).
 *
 * ===========================================================================
 * WHY THIS STOPS HERE — NO RECORDING UI, NO COMMAND, NO VIEW
 * ===========================================================================
 * `ol-0r92.14`'s own brief puts the clause gate first: F5.1 ("spoken or
 * typed") authorises voice as an input MODALITY for explain-back, but names
 * no invocable surface for it — no command id, no view, no modal, no
 * button — and neither does any other clause in the functional scope.
 * `docs/dev/surface-register.md` (private repo) carries no explain-back row
 * at all yet, voice or typed, because `grading/wiring.ts`'s own module doc
 * already records that there is no explain-back destination anywhere in the
 * review UI. Per this repo's "no user-visible affordance without a clause"
 * rule, a lane may not invent one to close that gap. This module is
 * therefore surface-free plumbing only — a composition root with no caller,
 * exactly the shape `grading/wiring.ts` itself first shipped in (a real,
 * callable port with "no caller yet" stated plainly in its own module doc).
 * The gap this leaves — WHAT surface F5.1 needs, and where a recording
 * control would actually live — is escalated as a proposed decision bead
 * rather than guessed at here; see `ol-0r92.14`'s notes for the bead id.
 *
 * `buildGradeExplainBackInputFromTranscript` (`olea-core`) is the seam a
 * future caller uses once a surface exists: it turns this wiring's
 * `TranscriptionCaller` output into the same `GradeExplainBackInput` a typed
 * answer produces, so voice is provably an input method feeding the
 * existing grading path (`grading/wiring.ts`'s `gradeExplainBackAttempt`),
 * never a second grading path of its own.
 *
 * ===========================================================================
 * NEVER LOGS (D-005)
 * ===========================================================================
 * A transcript is what she said, verbatim — the same content-heavy string
 * `workerTranscriptionCaller.ts` already refuses to log or include in any
 * thrown error. This module never touches the transcript text itself (it
 * only composes the caller that will one day produce one), so there is
 * nothing here to log in the first place.
 */

import {
  createWorkerTranscriptionCaller,
  type TranscriptionCaller,
  type WorkerTaskTransport,
} from 'olea-core';
import { isWorkerConfigured, ObsidianWorkerConfigStore } from '../worker/config-store.js';
import type { WorkerConfig } from '../worker/transport.js';

/** The `{ loadData, saveData }` slice of Obsidian's `Plugin` this module needs — same narrow-port pattern `grading/wiring.ts` and every other store in this plugin uses. */
export interface ObsidianDataHost {
  loadData(): Promise<unknown>;
  saveData(data: unknown): Promise<void>;
}

export interface TranscriptionWiringDeps {
  readonly dataHost: ObsidianDataHost;
  readonly createTransport: (config: WorkerConfig) => WorkerTaskTransport;
}

export interface TranscriptionWiring {
  /**
   * `null` when the Worker isn't configured yet (F7.8) — the same grey-out
   * contract `GradingWiring.judgeCaller` uses. No production caller of this
   * field exists anywhere in the plugin yet (see module doc): it is composed
   * here so the eventual surface has one pre-tested seam to call rather than
   * reinventing the config-load/grey-out dance itself.
   */
  readonly transcriptionCaller: TranscriptionCaller | null;
}

export async function buildTranscriptionWiring(
  deps: TranscriptionWiringDeps,
): Promise<TranscriptionWiring> {
  const configStore = new ObsidianWorkerConfigStore(deps.dataHost);
  const config = await configStore.load();

  if (!isWorkerConfigured(config)) {
    return { transcriptionCaller: null };
  }

  const transport = deps.createTransport({ baseUrl: config.baseUrl, token: config.token });
  return { transcriptionCaller: createWorkerTranscriptionCaller({ transport }) };
}
