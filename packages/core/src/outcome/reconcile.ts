/**
 * The outcome→concept containment reconciliation (`[OUT-3]`, F4.1, knowledge model §4/§3
 * reconciliation, ONT-R1 `ol-2zfj.86`).
 *
 * `./store.ts`'s `attachConceptToOutcome` already records the containment edge, but nothing
 * before this module ever called it in production: `packages/plugin/src/ingestion/wiring.ts`'s
 * own module doc says so — "Concept attachment (`attachConceptToOutcome`) is deliberately NOT
 * called here: nothing in this function has inferred concept keys from the outcome yet — that is
 * a later stage's job, once one exists, not this read-and-persist seam's." This module is that
 * later stage.
 *
 * **The match rule, three buckets, one sentence each.**
 * - **Exact.** The outcome's label, normalised (`../concept/concept-key.js`'s
 *   `conceptIdentityNormalizationIndex` — the same whole-string fold ONT-R1 already uses for
 *   concept identity), equals a concept's normalised name, or one of its ACCEPTED aliases (the
 *   wordings a rename or a rebind already folded into `ConceptKeyRecord`/`TopicAnchor.aliases` —
 *   never a pending, unconfirmed proposal). Attached directly, via `attachConceptToOutcome`.
 * - **Near.** Token-set containment after normalisation, in plain English: split the outcome's
 *   label and the concept's wording into whitespace-separated tokens, normalise each token the
 *   same way a whole wording normalises (Unicode fold, case fold, minimal punctuation strip, a
 *   naive plural fold), and call it a near match when neither token set is empty and one is a
 *   subset of the other — "cell" is a near match for "cell biology" because {cell} ⊆ {cell,
 *   biology}. **Never attached.** ONT-R1 ruled containment unsafe as a mint-time identity signal
 *   ("no safe operating point"); it is exactly as unsafe as a direct attachment here, so a near
 *   match instead becomes a `proposeSameAsLink` proposal — bias to splits, structurally:
 *   `proposeSameAsLink` can only ever write a `'proposed'` record or leave an existing decision
 *   alone, never a confirmed link (`../concept/same-as.js`'s own doc). Turning a confirmed
 *   proposal into an attach is a later step this module does not perform.
 * - **Everything else.** No match at all. The outcome is not touched, and it is counted.
 *
 * **Reusing `same-as` across two entity types, not just two concept identities — a judgement
 * call, logged here rather than made silently.** `SameAsLinkRecord` is generic over two opaque
 * string keys and "never inspects, requires, or depends on how either was derived" (`same-as.ts`'s
 * own module doc) — nothing in its shape assumes both sides are `ConceptKeyRecord` keys. This
 * module proposes a link between an OUTCOME id (`OPAQUE_OUTCOME_ID_PREFIX`-prefixed) and a
 * CONCEPT key (`OPAQUE_CONCEPT_KEY_PREFIX`-prefixed) for a near match: "this outcome's own wording
 * may name the same thing as this concept" is exactly the kind of call ONT-R1 says should PROPOSE
 * rather than assert, whichever two entities the collision sits between. The alternative —
 * inventing a second, outcome-specific proposal shape — would duplicate the bias-to-splits
 * machinery `same-as.ts` already carries for an identically-shaped problem, for no gain. The
 * `reason` passed is the existing closed union's only member, `'normalisation-collision'`:
 * ONT-R1's ruling names this whole family "a normalisation collision," and token-set containment
 * is a normalisation-based match test, not a different phenomenon from the exact-equality one the
 * reason already names — widening the closed union over a difference of matching STRICTNESS
 * (equality vs. containment), rather than of underlying mechanism, would be exactly the kind of
 * "second nomination reason is a decision, not an implementation detail" call `same-as.ts`'s own
 * doc reserves for elsewhere. Class B (a reversible reuse of an existing mechanism, not a
 * schema/contract amendment) — flagged for retroactive review, not escalated.
 *
 * **D-005: counts and opaque ids only, never a label or a wording.** Every report type below
 * carries outcome ids and concept keys — opaque strings, structural facts — and never an
 * `OutcomeRecord.label` or a concept's name/alias. `classifyOutcomeConceptMatch` reads label text
 * internally to classify a pair, but nothing it returns carries that text back out; its result is
 * one member of a closed four-value union.
 *
 * **Retired outcomes are skipped.** F8.5's withdrawal state means an outcome no longer represents
 * live scope; reconciling new concepts onto it would grow a scope the exam is not asking about. A
 * caller that wants a retired outcome reconciled anyway calls this before retiring it, not after.
 */

import { conceptIdentityNormalizationIndex } from '../concept/concept-key.js';
import type { ConceptKeyRecord } from '../concept/key-store.js';
import { proposeSameAsLink, type SameAsLinkStatus } from '../concept/same-as.js';
import type { VaultSource } from '../vault/types.js';
import { attachConceptToOutcome } from './store.js';
import type { OutcomeRecord } from './types.js';

/** Order-preserving de-duplication, dropping empty strings — mirrors `key-store.ts`'s own `dedupeAliases`. */
function dedupe(values: readonly string[]): readonly string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const value of values) {
    if (value.length === 0 || seen.has(value)) continue;
    seen.add(value);
    out.push(value);
  }
  return out;
}

/**
 * One concept, as the "normalised-name index" this module matches against — deliberately narrow
 * (just enough to classify a match), so this module's tests do not need a full `ConceptKeyRecord`
 * fixture and so a future concept representation could supply this shape without depending on
 * `key-store.ts`'s file-storage concerns.
 */
export interface OutcomeConceptRegistryEntry {
  readonly key: string;
  /** `null` for a note-anchored (tier-1/3 bound) concept — `key-store.ts`'s `NoteAnchor` carries no display name at this layer; see `conceptRegistryEntryFromRecord`'s doc. */
  readonly name: string | null;
  /** Every accepted wording this key answers to besides `name` — never a pending, unconfirmed proposal. */
  readonly aliases: readonly string[];
}

/**
 * Builds one registry entry from a `ConceptKeyRecord` (`../concept/key-store.js`). A `TopicAnchor`
 * record contributes its own `anchor.name`/`anchor.aliases`; a `NoteAnchor` record has no display
 * name at this layer (key-store never stores one for a bound note — the note itself carries any
 * title), so it contributes only the record-level `aliases` field `[D-183]`'s rebind already
 * folds prior wordings into. `name: null` for a note-anchored concept is honest about that gap,
 * not a bug: such a concept can still match on an alias, never on a name it does not carry here.
 */
export function conceptRegistryEntryFromRecord(
  record: ConceptKeyRecord,
): OutcomeConceptRegistryEntry {
  const anchorAliases = record.anchor.kind === 'topic' ? record.anchor.aliases : [];
  const name = record.anchor.kind === 'topic' ? record.anchor.name : null;
  return {
    key: record.key,
    name,
    aliases: dedupe([...anchorAliases, ...(record.aliases ?? [])]),
  };
}

function tokenize(wording: string): readonly string[] {
  return wording
    .trim()
    .split(/\s+/)
    .filter((token) => token.length > 0);
}

function normalizedTokenSet(wording: string): ReadonlySet<string> {
  return new Set(tokenize(wording).map(conceptIdentityNormalizationIndex));
}

function isNonEmptySubset(smaller: ReadonlySet<string>, larger: ReadonlySet<string>): boolean {
  if (smaller.size === 0) return false;
  for (const token of smaller) {
    if (!larger.has(token)) return false;
  }
  return true;
}

/**
 * True when one wording's normalised token set is contained in the other's — the near-match rule
 * (see module doc). Neither direction matches when either side tokenizes to nothing.
 */
function isTokenContainmentMatch(a: string, b: string): boolean {
  const tokensA = normalizedTokenSet(a);
  const tokensB = normalizedTokenSet(b);
  if (tokensA.size === 0 || tokensB.size === 0) return false;
  return isNonEmptySubset(tokensA, tokensB) || isNonEmptySubset(tokensB, tokensA);
}

export type OutcomeConceptMatchKind =
  | 'exact-name'
  | 'accepted-alias'
  | 'near-token-containment'
  | 'none';

/**
 * Classifies one outcome/concept pair — pure, no I/O, no vault. See the module doc for the three
 * buckets `'exact-name'`/`'accepted-alias'` (attach), `'near-token-containment'` (propose) and
 * `'none'` collapse into. Exact and alias are checked ahead of containment, so a wording that
 * already matches exactly is never also reported as a near match.
 */
export function classifyOutcomeConceptMatch(
  outcomeLabel: string,
  concept: OutcomeConceptRegistryEntry,
): OutcomeConceptMatchKind {
  const normalizedLabel = conceptIdentityNormalizationIndex(outcomeLabel);
  if (
    concept.name !== null &&
    conceptIdentityNormalizationIndex(concept.name) === normalizedLabel
  ) {
    return 'exact-name';
  }
  if (
    concept.aliases.some((alias) => conceptIdentityNormalizationIndex(alias) === normalizedLabel)
  ) {
    return 'accepted-alias';
  }
  const wordings = concept.name !== null ? [concept.name, ...concept.aliases] : concept.aliases;
  if (wordings.some((wording) => isTokenContainmentMatch(outcomeLabel, wording))) {
    return 'near-token-containment';
  }
  return 'none';
}

export interface OutcomeConceptAttachment {
  readonly outcomeId: string;
  readonly conceptKey: string;
  readonly kind: 'exact-name' | 'accepted-alias';
}

export interface OutcomeConceptProposal {
  readonly outcomeId: string;
  readonly conceptKey: string;
  readonly status: SameAsLinkStatus;
}

export interface OutcomeConceptReconciliationReport {
  readonly attached: readonly OutcomeConceptAttachment[];
  readonly proposed: readonly OutcomeConceptProposal[];
  /** Outcome ids for which no concept matched at all (exact, alias, or near) — see module doc. */
  readonly unattachedOutcomeIds: readonly string[];
  readonly unattachedCount: number;
}

export interface ReconcileOutcomeConceptsOptions {
  /** Threaded through to `attachConceptToOutcome`/`proposeSameAsLink`. Injectable for deterministic tests. */
  readonly now?: () => string;
}

/**
 * The reconciliation itself. For every ACTIVE outcome in `outcomes`, checks every entry in
 * `concepts`: an exact/alias match attaches directly (`attachConceptToOutcome`); a near match
 * proposes a same-as link between the outcome id and the concept key (`proposeSameAsLink`) rather
 * than attaching; no match at all leaves the outcome untouched and its id lands in
 * `unattachedOutcomeIds`. Both underlying writers are idempotent, so re-running this against a
 * course already partly reconciled writes nothing new for a pair already settled.
 *
 * `outcomes` and `concepts` are the caller's course-scoped views — this module's own brief is
 * "given a COURSE's Outcome records and its concept registry" — so no course filtering happens
 * here. `TopicAnchor` concepts carry a `course` field this module's registry entry deliberately
 * does not, and `NoteAnchor` concepts carry none at all at this layer; course scoping is the
 * composition root's job (`packages/plugin/src/ingestion/wiring.ts`'s own doc explains why).
 */
export async function reconcileOutcomeConcepts(
  vault: VaultSource,
  outcomes: readonly OutcomeRecord[],
  concepts: readonly OutcomeConceptRegistryEntry[],
  options: ReconcileOutcomeConceptsOptions = {},
): Promise<OutcomeConceptReconciliationReport> {
  const attached: OutcomeConceptAttachment[] = [];
  const proposed: OutcomeConceptProposal[] = [];
  const unattachedOutcomeIds: string[] = [];

  for (const outcome of outcomes) {
    if (outcome.status !== 'active') continue;
    let matchedAny = false;

    for (const concept of concepts) {
      const kind = classifyOutcomeConceptMatch(outcome.label, concept);
      if (kind === 'exact-name' || kind === 'accepted-alias') {
        await attachConceptToOutcome(
          vault,
          outcome.id,
          concept.key,
          options.now !== undefined ? { now: options.now } : {},
        );
        attached.push({ outcomeId: outcome.id, conceptKey: concept.key, kind });
        matchedAny = true;
      } else if (kind === 'near-token-containment') {
        const link = await proposeSameAsLink(
          vault,
          outcome.id,
          concept.key,
          options.now !== undefined ? { now: options.now } : {},
        );
        proposed.push({ outcomeId: outcome.id, conceptKey: concept.key, status: link.status });
        matchedAny = true;
      }
    }

    if (!matchedAny) unattachedOutcomeIds.push(outcome.id);
  }

  return {
    attached,
    proposed,
    unattachedOutcomeIds,
    unattachedCount: unattachedOutcomeIds.length,
  };
}
