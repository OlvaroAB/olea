/**
 * Real, client-side nomination-signal computation for the corpus-level
 * relation stage (`[D-082]`, component register row 1.2a, `[EXT-11]`
 * `ol-kw4a`, `ol-2zfj.13`), plus the passage-text resolution
 * `runCorpusRelationBatch`'s `PassageTextLookup` needs. All three read
 * mostly the same set of files, so this module does the vault work in one
 * pass rather than three.
 *
 * **`ol-2zfj.64` [REL-5]: passage text is now the anchor's SECTION, not its
 * bare block.** `gatherCorpusRelationVaultContext`'s `passageTextByName`
 * used to be a plain `content.slice(charRange.start, charRange.end)` — the
 * one anchor block, and nothing else. The pre-flight judge contrast
 * measured that this loses 41 of 49 real edges against a whole-note
 * baseline (`findings/frontier-loop-preflight-2026-09-07.md` S3,
 * `olea-service`). `sectionPassageText` (below) widens it to the anchor's
 * nearest enclosing heading and its own content, or the whole note when
 * there is no heading to key on, bounded by the declared
 * `RELATIONS_ENDPOINT_CHAR_BUDGET` — see that constant's own doc for where
 * the number comes from.
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
  buildOutline,
  type CorpusConcept,
  cosineSimilarity,
  type EmbeddingCacheEngine,
  hashText,
  type MisconceptionRecord,
  type NominationSignal,
  type OutlineNode,
  type ParsedDocument,
  parseDocument,
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

/**
 * `ol-2zfj.64` [REL-5]. **Declared, never fitted** (the component register's
 * declared/derived line): the per-endpoint character budget for a relations
 * candidate's `sourceChunks` entry.
 *
 * Replaces the bare anchor-block slice (`content.slice(charRange.start,
 * charRange.end)`) that production sent until this bead — measured, in the
 * pre-flight judge contrast, to lose 41 of 49 real edges against a whole-note
 * baseline (`findings/frontier-loop-preflight-2026-09-07.md` S3,
 * `olea-service`). `sectionPassageText` below now carries the anchor's own
 * SECTION (its nearest enclosing heading's material, or the whole note when
 * there is no heading structure to key on) instead of the bare block, and
 * this budget is what keeps that section from becoming a second whole-note
 * payload for her longest notes.
 *
 * **Where 4000 comes from, in plain English.** The demand model's own
 * measured note-size distribution (`docs/Olea_ai_workload_and_cost_model.md`,
 * "What the demand model has no line for" §1, `olea-service`;
 * `findings/demand-model-authoring-rate.md`) puts a typical new note's
 * *median* under ~210 bytes and its *mean* at ~2 KB, with a long tail running
 * to ~26.5 KB. 4000 characters is roughly double that mean — generous enough
 * that an ordinary lecture section fits whole, without also being large
 * enough to reproduce the 1.5 MB whole-note payload the harness's own
 * `RELATIONS_CHUNKS_PER_ENDPOINT` doc (`olea-service`,
 * `scripts/harness/playback-extraction.mjs`) named as the failure mode this
 * bound exists to avoid. It is a plain-English generosity call, not a number
 * swept or scored against an eval set — nothing here was fitted.
 */
export const RELATIONS_ENDPOINT_CHAR_BUDGET = 4000;

/**
 * The block in `doc.blocks` whose own `[start, end)` contains `charRange` —
 * the concept's own anchor block, when `charRange` was produced by
 * `../read.js`'s own convention (every anchor a concept gets IS one block's
 * real `[start, end)`, per that module's doc). `-1` when nothing contains
 * it — a hand-built or since-stale `charRange` — so the caller can degrade
 * to the bare slice rather than guessing at a section.
 */
function blockIndexContaining(
  doc: ParsedDocument,
  charRange: { readonly start: number; readonly end: number },
): number {
  return doc.blocks.findIndex((b) => b.start <= charRange.start && b.end >= charRange.end);
}

/**
 * The heading node whose OWN material `blockIndex` belongs to, or `undefined`
 * when `blockIndex` sits before every heading (or the note has none at all).
 *
 * **Deliberately NOT `../read.js`'s `sectionsByBlockIndex` convention.** That
 * function labels a block for citation and specifically wants a heading's own
 * block tagged with its PARENT's heading (so a citation never reads a heading
 * as if it were content one level inside itself). This function instead picks
 * the section to WIDEN a passage to — and when the anchor block IS a heading
 * (a concept whose own anchor is a lecture heading, `../read.js`'s "her
 * lecture headings are question-shaped" case), the material that actually
 * explains it is that heading's OWN content, not its parent's. So a heading
 * match returns ITSELF here, not its parent.
 */
function findEnclosingNode(
  nodes: readonly OutlineNode[],
  blockIndex: number,
): OutlineNode | undefined {
  for (const node of nodes) {
    if (node.index === blockIndex) return node;
    if (node.contentIndices.includes(blockIndex)) return node;
    const found = findEnclosingNode(node.children, blockIndex);
    if (found !== undefined) return found;
  }
  return undefined;
}

/** The char span covering every block named in `indices` — `undefined` for an empty or all-missing list. */
function blockRangeOf(
  doc: ParsedDocument,
  indices: readonly number[],
): { start: number; end: number } | undefined {
  let start = Number.POSITIVE_INFINITY;
  let end = Number.NEGATIVE_INFINITY;
  for (const i of indices) {
    const block = doc.blocks[i];
    if (block === undefined) continue;
    start = Math.min(start, block.start);
    end = Math.max(end, block.end);
  }
  return start <= end ? { start, end } : undefined;
}

/**
 * Truncates `[sectionStart, sectionEnd)` to at most `budget` characters,
 * centred on the anchor's own `charRange` — the anchor is never dropped, and
 * never itself truncated unless it alone exceeds the budget (an edge case,
 * not the ordinary path). Context is taken symmetrically from both sides of
 * the anchor and clipped to the section's own bounds; if one side runs out
 * of room first, the leftover budget is handed to the other side rather than
 * left unused.
 */
function boundAroundAnchor(
  content: string,
  section: { readonly start: number; readonly end: number },
  anchor: { readonly start: number; readonly end: number },
  budget: number,
): string {
  if (section.end - section.start <= budget) {
    return content.slice(section.start, section.end);
  }
  const anchorLen = anchor.end - anchor.start;
  if (anchorLen >= budget) {
    return content.slice(anchor.start, anchor.start + budget);
  }
  const remaining = budget - anchorLen;
  const half = Math.floor(remaining / 2);
  let start = Math.max(section.start, anchor.start - half);
  let end = Math.min(section.end, anchor.end + (remaining - half));
  let shortfall = budget - (end - start);
  if (shortfall > 0) {
    const extendEnd = Math.min(section.end - end, shortfall);
    end += extendEnd;
    shortfall -= extendEnd;
  }
  if (shortfall > 0) {
    const extendStart = Math.min(start - section.start, shortfall);
    start -= extendStart;
  }
  return content.slice(start, end);
}

/**
 * `ol-2zfj.64` [REL-5]. The anchor block's own passage text, widened to its
 * SURROUNDING SECTION and bounded by `budget` — the fix this bead makes for
 * the payload production actually sends (`WorkerCorpusRelationVerdict.
 * toWireEndpoint`, `packages/plugin/src/concept/
 * workerCorpusRelationVerdict.ts`, still `sourceChunks: [passageText]`, ONE
 * entry; only what that one entry carries changes here).
 *
 * "Section" is the anchor's nearest enclosing heading's own material — the
 * heading line plus the content directly under it, NOT nested subsections
 * (`findEnclosingNode`'s contract) — or, when the anchor sits before any
 * heading or the note has none at all, the WHOLE note. Either way the result
 * is then bounded to `budget` characters, always keeping the anchor's own
 * `charRange` intact (`boundAroundAnchor`).
 *
 * Degrades to the bare `charRange` slice — production's PRE-bead behaviour —
 * whenever the note no longer parses the way `charRange` implies (a stale
 * offset, a hand-built range in a test): honest degradation over a guess,
 * the same posture this module already takes for an unreadable anchor file.
 */
export function sectionPassageText(
  content: string,
  charRange: { readonly start: number; readonly end: number },
  budget: number = RELATIONS_ENDPOINT_CHAR_BUDGET,
): string {
  const doc = parseDocument(content);
  const blockIndex = blockIndexContaining(doc, charRange);
  if (blockIndex === -1) {
    return content.slice(charRange.start, charRange.end);
  }

  const roots = buildOutline(doc);
  const node = findEnclosingNode(roots, blockIndex);

  let section: { start: number; end: number };
  if (node !== undefined) {
    section = blockRangeOf(doc, [node.index, ...node.contentIndices]) ?? {
      start: charRange.start,
      end: charRange.end,
    };
  } else {
    const first = doc.blocks[0];
    const last = doc.blocks[doc.blocks.length - 1];
    section =
      first !== undefined && last !== undefined
        ? { start: first.start, end: last.end }
        : { start: charRange.start, end: charRange.end };
  }

  // Defensive floor: whatever the outline math produced, it must at least
  // cover the anchor itself.
  section = {
    start: Math.min(section.start, charRange.start),
    end: Math.max(section.end, charRange.end),
  };

  return boundAroundAnchor(content, section, charRange, budget);
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
    // throwing if it ever is, by falling back to the whole passage's text (bounded, same as the
    // ordinary path below — see `RELATIONS_ENDPOINT_CHAR_BUDGET`'s own doc for why an unbounded
    // whole note was never the fix).
    const charRange = concept.anchor.location.charRange;
    const passageText =
      charRange !== undefined
        ? sectionPassageText(content, charRange)
        : content.slice(0, RELATIONS_ENDPOINT_CHAR_BUDGET);
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
