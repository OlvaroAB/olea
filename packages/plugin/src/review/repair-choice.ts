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
 */

import type { VaultPath } from 'olea-core';

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
 * Deterministic: the same input always produces the same outcome.
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
    proposal: { instrumentId, candidates, status: 'proposed', proposedAt: now },
  };
}

/** Her answer to a grouped choice — a candidate's `notePath`, or "none of these." */
export type RepairChoiceAnswer =
  | { readonly kind: 'candidate'; readonly notePath: VaultPath }
  | { readonly kind: 'none-of-these' };

/** She chose a candidate: the deleted id attaches to it, and only it. */
export interface RepairChoiceAttachedResult {
  readonly kind: 'attached';
  readonly instrumentId: string;
  readonly notePath: VaultPath;
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

  const matched = proposal.candidates.some((candidate) => candidate.notePath === answer.notePath);
  if (!matched) {
    return { kind: 'unknown-candidate', notePath: answer.notePath };
  }

  return {
    kind: 'attached',
    instrumentId: proposal.instrumentId,
    notePath: answer.notePath,
    proposal: { ...proposal, status: 'confirmed', resolvedNotePath: answer.notePath },
  };
}
