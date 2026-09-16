import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { FolderSource } from '../vault/folder-source.js';
import type { VaultPath } from '../vault/types.js';
import {
  attachConceptToOutcome,
  isOutcomeRecord,
  listOutcomeRecords,
  mintOpaqueOutcomeId,
  OPAQUE_OUTCOME_ID_PREFIX,
  OUTCOME_STORE_FOLDER,
  outcomeRecordPath,
  resolveOutcome,
  retireOutcome,
} from './store.js';

// Scenarios: olea-service/features/F4-oracle.md — "Outcome record: mint once, read back
// thereafter (F4.1, [ONT-R5], [D-253 / OUT-1])", tagged `@auto:core/outcome/store.spec`.

const SOURCE = { path: '02 Assignments/Objectives.md' as VaultPath, blockIndex: 3 };
const PROVENANCE = { promptVersion: 'v1', modelVersion: 'model-a' };

describe('resolveOutcome — mint once, read back thereafter', () => {
  let root: string;
  let source: FolderSource;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'olea-outcome-store-'));
    source = new FolderSource(root);
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it('mints and persists a new record when no existing one matches', async () => {
    const record = await resolveOutcome(
      source,
      {
        courses: ['COURSEB', 'COURSEA'],
        source: SOURCE,
        label: 'Explain X',
        provenance: PROVENANCE,
      },
      { now: () => '2026-09-16' },
    );

    expect(record.courses).toEqual(['COURSEA', 'COURSEB']);
    expect(record.label).toBe('Explain X');
    expect(record.conceptKeys).toEqual([]);
    expect(record.status).toBe('active');
    expect(record.mintedAt).toBe('2026-09-16');
    expect(record.schemaVersion).toBe(1);

    const records = await listOutcomeRecords(source);
    expect(records).toHaveLength(1);
    expect(records[0]?.record.id).toBe(record.id);
    expect(records[0]?.path).toBe(outcomeRecordPath(record.id));
  });

  it('`[D-253]`: threads extractorSelfRating through verbatim when the caller supplies one', async () => {
    const record = await resolveOutcome(source, {
      courses: ['COURSEA'],
      source: SOURCE,
      label: 'Explain X',
      provenance: PROVENANCE,
      extractorSelfRating: 0.73,
    });

    expect(record.extractorSelfRating).toBe(0.73);
    const [persisted] = await listOutcomeRecords(source);
    expect(persisted?.record.extractorSelfRating).toBe(0.73);
  });

  it('`[D-253]`: omits extractorSelfRating entirely (never `undefined`) when the caller supplies none', async () => {
    const record = await resolveOutcome(source, {
      courses: ['COURSEA'],
      source: SOURCE,
      label: 'Explain X',
      provenance: PROVENANCE,
    });

    expect('extractorSelfRating' in record).toBe(false);
    const [persisted] = await listOutcomeRecords(source);
    expect(persisted !== undefined && 'extractorSelfRating' in persisted.record).toBe(false);
  });

  it('`[D-253]`: a re-extraction with a different self-rating never overwrites the stored one (conservation)', async () => {
    const first = await resolveOutcome(source, {
      courses: ['COURSEA'],
      source: SOURCE,
      label: 'Explain X',
      provenance: PROVENANCE,
      extractorSelfRating: 0.6,
    });
    const second = await resolveOutcome(source, {
      courses: ['COURSEA'],
      source: SOURCE,
      label: 'Explain X (re-extracted)',
      provenance: PROVENANCE,
      extractorSelfRating: 0.95,
    });

    expect(second.id).toBe(first.id);
    expect(second.extractorSelfRating).toBe(0.6);
  });

  it('mints an opaque id, never a derivation of label, source or courses', async () => {
    const record = await resolveOutcome(source, {
      courses: ['COURSEA'],
      source: SOURCE,
      label: 'Explain the mechanism of osmosis',
      provenance: PROVENANCE,
    });

    expect(record.id.startsWith(`${OPAQUE_OUTCOME_ID_PREFIX}:`)).toBe(true);
    expect(record.id).not.toContain('COURSEA');
    expect(record.id).not.toContain('osmosis');
    expect(record.id).not.toContain('Objectives');
  });

  it('re-resolving the same source reference returns the same record and mints no second one', async () => {
    const first = await resolveOutcome(source, {
      courses: ['COURSEA'],
      source: SOURCE,
      label: 'Explain X',
      provenance: PROVENANCE,
    });
    const second = await resolveOutcome(source, {
      courses: ['COURSEA'],
      source: SOURCE,
      label: 'Explain X (re-extracted)',
      provenance: PROVENANCE,
    });

    expect(second.id).toBe(first.id);
    const records = await listOutcomeRecords(source);
    expect(records).toHaveLength(1);
  });

  it('a different source reference mints a distinct outcome', async () => {
    const first = await resolveOutcome(source, {
      courses: ['COURSEA'],
      source: SOURCE,
      label: 'Explain X',
      provenance: PROVENANCE,
    });
    const second = await resolveOutcome(source, {
      courses: ['COURSEA'],
      source: { path: SOURCE.path, blockIndex: SOURCE.blockIndex + 1 },
      label: 'Explain Y',
      provenance: PROVENANCE,
    });

    expect(second.id).not.toBe(first.id);
    const records = await listOutcomeRecords(source);
    expect(records).toHaveLength(2);
  });

  it('the mint nonce is injectable via generateId, for deterministic tests', async () => {
    const record = await resolveOutcome(
      source,
      { courses: ['COURSEA'], source: SOURCE, label: 'Explain X', provenance: PROVENANCE },
      { generateId: () => 'fixed-nonce' },
    );
    expect(record.id).toBe(`${OPAQUE_OUTCOME_ID_PREFIX}:fixed-nonce`);
  });

  it('a record survives a write/read round-trip byte-for-byte', async () => {
    const record = await resolveOutcome(source, {
      courses: ['COURSEA'],
      source: SOURCE,
      label: 'Explain X',
      provenance: PROVENANCE,
    });
    const path = outcomeRecordPath(record.id);
    const bytesOnce = await source.read(path);
    const bytesTwice = await source.read(path);
    expect(bytesTwice).toBe(bytesOnce);
    const parsed: unknown = JSON.parse(bytesOnce);
    expect(isOutcomeRecord(parsed)).toBe(true);
  });

  it('`[D-253]`: isOutcomeRecord accepts a record with no extractorSelfRating and rejects a non-numeric one', async () => {
    const record = await resolveOutcome(source, {
      courses: ['COURSEA'],
      source: SOURCE,
      label: 'Explain X',
      provenance: PROVENANCE,
    });
    expect(isOutcomeRecord(record)).toBe(true);
    expect(isOutcomeRecord({ ...record, extractorSelfRating: 'high' })).toBe(false);
    expect(isOutcomeRecord({ ...record, extractorSelfRating: 0.5 })).toBe(true);
  });

  it('a corrupt sidecar file is skipped, never thrown, and does not block other lookups', async () => {
    await mkdir(join(root, OUTCOME_STORE_FOLDER), { recursive: true });
    await writeFile(join(root, OUTCOME_STORE_FOLDER, 'broken.json'), 'not valid json{{{', 'utf8');

    const record = await resolveOutcome(source, {
      courses: ['COURSEA'],
      source: SOURCE,
      label: 'Explain X',
      provenance: PROVENANCE,
    });
    expect(typeof record.id).toBe('string');
  });
});

describe('attachConceptToOutcome', () => {
  let root: string;
  let source: FolderSource;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'olea-outcome-attach-'));
    source = new FolderSource(root);
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it('records the outcome-to-concept containment edge', async () => {
    const outcome = await resolveOutcome(source, {
      courses: ['COURSEA'],
      source: SOURCE,
      label: 'Explain X',
      provenance: PROVENANCE,
    });

    const updated = await attachConceptToOutcome(source, outcome.id, 'concept-key1:abc');
    expect(updated.conceptKeys).toEqual(['concept-key1:abc']);

    const records = await listOutcomeRecords(source);
    expect(records).toHaveLength(1);
    expect(records[0]?.record.conceptKeys).toEqual(['concept-key1:abc']);
  });

  it('is idempotent: attaching the same concept key twice writes no second time', async () => {
    const outcome = await resolveOutcome(source, {
      courses: ['COURSEA'],
      source: SOURCE,
      label: 'Explain X',
      provenance: PROVENANCE,
    });
    await attachConceptToOutcome(source, outcome.id, 'concept-key1:abc');
    const path = outcomeRecordPath(outcome.id);
    const bytesAfterFirst = await source.read(path);

    await attachConceptToOutcome(source, outcome.id, 'concept-key1:abc');
    const bytesAfterSecond = await source.read(path);
    expect(bytesAfterSecond).toBe(bytesAfterFirst);
  });

  it('throws rather than minting when the outcome id has no existing record', async () => {
    await expect(
      attachConceptToOutcome(source, `${OPAQUE_OUTCOME_ID_PREFIX}:nonexistent`, 'concept-key1:abc'),
    ).rejects.toThrow();
    expect(await listOutcomeRecords(source)).toHaveLength(0);
  });
});

describe('retireOutcome', () => {
  let root: string;
  let source: FolderSource;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'olea-outcome-retire-'));
    source = new FolderSource(root);
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it('moves an outcome to retired without deleting its record', async () => {
    const outcome = await resolveOutcome(source, {
      courses: ['COURSEA'],
      source: SOURCE,
      label: 'Explain X',
      provenance: PROVENANCE,
    });

    const retired = await retireOutcome(source, outcome.id);
    expect(retired.status).toBe('retired');

    const records = await listOutcomeRecords(source);
    expect(records).toHaveLength(1); // F8.5: withdrawal, never deletion
    expect(records[0]?.record.status).toBe('retired');
    expect(records[0]?.record.id).toBe(outcome.id);
  });

  it('is idempotent: retiring an already-retired outcome writes no second time', async () => {
    const outcome = await resolveOutcome(source, {
      courses: ['COURSEA'],
      source: SOURCE,
      label: 'Explain X',
      provenance: PROVENANCE,
    });
    await retireOutcome(source, outcome.id);
    const path = outcomeRecordPath(outcome.id);
    const bytesAfterFirst = await source.read(path);

    await retireOutcome(source, outcome.id);
    const bytesAfterSecond = await source.read(path);
    expect(bytesAfterSecond).toBe(bytesAfterFirst);
  });

  it('throws rather than minting when the outcome id has no existing record', async () => {
    await expect(
      retireOutcome(source, `${OPAQUE_OUTCOME_ID_PREFIX}:nonexistent`),
    ).rejects.toThrow();
    expect(await listOutcomeRecords(source)).toHaveLength(0);
  });
});

describe('mintOpaqueOutcomeId', () => {
  it('is content-independent and marked distinctly from a concept key', () => {
    expect(mintOpaqueOutcomeId(() => 'n')).toBe(`${OPAQUE_OUTCOME_ID_PREFIX}:n`);
  });

  it('defaults to a real random nonce — two default-generated ids never collide', () => {
    const a = mintOpaqueOutcomeId();
    const b = mintOpaqueOutcomeId();
    expect(a).not.toBe(b);
  });
});

describe('the vault writer never touches her authored notes', () => {
  let root: string;
  let source: FolderSource;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'olea-outcome-boundary-'));
    source = new FolderSource(root);
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it('every write (mint, attach, retire) lands under .olea/outcomes/, never elsewhere', async () => {
    const outcome = await resolveOutcome(source, {
      courses: ['COURSEA'],
      source: SOURCE,
      label: 'Explain X',
      provenance: PROVENANCE,
    });
    await attachConceptToOutcome(source, outcome.id, 'concept-key1:abc');
    await retireOutcome(source, outcome.id);

    // An ordinary, vault-wide listing never sees a dot-directory at all
    // (`FolderSource.list`'s own documented behaviour) — the strongest form
    // of "not in her authored notes": nothing here is even visible to a walk
    // that does not already know to look under `.olea/`.
    expect(await source.list({})).toEqual([]);

    const outcomePaths = await source.list({ under: OUTCOME_STORE_FOLDER });
    // The one file that exists is the outcome's own sidecar record, addressed
    // exactly the way outcomeRecordPath predicts.
    expect(outcomePaths).toEqual([outcomeRecordPath(outcome.id)]);
  });
});
