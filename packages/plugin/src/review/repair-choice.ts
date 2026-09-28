/**
 * `repair-choice.ts` — `[D-392]`'s grouped choice for an ambiguous deleted-id repair
 * (`ol-v7r5.100`), C5.3 as amended:
 *
 * > "Where more than one candidate could carry a deleted id, none is repaired silently: she is
 * > offered one grouped choice, the candidates and none of these, never separate confirmations,
 * > and the deleted id keeps its identity and history until she answers; repair proposals share
 * > the duplication confirmation record under a reason of their own."
 * > (`docs/Olea_alpha_functional_scope.md` C5.3, amended Sep 2026 — `[D-392]`.)
 *
 * `[D-392]`'s three binding conditions, all enforced here:
 *
 * 1. **The original identity is preserved until she resolves it.** Nothing attaches until she
 *    answers — {@link buildRepairChoice} never mutates or removes the deleted id, and a proposal
 *    starts (and stays, until answered) `status: 'proposed'`.
 * 2. **One grouped choice — every candidate plus "none of these" — never independent
 *    per-candidate confirmations** that could attach more than one successor to the same deleted
 *    id. With more than one candidate this module never repairs silently, whatever any individual
 *    candidate's own certainty looks like: the ruling's own words for why ("with two candidates
 *    the choice is not certain," `[D-392]`, part 1(a)) are about the SET being ambiguous, not
 *    about re-litigating each candidate alone.
 * 3. **A single candidate is still repaired automatically only when it meets the existing
 *    near-certainty test** (byte-identical item text, same file, candidate id unclaimed; C5.3 as
 *    ruled by `[D-090]`) — otherwise it too goes to her, as a grouped choice of one candidate plus
 *    "none of these."
 *
 * **What this module is, and is not.** This is the decision's PURE half — the plugin-side sibling
 * of `olea-core`'s `resolveInstrumentRepair` (single-candidate, `instrument/repair.ts`) and
 * `resolveInstrumentDuplications` (grouped by losing note, `instrument/duplication.ts`). It never
 * walks the vault, never persists a record, and never mints, writes or attaches an id — attaching
 * "the deleted id and its history to that candidate" (moving scheduling history) is the CALLER's
 * job once this module names which candidate; this module carries no history data at all, so
 * "history intact" on decline is structural, not something it has to remember to preserve.
 *
 * **Where `[D-090]`'s certainty test comes from.** `olea-core`'s `resolveInstrumentRepair` already
 * computes it (byte-identical + same file + unclaimed), but as of this writing `instrument/repair.ts`
 * is not exported from `olea-core`'s public index (only `instrument/duplication.ts` is) — so rather
 * than reach past the package boundary, {@link RepairChoiceCandidate.meetsCertaintyTest} takes it
 * as a caller-supplied fact, the same "caller supplies the fact" split `resolveInstrumentRepair`
 * itself draws for `candidateIdClaimedElsewhere`. A caller wires this against the real
 * `resolveInstrumentRepair` once one exists that owns the several-candidates matching step
 * (F8.6-shaped and unbuilt) and the export gap is closed — tracked as a follow-up, not solved here
 * (see this bead's evidence).
 *
 * **Why "none of these" is not a fourth candidate.** Choosing a candidate and choosing "none of
 * these" produce structurally different outcomes (attach vs. decline), so they are two branches of
 * one closed answer type ({@link RepairChoiceAnswer}), never a candidate with a synthetic id.
 *
 * Persisting a grouped proposal (`[D-392]` part 2: share `./duplication-confirmation-store.ts`
 * under a second reason value) and wiring a live caller are other beads' work (`ol-v7r5.91` and
 * whatever surfaces the choice to her), not this module's.
 *
 * ## `[D-409]`: each candidate is identified by a digest (`ol-v7r5.105`)
 *
 * A note path alone cannot tell two candidates in one note apart, so `[D-409]` ruled that each
 * candidate is identified by a digest of its block text plus its heading path
 * ({@link repairCandidateDigest}). The digest stays stable while she leaves that block alone, and
 * it stores no wording of hers: it is a one-way SHA-256 over the block text and the headings above
 * it (`olea-core`'s `session/types.ts` `headingPath`), never the text itself. An edit to the block,
 * or to a heading above it, changes the digest, so an answer naming the old digest no longer
 * matches any block and is re-proposed rather than applied (the persisted half's
 * `saveRepairChoiceAnswer` / `applyConfirmedRepairChoice` in `./duplication-confirmation-store.ts`).
 *
 * The digest does not include the note path: a candidate is the pair (note path, digest), and
 * both must match for an answer or an apply to name it. Candidates are ordered by note path, then
 * digest ({@link compareRepairChoiceCandidates}), so the same set always lists the same way.
 */

import type { VaultInstrumentRecord, VaultPath } from 'olea-core';
import { hashText } from 'olea-core';

/** `[D-392]`'s own wording for the second choice, verbatim from the amended C5.3 clause. */
export const REPAIR_CHOICE_NONE_OF_THESE_LABEL = 'None of these';

/**
 * One candidate as she sees it in the grouped choice. `notePath` is the only stable,
 * caller-visible identity a repair candidate carries — an item with no id is exactly why a repair
 * path was reached in the first place — and is what {@link RepairChoiceAnswer} names back.
 */
export interface RepairChoiceCandidate {
  readonly notePath: VaultPath;
  /**
   * Whether `[D-090]`'s three-condition near-certainty test holds for this candidate alone,
   * computed the same way `olea-core`'s `resolveInstrumentRepair` computes it for one candidate —
   * see the module doc's "Where `[D-090]`'s certainty test comes from." Only read when there is
   * exactly one candidate; with more than one, binding condition 2 answers the question outright.
   */
  readonly meetsCertaintyTest: boolean;
  /**
   * `[D-409]`: {@link repairCandidateDigest} of this candidate's block text plus heading path.
   * Optional only while a caller that cannot yet compute it still exists; a candidate without one
   * cannot be named by an answer that carries a digest, and the persisted half never applies it.
   */
  readonly digest?: string;
}

/**
 * `[D-409]`'s scheme tag, hashed in with every digest so a later change to what is hashed yields
 * digests that can never collide with this one's (a stale proposal, never a wrong match).
 */
export const REPAIR_CANDIDATE_DIGEST_SCHEME = 'olea-repair-candidate/1';

/** What {@link repairCandidateDigest} hashes: one block's exact text and the headings above it. */
export interface RepairCandidateDigestInput {
  /** The block's exact source text (`card.raw` / `mcq.raw`). */
  readonly raw: string;
  /** Outermost first — `olea-core`'s `VaultInstrumentRecord.headingPath`. Empty above the first heading. */
  readonly headingPath: readonly string[];
}

/**
 * `[D-409]`: the digest that identifies a repair candidate — SHA-256 (`olea-core`'s `hashText`) of
 * an unambiguous JSON encoding of the scheme tag, the heading path and the block text, as
 * lowercase hex. Deterministic and one-way; it carries none of her wording.
 */
export async function repairCandidateDigest(input: RepairCandidateDigestInput): Promise<string> {
  return hashText(
    JSON.stringify([REPAIR_CANDIDATE_DIGEST_SCHEME, [...input.headingPath], input.raw]),
  );
}

/** A current record's exact block text — the same field `open-session.ts`'s walk snapshot reads. */
export function rawOfInstrumentRecord(record: VaultInstrumentRecord): string {
  return record.instrumentType === 'mcq' ? record.mcq.raw : record.card.raw;
}

/**
 * `[D-409]`: the digest of a record a vault walk produced, or `undefined` when it carries no
 * `headingPath` (a record built by hand). Never falls back to the nearest heading alone: that
 * would give the same block a second, different digest.
 */
export async function digestOfInstrumentRecord(
  record: VaultInstrumentRecord,
): Promise<string | undefined> {
  if (record.headingPath === undefined) return undefined;
  return repairCandidateDigest({
    raw: rawOfInstrumentRecord(record),
    headingPath: record.headingPath,
  });
}

/**
 * `[D-409]`: the digest of each candidate `olea-core`'s `matchDeletedInstrumentIds` produced, in
 * the candidates' own order, computed from the current walk's records (a candidate carries only
 * its note path and text, so its heading path is read off the record it came from).
 *
 * The matcher builds its candidates only from current records whose id the previous walk never
 * saw, so pairing is restricted to exactly those (`previouslyKnownIds` excluded); two candidates
 * with the same note and text are paired with those records in source order, which is the order
 * the matcher's stable sort leaves them in. `undefined` for a candidate no record pairs with, or
 * whose record carries no heading path — a caller bug the persisted half treats as "cannot be
 * applied", never as a guess.
 */
export async function repairCandidateDigests(
  candidates: readonly { readonly notePath: VaultPath; readonly raw: string }[],
  currentRecords: readonly VaultInstrumentRecord[],
  previouslyKnownIds: ReadonlySet<string>,
): Promise<readonly (string | undefined)[]> {
  const queues = new Map<string, VaultInstrumentRecord[]>();
  for (const record of currentRecords) {
    if (previouslyKnownIds.has(record.instrumentId)) continue;
    const key = `${record.notePath}\u0000${rawOfInstrumentRecord(record)}`;
    const queue = queues.get(key);
    if (queue === undefined) queues.set(key, [record]);
    else queue.push(record);
  }
  const out: (string | undefined)[] = [];
  for (const candidate of candidates) {
    const record = queues.get(`${candidate.notePath}\u0000${candidate.raw}`)?.shift();
    out.push(record === undefined ? undefined : await digestOfInstrumentRecord(record));
  }
  return out;
}

function byString(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/**
 * `[D-409]`'s deterministic order: note path, then digest (a candidate without one sorts first
 * within its note). A stable sort by this keeps equal pairs in the order given.
 */
export function compareRepairChoiceCandidates(
  a: { readonly notePath: VaultPath; readonly digest?: string },
  b: { readonly notePath: VaultPath; readonly digest?: string },
): number {
  return byString(a.notePath, b.notePath) || byString(a.digest ?? '', b.digest ?? '');
}

/**
 * A grouped choice awaiting her answer — binding condition 2: every candidate plus "none of
 * these," never separate per-candidate confirmations. `status` starts `'proposed'` and moves to
 * `'confirmed'` or `'declined'` exactly once; {@link resolveRepairChoice} refuses a second answer
 * (binding condition 1 — see its own doc and this module's spec).
 */
export interface RepairChoiceProposal {
  readonly instrumentId: string;
  /** Non-empty; more than one exactly in the ambiguous case, or exactly one that failed `[D-090]`'s certainty test. */
  readonly candidates: readonly RepairChoiceCandidate[];
  readonly status: 'proposed' | 'confirmed' | 'declined';
  /** Epoch ms — the caller's clock, never read here. */
  readonly proposedAt: number;
  /** Set only once `status` is `'confirmed'` — which candidate she chose. */
  readonly resolvedNotePath?: VaultPath;
  /** `[D-409]`: set with `resolvedNotePath` when the chosen candidate carries a digest. */
  readonly resolvedDigest?: string;
}

/** A caller's request to decide whether `instrumentId` can repair silently or must go to her. */
export interface BuildRepairChoiceInput {
  readonly instrumentId: string;
  /** Non-empty — every candidate some caller already matched to `instrumentId` (see module doc). */
  readonly candidates: readonly RepairChoiceCandidate[];
  readonly now: number;
}

/** No choice needed: `[D-090]`'s certainty test passed on the one candidate, so it repairs silently. */
export interface RepairChoiceSilentOutcome {
  readonly kind: 'silent';
  readonly instrumentId: string;
  readonly notePath: VaultPath;
}

/** She must be asked — binding condition 2's grouped choice. */
export interface RepairChoiceNeededOutcome {
  readonly kind: 'choice-needed';
  readonly proposal: RepairChoiceProposal;
}

export type BuildRepairChoiceOutcome = RepairChoiceSilentOutcome | RepairChoiceNeededOutcome;

/**
 * Decides whether `input.candidates` can repair silently or must go to her. Throws on an empty
 * `candidates` array — there is nothing a caller could have matched, and a grouped choice with no
 * candidates would make "the candidates and none of these" meaningless.
 *
 * With exactly one candidate whose `meetsCertaintyTest` is `true`: silent (binding condition 3).
 * Every other case — more than one candidate, however certain any of them individually, or one
 * candidate whose `meetsCertaintyTest` is `false` — becomes a {@link RepairChoiceProposal} naming
 * every candidate (binding conditions 2 and 3's "otherwise").
 *
 * Deterministic: the same input always produces the same outcome, and a proposal lists its
 * candidates in {@link compareRepairChoiceCandidates}' order (`[D-409]`), whatever order they came in.
 */
export function buildRepairChoice(input: BuildRepairChoiceInput): BuildRepairChoiceOutcome {
  const { instrumentId, candidates, now } = input;
  if (candidates.length === 0) {
    throw new Error('buildRepairChoice: candidates must be non-empty');
  }

  if (candidates.length === 1) {
    const [only] = candidates;
    if (only?.meetsCertaintyTest === true) {
      return { kind: 'silent', instrumentId, notePath: only.notePath };
    }
  }

  return {
    kind: 'choice-needed',
    proposal: {
      instrumentId,
      candidates: [...candidates].sort(compareRepairChoiceCandidates),
      status: 'proposed',
      proposedAt: now,
    },
  };
}

/**
 * Her answer to a grouped choice — a candidate, or "none of these." `[D-409]`: a candidate is
 * named by its note path and its digest; an answer without a digest names a candidate only when
 * it is the only one in that note ({@link RepairChoiceAmbiguousCandidateResult} otherwise).
 */
export type RepairChoiceAnswer =
  | { readonly kind: 'candidate'; readonly notePath: VaultPath; readonly digest?: string }
  | { readonly kind: 'none-of-these' };

/** She chose a candidate: the deleted id attaches to it, and only it. */
export interface RepairChoiceAttachedResult {
  readonly kind: 'attached';
  readonly instrumentId: string;
  readonly notePath: VaultPath;
  /** `[D-409]`: the chosen candidate's digest, when it carries one. */
  readonly digest?: string;
  readonly proposal: RepairChoiceProposal;
}

/** She chose "none of these": the id stays unattached, its identity and history untouched. */
export interface RepairChoiceDeclinedResult {
  readonly kind: 'declined';
  readonly instrumentId: string;
  readonly proposal: RepairChoiceProposal;
}

/** The answer named a `notePath` this proposal never offered — a caller bug, not a real choice. */
export interface RepairChoiceUnknownCandidateResult {
  readonly kind: 'unknown-candidate';
  readonly notePath: VaultPath;
}

/**
 * `[D-409]`: the answer named a note without a digest, and more than one candidate is in that
 * note — which block she meant cannot be told, so nothing attaches.
 */
export interface RepairChoiceAmbiguousCandidateResult {
  readonly kind: 'ambiguous-candidate';
  readonly notePath: VaultPath;
}

/**
 * `proposal.status` was already `'confirmed'` or `'declined'` — binding condition 1: the id's
 * identity resolves exactly once, so a second answer is refused rather than silently overwriting
 * a decline or attaching a second successor to the same id.
 */
export interface RepairChoiceAlreadyResolvedResult {
  readonly kind: 'already-resolved';
  readonly proposal: RepairChoiceProposal;
}

export type RepairChoiceResolution =
  | RepairChoiceAttachedResult
  | RepairChoiceDeclinedResult
  | RepairChoiceUnknownCandidateResult
  | RepairChoiceAmbiguousCandidateResult
  | RepairChoiceAlreadyResolvedResult;

/**
 * Resolves her answer to a grouped choice — binding conditions 1 and 2. Never mutates `proposal`;
 * every result carries the proposal `proposal` should become from here (a caller persists it, once
 * `[D-392]` part 2's store extension exists). Deterministic: the same `proposal`/`answer` pair
 * always produces the same resolution.
 *
 * Calling this again with the ALREADY-RETURNED `proposal` (not the original) is exactly how a
 * caller proves binding condition 1's "a second attachment for the same id is impossible": the
 * updated `proposal.status` is no longer `'proposed'`, so the second call returns
 * `'already-resolved'` rather than attaching a second candidate.
 */
export function resolveRepairChoice(
  proposal: RepairChoiceProposal,
  answer: RepairChoiceAnswer,
): RepairChoiceResolution {
  if (proposal.status !== 'proposed') {
    return { kind: 'already-resolved', proposal };
  }

  if (answer.kind === 'none-of-these') {
    return {
      kind: 'declined',
      instrumentId: proposal.instrumentId,
      proposal: { ...proposal, status: 'declined' },
    };
  }

  const inNote = proposal.candidates.filter((candidate) => candidate.notePath === answer.notePath);
  const matched =
    answer.digest === undefined
      ? inNote
      : inNote.filter((candidate) => candidate.digest === answer.digest);
  if (matched.length === 0) {
    return { kind: 'unknown-candidate', notePath: answer.notePath };
  }
  const [chosen] = matched;
  if (matched.length > 1 || chosen === undefined) {
    return { kind: 'ambiguous-candidate', notePath: answer.notePath };
  }

  return {
    kind: 'attached',
    instrumentId: proposal.instrumentId,
    notePath: answer.notePath,
    ...(chosen.digest !== undefined ? { digest: chosen.digest } : {}),
    proposal: {
      ...proposal,
      status: 'confirmed',
      resolvedNotePath: answer.notePath,
      ...(chosen.digest !== undefined ? { resolvedDigest: chosen.digest } : {}),
    },
  };
}
