/**
 * `ol-egov.141.89.104.33` (the reader floor; `[D-500]`, `[D-539]`, `[D-347]`): a composed session
 * serves no instrument the hold reader keeps from presentation (held, or a hold check that could
 * not be made), never records one as a changed cited passage, and its ranking leaves out the
 * evidence a readable hold withholds. With no hold input the composition is exactly today's.
 * Scenarios: olea-service `features/F1-sources.md`, "a held instrument, or one whose hold check
 * could not be made, is not served in a composed session", and `features/F4-oracle.md`, "evidence
 * a readable hold withholds is left out of current readings", both tagged
 * `@auto:plugin/session-builder/hold-withholding.ol-egov.141.89.104.33.spec`.
 *
 * The hold reader runs for real (`readHoldText`, `resolveHoldWithholding`) over synthetic hold
 * text; only its caller is a stand-in (`readHoldWithholding`), since no production caller exists
 * until the hold store's location is ruled (`ol-egov.141.89.104.6`). Each instrument cites its own
 * note with no passage digest, the legacy shape C5.3 (as amended by `[D-539]`) lets a hold match
 * by source path. Every string here is invented (INV-3).
 */

import type { RetrievabilityInput, RetrievabilityOutput, Scheduler } from 'olea-core';
import { createFsrsScheduler, enumerateVaultInstruments } from 'olea-core';
import { describe, expect, it, vi } from 'vitest';
import {
  type HoldStoreRead,
  readHoldText,
  resolveHoldWithholding,
} from '../../src/ingestion/materiality/hold-record-reader.js';
import type { ObsidianDataHost } from '../../src/plan/settings-store.js';
import { STUDY_PLAN_SETTINGS_STORAGE_KEY } from '../../src/plan/settings-store.js';
import { DEFAULT_SESSION_BUDGET_MINUTES } from '../../src/session-builder/copy.js';
import { composeStudySessionForRequest } from '../../src/session-builder/provider.js';
import { memoryVault } from '../review/memory-vault.js';

const DEVICE = 'olea-testdevice1';
const NOW = new Date('2026-08-10T09:00:00-04:00');
const LOG = '.olea/reviews/2026-08-09.olea-testdevice1.jsonl';
const ASSIGNMENTS_BASE_PATH = '02 Assignments/Assignments.base';
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

class FakeSettingsHost implements ObsidianDataHost {
  private blob: unknown = {
    [STUDY_PLAN_SETTINGS_STORAGE_KEY]: { version: 1, assignmentsBasePath: ASSIGNMENTS_BASE_PATH },
  };
  async loadData(): Promise<unknown> {
    return this.blob;
  }
  async saveData(data: unknown): Promise<void> {
    this.blob = data;
  }
}

/** Retrievability fixed at one value; scheduling delegates to the real FSRS scheduler. */
function fixedRetrievabilityScheduler(recallProbability: number): Scheduler {
  const real = createFsrsScheduler();
  return {
    schedule: (input) => real.schedule(input),
    retrievability: (input: RetrievabilityInput): RetrievabilityOutput => ({
      instrumentId: input.instrumentId,
      recallProbability,
    }),
  };
}

function note(topic: string, card: string): string {
  return ['---', `topic: [${topic}]`, 'course: TESTC101', '---', '', card, ''].join('\n');
}

/** Two concepts in one course, both asked by one past paper: Widget theory with two cards, Gadget theory with one. */
async function world() {
  const vault = memoryVault({
    '05 Zettelkasten/Widget theory.md': '# Widget theory\n',
    '05 Zettelkasten/Gadget theory.md': '# Gadget theory\n',
    'Notes/one.md': note('Widget theory', 'Front::Back'),
    'Notes/two.md': note('Widget theory', 'Second front::Second back'),
    'Notes/three.md': note('Gadget theory', 'Third front::Third back'),
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
      '## Question 2 (10 marks)',
      '',
      'Explain the core mechanism behind Gadget theory and why it matters.',
      '',
    ].join('\n'),
    [ASSIGNMENTS_BASE_PATH]: BASE_FILE,
    '02 Assignments/Quiz 1.md':
      '---\nclass: TESTC101\ntype: Quiz\nweight: 10\ndue: 2026-09-01\nstatus: upcoming\n---\n\n# Quiz 1\n',
  });
  const records = (await enumerateVaultInstruments(vault, { concepts: { stampConceptKeys: true } }))
    .records;
  const byNote = (path: string) => {
    const record = records.find((r) => r.notePath === path);
    const conceptKey = record?.conceptIds[0];
    if (record === undefined || conceptKey === undefined) throw new Error(`no card in ${path}`);
    return { instrumentId: record.instrumentId, conceptKey };
  };
  return {
    vault,
    w1: byNote('Notes/one.md'),
    w2: byNote('Notes/two.md'),
    g: byNote('Notes/three.md'),
  };
}

/** One unaided recall success yesterday on each named instrument. */
async function reviewed(
  vault: ReturnType<typeof memoryVault>,
  ...instruments: readonly { readonly instrumentId: string; readonly conceptKey: string }[]
): Promise<void> {
  const lines = instruments.map(
    ({ instrumentId, conceptKey }, index) =>
      `${JSON.stringify({
        schemaVersion: 6,
        kind: 'review',
        eventId: `r${index + 1}`,
        timestamp: '2026-08-09T09:00:00-04:00',
        instrumentId,
        instrumentType: 'qa',
        conceptIds: [conceptKey],
        rating: 'good',
        supportLevelShown: 'independent',
        wasUnsure: false,
        durationMs: 1200,
        selectionContext: {
          dueState: 'due',
          examProximity: null,
          yieldRank: null,
          instrumentTypesOffered: ['qa'],
          planVersion: null,
        },
      })}\n`,
  );
  await vault.write(LOG, lines.join(''));
}

/** A readable hold on one note, as a newer build would publish it ([D-500]). */
const holdOn = (sourcePath: string): HoldStoreRead =>
  readHoldText(
    `${JSON.stringify({ id: 'hold-1', factId: 'fact-1', reason: 'newer-fact', passage: { sourcePath } })}\n`,
  );

type Deps = Parameters<typeof composeStudySessionForRequest>[0];

/**
 * The stand-in caller: the real reader over the store read given, each instrument citing its own
 * note (no digest), or only the notes in `citing` when given.
 */
const readerOver =
  (read: HoldStoreRead, citing?: readonly string[]): NonNullable<Deps['readHoldWithholding']> =>
  async ({ records }) =>
    resolveHoldWithholding(
      read,
      records.map((record) => ({
        instrumentId: record.instrumentId,
        cited:
          citing === undefined || citing.includes(record.notePath)
            ? [{ sourcePath: record.notePath }]
            : [],
      })),
    );

async function compose(
  vault: ReturnType<typeof memoryVault>,
  extra: Partial<Deps> = {},
  scheduler: Scheduler = createFsrsScheduler(),
) {
  const result = await composeStudySessionForRequest(
    {
      vault,
      deviceId: DEVICE,
      settingsHost: new FakeSettingsHost(),
      now: () => NOW,
      scheduler,
      ...extra,
    },
    { budgetMinutes: DEFAULT_SESSION_BUDGET_MINUTES },
    NOW,
  );
  if (result === null) throw new Error('expected an assessment source');
  return result;
}

type Composed = Awaited<ReturnType<typeof compose>>;

const served = (result: Composed): string[] =>
  result.composed.full.model.items.map((item) => item.instrumentId).sort();

const offered = (result: Composed, conceptKey: string): string[] =>
  result.composedInput.instruments
    .instrumentsFor(conceptKey)
    .map((record) => record.instrumentId)
    .sort();

describe('a composed session serves nothing the hold reader keeps from presentation ([D-500], [D-539])', () => {
  it('with no hold input, or one that holds nothing, the composition is exactly as before', async () => {
    const { vault, w1, g } = await world();
    const without = await compose(vault);
    // One instrument per concept fits today's composition: the first Widget card, and Gadget's.
    expect(served(without)).toEqual([w1.instrumentId, g.instrumentId].sort());
    for (const read of [{ status: 'absent' } as const, holdOn('Notes/elsewhere.md')]) {
      const withReader = await compose(vault, { readHoldWithholding: readerOver(read) });
      expect(withReader.composed.full.model).toEqual(without.composed.full.model);
      expect(withReader.composedInput.rows).toEqual(without.composedInput.rows);
      expect(offered(withReader, w1.conceptKey)).toEqual(offered(without, w1.conceptKey));
      expect(offered(withReader, g.conceptKey)).toEqual(offered(without, g.conceptKey));
      expect(withReader.composed.full.citationRevalidationPending).toEqual(
        without.composed.full.citationRevalidationPending,
      );
    }
  });

  it("REGRESSION (fails without the wiring): an instrument a readable hold holds is not served; its concept's other instrument is", async () => {
    const { vault, w1, w2, g } = await world();
    const result = await compose(vault, {
      readHoldWithholding: readerOver(holdOn('Notes/one.md')),
    });
    expect(served(result)).toEqual([w2.instrumentId, g.instrumentId].sort());
    expect(offered(result, w1.conceptKey)).toEqual([w2.instrumentId]);
    // The session's frozen scope never names it either, as for a suspended instrument.
    const frozen = result.frozenScope.concepts.find((c) => c.conceptKey === w1.conceptKey);
    expect(frozen?.instrumentIds).toEqual([w2.instrumentId]);
  });

  it('REGRESSION (fails without the wiring): an instrument whose hold check could not be made is not served; one citing no passage is', async () => {
    const { vault, w1, w2, g } = await world();
    const result = await compose(vault, {
      readHoldWithholding: readerOver({ status: 'unavailable' }, ['Notes/three.md']),
    });
    expect(served(result)).toEqual([w1.instrumentId]);
    expect(offered(result, g.conceptKey)).toEqual([]);
    // The Widget cards cite no passage, so no hold check reaches them: both stay servable.
    expect(offered(result, w1.conceptKey)).toEqual([w1.instrumentId, w2.instrumentId].sort());
  });

  it('neither is recorded as a changed cited passage', async () => {
    const { vault, w1, g } = await world();
    for (const reader of [
      readerOver(holdOn('Notes/one.md')),
      readerOver({ status: 'unavailable' }, ['Notes/three.md']),
    ]) {
      const result = await compose(vault, { readHoldWithholding: reader });
      expect(result.composed.full.citationRevalidationPending.size).toBe(0);
      const setAside = (result.composed.full.setAside?.instruments ?? []).map(
        (i) => i.instrumentId,
      );
      expect(setAside).not.toContain(w1.instrumentId);
      expect(setAside).not.toContain(g.instrumentId);
    }
  });

  it('the hold reader is handed the instruments this composition enumerated and the review log it read', async () => {
    const { vault, w1, w2, g } = await world();
    await reviewed(vault, w1);
    const reader = vi.fn<NonNullable<Deps['readHoldWithholding']>>(
      readerOver({ status: 'absent' }),
    );
    await compose(vault, { readHoldWithholding: reader });
    expect(reader).toHaveBeenCalledTimes(1);
    const scope = reader.mock.calls[0]?.[0];
    expect(scope?.records.map((r) => r.instrumentId).sort()).toEqual(
      [w1.instrumentId, w2.instrumentId, g.instrumentId].sort(),
    );
    expect(scope?.entries.filter((e) => e.kind === 'review').map((e) => e.eventId)).toEqual(['r1']);
  });
});

describe("the session's ranking leaves out the evidence a readable hold withholds ([D-500], [D-347])", () => {
  const rowFor = (result: Composed, conceptKey: string) => {
    const row = result.composedInput.rows.find((r) => r.conceptKey === conceptKey);
    if (row === undefined) throw new Error('expected a session row');
    return row;
  };

  it('REGRESSION (fails without the wiring): a held card gives no readiness evidence, so need reads unknown; the stage is unchanged', async () => {
    const { vault, w1 } = await world();
    await reviewed(vault, w1);
    const scheduler = fixedRetrievabilityScheduler(1);
    const tracked = rowFor(await compose(vault, {}, scheduler), w1.conceptKey);
    const held = rowFor(
      await compose(vault, { readHoldWithholding: readerOver(holdOn('Notes/one.md')) }, scheduler),
      w1.conceptKey,
    );
    // Recall 1 is need 0; with the evidence left out, need is unknown at the declared 1, added at
    // the declared need weight 1, exactly as for a changed passage not yet revalidated.
    expect(held.priorityScore).toBeCloseTo(tracked.priorityScore + 1, 10);
    expect(held.masteryState).toBe(tracked.masteryState);
  });

  it('PIN (not ruled): evidence whose hold check could not be made is not read by the ranking, so its row is unchanged', async () => {
    // How the ranking orders a concept whose readiness could not be made is an open question
    // (ol-egov.141.89.104.33's report). Pinned so that a change here is a visible, ruled one.
    const { vault, g } = await world();
    await reviewed(vault, g);
    const scheduler = fixedRetrievabilityScheduler(1);
    const before = rowFor(await compose(vault, {}, scheduler), g.conceptKey);
    const unknown = rowFor(
      await compose(
        vault,
        { readHoldWithholding: readerOver({ status: 'unavailable' }, ['Notes/three.md']) },
        scheduler,
      ),
      g.conceptKey,
    );
    expect(unknown.priorityScore).toBeCloseTo(before.priorityScore, 12);
  });
});
