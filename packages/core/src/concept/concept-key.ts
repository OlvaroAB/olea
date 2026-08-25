/**
 * The provisional concept key seam (`ol-il6m`, C7.11, `[D-088]`, `[D-109]`).
 *
 * **The target, stated by the contract this seam is building toward
 * (C7.11): a concept's identity key is opaque, immutable, never displayed to
 * her, and — the clause's own words — "never derived from content, because a
 * content-derived key changes identity exactly when her material is most
 * alive."** This module does not yet deliver that. It mints a key that *is*
 * derived from content (her note's path, or failing that the topic string
 * itself), and it is honest about the gap rather than quiet about it — the
 * same shape `../session/instrument-id.ts` used for instrument identity
 * before D-030 ruled the stamped-identity mechanism: a pure, position/content
 * derived stand-in, visibly prefixed, that a later ruling replaces without
 * asking every caller of `ConceptIdSource` to change.
 *
 * **Why a stand-in ships at all, rather than waiting for the real mechanism.**
 * `ol-il6m`'s own investigation (see the bead's notes) found the real fix —
 * a persisted lookup, either a vault-frontmatter stamp on tier-1 bound notes
 * (`../uid/stamp.ts`'s `olea-uid`, extended to concept notes) or a replay of
 * review-log lineage events (F8.6) — needs machinery this module does not
 * own: vault writes, or a review-log read, neither of which
 * `packages/core/src/concept/` performs today. Blocking `ConceptRecord.key`
 * on that machinery would mean concept identity never gets a key field at
 * all, which is strictly worse than a key that is honestly not yet stable.
 * `[D-109]` (2026-08-25) is what makes shipping the stand-in *now* safe: it
 * rules that a review-log field's meaning may migrate in place while no real
 * user data exists, so this seam does not have to get the derivation right
 * on the first try the way it would once a semester of real history existed
 * under it.
 *
 * **What this stand-in DOES satisfy, and what it does NOT.** It is pure,
 * total and free of I/O — same key for the same input, every time, within one
 * run. It does NOT survive a rename: renaming a bound note changes its path,
 * which changes the derived key, which is exactly the orphaning C7.11's key
 * exists to end. That is the deliberately unclosed half — see the follow-up
 * bead this module's own doc points at (`ol-il6m`'s notes, "the deeper gap")
 * — and it is why `ConceptIdSource` (the seam type) is public API here
 * rather than a private implementation detail: a caller wanting stability
 * across a rename swaps `provisionalConceptKey` for a stamped source without
 * touching every mint site.
 */

import type { VaultPath } from '../vault/types.js';

/** Marks every key minted by the unruled derivation below — greppable in a review-log line, in a `ConceptRecord`, and in a bug report. */
export const PROVISIONAL_CONCEPT_KEY_PREFIX = 'concept-prov1';

/** What the provisional derivation needs to mint a key for one concept. */
export interface ConceptKeyInput {
  /**
   * Her exact display name for this concept (R1/R2, verbatim). Used only as
   * the last-resort derivation root, when there is no bound note — see the
   * module doc's honesty note: a key derived from `name` changes the instant
   * her wording does, which is the very failure C7.11's opaque key exists to
   * prevent. Never read for anything other than deriving the stand-in below.
   */
  readonly name: string;
  /**
   * The Zettelkasten note this concept is bound to (tier 1), or `null`. Used
   * ahead of `name` because a note path is at least a step further from her
   * wording than the topic string itself, even though it still moves on
   * rename — see the module doc.
   */
  readonly boundNotePath: VaultPath | null;
}

/**
 * The single seam. Everything that needs a concept key calls one of these and
 * nothing assembles a string itself — the same discipline
 * `../session/instrument-id.ts`'s `InstrumentIdSource` established for
 * instrument identity.
 */
export type ConceptKeySource = (input: ConceptKeyInput) => string;

/**
 * The provisional derivation (`[D-109]` unblocks shipping it; no ruling has
 * settled the persisted mechanism yet — see the module doc).
 *
 * Pure, total and free of I/O: same input, same key, always, within one run.
 * `boundNotePath` wins over `name` where both could apply, but neither is
 * stable across the edit that would matter (a note rename, a retitled
 * `topic:` value) — this derivation makes no claim otherwise.
 */
export const provisionalConceptKey: ConceptKeySource = (input) => {
  const root = input.boundNotePath ?? input.name;
  return `${PROVISIONAL_CONCEPT_KEY_PREFIX}:${root}`;
};
