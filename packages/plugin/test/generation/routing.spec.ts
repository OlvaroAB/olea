/**
 * `routing.ts` unit tests (`ol-tz7v` / `[WIRE-7]`) — component 2.2's routing
 * consultation, exercised independently of `pipeline.ts`'s sweep loop.
 *
 * Proves: source material is read whole-note, skipping missing/empty notes;
 * classification collapses every "nothing real is known" outcome
 * (`classifier: null`, no source material, a declined label) to the same
 * `status: 'unclassified'`, never guessing; the real inventory reader groups
 * `enumerateVaultInstruments`' records by routing group and folds a
 * multi-concept instrument into every concept it names; and the pure
 * decision function reads `instrumentMixGaps` faithfully.
 */
import type {
  ConceptInstrumentInventory,
  DerivedTextUnit,
  KnowledgeKindClassifierPort,
} from 'olea-core';
import { extractConcepts } from 'olea-core';
import { describe, expect, it } from 'vitest';
import {
  buildConceptInstrumentInventory,
  buildKnowledgeKindSourceMaterial,
  classifyForRouting,
  createDerivedUnitSupplier,
  decideConceptRouting,
  followOnKindOrder,
  groupDeficit,
  KnowledgeKindLabels,
  knowledgeKindLabelsFor,
  MAX_ROUTING_UNIT_CHARS,
  MAX_ROUTING_UNITS_PER_IDENTITY,
  quizDeficit,
} from '../../src/generation/routing.js';
import { MemoryVaultSource } from './fakes.js';

const NOTE = '01 Courses/COGS214/Working memory.md';

function frontmatter(topic: string, course = 'COGS214'): string {
  return ['---', `topic: [${topic}]`, `course: ${course}`, '---', ''].join('\n');
}

const MCQ_BLOCK = [
  '```olea-mcq',
  'stem: Which structure is it?',
  'answer: The right one',
  'distractor: d1',
  'distractor: d2',
  'distractor: d3',
  'distractor: d4',
  'feedback: Because of the thing.',
  '```',
].join('\n');

describe('buildKnowledgeKindSourceMaterial', () => {
  it('reads each existing, non-empty source note whole, as one passage per note', async () => {
    const vault = new MemoryVaultSource({
      'a.md': 'first note',
      'b.md': 'second note',
    });
    const passages = await buildKnowledgeKindSourceMaterial(vault, {
      sourcePaths: ['a.md', 'b.md', 'missing.md'],
    });
    expect(passages).toHaveLength(2);
    expect(passages[0]).toEqual({
      text: 'first note',
      anchor: { sourcePath: 'a.md', location: { page: 1, charRange: { start: 0, end: 10 } } },
    });
    expect(passages[1]?.anchor.sourcePath).toBe('b.md');
  });

  it('skips a note that exists but is empty, and returns `[]` for a concept with no readable source at all (INV-5 upstream)', async () => {
    const vault = new MemoryVaultSource({ blank: '   \n  ' });
    expect(await buildKnowledgeKindSourceMaterial(vault, { sourcePaths: ['blank'] })).toEqual([]);
    expect(await buildKnowledgeKindSourceMaterial(vault, { sourcePaths: [] })).toEqual([]);
    expect(await buildKnowledgeKindSourceMaterial(vault, { sourcePaths: ['nope.md'] })).toEqual([]);
  });

  it("gap 1 (`ol-egov.141.89.3.8`): includes the concept's own bound note, not only the introducing notes in sourcePaths", async () => {
    const vault = new MemoryVaultSource({
      'lecture.md': 'A lecture that mentions the concept only in passing.',
      'concept-note.md': "The concept's own defining passage.",
    });
    const passages = await buildKnowledgeKindSourceMaterial(vault, {
      sourcePaths: ['lecture.md'],
      boundNotePath: 'concept-note.md',
    });
    expect(passages.map((p) => p.text)).toContain("The concept's own defining passage.");
    // The bound note is read first, and never duplicated when it also
    // happens to be listed in `sourcePaths`.
    expect(passages[0]).toEqual({
      text: "The concept's own defining passage.",
      anchor: {
        sourcePath: 'concept-note.md',
        location: { page: 1, charRange: { start: 0, end: 35 } },
      },
    });
    expect(passages).toHaveLength(2);

    const dedupe = await buildKnowledgeKindSourceMaterial(vault, {
      sourcePaths: ['concept-note.md', 'lecture.md'],
      boundNotePath: 'concept-note.md',
    });
    expect(dedupe).toHaveLength(2);
    expect(dedupe.filter((p) => p.anchor.sourcePath === 'concept-note.md')).toHaveLength(1);
  });
});

describe('buildKnowledgeKindSourceMaterial: only markdown is read as text (`ol-egov.141.89.3.56`)', () => {
  /** Records every path handed to `read`, and throws for any path in `throwing`. */
  class RecordingVault extends MemoryVaultSource {
    readonly reads: string[] = [];
    constructor(
      initial: Record<string, string>,
      private readonly throwing: readonly string[] = [],
    ) {
      super(initial);
    }
    override async read(path: string): Promise<string> {
      this.reads.push(path);
      if (this.throwing.includes(path)) throw new Error('refused');
      return super.read(path);
    }
  }

  const unit = (
    sourcePath: string,
    text: string,
    extra: Partial<DerivedTextUnit> = {},
  ): DerivedTextUnit => ({
    sourcePath,
    duplicateSourcePaths: [],
    courses: ['C1'],
    role: undefined,
    format: 'pdf',
    text,
    templateHeadEnd: 0,
    ...extra,
  });

  it('a PDF-only concept is routed on the extracted units of its own PDFs that name it, and no PDF is read as text (`[D-547]`)', async () => {
    const vault = new RecordingVault({ 'a.pdf': '%PDF-1.7 raw bytes', 'B.PDF': '%PDF-1.7' });
    const units = [
      unit('a.pdf', 'page one has nothing relevant'),
      unit('a.pdf', 'page two defines Entropy in full'),
      unit('B.PDF', 'the entropy of a source', { duplicateSourcePaths: [] }),
      unit('other.pdf', 'another document naming entropy'),
      unit('dup.pdf', 'a copy naming Entropy', { duplicateSourcePaths: ['a.pdf'] }),
    ];
    const passages = await buildKnowledgeKindSourceMaterial(
      vault,
      { name: 'Entropy', sourcePaths: ['a.pdf', 'B.PDF'] },
      async () => units,
    );
    expect(passages.map((p) => [p.anchor.sourcePath, p.anchor.location.page])).toEqual([
      ['a.pdf', 2],
      ['B.PDF', 1],
      ['dup.pdf', 1],
    ]);
    expect(passages[0]?.anchor.location.charRange).toEqual({
      start: 0,
      end: 'page two defines Entropy in full'.length,
    });
    expect(vault.reads).toEqual([]);
  });

  it("a course-scoped PDF-only concept is routed on the passage of its own course's reading set that names it, not on the assessment units (`[D-553]`, `[D-544]`)", async () => {
    const vault = new RecordingVault({
      '01 Courses/C1/lecture.md':
        'Intro paragraph.\n\nEntropy is the measure of disorder.\n\nUnrelated closing.',
      '01 Courses/C1/(Olea) home.md':
        '---\nolea-home-note: true\n---\n\nEntropy generated practice',
      '01 Courses/C2/other.md': 'Entropy in another course entirely.',
      '01 Courses/C1/exam.pdf': '%PDF',
    });
    let asked = 0;
    const passages = await buildKnowledgeKindSourceMaterial(
      vault,
      { name: 'Entropy', sourcePaths: ['01 Courses/C1/exam.pdf'], courses: ['C1'] },
      async () => {
        asked += 1;
        return [unit('01 Courses/C1/exam.pdf', 'Entropy in an exam question')];
      },
    );
    expect(passages.map((p) => [p.anchor.sourcePath, p.text])).toEqual([
      ['01 Courses/C1/lecture.md', 'Entropy is the measure of disorder.'],
    ]);
    const start = 'Intro paragraph.\n\n'.length;
    expect(passages[0]?.anchor.location.charRange).toEqual({
      start,
      end: start + 'Entropy is the measure of disorder.'.length,
    });
    expect(asked).toBe(0);
    expect(vault.reads).not.toContain('01 Courses/C2/other.md');
    expect(vault.reads.some((r) => r.endsWith('.pdf'))).toBe(false);
  });

  it("a course-scoped PDF-only concept whose course's reading set never names it routes on the assessment text; another course's passage is never used (`[D-553]`, `[D-544]`)", async () => {
    const vault = new RecordingVault({
      '01 Courses/C2/other.md': 'Entropy in another course entirely.',
      '01 Courses/C1/lecture.md': 'Nothing relevant here.',
    });
    const passages = await buildKnowledgeKindSourceMaterial(
      vault,
      { name: 'Entropy', sourcePaths: ['01 Courses/C1/exam.pdf'], courses: ['C1'] },
      async () => [unit('01 Courses/C1/exam.pdf', 'Entropy in an exam question')],
    );
    expect(passages.map((p) => p.anchor.sourcePath)).toEqual(['01 Courses/C1/exam.pdf']);
    // No course at all: no reading set is consulted, and nothing is borrowed from any course.
    const none = await buildKnowledgeKindSourceMaterial(
      vault,
      { name: 'Entropy', sourcePaths: ['x.pdf'] },
      async () => [],
    );
    expect(none).toEqual([]);
    expect(vault.reads).not.toContain('01 Courses/C2/other.md');
  });

  it('a PDF-only concept with no extracted unit naming it, or an unreadable unit source, gets no input', async () => {
    const vault = new RecordingVault({});
    const none = await buildKnowledgeKindSourceMaterial(
      vault,
      { name: 'Entropy', sourcePaths: ['a.pdf'] },
      async () => [unit('a.pdf', 'nothing relevant'), unit('z.pdf', 'Entropy elsewhere')],
    );
    expect(none).toEqual([]);
    const thrown = await buildKnowledgeKindSourceMaterial(
      vault,
      { name: 'Entropy', sourcePaths: ['a.pdf'] },
      async () => {
        throw new Error('refused');
      },
    );
    expect(thrown).toEqual([]);
    expect(await buildKnowledgeKindSourceMaterial(vault, { sourcePaths: ['a.pdf'] })).toEqual([]);
    expect(vault.reads).toEqual([]);
  });

  it('the units are bounded per identity and per unit', async () => {
    const vault = new RecordingVault({});
    const many = Array.from({ length: MAX_ROUTING_UNITS_PER_IDENTITY + 3 }, () =>
      unit('a.pdf', `Entropy ${'x'.repeat(MAX_ROUTING_UNIT_CHARS * 2)}`),
    );
    const passages = await buildKnowledgeKindSourceMaterial(
      vault,
      { name: 'Entropy', sourcePaths: ['a.pdf'] },
      async () => many,
    );
    expect(passages).toHaveLength(MAX_ROUTING_UNITS_PER_IDENTITY);
    expect(passages.every((p) => p.text.length === MAX_ROUTING_UNIT_CHARS)).toBe(true);
  });

  it("markdown sources keep today's behaviour: units are never consulted when a note is a source", async () => {
    const vault = new RecordingVault({ 'a.md': 'note text' });
    let asked = 0;
    const passages = await buildKnowledgeKindSourceMaterial(
      vault,
      { name: 'Entropy', sourcePaths: ['x.pdf', 'a.md'] },
      async () => {
        asked += 1;
        return [unit('x.pdf', 'Entropy')];
      },
    );
    expect(passages.map((p) => p.anchor.sourcePath)).toEqual(['a.md']);
    expect(asked).toBe(0);
  });

  it('the default unit supplier over a vault with no registered documents yields nothing, and never reads a PDF', async () => {
    const vault = new RecordingVault({ 'a.pdf': '%PDF-1.7' });
    expect(await createDerivedUnitSupplier(vault)()).toEqual([]);
    expect(vault.reads.filter((r) => r.endsWith('.pdf'))).toEqual([]);
  });

  it('a PDF among markdown sources is skipped while the notes are still read', async () => {
    const vault = new RecordingVault({ 'a.md': 'note text', 'x.pdf': '%PDF' });
    const passages = await buildKnowledgeKindSourceMaterial(vault, {
      sourcePaths: ['x.pdf', 'a.md'],
    });
    expect(passages.map((p) => p.anchor.sourcePath)).toEqual(['a.md']);
    expect(vault.reads).toEqual(['a.md']);
  });

  it('a read that throws contributes nothing, exactly as a missing note does', async () => {
    const vault = new RecordingVault({ 'a.md': 'bad', 'b.md': 'good' }, ['a.md']);
    const passages = await buildKnowledgeKindSourceMaterial(vault, {
      sourcePaths: ['a.md', 'b.md'],
    });
    expect(passages.map((p) => p.anchor.sourcePath)).toEqual(['b.md']);
  });
});

describe("buildKnowledgeKindSourceMaterial: Olea's own stamp never reaches the model", () => {
  const STAMP = ['olea-cloze-ids:', '  block-a1: cloze-1', '  block-b2: cloze-2', ''].join('\n');

  it('drops the olea-cloze-ids block from the passage text, keeping her own keys and body byte-for-byte', async () => {
    const note = [
      '---',
      'topic: [Memory]',
      STAMP + 'course: COGS214',
      '---',
      '',
      'Body {{c1::text}}.',
    ].join('\n');
    const vault = new MemoryVaultSource({ 'a.md': note });
    const passages = await buildKnowledgeKindSourceMaterial(vault, { sourcePaths: ['a.md'] });
    const expected = [
      '---',
      'topic: [Memory]',
      'course: COGS214',
      '---',
      '',
      'Body {{c1::text}}.',
    ].join('\n');
    expect(passages).toHaveLength(1);
    expect(passages[0]?.text).toBe(expected);
    expect(passages[0]?.text).not.toContain('olea-cloze-ids');
    expect(passages[0]?.text).not.toContain('cloze-1');
    expect(passages[0]?.anchor.location.charRange).toEqual({ start: 0, end: expected.length });
  });

  it('leaves a note with no stamp unchanged, and skips a note that is only a stamp', async () => {
    const plain = '---\ntopic: [Memory]\n---\n\nBody.\n';
    const onlyStamp = `---\n${STAMP}---\n`;
    const vault = new MemoryVaultSource({ 'plain.md': plain, 'stamp.md': onlyStamp });
    const passages = await buildKnowledgeKindSourceMaterial(vault, {
      sourcePaths: ['plain.md', 'stamp.md'],
    });
    expect(passages.map((p) => p.text)).toEqual([plain]);
  });
});

describe('classifyForRouting', () => {
  const concept = { name: 'Working memory', sourcePaths: [NOTE] };

  it('classifier: null routes as unclassified without reading the vault', async () => {
    const vault = new MemoryVaultSource(); // no NOTE — would throw if ever read
    const classification = await classifyForRouting({ classifier: null }, vault, concept as never);
    expect(classification).toEqual({
      status: 'unclassified',
      confidence: undefined,
      method: 'model',
    });
  });

  it('no readable source material routes as unclassified without calling the port', async () => {
    const vault = new MemoryVaultSource(); // NOTE does not exist
    let called = false;
    const classifier: KnowledgeKindClassifierPort = {
      async classify() {
        called = true;
        return { kind: 'fact', confidence: 0.9 };
      },
    };
    const classification = await classifyForRouting({ classifier }, vault, concept as never);
    expect(called).toBe(false);
    expect(classification).toEqual({
      status: 'unclassified',
      confidence: undefined,
      method: 'model',
    });
  });

  it('a confident, real label passes through classified', async () => {
    const vault = new MemoryVaultSource({ [NOTE]: 'some real material' });
    const classifier: KnowledgeKindClassifierPort = {
      async classify() {
        return { kind: 'principle', confidence: 0.8 };
      },
    };
    const classification = await classifyForRouting({ classifier }, vault, concept as never);
    expect(classification).toEqual({
      status: 'classified',
      kind: 'principle',
      confidence: 0.8,
      method: 'model',
    });
  });

  it('a label below the confidence floor routes as unclassified, never guessed', async () => {
    const vault = new MemoryVaultSource({ [NOTE]: 'some real material' });
    const classifier: KnowledgeKindClassifierPort = {
      async classify() {
        return { kind: 'fact', confidence: 0.2 };
      },
    };
    const classification = await classifyForRouting(
      { classifier, confidenceFloor: 0.5 },
      vault,
      concept as never,
    );
    expect(classification.status).toBe('unclassified');
  });
});

/**
 * The permanent concept key (`[D-357]`) the inventory keys by — read back from the same
 * `.olea/concepts/` sidecar the inventory's own walk stamped, never the content-derived stand-in.
 */
async function permanentKey(vault: MemoryVaultSource, name: string): Promise<string> {
  const key = (await extractConcepts(vault, { stampConceptKeys: true })).find(
    (concept) => concept.name === name,
  )?.key;
  if (key === undefined) throw new Error(`no concept named ${name}`);
  return key;
}

describe('buildConceptInstrumentInventory', () => {
  it('counts a real vault instrument into its concept and routing group', async () => {
    const vault = new MemoryVaultSource({
      [NOTE]: [frontmatter('Working memory'), '## Q', '', MCQ_BLOCK, ''].join('\n'),
    });
    const inventory = await buildConceptInstrumentInventory(vault, { under: '01 Courses' });
    const key = await permanentKey(vault, 'Working memory');

    expect(inventory.get(key)).toEqual({ retrieval: 0, quiz: 1, explainBack: 0 });
  });

  it('folds one instrument into every concept it is bound to (multi-`topic:`, D-031/`ol-t3sd`)', async () => {
    const vault = new MemoryVaultSource({
      [NOTE]: [
        '---',
        'topic: [Working memory, Attention]',
        'course: COGS214',
        '---',
        '',
        'The front::The back',
        '',
      ].join('\n'),
    });
    const inventory = await buildConceptInstrumentInventory(vault, { under: '01 Courses' });
    const wmKey = await permanentKey(vault, 'Working memory');
    const attnKey = await permanentKey(vault, 'Attention');

    expect(inventory.get(wmKey)).toEqual({ retrieval: 1, quiz: 0, explainBack: 0 });
    expect(inventory.get(attnKey)).toEqual({ retrieval: 1, quiz: 0, explainBack: 0 });
  });

  it('a concept with nothing bound yet has no entry at all', async () => {
    const vault = new MemoryVaultSource({
      [NOTE]: [frontmatter('Working memory'), '## Q', '', 'plain prose, no instruments'].join('\n'),
    });
    const inventory = await buildConceptInstrumentInventory(vault, { under: '01 Courses' });
    expect(inventory.size).toBe(0);
  });
});

describe('decideConceptRouting / quizDeficit', () => {
  const EMPTY: ConceptInstrumentInventory = { retrieval: 0, quiz: 0, explainBack: 0 };

  it('unclassified routes to the retrieval baseline: the quiz group reads no share (a reading, never a gate, since [D-549])', () => {
    const decision = decideConceptRouting(
      { status: 'unclassified', confidence: undefined, method: 'model' },
      EMPTY,
    );
    expect(decision.mix).toEqual({ retrieval: 'floor', quiz: 'none', explainBack: 'none' });
    expect(quizDeficit(decision)).toBe(0);
    expect(groupDeficit(decision, 'retrieval')).toBe(1);
  });

  it('a classified `category` against an empty inventory reads a quiz deficit', () => {
    const decision = decideConceptRouting(
      { status: 'classified', kind: 'category', confidence: 0.9, method: 'model' },
      EMPTY,
    );
    expect(quizDeficit(decision)).toBeGreaterThan(0);
  });

  it('a classified `fact` whose quiz floor is already met reports zero deficit', () => {
    const decision = decideConceptRouting(
      { status: 'classified', kind: 'fact', confidence: 0.9, method: 'model' },
      { retrieval: 0, quiz: 1, explainBack: 0 },
    );
    expect(quizDeficit(decision)).toBe(0);
    expect(groupDeficit(decision, 'retrieval')).toBe(3);
  });
});

describe('followOnKindOrder: the kind of knowledge orders the next kinds (`[D-549]`, ol-egov.141.89.105.8)', () => {
  const LISTED = ['qa', 'cloze', 'mcq'] as const;
  const EMPTY: ConceptInstrumentInventory = { retrieval: 0, quiz: 0, explainBack: 0 };

  it('a fact puts recall first, a category multiple choice first, against an empty inventory', () => {
    expect(followOnKindOrder('fact', EMPTY, LISTED)).toEqual(['qa', 'cloze', 'mcq']);
    expect(followOnKindOrder('category', EMPTY, LISTED)).toEqual(['mcq', 'qa', 'cloze']);
  });

  it('equal deficits keep the preferred order: a principle (both drafted groups at the floor) and her observed order', () => {
    expect(followOnKindOrder('principle', EMPTY, LISTED)).toEqual(['qa', 'cloze', 'mcq']);
    expect(followOnKindOrder('principle', EMPTY, ['mcq', 'qa', 'cloze'])).toEqual([
      'mcq',
      'qa',
      'cloze',
    ]);
  });

  it('reads deficits against what the concept holds, so a met share yields to the next group', () => {
    // A fact holding three recall items has met its recall share (dominant, three steps).
    expect(followOnKindOrder('fact', { retrieval: 3, quiz: 0, explainBack: 0 }, LISTED)).toEqual([
      'mcq',
      'qa',
      'cloze',
    ]);
    // A category holding two multiple-choice items has met its quiz share (weighted, two steps).
    expect(
      followOnKindOrder('category', { retrieval: 0, quiz: 2, explainBack: 0 }, LISTED),
    ).toEqual(['qa', 'cloze', 'mcq']);
  });

  it('the unclassified reading orders recall first and never removes a kind', () => {
    expect(followOnKindOrder(null, EMPTY, LISTED)).toEqual(['qa', 'cloze', 'mcq']);
    expect(followOnKindOrder(null, EMPTY, ['mcq', 'cloze', 'qa'])).toEqual(['cloze', 'qa', 'mcq']);
    for (const kind of ['fact', 'category', 'principle', null] as const) {
      expect([...followOnKindOrder(kind, EMPTY, LISTED)].sort()).toEqual(['cloze', 'mcq', 'qa']);
    }
  });
});

describe('KnowledgeKindLabels: the label kept for the further calls (`[D-549]`)', () => {
  const classified = (kind: 'fact' | 'category' | 'principle') =>
    ({ status: 'classified', kind, confidence: 0.9, method: 'model' }) as const;
  const unclassified = { status: 'unclassified', confidence: undefined, method: 'model' } as const;

  it('keys by course and concept, reads null when nothing is held, and lets a real label replace another', () => {
    const labels = new KnowledgeKindLabels();
    expect(labels.kindFor('COURSE-A', 'k1')).toBeNull();
    expect(labels.has('COURSE-A', 'k1')).toBe(false);
    labels.record('COURSE-A', 'k1', classified('fact'));
    expect(labels.kindFor('COURSE-A', 'k1')).toBe('fact');
    expect(labels.kindFor('COURSE-B', 'k1')).toBeNull();
    labels.record('COURSE-A', 'k1', classified('principle'));
    expect(labels.kindFor('COURSE-A', 'k1')).toBe('principle');
  });

  it('an unclassified reading is held only where no label is, and never erases one', () => {
    const labels = new KnowledgeKindLabels();
    labels.record('COURSE-A', 'k1', unclassified);
    expect(labels.has('COURSE-A', 'k1')).toBe(true);
    expect(labels.kindFor('COURSE-A', 'k1')).toBeNull();
    labels.record('COURSE-A', 'k1', classified('category'));
    labels.record('COURSE-A', 'k1', unclassified);
    expect(labels.kindFor('COURSE-A', 'k1')).toBe('category');
  });

  it('the default labels are one per vault object', () => {
    const a = new MemoryVaultSource();
    const b = new MemoryVaultSource();
    expect(knowledgeKindLabelsFor(a)).toBe(knowledgeKindLabelsFor(a));
    expect(knowledgeKindLabelsFor(a)).not.toBe(knowledgeKindLabelsFor(b));
  });
});
