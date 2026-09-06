/**
 * The planted pattern, and the one place a neutralised twin is derived.
 *
 * ## Why this file exists at all
 *
 * `[D-233]` (`ol-egov.120`) rules that a persona is a **character**, not a set
 * of independent samplers, and that each character carries a **pre-registered
 * neutralised twin**: identical but for the one property under test, both
 * authored and registered before any result is inspected.
 *
 * A twin therefore exists on **two layers** — a behavioural one (the dials a
 * generated stream is driven by) and a textual one (the character sheet an
 * author writes from, `scripts/harness/persona-authoring.mjs` in the private
 * service repo). Before this module the two layers each computed the delta
 * themselves from `planted.neutralise`, in two repos, and nothing stopped them
 * disagreeing. A text twin and a behavioural twin that disagree do not isolate
 * one property, and a twin that does not isolate one property is not a
 * counterfactual — which is the whole of what `[D-233]` buys. So the derivation
 * is **one exported pure function**, `neutralise`, and both layers call it.
 *
 * ## What a twin is, precisely
 *
 * `neutralise(character)` is the character's `Behaviour` with
 * `planted.neutralise` applied over it, and nothing else touched. That is the
 * *same* override `test/personas.spec.ts` already runs every discriminating
 * claim against and requires to **fail** (SYN-1's falsifiability clause), so
 * "the twin removes the pattern" is not a claim this module makes about itself
 * — it is a property the persona suite already proves, and this module reuses
 * rather than restates.
 *
 * ## Who gets a twin, and who deliberately does not
 *
 * A character whose `planted.neutralise` is **empty** gets no twin, because a
 * twin identical to its character isolates nothing. That is the control
 * (`steady-reviewer` — it *is* the neutral behaviour) and the two floor cases
 * (`empty-history`, `single-session`, which plant no pattern). Seven of the ten
 * characters therefore have twins. A twin is never itself given a twin: its own
 * planted pattern is empty by construction (`emptyPlantedFor`), so `hasTwin`
 * says no and the derivation is not recursive.
 *
 * ## Nothing here is a threshold
 *
 * Same rule as `./personas.ts`: every value this module moves is a *generator
 * input*, copied verbatim out of a character's own declared `neutralise`
 * override. Nothing is fitted, nothing is read off a distribution, and no
 * detector may ever be calibrated against what a twin produces (N-015).
 */

import type { Behaviour, Persona, PersonaId, PlantedPattern } from './personas.js';

/**
 * The suffix that names a twin after its character. Registered ids are
 * `<characterId>-twin`; the pre-registration
 * (`findings/moment-validation-preregistration.md` §6, in the service repo)
 * and the third dry run's refusal receipts both already use this spelling, so
 * it is fixed here rather than re-chosen.
 */
export const TWIN_SUFFIX = '-twin';

/** `crammer` → `crammer-twin`. Pure string arithmetic; asserts nothing about registration. */
export function twinIdFor(characterId: string): string {
  return `${characterId}${TWIN_SUFFIX}`;
}

/** True for an id shaped like a twin's. Says nothing about whether it is registered. */
export function isTwinId(id: string): boolean {
  return id.endsWith(TWIN_SUFFIX);
}

/** `crammer-twin` → `crammer`; `null` for anything not shaped like a twin id. */
export function characterIdOfTwin(id: string): string | null {
  return isTwinId(id) ? id.slice(0, -TWIN_SUFFIX.length) : null;
}

/**
 * The `Behaviour` fields the twin removes — the character's own
 * `planted.neutralise` keys, in declaration order. This is the list a report,
 * a prompt header or a test failure message names, so it comes from the same
 * object the dials come from and never from a second table.
 */
export function neutralisedFields(character: Persona): readonly (keyof Behaviour)[] {
  return Object.keys(character.planted.neutralise ?? {}) as (keyof Behaviour)[];
}

/**
 * **The single source of truth for a twin's dials.** The character's behaviour
 * with its `planted.neutralise` override applied over it, and nothing else
 * changed.
 */
export function neutralise(character: Persona): Behaviour {
  return { ...character.behaviour, ...character.planted.neutralise };
}

/**
 * Whether this persona has a twin: true exactly when it plants something a
 * twin could remove. False for the control, the two floor cases, and every
 * twin (whose own planted pattern is empty by construction).
 */
export function hasTwin(persona: Persona): boolean {
  return neutralisedFields(persona).length > 0;
}

/**
 * A twin's own `PlantedPattern`: empty, and saying so in the vocabulary a
 * reader of a report meets. Empty rather than "the absence of X" because
 * `carriedBy`/`neutralise` are read mechanically — by `hasTwin` here, and by
 * the authoring instrument's own character-sheet renderer — and a non-empty
 * `neutralise` on a twin would mint a twin of a twin.
 */
export function emptyPlantedFor(character: Persona): PlantedPattern {
  const fields = neutralisedFields(character);
  return {
    description:
      `The pre-registered neutralised twin of \`${character.id}\` ([D-233]): identical in every ` +
      `dial except ${fields.map((f) => `\`${String(f)}\``).join(', ')}, which is/are returned to ` +
      'the neutral value so the one property under test is absent. Plants nothing of its own — ' +
      'a twin of a twin would isolate nothing.',
    carriedBy: [],
    neutralise: {},
  };
}

/**
 * Derive the twin persona from its character. Pure: the same character in
 * gives the same twin out, and the twin's dials are exactly `neutralise()`'s.
 *
 * Throws for a character with no planted pattern rather than returning a clone
 * of it — a registered twin that isolates nothing is the one shape `[D-233]`'s
 * discipline cannot survive, so it fails loudly at module load rather than
 * quietly shipping a second copy of the control.
 */
export function deriveTwin(character: Persona): Persona {
  if (!hasTwin(character)) {
    throw new Error(
      `deriveTwin: '${character.id}' plants nothing (planted.neutralise is empty), so a twin of ` +
        'it would be identical to it and would isolate nothing. The control and the floor cases ' +
        'deliberately have no twin — see this module’s doc.',
    );
  }
  return {
    id: twinIdFor(character.id) as PersonaId,
    behaviour: neutralise(character),
    planted: emptyPlantedFor(character),
  };
}
