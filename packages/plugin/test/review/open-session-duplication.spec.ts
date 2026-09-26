/**
 * C5.3 as amended by `[D-090]`, persisted per `[D-380]` (`ol-v7r5.88`): the review open withholds a
 * duplicated item id's losing copy and records its confirmation entry.
 *
 * `olea-core`'s `resolveInstrumentDuplications` (`instrument/duplication.spec.ts`) proves the pure
 * half and `duplication-confirmation-store.spec.ts` the store; this file proves the production
 * open path joins them over a real (in-memory) vault and a real walk:
 *
 *  - the losing copy never reaches her queue — the id is served once, from the kept copy, even
 *    when the composition names both copies (F3: "one scheduling history is never fed by two
 *    physical items"), and whatever status the record holds (F3: "it holds while the loser waits in
 *    the queue as much as after she answers");
 *  - its entry persists as one record per losing note, naming both copies, the reason and the
 *    status, and a rename of either note between two opens neither loses nor duplicates it;
 *  - nothing is written into a note she authored (INV-6), and a store that cannot be written never
 *    costs her the review.
 */

import type { ComposedStudySession, StudySessionItem, VaultSource } from 'olea-core';
import {
  calendarDayFromLocalDate,
  createFsrsScheduler,
  enumerateVaultInstruments,
} from 'olea-core';
import { describe, expect, it } from 'vitest';
import {
  DUPLICATION_CONFIRMATION_FOLDER,
  listDuplicationConfirmationRecords,
} from '../../src/review/duplication-confirmation-store.js';
import { type OpenReviewSessionInput, openReviewSession } from '../../src/review/open-session.js';
import {
  createVaultNoteExistsPort,
  createVaultReviewLogPort,
  createVaultSuspendPort,
} from '../../src/review/ports.js';
import { createStudySessionHolder } from '../../src/session/holder.js';
import { type MemoryVault, memoryVault } from './memory-vault.js';

const DEVICE = 'olea-testdevice1';
const NOW = new Date('2026-08-10T14:00:00-04:00');
const STAMPED = { concepts: { stampConceptKeys: true } } as const;

const DUP_ID = 'mcq-dup-1';
/** Enumerated first, so today's last-write-wins walk keeps the OTHER copy: this one loses. */
const LOSING_NOTE = 'Courses/TEST101/Week one.md';
/** Enumerated last: this copy keeps the id. */
const KEPT_NOTE = 'Courses/TEST101/Week two.md';

function mcqNote(stem: string): string {
  return [
    '---',
    'topic: [Alpha]',
    'course: TEST101',
    '---',
    '## A question?',
    '',
    '```olea-mcq',
    `id: ${DUP_ID}`,
    `stem: ${stem}`,
    'answer: The right one',
    'distractor: d1',
    'distractor: d2',
    'distractor: d3',
    'distractor: d4',
    'feedback: Because of the thing.',
    '```',
    '',
  ].join('\n');
}

/** One item id, two copies — different stems, so which copy she is served is readable. */
function duplicatedVault(): MemoryVault {
  return memoryVault({
    'Concepts/Alpha.md': [
      '---',
      'title: Alpha',
      'course: TEST101',
      '---',
      '',
      'A concept.',
      '',
    ].join('\n'),
    [LOSING_NOTE]: mcqNote('Losing copy stem?'),
    [KEPT_NOTE]: mcqNote('Kept copy stem?'),
  });
}

/** The same vault with one file moved — a rename, as the next walk sees it. */
async function renamed(vault: MemoryVault, from: string, to: string): Promise<MemoryVault> {
  const files: Record<string, string> = {};
  for (const path of await vault.list()) {
    const content = vault.contentOf(path);
    if (content !== undefined) files[path === from ? to : path] = content;
  }
  return memoryVault(files);
}

/** A composition naming exactly these rows, in order, the shape the study-session composer returns. */
async function composition(
  vault: VaultSource,
  rows: readonly { readonly instrumentId: string; readonly notePath: string }[],
): Promise<ComposedStudySession> {
  const enumeration = await enumerateVaultInstruments(vault, STAMPED);
  const items: StudySessionItem[] = rows.map((row, index) => {
    const record = enumeration.records.find(
      (r) => r.instrumentId === row.instrumentId && r.notePath === row.notePath,
    );
    if (record === undefined) throw new Error(`no enumerated copy at ${row.notePath}`);
    return {
      position: index + 1,
      instrumentId: record.instrumentId,
      instrumentType: record.instrumentType,
      notePath: record.notePath,
      noteTitle: record.noteTitle,
      conceptName: 'Alpha',
      course: 'TEST101',
      gapClass: 'coverage-gap',
      gapRank: index + 1,
      gapScore: 1,
      estimatedSeconds: 60,
      durationSource: 'assumed',
      formatMatch: 'no-preference',
    };
  });
  return {
    model: {
      asOf: calendarDayFromLocalDate(NOW),
      budgetMinutes: 20,
      budgetSeconds: 1200,
      plannedSeconds: items.length * 60,
      items,
      leftOut: [],
      leftOutInstrumentCount: 0,
      consideredRowCount: items.length,
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

/**
 * `held` pre-seeds an active sitting (a resume); omitted, the holder is idle and the open composes
 * once through `composeDefaultStudySession` — the production path for a fresh open.
 */
async function input(
  vault: VaultSource,
  opts: {
    readonly held?: ComposedStudySession;
    readonly fresh?: ComposedStudySession;
  },
): Promise<OpenReviewSessionInput> {
  const holder = createStudySessionHolder();
  if (opts.held !== undefined) holder.enter(NOW, opts.held);
  return {
    vault,
    scheduler: createFsrsScheduler(),
    deviceId: DEVICE,
    probeDays: 30,
    studySessionHolder: holder,
    composeDefaultStudySession: async () => {
      if (opts.fresh === undefined) throw new Error('no fresh composition in this fixture');
      return opts.fresh;
    },
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

async function open(vault: VaultSource, opts: Parameters<typeof input>[1]) {
  const outcome = await openReviewSession(await input(vault, opts));
  if (!outcome.ok) throw new Error(`expected a composed session: ${String(outcome.error)}`);
  return outcome;
}

function servedCopies(outcome: Awaited<ReturnType<typeof open>>) {
  return outcome.scheduledQueue
    .filter((item) => item.instrument.instrumentId === DUP_ID)
    .map((item) => ({
      sourcePath: item.instrument.sourcePath,
      stem: item.instrument.type === 'mcq' ? item.instrument.stem : null,
    }));
}

describe('the losing copy never reaches her queue', () => {
  it('a composition naming BOTH copies serves the id once, from the kept copy', async () => {
    const vault = duplicatedVault();
    const held = await composition(vault, [
      { instrumentId: DUP_ID, notePath: LOSING_NOTE },
      { instrumentId: DUP_ID, notePath: KEPT_NOTE },
    ]);

    const outcome = await open(vault, { held });

    expect(servedCopies(outcome)).toEqual([{ sourcePath: KEPT_NOTE, stem: 'Kept copy stem?' }]);
    expect(outcome.itemCount).toBe(1);
  });

  it('a fresh composition whose one row names the LOSING copy still serves the kept copy', async () => {
    const vault = duplicatedVault();
    const fresh = await composition(vault, [{ instrumentId: DUP_ID, notePath: LOSING_NOTE }]);

    const outcome = await open(vault, { fresh });

    expect(servedCopies(outcome)).toEqual([{ sourcePath: KEPT_NOTE, stem: 'Kept copy stem?' }]);
  });

  it('stays withheld whatever her recorded answer says — the record never un-withholds a copy', async () => {
    const vault = duplicatedVault();
    const rows = [
      { instrumentId: DUP_ID, notePath: LOSING_NOTE },
      { instrumentId: DUP_ID, notePath: KEPT_NOTE },
    ];
    await open(vault, { held: await composition(vault, rows) });
    const [only] = await listDuplicationConfirmationRecords(vault);
    if (only === undefined) throw new Error('expected a record after the first open');
    await vault.write(
      only.path,
      `${JSON.stringify({ ...only.record, status: 'confirmed', confirmedAt: NOW.toISOString() }, null, 2)}\n`,
    );

    const outcome = await open(vault, { held: await composition(vault, rows) });

    expect(servedCopies(outcome)).toEqual([{ sourcePath: KEPT_NOTE, stem: 'Kept copy stem?' }]);
  });
});

describe('its confirmation entry persists, per [D-380]', () => {
  it('one record for the losing note, naming both copies, the reason and the proposed status', async () => {
    const vault = duplicatedVault();
    await open(vault, {
      held: await composition(vault, [{ instrumentId: DUP_ID, notePath: KEPT_NOTE }]),
    });

    const records = await listDuplicationConfirmationRecords(vault);
    expect(records).toHaveLength(1);
    expect(records[0]?.record).toEqual({
      losing: { notePath: LOSING_NOTE, noteUid: null },
      collisions: [{ instrumentId: DUP_ID, kept: { notePath: KEPT_NOTE, noteUid: null } }],
      status: 'proposed',
      reason: 'duplicate-instrument-id',
      proposedAt: NOW.toISOString(),
      schemaVersion: 1,
    });
  });

  it('opening again writes nothing new to the store', async () => {
    const vault = duplicatedVault();
    const held = await composition(vault, [{ instrumentId: DUP_ID, notePath: KEPT_NOTE }]);
    await open(vault, { held });
    const storeWrites = () =>
      vault.writes.filter((path) => path.startsWith(`${DUPLICATION_CONFIRMATION_FOLDER}/`));
    const before = storeWrites().length;

    await open(vault, { held });

    expect(storeWrites().length).toBe(before);
  });

  it('renaming the losing note between two opens keeps ONE record, naming its new path', async () => {
    const first = duplicatedVault();
    await open(first, {
      held: await composition(first, [{ instrumentId: DUP_ID, notePath: KEPT_NOTE }]),
    });
    const moved = 'Courses/TEST101/Week one renamed.md';
    const second = await renamed(first, LOSING_NOTE, moved);

    await open(second, {
      held: await composition(second, [{ instrumentId: DUP_ID, notePath: KEPT_NOTE }]),
    });

    const records = await listDuplicationConfirmationRecords(second);
    expect(records).toHaveLength(1);
    expect(records[0]?.record.losing.notePath).toBe(moved);
    expect(records[0]?.record.collisions[0]?.kept.notePath).toBe(KEPT_NOTE);
  });

  it('renaming the kept note — even when that flips which copy the walk keeps — keeps ONE record', async () => {
    const first = duplicatedVault();
    await open(first, {
      held: await composition(first, [{ instrumentId: DUP_ID, notePath: KEPT_NOTE }]),
    });
    // Sorted ahead of every course note: the walk now enumerates it first, so it loses.
    const moved = 'Archive/Week two.md';
    const second = await renamed(first, KEPT_NOTE, moved);

    const outcome = await open(second, {
      held: await composition(second, [{ instrumentId: DUP_ID, notePath: LOSING_NOTE }]),
    });

    const records = await listDuplicationConfirmationRecords(second);
    expect(records).toHaveLength(1);
    expect(records[0]?.record.losing.notePath).toBe(moved);
    expect(records[0]?.record.collisions[0]?.kept.notePath).toBe(LOSING_NOTE);
    expect(servedCopies(outcome)).toHaveLength(1);
  });
});

describe('where it writes, and what a failed write costs', () => {
  it('writes nothing into a note she authored (INV-6)', async () => {
    const vault = duplicatedVault();
    await open(vault, {
      held: await composition(vault, [{ instrumentId: DUP_ID, notePath: KEPT_NOTE }]),
    });

    expect(
      vault.writes.some((path) => path.startsWith(`${DUPLICATION_CONFIRMATION_FOLDER}/`)),
    ).toBe(true);
    for (const path of vault.writes) expect(path.startsWith('.olea/')).toBe(true);
    expect(vault.contentOf(LOSING_NOTE)).toBe(mcqNote('Losing copy stem?'));
    expect(vault.contentOf(KEPT_NOTE)).toBe(mcqNote('Kept copy stem?'));
  });

  it('with no duplicated id, the store is never written', async () => {
    const vault = memoryVault({
      'Concepts/Alpha.md': [
        '---',
        'title: Alpha',
        'course: TEST101',
        '---',
        '',
        'A concept.',
        '',
      ].join('\n'),
      [KEPT_NOTE]: mcqNote('Kept copy stem?'),
    });
    await open(vault, {
      held: await composition(vault, [{ instrumentId: DUP_ID, notePath: KEPT_NOTE }]),
    });

    expect(
      vault.writes.some((path) => path.startsWith(`${DUPLICATION_CONFIRMATION_FOLDER}/`)),
    ).toBe(false);
  });

  it('a store that cannot be written never costs her the review, and the loser stays withheld', async () => {
    const vault = duplicatedVault();
    const held = await composition(vault, [
      { instrumentId: DUP_ID, notePath: LOSING_NOTE },
      { instrumentId: DUP_ID, notePath: KEPT_NOTE },
    ]);
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

    const outcome = await openReviewSession(await input(refusing, { held }));

    if (!outcome.ok) throw new Error('expected the review to open despite the store failing');
    expect(servedCopies(outcome)).toEqual([{ sourcePath: KEPT_NOTE, stem: 'Kept copy stem?' }]);
  });
});
