/**
 * The outcome-to-concept near-match proposal — `[D-256]` (`ol-2zfj.129`), ruling `[OUT-4]`
 * (`ol-2zfj.128`). Own record type, own folder, own status vocabulary, deliberately separate from
 * `../concept/same-as.ts`.
 *
 * **Why this is not a same-as link.** `same-as` is contracted (ONT-R1, the vocabulary registry's
 * "Same-as link" entry, `docs/Olea_knowledge_model.md` §3) to mean CONCEPT IDENTITY: two concept
 * identities a consumer reads as one, severable, neither side's evidence unioned. An outcome and a
 * concept are never that relationship — `[ONT-R5]`/F4.1 rules them "different entities, never the
 * same node read at a coarser grain": an outcome CONTAINS the concepts inferred from it, it is
 * never THE SAME THING as one of them. A near textual match (`./reconcile.ts`'s token-set
 * containment test) is evidence for attachment, not evidence of identity, so it is proposed here,
 * under its own vocabulary, rather than through `proposeSameAsLink` — which `[D-256]` ruled out
 * specifically because a consumer built to `same-as`'s contract (identity-only, no inspection of
 * key shape — `same-as.ts`'s own module doc disclaims that) has no principled way to reject an
 * outcome id reaching a `same-as` `'confirmed'` state, and `remapIncidentRelationCacheRecords`
 * would rewrite relation-cache edges using an outcome id as a concept key if one ever did.
 *
 * **Status vocabulary: `'proposed'` / `'confirmed'` / `'declined'` — deliberately no `'severed'`.**
 * `same-as`'s confirm/sever pair models undoing a READING of two identities as one, which needs a
 * separate "was read as one, now isn't" state. A near match is never read as identity in the first
 * place — confirming it means "this concept genuinely falls under this outcome" and declining it
 * means "it does not"; both are direct, terminal resolutions of the `'proposed'` candidate, not a
 * later reversal of one. There is nothing here to sever.
 *
 * **No score fields.** This record carries exactly the evidence `./reconcile.ts` already has for a
 * near match — the outcome id, the concept key, and the one reason its containment test can ever
 * produce — never a similarity score or any other number `[D-256]`'s ruling did not ask for.
 *
 * **Idempotent propose, keyed on the (outcome id, concept key) pair**, mirroring `same-as.ts`'s
 * `proposeSameAsLink`: this module's one automatic-signal entry point never transitions an
 * existing record and never writes a `'confirmed'` one. Unlike a same-as pair, this identity is
 * NOT symmetric — an outcome containing a concept is a directed relationship, so the pair is never
 * canonically sorted the way `same-as.ts`'s `canonicalPair` sorts two same-kind keys.
 *
 * **Persistence, mirroring `same-as.ts`'s own file layout.** One small JSON file per pair, under
 * its own dot-prefixed folder, written and read through the injected `VaultSource` port — never
 * into her authored notes (INV-6 Part one has nothing to say about `.olea/`, same argument
 * `same-as.ts` and `../outcome/store.ts` already make).
 *
 * **An existing decision is found by concept identity (`[D-378]`, `ol-egov.141.89.9.56`).** Two
 * same-anchor concept key records are one identity (`../concept/key-store.ts`'s canonical-key
 * index). `proposeOutcomeConceptNearMatch` treats a record for this outcome and any key of the
 * concept's identity as this pair's record, so a near match declined under a superseded
 * duplicate's key is not proposed again under the canonical key. Records keep the keys they were
 * written with; confirm and decline still address one record by its own pair.
 */

import {
  type ConceptKeyCanonicalIndex,
  readConceptKeyCanonicalIndex,
} from '../concept/key-store.js';
import { listFolder } from '../vault/list-folder.js';
import type { VaultPath, VaultSource } from '../vault/types.js';

/** The vault folder this module owns. Dot-prefixed, sibling to `.olea/same-as/` and `.olea/outcomes/` — its own folder, never a subfolder of either. */
export const OUTCOME_CONCEPT_NEAR_MATCH_FOLDER: VaultPath = '.olea/outcome-near-match';

export const OUTCOME_CONCEPT_NEAR_MATCH_RECORD_SCHEMA_VERSION = 1;

/**
 * `'proposed'` — a near match was found; nothing is attached yet. `'confirmed'` — a human (or a
 * later evidential read) decided the concept genuinely falls under the outcome; `./store.ts`'s
 * `attachConceptToOutcome` is a separate, later call this module does not make on a caller's
 * behalf. `'declined'` — decided it does not; the candidate is resolved and not re-proposed. There
 * is deliberately no `'severed'` state — see the module doc.
 */
export type OutcomeConceptNearMatchStatus = 'proposed' | 'confirmed' | 'declined';

/**
 * Why the pair was proposed. `'token-set-containment'` is the one test `./reconcile.ts` runs that
 * ever calls this module (its near-match bucket); a closed union of one member, the same
 * "a second reason is a decision, not an implementation detail" discipline `same-as.ts`'s own
 * `SameAsProposalReason` doc reserves for its sibling field.
 */
export type OutcomeConceptNearMatchReason = 'token-set-containment';

export interface OutcomeConceptNearMatchRecord {
  readonly outcomeId: string;
  readonly conceptKey: string;
  readonly status: OutcomeConceptNearMatchStatus;
  readonly reason: OutcomeConceptNearMatchReason;
  readonly proposedAt: string;
  readonly confirmedAt?: string;
  readonly declinedAt?: string;
  readonly schemaVersion: number;
}

/** This record's own file identity — directed (`outcomeId` first), never sorted: an outcome containing a concept is not a symmetric pair the way two concept identities are. */
function pairIdentity(outcomeId: string, conceptKey: string): string {
  return `${outcomeId} ${conceptKey}`;
}

export function outcomeConceptNearMatchRecordPath(
  outcomeId: string,
  conceptKey: string,
): VaultPath {
  return `${OUTCOME_CONCEPT_NEAR_MATCH_FOLDER}/${encodeURIComponent(pairIdentity(outcomeId, conceptKey))}.json`;
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}

export function isOutcomeConceptNearMatchRecord(
  value: unknown,
): value is OutcomeConceptNearMatchRecord {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Record<string, unknown>;
  if (!isNonEmptyString(v.outcomeId) || !isNonEmptyString(v.conceptKey)) return false;
  if (v.status !== 'proposed' && v.status !== 'confirmed' && v.status !== 'declined') return false;
  if (v.reason !== 'token-set-containment') return false;
  if (!isNonEmptyString(v.proposedAt)) return false;
  if (v.confirmedAt !== undefined && !isNonEmptyString(v.confirmedAt)) return false;
  if (v.declinedAt !== undefined && !isNonEmptyString(v.declinedAt)) return false;
  if (typeof v.schemaVersion !== 'number') return false;
  return true;
}

function serialize(record: OutcomeConceptNearMatchRecord): string {
  return `${JSON.stringify(record, null, 2)}\n`;
}

export async function listOutcomeConceptNearMatchRecords(
  vault: VaultSource,
): Promise<
  readonly { readonly path: VaultPath; readonly record: OutcomeConceptNearMatchRecord }[]
> {
  // `listFolder`, not `vault.list`: `ObsidianSource.list()` never sees a dot folder (`ol-egov.141.89.10.52`).
  const paths = await listFolder(vault, OUTCOME_CONCEPT_NEAR_MATCH_FOLDER, {
    extensions: ['json'],
  });
  const out: { readonly path: VaultPath; readonly record: OutcomeConceptNearMatchRecord }[] = [];
  for (const path of paths) {
    try {
      const parsed: unknown = JSON.parse(await vault.read(path));
      if (isOutcomeConceptNearMatchRecord(parsed)) out.push({ path, record: parsed });
    } catch {
      // Corrupt or unreadable file: skipped, never thrown — same posture as every sibling sidecar.
    }
  }
  return out;
}

async function findNearMatch(
  vault: VaultSource,
  outcomeId: string,
  conceptKey: string,
): Promise<
  { readonly path: VaultPath; readonly record: OutcomeConceptNearMatchRecord } | undefined
> {
  const path = outcomeConceptNearMatchRecordPath(outcomeId, conceptKey);
  if (!(await vault.exists(path))) return undefined;
  try {
    const parsed: unknown = JSON.parse(await vault.read(path));
    if (isOutcomeConceptNearMatchRecord(parsed)) return { path, record: parsed };
  } catch {
    // Corrupt: treated as absent, matching `listOutcomeConceptNearMatchRecords`'s posture.
  }
  return undefined;
}

function defaultNow(): string {
  return new Date().toISOString();
}

export interface ProposeOutcomeConceptNearMatchOptions {
  readonly now?: () => string;
  /**
   * `[D-378]`: the canonical-key index an existing decision is looked up through (module doc).
   * Read from the vault's `.olea/concepts/` store when omitted and the exact pair has no record.
   */
  readonly canonicalKeys?: ConceptKeyCanonicalIndex;
}

/**
 * A record for this outcome and another key of the same concept identity (`[D-378]`, module doc).
 * A decision outranks a pending proposal when there are several (the first `'confirmed'` or
 * `'declined'` record in listing order, else the first `'proposed'` one). `undefined` on a store
 * with no duplicates, without listing a single record.
 */
async function findNearMatchForIdentity(
  vault: VaultSource,
  outcomeId: string,
  conceptKey: string,
  canonicalKeys: ConceptKeyCanonicalIndex,
): Promise<
  { readonly path: VaultPath; readonly record: OutcomeConceptNearMatchRecord } | undefined
> {
  if (canonicalKeys.superseded.size === 0) return undefined;
  const canonicalKey = canonicalKeys.canonicalOf(conceptKey);
  const matches = (await listOutcomeConceptNearMatchRecords(vault)).filter(
    ({ record }) =>
      record.outcomeId === outcomeId &&
      canonicalKeys.canonicalOf(record.conceptKey) === canonicalKey,
  );
  return matches.find(({ record }) => record.status !== 'proposed') ?? matches[0];
}

/**
 * The one function `./reconcile.ts`'s near-match bucket may call. Writes a brand-new `'proposed'`
 * record only when none exists for this (outcome id, concept key) pair; otherwise a no-op that
 * returns the existing record unchanged — already `'proposed'` (do not re-propose), already
 * `'confirmed'` (already resolved as containment, nothing to propose), or already `'declined'`
 * (already resolved as not containment; a re-run finding the same token-set containment is not new
 * evidence). Mirrors `same-as.ts`'s `proposeSameAsLink` exactly, for the same idempotent-signal
 * reason.
 *
 * When this exact pair has no record, a record for the same outcome and another key of the
 * concept's identity is this pair's record (`[D-378]`, module doc) — the same no-op applies to it.
 * A brand-new record carries the keys as given; `./reconcile.ts` passes the canonical key.
 */
export async function proposeOutcomeConceptNearMatch(
  vault: VaultSource,
  outcomeId: string,
  conceptKey: string,
  options: ProposeOutcomeConceptNearMatchOptions = {},
): Promise<OutcomeConceptNearMatchRecord> {
  const now = options.now ?? defaultNow;
  const existing =
    (await findNearMatch(vault, outcomeId, conceptKey)) ??
    (await findNearMatchForIdentity(
      vault,
      outcomeId,
      conceptKey,
      options.canonicalKeys ?? (await readConceptKeyCanonicalIndex(vault)),
    ));
  if (existing !== undefined) return existing.record;

  const record: OutcomeConceptNearMatchRecord = {
    outcomeId,
    conceptKey,
    status: 'proposed',
    reason: 'token-set-containment',
    proposedAt: now(),
    schemaVersion: OUTCOME_CONCEPT_NEAR_MATCH_RECORD_SCHEMA_VERSION,
  };
  await vault.write(outcomeConceptNearMatchRecordPath(outcomeId, conceptKey), serialize(record));
  return record;
}

/**
 * The confirming read, recorded: "this concept genuinely falls under this outcome." **Never
 * mints** — a confirm with no existing `'proposed'` record is a caller error, mirroring
 * `same-as.ts`'s `confirmSameAsLink`. Idempotent: confirming an already-`'confirmed'` pair writes
 * nothing new. This function does not itself call `../outcome/store.ts`'s `attachConceptToOutcome`
 * — that is a separate, later step for whichever caller decides confirmation should also attach
 * (there is none yet; see the module doc and this bead's reachability note).
 */
export async function confirmOutcomeConceptNearMatch(
  vault: VaultSource,
  outcomeId: string,
  conceptKey: string,
  options: { readonly now?: () => string } = {},
): Promise<OutcomeConceptNearMatchRecord> {
  const now = options.now ?? defaultNow;
  const existing = await findNearMatch(vault, outcomeId, conceptKey);
  if (existing === undefined) {
    throw new Error(
      'confirmOutcomeConceptNearMatch: no proposed near-match record for this pair — a near ' +
        'match proposes, it never attaches on its own, so a confirm must follow an existing ' +
        'proposal.',
    );
  }
  if (existing.record.status === 'confirmed') return existing.record;
  if (existing.record.status === 'declined') {
    throw new Error(
      'confirmOutcomeConceptNearMatch: this pair was already declined — declined is a terminal ' +
        'resolution, not reopened by a later confirm.',
    );
  }

  const confirmed: OutcomeConceptNearMatchRecord = {
    ...existing.record,
    status: 'confirmed',
    confirmedAt: now(),
  };
  await vault.write(existing.path, serialize(confirmed));
  return confirmed;
}

/**
 * The declining read, recorded: "this concept does not fall under this outcome." **Never mints**,
 * same argument as `confirmOutcomeConceptNearMatch`. Idempotent: declining an already-`'declined'`
 * pair writes nothing new.
 */
export async function declineOutcomeConceptNearMatch(
  vault: VaultSource,
  outcomeId: string,
  conceptKey: string,
  options: { readonly now?: () => string } = {},
): Promise<OutcomeConceptNearMatchRecord> {
  const now = options.now ?? defaultNow;
  const existing = await findNearMatch(vault, outcomeId, conceptKey);
  if (existing === undefined) {
    throw new Error(
      'declineOutcomeConceptNearMatch: no proposed near-match record for this pair — a decline ' +
        'must follow an existing proposal.',
    );
  }
  if (existing.record.status === 'declined') return existing.record;
  if (existing.record.status === 'confirmed') {
    throw new Error(
      'declineOutcomeConceptNearMatch: this pair was already confirmed — confirmed is a terminal ' +
        'resolution, not reopened by a later decline.',
    );
  }

  const declined: OutcomeConceptNearMatchRecord = {
    ...existing.record,
    status: 'declined',
    declinedAt: now(),
  };
  await vault.write(existing.path, serialize(declined));
  return declined;
}
