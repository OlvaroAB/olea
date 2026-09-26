// `[D-367]` (ol-0r92.118), the ruling's binding clarification: the new optional
// review `origin` must be compatible with every existing reader of the review
// record — nothing that reads the record today may break, misinterpret it, or
// need to special-case its absence.
//
// The property checked here, over generated logs rather than a few hand-built
// cases: take a log, mark some of its reviews with `origin: 'practice-paper'`,
// and every reader returns the same reading it returned before, field for
// field, once the marked records' own `origin` key is set aside. No reader
// imports the field, so none can treat its presence or its absence as
// anything. (Whether a reading should one day weigh a handed-over review
// differently is a question for a ruling, never something a reader starts
// doing because the key appeared.)
import type { InstrumentType, Rating, ReviewLogEntry, ReviewLogRecord } from 'olea-contracts';
import { describe, expect, it } from 'vitest';
import { detectSpacing } from '../insights/spacing.js';
import { readAllConceptAttainment } from '../mastery/attainment.js';
import {
  computeAllConceptMastery,
  masteryAtTimeForConceptIds,
  readAllConceptVitality,
} from '../mastery/rollup.js';
import { projectInstrumentValidity } from '../mastery/validity.js';
import { createFsrsScheduler } from '../scheduler/fsrs-scheduler.js';
import { computeStreak, studyDays } from '../today/streak.js';
import { explainBackGradeHistoryByInstrument } from './explain-back-history.js';
import { mergeReviewLogRecords } from './merge.js';
import { parseReviewLog } from './parse.js';
import { suspendedInstrumentIds } from './suspension.js';
import { latestVerdictByInstrument } from './verdicts.js';

/** Deterministic PRNG (mulberry32) — the same stand-in `../mastery/rollup.spec.ts` uses. */
function mulberry32(seed: number): () => number {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function pick<T>(rand: () => number, values: readonly T[]): T {
  const value = values[Math.floor(rand() * values.length)];
  if (value === undefined) throw new Error('pick: empty array');
  return value;
}

const TYPES: readonly InstrumentType[] = ['qa', 'mcq', 'cloze', 'explain-back'];
const RATINGS: readonly Rating[] = ['again', 'hard', 'good', 'easy'];
const CONCEPTS = ['concept-a', 'concept-b', 'concept-c'] as const;
const PROVENANCE = { taskId: 'explain-back-grade', promptVersion: 'v0', modelId: 'model-x' };

/** A generated log of every event shape these readers look at: reviews of every kind, a suspend, a verdict. */
function generateLog(seed: number, length: number): ReviewLogEntry[] {
  const rand = mulberry32(seed);
  const entries: ReviewLogEntry[] = [];
  for (let i = 0; i < length; i += 1) {
    const instrumentType = pick(rand, TYPES);
    const conceptId = pick(rand, CONCEPTS);
    const isExplainBack = instrumentType === 'explain-back';
    const day = String(1 + Math.floor(rand() * 25)).padStart(2, '0');
    const record: ReviewLogRecord = {
      schemaVersion: 5,
      kind: 'review',
      eventId: `gen-${seed}-${i}`,
      timestamp: `2026-01-${day}T09:${String(i % 60).padStart(2, '0')}:00-04:00`,
      instrumentId: `${instrumentType}:${conceptId}:${Math.floor(rand() * 3)}`,
      instrumentType,
      rating: isExplainBack ? null : pick(rand, RATINGS),
      wasUnsure: rand() > 0.8,
      durationMs: isExplainBack ? null : 1000 + Math.floor(rand() * 5000),
      selectionContext: {
        dueState: pick(rand, ['due', 'overdue', 'early', 'new'] as const),
        examProximity: rand() > 0.5 ? Math.floor(rand() * 30) : null,
        yieldRank: null,
        instrumentTypesOffered: [instrumentType],
        planVersion: null,
      },
      conceptIds: [conceptId],
      ...(rand() > 0.4 && !isExplainBack && instrumentType !== 'mcq'
        ? { supportLevelShown: pick(rand, ['independent', 'prompted', 'guided'] as const) }
        : {}),
      ...(isExplainBack
        ? {
            explainBackGrade: {
              soloLevel: pick(rand, ['unistructural', 'multistructural', 'relational'] as const),
              correctness: pick(rand, ['correct', 'partial', 'incorrect'] as const),
              contentRef: `content-${seed}-${i}`,
              revisionOf: null,
              artifactProvenance: PROVENANCE,
            },
          }
        : {}),
      ...(instrumentType === 'mcq'
        ? { correctness: { chosenIndex: Math.floor(rand() * 4), matchedKey: rand() > 0.4 } }
        : {}),
    };
    entries.push(record);
  }
  entries.push({
    schemaVersion: 5,
    kind: 'suspend',
    eventId: `suspend-${seed}`,
    timestamp: '2026-01-20T12:00:00-04:00',
    instrumentId: 'qa:concept-a:0',
    conceptIds: ['concept-a'],
  });
  entries.push({
    schemaVersion: 5,
    kind: 'verdict',
    eventId: `verdict-${seed}`,
    timestamp: '2026-01-21T12:00:00-04:00',
    instrumentId: 'mcq:concept-b:1',
    instrumentType: 'mcq',
    conceptIds: ['concept-b'],
    verdict: 'rejected',
    artifactProvenance: PROVENANCE,
  });
  return entries;
}

/** `entries` with roughly half their reviews marked as handed over from a practice paper. */
function markSome(entries: readonly ReviewLogEntry[], seed: number): ReviewLogEntry[] {
  const rand = mulberry32(seed * 7919);
  return entries.map((entry) =>
    entry.kind === 'review' && rand() > 0.5
      ? { ...entry, origin: 'practice-paper' as const }
      : entry,
  );
}

/** Maps and sets as plain arrays, and every `origin` key set aside, so two readings compare field for field. */
function comparable(value: unknown): unknown {
  if (value instanceof Map) return [...value].map(([k, v]) => [comparable(k), comparable(v)]);
  if (value instanceof Set) return [...value].map(comparable).sort();
  if (Array.isArray(value)) return value.map(comparable);
  if (value !== null && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [key, inner] of Object.entries(value)) {
      if (key !== 'origin') out[key] = comparable(inner);
    }
    return out;
  }
  return value;
}

function readEverything(entries: readonly ReviewLogEntry[]) {
  const conceptIds = [...CONCEPTS];
  const scheduler = createFsrsScheduler();
  const now = new Date('2026-01-28T12:00:00-04:00');
  const validity = projectInstrumentValidity(entries);
  return {
    mastery: computeAllConceptMastery(entries, conceptIds),
    stamp: masteryAtTimeForConceptIds(entries, conceptIds),
    vitality: readAllConceptVitality(entries, conceptIds, scheduler, now, 0.9),
    // The projection's own as-of reader is a closure: compared by what it
    // returns at a fixed instant, never by function identity.
    validity: {
      provenInvalid: validity.provenInvalid,
      withheld: validity.withheld,
      contested: validity.contested,
      provenInvalidAsOf: validity.provenInvalidAsOf(Date.parse('2026-01-22T00:00:00-04:00')),
      changeInstants: validity.changeInstants,
      unreadableEventCount: validity.unreadableEventCount,
    },
    attainment: readAllConceptAttainment(entries, conceptIds, validity),
    suspended: suspendedInstrumentIds(entries),
    verdicts: latestVerdictByInstrument(entries),
    explainBackHistory: explainBackGradeHistoryByInstrument(entries),
    studyDays: studyDays(entries),
    streak: computeStreak(entries, { today: '2026-01-28', windowDays: 60 }),
    spacing: detectSpacing(entries),
    mergedOrder: mergeReviewLogRecords(entries).records.map((entry) => entry.eventId),
  };
}

describe('[D-367] review origin: every existing reader reads a marked log the same as the unmarked one', () => {
  it('over generated logs, no reading changes when some reviews carry the origin', () => {
    let marked = 0;
    for (let seed = 1; seed <= 30; seed += 1) {
      const plain = generateLog(seed, 8 + (seed % 15));
      const withOrigin = markSome(plain, seed);
      marked += withOrigin.filter((e) => e.kind === 'review' && e.origin !== undefined).length;
      const before: Record<string, unknown> = readEverything(plain);
      const after: Record<string, unknown> = readEverything(withOrigin);
      for (const [reader, reading] of Object.entries(after)) {
        expect(comparable(reading), `seed ${seed}, ${reader}`).toEqual(comparable(before[reader]));
      }
    }
    // Not vacuous: the property ran over logs that actually carried the field.
    expect(marked).toBeGreaterThan(30);
  });

  it('a marked record still counts: the field never makes a reader drop the event', () => {
    const plain = generateLog(3, 12);
    const everyReviewMarked = plain.map((entry) =>
      entry.kind === 'review' ? { ...entry, origin: 'practice-paper' as const } : entry,
    );
    const before = computeAllConceptMastery(plain, [...CONCEPTS]);
    const after = computeAllConceptMastery(everyReviewMarked, [...CONCEPTS]);
    expect([...after]).toEqual([...before]);
    const scored = [...after.values()].reduce((sum, r) => sum + r.evidence.scoredEventCount, 0);
    expect(scored).toBeGreaterThan(0);
  });

  it('the log reader reads a written log with the field back, line for line, and re-serialises it byte-identically', () => {
    const withOrigin = markSome(generateLog(5, 20), 5);
    const text = withOrigin.map((entry) => `${JSON.stringify(entry)}\n`).join('');
    const parsed = parseReviewLog(text);
    expect(parsed.invalidLines).toEqual([]);
    expect(parsed.records.map((entry) => `${JSON.stringify(entry)}\n`).join('')).toBe(text);
  });
});
