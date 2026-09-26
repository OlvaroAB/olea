/**
 * `createGenerationPrioritySource` tests (`[D-368]`, `[D-348]`, `ol-2zfj.173`).
 *
 * Scenario: `features/F3-learn-from-anything.md`, "Coverage-first priority
 * order among pending generation jobs" — the reading half of
 * `@auto:plugin/generation/priority-source.spec` (the comparator half is
 * `@auto:plugin/ingestion/wiring.spec`).
 *
 * Proves: a concept with no current evidence gets `[D-348]`'s named
 * unknown-basis default and, because that default is the ranking maximum,
 * outranks a concept with strong recent evidence — the concrete "higher-need
 * job ranks first" case; `refresh()` reads the review log fresh, so a
 * reading composed before a review happened differs from one composed
 * after, and the two never blend; before any `refresh()`, every job reads
 * as "no opinion" (`null`), matching the engine's own pre-`[D-368]` default;
 * and `expectedYield` is the declared, plain-English, per-kind constant,
 * never a fitted number.
 */

import type { ReviewLogRecord } from 'olea-contracts';
import type { GenerationJobPayload } from 'olea-core';
import { createFsrsScheduler, REVIEW_LOG_FOLDER } from 'olea-core';
import { describe, expect, it } from 'vitest';
import {
  createGenerationPrioritySource,
  DECLARED_EXPECTED_YIELD_BY_INSTRUMENT_KIND,
} from '../../src/generation/priority-source.js';
import type { GenerationPrioritySignal } from '../../src/ingestion/wiring.js';
import { MemoryVaultSource } from './fakes.js';

const REVIEW_LOG_PATH = `${REVIEW_LOG_FOLDER}/priority-source-spec.jsonl`;

/** Narrows a `priority()` reading for a test that has already asserted it is non-null — never a bare `!` assertion. */
function mustSignal(signal: GenerationPrioritySignal | null): GenerationPrioritySignal {
  if (signal === null) throw new Error('expected a composed priority signal, got null');
  return signal;
}

function review(overrides: Partial<ReviewLogRecord> = {}): ReviewLogRecord {
  return {
    schemaVersion: 5,
    kind: 'review',
    eventId: 'r-default',
    timestamp: '2026-01-10T09:00:00-04:00',
    instrumentId: 'qa:concept-b:1',
    instrumentType: 'qa',
    conceptIds: ['concept-b'],
    rating: 'good',
    wasUnsure: false,
    durationMs: 1200,
    supportLevelShown: 'independent',
    selectionContext: {
      dueState: 'due',
      examProximity: null,
      yieldRank: null,
      instrumentTypesOffered: ['qa'],
      planVersion: null,
    },
    ...overrides,
  };
}

function vaultWithLog(records: readonly ReviewLogRecord[]): MemoryVaultSource {
  const jsonl = records.map((record) => JSON.stringify(record)).join('\n');
  return new MemoryVaultSource({ [REVIEW_LOG_PATH]: jsonl });
}

function payloadFor(conceptKey: string, conceptName: string): GenerationJobPayload {
  return {
    kind: 'generation',
    courseCode: 'COURSE',
    conceptKey,
    conceptName,
    instrumentKind: 'mcq',
    trigger: 'arrival',
  };
}

const scheduler = createFsrsScheduler();

describe('createGenerationPrioritySource: before any refresh(), every job reads as "no opinion"', () => {
  it('returns null — the same default the engine already applies with no comparator', async () => {
    const source = createGenerationPrioritySource({ vault: vaultWithLog([]), scheduler });
    expect(source.priority(payloadFor('concept-a', 'Concept A'))).toBeNull();
  });
});

describe('[D-348]: a concept with no current evidence gets the named unknown-basis default, and it outranks a concept with strong evidence — the higher-need-ranks-first case', () => {
  it('after refresh(), the never-practised concept reads a strictly higher need than the strongly-recalled one', async () => {
    // `concept-b` was reviewed once, independently, well before `now` and
    // rated `good` — a strong, current, unaided recall reading.
    // `concept-a` has no review-log entry at all: `readNeed`'s own
    // `basis: 'unknown'` branch.
    const vault = vaultWithLog([review()]);
    const now = () => new Date('2026-01-11T09:00:00-04:00');
    const source = createGenerationPrioritySource({ vault, scheduler, now });
    await source.refresh();

    const unknown = source.priority(payloadFor('concept-a', 'Concept A'));
    const estimated = source.priority(payloadFor('concept-b', 'Concept B'));

    const unknownSignal = mustSignal(unknown);
    const estimatedSignal = mustSignal(estimated);
    // `[D-348]`, ruled: the unknown basis enters at the declared maximum (1).
    expect(unknownSignal.need).toBe(1);
    expect(estimatedSignal.need).toBeLessThan(unknownSignal.need);

    // The concrete "ranks first" case: sorting by `[D-368]`'s own rule
    // (need descending, then expected yield descending) puts the
    // never-practised concept's job ahead of the strongly-recalled one's —
    // mirroring `ingestion/wiring.ts#compareGenerationPriority` without
    // re-implementing it (that function is not exported; this is the same
    // one-line rule its own doc states).
    const jobs = [
      { label: 'estimated' as const, signal: estimatedSignal },
      { label: 'unknown' as const, signal: unknownSignal },
    ];
    jobs.sort(
      (a, b) => b.signal.need - a.signal.need || b.signal.expectedYield - a.signal.expectedYield,
    );
    expect(jobs[0]?.label).toBe('unknown');
  });
});

describe('[D-368]: read fresh at drain time — refresh() re-reads the vault, and never blends with a previous reading', () => {
  it('a reading composed before a review happened differs from one composed after, once refresh() runs again', async () => {
    const vault = vaultWithLog([]);
    const source = createGenerationPrioritySource({
      vault,
      scheduler,
      now: () => new Date('2026-01-11T09:00:00-04:00'),
    });

    await source.refresh();
    const before = source.priority(payloadFor('concept-b', 'Concept B'));
    expect(before?.need).toBe(1); // no evidence yet — unknown basis

    // She reviews concept-b, independently and successfully, and the SAME
    // vault now carries that record — no new `MemoryVaultSource`, so this
    // is genuinely the same underlying store a real drain would re-read.
    await vault.write(REVIEW_LOG_PATH, JSON.stringify(review()));
    await source.refresh();
    const after = source.priority(payloadFor('concept-b', 'Concept B'));

    expect(after?.need).toBeLessThan(mustSignal(before).need);
  });

  it('a stale earlier snapshot never survives a later refresh() — explicit invalidation, not a merge', async () => {
    const vault = vaultWithLog([review()]);
    const source = createGenerationPrioritySource({
      vault,
      scheduler,
      now: () => new Date('2026-01-11T09:00:00-04:00'),
    });
    await source.refresh();
    const withEvidence = source.priority(payloadFor('concept-b', 'Concept B'));
    expect(withEvidence?.need).toBeLessThan(1);

    // The evidence disappears from the vault entirely (a harness-only move —
    // real logs never shrink — but it proves refresh() replaces wholesale
    // rather than accumulating what earlier snapshots ever showed).
    await vault.write(REVIEW_LOG_PATH, '');
    await source.refresh();
    const afterLoss = source.priority(payloadFor('concept-b', 'Concept B'));
    expect(afterLoss?.need).toBe(1);
  });
});

describe('expectedYield: the declared, plain-English, per-instrument-kind constant, never fitted', () => {
  it('answers exactly the declared table for every schedulable instrument kind', async () => {
    const source = createGenerationPrioritySource({ vault: vaultWithLog([review()]), scheduler });
    await source.refresh();

    for (const instrumentKind of ['mcq', 'qa', 'cloze'] as const) {
      const signal = source.priority({ ...payloadFor('concept-b', 'Concept B'), instrumentKind });
      expect(signal?.expectedYield).toBe(
        DECLARED_EXPECTED_YIELD_BY_INSTRUMENT_KIND[instrumentKind],
      );
    }
  });
});
