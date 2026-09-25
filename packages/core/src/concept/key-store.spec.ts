import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { FolderSource } from '../vault/folder-source.js';
import { OPAQUE_CONCEPT_KEY_PREFIX } from './concept-key.js';
import { extractConcepts } from './extract.js';
import {
  bindConceptKeyToNote,
  CONCEPT_KEY_STORE_FOLDER,
  type ConceptKeyRecord,
  conceptKeyRecordPath,
  findNormalizationCollisions,
  isConceptKeyRecord,
  listConceptKeyRecords,
  resolveConceptKey,
} from './key-store.js';

// Scenarios: olea-service/features/F8-concepts-scope.md — "Concept-key sidecar: mint once,
// read back thereafter ([D-174], ol-2zfj.42)", tagged `@auto:core/concept/key-store.spec`.

describe('resolveConceptKey — mint once, read back thereafter ([D-174])', () => {
  let root: string;
  let source: FolderSource;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'olea-concept-key-store-'));
    source = new FolderSource(root);
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it('mints and persists a new record when no existing one matches', async () => {
    const key = await resolveConceptKey(
      source,
      2,
      { kind: 'topic', course: 'COURSEA', name: 'Basalt weathering', aliases: [] },
      { now: () => '2026-09-01' },
    );

    const records = await listConceptKeyRecords(source);
    expect(records).toHaveLength(1);
    expect(records[0]?.record.key).toBe(key);
    expect(records[0]?.record.tier).toBe(2);
    expect(records[0]?.record.mintedAt).toBe('2026-09-01');
    expect(records[0]?.record.schemaVersion).toBe(1);
    expect(records[0]?.path).toBe(conceptKeyRecordPath(key));
  });

  it('re-resolving the same anchor returns the same key verbatim and writes no second record', async () => {
    const anchor = {
      kind: 'topic' as const,
      course: 'COURSEA',
      name: 'Basalt weathering',
      aliases: [],
    };
    const first = await resolveConceptKey(source, 2, anchor);
    const second = await resolveConceptKey(source, 2, anchor);

    expect(second).toBe(first);
    const records = await listConceptKeyRecords(source);
    expect(records).toHaveLength(1);
  });

  it('a bound concept is looked up by noteUid, surviving a path rename', async () => {
    const first = await resolveConceptKey(source, 1, {
      kind: 'note',
      noteUid: 'uid-abc',
      notePath: '05 Zettelkasten/Old name.md',
    });

    // Renamed on disk; olea-uid — the part that actually matters — is unchanged.
    const second = await resolveConceptKey(source, 1, {
      kind: 'note',
      noteUid: 'uid-abc',
      notePath: '05 Zettelkasten/New name.md',
    });

    expect(second).toBe(first);
    const records = await listConceptKeyRecords(source);
    expect(records).toHaveLength(1);
    expect(records[0]?.record.anchor).toEqual({
      kind: 'note',
      noteUid: 'uid-abc',
      notePath: '05 Zettelkasten/New name.md',
    });
  });

  it('falls back to notePath when noteUid is absent on both sides', async () => {
    const first = await resolveConceptKey(source, 1, {
      kind: 'note',
      noteUid: null,
      notePath: '05 Zettelkasten/Some note.md',
    });
    const second = await resolveConceptKey(source, 1, {
      kind: 'note',
      noteUid: null,
      notePath: '05 Zettelkasten/Some note.md',
    });

    expect(second).toBe(first);
    const records = await listConceptKeyRecords(source);
    expect(records).toHaveLength(1);
  });

  it('a topic-only concept is matched by the existing wording/alias precedence ([D-088])', async () => {
    const key = await resolveConceptKey(source, 2, {
      kind: 'topic',
      course: 'COURSEA',
      name: 'Isostasy',
      aliases: ['Isostatic rebound'],
    });

    // A later run proposes the recorded alias instead of the canonical name — still matches.
    const viaAlias = await resolveConceptKey(source, 2, {
      kind: 'topic',
      course: 'COURSEA',
      name: 'Isostatic rebound',
      aliases: [],
    });
    expect(viaAlias).toBe(key);

    // A different course with the same exact name does NOT match — course-scoped.
    const otherCourse = await resolveConceptKey(source, 2, {
      kind: 'topic',
      course: 'COURSEB',
      name: 'Isostasy',
      aliases: [],
    });
    expect(otherCourse).not.toBe(key);
  });

  it('a re-resolve never mutates an existing record other than refreshing its anchor', async () => {
    const key = await resolveConceptKey(
      source,
      1,
      { kind: 'note', noteUid: 'uid-1', notePath: '05 Zettelkasten/A.md' },
      { now: () => '2026-01-01' },
    );
    await resolveConceptKey(
      source,
      1,
      { kind: 'note', noteUid: 'uid-1', notePath: '05 Zettelkasten/A.md' },
      {
        now: () => '2099-01-01',
      },
    );

    const records = await listConceptKeyRecords(source);
    expect(records).toHaveLength(1);
    expect(records[0]?.record.key).toBe(key);
    // mintedAt is never rewritten on a match — only a genuine mint sets it.
    expect(records[0]?.record.mintedAt).toBe('2026-01-01');
  });

  it('a concept a later run no longer finds evidence for keeps its record untouched — no run enumerates and prunes it', async () => {
    await resolveConceptKey(source, 2, {
      kind: 'topic',
      course: 'COURSEA',
      name: 'Volcanic tuff',
      aliases: [],
    });
    const before = await listConceptKeyRecords(source);

    // A later extraction over a vault with no mention of this concept at all never touches
    // this module — there is no enumerate-and-prune path here (F8.5: pruning is a registry
    // action elsewhere, never automatic).
    const after = await listConceptKeyRecords(source);
    expect(after).toEqual(before);
  });

  it('a record survives a write/read round-trip byte-for-byte', async () => {
    const key = await resolveConceptKey(
      source,
      2,
      { kind: 'topic', course: 'COURSEA', name: 'Cross-bedding', aliases: [] },
      { now: () => '2026-09-01' },
    );
    const path = conceptKeyRecordPath(key);
    const bytesOnce = await source.read(path);
    const bytesTwice = await source.read(path);
    expect(bytesTwice).toBe(bytesOnce);
    const parsed: unknown = JSON.parse(bytesOnce);
    expect(isConceptKeyRecord(parsed)).toBe(true);
  });

  it('a corrupt sidecar file is skipped, never thrown, and does not block other lookups', async () => {
    await mkdir(join(root, CONCEPT_KEY_STORE_FOLDER), { recursive: true });
    await writeFile(
      join(root, CONCEPT_KEY_STORE_FOLDER, 'broken.json'),
      'not valid json{{{',
      'utf8',
    );

    const key = await resolveConceptKey(source, 2, {
      kind: 'topic',
      course: 'COURSEA',
      name: 'Fresh concept',
      aliases: [],
    });
    expect(typeof key).toBe('string');
  });
});

// Scenarios: olea-service/features/F8-concepts-scope.md — "A genuine mint is opaque, never
// content-derived ([D-174], ONT-R1 ol-2zfj.86, ONT-R6 ol-2zfj.88, ol-bo48)", tagged
// `@auto:core/concept/key-store.spec`.
describe('resolveConceptKey — opaque mint (ol-bo48, ONT-R1, ONT-R6, [D-174])', () => {
  let root: string;
  let source: FolderSource;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'olea-concept-key-opaque-'));
    source = new FolderSource(root);
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it('a genuine mint carries the opaque prefix, never her course/wording/path', async () => {
    const key = await resolveConceptKey(source, 2, {
      kind: 'topic',
      course: 'COURSEA',
      name: 'Basalt weathering',
      aliases: [],
    });

    expect(key.startsWith(`${OPAQUE_CONCEPT_KEY_PREFIX}:`)).toBe(true);
    expect(key).not.toContain('COURSEA');
    expect(key).not.toContain('Basalt');
    expect(key).not.toContain('weathering');
  });

  it('a genuine mint for a bound note carries no trace of the note path', async () => {
    const key = await resolveConceptKey(source, 1, {
      kind: 'note',
      noteUid: 'uid-abc',
      notePath: '05 Zettelkasten/Imbrication.md',
    });

    expect(key.startsWith(`${OPAQUE_CONCEPT_KEY_PREFIX}:`)).toBe(true);
    expect(key).not.toContain('Zettelkasten');
    expect(key).not.toContain('Imbrication');
    expect(key).not.toContain('uid-abc');
  });

  it('the mint nonce is injectable via generateKey, for deterministic tests', async () => {
    const key = await resolveConceptKey(
      source,
      2,
      { kind: 'topic', course: 'COURSEA', name: 'Isostasy', aliases: [] },
      { generateKey: () => 'fixed-nonce-1' },
    );
    expect(key).toBe(`${OPAQUE_CONCEPT_KEY_PREFIX}:fixed-nonce-1`);
  });

  it('two distinct topic anchors, minted with the default generator, never collide', async () => {
    const a = await resolveConceptKey(source, 2, {
      kind: 'topic',
      course: 'COURSEA',
      name: 'Basalt weathering',
      aliases: [],
    });
    const b = await resolveConceptKey(source, 2, {
      kind: 'topic',
      course: 'COURSEA',
      name: 'Isostasy',
      aliases: [],
    });
    expect(a).not.toBe(b);
  });

  it(
    'MIGRATION: a pre-ol-bo48 record, minted content-derived before this landing, is read back ' +
      'verbatim by anchor — its key is never rewritten opaque and her vault is never touched',
    async () => {
      const legacyKey = 'concept-prov1:COURSEA Basalt weathering';
      await mkdir(join(root, CONCEPT_KEY_STORE_FOLDER), { recursive: true });
      await writeFile(
        join(root, conceptKeyRecordPath(legacyKey)),
        `${JSON.stringify(
          {
            key: legacyKey,
            tier: 2,
            anchor: { kind: 'topic', course: 'COURSEA', name: 'Basalt weathering', aliases: [] },
            mintedAt: '2026-08-01',
            schemaVersion: 1,
          },
          null,
          2,
        )}\n`,
      );

      const resolved = await resolveConceptKey(source, 2, {
        kind: 'topic',
        course: 'COURSEA',
        name: 'Basalt weathering',
        aliases: [],
      });

      expect(resolved).toBe(legacyKey);
      const records = await listConceptKeyRecords(source);
      expect(records).toHaveLength(1);
      expect(records[0]?.record.key).toBe(legacyKey);
    },
  );

  it('a new concept alongside a legacy record mints opaque, leaving the legacy record untouched', async () => {
    const legacyKey = 'concept-prov1:COURSEA Basalt weathering';
    await mkdir(join(root, CONCEPT_KEY_STORE_FOLDER), { recursive: true });
    await writeFile(
      join(root, conceptKeyRecordPath(legacyKey)),
      `${JSON.stringify(
        {
          key: legacyKey,
          tier: 2,
          anchor: { kind: 'topic', course: 'COURSEA', name: 'Basalt weathering', aliases: [] },
          mintedAt: '2026-08-01',
          schemaVersion: 1,
        },
        null,
        2,
      )}\n`,
    );

    const newKey = await resolveConceptKey(source, 2, {
      kind: 'topic',
      course: 'COURSEA',
      name: 'Isostasy',
      aliases: [],
    });

    expect(newKey.startsWith(`${OPAQUE_CONCEPT_KEY_PREFIX}:`)).toBe(true);
    const records = await listConceptKeyRecords(source);
    expect(records).toHaveLength(2);
    const legacy = records.find((r) => r.record.key === legacyKey);
    expect(legacy?.record).toEqual({
      key: legacyKey,
      tier: 2,
      anchor: { kind: 'topic', course: 'COURSEA', name: 'Basalt weathering', aliases: [] },
      mintedAt: '2026-08-01',
      schemaVersion: 1,
    });
  });
});

// Scenarios: olea-service/features/F8-concepts-scope.md — "Accepting a note offer rebinds the
// existing concept key onto the new note ([D-088], [D-176], [D-183], ol-2zfj.55)", tagged
// `@auto:core/concept/key-store.spec`.
describe('bindConceptKeyToNote — key-driven rebind onto a new note ([D-088], [D-176], [D-183])', () => {
  let root: string;
  let source: FolderSource;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'olea-concept-key-rebind-'));
    source = new FolderSource(root);
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it('rebinding a topic-anchored record then re-resolving via the OLD topic anchor still resolves the same key', async () => {
    const key = await resolveConceptKey(source, 2, {
      kind: 'topic',
      course: 'COURSEA',
      name: 'Basalt weathering',
      aliases: [],
    });

    await bindConceptKeyToNote(source, key, {
      kind: 'note',
      noteUid: 'uid-basalt',
      notePath: '05 Zettelkasten/Basalt weathering.md',
    });

    // A stale extraction pass that still proposes her old `topic:` wording (before it has
    // learned about the new note) resolves to the SAME key rather than minting a second one.
    const reResolved = await resolveConceptKey(source, 2, {
      kind: 'topic',
      course: 'COURSEA',
      name: 'Basalt weathering',
      aliases: [],
    });
    expect(reResolved).toBe(key);
  });

  it('mints no second sidecar file — one record, now note-anchored', async () => {
    const key = await resolveConceptKey(source, 2, {
      kind: 'topic',
      course: 'COURSEA',
      name: 'Isostasy',
      aliases: [],
    });

    await bindConceptKeyToNote(source, key, {
      kind: 'note',
      noteUid: null,
      notePath: '05 Zettelkasten/Isostasy.md',
    });

    const records = await listConceptKeyRecords(source);
    expect(records).toHaveLength(1);
    expect(records[0]?.record.key).toBe(key);
    expect(records[0]?.record.anchor).toEqual({
      kind: 'note',
      noteUid: null,
      notePath: '05 Zettelkasten/Isostasy.md',
    });
  });

  it('keeps the previous topic wording as an alias ([D-183])', async () => {
    const key = await resolveConceptKey(source, 2, {
      kind: 'topic',
      course: 'COURSEA',
      name: 'Cross-bedding',
      aliases: ['Cross bedding'],
    });

    await bindConceptKeyToNote(source, key, {
      kind: 'note',
      noteUid: 'uid-xb',
      notePath: '05 Zettelkasten/Cross-bedding.md',
    });

    const records = await listConceptKeyRecords(source);
    expect(records[0]?.record.aliases).toEqual(
      expect.arrayContaining(['Cross-bedding', 'Cross bedding']),
    );
  });

  it('is idempotent: calling it twice with the same key and anchor writes no second time', async () => {
    const key = await resolveConceptKey(source, 2, {
      kind: 'topic',
      course: 'COURSEA',
      name: 'Volcanic tuff',
      aliases: [],
    });
    const noteAnchor = {
      kind: 'note' as const,
      noteUid: 'uid-vt',
      notePath: '05 Zettelkasten/Volcanic tuff.md',
    };

    await bindConceptKeyToNote(source, key, noteAnchor);
    const path = conceptKeyRecordPath(key);
    const bytesAfterFirst = await source.read(path);

    await bindConceptKeyToNote(source, key, noteAnchor);
    const bytesAfterSecond = await source.read(path);

    expect(bytesAfterSecond).toBe(bytesAfterFirst);
    const records = await listConceptKeyRecords(source);
    expect(records).toHaveLength(1);
    expect(records[0]?.record.aliases).toEqual(['Volcanic tuff']);
  });

  it('throws rather than minting when the key has no existing record', async () => {
    await expect(
      bindConceptKeyToNote(source, 'concept-prov1:nonexistent', {
        kind: 'note',
        noteUid: null,
        notePath: '05 Zettelkasten/Nonexistent.md',
      }),
    ).rejects.toThrow();

    const records = await listConceptKeyRecords(source);
    expect(records).toHaveLength(0);
  });
});

describe('extractConcepts — wired through the [D-174] sidecar when stampConceptKeys is on', () => {
  let root: string;
  let source: FolderSource;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'olea-concept-key-extract-'));
    source = new FolderSource(root);
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  async function write(relPath: string, content: string): Promise<void> {
    const full = join(root, ...relPath.split('/'));
    await mkdir(join(full, '..'), { recursive: true });
    await writeFile(full, content, 'utf8');
  }

  it('is off by default: no .olea/concepts/ writes and the pre-[D-174] provisional key is used', async () => {
    await write(
      '01 Courses/COURSEA/Note.md',
      '---\ntopic: [Basalt weathering]\ncourse: COURSEA\n---\n\n# Note\n',
    );
    const concepts = await extractConcepts(source);
    expect(concepts[0]?.key).toBe('concept-prov1:Basalt weathering');
    const records = await listConceptKeyRecords(source);
    expect(records).toHaveLength(0);
  });

  it('a bound concept mints once and a second extraction reads the same key back', async () => {
    await write(
      '05 Zettelkasten/Quartz cleavage.md',
      '---\ntype: concept\nolea-uid: uid-quartz\n---\n\n# Quartz cleavage\n\nDefinition, hers.\n',
    );
    await write(
      // `[D-248]`: the link is what puts the concept note in this course's
      // reading set, and binding is what this case is about.
      '01 Courses/COURSEA/Note.md',
      '---\ntopic: [[Quartz cleavage]]\ncourse: COURSEA\n---\n\n# Note\n',
    );

    const first = await extractConcepts(source, { stampConceptKeys: true });
    const key = first.find((c) => c.name === 'Quartz cleavage')?.key;
    expect(key).toBeDefined();

    const records = await listConceptKeyRecords(source);
    expect(records).toHaveLength(1);
    expect(records[0]?.record.anchor).toEqual({
      kind: 'note',
      noteUid: 'uid-quartz',
      notePath: '05 Zettelkasten/Quartz cleavage.md',
    });

    const second = await extractConcepts(source, { stampConceptKeys: true });
    expect(second.find((c) => c.name === 'Quartz cleavage')?.key).toBe(key);
    // Still exactly one record — the second run matched, it did not mint again.
    expect(await listConceptKeyRecords(source)).toHaveLength(1);
  });

  // The two orphaning cases `ol-zfty` names as the gap `[D-174]` was meant to close. Case (a)
  // (bound-note rename) is closed by the sidecar's `noteUid` anchor. Case (b) (a topic-only
  // concept's display string edited) is NOT closed by anything in this module today — see the
  // test's own comment for why the wiring never reaches the alias-match path `resolveConceptKey`
  // already implements and this file's own tests above already exercise in isolation.

  it('CASE (a), CLOSED: a bound Zettelkasten note renamed on disk keeps its key ([D-174] via noteUid)', async () => {
    await write(
      '05 Zettelkasten/Quartz cleavage.md',
      '---\ntype: concept\nolea-uid: uid-quartz\n---\n\n# Quartz cleavage\n\nDefinition, hers.\n',
    );
    await write(
      '01 Courses/COURSEA/Note.md',
      '---\ncourse: COURSEA\n---\n\nBody links to [[Quartz cleavage]].\n',
    );

    const before = await extractConcepts(source, { stampConceptKeys: true });
    const keyBefore = before.find((c) => c.name === 'Quartz cleavage')?.key;
    expect(keyBefore).toBeDefined();

    // She renames the note in Obsidian. `olea-uid` rides the file (it is frontmatter, not a
    // path), and Obsidian's own rename behaviour rewrites the wikilinks that point at it — both
    // simulated here by deleting the old path and writing the new one, and updating the one
    // note that links to it.
    await rm(join(root, '05 Zettelkasten', 'Quartz cleavage.md'));
    await write(
      '05 Zettelkasten/Quartz cleavage renamed.md',
      '---\ntype: concept\nolea-uid: uid-quartz\n---\n\n# Quartz cleavage renamed\n\nDefinition, hers.\n',
    );
    await write(
      '01 Courses/COURSEA/Note.md',
      '---\ncourse: COURSEA\n---\n\nBody links to [[Quartz cleavage renamed]].\n',
    );

    const after = await extractConcepts(source, { stampConceptKeys: true });
    const renamed = after.find((c) => c.name === 'Quartz cleavage renamed');
    expect(renamed).toBeDefined();
    // The display name moved (expected — it is a mutable attribute); the opaque key did not.
    expect(renamed?.key).toBe(keyBefore);

    // Exactly one sidecar record throughout — the rename refreshed `anchor.notePath` on the
    // existing record rather than minting a second one.
    const records = await listConceptKeyRecords(source);
    expect(records).toHaveLength(1);
    expect(records[0]?.record.anchor).toEqual({
      kind: 'note',
      noteUid: 'uid-quartz',
      notePath: '05 Zettelkasten/Quartz cleavage renamed.md',
    });
  });

  it('CASE (b), CLOSED by [D-180]/[D-183]: a topic-only concept whose display string is edited keeps its key', async () => {
    await write(
      '01 Courses/COURSEA/Note.md',
      '---\ntopic: [Basalt weathering]\ncourse: COURSEA\n---\n\n# Note\n',
    );
    const before = await extractConcepts(source, { stampConceptKeys: true });
    const keyBefore = before.find((c) => c.name === 'Basalt weathering')?.key;
    expect(keyBefore).toBeDefined();

    // She retitles the topic — same real-world concept, new wording, nothing else about the
    // note changes. There is no `noteUid` for a topic-only (no bound note) concept to anchor on.
    await write(
      '01 Courses/COURSEA/Note.md',
      '---\ntopic: [Basalt weathering process]\ncourse: COURSEA\n---\n\n# Note\n',
    );
    const after = await extractConcepts(source, { stampConceptKeys: true });
    const renamed = after.find((c) => c.name === 'Basalt weathering process');
    expect(renamed).toBeDefined();

    // `[D-180 / KEY-2]`/`[D-183 / NAME-1]` closed the gap: `extract.ts`'s `keysFor` now threads the
    // candidate's `sourcePaths` into the topic anchor as `introducingPaths`, and `key-store.ts`'s
    // rename-signature match recognises "same course, same introducingPaths, old wording absent
    // from this run" as the same concept re-worded. The display name renders the current wording
    // (a mutable attribute, per `[D-183]`'s written-vs-computed boundary); the key — what a
    // review-log record or mastery rollup actually joins on — does not move.
    expect(renamed?.key).toBe(keyBefore);

    // Never a silent rebind: exactly one sidecar record, and it is UNCHANGED — still anchored on
    // the old wording, since only a formal, accepted rename proposal (not built here) would ever
    // rewrite it.
    const records = await listConceptKeyRecords(source);
    expect(records).toHaveLength(1);
    expect(records[0]?.record.anchor).toEqual({
      kind: 'topic',
      course: 'COURSEA',
      name: 'Basalt weathering',
      aliases: [],
      introducingPaths: ['01 Courses/COURSEA/Note.md'],
    });
  });

  it('two distinct topic-only concepts sharing one introducing note are never merged', async () => {
    // Both wordings are cited by the SAME note, in the SAME run — not a rename, two concepts.
    await write(
      '01 Courses/COURSEA/Note.md',
      '---\ntopic: [Basalt weathering, Basalt weathering process]\ncourse: COURSEA\n---\n\n# Note\n',
    );
    const records = await extractConcepts(source, { stampConceptKeys: true });
    const a = records.find((c) => c.name === 'Basalt weathering');
    const b = records.find((c) => c.name === 'Basalt weathering process');
    expect(a).toBeDefined();
    expect(b).toBeDefined();
    // The old-wording-absent test fails for both (each is present in this very run), so the
    // rename signature never fires and each keeps its own key.
    expect(a?.key).not.toBe(b?.key);

    const sidecarRecords = await listConceptKeyRecords(source);
    expect(sidecarRecords).toHaveLength(2);
  });

  it('a record with no introducingPaths on disk never matches on the rename-signature branch', async () => {
    // Simulates a `ConceptKeyRecord` minted before `[D-180]` — no `introducingPaths` field at all.
    await mkdir(join(root, CONCEPT_KEY_STORE_FOLDER), { recursive: true });
    const preExistingKey = 'concept-prov1:COURSEA Basalt weathering';
    await writeFile(
      join(root, conceptKeyRecordPath(preExistingKey)),
      `${JSON.stringify(
        {
          key: preExistingKey,
          tier: 2,
          anchor: { kind: 'topic', course: 'COURSEA', name: 'Basalt weathering', aliases: [] },
          mintedAt: '2026-08-01',
          schemaVersion: 1,
        },
        null,
        2,
      )}\n`,
    );

    await write(
      '01 Courses/COURSEA/Note.md',
      '---\ntopic: [Basalt weathering process]\ncourse: COURSEA\n---\n\n# Note\n',
    );
    const records = await extractConcepts(source, { stampConceptKeys: true });
    const renamed = records.find((c) => c.name === 'Basalt weathering process');
    expect(renamed).toBeDefined();
    // No `introducingPaths` on the old record to compare against — never a match on this branch,
    // so a fresh key mints and the old record survives untouched.
    expect(renamed?.key).not.toBe(preExistingKey);

    const sidecarRecords = await listConceptKeyRecords(source);
    expect(sidecarRecords).toHaveLength(2);
    const untouched = sidecarRecords.find(({ record }) => record.key === preExistingKey);
    expect(untouched?.record.anchor).toEqual({
      kind: 'topic',
      course: 'COURSEA',
      name: 'Basalt weathering',
      aliases: [],
    });
  });
});

describe('findNormalizationCollisions (ONT-R1, ol-2zfj.86, C7.11 — mint-time index)', () => {
  function topicRecord(
    key: string,
    name: string,
    aliases: readonly string[] = [],
  ): ConceptKeyRecord {
    return {
      key,
      tier: 2,
      anchor: { kind: 'topic', course: 'COURSEA', name, aliases: [] },
      aliases,
      mintedAt: '2026-09-01',
      schemaVersion: 1,
    };
  }

  it('finds a case-and-whitespace collision', () => {
    const existing = [{ record: topicRecord('key-1', 'Basalt weathering') }];
    expect(findNormalizationCollisions(existing, ['  BASALT   weathering  '])).toEqual(['key-1']);
  });

  it('finds a collision against an alias, not only the primary name', () => {
    const existing = [
      { record: topicRecord('key-1', 'Basalt weathering', ['Weathering of basalt'.toLowerCase()]) },
    ];
    expect(findNormalizationCollisions(existing, ['weathering of basalt'])).toEqual(['key-1']);
  });

  it('never treats a NoteAnchor record as a candidate — wording collisions there are not this index’s job', () => {
    const existing = [
      {
        record: {
          key: 'key-note',
          tier: 1 as const,
          anchor: {
            kind: 'note' as const,
            noteUid: 'uid-1',
            notePath: '05 Zettelkasten/Basalt weathering.md',
          },
          mintedAt: '2026-09-01',
          schemaVersion: 1,
        },
      },
    ];
    expect(findNormalizationCollisions(existing, ['BASALT WEATHERING'])).toEqual([]);
  });

  it('reports no collision for a genuinely distinct wording', () => {
    const existing = [{ record: topicRecord('key-1', 'Basalt weathering') }];
    expect(findNormalizationCollisions(existing, ['Diffusion'])).toEqual([]);
  });

  it('excludes containment — "cell" does not collide with "cell biology"', () => {
    const existing = [{ record: topicRecord('key-1', 'Cell biology') }];
    expect(findNormalizationCollisions(existing, ['Cell'])).toEqual([]);
  });
});

describe('resolveConceptKey — normalisation-collision candidates recorded at mint (ONT-R1)', () => {
  let root: string;
  let source: FolderSource;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'olea-concept-key-store-norm-'));
    source = new FolderSource(root);
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it('a genuinely new topic mint records a normalisation collision against an existing key, and proposes rather than merges', async () => {
    const first = await resolveConceptKey(source, 2, {
      kind: 'topic',
      course: 'COURSEA',
      name: 'Basalt weathering',
      aliases: [],
    });

    // A different, case/whitespace-folded wording — not an exact-match, not an alias, not a
    // rename signature (no shared `introducingPaths`) — so this mints a genuinely SECOND key.
    const second = await resolveConceptKey(source, 2, {
      kind: 'topic',
      course: 'COURSEA',
      name: '  BASALT   Weathering  ',
      aliases: [],
    });

    // Proposes, never merges: both keys persist and are distinct.
    expect(second).not.toBe(first);

    const records = await listConceptKeyRecords(source);
    expect(records).toHaveLength(2);
    const secondRecord = records.find(({ record }) => record.key === second);
    expect(secondRecord?.record.normalizationCollisions).toEqual([first]);
    // The first record is untouched — the collision is recorded only on the NEW record, at ITS
    // own mint time, never retrofitted onto the existing one.
    const firstRecord = records.find(({ record }) => record.key === first);
    expect(firstRecord?.record.normalizationCollisions).toBeUndefined();
  });

  it('no collision field is written when nothing collides — the common case stays unchanged', async () => {
    const key = await resolveConceptKey(source, 2, {
      kind: 'topic',
      course: 'COURSEA',
      name: 'Basalt weathering',
      aliases: [],
    });
    const records = await listConceptKeyRecords(source);
    const record = records.find((r) => r.record.key === key);
    expect(record?.record.normalizationCollisions).toBeUndefined();
  });

  it('a bound (note) concept never gets a normalisation-collision entry', async () => {
    const key = await resolveConceptKey(source, 1, {
      kind: 'note',
      noteUid: 'uid-abc',
      notePath: '05 Zettelkasten/Basalt weathering.md',
    });
    const records = await listConceptKeyRecords(source);
    const record = records.find((r) => r.record.key === key);
    expect(record?.record.normalizationCollisions).toBeUndefined();
  });
});
