/**
 * `createVaultScopeSource` — `[D-281]` item 4 reaches this fold too
 * (`ol-vrlp`, `[DOS-C5b]`).
 *
 * `packages/core/src/registry/build.invalid-instruments.spec.ts` proves the
 * OTHER production caller (`buildRegistryModel`) derives
 * `MasteryRollupOptions.invalidInstrumentIds` from the registry's own
 * withdrawn-instrument projection. This file proves the same thing end to
 * end through THIS module's own fold (`../../src/today/data-source.ts`'s
 * `createVaultScopeSource`, wired for real from `main.ts`) — over a real
 * vault walk plus a real review-log read, not a fixture map of pre-computed
 * mastery — since before this bead, that call site passed
 * `computeAllConceptMastery` no options at all, and a withdrawn instrument's
 * qualifying attempt kept reading `tree`.
 *
 * Fixture shape matches `data-source.spec.ts`'s own `createVaultScopeSource`
 * suite (`fixtureVaultWithRegisteredSource`-style: a registered objectives
 * doc plus one concept note) — every course code and concept name below is
 * invented (INV-3).
 */
import { appendReviewLogRecord, appendSuspendRecord, enumerateVaultInstruments } from 'olea-core';
import { describe, expect, it } from 'vitest';
import { createVaultScopeSource } from '../../src/today/data-source.js';
import { memoryVault } from '../review/memory-vault.js';

const DEVICE = 'olea-testdevice1';
const NOW = new Date('2026-09-01T09:00:00Z');

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
  const source = createVaultScopeSource({ vault, deviceId: DEVICE, now: () => NOW });
  const models = await source.listCourseGroveModels();
  const course = (models ?? []).find((model) => model.course === 'TESTC101');
  if (course === undefined || course.status !== 'declared') {
    throw new Error(`expected TESTC101 declared, got ${course?.status}`);
  }
  const cell = course.cells.find((c) => c.conceptName === 'Concept A');
  if (cell === undefined) throw new Error('missing Concept A cell');
  return cell;
}

describe('createVaultScopeSource — [D-281] item 4 reaches this fold too (ol-vrlp)', () => {
  it('a qualifying explain-back attempt reaches `tree`, and withdrawing (F8.5) the instrument it rode drops it back — same instrument, same log, only its CURRENT standing changed', async () => {
    const vault = fixtureVault();

    // The real instrument id the vault walk mints for the "Front::Back" card
    // — read the same way `createVaultScopeSource` itself does, rather than
    // guessed or hardcoded.
    const enumeration = await enumerateVaultInstruments(vault);
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

    const beforeWithdrawal = await conceptACell(vault);
    expect(beforeWithdrawal.state).toBe('tree');

    await appendSuspendRecord(
      vault,
      {
        kind: 'suspend',
        timestamp: '2026-08-15T09:00:00-04:00',
        instrumentId: instrument.instrumentId,
        conceptIds,
      },
      { deviceId: DEVICE, generateEventId: () => 'suspend-1' },
    );

    const afterWithdrawal = await conceptACell(vault);
    expect(afterWithdrawal.state).not.toBe('tree');
    expect(afterWithdrawal.state).toBe('sprout');
  });
});
