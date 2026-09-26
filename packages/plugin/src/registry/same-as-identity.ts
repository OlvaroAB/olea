/**
 * `buildSameAsIdentityProposals` / `confirmSameAsIdentityProposal` /
 * `declineSameAsIdentityProposal` — the read-and-decide half of F8.4a's concept-identity
 * section (`[D-257]`, TRIAGE-6, `ol-egov.141.41`).
 *
 * **What this file is not.** It does not propose anything — nothing in this plugin calls
 * `proposeSameAsLink` yet (the "evidential read" automatic collision signal `key-store.ts`'s own
 * `normalizationCollisions` doc names as "not yet built"), so on today's vault this section reads
 * whatever `'proposed'` `SameAsLinkRecord`s already exist under `.olea/same-as/` and renders
 * nothing when there are none — an honest empty state, not a placeholder. This file is the
 * consumer the eventual propose-side signal will feed, built now so accept/decline have
 * somewhere real to land the moment it does.
 *
 * **Where the three displayed fields come from (F8.4a, "Each proposal shows exactly three
 * things").** A `SameAsLinkRecord` carries only two opaque keys — no name, course or passage of
 * its own (`same-as.ts`'s own doc: "code against the key as an opaque string"). This module
 * resolves both keys against the SAME `RegistryConceptEntry[]` the registry view already built
 * for this load (`provider.ts`'s `load()`), which already carries `displayName`, `courses` and
 * `sourceLocations` per key — reusing that walk rather than a second one over
 * `ConceptKeyRecord`/`listConceptKeyRecords`, which carries an anchor's PATH but no passage TEXT
 * and no course either.
 *
 * **"Passages... as excerpts" — a plain, bounded excerpt, not a second extraction pipeline.**
 * `RegistrySourceLocation` carries a block/heading/note grain, never the passage's own text
 * (`Provenance` doesn't carry text; only `ExtractedUnit.text` does, and nothing persists those).
 * `excerptForLocation` below reads the concept's own source note fresh and takes the paragraph at
 * its known grain (the block, then the heading, then the top of the note), collapsed to one line
 * and bounded by `IDENTITY_PROPOSAL_EXCERPT_CHAR_BUDGET` — the same "declared, not derived, a
 * plain-English defence rather than a guess dressed as one" posture `./wiring.ts`'s
 * `DEFAULT_MAX_PASSAGES_PER_READ` documents for its own budget, chosen only to keep one row
 * legible, never a signal any decision reads.
 *
 * **"A proposal that cannot show its passages is not shown" (F8.4a) is enforced here, not in the
 * view.** `buildSameAsIdentityProposals` drops a link whose either endpoint concept is not in
 * `concepts` (pruned out of this model's walk, or a key with no matching row at all — a
 * same-as-link production caller does not exist yet, so this cannot happen in practice today, but
 * the guard is the honest one regardless) or whose note cannot be read or yields no excerpt — the
 * view (`./view.ts`) never sees a proposal it could not fully resolve, so it never has to decide
 * whether to render a half-supported row.
 *
 * **Accept/decline call the core functions directly over `VaultSource` — no new persisted
 * shape.** `confirmSameAsIdentityProposal`/`declineSameAsIdentityProposal` are thin, directly
 * testable wrappers over `olea-core`'s `confirmSameAsLink`/`declineSameAsLink` (`ol-egov.141.33`
 * [TRIAGE-5]) — this file mints nothing and never re-derives their state-transition rules.
 *
 * **A link's keys are read by identity (`[D-378]`, `ol-egov.141.89.9.56`).** Two
 * `.olea/concepts/` records sharing an anchor are one identity, and the registry lists it once,
 * under its canonical key. `buildSameAsIdentityProposals` resolves both of a link's keys through
 * `olea-core`'s canonical-key index before looking them up, so a proposal recorded under a
 * superseded duplicate's key is shown against the canonical row. A link whose two keys are one
 * identity is never asked about (it already is one), and an identity pair is asked about at most
 * once, and not at all once any record for it is confirmed, declined or severed. The proposal
 * keeps the stored link's own keys, so accepting or declining transitions that record and no other;
 * no stored key is rewritten. Two concepts that share only an introducing passage are two
 * identities in the index and are shown as two rows.
 */

import {
  type ConceptKeyCanonicalIndex,
  confirmSameAsLink,
  declineSameAsLink,
  type RegistryConceptEntry,
  type RegistrySourceLocation,
  readConceptKeyCanonicalIndex,
  type SameAsLinkRecord,
  type VaultSource,
} from 'olea-core';

/**
 * Bounds one rendered excerpt. DECLARED, not derived (see this module's doc) — chosen only to
 * keep one identity-section row legible; not a threshold any accept/decline decision reads, and
 * moving it is a plain Class B UI tuning, never a Class C stop.
 */
export const IDENTITY_PROPOSAL_EXCERPT_CHAR_BUDGET = 240;

export interface SameAsIdentityPassage {
  readonly location: RegistrySourceLocation;
  readonly excerpt: string;
}

/**
 * One concept-identity proposal, fully resolved and ready to render — F8.4a's exact three
 * fields, per side. No score, no confidence, no `evidenceFingerprint`: this shape structurally
 * cannot carry one, matching the clause's "nothing is shown as a score."
 */
export interface SameAsIdentityProposal {
  /** The stored link's own keys, as written — what accept and decline address; the rows shown are resolved by identity (module doc). */
  readonly keyA: string;
  readonly keyB: string;
  readonly nameA: string;
  readonly nameB: string;
  readonly coursesA: readonly string[];
  readonly coursesB: readonly string[];
  readonly passageA: SameAsIdentityPassage;
  readonly passageB: SameAsIdentityPassage;
}

function escapeForRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** The first non-empty, whitespace-collapsed paragraph of `content`, or `''` if there is none. */
function firstNonEmptyParagraph(content: string): string {
  for (const paragraph of content.split(/\n\s*\n/)) {
    const collapsed = paragraph.replace(/\s+/g, ' ').trim();
    if (collapsed.length > 0) return collapsed;
  }
  return '';
}

/**
 * The note text at `location`'s known grain: the block bearing `^blockId` when one is recorded,
 * else the section starting at `heading`, else the top of the note — mirroring the fallback order
 * `[D-171]`'s own click-through (`obsidian-ports.ts`'s `sourceLocationLinktext`) already uses for
 * "open," applied here to "read," so the excerpt and the note the `Open` affordance lands on are
 * always the same passage.
 */
function excerptFromNote(content: string, location: RegistrySourceLocation): string {
  let body = content;
  if (location.blockId) {
    const marker = `^${location.blockId}`;
    const markerIndex = content.indexOf(marker);
    if (markerIndex !== -1) {
      const paragraphStart = content.lastIndexOf('\n\n', markerIndex);
      body = content.slice(paragraphStart === -1 ? 0 : paragraphStart, markerIndex);
    }
  } else if (location.heading) {
    const headingPattern = new RegExp(`^#{1,6}\\s+${escapeForRegExp(location.heading)}\\s*$`, 'm');
    const match = headingPattern.exec(content);
    if (match) body = content.slice(match.index + match[0].length);
  }

  const paragraph = firstNonEmptyParagraph(body);
  if (paragraph.length === 0) return '';
  return paragraph.length > IDENTITY_PROPOSAL_EXCERPT_CHAR_BUDGET
    ? `${paragraph.slice(0, IDENTITY_PROPOSAL_EXCERPT_CHAR_BUDGET).trimEnd()}…`
    : paragraph;
}

/**
 * `undefined` means "cannot show this concept's passage" (F8.4a: "a proposal that cannot show its
 * passages is not shown") — no source location at all, the note is unreadable (deleted, moved),
 * or the resolved grain yields no text to excerpt.
 */
async function passageForConcept(
  vault: VaultSource,
  entry: RegistryConceptEntry,
): Promise<SameAsIdentityPassage | undefined> {
  const location = entry.sourceLocations[0];
  if (location === undefined) return undefined;

  let content: string;
  try {
    content = await vault.read(location.sourcePath);
  } catch {
    return undefined;
  }

  const excerpt = excerptFromNote(content, location);
  if (excerpt === '') return undefined;
  return { location, excerpt };
}

/** Each key as itself — the reading when the concept store cannot be read (see below). */
const KEYS_AS_STORED: ConceptKeyCanonicalIndex = {
  canonicalOf: (key) => key,
  superseded: new Map(),
};

export interface BuildSameAsIdentityProposalsOptions {
  /**
   * `[D-378]`: the canonical-key index a link's keys are resolved through (module doc). Read from
   * the vault's `.olea/concepts/` store when omitted and there is a proposal to resolve; when that
   * store cannot be read, each key reads as itself, the same reading a key the store holds no
   * record for already gets, and the passage rule below still decides what is shown.
   */
  readonly canonicalKeys?: ConceptKeyCanonicalIndex;
}

/** One unordered identity pair, as a map key. */
function identityPairKey(a: string, b: string): string {
  return JSON.stringify(a < b ? [a, b] : [b, a]);
}

/**
 * Every currently-`'proposed'` same-as link that can show its passages, resolved against
 * `concepts` — the F8.4a identity section's whole read side. See this module's doc for why an
 * empty result is the honest, expected answer until a propose-side signal exists, and for how a
 * link's keys are read by identity (`[D-378]`).
 */
export async function buildSameAsIdentityProposals(
  vault: VaultSource,
  links: readonly SameAsLinkRecord[],
  concepts: readonly RegistryConceptEntry[],
  options: BuildSameAsIdentityProposalsOptions = {},
): Promise<readonly SameAsIdentityProposal[]> {
  if (!links.some((link) => link.status === 'proposed')) return [];
  const canonicalKeys =
    options.canonicalKeys ??
    (await readConceptKeyCanonicalIndex(vault).catch(() => KEYS_AS_STORED));
  const canonicalOf = (key: string): string => canonicalKeys.canonicalOf(key);

  // One row per identity: the row under the canonical key itself, else the first row of it.
  const byKey = new Map<string, RegistryConceptEntry>();
  for (const entry of concepts) {
    if (canonicalOf(entry.key) === entry.key) byKey.set(entry.key, entry);
  }
  for (const entry of concepts) {
    const key = canonicalOf(entry.key);
    if (!byKey.has(key)) byKey.set(key, entry);
  }

  // An identity pair any record has already settled — confirmed, declined or severed.
  const settled = new Set<string>();
  for (const link of links) {
    if (link.status === 'proposed') continue;
    settled.add(identityPairKey(canonicalOf(link.keyA), canonicalOf(link.keyB)));
  }

  const proposals: SameAsIdentityProposal[] = [];
  const shown = new Set<string>();
  for (const link of links) {
    if (link.status !== 'proposed') continue;

    const keyA = canonicalOf(link.keyA);
    const keyB = canonicalOf(link.keyB);
    if (keyA === keyB) continue;
    const pair = identityPairKey(keyA, keyB);
    if (settled.has(pair) || shown.has(pair)) continue;

    const a = byKey.get(keyA);
    const b = byKey.get(keyB);
    if (a === undefined || b === undefined) continue;

    const [passageA, passageB] = await Promise.all([
      passageForConcept(vault, a),
      passageForConcept(vault, b),
    ]);
    if (passageA === undefined || passageB === undefined) continue;

    shown.add(pair);
    proposals.push({
      keyA: link.keyA,
      keyB: link.keyB,
      nameA: a.displayName,
      nameB: b.displayName,
      coursesA: a.courses,
      coursesB: b.courses,
      passageA,
      passageB,
    });
  }

  return proposals;
}

/** F8.4a's accept — "Are these one thing?" answered yes. Confirms the underlying link (`[D-257]` ruling 3); records nothing about her beyond that fact. */
export async function confirmSameAsIdentityProposal(
  vault: VaultSource,
  proposal: SameAsIdentityProposal,
): Promise<void> {
  await confirmSameAsLink(vault, proposal.keyA, proposal.keyB);
}

/**
 * F8.4a's decline — "Are these one thing?" answered no, for now. A hard labelled negative on this
 * proposal, never a claim that the two concepts differ, and never state about her
 * (`declineSameAsLink`'s own doc / `[D-257]` ruling 3): it records `declinedAt` and whatever
 * `evidenceFingerprint` the underlying record already carries, so the same pair can only return
 * once its evidence has meaningfully changed (`[D-093]`, `proposeSameAsLink`'s own reopen rule) —
 * nothing this function does chooses when that is.
 */
export async function declineSameAsIdentityProposal(
  vault: VaultSource,
  proposal: SameAsIdentityProposal,
): Promise<void> {
  await declineSameAsLink(vault, proposal.keyA, proposal.keyB);
}
