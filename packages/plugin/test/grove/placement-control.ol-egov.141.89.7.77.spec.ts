/**
 * Her correction control for links Olea's reading makes under a course's objectives (`[D-537]`,
 * `ol-egov.141.89.7.77`), tested through the control: the grove provider hands the view a control
 * whose handler appends her choice to the history in Olea's own folder, and the next grove read
 * shows the change. Scenarios: olea-service `features/F8-concepts-scope.md`, the `[D-537]` feature,
 * tagged `@auto:plugin/grove/placement-control.ol-egov.141.89.7.77.spec`.
 *
 * The read's inputs (outcomes, documents at their current revisions, alignment results and the
 * basis switches) reach the provider through `modelDecidedSources`, which nothing in `main.ts`
 * supplies yet: the wire bead that turns the objectives basis on supplies them with its switch.
 * Here a synthetic gate turns the objectives switch on by the one route to "on".
 *
 * INV-3: every course code, concept name, path and sentence below is invented.
 */

import {
  alignmentResultKey,
  type BasisGateRecord,
  type BasisSwitches,
  type CalendarDay,
  containmentCorrectionPath,
  type GroveCourseModel,
  HELD_OUT_CELL_MINIMUMS,
  type HeldOutExposureEvent,
  OUTCOME_CONTAINMENT_CORRECTION_FOLDER,
  OUTCOME_RECORD_SCHEMA_VERSION,
  type OutcomeRecord,
  objectivesDeclarationOf,
  PER_BASIS_GATE_PREREGISTRATION,
  projectScopeReadings,
  readContainmentCorrection,
  readModelDecidedContainment,
  resolveBasisSwitches,
  type ScopeReadingLogEntry,
  type ScopeRevisionRef,
  UnreadableStoreRecordError,
  type VaultPath,
} from 'olea-core';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createLocalGroveProvider,
  type GroveModelDecidedSources,
} from '../../src/grove/provider.js';
import type { GroveViewState } from '../../src/grove/view.js';
import type { ObsidianDataHost } from '../../src/plan/settings-store.js';
import { discoverOleaLayerPaths } from '../../src/privacy/log-discovery.js';
import { ObsidianRegistryOverridesStore } from '../../src/registry/overrides-store.js';
import { type MemoryVault, memoryVault } from '../review/memory-vault.js';

vi.mock('olea-core', async (importOriginal) => {
  const actual = await importOriginal<typeof import('olea-core')>();
  return { ...actual, readModelDecidedContainment: vi.fn(actual.readModelDecidedContainment) };
});

const DEVICE = 'olea-testdevice1';
const COURSE = 'TESTC101';
const NOW = new Date('2026-10-06T09:00:00Z');
const OBJECTIVES = '03 Research/Objectives.md' as VaultPath;

class FakeDataHost implements ObsidianDataHost {
  blob: unknown = null;

  async loadData(): Promise<unknown> {
    return this.blob;
  }

  async saveData(data: unknown): Promise<void> {
    this.blob = data;
  }
}

/** A declared course: the objectives name Concept A; Concepts B and C are hers and named nowhere. */
function fixtureVault(): MemoryVault {
  const note = (topic: string) =>
    ['---', `topic: [${topic}]`, `course: ${COURSE}`, '---', '', `Prose about ${topic}.`, ''].join(
      '\n',
    );
  return memoryVault({
    [OBJECTIVES]: [
      '---',
      'role: objectives',
      `course: ${COURSE}`,
      '---',
      '',
      'The course covers Concept A in depth.',
      '',
    ].join('\n'),
    'Notes/a.md': note('Concept A'),
    'Notes/b.md': note('Concept B'),
    'Notes/c.md': note('Concept C'),
  });
}

// ------------------------------------------------------------------------------------------------
// The read's inputs, synthetic
// ------------------------------------------------------------------------------------------------

const CONFIG = 'sha256:config-c';
const CURRENT = {
  closedList: 'sha256:closed-list-now',
  coverage: 'sha256:coverage-now',
  batchPlan: 'sha256:batch-plan-now',
};
const O1 = 'outcome-key1:o-gears';
const O2 = 'outcome-key1:o-belts';
const WORDING_1 = 'Describe how gear trains change speed';
const WORDING_2 = 'Compare drive belts and chains';

function objectivesRef(
  sourcePath: string = OBJECTIVES,
  revisionDigest = 'rev-1',
): ScopeRevisionRef {
  return { documentKind: 'objectives', sourcePath, revisionDigest };
}

function outcome(id: string, label: string, blockIndex: number, path: string = OBJECTIVES) {
  return {
    id,
    courses: [COURSE],
    source: { path, blockIndex },
    label,
    conceptKeys: [],
    status: 'active',
    provenance: { promptVersion: 'v1', modelVersion: 'model-a' },
    mintedAt: '2026-10-01',
    schemaVersion: OUTCOME_RECORD_SCHEMA_VERSION,
  } satisfies OutcomeRecord;
}

function switchesOn(bases: readonly ('objectives' | 'assessment-brief')[]): BasisSwitches {
  const records: BasisGateRecord[] = bases.map((basis) => ({
    basis,
    preRegistration: PER_BASIS_GATE_PREREGISTRATION,
    look: { heldOutSetHash: `set-${basis}`, configurationDigest: CONFIG },
    cells: {
      decidedNotAttested: HELD_OUT_CELL_MINIMUMS.decidedNotAttested,
      decidedNotAttestedCourses: HELD_OUT_CELL_MINIMUMS.courses,
      attested: HELD_OUT_CELL_MINIMUMS.attested,
      attestedCourses: HELD_OUT_CELL_MINIMUMS.courses,
    },
    verdict: { kind: 'switch-on' },
    evidence: { report: 'synthetic-report.md', recordedBy: 'ol-synthetic' },
  }));
  const events: HeldOutExposureEvent[] = records.flatMap((record): HeldOutExposureEvent[] => [
    {
      kind: 'registered',
      heldOutSetHash: record.look.heldOutSetHash,
      frozenConfigurationDigest: record.look.configurationDigest,
    },
    { kind: 'looked', ...record.look },
  ]);
  return resolveBasisSwitches({ records, exposure: { events } });
}

let clock = 0;

/** One aligned, current result per (document, concept), as the scope-reading store projects it. */
function alignments(
  results: readonly {
    readonly source: ScopeRevisionRef;
    readonly conceptKey: string;
    readonly recordIds: readonly string[];
  }[],
) {
  const alignmentResult: ScopeReadingLogEntry[] = results.map((result) => {
    clock += 1;
    return {
      schemaVersion: 1,
      eventId: `sr1-test-${clock}`,
      clock,
      recordedAt: NOW.toISOString(),
      kind: 'alignment-result',
      key: alignmentResultKey(COURSE, result.source, result.conceptKey),
      deviceId: 'device-1',
      payload: {
        source: result.source,
        courseId: COURSE,
        conceptKey: result.conceptKey,
        result: { kind: 'aligned', recordIds: result.recordIds, refs: [1] },
        digests: { ...CURRENT, frozenConfiguration: CONFIG },
        coverage: { unitsNotRead: [], pairsNotSent: [] },
        provenance: { task: 'outcomes.align.v1', promptVersion: '1.0.0', modelId: 'model-synth' },
      },
    };
  });
  return projectScopeReadings({ documentState: [], paperStructure: [], alignmentResult });
}

type Declared = Extract<GroveCourseModel, { readonly status: 'declared' }>;

function declared(state: GroveViewState): Declared {
  if (state.kind !== 'model') throw new Error('expected a model');
  const section = state.courses.find((s) => s.course === COURSE);
  if (section?.model.status !== 'declared') throw new Error('expected a declared course');
  return section.model;
}

function control(state: GroveViewState) {
  if (state.kind !== 'model' || state.placementControl === undefined) {
    throw new Error('expected the grove to hand the view her control');
  }
  return state.placementControl;
}

describe('[D-537] — her control, through the grove provider', () => {
  let vault: MemoryVault;
  let host: FakeDataHost;
  let sources: GroveModelDecidedSources | undefined;
  let keyOf: (name: string) => string;

  function provider(withSources = true) {
    return createLocalGroveProvider({
      vault,
      deviceId: DEVICE,
      settingsHost: host,
      now: () => NOW,
      ...(withSources
        ? {
            modelDecidedSources: async (course: string) =>
              course === COURSE ? sources : undefined,
          }
        : {}),
    });
  }

  /** Concept B placed under O1 (and, when `both`, Concept C under O1 and O2). */
  function placeB(extra: Partial<GroveModelDecidedSources> = {}, both = false): void {
    const ref = objectivesRef();
    sources = {
      outcomes: [outcome(O1, WORDING_1, 0), outcome(O2, WORDING_2, 1)],
      documents: [{ source: ref, currentDigests: CURRENT }],
      alignments: alignments([
        { source: ref, conceptKey: keyOf('Concept B'), recordIds: [O1] },
        ...(both ? [{ source: ref, conceptKey: keyOf('Concept C'), recordIds: [O1, O2] }] : []),
      ]),
      switches: switchesOn(['objectives']),
      ...extra,
    };
  }

  beforeEach(async () => {
    vi.mocked(readModelDecidedContainment).mockClear();
    vault = fixtureVault();
    host = new FakeDataHost();
    sources = undefined;
    const today = declared(await provider().load());
    const keys = new Map(today.volunteers.map((v) => [v.conceptName, v.conceptKey]));
    keyOf = (name) => {
      const key = keys.get(name);
      if (key === undefined) throw new Error(`no volunteer named ${name}`);
      return key;
    };
  });

  it('as this release wires it: the read is made with her control stated for objectives only, no basis is on, and the grove is today’s', async () => {
    vi.mocked(readModelDecidedContainment).mockClear();
    const state = await provider(false).load();
    const model = declared(state);
    expect(model.modelDecided).toBeUndefined();
    expect(model.volunteers.map((v) => v.conceptName)).toEqual(['Concept B', 'Concept C']);
    const calls = vi.mocked(readModelDecidedContainment).mock.calls;
    expect(calls.length).toBeGreaterThan(0);
    for (const [, input] of calls) {
      expect(input.correctionControlAvailable).toEqual({
        objectives: true,
        'assessment-brief': false,
      });
    }
    const results = await Promise.all(
      vi.mocked(readModelDecidedContainment).mock.results.map((r) => r.value),
    );
    for (const result of results) {
      expect(result).toEqual({ status: 'disabled', reason: 'no-containment-basis-on' });
    }
  });

  it('with the objectives switch on, a placed concept is listed apart with its objective, and the view gets her control', async () => {
    placeB();
    const state = await provider().load();
    const model = declared(state);
    expect(model.modelDecided?.count).toBe(1);
    expect(model.modelDecided?.concepts).toEqual([
      {
        conceptKey: keyOf('Concept B'),
        conceptName: 'Concept B',
        outcomeIds: [O1],
        placements: [
          {
            outcomeId: O1,
            conceptKey: keyOf('Concept B'),
            wording: WORDING_1,
            documentPath: OBJECTIVES,
            declaration: await objectivesDeclarationOf(outcome(O1, WORDING_1, 0), COURSE),
          },
        ],
      },
    ]);
    expect(model.volunteers.map((v) => v.conceptName)).toEqual(['Concept C']);
    expect(model.summary.denominatorCount).toBe(1);
    expect(state.kind === 'model' ? typeof state.placementControl?.takeOut : '').toBe('function');
  });

  it('taking it out appends a declined entry in Olea’s own folder, writes nothing else, and the concept is a volunteer again', async () => {
    placeB();
    const first = await provider().load();
    const placement = declared(first).modelDecided?.concepts[0]?.placements[0];
    if (placement === undefined) throw new Error('expected a placement');
    const before = vault.writes.length;
    await control(first).takeOut(placement);
    const written = vault.writes.slice(before);
    expect(written).toHaveLength(1);
    expect(written[0]?.startsWith(`${OUTCOME_CONTAINMENT_CORRECTION_FOLDER}/`)).toBe(true);
    const history = await readContainmentCorrection(
      vault,
      placement.declaration,
      placement.conceptKey,
    );
    expect(history.kind === 'record' ? history.record.events : []).toEqual([
      { kind: 'declined', at: NOW.toISOString() },
    ]);

    const next = declared(await provider().load());
    expect(next.modelDecided?.count).toBe(0);
    expect(next.modelDecided?.concepts).toEqual([]);
    expect(next.modelDecided?.declined.map((d) => [d.conceptName, d.wording])).toEqual([
      ['Concept B', WORDING_1],
    ]);
    expect(next.volunteers.map((v) => v.conceptName)).toEqual(['Concept B', 'Concept C']);
  });

  it('taking one placement out leaves the concept’s other placements standing', async () => {
    placeB({}, true);
    const first = await provider().load();
    const c = declared(first).modelDecided?.concepts.find((x) => x.conceptName === 'Concept C');
    expect(c?.placements.map((p) => p.wording)).toEqual([WORDING_2, WORDING_1]);
    const underO1 = c?.placements.find((p) => p.outcomeId === O1);
    if (underO1 === undefined) throw new Error('expected the placement under O1');
    await control(first).takeOut(underO1);
    const next = declared(await provider().load());
    const after = next.modelDecided?.concepts.find((x) => x.conceptName === 'Concept C');
    expect(after?.placements.map((p) => p.wording)).toEqual([WORDING_2]);
    expect(next.modelDecided?.declined.map((d) => [d.conceptName, d.wording])).toEqual([
      ['Concept C', WORDING_1],
    ]);
    expect(next.volunteers.map((v) => v.conceptName)).not.toContain('Concept C');
  });

  it('putting it back appends an accepted entry after the declined one, and it is listed again while the switch is on', async () => {
    placeB();
    const first = await provider().load();
    const placement = declared(first).modelDecided?.concepts[0]?.placements[0];
    if (placement === undefined) throw new Error('expected a placement');
    await control(first).takeOut(placement);
    const taken = await provider().load();
    const declined = declared(taken).modelDecided?.declined[0];
    if (declined === undefined) throw new Error('expected a declined placement');
    await control(taken).putBack(declined);
    const history = await readContainmentCorrection(
      vault,
      placement.declaration,
      placement.conceptKey,
    );
    expect(history.kind === 'record' ? history.record.events.map((e) => e.kind) : []).toEqual([
      'declined',
      'accepted',
    ]);
    const back = declared(await provider().load());
    expect(back.modelDecided?.concepts.map((c) => c.conceptName)).toEqual(['Concept B']);
    expect(back.modelDecided?.declined).toEqual([]);
    // Her acceptance never makes it count on its own: with the switch off nothing is listed.
    placeB({ switches: resolveBasisSwitches() });
    expect(declared(await provider().load()).modelDecided).toBeUndefined();
  });

  async function takeOutB(): Promise<void> {
    placeB();
    const first = await provider().load();
    const placement = declared(first).modelDecided?.concepts[0]?.placements[0];
    if (placement === undefined) throw new Error('expected a placement');
    await control(first).takeOut(placement);
  }

  function declinedOf(model: Declared) {
    return model.modelDecided?.declined.map((d) => [d.conceptName, d.wording, d.documentPath]);
  }

  it('her choice holds when the reading runs again', async () => {
    await takeOutB();
    placeB();
    const rerun = declared(await provider().load());
    expect(rerun.modelDecided?.concepts).toEqual([]);
    expect(declinedOf(rerun)).toEqual([['Concept B', WORDING_1, OBJECTIVES]]);
  });

  it('her choice holds across an unrelated edit that re-mints the objective on another unit', async () => {
    await takeOutB();
    const ref = objectivesRef(OBJECTIVES, 'rev-2');
    const reminted = outcome('outcome-key1:o-gears-again', WORDING_1, 4);
    placeB({
      outcomes: [reminted, outcome(O2, WORDING_2, 1)],
      documents: [{ source: ref, currentDigests: CURRENT }],
      alignments: alignments([
        { source: ref, conceptKey: keyOf('Concept B'), recordIds: [reminted.id] },
      ]),
    });
    const edited = declared(await provider().load());
    expect(edited.modelDecided?.concepts).toEqual([]);
    expect(edited.modelDecided?.declined.map((d) => d.outcomeId)).toEqual([reminted.id]);
  });

  it('her choice holds when the objectives document is renamed or moved', async () => {
    await takeOutB();
    for (const path of ['03 Research/Course aims.md', 'Archive/2026/Objectives.md']) {
      const ref = objectivesRef(path, 'rev-1');
      placeB({
        outcomes: [outcome(O1, WORDING_1, 0, path)],
        documents: [{ source: ref, currentDigests: CURRENT }],
        alignments: alignments([{ source: ref, conceptKey: keyOf('Concept B'), recordIds: [O1] }]),
      });
      const renamed = declared(await provider().load());
      expect(renamed.modelDecided?.concepts).toEqual([]);
      expect(declinedOf(renamed)).toEqual([['Concept B', WORDING_1, path]]);
    }
  });

  it('the histories her controls write are found by the discovery her export and full delete share', async () => {
    placeB({}, true);
    const first = await provider().load();
    const listing = declared(first).modelDecided;
    const b = listing?.concepts.find((c) => c.conceptName === 'Concept B')?.placements[0];
    const c = listing?.concepts.find((x) => x.conceptName === 'Concept C')?.placements[0];
    if (b === undefined || c === undefined) throw new Error('expected two placements');
    await control(first).takeOut(b);
    await control(first).takeOut(c);
    await control(first).putBack(c);
    const found = await discoverOleaLayerPaths(vault, {
      deviceId: DEVICE,
      today: '2026-10-06' as CalendarDay,
      probeDays: 1,
    });
    const histories = found.filter((p) =>
      p.startsWith(`${OUTCOME_CONTAINMENT_CORRECTION_FOLDER}/`),
    );
    expect(histories.sort()).toEqual(
      [
        await containmentCorrectionPath(b.declaration, b.conceptKey),
        await containmentCorrectionPath(c.declaration, c.conceptKey),
      ].sort(),
    );
  });

  it('an unreadable history fails closed: the pair is listed nowhere, the control refuses, and the bytes are kept', async () => {
    placeB({}, true);
    const first = await provider().load();
    const b = declared(first).modelDecided?.concepts.find((x) => x.conceptName === 'Concept B')
      ?.placements[0];
    if (b === undefined) throw new Error('expected a placement');
    const path = await containmentCorrectionPath(b.declaration, b.conceptKey);
    await vault.write(path, '{"declaration": ');
    const next = declared(await provider().load());
    expect(next.modelDecided?.concepts.map((x) => x.conceptName)).toEqual(['Concept C']);
    expect(next.modelDecided?.declined).toEqual([]);
    expect(next.volunteers.map((v) => v.conceptName)).toEqual(['Concept B']);
    await expect(control(first).takeOut(b)).rejects.toBeInstanceOf(UnreadableStoreRecordError);
    expect(vault.contentOf(path)).toBe('{"declaration": ');
  });

  it('an assessment’s stated scope stays off, whatever its switch says', async () => {
    const q1: ScopeRevisionRef = {
      documentKind: 'stated-scope',
      sourcePath: 'scope-key:q1',
      revisionDigest: 'rev-q1',
    };
    placeB();
    const withBrief: GroveModelDecidedSources = {
      ...(sources as GroveModelDecidedSources),
      documents: [
        ...(sources as GroveModelDecidedSources).documents,
        { source: q1, currentDigests: CURRENT },
      ],
      alignments: alignments([
        { source: objectivesRef(), conceptKey: keyOf('Concept B'), recordIds: [O1] },
        { source: q1, conceptKey: keyOf('Concept C'), recordIds: ['entry-1'] },
      ]),
      switches: switchesOn(['objectives', 'assessment-brief']),
    };
    sources = withBrief;
    vi.mocked(readModelDecidedContainment).mockClear();
    const model = declared(await provider().load());
    const results = await Promise.all(
      vi.mocked(readModelDecidedContainment).mock.results.map((r) => r.value),
    );
    for (const result of results) {
      expect(result.status === 'read' ? result.standings : []).toEqual([]);
    }
    expect(model.modelDecided?.concepts.map((c) => c.conceptName)).toEqual(['Concept B']);
    expect(model.volunteers.map((v) => v.conceptName)).toEqual(['Concept C']);
    // Only the briefs switch on: nothing is read for the course.
    sources = { ...withBrief, switches: switchesOn(['assessment-brief']) };
    expect(declared(await provider().load()).modelDecided).toBeUndefined();
  });

  it('a placement under a concept she withdrew is listed nowhere', async () => {
    placeB();
    await new ObsidianRegistryOverridesStore(host).save({
      version: 1,
      renames: {},
      prunedConceptKeys: [keyOf('Concept B')],
    });
    const model = declared(await provider().load());
    expect(model.modelDecided).toEqual({ count: 0, concepts: [], declined: [] });
    expect(model.volunteers.map((v) => v.conceptName)).toEqual(['Concept C']);
  });
});
