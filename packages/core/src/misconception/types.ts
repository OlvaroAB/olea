/**
 * The misconception store's domain and event types (F5.6, knowledge model
 * §4.1, D-008, M1–M4, P4-T04).
 *
 * **Local event-sourcing, same as the review log (plan §7.1).** A
 * misconception's `statement`, `correction` and source citation cannot be
 * reconstructed retroactively (§4.1: "capture it from day one or lose it
 * permanently") — the same argument INV-4 makes for D7.1. So this directory
 * follows `../review-log/`'s shape deliberately: an append-only JSONL event
 * log is the truth, one file per day per device, and every read-facing shape
 * (`MisconceptionRecord`) is a **projection** folded from it by `./project.js`,
 * never a second source of truth. Discard the projection and `./project.js`
 * rebuilds it byte-for-byte from the same events — that rebuildability is
 * what keeps this a projection and not a database (plan §7.1's tripwire).
 *
 * **A deliberately separate stream from the review log, not a new `kind`
 * on it.** `../../contracts` (`packages/contracts/src/review-log.ts`) is
 * FROZEN and this task's ownership excludes touching it — D-020 built that
 * file's `kind` discriminator specifically so it *could* grow a third arm
 * later, and adding `kind: 'misconception'` there would be the more
 * consolidated design (one file per day per device instead of two, one
 * merge function instead of two). That is flagged as a proposed follow-up
 * decision rather than done here: see the bead report. Cost of adopting it
 * later is small — this module's events already carry everything a
 * `kind: 'misconception'` review-log arm would need, so migrating means
 * changing which schema validates a line already shaped the same way, not
 * re-deriving the data.
 *
 * **M4 — never leaves the device except transiently.** Nothing in this
 * directory performs network I/O: embedding computation is the injected
 * `MisconceptionEmbedder` port (mirrors `EmbeddingProvider` in
 * `../retrieval/types.js` — the Worker is a calculator, D-004), and the only
 * thing ever handed to a request is `./digest.js`'s bounded transient digest.
 * `./digest.spec.ts` and the module-wide fitness test in
 * `store.fitness.spec.ts` are the M4 tests the bead card asks for.
 */

import { OPAQUE_CONCEPT_KEY_PREFIX } from '../concept/concept-key.js';
import type { VaultPath } from '../vault/types.js';

/** Where in her material a statement or correction is grounded (mirrors `RetrievalChunk`'s citation shape, `../retrieval/types.js`). */
export interface SourceCitation {
  readonly path: VaultPath;
  readonly blockIndex: number;
}

/**
 * Which identity scheme a `MisconceptionRecord.conceptId`/`.confusedWithConceptId` value was
 * stamped under (`ol-2zfj.155`, `[D-088]`, C7.11). Every production writer today
 * (`./accepted-grading-observation.js`'s `resolveConceptId` seam) stamps a caller-chosen string
 * whose scheme is not otherwise recorded on the record itself — a future caller switching that
 * seam to `../concept/concept-key.js`'s opaque mint must not have its output silently reread as
 * if it had always been the older, name-keyed scheme, or vice versa. `'legacy-name'` is that
 * older scheme: a plain concept name/alias, or `../concept/concept-key.js`'s
 * `provisionalConceptKey` non-persisted stand-in — no misconception record has ever persisted
 * the latter, but it is still not the opaque scheme, so it classifies the same way.
 * `'opaque-key'` is `../concept/concept-key.js`'s `mintOpaqueConceptKey` output shape, the only
 * scheme `[D-088]`'s conservation property covers.
 */
export type MisconceptionConceptIdScheme = 'legacy-name' | 'opaque-key';

/**
 * Classifies one `conceptId`/`confusedWithConceptId` value by its literal shape — a pure
 * string-prefix test, no I/O, no lookup. `` `${OPAQUE_CONCEPT_KEY_PREFIX}:...` `` is the only
 * shape `mintOpaqueConceptKey` ever produces, so that prefix is the sole `'opaque-key'` case;
 * every other value (a plain name, an alias, or a stray `provisionalConceptKey` stand-in) reads
 * as `'legacy-name'`, the pre-migration scheme every production writer uses today. A reader
 * resolving a record's identity (e.g. `../concept/confusion-pairing/corroborate.js`) calls this
 * first and picks its lookup path by the result, rather than trying one lookup space and
 * silently treating a miss as "no such concept."
 */
export function classifyMisconceptionConceptIdScheme(id: string): MisconceptionConceptIdScheme {
  return id.startsWith(`${OPAQUE_CONCEPT_KEY_PREFIX}:`) ? 'opaque-key' : 'legacy-name';
}

/** §4.1's three-state lifecycle. Framing for each is centralised in `./framing.js` (M3) — never inlined at a call site. */
export const MISCONCEPTION_STATUSES = ['active', 'fading', 'resolved'] as const;
export type MisconceptionStatus = (typeof MISCONCEPTION_STATUSES)[number];

/**
 * R7's evidence hierarchy, restricted to the two kinds that may ever count as
 * resolution evidence (M2). Recognition (MCQ) is deliberately **not** a
 * member of this type — "not merely when she passes a related card" from the
 * bead's M2 clause is enforced here as a type, not a runtime check, the same
 * way `McqRating` makes `easy` unrepresentable for MCQ
 * (`../instrument/rating.js`).
 */
export type ResolutionEvidenceKind = 'recall' | 'explanation';

/** Schema version this build writes and is willing to read. See `../review-log/`'s versioning doc for why every event carries one from day one. */
export const MISCONCEPTION_EVENT_SCHEMA_VERSION = 1 as const;

interface MisconceptionEventCommon {
  readonly schemaVersion: 1;
  /** Stable unique id for this event; makes a two-device same-day append idempotent (mirrors D7.1's `eventId`). */
  readonly eventId: string;
  /** ISO-8601 with offset. The offset matters: "when did this happen" is local, same as the review log. */
  readonly timestamp: string;
  /** The instrument (an explain-back prompt, per F2.12 a repeated card failure) whose attempt surfaced or addressed this. */
  readonly originInstrumentId: string;
  /** The review-log `eventId` for the same attempt, when the caller has one. Null rather than omitted — explicit-null discipline, same reasoning as D7.1's `selectionContext`. */
  readonly originReviewEventId: string | null;
}

/**
 * One occurrence of a misconception (§4.1's `statement`/`correction`/
 * `confused-with`, surfaced by the grading pipeline — `ol-p4t02` — and
 * resolved to an id by `./events.js` **before** this is constructed).
 *
 * **`misconceptionId` is stamped by the client, never by the grader.** The
 * Worker is a stateless calculator (D-008) and has no notion of existing
 * misconception identity across calls; M1's fuzzy match runs locally, against
 * this store's own projection, in `./matcher.js`. `./events.js`'s
 * `buildObservationEvent` is the one place that decides whether a finding
 * reuses an existing id or mints a new one — see its doc for the conservative
 * threshold argument.
 */
// Distractor-level aggregation (ol-pjs7) is a proposal, not yet a schema
// change — see olea-service findings/pjs7-misconception-aggregation-proposal.md
// for the record-shape sketch and its dependency on ol-il6m's concept-key
// outcome. Nothing below is altered by that proposal.
export interface MisconceptionObservedEvent extends MisconceptionEventCommon {
  readonly kind: 'observed';
  readonly misconceptionId: string;
  readonly conceptId: string;
  /** §4.1: "the concept she conflates it with, when the grader identifies a pairwise confusion." Nullable, keyed on nothing. */
  readonly confusedWithConceptId: string | null;
  /** What she appears to believe, in her own words where possible (§4.1). */
  readonly statement: string;
  /** What the source actually says (§4.1), cited via `citation`. */
  readonly correction: string;
  readonly citation: SourceCitation;
}

/**
 * Evidence that she demonstrated correct understanding of a concept (M2).
 * Applies to every currently active/fading misconception on `conceptId` —
 * see `./project.js`'s doc for why resolution is per-concept rather than
 * per-misconception-id: the grader identifies errors on a concept, not
 * against a specific prior misconception id, so asking it to pick one would
 * invent a distinction the Worker has no way to make reliably.
 */
export interface MisconceptionResolutionEvidenceEvent extends MisconceptionEventCommon {
  readonly kind: 'resolution-evidence';
  readonly conceptId: string;
  readonly evidenceKind: ResolutionEvidenceKind;
}

export type MisconceptionEvent = MisconceptionObservedEvent | MisconceptionResolutionEvidenceEvent;

/**
 * The read-model (§4.1's shape) — what `./project.js` folds the event log
 * into. Never persisted as such; a cache of this shape (if one is ever added
 * for performance) must be rebuildable from the event log alone, per the
 * bead's own rebuildability requirement.
 */
export interface MisconceptionRecord {
  readonly id: string;
  /** `classifyMisconceptionConceptIdScheme`, above, tells a reader which identity scheme this value was stamped under — never assume from context. */
  readonly conceptId: string;
  /** Same identity-scheme caveat as `conceptId`, above; `null` still means "no confusion evidenced," not "unresolved." */
  readonly confusedWithConceptId: string | null;
  /** The most recent occurrence's wording — see `./project.js`'s doc on why the record tracks the latest phrasing while `occurrenceCount` preserves the full history. */
  readonly statement: string;
  readonly correction: string;
  /**
   * `null` for a record folded (in part or entirely) from a review-log
   * `misconception-observed` pick (`[D-202]`/`[D-220]`, `./store.js`, `ol-2zfj.70`)
   * — that stream's schema carries `distractor.source_says` as free text, never
   * a `{ path, blockIndex }` reference into her material, so there is nothing
   * honest to put here. `null` reads as "grounded in `correction`'s free text,
   * not a vault block," never as "no correction available." **Additive,
   * non-breaking:** this widens only the read-model shape — the PERSISTED
   * Stream A event (`MisconceptionObservedEvent.citation`, below) is
   * unchanged and still required; every existing writer/reader of that event
   * is unaffected.
   */
  readonly citation: SourceCitation | null;
  /** Timestamp of the first `observed` event that produced this id. */
  readonly firstSeen: string;
  /** Timestamp of the most recent `observed` event that produced this id. */
  readonly lastSeen: string;
  /** How many `observed` events matched to this id — §4.1's "how many times this has recurred." */
  readonly occurrenceCount: number;
  readonly status: MisconceptionStatus;
  /** The instrument that most recently surfaced or reinforced this record (§4.1's "origin"). */
  readonly originInstrumentId: string;
}

/**
 * The seam onto "compute embeddings for this text" (M1, D-004's "same local
 * pattern"). Deliberately a fresh, local interface rather than an import of
 * `../retrieval/types.js`'s `EmbeddingProvider` — that directory is a
 * concurrently-live lane's, and importing its *port* would create a coupling
 * this store does not need (it needs the shape, not the module). The
 * production implementation is the same Worker `retrieval.embed.v1` task
 * either port would call; nothing here assumes so.
 */
export interface MisconceptionEmbedder {
  embed(texts: readonly string[]): Promise<readonly EmbeddingVector[]>;
}

/** A dense embedding vector, full precision. Same shape as `../retrieval/types.js`'s `EmbeddingVector` — redeclared locally for the isolation reason above. */
export type EmbeddingVector = readonly number[];
