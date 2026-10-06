/**
 * Her correction history for a model-decided link (`[D-533]`, A strengthened;
 * `ol-egov.141.89.7.26`), keyed on the course and the objective's wording so her choice survives a
 * rename or move of the document (`[D-537]`, `ol-egov.141.89.7.77`). Scenarios: olea-service
 * `features/F8-concepts-scope.md`, section "`[D-433]` — Model-decided containment and scope
 * standing", tagged `@auto:core/outcome/containment-correction.spec`.
 *
 * INV-3: every course code, concept name, path and sentence below is invented.
 */

import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { ConceptKeyCanonicalIndex } from '../concept/key-store.js';
import { FolderSource } from '../vault/folder-source.js';
import { UnreadableStoreRecordError } from '../vault/store-record.js';
import type { VaultPath } from '../vault/types.js';
import {
  type ContainmentDeclaration,
  containmentCorrectionPath,
  currentContainmentCorrection,
  isContainmentCorrectionLog,
  isCorrectedAway,
  OUTCOME_CONTAINMENT_CORRECTION_FOLDER,
  OUTCOME_CONTAINMENT_CORRECTION_SCHEMA_VERSION,
  objectivesDeclarationOf,
  readContainmentCorrection,
  readContainmentCorrectionState,
  recordContainmentCorrection,
  statedScopeDeclarationOf,
} from './containment-correction.js';
import { outcomeLabelDigest } from './source-identity.js';
import { OUTCOME_RECORD_SCHEMA_VERSION, type OutcomeRecord } from './types.js';

const DOC = '03 Research/Objectives A.md' as VaultPath;
const COURSE = 'COURSEA';
const K1 = 'concept-key1:flange';
const K2 = 'concept-key1:cog';

function outcome(
  id: string,
  label: string,
  blockIndex: number,
  labelDigest?: string,
  path: VaultPath = DOC,
) {
  return {
    id,
    courses: [COURSE],
    source: {
      path,
      blockIndex,
      ...(labelDigest !== undefined ? { labelDigest } : {}),
    },
    label,
    conceptKeys: [],
    status: 'active',
    provenance: { promptVersion: 'v1', modelVersion: 'model-a' },
    mintedAt: '2026-10-01',
    schemaVersion: OUTCOME_RECORD_SCHEMA_VERSION,
  } satisfies OutcomeRecord;
}

describe('the declaration identity a correction is keyed on', () => {
  it("an objectives declaration is the course and [D-477]'s wording key, never the document's path or the outcome id ([D-537])", async () => {
    const digest = await outcomeLabelDigest('Analyse a loaded frame');
    const declaration = await objectivesDeclarationOf(
      outcome('outcome-key1:o1', 'Analyse a loaded frame', 3, digest),
      COURSE,
    );
    expect(declaration).toEqual({ kind: 'objectives', courseId: COURSE, wordingKey: digest });
    expect(JSON.stringify(declaration)).not.toContain('outcome-key1:o1');
    expect(JSON.stringify(declaration)).not.toContain(DOC);
  });

  it('survives a rename or move of the document: the same wording under another path is the same declaration ([D-537])', async () => {
    const digest = await outcomeLabelDigest('Analyse a loaded frame');
    const before = await objectivesDeclarationOf(
      outcome('outcome-key1:o1', 'Analyse a loaded frame', 3, digest),
      COURSE,
    );
    const renamed = await objectivesDeclarationOf(
      outcome('outcome-key1:o1', 'Analyse a loaded frame', 3, digest, '03 Research/Aims A.md'),
      COURSE,
    );
    const moved = await objectivesDeclarationOf(
      outcome('outcome-key1:o1b', 'Analyse a loaded frame', 3, digest, 'Archive/Objectives A.md'),
      COURSE,
    );
    expect(renamed).toEqual(before);
    expect(moved).toEqual(before);
    expect(await containmentCorrectionPath(renamed, K1)).toBe(
      await containmentCorrectionPath(before, K1),
    );
  });

  it('is per course: the same wording in another course is another declaration', async () => {
    const digest = await outcomeLabelDigest('Analyse a loaded frame');
    const record = outcome('outcome-key1:o1', 'Analyse a loaded frame', 3, digest);
    expect(await objectivesDeclarationOf(record, 'COURSEB')).not.toEqual(
      await objectivesDeclarationOf(record, COURSE),
    );
  });

  it('survives an unrelated edit: the same wording minted again on another unit is the same declaration', async () => {
    const digest = await outcomeLabelDigest('Analyse a loaded frame');
    const before = await objectivesDeclarationOf(
      outcome('outcome-key1:o1', 'Analyse a loaded frame', 3, digest),
      COURSE,
    );
    const after = await objectivesDeclarationOf(
      outcome('outcome-key1:o1-reminted', 'Analyse a loaded frame', 5, digest),
      COURSE,
    );
    expect(after).toEqual(before);
  });

  it('a record minted before [D-477] reads its wording key from its stored label, as [D-477] reads it', async () => {
    const legacy = await objectivesDeclarationOf(
      outcome('outcome-key1:o-old', 'Analyse a loaded frame', 3),
      COURSE,
    );
    expect(legacy).toEqual({
      kind: 'objectives',
      courseId: COURSE,
      wordingKey: await outcomeLabelDigest('Analyse a loaded frame'),
    });
  });

  it('changed wording is a different declaration (new evidence)', async () => {
    const a = await objectivesDeclarationOf(
      outcome('outcome-key1:o1', 'Analyse a loaded frame', 3, await outcomeLabelDigest('x')),
      COURSE,
    );
    const b = await objectivesDeclarationOf(
      outcome('outcome-key1:o2', 'Design a ratchet', 3, await outcomeLabelDigest('y')),
      COURSE,
    );
    expect(a).not.toEqual(b);
  });

  it("a stated-scope declaration is the assessment's scope key", () => {
    expect(statedScopeDeclarationOf('scope-key:q1')).toEqual({
      kind: 'stated-scope',
      scopeKey: 'scope-key:q1',
    });
  });

  it('the file a pair lives in is opaque, under its own folder, and one per (declaration, concept)', async () => {
    const declaration: ContainmentDeclaration = {
      kind: 'objectives',
      courseId: COURSE,
      wordingKey: 'v1:abc',
    };
    const path = await containmentCorrectionPath(declaration, K1);
    expect(OUTCOME_CONTAINMENT_CORRECTION_FOLDER).toBe('.olea/outcome-containment-corrections');
    expect(path.startsWith(`${OUTCOME_CONTAINMENT_CORRECTION_FOLDER}/`)).toBe(true);
    expect(path).toMatch(/^\.olea\/outcome-containment-corrections\/[0-9a-f]{64}\.json$/);
    expect(await containmentCorrectionPath(declaration, K1)).toBe(path);
    expect(await containmentCorrectionPath(declaration, K2)).not.toBe(path);
    expect(
      await containmentCorrectionPath({ kind: 'stated-scope', scopeKey: 'scope-key:q1' }, K1),
    ).not.toBe(path);
  });
});

describe('recordContainmentCorrection — her own append-only history per (declaration, concept)', () => {
  let root: string;
  let vault: FolderSource;
  const declaration: ContainmentDeclaration = {
    kind: 'objectives',
    courseId: COURSE,
    wordingKey: 'v1:abc',
  };

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'olea-containment-correction-'));
    vault = new FolderSource(root);
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it('writes one history file for the pair, holding a declined event with its time, and nothing else', async () => {
    const log = await recordContainmentCorrection(vault, declaration, K1, 'declined', {
      now: () => '2026-10-06T10:00:00.000Z',
    });
    expect(log).toEqual({
      declaration,
      conceptKey: K1,
      events: [{ kind: 'declined', at: '2026-10-06T10:00:00.000Z' }],
      schemaVersion: OUTCOME_CONTAINMENT_CORRECTION_SCHEMA_VERSION,
    });
    const folders = await readdir(join(root, '.olea'));
    expect(folders).toEqual(['outcome-containment-corrections']);
    const files = await readdir(join(root, OUTCOME_CONTAINMENT_CORRECTION_FOLDER));
    expect(files).toHaveLength(1);
    const path = await containmentCorrectionPath(declaration, K1);
    expect(JSON.parse(await readFile(join(root, path), 'utf8'))).toEqual(log);
  });

  it('is append-only: her reversal is a later entry, every earlier entry kept in order', async () => {
    await recordContainmentCorrection(vault, declaration, K1, 'declined', { now: () => 't1' });
    await recordContainmentCorrection(vault, declaration, K1, 'accepted', { now: () => 't2' });
    const log = await recordContainmentCorrection(vault, declaration, K1, 'declined', {
      now: () => 't3',
    });
    expect(log.events).toEqual([
      { kind: 'declined', at: 't1' },
      { kind: 'accepted', at: 't2' },
      { kind: 'declined', at: 't3' },
    ]);
    const read = await readContainmentCorrection(vault, declaration, K1);
    expect(read.kind === 'record' ? read.record.events : undefined).toEqual(log.events);
    expect(currentContainmentCorrection(log)).toBe('declined');
  });

  it('an immediately repeated decision writes nothing new', async () => {
    await recordContainmentCorrection(vault, declaration, K1, 'declined', { now: () => 't1' });
    const log = await recordContainmentCorrection(vault, declaration, K1, 'declined', {
      now: () => 't2',
    });
    expect(log.events).toEqual([{ kind: 'declined', at: 't1' }]);
  });

  it('two pairs are two histories: a decision on one never touches the other', async () => {
    await recordContainmentCorrection(vault, declaration, K1, 'declined', { now: () => 't1' });
    expect((await readContainmentCorrection(vault, declaration, K2)).kind).toBe('absent');
  });

  it('a file this build cannot read is refused and left byte-identical, never written over', async () => {
    const path = await containmentCorrectionPath(declaration, K1);
    const torn = '{"declaration": {"kind": "objectives"';
    await vault.write(path, torn);
    await expect(
      recordContainmentCorrection(vault, declaration, K1, 'declined', { now: () => 't1' }),
    ).rejects.toBeInstanceOf(UnreadableStoreRecordError);
    expect(await vault.read(path)).toBe(torn);

    const newer = `${JSON.stringify({
      declaration,
      conceptKey: K1,
      events: [{ kind: 'expired', at: 't0' }],
      schemaVersion: OUTCOME_CONTAINMENT_CORRECTION_SCHEMA_VERSION,
    })}\n`;
    await vault.write(path, newer);
    await expect(
      recordContainmentCorrection(vault, declaration, K1, 'accepted', { now: () => 't1' }),
    ).rejects.toBeInstanceOf(UnreadableStoreRecordError);
    expect(await vault.read(path)).toBe(newer);
  });

  it('refuses a record whose shape it does not know', () => {
    const good = {
      declaration,
      conceptKey: K1,
      events: [{ kind: 'declined', at: 't1' }],
      schemaVersion: OUTCOME_CONTAINMENT_CORRECTION_SCHEMA_VERSION,
    };
    expect(OUTCOME_CONTAINMENT_CORRECTION_SCHEMA_VERSION).toBe(2);
    expect(isContainmentCorrectionLog(good)).toBe(true);
    expect(isContainmentCorrectionLog({ ...good, schemaVersion: 1 })).toBe(false);
    expect(isContainmentCorrectionLog({ ...good, schemaVersion: 3 })).toBe(false);
    expect(isContainmentCorrectionLog({ ...good, events: [] })).toBe(false);
    expect(isContainmentCorrectionLog({ ...good, conceptKey: '' })).toBe(false);
    expect(
      isContainmentCorrectionLog({ ...good, declaration: { kind: 'past-paper', sourcePath: DOC } }),
    ).toBe(false);
    expect(
      isContainmentCorrectionLog({ ...good, declaration: { kind: 'objectives', sourcePath: DOC } }),
    ).toBe(false);
    // The earlier path-keyed shape, whole, is never read as this build's ([D-537]).
    expect(
      isContainmentCorrectionLog({
        ...good,
        declaration: { kind: 'objectives', sourcePath: DOC, wordingKey: 'v1:abc' },
      }),
    ).toBe(false);
    // A declaration carrying a field beyond its own is another identity, never this one.
    expect(
      isContainmentCorrectionLog({
        ...good,
        declaration: { ...declaration, sourcePath: DOC },
      }),
    ).toBe(false);
    expect(
      isContainmentCorrectionLog({
        ...good,
        declaration: { kind: 'objectives', courseId: '', wordingKey: 'v1:abc' },
      }),
    ).toBe(false);
  });

  it('a history in the earlier path-keyed shape is unreadable, never matched and never absent ([D-537])', async () => {
    const path = await containmentCorrectionPath(declaration, K1);
    const earlier = `${JSON.stringify(
      {
        declaration: { kind: 'objectives', sourcePath: DOC, wordingKey: 'v1:abc' },
        conceptKey: K1,
        events: [{ kind: 'declined', at: 't0' }],
        schemaVersion: 1,
      },
      null,
      2,
    )}\n`;
    await vault.write(path, earlier);
    expect((await readContainmentCorrection(vault, declaration, K1)).kind).toBe('unreadable');
    await expect(
      recordContainmentCorrection(vault, declaration, K1, 'accepted', { now: () => 't1' }),
    ).rejects.toBeInstanceOf(UnreadableStoreRecordError);
    expect(await vault.read(path)).toBe(earlier);
  });

  it("a history at a pair's path that names another pair is unreadable, never read as this pair's", async () => {
    const path = await containmentCorrectionPath(declaration, K1);
    const other = `${JSON.stringify({
      declaration: { ...declaration, wordingKey: 'v1:other' },
      conceptKey: K1,
      events: [{ kind: 'accepted', at: 't0' }],
      schemaVersion: OUTCOME_CONTAINMENT_CORRECTION_SCHEMA_VERSION,
    })}\n`;
    await vault.write(path, other);
    expect((await readContainmentCorrection(vault, declaration, K1)).kind).toBe('unreadable');
    const otherConcept = `${JSON.stringify({
      declaration,
      conceptKey: K2,
      events: [{ kind: 'accepted', at: 't0' }],
      schemaVersion: OUTCOME_CONTAINMENT_CORRECTION_SCHEMA_VERSION,
    })}\n`;
    await vault.write(path, otherConcept);
    expect((await readContainmentCorrection(vault, declaration, K1)).kind).toBe('unreadable');
    await expect(
      recordContainmentCorrection(vault, declaration, K1, 'declined', { now: () => 't1' }),
    ).rejects.toBeInstanceOf(UnreadableStoreRecordError);
    expect(await vault.read(path)).toBe(otherConcept);
  });
});

describe('isCorrectedAway — the read-time exclusion, failing closed', () => {
  let root: string;
  let vault: FolderSource;
  const declaration: ContainmentDeclaration = { kind: 'stated-scope', scopeKey: 'scope-key:q1' };
  const identity: ConceptKeyCanonicalIndex = { canonicalOf: (k) => k, superseded: new Map() };

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'olea-containment-correction-read-'));
    vault = new FolderSource(root);
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it('no history: not excluded; latest declined: excluded; latest accepted: not excluded', async () => {
    expect(await isCorrectedAway(vault, declaration, K1, identity)).toBe(false);
    await recordContainmentCorrection(vault, declaration, K1, 'declined', { now: () => 't1' });
    expect(await isCorrectedAway(vault, declaration, K1, identity)).toBe(true);
    await recordContainmentCorrection(vault, declaration, K1, 'accepted', { now: () => 't2' });
    expect(await isCorrectedAway(vault, declaration, K1, identity)).toBe(false);
  });

  it('an unreadable history excludes its pair, so a rejection inside it is never lost', async () => {
    await vault.write(await containmentCorrectionPath(declaration, K1), 'not json');
    expect(await isCorrectedAway(vault, declaration, K1, identity)).toBe(true);
    expect(await isCorrectedAway(vault, declaration, K2, identity)).toBe(false);
  });

  it('the state read keeps none, declined, accepted and unreadable apart ([D-537]: the grove lists only the first three)', async () => {
    expect(await readContainmentCorrectionState(vault, declaration, K1, identity)).toBe('none');
    await recordContainmentCorrection(vault, declaration, K1, 'declined', { now: () => 't1' });
    expect(await readContainmentCorrectionState(vault, declaration, K1, identity)).toBe('declined');
    await recordContainmentCorrection(vault, declaration, K1, 'accepted', { now: () => 't2' });
    expect(await readContainmentCorrectionState(vault, declaration, K1, identity)).toBe('accepted');
    await vault.write(await containmentCorrectionPath(declaration, K2), '{"declaration": ');
    expect(await readContainmentCorrectionState(vault, declaration, K2, identity)).toBe(
      'unreadable',
    );
  });

  it('[D-378]: a decline recorded under a superseded duplicate key excludes the canonical concept, and the reverse', async () => {
    const SUPERSEDED = 'concept-key1:flange-dup';
    const index: ConceptKeyCanonicalIndex = {
      canonicalOf: (k) => (k === SUPERSEDED ? K1 : k),
      superseded: new Map([[SUPERSEDED, K1]]),
    };
    await recordContainmentCorrection(vault, declaration, SUPERSEDED, 'declined', {
      now: () => 't1',
    });
    expect(await isCorrectedAway(vault, declaration, K1, index)).toBe(true);
    expect(await isCorrectedAway(vault, declaration, SUPERSEDED, index)).toBe(true);
    // Her later acceptance under the canonical key is the latest event across both histories.
    await recordContainmentCorrection(vault, declaration, K1, 'accepted', { now: () => 't2' });
    expect(await isCorrectedAway(vault, declaration, K1, index)).toBe(false);
  });
});
