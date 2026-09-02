/**
 * Real, client-side nomination-signal computation for the corpus-level
 * relation stage (`[D-082]`, component register row 1.2a, `[EXT-11]`
 * `ol-kw4a`, `ol-2zfj.13`), plus the passage-text resolution
 * `runCorpusRelationBatch`'s `PassageTextLookup` needs. All three read
 * mostly the same set of files, so this module does the vault work in one
 * pass rather than three.
 *
 * **All three register-row-1.2a-named signals are wired, plus a fourth from
 * outside that row.** Component register row 1.2a names three
 * nomination-signal sources: assessment-document co-occurrence,
 * embedding-proximity over the local vector cache, and her own wikilinks
 * between concept notes (`'her-link'`,
 * `packages/core/src/concept/corpus-relations/types.ts`'s
 * `NominationSignalKind`). `ol-kw4a` wired `her-link` alone and named the
 * other two deferred, real-subsystem work; `ol-2zfj.13` is that follow-on:
 *
 * - **`her-link`** — unchanged from `ol-kw4a`: scans every concept's own
 *   anchor passage for a `[[target]]` resolving to another concept in the
 *   same set. See the section below for why anchor passages, not a
 *   dedicated folder.
 * - **`assessment-cooccurrence`** — reuses `registerSources`
 *   (`packages/core/src/source/register.ts`, F1.5), the SAME reader that
 *   already classifies a vault note as a past paper or an objectives
 *   document for tier-3 evidence extraction
 *   (`packages/core/src/concept/evidence.ts`'s `pastPaperCitations`/
 *   `objectivesCitations`) — no new "what counts as an assessment document"
 *   heuristic is invented here. Two concepts co-occurring anywhere in the
 *   same classified document's text nominate a pair. Term matching restates
 *   `evidence.ts`'s own `findMentionedTerms` rule (case-insensitive,
 *   word-bounded) rather than importing it — that function is module-private
 *   there, the same reason `WIKILINK_RE` below is restated rather than
 *   imported. **Markdown assessment documents only** (`Source.format ===
 *   null`): a PDF past paper or objectives file would need the extraction
 *   pipeline (`../extract/registry.js`) run first, which is real subsystem
 *   work this signal does not also stand up — it degrades to "not counted"
 *   for such a file rather than guessing at its text.
 *
 *   **Revisited by `ol-3ux7.10` and left unchanged.** That bead wired a PDF
 *   past paper's *questions* into `../concept/evidence.js`'s
 *   `kind: 'past-paper'` citations via
 *   `../source/segment-past-paper-plaintext.js`. This signal never consumed
 *   that structure — co-occurrence only needs a document's raw text, not its
 *   question boundaries — so there is nothing here for that segmenter to
 *   feed. Lifting the `format === null` filter would still mean standing up
 *   the extraction pipeline in this module for the first time, the same real
 *   subsystem work named above, so it stays out of scope here.
 * - **`embedding-proximity`** — reads `codesFor` off an ALREADY-BUILT local
 *   embedding cache (`packages/core/src/retrieval/embeddingCache.ts`'s
 *   `EmbeddingCacheEngine`, composed for real by
 *   `packages/plugin/src/retrieval/wiring.ts`'s `buildRetrievalWiring`) —
 *   never `ensureEmbeddings`. This module only ever reads what retrieval
 *   already cached for its own purposes; it never triggers a new embedding
 *   call and never needs the Worker reachable at nomination time. A
 *   concept's introducing passage is looked up by the SAME content-hash key
 *   `chunksFromIndex` uses (`hashText` of the exact block text — a
 *   concept's `anchor.location.charRange` is always one block's
 *   `[start, end)`, the identical span `chunksFromIndex` hashes for the
 *   embedding cache, so the two are the same lookup key by construction, not
 *   by coincidence). A pair whose passages were never both retrieval-indexed
 *   (nothing embedded them yet) contributes no signal — an honest "the local
 *   cache doesn't have it," never a fabricated score. **Opt-in, no default
 *   cache and no default threshold**: see `EmbeddingProximityOptions` below
 *   for why the threshold is a required option with no declared value.
 *
 * - **`assessment-error-adjacency`** — `ol-2zfj.19`, sourced from the grading
 *   judge's pairwise confusion evidence rather than from anything this
 *   module reads out of the vault itself. `workerJudgeCaller.ts` parses a
 *   `confusedWith` name out of the Worker's response, `gradingPipeline.ts`
 *   carries it through as `ObservationInput.confusedWith`, and
 *   `misconception/events.ts`/`project.ts` fold it onto
 *   `MisconceptionRecord.confusedWithConceptId` — an already-projected,
 *   already-in-memory read-model by the time it reaches here (see the
 *   confusion-pairing scoping memo,
 *   `olea-service/docs/direction/papers/confusion-pairing-home/PROPOSAL.md`
 *   §2(a), for the full call chain and why this was the first buildable
 *   producer of the three it considered). **Opt-in, like
 *   `embedding-proximity` and for an analogous reason**: unlike `her-link`
 *   and `assessment-cooccurrence`, which only need what this function
 *   already has in hand (a `VaultSource` and `concepts`), this signal needs
 *   an extra input — the misconception projection — that no caller of this
 *   function is wired to supply yet (there is no client-side misconception
 *   store construction anywhere in `packages/plugin` today). Omitting
 *   `assessmentErrorAdjacency` computes no such signal, the same
 *   "absent, not guessed" contract `embeddingProximity` follows. See
 *   `AssessmentErrorAdjacencyOptions` below for the concept-identity
 *   assumption this pass makes and why.
 *
 * **Why this scans every concept's OWN anchor passage, not a dedicated
 * "concept note" folder.** `[D-068]` corroborates concepts from the material
 * itself, her concept notes, and her `topic` property — a concept's
 * `anchor` may be a lecture note, a paper, or a dedicated zettelkasten note,
 * and nothing at this layer distinguishes which. Scanning every anchor
 * source for `[[...]]` targets that resolve to another concept in the SAME
 * course's set is the honest reading of "her own wikilinks between concept
 * notes" available without inventing a folder convention this bead was not
 * asked to design.
 */

import {
  type CorpusConcept,
  cosineSimilarity,
  type EmbeddingCacheEngine,
  hashText,
  type MisconceptionRecord,
  type NominationSignal,
  registerSources,
  type VaultPath,
  type VaultSource,
} from 'olea-core';

/** Matches `[[target]]`, `[[target#heading]]`, `[[target|alias]]` (and the combination) — same shape `olea-core`'s frontmatter reader uses for the identical syntax, restated here rather than imported across a package this module has no other reason to depend on for one regex. */
const WIKILINK_RE = /\[\[([^[\]]+)\]\]/g;

function wikilinkTargets(raw: string): readonly string[] {
  const targets: string[] = [];
  for (const match of raw.matchAll(WIKILINK_RE)) {
    const inner = match[1];
    if (inner === undefined) continue;
    const target = inner.split('#')[0]?.split('|')[0]?.trim();
    if (target) targets.push(target);
  }
  return targets;
}

/**
 * Unordered pair key. The separator is NUL as a source-level escape (never a
 * raw byte in this file): concept names routinely contain spaces, so a
 * space-joined key collides on equality — `('a b','c')` and `('a','b c')`
 * would dedup as one pair. NUL cannot appear in a concept name.
 */
function unorderedPairKey(a: string, b: string): string {
  return a < b ? `${a}\u0000${b}` : `${b}\u0000${a}`;
}

/** Restates `packages/core/src/concept/evidence.ts`'s own `escapeRegExp` — module-private there, same reason `WIKILINK_RE` above is restated rather than imported. */
function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Case-insensitive, word-bounded term match — the exact rule `evidence.ts`'s `findMentionedTerms` already uses to decide whether a concept "appears in" a past-paper or objectives document for tier-3 evidence. Restated, not imported (see the module doc): one function, module-private on the other side, not worth a new cross-package export. */
function mentionsTerm(text: string, term: string): boolean {
  if (term === '') return false;
  return new RegExp(`\\b${escapeRegExp(term)}\\b`, 'i').test(text);
}

/** `true` when `text` mentions `concept` by its canonical name or any alias. */
function conceptMentioned(text: string, concept: CorpusConcept): boolean {
  return (
    mentionsTerm(text, concept.name) || concept.aliases.some((alias) => mentionsTerm(text, alias))
  );
}

export interface AssessmentCooccurrenceOptions {
  /** Forwarded to `registerSources` — overrides its own `DEFAULT_SOURCES_FOLDER` ('03 Research', F7.9). Omit to use that default. */
  readonly sourcesFolder?: VaultPath;
}

/**
 * Wires the `embedding-proximity` nomination signal against an
 * ALREADY-BUILT local embedding cache — see the module doc's
 * `embedding-proximity` section for what this does and does not do.
 *
 * **`threshold` is a REQUIRED option with no default, deliberately.** A
 * cosine-similarity cutoff for "these two concepts are close enough to
 * nominate" is a DERIVED constant in the component register's sense — it
 * has to be fitted against real embedded passages and scored against a
 * held-out or eval set, the same posture `classifyConceptKnowledgeKind`'s
 * `confidenceFloor` holds in `wiring.ts` and for the identical reason: no
 * such derivation has run for this signal, so there is no defensible,
 * plain-English number to declare as a fallback. Inventing one here (0.8,
 * say) would look like a considered choice and be a guess. A caller that
 * wants this signal on must supply a measured value; a caller that has none
 * yet omits `embeddingProximity` entirely, and the signal simply does not
 * fire — the same F7.8-shaped "absent, not guessed" contract every other
 * unconfigured port in this plugin follows.
 */
export interface EmbeddingProximityOptions {
  readonly cache: EmbeddingCacheEngine;
  readonly threshold: number;
}

/**
 * Wires the `assessment-error-adjacency` nomination signal against an
 * already-projected misconception read-model — see the module doc's
 * `assessment-error-adjacency` section for what this does and does not do.
 *
 * **`records` is a plain array, not a store handle.** This module has no
 * vault or network access of its own reason to gain one for this signal
 * either — `nominate.js`'s own doc makes the identical choice for every
 * signal source ("this module takes their output as plain data and stays
 * agnostic to how any of it was computed"). The caller resolves
 * `projectMisconceptions`'s current read-model once per batch and hands the
 * result in, same shape any other consumer of the misconception store reads.
 *
 * **Concept identity assumption, stated rather than silently relied on.**
 * `MisconceptionRecord.conceptId`/`confusedWithConceptId` are typed as plain
 * `string` with no identity-space documented on the misconception module
 * itself (no reference to `[D-088]`'s opaque `ConceptRecord.key` anywhere in
 * `packages/core/src/misconception/`), and no production caller populates
 * `ObservationInput.conceptId` yet — `packages/plugin` has no client-side
 * misconception store construction today. This pass resolves both ids
 * against `concepts`' own `name`/`aliases` space, the SAME identity
 * `her-link` and `assessment-cooccurrence` already key on and that
 * `relation.ts` itself documents as this stage's deliberate interim choice
 * ("`from`/`to` are NAMES... [because] C7.11 rules identity is an opaque key
 * never derived from content" but the opaque-key registry does not exist
 * yet). An id that resolves to no known concept name/alias nominates
 * nothing — the same "unrecognised concept nominates nothing" discipline
 * `nominate.js` itself enforces for a signal naming an unknown name. If a
 * future misconception-store caller instead stamps `conceptId` with
 * `[D-088]`'s opaque key, this pass's resolution silently stops matching
 * (every id looks unrecognised) rather than mismatching silently — a caller
 * wiring that store for the first time should verify a resolved-pair count
 * that is not permanently zero.
 */
export interface AssessmentErrorAdjacencyOptions {
  readonly records: readonly MisconceptionRecord[];
}

export interface CorpusRelationVaultContextOptions {
  /** Assessment-document co-occurrence is always attempted (mirrors `her-link`'s always-on posture); this only overrides where `registerSources` looks. */
  readonly sourcesFolder?: VaultPath;
  /** Omitted (the default) skips the embedding-proximity signal entirely — see `EmbeddingProximityOptions`'s own doc for why there is no default cache or threshold to fall back to. */
  readonly embeddingProximity?: EmbeddingProximityOptions;
  /** Omitted (the default) skips the assessment-error-adjacency signal entirely — no caller wires a misconception store into this function yet; see `AssessmentErrorAdjacencyOptions`'s own doc. */
  readonly assessmentErrorAdjacency?: AssessmentErrorAdjacencyOptions;
}

export interface CorpusRelationVaultContext {
  /** Every nomination signal found this pass — `her-link` (wikilinks between concept notes), `assessment-cooccurrence` (co-occurrence in a classified past-paper or objectives document), `embedding-proximity` (cosine proximity over the local embedding cache, when `options.embeddingProximity` is supplied) and `assessment-error-adjacency` (grading-judge confusion evidence, when `options.assessmentErrorAdjacency` is supplied). See the module doc for what each does and does not compute. */
  readonly signals: readonly NominationSignal[];
  /** Every concept's introducing-passage TEXT, keyed by its `name` — `runCorpusRelationBatch`'s `PassageTextLookup` reads from this, pre-resolved because that lookup is synchronous. */
  readonly passageTextByName: ReadonlyMap<string, string>;
}

/**
 * The `assessment-cooccurrence` pass: classify sources via `registerSources`
 * (F1.5's own past-paper/objectives reader), read every markdown one found,
 * and nominate every pair of `concepts` both mentioned in that document's
 * text. Non-markdown sources (`format !== null`) are skipped — see the
 * module doc's `assessment-cooccurrence` section for why.
 */
async function assessmentCooccurrenceSignals(
  vault: VaultSource,
  concepts: readonly CorpusConcept[],
  readCached: (path: VaultPath) => Promise<string>,
  sourcesFolder: VaultPath | undefined,
): Promise<readonly NominationSignal[]> {
  const report = await registerSources(vault, sourcesFolder !== undefined ? { sourcesFolder } : {});
  const assessmentDocs = report.sources.filter(
    (source) =>
      (source.role === 'past-paper' || source.role === 'objectives') && source.format === null,
  );

  const seenPairs = new Set<string>();
  const signals: NominationSignal[] = [];

  for (const doc of assessmentDocs) {
    const text = await readCached(doc.path);
    if (text === '') continue;
    const present = concepts.filter((concept) => conceptMentioned(text, concept));
    for (let i = 0; i < present.length; i++) {
      for (let j = i + 1; j < present.length; j++) {
        const a = present[i];
        const b = present[j];
        if (a === undefined || b === undefined || a.name === b.name) continue;
        const key = unorderedPairKey(a.name, b.name);
        if (seenPairs.has(key)) continue;
        seenPairs.add(key);
        signals.push({ kind: 'assessment-cooccurrence', a: a.name, b: b.name });
      }
    }
  }
  return signals;
}

/**
 * The `embedding-proximity` pass: hash every concept's already-resolved
 * introducing-passage text, look up cached codes for that hash (never
 * computing new ones — see the module doc), and nominate every pair whose
 * cosine similarity meets `threshold`.
 */
async function embeddingProximitySignals(
  passageTextByName: ReadonlyMap<string, string>,
  options: EmbeddingProximityOptions,
): Promise<readonly NominationSignal[]> {
  const codesByName = new Map<string, NonNullable<ReturnType<EmbeddingCacheEngine['codesFor']>>>();
  for (const [name, text] of passageTextByName) {
    if (text === '') continue;
    const hash = await hashText(text);
    const codes = options.cache.codesFor(hash);
    if (codes !== undefined) codesByName.set(name, codes);
  }

  const names = [...codesByName.keys()];
  const signals: NominationSignal[] = [];
  for (let i = 0; i < names.length; i++) {
    for (let j = i + 1; j < names.length; j++) {
      const aName = names[i];
      const bName = names[j];
      if (aName === undefined || bName === undefined) continue;
      const aCodes = codesByName.get(aName);
      const bCodes = codesByName.get(bName);
      if (aCodes === undefined || bCodes === undefined) continue;
      if (cosineSimilarity(aCodes, bCodes) >= options.threshold) {
        signals.push({ kind: 'embedding-proximity', a: aName, b: bName });
      }
    }
  }
  return signals;
}

/**
 * The `assessment-error-adjacency` pass: turn every misconception record's
 * `confusedWithConceptId` into a nomination signal, resolving both ids
 * against `byName` (concept name or alias -> `CorpusConcept`, the same index
 * `her-link`'s wikilink resolution uses) — see
 * `AssessmentErrorAdjacencyOptions`'s own doc for the identity assumption
 * this makes and why. Pure and synchronous: no vault or network access,
 * `records` is already the in-memory read-model.
 */
function assessmentErrorAdjacencySignals(
  byName: ReadonlyMap<string, CorpusConcept>,
  records: readonly MisconceptionRecord[],
): readonly NominationSignal[] {
  const seenPairs = new Set<string>();
  const signals: NominationSignal[] = [];

  for (const record of records) {
    if (record.confusedWithConceptId === null) continue;
    const a = byName.get(record.conceptId);
    const b = byName.get(record.confusedWithConceptId);
    if (a === undefined || b === undefined || a.name === b.name) continue;
    const key = unorderedPairKey(a.name, b.name);
    if (seenPairs.has(key)) continue;
    seenPairs.add(key);
    signals.push({ kind: 'assessment-error-adjacency', a: a.name, b: b.name });
  }
  return signals;
}

/**
 * One vault pass over `concepts`' own anchor files, the classified
 * assessment documents `registerSources` finds, and (when wired) the local
 * embedding cache: resolves each concept's introducing-passage text (for
 * `PassageTextLookup`) and computes every nomination signal named in the
 * module doc. Anchor files are read at most once each, cached by path — an
 * assessment document that happens to also be some concept's anchor (a
 * tier-3 concept minted from a past paper, say) is not re-read for the
 * co-occurrence pass.
 *
 * Best-effort throughout: a file that fails to read (deleted since the read
 * that anchored it, a permissions error) contributes empty passage text and
 * no signals for that concept rather than failing the whole pass — nomination
 * is a cheap-signal stage by design (`[D-082]`: "cheap signals nominate; the
 * material decides"), and a caller missing one candidate is a smaller
 * failure than a caller that cannot run the batch at all.
 */
export async function gatherCorpusRelationVaultContext(
  vault: VaultSource,
  concepts: readonly CorpusConcept[],
  options: CorpusRelationVaultContextOptions = {},
): Promise<CorpusRelationVaultContext> {
  const byName = new Map<string, CorpusConcept>();
  for (const concept of concepts) {
    if (!byName.has(concept.name)) byName.set(concept.name, concept);
    for (const alias of concept.aliases) {
      if (!byName.has(alias)) byName.set(alias, concept);
    }
  }

  const fileCache = new Map<VaultPath, string>();
  async function readCached(path: VaultPath): Promise<string> {
    const cached = fileCache.get(path);
    if (cached !== undefined) return cached;
    let content: string;
    try {
      content = await vault.read(path);
    } catch {
      content = '';
    }
    fileCache.set(path, content);
    return content;
  }

  const passageTextByName = new Map<string, string>();
  const seenPairs = new Set<string>();
  const signals: NominationSignal[] = [];

  for (const concept of concepts) {
    const content = await readCached(concept.anchor.sourcePath);
    // `charRange` is optional (`../../core/src/extract/types.js`, `ol-2zfj.54`); every anchor a
    // concept actually gets is one block's real `[start, end)` (see the module doc above), so
    // this is never absent in practice — but a nomination signal degrades honestly rather than
    // throwing if it ever is, by falling back to the whole passage's text.
    const charRange = concept.anchor.location.charRange;
    const passageText =
      charRange !== undefined ? content.slice(charRange.start, charRange.end) : content;
    passageTextByName.set(concept.name, passageText);

    for (const target of wikilinkTargets(content)) {
      const linked = byName.get(target);
      if (linked === undefined || linked.name === concept.name) continue;
      const key = unorderedPairKey(concept.name, linked.name);
      if (seenPairs.has(key)) continue;
      seenPairs.add(key);
      signals.push({ kind: 'her-link', a: concept.name, b: linked.name });
    }
  }

  signals.push(
    ...(await assessmentCooccurrenceSignals(vault, concepts, readCached, options.sourcesFolder)),
  );

  if (options.embeddingProximity !== undefined) {
    signals.push(
      ...(await embeddingProximitySignals(passageTextByName, options.embeddingProximity)),
    );
  }

  if (options.assessmentErrorAdjacency !== undefined) {
    signals.push(
      ...assessmentErrorAdjacencySignals(byName, options.assessmentErrorAdjacency.records),
    );
  }

  return { signals, passageTextByName };
}
