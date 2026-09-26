/**
 * `[D-322]`'s registry-backed composer for `../explain-back/modal.ts`'s optional
 * `ExplainBackModalDeps.matchFreeformTopicConcept` — the production caller `main.ts` was still
 * missing (this bead's report, "Remaining: … a registry-backed topic matcher composer (main.ts
 * and registry provider)"). `../explain-back/request.ts`'s pure `matchFreeformTopicToConcept`
 * already implements the ruling's matching rule (exact, case/whitespace-insensitive, course-aware
 * when a course is known); what was missing is the candidate list it needs — this file builds it.
 *
 * **Deliberately NOT a `../registry/provider.ts` change.** That file is another live lane's `owns`
 * this round (`ol-egov.141.89.10.22`/`.10.42`/`.10.48`); it also runs a fresh, async, whole-vault
 * `buildRegistryModel` on every `load()` (that provider's own module doc: "no cache … recomputes
 * from scratch every time the view opens or refreshes"), which cannot serve
 * `matchFreeformTopicConcept`'s synchronous signature (`explain-back/modal.ts`'s
 * `(topic: string) => FreeformTopicConceptMatch | undefined`) — the topic modal resolves a prompt
 * the instant she opens it, with no `await` in this dep's contract. Instead this composer reads
 * the SAME two already-cached, synchronous sources `main.ts` keeps for other same-tick registry
 * reads: `this.conceptRecords` (`ConceptRecord[]`, refreshed each corpus-relation tick) and
 * `this.registryOverridesCache` (`RegistryOverrides`, refreshed on `onOverridesChanged` — see
 * `main.ts`'s own doc on `registryOverridesCache` for why a cached copy exists at all). Reusing
 * `resolvedDisplayName`/`aliasesFor`/`isConceptPruned` from `../registry/overrides.js` (via
 * `olea-core`) keeps this file's idea of "a concept's names" and "is this concept withdrawn"
 * identical to `buildRegistryModel`'s own, never a second, drifting definition.
 *
 * **Pruned concepts are excluded from the candidate list** — a design choice this file makes
 * explicit rather than leaving implicit, since `[D-322]` itself is silent on pruning. F8.5's
 * pruning is "withdrawn from browsing's default view" (`registry/types.ts`'s `RegistryConceptEntry
 * .pruned` doc); silently letting a withdrawn concept absorb a fresh freeform explain-back answer
 * as scored evidence would work against that withdrawal. Reversible, Class B: flagged in this
 * bead's report for retroactive review, not a Class C surface change (it narrows which concept id
 * a topic can resolve to; it adds no new surface and changes no wording).
 */

import {
  aliasesFor,
  type ConceptRecord,
  isConceptPruned,
  type RegistryOverrides,
  resolvedDisplayName,
} from 'olea-core';

import {
  type FreeformTopicConceptCandidate,
  type FreeformTopicConceptMatch,
  matchFreeformTopicToConcept,
} from '../explain-back/request.js';

/**
 * Everything this composer needs, gathered by the caller (`main.ts`) from state it already keeps
 * — never a fresh read of its own. `courseCode` is optional and absent by default: no production
 * freeform entry point (command palette, session-builder screen, Home) carries a course signal
 * today — each opens `ExplainBackModal` with `{ kind: 'freeform' }` and no active-file context —
 * so `main.ts`'s real wiring omits it, an honest "no course known" rather than a guess, per
 * `[D-322]`'s own "when courseCode is null … every candidate is in scope" branch.
 */
export interface FreeformTopicMatcherDeps {
  /** `main.ts`'s `this.conceptRecords` — `null` before the first corpus-relation tick completes. */
  readonly conceptRecords: () => readonly ConceptRecord[] | null;
  /** `main.ts`'s `this.registryOverridesCache`. */
  readonly overrides: () => RegistryOverrides;
  /** Absent when no production caller has a course signal for this prompt (see this module's doc). */
  readonly courseCode?: () => string | null;
}

/**
 * One `ConceptRecord` (plus its rename/prune overrides) turned into `request.ts`'s
 * `FreeformTopicConceptCandidate` — every name a caller's typed topic could honestly be compared
 * against (the vault-derived name, the current override display name if renamed, and every prior
 * name it has answered to), and the M:N course list verbatim. Exported standalone (not just via
 * `createFreeformTopicMatcher`) so it can be unit-tested against the registry's own override
 * transforms directly, the same "test the composition, not just the wired whole" split this
 * package's other providers use.
 */
export function freeformTopicConceptCandidatesFrom(
  records: readonly ConceptRecord[],
  overrides: RegistryOverrides,
): readonly FreeformTopicConceptCandidate[] {
  return records
    .filter((record) => !isConceptPruned(overrides, record.key))
    .map((record) => {
      const displayName = resolvedDisplayName(overrides, record.key, record.name);
      const names = [...new Set([displayName, record.name, ...aliasesFor(overrides, record.key)])];
      return { conceptId: record.key, names, courses: record.courses };
    });
}

/**
 * `main.ts`'s real `matchFreeformTopicConcept` composer — one call to
 * `freeformTopicConceptCandidatesFrom` above, folded straight into `../explain-back/request.ts`'s
 * `matchFreeformTopicToConcept`. Never `undefined`: `explain-back/modal.ts`'s dep type allows it
 * (for the "no composer wired" default), but a real composer always has an answer — `no-match`
 * when `conceptRecords()` is `null` (no vault walk yet) or the topic matches nothing, exactly as
 * `matchFreeformTopicToConcept([], …)` already returns for an empty candidate list.
 */
export function createFreeformTopicMatcher(
  deps: FreeformTopicMatcherDeps,
): (topic: string) => FreeformTopicConceptMatch {
  return (topic: string) => {
    const candidates = freeformTopicConceptCandidatesFrom(
      deps.conceptRecords() ?? [],
      deps.overrides(),
    );
    return matchFreeformTopicToConcept(topic, candidates, deps.courseCode?.() ?? null);
  };
}
