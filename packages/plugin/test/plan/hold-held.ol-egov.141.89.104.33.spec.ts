/**
 * `ol-egov.141.89.104.33` (the reader floor; `[D-500]`, `[D-347]`, F4.3): the study plan's ranking
 * leaves out the evidence a readable hold withholds, exactly as it leaves out a changed passage not
 * yet revalidated, and with no held input the plan is exactly today's. Scenario: olea-service
 * `features/F4-oracle.md`, "evidence a readable hold withholds is left out of current readings",
 * tagged `@auto:plugin/plan/hold-held.ol-egov.141.89.104.33.spec`.
 *
 * The hold reader is a stand-in (`readHoldEvidenceWithdrawn`): no production caller exists until
 * the hold store's location is ruled (`ol-egov.141.89.104.6`). Every string here is invented
 * (INV-3).
 */
import type { ReviewLogEntry } from 'olea-contracts';
import { studyPlanEnvelope } from 'olea-contracts';
import type { RetrievabilityInput, RetrievabilityOutput, Scheduler, VaultPath } from 'olea-core';
import { createFsrsScheduler } from 'olea-core';
import { describe, expect, it, vi } from 'vitest';
import { ObsidianCitationHashStore } from '../../src/ingestion/materiality/citation-hash-store.js';
import { createLocalStudyPlanProvider } from '../../src/plan/provider.js';
import type { ObsidianDataHost } from '../../src/plan/settings-store.js';
import { STUDY_PLAN_SETTINGS_STORAGE_KEY } from '../../src/plan/settings-store.js';
import { memoryVault } from '../review/memory-vault.js';

const DEVICE = 'olea-testdevice1';
const BASE_PATH = '02 Assignments/Assignments.base';
const NOW = () => new Date('2026-08-10T09:00:00-04:00');
const CARD = 'qa:widget-theory:1';

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

class FakeDataHost implements ObsidianDataHost {
  blob: unknown = null;
  async loadData(): Promise<unknown> {
    return this.blob;
  }
  async saveData(data: unknown): Promise<void> {
    this.blob = data;
  }
}

function settingsHost(): FakeDataHost {
  const host = new FakeDataHost();
  host.blob = {
    [STUDY_PLAN_SETTINGS_STORAGE_KEY]: { version: 1, assignmentsBasePath: BASE_PATH },
  };
  return host;
}

/** One course, one concept named by a past paper, and one unaided recall success on a card yesterday. */
async function vaultWithOneReview() {
  const vault = memoryVault({
    '05 Zettelkasten/Widget theory.md': '# Widget theory\n',
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
  await vault.write(
    '.olea/reviews/2026-08-09.olea-testdevice1.jsonl',
    `${JSON.stringify({
      schemaVersion: 5,
      kind: 'review',
      eventId: 'r1',
      timestamp: '2026-08-09T09:00:00-04:00',
      instrumentId: CARD,
      instrumentType: 'qa',
      conceptIds: ['Widget theory'],
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
  return vault;
}

type Deps = Parameters<typeof createLocalStudyPlanProvider>[0];

async function plan(extra: Partial<Deps> = {}): Promise<unknown> {
  return createLocalStudyPlanProvider({
    vault: await vaultWithOneReview(),
    deviceId: DEVICE,
    settingsHost: settingsHost(),
    now: NOW,
    scheduler: fixedRetrievabilityScheduler(1),
    ...extra,
  }).fetchPlan();
}

function weightOf(raw: unknown): number {
  const parsed = studyPlanEnvelope.parse(raw);
  const course = parsed.body.courses.find((c) => c.course === 'TESTC101');
  if (course?.status !== 'ranked') throw new Error('expected TESTC101 to rank');
  const weight = course.concepts[0]?.weight;
  if (weight === undefined) throw new Error('expected a weight on the ranked concept');
  return weight;
}

const heldOf =
  (...ids: string[]): NonNullable<Deps['readHoldEvidenceWithdrawn']> =>
  async () =>
    new Set(ids);

describe('the study plan leaves out the evidence a readable hold withholds ([D-500], [D-347])', () => {
  it('with no held input, an empty one, or one naming nothing she reviewed, the plan is exactly as before', async () => {
    const without = await plan();
    expect(await plan({ readHoldEvidenceWithdrawn: heldOf() })).toEqual(without);
    expect(await plan({ readHoldEvidenceWithdrawn: heldOf('qa:never-reviewed:1') })).toEqual(
      without,
    );
  });

  it('REGRESSION (fails without the wiring): a held card gives no readiness evidence, so need reads unknown at the declared 1', async () => {
    const tracked = weightOf(await plan());
    const held = weightOf(await plan({ readHoldEvidenceWithdrawn: heldOf(CARD) }));
    // Recall 1 is need 0; with the evidence left out, need is unknown at the declared 1.
    expect(held).toBeCloseTo(tracked + 1, 10);
  });

  it('held reads exactly as a changed passage not yet revalidated', async () => {
    const store = new ObsidianCitationHashStore(new FakeDataHost());
    await store.save(CARD, {
      sourcePath: 'Notes/one.md' as VaultPath,
      text: 'Front::Back',
      conceptIds: ['Widget theory'],
    });
    await store.setPendingRevalidation(
      CARD,
      'sha-of-the-edited-passage',
      Date.parse('2026-08-09T12:00:00-04:00'),
    );
    const changed = weightOf(await plan({ citationHashStore: store }));
    const held = weightOf(await plan({ readHoldEvidenceWithdrawn: heldOf(CARD) }));
    expect(held).toBeCloseTo(changed, 12);
  });

  it('the hold reader is handed the instruments this refresh enumerated and the review log it read', async () => {
    const reader = vi.fn<NonNullable<Deps['readHoldEvidenceWithdrawn']>>(async () => new Set());
    await plan({ readHoldEvidenceWithdrawn: reader });
    expect(reader).toHaveBeenCalledTimes(1);
    const scope = reader.mock.calls[0]?.[0];
    expect(Array.isArray(scope?.records)).toBe(true);
    expect(
      scope?.entries.filter((e: ReviewLogEntry) => e.kind === 'review').map((e) => e.eventId),
    ).toEqual(['r1']);
  });

  it('a hold reader that throws fails the refresh, which keeps the cached plan, never a plan over the rest', async () => {
    await expect(
      plan({
        readHoldEvidenceWithdrawn: async () => {
          throw new Error('unreadable');
        },
      }),
    ).rejects.toThrow('unreadable');
  });
});
