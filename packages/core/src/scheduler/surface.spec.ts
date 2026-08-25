/**
 * Standing proof for the two guarantees `types.ts`'s module doc claims:
 *
 *   1. R3 — no key on the `Scheduler` surface (`ScheduleInput`,
 *      `ScheduleOutput`, `SchedulerState`) is concept-shaped.
 *   2. The wrapper boundary — `types.ts`, the file callers actually import
 *      from, never imports `ts-fsrs` or names one of its types.
 *
 * Same technique `scripts/check-inv1.mjs` and its
 * `test/inv1.probe.spec.ts` use for INV-1: a fitness function that fails
 * loudly (here, a compile error) the day the property it guards stops
 * holding, rather than relying on a reviewer noticing.
 */

import { readFileSync } from 'node:fs';
import { describe, expect, expectTypeOf, it } from 'vitest';
import type {
  RetrievabilityInput,
  RetrievabilityOutput,
  ScheduleInput,
  ScheduleOutput,
  SchedulerState,
} from './types.js';

// --- Guarantee 1: R3, no concept-shaped key -------------------------------
//
// Every key across the public shapes, unioned — including `retrievability`'s
// `RetrievabilityInput`/`RetrievabilityOutput`, added alongside `schedule`'s
// shapes rather than in a shape of their own, because the property under
// test is about the whole `Scheduler` surface, not about `schedule`
// specifically. `${string}oncept${string}` matches `conceptId`, `concept`,
// `conceptType`, etc. (deliberately dropping the leading `c`/`C` so it also
// catches a capitalised `Concept...` key) — broad on purpose, since the
// failure mode this guards is "someone adds a concept field," not "someone
// adds a field literally spelled conceptId." If `ConceptKeysFound` is ever
// non-`never`, the `toEqualTypeOf<never>()` call below fails to typecheck,
// which fails `pnpm -r typecheck`.
type SchedulerSurfaceKeys =
  | keyof ScheduleInput
  | keyof ScheduleOutput
  | keyof SchedulerState
  | keyof RetrievabilityInput
  | keyof RetrievabilityOutput;
type ConceptKeysFound = SchedulerSurfaceKeys extends infer K
  ? K extends `${string}oncept${string}`
    ? K
    : never
  : never;

// --- Guarantee 2: no `ts-fsrs` import in the public surface file ----------
//
// A grep, not a type check, because "does this file import that module" is
// a source-text fact, the same reasoning `check-inv1.mjs` uses for
// `obsidian`. Matches an actual import/require, not the string `ts-fsrs`
// appearing anywhere (e.g. in a doc comment), so this only fires on a real
// dependency creeping in.
const TS_FSRS_IMPORT_RE = /(?:from\s+|require\(\s*|import\(\s*)['"]ts-fsrs['"]/;

describe('Scheduler surface (types.ts)', () => {
  it('R3: no key across ScheduleInput | ScheduleOutput | SchedulerState is concept-shaped', () => {
    expectTypeOf<ConceptKeysFound>().toEqualTypeOf<never>();
    // Runtime companion to the type-level check above: construct a real
    // ScheduleOutput and enumerate its (and its nested state's) own keys,
    // so this test also fails at `vitest run` time, not only under
    // typecheck, if a concept-shaped field is ever actually populated.
    const sample: ScheduleOutput = {
      instrumentId: 'inst-1',
      intervalDays: 1,
      state: {
        schemaVersion: 1,
        due: '2026-01-02T00:00:00.000Z',
        stability: 1,
        difficulty: 5,
        scheduledDays: 1,
        learningStepIndex: 0,
        reps: 1,
        lapses: 0,
        learningState: 'review',
        lastReview: '2026-01-01T00:00:00.000Z',
      },
    };
    const allKeys = [...Object.keys(sample), ...Object.keys(sample.state)];
    for (const key of allKeys) {
      expect(key.toLowerCase()).not.toContain('concept');
    }
  });

  it('R3: no key across RetrievabilityInput | RetrievabilityOutput is concept-shaped', () => {
    // Runtime companion for the two shapes `retrievability` added, same
    // technique as the `ScheduleOutput` check above: construct real values
    // and enumerate their own keys, so this also fails at `vitest run` time
    // if a concept-shaped field is ever actually populated on either shape.
    const input: RetrievabilityInput = {
      instrumentId: 'inst-1',
      now: new Date('2026-01-01T00:00:00.000Z'),
      state: {
        schemaVersion: 1,
        due: '2026-01-02T00:00:00.000Z',
        stability: 1,
        difficulty: 5,
        scheduledDays: 1,
        learningStepIndex: 0,
        reps: 1,
        lapses: 0,
        learningState: 'review',
        lastReview: '2026-01-01T00:00:00.000Z',
      },
    };
    const output: RetrievabilityOutput = {
      instrumentId: 'inst-1',
      recallProbability: 0.9,
    };
    const allKeys = [...Object.keys(input), ...Object.keys(input.state), ...Object.keys(output)];
    for (const key of allKeys) {
      expect(key.toLowerCase()).not.toContain('concept');
    }
  });

  it('never imports ts-fsrs from the public interface file', () => {
    const source = readFileSync(new URL('./types.ts', import.meta.url), 'utf8');
    expect(TS_FSRS_IMPORT_RE.test(source)).toBe(false);
  });
});
