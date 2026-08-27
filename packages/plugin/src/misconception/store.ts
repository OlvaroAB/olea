/**
 * `createVaultMisconceptionStore` — the plugin-side read of the misconception
 * event log (F5.6, knowledge model §4.1, `ol-2zfj.22`), closing the gap
 * `ol-2zfj.19`'s close evidence named: "there is no client-side misconception
 * store construction anywhere in `packages/plugin` today", which left
 * `corpusRelationSignals.ts`'s `assessment-error-adjacency` nomination signal
 * with a producer and no supplier. This module IS that supplier.
 *
 * ===========================================================================
 * SHAPE — MODELLED ON THE VAULT-BACKED "load, don't persist" STORES, NOT ON
 * THE `data.json` ONES
 * ===========================================================================
 * `../concept/corpusRelationStateStore.ts` and `../today/material-arrival-
 * store.ts` hold DEVICE-LOCAL bookkeeping with no vault source of truth —
 * `data.json` *is* their durable state. A misconception record is the
 * opposite shape: it is a **projection of her vault's own event log**
 * (`packages/core/src/misconception/types.ts`'s module doc: "local
 * event-sourcing, same as the review log... every read-facing shape... is a
 * projection folded from it, never a second source of truth"). Caching that
 * projection in `data.json` would be exactly the un-rebuildable second copy
 * that doc warns against, so this store takes the shape
 * `today/data-source.ts`'s `createVaultTrendsSource`/`createRhythmSource`/
 * `createVaultInstrumentSource` already use for vault-derived reads: a
 * `load()`-shaped port, nothing persisted here, re-read and re-projected
 * fresh on every call.
 *
 * **`null` vs `[]`, the same three-state discipline every other source in
 * `today/data-source.ts` follows.** `null` means "the vault could not be
 * read" (a throw partway through discovery/read/parse); `[]` is a real,
 * common answer — an install that has never observed a misconception yet.
 * `corpusRelationSignals.ts`'s `AssessmentErrorAdjacencyOptions` documents the
 * consequence deliberately: omitting the option skips the signal entirely
 * (the same "absent, not guessed" contract `embeddingProximity` follows),
 * while `{ records: [] }` computes the signal and finds nothing — a caller
 * threading this store's `load()` result into that option should map `null`
 * to omitting the key, not to `{ records: [] }`. See this bead's report
 * (`ol-2zfj.22`) for the exact `main.ts` diff that does this — out of this
 * bead's file ownership (`ol-2zfj.23`'s job).
 *
 * ===========================================================================
 * DISCOVERY — REUSES `../privacy/log-discovery.ts`, NEVER RE-DERIVED
 * ===========================================================================
 * `.olea/misconceptions/` is dot-prefixed exactly like `.olea/reviews/`
 * (`packages/core/src/misconception/path.ts`'s module doc), so `vault.list()`
 * may not surface another device's files on a host that will not list a dot
 * folder — most Obsidian hosts, per `review-log/path.ts`'s own warning.
 * `../privacy/log-discovery.ts`'s `discoverLogPaths` already implements the
 * fix (union of "whatever `list()` finds" with "this device's own file for
 * each of the last N days, found by exact path") and is already used for this
 * exact folder by `export-bundle.ts`/`vault-artifact-delete.ts`
 * (`MISCONCEPTION_LOG_FOLDER`/`misconceptionLogPath`). `today/data-source.ts`'s
 * `readReviewHistory` inlines the identical strategy a second time for the
 * review log — accepted there as a deliberate near-duplicate between two
 * separate event streams (`misconception/write.ts`'s own doc makes the same
 * call). Forking `discoverLogPaths` itself a THIRD time here would be a
 * different thing: the exact same folder, the exact same helper, already
 * imported by two sibling modules in this package. Reused, not re-derived.
 *
 * **Probe window defaults to `DEFAULT_LOG_PROBE_DAYS` (~10 years,
 * `log-discovery.ts`), not a short streak-style window.** A misconception's
 * `status` (`active`/`fading`/`resolved`) and `occurrenceCount` are folded
 * from its ENTIRE history, the same reason `TodayInstrumentSource`'s own doc
 * gives for reading suspension from the whole review log rather than a
 * trailing window: "a suspend from last term is outside that window and
 * would be silently forgotten." An active misconception from months ago is
 * exactly the case `assessment-error-adjacency` exists to nominate against;
 * truncating the read to a recent window would silently drop it. Overridable
 * via `probeDays` for a caller with a real reason to bound it (e.g. a test).
 *
 * ===========================================================================
 * THE IDENTITY-SPACE CAVEAT — VERIFIED, NOT ASSUMED (`ol-2zfj.22`'s brief)
 * ===========================================================================
 * `corpusRelationSignals.ts`'s `AssessmentErrorAdjacencyOptions` already
 * documents the risk it could not close without this store existing: does
 * `MisconceptionRecord.conceptId`/`.confusedWithConceptId` hold a concept
 * NAME (what `her-link`/`assessment-cooccurrence` key on) or `[D-088]`'s
 * opaque `ConceptRecord.key` (what review-log `conceptIds` now carry, per
 * `today/data-source.ts`'s `createVaultTrendsSource` doc: "A concept's id is
 * its opaque key, not its name")? If the latter, that resolution "silently
 * stops matching... rather than mismatching silently" — a store shipped
 * without checking would be exactly the failure this bead's brief warns
 * against.
 *
 * **Traced end to end. It is neither a canonical name nor an opaque key —
 * it is free text the grading judge invented, with NO concept vocabulary of
 * either kind ever given to it to draw from:**
 *
 * 1. `olea-service/src/tasks/explainBackJudge.ts`'s `misconceptionCandidate`
 *    zod schema types `concept`/`confusedWith` as bare `z.string().min(1)` —
 *    no enum, no id format, no reference to any concept list.
 * 2. That same file's `buildPrompt` never sends the model a concept name or
 *    id list of any kind — only `sourceBlocks` (raw excerpt text keyed by an
 *    unrelated `blockId`) and `misconceptionDigest` (prior misconceptions'
 *    own `concept` strings, for context, not as a controlled vocabulary).
 *    There is no request-side concept identity for the model to echo back,
 *    canonical or opaque — it names a concept purely from what it read in
 *    the question/answer/source text.
 * 3. `packages/core/src/grading/workerJudgeCaller.ts`'s `readMisconception
 *    Candidates` (~line 204–253) parses `concept` (line 218) and
 *    `confusedWith` (line 240) off the wire response as plain strings with no
 *    further validation against any identity space — it cannot check what
 *    was never sent.
 * 4. `gradingPipeline.ts`'s module doc (its "WHAT THIS EMITS" section) states
 *    the mapping is field-for-field: a `MisconceptionCandidate`'s `concept`/
 *    `confusedWith` become `ObservationInput.conceptId`/
 *    `.confusedWithConceptId` verbatim, at whatever integration point wires
 *    the grading pipeline to `misconception/events.ts` (not yet built —
 *    `ol-p4t04`'s own scope, separate from this bead).
 * 5. `misconception/types.ts`'s own doc corroborates from the other side:
 *    `conceptId` carries "no reference to `[D-088]`'s opaque
 *    `ConceptRecord.key` anywhere in `packages/core/src/misconception/`".
 *
 * **Verdict: the identity spaces are the same CATEGORY (free-text labels),
 * so records CAN match `corpusRelationSignals.ts`'s `byName` lookup — but
 * nothing GUARANTEES a match.** `assessmentErrorAdjacencySignals` resolves
 * both ids via an EXACT `Map.get` against `CorpusConcept.name`/`.aliases`
 * (`corpusRelationSignals.ts` lines ~330–334) — unlike `her-link`/
 * `assessment-cooccurrence` in the SAME file, which both use
 * `mentionsTerm`'s case-insensitive, word-bounded regex. A judge-invented
 * label that paraphrases, abbreviates, or differs in case from the concept's
 * canonical `name`/`aliases` resolves to nothing, silently (the documented,
 * accepted "unrecognised concept nominates nothing" behaviour) — this is a
 * real, live risk given the model is never shown the canonical name list, not
 * a hypothetical. **This store does no resolution of its own and ships none**
 * — `AssessmentErrorAdjacencyOptions`'s own doc already commits to "a plain
 * array... stays agnostic to how any of it was computed", so fixing the
 * match rate (e.g. loosening `assessmentErrorAdjacencySignals` to the same
 * `mentionsTerm`-style matching the other two signals use, or having the
 * grader's prompt list known concept names) belongs to whoever owns that
 * file or the prompt, not to this store. Flagged here so a caller wiring
 * this store for the first time watches the resolved-pair count rather than
 * assuming zero means "no misconceptions" when it may mean "no exact-string
 * matches yet" — exactly the caution `AssessmentErrorAdjacencyOptions`'s own
 * doc already asks for.
 */

import {
  calendarDayFromLocalDate,
  MISCONCEPTION_LOG_FOLDER,
  type MisconceptionEvent,
  type MisconceptionRecord,
  mergeMisconceptionEvents,
  misconceptionLogPath,
  parseMisconceptionLog,
  projectMisconceptions,
  type VaultSource,
} from 'olea-core';
import { DEFAULT_LOG_PROBE_DAYS, discoverLogPaths } from '../privacy/log-discovery.js';

/**
 * The seam `main.ts` composes against — see the module doc's "SHAPE" section
 * for why `load()` re-reads and re-projects rather than persisting anything.
 */
export interface MisconceptionStore {
  /**
   * `null` means "could not read the vault" (a throw during discovery, read
   * or parse); `[]` is a real, common answer for an install with no observed
   * misconceptions yet. See the module doc's null-vs-empty section for what
   * a caller must do with each before handing the result to
   * `corpusRelationSignals.ts`'s `AssessmentErrorAdjacencyOptions`.
   */
  load(): Promise<readonly MisconceptionRecord[] | null>;
}

export interface VaultMisconceptionStoreDeps {
  readonly vault: VaultSource;
  /** Names this device's own log files for `discoverLogPaths`'s exact-path probe. */
  readonly deviceId: string;
  /** Injected so the store is deterministic under test; production passes `() => new Date()`. */
  readonly now: () => Date;
  /**
   * How many days back `discoverLogPaths` probes this device's own files by
   * exact path. Defaults to `DEFAULT_LOG_PROBE_DAYS` (~10 years) — see the
   * module doc's "DISCOVERY" section for why a short window is wrong here.
   */
  readonly probeDays?: number;
}

/**
 * The real store: discover every misconception-log file this device or host
 * can see, parse and merge them into one deduplicated event stream, and fold
 * that into current `MisconceptionRecord`s. See the module doc for discovery,
 * the null-vs-empty contract, and the identity-space caveat this function
 * does NOT resolve.
 */
export function createVaultMisconceptionStore(
  deps: VaultMisconceptionStoreDeps,
): MisconceptionStore {
  return {
    async load() {
      try {
        const today = calendarDayFromLocalDate(deps.now());
        const paths = await discoverLogPaths(
          deps.vault,
          MISCONCEPTION_LOG_FOLDER,
          misconceptionLogPath,
          deps.deviceId,
          today,
          deps.probeDays ?? DEFAULT_LOG_PROBE_DAYS,
        );

        const perFile: (readonly MisconceptionEvent[])[] = [];
        for (const path of paths) {
          const content = await deps.vault.read(path);
          perFile.push(parseMisconceptionLog(content).events);
        }

        const merged = mergeMisconceptionEvents(...perFile);
        return projectMisconceptions(merged.events);
      } catch {
        // "Could not read the vault" is not "no misconceptions" — same
        // honest-absence posture every other `today/data-source.ts` source
        // takes. See the module doc's null-vs-empty section.
        return null;
      }
    },
  };
}
