/**
 * Real, client-side nomination-signal computation for the corpus-level
 * relation stage (`[D-082]`, component register row 1.2a, `[EXT-11]`
 * `ol-kw4a`, `ol-2zfj.13`), plus the passage-text resolution
 * `runCorpusRelationBatch`'s `PassageTextLookup` needs. All three read
 * mostly the same set of files, so this module does the vault work in one
 * pass rather than three.
 *
 * **`ol-2zfj.64` [REL-5]: passage text is now the WHOLE source note, bounded
 * by budget — not the anchor's bare block, and not only its section either.**
 * `gatherCorpusRelationVaultContext`'s `passageTextByName` started as a plain
 * `content.slice(charRange.start, charRange.end)` — the one anchor block, and
 * nothing else. The pre-flight judge contrast measured that this loses 41 of
 * 49 real edges against a whole-note baseline
 * (`findings/frontier-loop-preflight-2026-09-07.md` S3, `olea-service`). The
 * first fix widened it to the anchor's own SECTION (`sectionPassageText`,
 * below) — an improvement, but the harness's own round-1b measurement found a
 * section barely bigger than three chunks in these notes (mean 762 to 782
 * characters) and recovering only 17 of 48 real edges. Round 1c measured the
 * WHOLE source note truncated to the same budget (mean 2,812 characters) and
 * recovered 30 of 48 plus 9 novel edges that hold, judge saturated at 89/89
 * (`findings/relations-endpoint-context-2026-09-07.md`, addendum). This is
 * the shape production now sends: `notePassageText` (below) bounds the
 * concept's WHOLE source note to `RELATIONS_ENDPOINT_CHAR_BUDGET` characters
 * centred on the anchor, keeping the anchor's own text intact — see that
 * constant's own doc for where the budget number comes from.
 * `sectionPassageText` stays exported and tested as a standalone widener;
 * nothing in this module calls it anymore.
 *

 * **All three register-row-1.2a-named signals are wired, plus a fourth from
 * outside that row.** Component register row 1.2a names three
 * nomination-signal sources: assessment-document co-occurrence,
 * embedding-proximity over the local vector cache, and wikilinks in notes she keeps
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
 *   module reads out of the vault itself. The judge may name only the concept
 *   ids the request permits (`[D-482]`), the client resolver accepts only
 *   those ids, and `misconception/events.ts`/`project.ts` fold them onto
 *   `MisconceptionRecord.conceptId`/`.confusedWithConceptId` — concept KEYS,
 *   in an already-projected, already-in-memory read-model by the time they
 *   reach here (`ol-2zfj.27`). **Opt-in, like `embedding-proximity` and for an
 *   analogous reason**: unlike `her-link` and `assessment-cooccurrence`, which
 *   only need what this function already has in hand (a `VaultSource` and
 *   `concepts`), this signal needs an extra input, the misconception
 *   projection, which `main.ts`'s corpus pass reads from the vault's
 *   misconception store and hands in. Omitting `assessmentErrorAdjacency`
 *   computes no such signal, the same "absent, not guessed" contract
 *   `embeddingProximity` follows. See `AssessmentErrorAdjacencyOptions` below
 *   for how the two ids are resolved.
 *
 * **Why this scans every concept's OWN anchor passage, not a dedicated
 * "concept note" folder.** `[D-068]` corroborates concepts from the material
 * itself, her concept notes, and her `topic` property — a concept's
 * `anchor` may be a lecture note, a paper, or a dedicated zettelkasten note,
 * and nothing at this layer distinguishes which. Scanning every anchor
 * source for `[[...]]` targets that resolve to another concept in the SAME
 * course's set is the honest reading of "wikilinks between concept
 * notes" available without inventing a folder convention this bead was not
 * asked to design.
 */

import {
  buildOutline,
  type CorpusConcept,
  cosineSimilarity,
  type DeclaredMadeBy,
  declaredMadeByFromFrontmatter,
  type EmbeddingCacheEngine,
  hashText,
  type MisconceptionRecord,
  type NominationSignal,
  type OutlineNode,
  type ParsedDocument,
  parseDocument,
  parseFrontmatter,
  registerSources,
  type TeachingEventResolver,
  type VaultPath,
  type VaultSource,
} from 'olea-core';
import { stripOleaFrontmatter } from '../generation/strip-olea-frontmatter.js';

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
 * `olea-service`). Production now carries the concept's WHOLE source note,
 * bounded to this budget centred on the anchor (`notePassageText`, below) —
 * an intermediate fix widened only to the anchor's enclosing SECTION
 * (`sectionPassageText`, kept as a tested standalone helper) before a further
 * measurement round found the section too close to the old bare-block size to
 * recover most of the missed edges; see the module doc's `ol-2zfj.64`
 * paragraph for both rounds' numbers.
 *
 * **8000, in plain English — [REL-6.1].** The sensitivity sweep this doc
 * once deferred has run: three whole-note endpoints, three budgets, the same
 * candidates judged blind (`findings/relations-endpoint-context-2026-09-07.md`,
 * "the endpoint budget sweep" addendum, `olea-service`). Precision sat at
 * ceiling throughout — the budget was never where false edges came from —
 * and recall rose 6, 8, 9 true edges at 4,000 / 8,000 / 16,000, a plateau
 * above 8,000. 8,000 characters is about the length of one full lecture
 * note, so a note that was being cut at 4,000 now arrives whole; the next
 * doubling to 16,000 returns one more edge for twice the judge cost, which
 * is the sweep's basis for stopping here rather than following the tail.
 * Declared, not fitted — it moves only through a decision bead.
 */
export const RELATIONS_ENDPOINT_CHAR_BUDGET = 8000;

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
 * SURROUNDING SECTION and bounded by `budget`. This was the first fix this
 * bead made for the payload production sends — production has since moved on
 * to `notePassageText` (below), which widens to the WHOLE source note rather
 * than only its section (see the module doc's `ol-2zfj.64` paragraph for the
 * measurement that moved it). Kept exported and tested as a standalone
 * section-widener for any future caller that wants a section rather than a
 * whole note; nothing in this module calls it anymore.
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

/**
 * `ol-2zfj.64` [REL-5]. The concept's WHOLE source note, bounded by `budget`
 * characters centred on the anchor — what production actually calls now
 * (`gatherCorpusRelationVaultContext`'s `passageTextByName`, feeding
 * `WorkerCorpusRelationVerdict.toWireEndpoint`'s `sourceChunks: [passageText]`,
 * still one entry; only what that entry carries changes here). See the
 * module doc's `ol-2zfj.64` paragraph for the measurement that moved
 * production from `sectionPassageText` to this: the section was barely wider
 * than three chunks in these notes and recovered only 17 of 48 real missed
 * edges, where the whole note under the same budget recovered 30 plus 9
 * novel edges.
 *
 * A concept with no note of its own — its anchor is a stub heading inside a
 * shared course note, not a dedicated zettelkasten note — still gets a real
 * note's worth of text here, never a bare heading: `content` is always
 * `concept.anchor.sourcePath`'s own text, the note the concept was actually
 * *extracted from*, whatever kind of note that is (`[D-068]`; see the module
 * doc's "why this scans every concept's OWN anchor passage" paragraph for the
 * identical reasoning applied to the `her-link` signal). There is no separate
 * "does this concept have its own note" branch — the whole-note rule already
 * reads the one note `anchor.sourcePath` names, in full, for every concept.
 *
 * This is `boundAroundAnchor` with the "section" widened to the entire note
 * (`[0, content.length)`) rather than an enclosing heading's material: the
 * anchor is never dropped, and never itself truncated unless it alone
 * exceeds `budget`; context comes symmetrically from both sides of the
 * anchor, and a side that runs out of room first hands its leftover budget to
 * the other. Mirrors `scripts/harness/playback-extraction.mjs`'s
 * `centeredTruncateAroundAnchor` (`olea-service`) exactly — that function is
 * the harness's own copy of this same rule, built for a replay path with no
 * `charRange` to key `parseDocument` on, so it works from `text.length`
 * directly rather than composing with `boundAroundAnchor`. Unlike
 * `sectionPassageText`, there is no document-parsing degrade path to fall
 * off of: a whole note needs no outline, so any `charRange` within
 * `[0, content.length)` — including a hand-built one that straddles two
 * blocks — truncates correctly.
 */
export function notePassageText(
  content: string,
  charRange: { readonly start: number; readonly end: number },
  budget: number = RELATIONS_ENDPOINT_CHAR_BUDGET,
): string {
  return boundAroundAnchor(content, { start: 0, end: content.length }, charRange, budget);
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
 * **Both ids are concept keys, resolved by key (`ol-2zfj.27`, ONT-R1
 * `ol-2zfj.86`).** Every writer of a misconception record stamps a concept key:
 * the explain-back accept path records only an id from the request's permitted
 * list (`explain-back/observation.ts`'s `resolveConceptId`; the list is the
 * subject's key and the resolved neighbour's key, `explain-back/request.ts`'s
 * `permittedConceptIdsFor`), and a wrong MCQ pick records its instrument's
 * `conceptIds` (`olea-core`'s `misconception/store.ts` `normalizeMcqPick`, with
 * no `confusedWithConceptId`). No writer stamps a name or alias, so this pass
 * looks each id up in `concepts`' `key` index only, with no name fallback: a
 * name lookup would match no bound record at all, and under ONT-R1 a name is
 * an index over identities, never the identity. An id no concept carries as
 * its key nominates nothing, the same "unrecognised concept nominates nothing"
 * discipline `nominate.js` enforces for an unknown name.
 *
 * **The signal still carries names**, because `NominationSignal.a`/`.b` are
 * names and `nominate.js` resolves them to every concept holding that name.
 * So a resolved concept whose name another identity also holds (the
 * ambiguous names `buildByNameIndex` excludes) nominates nothing here: the
 * name would let nomination attach her confusion to a concept it was never
 * about, a merge of evidence across two identities that ONT-R1 rules out.
 */
export interface AssessmentErrorAdjacencyOptions {
  readonly records: readonly MisconceptionRecord[];
}

export interface CorpusRelationVaultContextOptions {
  /** Assessment-document co-occurrence is always attempted (mirrors `her-link`'s always-on posture); this only overrides where `registerSources` looks. */
  readonly sourcesFolder?: VaultPath;
  /** Omitted (the default) skips the embedding-proximity signal entirely — see `EmbeddingProximityOptions`'s own doc for why there is no default cache or threshold to fall back to. */
  readonly embeddingProximity?: EmbeddingProximityOptions;
  /** Omitted (the default) skips the assessment-error-adjacency signal entirely; `main.ts`'s corpus pass supplies the misconception store's records. See `AssessmentErrorAdjacencyOptions`'s own doc. */
  readonly assessmentErrorAdjacency?: AssessmentErrorAdjacencyOptions;
  /**
   * One teaching event counts once (`[D-465]`, knowledge model 5): the SAME resolver the concept
   * reader takes (`olea-core`'s `TeachingEventResolver`, `ol-egov.141.89.3.43`), taken as an input,
   * never rebuilt here. When two concepts' anchors resolve to one event and either anchor is a
   * transcript passage, the transcript is restating that event's slides or note, so their
   * `embedding-proximity` is the repetition itself and is not nominated as independent evidence.
   * Omitted (the default): no bundles known, today's behaviour.
   */
  readonly teachingEventOf?: TeachingEventResolver;
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
 * True when both concepts were introduced inside ONE teaching event and at least one introducing
 * passage is a transcript part: the transcript restating its own lecture is not independent
 * corroboration (`[D-465]`). Without a resolver, or with an anchor outside any bundle, false.
 */
function sameEventRestatement(
  anchorByName: ReadonlyMap<string, CorpusConcept['anchor']>,
  teachingEventOf: TeachingEventResolver | undefined,
  aName: string,
  bName: string,
): boolean {
  if (teachingEventOf === undefined) return false;
  const a = anchorByName.get(aName);
  const b = anchorByName.get(bName);
  if (a === undefined || b === undefined) return false;
  const eventA = teachingEventOf(a.sourcePath);
  if (eventA === undefined || eventA !== teachingEventOf(b.sourcePath)) return false;
  return a.location.transcriptPart !== undefined || b.location.transcriptPart !== undefined;
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
  sameEventRestatement: (aName: string, bName: string) => boolean = () => false,
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
      if (sameEventRestatement(aName, bName)) continue;
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
 * against `byKey` (concept key -> `CorpusConcept`) and never against a name
 * or alias — see `AssessmentErrorAdjacencyOptions`'s own doc for why
 * (`ol-2zfj.27`). `byName` is consulted only to refuse a concept whose name
 * another identity also holds, since the signal it would emit names it.
 * Pure and synchronous: no vault or network access, `records` is already the
 * in-memory read-model.
 */
function assessmentErrorAdjacencySignals(
  byKey: ReadonlyMap<string, CorpusConcept>,
  byName: ReadonlyMap<string, CorpusConcept>,
  records: readonly MisconceptionRecord[],
): readonly NominationSignal[] {
  const seenPairs = new Set<string>();
  const signals: NominationSignal[] = [];
  const nameIsItsAlone = (concept: CorpusConcept): boolean => {
    const holder = byName.get(concept.name);
    return holder !== undefined && identityOf(holder) === identityOf(concept);
  };

  for (const record of records) {
    if (record.confusedWithConceptId === null) continue;
    const a = byKey.get(record.conceptId);
    const b = byKey.get(record.confusedWithConceptId);
    if (a === undefined || b === undefined || identityOf(a) === identityOf(b)) continue;
    if (!nameIsItsAlone(a) || !nameIsItsAlone(b)) continue;
    const key = unorderedPairKey(a.name, b.name);
    if (seenPairs.has(key)) continue;
    seenPairs.add(key);
    signals.push({ kind: 'assessment-error-adjacency', a: a.name, b: b.name });
  }
  return signals;
}

/**
 * Key-first, name-for-keyless-only identity — the same discipline
 * `packages/core/src/concept/corpus-relations/nominate.ts`'s own
 * `identityOf` applies at candidate-generation time (`ol-egov.141.89.4.16`)
 * and `packages/core/src/concept/corpus-relations/verdict.ts`'s `byName`
 * applies at verdict-resolution time (`ol-egov.141.89.4.18`), restated here
 * rather than imported across the client/plugin boundary — this module
 * already restates other core helpers deliberately (module doc,
 * `unorderedPairKey` below). A concept's `key` when it has one, its `name`
 * only as the fallback for a keyless concept.
 */
function identityOf(concept: CorpusConcept): string {
  return concept.key ?? concept.name;
}

/**
 * `concept.key` -> `CorpusConcept`, for `assessmentErrorAdjacencySignals`
 * (`ol-2zfj.27`). Keyless concepts are not indexed: no misconception record
 * can name one, since every writer stamps a key. Two entries carrying one key
 * are one identity (`[D-088]`), so the first is kept and nothing is merged.
 */
function buildByKeyIndex(concepts: readonly CorpusConcept[]): ReadonlyMap<string, CorpusConcept> {
  const index = new Map<string, CorpusConcept>();
  for (const concept of concepts) {
    if (concept.key !== undefined && !index.has(concept.key)) index.set(concept.key, concept);
  }
  return index;
}

/**
 * `concept.name`/`.aliases` -> `CorpusConcept`, for the `her-link` wikilink
 * pass (and, in `assessmentErrorAdjacencySignals`, only to refuse an
 * ambiguous name). **A name or alias held
 * by two distinct, differently-keyed concepts is ambiguous within this
 * concept set and is excluded from the index entirely** (rel.md §3 Default
 * 5, `ol-egov.141.89.4.18` — the same key-first, name-for-keyless-only
 * discipline `./nominate.ts`'s widened byName and `./verdict.ts`'s byName
 * fallback both apply): a wikilink naming it then
 * misses here exactly as a name outside the set would, and nominates
 * nothing for it — never a silent last-write-wins pick of whichever
 * concept happened to be indexed last. Two concepts sharing a name or
 * alias but the SAME identity (the same concept's own alias colliding with
 * its own name, or two keyless concepts indistinguishable by construction)
 * are not ambiguous and still resolve, unchanged from before this fix.
 */
function buildByNameIndex(concepts: readonly CorpusConcept[]): ReadonlyMap<string, CorpusConcept> {
  const index = new Map<string, CorpusConcept>();
  const identityByName = new Map<string, string>();
  const ambiguousNames = new Set<string>();
  const consider = (nameOrAlias: string, concept: CorpusConcept) => {
    const identity = identityOf(concept);
    const priorIdentity = identityByName.get(nameOrAlias);
    if (priorIdentity === undefined) {
      identityByName.set(nameOrAlias, identity);
      index.set(nameOrAlias, concept);
    } else if (priorIdentity !== identity) {
      ambiguousNames.add(nameOrAlias);
    }
  };
  for (const concept of concepts) {
    consider(concept.name, concept);
    for (const alias of concept.aliases) consider(alias, concept);
  }
  for (const name of ambiguousNames) index.delete(name);
  return index;
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
  const byName = buildByNameIndex(concepts);

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
  const anchorByName = new Map(concepts.map((c) => [c.name, c.anchor] as const));
  const seenPairs = new Set<string>();
  const signals: NominationSignal[] = [];

  const madeByCache = new Map<VaultPath, DeclaredMadeBy | undefined>();
  const madeByOf = (path: VaultPath, content: string): DeclaredMadeBy | undefined => {
    if (madeByCache.has(path)) return madeByCache.get(path);
    const first = parseDocument(content).blocks[0];
    const madeBy =
      first?.kind === 'frontmatter'
        ? declaredMadeByFromFrontmatter(parseFrontmatter(first.inner))
        : undefined;
    madeByCache.set(path, madeBy);
    return madeBy;
  };

  for (const concept of concepts) {
    const content = await readCached(concept.anchor.sourcePath);
    // `charRange` is optional (`../../core/src/extract/types.js`, `ol-2zfj.54`); every anchor a
    // concept actually gets is one block's real `[start, end)` (see the module doc above), so
    // this is never absent in practice — but a nomination signal degrades honestly rather than
    // throwing if it ever is, by falling back to the note's own text bounded from its start
    // (still never an unbounded whole note — see `RELATIONS_ENDPOINT_CHAR_BUDGET`'s own doc for
    // why that was never the fix). The ordinary path is `notePassageText`, [REL-5]'s whole-note,
    // budget-bounded rule — see the module doc's `ol-2zfj.64` paragraph for why this superseded
    // `sectionPassageText`.
    const charRange = concept.anchor.location.charRange;
    // `ol-egov.141.89.2.32`: Olea's own `olea-*` frontmatter keys never travel inside a passage.
    // The strip only removes text inside the leading frontmatter block, so an anchor's offsets
    // shift left by exactly the removed length (clamped at the note's start).
    const sendable = stripOleaFrontmatter(content);
    const removed = content.length - sendable.length;
    const passageText =
      charRange !== undefined
        ? notePassageText(
            sendable,
            removed === 0
              ? charRange
              : {
                  start: Math.max(0, charRange.start - removed),
                  end: Math.max(0, charRange.end - removed),
                },
          )
        : sendable.slice(0, RELATIONS_ENDPOINT_CHAR_BUDGET);
    passageTextByName.set(concept.name, passageText);

    for (const target of wikilinkTargets(content)) {
      const linked = byName.get(target);
      if (linked === undefined || linked.name === concept.name) continue;
      // `ol-egov.141.89.4.32` (`[D-490]`): the note carrying this link is `concept`'s anchor
      // note; its `made-by` rides on the signal. A pair linked from two notes keeps one signal
      // per DISTINCT declaration (undeclared included), because `reconcileCorpusVerdicts` reads
      // the whole list of linking-note declarations ("every note assistant" differs from "one
      // assistant, one not"); a repeat of a declaration already recorded adds nothing.
      const madeBy = madeByOf(concept.anchor.sourcePath, content);
      const key = `${unorderedPairKey(concept.name, linked.name)}\u0000${madeBy ?? ''}`;
      if (seenPairs.has(key)) continue;
      seenPairs.add(key);
      signals.push({
        kind: 'her-link',
        a: concept.name,
        b: linked.name,
        ...(madeBy !== undefined ? { linkingNoteMadeBy: madeBy } : {}),
      });
    }
  }

  signals.push(
    ...(await assessmentCooccurrenceSignals(vault, concepts, readCached, options.sourcesFolder)),
  );

  if (options.embeddingProximity !== undefined) {
    signals.push(
      ...(await embeddingProximitySignals(
        passageTextByName,
        options.embeddingProximity,
        (aName, bName) => sameEventRestatement(anchorByName, options.teachingEventOf, aName, bName),
      )),
    );
  }

  if (options.assessmentErrorAdjacency !== undefined) {
    signals.push(
      ...assessmentErrorAdjacencySignals(
        buildByKeyIndex(concepts),
        byName,
        options.assessmentErrorAdjacency.records,
      ),
    );
  }

  return { signals, passageTextByName };
}
