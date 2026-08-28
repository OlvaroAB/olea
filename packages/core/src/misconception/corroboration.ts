/**
 * The confusion-pairing corroboration reader, wired as a NAMED PRODUCTION
 * READER (`ol-2zfj.32`, `[D-130]` / `ol-2zfj.31`, from
 * `olea-service`'s `docs/direction/papers/confusion-pairing-home/PROPOSAL.md`
 * §3 option 1).
 *
 * **This is a thin wrapper, not a second implementation.** The actual join —
 * fold `RelationSet`'s `contrasts-with` entries against
 * `MisconceptionRecord[]` evidence, after name/alias resolution — was already
 * built, reviewed and tested by `ol-2zfj.20`:
 * `../concept/confusion-pairing/corroborate.js`'s `corroborateConfusionPairs`,
 * 16 tests, closed 2026-08-27. That bead's own close evidence records it was
 * deliberately left with **no production caller**, gated on `ol-2zfj.21`
 * (what "confusion pairing" is contracted to mean). `[D-130]` closes that
 * gate: corroboration-only, ordinary work, no clause needed. This module is
 * what makes the existing reader production-reachable (`[D-072]` clause 5),
 * plus the one behavioural fix production needs that the existing join does
 * not itself provide — see below. Re-deriving the join here would create two
 * divergent implementations of the same fold; that is the mistake this file
 * exists to avoid, not to make.
 *
 * **The honest-empty-input fix.** `corroborateConfusionPairs` unconditionally
 * maps every currently-served `contrasts-with` edge to a standing, so with
 * zero misconception records (today's real production state — the
 * misconception projection has zero real records in production, `ol-2zfj.27`
 * context) it would label **every single edge** `'uncorroborated'`. That is
 * not a measurement; it is "we never looked" dressed up as "we looked and
 * found nothing," and wiring it straight into production today would emit a
 * false retire-candidate for every `contrasts-with` edge that exists, purely
 * because the observation channel hasn't produced any data yet. This
 * function guards that case explicitly: **zero evidence-bearing
 * misconception records (`confusedWithConceptId !== null`) yields zero
 * verdicts, never a default `'noise-candidate'`.** `corroboration.spec.ts`
 * tests this directly.
 *
 * **Verdict naming.** `'noise-candidate'` is `corroborateConfusionPairs`'s
 * `'uncorroborated'` standing, renamed to match this bead's brief
 * ("noise-candidate (retire)") — an edge no observation ever confirms is a
 * candidate FOR retirement, not evidence that already retired it; nothing
 * here retires anything (no persistence, no surface, `[D-130]` explicit).
 * `'corroborated'` is `corroborateConfusionPairs`'s `'corroborated'` standing
 * unchanged. **Fact vs inference, stated plainly:** the contract's "each can
 * confirm the other" (knowledge model §5) is symmetric — the edge confirms
 * the observation exactly as much as the observation confirms the edge — so
 * this reader reports ONE mutual-confirmation state (`'corroborated'`) per
 * matched pair rather than inventing a further split over which side is
 * "the one being confirmed." A prior reading of this bead's brief considered
 * splitting `'corroborated'` by the edge's `triageStanding` (candidate vs
 * assertion, `[D-070]`) into "edge-corroborated" / "observation-corroborated"
 * halves; that split is not supported by anything in `[D-130]`'s ruling text
 * or the PROPOSAL memo's §3 option 1 and was dropped as invention rather than
 * measurement — flagged in this bead's report for review rather than shipped
 * silently.
 */

import { corroborateConfusionPairs } from '../concept/confusion-pairing/corroborate.js';
import type { ConfusionPairingConcept } from '../concept/confusion-pairing/types.js';
import type { RelationSet } from '../concept/relation.js';
import type { MisconceptionRecord } from './types.js';

export type { ConfusionPairingConcept } from '../concept/confusion-pairing/types.js';

/** `'corroborated'` — at least one misconception record evidences this pair. `'noise-candidate'` — none does, on the material handed to this run; a candidate FOR retirement, not a retirement (no persistence here). */
export type ConfusionPairingVerdictKind = 'corroborated' | 'noise-candidate';

/** One `contrasts-with` edge's corroboration verdict, as this reader reports it. */
export interface ConfusionPairingVerdict {
  /** `RelationSetEntry.key` — same fold identity `../concept/relation.js` uses. */
  readonly key: string;
  /** The edge's endpoints, carried through verbatim (symmetric type — order is the fold's, not a claim about direction). */
  readonly a: string;
  readonly b: string;
  readonly verdict: ConfusionPairingVerdictKind;
  /** Distinct misconception records (post-M1 merge) evidencing this pair, either direction. */
  readonly misconceptionRecordCount: number;
  /** Sum of `MisconceptionRecord.occurrenceCount` across those records. */
  readonly misconceptionOccurrenceCount: number;
}

/**
 * Corroborate every `contrasts-with` edge `relations` currently serves
 * against `records`' evidence of real confusion, resolved to concept names
 * via `concepts`' name/alias index (same identity-space convention
 * `../concept/confusion-pairing/types.js` documents).
 *
 * Pure: no I/O, no clock, no identity minting. Same inputs, same output.
 *
 * **Honest empty input.** Returns `[]` — not one `'noise-candidate'` verdict
 * per served edge — when `records` carries no evidence-bearing occurrence at
 * all (`confusedWithConceptId !== null` for none of them). See this module's
 * top doc for why: zero observations is "no opportunity to confirm or deny
 * yet," never itself evidence of absence.
 */
export function corroborateConfusionPairings(
  relations: RelationSet,
  records: readonly MisconceptionRecord[],
  concepts: readonly ConfusionPairingConcept[],
): readonly ConfusionPairingVerdict[] {
  const evidenceBearing = records.some((record) => record.confusedWithConceptId !== null);
  if (!evidenceBearing) return [];

  const result = corroborateConfusionPairs(relations, records, concepts);
  return result.entries.map((entry) => ({
    key: entry.key,
    a: entry.a,
    b: entry.b,
    verdict: entry.standing === 'corroborated' ? 'corroborated' : 'noise-candidate',
    misconceptionRecordCount: entry.misconceptionRecordCount,
    misconceptionOccurrenceCount: entry.misconceptionOccurrenceCount,
  }));
}
