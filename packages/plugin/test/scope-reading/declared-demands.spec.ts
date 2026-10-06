/**
 * The gap view's declared-demands reader over the `[D-429]` stores (`ol-egov.141.89.9.81`).
 * Scenarios: `features/F4-oracle.md`, "Declared demands from the scope reading" (olea-service).
 *
 * Every store record here is written through SCP's own persistence API (`recordExtraction`,
 * `recordPartDemand`, `recordAlignmentResults`), the same calls the drivers make, and read back
 * through the reader under test. Invented ids and wording only (INV-3).
 */

import type { ReviewLogEntry } from 'olea-contracts';
import {
  type AlignmentResult,
  createFsrsScheduler,
  extractConcepts,
  type PaperDemand,
  type Scheduler,
  type ScopePartDemand,
  type UnitManifest,
} from 'olea-core';
import { describe, expect, it } from 'vitest';
import { UNVERIFIED_REVISION_DIGEST } from '../../../core/src/ingestion/unit-manifest/projection.js';
import { gapRowLine, masteryGapLine, masteryGapNarrative } from '../../src/gap/copy.js';
import { createLocalGapProvider } from '../../src/gap/provider.js';
import { STUDY_PLAN_SETTINGS_STORAGE_KEY } from '../../src/plan/settings-store.js';
import {
  createDeclaredDemandsReader,
  currentRevisionsFromManifests,
  declaredDemandsFromProjection,
  type RegisteredPastPaper,
  registeredPastPapersFrom,
} from '../../src/scope-reading/declared-demands.js';
import {
  createScopeReadingPersistence,
  type ExtractedPaperStructure,
  type ScopeReadingPersistence,
} from '../../src/scope-reading/persistence.js';
import { type MemoryVault, memoryVault } from '../review/memory-vault.js';

const STAMP = { promptVersion: 'p1', modelId: 'm1' };
const COURSE = 'TESTC101';
const OTHER_COURSE = 'TESTC202';
const PAPER = '03 Research/TESTC101 Paper A.pdf';
const PAPER_B = '03 Research/TESTC101 Paper B.pdf';
const DIGESTS = { closedList: 'cl', coverage: 'cv', batchPlan: 'bp', frozenConfiguration: 'fc' };
const NO_GAPS = { unitsNotRead: [], pairsNotSent: [] };
const K1 = 'concept-key1:aaaa';
const K2 = 'concept-key1:bbbb';
const K3 = 'concept-key1:cccc';

let tick = 0;
const now = () => new Date(Date.UTC(2026, 9, 6) + tick++ * 1000).toISOString();

function structure(partIds: readonly string[], form = 'short answer'): ExtractedPaperStructure {
  return {
    sections: [
      { label: 'One', questionForm: form, itemCount: partIds.length, anchor: { blockIndex: 0 } },
    ],
    questionGroups: [
      {
        id: 'g1',
        kind: 'parent-question',
        label: 'Q1',
        memberLabels: partIds.map((_, i) => `1${'abcdefgh'[i]}`),
        anchor: { blockIndex: 1 },
        stimulus: { status: 'none' },
      },
    ],
    questionParts: partIds.map((id, i) => ({
      id,
      label: `1${'abcdefgh'[i]}`,
      groupId: 'g1',
      instructionAnchor: { blockIndex: 2 + i },
      questionForm: form,
    })),
  };
}

/** One past paper at one revision: its structure, part demands and alignment results, written through the store. */
async function writePaper(
  persistence: ScopeReadingPersistence,
  input: {
    readonly path?: string;
    readonly revision?: string;
    readonly parts: Readonly<Record<string, ScopePartDemand | undefined>>;
    readonly aligned?: Readonly<Record<string, AlignmentResult>>;
    readonly course?: string;
    readonly stamp?: typeof STAMP;
    readonly alignStamp?: typeof STAMP;
    readonly structureForm?: string;
  },
): Promise<string> {
  const path = input.path ?? PAPER;
  const revisionDigest = input.revision ?? 'r1';
  const stamp = input.stamp ?? STAMP;
  const partIds = Object.keys(input.parts);
  const recorded = await persistence.recordExtraction({
    sourcePath: path,
    documentKind: 'past-paper',
    revisionDigest,
    coverage: { unitsRead: 2 + partIds.length, unitsTotal: 2 + partIds.length },
    declarationCount: 0,
    paperStructure: structure(partIds, input.structureForm),
    stamp,
  });
  const structureId = recorded.structure?.structureId;
  if (structureId === undefined) throw new Error('fixture: no structure recorded');
  const ref = { sourcePath: path, documentKind: 'past-paper' as const, revisionDigest };
  for (const [partId, demand] of Object.entries(input.parts)) {
    if (demand === undefined) continue;
    await persistence.recordPartDemand({ ref, structureId, partId, demand, stamp });
  }
  const aligned = Object.entries(input.aligned ?? {});
  if (aligned.length > 0) {
    const alignStamp = input.alignStamp ?? stamp;
    await persistence.recordAlignmentResults({
      ref,
      courseId: input.course ?? COURSE,
      digests: DIGESTS,
      structureId,
      results: aligned.map(([conceptKey, result]) => ({
        conceptKey,
        result,
        coverage: NO_GAPS,
        ...(result.kind !== 'pending'
          ? { provenance: { task: 'outcomes.align.v1', ...alignStamp } }
          : {}),
      })),
    });
  }
  return structureId;
}

const decided = (demand: PaperDemand, refs: number[] = [2]): ScopePartDemand => ({
  status: 'decided',
  demand,
  commandWord: 'find',
  refs,
});
const compound = (a: PaperDemand, b: PaperDemand): ScopePartDemand => ({
  status: 'compound',
  demands: [a, b],
  refs: [2],
});
const alignedTo = (recordIds: string[], refs: number[] = [2]): AlignmentResult => ({
  kind: 'aligned',
  recordIds,
  refs,
});

function setup() {
  const vault = memoryVault();
  const persistence = createScopeReadingPersistence({ vault, deviceId: 'olea-dev1', now });
  return { vault, persistence };
}

const papersOf = (...paths: string[]): RegisteredPastPaper[] =>
  paths.map((path) => ({ path, courses: [COURSE] }));

async function read(
  persistence: ScopeReadingPersistence,
  options: {
    readonly papers?: readonly RegisteredPastPaper[];
    readonly revisions?: Readonly<Record<string, string>>;
    readonly policy?: { readonly acceptedReaderVersions: readonly string[] };
  } = {},
) {
  return declaredDemandsFromProjection(
    await persistence.load(),
    options.papers ?? papersOf(PAPER),
    new Map(Object.entries(options.revisions ?? { [PAPER]: 'r1', [PAPER_B]: 'r1' })),
    options.policy,
  );
}

describe('a decided demand reaches the concept its part is explicitly linked to', () => {
  it('a decided part gives its demand; a compound part gives both, in the five-word order', async () => {
    const { persistence } = setup();
    await writePaper(persistence, {
      parts: {
        p1: decided('calculate'),
        p2: compound('interpret-printed-result', 'recall-a-fact'),
      },
      aligned: { [K1]: alignedTo(['p1']), [K2]: alignedTo(['p2']) },
    });
    const out = await read(persistence);
    expect(out.get(K1)).toEqual(['calculate']);
    expect(out.get(K2)).toEqual(['recall-a-fact', 'interpret-printed-result']);
  });

  it('a concept linked to several parts, or to parts of several papers, carries each demand once', async () => {
    const { persistence } = setup();
    await writePaper(persistence, {
      parts: {
        p1: decided('calculate'),
        p2: decided('calculate'),
        p3: decided('compare-or-choose'),
      },
      aligned: { [K1]: alignedTo(['p1', 'p2', 'p3']) },
    });
    await writePaper(persistence, {
      path: PAPER_B,
      parts: { q1: decided('recall-a-fact'), q2: decided('calculate') },
      aligned: { [K1]: alignedTo(['q1', 'q2']) },
    });
    const out = await read(persistence, { papers: papersOf(PAPER, PAPER_B) });
    expect(out.get(K1)).toEqual(['recall-a-fact', 'calculate', 'compare-or-choose']);
    expect([...out.keys()]).toEqual([K1]);
  });
});

describe('only an explicit link counts; shared passages never do (David, 2026-10-04, option b)', () => {
  it('an aligned result citing a part instruction it does not name gives that part nothing', async () => {
    const { persistence } = setup();
    // p2's instruction is unit 3. K1's result cites units 2 and 3, but names only p1.
    await writePaper(persistence, {
      parts: { p1: decided('recall-a-fact'), p2: decided('calculate') },
      aligned: { [K1]: alignedTo(['p1'], [2, 3]) },
    });
    expect((await read(persistence)).get(K1)).toEqual(['recall-a-fact']);
  });

  it('a concept with no aligned result, or one not aligned, cannot tell or pending, has no entry, never []', async () => {
    const { persistence } = setup();
    await writePaper(persistence, {
      parts: { p1: decided('calculate') },
      aligned: {
        [K1]: { kind: 'not-aligned', reason: 'searched' },
        [K2]: { kind: 'cannot-tell', reason: 'ambiguous' },
        [K3]: { kind: 'pending', reason: 'unavailable' },
      },
    });
    const out = await read(persistence);
    expect(out.size).toBe(0);
    expect(out.has(K1)).toBe(false);
  });

  it('with no scope-reading record at all, no concept has an entry', async () => {
    const { persistence } = setup();
    expect((await read(persistence)).size).toBe(0);
  });
});

describe('an unsupported operation, a part that could not be told and a part not yet read are never a declared demand', () => {
  it('a concept linked only to such parts has no entry, never []', async () => {
    const { persistence } = setup();
    await writePaper(persistence, {
      parts: {
        p1: { status: 'unsupported', commandWord: 'sketch', refs: [2] },
        p2: { status: 'cannot-tell', reason: 'ambiguous' },
        p3: undefined, // not yet read: no record
      },
      aligned: { [K1]: alignedTo(['p1', 'p2', 'p3']) },
    });
    expect((await read(persistence)).has(K1)).toBe(false);
  });

  it('beside a decided part, they add nothing', async () => {
    const { persistence } = setup();
    await writePaper(persistence, {
      parts: {
        p1: { status: 'unsupported', commandWord: 'sketch', refs: [2] },
        p2: { status: 'cannot-tell', reason: 'ambiguous' },
        p3: undefined,
        p4: decided('apply-to-unfamiliar-case'),
      },
      aligned: { [K1]: alignedTo(['p1', 'p2', 'p3', 'p4']) },
    });
    expect((await read(persistence)).get(K1)).toEqual(['apply-to-unfamiliar-case']);
  });

  it('a stored word outside the five is never supplied', async () => {
    const { persistence } = setup();
    await writePaper(persistence, {
      parts: { p1: decided('summarise' as PaperDemand) },
      aligned: { [K1]: alignedTo(['p1']) },
    });
    expect((await read(persistence)).has(K1)).toBe(false);
  });
});

describe('only current readings count', () => {
  it('readings of an earlier revision give nothing', async () => {
    const { persistence } = setup();
    await writePaper(persistence, {
      revision: 'r0',
      parts: { p1: decided('calculate') },
      aligned: { [K1]: alignedTo(['p1']) },
    });
    expect((await read(persistence)).size).toBe(0);
    // The same records read as current once the caller says r0 is current.
    expect((await read(persistence, { revisions: { [PAPER]: 'r0' } })).get(K1)).toEqual([
      'calculate',
    ]);
  });

  it('a structure replaced since leaves the earlier alignment unverified and its demands stale', async () => {
    const { persistence } = setup();
    await writePaper(persistence, {
      parts: { p1: decided('calculate') },
      aligned: { [K1]: alignedTo(['p1']) },
    });
    // A re-read of the same revision mints a different structure; nothing re-read against it.
    await persistence.recordExtraction({
      sourcePath: PAPER,
      documentKind: 'past-paper',
      revisionDigest: 'r1',
      coverage: { unitsRead: 3, unitsTotal: 3 },
      declarationCount: 0,
      paperStructure: structure(['p1'], 'essay'),
      stamp: STAMP,
    });
    expect((await read(persistence)).size).toBe(0);
  });

  it('an aligned result naming another structure gives nothing, even when the part was re-read against the current one', async () => {
    const { persistence } = setup();
    const first = await writePaper(persistence, {
      parts: { p1: decided('calculate') },
      aligned: { [K1]: alignedTo(['p1']) },
    });
    // The paper is re-read (a new structure) and its part demand re-read against it, but the
    // alignment was not re-run: its part ids still name the first structure ([D-534] 2-ii).
    const second = await writePaper(persistence, {
      parts: { p1: decided('calculate') },
      structureForm: 'essay',
    });
    expect(second).not.toBe(first);
    expect((await read(persistence)).size).toBe(0);
  });

  it('a reading by a reader version the caller does not accept gives nothing', async () => {
    const { persistence } = setup();
    await writePaper(persistence, {
      parts: { p1: decided('calculate') },
      aligned: { [K1]: alignedTo(['p1']) },
      alignStamp: { promptVersion: 'a1', modelId: 'm1' },
    });
    expect(
      (await read(persistence, { policy: { acceptedReaderVersions: ['p1', 'a1'] } })).get(K1),
    ).toEqual(['calculate']);
    // Structure and demand by p1 refused.
    expect((await read(persistence, { policy: { acceptedReaderVersions: ['a1'] } })).size).toBe(0);
    // The alignment by a1 refused, structure and demand accepted.
    expect((await read(persistence, { policy: { acceptedReaderVersions: ['p1'] } })).size).toBe(0);
  });

  it('a paper whose current revision cannot be established gives nothing', async () => {
    const { persistence } = setup();
    await writePaper(persistence, {
      parts: { p1: decided('calculate') },
      aligned: { [K1]: alignedTo(['p1']) },
    });
    expect((await read(persistence, { revisions: {} })).size).toBe(0);
    expect(
      (await read(persistence, { revisions: { [PAPER]: UNVERIFIED_REVISION_DIGEST } })).size,
    ).toBe(0);
  });

  it("the unit manifest's unknown record names no current revision", () => {
    const manifest = (path: string, revisionDigest: string): UnitManifest => ({
      sourcePath: path,
      revisionDigest,
      entries: [],
    });
    const out = currentRevisionsFromManifests(
      new Map([
        [PAPER, manifest(PAPER, 'r1')],
        [PAPER_B, manifest(PAPER_B, UNVERIFIED_REVISION_DIGEST)],
      ]),
    );
    expect([...out]).toEqual([[PAPER, 'r1']]);
  });
});

describe('only a paper registered now as a past paper of that course counts', () => {
  const registered = (
    eventId: string,
    timestamp: string,
    path: string,
    role: string,
    course?: string,
  ): ReviewLogEntry =>
    ({
      schemaVersion: 6,
      kind: 'source-registered',
      eventId,
      timestamp,
      path,
      role,
      ...(course !== undefined ? { course } : {}),
    }) as unknown as ReviewLogEntry;

  it("the latest registration per path decides, and the course is the registration's, else its folder's", () => {
    const papers = registeredPastPapersFrom([
      registered('e1', '2026-10-01T09:00:00Z', PAPER, 'past-paper', COURSE),
      registered('e2', '2026-10-01T09:00:00Z', PAPER_B, 'past-paper', COURSE),
      // A later correction: B is no longer a past paper.
      registered('e3', '2026-10-02T09:00:00Z', PAPER_B, 'objectives', COURSE),
      registered('e4', '2026-10-01T09:00:00Z', '01 Courses/TESTC303/old.pdf', 'past-paper'),
      registered('e5', '2026-10-01T09:00:00Z', 'loose.pdf', 'past-paper'),
    ]);
    expect(papers).toEqual([
      { path: '01 Courses/TESTC303/old.pdf', courses: ['TESTC303'] },
      { path: PAPER, courses: [COURSE] },
      { path: 'loose.pdf', courses: [] },
    ]);
  });

  it('a document not registered as a past paper, or a result for another course, gives nothing', async () => {
    const { persistence } = setup();
    await writePaper(persistence, {
      parts: { p1: decided('calculate') },
      aligned: { [K1]: alignedTo(['p1']) },
    });
    await writePaper(persistence, {
      path: PAPER_B,
      parts: { q1: decided('recall-a-fact') },
      aligned: { [K2]: alignedTo(['q1']) },
      course: OTHER_COURSE,
    });
    // PAPER is not in the registered list; PAPER_B is registered to COURSE, its result is for OTHER_COURSE.
    expect((await read(persistence, { papers: papersOf(PAPER_B) })).size).toBe(0);
    expect((await read(persistence, { papers: [] })).size).toBe(0);
    expect(
      (await read(persistence, { papers: [{ path: PAPER_B, courses: [OTHER_COURSE] }] })).get(K2),
    ).toEqual(['recall-a-fact']);
  });
});

describe('createDeclaredDemandsReader', () => {
  it('asks for the current revisions of the registered papers only, once each, and reads nothing when none is registered', async () => {
    const { persistence } = setup();
    await writePaper(persistence, {
      parts: { p1: decided('calculate') },
      aligned: { [K1]: alignedTo(['p1']) },
    });
    const asked: string[][] = [];
    let loads = 0;
    const reader = (papers: RegisteredPastPaper[]) =>
      createDeclaredDemandsReader({
        loadScopeReadings: () => {
          loads += 1;
          return persistence.load();
        },
        registeredPastPapers: async () => papers,
        currentRevisions: async (paths) => {
          asked.push([...paths]);
          return new Map(paths.map((path) => [path, 'r1']));
        },
      });
    expect((await reader([...papersOf(PAPER), ...papersOf(PAPER)])()).get(K1)).toEqual([
      'calculate',
    ]);
    expect(asked).toEqual([[PAPER]]);
    expect(await reader([])()).toEqual(new Map());
    expect(loads).toBe(1);
  });
});

// ---------------------------------------------------------------------------------------------
// Through the production gap provider
// ---------------------------------------------------------------------------------------------

const DEVICE = 'olea-testdevice1';
const BASE_PATH = '02 Assignments/Assignments.base';
const BASE_FILE = [
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
const QUIZ = `---\nclass: ${COURSE}\ntype: Quiz\nweight: 10\ndue: 2026-09-01\nstatus: upcoming\n---\n\n# Quiz 1\n`;
const NOTE_PAPER = `03 Research/${COURSE} Past Paper 2023.md`;
const LOG = '.olea/reviews/2026-08-09.olea-testdevice1.jsonl';
const GAP_NOW = () => new Date('2026-08-10T09:00:00-04:00');

function gapVault(): MemoryVault {
  return memoryVault({
    '05 Zettelkasten/Widget theory.md': '# Widget theory\n',
    'Notes/one.md': [
      '---',
      'topic: [Widget theory]',
      `course: ${COURSE}`,
      '---',
      '',
      'Front::Back',
      '',
    ].join('\n'),
    [NOTE_PAPER]: [
      '---',
      'role: past-paper',
      `course: ${COURSE}`,
      '---',
      '',
      `# ${COURSE} Past Paper — 2023`,
      '',
      '## Question 1 (10 marks)',
      '',
      'Explain the core mechanism behind Widget theory and why it matters.',
      '',
    ].join('\n'),
    [BASE_PATH]: BASE_FILE,
    '02 Assignments/Quiz 1.md': QUIZ,
  });
}

function quizReview(conceptKey: string): string {
  return `${JSON.stringify({
    schemaVersion: 5,
    kind: 'review',
    eventId: 'r1',
    timestamp: '2026-08-09T09:00:00-04:00',
    instrumentId: 'mcq:widget-theory:1',
    instrumentType: 'mcq',
    conceptIds: [conceptKey],
    rating: 'good',
    supportLevelShown: 'independent',
    wasUnsure: false,
    durationMs: 1200,
    selectionContext: {
      dueState: 'due',
      examProximity: null,
      yieldRank: null,
      instrumentTypesOffered: ['mcq'],
      planVersion: null,
    },
  })}\n`;
}

/** The real schedule, with a recall that always reads 1, so the quiz answer stays current. */
function alwaysRecalled(): Scheduler {
  const real = createFsrsScheduler();
  return {
    schedule: (input) => real.schedule(input),
    retrievability: (input) => ({ instrumentId: input.instrumentId, recallProbability: 1 }),
  };
}

async function widgetWorld() {
  const vault = gapVault();
  const key = (await extractConcepts(vault, { stampConceptKeys: true })).find(
    (concept) => concept.name === 'Widget theory',
  )?.key;
  if (key === undefined) throw new Error('fixture vault has no Widget theory concept');
  await vault.write(LOG, quizReview(key));
  const persistence = createScopeReadingPersistence({ vault, deviceId: DEVICE, now });
  const settingsHost = {
    blob: {
      [STUDY_PLAN_SETTINGS_STORAGE_KEY]: { version: 1, assignmentsBasePath: BASE_PATH },
    } as unknown,
    async loadData() {
      return this.blob;
    },
    async saveData(data: unknown) {
      this.blob = data;
    },
  };
  const load = async (
    readDeclaredDemands?: () => Promise<ReadonlyMap<string, readonly PaperDemand[]>>,
  ) => {
    const state = await createLocalGapProvider({
      vault,
      deviceId: DEVICE,
      settingsHost,
      now: GAP_NOW,
      scheduler: alwaysRecalled(),
      ...(readDeclaredDemands !== undefined ? { readDeclaredDemands } : {}),
    }).load();
    if (state.kind !== 'model') throw new Error('expected a model');
    const course = state.model.courses.find((c) => c.course === COURSE);
    if (course?.status !== 'ranked') throw new Error(`expected ${COURSE} to rank`);
    const row = course.rows.find((r) => r.conceptName === 'Widget theory');
    if (row === undefined) throw new Error('expected Widget theory to be ranked');
    return row;
  };
  const reader = createDeclaredDemandsReader({
    loadScopeReadings: () => persistence.load(),
    registeredPastPapers: async () => papersOf(PAPER),
    currentRevisions: async (paths) => new Map(paths.map((path) => [path, 'r1'])),
  });
  return { vault, key, persistence, load, reader };
}

describe('through the production gap provider', () => {
  it('a linked unmet demand reaches the row, and the recognition credit is withheld (the ruled rule)', async () => {
    const world = await widgetWorld();
    const off = await world.load();
    expect(off.readiness.applied).toBe(true);
    expect(off.unmetDemands).toBeUndefined();

    // Nothing written yet: the reader reads nothing, and the row is today's row.
    const empty = await world.load(world.reader);
    expect(empty).toEqual(off);

    await writePaper(world.persistence, {
      parts: { p1: decided('calculate') },
      aligned: { [world.key]: alignedTo(['p1']) },
    });
    const on = await world.load(world.reader);
    expect(on.unmetDemands).toEqual(['calculate']);
    expect(on.readiness.applied).toBe(false);
    expect(on.gapScore).toBeGreaterThan(off.gapScore);
    // No sentence added: the lines are the ones any row without the credit reads.
    const lines = (row: typeof on) =>
      JSON.stringify([gapRowLine(row), masteryGapLine(row), masteryGapNarrative(row)]);
    expect(lines(on)).toBe(lines({ ...off, readiness: on.readiness, gapScore: on.gapScore }));
  });

  it('a reader that fails reads as nothing read: the view composes and the row carries no field', async () => {
    const world = await widgetWorld();
    const off = await world.load();
    const failing = createDeclaredDemandsReader({
      loadScopeReadings: async () => {
        throw new Error('store unreadable');
      },
      registeredPastPapers: async () => papersOf(PAPER),
      currentRevisions: async () => new Map(),
    });
    const row = await world.load(failing);
    expect(row.unmetDemands).toBeUndefined();
    expect(row).toEqual(off);
  });
});
