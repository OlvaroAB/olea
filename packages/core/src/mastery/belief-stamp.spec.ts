// `ol-95vv.13`: the production producer of the v6 belief stamp (MAT-7,
// `masteryAtTimeV6`; `[D-087]`, `[D-116]`, `[D-338]`, `[D-345]`). Pins the
// stamp's value for known logs, proves it reads the attainment arithmetic its
// version names (not the no-validity fold the stamp used before), that it is
// whole or absent, that a line carrying it round-trips byte for byte through
// her vault (INV-2), and that readers older than the field still read it.
// Ids are structural placeholders, never fixture vocabulary (INV-3).
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  masteryAtTime as masteryAtTimeV5Field,
  type ReviewLogEntry,
  type ReviewLogRecord,
  reviewLogRecord,
  type VerdictLogRecord,
} from 'olea-contracts';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { parseReviewLog } from '../review-log/parse.js';
import { reviewLogPath } from '../review-log/path.js';
import { appendReviewLogRecord, type ReviewLogRecordInput } from '../review-log/write.js';
import {
  createFsrsScheduler,
  SCHEDULER_CONFIGURATION_VERSION,
} from '../scheduler/fsrs-scheduler.js';
import type { Scheduler } from '../scheduler/types.js';
import { FolderSource } from '../vault/folder-source.js';
import {
  ATTAINMENT_FOLD_VERSION,
  readAllConceptAttainment,
  readAllEligibleConceptVitality,
} from './attainment.js';
import { masteryAtTimeStamp } from './belief-stamp.js';
import { HOLDING_CUT, masteryAtTimeForConceptIds } from './rollup.js';
import { projectInstrumentValidity } from './validity.js';

const DAY = 24 * 60 * 60 * 1000;
const T1 = '2026-01-10T09:00:00-04:00';
const T2 = '2026-01-12T09:00:00-04:00';
const T3 = '2026-01-15T09:00:00-04:00';
const T4 = '2026-01-20T09:00:00-04:00';

/**
 * The version every default reading carries today, spelled out rather than
 * rebuilt from `attainmentArithmeticVersion`, so a silent change to the string
 * a stamp records goes red here.
 */
const DEFAULT_VERSION = `att-fold-1;sapling=any-scored-success;withheld=count;scheduler=fsrs6-declared-1`;

const scheduler: Scheduler = createFsrsScheduler();

function recall(
  eventId: string,
  timestamp: string,
  overrides: Partial<ReviewLogRecord> = {},
): ReviewLogRecord {
  return {
    schemaVersion: 6,
    kind: 'review',
    eventId,
    timestamp,
    instrumentId: 'qa:a:1',
    instrumentType: 'qa',
    conceptIds: ['concept-a'],
    rating: 'good',
    wasUnsure: false,
    durationMs: 1200,
    selectionContext: {
      dueState: 'due',
      examProximity: null,
      yieldRank: null,
      instrumentTypesOffered: ['qa'],
      planVersion: null,
    },
    supportLevelShown: 'independent',
    ...overrides,
  };
}

function rejected(instrumentId: string, timestamp: string, eventId: string): VerdictLogRecord {
  return {
    schemaVersion: 6,
    kind: 'verdict',
    eventId,
    timestamp,
    instrumentId,
    instrumentType: 'qa',
    conceptIds: ['concept-a'],
    verdict: 'rejected',
    artifactProvenance: { taskId: 't', promptVersion: 'v0', modelId: 'm' },
  };
}

function stamp(
  entries: readonly ReviewLogEntry[],
  conceptIds: readonly string[],
  now: Date,
  over: {
    scheduler?: Scheduler;
    options?: Parameters<typeof masteryAtTimeStamp>[0]['options'];
  } = {},
) {
  return masteryAtTimeStamp({
    entries,
    conceptIds,
    validity: projectInstrumentValidity(entries),
    scheduler: over.scheduler ?? scheduler,
    now,
    holdingCut: HOLDING_CUT,
    ...(over.options !== undefined ? { options: over.options } : {}),
  });
}

describe('masteryAtTimeStamp — the value pinned for known logs', () => {
  it('the version literal is the attainment arithmetic at its defaults with the declared scheduler', () => {
    expect(ATTAINMENT_FOLD_VERSION).toBe('att-fold-1');
    expect(SCHEDULER_CONFIGURATION_VERSION).toBe('fsrs6-declared-1');
  });

  it('a concept the log never names reads seed and too early to say, with the version (a real reading, never a default)', () => {
    expect(stamp([], ['concept-a'], new Date(Date.parse(T1)))).toEqual({
      attribution: 'per-concept',
      byConcept: { 'concept-a': 'seed' },
      vitalityByConcept: { 'concept-a': 'early' },
      arithmeticVersion: DEFAULT_VERSION,
    });
  });

  it('one good recall review: sprout, holding a day later, needs tending once past due', () => {
    const entries = [recall('r1', T1)];
    // FSRS-6's first `good` stability is ~2.3 days and the holding cut is the
    // 0.90 retention target (`[D-115]`): one day on is before due, ten past it.
    expect(stamp(entries, ['concept-a'], new Date(Date.parse(T1) + DAY))).toEqual({
      attribution: 'per-concept',
      byConcept: { 'concept-a': 'sprout' },
      vitalityByConcept: { 'concept-a': 'holding' },
      arithmeticVersion: DEFAULT_VERSION,
    });
    expect(stamp(entries, ['concept-a'], new Date(Date.parse(T1) + 10 * DAY))).toEqual({
      attribution: 'per-concept',
      byConcept: { 'concept-a': 'sprout' },
      vitalityByConcept: { 'concept-a': 'tending' },
      arithmeticVersion: DEFAULT_VERSION,
    });
  });

  it('names exactly the record’s concepts, each with its own reading, in her order, duplicates once', () => {
    const value = stamp(
      [recall('r1', T1)],
      ['concept-b', 'concept-a', 'concept-b'],
      new Date(Date.parse(T1) + DAY),
    );
    expect(value).toEqual({
      attribution: 'per-concept',
      byConcept: { 'concept-b': 'seed', 'concept-a': 'sprout' },
      vitalityByConcept: { 'concept-b': 'early', 'concept-a': 'holding' },
      arithmeticVersion: DEFAULT_VERSION,
    });
    expect(Object.keys(value.byConcept)).toEqual(['concept-b', 'concept-a']);
    expect(Object.keys(value.vitalityByConcept ?? {})).toEqual(['concept-b', 'concept-a']);
  });

  it('lays the fields out in the contract’s order', () => {
    expect(Object.keys(stamp([], ['concept-a'], new Date(Date.parse(T1))))).toEqual([
      'attribution',
      'byConcept',
      'vitalityByConcept',
      'arithmeticVersion',
    ]);
  });
});

describe('masteryAtTimeStamp — reads the arithmetic its version names ([D-338])', () => {
  // Sapling on three distinct days, one of them on an instrument later rejected.
  const entries: ReviewLogEntry[] = [
    recall('r1', T1),
    recall('r2', T2),
    recall('r3', T3, { instrumentId: 'qa:a:2' }),
    rejected('qa:a:2', T4, 'v1'),
  ];
  const now = new Date(Date.parse(T4) + DAY);

  it('the stage is the displayed stage: proven-invalid evidence removed at every stage', () => {
    const value = stamp(entries, ['concept-a'], now);
    expect(value.byConcept).toEqual({ 'concept-a': 'sprout' });
    // The discriminating half: the stage-only fold the stamp used before
    // folds with no validity set and still says sapling.
    expect(masteryAtTimeForConceptIds(entries, ['concept-a'])).toEqual({
      attribution: 'per-concept',
      byConcept: { 'concept-a': 'sapling' },
    });
  });

  it('stage, vitality and version are exactly what the two attainment readings say', () => {
    const validity = projectInstrumentValidity(entries);
    const attainment = readAllConceptAttainment(entries, ['concept-a'], validity, {
      schedulerVersion: SCHEDULER_CONFIGURATION_VERSION,
    }).get('concept-a');
    const vitality = readAllEligibleConceptVitality(
      entries,
      ['concept-a'],
      scheduler,
      now,
      HOLDING_CUT,
      validity,
    ).get('concept-a');
    expect(stamp(entries, ['concept-a'], now)).toEqual({
      attribution: 'per-concept',
      byConcept: { 'concept-a': attainment?.displayed.state },
      vitalityByConcept: { 'concept-a': vitality?.value },
      arithmeticVersion: vitality?.arithmeticVersion,
    });
    expect(attainment?.arithmeticVersion).toBe(DEFAULT_VERSION);
    expect(vitality?.arithmeticVersion).toBe(DEFAULT_VERSION);
    // The rejected instrument left vitality too.
    expect(vitality?.excludedInstrumentIds).toEqual(['qa:a:2']);
  });

  it('a chosen option is named in the version, never silently', () => {
    const value = stamp(entries, ['concept-a'], now, {
      options: { withheldEvidence: 'drop-from-every-current-reading' },
    });
    expect(value.arithmeticVersion).toBe(
      'att-fold-1;sapling=any-scored-success;withheld=drop-from-every-current-reading;scheduler=fsrs6-declared-1',
    );
  });

  it('a scheduler that names no configuration is stamped unknown, never guessed', () => {
    const { configuration: _dropped, ...unversioned } = scheduler;
    const value = stamp([recall('r1', T1)], ['concept-a'], new Date(Date.parse(T1) + DAY), {
      scheduler: unversioned,
    });
    expect(value.arithmeticVersion).toBe(
      'att-fold-1;sapling=any-scored-success;withheld=count;scheduler=unknown',
    );
    expect(value.vitalityByConcept).toEqual({ 'concept-a': 'holding' });
  });

  it('refuses a review that names no concept rather than stamp nothing as something', () => {
    expect(() => stamp([], [], new Date(Date.parse(T1)))).toThrow(/at least one concept/);
  });
});

describe('masteryAtTimeStamp — whole, and valid against the contract', () => {
  function recordWith(masteryAtTime: unknown, conceptIds: string[]): unknown {
    const { masteryAtTime: _none, ...rest } = recall('r-new', T4, { conceptIds });
    return { ...rest, masteryAtTime };
  }

  it('the record a writer builds from it passes the current schema', () => {
    const value = stamp([recall('r1', T1)], ['concept-a', 'concept-b'], new Date(Date.parse(T4)));
    expect(reviewLogRecord.safeParse(recordWith(value, ['concept-a', 'concept-b'])).success).toBe(
      true,
    );
  });

  it('the schema refuses either half alone, which this producer can never emit', () => {
    const value = stamp([recall('r1', T1)], ['concept-a'], new Date(Date.parse(T4)));
    const { vitalityByConcept: _v, ...noVitality } = value;
    const { arithmeticVersion: _a, ...noVersion } = value;
    expect(reviewLogRecord.safeParse(recordWith(noVitality, ['concept-a'])).success).toBe(false);
    expect(reviewLogRecord.safeParse(recordWith(noVersion, ['concept-a'])).success).toBe(false);
  });
});

describe('a line carrying the stamp in her vault (INV-2) and readers older than the field', () => {
  let tempRoot: string;

  beforeEach(async () => {
    tempRoot = await mkdtemp(join(tmpdir(), 'olea-belief-stamp-'));
  });

  afterEach(async () => {
    await rm(tempRoot, { recursive: true, force: true });
  });

  const day = '2026-01-20';

  function input(over: Partial<ReviewLogRecordInput> = {}): ReviewLogRecordInput {
    return {
      timestamp: T4,
      instrumentId: 'qa:a:1',
      instrumentType: 'qa',
      conceptIds: ['concept-a'],
      rating: 'good',
      wasUnsure: false,
      durationMs: 1200,
      selectionContext: {
        dueState: 'due',
        examProximity: null,
        yieldRank: null,
        instrumentTypesOffered: ['qa'],
        planVersion: null,
      },
      ...over,
    };
  }

  async function fileText(): Promise<string> {
    return readFile(join(tempRoot, reviewLogPath(day, 'desktop')), 'utf8');
  }

  it('an earlier line keeps every byte, and the stamped line re-serialises byte-identically after a read', async () => {
    const source = new FolderSource(tempRoot);
    // A line as the stage-only writer laid it down before this producer.
    await appendReviewLogRecord(
      source,
      input({ masteryAtTime: { attribution: 'per-concept', byConcept: { 'concept-a': 'seed' } } }),
      { deviceId: 'desktop', generateEventId: () => 'review-1' },
    );
    const before = await fileText();

    const prior = parseReviewLog(before).records;
    const value = stamp(prior, ['concept-a'], new Date(Date.parse(T4) + 1000));
    await appendReviewLogRecord(source, input({ masteryAtTime: value }), {
      deviceId: 'desktop',
      generateEventId: () => 'review-2',
    });
    const after = await fileText();

    expect(after.startsWith(before)).toBe(true);
    const parsed = parseReviewLog(after);
    expect(parsed.invalidLines).toEqual([]);
    expect(parsed.records.map((record) => `${JSON.stringify(record)}\n`).join('')).toBe(after);

    const written = parsed.records[1];
    if (written?.kind !== 'review') throw new Error('expected the stamped review');
    expect(written.masteryAtTime).toEqual({
      attribution: 'per-concept',
      byConcept: { 'concept-a': 'sprout' },
      vitalityByConcept: { 'concept-a': 'holding' },
      arithmeticVersion: DEFAULT_VERSION,
    });
  });

  it('a reader of the stage alone reads the stage unchanged; the v5 shape of the field strips the rest', () => {
    const value = stamp([recall('r1', T1)], ['concept-a'], new Date(Date.parse(T1) + DAY));
    const line = JSON.parse(JSON.stringify(value));
    const older = masteryAtTimeV5Field.parse(line);
    expect(older).toEqual({ attribution: 'per-concept', byConcept: { 'concept-a': 'sprout' } });
    expect(Object.keys(older).sort()).toEqual(['attribution', 'byConcept']);
  });

  it('no reading takes the stamp back as evidence (strip-invariance, knowledge model §8 test 5)', () => {
    // Each record stamped the way the writer stamps it: from the log as it
    // stood before that record.
    const plain: ReviewLogRecord[] = [
      recall('r1', T1),
      recall('r2', T2, { instrumentId: 'qa:a:2', rating: 'again' }),
      recall('r3', T3, { conceptIds: ['concept-a', 'concept-b'] }),
    ];
    const stamped: ReviewLogEntry[] = [];
    for (const record of plain) {
      const value = stamp(stamped, record.conceptIds, new Date(Date.parse(record.timestamp)));
      stamped.push({ ...record, masteryAtTime: value });
    }
    expect(stamped.every((e) => e.kind === 'review' && e.masteryAtTime !== undefined)).toBe(true);

    const now = new Date(Date.parse(T4));
    const ids = ['concept-a', 'concept-b'];
    const read = (entries: readonly ReviewLogEntry[]) => {
      const validity = projectInstrumentValidity(entries);
      return JSON.stringify({
        stage: [...readAllConceptAttainment(entries, ids, validity)],
        vitality: [
          ...readAllEligibleConceptVitality(entries, ids, scheduler, now, HOLDING_CUT, validity),
        ],
        stamp: stamp(entries, ids, now),
      });
    };
    expect(read(stamped)).toBe(read(plain));
  });
});
