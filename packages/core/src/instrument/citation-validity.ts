/**
 * `[IL-D8]` row 2.9 (`ol-2zfj.147`, part 2) — a passage citation's current-validity read.
 *
 * The external review's disposition for row 2.9 (`docs/direction/20260921_intelligence_layer
 * _dossier/components-group2.md` section 2.9) asked for "explicit supersession or current-
 * validity status" on a passage citation. A prior attempt at this bead built that as a new
 * persisted field (`supersededAt`) plus a schema-version bump on `CitationRecord`
 * (`./citation-store.js`) — reversed by the orchestrator, because no decision bead covers a new
 * stored shape there. This module is the re-dispatch: the status is a PURE DERIVED READ over
 * facts that already exist, never a new persisted field and never a `CITATION_RECORD_SCHEMA_
 * VERSION` change. `./citation-store.js` itself is untouched by this bead.
 *
 * ===========================================================================
 * WHAT IT READS: TWO ALREADY-RULED FIELDS, FROM TWO DIFFERENT STORES
 * ===========================================================================
 * `[D-292]` (`ol-egov.141.89.2.7`, closed) put `passageDigest`/`sourceRevision` on
 * `InstrumentCitation` itself (`./citation-store.js`) — the digest of the cited passage's text,
 * and the source's own content-hash revision, both taken at draft time. `classifyCitationFreshness`
 * already compares that recorded digest against a caller-supplied current observation and answers
 * `'fresh'`/`'stale'`/`'unknown'`; this module's `citationValidityStatus` reuses that comparison
 * rather than duplicating it (see below).
 *
 * `[D-351]` (`ol-egov.141.89.5.12`, ruled 2026-09-25) put a PENDING-revalidation fact — a raw
 * digest mismatch not yet judged — on `CitationAnchorRecord` in the PLUGIN repo's
 * `packages/plugin/src/ingestion/materiality/citation-hash-store.ts`. That field is not built
 * yet (`ol-egov.141.89.5.4`, open); this module never imports that store (it is core, no plugin
 * dependency, and the field does not exist to import even if it could) and never persists a
 * second, competing pending fact of its own. Instead the pending fact arrives here as an
 * OPTIONAL INPUT, {@link CitationValidityEvidence.pendingRevalidation}, which whatever future
 * caller reads `CitationAnchorRecord` passes straight through. This keeps the two facts on their
 * two separate stores exactly as `[D-351]`'s ruling requires: this module never duplicates or
 * shadows the pending field, it only reads a value someone else already resolved.
 *
 * ===========================================================================
 * `[D-351]`'s SCOPING RULE, ENCODED IN THE CONTRACT (not merely a comment)
 * ===========================================================================
 * David's ruling: "the pending state belongs to the particular source revision being checked, so
 * a late result for an earlier edit never clears a newer pending state." This function has no
 * memory across calls — it cannot itself "clear" anything — so the ruling is encoded as a
 * matching rule: {@link CitationValidityEvidence.pendingRevalidation} is honoured ONLY when its
 * `sourceRevision` is exactly the citation's own recorded `sourceRevision` (the revision this
 * particular citation was drafted against, i.e. the revision actually being checked here). A
 * pending signal named for any other revision — earlier, later, or the citation has none recorded
 * at all — is never treated as applying to this citation: it neither raises `'pending'` nor
 * resolves it to `'current'`. That refusal to interpret revision-mismatched evidence is what stops
 * this function from ever being the channel through which a stale result for one revision
 * overrides a fact that belongs to another; see `citation-validity.spec.ts`'s
 * "[D-351] scoping" describe block.
 *
 * ===========================================================================
 * NEVER `'current'` BY DEFAULT
 * ===========================================================================
 * Every branch that lacks enough evidence to positively confirm the citation still matches its
 * source returns `'unknown'` (or `'pending'` when a revalidation is in flight) — never `'current'`.
 * `'current'` is returned only when a recorded `passageDigest` and a caller-supplied
 * `currentPassageDigest` both exist and agree. This mirrors `classifyCitationFreshness`'s own
 * "'unknown' is a genuine third answer, not 'assume fresh' wearing a different name" contract.
 */

import {
  classifyCitationFreshness,
  type InstrumentCitation,
} from './citation-store.js';

/**
 * The three-and-one states a consumer reads for one citation's current validity.
 * `'current'`: the caller's fresh observation matches what was recorded at draft time.
 * `'superseded'`: the caller's fresh observation disagrees with what was recorded.
 * `'pending'`: a revalidation for this citation's own source revision is in flight
 * (`[D-351]`) — the answer is deliberately withheld, not yet `'current'` or `'superseded'`.
 * `'unknown'`: neither of the above can be determined from the evidence given — a legacy
 * (pre-`[D-292]`) record, or no current observation supplied to compare against.
 */
export type CitationValidityStatus = 'current' | 'superseded' | 'pending' | 'unknown';

/** One `[D-351]` pending-revalidation signal, scoped to the source revision it was raised for. */
export interface PendingRevalidationEvidence {
  /**
   * The source revision this pending signal is about — the same revision-identifying value
   * `InstrumentCitation.sourceRevision` carries (`[D-292]`'s content-hash revision). Only ever
   * honoured by {@link citationValidityStatus} when it equals the citation's own
   * `sourceRevision`; see the module doc's "`[D-351]`'s scoping rule" section.
   */
  readonly sourceRevision: string;
  /** Whether a revalidation for that revision is currently outstanding (unresolved). */
  readonly isPending: boolean;
}

/**
 * The caller's current evidence about one citation — everything this module needs beyond the
 * stored {@link InstrumentCitation} itself. Both fields are independently optional: a caller with
 * no current passage observation, no pending-revalidation read, or neither, still gets a
 * well-defined (never fabricated) answer.
 */
export interface CitationValidityEvidence {
  /**
   * The caller's own fresh observation of the cited passage's digest, in the same digest space
   * `InstrumentCitation.passageDigest` was minted in. `undefined` means "no current observation
   * available" — never treated as agreement.
   */
  readonly currentPassageDigest?: string;
  /**
   * `[D-351]`'s pending-revalidation fact, for the revision the caller is checking right now.
   * `undefined` means "no pending information available" — never "confirmed not pending".
   */
  readonly pendingRevalidation?: PendingRevalidationEvidence;
}

export interface CitationValidityResult {
  readonly status: CitationValidityStatus;
  /** Plain-text explanation of why this status was reached — never omitted, for either a human reading a log or a test asserting on it. */
  readonly reason: string;
}

/**
 * Classify one citation's current validity — pure, no vault I/O, no persisted field, no schema
 * version. See the module doc for the full contract; in short: `'pending'` wins whenever
 * {@link CitationValidityEvidence.pendingRevalidation} is scoped to this citation's own
 * `sourceRevision` and reports `isPending: true`; otherwise the answer falls to comparing
 * `passageDigest` against `currentPassageDigest` via {@link classifyCitationFreshness}, mapping
 * its `'fresh'`/`'stale'`/`'unknown'` onto `'current'`/`'superseded'`/`'unknown'`.
 */
export function citationValidityStatus(
  citation: InstrumentCitation,
  evidence: CitationValidityEvidence = {},
): CitationValidityResult {
  const { currentPassageDigest, pendingRevalidation } = evidence;

  if (
    pendingRevalidation !== undefined &&
    pendingRevalidation.isPending &&
    citation.sourceRevision !== undefined &&
    pendingRevalidation.sourceRevision === citation.sourceRevision
  ) {
    return {
      status: 'pending',
      reason: `a [D-351] revalidation for source revision ${pendingRevalidation.sourceRevision} (this citation's own recorded revision) is outstanding; withheld until it resolves`,
    };
  }

  const freshness = classifyCitationFreshness(citation, currentPassageDigest);
  if (freshness === 'fresh') {
    return {
      status: 'current',
      reason: 'the current passage observation matches the digest recorded at draft time',
    };
  }
  if (freshness === 'stale') {
    return {
      status: 'superseded',
      reason: 'the current passage observation disagrees with the digest recorded at draft time',
    };
  }
  return {
    status: 'unknown',
    reason:
      citation.passageDigest === undefined
        ? 'this citation carries no passageDigest (a record written before [D-292])'
        : 'no current passage observation was supplied to compare against',
  };
}
