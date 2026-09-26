/**
 * F2.12's prerequisite-aware branch, joined to a real review session
 * (`[D-265]` ruling 2 implemented the pure decision in
 * `../misconception/confusion-routing.ts`; `ol-egov.141.51.1` wired the call
 * site; this module — `ol-egov.141.51.1.1` [INTERV-16] — is the "real
 * production resolver" both `session.ts`'s `resolvePrerequisiteEvidence` port
 * doc and `./strong-recall-wiring.ts`'s own doc name as the follow-up: a
 * composer built where the whole review log is already in hand
 * (`./open-session.ts`), not threaded from `main.ts`).
 *
 * Two jobs, matching the bead's own two-part description:
 *
 * 1. Resolve the failing instrument's concept(s) to a **direct** prerequisite
 *    edge — `../concept/prerequisite-order.js`'s `resolvePrerequisiteConceptKeys`,
 *    the same map queue ordering was built to read (`ol-3ux7.5.57.9.2`),
 *    reused here for its second, distinct reader (`docs/dev/intelligence-build/rel.md`
 *    §1's table: "Confusion-routing offer, prerequisite branch").
 * 2. Classify that prerequisite's CURRENT evidence — read fresh, from the
 *    same review log this session was already composed from, never a stored
 *    judgement — into one of {@link PrerequisiteEvidenceReading}'s six
 *    values. See "THE CLASSIFICATION" below for what is and is not ruled
 *    about that mapping.
 *
 * ## The seam, mirroring `./strong-recall-wiring.ts` exactly
 *
 * Same reason, stated there and in `session.ts`'s port doc: the decision
 * needs the concept's whole-log mastery rollup and vitality reading, which
 * `ReviewSession` (a presentation-layer class) neither holds nor should
 * learn to compute. This module closes over the log `open-session.ts`
 * already read (`composed.entries`) — no second vault walk, no second log
 * parse — and answers one dependent concept at a time, lazily, memoising
 * both the resolved edge (per dependent concept id) and the classification
 * (per prerequisite concept id), so a session with many graded items pays
 * for at most one scheduler replay and one instrument-validity fold, ever.
 *
 * ## Default 4 (rel.md §3) — freshness is inherited, never re-applied here
 *
 * `[D-093]`'s per-endpoint freshness gate is enforced once, centrally, by
 * `../concept/relation.js`'s `servedRelations` — "every reader … reads
 * relations through that gated path … never a raw ungated fold" (rel.md §3,
 * Default 4, item 4). `deps.relations` is exactly that already-gated output
 * (the same `ConceptRelation[]` `main.ts`'s `servedRelationEdges()` already
 * hands `session-builder/provider.ts`'s `resolveRelatedConceptKeys` for its
 * own, unrelated reader) — this module never reads a `RelationSet` or its
 * `entries` directly, so a stale or unverified endpoint is never visible to
 * it in the first place, by construction rather than by a check repeated
 * here. See `prerequisite-evidence-wiring.spec.ts`'s "Default 4" describe
 * block for a stale-beside-current fixture proving the stale edge never
 * reaches this module's resolution at all.
 *
 * ## THE CLASSIFICATION — what `[D-265]` ruling 2 rules, and what this bead rules
 *
 * The ruling names six readings and two behaviours (`confusion-routing.ts`'s
 * module doc has the full clause): weak/unknown route the offer onto the
 * prerequisite, strong/defective/provisional/inherited all leave the
 * ordinary offer standing. **Which mastery/vitality facts produce which of
 * the six readings is NOT ruled anywhere** — the bead's own close evidence
 * says so explicitly and marks it Class B (a non-persisted vocabulary/enum
 * choice): "proceed with a reversible default, flag for retroactive
 * review." This is that default:
 *
 * - **`unknown`** — no review evidence names the prerequisite concept at
 *   all (`conceptVitalityInstruments` returns nothing for it). The honest
 *   "we simply have not seen this concept reviewed" case.
 * - **`defective`** — evidence exists, but EVERY instrument that is
 *   evidence for the prerequisite has been proven invalid (`../mastery/
 *   validity.js`'s `projectInstrumentValidity`: a rejected verdict or a
 *   grade contest resolved `corrected`). This is the knowledge model §8 /
 *   F2.23 "item-defect exclusion applied to evidence" the bead's
 *   description names: nothing trustworthy remains, which is a different
 *   honest state from never having been reviewed.
 * - **`strong`** — the prerequisite's high-water-mark growth stage
 *   (`../mastery/rollup.js`'s `computeAllConceptMastery`, over the SAME
 *   `invalidInstrumentIds` exclusion `defective` above uses) is `sapling` or
 *   `tree`, AND its current vitality (`readVitality`, over every instrument
 *   that is evidence for it, valid or not — the same non-exclusion
 *   `./strong-recall-wiring.ts` already takes for vitality) reads
 *   `holding`. Demonstrated competence that is not currently fading.
 * - **`weak`** — every other case with at least some non-excluded evidence:
 *   below `sapling`, or at/above it but currently `tending` (fading despite
 *   a past demonstration). Either way, "current evidence" — the clause's
 *   own words — does not support calling this prerequisite solid right now.
 * - **`provisional` / `inherited`** — **never produced by this module.**
 *   Both name F8.6's offshoot mechanism ("the offshoot starts at the
 *   parent's mastery reading as a provisional, visibly-inferred prior … the
 *   prior is labelled as inherited, not earned") — and F8.6 is explicitly
 *   post-v0.9, with no concept-split producer anywhere in this codebase
 *   (searched; the only built piece is F8.4a's narrow propose/accept/
 *   decline identity surface, which is same-as linking, not splitting).
 *   Kept as reachable literals in the type — same "an honest gap, not a
 *   guessed value" posture `session.ts`'s own doc states for
 *   `resolveInstrumentStanding`'s `flagged`/`safety-information-unavailable`
 *   — rather than silently folded into `weak` or `strong`, so a future
 *   split-mechanism composer has an unambiguous place to plug into.
 *
 * **Multi-prerequisite tie-break, also undecided by `[D-265]`:** a dependent
 * concept with more than one direct-prerequisite edge picks the
 * lexicographically smallest prerequisite concept id, deterministically —
 * "direct prerequisites only, one at a time, never a tour" (the clause's own
 * words) rules that exactly one edge is used, never which one when several
 * exist. Flagged in this bead's report as a proposed decision, not blocking.
 *
 * ## What this module deliberately does NOT do
 *
 * **It does not see the review she just gave** — `deps.entries` is the log
 * as the session opened it, the same snapshot `./strong-recall-wiring.ts`
 * reads for the identical reason (its own module doc).
 *
 * **It writes nothing and stores nothing.** `[D-265]` ruling 2: "nothing
 * persisted about the judgement" — this module returns a reading; recording
 * the offer itself (D7.1) is `ReviewSession`'s job, unchanged by this bead.
 *
 * **INV-1.** No `obsidian` import; composed by `open-session.ts`, itself
 * Obsidian-free, so this module is driven against plain arrays under test.
 */

import type { ReviewLogEntry } from 'olea-contracts';
import type {
  ConceptRecord,
  ConceptRelation,
  DirectPrerequisiteEvidence,
  PrerequisiteEvidenceReading,
  ReplayResult,
  Scheduler,
} from 'olea-core';
import {
  computeAllConceptMastery,
  conceptVitalityInstruments,
  HOLDING_CUT,
  projectInstrumentValidity,
  readVitality,
  replaySchedulerStates,
  resolvePrerequisiteConceptKeys,
} from 'olea-core';

export interface PrerequisiteEvidenceReaderDeps {
  /** The review log the session was composed from — passed, never re-read. See the module doc. */
  readonly entries: readonly ReviewLogEntry[];
  /** The same scheduler the session rates against. */
  readonly scheduler: Scheduler;
  /** The session's own instant, read once by its caller — never `Date.now()` inside this module. */
  readonly now: Date;
  /**
   * Already freshness-gated (rel.md §3 Default 4) — see the module doc's
   * "Default 4" section. Omitted or empty means no prerequisite edge can
   * ever resolve, the same real no-op every optional relation-shaped input
   * in this package already documents.
   */
  readonly relations: readonly ConceptRelation[];
  /**
   * The concept records `relations`' names join against
   * (`resolvePrerequisiteConceptKeys`'s own name→key fold). Omitted or empty
   * means the same no-op as an empty `relations`.
   */
  readonly concepts: readonly ConceptRecord[];
  /** Overrides {@link HOLDING_CUT} ([D-115]'s ratified 0.90). */
  readonly holdingCut?: number;
}

function classifyPrerequisite(
  prerequisiteConceptId: string,
  deps: PrerequisiteEvidenceReaderDeps,
  replayed: ReplayResult,
  invalidInstrumentIds: readonly string[],
  holdingCut: number,
): PrerequisiteEvidenceReading {
  const evidenceInstruments = conceptVitalityInstruments(
    deps.entries,
    prerequisiteConceptId,
    replayed,
  );
  if (evidenceInstruments.length === 0) return 'unknown';

  const invalidSet = new Set(invalidInstrumentIds);
  const validInstruments = evidenceInstruments.filter(
    (instrument) => !invalidSet.has(instrument.instrumentId),
  );
  if (validInstruments.length === 0) return 'defective';

  const mastery = computeAllConceptMastery(deps.entries, [prerequisiteConceptId], {
    invalidInstrumentIds,
  }).get(prerequisiteConceptId);
  const vitality = readVitality({
    instruments: evidenceInstruments,
    scheduler: deps.scheduler,
    now: deps.now,
    holdingCut,
  });

  const demonstratedTopStage = mastery?.state === 'sapling' || mastery?.state === 'tree';
  return demonstratedTopStage && vitality.value === 'holding' ? 'strong' : 'weak';
}

/**
 * Builds the resolver `open-session.ts` threads onto
 * `ReviewSessionDeps.resolvePrerequisiteEvidence`.
 *
 * Reads the graded instrument's `conceptIds` in order (D-031: an instrument
 * may be evidence for several) and returns the first one that names a direct
 * prerequisite — mirroring `./strong-recall-wiring.ts`'s "first concept that
 * proposes" convention. `undefined` when none does, which
 * `evaluateConfusionRouting` already treats as "no direct prerequisite
 * recorded" (the ordinary offer stands).
 *
 * Never throws: a fold over a malformed log is a diagnostic, not a reason to
 * break a review she is in the middle of — same "simply cannot offer it"
 * posture every optional port on `ReviewSessionDeps` already has.
 */
export function createPrerequisiteEvidenceReader(
  deps: PrerequisiteEvidenceReaderDeps,
): (conceptIds: readonly string[]) => DirectPrerequisiteEvidence | undefined {
  const holdingCut = deps.holdingCut ?? HOLDING_CUT;
  const { prerequisiteConceptKeys } = resolvePrerequisiteConceptKeys(deps.relations, deps.concepts);

  let replayed: ReplayResult | null = null;
  let invalidInstrumentIds: readonly string[] | null = null;
  const dependentMemo = new Map<string, DirectPrerequisiteEvidence | undefined>();
  const readingMemo = new Map<string, PrerequisiteEvidenceReading>();

  function resolveForDependent(dependentConceptId: string): DirectPrerequisiteEvidence | undefined {
    const cached = dependentMemo.get(dependentConceptId);
    if (cached !== undefined || dependentMemo.has(dependentConceptId)) return cached;

    const prerequisites = prerequisiteConceptKeys.get(dependentConceptId);
    let evidence: DirectPrerequisiteEvidence | undefined;
    if (prerequisites !== undefined && prerequisites.size > 0) {
      // Deterministic tie-break for the "which one edge" question `[D-265]`
      // does not rule — see the module doc's "Multi-prerequisite tie-break".
      const chosen = [...prerequisites].sort()[0];
      if (chosen !== undefined) {
        // Replayed and folded once, lazily, on the first call that actually
        // needs it — never at composition time, so a session she never
        // rates past the threshold costs nothing.
        replayed ??= replaySchedulerStates(deps.entries, deps.scheduler);
        invalidInstrumentIds ??= [...projectInstrumentValidity(deps.entries).provenInvalid.keys()];

        let reading = readingMemo.get(chosen);
        if (reading === undefined) {
          reading = classifyPrerequisite(chosen, deps, replayed, invalidInstrumentIds, holdingCut);
          readingMemo.set(chosen, reading);
        }
        evidence = { conceptId: chosen, reading };
      }
    }
    dependentMemo.set(dependentConceptId, evidence);
    return evidence;
  }

  return (conceptIds) => {
    try {
      for (const conceptId of conceptIds) {
        if (conceptId.length === 0) continue;
        const evidence = resolveForDependent(conceptId);
        if (evidence !== undefined) return evidence;
      }
      return undefined;
    } catch (error) {
      console.error(
        'Olea: could not resolve the direct-prerequisite evidence (F2.12, [D-265] ruling 2)',
        error,
      );
      return undefined;
    }
  };
}
