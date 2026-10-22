/**
 * `ol-egov.141.89.104.33` (the reader floor; `[D-500]`, `[D-347]`, F4.3): the gap view leaves out
 * the evidence a readable hold withholds from the ranking's readiness, need, the recognition credit
 * and the demand rule, exactly as it leaves out a changed passage not yet revalidated; the stage the
 * row displays keeps it, and held evidence never sets a concept aside as unavailable. With no held
 * input the view is exactly today's. Scenario: olea-service `features/F4-oracle.md`, "evidence a
 * readable hold withholds is left out of current readings", tagged
 * `@auto:plugin/gap/hold-held.ol-egov.141.89.104.33.spec`.
 *
 * The hold reader is a stand-in (`readHoldEvidenceWithdrawn`): no production caller exists until
 * the hold store's location is ruled (`ol-egov.141.89.104.6`). INV-3: every course code, concept
 * name, path and id below is invented.
 */

import type { ReviewLogEntry } from 'olea-contracts';
import {
  createFsrsScheduler,
  enumerateVaultInstruments,
  extractConcepts,
  questionBindingOf,
  type RetrievabilityInput,
  type Scheduler,
  type VaultInstrumentRecord,
  type VaultPath,
  writeInstrumentTarget,
} from 'olea-core';
import { describe, expect, it, vi } from 'vitest';
import { createLocalGapProvider } from '../../src/gap/provider.js';
import { listedGapRows } from '../../src/gap/readings-unavailable.js';
import {
  type CitationHashStore,
  ObsidianCitationHashStore,
} from '../../src/ingestion/materiality/citation-hash-store.js';
import type { ObsidianDataHost } from '../../src/plan/settings-store.js';
import { STUDY_PLAN_SETTINGS_STORAGE_KEY } from '../../src/plan/settings-store.js';
import { memoryVault } from '../review/memory-vault.js';

const DEVICE = 'olea-testdevice1';
const BASE_PATH = '02 Assignments/Assignments.base';
const NOW = () => new Date('2026-08-10T09:00:00-04:00');
const LOG = '.olea/reviews/2026-08-09.olea-testdevice1.jsonl';

class JsonDataHost implements ObsidianDataHost {
  constructor(public json = 'null') {}
  async loadData(): Promise<unknown> {
    return JSON.parse(this.json);
  }
  async saveData(data: unknown): Promise<void> {
    this.json = JSON.stringify(data);
  }
}

function settingsHost(): JsonDataHost {
  return new JsonDataHost(
    JSON.stringify({
      [STUDY_PLAN_SETTINGS_STORAGE_KEY]: { version: 1, assignmentsBasePath: BASE_PATH },
    }),
  );
}

/** FSRS for scheduling; every recall estimate fixed, so the recognition credit's answer is current. */
function fixedScheduler(recallProbability: number): Scheduler {
  const real = createFsrsScheduler();
  return {
    schedule: (input) => real.schedule(input),
    retrievability: (input: RetrievabilityInput) => ({
      instrumentId: input.instrumentId,
      recallProbability,
    }),
  };
}

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

/** One course, one concept named by a past paper, its note holding one card. */
function world() {
  return memoryVault({
    '05 Zettelkasten/Widget theory.md': '# Widget theory\n',
    'Notes/card 1.md': [
      '---',
      'topic: [Widget theory]',
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
      '# TESTC101 Past Paper — 2023',
      '',
      '## Question 1 (10 marks)',
      '',
      'Explain the core mechanism behind Widget theory and why it matters.',
      '',
    ].join('\n'),
    [BASE_PATH]: BASE_FILE,
    '02 Assignments/Quiz 1.md':
      '---\nclass: TESTC101\ntype: Quiz\nweight: 10\ndue: 2026-09-01\nstatus: upcoming\n---\n\n# Quiz 1\n',
  });
}

function reviewLine(
  conceptKey: string,
  instrumentId: string,
  instrumentType: 'mcq' | 'qa',
  eventId: string,
): string {
  return `${JSON.stringify({
    schemaVersion: 6,
    kind: 'review',
    eventId,
    timestamp: '2026-08-09T09:00:00-04:00',
    instrumentId,
    instrumentType,
    conceptIds: [conceptKey],
    rating: 'good',
    supportLevelShown: 'independent',
    wasUnsure: false,
    durationMs: 1200,
    selectionContext: {
      dueState: 'due',
      examProximity: null,
      yieldRank: null,
      instrumentTypesOffered: [instrumentType],
      planVersion: null,
    },
  })}\n`;
}

async function conceptKeyOf(vault: ReturnType<typeof world>): Promise<string> {
  const key = (await extractConcepts(vault, { stampConceptKeys: true })).find(
    (concept) => concept.name === 'Widget theory',
  )?.key;
  if (key === undefined) throw new Error('fixture vault has no Widget theory concept');
  return key;
}

const CARD = 'qa:widget-theory:1';
const QUIZ_ITEM = 'mcq:widget-theory:1';

type Deps = Parameters<typeof createLocalGapProvider>[0];

async function load(vault: ReturnType<typeof world>, extra: Partial<Deps> = {}) {
  return createLocalGapProvider({
    vault,
    deviceId: DEVICE,
    settingsHost: settingsHost(),
    now: NOW,
    scheduler: fixedScheduler(0.95),
    ...extra,
  }).load();
}

type Loaded = Awaited<ReturnType<typeof load>>;

function widgetCourse(state: Loaded) {
  if (state.kind !== 'model') throw new Error('expected a model');
  const course = state.model.courses.find((c) => c.course === 'TESTC101');
  if (course?.status !== 'ranked') throw new Error('expected TESTC101 to rank');
  return course;
}

function widgetRow(state: Loaded) {
  const row = widgetCourse(state).rows.find((r) => r.conceptName === 'Widget theory');
  if (row === undefined) throw new Error('expected the Widget theory row in the model');
  return row;
}

function listed(state: Loaded): readonly string[] {
  if (state.kind !== 'model') throw new Error('expected a model');
  return listedGapRows(widgetCourse(state).rows, state.readingsUnavailable).map(
    (row) => row.conceptName,
  );
}

/** `value` with every `arithmeticVersion` field removed, at any depth in plain objects and arrays. */
function withoutVersions(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(withoutVersions);
  if (
    value !== null &&
    typeof value === 'object' &&
    Object.getPrototypeOf(value) === Object.prototype
  ) {
    return Object.fromEntries(
      Object.entries(value)
        .filter(([key]) => key !== 'arithmeticVersion')
        .map(([key, inner]) => [key, withoutVersions(inner)]),
    );
  }
  return value;
}

const heldOf =
  (...ids: string[]): NonNullable<Deps['readHoldEvidenceWithdrawn']> =>
  async () =>
    new Set(ids);

/** The pending-revalidation store with a changed, unrevalidated passage recorded for `instrumentId`. */
async function pendingStore(instrumentId: string, conceptKey: string): Promise<CitationHashStore> {
  const store: CitationHashStore = new ObsidianCitationHashStore(new JsonDataHost());
  await store.save(instrumentId, {
    sourcePath: 'Notes/card 1.md' as VaultPath,
    text: 'Front::Back',
    conceptIds: [conceptKey],
  });
  await store.setPendingRevalidation(
    instrumentId,
    'sha-of-the-edited-passage',
    Date.parse('2026-08-09T12:00:00-04:00'),
  );
  return store;
}

describe('the gap view leaves out the evidence a readable hold withholds ([D-500], [D-347])', () => {
  it('with no held input, an empty one, or one naming nothing she reviewed, the state is exactly as before', async () => {
    const vault = world();
    const key = await conceptKeyOf(vault);
    await vault.write(
      LOG,
      reviewLine(key, CARD, 'qa', 'r1') + reviewLine(key, QUIZ_ITEM, 'mcq', 'm1'),
    );
    const without = await load(vault);
    expect(await load(vault, { readHoldEvidenceWithdrawn: heldOf() })).toEqual(without);
    expect(
      await load(vault, { readHoldEvidenceWithdrawn: heldOf('qa:nothing-reviewed-it:1') }),
    ).toEqual(without);
  });

  it('REGRESSION (fails without the wiring): a held card gives no recall evidence, so need reads unknown; the row stays listed and the stage is unchanged', async () => {
    const vault = world();
    const key = await conceptKeyOf(vault);
    await vault.write(LOG, reviewLine(key, CARD, 'qa', 'r1'));
    const before = await load(vault);
    expect(widgetRow(before).need?.basis).toBe('estimated');

    const state = await load(vault, { readHoldEvidenceWithdrawn: heldOf(CARD) });
    if (state.kind !== 'model') throw new Error('expected a model');
    expect(widgetRow(state).need?.basis).toBe('unknown');
    // Held evidence is excluded on purpose, never "could not be checked": nothing is set aside.
    expect(state.readingsUnavailable).toBeUndefined();
    expect(listed(state)).toEqual(['Widget theory']);
    // The displayed stage keeps the held evidence ([D-338]).
    expect(widgetRow(state).masteryState).toBe(widgetRow(before).masteryState);
    // The ranking's own readiness leaves it out too: need was 1 - 0.95, now the declared 1.
    expect(widgetRow(state).priorityScore).toBeGreaterThan(widgetRow(before).priorityScore);
  });

  it('held reads exactly as a changed passage not yet revalidated, for a recall card and a quiz item', async () => {
    for (const [instrumentId, type] of [
      [CARD, 'qa'],
      [QUIZ_ITEM, 'mcq'],
    ] as const) {
      const vault = world();
      const key = await conceptKeyOf(vault);
      await vault.write(
        LOG,
        reviewLine(key, CARD, 'qa', 'r1') + reviewLine(key, QUIZ_ITEM, 'mcq', 'm1'),
      );
      const changed = await load(vault, {
        citationHashStore: await pendingStore(instrumentId, key),
      });
      const held = await load(vault, { readHoldEvidenceWithdrawn: heldOf(instrumentId) });
      // A wired passage store names its split in each reading's arithmetic version; a held input
      // names nothing new (an open question on the bead), so the versions are set aside here.
      expect(withoutVersions(held), type).toEqual(withoutVersions(changed));
      expect(held, type).not.toEqual(await load(vault));
    }
  });

  it('a held quiz item earns no recognition credit', async () => {
    const vault = world();
    const key = await conceptKeyOf(vault);
    await vault.write(LOG, reviewLine(key, QUIZ_ITEM, 'mcq', 'm1'));
    const before = widgetRow(await load(vault));
    const held = widgetRow(await load(vault, { readHoldEvidenceWithdrawn: heldOf(QUIZ_ITEM) }));
    expect(held.readiness.weight).toBeGreaterThan(before.readiness.weight);
  });

  it('an instrument both held and unchecked is excluded on purpose: nothing is set aside', async () => {
    const vault = world();
    const key = await conceptKeyOf(vault);
    await vault.write(LOG, reviewLine(key, CARD, 'qa', 'r1'));
    const heldOnly = await load(vault, { readHoldEvidenceWithdrawn: heldOf(CARD) });
    const both = await load(vault, {
      readHoldEvidenceWithdrawn: heldOf(CARD),
      readHoldEvidenceUnknown: async () => new Set([CARD]),
    });
    expect(both).toEqual(heldOnly);
  });

  it('the demand rule: a review on a held instrument shows no demand met now', async () => {
    const vault = world();
    const records = (
      await enumerateVaultInstruments(vault, { concepts: { stampConceptKeys: true } })
    ).records;
    const card = records[0];
    const key = card?.conceptIds[0];
    if (card?.instrumentType !== 'qa' || key === undefined) throw new Error('fixture has no card');
    await vault.write(LOG, reviewLine(key, card.instrumentId, 'qa', 'r1'));
    await writeInstrumentTarget(vault, {
      instrumentId: card.instrumentId,
      declaredDemand: 'recall-a-fact',
      origin: 'heading-cue',
      questionBinding: await questionBindingOf(card.card),
      authoredAt: '2026-08-01T10:00:00.000Z',
      generator: { taskId: 'cards.generate.v1', promptVersion: '1.8.0' },
    });
    const readDeclaredDemands = async () => new Map([[key, ['recall-a-fact'] as const]]);
    expect(widgetRow(await load(vault, { readDeclaredDemands })).unmetDemands).toEqual([]);
    const held = await load(vault, {
      readDeclaredDemands,
      readHoldEvidenceWithdrawn: heldOf(card.instrumentId),
    });
    expect(widgetRow(held).unmetDemands).toEqual(['recall-a-fact']);
    // Held and unchecked at once: excluded on purpose, so the demand rule's answer is still given.
    const both = await load(vault, {
      readDeclaredDemands,
      readHoldEvidenceWithdrawn: heldOf(card.instrumentId),
      readHoldEvidenceUnknown: async () => new Set([card.instrumentId]),
    });
    if (both.kind !== 'model') throw new Error('expected a model');
    expect(both.readingsUnavailable).toBeUndefined();
    expect(widgetRow(both).unmetDemands).toEqual(['recall-a-fact']);
  });

  it('the hold reader is handed the instruments this load enumerated and the review log it read', async () => {
    const vault = world();
    const key = await conceptKeyOf(vault);
    await vault.write(LOG, reviewLine(key, CARD, 'qa', 'r1'));
    const reader = vi.fn<NonNullable<Deps['readHoldEvidenceWithdrawn']>>(async () => new Set());
    await load(vault, { readHoldEvidenceWithdrawn: reader });
    expect(reader).toHaveBeenCalledTimes(1);
    const scope = reader.mock.calls[0]?.[0];
    const enumerated = (
      await enumerateVaultInstruments(vault, { concepts: { stampConceptKeys: true } })
    ).records;
    expect(scope?.records.map((r: VaultInstrumentRecord) => r.instrumentId)).toEqual(
      enumerated.map((r) => r.instrumentId),
    );
    expect(
      scope?.entries.filter((e: ReviewLogEntry) => e.kind === 'review').map((e) => e.eventId),
    ).toEqual(['r1']);
  });

  it('a hold reader that throws fails the load into the existing unavailable state', async () => {
    const vault = world();
    const key = await conceptKeyOf(vault);
    await vault.write(LOG, reviewLine(key, CARD, 'qa', 'r1'));
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const state = await load(vault, {
      readHoldEvidenceWithdrawn: async () => {
        throw new Error('unreadable');
      },
    });
    error.mockRestore();
    expect(state).toEqual({ kind: 'unavailable' });
  });
});
