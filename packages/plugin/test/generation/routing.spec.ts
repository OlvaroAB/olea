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
import type { ConceptInstrumentInventory, KnowledgeKindClassifierPort } from 'olea-core';
import { provisionalConceptKey } from 'olea-core';
import { describe, expect, it } from 'vitest';
import {
  buildConceptInstrumentInventory,
  buildKnowledgeKindSourceMaterial,
  classifyForRouting,
  decideConceptRouting,
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

describe('buildConceptInstrumentInventory', () => {
  it('counts a real vault instrument into its concept and routing group', async () => {
    const vault = new MemoryVaultSource({
      [NOTE]: [frontmatter('Working memory'), '## Q', '', MCQ_BLOCK, ''].join('\n'),
    });
    const key = provisionalConceptKey({ name: 'Working memory', boundNotePath: null });

    const inventory = await buildConceptInstrumentInventory(vault, { under: '01 Courses' });

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
    const wmKey = provisionalConceptKey({ name: 'Working memory', boundNotePath: null });
    const attnKey = provisionalConceptKey({ name: 'Attention', boundNotePath: null });

    const inventory = await buildConceptInstrumentInventory(vault, { under: '01 Courses' });

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

  it('unclassified routes to the retrieval baseline: quiz is never warranted', () => {
    const decision = decideConceptRouting(
      { status: 'unclassified', confidence: undefined, method: 'model' },
      EMPTY,
    );
    expect(decision.mix).toEqual({ retrieval: 'floor', quiz: 'none', explainBack: 'none' });
    expect(quizDeficit(decision)).toBe(0);
  });

  it('a classified `category` against an empty inventory warrants quiz drafting', () => {
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
  });
});
