import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { isSameAsLinkRecord, listSameAsLinkRecords } from '../concept/same-as.js';
import { FolderSource } from '../vault/folder-source.js';
import {
  confirmOutcomeConceptNearMatch,
  declineOutcomeConceptNearMatch,
  isOutcomeConceptNearMatchRecord,
  listOutcomeConceptNearMatchRecords,
  outcomeConceptNearMatchRecordPath,
  proposeOutcomeConceptNearMatch,
} from './near-match.js';

// Scenarios: olea-service/features/F8-concepts-scope.md — "[OUT-4] Outcome-to-concept near match:
// its own proposal record, never a same-as link ([D-256])", tagged
// `@auto:core/outcome/near-match.spec`.

describe('proposeOutcomeConceptNearMatch — its own record, never a same-as link ([D-256])', () => {
  let root: string;
  let source: FolderSource;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'olea-outcome-near-match-'));
    source = new FolderSource(root);
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it('writes a proposed record when none exists, directed outcome-first, never sorted', async () => {
    const record = await proposeOutcomeConceptNearMatch(
      source,
      'outcome-key1:a',
      'concept-key1:z',
      {
        now: () => '2026-09-18',
      },
    );
    expect(record.status).toBe('proposed');
    expect(record.outcomeId).toBe('outcome-key1:a');
    expect(record.conceptKey).toBe('concept-key1:z');
    expect(record.reason).toBe('token-set-containment');
    expect(record.proposedAt).toBe('2026-09-18');

    const records = await listOutcomeConceptNearMatchRecords(source);
    expect(records).toHaveLength(1);
    expect(isOutcomeConceptNearMatchRecord(records[0]?.record)).toBe(true);
  });

  it('is idempotent — proposing an already-proposed pair writes nothing new and does not change proposedAt', async () => {
    const first = await proposeOutcomeConceptNearMatch(source, 'outcome-key1:a', 'concept-key1:z', {
      now: () => '2026-09-18',
    });
    const second = await proposeOutcomeConceptNearMatch(
      source,
      'outcome-key1:a',
      'concept-key1:z',
      {
        now: () => '2026-09-19',
      },
    );
    expect(second).toEqual(first);
  });

  it('bias to resolution: a CONFIRMED pair is left untouched, never re-proposed', async () => {
    await proposeOutcomeConceptNearMatch(source, 'outcome-key1:a', 'concept-key1:z');
    const confirmed = await confirmOutcomeConceptNearMatch(
      source,
      'outcome-key1:a',
      'concept-key1:z',
    );
    const reproposed = await proposeOutcomeConceptNearMatch(
      source,
      'outcome-key1:a',
      'concept-key1:z',
    );
    expect(reproposed).toEqual(confirmed);
    expect(reproposed.status).toBe('confirmed');
  });

  it('a DECLINED pair is left declined, never automatically re-proposed', async () => {
    await proposeOutcomeConceptNearMatch(source, 'outcome-key1:a', 'concept-key1:z');
    const declined = await declineOutcomeConceptNearMatch(
      source,
      'outcome-key1:a',
      'concept-key1:z',
    );
    const reproposed = await proposeOutcomeConceptNearMatch(
      source,
      'outcome-key1:a',
      'concept-key1:z',
    );
    expect(reproposed.status).toBe('declined');
    expect(reproposed).toEqual(declined);
  });

  it('the automatic path never produces a confirmed or declined record on its own', async () => {
    const record = await proposeOutcomeConceptNearMatch(source, 'outcome-key1:a', 'concept-key1:z');
    expect(record.status).toBe('proposed');
  });

  it('never writes into the same-as folder — a confirmed near match is invisible to the identity read consumer', async () => {
    await proposeOutcomeConceptNearMatch(source, 'outcome-key1:a', 'concept-key1:z');
    await confirmOutcomeConceptNearMatch(source, 'outcome-key1:a', 'concept-key1:z');

    const sameAsRecords = await listSameAsLinkRecords(source);
    expect(sameAsRecords).toHaveLength(0);
    // Also true of the raw file layout: no `.olea/same-as/` writer is ever exercised here, so
    // `isSameAsLinkRecord` never even gets a candidate to accept or reject.
    expect(sameAsRecords.every(({ record }) => isSameAsLinkRecord(record))).toBe(true);
  });
});

describe('confirmOutcomeConceptNearMatch / declineOutcomeConceptNearMatch — explicit, never automatic, no severed state', () => {
  let root: string;
  let source: FolderSource;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'olea-outcome-near-match-confirm-'));
    source = new FolderSource(root);
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it('throws confirming a pair with no proposal', async () => {
    await expect(
      confirmOutcomeConceptNearMatch(source, 'outcome-key1:a', 'concept-key1:z'),
    ).rejects.toThrow(/no proposed near-match record/);
  });

  it('throws declining a pair with no proposal', async () => {
    await expect(
      declineOutcomeConceptNearMatch(source, 'outcome-key1:a', 'concept-key1:z'),
    ).rejects.toThrow(/no proposed near-match record/);
  });

  it('throws confirming an already-declined pair — declined is terminal', async () => {
    await proposeOutcomeConceptNearMatch(source, 'outcome-key1:a', 'concept-key1:z');
    await declineOutcomeConceptNearMatch(source, 'outcome-key1:a', 'concept-key1:z');
    await expect(
      confirmOutcomeConceptNearMatch(source, 'outcome-key1:a', 'concept-key1:z'),
    ).rejects.toThrow(/already declined/);
  });

  it('throws declining an already-confirmed pair — confirmed is terminal', async () => {
    await proposeOutcomeConceptNearMatch(source, 'outcome-key1:a', 'concept-key1:z');
    await confirmOutcomeConceptNearMatch(source, 'outcome-key1:a', 'concept-key1:z');
    await expect(
      declineOutcomeConceptNearMatch(source, 'outcome-key1:a', 'concept-key1:z'),
    ).rejects.toThrow(/already confirmed/);
  });

  it('confirming keeps both the outcome id and the concept key, unsorted', async () => {
    await proposeOutcomeConceptNearMatch(source, 'outcome-key1:a', 'concept-key1:z');
    const confirmed = await confirmOutcomeConceptNearMatch(
      source,
      'outcome-key1:a',
      'concept-key1:z',
      {
        now: () => '2026-09-18',
      },
    );
    expect(confirmed.outcomeId).toBe('outcome-key1:a');
    expect(confirmed.conceptKey).toBe('concept-key1:z');
    expect(confirmed.confirmedAt).toBe('2026-09-18');
  });

  it('declining sets declinedAt and leaves confirmedAt absent', async () => {
    await proposeOutcomeConceptNearMatch(source, 'outcome-key1:a', 'concept-key1:z');
    const declined = await declineOutcomeConceptNearMatch(
      source,
      'outcome-key1:a',
      'concept-key1:z',
      {
        now: () => '2026-09-18',
      },
    );
    expect(declined.declinedAt).toBe('2026-09-18');
    expect(declined.confirmedAt).toBeUndefined();
  });

  it('the record path is directed — swapping outcome id and concept key is a different pair, not the same pair reordered', () => {
    expect(outcomeConceptNearMatchRecordPath('outcome-key1:a', 'concept-key1:z')).not.toBe(
      outcomeConceptNearMatchRecordPath('concept-key1:z', 'outcome-key1:a'),
    );
  });
});
