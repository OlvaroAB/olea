/**
 * `ol-3ux7.5.57.104` — the merged misconception read honours the validity fold
 * (`[D-338]` item 3: a rejected instrument's evidence counts in no current reading;
 * the repairability rule is "reject-as-defective, excluding evidence at read time").
 *
 * The rejection is written by the registry's production path (`rejectWithheldItem` appends a
 * `rejected` verdict through `appendVerdictRecord`); this suite appends the same record through
 * the same writer, into an in-memory vault, and reads through the real store.
 *
 * Synthetic fixtures only (INV-3): invented concept ids and wording.
 */

import { appendVerdictRecord } from 'olea-core';
import { describe, expect, it } from 'vitest';
import { createVaultMisconceptionStore } from '../../src/misconception/store.js';
import { memoryVault } from '../review/memory-vault.js';

const DEVICE = 'olea-testdevice1';
const REVIEW_LOG = `.olea/reviews/2026-08-10.${DEVICE}.jsonl`;
const REJECTED = 'mcq:concept-alpha:1';
const KEPT = 'mcq:concept-beta:1';
const CONTESTED = 'mcq:concept-gamma:1';

function pickLine(eventId: string, instrumentId: string, conceptId: string): string {
  return `${JSON.stringify({
    schemaVersion: 5,
    kind: 'misconception-observed',
    eventId,
    timestamp: '2026-08-10T09:00:00-04:00',
    instrumentId,
    conceptIds: [conceptId],
    reviewEventId: `review-${eventId}`,
    misconceptionId: `minted-${eventId}`,
    distractor: {
      text: 'Y always follows X',
      believes: `Believes X always implies Y (${conceptId}).`,
      source_says: 'X implies Y only under condition Z.',
    },
  })}\n`;
}

function openContestLine(instrumentId: string, conceptId: string): string {
  return `${JSON.stringify({
    schemaVersion: 6,
    kind: 'dispute',
    eventId: 'contest-open-1',
    timestamp: '2026-08-10T09:30:00-04:00',
    claimKind: 'grade',
    claimRendering: 'explain-back-grade',
    conceptIds: [conceptId],
    instrumentId,
    evidenceBasis: 'evidence-fingerprint-1',
    effect: 'quarantined',
  })}\n`;
}

const ALL_PICKS =
  pickLine('p-rejected', REJECTED, 'Concept Alpha') +
  pickLine('p-kept', KEPT, 'Concept Beta') +
  pickLine('p-contested', CONTESTED, 'Concept Gamma');

function storeOver(vault: ReturnType<typeof memoryVault>) {
  return createVaultMisconceptionStore({
    vault,
    deviceId: DEVICE,
    now: () => new Date('2026-08-10T12:00:00-04:00'),
  });
}

async function reject(vault: ReturnType<typeof memoryVault>, instrumentId: string) {
  await appendVerdictRecord(
    vault,
    {
      timestamp: '2026-08-10T10:00:00-04:00',
      instrumentId,
      instrumentType: 'mcq',
      conceptIds: ['Concept Alpha'],
      verdict: 'rejected',
    },
    { deviceId: DEVICE },
  );
}

describe('the merged misconception read excludes a rejected instrument (ol-3ux7.5.57.104, D-338)', () => {
  it('drops a pick on an instrument later rejected, and keeps the others', async () => {
    const vault = memoryVault({ [REVIEW_LOG]: ALL_PICKS });
    await reject(vault, REJECTED);

    const records = await storeOver(vault).load();
    const concepts = (records ?? []).map((record) => record.conceptId).sort();
    expect(concepts).toEqual(['Concept Beta', 'Concept Gamma']);
  });

  it('keeps the same pick when nothing was rejected', async () => {
    const vault = memoryVault({ [REVIEW_LOG]: ALL_PICKS });

    const records = await storeOver(vault).load();
    expect((records ?? []).map((record) => record.conceptId).sort()).toEqual([
      'Concept Alpha',
      'Concept Beta',
      'Concept Gamma',
    ]);
  });

  it('leaves a pick on an instrument whose grade is contested but not rejected', async () => {
    const vault = memoryVault({
      [REVIEW_LOG]: ALL_PICKS + openContestLine(CONTESTED, 'Concept Gamma'),
    });

    const records = await storeOver(vault).load();
    expect((records ?? []).map((record) => record.conceptId)).toContain('Concept Gamma');
  });

  it('does not touch the review log: the rejected pick stays in it as history', async () => {
    const vault = memoryVault({ [REVIEW_LOG]: ALL_PICKS });
    await reject(vault, REJECTED);
    await storeOver(vault).load();

    const log = await vault.read(REVIEW_LOG);
    expect(log.startsWith(ALL_PICKS)).toBe(true);
    expect(log).toContain('"eventId":"p-rejected"');
  });
});
