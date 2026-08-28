/**
 * Relocation matching for `[D-093]`'s item clause: "re-location runs before
 * stranding — exact (whitespace-normalised) matches elsewhere in the vault
 * heal the citation silently; near-matches only propose a re-bind."
 *
 * This module decides `exact` / `near` / `none` from plain text — it never
 * searches the vault itself (core holds no vault access; a caller supplies
 * candidate texts it already found, e.g. by an exact-text or embedding
 * search over the corpus).
 *
 * **Whitespace normalisation only, deliberately narrower than row 1.4's
 * `canonicalizeForMateriality`.** That function also strips markdown markup
 * (headings, lists, emphasis) because row 1.4's question is "did the
 * FORMATTING change" for a whole file. This module's question is different:
 * "is this the SAME passage, moved" — stripping markup here would let a
 * genuinely different passage that merely shares plain wording (e.g. two
 * near-identical bullet items) read as the same one. Whitespace collapse
 * alone answers `[D-093]`'s own example ("moving a paragraph") without
 * reaching for that broader — and here, wrong — normalisation.
 */

import type { RelocationCandidate } from './types.js';

/** Collapses runs of whitespace to a single space and trims — the one normalisation `[D-093]`'s "whitespace-normalised" phrase names. */
export function normalizeWhitespace(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

/**
 * The near-match floor: the fraction of the OLD passage's normalised word
 * tokens that must also appear in a candidate for it to count as "similar
 * but not exact" rather than "unrelated." **Declared, not derived** (no
 * corpus of real relocations exists to fit against) — argued in plain
 * English per the component register's declared/derived rule: a candidate
 * sharing fewer than a third of the old passage's words is not "the same
 * passage with an edit," it is a different passage, and `[D-093]`'s own
 * text treats a near-match and an unrelated passage as different things
 * ("near-matches only propose a re-bind" implies a near-match is still
 * recognisably close). Flagged for retroactive review once real relocation
 * data exists to tune against, same posture `MATERIALITY_MIN_EDIT_CHARS`
 * states for its own declared default.
 */
export const RELOCATION_NEAR_MATCH_FLOOR = 1 / 3;

function tokenSet(text: string): ReadonlySet<string> {
  return new Set(
    normalizeWhitespace(text)
      .toLowerCase()
      .split(' ')
      .filter((token) => token.length > 0),
  );
}

/** Fraction of `a`'s tokens also present in `b` — asymmetric on purpose: "how much of the OLD passage survives in this candidate." */
function overlapRatio(a: ReadonlySet<string>, b: ReadonlySet<string>): number {
  if (a.size === 0) return 0;
  let shared = 0;
  for (const token of a) {
    if (b.has(token)) shared += 1;
  }
  return shared / a.size;
}

export type RelocationMatch =
  | { readonly kind: 'exact'; readonly candidate: RelocationCandidate }
  | { readonly kind: 'near'; readonly candidate: RelocationCandidate }
  | { readonly kind: 'none' };

/**
 * Classifies the best relocation match for `oldText` among `candidates`.
 * Exact match wins over any near match, whatever order candidates arrive
 * in; among near matches, the highest-overlap candidate is reported so a
 * caller proposing a re-bind proposes the best one available.
 */
export function classifyRelocation(
  oldText: string,
  candidates: readonly RelocationCandidate[],
): RelocationMatch {
  const normalizedOld = normalizeWhitespace(oldText);
  const oldTokens = tokenSet(oldText);

  let bestNear: { candidate: RelocationCandidate; overlap: number } | null = null;

  for (const candidate of candidates) {
    if (normalizeWhitespace(candidate.text) === normalizedOld) {
      return { kind: 'exact', candidate };
    }
    const overlap = overlapRatio(oldTokens, tokenSet(candidate.text));
    if (
      overlap >= RELOCATION_NEAR_MATCH_FLOOR &&
      (bestNear === null || overlap > bestNear.overlap)
    ) {
      bestNear = { candidate, overlap };
    }
  }

  return bestNear === null ? { kind: 'none' } : { kind: 'near', candidate: bestNear.candidate };
}
