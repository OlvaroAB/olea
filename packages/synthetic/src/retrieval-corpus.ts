/**
 * A synthetic retrieval corpus: documents/blocks over the coined vocabulary,
 * shaped so the query -> retrieve -> ground/refuse chain has something real
 * to run against (`olea-service`'s `ol-opmb.2` [TB-2]).
 *
 * ## Why this is a SEPARATE corpus from `corpus.ts`
 *
 * `corpus.ts`'s three notes exist to drive `buildGapView`'s three gap classes
 * (TB-1) and are deliberately tiny and unevenly covered — `kelvane` is
 * deliberately ABSENT from it, on purpose, to make F4.10's material-gap row
 * reachable. Retrieval needs a different, larger shape for a structural
 * reason that has nothing to do with quality: `compositeSignals.ts`'s
 * `marginP99` is `top1 - cosinePercentile(scores, 0.99)`, and
 * `cosinePercentile` indexes at `floor(0.99 * n)`. For `n <= 100` that index
 * is always the LAST (maximum) element, so `marginP99` is **always exactly
 * zero** — the composite gate could never pass, regardless of anything about
 * the query. `RECOMMENDED_COMPOSITE_THRESHOLDS.marginP99` (0.055) is
 * therefore only ever satisfiable once the corpus exceeds ~100 chunks. This
 * corpus is sized comfortably past that line (190 chunks, 126 distinct
 * texts) so `grounding-refused-composite` and `grounded-with-citations` are
 * both genuinely reachable, not just theoretically defined — verified
 * empirically against a real embedding pass, not merely arithmetically. See
 * `../../workbench/src/oracle/retrieve.ts`'s module doc, which found this.
 *
 * A first pass at 110 chunks (four rich concepts x 20 near-duplicate
 * templated blocks each) still failed the composite gate for EVERY labelled
 * query: repeating near-identical boilerplate phrasing across many blocks
 * clusters their embeddings so tightly that even 110 distinct chunks behave
 * like far fewer for `marginP99`'s purposes. The fix was not more chunks of
 * the same shape but more DIVERSITY — fewer, less-repetitive blocks per rich
 * concept (11, one of them phrased close to the query itself) plus a much
 * larger and more varied FILLER bank (20 templates spanning distinct
 * administrative vocabulary, not four variants of one scaffold) so the
 * corpus's overall cosine distribution has genuine spread. Left here because
 * it is the one place ranking-adjacent behaviour was actually investigated —
 * strictly to make the MECHANISM reachable, never to move a threshold or
 * report a quality number (the parent bead's hard limit, held throughout).
 *
 * ## Coverage shape, deliberately uneven (mirrors the ratified grounding
 * set's own answerable / near-miss / unanswerable split)
 *
 *  - RICH (`melspar`, `tirasp`, `ilmenor`, `sarquith`) — 11 blocks each,
 *    varied templates, cross-referencing each other. Answerable-query
 *    targets: real keyword and semantic signal.
 *  - SPARSE (`dornith`, `nubrast`) — 3 blocks each, minimal template.
 *    Near-miss targets: named, but thin.
 *  - ABSENT (`kelvane`, `plevin`) — zero blocks. Curriculum-cited elsewhere
 *    in this package (`curriculum.ts`), never mentioned here at all.
 *    Unanswerable-by-content targets.
 *  - FILLER — ten documents (140 blocks), no concept token at all, varied
 *    connective/administrative scaffolding, so the corpus has genuine
 *    "background" mass rather than being mostly concept mentions.
 *
 * ## INV-3 and N-015
 *
 * Every token is one of `./vocabulary.js`'s already-vetted `CONCEPTS`/
 * `COURSES` bare tokens, a small closed list of ordinary connective English
 * words (`ORDINARY_WORDS` below, ported from the same discipline
 * `world.spec.ts` already applies to `corpus.ts`/`curriculum.ts`), or a bare
 * number — never a fresh proper noun, never real academic prose (the parent
 * bead, `ol-opmb`, explicitly rejects that mitigation: an embedding model has
 * no real geometry over invented tokens regardless, and real prose would
 * only reintroduce the constituent-word collision risk the coined-token
 * convention exists to avoid). `retrieval-corpus.spec.ts` re-asserts the
 * vocabulary-discipline property by scanning every generated block.
 * Retrieval RANKING QUALITY over this corpus is uninterpretable by
 * construction (parent bead) — nothing here may be measured, tuned or
 * reported as a quality number; what is measured is only mechanism
 * (does refusal fire, does citation attribution work, is the run
 * deterministic).
 */

import type { IndexedBlock, IndexedDocument, PersistedKeywordIndex, VaultPath } from 'olea-core';
import { SYNTHETIC_ID_PREFIX } from './provenance.js';
import { CONCEPTS, COURSE_QUORBIN, COURSE_VANTREL, courseOfConcept } from './vocabulary.js';

/** Bare token from a `syn:concept:<token>` or `syn:course:<token>` id. */
function bareToken(id: string): string {
  return id.split(':').at(-1) as string;
}

/** The four richly-covered concepts (answerable-query targets). */
export const RICH_CONCEPT_TOKENS: readonly string[] = ['melspar', 'tirasp', 'ilmenor', 'sarquith'];
/** The two sparsely-covered concepts (near-miss-query targets). */
export const SPARSE_CONCEPT_TOKENS: readonly string[] = ['dornith', 'nubrast'];
/**
 * The two concepts this corpus never mentions at all — curriculum-cited
 * (`curriculum.ts`) but absent here (unanswerable-by-content query targets).
 * Restated, not re-derived, so a reader can see the completeness claim
 * without cross-referencing `vocabulary.ts` by hand.
 */
export const ABSENT_CONCEPT_TOKENS: readonly string[] = ['kelvane', 'plevin'];

const RICH_BLOCKS_PER_CONCEPT = 11;
const SPARSE_BLOCKS_PER_CONCEPT = 3;
const FILLER_BLOCKS_PER_DOCUMENT = 14;
const FILLER_DOCUMENT_COUNT = 10;

function conceptToken(id: string): string {
  return bareToken(id);
}

function courseTokenOf(conceptId: string): string {
  const course = courseOfConcept(conceptId);
  return course === undefined ? 'vantrel' : bareToken(course);
}

/** Every rich concept's bare token, paired with the NEXT rich token (wrapping) — a stable "other concept" to cross-reference, never itself. */
function otherRichToken(token: string): string {
  const index = RICH_CONCEPT_TOKENS.indexOf(token);
  const next = RICH_CONCEPT_TOKENS[(index + 1) % RICH_CONCEPT_TOKENS.length];
  return next ?? token;
}

/**
 * Eleven templates, cycled by block index (`RICH_BLOCKS_PER_CONCEPT` = 11,
 * so every template fires exactly once per rich concept, never repeating).
 * Template 0 is deliberately phrased close to `queries.ts`'s own
 * `answerableQuery` wording ("What do the notes say about X?") — a
 * heading-style restatement, the same way a real note's own heading often
 * echoes the question it answers. Every word beyond the two concept slots
 * and the course slot is ordinary connective English (see `ORDINARY_WORDS`)
 * or a bare number.
 */
const RICH_TEMPLATES: readonly ((c: string, o: string, k: string, n: number) => string)[] = [
  (c, _o, k, n) =>
    `What do the notes say about ${c}? ${c} is explained here, within ${k}, entry ${n}.`,
  (c, _o, k, n) => `Passage ${n} discusses ${c} in relation to ${k}.`,
  (c, _o, _k, n) => `This section continues coverage of ${c}, following on from passage ${n}.`,
  (c, o, k, n) => `${c} is named again here, alongside ${o}, within ${k}, section ${n}.`,
  (c, _o, k, n) =>
    `A further note on ${c} appears in passage ${n}, expanding earlier coverage of ${k}.`,
  (c, o, _k, n) => `See also ${o} for material connected to ${c}, passage ${n}.`,
  (c, _o, k, n) => `Coverage of ${c} within ${k} continues across section ${n}.`,
  (c, _o, k, n) => `This paragraph returns to ${c}, covered previously under ${k}, passage ${n}.`,
  (c, o, k, n) => `${c} and ${o} are both named in this section of ${k}, number ${n}.`,
  (c, _o, k, n) => `Additional material on ${c} is recorded here, under ${k}, passage ${n}.`,
  (c, o, _k, n) => `A note on ${c} follows, cross-referenced against ${o}, passage ${n}.`,
];

/** Two minimal templates for sparse concepts — named, but with far less text than a rich concept gets. */
const SPARSE_TEMPLATES: readonly ((c: string, k: string, n: number) => string)[] = [
  (c, k, n) => `A note on ${c} is recorded here, within ${k}, passage ${n}.`,
  (c, k, n) => `${c} appears briefly in this section of ${k}, passage ${n}.`,
];

/**
 * Filler templates that name no concept at all — administrative background
 * mass, deliberately varied in vocabulary and sentence shape (not four
 * variants of the same scaffold) so the corpus's overall cosine distribution
 * has real spread rather than clustering tightly around one boilerplate
 * shape. Every word is ordinary English (`ORDINARY_WORDS`) — schedules,
 * logistics and recordkeeping, never a concept token, never anything
 * specific to a real vault.
 */
const FILLER_TEMPLATES: readonly ((k: string, n: number) => string)[] = [
  (k, n) => `General material for ${k} appears in section ${n}, covering background context.`,
  (k, n) => `This passage is administrative, noting coverage dates for ${k}, entry ${n}.`,
  (k, n) => `A section header for ${k} appears here, passage ${n}, with no concept named yet.`,
  (k, n) => `Background scaffolding for ${k} continues in passage ${n}.`,
  (k, n) => `Recordkeeping for ${k} continues in section ${n}.`,
  (k, n) => `The outline for ${k} lists section ${n} as background reading.`,
  (k, n) => `Timetable notes for ${k} are filed under entry ${n}.`,
  (k, n) => `Attendance is noted for ${k} in this entry, number ${n}.`,
  (k, n) => `A reading list item for ${k} appears here, entry ${n}.`,
  (k, n) => `Revision scheduling for ${k} is noted in passage ${n}.`,
  (k, n) => `Assessment logistics for ${k} are recorded in section ${n}.`,
  (k, n) => `Room allocation details for ${k} appear in entry ${n}.`,
  (k, n) => `Contact information for ${k} staff is filed in section ${n}.`,
  (k, n) => `Library holds for ${k} materials are logged in entry ${n}.`,
  (k, n) => `Printing arrangements for ${k} handouts are noted in section ${n}.`,
  (k, n) => `Enrolment figures for ${k} are recorded in entry ${n}.`,
  (k, n) => `Office hours for ${k} staff are listed in section ${n}.`,
  (k, n) => `Submission deadlines for ${k} are noted in entry ${n}.`,
  (k, n) => `A holiday calendar note for ${k} appears in section ${n}.`,
  (k, n) => `Seating arrangements for ${k} sessions are logged in entry ${n}.`,
];

function noteId(token: string): VaultPath {
  return `${SYNTHETIC_ID_PREFIX}retrieval-note:${token}`;
}

function fillerId(index: number): VaultPath {
  return `${SYNTHETIC_ID_PREFIX}retrieval-filler:${String(index).padStart(2, '0')}`;
}

function buildRichDocument(id: string): IndexedDocument {
  const token = conceptToken(id);
  const course = courseTokenOf(id);
  const other = otherRichToken(token);
  const blocks: IndexedBlock[] = [];
  for (let n = 0; n < RICH_BLOCKS_PER_CONCEPT; n++) {
    const template = RICH_TEMPLATES[n % RICH_TEMPLATES.length];
    if (!template) continue;
    blocks.push({ blockIndex: n, kind: 'paragraph', text: template(token, other, course, n) });
  }
  return {
    path: noteId(token),
    courses: [`${SYNTHETIC_ID_PREFIX}course:${course}`],
    contentHash: `retrieval:${token}`,
    blocks,
  };
}

function buildSparseDocument(id: string): IndexedDocument {
  const token = conceptToken(id);
  const course = courseTokenOf(id);
  const blocks: IndexedBlock[] = [];
  for (let n = 0; n < SPARSE_BLOCKS_PER_CONCEPT; n++) {
    const template = SPARSE_TEMPLATES[n % SPARSE_TEMPLATES.length];
    if (!template) continue;
    blocks.push({ blockIndex: n, kind: 'paragraph', text: template(token, course, n) });
  }
  return {
    path: noteId(token),
    courses: [`${SYNTHETIC_ID_PREFIX}course:${course}`],
    contentHash: `retrieval:${token}`,
    blocks,
  };
}

/**
 * One filler document, `index` in `[0, FILLER_DOCUMENT_COUNT)`. Alternates
 * course by parity and offsets its starting template by `index * 3` so ten
 * documents of 14 blocks each sweep across all 20 `FILLER_TEMPLATES` in
 * different combinations rather than every document repeating the same
 * first-14-of-20 — real diversity, not one template bank read from the same
 * starting point ten times.
 */
function buildFillerDocument(index: number): IndexedDocument {
  const courseId = index % 2 === 0 ? COURSE_VANTREL : COURSE_QUORBIN;
  const course = bareToken(courseId);
  const offset = index * 3;
  const blocks: IndexedBlock[] = [];
  for (let n = 0; n < FILLER_BLOCKS_PER_DOCUMENT; n++) {
    const template = FILLER_TEMPLATES[(offset + n) % FILLER_TEMPLATES.length];
    if (!template) continue;
    blocks.push({ blockIndex: n, kind: 'paragraph', text: template(course, offset + n) });
  }
  return {
    path: fillerId(index),
    courses: [courseId],
    contentHash: `retrieval:filler:${String(index).padStart(2, '0')}`,
    blocks,
  };
}

/**
 * The whole retrieval corpus as a hand-built `PersistedKeywordIndex` — the
 * same "declared, not discovered" shortcut `corpus.ts` and `curriculum.ts`
 * take, applied to the keyword index this package has no vault to build for
 * real. `chunksFromIndex` (`olea-core`) derives `RetrievalChunk[]` (with
 * content hashes) from this the same way it would from a real plugin index;
 * nothing downstream needs to know this was hand-built rather than parsed.
 *
 * Deterministic and unseeded, like `buildCorpus`/`buildCurriculum` — every
 * value is a literal template application, never a draw from an `Rng`.
 */
export function buildRetrievalIndex(): PersistedKeywordIndex {
  const richIds = CONCEPTS.filter((c) => RICH_CONCEPT_TOKENS.includes(conceptToken(c.conceptId)));
  const sparseIds = CONCEPTS.filter((c) =>
    SPARSE_CONCEPT_TOKENS.includes(conceptToken(c.conceptId)),
  );

  const filler = Array.from({ length: FILLER_DOCUMENT_COUNT }, (_, index) =>
    buildFillerDocument(index),
  );

  const documents: IndexedDocument[] = [
    ...richIds.map((c) => buildRichDocument(c.conceptId)),
    ...sparseIds.map((c) => buildSparseDocument(c.conceptId)),
    ...filler,
  ].sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));

  return { version: 1, documents };
}

/** Total block ("chunk") count this corpus produces — for the precompute script's own arithmetic and this module's own spec. */
export function retrievalCorpusBlockCount(): number {
  return buildRetrievalIndex().documents.reduce((sum, doc) => sum + doc.blocks.length, 0);
}
