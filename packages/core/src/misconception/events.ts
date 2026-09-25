/**
 * Pure event construction — the one place a caller's grading-pipeline output
 * becomes a `MisconceptionEvent`, with M1's matching decision already
 * resolved into an id. No I/O: `./write.js` is what appends the result to
 * the vault. Kept separate so the id-resolution decision (this file) is
 * unit-testable without a `VaultSource` in play, mirroring how
 * `../review-log/write.js` separates "what does this record contain" from
 * "how does it reach disk" (this file taking the first half, `./write.js`
 * the second).
 */

import type { MaterialityAuthorship } from '../source/materiality.js';
import { assertBeliefBearingStatement } from './belief-source.js';
import type { MisconceptionMatchCandidate } from './matcher.js';
import { DEFAULT_M1_THRESHOLD, matchExistingMisconception } from './matcher.js';
import {
  type EmbeddingVector,
  MISCONCEPTION_EVENT_SCHEMA_VERSION,
  type MisconceptionObservedEvent,
  type MisconceptionResolutionEvidenceEvent,
  type ResolutionEvidenceKind,
  type SourceCitation,
} from './types.js';

/** Every `MisconceptionObservedEvent` field the caller supplies; the builder stamps the rest. */
export interface ObservationInput {
  readonly conceptId: string;
  readonly confusedWithConceptId: string | null;
  readonly statement: string;
  readonly correction: string;
  readonly citation: SourceCitation;
  readonly originInstrumentId: string;
  readonly originReviewEventId: string | null;
  readonly timestamp: string;
  /**
   * `[D-101]`'s authorship fact for this statement's source prose (knowledge
   * model §4.1's statement field, amended `[D-101]`): `'hers'` admits;
   * `'not-hers'`/`'unknown'` both exclude, per `belief-source.ts`'s
   * `admitBeliefBearingStatement`. **Optional** — no production caller
   * supplies a real value yet. The observation path today
   * (`accepted-grading-observation.ts`'s `buildObservationEventsFromAcceptedGrading`,
   * called from `packages/plugin/src/grading/wiring.ts`'s
   * `computeAcceptExplainBackGradingWithObservation`) builds its candidates
   * from `AcceptedExplainBackGrading.misconceptionCandidates`
   * (`../grading/gradingPipeline.js`, not this directory's `owns`) with no
   * authorship fact attached anywhere upstream. The plugin caller that must
   * start supplying one is `packages/plugin/src/grading/wiring.ts` (or the
   * materiality wiring it already has under
   * `packages/plugin/src/ingestion/materiality/`), classifying the graded
   * answer's source prose via `classifyMateriality`/`resolveMateriality`
   * before building each `AcceptedGradingMisconceptionCandidate`. Omitting
   * this field leaves existing behaviour unchanged — see
   * `admitBeliefBearingStatement`'s own doc for why an absent fact admits
   * rather than guesses at an exclusion.
   */
  readonly statementAuthorship?: MaterialityAuthorship;
}

export interface BuildObservationEventOptions {
  /**
   * The new statement's embedding, computed by the caller's
   * `MisconceptionEmbedder` before calling this. **Omit the field entirely**
   * — never pass an empty array in its place — when no embedder is
   * available (F7.8: AI features grey out rather than half-work;
   * `MisconceptionEmbedder`'s only production implementation,
   * `./embedder.ts`'s `WorkerMisconceptionEmbedder`, needs a configured
   * Worker). See this function's doc for what omitting it does to the
   * matching decision (`ol-nagi`).
   */
  readonly statementEmbedding?: EmbeddingVector;
  /** Existing misconceptions eligible to reabsorb this occurrence — already filtered to `input.conceptId` by the caller (`./project.js`'s output, `active`/`fading` records, typically). */
  readonly candidates: readonly MisconceptionMatchCandidate[];
  /** M1's threshold. Defaults to the conservative `DEFAULT_M1_THRESHOLD`. */
  readonly threshold?: number;
  /** Event id generator, injectable for deterministic tests. Defaults to `crypto.randomUUID()`. */
  readonly generateEventId?: () => string;
  /** Misconception id generator for a genuinely new record, injectable for deterministic tests. Defaults to `crypto.randomUUID()`. */
  readonly generateMisconceptionId?: () => string;
}

export interface BuildObservationEventResult {
  readonly event: MisconceptionObservedEvent;
  /** Whether M1 matched an existing id (`true`) or minted a fresh one (`false`) — surfaced for callers/tests that want to assert on it directly rather than re-deriving it from `event.misconceptionId`. */
  readonly matchedExisting: boolean;
}

function defaultGenerateId(): string {
  return globalThis.crypto.randomUUID();
}

/**
 * Resolves M1's matching decision and returns a fully-formed
 * `MisconceptionObservedEvent`. This is the one call site that decides
 * "same misconception again" versus "a new one" — see `./matcher.js`'s doc
 * for why the threshold defaults conservative.
 *
 * **No-embedder fallback (`ol-nagi`).** When `options.statementEmbedding` is
 * omitted — no `MisconceptionEmbedder` was available to the caller — M1's
 * comparison never runs at all and this always mints a fresh id
 * (`matchedExisting: false`), regardless of what `options.candidates`
 * contains. This is the same conservative default the module doc already
 * argues for ("creating two records for one misunderstanding is a much
 * smaller harm than merging two distinct ones"), applied to the case where
 * there is nothing at all to compare rather than to a low-scoring
 * comparison — the honest response to "no similarity signal" is "record it
 * as new," never "guess."
 */
// See olea-service findings/pjs7-misconception-aggregation-proposal.md
// (ol-pjs7) for a proposed second construction path — an already-resolved
// misconceptionId from a distractor-binding lookup, bypassing M1 — for MCQ-
// origin selections. Proposal only; this function's contract is unchanged.
export function buildObservationEvent(
  input: ObservationInput,
  options: BuildObservationEventOptions,
): BuildObservationEventResult {
  // `[D-101]`: in front of the `statement` field below — defense-in-depth,
  // not the expected control flow. See `belief-source.ts`'s
  // `assertBeliefBearingStatement` doc for why a real production caller
  // gates earlier and never reaches this throw.
  assertBeliefBearingStatement(input.statementAuthorship);

  const threshold = options.threshold ?? DEFAULT_M1_THRESHOLD;
  const matchedId =
    options.statementEmbedding === undefined
      ? null
      : matchExistingMisconception(options.statementEmbedding, options.candidates, threshold);
  const generateEventId = options.generateEventId ?? defaultGenerateId;
  const generateMisconceptionId = options.generateMisconceptionId ?? defaultGenerateId;

  const misconceptionId = matchedId ?? generateMisconceptionId();

  const event: MisconceptionObservedEvent = {
    schemaVersion: MISCONCEPTION_EVENT_SCHEMA_VERSION,
    kind: 'observed',
    eventId: generateEventId(),
    timestamp: input.timestamp,
    originInstrumentId: input.originInstrumentId,
    originReviewEventId: input.originReviewEventId,
    misconceptionId,
    conceptId: input.conceptId,
    confusedWithConceptId: input.confusedWithConceptId,
    statement: input.statement,
    correction: input.correction,
    citation: input.citation,
  };

  return { event, matchedExisting: matchedId !== null };
}

/** Every `MisconceptionResolutionEvidenceEvent` field the caller supplies; the builder stamps the rest. */
export interface ResolutionEvidenceInput {
  readonly conceptId: string;
  readonly evidenceKind: ResolutionEvidenceKind;
  readonly originInstrumentId: string;
  readonly originReviewEventId: string | null;
  readonly timestamp: string;
}

export interface BuildResolutionEvidenceEventOptions {
  readonly generateEventId?: () => string;
}

/**
 * Builds a resolution-evidence event (M2). Unlike an observation, there is
 * no matching decision to make: the event names a concept, not a
 * misconception id, and `./project.js`'s fold applies it to every
 * `active`/`fading` record on that concept — see that module's doc for why.
 */
export function buildResolutionEvidenceEvent(
  input: ResolutionEvidenceInput,
  options: BuildResolutionEvidenceEventOptions = {},
): MisconceptionResolutionEvidenceEvent {
  const generateEventId = options.generateEventId ?? defaultGenerateId;
  return {
    schemaVersion: MISCONCEPTION_EVENT_SCHEMA_VERSION,
    kind: 'resolution-evidence',
    eventId: generateEventId(),
    timestamp: input.timestamp,
    originInstrumentId: input.originInstrumentId,
    originReviewEventId: input.originReviewEventId,
    conceptId: input.conceptId,
    evidenceKind: input.evidenceKind,
  };
}
