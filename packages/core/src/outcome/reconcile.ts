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
 *   match instead becomes a `proposeOutcomeConceptNearMatch` proposal — bias to a resolved
 *   candidate rather than a silent attach: that function can only ever write a `'proposed'`
 *   record or leave an existing decision alone, never a confirmed one (`./near-match.js`'s own
 *   doc). Turning a confirmed proposal into an attach is a later step this module does not
 *   perform.
 * - **Everything else.** No match at all. The outcome is not touched, and it is counted.
 *
 * **Its own proposal record, never `same-as` — `[D-256]` (`ol-2zfj.129`), ruling `[OUT-4]`
 * (`ol-2zfj.128`).** An earlier version of this module reused `../concept/same-as.js`'s
 * `proposeSameAsLink` here, reasoning that `SameAsLinkRecord` is generic over two opaque string
 * keys and "never inspects, requires, or depends on how either was derived." `[OUT-4]`'s review
 * found that reasoning unsound: `same-as` is contracted (ONT-R1, the vocabulary registry) to mean
 * CONCEPT IDENTITY, and an outcome-to-concept near match is a CONTAINMENT candidate
 * (`[ONT-R5]`/F4.1: "different entities, never the same node read at a coarser grain") — not an
 * identity claim, whatever the record's own shape happened to permit. Reusing the identity record
 * also misrepresented its `reason` field: `'normalisation-collision'` names a concept-key
 * mint-time collision (`../concept/key-store.js`'s `findNormalizationCollisions`), and an outcome
 * id is never minted through that index. `[D-256]` ruled a new, additive record type
 * (`./near-match.js`'s `OutcomeConceptNearMatchRecord`, its own folder and status vocabulary)
 * rather than widening `same-as`'s own schema, so `same-as`'s identity read consumer never has to
 * reason about outcome ids at all — the type confusion becomes unreachable rather than
 * re-guarded. Full argument on `ol-2zfj.128`'s notes.
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
 *
 * **One entry per concept identity (`[D-378]`, `ol-egov.141.89.9.56`).** Two same-anchor concept
 * key records are one identity; `../concept/key-store.ts`'s canonical-key index names its
 * canonical key. A registry built record by record (`conceptRegistryEntryFromRecord` over
 * `listConceptKeyRecords`) holds one entry per record, so before matching,
 * `reconcileOutcomeConcepts` folds the entries of one identity into one, under the canonical key,
 * answering to every wording any of them carries. An outcome then attaches that identity once, by
 * its canonical key, and a near match is proposed once. Two concepts that share only an
 * introducing passage are two identities in the index and stay two entries here.
 *
 * **Model-decided containment and scope standing (`[D-433]`, `ol-egov.141.89.7.26`), behind her
 * correction control (`[D-533]`).** `readModelDecidedContainment` below reads, at read time, the
 * links `[D-429]`'s alignment results support: an objectives declaration containing a concept, and
 * an assessment's stated scope giving a concept standing. It writes nothing: a model-decided link is
 * never put into `OutcomeRecord.conceptKeys`, never written as a near-match record, and never read
 * as hers. It counts only when ALL of these hold, and the read checks them in this order:
 * 1. **Her correction control exists and works.** The read takes a required statement of it;
 *    anything but `true` disables everything, whatever the switches say (`[D-533]`: "a clause alone
 *    is insufficient"). No production caller states it, because no such control exists yet.
 * 2. **The basis's switch is on** (`../evidence-edge/basis-switch.ts`, `[D-432]`): objectives for a
 *    declaration, assessment briefs for a stated scope. Both off reads disabled. **A past paper
 *    never gives containment or standing, whatever its switch says** (`[D-433]`; F4.2: a historical
 *    paper is never proof of current scope): only a result stored as an objectives or stated-scope
 *    reading is ever looked at.
 * 3. **The result is current and aligned**: its revision is the document's current one, its
 *    closed-list, coverage and batch-plan digests are the caller's current ones (all three
 *    required), its frozen-configuration digest is the switch's passing configuration, it is
 *    `aligned`, and it carries its reader's provenance.
 * 4. **For containment, the record id names an active outcome of that document and course**, and
 *    the concept is not already attached to it (stored, or by this run): a pair reached by an
 *    exact name or alias is read once, as that attachment.
 * 5. **Her own decisions outrank the model.** A near-match record for the pair that she confirmed
 *    or declined (`[D-256]`), or that this build cannot read, gives no model-decided edge; and her
 *    correction history (`./containment-correction.ts`) removes a pair whose latest decision is a
 *    decline, or whose history cannot be read, keyed on the declaration so it persists across
 *    unrelated edits.
 */

import { conceptIdentityNormalizationIndex } from '../concept/concept-key.js';
import {
  type ConceptKeyCanonicalIndex,
  type ConceptKeyRecord,
  readConceptKeyCanonicalIndex,
} from '../concept/key-store.js';
import { type BasisSwitches, resolveBasisSwitches } from '../evidence-edge/basis-switch.js';
import { readStoreRecord, skipUnreadableStoreRecord } from '../vault/store-record.js';
import type { VaultSource } from '../vault/types.js';
import {
  type ContainmentDeclaration,
  isCorrectedAway,
  objectivesDeclarationOf,
  statedScopeDeclarationOf,
} from './containment-correction.js';
import {
  isOutcomeConceptNearMatchRecord,
  type OutcomeConceptNearMatchStatus,
  outcomeConceptNearMatchRecordPath,
  proposeOutcomeConceptNearMatch,
} from './near-match.js';
import {
  alignmentResultsForDocument,
  type ScopeReadingProjection,
  type ScopeRevisionRef,
} from './scope-reading-project.js';
import type { AlignmentDigests } from './scope-reading-types.js';
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
  readonly status: OutcomeConceptNearMatchStatus;
}

export interface OutcomeConceptReconciliationReport {
  readonly attached: readonly OutcomeConceptAttachment[];
  readonly proposed: readonly OutcomeConceptProposal[];
  /** Outcome ids for which no concept matched at all (exact, alias, or near) — see module doc. */
  readonly unattachedOutcomeIds: readonly string[];
  readonly unattachedCount: number;
  /**
   * `[D-433]`: the model-decided links, listed apart from `attached` and never written. Present only
   * when `ReconcileOutcomeConceptsOptions.modelDecided` was supplied and its read was not disabled
   * (module doc); absent otherwise, so a disabled read leaves the report exactly as it was.
   */
  readonly modelDecided?: {
    readonly edges: readonly ModelDecidedContainmentEdge[];
    readonly standings: readonly ModelDecidedScopeStanding[];
  };
}

export interface ReconcileOutcomeConceptsOptions {
  /** Threaded through to `attachConceptToOutcome`/`proposeOutcomeConceptNearMatch`. Injectable for deterministic tests. */
  readonly now?: () => string;
  /**
   * `[D-378]`: the canonical-key index the registry is folded through (module doc), and threaded
   * through to both writers. Read from the vault's `.olea/concepts/` store when omitted.
   */
  readonly canonicalKeys?: ConceptKeyCanonicalIndex;
  /**
   * `[D-433]`: read model-decided links after the reconciliation, with this run's outcomes,
   * attachments and canonical index (module doc). Omitted, nothing is read.
   */
  readonly modelDecided?: Omit<
    ReadModelDecidedContainmentInput,
    'outcomes' | 'attached' | 'canonicalKeys'
  >;
}

// ------------------------------------------------------------------------------------------------
// Model-decided containment and scope standing ([D-433], [D-533]) — see the module doc
// ------------------------------------------------------------------------------------------------

/** What a model-decided link was read from: the reader, the document revision and every digest. */
export interface ModelDecidedProvenance {
  readonly task: string;
  readonly promptVersion: string;
  readonly modelId: string;
  /** The document and the revision the result was made from. */
  readonly source: ScopeRevisionRef;
  readonly digests: AlignmentDigests;
}

/** An objectives declaration containing a concept, decided by the model. Never hers. */
export interface ModelDecidedContainmentEdge {
  readonly outcomeId: string;
  /** The concept's canonical key (`[D-378]`). */
  readonly conceptKey: string;
  readonly basis: 'objectives';
  readonly decidedBy: 'model';
  /** What her correction of this edge is keyed on (`./containment-correction.ts`). */
  readonly declaration: ContainmentDeclaration;
  readonly provenance: ModelDecidedProvenance;
}

/** An assessment's stated scope giving a concept standing on that assessment, decided by the model. Never hers. */
export interface ModelDecidedScopeStanding {
  /** The assessment's scope key; the standing is on this assessment and no other. */
  readonly scopeKey: string;
  readonly conceptKey: string;
  readonly basis: 'assessment-brief';
  readonly decidedBy: 'model';
  readonly declaration: ContainmentDeclaration;
  readonly provenance: ModelDecidedProvenance;
}

/** Why nothing was read: in the order the read checks (module doc). */
export type ModelDecidedDisabledReason =
  | 'correction-control-unavailable'
  | 'no-containment-basis-on';

export type ModelDecidedContainmentRead =
  | { readonly status: 'disabled'; readonly reason: ModelDecidedDisabledReason }
  | {
      readonly status: 'read';
      readonly edges: readonly ModelDecidedContainmentEdge[];
      readonly standings: readonly ModelDecidedScopeStanding[];
    };

/** One registered document at its CURRENT revision, with the digests current for it now. */
export interface ModelDecidedDocument {
  readonly source: ScopeRevisionRef;
  /** All three required, so no digest goes unchecked; the frozen configuration comes from the switch. */
  readonly currentDigests: {
    readonly closedList: string;
    readonly coverage: string;
    readonly batchPlan: string;
  };
}

export interface ReadModelDecidedContainmentInput {
  /**
   * `[D-533]`: whether her correction control for model-decided links exists in the shipped
   * plugin and works. Required, and only the literal `true` counts: absent, `false` or anything
   * else disables every model-decided link, whatever the switches say. A clause defining the
   * control is not enough. **No production caller states it today: no such control exists**, and
   * the bead that ships her working control is the one that may.
   */
  readonly correctionControlAvailable: boolean;
  readonly courseId: string;
  /** The course's outcome records (the caller scopes them, as for the reconciliation). */
  readonly outcomes: readonly OutcomeRecord[];
  /** The course's registered documents at their current revisions. A past paper here gives nothing. */
  readonly documents: readonly ModelDecidedDocument[];
  /** `[D-429]`'s projection (`./scope-reading-store.ts`'s `load()`). */
  readonly alignments: ScopeReadingProjection;
  /** `resolveBasisSwitches`' output. Omitted: every basis off (`NO_BASIS_GATE`). */
  readonly switches?: BasisSwitches;
  /** `[D-378]`. Read from the vault's concept store when omitted. */
  readonly canonicalKeys?: ConceptKeyCanonicalIndex;
  /** Pairs already attached by exact name or alias in this run, read once as that attachment. */
  readonly attached?: readonly Pick<OutcomeConceptAttachment, 'outcomeId' | 'conceptKey'>[];
}

function pairKey(a: string, b: string): string {
  return JSON.stringify([a, b]);
}

/** Every key of `conceptKey`'s identity: the canonical key first, then its superseded duplicates. */
function identityKeys(conceptKey: string, canonicalKeys: ConceptKeyCanonicalIndex): string[] {
  const canonical = canonicalKeys.canonicalOf(conceptKey);
  const keys = [canonical];
  for (const [duplicate, owner] of canonicalKeys.superseded) {
    if (owner === canonical && duplicate !== canonical) keys.push(duplicate);
  }
  return keys;
}

/** True when a near-match record for the pair is hers (confirmed or declined) or cannot be read. A pending proposal is false. */
async function nearMatchDecided(
  vault: VaultSource,
  outcomeId: string,
  conceptKey: string,
  canonicalKeys: ConceptKeyCanonicalIndex,
): Promise<boolean> {
  for (const key of identityKeys(conceptKey, canonicalKeys)) {
    const read = await readStoreRecord(
      vault,
      outcomeConceptNearMatchRecordPath(outcomeId, key),
      isOutcomeConceptNearMatchRecord,
    );
    if (read.kind === 'unreadable') return true;
    if (read.kind === 'record' && read.record.status !== 'proposed') return true;
  }
  return false;
}

/**
 * Reads the model-decided containment edges and scope standings that count now, under every
 * condition in the module doc. Writes nothing. Edges and standings come back in a fixed order
 * (by outcome id or scope key, then concept key).
 */
export async function readModelDecidedContainment(
  vault: VaultSource,
  input: ReadModelDecidedContainmentInput,
): Promise<ModelDecidedContainmentRead> {
  if (input.correctionControlAvailable !== true) {
    return { status: 'disabled', reason: 'correction-control-unavailable' };
  }
  const switches = input.switches ?? resolveBasisSwitches();
  const objectives = switches.objectives;
  const briefs = switches['assessment-brief'];
  if (objectives.status !== 'on' && briefs.status !== 'on') {
    return { status: 'disabled', reason: 'no-containment-basis-on' };
  }
  const canonicalKeys = input.canonicalKeys ?? (await readConceptKeyCanonicalIndex(vault));

  const attached = new Set<string>();
  for (const outcome of input.outcomes) {
    for (const key of outcome.conceptKeys) {
      attached.add(pairKey(outcome.id, canonicalKeys.canonicalOf(key)));
    }
  }
  for (const pair of input.attached ?? []) {
    attached.add(pairKey(pair.outcomeId, canonicalKeys.canonicalOf(pair.conceptKey)));
  }

  const edges = new Map<string, ModelDecidedContainmentEdge>();
  const standings = new Map<string, ModelDecidedScopeStanding>();
  for (const document of input.documents) {
    const kind = document.source.documentKind;
    // The past-paper guard: only an objectives or stated-scope reading is ever looked at.
    const switchState =
      kind === 'objectives' ? objectives : kind === 'stated-scope' ? briefs : undefined;
    if (switchState?.status !== 'on') continue;
    const frozenConfiguration = switchState.record.look.configurationDigest;
    const views = alignmentResultsForDocument(input.alignments, input.courseId, document.source, {
      ...document.currentDigests,
      frozenConfiguration,
    });
    for (const view of views) {
      if (view.status !== 'current' || view.result.kind !== 'aligned') continue;
      if (view.provenance === undefined) continue;
      const conceptKey = canonicalKeys.canonicalOf(view.conceptKey);
      const provenance: ModelDecidedProvenance = {
        task: view.provenance.task,
        promptVersion: view.provenance.promptVersion,
        modelId: view.provenance.modelId,
        source: document.source,
        digests: view.digests,
      };

      if (kind === 'stated-scope') {
        const scopeKey = document.source.sourcePath;
        const id = pairKey(scopeKey, conceptKey);
        if (standings.has(id)) continue;
        const declaration = statedScopeDeclarationOf(scopeKey);
        if (await isCorrectedAway(vault, declaration, conceptKey, canonicalKeys)) continue;
        standings.set(id, {
          scopeKey,
          conceptKey,
          basis: 'assessment-brief',
          decidedBy: 'model',
          declaration,
          provenance,
        });
        continue;
      }

      for (const recordId of view.result.recordIds) {
        const outcome = input.outcomes.find(
          (candidate) =>
            candidate.id === recordId &&
            candidate.status === 'active' &&
            candidate.source.path === document.source.sourcePath &&
            candidate.courses.includes(input.courseId),
        );
        if (outcome === undefined) continue;
        const id = pairKey(outcome.id, conceptKey);
        if (edges.has(id) || attached.has(id)) continue;
        if (await nearMatchDecided(vault, outcome.id, conceptKey, canonicalKeys)) continue;
        const declaration = await objectivesDeclarationOf(outcome);
        if (await isCorrectedAway(vault, declaration, conceptKey, canonicalKeys)) continue;
        edges.set(id, {
          outcomeId: outcome.id,
          conceptKey,
          basis: 'objectives',
          decidedBy: 'model',
          declaration,
          provenance,
        });
      }
    }
  }

  const byKey = (a: [string, unknown], b: [string, unknown]) =>
    a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0;
  return {
    status: 'read',
    edges: [...edges].sort(byKey).map(([, edge]) => edge),
    standings: [...standings].sort(byKey).map(([, standing]) => standing),
  };
}

/**
 * `concepts` with the entries of one identity folded into one (`[D-378]`, module doc): keyed by the
 * canonical key, first-seen order kept. The folded entry takes the canonical key's own entry's
 * name when that entry is present (else the first non-null name), and answers to every other name
 * and alias in the group as an alias. An entry alone in its identity under its canonical key is
 * passed through as it is.
 */
function foldRegistryThroughCanonicalKeys(
  concepts: readonly OutcomeConceptRegistryEntry[],
  canonicalKeys: ConceptKeyCanonicalIndex,
): readonly OutcomeConceptRegistryEntry[] {
  const groups = new Map<string, OutcomeConceptRegistryEntry[]>();
  for (const concept of concepts) {
    const key = canonicalKeys.canonicalOf(concept.key);
    const group = groups.get(key);
    if (group === undefined) groups.set(key, [concept]);
    else group.push(concept);
  }
  const folded: OutcomeConceptRegistryEntry[] = [];
  for (const [key, group] of groups) {
    const [only] = group;
    if (group.length === 1 && only !== undefined && only.key === key) {
      folded.push(only);
      continue;
    }
    const own = group.find((concept) => concept.key === key);
    const name = own?.name ?? group.find((concept) => concept.name !== null)?.name ?? null;
    const wordings = [own, ...group.filter((concept) => concept !== own)].flatMap((concept) =>
      concept === undefined
        ? []
        : [...(concept.name !== null ? [concept.name] : []), ...concept.aliases],
    );
    folded.push({
      key,
      name,
      aliases: dedupe(wordings.filter((wording) => wording !== name)),
    });
  }
  return folded;
}

/**
 * The reconciliation itself. For every ACTIVE outcome in `outcomes`, checks every entry in
 * `concepts`: an exact/alias match attaches directly (`attachConceptToOutcome`); a near match
 * proposes a near-match record between the outcome id and the concept key
 * (`proposeOutcomeConceptNearMatch`) rather than attaching; no match at all leaves the outcome
 * untouched and its id lands in `unattachedOutcomeIds`. Both underlying writers are idempotent, so
 * re-running this against a course already partly reconciled writes nothing new for a pair
 * already settled. `concepts` is first folded to one entry per concept identity, under its
 * canonical key (`[D-378]`, module doc), so "every entry" means every identity.
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
  const canonicalKeys = options.canonicalKeys ?? (await readConceptKeyCanonicalIndex(vault));
  const registry = foldRegistryThroughCanonicalKeys(concepts, canonicalKeys);
  const writerOptions = {
    canonicalKeys,
    ...(options.now !== undefined ? { now: options.now } : {}),
  };

  for (const outcome of outcomes) {
    if (outcome.status !== 'active') continue;
    let matchedAny = false;

    for (const concept of registry) {
      const kind = classifyOutcomeConceptMatch(outcome.label, concept);
      if (kind === 'exact-name' || kind === 'accepted-alias') {
        await attachConceptToOutcome(vault, outcome.id, concept.key, writerOptions);
        attached.push({ outcomeId: outcome.id, conceptKey: concept.key, kind });
        matchedAny = true;
      } else if (kind === 'near-token-containment') {
        matchedAny = true;
        let nearMatch: Awaited<ReturnType<typeof proposeOutcomeConceptNearMatch>>;
        try {
          nearMatch = await proposeOutcomeConceptNearMatch(
            vault,
            outcome.id,
            concept.key,
            writerOptions,
          );
        } catch (error) {
          // A near-match record this build cannot read is left exactly as it is and skipped
          // (T12, `ol-egov.141.89.104.2`); the rest of the reconciliation carries on.
          skipUnreadableStoreRecord(error);
          continue;
        }
        proposed.push({
          outcomeId: outcome.id,
          conceptKey: concept.key,
          status: nearMatch.status,
        });
      }
    }

    if (!matchedAny) unattachedOutcomeIds.push(outcome.id);
  }

  const report: OutcomeConceptReconciliationReport = {
    attached,
    proposed,
    unattachedOutcomeIds,
    unattachedCount: unattachedOutcomeIds.length,
  };
  if (options.modelDecided === undefined) return report;
  // `[D-433]`: read after this run's writes, never written itself; a disabled read changes nothing.
  const read = await readModelDecidedContainment(vault, {
    ...options.modelDecided,
    outcomes,
    attached,
    canonicalKeys,
  });
  if (read.status === 'disabled') return report;
  return { ...report, modelDecided: { edges: read.edges, standings: read.standings } };
}
