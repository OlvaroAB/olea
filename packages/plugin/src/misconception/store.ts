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
 *
 * ===========================================================================
 * TWO STREAMS FOLDED, ONE PROJECTION (`[D-202]`, `ol-2zfj.70`/`ol-2zfj.74`)
 * ===========================================================================
 * `load()` now reads BOTH of the vault's misconception-shaped logs and folds
 * them through `olea-core`'s `projectMisconceptionsFromAllSources` — never
 * the Stream-A-only `projectMisconceptions` this module used before. **Stream
 * A** is this folder's own event log (`.olea/misconceptions/`, unchanged from
 * before this fold). **Stream B** is a wrong MCQ pick: every
 * `kind: 'misconception-observed'` record in the review log
 * (`.olea/reviews/`, `olea-core`'s `parseReviewLog`), mapped to
 * `McqMisconceptionPick` field-for-field (the two schemas already match,
 * per `olea-core/src/misconception/store.ts`'s own module doc). No embedder
 * is threaded through here — the deterministic per-distractor fallback key
 * alone gives real `occurrenceCount`/`status` behaviour for the common "same
 * distractor picked again" case (`ol-2zfj.74`'s own scope note); wiring
 * `believesEmbeddings`/`candidateEmbeddings` is separate, optional follow-up.
 * The SAME `discoverLogPaths` helper this module already used for Stream A is
 * reused for Stream B's folder — same discovery strategy, same probe window,
 * a different folder and path-builder (`REVIEW_LOG_FOLDER`/`reviewLogPath`).
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
 * WHAT THE TWO CONCEPT FIELDS CARRY (`ol-2zfj.27`, `[D-482]`, ONT-R1 `ol-2zfj.86`)
 * ===========================================================================
 * `MisconceptionRecord.conceptId`/`.confusedWithConceptId` hold concept KEYS
 * (`ConceptRecord.key`, `[D-088]`), never a name or the judge's own wording.
 * Traced end to end:
 *
 * 1. The grading request carries `permittedConceptIds`: the subject's key and,
 *    when a causes partner resolved, the neighbour's key
 *    (`explain-back/request.ts`'s `permittedConceptIdsFor`; the subject is
 *    `instrument.conceptIds[0]`, the neighbour a `ConceptRecord.key`). The
 *    Worker tells the judge to name only those and drops any candidate that
 *    names anything else (`olea-service`'s `src/tasks/explainBackJudge.ts`
 *    grounding).
 * 2. The client resolver accepts only an exact id from that same list
 *    (`explain-back/observation.ts`'s `resolveConceptId`), so a stale Worker's
 *    free label is refused as `'unresolved-concept'`, and
 *    `olea-core`'s `buildObservationEventsFromAcceptedGrading` refuses a
 *    concept confused with itself.
 * 3. A wrong MCQ pick (Stream B) records its instrument's `conceptIds`, also
 *    keys, with no `confusedWithConceptId` (`olea-core`'s
 *    `misconception/store.ts` `normalizeMcqPick`).
 *
 * **This store does no resolution of its own** and hands records through
 * verbatim. A consumer resolves the two ids by concept key: the
 * `assessment-error-adjacency` signal (`concept/corpusRelationSignals.ts`) and
 * the confusion-pairing reader (`olea-core`'s `concept/confusion-pairing/`)
 * both do. A consumer that looked ids up by name or alias would match no
 * record at all.
 */

import {
  calendarDayFromLocalDate,
  type McqMisconceptionPick,
  MISCONCEPTION_LOG_FOLDER,
  type MisconceptionEvent,
  type MisconceptionRecord,
  mergeMisconceptionEvents,
  misconceptionLogPath,
  parseMisconceptionLog,
  parseReviewLog,
  projectMisconceptionsFromAllSources,
  REVIEW_LOG_FOLDER,
  reviewLogPath,
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
        const probeDays = deps.probeDays ?? DEFAULT_LOG_PROBE_DAYS;

        const misconceptionPaths = await discoverLogPaths(
          deps.vault,
          MISCONCEPTION_LOG_FOLDER,
          misconceptionLogPath,
          deps.deviceId,
          today,
          probeDays,
        );

        const perFile: (readonly MisconceptionEvent[])[] = [];
        for (const path of misconceptionPaths) {
          const content = await deps.vault.read(path);
          perFile.push(parseMisconceptionLog(content).events);
        }

        const merged = mergeMisconceptionEvents(...perFile);

        // Stream B: every `misconception-observed` record across the review
        // log, mapped to `McqMisconceptionPick` — see the module doc's "TWO
        // STREAMS FOLDED" section.
        const reviewPaths = await discoverLogPaths(
          deps.vault,
          REVIEW_LOG_FOLDER,
          reviewLogPath,
          deps.deviceId,
          today,
          probeDays,
        );
        const mcqPicks: McqMisconceptionPick[] = [];
        for (const path of reviewPaths) {
          const content = await deps.vault.read(path);
          const parsed = parseReviewLog(content);
          for (const record of parsed.records) {
            if (record.kind !== 'misconception-observed') continue;
            mcqPicks.push({
              eventId: record.eventId,
              timestamp: record.timestamp,
              instrumentId: record.instrumentId,
              conceptIds: record.conceptIds,
              reviewEventId: record.reviewEventId,
              distractor: record.distractor,
            });
          }
        }

        return projectMisconceptionsFromAllSources(merged.events, mcqPicks);
      } catch {
        // "Could not read the vault" is not "no misconceptions" — same
        // honest-absence posture every other `today/data-source.ts` source
        // takes. See the module doc's null-vs-empty section.
        return null;
      }
    },
  };
}
