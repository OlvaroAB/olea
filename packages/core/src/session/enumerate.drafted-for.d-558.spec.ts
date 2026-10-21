// Scenarios: features/F3-learn-from-anything.md, the `[D-558]` block of "F3.1 / F3.3 / F3.5 — A bare
// drop with no embedding note gets its own home note" — @auto:core/session/enumerate.drafted-for.d-558.spec
//
// `[D-558]` (ol-egov.141.89.9.100; built by ol-egov.141.89.9.99): an item Olea drafted into its home
// note scores the concept it was drafted for and belongs to that concept's courses. Synthetic vault:
// course D's code sorts first, as on the run that found this, so the whole-note binding showed D.
import { describe, expect, it } from 'vitest';
import { memoryVault } from '../../test/session/memory-vault.js';
import type { ConceptRecord } from '../concept/types.js';
import type { GapRow } from '../gap/build.js';
import { buildStudySession } from '../study-session/build.js';
import type { DurationModel } from '../study-session/duration.js';
import { buildConceptInstrumentIndex } from '../study-session/instrument-index.js';
import { DRAFTED_FOR_FRONTMATTER_KEY } from './drafted-for.js';
import { enumerateVaultInstruments } from './enumerate.js';
import { scoredConceptOf } from './scored-concept.js';
import type { VaultInstrumentRecord } from './types.js';

const COURSE_A = 'ZZZ100';
const COURSE_D = 'AAA100';
const HOME = `01 Courses/${COURSE_A}/a-note (Olea).md`;
const ONLY_A_ITEM = 'mcq-aaaaaaaaaaaaaaaa';
const SHARED_ITEM = 'mcq-bbbbbbbbbbbbbbbb';

const mcq = (id: string | null, stem: string) =>
  [
    '```olea-mcq',
    ...(id === null ? [] : [`id: ${id}`]),
    `stem: ${stem}`,
    'answer: right',
    'distractor: d1',
    'distractor: d2',
    'distractor: d3',
    'feedback: because.',
    '```',
  ].join('\n');

/** Her notes: a concept both courses hold (bound to her concept note) and one only A holds. */
const HER_NOTES: Readonly<Record<string, string>> = {
  [`01 Courses/${COURSE_D}/d-note.md`]: [
    '---',
    'topic:',
    '  - Shared idea',
    '---',
    '',
    'See [[Shared idea]].',
    '',
  ].join('\n'),
  [`01 Courses/${COURSE_A}/a-note.md`]: [
    '---',
    'topic:',
    '  - Shared idea',
    '  - Only-A idea',
    '---',
    '',
    'See [[Shared idea]].',
    '',
  ].join('\n'),
  '05 Zettelkasten/Shared idea.md': 'A note she wrote.\n',
};

/** Olea's home note in course A, shaped as `generation/home-note.ts` writes it. */
function homeNote(options: {
  readonly topics?: readonly string[];
  readonly record?: readonly (readonly [string, string])[];
  readonly body: readonly string[];
}): string {
  const topics = options.topics ?? ['Shared idea', 'Only-A idea'];
  const record = options.record ?? [];
  return [
    '---',
    'topic:',
    ...topics.map((topic) => `  - ${topic}`),
    'olea-home-note: true',
    ...(record.length === 0
      ? []
      : [`${DRAFTED_FOR_FRONTMATTER_KEY}:`, ...record.map(([item, key]) => `  ${item}: ${key}`)]),
    '---',
    '',
    '*Olea created this note beside `a-note.md`.*',
    '',
    ...options.body.flatMap((block) => [block, '']),
  ].join('\n');
}

const TWO_ITEMS = [
  mcq(SHARED_ITEM, 'Drafted for the shared idea?'),
  mcq(ONLY_A_ITEM, 'Drafted for the only-A idea?'),
];

/** The two concepts as the product extracts them, read from a vault with no record. */
async function theConcepts(): Promise<{ shared: ConceptRecord; onlyA: ConceptRecord }> {
  const found = await enumerateVaultInstruments(
    memoryVault({ ...HER_NOTES, [HOME]: homeNote({ body: TWO_ITEMS }) }),
  );
  const byName = new Map(found.concepts.map((concept) => [concept.name, concept]));
  const shared = byName.get('Shared idea');
  const onlyA = byName.get('Only-A idea');
  if (shared === undefined || onlyA === undefined) throw new Error('test setup: concepts missing');
  expect(shared.courses).toEqual([COURSE_D, COURSE_A]);
  expect(onlyA.courses).toEqual([COURSE_A]);
  return { shared, onlyA };
}

function recordOf(records: readonly VaultInstrumentRecord[], id: string): VaultInstrumentRecord {
  const found = records.find((record) => record.instrumentId === id);
  if (found === undefined) throw new Error(`no record ${id}`);
  return found;
}

/** A course row on `concept`, filled from `records` the way the session builder fills one. */
function fillRow(
  records: readonly VaultInstrumentRecord[],
  concept: ConceptRecord,
  course: string,
): readonly string[] {
  const row = {
    conceptName: concept.name,
    conceptKey: concept.key,
    course,
    gapClass: 'mastery-gap',
    rank: 1,
    oracleRank: 1,
    priorityScore: 1,
    gapScore: 1,
    readiness: {
      assessmentFormat: 'unknown',
      recognitionEvidence: false,
      recognitionOnly: false,
      applied: false,
      weight: 1,
    },
    masteryState: 'sprout',
    targetAssessmentPath: '02 Assignments/q.md',
    assessmentFormat: 'unknown',
    citations: [],
    distinctSourceCount: 1,
    reasoning: 'r',
    notePaths: [],
    instrumentCount: records.length,
    affordances: ['open-concept', 'build-session'],
  } as unknown as GapRow;
  const durations = {
    estimates: [],
    basis: 'assumed',
    totalSampleCount: 0,
    secondsFor: () => 60,
    sourceFor: () => 'assumed',
  } as unknown as DurationModel;
  const session = buildStudySession({
    rows: [row],
    instruments: buildConceptInstrumentIndex(records),
    budgetMinutes: 30,
    durations,
    asOf: '2026-10-20' as never,
    order: 'given',
  });
  return session.items.map((item) => item.instrumentId);
}

describe('[D-558] an item in Olea home note scores the concept it was drafted for', () => {
  it('an A-only item serves A only and scores its own concept; a shared item serves both; a D row reaches only the shared one', async () => {
    const { shared, onlyA } = await theConcepts();
    const vault = memoryVault({
      ...HER_NOTES,
      [HOME]: homeNote({
        record: [
          [SHARED_ITEM, shared.key],
          [ONLY_A_ITEM, onlyA.key],
        ],
        body: TWO_ITEMS,
      }),
    });
    const found = await enumerateVaultInstruments(vault);

    const onlyAItem = recordOf(found.records, ONLY_A_ITEM);
    expect(onlyAItem.conceptIds).toEqual([onlyA.key]);
    expect(scoredConceptOf(onlyAItem)).toBe(onlyA.key);
    expect(onlyAItem.courses).toEqual([COURSE_A]);

    const sharedItem = recordOf(found.records, SHARED_ITEM);
    expect(sharedItem.conceptIds).toEqual([shared.key]);
    expect(sharedItem.courses).toEqual([COURSE_D, COURSE_A]);

    expect(fillRow(found.records, shared, COURSE_D)).toEqual([SHARED_ITEM]);
    expect(found.unbound).toEqual([]);
    expect(vault.writes).toEqual([]); // the walk still writes nothing
  });

  it("the note's other topics are not context for a recorded item: each is filed under its own concept alone", async () => {
    const { shared, onlyA } = await theConcepts();
    const found = await enumerateVaultInstruments(
      memoryVault({
        ...HER_NOTES,
        [HOME]: homeNote({
          record: [
            [SHARED_ITEM, shared.key],
            [ONLY_A_ITEM, onlyA.key],
          ],
          body: TWO_ITEMS,
        }),
      }),
    );
    const index = buildConceptInstrumentIndex(found.records);
    expect(index.instrumentsFor(onlyA.key).map((r) => r.instrumentId)).toEqual([ONLY_A_ITEM]);
    expect(index.instrumentsFor(shared.key).map((r) => r.instrumentId)).toEqual([SHARED_ITEM]);
    // The note itself is still recorded under every topic it names.
    for (const name of ['Shared idea', 'Only-A idea']) {
      expect(found.concepts.find((c) => c.name === name)?.sourcePaths).toContain(HOME);
    }
  });

  it('a recorded card is found by its block id', async () => {
    const { shared, onlyA } = await theConcepts();
    const found = await enumerateVaultInstruments(
      memoryVault({
        ...HER_NOTES,
        [HOME]: homeNote({
          record: [['k3x9qa', onlyA.key]],
          body: ['Drafted for the only-A idea?::Because. ^k3x9qa'],
        }),
      }),
    );
    expect(found.records).toHaveLength(1);
    const card = found.records[0];
    expect(card?.instrumentType).toBe('qa');
    expect(card?.blockId).toBe('k3x9qa');
    expect(card?.conceptIds).toEqual([onlyA.key]);
    expect(card?.courses).toEqual([COURSE_A]);
    expect(card?.conceptIds).not.toContain(shared.key);
  });
});

describe('[D-558] an item with no record keeps the whole-note binding', () => {
  it('every item in a home note written before the ruling binds as before', async () => {
    const { shared, onlyA } = await theConcepts();
    const found = await enumerateVaultInstruments(
      memoryVault({ ...HER_NOTES, [HOME]: homeNote({ body: TWO_ITEMS }) }),
    );
    for (const id of [SHARED_ITEM, ONLY_A_ITEM]) {
      expect(recordOf(found.records, id).conceptIds).toEqual([shared.key, onlyA.key]);
      expect(recordOf(found.records, id).courses).toEqual([COURSE_D, COURSE_A]);
    }
  });

  it('an item she wrote into a home note herself binds as before, beside a recorded one', async () => {
    const { shared, onlyA } = await theConcepts();
    const found = await enumerateVaultInstruments(
      memoryVault({
        ...HER_NOTES,
        [HOME]: homeNote({
          record: [[ONLY_A_ITEM, onlyA.key]],
          body: [
            mcq(ONLY_A_ITEM, 'Drafted for the only-A idea?'),
            mcq(null, 'One she wrote herself?'),
            'A card she wrote::Its back.',
          ],
        }),
      }),
    );
    expect(found.records).toHaveLength(3);
    expect(recordOf(found.records, ONLY_A_ITEM).conceptIds).toEqual([onlyA.key]);
    const hers = found.records.filter((record) => record.instrumentId !== ONLY_A_ITEM);
    expect(hers).toHaveLength(2);
    for (const record of hers) {
      expect(record.conceptIds).toEqual([shared.key, onlyA.key]);
      expect(record.courses).toEqual([COURSE_D, COURSE_A]);
    }
  });

  it('a look-alike entry in a note she wrote never rebinds her items', async () => {
    const { shared, onlyA } = await theConcepts();
    const herNote = [
      '---',
      'topic:',
      '  - Shared idea',
      '  - Only-A idea',
      `${DRAFTED_FOR_FRONTMATTER_KEY}:`,
      `  ${ONLY_A_ITEM}: ${onlyA.key}`,
      '---',
      '',
      mcq(ONLY_A_ITEM, 'A question in her own note?'),
      '',
    ].join('\n');
    const found = await enumerateVaultInstruments(
      memoryVault({ ...HER_NOTES, [`01 Courses/${COURSE_A}/her-own.md`]: herNote }),
    );
    expect(recordOf(found.records, ONLY_A_ITEM).conceptIds).toEqual([shared.key, onlyA.key]);
    expect(recordOf(found.records, ONLY_A_ITEM).courses).toEqual([COURSE_D, COURSE_A]);
  });

  it('a record whose concept no longer exists falls back to the whole-note binding, never unbound, with the same id', async () => {
    const { shared, onlyA } = await theConcepts();
    const found = await enumerateVaultInstruments(
      memoryVault({
        ...HER_NOTES,
        [HOME]: homeNote({
          record: [[ONLY_A_ITEM, 'concept-key1:no-longer-anywhere']],
          body: [mcq(ONLY_A_ITEM, 'Drafted for a concept since removed?')],
        }),
      }),
    );
    expect(found.unbound).toEqual([]);
    expect(recordOf(found.records, ONLY_A_ITEM).conceptIds).toEqual([shared.key, onlyA.key]);
  });

  it('in a home note whose topic list names nothing, a recorded item still binds and the rest are reported unbound', async () => {
    const { onlyA } = await theConcepts();
    const found = await enumerateVaultInstruments(
      memoryVault({
        ...HER_NOTES,
        [HOME]: homeNote({
          topics: [],
          record: [[ONLY_A_ITEM, onlyA.key]],
          body: [mcq(ONLY_A_ITEM, 'Drafted for the only-A idea?'), mcq(null, 'Unrecorded?')],
        }),
      }),
    );
    expect(found.records.map((record) => record.instrumentId)).toEqual([ONLY_A_ITEM]);
    expect(recordOf(found.records, ONLY_A_ITEM).courses).toEqual([COURSE_A]);
    expect(found.unbound).toHaveLength(1);
    expect(found.unbound[0]?.notePath).toBe(HOME);
  });
});
