/**
 * The `[D-326]` unit manifest — the per-source-revision completeness record
 * this chain (`[ILB-PER-4]`, `docs/dev/intelligence-build/per.md` section 3
 * and section 7 decision 3, in the service repo) extends from `[D-294]`'s
 * base manifest (`ol-egov.141.89.3.6`): reading method, `partial` coverage,
 * the not-read reason, and producer provenance, plus the three conditions
 * the ruling itself adds:
 *
 *  - **Reading status and concept-extraction status are separate fields.**
 *    `UnitManifestEntry.readingState` says how far a unit was read;
 *    `conceptExtractionState` says, separately, whether concept extraction
 *    has run over it. Finishing the reading never marks extraction complete
 *    — the two fields are never derived from one another anywhere in this
 *    module (`manifest.spec.ts` tests this directly, in both directions).
 *  - **A partly read region keeps a stable identity, so reading can
 *    resume.** `stableUnitId` (`manifest.ts`) is a pure function of
 *    `sourcePath` and `page` alone — never of a pass number, a timestamp or
 *    a run id — so a region read `'partial'` on one pass and revisited on a
 *    later pass is the SAME entry, not a new one appended beside it.
 *  - **An unread or partially read region reads `'unknown'` to every
 *    consumer, never a claim that a concept is absent.** `absenceGroundingFor`
 *    (`manifest.ts`) is the one function a consumer may ask "can I treat a
 *    missing concept here as meaningful," and every state but a full
 *    `'read'` answers `'unknown'` — see that function's own doc.
 *
 * **What this module does not do.** It does not decide *when* a unit is
 * read (that is the `route`/`render`/`perceive` steps of per.md's pipeline
 * — this bead's job-runner files, wired separately) and it does not persist
 * anything: `UnitManifest` is a plain, serialisable value, and where it is
 * stored durably is a later wiring decision this file does not make (see
 * this bead's own report for what is left). `[D-196]`'s three grove-census
 * reasons are unchanged by this module; `../../source/unreadable.js` (this
 * bead's `owns`) is the one place this manifest and that census meet.
 */

import type { VaultPath } from '../../vault/types.js';

/** How a unit was, or would be, read. Mirrors per.md section 2's three methods. */
export type UnitReadMethod = 'text-layer' | 'image' | 'text-and-image';

/** The three closed unreadable reasons `vision.extract.v2` can report (`[D-325]`). Never a fourth. */
export type UnitUnreadableReason = 'blank-page' | 'not-legible' | 'no-text-on-page';

/** Why a unit sits at `'pending'` — resumable, never dropped (per.md section 3). */
export type UnitPendingReason = 'budget' | 'queued';

/**
 * Why a unit is `'failed'` — a structural or repeated-malformed problem,
 * distinct from `'unavailable'` (below), which is a transient outage and is
 * always retried, never counted the same way. Per.md section 3's `not read:
 * failed` reasons.
 */
export type UnitFailedReason =
  | 'render-failed'
  | 'type-not-accepted'
  | 'no-renderer-for-format'
  | 'malformed-response-twice';

/**
 * Task id, prompt version, model identity and an evidence digest — travels
 * with every model-produced state (INV-4, D7.3; per.md section 2's "shape"
 * rule, "producer provenance on every stored model output"). Present only
 * on a state a perception model actually produced (`'read'` by `'image'` or
 * `'text-and-image'`, and `'partial'`, and a model-reached `'unreadable'`);
 * a `'read'` by `'text-layer'` alone has no model to attribute, so it
 * carries none — see `UnitReadingState`'s own field doc.
 */
export interface UnitProducerProvenance {
  readonly task: string;
  readonly promptVersion: string;
  readonly modelIdentity: string;
  /** A digest of the image bytes read, never the bytes or any derived content (D-005). */
  readonly imageDigest: string;
}

/**
 * Every state a unit can be in — per.md section 3's four top-level states,
 * `read` / `partial` / `unreadable` / `not read`, with `not read` expanded
 * into its three named reasons (`'pending'`, `'unavailable'`, `'failed'`) as
 * distinct discriminants, so a consumer switching on `kind` cannot forget
 * one — the same "non-optional discriminant" discipline
 * `../../extract/types.js`'s `ExtractionOutcome` already uses for the
 * identical reason (cited in this module's own doc).
 */
export type UnitReadingState =
  | {
      readonly kind: 'read';
      readonly method: UnitReadMethod;
      /** Absent for a `'text-layer'`-only read: there is no model to attribute — see the type's own doc. */
      readonly provenance?: UnitProducerProvenance;
    }
  | {
      readonly kind: 'partial';
      readonly method: UnitReadMethod;
      /**
       * What the reading covered, in the model's own words — never invented
       * when the model did not name one (the same posture
       * `olea-service/src/tasks/visionExtract.ts`'s `COVERAGE_NOT_STATED`
       * takes for the identical gap on the wire shape this state is built
       * from).
       */
      readonly coverage: string;
      readonly provenance?: UnitProducerProvenance;
    }
  | {
      readonly kind: 'unreadable';
      readonly reason: UnitUnreadableReason;
      /** Present when a model reached a verdict (vision); absent for a structural, code-only unreadable call. */
      readonly provenance?: UnitProducerProvenance;
    }
  | { readonly kind: 'pending'; readonly reason: UnitPendingReason }
  | { readonly kind: 'unavailable' }
  | { readonly kind: 'failed'; readonly reason: UnitFailedReason; readonly retryable: boolean };

/**
 * Whether concept extraction has run over a unit's read material —
 * deliberately its OWN field, never derived from `readingState`
 * (`[D-326]`'s first condition). `'complete'` says extraction ran, not that
 * it found anything: a page read as empty prose still finishes extraction
 * with zero concepts, which is a different fact from never having tried.
 */
export type ConceptExtractionState = 'not-started' | 'complete';

/** One unit's whole record: its stable identity, its reading state, and its concept-extraction state, tracked apart. */
export interface UnitManifestEntry {
  readonly unitId: string;
  readonly sourcePath: VaultPath;
  readonly page: number;
  readonly readingState: UnitReadingState;
  readonly conceptExtractionState: ConceptExtractionState;
}

/** The whole completeness record for one source revision — `[D-294]`'s manifest, per unit. */
export interface UnitManifest {
  readonly sourcePath: VaultPath;
  readonly revisionDigest: string;
  readonly entries: readonly UnitManifestEntry[];
}
