/**
 * The provisional concept key seam (`ol-il6m`, C7.11, `[D-088]`, `[D-109]`), and — below,
 * `mintOpaqueConceptKey` — the opaque mint that closes `ol-bo48` (ONT-R1 `ol-2zfj.86`, ONT-R6
 * `ol-2zfj.88`, `[D-174]`).
 *
 * **The target, stated by the contract this seam is building toward
 * (C7.11): a concept's identity key is opaque, immutable, never displayed to
 * her, and — the clause's own words — "never derived from content, because a
 * content-derived key changes identity exactly when her material is most
 * alive."** `provisionalConceptKey` below does not deliver that — it mints a key that *is*
 * derived from content (her note's path, or failing that the topic string
 * itself), and it is honest about the gap rather than quiet about it — the
 * same shape `../session/instrument-id.ts` used for instrument identity
 * before D-030 ruled the stamped-identity mechanism: a pure, position/content
 * derived stand-in, visibly prefixed, that a later ruling replaces without
 * asking every caller of `ConceptIdSource` to change.
 *
 * **`mintOpaqueConceptKey` is that later ruling's mint, landed by `ol-bo48`.** ONT-R1/ONT-R6
 * named the residual gap in `[D-174]`'s persisted sidecar: the sidecar's persistence and
 * `[D-088]` conservation were already sound, but the minted `key` string itself was still her
 * note path or her verbatim wording. `./key-store.ts`'s `resolveConceptKey` now calls
 * `mintOpaqueConceptKey` — never `provisionalConceptKey` — on its genuine-mint path, so every
 * key persisted from this landing forward is a random nonce, carrying no meaning and derived
 * from nothing she wrote. `provisionalConceptKey` remains exactly what it always was: the
 * transient, content-derived, non-persisted stand-in `extractConcepts` falls back to when
 * `stampConceptKeys` is off (a call against the shared fixture vault, e.g.) — nothing about
 * that path writes a `ConceptKeyRecord`, so its content-derivation was never the opacity gap
 * `ol-bo48` names, and it is unchanged here.
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
 * The provisional derivation (`[D-109]` unblocked shipping it as a non-persisted stand-in;
 * `ol-bo48`/`mintOpaqueConceptKey` below is the persisted, opaque mint — see the module doc).
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

/**
 * Marks every key minted by the opaque scheme below (ONT-R1 `ol-2zfj.86`, ONT-R6 `ol-2zfj.88`,
 * `[D-174]`, `ol-bo48`) — the durable identity C7.11 requires: opaque, immutable, never
 * displayed to her, never derived from her content. Distinct from
 * `PROVISIONAL_CONCEPT_KEY_PREFIX` above, which keeps marking the transient, content-derived,
 * non-persisted stand-in — only the persisted mint (`./key-store.ts`'s `resolveConceptKey`, on
 * its genuine-mint path) uses this prefix.
 */
export const OPAQUE_CONCEPT_KEY_PREFIX = 'concept-key1';

/**
 * A source of randomness for `mintOpaqueConceptKey`. Injectable for deterministic tests, the
 * same shape `../uid/stamp.ts`'s `StampUidOptions.generateId` and
 * `../instrument/mcq-format.ts`'s `generateId` option already use for their own durable,
 * random-by-default ids.
 */
export type OpaqueKeyNonceSource = () => string;

/** Defaults to `crypto.randomUUID()` — the same primitive `../uid/stamp.ts`'s `stampUid` already uses to mint `olea-uid`. */
function defaultOpaqueKeyNonceSource(): string {
  return globalThis.crypto.randomUUID();
}

/**
 * Mints a durable, opaque concept key (`ol-bo48`, ONT-R1/ONT-R6, `[D-174]`): a random nonce —
 * a UUIDv4 by default — never a hash or transform of her content, her wording, or her note
 * path. `${OPAQUE_CONCEPT_KEY_PREFIX}:${nonce}`.
 *
 * **The only function in this package permitted to assemble a persisted `ConceptKeyRecord.key`
 * string.** `./key-store.ts`'s `resolveConceptKey` is its one caller, and only on the
 * not-found path — every other path in that module reads an existing key back verbatim rather
 * than minting again (the conservation property, `[D-088]`), so calling this twice for what
 * turns out to be the same real-world concept never happens by construction, not by luck.
 *
 * Content-independence, not determinism, is the property under test here: the default
 * generator is deliberately impure (two calls never coincidentally collide, which a
 * content-derived function could never promise), and `nonceSource` exists solely so a test can
 * assert the *shape* (`OPAQUE_CONCEPT_KEY_PREFIX` plus whatever the nonce source returns)
 * without asserting on real randomness.
 */
export function mintOpaqueConceptKey(
  nonceSource: OpaqueKeyNonceSource = defaultOpaqueKeyNonceSource,
): string {
  return `${OPAQUE_CONCEPT_KEY_PREFIX}:${nonceSource()}`;
}

/**
 * ONT-R1's mint-time normalisation (`ol-2zfj.86`, closed 2026-09-15, C7.11):
 * "a deterministic normalisation (Unicode and whitespace, case fold, a naive
 * plural fold, minimal punctuation; containment — 'shortened or lengthened
 * form' — excluded, no safe operating point) produces a lookup key that is
 * an INDEX over identities, never the identity itself."
 *
 * **This is that index, and only that.** It is a pure string transform used
 * to find CANDIDATE identity collisions at mint time — never to decide one.
 * Per the ruling, a normalisation collision *proposes, it never merges*: the
 * one caller today, `./key-store.js`'s `findNormalizationCollisions`, uses
 * this only to list other existing keys whose wording collides, and nothing
 * in this module or that one ever substitutes one key for another on the
 * strength of a match here. The opaque `key` field itself is untouched by
 * this function — that was the separate, now-landed `ol-bo48` question of
 * making `key` itself content-free, delivered by `mintOpaqueConceptKey`
 * above and out of this function's scope either way: this index stays a
 * lookup over identities, never the identity itself, regardless of how the
 * identity is minted.
 *
 * Steps, exactly the ones the ruling names and none beyond them:
 *
 * 1. **Unicode normalisation** (`NFKC`) — canonicalises composed/decomposed
 *    forms and compatibility variants (full-width characters, ligatures)
 *    onto one representation before anything else runs.
 * 2. **Whitespace normalisation** — trim, then collapse every run of
 *    whitespace to one space.
 * 3. **Case fold** — `toLocaleLowerCase()`.
 * 4. **Minimal punctuation stripping** — a small, named set of ASCII marks
 *    that carry no lexical content on their own (quotes, brackets, terminal
 *    punctuation, commas, colons/semicolons). Deliberately **not** hyphens
 *    or mid-word apostrophes: "co-occurrence" and "co occurrence" are left
 *    distinct, because the ruling calls this stripping "minimal," not
 *    exhaustive.
 * 5. **A naive plural fold** — strips one trailing "s" (never from "ss," and
 *    never from a string of length 1), exactly the scope the ruling names
 *    ("a naive plural fold") and nothing cleverer: no irregular-plural
 *    table, no stemming library.
 *
 * **Explicitly excluded, in the ruling's own words: containment.** Matching
 * "cell" as a substring of "cell biology" — a shortened or lengthened form —
 * is never attempted here, because the ruling found no safe operating point
 * for it. This function only ever normalises one whole string for later
 * *equality* comparison; it never does substring, prefix or suffix
 * matching, and callers must not build that on top of it.
 */
export function conceptIdentityNormalizationIndex(wording: string): string {
  let normalized = wording.normalize('NFKC').trim().replace(/\s+/g, ' ');
  normalized = normalized.toLocaleLowerCase();
  // Minimal punctuation stripping (step 4) — see the function doc for the
  // named exclusions (hyphens, mid-word apostrophes: `'` is deliberately
  // absent from this class).
  normalized = normalized
    .replace(/[.,;:!?"`()[\]{}]/g, '')
    .trim()
    .replace(/\s+/g, ' ');
  // Naive plural fold (step 5).
  if (normalized.length > 1 && normalized.endsWith('s') && !normalized.endsWith('ss')) {
    normalized = normalized.slice(0, -1);
  }
  return normalized;
}
