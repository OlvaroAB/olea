/**
 * The read-time reconciliation seam `[D-202]`'s own ruling text names
 * explicitly: "a never-matched record stays as written... reconciles at
 * read time, never by rewriting the event" (`ol-2zfj.70`; the trace that
 * found the gap is `findings/misconception-loop-2026-09.md`, olea-service,
 * private).
 *
 * ===========================================================================
 * THE GAP THIS CLOSES
 * ===========================================================================
 * Two misconception streams exist. **Stream A** is this directory's own
 * event log (`./events.js`/`./project.js`, knowledge-model §4.1's
 * `MisconceptionRecord`) — `occurrenceCount`, `status`, `confusedWithConceptId`,
 * read by `./digest.js` (the explain-back judge's context, C7.9/F5.6),
 * `./framing.js` (encouragement copy, F6.8) and `./corroboration.js`
 * (`contrasts-with` corroboration, C7.10). **Stream B** is a wrong MCQ pick
 * (`../review-log/write.ts`'s `appendMisconceptionObservedRecord`,
 * `misconceptionObservedLogRecordV5`, `[D-202]`/`[D-220]`) — written, and
 * read by one live consumer (`packages/plugin/src/review/strong-recall-wiring.ts`,
 * F2.21's third trigger), but never folded into Stream A's entity. So an
 * MCQ-origin misconception could never accumulate `occurrenceCount`, never
 * transition `status`, and never corroborate a `contrasts-with` edge — the
 * three things C7.9, F5.6 and C7.10 all name as what an observed
 * misconception is FOR. This file is that fold.
 *
 * **A projection, not a new persisted shape.** No vault I/O, no event
 * minted — pure data-in, data-out, same discipline `./project.js`'s doc
 * states for itself. Nothing here is written back to `.olea/misconceptions/`
 * or the review log; the read model is recomputed fresh every call from
 * whatever the caller already read off disk. **Wiring this function into a
 * vault-backed store that reads both logs (plugin's `createVaultMisconceptionStore`
 * and its review-log equivalent) is follow-up plugin-side work, named in
 * this bead's close notes, not done here** — `[D-072]`'s reachability
 * clause still applies to that follow-up, separately, once filed.
 *
 * ===========================================================================
 * IDENTITY: THE REVIEW-LOG RECORD'S OWN `misconceptionId` IS A HINT, NOT AN
 * ASSERTION (`[D-202]`)
 * ===========================================================================
 * The writer mints a FRESH id on every wrong pick, by design
 * (`../review-log/write.ts`'s own doc: "an MCQ pick has no such ambiguity...
 * there is nothing to match against at write time"). Using that id as this
 * fold's key would make every repeated pick of the exact same distractor a
 * brand-new record — the opposite of what `occurrenceCount` is for. Two
 * tiers decide the fold's real key, in order:
 *
 * 1. **M1 embedding match, when the caller supplies one**
 *    (`believesEmbeddings`/`candidateEmbeddings`, mirroring `./events.js`'s
 *    own `buildObservationEvent` options). The SAME conservative threshold
 *    (`./matcher.js`'s `DEFAULT_M1_THRESHOLD`) decides whether this pick's
 *    `distractor.believes` text is close enough to an EXISTING record's
 *    statement (Stream-A-origin, or a prior Stream-B pick already folded)
 *    to reabsorb into it — `matchExistingMisconception`'s existing contract,
 *    called with no new matching logic invented here.
 * 2. **A deterministic, content-derived fallback key** —
 *    `(instrumentId, conceptId, distractor.text)` — when no embedding is
 *    supplied for this pick, or nothing clears the threshold. The SAME
 *    literal distractor, on the SAME instrument, is not an ambiguous case
 *    the way a spoken explanation's wording is (the writer's own doc makes
 *    this point): two picks of one distractor are deterministically "the
 *    same misconception," no fuzzy comparison needed. This mirrors
 *    `./events.js`'s own no-embedder fallback shape (mint something safe
 *    rather than guess) — except this fallback is deterministic rather than
 *    random, because unlike a fresh explain-back id there IS a stable,
 *    content-derived handle available. **Never persisted** — recomputed
 *    fresh on every fold, the same "derived from content, not stored"
 *    discipline `[D-088]`'s `provisionalConceptKey` and `ol-pjs7`'s own
 *    sketch (`distractorKey`) already use.
 *
 * ===========================================================================
 * NO VAULT-BLOCK CITATION FOR AN MCQ-ORIGIN RECORD
 * ===========================================================================
 * Stream B's schema carries `distractor.source_says` — free text — never a
 * `{ path, blockIndex }` reference into her material; nothing upstream of
 * the review log records one for a wrong pick (`packages/core/src/instrument/
 * distractor-provenance-store.ts`'s `DistractorProvenanceEntry` confirms:
 * `text`/`believes`/`source_says` only, no path). `MisconceptionRecord.citation`
 * is widened to `SourceCitation | null` in `./types.js` for exactly this case
 * (see that file's doc) — an additive, non-breaking read-model change; the
 * persisted Stream A event shape is untouched, and grep confirms no
 * production reader dereferences `.citation` today.
 */

import type { MisconceptionMatchCandidate } from './matcher.js';
import { DEFAULT_M1_THRESHOLD, matchExistingMisconception } from './matcher.js';
import {
  foldMisconceptionObservations,
  type NormalizedMisconceptionFoldEntry,
  normalizeMisconceptionEvent,
} from './project.js';
import type { EmbeddingVector, MisconceptionEvent, MisconceptionRecord } from './types.js';

/**
 * One wrong MCQ pick, reduced to exactly the fields this fold needs.
 * Structurally satisfied by `packages/contracts`' `MisconceptionObservedLogRecordV5`
 * (a parsed review-log record can be passed straight through) — this file
 * deliberately does not import that type, so this directory's own fitness
 * boundary (`store.fitness.spec.ts`) stays independent of the contracts
 * package.
 */
export interface McqMisconceptionPick {
  readonly eventId: string;
  readonly timestamp: string;
  readonly instrumentId: string;
  readonly conceptIds: readonly string[];
  readonly reviewEventId: string;
  readonly distractor: {
    readonly text: string;
    readonly believes: string;
    readonly source_says: string;
  };
}

export interface ReconcileMisconceptionStreamsOptions {
  /** M1's threshold; defaults to `DEFAULT_M1_THRESHOLD`, same as `./events.js`. */
  readonly threshold?: number;
  /**
   * Precomputed embedding of `distractor.believes`, keyed by
   * `mcqObservationKey(pick, conceptId)` — one entry per `(pick, conceptId)`
   * pair the caller wants matched, not per pick. Omit an entry (or the whole
   * map) to skip matching for that pair; it then folds under the
   * deterministic fallback key (tier 2 above), never guesses.
   */
  readonly believesEmbeddings?: ReadonlyMap<string, EmbeddingVector>;
  /**
   * Embeddings for EXISTING candidate records this pick may reabsorb into —
   * already filtered to the relevant `conceptId` by the caller, exactly
   * `./events.js`'s own `candidates` option. Keyed by `MisconceptionRecord.id`.
   */
  readonly candidateEmbeddings?: ReadonlyMap<string, EmbeddingVector>;
}

/**
 * The `believesEmbeddings` lookup key for one `(pick, conceptId)` pair —
 * exported so a caller building the embeddings map keys it consistently.
 */
export function mcqObservationKey(pick: McqMisconceptionPick, conceptId: string): string {
  return `${pick.eventId}::${conceptId}`;
}

/** Tier 2's deterministic fallback key — see this module's doc. Never persisted. */
function mcqDistractorFallbackKey(pick: McqMisconceptionPick, conceptId: string): string {
  return `mcq-distractor:${JSON.stringify([pick.instrumentId, conceptId, pick.distractor.text])}`;
}

function resolveMcqMisconceptionId(
  pick: McqMisconceptionPick,
  conceptId: string,
  options: ReconcileMisconceptionStreamsOptions,
): string {
  const embedding = options.believesEmbeddings?.get(mcqObservationKey(pick, conceptId));
  if (embedding !== undefined && options.candidateEmbeddings !== undefined) {
    const candidates: MisconceptionMatchCandidate[] = [...options.candidateEmbeddings].map(
      ([id, candidateEmbedding]) => ({ id, embedding: candidateEmbedding }),
    );
    const matched = matchExistingMisconception(
      embedding,
      candidates,
      options.threshold ?? DEFAULT_M1_THRESHOLD,
    );
    if (matched !== null) return matched;
  }
  return mcqDistractorFallbackKey(pick, conceptId);
}

/**
 * Normalizes one Stream B pick into this fold's shared entry shape — one
 * entry per `conceptIds` element (an instrument can practise more than one
 * concept; each gets its own record, the same per-concept scoping
 * `resolution-evidence` already uses for Stream A). `eventId` is namespaced
 * per concept (`mcqObservationKey`) so a multi-concept pick cannot collide
 * with itself under the fold's own idempotency check.
 */
export function normalizeMcqPick(
  pick: McqMisconceptionPick,
  options: ReconcileMisconceptionStreamsOptions = {},
): readonly NormalizedMisconceptionFoldEntry[] {
  return pick.conceptIds.map((conceptId) => ({
    kind: 'observed' as const,
    eventId: mcqObservationKey(pick, conceptId),
    timestamp: pick.timestamp,
    misconceptionId: resolveMcqMisconceptionId(pick, conceptId, options),
    conceptId,
    confusedWithConceptId: null,
    statement: pick.distractor.believes,
    correction: pick.distractor.source_says,
    citation: null,
    originInstrumentId: pick.instrumentId,
  }));
}

/**
 * The merged read: Stream A's own event log plus Stream B's MCQ picks,
 * folded through the SAME chronological rule set (`./project.js`'s
 * `foldMisconceptionObservations`) into one `MisconceptionRecord[]` — what
 * `./digest.js`, `./corroboration.js` and `./framing.js` already consume
 * unchanged, since all three operate on `MisconceptionRecord[]` agnostic to
 * origin.
 *
 * **Interleaves rather than projects-then-merges.** A Stream A
 * `resolution-evidence` event downgrades an MCQ-origin record on the same
 * concept exactly as it would an explain-back-origin one, and in the right
 * chronological place relative to later MCQ picks — projecting each stream
 * separately and unioning the results would get that ordering wrong (a
 * pick that arrives, in wall-clock time, between two Stream A events must
 * be folded between them, not after both).
 */
export function projectMisconceptionsFromAllSources(
  streamAEvents: readonly MisconceptionEvent[],
  mcqPicks: readonly McqMisconceptionPick[],
  options: ReconcileMisconceptionStreamsOptions = {},
): readonly MisconceptionRecord[] {
  const streamAEntries = streamAEvents.map(normalizeMisconceptionEvent);
  const mcqEntries = mcqPicks.flatMap((pick) => normalizeMcqPick(pick, options));
  return foldMisconceptionObservations([...streamAEntries, ...mcqEntries]);
}
