/**
 * `createLocalGroveProvider`'s own mastery reading — `[D-338]` interim fix
 * (`olea-service`'s `ol-egov.141.89.9.14`).
 *
 * The grove's per-concept `state` is read straight off `buildRegistryModel`
 * (`../../src/grove/provider.ts`'s own module doc: "this module computes
 * nothing new about mastery"), so `packages/core/src/registry/
 * build.invalid-instruments.spec.ts`'s fix — `buildRegistryModel` no longer
 * reads `suspendedInstrumentIds` into the mastery fold's
 * `invalidInstrumentIds` — reaches the grove for free. This file proves that
 * end to end, through the real provider, over a real vault walk: suspension
 * alone (however it was written — the citation-revision tick, or her own
 * withdrawal; the log cannot tell the two apart, `docs/dev/intelligence-
 * build/att.md` item 2 in `olea-service`) no longer takes back a top-stage
 * cell, while a `verdict: 'rejected'` record — a real refusal — still does.
 *
 * Fixture shape matches `provider.spec.ts`'s own `fixtureVaultWithRegistered
 * Source` (a registered objectives doc plus one concept note); every course
 * code and concept name below is invented (INV-3).
 */
import {
  appendDisputeRecord,
  appendReviewLogRecord,
  appendSuspendRecord,
  appendVerdictRecord,
  contestClaim,
  enumerateVaultInstruments,
  resolveDispute,
} from 'olea-core';
import { describe, expect, it } from 'vitest';
import { createLocalGroveProvider } from '../../src/grove/provider.js';
import type { GroveCourseSection, GroveViewState } from '../../src/grove/view.js';
import type { ObsidianDataHost } from '../../src/plan/settings-store.js';
import { memoryVault } from '../review/memory-vault.js';

const DEVICE = 'olea-testdevice1';
const NOW = new Date('2026-09-01T09:00:00Z');

class FakeDataHost implements ObsidianDataHost {
  blob: unknown = null;

  async loadData(): Promise<unknown> {
    return this.blob;
  }

  async saveData(data: unknown): Promise<void> {
    this.blob = data;
  }
}

function fixtureVault() {
  return memoryVault({
    '03 Research/Objectives.md': [
      '---',
      'role: objectives',
      'course: TESTC101',
      '---',
      '',
      'The course covers Concept A in depth.',
      '',
    ].join('\n'),
    'Notes/one.md': [
      '---',
      'topic: [Concept A]',
      'course: TESTC101',
      '---',
      '',
      'Front::Back',
      '',
    ].join('\n'),
  });
}

async function conceptACell(vault: ReturnType<typeof fixtureVault>) {
  const provider = createLocalGroveProvider({
    vault,
    deviceId: DEVICE,
    settingsHost: new FakeDataHost(),
    now: () => NOW,
  });
  const state: GroveViewState = await provider.load();
  if (state.kind !== 'model') throw new Error(`expected a model, got ${state.kind}`);
  const section: GroveCourseSection | undefined = state.courses.find(
    (c) => c.course === 'TESTC101',
  );
  if (section === undefined) throw new Error('missing TESTC101 section');
  if (section.model.status !== 'declared') {
    throw new Error(`expected TESTC101 declared, got ${section.model.status}`);
  }
  const cell = section.model.cells.find((c) => c.conceptName === 'Concept A');
  if (cell === undefined) throw new Error('missing Concept A cell');
  return cell;
}

/** Writes the qualifying explain-back attempt and returns the real minted instrument id. */
async function seedQualifyingAttempt(vault: ReturnType<typeof fixtureVault>) {
  // Stamped, as the provider's own walk is (`[D-357]`): the attempt is logged under the
  // concept's permanent key, the key a real review carries.
  const enumeration = await enumerateVaultInstruments(vault, {
    concepts: { stampConceptKeys: true },
  });
  const instrument = enumeration.records[0];
  if (instrument === undefined) throw new Error('missing instrument');
  const conceptIds = [...instrument.conceptIds];

  await appendReviewLogRecord(
    vault,
    {
      timestamp: '2026-08-01T09:00:00-04:00',
      instrumentId: instrument.instrumentId,
      instrumentType: 'explain-back',
      conceptIds,
      rating: null,
      wasUnsure: false,
      durationMs: 4000,
      selectionContext: {
        dueState: 'due',
        examProximity: null,
        yieldRank: null,
        instrumentTypesOffered: ['explain-back'],
        planVersion: null,
      },
      supportLevelShown: 'independent',
      explainBackGrade: {
        soloLevel: 'relational',
        correctness: 'correct',
        contentRef: 'content-ref-1',
        revisionOf: null,
        artifactProvenance: { taskId: 'task-1', promptVersion: 'v1', modelId: 'model-1' },
      },
    },
    { deviceId: DEVICE, generateEventId: () => 'eb-1' },
  );

  return { instrumentId: instrument.instrumentId, conceptIds };
}

/**
 * Opens a `[D-095]` dispute against the instrument's grade and resolves it —
 * `outcome` defaults to `corrected`, `[D-338]` item 2's grade-half signal
 * (`ol-egov.141.89.9.23`). Both records are appended for real, exercising
 * `disputesFromFiles`'s own re-read of the same review-log files
 * `readReviewLogHistory` already walked.
 */
async function seedContestedGradeDispute(
  vault: ReturnType<typeof fixtureVault>,
  instrumentId: string,
  conceptIds: readonly string[],
  outcome: 'upheld' | 'corrected' = 'corrected',
): Promise<void> {
  const opening = contestClaim({
    claim: {
      rendering: 'explain-back-grade',
      conceptIds,
      instrumentId,
      evidenceBasis: 'evidence-fingerprint-1',
    },
    timestamp: '2026-08-16T09:00:00-04:00',
  });
  const { record: openingRecord } = await appendDisputeRecord(vault, opening.record, {
    deviceId: DEVICE,
    generateEventId: () => 'dispute-1',
  });
  const resolution = resolveDispute({
    dispute: openingRecord,
    outcome,
    timestamp: '2026-08-17T09:00:00-04:00',
  });
  await appendDisputeRecord(vault, resolution, {
    deviceId: DEVICE,
    generateEventId: () => 'dispute-2',
  });
}

describe('createLocalGroveProvider — [D-338]: suspension alone never retracts the top stage', () => {
  it('a qualifying explain-back attempt reads `tree`, and suspending the instrument it rode afterwards — as the citation-revision tick writes, or as her own withdrawal writes — KEEPS `tree`', async () => {
    const vault = fixtureVault();
    const { instrumentId, conceptIds } = await seedQualifyingAttempt(vault);

    const beforeSuspend = await conceptACell(vault);
    expect(beforeSuspend.state).toBe('tree');

    await appendSuspendRecord(
      vault,
      {
        kind: 'suspend',
        timestamp: '2026-08-15T09:00:00-04:00',
        instrumentId,
        conceptIds,
      },
      { deviceId: DEVICE, generateEventId: () => 'suspend-1' },
    );

    const afterSuspend = await conceptACell(vault);
    expect(afterSuspend.state).toBe('tree');
  });

  it('the SAME attempt, once its instrument carries a `rejected` verdict — a real refusal, not a mere suspend — no longer reads the top stage', async () => {
    const vault = fixtureVault();
    const { instrumentId, conceptIds } = await seedQualifyingAttempt(vault);

    const beforeReject = await conceptACell(vault);
    expect(beforeReject.state).toBe('tree');

    await appendVerdictRecord(
      vault,
      {
        instrumentId,
        instrumentType: 'qa',
        conceptIds,
        timestamp: '2026-08-15T09:00:00-04:00',
        verdict: 'rejected',
        artifactProvenance: { taskId: 'task-1', promptVersion: 'v1', modelId: 'model-1' },
      },
      { deviceId: DEVICE, generateEventId: () => 'verdict-1' },
    );

    const afterReject = await conceptACell(vault);
    expect(afterReject.state).not.toBe('tree');
    expect(afterReject.state).toBe('sprout');
  });

  it('the SAME attempt, once a `[D-095]` dispute against its grade resolves `corrected` — the identical today-unambiguous "found defective" shape a `rejected` verdict already is (`[D-338]` item 2, `ol-egov.141.89.9.23`) — no longer reads the top stage', async () => {
    const vault = fixtureVault();
    const { instrumentId, conceptIds } = await seedQualifyingAttempt(vault);

    const beforeDispute = await conceptACell(vault);
    expect(beforeDispute.state).toBe('tree');

    await seedContestedGradeDispute(vault, instrumentId, conceptIds, 'corrected');

    const afterCorrected = await conceptACell(vault);
    expect(afterCorrected.state).not.toBe('tree');
    expect(afterCorrected.state).toBe('sprout');
  });

  it('the SAME contest resolved `upheld` instead — the grading was checked and held, nothing found defective — KEEPS the top stage', async () => {
    const vault = fixtureVault();
    const { instrumentId, conceptIds } = await seedQualifyingAttempt(vault);

    await seedContestedGradeDispute(vault, instrumentId, conceptIds, 'upheld');

    const afterUpheld = await conceptACell(vault);
    expect(afterUpheld.state).toBe('tree');
  });
});
