/**
 * Which stored Outcome record each extracted outcome candidate is — `[D-477]`
 * (`ol-egov.141.89.7.53`, option (a)), built under `ol-egov.141.89.7.43`.
 *
 * **The problem.** An outcome's source reference was `path` plus `blockIndex`, and a block is a
 * whole unit of one delivery: a PDF page, a DOCX paragraph, a PPTX slide. One objectives page
 * usually states several outcomes, so `path` plus `blockIndex` cannot tell them apart, and matching
 * on it alone folded every outcome on a page onto one record.
 *
 * **The discriminator.** Each newly minted record carries `source.labelDigest`, a digest of the
 * outcome's own wording after normalisation (`normalizeOutcomeLabel`: Unicode NFKC, lower case,
 * each run of punctuation or symbol characters to one space, whitespace runs to one space,
 * trimmed), SHA-256 over its UTF-8 bytes, stored as `v1:<hex>`; `v1` names this normalisation. It
 * is never an id (`OutcomeRecord.id` stays a random nonce) and it is computed by the store from the
 * label it mints with, never taken from a caller.
 *
 * **The matching rule.** A candidate is only ever compared with stored records on the same `path`
 * and `blockIndex`. Candidates with one normalised wording on one block are one wording group and
 * always resolve together (one outcome stated twice is one outcome). Each group then, in order:
 *  1. **Exact.** A stored record whose wording key equals the group's digest. The wording key is
 *     the record's `labelDigest`, or — for a record minted before the field existed — the digest
 *     of its stored `label`, computed when read. Several stored records with one key: the earliest
 *     minted, then the lowest id, is returned, and none of them can be claimed in step 2.
 *  2. **Near.** Token-set Jaccard of the normalised wordings at or above
 *     `OUTCOME_LABEL_NEAR_MATCH_THRESHOLD`, against the block's records no group took in step 1.
 *     Greedy, highest score first (ties: group order, then record order), one record per group and
 *     one group per record. Only records that were stored before this call take part, so two
 *     wordings in one extraction never fold together.
 *  3. **Mint.** Every group still unmatched mints one record (the store does that, not this file).
 *
 * **Records minted before the discriminator** keep matching on `path` and `blockIndex`, as
 * `[D-477]` ruled, and then by the label every one of them stores — no migration, no rewrite. They
 * are claimed by one wording at most (step 1 needs an equal normalised wording, step 2 is one to
 * one), so the rest of their block mints its own records and the page-level collapse cannot come
 * back. A record no wording matches is left unclaimed and unchanged. There is deliberately no
 * positional fallback (a block's only old record going to its only unmatched candidate): that is
 * how a different outcome, or a unit from another job that also numbers from 0, would inherit a
 * record whose label says something else.
 *
 * **Why 0.8.** The threshold and normalisation are the ones the stability measurement behind
 * `[D-477]` declared before it computed anything (its record is in olea-service): the rule's match
 * count was flat from 0.6 to 0.8, and no two different outcomes on one page came near enough to
 * merge at any threshold swept. It is a development default, not a fitted number, and it is not
 * persisted: moving it rewrites no record.
 *
 * Pure apart from hashing: no vault, no clock.
 */

import { hashText } from '../ingestion/hash.js';
import type { VaultPath } from '../vault/types.js';
import type { OutcomeRecord } from './types.js';

/** Names `normalizeOutcomeLabel` as it stands; the prefix of every `labelDigest` it produces. */
export const OUTCOME_LABEL_DIGEST_VERSION = 'v1';

/** Step 2's floor (module doc): token-set Jaccard of two normalised wordings. Not persisted. */
export const OUTCOME_LABEL_NEAR_MATCH_THRESHOLD = 0.8;

/** The wording an outcome's identity is read from — see the module doc for each step. */
export function normalizeOutcomeLabel(label: string): string {
  return label
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[\p{P}\p{S}]+/gu, ' ')
    .replace(/\s+/gu, ' ')
    .trim();
}

/** `source.labelDigest` for `label`: `v1:` plus the SHA-256 hex of its normalised wording. */
export async function outcomeLabelDigest(label: string): Promise<string> {
  return `${OUTCOME_LABEL_DIGEST_VERSION}:${await hashText(normalizeOutcomeLabel(label))}`;
}

function tokenSet(label: string): ReadonlySet<string> {
  return new Set(
    normalizeOutcomeLabel(label)
      .split(' ')
      .filter((token) => token.length > 0),
  );
}

/** Token-set Jaccard of two wordings after normalisation; 0 when either has no tokens. */
export function outcomeLabelJaccard(a: string, b: string): number {
  const tokensA = tokenSet(a);
  const tokensB = tokenSet(b);
  if (tokensA.size === 0 || tokensB.size === 0) return 0;
  let shared = 0;
  for (const token of tokensA) if (tokensB.has(token)) shared += 1;
  return shared / (tokensA.size + tokensB.size - shared);
}

/** A stored record with its wording key: its `labelDigest`, or its label's digest when it has none. */
export interface KeyedOutcomeRecord {
  readonly record: OutcomeRecord;
  readonly key: string;
}

/** One candidate to resolve: where it was found, its wording, and that wording's digest. */
export interface OutcomeIdentityCandidate {
  readonly source: { readonly path: VaultPath; readonly blockIndex: number };
  readonly label: string;
  readonly digest: string;
}

/**
 * One wording group (module doc): the candidates, by index into the input, that share one block and
 * one normalised wording, and the stored record they resolve to — `undefined` when the group mints.
 */
export interface OutcomeIdentityGroup {
  readonly members: readonly number[];
  readonly match: { readonly record: OutcomeRecord; readonly how: 'exact' | 'near' } | undefined;
}

/** One string per (path, blockIndex): the only records a candidate is ever compared with share it. */
export function outcomeSourceBlockKey(source: {
  readonly path: VaultPath;
  readonly blockIndex: number;
}): string {
  return JSON.stringify([source.path, source.blockIndex]);
}

/** Earliest minted first, then lowest id: a fixed order however the store happens to list. */
function compareStored(a: KeyedOutcomeRecord, b: KeyedOutcomeRecord): number {
  if (a.record.mintedAt !== b.record.mintedAt)
    return a.record.mintedAt < b.record.mintedAt ? -1 : 1;
  if (a.record.id !== b.record.id) return a.record.id < b.record.id ? -1 : 1;
  return 0;
}

/**
 * Applies the module doc's three steps to one batch of candidates against the records stored
 * before it. Returns one group per distinct (block, wording), in the order each group's first
 * candidate appears; every candidate index is in exactly one group.
 */
export function matchOutcomeCandidates(
  stored: readonly KeyedOutcomeRecord[],
  candidates: readonly OutcomeIdentityCandidate[],
): readonly OutcomeIdentityGroup[] {
  const ordered = [...stored].sort(compareStored);
  const storedByBlock = new Map<string, KeyedOutcomeRecord[]>();
  for (const entry of ordered) {
    const key = outcomeSourceBlockKey(entry.record.source);
    const onBlock = storedByBlock.get(key);
    if (onBlock) onBlock.push(entry);
    else storedByBlock.set(key, [entry]);
  }

  const groups: { block: string; digest: string; label: string; members: number[] }[] = [];
  const groupByWording = new Map<string, (typeof groups)[number]>();
  candidates.forEach((candidate, index) => {
    const block = outcomeSourceBlockKey(candidate.source);
    const wording = JSON.stringify([block, candidate.digest]);
    const existing = groupByWording.get(wording);
    if (existing) {
      existing.members.push(index);
      return;
    }
    const group = { block, digest: candidate.digest, label: candidate.label, members: [index] };
    groups.push(group);
    groupByWording.set(wording, group);
  });

  const matches: (OutcomeIdentityGroup['match'] | undefined)[] = groups.map(() => undefined);
  const taken = new Set<KeyedOutcomeRecord>();

  // Step 1 — exact.
  groups.forEach((group, groupIndex) => {
    const sameWording = (storedByBlock.get(group.block) ?? []).filter(
      (entry) => entry.key === group.digest,
    );
    const [first] = sameWording;
    if (first === undefined) return;
    matches[groupIndex] = { record: first.record, how: 'exact' };
    for (const entry of sameWording) taken.add(entry);
  });

  // Step 2 — near, greedy and one to one.
  const pairs: { score: number; groupIndex: number; order: number; entry: KeyedOutcomeRecord }[] =
    [];
  groups.forEach((group, groupIndex) => {
    if (matches[groupIndex] !== undefined) return;
    for (const entry of storedByBlock.get(group.block) ?? []) {
      if (taken.has(entry)) continue;
      const score = outcomeLabelJaccard(group.label, entry.record.label);
      if (score >= OUTCOME_LABEL_NEAR_MATCH_THRESHOLD) {
        pairs.push({ score, groupIndex, order: ordered.indexOf(entry), entry });
      }
    }
  });
  pairs.sort((a, b) => b.score - a.score || a.groupIndex - b.groupIndex || a.order - b.order);
  for (const pair of pairs) {
    if (matches[pair.groupIndex] !== undefined || taken.has(pair.entry)) continue;
    matches[pair.groupIndex] = { record: pair.entry.record, how: 'near' };
    taken.add(pair.entry);
  }

  return groups.map((group, groupIndex) => ({
    members: group.members,
    match: matches[groupIndex],
  }));
}
