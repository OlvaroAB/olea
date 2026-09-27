// Review-log schema version 6 (ol-95vv.8), the one evidence-format migration
// that carries every ruled field together so her log migrates once:
//
//   - `masteryAtTime`'s per-concept arm stamps vitality beside the stage, plus
//     the arithmetic version that produced both (MAT-7, `[D-087]`, `[D-116]`);
//     that version is also the rule-version marker `[D-345]` asks for;
//   - `explainBackCorrectness`, the correctness verdict as its own top-level
//     field with its own stamp, able to stand without a depth grade (`[D-303]`);
//   - `reason` on a suspend event: defect, source revision or her own choice,
//     absent meaning unknown (`[D-345]`);
//   - `hintOpened`, an explicit true or false, absent meaning unknown (`[D-350]`);
//   - `presentedPassageDigest`, the cited passage's digest as presented to
//     her, absent meaning unknown (`[D-358]`);
//   - `compositionId`, the composition record that served the review, absent
//     meaning unknown and never a prompt to join by time (`[D-395]`).
//
// `[D-386]` (option a) rules what the hop does with a verdict already
// recorded nested in `explainBackGrade`: carried verbatim, no provenance
// synthesised, read top-level first and nested second. The last block below
// proves that on a whole old-shape log: v5 → v6 → v5 round-trips byte for
// byte, every verdict reads the same before and after, and no key appears
// at any depth that the v5 line did not hold.
//
// Each field is proved three ways: a record carrying it keeps it (write), the
// v6 union reads it back (read), and a record without it — which is exactly
// what a v5 line restamped to 6 is — parses with no new key and re-serialises
// byte-identically (legacy absent). None of them is a v5 field: v5 drops them.
import { describe, expect, it } from 'vitest';
import {
  disputeLogRecordV6,
  explainBackCorrectness,
  explainBackCorrectnessVerdict,
  explainBackOfferLogRecordV6,
  masteryAtTimeV6,
  misconceptionObservedLogRecordV6,
  nonAttemptLogRecordV6,
  REVIEW_LOG_READABLE_VERSIONS,
  REVIEW_LOG_SCHEMA_VERSION,
  readExplainBackCorrectness,
  retrospectiveOfferLogRecordV6,
  reviewLogEntry,
  reviewLogEntryV5,
  reviewLogEntryV6,
  reviewLogRecord,
  reviewLogRecordV5,
  reviewLogRecordV6,
  sourceRegisteredLogRecordV6,
  successionLogRecordV6,
  suspendLogRecordV6,
  suspensionReason,
  verdictLogRecordV6,
  vitalityValue,
} from './review-log.js';

const provenance = {
  taskId: 'explain-back.judge.v1',
  promptVersion: '3',
  modelId: 'model-x',
};

/** A v6 review line with none of v6's new fields — the shape a restamped v5 line has. */
function reviewLine(over: Record<string, unknown> = {}) {
  return {
    schemaVersion: 6,
    kind: 'review',
    eventId: 'review-1',
    timestamp: '2026-09-25T10:15:00-04:00',
    instrumentId: 'qa:concept-a:1',
    instrumentType: 'qa',
    rating: 'good',
    wasUnsure: false,
    durationMs: 4200,
    selectionContext: {
      dueState: 'due',
      examProximity: null,
      yieldRank: null,
      instrumentTypesOffered: ['qa'],
      planVersion: null,
    },
    conceptIds: ['concept-a', 'concept-b'],
    ...over,
  };
}

function explainBackLine(over: Record<string, unknown> = {}) {
  return reviewLine({
    instrumentId: 'explain-back:concept-a',
    instrumentType: 'explain-back',
    rating: null,
    selectionContext: {
      dueState: 'new',
      examProximity: null,
      yieldRank: null,
      instrumentTypesOffered: ['explain-back'],
      planVersion: null,
    },
    conceptIds: ['concept-a'],
    ...over,
  });
}

const fullStamp = {
  attribution: 'per-concept',
  byConcept: { 'concept-a': 'sprout', 'concept-b': 'seed' },
  vitalityByConcept: { 'concept-a': 'tending', 'concept-b': 'early' },
  arithmeticVersion: 'attainment-1;sapling=three-days;withheld=exclude;scheduler=fsrs-6',
};

function issuePaths(result: { success: boolean; error?: { issues: { path: PropertyKey[] }[] } }) {
  return (result.error?.issues ?? []).map((issue) => issue.path.map(String).join('.'));
}

describe('review-log v6 — staged, not yet current', () => {
  it('is defined beside v5 while writers still stamp 5 and every alias still names v5', () => {
    // The flip (REVIEW_LOG_SCHEMA_VERSION → 6, 6 added to the readable list,
    // the aliases moved, core's parse.ts and upgrade.ts taught the v5 → v6
    // hop) lands in one change with its readers; until then no writer can
    // produce a line this build's reader would refuse.
    expect(REVIEW_LOG_SCHEMA_VERSION).toBe(5);
    expect(REVIEW_LOG_READABLE_VERSIONS).toEqual([5, 3, 2, 1]);
    expect(reviewLogRecord).toBe(reviewLogRecordV5);
    expect(reviewLogEntry).toBe(reviewLogEntryV5);
  });

  it('refuses any other schemaVersion — the version literal is 6', () => {
    expect(reviewLogRecordV6.safeParse(reviewLine({ schemaVersion: 5 })).success).toBe(false);
    expect(reviewLogRecordV6.safeParse(reviewLine({ schemaVersion: 7 })).success).toBe(false);
  });

  it('none of the new fields is a v5 field: a v5 parse drops every one of them', () => {
    const parsed = reviewLogRecordV5.parse({
      ...explainBackLine({
        explainBackCorrectness: { verdict: 'correct', artifactProvenance: provenance },
        hintOpened: false,
        presentedPassageDigest: 'digest-1',
        compositionId: 'composition-1',
      }),
      schemaVersion: 5,
    });
    for (const key of [
      'explainBackCorrectness',
      'hintOpened',
      'presentedPassageDigest',
      'compositionId',
    ]) {
      expect(Object.hasOwn(parsed, key)).toBe(false);
    }
  });
});

describe('legacy absent: a v5 record restamped to 6 is a valid v6 record, byte for byte', () => {
  it('a review line with none of the new fields parses with no new key and re-serialises identically', () => {
    const line = JSON.stringify(
      reviewLine({
        masteryAtTime: {
          attribution: 'per-concept',
          byConcept: { 'concept-a': 'seed', 'concept-b': 'seed' },
        },
      }),
    );
    const parsed = reviewLogRecordV6.parse(JSON.parse(line));
    for (const key of [
      'explainBackCorrectness',
      'hintOpened',
      'presentedPassageDigest',
      'compositionId',
    ]) {
      expect(Object.hasOwn(parsed, key)).toBe(false);
    }
    expect(parsed.masteryAtTime).toEqual({
      attribution: 'per-concept',
      byConcept: { 'concept-a': 'seed', 'concept-b': 'seed' },
    });
    expect(JSON.stringify(parsed)).toBe(line);
    expect(JSON.stringify(reviewLogEntryV6.parse(JSON.parse(line)))).toBe(line);
  });

  it('the migration-only not-attributable arm is unchanged and carries no vitality or version', () => {
    const line = JSON.stringify(
      reviewLine({ masteryAtTime: { attribution: 'not-attributable', recorded: 'sprout' } }),
    );
    expect(JSON.stringify(reviewLogRecordV6.parse(JSON.parse(line)))).toBe(line);
    expect(
      masteryAtTimeV6.safeParse({
        attribution: 'not-attributable',
        recorded: 'sprout',
        vitalityByConcept: {},
      }).success,
    ).toBe(true); // extra key stripped, never kept
    const stripped = masteryAtTimeV6.parse({
      attribution: 'not-attributable',
      recorded: 'sprout',
      arithmeticVersion: 'v',
    });
    expect(Object.keys(stripped).sort()).toEqual(['attribution', 'recorded']);
  });

  it('a v5 explain-back line with a nested correctness keeps it verbatim at v6 (nothing recorded is dropped)', () => {
    const grade = {
      soloLevel: 'relational',
      correctness: 'correct',
      contentRef: 'content-1',
      revisionOf: null,
      artifactProvenance: provenance,
    };
    const line = JSON.stringify(explainBackLine({ explainBackGrade: grade }));
    expect(JSON.stringify(reviewLogRecordV6.parse(JSON.parse(line)))).toBe(line);
  });

  it('every other kind is its v5 shape with only the version restamped', () => {
    const lines: Record<string, unknown>[] = [
      {
        schemaVersion: 6,
        kind: 'suspend',
        eventId: 's-1',
        timestamp: '2026-09-25T10:15:00-04:00',
        instrumentId: 'qa:1',
        conceptIds: ['concept-a'],
      },
      {
        schemaVersion: 6,
        kind: 'verdict',
        eventId: 'v-1',
        timestamp: '2026-09-25T10:15:00-04:00',
        instrumentId: 'qa:1',
        instrumentType: 'qa',
        conceptIds: ['concept-a'],
        verdict: 'accepted',
        artifactProvenance: provenance,
      },
      {
        schemaVersion: 6,
        kind: 'succession',
        eventId: 'su-1',
        timestamp: '2026-09-25T10:15:00-04:00',
        predecessorInstrumentId: 'mcq:1',
        successorInstrumentId: 'mcq:2',
      },
      {
        schemaVersion: 6,
        kind: 'dispute',
        eventId: 'd-1',
        timestamp: '2026-09-25T10:15:00-04:00',
        claimKind: 'grade',
        claimRendering: 'explain-back-grade',
        conceptIds: ['concept-a'],
        instrumentId: 'explain-back:concept-a',
        evidenceBasis: 'basis-1',
        effect: 'quarantined',
      },
      {
        schemaVersion: 6,
        kind: 'retrospective-offered',
        eventId: 'r-1',
        timestamp: '2026-09-25T10:15:00-04:00',
        assessmentPath: 'Assessments/one.md',
      },
      {
        schemaVersion: 6,
        kind: 'explain-back-declined',
        eventId: 'o-2',
        timestamp: '2026-09-25T10:15:00-04:00',
        conceptIds: ['concept-a'],
        trigger: 'repeated-failure',
        instrumentId: 'qa:1',
        answers: 'o-1',
        manner: 'not-taken',
      },
      {
        schemaVersion: 6,
        kind: 'non-attempt',
        eventId: 'n-1',
        timestamp: '2026-09-25T10:15:00-04:00',
        conceptIds: ['concept-a'],
        trigger: 'strong-recall-proposal',
        offerEventId: 'o-1',
      },
      {
        schemaVersion: 6,
        kind: 'misconception-observed',
        eventId: 'm-1',
        timestamp: '2026-09-25T10:15:00-04:00',
        instrumentId: 'mcq:1',
        conceptIds: ['concept-a'],
        reviewEventId: 'review-1',
        misconceptionId: 'mis-1',
        distractor: { text: 'option', believes: 'belief', source_says: 'correction' },
      },
      {
        schemaVersion: 6,
        kind: 'source-registered',
        eventId: 'sr-1',
        timestamp: '2026-09-25T10:15:00-04:00',
        path: 'Sources/one.pdf',
        role: 'objectives',
        course: 'course-a',
      },
    ];
    for (const record of lines) {
      const line = JSON.stringify(record);
      const parsed = reviewLogEntryV6.safeParse(JSON.parse(line));
      expect(parsed.success, String(record.kind)).toBe(true);
      if (parsed.success) expect(JSON.stringify(parsed.data)).toBe(line);
      // …and the same line at version 5 is still a valid v5 line.
      expect(reviewLogEntryV5.safeParse({ ...record, schemaVersion: 5 }).success).toBe(true);
    }
  });

  it('the v6 union carries the v5 union’s ten members and fourteen kind literals exactly', () => {
    const kindsOf = (options: readonly { readonly shape: { readonly kind: unknown } }[]) =>
      options.flatMap((option) => {
        const kind = option.shape.kind as { readonly options?: readonly string[]; value?: string };
        return kind.options !== undefined ? [...kind.options] : [String(kind.value)];
      });
    expect(reviewLogEntryV6.options).toHaveLength(10);
    expect(new Set(kindsOf(reviewLogEntryV6.options))).toEqual(
      new Set(kindsOf(reviewLogEntryV5.options)),
    );
    expect(kindsOf(reviewLogEntryV6.options)).toHaveLength(14);
  });

  it('the non-v5 member schemas each require version 6', () => {
    for (const schema of [
      suspendLogRecordV6,
      verdictLogRecordV6,
      successionLogRecordV6,
      disputeLogRecordV6,
      retrospectiveOfferLogRecordV6,
      explainBackOfferLogRecordV6,
      nonAttemptLogRecordV6,
      misconceptionObservedLogRecordV6,
      sourceRegisteredLogRecordV6,
    ]) {
      expect(schema.shape.schemaVersion.value).toBe(6);
    }
  });

  it('the pairing rules v5 enforces still hold at v6 (dispute, offer, non-attempt)', () => {
    expect(
      disputeLogRecordV6.safeParse({
        schemaVersion: 6,
        kind: 'dispute',
        eventId: 'd-1',
        timestamp: '2026-09-25T10:15:00-04:00',
        claimKind: 'grade',
        claimRendering: 'explain-back-grade',
        conceptIds: ['concept-a'],
        evidenceBasis: 'basis-1',
        effect: 'held',
        resolves: 'd-0',
      }).success,
    ).toBe(false);
    expect(
      explainBackOfferLogRecordV6.safeParse({
        schemaVersion: 6,
        kind: 'explain-back-declined',
        eventId: 'o-2',
        timestamp: '2026-09-25T10:15:00-04:00',
        conceptIds: ['concept-a'],
        trigger: 'repeated-failure',
      }).success,
    ).toBe(false);
    expect(
      nonAttemptLogRecordV6.safeParse({
        schemaVersion: 6,
        kind: 'non-attempt',
        eventId: 'n-1',
        timestamp: '2026-09-25T10:15:00-04:00',
        conceptIds: ['concept-a'],
        trigger: 'on-demand',
        offerEventId: 'o-1',
      }).success,
    ).toBe(false);
  });
});

describe('masteryAtTime at v6: both axes plus the arithmetic version (MAT-7, [D-087], [D-345])', () => {
  it('write: a full stamp keeps stage, vitality and version for every named concept', () => {
    const parsed = reviewLogRecordV6.parse(reviewLine({ masteryAtTime: fullStamp }));
    expect(parsed.masteryAtTime).toEqual(fullStamp);
  });

  it('read: the v6 union reads the full stamp back, byte for byte', () => {
    const line = JSON.stringify(reviewLine({ masteryAtTime: fullStamp }));
    expect(JSON.stringify(reviewLogEntryV6.parse(JSON.parse(line)))).toBe(line);
  });

  it('vitality uses the registry’s three internal names and nothing else', () => {
    expect(vitalityValue.options).toEqual(['holding', 'tending', 'early']);
    for (const bad of ['needs tending', 'too early to say', 'fading', 'unknown', null]) {
      const stamp = { ...fullStamp, vitalityByConcept: { 'concept-a': bad, 'concept-b': 'early' } };
      expect(reviewLogRecordV6.safeParse(reviewLine({ masteryAtTime: stamp })).success).toBe(false);
    }
  });

  it('the vitality map names exactly the record’s concepts: a missing or an extra key is refused', () => {
    const missing = { ...fullStamp, vitalityByConcept: { 'concept-a': 'holding' } };
    const extra = {
      ...fullStamp,
      vitalityByConcept: { 'concept-a': 'holding', 'concept-b': 'early', 'concept-z': 'early' },
    };
    const m = reviewLogRecordV6.safeParse(reviewLine({ masteryAtTime: missing }));
    const e = reviewLogRecordV6.safeParse(reviewLine({ masteryAtTime: extra }));
    expect(m.success).toBe(false);
    expect(e.success).toBe(false);
    expect(issuePaths(m)).toContain('masteryAtTime.vitalityByConcept');
    expect(issuePaths(e)).toContain('masteryAtTime.vitalityByConcept');
  });

  it('a concept named twice in her order still needs one vitality key', () => {
    const parsed = reviewLogRecordV6.safeParse(
      reviewLine({
        conceptIds: ['concept-a', 'concept-b', 'concept-a'],
        masteryAtTime: fullStamp,
      }),
    );
    expect(parsed.success).toBe(true);
  });

  it('a vitality reading never travels without the version that produced it, nor the version without vitality', () => {
    const { arithmeticVersion: _v, ...vitalityOnly } = fullStamp;
    const { vitalityByConcept: _m, ...versionOnly } = fullStamp;
    const a = reviewLogRecordV6.safeParse(reviewLine({ masteryAtTime: vitalityOnly }));
    const b = reviewLogRecordV6.safeParse(reviewLine({ masteryAtTime: versionOnly }));
    expect(a.success).toBe(false);
    expect(b.success).toBe(false);
    expect(issuePaths(a)).toContain('masteryAtTime.arithmeticVersion');
    expect(issuePaths(b)).toContain('masteryAtTime.vitalityByConcept');
  });

  it('refuses an empty arithmetic version — a version is named or the stamp is the legacy one', () => {
    const stamp = { ...fullStamp, arithmeticVersion: '' };
    expect(reviewLogRecordV6.safeParse(reviewLine({ masteryAtTime: stamp })).success).toBe(false);
  });

  it('the stage map’s own agreement rule is unchanged from v5', () => {
    const stamp = { ...fullStamp, byConcept: { 'concept-a': 'sprout' } };
    expect(issuePaths(reviewLogRecordV6.safeParse(reviewLine({ masteryAtTime: stamp })))).toContain(
      'masteryAtTime.byConcept',
    );
  });
});

describe('explainBackCorrectness at v6: the correctness verdict in its own place ([D-303])', () => {
  const field = { verdict: 'partial', artifactProvenance: provenance };

  it('write: stands on an explain-back review with no depth grade at all', () => {
    const parsed = reviewLogRecordV6.parse(explainBackLine({ explainBackCorrectness: field }));
    expect(parsed.explainBackCorrectness).toEqual(field);
    expect(Object.hasOwn(parsed, 'explainBackGrade')).toBe(false);
  });

  it('read: the v6 union reads it back, byte for byte', () => {
    const line = JSON.stringify(explainBackLine({ explainBackCorrectness: field }));
    expect(JSON.stringify(reviewLogEntryV6.parse(JSON.parse(line)))).toBe(line);
  });

  it('carries its own model and prompt stamp — a verdict without one is refused', () => {
    expect(explainBackCorrectness.safeParse({ verdict: 'correct' }).success).toBe(false);
    expect(
      reviewLogRecordV6.safeParse(
        explainBackLine({ explainBackCorrectness: { verdict: 'correct' } }),
      ).success,
    ).toBe(false);
  });

  it('three verdicts, the same three the nested v5 field holds', () => {
    expect(explainBackCorrectnessVerdict.options).toEqual(['correct', 'partial', 'incorrect']);
    expect(
      reviewLogRecordV6.safeParse(
        explainBackLine({ explainBackCorrectness: { ...field, verdict: 'unknown' } }),
      ).success,
    ).toBe(false);
  });

  it('only on an explain-back review', () => {
    const result = reviewLogRecordV6.safeParse(reviewLine({ explainBackCorrectness: field }));
    expect(result.success).toBe(false);
    expect(issuePaths(result)).toContain('explainBackCorrectness');
  });

  it('never in both places on one record: the nested field is the v5 home, not a second copy', () => {
    const result = reviewLogRecordV6.safeParse(
      explainBackLine({
        explainBackCorrectness: field,
        explainBackGrade: {
          soloLevel: 'relational',
          correctness: 'partial',
          contentRef: 'content-1',
          revisionOf: null,
          artifactProvenance: provenance,
        },
      }),
    );
    expect(result.success).toBe(false);
    expect(issuePaths(result)).toContain('explainBackCorrectness');
  });

  it('beside a strict depth grade that carries no nested verdict, both stand', () => {
    const parsed = reviewLogRecordV6.safeParse(
      explainBackLine({
        explainBackCorrectness: field,
        explainBackGrade: {
          soloLevel: 'relational',
          contentRef: 'content-1',
          revisionOf: null,
          artifactProvenance: { ...provenance, taskId: 'explain-back.solo.v1' },
        },
      }),
    );
    expect(parsed.success).toBe(true);
  });

  it('legacy absent: no key when not recorded, never a default', () => {
    const parsed = reviewLogRecordV6.parse(explainBackLine());
    expect(Object.hasOwn(parsed, 'explainBackCorrectness')).toBe(false);
  });
});

describe('hintOpened at v6 ([D-350])', () => {
  it('write: an explicit true and an explicit false are both kept', () => {
    expect(reviewLogRecordV6.parse(reviewLine({ hintOpened: true })).hintOpened).toBe(true);
    expect(reviewLogRecordV6.parse(reviewLine({ hintOpened: false })).hintOpened).toBe(false);
  });

  it('read: the v6 union reads it back, byte for byte', () => {
    const line = JSON.stringify(reviewLine({ supportLevelShown: 'prompted', hintOpened: false }));
    expect(JSON.stringify(reviewLogEntryV6.parse(JSON.parse(line)))).toBe(line);
  });

  it('legacy absent: no key, so a reader sees unknown — never false, never inferred from the support level', () => {
    const parsed = reviewLogRecordV6.parse(reviewLine({ supportLevelShown: 'prompted' }));
    expect(Object.hasOwn(parsed, 'hintOpened')).toBe(false);
  });

  it('refuses a null or non-boolean placeholder', () => {
    for (const bad of [null, 'false', 0]) {
      expect(reviewLogRecordV6.safeParse(reviewLine({ hintOpened: bad })).success).toBe(false);
    }
  });
});

describe('presentedPassageDigest at v6 ([D-358])', () => {
  it('write: keeps the digest of the passage as presented to her', () => {
    expect(
      reviewLogRecordV6.parse(reviewLine({ presentedPassageDigest: 'sha256:abc' }))
        .presentedPassageDigest,
    ).toBe('sha256:abc');
  });

  it('read: the v6 union reads it back, byte for byte', () => {
    const line = JSON.stringify(reviewLine({ presentedPassageDigest: 'sha256:abc' }));
    expect(JSON.stringify(reviewLogEntryV6.parse(JSON.parse(line)))).toBe(line);
  });

  it('legacy absent: no key, never backfilled', () => {
    expect(Object.hasOwn(reviewLogRecordV6.parse(reviewLine()), 'presentedPassageDigest')).toBe(
      false,
    );
  });

  it('refuses an empty or null placeholder', () => {
    for (const bad of ['', null]) {
      expect(reviewLogRecordV6.safeParse(reviewLine({ presentedPassageDigest: bad })).success).toBe(
        false,
      );
    }
  });
});

describe('suspend reason at v6 ([D-345])', () => {
  function suspendLine(over: Record<string, unknown> = {}) {
    return {
      schemaVersion: 6,
      kind: 'suspend',
      eventId: 's-1',
      timestamp: '2026-09-25T10:15:00-04:00',
      instrumentId: 'qa:1',
      conceptIds: ['concept-a'],
      ...over,
    };
  }

  it('write: each of the three reasons is kept on a suspend event', () => {
    expect(suspensionReason.options).toEqual(['defect', 'source-revision', 'own-choice']);
    for (const reason of suspensionReason.options) {
      expect(suspendLogRecordV6.parse(suspendLine({ reason })).reason).toBe(reason);
    }
  });

  it('read: the v6 union reads it back, byte for byte', () => {
    const line = JSON.stringify(suspendLine({ reason: 'source-revision' }));
    expect(JSON.stringify(reviewLogEntryV6.parse(JSON.parse(line)))).toBe(line);
  });

  it('legacy absent: no key — unknown, never presented as her choice or as a defect', () => {
    expect(Object.hasOwn(suspendLogRecordV6.parse(suspendLine()), 'reason')).toBe(false);
  });

  it('absence is the only unknown, and forgetting is never a reason (nothing encodes a revoked award)', () => {
    for (const bad of ['unknown', 'forgetting', 'revoked', '', null]) {
      expect(suspendLogRecordV6.safeParse(suspendLine({ reason: bad })).success).toBe(false);
    }
  });

  it('only a suspend carries one: an unsuspend returns an instrument to standing and says no why', () => {
    const result = suspendLogRecordV6.safeParse(
      suspendLine({ kind: 'unsuspend', reason: 'own-choice' }),
    );
    expect(result.success).toBe(false);
    expect(issuePaths(result)).toContain('reason');
    expect(suspendLogRecordV6.safeParse(suspendLine({ kind: 'unsuspend' })).success).toBe(true);
  });
});

describe('compositionId at v6 ([D-395])', () => {
  it('write: keeps the id of the composition record that served the review', () => {
    expect(
      reviewLogRecordV6.parse(reviewLine({ compositionId: 'composition-7' })).compositionId,
    ).toBe('composition-7');
  });

  it('read: the v6 union reads it back, byte for byte, beside every other v6 field', () => {
    const line = JSON.stringify(
      reviewLine({
        masteryAtTime: fullStamp,
        hintOpened: true,
        presentedPassageDigest: 'sha256:abc',
        compositionId: 'composition-7',
      }),
    );
    expect(JSON.stringify(reviewLogEntryV6.parse(JSON.parse(line)))).toBe(line);
  });

  it('legacy absent, and absent outside a composed session: no key, never synthesised', () => {
    expect(Object.hasOwn(reviewLogRecordV6.parse(reviewLine()), 'compositionId')).toBe(false);
    const line = JSON.stringify(reviewLine());
    expect(JSON.stringify(reviewLogEntryV6.parse(JSON.parse(line)))).toBe(line);
  });

  it('refuses an empty or null placeholder — absence is the only unknown', () => {
    for (const bad of ['', null, 7]) {
      expect(reviewLogRecordV6.safeParse(reviewLine({ compositionId: bad })).success).toBe(false);
    }
  });
});

describe('readExplainBackCorrectness: top-level first, legacy nested second ([D-386])', () => {
  const depthStamp = { ...provenance, taskId: 'explain-back.solo.v1', modelId: 'depth-model' };
  const nestedGrade = (correctness?: string) => ({
    soloLevel: 'relational',
    ...(correctness === undefined ? {} : { correctness }),
    contentRef: 'content-1',
    revisionOf: null,
    artifactProvenance: depthStamp,
  });

  it('a top-level verdict reads with its own stamp', () => {
    const record = reviewLogRecordV6.parse(
      explainBackLine({
        explainBackCorrectness: { verdict: 'partial', artifactProvenance: provenance },
        explainBackGrade: nestedGrade(),
      }),
    );
    expect(readExplainBackCorrectness(record)).toEqual({
      verdict: 'partial',
      source: 'top-level',
      provenance,
    });
  });

  it('a legacy nested verdict reads the same verdict with provenance unknown — the depth stamp is never borrowed', () => {
    const record = reviewLogRecordV6.parse(
      explainBackLine({ explainBackGrade: nestedGrade('correct') }),
    );
    const reading = readExplainBackCorrectness(record);
    expect(reading).toEqual({ verdict: 'correct', source: 'legacy-nested', provenance: 'unknown' });
    expect(JSON.stringify(reading)).not.toContain('depth-model');
  });

  it('the same reading from the v5 record and from the v6 record it restamps to', () => {
    for (const verdict of explainBackCorrectnessVerdict.options) {
      const v5 = reviewLogRecordV5.parse({
        ...explainBackLine({ explainBackGrade: nestedGrade(verdict) }),
        schemaVersion: 5,
      });
      const v6 = reviewLogRecordV6.parse({ ...v5, schemaVersion: 6 });
      expect(readExplainBackCorrectness(v6)).toEqual(readExplainBackCorrectness(v5));
      expect(readExplainBackCorrectness(v6)?.verdict).toBe(verdict);
    }
  });

  it('neither recorded reads undefined — unknown, never correct', () => {
    expect(readExplainBackCorrectness(reviewLogRecordV6.parse(explainBackLine()))).toBeUndefined();
    expect(
      readExplainBackCorrectness(
        reviewLogRecordV6.parse(explainBackLine({ explainBackGrade: nestedGrade() })),
      ),
    ).toBeUndefined();
  });

  it('no record carrying both can be produced through the v6 schema, so the order is never a tie-break', () => {
    // Every writer and the upgrade hop produce records through `.parse`, and
    // the schema refuses both at once; the order only matters for an
    // unvalidated object, where the top-level field wins.
    const both = explainBackLine({
      explainBackCorrectness: { verdict: 'incorrect', artifactProvenance: provenance },
      explainBackGrade: nestedGrade('correct'),
    });
    expect(reviewLogRecordV6.safeParse(both).success).toBe(false);
    expect(reviewLogEntryV6.safeParse(both).success).toBe(false);
    expect(
      readExplainBackCorrectness(
        both as unknown as Parameters<typeof readExplainBackCorrectness>[0],
      )?.source,
    ).toBe('top-level');
  });
});

describe('an old-shape log round-trips v5 → v6 → v5 with nothing rewritten and nothing manufactured ([D-386], [D-395])', () => {
  // A v5 day as a v5 build wrote it: stage-only mastery stamps, a nested
  // correctness verdict of each kind (one on a record with a support level
  // shown), a depth grade with no verdict, a suspension with no reason and a
  // verdict event. Each line is the exact string a v5 writer emits.
  const nested = (correctness: string | undefined, id: string) => ({
    soloLevel: 'multistructural',
    ...(correctness === undefined ? {} : { correctness }),
    contentRef: `content-${id}`,
    revisionOf: null,
    artifactProvenance: { ...provenance, taskId: 'explain-back.solo.v1' },
  });
  const v5Log = [
    reviewLine({
      schemaVersion: 5,
      eventId: 'old-1',
      masteryAtTime: {
        attribution: 'per-concept',
        byConcept: { 'concept-a': 'sprout', 'concept-b': 'seed' },
      },
    }),
    explainBackLine({
      schemaVersion: 5,
      eventId: 'old-2',
      masteryAtTime: { attribution: 'per-concept', byConcept: { 'concept-a': 'sprout' } },
      supportLevelShown: 'prompted',
      explainBackGrade: nested('correct', '2'),
    }),
    explainBackLine({
      schemaVersion: 5,
      eventId: 'old-3',
      explainBackGrade: nested('partial', '3'),
    }),
    explainBackLine({
      schemaVersion: 5,
      eventId: 'old-4',
      explainBackGrade: nested('incorrect', '4'),
    }),
    explainBackLine({
      schemaVersion: 5,
      eventId: 'old-5',
      explainBackGrade: nested(undefined, '5'),
    }),
    {
      schemaVersion: 5,
      kind: 'suspend',
      eventId: 'old-6',
      timestamp: '2026-09-25T10:20:00-04:00',
      instrumentId: 'qa:concept-a:1',
      conceptIds: ['concept-a'],
    },
    {
      schemaVersion: 5,
      kind: 'verdict',
      eventId: 'old-7',
      timestamp: '2026-09-25T10:25:00-04:00',
      instrumentId: 'qa:concept-a:1',
      instrumentType: 'qa',
      conceptIds: ['concept-a'],
      verdict: 'accepted',
      artifactProvenance: provenance,
    },
  ].map((record) => JSON.stringify(record));

  /** The pure restamp the v5 → v6 hop is documented to be: version only, through `.parse`. */
  const restamp = (line: string) =>
    reviewLogEntryV6.parse({ ...reviewLogEntryV5.parse(JSON.parse(line)), schemaVersion: 6 });

  /** Every key path in a JSON value, array indices collapsed — "what keys exist, at any depth". */
  function keyPaths(value: unknown, prefix = ''): string[] {
    if (Array.isArray(value)) return value.flatMap((item) => keyPaths(item, `${prefix}[]`));
    if (typeof value !== 'object' || value === null) return [];
    return Object.entries(value).flatMap(([key, inner]) => [
      `${prefix}${key}`,
      ...keyPaths(inner, `${prefix}${key}.`),
    ]);
  }

  it('every line is a valid v5 line as written (the fixture is genuinely old-shape)', () => {
    for (const line of v5Log) {
      expect(JSON.stringify(reviewLogEntryV5.parse(JSON.parse(line)))).toBe(line);
    }
  });

  it('v5 → v6 changes the version digit and nothing else, byte for byte', () => {
    for (const line of v5Log) {
      expect(JSON.stringify(restamp(line))).toBe(
        line.replace('"schemaVersion":5', '"schemaVersion":6'),
      );
    }
  });

  it('v6 → v5 gives back the original line: nothing recorded was rewritten or dropped', () => {
    for (const line of v5Log) {
      const back = reviewLogEntryV5.parse({ ...restamp(line), schemaVersion: 5 });
      expect(JSON.stringify(back)).toBe(line);
    }
  });

  it('no key appears at any depth that the v5 line did not hold — no provenance, date, stamp or composition link is manufactured', () => {
    for (const line of v5Log) {
      expect(keyPaths(restamp(line)).sort()).toEqual(keyPaths(JSON.parse(line)).sort());
    }
    const upgraded = v5Log.map(restamp);
    for (const key of [
      'explainBackCorrectness',
      'compositionId',
      'hintOpened',
      'presentedPassageDigest',
      'reason',
    ]) {
      expect(upgraded.some((record) => Object.hasOwn(record, key))).toBe(false);
    }
    for (const record of upgraded) {
      if (record.kind !== 'review' || record.masteryAtTime?.attribution !== 'per-concept') continue;
      expect(Object.keys(record.masteryAtTime).sort()).toEqual(['attribution', 'byConcept']);
    }
  });

  it('every nested verdict reads the same after the upgrade, with provenance unknown on both sides', () => {
    const before = v5Log.map((line) =>
      readExplainBackCorrectness(reviewLogEntryV5.parse(JSON.parse(line)) as never),
    );
    const after = v5Log.map((line) => readExplainBackCorrectness(restamp(line) as never));
    expect(after).toEqual(before);
    expect(after.map((reading) => reading?.verdict)).toEqual([
      undefined,
      'correct',
      'partial',
      'incorrect',
      undefined,
      undefined,
      undefined,
    ]);
    for (const reading of after) {
      if (reading !== undefined) expect(reading.provenance).toBe('unknown');
    }
  });
});
