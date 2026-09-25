/**
 * `createLocalStudyPlanProvider` — `sittingsSinceFloorMet`'s production
 * wiring (`[DOS-C4-a]` / `ol-feza`, follow-up to `ol-v7r5.63`'s pure
 * producer in `resolvePlanPolicyCourseInputs`, `olea-core`).
 *
 * A dedicated file rather than an addition to `provider.spec.ts` — this
 * exercises only the two new inputs (`deps.studyPlanStore` and the
 * `pastSessionsFromReviewLog` read built from the same `entries`/`concepts`
 * `provider.spec.ts` already covers for every other wiring path), never
 * re-testing `sittingsSinceFloorMet`'s own pure computation
 * (`resolve-inputs.spec.ts`, `olea-core`, already covers that).
 *
 * Every fixture string here is INVENTED per INV-3 — same course code and
 * concept name `provider.spec.ts`'s own fixture already uses.
 */

import type { StudyPlanEnvelope } from 'olea-contracts';
import { GOVERNING_FRESH_FOR_SECONDS, GOVERNING_GOVERNS_FOR_SECONDS } from 'olea-contracts';
import type { StudyPlanStore } from 'olea-core';
import { describe, expect, it } from 'vitest';
import { extractConceptsFromVault } from '../../src/concept/wiring.js';
import { createLocalStudyPlanProvider } from '../../src/plan/provider.js';
import type { ObsidianDataHost } from '../../src/plan/settings-store.js';
import { STUDY_PLAN_SETTINGS_STORAGE_KEY } from '../../src/plan/settings-store.js';
import { memoryVault } from '../review/memory-vault.js';

const DEVICE = 'olea-testdevice1';
const BASE_PATH = '02 Assignments/Assignments.base';
const NOW = () => new Date('2026-08-10T09:00:00-04:00');

class FakeDataHost implements ObsidianDataHost {
  blob: unknown = null;

  async loadData(): Promise<unknown> {
    return this.blob;
  }

  async saveData(data: unknown): Promise<void> {
    this.blob = data;
  }
}

function hostWithBasePath(basePath: string): FakeDataHost {
  const host = new FakeDataHost();
  host.blob = {
    [STUDY_PLAN_SETTINGS_STORAGE_KEY]: { version: 1, assignmentsBasePath: basePath },
  };
  return host;
}

function studyVault() {
  return memoryVault({
    '05 Zettelkasten/Widget theory.md': '# Widget theory\n',
    // F1.3's course-folder `topic:` attribution (`extract.ts`) — the ONE
    // thing `extractConceptsFromVault` needs to attribute this concept to
    // TESTC101, so `pastSessionsFromReviewLog`'s `coursesOfConcept` join has
    // something to read. Not needed by `composeOracleRanking`'s own ranking
    // (which finds the concept through the past paper's citation instead,
    // same as `provider.spec.ts`'s fixture) — only by this suite's own
    // sittings-history wiring.
    '01 Courses/TESTC101/Lecture notes.md': '---\ntopic: Widget theory\n---\n\n# Lecture notes\n',
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
}

/** The in-memory `StudyPlanStore` fake — same shape `olea-core`'s own `cache.spec.ts` uses. */
function memoryStore(initial: unknown = null): StudyPlanStore {
  let value = initial;
  return {
    async load() {
      return value;
    },
    async save(plan) {
      value = plan;
    },
  };
}

/** A previous cached plan carrying TESTC101's floor share (`0.6`) — the ONE thing this suite reads off it. */
function previousPlanWithFloorShare(floorShare: number): StudyPlanEnvelope {
  return {
    envelopeVersion: 1,
    kind: 'study-plan',
    bodyVersion: 1,
    policyVersion: 'sp1-aaaaaaaaaaaaaaaa',
    computedAt: '2026-08-09T09:00:00-04:00',
    freshForSeconds: GOVERNING_FRESH_FOR_SECONDS,
    governsForSeconds: GOVERNING_GOVERNS_FOR_SECONDS,
    body: {
      asOf: '2026-08-09',
      courses: [],
      allocation: [
        {
          courseId: 'TESTC101',
          share: 1,
          minBlockSeconds: 180,
          contributions: [{ name: 'floor', value: floorShare }],
          reason: 'the only running course receives the whole session, floored.',
        },
      ],
    },
  };
}

/**
 * `extractConceptsFromVault`'s stamped opaque key (`ol-63e1`/`[D-174]`) for
 * "Widget theory", persisted into `vault`'s own `.olea/` key-store sidecar on
 * this first call — a SECOND call against the same `vault` (as `fetchPlan`
 * makes internally) resolves to the identical key, never a fresh mint, which
 * is exactly `resolveConceptKey`'s own read-back guarantee. A synthetic
 * review log has to carry THIS key, never the bare concept name — production
 * review-log records never carry a name as `conceptIds` either.
 */
async function widgetTheoryConceptKey(vault: ReturnType<typeof studyVault>): Promise<string> {
  const concepts = await extractConceptsFromVault(vault, {});
  const key = concepts.find((concept) => concept.name === 'Widget theory')?.key;
  if (key === undefined) throw new Error('expected the vault fixture to extract "Widget theory"');
  return key;
}

/** A review-log line — same shape `provider.spec.ts`'s own fixture uses, `durationMs` overridable. */
function reviewLine(
  eventId: string,
  timestamp: string,
  durationMs: number | null,
  conceptId: string,
): string {
  return `${JSON.stringify({
    schemaVersion: 5,
    kind: 'review',
    eventId,
    timestamp,
    instrumentId: `qa:widget-theory:${eventId}`,
    instrumentType: 'qa',
    conceptIds: [conceptId],
    rating: 'good',
    wasUnsure: false,
    durationMs,
    selectionContext: {
      dueState: 'due',
      examProximity: null,
      yieldRank: null,
      instrumentTypesOffered: ['qa'],
      planVersion: null,
    },
  })}\n`;
}

describe('createLocalStudyPlanProvider — sittingsSinceFloorMet ([DOS-C4-a], ol-feza)', () => {
  it('a synthetic sittings history and the previous plan floor share reach resolvePlanPolicyCourseInputs', async () => {
    const vault = studyVault();
    const conceptId = await widgetTheoryConceptKey(vault);
    // Three sittings, oldest first, 90 minutes apart (over the 45-minute
    // clustering gap, so each is its own sitting). The oldest sitting
    // received real time (received share 1.0, meets any floor <= 1 — the
    // walk stops there); the two most recent sittings measured nothing
    // (`durationMs: null`, received share 0 — below the 0.6 floor).
    await vault.write(
      '.olea/reviews/2026-08-09.olea-testdevice1.jsonl',
      reviewLine('r1', '2026-08-09T08:00:00-04:00', 1200, conceptId) +
        reviewLine('r2', '2026-08-09T09:30:00-04:00', null, conceptId) +
        reviewLine('r3', '2026-08-09T11:00:00-04:00', null, conceptId),
    );

    let requestedCourses: readonly {
      readonly courseId: string;
      readonly sittingsSinceFloorMet?: number;
    }[] = [];
    await createLocalStudyPlanProvider({
      vault,
      deviceId: DEVICE,
      settingsHost: hostWithBasePath(BASE_PATH),
      now: NOW,
      studyPlanStore: memoryStore(previousPlanWithFloorShare(0.6)),
      readPlanPolicy: async (request) => {
        requestedCourses = request.courses;
        return undefined;
      },
    }).fetchPlan();

    const course = requestedCourses.find((c) => c.courseId === 'TESTC101');
    expect(course?.sittingsSinceFloorMet).toBe(2);
  });

  it("no review log at all keeps today's behaviour — sittingsSinceFloorMet stays absent even with a floor share on hand", async () => {
    const vault = studyVault();

    let requestedCourses: readonly {
      readonly courseId: string;
      readonly sittingsSinceFloorMet?: number;
    }[] = [];
    await createLocalStudyPlanProvider({
      vault,
      deviceId: DEVICE,
      settingsHost: hostWithBasePath(BASE_PATH),
      now: NOW,
      studyPlanStore: memoryStore(previousPlanWithFloorShare(0.6)),
      readPlanPolicy: async (request) => {
        requestedCourses = request.courses;
        return undefined;
      },
    }).fetchPlan();

    const course = requestedCourses.find((c) => c.courseId === 'TESTC101');
    expect(course?.sittingsSinceFloorMet).toBeUndefined();
  });

  it('no studyPlanStore dep at all — same absent sittingsSinceFloorMet, no throw (every existing caller keeps compiling and behaving unchanged)', async () => {
    const vault = studyVault();
    const conceptId = await widgetTheoryConceptKey(vault);
    await vault.write(
      '.olea/reviews/2026-08-09.olea-testdevice1.jsonl',
      reviewLine('r1', '2026-08-09T08:00:00-04:00', 1200, conceptId) +
        reviewLine('r2', '2026-08-09T09:30:00-04:00', null, conceptId),
    );

    let requestedCourses: readonly {
      readonly courseId: string;
      readonly sittingsSinceFloorMet?: number;
    }[] = [];
    await createLocalStudyPlanProvider({
      vault,
      deviceId: DEVICE,
      settingsHost: hostWithBasePath(BASE_PATH),
      now: NOW,
      readPlanPolicy: async (request) => {
        requestedCourses = request.courses;
        return undefined;
      },
    }).fetchPlan();

    const course = requestedCourses.find((c) => c.courseId === 'TESTC101');
    expect(course?.sittingsSinceFloorMet).toBeUndefined();
  });
});
