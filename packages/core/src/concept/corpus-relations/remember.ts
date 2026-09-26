/**
 * Remembering a `'none'` or `'insufficient-evidence'` proposition result — `docs/dev/
 * intelligence-build/rel.md` §3's Default 3 (`olea-service`, `[D-297]`, `ol-egov.141.89.4.10`):
 * "a negative result is cached against the evidence digest of both endpoints' introducing
 * passages AND the judge policy that produced it... either changing re-opens the proposition for
 * judgment."
 *
 * **This is a stored shape `[D-297]` already rules in** ("a wire change and a stored record"),
 * elaborated here exactly as rel.md's own text says: an added field, never a new decision. It is
 * built as a pure, injectable-clock module — the same discipline `./remember.ts`'s sibling stages
 * use — so a caller (production or the harness) supplies its own persistence; this module holds no
 * vault access of its own (`../relation-cache.js`'s own pattern, restated for a record this bead's
 * `owns` newly introduces rather than reused, since a remembered negative and a cached positive
 * answer different questions and neither implies the other's shape).
 *
 * Pure: no I/O, no vault, no identity minting. `now` is always injected.
 */

import type { RelationType } from '../relation.js';
import type { EvidenceDigestPair, JudgePolicyKey } from './types.js';
import { judgePolicyKeysEqual } from './types.js';

/** One remembered negative or undecided result. Keyed identically to `RelationCacheRecord`'s own `propositionKey` shape (type + two opaque keys) — see this module's doc for why it is not literally that same type. */
export interface RememberedPropositionRecord {
  readonly type: RelationType;
  readonly fromKey: string;
  readonly toKey: string;
  readonly outcome: 'none' | 'insufficient-evidence';
  readonly evidenceDigest: EvidenceDigestPair;
  readonly judgePolicy: JudgePolicyKey;
  readonly recordedAt: string;
}

/**
 * Default 3: re-ask a proposition unless a remembered record exists AND both its evidence digest
 * and its judge policy still match exactly. `record === undefined` (never asked, or the prior
 * record was for a different proposition) always re-asks — the same "missing reads as unverified,
 * never as settled" posture rel.md's Default 4 states for freshness, applied here to negative
 * results instead of positive ones.
 */
export function shouldReaskProposition(
  record: RememberedPropositionRecord | undefined,
  currentEvidence: EvidenceDigestPair,
  currentJudgePolicy: JudgePolicyKey,
): boolean {
  if (record === undefined) return true;
  if (record.evidenceDigest.from !== currentEvidence.from) return true;
  if (record.evidenceDigest.to !== currentEvidence.to) return true;
  if (!judgePolicyKeysEqual(record.judgePolicy, currentJudgePolicy)) return true;
  return false;
}

/** Build the record `shouldReaskProposition` later reads back — the write side of Default 3. */
export function recordNegativeResult(input: {
  readonly type: RelationType;
  readonly fromKey: string;
  readonly toKey: string;
  readonly outcome: 'none' | 'insufficient-evidence';
  readonly evidenceDigest: EvidenceDigestPair;
  readonly judgePolicy: JudgePolicyKey;
  readonly now?: () => string;
}): RememberedPropositionRecord {
  const now = input.now ?? (() => new Date().toISOString());
  return {
    type: input.type,
    fromKey: input.fromKey,
    toKey: input.toKey,
    outcome: input.outcome,
    evidenceDigest: input.evidenceDigest,
    judgePolicy: input.judgePolicy,
    recordedAt: now(),
  };
}

/** A remembered record's own identity — restated from `../relation-cache.js`'s `propositionKey` shape rather than imported, so a lookup index can be built without this module depending on the cache module (kept independently closed, same reasoning `./verdict.ts`'s own doc gives for duplicating `./nominate.ts`'s pair-key helper). */
export function rememberedPropositionIdentity(type: RelationType, fromKey: string, toKey: string): string {
  return `${type} ${fromKey} ${toKey}`;
}

/** Index a list of remembered records by their identity, last-write-wins — the shape a caller reads `shouldReaskProposition` against. */
export function indexRememberedRecords(
  records: readonly RememberedPropositionRecord[],
): ReadonlyMap<string, RememberedPropositionRecord> {
  const index = new Map<string, RememberedPropositionRecord>();
  for (const record of records) {
    index.set(rememberedPropositionIdentity(record.type, record.fromKey, record.toKey), record);
  }
  return index;
}
