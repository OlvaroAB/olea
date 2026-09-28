/**
 * C5.3 as amended by `[D-090]`/`[D-392]` (`ol-v7r5.91`): the review open finds a deleted
 * instrument id's near-certain successor between vault walks and, per `[D-392]`, offers her one
 * grouped choice instead of guessing whenever certainty is not near.
 *
 * `olea-core`'s `matchDeletedInstrumentIds`/`resolveInstrumentRepair` (their own `.spec.ts` files)
 * prove the pure matching and single-candidate decision; `./repair-choice.spec.ts` proves the pure
 * grouped-choice model; `duplication-confirmation-store.spec.ts` proves the shared store's
 * repair-choice half. This file proves the production open path joins all three over a real
 * (in-memory) vault and a real walk:
 *
 *  - the first open of a tab runs no matching at all — an honest "nothing to compare against yet";
 *  - a single byte-identical, same-file candidate repairs silently: no confirmation record, and the
 *    deleted id is written back into the item's own metadata position (`ol-v7r5.105`), after which
 *    the same open re-walks so the item is served under its recovered id;
 *  - anything short of that — one uncertain candidate, or more than one candidate at all — writes
 *    ONE grouped-choice proposal into the shared store, never one per candidate;
 *  - `createReviewSessionOpener` threads the previous walk's enumeration between opens on its own,
 *    without a caller ever supplying it;
 *  - short of near-certainty nothing is written into a note she authored (INV-6) — only the silent
 *    repair writes, and only the `[D-030]` identity marker — and a store that cannot be written
 *    never costs her the review.
 */

import type { ClozeIdAnchor, ComposedStudySession, VaultSource } from 'olea-core';
import {
  calendarDayFromLocalDate,
  createFsrsScheduler,
  enumerateVaultInstruments,
  removeSpans,
  stampClozeId,
} from 'olea-core';
import { describe, expect, it } from 'vitest';
import {
  DUPLICATION_CONFIRMATION_FOLDER,
  listRepairChoiceConfirmationRecords,
  proposeRepairChoiceConfirmations,
} from '../../src/review/duplication-confirmation-store.js';
import {
  createReviewSessionOpener,
  type EnumeratedInstrument,
  type OpenReviewSessionInput,
  openReviewSession,
} from '../../src/review/open-session.js';
import {
  createVaultNoteExistsPort,
  createVaultReviewLogPort,
  createVaultSuspendPort,
} from '../../src/review/ports.js';
import { createStudySessionHolder } from '../../src/session/holder.js';
import { type MemoryVault, memoryVault } from './memory-vault.js';

const DEVICE = 'olea-testdevice1';
const NOW = new Date('2026-08-10T14:00:00-04:00');
const NOTE_FRONTMATTER = ['---', 'topic: [Alpha]', 'course: TEST101', '---'].join('\n');

function baseVaultFiles(): Record<string, string> {
  return {
    'Concepts/Alpha.md': [
      '---',
      'title: Alpha',
      'course: TEST101',
      '---',
      '',
      'A concept.',
      '',
    ].join('\n'),
  };
}

function mcqBlock(stem: string): string {
  return [
    '```olea-mcq',
    `stem: ${stem}`,
    'answer: The right one',
    'distractor: d1',
    'distractor: d2',
    'distractor: d3',
    'distractor: d4',
    'feedback: Because of the thing.',
    '```',
  ].join('\n');
}

/** A single orphan MCQ (no `id:` field) under its own heading. */
function orphanMcqNote(stem: string): string {
  return [NOTE_FRONTMATTER, '## A question?', '', mcqBlock(stem), ''].join('\n');
}

/** This walk's own raw text for the one instrument at `notePath` — never guessed at by hand. */
async function rawAt(vault: VaultSource, notePath: string): Promise<string> {
  const { records } = await enumerateVaultInstruments(vault);
  const record = records.find((r) => r.notePath === notePath);
  if (record === undefined) throw new Error(`no enumerated instrument at ${notePath}`);
  return record.instrumentType === 'mcq' ? record.mcq.raw : record.card.raw;
}

function emptyComposition(): ComposedStudySession {
  return {
    model: {
      asOf: calendarDayFromLocalDate(NOW),
      budgetMinutes: 20,
      budgetSeconds: 1200,
      plannedSeconds: 0,
      items: [],
      leftOut: [],
      leftOutInstrumentCount: 0,
      consideredRowCount: 0,
      formatPreference: 'unknown',
      nextAssessment: null,
      durationBasis: 'assumed',
      focusConcept: null,
    },
    overflow: [],
    courseShares: new Map(),
    forcedCourses: [],
    obligationClasses: new Map(),
    citationRecheckQueued: new Set(),
    citationRevalidationPending: new Set(),
  };
}

async function input(
  vault: VaultSource,
  opts: { readonly previousInstrumentEnumeration?: readonly EnumeratedInstrument[] } = {},
): Promise<OpenReviewSessionInput> {
  return {
    vault,
    scheduler: createFsrsScheduler(),
    deviceId: DEVICE,
    probeDays: 30,
    studySessionHolder: createStudySessionHolder(),
    composeDefaultStudySession: async () => emptyComposition(),
    ...(opts.previousInstrumentEnumeration !== undefined
      ? { previousInstrumentEnumeration: opts.previousInstrumentEnumeration }
      : {}),
    ports: {
      reviewLog: createVaultReviewLogPort(vault, DEVICE),
      suspendPort: createVaultSuspendPort(vault, DEVICE),
      editPort: { async edit() {} },
      noteExists: createVaultNoteExistsPort(vault),
      clock: { now: () => NOW },
      draftAcceptPort: {
        accept() {
          throw new Error('no draft item in this suite');
        },
        reject() {
          throw new Error('no draft item in this suite');
        },
      },
    },
  };
}

async function open(vault: VaultSource, opts: Parameters<typeof input>[1] = {}) {
  const outcome = await openReviewSession(await input(vault, opts));
  if (!outcome.ok) throw new Error(`expected a composed session: ${String(outcome.error)}`);
  return outcome;
}

describe('the first open of a tab', () => {
  it('runs no repair matching at all — nothing to compare against yet', async () => {
    const notePath = 'Notes/Candidate.md';
    const vault: MemoryVault = memoryVault({
      ...baseVaultFiles(),
      [notePath]: orphanMcqNote('What is the mitochondria?'),
    });

    const outcome = await open(vault);

    expect(await listRepairChoiceConfirmationRecords(vault)).toHaveLength(0);
    expect(outcome.instrumentEnumeration.length).toBeGreaterThan(0);
  });
});

describe('a single near-certain candidate repairs silently', () => {
  it('byte-identical, same file, id unclaimed: no confirmation record, and the id is written back', async () => {
    const notePath = 'Notes/Candidate.md';
    const before = orphanMcqNote('What is the mitochondria?');
    const vault: MemoryVault = memoryVault({ ...baseVaultFiles(), [notePath]: before });
    const raw = await rawAt(vault, notePath);
    const previous: readonly EnumeratedInstrument[] = [
      { instrumentId: 'mcq-deleted-1', raw, notePath, instrumentType: 'mcq' },
    ];

    const outcome = await open(vault, { previousInstrumentEnumeration: previous });

    expect(await listRepairChoiceConfirmationRecords(vault)).toHaveLength(0);
    // The only change to her note is the recovered identity marker (INV-2 over the rest).
    const after = vault.contentOf(notePath) ?? '';
    const marker = 'id: mcq-deleted-1\n';
    const start = after.indexOf(marker);
    expect(start).toBeGreaterThan(-1);
    expect(removeSpans(after, [{ start, end: start + marker.length }])).toBe(before);
    // The same open re-walked: it already serves the item under its recovered id.
    expect(outcome.instrumentEnumeration.map((r) => r.instrumentId)).toContain('mcq-deleted-1');
    const { records } = await enumerateVaultInstruments(vault);
    expect(records.filter((r) => r.notePath === notePath).map((r) => r.instrumentId)).toEqual([
      'mcq-deleted-1',
    ]);
  });

  it('a second open after the write-back writes nothing more and proposes nothing', async () => {
    const notePath = 'Notes/Candidate.md';
    const vault: MemoryVault = memoryVault({
      ...baseVaultFiles(),
      [notePath]: orphanMcqNote('What is the mitochondria?'),
    });
    const raw = await rawAt(vault, notePath);
    const first = await open(vault, {
      previousInstrumentEnumeration: [
        { instrumentId: 'mcq-deleted-1', raw, notePath, instrumentType: 'mcq' },
      ],
    });
    const noteWrites = () => vault.writes.filter((w) => w === notePath).length;
    expect(noteWrites()).toBe(1);

    await open(vault, { previousInstrumentEnumeration: first.instrumentEnumeration });

    expect(noteWrites()).toBe(1);
    expect(await listRepairChoiceConfirmationRecords(vault)).toHaveLength(0);
  });

  it('writes nothing when the previous walk saw the deleted id as a different type', async () => {
    const notePath = 'Notes/Candidate.md';
    const before = orphanMcqNote('What is the mitochondria?');
    const vault: MemoryVault = memoryVault({ ...baseVaultFiles(), [notePath]: before });
    const raw = await rawAt(vault, notePath);

    await open(vault, {
      previousInstrumentEnumeration: [
        { instrumentId: 'mcq-deleted-1', raw, notePath, instrumentType: 'cloze' },
      ],
    });

    expect(vault.contentOf(notePath)).toBe(before);
    expect(await listRepairChoiceConfirmationRecords(vault)).toHaveLength(0);
  });

  it('a note that cannot be written never costs her the review', async () => {
    const notePath = 'Notes/Candidate.md';
    const before = orphanMcqNote('What is the mitochondria?');
    const vault: MemoryVault = memoryVault({ ...baseVaultFiles(), [notePath]: before });
    const raw = await rawAt(vault, notePath);
    const refusing: VaultSource = {
      ...vault,
      list: vault.list.bind(vault),
      read: vault.read.bind(vault),
      exists: vault.exists.bind(vault),
      async write(path, content) {
        if (path === notePath) throw new Error('read-only note');
        return vault.write(path, content);
      },
    };

    const outcome = await openReviewSession(
      await input(refusing, {
        previousInstrumentEnumeration: [
          { instrumentId: 'mcq-deleted-1', raw, notePath, instrumentType: 'mcq' },
        ],
      }),
    );

    expect(outcome.ok).toBe(true);
    expect(vault.contentOf(notePath)).toBe(before);
  });
});

describe('anything short of near-certainty goes to her grouped choice, per [D-392]', () => {
  it('a single candidate whose text changed is proposed, never silently repaired', async () => {
    const notePath = 'Notes/Candidate.md';
    const vault: MemoryVault = memoryVault({
      ...baseVaultFiles(),
      [notePath]: orphanMcqNote('What is the mitochondria?'),
    });
    const raw = await rawAt(vault, notePath);
    const previous: readonly EnumeratedInstrument[] = [
      { instrumentId: 'mcq-deleted-1', raw: `${raw} (edited)`, notePath, instrumentType: 'mcq' },
    ];

    await open(vault, { previousInstrumentEnumeration: previous });

    const records = await listRepairChoiceConfirmationRecords(vault);
    expect(records).toHaveLength(1);
    expect(records[0]?.record.instrumentId).toBe('mcq-deleted-1');
    expect(records[0]?.record.status).toBe('proposed');
    // `[D-409]`: the open path digests the candidate itself, so this is written as schema
    // version 2, not the undigested version 1 shape.
    expect(records[0]?.record.schemaVersion).toBe(2);
    expect(records[0]?.record.candidates).toHaveLength(1);
    const [candidate] = records[0]?.record.candidates ?? [];
    expect(candidate?.notePath).toBe(notePath);
    expect(candidate?.meetsCertaintyTest).toBe(false);
    expect(candidate?.digest).toMatch(/^[0-9a-f]{64}$/);
  });

  it('[D-409] a resolved version-1 record is left exactly as it is by a later open, never upgraded', async () => {
    const notePath = 'Notes/Candidate.md';
    const vault: MemoryVault = memoryVault({
      ...baseVaultFiles(),
      [notePath]: orphanMcqNote('What is the mitochondria?'),
    });
    const raw = await rawAt(vault, notePath);

    // A record as the store wrote it before `[D-409]`'s digest existed: undigested candidates,
    // schema version 1, and already resolved — as if she answered the grouped choice back then.
    const { records: proposed } = await proposeRepairChoiceConfirmations(vault, [
      {
        instrumentId: 'mcq-deleted-1',
        candidates: [{ notePath, meetsCertaintyTest: false }],
        proposedAt: 1_000,
      },
    ]);
    const [stored] = proposed;
    if (stored === undefined) throw new Error('fixture expected a stored record');
    expect(stored.record.schemaVersion).toBe(1);
    const resolvedV1 = {
      ...stored.record,
      status: 'confirmed' as const,
      confirmedAt: new Date(1_500).toISOString(),
      resolvedNotePath: notePath,
    };
    await vault.write(stored.path, `${JSON.stringify(resolvedV1, null, 2)}\n`);

    // The same deleted id is proposed again by a later open (the note still hasn't recovered its
    // id) — binding condition 1 says her answer is never rewritten, and the migration posture
    // says a RESOLVED version 1 record is never upgraded in place, unlike a still-proposed one.
    const previous: readonly EnumeratedInstrument[] = [
      { instrumentId: 'mcq-deleted-1', raw: `${raw} (edited)`, notePath, instrumentType: 'mcq' },
    ];
    await open(vault, { previousInstrumentEnumeration: previous });

    const after = await listRepairChoiceConfirmationRecords(vault);
    expect(after).toHaveLength(1);
    expect(after[0]?.record).toEqual(resolvedV1);
  });

  it('more than one candidate in the deleted id’s own file is ONE grouped choice, never one per candidate', async () => {
    const notePath = 'Notes/Candidates.md';
    const vault: MemoryVault = memoryVault({
      ...baseVaultFiles(),
      [notePath]: [
        NOTE_FRONTMATTER,
        '## Q1',
        '',
        mcqBlock('Question A?'),
        '',
        '## Q2',
        '',
        mcqBlock('Question B?'),
        '',
      ].join('\n'),
    });
    // Names neither candidate's text — both qualify only via the same-file dial, so this proves
    // "more than one candidate is never silent" independent of any individual certainty.
    const previous: readonly EnumeratedInstrument[] = [
      {
        instrumentId: 'mcq-deleted-1',
        raw: 'text matching neither candidate',
        notePath,
        instrumentType: 'mcq',
      },
    ];

    await open(vault, { previousInstrumentEnumeration: previous });

    const records = await listRepairChoiceConfirmationRecords(vault);
    expect(records).toHaveLength(1);
    expect(records[0]?.record.candidates).toHaveLength(2);
  });

  it('a deleted id with no candidate anywhere writes nothing', async () => {
    const vault: MemoryVault = memoryVault(baseVaultFiles());
    const previous: readonly EnumeratedInstrument[] = [
      {
        instrumentId: 'mcq-deleted-1',
        raw: 'gone for good',
        notePath: 'Notes/Nowhere.md',
        instrumentType: 'mcq',
      },
    ];

    await open(vault, { previousInstrumentEnumeration: previous });

    expect(await listRepairChoiceConfirmationRecords(vault)).toHaveLength(0);
  });

  it('opening again with the same candidates writes nothing new', async () => {
    const notePath = 'Notes/Candidate.md';
    const vault: MemoryVault = memoryVault({
      ...baseVaultFiles(),
      [notePath]: orphanMcqNote('What is the mitochondria?'),
    });
    const raw = await rawAt(vault, notePath);
    const previous: readonly EnumeratedInstrument[] = [
      { instrumentId: 'mcq-deleted-1', raw: `${raw} (edited)`, notePath, instrumentType: 'mcq' },
    ];
    await open(vault, { previousInstrumentEnumeration: previous });
    const writesBefore = vault.writes.length;

    await open(vault, { previousInstrumentEnumeration: previous });

    expect(vault.writes.length).toBe(writesBefore);
    expect(await listRepairChoiceConfirmationRecords(vault)).toHaveLength(1);
  });
});

describe('where it writes, and what a failed write costs', () => {
  it('short of near-certainty every write lands under its own dot folder — never into a note she authored (INV-6)', async () => {
    const notePath = 'Notes/Candidate.md';
    const before = orphanMcqNote('What is the mitochondria?');
    const vault: MemoryVault = memoryVault({ ...baseVaultFiles(), [notePath]: before });
    const raw = await rawAt(vault, notePath);
    const previous: readonly EnumeratedInstrument[] = [
      { instrumentId: 'mcq-deleted-1', raw: `${raw} (edited)`, notePath, instrumentType: 'mcq' },
    ];

    await open(vault, { previousInstrumentEnumeration: previous });

    expect(vault.writes.length).toBeGreaterThan(0);
    for (const written of vault.writes) expect(written.startsWith('.olea/')).toBe(true);
    expect(vault.contentOf(notePath)).toBe(before);
  });

  it('a store that cannot be written never costs her the review', async () => {
    const notePath = 'Notes/Candidate.md';
    const vault: MemoryVault = memoryVault({
      ...baseVaultFiles(),
      [notePath]: orphanMcqNote('What is the mitochondria?'),
    });
    const raw = await rawAt(vault, notePath);
    const previous: readonly EnumeratedInstrument[] = [
      { instrumentId: 'mcq-deleted-1', raw: `${raw} (edited)`, notePath, instrumentType: 'mcq' },
    ];
    const refusing: VaultSource = {
      ...vault,
      list: vault.list.bind(vault),
      read: vault.read.bind(vault),
      exists: vault.exists.bind(vault),
      async write(path, content) {
        if (path.startsWith(`${DUPLICATION_CONFIRMATION_FOLDER}/`)) throw new Error('disk full');
        return vault.write(path, content);
      },
    };

    const outcome = await openReviewSession(
      await input(refusing, { previousInstrumentEnumeration: previous }),
    );

    if (!outcome.ok) throw new Error('expected the review to open despite the store failing');
    expect(await listRepairChoiceConfirmationRecords(vault)).toHaveLength(0);
  });
});

describe('a real round trip: a stamped cloze id disappears from the frontmatter map', () => {
  const NOTE_PATH = 'Courses/TEST101/cloze.md';
  const ANCHOR: ClozeIdAnchor = { noteUid: null, notePath: NOTE_PATH, heading: 'Q1', ordinal: 1 };
  const UNSTAMPED = [NOTE_FRONTMATTER, '## Q1', '', 'A ==blank== in a sentence.', ''].join('\n');

  it('byte-identical, same file: repaired silently — cloze ids live outside the card line (C5.3)', async () => {
    const stamped = stampClozeId(UNSTAMPED, ANCHOR, () => 'cloze-orig-1').content;
    const before = memoryVault({ ...baseVaultFiles(), [NOTE_PATH]: stamped });
    const { records } = await enumerateVaultInstruments(before);
    const record = records.find((r) => r.instrumentType === 'cloze');
    if (record === undefined) throw new Error('expected a cloze record');
    expect(record.instrumentId).toBe('cloze-orig-1');
    const previous: readonly EnumeratedInstrument[] = [
      {
        instrumentId: record.instrumentId,
        raw: record.card.raw,
        notePath: NOTE_PATH,
        instrumentType: 'cloze',
      },
    ];

    // The frontmatter map entry is gone (a sync artifact, a manual edit) — her card's own line is
    // byte-for-byte unchanged.
    const after: MemoryVault = memoryVault({ ...baseVaultFiles(), [NOTE_PATH]: UNSTAMPED });

    const outcome = await open(after, { previousInstrumentEnumeration: previous });

    expect(await listRepairChoiceConfirmationRecords(after)).toHaveLength(0);
    // Written back into the frontmatter map, never the card line, and read back by the re-walk.
    const content = after.contentOf(NOTE_PATH) ?? '';
    expect(content).toContain('cloze-orig-1');
    expect(content).toContain('A ==blank== in a sentence.\n');
    expect(outcome.instrumentEnumeration.map((r) => r.instrumentId)).toContain('cloze-orig-1');
  });
});

describe('createReviewSessionOpener threads the previous enumeration between opens', () => {
  it('a second open on the SAME opener finds a deleted id without ever being told the previous walk', async () => {
    const NOTE_PATH = 'Courses/TEST101/cloze.md';
    const anchor: ClozeIdAnchor = { noteUid: null, notePath: NOTE_PATH, heading: 'Q1', ordinal: 1 };
    const stamped = stampClozeId(
      [NOTE_FRONTMATTER, '## Q1', '', 'A ==blank== in a sentence.', ''].join('\n'),
      anchor,
      () => 'cloze-orig-1',
    ).content;
    const vault1: MemoryVault = memoryVault({ ...baseVaultFiles(), [NOTE_PATH]: stamped });
    const opener = createReviewSessionOpener({ now: () => NOW });

    const outcome1 = await opener.open(await input(vault1));
    if (!outcome1.ok) throw new Error('expected the first open to succeed');
    expect(outcome1.instrumentEnumeration.some((r) => r.instrumentId === 'cloze-orig-1')).toBe(
      true,
    );

    // Between opens: the frontmatter cloze-id entry is lost AND the card's own text changed — short
    // of near-certainty, so `[D-392]` sends this to her grouped choice, never a silent repair.
    // `input()` below never supplies `previousInstrumentEnumeration` itself — only the opener does.
    const vault2: MemoryVault = memoryVault({
      ...baseVaultFiles(),
      [NOTE_PATH]: [NOTE_FRONTMATTER, '## Q1', '', 'A ==different blank== in a sentence.', ''].join(
        '\n',
      ),
    });

    const outcome2 = await opener.open(await input(vault2));

    expect(outcome2.ok).toBe(true);
    const records = await listRepairChoiceConfirmationRecords(vault2);
    expect(records).toHaveLength(1);
    expect(records[0]?.record.instrumentId).toBe('cloze-orig-1');
  });
});
