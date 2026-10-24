/**
 * `ol-egov.141.89.2.39` ([D-626], [D-628]): every note a drafted item was drawn from protects it.
 *
 * Scenarios (service repo, `features/F3-learn-from-anything.md`, "Feature: F3.3 / C5.3 — a drafted
 * item records every note it was drawn from, and each protects it"), written before this code:
 *  - "a change to any input note withholds a kept item before it is shown";
 *  - "a change to any input note withholds a pending draft, and its acceptance is refused";
 *  - "a hold on any input note holds the item";
 *  - "a drafted item recorded before input notes were is withheld and drafted again".
 * And the keep half of "the citation record carries the input notes" (a pending draft with input
 * notes that she keeps is written at schema version 3 with the same notes; the store half is
 * `packages/core/src/instrument/citation-store.input-notes.spec.ts`).
 *
 * Through the production pieces: `openReviewSession` (the session the student sits, with the draft
 * cache as provenance), the presentation checks it composes (`sourceCheckAtPresentation`,
 * `draftSourceCheckAtPresentation`), the accept port, the citation pass (`CitationRevisionTrigger`,
 * the changed-source route) and the sweep. Every note, course and sentence is invented.
 */
import type { ComposedStudySession, RandomSource } from 'olea-core';
import {
  calendarDayFromLocalDate,
  createFsrsScheduler,
  digestPassage,
  enumerateVaultInstruments,
  readInstrumentCitationRecord,
  readReviewLogHistory,
  suspendedInstrumentIds,
  writeInstrumentCitation,
} from 'olea-core';
import { describe, expect, it } from 'vitest';
import { createDraftAcceptPort } from '../../src/generation/accept.js';
import { createVaultDraftCacheStore } from '../../src/generation/cache-store.js';
import { StaleSourceRevisionError } from '../../src/generation/materialize-mcq.js';
import { runGenerationSweep } from '../../src/generation/pipeline.js';
import type { DraftRecord } from '../../src/generation/types.js';
import {
  instrumentCitedPassages,
  readHoldText,
  resolveHoldWithholding,
} from '../../src/ingestion/materiality/hold-record-reader.js';
import {
  draftSourceCheckAtPresentation,
  openReviewSession,
  sourceCheckAtPresentation,
} from '../../src/review/open-session.js';
import {
  createVaultNoteExistsPort,
  createVaultReviewLogPort,
  createVaultSuspendPort,
} from '../../src/review/ports.js';
import { createStudySessionHolder } from '../../src/session/holder.js';
import { currentInputNotes } from '../generation/input-notes-fixture.js';
import {
  harness,
  MemoryVault,
} from '../ingestion/materiality/transcript-fixtures.ol-egov.141.89.5.43.js';

const COURSE = 'COURSEA';
const FOLDER = `01 Courses/${COURSE}`;
const HOME = `${FOLDER}/Week 1 (Olea).md`;
const NOTE_A = `${FOLDER}/Week 2.md`;
const NOTE_B = `${FOLDER}/Week 3.md`;
const NOW = new Date('2026-10-24T10:00:00-07:00');

const A1 = 'Invented layers settle in order of their grain size.';
const B1 = 'Invented ripples form under a steady shallow flow.';
const B2 = 'Invented dunes migrate when the flow strengthens.';

const noteOf = (title: string, ...paragraphs: string[]): string =>
  `---\ncourse: ${COURSE}\n---\n\n# ${title}\n\n${paragraphs.join('\n\n')}\n`;

function mcq(id: string): string[] {
  return [
    '```olea-mcq',
    `id: ${id}`,
    `stem: Which invented statement holds (${id})?`,
    'answer: Alpha',
    'distractor: Beta',
    'distractor: Gamma',
    'distractor: Delta',
    '```',
    '',
  ];
}

/** An Olea home note holding one multiple-choice item per id, bound to the course's concept. */
function homeWith(ids: readonly string[]): string {
  return [
    '---',
    'topic: [Invented layering]',
    `course: ${COURSE}`,
    '---',
    '',
    ...ids.flatMap(mcq),
  ].join('\n');
}

function world(ids: readonly string[] = ['q-one']): MemoryVault {
  const vault = new MemoryVault();
  vault.files.set(HOME, homeWith(ids));
  vault.files.set(NOTE_A, noteOf('Week 2', A1));
  vault.files.set(NOTE_B, noteOf('Week 3', B1, B2));
  return vault;
}

function pendingDraft(id: string, overrides: Partial<DraftRecord> = {}): DraftRecord {
  return {
    draftId: id,
    status: 'pending',
    courseCode: COURSE,
    conceptName: 'Invented layering',
    conceptIds: ['concept-key-layering'],
    sourcePath: HOME,
    sourceCitation: { sourcePath: NOTE_A, page: 1 },
    createdAt: '2026-10-24T09:00:00-07:00',
    question: {
      stem: `Which invented statement about layering holds? (${id})`,
      correctAnswer: 'Alpha',
      distractors: ['Beta', 'Gamma', 'Delta'],
      feedback: 'See the invented notes.',
    },
    provenance: { taskId: 'quiz.generate.v1', promptVersion: '2.5.0', modelId: 'test-model' },
    firstServedAt: null,
    ...overrides,
  };
}

/** The accepted draft record that names `instrumentId`: provenance that Olea drafted it. */
function acceptedDraft(id: string, instrumentId: string, overrides: Partial<DraftRecord> = {}) {
  return pendingDraft(id, {
    status: 'accepted',
    instrumentId,
    resolvedAt: '2026-10-24T09:30:00-07:00',
    ...overrides,
  });
}

/** The session's presentation check for a kept item, composed as `openReviewSession` composes it. */
async function presentKept(
  vault: MemoryVault,
  h: ReturnType<typeof harness>,
  instrumentId: string,
  draftedInstrumentIds: ReadonlySet<string>,
): Promise<string> {
  const { records } = await enumerateVaultInstruments(vault, {
    concepts: { stampConceptKeys: true },
  });
  return sourceCheckAtPresentation(
    h.store,
    async () => suspendedInstrumentIds((await readReviewLogHistory(vault)).entries),
    { vault, recordOf: (id) => records.find((record) => record.instrumentId === id) },
    { vault, draftedInstrumentIds },
  )(instrumentId);
}

/** A kept item drafted from NOTE_A (which its citation names) and NOTE_B, with no passage digest. */
async function keptFromTwoNotes(vault: MemoryVault): Promise<void> {
  await writeInstrumentCitation(
    vault,
    'q-one',
    { sourcePath: NOTE_A, page: 1 },
    await currentInputNotes(vault, NOTE_A, NOTE_B),
  );
}

describe('a change to any input note withholds a kept item before it is shown', () => {
  it('a content change to the note its citation does not name withholds it at the next presentation, and it is sent down the changed-source route', async () => {
    const vault = world();
    await keptFromTwoNotes(vault);
    const h = harness({ transcriptPartGrain: true });
    const drafted = new Set(['q-one']);
    await h.pass(vault);
    expect(await presentKept(vault, h, 'q-one', drafted)).toBe('clear');

    // A session is open: each presentation reads the notes afresh, so the change is seen mid-session.
    vault.files.set(NOTE_B, noteOf('Week 3', B1, 'Invented dunes stall when the flow weakens.'));
    expect(await presentKept(vault, h, 'q-one', drafted)).toBe('check-failed');

    // The citation pass routes it as a change to its cited note is routed: rewritten, then suspended.
    const report = await h.pass(vault);
    expect(report.inputNotesRouted).toBe(1);
    expect(h.actions.enqueue).toHaveBeenCalledTimes(1);
    expect(h.actions.enqueue.mock.calls[0]?.[0].payload).toMatchObject({
      kind: 'instrument-revision',
      predecessorInstrumentId: 'q-one',
    });
    expect(h.actions.suspend.mock.calls.map((call) => call[0])).toEqual(['q-one']);
    expect(await h.withheld(['q-one'])).toEqual(new Set(['q-one']));
    expect(h.judge.judge).not.toHaveBeenCalled();
  });

  it('a formatting-only edit to either note, or a question block added to either, withholds nothing', async () => {
    const vault = world();
    await keptFromTwoNotes(vault);
    const h = harness({ transcriptPartGrain: true });
    const drafted = new Set(['q-one']);
    await h.pass(vault);

    vault.files.set(NOTE_B, noteOf('Week 3', `**${B1}**`, `   ${B2}`));
    vault.files.set(NOTE_A, `${noteOf('Week 2', A1)}\nAn invented front::An invented back\n`);
    expect(await presentKept(vault, h, 'q-one', drafted)).toBe('clear');
    const report = await h.pass(vault);
    expect(report.inputNotesRouted).toBe(0);
    expect(h.actions.enqueue).not.toHaveBeenCalled();
    expect(await h.withheld(['q-one'])).toEqual(new Set());
  });

  it('a note gone withholds it as a change does', async () => {
    const vault = world();
    await keptFromTwoNotes(vault);
    const h = harness({ transcriptPartGrain: true });
    await h.pass(vault);
    vault.files.delete(NOTE_B);
    expect(await presentKept(vault, h, 'q-one', new Set(['q-one']))).toBe('check-failed');
  });
});

describe('a change to any input note withholds a pending draft, and its acceptance is refused', () => {
  async function pendingFromTwoNotes(vault: MemoryVault) {
    const cache = createVaultDraftCacheStore(vault);
    const record = pendingDraft('d-two', {
      inputNotes: await currentInputNotes(vault, NOTE_A, NOTE_B),
    });
    await cache.put(record);
    const port = createDraftAcceptPort({ vault, cache, deviceId: 'device-a', now: () => NOW });
    return { cache, record, port };
  }

  it('one of the two notes changes before it is shown: withheld, and accepting it is refused as a changed note is', async () => {
    const vault = world([]);
    const { cache, record, port } = await pendingFromTwoNotes(vault);
    expect(await draftSourceCheckAtPresentation(vault, [record])(record.draftId)).toBe('clear');

    vault.files.set(NOTE_B, noteOf('Week 3', B1, 'Invented dunes stall when the flow weakens.'));
    expect(await draftSourceCheckAtPresentation(vault, [record])(record.draftId)).toBe(
      'check-failed',
    );
    await expect(port.accept(record.draftId, 'accepted')).rejects.toBeInstanceOf(
      StaleSourceRevisionError,
    );
    // The same bookkeeping a changed destination note's text gets today: nothing written to her
    // notes, the draft resolved as refused, never materialised.
    expect((await cache.get(record.draftId))?.status).toBe('rejected');
    expect(vault.files.get(HOME)).toBe(homeWith([]));
  });

  it('kept while every note holds: its citation record is written at schema version 3 with the same input notes', async () => {
    const vault = world([]);
    const { record, port } = await pendingFromTwoNotes(vault);
    const { instrumentId } = await port.accept(record.draftId, 'accepted');
    const citation = await readInstrumentCitationRecord(vault, instrumentId);
    expect(citation?.schemaVersion).toBe(3);
    expect(citation?.inputNotes).toEqual(record.inputNotes);
  });
});

describe('a hold on any input note holds the item', () => {
  it('a hold on a passage of the note its citation does not name holds it, matched by that note’s path', async () => {
    const vault = world();
    await keptFromTwoNotes(vault);
    const citation = await readInstrumentCitationRecord(vault, 'q-one');
    const hold = JSON.stringify({
      id: 'hold-1',
      factId: 'fact-1',
      reason: 'newer-fact',
      passage: { sourcePath: NOTE_B, passageDigest: await digestPassage(B2) },
    });
    const read = readHoldText(`${hold}\n`);
    const withholding = resolveHoldWithholding(read, [
      { instrumentId: 'q-one', cited: instrumentCitedPassages(citation) },
    ]);
    expect([...withholding.notPresented]).toEqual(['q-one']);
    expect([...withholding.evidenceWithdrawn]).toEqual(['q-one']);

    // Without its input notes the same item would not be held: the hold is on another note.
    const bare = resolveHoldWithholding(read, [
      {
        instrumentId: 'q-one',
        cited: instrumentCitedPassages(
          citation === undefined ? undefined : { sourcePath: citation.sourcePath },
        ),
      },
    ]);
    expect(bare.notPresented.size).toBe(0);
  });
});

describe('a drafted item recorded before input notes were is withheld and drafted again', () => {
  it.each([
    ['with no passage digest', undefined],
    ['even with a passage digest', 'p1:invented-digest'],
  ])(
    'a kept item (%s) is withheld and sent down the changed-source route',
    async (_label, digest) => {
      const vault = world();
      await writeInstrumentCitation(vault, 'q-one', {
        sourcePath: NOTE_A,
        page: 1,
        ...(digest === undefined ? {} : { passageDigest: await digestPassage(A1) }),
      });
      const cache = createVaultDraftCacheStore(vault);
      await cache.put(acceptedDraft('d-old', 'q-one'));
      const h = harness({ transcriptPartGrain: true });

      expect(await presentKept(vault, h, 'q-one', new Set(['q-one']))).toBe('check-failed');
      const report = await h.pass(vault);
      expect(report.inputNotesRouted).toBe(1);
      expect(h.actions.enqueue.mock.calls[0]?.[0].payload).toMatchObject({
        predecessorInstrumentId: 'q-one',
      });
      expect(h.actions.suspend.mock.calls.map((call) => call[0])).toEqual(['q-one']);
    },
  );

  it.each([
    ['with no passage digest', false],
    ['even with a passage digest', true],
  ])(
    'a pending draft (%s) is withheld, and the next sweep drafts it again beside it',
    async (_label, withDigest) => {
      const vault = world([]);
      const cache = createVaultDraftCacheStore(vault);
      const legacy = pendingDraft(
        'legacy',
        withDigest
          ? {
              sourceCitation: {
                sourcePath: NOTE_A,
                page: 1,
                passageDigest: await digestPassage(A1),
              },
            }
          : {},
      );
      // Recorded at the sweep's own id, as a sweep before this change recorded it.
      const { deriveDraftId } = await import('../../src/generation/cache-store.js');
      const legacyId = await deriveDraftId(COURSE, 'Invented layering', 0);
      await cache.put({ ...legacy, draftId: legacyId });
      expect(
        await draftSourceCheckAtPresentation(vault, [{ ...legacy, draftId: legacyId }])(legacyId),
      ).toBe('check-failed');

      const inputNotes = await currentInputNotes(vault, NOTE_A);
      const sweep = () =>
        runGenerationSweep(
          [
            {
              text: 'unused',
              provenance: {
                sourcePath: NOTE_A,
                location: { page: 1, charRange: { start: 0, end: 1 } },
              },
            },
          ],
          {
            vault,
            cache,
            draftDeps: {} as never,
            listConceptsForCourse: async () => [
              {
                key: 'concept-key-layering',
                name: 'Invented layering',
                tier: 2,
                courses: [COURSE],
                sourcePaths: [NOTE_A],
              },
            ],
            draftForConcept: async (_deps, request) => ({
              status: 'drafted',
              inputNotes,
              request: { courseCode: COURSE, conceptName: request.conceptName, sourceChunks: [A1] },
              response: {
                ok: true,
                stamp: { contractVersion: 1, promptVersion: '2.5.0', modelId: 'test-model' },
                result: {
                  questions: [
                    {
                      stem: 'Which invented statement holds (redrafted)?',
                      correctAnswer: 'Alpha',
                      distractors: ['Beta', 'Gamma', 'Delta'],
                      feedback: 'See the invented notes.',
                    },
                  ],
                },
              },
            }),
            now: () => NOW,
          },
        );
      const first = await sweep();
      expect(first).toMatchObject({ attempted: 1, drafted: 1, skippedDuplicate: 0 });
      const pending = await cache.listPending();
      const redrafted = pending.find((record) => record.draftId !== legacyId);
      expect(redrafted?.inputNotes).toEqual(inputNotes);
      // The record from before is left exactly as it was (never overwritten), and still withheld.
      expect(await cache.get(legacyId)).toEqual({ ...legacy, draftId: legacyId });
      // Drafted once: the next sweep finds the redraft and asks nothing.
      const second = await sweep();
      expect(second).toMatchObject({ attempted: 0, skippedDuplicate: 1 });
    },
  );

  it('items Olea did not draft through a draft record are unaffected: her own question block, a practice paper’s item', async () => {
    const vault = world(['q-paper']);
    // A practice paper's item: a version 3 citation with no input notes, and no draft record.
    await writeInstrumentCitation(vault, 'q-paper', { sourcePath: HOME });
    vault.files.set(
      NOTE_A,
      `---\ntopic: [Invented layering]\ncourse: ${COURSE}\n---\n\n# Week 2\n\n${A1}\n\nHer own front::Her own back ^own1\n`,
    );
    const h = harness({ transcriptPartGrain: true });
    const report = await h.pass(vault);
    expect(report.inputNotesRouted).toBe(0);
    expect(await presentKept(vault, h, 'q-paper', new Set())).toBe('clear');
    const { records } = await enumerateVaultInstruments(vault);
    const hers = records.find((record) => record.notePath === NOTE_A);
    if (hers === undefined) throw new Error('her card was not enumerated');
    expect(await presentKept(vault, h, hers.instrumentId, new Set())).toBe('clear');
  });
});

describe('openReviewSession withholds by the draft cache’s provenance (the production composition)', () => {
  const fixedRandom: RandomSource = { next: () => 0.42 };
  const DEVICE = 'olea-testdevice1';

  async function composedFor(vault: MemoryVault): Promise<ComposedStudySession> {
    const { records } = await enumerateVaultInstruments(vault);
    const items = records.map((record, index) => ({
      position: index + 1,
      instrumentId: record.instrumentId,
      instrumentType: record.instrumentType,
      notePath: record.notePath,
      noteTitle: record.noteTitle,
      conceptName: 'Invented layering',
      course: COURSE,
      gapClass: 'coverage-gap',
      gapRank: index + 1,
      gapScore: 1,
      estimatedSeconds: 60,
      durationSource: 'assumed',
      formatMatch: 'no-preference',
    }));
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
    } as never;
  }

  async function open(vault: MemoryVault, cache: ReturnType<typeof createVaultDraftCacheStore>) {
    const holder = createStudySessionHolder();
    holder.enter(NOW, await composedFor(vault));
    const outcome = await openReviewSession({
      vault,
      scheduler: createFsrsScheduler(),
      deviceId: DEVICE,
      ports: {
        reviewLog: createVaultReviewLogPort(vault, DEVICE),
        suspendPort: createVaultSuspendPort(vault, DEVICE),
        editPort: { async edit() {} },
        noteExists: createVaultNoteExistsPort(vault),
        clock: { now: () => NOW },
        draftAcceptPort: {
          accept: () => Promise.reject(new Error('unused')),
          reject: () => Promise.reject(new Error('unused')),
        },
      },
      random: fixedRandom,
      probeDays: 30,
      studySessionHolder: holder,
      composeDefaultStudySession: () => Promise.reject(new Error('unreachable')),
      draftCache: cache,
    } as never);
    if (!outcome.ok) throw new Error(`the session failed to open: ${String(outcome.error)}`);
    return outcome;
  }

  it('a kept item Olea drafted before input notes were is set aside; a practice paper’s item is shown', async () => {
    const vault = world(['q-legacy', 'q-paper']);
    await writeInstrumentCitation(vault, 'q-legacy', { sourcePath: NOTE_A, page: 1 });
    await writeInstrumentCitation(vault, 'q-paper', { sourcePath: HOME });
    const cache = createVaultDraftCacheStore(vault);
    await cache.put(acceptedDraft('d-legacy', 'q-legacy'));

    const outcome = await open(vault, cache);
    await outcome.session.start();
    expect(outcome.session.takeWithheldNotice()).not.toBeNull();
    const shown = JSON.stringify(outcome.session.getViewModel());
    expect(shown).toContain('q-paper');
    expect(shown).not.toContain('q-legacy');
  });

  it('the same kept item with no draft record behind it is shown first (the control: provenance, not the absent list, decides)', async () => {
    const vault = world(['q-legacy', 'q-paper']);
    await writeInstrumentCitation(vault, 'q-legacy', { sourcePath: NOTE_A, page: 1 });
    await writeInstrumentCitation(vault, 'q-paper', { sourcePath: HOME });
    const outcome = await open(vault, createVaultDraftCacheStore(vault));
    await outcome.session.start();
    expect(outcome.session.takeWithheldNotice()).toBeNull();
    expect(JSON.stringify(outcome.session.getViewModel())).toContain('q-legacy');
  });

  it('a pending draft one of whose notes changed is set aside; its sibling drawn from unchanged notes is shown', async () => {
    const vault = world([]);
    const cache = createVaultDraftCacheStore(vault);
    await cache.put(
      pendingDraft('draft-1', { inputNotes: await currentInputNotes(vault, NOTE_A, NOTE_B) }),
    );
    await cache.put(
      pendingDraft('draft-2', {
        createdAt: '2026-10-24T09:05:00-07:00',
        inputNotes: await currentInputNotes(vault, NOTE_A),
      }),
    );
    vault.files.set(NOTE_B, noteOf('Week 3', B1, 'Invented dunes stall when the flow weakens.'));

    const outcome = await open(vault, cache);
    await outcome.session.start();
    expect(outcome.session.takeWithheldNotice()).not.toBeNull();
    const shown = JSON.stringify(outcome.session.getViewModel());
    expect(shown).toContain('draft-2');
    expect(shown).not.toContain('draft-1');
  });
});
