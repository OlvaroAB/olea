import type { StudyPlanAllocationEntry } from 'olea-contracts';
import { describe, expect, it } from 'vitest';
import { allocationSharesToSeconds } from './allocation-seconds.js';

/**
 * `ol-v7r5.17` [ALLOC-2]. Fixture vocabulary is synthetic and non-vault
 * (INV-3): course ids below are placeholders, never anything from her
 * material.
 */
function entry(
  overrides: Partial<StudyPlanAllocationEntry> & { courseId: string },
): StudyPlanAllocationEntry {
  return {
    share: 0,
    minBlockSeconds: 180,
    contributions: [{ name: 'risk', value: 0.5 }],
    reason: `${overrides.courseId} gets its share.`,
    ...overrides,
  };
}

function withExamProximity(base: StudyPlanAllocationEntry, days: number): StudyPlanAllocationEntry {
  return {
    ...base,
    contributions: [...base.contributions, { name: 'examProximityDays', value: days }],
  };
}

function sumSeconds(result: ReturnType<typeof allocationSharesToSeconds>): number {
  return [...result.secondsByCourseId.values()].reduce((a, b) => a + b, 0);
}

describe('allocationSharesToSeconds — basic conversion', () => {
  it('multiplies each share by the session budget when every course clears its own floor', () => {
    const allocation = [
      entry({ courseId: 'course-a', share: 0.6 }),
      entry({ courseId: 'course-b', share: 0.4 }),
    ];
    const result = allocationSharesToSeconds(allocation, 1000);
    expect(result.secondsByCourseId.get('course-a')).toBe(600);
    expect(result.secondsByCourseId.get('course-b')).toBe(400);
    expect(result.droppedCourseIds).toEqual([]);
    expect(sumSeconds(result)).toBe(1000);
  });

  it('drops a course below its own minBlockSeconds and redistributes its time to the rest, in proportion', () => {
    const allocation = [
      entry({ courseId: 'course-a', share: 0.9, minBlockSeconds: 180 }),
      // 0.1 * 1000 = 100s, below its own 180s floor.
      entry({ courseId: 'course-b', share: 0.1, minBlockSeconds: 180 }),
    ];
    const result = allocationSharesToSeconds(allocation, 1000);
    expect(result.droppedCourseIds).toEqual(['course-b']);
    expect(result.secondsByCourseId.get('course-b')).toBe(0);
    expect(result.secondsByCourseId.get('course-a')).toBe(1000);
    expect(sumSeconds(result)).toBe(1000);
  });

  it('redistributes proportionally across more than one surviving course', () => {
    const allocation = [
      entry({ courseId: 'course-a', share: 0.6, minBlockSeconds: 60 }),
      entry({ courseId: 'course-b', share: 0.3, minBlockSeconds: 60 }),
      // 0.1 * 900 = 90s clears 60s here, so nobody is dropped in this case —
      // a separate assertion below forces an actual drop with three courses.
      entry({ courseId: 'course-c', share: 0.1, minBlockSeconds: 60 }),
    ];
    const result = allocationSharesToSeconds(allocation, 900);
    expect(result.droppedCourseIds).toEqual([]);
    expect(sumSeconds(result)).toBe(900);

    const withADropped = [
      entry({ courseId: 'course-a', share: 0.6, minBlockSeconds: 60 }),
      entry({ courseId: 'course-b', share: 0.35, minBlockSeconds: 60 }),
      // 0.05 * 900 = 45s, below its 60s floor — dropped, redistributed 60/40
      // between course-a and course-b (their relative shares).
      entry({ courseId: 'course-c', share: 0.05, minBlockSeconds: 60 }),
    ];
    const dropped = allocationSharesToSeconds(withADropped, 900);
    expect(dropped.droppedCourseIds).toEqual(['course-c']);
    expect(sumSeconds(dropped)).toBe(900);
    // course-a:course-b redistributed in proportion to 0.6:0.35 exactly.
    const a = dropped.secondsByCourseId.get('course-a') ?? 0;
    const b = dropped.secondsByCourseId.get('course-b') ?? 0;
    expect(a / (a + b)).toBeCloseTo(0.6 / 0.95, 2);
  });

  it("the 'everyone dropped' corner keeps every course rather than zeroing the session", () => {
    const allocation = [
      entry({ courseId: 'course-a', share: 0.5, minBlockSeconds: 180 }),
      entry({ courseId: 'course-b', share: 0.5, minBlockSeconds: 180 }),
    ];
    // 60s budget: 0.5 * 60 = 30s each, both below the 180s floor.
    const result = allocationSharesToSeconds(allocation, 60);
    expect(result.droppedCourseIds).toEqual([]);
    expect(sumSeconds(result)).toBe(60);
    expect(result.secondsByCourseId.get('course-a')).toBe(30);
    expect(result.secondsByCourseId.get('course-b')).toBe(30);
  });

  it('an empty allocation or a non-positive budget produces zero seconds for every course, never a throw', () => {
    expect(allocationSharesToSeconds([], 900).secondsByCourseId.size).toBe(0);
    const allocation = [entry({ courseId: 'course-a', share: 1 })];
    expect(allocationSharesToSeconds(allocation, 0).secondsByCourseId.get('course-a')).toBe(0);
    expect(allocationSharesToSeconds(allocation, -5).secondsByCourseId.get('course-a')).toBe(0);
  });
});

describe('allocationSharesToSeconds — largest remainder and tie-break', () => {
  it('assigns whole seconds by largest remainder', () => {
    // Three equal shares over 100s: 33.33 each, floors sum to 99, one extra
    // second goes to the largest remainder — a three-way tie here, so it
    // falls to the courseId tie-break (ascending).
    const allocation = [
      entry({ courseId: 'course-a', share: 1 / 3 }),
      entry({ courseId: 'course-b', share: 1 / 3 }),
      entry({ courseId: 'course-c', share: 1 / 3 }),
    ];
    const result = allocationSharesToSeconds(allocation, 100);
    expect(sumSeconds(result)).toBe(100);
    expect(result.secondsByCourseId.get('course-a')).toBe(34);
    expect(result.secondsByCourseId.get('course-b')).toBe(33);
    expect(result.secondsByCourseId.get('course-c')).toBe(33);
  });

  it('breaks a remainder tie by the nearer next assessment first', () => {
    const allocation = [
      withExamProximity(entry({ courseId: 'course-far', share: 1 / 3 }), 20),
      withExamProximity(entry({ courseId: 'course-near', share: 1 / 3 }), 3),
      entry({ courseId: 'course-unknown', share: 1 / 3 }), // no examProximityDays at all
    ];
    const result = allocationSharesToSeconds(allocation, 100);
    expect(sumSeconds(result)).toBe(100);
    // course-near (3 days) beats course-far (20 days) beats course-unknown
    // (no known assessment — sorts last, never treated as nearest).
    expect(result.secondsByCourseId.get('course-near')).toBe(34);
    expect(result.secondsByCourseId.get('course-far')).toBe(33);
    expect(result.secondsByCourseId.get('course-unknown')).toBe(33);
  });

  it('falls back to course id, ascending, once examProximityDays also ties', () => {
    const allocation = [
      withExamProximity(entry({ courseId: 'course-z', share: 1 / 3 }), 9),
      withExamProximity(entry({ courseId: 'course-a', share: 1 / 3 }), 9),
      entry({ courseId: 'course-m', share: 1 / 3 }),
    ];
    const result = allocationSharesToSeconds(allocation, 100);
    // course-a and course-z tie on examProximityDays (9); course-a wins the
    // extra second by courseId ordering.
    expect(result.secondsByCourseId.get('course-a')).toBe(34);
    expect(result.secondsByCourseId.get('course-z')).toBe(33);
    expect(result.secondsByCourseId.get('course-m')).toBe(33);
  });
});

/**
 * Property tests (`ol-v7r5.17`'s own requirement): a small, seeded PRNG
 * (mulberry32) rather than `Math.random`, so a failure is reproducible from
 * the printed seed and CI runs are not a source of flakiness of their own.
 */
function mulberry32(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function randomAllocation(rand: () => number, courseCount: number): StudyPlanAllocationEntry[] {
  const rawShares = Array.from({ length: courseCount }, () => rand());
  const total = rawShares.reduce((a, b) => a + b, 0) || 1;
  return rawShares.map((raw, i) => {
    const hasProximity = rand() < 0.5;
    const base = entry({
      courseId: `course-${i.toString().padStart(2, '0')}`,
      share: raw / total,
      minBlockSeconds: 30 + Math.floor(rand() * 300),
    });
    return hasProximity ? withExamProximity(base, Math.floor(rand() * 60)) : base;
  });
}

describe('allocationSharesToSeconds — property tests', () => {
  const SEEDS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];

  it('sum invariant: allocated whole seconds always sum exactly to an integer budget, across randomised inputs', () => {
    for (const seed of SEEDS) {
      const rand = mulberry32(seed);
      for (let trial = 0; trial < 20; trial++) {
        const courseCount = 1 + Math.floor(rand() * 8);
        const allocation = randomAllocation(rand, courseCount);
        const budgetSeconds = Math.floor(rand() * 3600);
        const result = allocationSharesToSeconds(allocation, budgetSeconds);
        expect(sumSeconds(result)).toBe(budgetSeconds);
      }
    }
  });

  it('tie-break determinism: the same allocation and budget always produce the same seconds, run to run', () => {
    for (const seed of SEEDS) {
      const rand = mulberry32(seed);
      const courseCount = 1 + Math.floor(rand() * 8);
      const allocation = randomAllocation(rand, courseCount);
      const budgetSeconds = Math.floor(rand() * 3600);

      const first = allocationSharesToSeconds(allocation, budgetSeconds);
      // A structurally-equal but freshly-built array — never the same
      // object references — to prove the result depends only on content.
      const rebuilt = allocation.map((e) => ({
        ...e,
        contributions: e.contributions.map((c) => ({ ...c })),
      }));
      const second = allocationSharesToSeconds(rebuilt, budgetSeconds);

      expect([...second.secondsByCourseId.entries()].sort()).toEqual(
        [...first.secondsByCourseId.entries()].sort(),
      );
      expect(second.droppedCourseIds).toEqual(first.droppedCourseIds);
    }
  });

  it('no course ever receives a negative number of seconds', () => {
    for (const seed of SEEDS) {
      const rand = mulberry32(seed);
      for (let trial = 0; trial < 10; trial++) {
        const courseCount = 1 + Math.floor(rand() * 8);
        const allocation = randomAllocation(rand, courseCount);
        const budgetSeconds = Math.floor(rand() * 3600);
        const result = allocationSharesToSeconds(allocation, budgetSeconds);
        for (const seconds of result.secondsByCourseId.values()) {
          expect(seconds).toBeGreaterThanOrEqual(0);
        }
      }
    }
  });
});
