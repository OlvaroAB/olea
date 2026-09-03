import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { FolderSource } from '../vault/folder-source.js';
import {
  CLAIM_ROUTING,
  type ClaimRendering,
  CONTEST_GESTURE_LABEL,
  CONTEST_RATE_MIN_CLAIMS,
  contestClaim,
  contestEffectFor,
  contestOutcomeShapes,
  contestRateHealthCheck,
  contestStateForClaim,
  isDisputeCurrent,
  quarantinedGradeInstrumentIds,
  resolveDispute,
  reviewLogDisputes,
  routeClaimRendering,
  standingDissent,
  UnroutedClaimError,
  withdrawnStructuralClaims,
} from './contest.js';
import type { DisputeLogRecord } from './contest-record.js';
import { safeParseDisputeLogRecord } from './contest-record.js';
import { parseReviewLog } from './parse.js';
import { reviewLogPath } from './path.js';
import { appendDisputeRecord } from './write.js';

// Synthetic fixtures only (INV-3): opaque ids, never real vault material.
const CONCEPT_A = 'concept-a';
const CONCEPT_B = 'concept-b';

function dispute(overrides: Partial<DisputeLogRecord> = {}): DisputeLogRecord {
  return {
    schemaVersion: 5,
    kind: 'dispute',
    eventId: 'd1',
    timestamp: '2026-08-21T09:00:00+02:00',
    claimKind: 'reading',
    claimRendering: 'mastery-reading',
    conceptIds: [CONCEPT_A],
    evidenceBasis: 'basis-1',
    effect: 'held',
    ...overrides,
  } as DisputeLogRecord;
}

describe('the contest gesture', () => {
  it('is one string, and it is the one [D-136] ratified', () => {
    expect(CONTEST_GESTURE_LABEL).toBe("This doesn't match what I see");
  });
});

describe('routing — [D-095] rules six renderings and leaves five open', () => {
  it('routes the six ruled renderings and cites the clause for each', () => {
    const routed = (Object.keys(CLAIM_ROUTING) as ClaimRendering[]).filter(
      (rendering) => CLAIM_ROUTING[rendering].status === 'routed',
    );
    expect(routed).toHaveLength(6);
    for (const rendering of routed) {
      const routing = routeClaimRendering(rendering);
      if (routing.status !== 'routed') throw new Error('unreachable');
      expect(routing.ruledBy.length).toBeGreaterThan(0);
    }
  });

  it('leaves the five DSN-1 open questions visibly open rather than guessing a kind', () => {
    const open = (Object.keys(CLAIM_ROUTING) as ClaimRendering[])
      .map((rendering) => CLAIM_ROUTING[rendering])
      .filter((routing) => routing.status === 'open');
    expect(open).toHaveLength(5);
    expect(
      open
        .map((routing) => (routing.status === 'open' ? routing.openQuestion : 0))
        .sort((a, b) => a - b),
    ).toEqual([6, 7, 8, 9, 10]);
  });

  it('holds a declared fact apart — correcting a declaration is not a contest', () => {
    expect(routeClaimRendering('declared-fact').status).toBe('not-a-contest');
  });

  it('still refuses a declared fact — correcting a declaration is not a contest at all', () => {
    expect(() =>
      contestClaim({
        claim: {
          rendering: 'declared-fact',
          conceptIds: [CONCEPT_A],
          evidenceBasis: 'basis-1',
        },
        timestamp: '2026-08-21T09:00:00+02:00',
      }),
    ).toThrow(UnroutedClaimError);
  });
});

describe('an open-routed rendering is recorded, not refused ([D-215])', () => {
  it('records claimKind unsorted and routingStatus open, effect held, instead of throwing', () => {
    const outcome = contestClaim({
      claim: {
        rendering: 'trend-sentence',
        conceptIds: [CONCEPT_A],
        evidenceBasis: 'basis-1',
      },
      timestamp: '2026-08-21T09:00:00+02:00',
    });
    expect(outcome.kind).toBe('unsorted');
    expect(outcome.effect).toBe('held');
    expect(outcome.record.claimKind).toBe('unsorted');
    expect(outcome.record.claimRendering).toBe('trend-sentence');
    expect(outcome.record.routingStatus).toBe('open');
    expect(outcome.record.effect).toBe('held');
  });

  it('produces a record every one of the five open renderings can validate as', () => {
    for (const rendering of [
      'trend-sentence',
      'study-plan-ranking',
      'refusal',
      'vault-freshness-line',
      'generated-explanation',
    ] as const) {
      const outcome = contestClaim({
        claim: { rendering, conceptIds: [CONCEPT_A], evidenceBasis: 'basis-1' },
        timestamp: '2026-08-21T09:00:00+02:00',
      });
      const parsed = safeParseDisputeLogRecord({
        schemaVersion: 5,
        kind: 'dispute',
        eventId: 'e1',
        ...outcome.record,
      });
      expect(parsed.success).toBe(true);
    }
  });

  it('a routed rendering is unchanged — no routingStatus, claimKind still the ruled kind', () => {
    const outcome = contestClaim({
      claim: {
        rendering: 'mastery-reading',
        conceptIds: [CONCEPT_A],
        evidenceBasis: 'basis-1',
      },
      timestamp: '2026-08-21T09:00:00+02:00',
    });
    expect(outcome.record.claimKind).toBe('reading');
    expect('routingStatus' in outcome.record).toBe(false);
  });

  it('the schema rejects unsorted without routingStatus, and a ruled kind carrying it', () => {
    expect(safeParseDisputeLogRecord(dispute({ claimKind: 'unsorted' })).success).toBe(false);
    expect(
      safeParseDisputeLogRecord(dispute({ claimKind: 'reading', routingStatus: 'open' })).success,
    ).toBe(false);
    expect(
      safeParseDisputeLogRecord(
        dispute({
          claimKind: 'unsorted',
          claimRendering: 'trend-sentence',
          routingStatus: 'open',
        }),
      ).success,
    ).toBe(true);
  });

  it('a pre-D-215 record with no routingStatus still validates (additive, no schemaVersion bump)', () => {
    expect(safeParseDisputeLogRecord(dispute()).success).toBe(true);
  });

  it('the health check counts an open rendering under claimKind unsorted rather than dropping it', () => {
    const opening = contestClaim({
      claim: { rendering: 'trend-sentence', conceptIds: [CONCEPT_A], evidenceBasis: 'basis-1' },
      timestamp: '2026-08-21T09:00:00+02:00',
    });
    const record: DisputeLogRecord = { ...dispute(), ...opening.record, eventId: 'd1' };
    const [reading] = contestRateHealthCheck({
      records: [record],
      claimsAsserted: { 'trend-sentence': CONTEST_RATE_MIN_CLAIMS },
    });
    expect(reading?.claimKind).toBe('unsorted');
    expect(reading?.disputes).toBe(1);
  });
});

describe('the effect is fixed by what she touched, never by what she picked', () => {
  it('maps each kind to its ruled effect', () => {
    expect(contestEffectFor('reading')).toBe('held');
    expect(contestEffectFor('structural')).toBe('returned-to-candidate');
    expect(contestEffectFor('grade')).toBe('quarantined');
  });

  it('records both endings across the three kinds, and no kind carries both', () => {
    const shapes = contestOutcomeShapes();
    // Both endings exist somewhere in the mechanism — [D-046] clause 4.
    expect(Object.values(shapes).some((shape) => shape.moves)).toBe(true);
    expect(Object.values(shapes).some((shape) => !shape.moves)).toBe(true);
    // A reading always holds at the moment of contest; a structural claim always moves.
    expect(shapes.reading.moves).toBe(false);
    expect(shapes.structural.moves).toBe(true);
    // And no kind is asked to carry both at once.
    expect(shapes.structural.mayMoveLater).toBe(false);
  });

  it('produces the same record shape for the same claim whatever she was thinking', () => {
    const outcome = contestClaim({
      claim: {
        rendering: 'mastery-reading',
        conceptIds: [CONCEPT_A],
        evidenceBasis: 'basis-1',
      },
      timestamp: '2026-08-21T09:00:00+02:00',
    });
    expect(outcome.effect).toBe('held');
    // No reason field anywhere: the record cannot carry what she picked.
    expect(Object.keys(outcome.record)).not.toContain('reason');
  });

  it('quarantines a contested grade and names the instrument', () => {
    const outcome = contestClaim({
      claim: {
        rendering: 'explain-back-grade',
        conceptIds: [CONCEPT_A],
        instrumentId: 'instrument-1',
        evidenceBasis: 'basis-1',
      },
      timestamp: '2026-08-21T09:00:00+02:00',
    });
    expect(outcome.kind).toBe('grade');
    expect(outcome.effect).toBe('quarantined');
    expect(outcome.record.instrumentId).toBe('instrument-1');
  });

  it('returns a contested structural claim to candidate', () => {
    const outcome = contestClaim({
      claim: {
        rendering: 'cross-course-match',
        conceptIds: [CONCEPT_A, CONCEPT_B],
        evidenceBasis: 'basis-1',
      },
      timestamp: '2026-08-21T09:00:00+02:00',
    });
    expect(outcome.effect).toBe('returned-to-candidate');
  });
});

describe('the dispute is recorded either way', () => {
  it('validates as a persistable record for every kind', () => {
    for (const rendering of [
      'mastery-reading',
      'cross-course-match',
      'explain-back-grade',
    ] as const) {
      const outcome = contestClaim({
        claim: { rendering, conceptIds: [CONCEPT_A], evidenceBasis: 'basis-1' },
        timestamp: '2026-08-21T09:00:00+02:00',
      });
      const parsed = safeParseDisputeLogRecord({
        schemaVersion: 5,
        kind: 'dispute',
        eventId: 'e1',
        ...outcome.record,
      });
      expect(parsed.success).toBe(true);
    }
  });

  it('rejects a resolution that names no outcome, and an outcome that resolves nothing', () => {
    const base = { ...dispute(), eventId: 'e1' };
    expect(safeParseDisputeLogRecord({ ...base, resolves: 'd0' }).success).toBe(false);
    expect(safeParseDisputeLogRecord({ ...base, outcome: 'upheld' }).success).toBe(false);
    expect(safeParseDisputeLogRecord({ ...base, resolves: 'd0', outcome: 'upheld' }).success).toBe(
      true,
    );
  });

  it('carries no reason, no text and no rendered sentence (D-005)', () => {
    const record = dispute();
    const serialised = JSON.stringify(record);
    for (const forbidden of ['reason', 'text', 'sentence', 'note']) {
      expect(serialised).not.toContain(`"${forbidden}"`);
    }
  });
});

describe('the two endings, reachable and recorded', () => {
  it('records a correction that names her contest as its catalyst', () => {
    const opening = dispute({
      eventId: 'd1',
      claimKind: 'grade',
      claimRendering: 'explain-back-grade',
      effect: 'quarantined',
      instrumentId: 'i1',
    });
    const resolution = resolveDispute({
      dispute: opening,
      outcome: 'corrected',
      timestamp: '2026-08-24T09:00:00+02:00',
    });
    expect(resolution.resolves).toBe('d1');
    expect(resolution.outcome).toBe('corrected');
  });

  it('records an upheld claim too — the state held and the dispute still exists', () => {
    const opening = dispute({ eventId: 'd1' });
    const resolution = resolveDispute({
      dispute: opening,
      outcome: 'upheld',
      timestamp: '2026-08-24T09:00:00+02:00',
    });
    expect(resolution.outcome).toBe('upheld');
    expect(resolution.effect).toBe('held');
  });

  it('acknowledges an upheld dispute exactly once, then lets it rest', () => {
    const opening = dispute({ eventId: 'd1' });
    const resolution: DisputeLogRecord = {
      ...opening,
      eventId: 'd2',
      resolves: 'd1',
      outcome: 'upheld',
    };
    const claim = {
      rendering: 'mastery-reading' as const,
      conceptIds: [CONCEPT_A],
      evidenceBasis: 'basis-1',
    };

    const first = contestStateForClaim({ records: [opening, resolution], claim });
    expect(first.acknowledgementDue).toBe(true);
    expect(first.resolution).toBe('upheld');

    const later = contestStateForClaim({
      records: [opening, resolution],
      claim,
      acknowledgedDisputeIds: ['d1'],
    });
    expect(later.acknowledgementDue).toBe(false);
    // The dispute itself is still there — acknowledged once is not forgotten.
    expect(later.disputed).toBe(true);
  });
});

describe('evidence-relative aging, never calendar aging', () => {
  it('keeps a dispute while the claim rests on the same evidence', () => {
    expect(isDisputeCurrent(dispute({ evidenceBasis: 'basis-1' }), 'basis-1')).toBe(true);
  });

  it('retires it when the claim is recomputed on new evidence — the claim arrives fresh', () => {
    const opening = dispute({ evidenceBasis: 'basis-1' });
    expect(isDisputeCurrent(opening, 'basis-2')).toBe(false);
    const state = contestStateForClaim({
      records: [opening],
      claim: {
        rendering: 'mastery-reading',
        conceptIds: [CONCEPT_A],
        evidenceBasis: 'basis-2',
      },
    });
    expect(state.disputed).toBe(false);
  });
});

describe('consumers read the effect from the log', () => {
  it('quarantines a grade until its re-derivation lands, either way', () => {
    const opening = dispute({
      eventId: 'd1',
      claimKind: 'grade',
      claimRendering: 'explain-back-grade',
      effect: 'quarantined',
      instrumentId: 'i1',
    });
    expect(quarantinedGradeInstrumentIds([opening])).toEqual(['i1']);
    const resolved: DisputeLogRecord = {
      ...opening,
      eventId: 'd2',
      resolves: 'd1',
      outcome: 'upheld',
    };
    expect(quarantinedGradeInstrumentIds([opening, resolved])).toEqual([]);
  });

  it('stops serving a withdrawn structural claim', () => {
    const withdrawal = dispute({
      claimKind: 'structural',
      claimRendering: 'cross-course-match',
      effect: 'returned-to-candidate',
      conceptIds: [CONCEPT_A, CONCEPT_B],
    });
    expect(withdrawnStructuralClaims([withdrawal])).toEqual([[CONCEPT_A, CONCEPT_B]]);
  });

  it('leaves a contested reading standing, wearing her dissent', () => {
    const contested = dispute();
    expect(standingDissent([contested])).toHaveLength(1);
    // and nothing about it quarantines or withdraws anything.
    expect(quarantinedGradeInstrumentIds([contested])).toEqual([]);
    expect(withdrawnStructuralClaims([contested])).toEqual([]);
  });

  it('picks disputes out of a mixed log', () => {
    expect(reviewLogDisputes([dispute()])).toHaveLength(1);
  });
});

describe('the contest-rate health check ([D-095] §4)', () => {
  it('reports counts only — no concept id, no instrument id, no content', () => {
    const readings = contestRateHealthCheck({
      records: [dispute()],
      claimsAsserted: { 'mastery-reading': 10 },
    });
    expect(readings).toHaveLength(1);
    expect(Object.keys(readings[0] as object).sort()).toEqual([
      'claimKind',
      'claimRendering',
      'claimsAsserted',
      'disputes',
      'firing',
    ]);
  });

  it('can actually fire', () => {
    const records = Array.from({ length: 4 }, (_, index) =>
      dispute({ eventId: `d${index}`, conceptIds: [`concept-${index}`] }),
    );
    const [reading] = contestRateHealthCheck({
      records,
      claimsAsserted: { 'mastery-reading': CONTEST_RATE_MIN_CLAIMS },
    });
    expect(reading?.firing).toBe(true);
  });

  it('does not fire on a denominator too small to mean anything', () => {
    const [reading] = contestRateHealthCheck({
      records: [dispute()],
      claimsAsserted: { 'mastery-reading': 2 },
    });
    expect(reading?.firing).toBe(false);
  });
});

describe('the dispute survives a round trip through her vault', () => {
  let dir = '';

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'olea-contest-'));
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('appends both endings and reads them back beside the review events', async () => {
    const vault = new FolderSource(dir);
    const opening = contestClaim({
      claim: {
        rendering: 'explain-back-grade',
        conceptIds: [CONCEPT_A],
        instrumentId: 'i1',
        evidenceBasis: 'basis-1',
      },
      timestamp: '2026-08-21T09:00:00+02:00',
    });

    const written = await appendDisputeRecord(vault, opening.record, {
      deviceId: 'device-1',
      generateEventId: () => 'd1',
    });
    expect(written.record.eventId).toBe('d1');

    await appendDisputeRecord(
      vault,
      resolveDispute({
        dispute: written.record,
        outcome: 'corrected',
        timestamp: '2026-08-24T09:00:00+02:00',
      }),
      { deviceId: 'device-1', generateEventId: () => 'd2' },
    );

    const day1 = parseReviewLog(
      await readFile(join(dir, reviewLogPath('2026-08-21', 'device-1')), 'utf8'),
    );
    const day2 = parseReviewLog(
      await readFile(join(dir, reviewLogPath('2026-08-24', 'device-1')), 'utf8'),
    );

    // A dispute line is a valid line, never an `invalidLine` — the log this
    // build writes is the log this build reads.
    expect(day1.invalidLines).toEqual([]);
    expect(day2.invalidLines).toEqual([]);
    expect(day1.records).toEqual([]);
    expect(day1.disputes).toHaveLength(1);
    expect(day2.disputes[0]?.resolves).toBe('d1');
    expect(day2.disputes[0]?.outcome).toBe('corrected');

    // Both endings are reachable from the log alone.
    const all = [...day1.disputes, ...day2.disputes];
    expect(quarantinedGradeInstrumentIds(all)).toEqual([]);
    expect(reviewLogDisputes(all)).toHaveLength(2);
  });

  it('refuses to write a record that fails validation, before any byte reaches the vault', async () => {
    const vault = new FolderSource(dir);
    await expect(
      appendDisputeRecord(vault, { ...dispute(), conceptIds: [] } as never, {
        deviceId: 'device-1',
        generateEventId: () => 'd1',
      }),
    ).rejects.toThrow(/conceptIds/);
  });
});
