/**
 * The replay before the wire (`ol-egov.141.89.9.81`): over the synthetic fixtures the gap view
 * composes over, load the production gap view with the declared-demands reader and without it,
 * and count the rows whose position moves. Scenario: `features/F4-oracle.md`, "the replay before
 * the wire counts the rows whose position moves" (olea-service).
 *
 * **What it measures, and what it cannot.** Impact, not correctness (David, 2026-10-04). The
 * reader is composed exactly as `main.ts` composes it (`declaredDemandsReaderForVault`: SCP's
 * store over the vault, her registrations from the review log, the real unit manifest store for
 * each paper's current revision), and each fixture is read with whatever scope-reading records it
 * holds. None holds any: the only writers of part demands and alignment results are the drivers,
 * which ship switched off (`[D-534]` 1b, `../../src/scope-reading/drivers.ts`), and nothing is
 * installed in her vault. So this is the wire's impact today. What rows would move once the
 * drivers are turned on depends on the demand and alignment answers they would get, which only a
 * model call (spend) produces; the mechanism itself (a linked unmet demand withholds the
 * recognition credit and raises the row's score) is pinned in `./declared-demands.spec.ts`.
 *
 * Invented wording only in the memory fixture (INV-3); the tracked fixture vault is copied first
 * and never touched.
 */

import { cp, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  createFsrsScheduler,
  extractConcepts,
  FolderSource,
  type GapViewModel,
  type Scheduler,
  type VaultSource,
} from 'olea-core';
import { afterAll, describe, expect, it } from 'vitest';
import { createLocalGapProvider } from '../../src/gap/provider.js';
import { createVaultUnitManifestStore } from '../../src/grove/unit-manifest-store.js';
import { STUDY_PLAN_SETTINGS_STORAGE_KEY } from '../../src/plan/settings-store.js';
import {
  createDeclaredDemandsReader,
  declaredDemandsReaderForVault,
} from '../../src/scope-reading/declared-demands.js';
import { createScopeReadingPersistence } from '../../src/scope-reading/persistence.js';
import { memoryVault } from '../review/memory-vault.js';

const here = dirname(fileURLToPath(import.meta.url));
/** `packages/plugin/test/scope-reading` -> `packages/core/fixtures/vault`. */
const FIXTURE_VAULT = join(here, '..', '..', '..', 'core', 'fixtures', 'vault');
const DEVICE = 'olea-testdevice1';
const BASE_PATH = '02 Assignments/Assignments.base';

function settingsHost() {
  return {
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
}

function recalledAt(probability: number): Scheduler {
  const real = createFsrsScheduler();
  return {
    schedule: (input) => real.schedule(input),
    retrievability: (input) => ({
      instrumentId: input.instrumentId,
      recallProbability: probability,
    }),
  };
}

/** Per ranked course, the concept keys in row order. */
function orderOf(model: GapViewModel): ReadonlyMap<string, readonly string[]> {
  const out = new Map<string, readonly string[]>();
  for (const course of model.courses) {
    if (course.status === 'ranked')
      out.set(
        course.course,
        course.rows.map((r) => r.conceptKey),
      );
  }
  return out;
}

/** Rows whose position in their course differs between the two loads, by course and concept key. */
function movedRows(off: GapViewModel, on: GapViewModel): string[] {
  const before = orderOf(off);
  const after = orderOf(on);
  const moved: string[] = [];
  for (const [course, keys] of before) {
    const now = after.get(course) ?? [];
    keys.forEach((key, i) => {
      if (now.indexOf(key) !== i) moved.push(`${course}:${key}`);
    });
  }
  for (const [course, keys] of after) {
    if (!before.has(course)) moved.push(...keys.map((key) => `${course}:${key}`));
  }
  return moved;
}

interface ReplayFixture {
  readonly id: string;
  readonly vault: () => Promise<VaultSource>;
  readonly now: Date;
  readonly scheduler?: Scheduler;
}

async function replay(fixture: ReplayFixture) {
  const vault = await fixture.vault();
  const now = () => fixture.now;
  const manifests = createVaultUnitManifestStore({ vault, deviceId: DEVICE, now });
  await manifests.load();
  const reader = declaredDemandsReaderForVault({
    vault,
    deviceId: DEVICE,
    manifestsFor: (paths) => manifests.manifestsFor(paths),
  });
  const load = async (withReader: boolean) => {
    const state = await createLocalGapProvider({
      vault,
      deviceId: DEVICE,
      settingsHost: settingsHost(),
      now,
      ...(fixture.scheduler !== undefined ? { scheduler: fixture.scheduler } : {}),
      unitManifests: (paths) => manifests.manifestsFor(paths),
      ...(withReader ? { readDeclaredDemands: reader } : {}),
    }).load();
    if (state.kind !== 'model') throw new Error(`${fixture.id}: the gap view did not compose`);
    return state.model;
  };
  const off = await load(false);
  const on = await load(true);
  const declared = await reader();
  return { off, on, declared, moved: movedRows(off, on) };
}

const tempRoots: string[] = [];
afterAll(async () => {
  await Promise.all(tempRoots.map((root) => rm(root, { recursive: true, force: true })));
});

async function copiedFixtureVault(): Promise<VaultSource> {
  const root = await mkdtemp(join(tmpdir(), 'olea-declared-demands-replay-'));
  tempRoots.push(root);
  await cp(FIXTURE_VAULT, root, { recursive: true });
  return new FolderSource(root);
}

/** One course, one concept with a correct, current quiz answer (the credit applies), and a past paper registered to the course. */
async function widgetWorld(): Promise<VaultSource> {
  const vault = memoryVault({
    '05 Zettelkasten/Widget theory.md': '# Widget theory\n',
    '05 Zettelkasten/Gizmology.md': '# Gizmology\n',
    'Notes/one.md': [
      '---',
      'topic: [Widget theory]',
      'course: TESTC101',
      '---',
      '',
      'Front::Back',
      '',
    ].join('\n'),
    'Notes/two.md': [
      '---',
      'topic: [Gizmology]',
      'course: TESTC101',
      '---',
      '',
      'Front::Back',
      '',
    ].join('\n'),
    '03 Research/TESTC101 Past Paper 2023.md': [
      '---',
      'role: past-paper',
      'course: TESTC101',
      '---',
      '',
      '## Question 1 (10 marks)',
      '',
      'Explain the core mechanism behind Widget theory and why it matters.',
      '',
      '## Question 2 (10 marks)',
      '',
      'Apply Gizmology and Widget theory to a new case.',
      '',
    ].join('\n'),
    [BASE_PATH]: [
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
    ].join('\n'),
    '02 Assignments/Quiz 1.md':
      '---\nclass: TESTC101\ntype: Quiz\nweight: 10\ndue: 2026-09-01\nstatus: upcoming\n---\n\n# Quiz 1\n',
  });
  const key = (await extractConcepts(vault, { stampConceptKeys: true })).find(
    (concept) => concept.name === 'Widget theory',
  )?.key;
  if (key === undefined) throw new Error('widget world: no Widget theory concept');
  const line = (record: Record<string, unknown>) => `${JSON.stringify(record)}\n`;
  await vault.write(
    '.olea/reviews/2026-08-09.olea-testdevice1.jsonl',
    line({
      schemaVersion: 5,
      kind: 'review',
      eventId: 'r1',
      timestamp: '2026-08-09T09:00:00-04:00',
      instrumentId: 'mcq:widget-theory:1',
      instrumentType: 'mcq',
      conceptIds: [key],
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
    }) +
      line({
        schemaVersion: 6,
        kind: 'source-registered',
        eventId: 'reg1',
        timestamp: '2026-08-09T08:00:00-04:00',
        path: '03 Research/TESTC101 Past Paper 2023.md',
        role: 'past-paper',
        course: 'TESTC101',
      }),
  );
  return vault;
}

const FIXTURES: readonly ReplayFixture[] = [
  {
    id: 'core-fixture-vault',
    vault: copiedFixtureVault,
    now: new Date('2026-09-14T09:00:00-04:00'),
  },
  {
    id: 'gap-widget-world',
    vault: widgetWorld,
    now: new Date('2026-08-10T09:00:00-04:00'),
    scheduler: recalledAt(1),
  },
];

describe('the replay before the wire: rows whose position moves with the reader on versus off', () => {
  const counts: Record<string, number> = {};

  for (const fixture of FIXTURES) {
    it(`${fixture.id}: no row moves, and the model is unchanged`, async () => {
      const { off, on, declared, moved } = await replay(fixture);
      counts[fixture.id] = moved.length;
      // The fixture composes ranked rows, so a move would be visible.
      expect([...orderOf(off).values()].flat().length).toBeGreaterThan(0);
      // No scope-reading record exists in any fixture: the reader reads nothing at all.
      expect(declared.size).toBe(0);
      expect(moved).toEqual([]);
      expect(on).toEqual(off);
    }, 120_000);
  }

  it('the count recorded per fixture', () => {
    expect(counts).toEqual({ 'core-fixture-vault': 0, 'gap-widget-world': 0 });
  });

  it('the count is not blind: a swap of two rows counts both', () => {
    const model = (keys: string[]) =>
      ({
        courses: [
          { course: 'C', status: 'ranked', rows: keys.map((conceptKey) => ({ conceptKey })) },
        ],
      }) as unknown as GapViewModel;
    expect(movedRows(model(['a', 'b', 'c']), model(['b', 'a', 'c']))).toEqual(['C:a', 'C:b']);
    expect(movedRows(model(['a', 'b']), model(['a', 'b']))).toEqual([]);
  });
});

/**
 * A constructed projection, NOT the gate: the same fixtures with the stores written as the drivers
 * would write them if every ranked concept were linked to a part asking `calculate`, which no
 * review shows. It shows the reader does reach the view (every row carries the unmet demand, and
 * a credited row loses its credit), and how far that moves rows here. It predicts nothing about
 * her papers: which concepts a real paper links, and to which demands, only the drivers' model
 * answers say.
 */
describe('constructed projection (not the gate): every ranked concept linked to an unmet demand', () => {
  const PAPER = 'constructed/paper.pdf';
  const STAMP = { promptVersion: 'p1', modelId: 'm1' };

  async function seedEveryConcept(vault: VaultSource): Promise<readonly string[]> {
    const persistence = createScopeReadingPersistence({ vault, deviceId: DEVICE });
    const concepts = await extractConcepts(vault, { stampConceptKeys: true });
    const recorded = await persistence.recordExtraction({
      sourcePath: PAPER,
      documentKind: 'past-paper',
      revisionDigest: 'r1',
      coverage: { unitsRead: 3, unitsTotal: 3 },
      declarationCount: 0,
      stamp: STAMP,
      paperStructure: {
        sections: [
          { label: 'One', questionForm: 'short', itemCount: 1, anchor: { blockIndex: 0 } },
        ],
        questionParts: [
          {
            id: 'p1',
            label: '1',
            groupId: 'g',
            instructionAnchor: { blockIndex: 2 },
            questionForm: 'short',
          },
        ],
      },
    });
    const structureId = recorded.structure?.structureId;
    if (structureId === undefined) throw new Error('constructed: no structure');
    const ref = { sourcePath: PAPER, documentKind: 'past-paper' as const, revisionDigest: 'r1' };
    await persistence.recordPartDemand({
      ref,
      structureId,
      partId: 'p1',
      demand: { status: 'decided', demand: 'calculate', refs: [2] },
      stamp: STAMP,
    });
    const courses = [...new Set(concepts.flatMap((concept) => concept.courses))].sort();
    for (const courseId of courses) {
      await persistence.recordAlignmentResults({
        ref,
        courseId,
        digests: { closedList: 'a', coverage: 'b', batchPlan: 'c', frozenConfiguration: 'd' },
        structureId,
        results: concepts
          .filter((concept) => concept.courses.includes(courseId))
          .map((concept) => ({
            conceptKey: concept.key,
            result: { kind: 'aligned' as const, recordIds: ['p1'], refs: [2] },
            coverage: { unitsNotRead: [], pairsNotSent: [] },
            provenance: { task: 'outcomes.align.v1', ...STAMP },
          })),
      });
    }
    return courses;
  }

  for (const fixture of FIXTURES) {
    it(`${fixture.id}: every row carries the unmet demand; no row moves here`, async () => {
      const vault = await fixture.vault();
      const courses = await seedEveryConcept(vault);
      const reader = createDeclaredDemandsReader({
        loadScopeReadings: () => createScopeReadingPersistence({ vault, deviceId: DEVICE }).load(),
        registeredPastPapers: async () => [{ path: PAPER, courses }],
        currentRevisions: async () => new Map([[PAPER, 'r1']]),
      });
      const load = async (withReader: boolean) => {
        const state = await createLocalGapProvider({
          vault,
          deviceId: DEVICE,
          settingsHost: settingsHost(),
          now: () => fixture.now,
          ...(fixture.scheduler !== undefined ? { scheduler: fixture.scheduler } : {}),
          ...(withReader ? { readDeclaredDemands: reader } : {}),
        }).load();
        if (state.kind !== 'model') throw new Error(`${fixture.id}: the gap view did not compose`);
        return state.model;
      };
      const off = await load(false);
      const on = await load(true);
      const rows = (model: GapViewModel) =>
        model.courses.flatMap((course) => (course.status === 'ranked' ? course.rows : []));
      expect(rows(on).every((row) => row.unmetDemands?.join() === 'calculate')).toBe(true);
      expect(rows(on).every((row) => !row.readiness.applied)).toBe(true);
      const creditedBefore = rows(off).filter((row) => row.readiness.applied).length;
      expect(creditedBefore).toBe(fixture.id === 'gap-widget-world' ? 1 : 0);
      expect(movedRows(off, on)).toEqual([]);
    }, 120_000);
  }
});
