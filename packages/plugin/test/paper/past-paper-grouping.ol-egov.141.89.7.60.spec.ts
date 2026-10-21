/**
 * `ol-egov.141.89.7.60` (`[D-559]`: "grouping as the fallback for a text paper whose reading is
 * pending"; F4.11; scp.md 2.2): the local question grouping of a past paper's own text shapes the
 * structured paper while that paper's structure reading is pending, and never once the reading
 * exists.
 *
 * Scenarios: olea-service/features/F4-oracle.md, the three tagged
 * `@auto:plugin/paper/past-paper-grouping.ol-egov.141.89.7.60.spec`:
 * - a text past paper whose structure reading is pending is shaped by its local grouping;
 * - once the structure reading exists, the reading shapes the paper, never the grouping;
 * - a Markdown past paper, which never gets a structure reading, is shaped by its local grouping.
 *
 * Course A is synthetic: every paper, label, note and path here is invented. The text paper's
 * extraction is injected (a synthetic `ExtractionResult`), so no PDF is parsed; the Markdown paper
 * goes through the production read (`registerSources`, `segmentPastPaper`) unchanged.
 */

import type { ReviewLogEntry } from 'olea-contracts';
import type {
  ExtractionResult,
  PageExtraction,
  PastPaperStoredReading,
  UnitManifest,
  VaultSource,
} from 'olea-core';
import {
  buildStructuredPaperShape,
  listPaperJournals,
  listPaperRecords,
  selectPaperTemplateParts,
} from 'olea-core';
import { describe, expect, it } from 'vitest';
import type { PaperSlotOutcomePort } from '../../src/oracle/paper-item-port.js';
import {
  createPendingPaperTemplateReader,
  groupPastPaperText,
  type PastPaperExtract,
  pastPaperReadingPending,
  pastPaperTemplateFromGrouping,
} from '../../src/paper/past-paper-grouping.js';
import {
  type CreateLocalPracticePaperProviderDeps,
  createLocalPracticePaperProvider,
  PracticePaperUnfinishedError,
  pastPaperStructureReaderForVault,
} from '../../src/paper/provider.js';
import {
  createScopeReadingPersistence,
  type ExtractedPaperStructure,
} from '../../src/scope-reading/persistence.js';
import { memoryVault } from '../review/memory-vault.js';

const BASE_PATH = '02 Assignments/Assignments.base';
const ASSIGNMENTS_BASE_FILE = [
  'filters:',
  '  and:',
  '    - file.inFolder("02 Assignments")',
  '    - file.ext == "md"',
  'properties:',
  '  class:',
  '  type:',
  '  weight:',
  '  due:',
  '  status:',
].join('\n');
const SETTINGS = {
  load: async () => ({ version: 1 as const, assignmentsBasePath: BASE_PATH }),
};
const DEVICE = 'olea-dev1';
const TOPICS = ['Alpha', 'Beta', 'Gamma', 'Delta', 'Epsilon', 'Zeta', 'Eta'].map(
  (name) => `${name} theory`,
);
const TEXT_PAPER = '03 Research/COURSEA Paper 1.pdf';
const MARKDOWN_PAPER = '03 Research/COURSEA Past Paper.md';

/** Course A: an exam three days out and seven topics with her own notes behind them. */
function courseVault(extraFiles: Record<string, string> = {}): VaultSource {
  const files: Record<string, string> = {
    [BASE_PATH]: ASSIGNMENTS_BASE_FILE,
    '02 Assignments/exam.md':
      '---\nclass: COURSEA\ntype: exam\nweight: 1\ndue: 2026-09-22\nstatus: pending\n---\n',
    ...extraFiles,
  };
  TOPICS.forEach((topic, index) => {
    files[`05 Zettelkasten/${topic}.md`] = `# ${topic}\n`;
    files[`Notes/${index}.md`] = [
      '---',
      `topic: [${topic}]`,
      'course: COURSEA',
      '---',
      '',
      `Front ${index}::Back ${index}`,
      '',
    ].join('\n');
  });
  return memoryVault(files);
}

/**
 * A synthetic text paper: a question before any section (so in no group), Section A with a plain
 * question and a parent question of two parts, a Section B with no question under it (unresolved),
 * and Section C with one question. Marks are printed on some parts and not on others.
 */
const TEXT_PAPER_TEXT = [
  'Answer ALL questions.',
  '',
  '1. Define kinetic energy in your own words. (2 marks)',
  '',
  'SECTION A',
  '',
  '2. State the first law of motion. (3 marks)',
  '',
  '3. A trolley rolls down a ramp and along a flat bench.',
  '',
  '(a) Describe the energy changes on the ramp. (4 marks)',
  '',
  '(b) Explain why the trolley slows on the bench.',
  '',
  'SECTION B',
  '',
  'SECTION C',
  '',
  '4. Discuss momentum in collisions. (10 marks)',
  '',
].join('\n');

function page(path: string, number: number, text: string): PageExtraction {
  return {
    page: number,
    charCount: text.length,
    textLayer: 'readable',
    route: 'text-layer',
    units: [
      {
        text,
        provenance: {
          sourcePath: path,
          location: { page: number, charRange: { start: 0, end: text.length } },
        },
      },
    ],
    furniture: false,
  };
}

function textExtraction(path: string, pages: readonly string[]): ExtractionResult {
  return {
    sourcePath: path,
    format: 'pdf',
    outcome: 'extracted',
    pages: pages.map((text, index) => page(path, index + 1, text)),
  };
}

/** The injected extraction, counting its calls: the only route to a text paper's grouping. */
function countingExtract(pages: Readonly<Record<string, readonly string[]>>): {
  readonly extract: PastPaperExtract;
  readonly calls: string[];
} {
  const calls: string[] = [];
  return {
    calls,
    extract: async (_vault, path) => {
      calls.push(path);
      const text = pages[path];
      if (text === undefined) throw new Error('no such paper');
      return textExtraction(path, text);
    },
  };
}

const MARKDOWN_PAPER_TEXT = [
  '---',
  'role: past-paper',
  'course: COURSEA',
  '---',
  '',
  '# Synthetic Past Paper',
  '',
  '## Section A',
  '',
  '## Question 1 (5 marks)',
  '',
  'Explain how a lever multiplies force.',
  '',
  '## Question 2',
  '',
  'A ball is thrown straight upwards.',
  '',
  '(a) Describe its motion. [2 marks]',
  '',
  '(b) State its speed at the top.',
  '',
  '## Section B',
  '',
  '## Question 3 (8 marks)',
  '',
  'Discuss friction on a slope.',
  '',
].join('\n');

const registered = (path: string, course: string): ReviewLogEntry =>
  ({
    schemaVersion: 6,
    kind: 'source-registered',
    eventId: `registered-${path}`,
    timestamp: '2026-10-01T09:00:00Z',
    path,
    role: 'past-paper',
    course,
  }) as unknown as ReviewLogEntry;

const manifestsAt =
  (revisions: Readonly<Record<string, string>>) =>
  async (paths: readonly string[]): Promise<ReadonlyMap<string, UnitManifest>> =>
    new Map(
      paths
        .filter((path) => revisions[path] !== undefined)
        .map((path) => [
          path,
          { sourcePath: path, revisionDigest: revisions[path] as string, entries: [] },
        ]),
    );

/** A reading of the text paper with groups and parts, as the Worker would store it. */
const READING_WITH_PARTS: ExtractedPaperStructure = {
  sections: [
    { label: 'Section A', questionForm: 'short answer', itemCount: 2, anchor: { blockIndex: 0 } },
  ],
  questionGroups: [
    {
      id: 'q1',
      kind: 'parent-question',
      label: 'Question 1',
      memberLabels: ['1(a)', '1(b)'],
      anchor: { blockIndex: 1 },
      stimulus: { status: 'none' },
    },
  ],
  questionParts: [
    {
      id: 'p1a',
      label: '1(a)',
      groupId: 'q1',
      instructionAnchor: { blockIndex: 1 },
      questionForm: 'short answer',
    },
    {
      id: 'p1b',
      label: '1(b)',
      groupId: 'q1',
      instructionAnchor: { blockIndex: 2 },
      questionForm: 'short answer',
    },
  ],
};

async function recordReading(
  vault: VaultSource,
  path: string,
  structure: ExtractedPaperStructure,
  coverage = { unitsRead: 4, unitsTotal: 4 },
): Promise<void> {
  await createScopeReadingPersistence({ vault, deviceId: DEVICE }).recordExtraction({
    sourcePath: path,
    documentKind: 'past-paper',
    revisionDigest: 'r1',
    coverage,
    declarationCount: 0,
    paperStructure: structure,
    stamp: { promptVersion: 'p1', modelId: 'm1' },
  });
}

const generated: PaperSlotOutcomePort = async (request) => ({
  status: 'generated',
  taskId: request.taskId,
  promptVersion: 'v1',
  response: {
    ok: true,
    result:
      request.taskId === 'quiz.generate.v1'
        ? { questions: [{ stem: 'q', correctAnswer: 'a', distractors: [], feedback: '' }] }
        : { cards: [{ front: 'q', back: 'a' }] },
  },
});

let nonce = 0;
function providerWith(
  vault: VaultSource,
  readPastPaperStructure: CreateLocalPracticePaperProviderDeps['readPastPaperStructure'],
  port: PaperSlotOutcomePort = generated,
) {
  const calls: string[] = [];
  const recording: PaperSlotOutcomePort = async (request) => {
    calls.push(request.conceptName);
    return port(request);
  };
  const provider = createLocalPracticePaperProvider({
    vault,
    settingsStore: SETTINGS,
    generationPort: async () => recording,
    now: () => new Date(`2026-09-19T00:00:00.${String(nonce++ % 1000).padStart(3, '0')}Z`),
    ...(readPastPaperStructure !== undefined ? { readPastPaperStructure } : {}),
  });
  return { provider, calls };
}

async function readyPaper(provider: ReturnType<typeof providerWith>['provider']) {
  const state = await provider.requestPaper('COURSEA');
  if (state.kind !== 'ready') throw new Error(`expected ready, got ${state.kind}`);
  return state;
}

/** The production reader over course A's registered text paper, with its extraction injected. */
function textPaperReader(
  vault: VaultSource,
  extract: PastPaperExtract,
  revisions: Readonly<Record<string, string>> = { [TEXT_PAPER]: 'r1' },
) {
  return pastPaperStructureReaderForVault({
    vault,
    deviceId: DEVICE,
    manifestsFor: manifestsAt(revisions),
    reviewLog: async () => [registered(TEXT_PAPER, 'COURSEA')],
    extract,
  });
}

const GROUPED_PARTS = [
  ['2', 'group-1'],
  ['3(a)', 'group-2'],
  ['3(b)', 'group-2'],
  ['4', 'group-3'],
];

describe('a text past paper whose structure reading is pending is shaped by its local grouping', () => {
  it('the paper is composed in the structured form from the grouping of that paper’s text', async () => {
    const vault = courseVault();
    const { extract, calls: extracted } = countingExtract({ [TEXT_PAPER]: [TEXT_PAPER_TEXT] });
    const reader = textPaperReader(vault, extract);
    expect(await reader('COURSEA')).toBeNull();

    const { provider, calls } = providerWith(vault, reader);
    const state = await readyPaper(provider);
    expect(extracted).toEqual([TEXT_PAPER]);
    expect(state.record.schemaVersion).toBe(2);
    expect(state.record.structure?.parts.map((part) => [part.label, part.groupId])).toEqual(
      GROUPED_PARTS,
    );
    expect(state.record.structure?.groups.map((group) => [group.groupId, group.kind])).toEqual([
      ['group-1', 'section'],
      ['group-2', 'parent-question'],
      ['group-3', 'section'],
    ]);
    expect(state.record.structure?.groups[1]?.parentGroupId).toBe('group-1');
    // Marks the text prints are stated; a part with none stays unknown, never zero ([D-431]).
    expect(state.record.structure?.parts.map((part) => part.marks)).toEqual([
      { status: 'stated', value: 3 },
      { status: 'stated', value: 4 },
      { status: 'unknown' },
      { status: 'stated', value: 10 },
    ]);
    // No dependency, question form or total is invented.
    for (const part of state.record.structure?.parts ?? []) {
      expect(part.dependsOn).toEqual({ status: 'unknown' });
      expect(part.questionForm).toBe('');
    }
    expect(state.record.structure?.totalMarks).toEqual({ status: 'unknown' });
    expect(state.record.structure?.timeAllowance).toEqual({ status: 'unknown' });
    // Four parts, four calls, one concept each.
    expect(calls).toHaveLength(4);
    expect(new Set(calls).size).toBe(4);
    expect(state.items).toHaveLength(4);
    // The length is the readings' alone: none counts, so the declared standard extent was planned.
    expect(state.record.compositionAccount.structureSummary).toBeNull();
  });

  it('a group or part the grouping could not resolve is left out of the structure and never shown to her', async () => {
    const vault = courseVault();
    const { extract } = countingExtract({ [TEXT_PAPER]: [TEXT_PAPER_TEXT] });
    const { provider } = providerWith(vault, textPaperReader(vault, extract));
    const state = await readyPaper(provider);

    // Question 1 sits in no group, and Section B has no question under it.
    const labels = state.record.structure?.parts.map((part) => part.label) ?? [];
    expect(labels).not.toContain('1');
    const groupLabels = state.record.structure?.groups.map((group) => group.label) ?? [];
    expect(groupLabels).not.toContain('SECTION B');
    // Nothing of either reaches the face, the record or the journal.
    const face = JSON.stringify({ ...state, record: undefined });
    expect(face).not.toContain('SECTION B');
    expect(face).not.toContain('kinetic energy');
    expect(state.passages).toEqual([]);
    const stored = JSON.stringify([
      ...(await listPaperRecords(vault)).map((entry) => entry.record),
      ...(await listPaperJournals(vault)).map((entry) => entry.record),
    ]);
    expect(stored).not.toContain('SECTION B');
    expect(stored).not.toContain('kinetic energy');
    expect(stored).not.toContain('unresolved');
  });

  it('the grouping is never stored: the vault holds only the paper and its journal afterwards', async () => {
    const vault = courseVault();
    const before = new Set(await vault.list());
    const { extract } = countingExtract({ [TEXT_PAPER]: [TEXT_PAPER_TEXT] });
    const { provider } = providerWith(vault, textPaperReader(vault, extract));
    const state = await readyPaper(provider);
    // The vault walk stamps each concept's permanent key on every request (`stampConceptKeys`).
    const added = (await vault.list()).filter(
      (path) => !before.has(path) && !path.startsWith('.olea/concepts/'),
    );
    const paperFiles = [
      ...(await listPaperRecords(vault)).map((entry) => entry.path),
      ...(await listPaperJournals(vault)).map((entry) => entry.path),
    ];
    expect(added.sort()).toEqual([...paperFiles].sort());
    expect(state.record.structure).toBeDefined();
  });

  it('a text paper the splitter cannot split, or cannot be read, gives no template: the flat paper', async () => {
    const vault = courseVault();
    const unsplittable = countingExtract({ [TEXT_PAPER]: ['No numbered questions on this page.'] });
    const flat = await readyPaper(
      providerWith(vault, textPaperReader(vault, unsplittable.extract)).provider,
    );
    expect(flat.record.structure).toBeUndefined();
    expect(flat.items).toHaveLength(6);

    const unreadable = countingExtract({});
    const flatAgain = await readyPaper(
      providerWith(vault, textPaperReader(vault, unreadable.extract)).provider,
    );
    expect(unreadable.calls).toEqual([TEXT_PAPER]);
    expect(flatAgain.record.structure).toBeUndefined();
  });

  it('a paper whose current revision is unknown has no current reading, so it is pending too (Class B)', async () => {
    const vault = courseVault();
    await recordReading(vault, TEXT_PAPER, READING_WITH_PARTS);
    const { extract, calls } = countingExtract({ [TEXT_PAPER]: [TEXT_PAPER_TEXT] });
    const reader = textPaperReader(vault, extract, {});
    expect(await reader('COURSEA')).toBeNull();
    expect((await reader.pendingPaperTemplate?.('COURSEA'))?.parts.map((p) => p.label)).toEqual([
      '2',
      '3(a)',
      '3(b)',
      '4',
    ]);
    expect(calls).toEqual([TEXT_PAPER]);
  });
});

describe('once the structure reading exists, the reading shapes the paper, never the grouping', () => {
  it('a new paper after the reading arrives takes the reading’s groups and parts, and the paper’s text is not read for a grouping', async () => {
    const vault = courseVault();
    const { extract, calls: extracted } = countingExtract({ [TEXT_PAPER]: [TEXT_PAPER_TEXT] });
    const reader = textPaperReader(vault, extract);

    const first = await readyPaper(providerWith(vault, reader).provider);
    expect(first.record.structure?.parts.map((part) => [part.label, part.groupId])).toEqual(
      GROUPED_PARTS,
    );
    expect(extracted).toHaveLength(1);

    await recordReading(vault, TEXT_PAPER, READING_WITH_PARTS);
    const second = await readyPaper(providerWith(vault, reader).provider);
    expect(second.record.structure?.parts.map((part) => [part.label, part.groupId])).toEqual([
      ['1(a)', 'q1'],
      ['1(b)', 'q1'],
    ]);
    expect(second.record.structure?.parts.map((part) => part.questionForm)).toEqual([
      'short answer',
      'short answer',
    ]);
    // The grouping was not consulted: the paper's text was not read again.
    expect(extracted).toHaveLength(1);
  });

  it('readings first (Class B): one paper’s counted reading shapes the paper, though another paper earlier in path order is still pending', async () => {
    const vault = courseVault();
    const readPaper = '03 Research/COURSEA Paper 2.pdf';
    await recordReading(vault, readPaper, READING_WITH_PARTS);
    const { extract, calls: extracted } = countingExtract({
      [TEXT_PAPER]: [TEXT_PAPER_TEXT],
      [readPaper]: [TEXT_PAPER_TEXT],
    });
    const reader = pastPaperStructureReaderForVault({
      vault,
      deviceId: DEVICE,
      manifestsFor: manifestsAt({ [TEXT_PAPER]: 'r1', [readPaper]: 'r1' }),
      reviewLog: async () => [registered(TEXT_PAPER, 'COURSEA'), registered(readPaper, 'COURSEA')],
      extract,
    });
    const state = await readyPaper(providerWith(vault, reader).provider);
    expect(state.record.structure?.parts.map((part) => part.groupId)).toEqual(['q1', 'q1']);
    expect(extracted).toEqual([]);
  });

  it('a reading that counts but carries sections only gives the flat paper, and the grouping is not consulted', async () => {
    const vault = courseVault();
    await recordReading(vault, TEXT_PAPER, {
      sections: [
        {
          label: 'Section A',
          questionForm: 'short answer',
          itemCount: 3,
          anchor: { blockIndex: 0 },
        },
      ],
    });
    const { extract, calls: extracted } = countingExtract({ [TEXT_PAPER]: [TEXT_PAPER_TEXT] });
    const reader = textPaperReader(vault, extract);
    expect((await reader('COURSEA'))?.template).toBeUndefined();
    const state = await readyPaper(providerWith(vault, reader).provider);
    expect(state.record.structure).toBeUndefined();
    expect(state.items).toHaveLength(3);
    expect(extracted).toEqual([]);
  });

  it('an unfinished paper planned on the grouping resumes on its own recorded structure after the reading arrives, and only the next new paper takes the reading ([D-560])', async () => {
    const vault = courseVault();
    const { extract } = countingExtract({ [TEXT_PAPER]: [TEXT_PAPER_TEXT] });
    const reader = textPaperReader(vault, extract);
    // The third part's call, and its one retry, find the service down: the run stops there.
    let call = 0;
    const down: PaperSlotOutcomePort = async (request) => {
      call += 1;
      return call === 3 || call === 4
        ? { status: 'unavailable', reason: 'transport-failure' }
        : generated(request);
    };
    const first = providerWith(vault, reader, down);
    const unfinished = await first.provider.requestPaper('COURSEA').then(
      () => null,
      (error: unknown) => error,
    );
    expect(unfinished).toBeInstanceOf(PracticePaperUnfinishedError);
    expect(first.calls).toHaveLength(4);
    const journal = (await listPaperJournals(vault))[0]?.record;
    expect(journal?.structure?.parts.map((part) => [part.label, part.groupId])).toEqual(
      GROUPED_PARTS,
    );

    await recordReading(vault, TEXT_PAPER, READING_WITH_PARTS);
    const resumed = providerWith(vault, reader);
    const state = await readyPaper(resumed.provider);
    expect(state.record.structure).toEqual(journal?.structure);
    // Only what was still owed is drafted: the third part, then the fourth.
    expect(resumed.calls).toHaveLength(2);
    expect(resumed.calls[0]).toBe(first.calls[2]);
    expect(first.calls.slice(0, 2)).not.toContain(resumed.calls[1]);

    const next = await readyPaper(providerWith(vault, reader).provider);
    expect(next.record.structure?.parts.map((part) => part.groupId)).toEqual(['q1', 'q1']);
  });
});

describe('a Markdown past paper, which never gets a structure reading, is shaped by its local grouping', () => {
  it('its local grouping shapes the paper, as for a text paper whose reading is pending, through the production read', async () => {
    const vault = courseVault({ [MARKDOWN_PAPER]: MARKDOWN_PAPER_TEXT });
    const { extract, calls: extracted } = countingExtract({});
    const reader = pastPaperStructureReaderForVault({
      vault,
      deviceId: DEVICE,
      manifestsFor: manifestsAt({}),
      reviewLog: async () => [],
      extract,
    });
    expect(await reader('COURSEA')).toBeNull();
    const { provider, calls } = providerWith(vault, reader);
    const state = await readyPaper(provider);
    expect(state.record.structure?.parts.map((part) => [part.label, part.groupId])).toEqual([
      ['1', 'group-1'],
      ['2(a)', 'group-2'],
      ['2(b)', 'group-2'],
      ['3', 'group-3'],
    ]);
    expect(state.record.structure?.groups.map((group) => [group.label, group.kind])).toEqual([
      ['Section A', 'section'],
      ['Question 2', 'parent-question'],
      ['Section B', 'section'],
    ]);
    expect(state.record.structure?.parts.map((part) => part.marks)).toEqual([
      { status: 'stated', value: 5 },
      { status: 'stated', value: 2 },
      { status: 'unknown' },
      { status: 'stated', value: 8 },
    ]);
    expect(calls).toHaveLength(4);
    // A Markdown paper is read from the note itself, never extracted.
    expect(extracted).toEqual([]);
  });

  it('a Markdown past paper of another course is not read for this one', async () => {
    const vault = courseVault({
      [MARKDOWN_PAPER]: MARKDOWN_PAPER_TEXT.replace('course: COURSEA', 'course: COURSEB'),
    });
    const reader = pastPaperStructureReaderForVault({
      vault,
      deviceId: DEVICE,
      manifestsFor: manifestsAt({}),
      reviewLog: async () => [],
    });
    expect(await reader.pendingPaperTemplate?.('COURSEA')).toBeNull();
    const state = await readyPaper(providerWith(vault, reader).provider);
    expect(state.record.structure).toBeUndefined();
  });
});

describe('which papers are pending, and in what order they are tried', () => {
  const readingOf = (
    state: PastPaperStoredReading['state'],
    structure: PastPaperStoredReading['structure'] = { status: 'absent' },
  ): PastPaperStoredReading => ({ state, structure });
  const known = (kind: 'recorded' | 'read-states-nothing' | 'registered') =>
    ({ status: 'known', state: { kind }, recordedAt: '2026-10-01T00:00:00Z' }) as const;
  const current = {
    status: 'current',
    reading: {
      sections: [],
      totalMarks: { status: 'unknown' },
      timeAllowance: { status: 'unknown' },
    },
    provenance: { task: 't', promptVersion: 'p', modelId: 'm' },
    structureId: 's',
  } as const;

  it('pending: no current revision, never read, registered, owed, read in part, read at another revision, or recorded with no current structure', () => {
    expect(pastPaperReadingPending(null)).toBe(true);
    expect(
      pastPaperReadingPending(readingOf({ status: 'unknown', otherRevisionsRecorded: true })),
    ).toBe(true);
    expect(pastPaperReadingPending(readingOf(known('registered')))).toBe(true);
    expect(
      pastPaperReadingPending(
        readingOf({
          status: 'known',
          state: { kind: 'pending', reason: 'unavailable' },
          recordedAt: '2026-10-01T00:00:00Z',
        }),
      ),
    ).toBe(true);
    expect(
      pastPaperReadingPending(
        readingOf(
          {
            status: 'known',
            state: { kind: 'partly-read', unitsRead: 2, unitsTotal: 4 },
            recordedAt: '2026-10-01T00:00:00Z',
          },
          current,
        ),
      ),
    ).toBe(true);
    expect(pastPaperReadingPending(readingOf(known('recorded')))).toBe(true);
    expect(
      pastPaperReadingPending(readingOf(known('recorded'), { status: 'stale-revision' })),
    ).toBe(true);
  });

  it('not pending: a reading that counts, or a revision read in full that states nothing', () => {
    expect(pastPaperReadingPending(readingOf(known('recorded'), current))).toBe(false);
    expect(pastPaperReadingPending(readingOf(known('read-states-nothing')))).toBe(false);
  });

  it('a paper read in full that states nothing is not grouped; a paper read in part is', async () => {
    const vault = courseVault();
    const nothing = '03 Research/COURSEA Paper 0.pdf';
    await createScopeReadingPersistence({ vault, deviceId: DEVICE }).recordExtraction({
      sourcePath: nothing,
      documentKind: 'past-paper',
      revisionDigest: 'r1',
      coverage: { unitsRead: 4, unitsTotal: 4 },
      declarationCount: 0,
      paperStructure: { sections: [] },
      stamp: { promptVersion: 'p1', modelId: 'm1' },
    });
    await recordReading(vault, TEXT_PAPER, READING_WITH_PARTS, { unitsRead: 2, unitsTotal: 4 });
    const { extract, calls } = countingExtract({
      [nothing]: [TEXT_PAPER_TEXT],
      [TEXT_PAPER]: [TEXT_PAPER_TEXT],
    });
    const reader = pastPaperStructureReaderForVault({
      vault,
      deviceId: DEVICE,
      manifestsFor: manifestsAt({ [nothing]: 'r1', [TEXT_PAPER]: 'r1' }),
      reviewLog: async () => [registered(nothing, 'COURSEA'), registered(TEXT_PAPER, 'COURSEA')],
      extract,
    });
    expect((await reader.pendingPaperTemplate?.('COURSEA'))?.parts).toHaveLength(4);
    expect(calls).toEqual([TEXT_PAPER]);
  });

  it('papers are tried in path order and the first whose grouping forms a template is used; one that fails is skipped', async () => {
    const tried: string[] = [];
    const grouped = await groupPastPaperText(memoryVault(), TEXT_PAPER, async (_vault, path) =>
      textExtraction(path, [TEXT_PAPER_TEXT]),
    );
    const read = createPendingPaperTemplateReader({
      loadScopeReadings: async () => {
        throw new Error('not asked: nothing registered');
      },
      registeredPastPapers: async () => [],
      currentRevisions: async () => new Map(),
      markdownPastPapers: async () => ['c.md', 'a.md', 'b.md', 'd.md'],
      groupPaper: async (path) => {
        tried.push(path);
        if (path === 'a.md') throw new Error('unreadable');
        if (path === 'b.md') return null;
        return grouped;
      },
    });
    expect(await read('COURSEA')).not.toBeNull();
    expect(tried).toEqual(['a.md', 'b.md', 'c.md']);
  });
});

describe('the mapping from a grouping to a template (pure)', () => {
  const block = (label: string, parentLabel?: string, marks?: number) => ({
    label,
    parentLabel,
    text: `${label} text`,
    marks,
    provenance: { sourcePath: 'p.md', location: { page: 1, charRange: { start: 0, end: 1 } } },
  });

  it('ids are opaque ordinals, never the paper’s numbering, and each group keeps its kind, label, nesting, members, choose and stimulus', async () => {
    const grouped = await groupPastPaperText(memoryVault(), TEXT_PAPER, async (_vault, path) =>
      textExtraction(path, [
        [
          'Answer TWO of the following three questions.',
          '',
          '1. Describe the water cycle.',
          '',
          '2. Explain why deserts form.',
          '',
          '3. Answer either (a) or (b).',
          '',
          '(a) Discuss the formation of river deltas.',
          '',
          '(b) Discuss the formation of glaciers.',
        ].join('\n'),
      ]),
    );
    if (grouped === null) throw new Error('expected a grouping');
    const template = pastPaperTemplateFromGrouping(grouped);
    expect(template?.groups.map((g) => [g.id, g.kind, g.parentGroupId, g.choose])).toEqual([
      ['group-1', 'choice', undefined, 2],
      ['group-2', 'parent-question', 'group-1', undefined],
      ['group-3', 'choice', 'group-2', 1],
    ]);
    expect(template?.groups.map((g) => g.memberLabels)).toEqual(
      grouped.grouping.groups.map((g) => g.memberLabels),
    );
    expect(template?.groups.map((g) => g.stimulus)).toEqual(
      grouped.grouping.groups.map((g) => g.stimulus),
    );
    expect(template?.parts.map((p) => [p.id, p.label, p.groupId])).toEqual([
      ['part-1', '1', 'group-1'],
      ['part-2', '2', 'group-1'],
      ['part-3', '3(a)', 'group-3'],
      ['part-4', '3(b)', 'group-3'],
    ]);
    for (const id of [...(template?.groups ?? []), ...(template?.parts ?? [])].map((x) => x.id)) {
      expect(id).not.toMatch(/\d\(|question|section|choice|stimulus/);
    }
  });

  it('a part whose groups do not nest one inside the next is left out', () => {
    // A stimulus range over 2..3 that crosses into a section over 3..4: question 3 sits in both,
    // and neither group holds the other.
    const questions = ['1', '2', '3', '4'].map((label) => block(label));
    const grouping = {
      groups: [
        {
          id: 'stimulus:1',
          kind: 'shared-stimulus' as const,
          label: 's',
          memberLabels: ['2', '3'],
          anchor: { start: 0, end: 1 },
          stimulus: { status: 'not-identified' as const, reason: 'no-cue' as const },
        },
        {
          id: 'section:1',
          kind: 'section' as const,
          label: 'S',
          memberLabels: ['3', '4'],
          anchor: { start: 0, end: 1 },
          stimulus: { status: 'not-identified' as const, reason: 'no-cue' as const },
        },
      ],
      placements: [
        { label: '1', groupPath: [], isStem: false },
        { label: '2', groupPath: ['stimulus:1'], isStem: false },
        { label: '3', groupPath: ['stimulus:1', 'section:1'], isStem: false },
        { label: '4', groupPath: ['section:1'], isStem: false },
      ],
    };
    const template = pastPaperTemplateFromGrouping({ grouping, questions });
    expect(template?.parts.map((p) => [p.label, p.groupId])).toEqual([
      ['2', 'group-1'],
      ['4', 'group-2'],
    ]);
  });

  it('no template from a grouping with no groups, no part, a label placed twice, placements that do not line up, a repeated group id or a group nested in one it does not hold', () => {
    const questions = [block('1'), block('2')];
    const section = {
      id: 'section:1',
      kind: 'section' as const,
      label: 'S',
      memberLabels: ['1', '2'],
      anchor: { start: 0, end: 1 },
      stimulus: { status: 'not-identified' as const, reason: 'no-cue' as const },
    };
    const inSection = (label: string) => ({ label, groupPath: ['section:1'], isStem: false });
    expect(
      pastPaperTemplateFromGrouping({
        grouping: { groups: [], placements: [inSection('1'), inSection('2')] },
        questions,
      }),
    ).toBeNull();
    expect(
      pastPaperTemplateFromGrouping({
        grouping: {
          groups: [section],
          placements: [
            { label: '1', groupPath: [], isStem: false },
            { label: '2', groupPath: [], isStem: false },
          ],
        },
        questions,
      }),
    ).toBeNull();
    expect(
      pastPaperTemplateFromGrouping({
        grouping: { groups: [section], placements: [inSection('1'), inSection('1')] },
        questions: [block('1'), block('1')],
      }),
    ).toBeNull();
    expect(
      pastPaperTemplateFromGrouping({
        grouping: { groups: [section], placements: [inSection('1')] },
        questions,
      }),
    ).toBeNull();
    expect(
      pastPaperTemplateFromGrouping({
        grouping: { groups: [section, section], placements: [inSection('1'), inSection('2')] },
        questions,
      }),
    ).toBeNull();
    expect(
      pastPaperTemplateFromGrouping({
        grouping: {
          groups: [{ ...section, parentGroupId: 'section:9' }],
          placements: [inSection('1'), inSection('2')],
        },
        questions,
      }),
    ).toBeNull();
    expect(
      pastPaperTemplateFromGrouping({
        grouping: { groups: [section], placements: [inSection('1'), inSection('2')] },
        questions,
      })?.parts,
    ).toHaveLength(2);
  });

  it('a choice one of whose alternatives was left out is refused by the structured builder, never shaped with fewer alternatives', () => {
    // A choice over 1 and 2, and a stimulus over 2 and 3 that does not nest in it: 2 is left out.
    const questions = ['1', '2', '3'].map((label) => block(label));
    const noCue = { status: 'not-identified' as const, reason: 'no-cue' as const };
    const template = pastPaperTemplateFromGrouping({
      grouping: {
        groups: [
          {
            id: 'choice:paper',
            kind: 'choice' as const,
            label: 'c',
            memberLabels: ['1', '2'],
            choose: 1,
            anchor: { start: 0, end: 1 },
            stimulus: noCue,
          },
          {
            id: 'stimulus:1',
            kind: 'shared-stimulus' as const,
            label: 's',
            memberLabels: ['2', '3'],
            anchor: { start: 0, end: 1 },
            stimulus: noCue,
          },
        ],
        placements: [
          { label: '1', groupPath: ['choice:paper'], isStem: false },
          { label: '2', groupPath: ['choice:paper', 'stimulus:1'], isStem: false },
          { label: '3', groupPath: ['stimulus:1'], isStem: false },
        ],
      },
      questions,
    });
    if (template === null) throw new Error('expected a template');
    expect(template.parts.map((part) => part.label)).toEqual(['1', '3']);
    const partIds = selectPaperTemplateParts(template, 6);
    const built = buildStructuredPaperShape(template, partIds, ['slot-0', 'slot-1']);
    expect(built.status).toBe('refused');
    if (built.status === 'refused') {
      expect(built.problems.map((problem) => problem.code)).toContain(
        'choice-alternatives-mismatch',
      );
    }
  });

  it('the unresolved list is never read: a grouping with one maps exactly as the same grouping without it', async () => {
    const grouped = await groupPastPaperText(memoryVault(), TEXT_PAPER, async (_vault, path) =>
      textExtraction(path, [TEXT_PAPER_TEXT]),
    );
    if (grouped === null) throw new Error('expected a grouping');
    expect(grouped.grouping.unresolved).toHaveLength(1);
    const { unresolved: _dropped, ...withoutUnresolved } = grouped.grouping;
    expect(pastPaperTemplateFromGrouping(grouped)).toEqual(
      pastPaperTemplateFromGrouping({ ...grouped, grouping: withoutUnresolved }),
    );
  });
});

describe('criterion 2: the extracted-text splitter and its grouping run together on the paper path', () => {
  it('a text paper is split and grouped from one extraction; the grouping places every question the splitter found', async () => {
    const grouped = await groupPastPaperText(memoryVault(), TEXT_PAPER, async (_vault, path) =>
      textExtraction(path, [TEXT_PAPER_TEXT]),
    );
    expect(grouped?.questions.map((q) => q.label)).toEqual(['1', '2', '3', '3(a)', '3(b)', '4']);
    expect(grouped?.grouping.placements.map((p) => p.label)).toEqual(
      grouped?.questions.map((q) => q.label),
    );
    // Section B is named but holds nothing: preserved in memory, in the grouping, and only there.
    expect(grouped?.grouping.unresolved?.map((u) => u.kind)).toEqual(['section-without-questions']);
  });

  it('an unsupported file, or a text the splitter will not split, gives no grouping', async () => {
    expect(await groupPastPaperText(memoryVault(), '03 Research/notes.txt')).toBeNull();
    expect(
      await groupPastPaperText(memoryVault(), TEXT_PAPER, async (_vault, path) =>
        textExtraction(path, ['Nothing numbered here.']),
      ),
    ).toBeNull();
  });
});
