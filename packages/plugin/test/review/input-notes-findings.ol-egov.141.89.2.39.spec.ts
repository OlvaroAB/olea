/**
 * `ol-egov.141.89.2.39` ([D-626], [D-628]): the independent review's findings on the input-note
 * rework, each held by a test that failed before its fix. Functional scope C5.3 ("A drafted item
 * records every note its drafting request was drawn from, and each of them protects it", the hold
 * sentence after it, and the free exits of `[D-446]`/`[D-543]`/`[D-508]`) and the scenarios of
 * "Feature: F3.3 / C5.3 — a drafted item records every note it was drawn from, and each protects
 * it" (service repo, `features/F3-learn-from-anything.md`).
 *
 *  - A: the input-note check runs whatever the citation's kind (a transcript citation included).
 *  - B: the single-passage note is judged by its passage anchor and its free exits only.
 *  - C: every drafted item withheld for its input notes is reachable by the rewrite route.
 *  - D: frontmatter Olea writes itself is not a change to her material.
 *  - E: "Olea drafted it" survives a purge of the draft cache.
 *  - F: a rename Olea saw is followed by the pass and by an open session.
 *  - G: a pending draft whose input note changed no longer blocks its concept.
 *  - H: a new draft never overwrites a record by an id collision.
 *  - I: a successor records the note its passage came from, from that same read.
 * (J, the internal citation of a several-note draft, is in `pipeline.input-notes.spec.ts`.)
 *
 * Through the production pieces: the session's presentation checks and `openReviewSession`, the
 * citation pass (`CitationRevisionTrigger`), the sweep, the heading offer, the generation and
 * revision job runners, and the accept port. Every note, course and sentence is invented.
 */
import type { ComposedStudySession, RandomSource } from 'olea-core';
import {
  appendVerdictRecord,
  calendarDayFromLocalDate,
  createFsrsScheduler,
  digestPassage,
  enumerateVaultInstruments,
  readInstrumentCitationRecord,
  readReviewLogHistory,
  stampClozeId,
  stampUid,
  suspendedInstrumentIds,
  writeInstrumentCitation,
} from 'olea-core';
import { describe, expect, it } from 'vitest';
import { createDraftAcceptPort } from '../../src/generation/accept.js';
import { createVaultDraftCacheStore, purgeDraftCache } from '../../src/generation/cache-store.js';
import { runGenerationDraftJob } from '../../src/generation/generation-job-runner.js';
import {
  ensureHomeNoteForConcept,
  recordDraftedForConcept,
} from '../../src/generation/home-note.js';
import {
  type InputNote,
  inputNoteFingerprint,
  markdownFingerprint,
} from '../../src/generation/input-notes.js';
import { runGenerationSweep } from '../../src/generation/pipeline.js';
import { runInstrumentRevisionJob } from '../../src/generation/revision-job-runner.js';
import type { DraftProvenance, DraftRecord } from '../../src/generation/types.js';
import { ObsidianCitationHashStore } from '../../src/ingestion/materiality/citation-hash-store.js';
import { stripQuestionBlocks } from '../../src/ingestion/materiality/citation-material.js';
import { CitationRevisionTrigger } from '../../src/ingestion/materiality/citation-revision-wiring.js';
import type {
  DraftQuizCardsDeps,
  DraftQuizCardsResult,
} from '../../src/retrieval/draft-quiz-cards.js';
import { createHeadingOfferPort } from '../../src/review/heading-offer.js';
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
  bytesHashOf,
  FakeDataHost,
  harness,
  LECTURE,
  MemoryVault,
  transcriptOf,
} from '../ingestion/materiality/transcript-fixtures.ol-egov.141.89.5.43.js';

const COURSE = 'COURSEA';
const FOLDER = `01 Courses/${COURSE}`;
const HOME = `${FOLDER}/Week 1 (Olea).md`;
const NOTE_A = `${FOLDER}/Week 2.md`;
const NOTE_B = `${FOLDER}/Week 3.md`;
const NOTE_B2 = `${FOLDER}/Week 3 renamed.md`;
const NOTE_C = `${FOLDER}/Week 4.md`;
const HER_NOTE = `${FOLDER}/Week 5.md`;
const TRANSCRIPT = `${FOLDER}/Lecture 1.txt`;
const CONCEPT = 'Invented layering';
const CONCEPT_KEY = 'concept-key-layering';
const NOW = new Date('2026-10-24T10:00:00-07:00');

const A1 = 'Invented layers settle in order of their grain size.';
const A2 = 'Invented currents slow down where the channel widens.';
const B1 = 'Invented ripples form under a steady shallow flow.';
const B2 = 'Invented dunes migrate when the flow strengthens.';
const B2_CHANGED = 'Invented dunes stall when the flow weakens.';
const C1 = 'Invented mud drapes mark the pauses between floods.';

const PROVENANCE: DraftProvenance = {
  taskId: 'quiz.generate.v1',
  promptVersion: '2.5.0',
  modelId: 'test-model',
};

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

/** A note holding one multiple-choice item per id, bound to the course's concept. */
function homeWith(ids: readonly string[]): string {
  return ['---', `topic: [${CONCEPT}]`, `course: ${COURSE}`, '---', '', ...ids.flatMap(mcq)].join(
    '\n',
  );
}

function world(ids: readonly string[] = ['q-one']): MemoryVault {
  const vault = new MemoryVault();
  vault.files.set(HOME, homeWith(ids));
  vault.files.set(NOTE_A, noteOf('Week 2', A1, A2));
  vault.files.set(NOTE_B, noteOf('Week 3', B1, B2));
  vault.files.set(NOTE_C, noteOf('Week 4', C1));
  return vault;
}

function pendingDraft(id: string, overrides: Partial<DraftRecord> = {}): DraftRecord {
  return {
    draftId: id,
    status: 'pending',
    courseCode: COURSE,
    conceptName: CONCEPT,
    conceptIds: [CONCEPT_KEY],
    sourcePath: HOME,
    sourceCitation: { sourcePath: NOTE_A, page: 1 },
    createdAt: '2026-10-24T09:00:00-07:00',
    question: {
      stem: `Which invented statement about layering holds? (${id})`,
      correctAnswer: 'Alpha',
      distractors: ['Beta', 'Gamma', 'Delta'],
      feedback: 'See the invented notes.',
    },
    provenance: PROVENANCE,
    firstServedAt: null,
    ...overrides,
  };
}

/** The verdict her review log holds when she keeps a draft (`accept.ts`): Olea's provenance. */
async function keptVerdict(vault: MemoryVault, instrumentId: string): Promise<void> {
  await appendVerdictRecord(
    vault,
    {
      timestamp: '2026-10-24T09:30:00-07:00',
      instrumentId,
      instrumentType: 'mcq',
      conceptIds: [CONCEPT_KEY],
      verdict: 'accepted',
      artifactProvenance: PROVENANCE,
    },
    { deviceId: 'device-a', generateEventId: () => `verdict-${instrumentId}` },
  );
}

/** The session's presentation check for a kept item, composed as `openReviewSession` composes it. */
async function presentKept(
  vault: MemoryVault,
  store: ObsidianCitationHashStore,
  instrumentId: string,
  draftedInstrumentIds: ReadonlySet<string>,
): Promise<string> {
  const { records } = await enumerateVaultInstruments(vault, {
    concepts: { stampConceptKeys: true },
  });
  return sourceCheckAtPresentation(
    store,
    async () => suspendedInstrumentIds((await readReviewLogHistory(vault)).entries),
    { vault, recordOf: (id) => records.find((record) => record.instrumentId === id) },
    { vault, draftedInstrumentIds },
  )(instrumentId);
}

const DRAFTED = new Set(['q-one']);

const goodResponse = {
  ok: true,
  stamp: { contractVersion: 1, promptVersion: '2.5.0', modelId: 'test-model' },
  result: {
    questions: [
      {
        stem: 'Which invented statement holds (drafted)?',
        correctAnswer: 'Alpha',
        distractors: ['Beta', 'Gamma', 'Delta'],
        feedback: 'See the invented notes.',
      },
    ],
  },
};

// ---------------------------------------------------------------------------------------------
// A
// ---------------------------------------------------------------------------------------------

describe('A: the input-note check runs whatever the citation’s kind', () => {
  async function transcriptCited(vault: MemoryVault): Promise<void> {
    vault.files.set(TRANSCRIPT, transcriptOf(LECTURE));
    await writeInstrumentCitation(
      vault,
      'q-one',
      { sourcePath: TRANSCRIPT, page: 1, sourceRevision: await bytesHashOf(transcriptOf(LECTURE)) },
      await currentInputNotes(vault, TRANSCRIPT, NOTE_B),
    );
  }

  it('a kept item cited from a lecture transcript and drawn from another note too is withheld when that other note changes', async () => {
    const vault = world();
    await transcriptCited(vault);
    const h = harness({ transcriptPartGrain: true });
    await h.pass(vault);
    expect((await h.store.loadAll()).get('q-one')?.sourcePath).toBe(TRANSCRIPT);
    expect(await presentKept(vault, h.store, 'q-one', DRAFTED)).toBe('clear');

    vault.files.set(NOTE_B, noteOf('Week 3', B1, B2_CHANGED));
    expect(await presentKept(vault, h.store, 'q-one', DRAFTED)).toBe('check-failed');
    const report = await h.pass(vault);
    expect(report.inputNotesRouted).toBe(1);
  });

  it('the transcript itself is its anchor’s to judge: bytes that read as the same spoken text withhold nothing', async () => {
    const vault = world();
    await transcriptCited(vault);
    const h = harness({ transcriptPartGrain: true });
    await h.pass(vault);
    vault.files.set(TRANSCRIPT, `${transcriptOf(LECTURE)}\n`);
    expect(await presentKept(vault, h.store, 'q-one', DRAFTED)).toBe('clear');
    const report = await h.pass(vault);
    expect(report.inputNotesRouted).toBe(0);
    expect(await presentKept(vault, h.store, 'q-one', DRAFTED)).toBe('clear');
  });
});

// ---------------------------------------------------------------------------------------------
// B
// ---------------------------------------------------------------------------------------------

describe('B: the single-passage note is judged by its passage anchor and its free exits only', () => {
  async function singlePassage(vault: MemoryVault): Promise<void> {
    await writeInstrumentCitation(
      vault,
      'q-one',
      { sourcePath: NOTE_A, page: 1, passageDigest: await digestPassage(A1) },
      await currentInputNotes(vault, NOTE_A),
    );
  }

  it('a formatting-only edit of the passage withholds nothing, at presentation or in the pass', async () => {
    const vault = world();
    await singlePassage(vault);
    const h = harness({ transcriptPartGrain: true });
    await h.pass(vault);
    expect((await h.store.loadAll()).get('q-one')?.passageDigest).toBe(await digestPassage(A1));

    vault.files.set(NOTE_A, noteOf('Week 2', `**${A1}**`, A2));
    expect(await presentKept(vault, h.store, 'q-one', DRAFTED)).toBe('clear');
    const report = await h.pass(vault);
    expect(report.inputNotesRouted).toBe(0);
    expect(h.judge.judge).not.toHaveBeenCalled();
    expect(await presentKept(vault, h.store, 'q-one', DRAFTED)).toBe('clear');
  });

  it('a move of the passage to another note withholds nothing, before and after the pass heals the anchor', async () => {
    const vault = world();
    await singlePassage(vault);
    const h = harness({ transcriptPartGrain: true });
    await h.pass(vault);

    vault.files.set(NOTE_A, noteOf('Week 2', A2));
    vault.files.set(NOTE_C, noteOf('Week 4', C1, A1));
    expect(await presentKept(vault, h.store, 'q-one', DRAFTED)).toBe('clear');
    const report = await h.pass(vault);
    expect(report.inputNotesRouted).toBe(0);
    expect(report.relocated).toBe(1);
    expect(await presentKept(vault, h.store, 'q-one', DRAFTED)).toBe('clear');
  });

  it('a change to the passage itself still withholds it', async () => {
    const vault = world();
    await singlePassage(vault);
    const h = harness({ transcriptPartGrain: true });
    await h.pass(vault);
    vault.files.set(NOTE_A, noteOf('Week 2', 'Invented layers settle in no order at all.', A2));
    expect(await presentKept(vault, h.store, 'q-one', DRAFTED)).toBe('check-failed');
  });

  it('a change elsewhere in the note before the pass first anchors it routes nothing: the passage is seeded', async () => {
    const vault = world();
    await singlePassage(vault);
    vault.files.set(NOTE_A, noteOf('Week 2', A1, 'An invented second paragraph, rewritten.'));
    const h = harness({ transcriptPartGrain: true });
    const report = await h.pass(vault);
    expect(report.inputNotesRouted).toBe(0);
    expect(report.newlyBaselined).toBe(1);
    expect(await presentKept(vault, h.store, 'q-one', DRAFTED)).toBe('clear');
  });

  it('a pending single-passage draft survives a formatting-only edit of its passage; a change to it does not', async () => {
    const vault = world([]);
    const record = pendingDraft('d-one', {
      sourceCitation: { sourcePath: NOTE_A, page: 1, passageDigest: await digestPassage(A1) },
      inputNotes: await currentInputNotes(vault, NOTE_A),
    });
    vault.files.set(NOTE_A, noteOf('Week 2', `**${A1}**`, A2));
    expect(await draftSourceCheckAtPresentation(vault, [record])(record.draftId)).toBe('clear');
    vault.files.set(NOTE_A, noteOf('Week 2', 'Invented layers settle in no order at all.', A2));
    expect(await draftSourceCheckAtPresentation(vault, [record])(record.draftId)).toBe(
      'check-failed',
    );
  });
});

// ---------------------------------------------------------------------------------------------
// C
// ---------------------------------------------------------------------------------------------

describe('C: every drafted item withheld for its input notes reaches the rewrite route', () => {
  const herNote = (): string =>
    ['---', `topic: [${CONCEPT}]`, `course: ${COURSE}`, '---', '', '# Week 5', '', C1, ''].join(
      '\n',
    );

  it('a heading offer drawn from several notes cites one of them with a page, and once kept a change to another is routed', async () => {
    const vault = world([]);
    vault.files.set(HER_NOTE, herNote());
    const cache = createVaultDraftCacheStore(vault);
    const inputNotes = await currentInputNotes(vault, NOTE_B, NOTE_A);
    const port = createHeadingOfferPort({
      draftDeps: () => ({ vault }) as unknown as DraftQuizCardsDeps,
      cache,
      now: () => NOW,
      draftForConcept: async () => ({
        status: 'drafted',
        request: { courseCode: COURSE, conceptName: CONCEPT, sourceChunks: [B1, A1, B2] },
        chunkPaths: [NOTE_B, NOTE_A, NOTE_B],
        inputNotes,
        response: goodResponse,
      }),
    });
    const outcome = await port.accept(
      {
        headingText: 'Why do invented layers settle in order?',
        level: 2,
        blockIndex: 1,
        headingStart: 0,
        headingEnd: 10,
        coverageEnd: 20,
        rule: 'wh-inversion',
      },
      {
        courseCode: COURSE,
        concept: { key: CONCEPT_KEY, name: CONCEPT, tier: 2, courses: [COURSE], sourcePaths: [] },
        sourcePath: HER_NOTE,
      },
    );
    if (outcome.kind !== 'drafted') throw new Error(`the offer did not draft: ${outcome.kind}`);
    const record = await cache.get(outcome.draftIds[0] ?? '');
    // The note that supplied the most chunks, never her note (it supplied none).
    expect(record?.sourceCitation).toEqual({ sourcePath: NOTE_B, page: 1 });

    const { instrumentId } = await createDraftAcceptPort({
      vault,
      cache,
      deviceId: 'device-a',
      now: () => NOW,
    }).accept(record?.draftId ?? '', 'accepted');
    const { records } = await enumerateVaultInstruments(vault);
    expect(records.find((r) => r.instrumentId === instrumentId)?.sourceProvenance).toBeDefined();

    vault.files.set(NOTE_A, noteOf('Week 2', 'Invented layers settle in no order at all.', A2));
    const h = harness({ transcriptPartGrain: true });
    const report = await h.pass(vault);
    expect(report.inputNotesRouted).toBe(1);
    expect(h.actions.enqueue.mock.calls[0]?.[0].payload).toMatchObject({
      predecessorInstrumentId: instrumentId,
    });
  });

  it('a generation job drawn from several notes cites the concept’s note when it supplied a chunk', async () => {
    const vault = world([]);
    const cache = createVaultDraftCacheStore(vault);
    const inputNotes = await currentInputNotes(vault, NOTE_B, NOTE_A);
    const outcome = await runGenerationDraftJob(
      {
        vault,
        cache,
        draftDeps: () => ({}) as never,
        listConceptsForCourse: async () => [
          { key: CONCEPT_KEY, name: CONCEPT, tier: 2, courses: [COURSE], sourcePaths: [NOTE_A] },
        ],
        draftForConcept: async () => ({
          status: 'drafted',
          request: { courseCode: COURSE, conceptName: CONCEPT, sourceChunks: [B1, A1, B2] },
          chunkPaths: [NOTE_B, NOTE_A, NOTE_B],
          inputNotes,
          response: goodResponse,
        }),
        generateDraftId: () => 'job-draft-1',
        now: () => NOW,
      },
      {
        kind: 'generation',
        courseCode: COURSE,
        conceptKey: CONCEPT_KEY,
        conceptName: CONCEPT,
        instrumentKind: 'mcq',
        trigger: 'arrival',
      },
    );
    expect(outcome).toEqual({ ok: true });
    expect((await cache.get('job-draft-1'))?.sourceCitation).toEqual({
      sourcePath: NOTE_A,
      page: 1,
    });
  });

  it('a kept item drafted before every path cited a note (no page) is routed when a note it was drawn from changes', async () => {
    const vault = world();
    await writeInstrumentCitation(
      vault,
      'q-one',
      { sourcePath: HOME },
      await currentInputNotes(vault, NOTE_A, NOTE_B),
    );
    await keptVerdict(vault, 'q-one');
    const h = harness({ transcriptPartGrain: true });
    expect((await h.pass(vault)).inputNotesRouted).toBe(0);

    vault.files.set(NOTE_B, noteOf('Week 3', B1, B2_CHANGED));
    expect(await presentKept(vault, h.store, 'q-one', DRAFTED)).toBe('check-failed');
    const report = await h.pass(vault);
    expect(report.inputNotesRouted).toBe(1);
    expect(h.actions.enqueue.mock.calls[0]?.[0].payload).toMatchObject({
      predecessorInstrumentId: 'q-one',
    });
    expect(h.actions.suspend.mock.calls.map((call) => call[0])).toEqual(['q-one']);
  });

  it('a kept item drafted with no input notes and no page is routed by the unrecorded rule', async () => {
    const vault = world();
    await writeInstrumentCitation(vault, 'q-one', { sourcePath: HOME });
    await keptVerdict(vault, 'q-one');
    const h = harness({ transcriptPartGrain: true });
    expect(await presentKept(vault, h.store, 'q-one', DRAFTED)).toBe('check-failed');
    const report = await h.pass(vault);
    expect(report.inputNotesRouted).toBe(1);
    expect(h.actions.suspend.mock.calls.map((call) => call[0])).toEqual(['q-one']);
  });
});

// ---------------------------------------------------------------------------------------------
// D
// ---------------------------------------------------------------------------------------------

describe('D: frontmatter Olea writes itself is not a change to her material', () => {
  const stampCloze = (content: string): string =>
    stampClozeId(
      content,
      { noteUid: null, notePath: NOTE_B, heading: 'Week 3', ordinal: 1 },
      () => 'cloze-invented-1',
    ).content;

  it('a first-sight cloze stamp or uid stamp in her note leaves the fingerprint; her own frontmatter changes it', async () => {
    const vault = world();
    const before = await inputNoteFingerprint(vault, NOTE_B);
    const clozeStamped = stampCloze(noteOf('Week 3', B1, B2));
    expect(clozeStamped).toContain('olea-cloze-ids');
    vault.files.set(NOTE_B, clozeStamped);
    expect(await inputNoteFingerprint(vault, NOTE_B)).toBe(before);
    const uidStamped = stampUid(clozeStamped, { generateId: () => 'uid-invented-1' }).content;
    expect(uidStamped).toContain('olea-uid');
    vault.files.set(NOTE_B, uidStamped);
    expect(await inputNoteFingerprint(vault, NOTE_B)).toBe(before);

    vault.files.set(
      NOTE_B,
      uidStamped.replace(`course: ${COURSE}`, `course: ${COURSE}\naliases: [Ripples]`),
    );
    expect(await inputNoteFingerprint(vault, NOTE_B)).not.toBe(before);
  });

  it('a home note’s topic growth and drafted-for record leave its fingerprint', async () => {
    const vault = world();
    const source = `${FOLDER}/Slides 6.pdf`;
    vault.binaries.set(source, new Uint8Array([1, 2, 3]));
    const home = await ensureHomeNoteForConcept(vault, source, 'Invented layering');
    if (home === null) throw new Error('no home note');
    vault.files.set(
      home,
      `${vault.files.get(home) ?? ''}\nHer own invented line about layering.\n`,
    );
    const before = await inputNoteFingerprint(vault, home);
    await ensureHomeNoteForConcept(vault, source, 'Invented ripples');
    expect(vault.files.get(home)).toContain('Invented ripples');
    expect(await inputNoteFingerprint(vault, home)).toBe(before);
    vault.files.set(home, recordDraftedForConcept(vault.files.get(home) ?? '', 'item-1', 'key-x'));
    expect(vault.files.get(home)).toContain('olea-drafted-for');
    expect(await inputNoteFingerprint(vault, home)).toBe(before);
    // Her own line is still hers.
    vault.files.set(home, (vault.files.get(home) ?? '').replace('Her own invented', 'Her edited'));
    expect(await inputNoteFingerprint(vault, home)).not.toBe(before);
  });

  it('a kept item drawn from a note Olea stamps is neither withheld nor routed', async () => {
    const vault = world();
    await writeInstrumentCitation(
      vault,
      'q-one',
      { sourcePath: NOTE_A, page: 1 },
      await currentInputNotes(vault, NOTE_A, NOTE_B),
    );
    const h = harness({ transcriptPartGrain: true });
    await h.pass(vault);
    vault.files.set(NOTE_B, stampCloze(noteOf('Week 3', B1, B2)));
    expect(await presentKept(vault, h.store, 'q-one', DRAFTED)).toBe('clear');
    expect((await h.pass(vault)).inputNotesRouted).toBe(0);
  });

  it('the whole-note check of a cited note: Olea’s stamp is not a change on either side, her own key is', async () => {
    const vault = world();
    // Not a drafted item: only the cited note's whole-note check applies.
    await writeInstrumentCitation(vault, 'q-one', { sourcePath: NOTE_B, page: 1 });
    const h = harness({ transcriptPartGrain: true });
    await h.pass(vault);
    vault.files.set(NOTE_B, stampCloze(noteOf('Week 3', B1, B2)));
    expect(await presentKept(vault, h.store, 'q-one', new Set())).toBe('clear');
    const report = await h.pass(vault);
    expect(h.judge.judge).not.toHaveBeenCalled();
    expect(report.formattingOnly).toBe(1);
    expect((await h.store.loadAll()).get('q-one')?.settledBy).toMatchObject({
      kind: 'code',
      rule: 'olea-frontmatter-writes',
    });
    expect(await presentKept(vault, h.store, 'q-one', new Set())).toBe('clear');

    vault.files.set(
      NOTE_B,
      stampCloze(noteOf('Week 3', B1, B2)).replace(
        `course: ${COURSE}`,
        `course: ${COURSE}\naliases: [Ripples]`,
      ),
    );
    expect(await presentKept(vault, h.store, 'q-one', new Set())).toBe('check-failed');
  });
});

// ---------------------------------------------------------------------------------------------
// E
// ---------------------------------------------------------------------------------------------

describe('E: "Olea drafted it" survives a purge of the draft cache', () => {
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
      conceptName: CONCEPT,
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

  async function legacyKeptThenPurged(vault: MemoryVault) {
    await writeInstrumentCitation(vault, 'q-legacy', { sourcePath: NOTE_A, page: 1 });
    await writeInstrumentCitation(vault, 'q-paper', { sourcePath: HOME });
    const cache = createVaultDraftCacheStore(vault);
    await cache.put(
      pendingDraft('d-legacy', {
        status: 'accepted',
        instrumentId: 'q-legacy',
        resolvedAt: '2026-10-24T09:30:00-07:00',
      }),
    );
    await keptVerdict(vault, 'q-legacy');
    await purgeDraftCache(vault, async (path) => {
      vault.files.delete(path);
    });
    expect(await cache.list()).toEqual([]);
    return cache;
  }

  it('a kept item drafted before input notes were is set aside by the session after the purge', async () => {
    const vault = world(['q-legacy', 'q-paper']);
    const cache = await legacyKeptThenPurged(vault);
    const outcome = await open(vault, cache);
    await outcome.session.start();
    expect(outcome.session.takeWithheldNotice()).not.toBeNull();
    const shown = JSON.stringify(outcome.session.getViewModel());
    expect(shown).toContain('q-paper');
    expect(shown).not.toContain('q-legacy');
  });

  it('and the citation pass still routes it to the rewrite after the purge', async () => {
    const vault = world(['q-legacy', 'q-paper']);
    await legacyKeptThenPurged(vault);
    const h = harness({ transcriptPartGrain: true });
    const report = await h.pass(vault);
    expect(report.inputNotesRouted).toBe(1);
    expect(h.actions.suspend.mock.calls.map((call) => call[0])).toEqual(['q-legacy']);
  });

  it('a restore of her own rejected block is not Olea’s provenance: it is neither withheld nor routed', async () => {
    const vault = world(['q-own']);
    await writeInstrumentCitation(vault, 'q-own', { sourcePath: NOTE_A, page: 1 });
    const rejected = await appendVerdictRecord(
      vault,
      {
        timestamp: '2026-10-24T09:00:00-07:00',
        instrumentId: 'q-own',
        instrumentType: 'mcq',
        conceptIds: [CONCEPT_KEY],
        verdict: 'rejected',
      },
      { deviceId: 'device-a', generateEventId: () => 'verdict-rejected' },
    );
    await appendVerdictRecord(
      vault,
      {
        timestamp: '2026-10-24T09:10:00-07:00',
        instrumentId: 'q-own',
        instrumentType: 'mcq',
        conceptIds: [CONCEPT_KEY],
        verdict: 'accepted',
        restores: rejected.record.eventId,
      },
      { deviceId: 'device-a', generateEventId: () => 'verdict-restored' },
    );
    const h = harness({ transcriptPartGrain: true });
    expect((await h.pass(vault)).inputNotesRouted).toBe(0);
    const outcome = await open(vault, createVaultDraftCacheStore(vault));
    await outcome.session.start();
    expect(JSON.stringify(outcome.session.getViewModel())).toContain('q-own');
  });
});

// ---------------------------------------------------------------------------------------------
// F
// ---------------------------------------------------------------------------------------------

describe('F: a rename Olea saw is followed by the pass and by an open session', () => {
  it('a pending draft an open session holds is read at its note’s new path once the rename is followed', async () => {
    const vault = world([]);
    const cache = createVaultDraftCacheStore(vault);
    const record = pendingDraft('d-two', {
      inputNotes: await currentInputNotes(vault, NOTE_A, NOTE_B),
    });
    await cache.put(record);
    // The session's own copy of its drafts is taken at open, as `openReviewSession` takes it.
    const check = draftSourceCheckAtPresentation(vault, [record], undefined, { cache });
    expect(await check(record.draftId)).toBe('clear');

    vault.move(NOTE_B, NOTE_B2);
    const h = harness({ transcriptPartGrain: true });
    expect(await h.trigger.onSourceRenamed(vault, NOTE_B, NOTE_B2)).toBeGreaterThan(0);
    expect(await check(record.draftId)).toBe('clear');
  });

  it('a pass running when a rename arrives reads the note at its new path, and the moves follow it', async () => {
    const vault = world();
    await writeInstrumentCitation(
      vault,
      'q-one',
      { sourcePath: NOTE_A, page: 1 },
      await currentInputNotes(vault, NOTE_A, NOTE_B),
    );
    const real = new ObsidianCitationHashStore(new FakeDataHost());
    let gate: Promise<void> = Promise.resolve();
    let release = (): void => {};
    const store = new Proxy(real, {
      get(target, property, receiver) {
        if (property === 'loadAll') {
          return async () => {
            await gate;
            return target.loadAll();
          };
        }
        const value = Reflect.get(target, property, receiver);
        return typeof value === 'function' ? value.bind(target) : value;
      },
    });
    const trigger = new CitationRevisionTrigger({
      store,
      judge: { judge: async () => ({ material: true, reason: 'scripted' }) },
      clock: { now: () => 1_000 },
      transcriptPartGrain: true,
    });
    const enqueued: unknown[] = [];
    const actions = {
      enqueue: async (input: unknown) => {
        enqueued.push(input);
        return undefined;
      },
      suspend: async () => {},
      onRelocationProposed: () => {},
    } as never;
    await trigger.tick(vault, actions);
    expect((await real.loadAll()).has('q-one')).toBe(true);

    gate = new Promise((resolve) => {
      release = resolve;
    });
    const pass = trigger.tick(vault, actions);
    // The vault already holds the note at its new path when the rename event arrives.
    vault.move(NOTE_B, NOTE_B2);
    const renaming = trigger.onSourceRenamed(vault, NOTE_B, NOTE_B2);
    expect(trigger.renamedPathOf(NOTE_B)).toBe(NOTE_B2);
    release();
    const report = await pass;
    expect(report.inputNotesRouted).toBe(0);
    expect(enqueued).toEqual([]);
    expect(await renaming).toBeGreaterThan(0);
    expect(
      (await readInstrumentCitationRecord(vault, 'q-one'))?.inputNotes?.map((note) => note.path),
    ).toEqual([NOTE_A, NOTE_B2]);
    expect(trigger.renamedPathOf(NOTE_B)).toBe(NOTE_B);
    // And the next pass, reading the moved records, routes nothing either.
    expect((await trigger.tick(vault, actions)).inputNotesRouted).toBe(0);
  });
});

// ---------------------------------------------------------------------------------------------
// G, H
// ---------------------------------------------------------------------------------------------

describe('G and H: a stale pending draft never blocks its concept, and is never overwritten', () => {
  const COURSE_NOTE = `${FOLDER}/Week 0.md`;
  const unit = {
    text: 'the sweep never reads unit text',
    provenance: {
      sourcePath: `${FOLDER}/Slides 0.pdf`,
      location: { page: 1, charRange: { start: 0, end: 1 } },
      embeddedIn: { notePath: COURSE_NOTE, blockStart: 0, blockEnd: 10 },
    },
  };
  const concepts = async () => [
    {
      key: CONCEPT_KEY,
      name: CONCEPT,
      tier: 2 as const,
      courses: [COURSE],
      sourcePaths: [COURSE_NOTE],
    },
  ];
  const drafted = (stem: string, inputNotes?: readonly InputNote[]): DraftQuizCardsResult => ({
    status: 'drafted',
    request: { courseCode: COURSE, conceptName: CONCEPT, sourceChunks: [A1] },
    ...(inputNotes === undefined ? {} : { inputNotes }),
    response: {
      ...goodResponse,
      result: { questions: [{ ...goodResponse.result.questions[0], stem }] },
    },
  });

  it('G: a pending draft one of whose input notes changed no longer counts as a duplicate; the concept is drafted again', async () => {
    const vault = world([]);
    vault.files.set(COURSE_NOTE, noteOf('Week 0', 'The invented course note.'));
    const cache = createVaultDraftCacheStore(vault);
    let n = 0;
    const deps = {
      vault,
      cache,
      draftDeps: {} as never,
      listConceptsForCourse: concepts,
      draftForConcept: async () => {
        n += 1;
        return drafted(`stem ${n}`, await currentInputNotes(vault, NOTE_A));
      },
      now: () => NOW,
    };
    expect(await runGenerationSweep([unit], deps)).toMatchObject({ drafted: 1 });
    // Unchanged: a duplicate, as before.
    expect(await runGenerationSweep([unit], deps)).toMatchObject({
      attempted: 0,
      skippedDuplicate: 1,
    });
    const [first] = await cache.list();
    vault.files.set(NOTE_A, noteOf('Week 2', 'Invented layers settle in no order at all.', A2));
    expect(await runGenerationSweep([unit], deps)).toMatchObject({
      attempted: 1,
      drafted: 1,
      skippedDuplicate: 0,
    });
    const all = await cache.list();
    expect(all).toHaveLength(2);
    // The withheld draft is kept exactly as it was.
    expect(all.find((record) => record.draftId === first?.draftId)).toEqual(first);
  });

  it('H: a redo of a redo never lands on the earlier redo’s record', async () => {
    const vault = world([]);
    vault.files.set(COURSE_NOTE, noteOf('Week 0', 'The invented course note.'));
    const cache = createVaultDraftCacheStore(vault);
    let n = 0;
    const deps = {
      vault,
      cache,
      draftDeps: {} as never,
      listConceptsForCourse: concepts,
      // A drafting call that reports no input notes: each draft reads as one recorded before input
      // notes were, so every sweep drafts the concept again beside it.
      draftForConcept: async () => {
        n += 1;
        return drafted(`stem ${n}`);
      },
      now: () => NOW,
    };
    await runGenerationSweep([unit], deps);
    await runGenerationSweep([unit], deps);
    const afterTwo = await cache.list();
    expect(afterTwo).toHaveLength(2);
    await runGenerationSweep([unit], deps);
    const afterThree = await cache.list();
    expect(afterThree).toHaveLength(3);
    for (const earlier of afterTwo) {
      expect(afterThree.find((record) => record.draftId === earlier.draftId)).toEqual(earlier);
    }
    expect(new Set(afterThree.map((record) => record.question?.stem))).toEqual(
      new Set(['stem 1', 'stem 2', 'stem 3']),
    );
  });

  it('H: a heading offer never lands on a sweep draft’s record', async () => {
    const vault = world([]);
    vault.files.set(COURSE_NOTE, noteOf('Week 0', 'The invented course note.'));
    const cache = createVaultDraftCacheStore(vault);
    await runGenerationSweep([unit], {
      vault,
      cache,
      draftDeps: {} as never,
      listConceptsForCourse: concepts,
      draftForConcept: async () =>
        drafted('the sweep draft', await currentInputNotes(vault, NOTE_A)),
      now: () => NOW,
    });
    const [sweepDraft] = await cache.list();
    const port = createHeadingOfferPort({
      draftDeps: () => ({ vault }) as unknown as DraftQuizCardsDeps,
      cache,
      now: () => NOW,
      draftForConcept: async () =>
        drafted('the offer draft', await currentInputNotes(vault, NOTE_A)),
    });
    const outcome = await port.accept(
      {
        headingText: 'Why do invented layers settle in order?',
        level: 2,
        blockIndex: 1,
        headingStart: 0,
        headingEnd: 10,
        coverageEnd: 20,
        rule: 'wh-inversion',
      },
      {
        courseCode: COURSE,
        concept: { key: CONCEPT_KEY, name: CONCEPT, tier: 2, courses: [COURSE], sourcePaths: [] },
        sourcePath: COURSE_NOTE,
      },
    );
    expect(outcome.kind).toBe('drafted');
    expect(await cache.get(sweepDraft?.draftId ?? '')).toEqual(sweepDraft);
    expect(await cache.list()).toHaveLength(2);
  });
});

// ---------------------------------------------------------------------------------------------
// I
// ---------------------------------------------------------------------------------------------

describe('I: a successor records the note its passage came from, from that same read', () => {
  /**
   * Reads of `path` after the first `stable` return `later`: the note changing between two reads.
   * Before the job reads the cited note for its passage, the question's walk reads it twice (the
   * concept reading and the instrument walk) and the transcript test once, so with `stable` 4 the
   * passage is read from the first version and every read after it sees the second. The test
   * checks the passage sent came from the first version, so a change in that count shows.
   */
  class ChangingVault extends MemoryVault {
    private reads = 0;
    constructor(
      private readonly path: string,
      private readonly stable: number,
      private readonly later: string,
    ) {
      super();
    }
    override async read(path: string): Promise<string> {
      if (path === this.path) {
        this.reads += 1;
        if (this.reads > this.stable) return this.later;
      }
      return super.read(path);
    }
  }

  async function predecessorCiting(vault: MemoryVault): Promise<void> {
    vault.files.set(HOME, homeWith(['q-one']));
    vault.files.set(NOTE_C, noteOf('Week 4', C1, A1));
    await writeInstrumentCitation(vault, 'q-one', {
      sourcePath: NOTE_A,
      page: 1,
      passageDigest: await digestPassage(A1),
    });
  }

  const revise = (vault: MemoryVault) =>
    runInstrumentRevisionJob(
      {
        vault,
        cache: createVaultDraftCacheStore(vault),
        draftDeps: () => ({ transport: { send: async () => goodResponse } }) as never,
        // Retrieval found the passage's very words in another note.
        draftForConcept: async () => ({
          status: 'drafted',
          request: { courseCode: COURSE, conceptName: CONCEPT, sourceChunks: [A1] },
          inputNotes: await currentInputNotes(vault, NOTE_C),
          response: goodResponse,
        }),
        now: () => NOW,
      },
      { kind: 'instrument-revision', predecessorInstrumentId: 'q-one', newPassageText: A1 },
    );

  it('a retrieved chunk with the passage’s text from another note does not drop the cited note', async () => {
    const vault = world([]);
    await predecessorCiting(vault);
    expect(await revise(vault)).toEqual({ ok: true });
    const [successor] = await createVaultDraftCacheStore(vault).listPending();
    expect(successor?.inputNotes).toEqual([
      { path: NOTE_A, contentHash: await inputNoteFingerprint(vault, NOTE_A) },
      { path: NOTE_C, contentHash: await inputNoteFingerprint(vault, NOTE_C) },
    ]);
  });

  it('the cited note’s fingerprint is taken from the read its passage came from', async () => {
    const first = noteOf('Week 2', A1, A2);
    const later = noteOf('Week 2', A1, 'An invented later paragraph.');
    const vault = new ChangingVault(NOTE_A, 4, later);
    for (const [path, content] of world([]).files) vault.files.set(path, content);
    vault.files.set(NOTE_A, first);
    vault.files.set(HOME, homeWith(['q-one']));
    // Whole-note grain: the passage sent is the whole cited note as read, so it shows which version
    // the successor was drafted from.
    await writeInstrumentCitation(vault, 'q-one', { sourcePath: NOTE_A, page: 1 });
    const sent: string[] = [];
    const transport = {
      send: async (request: { readonly payload: { readonly sourceChunks: readonly string[] } }) => {
        sent.push(request.payload.sourceChunks[0] ?? '');
        return goodResponse;
      },
    };
    const outcome = await runInstrumentRevisionJob(
      {
        vault,
        cache: createVaultDraftCacheStore(vault),
        draftDeps: () => ({ transport }) as never,
        draftForConcept: async (deps) => {
          await deps.transport.send({
            contractVersion: 1,
            taskId: 'quiz.generate.v1',
            payload: {
              courseCode: COURSE,
              conceptName: CONCEPT,
              sourceChunks: [C1],
              sourceChunkOrigins: [null],
            },
          } as never);
          return {
            status: 'drafted',
            request: { courseCode: COURSE, conceptName: CONCEPT, sourceChunks: [C1] },
            inputNotes: await currentInputNotes(vault, NOTE_C),
            response: goodResponse,
          };
        },
        now: () => NOW,
      },
      {
        kind: 'instrument-revision',
        predecessorInstrumentId: 'q-one',
        newPassageText: stripQuestionBlocks(first),
      },
    );
    expect(outcome).toEqual({ ok: true });
    const [successor] = await createVaultDraftCacheStore(vault).listPending();
    // The passage sent came from the first version (the scenario holds) ...
    expect(sent[0]).toContain(A2);
    expect(sent[0]).not.toContain('An invented later paragraph.');
    // ... and so does the fingerprint recorded for its note, never the version a later read saw.
    expect(successor?.inputNotes?.find((note) => note.path === NOTE_A)?.contentHash).toBe(
      await markdownFingerprint(first),
    );
    expect(await markdownFingerprint(first)).not.toBe(await markdownFingerprint(later));
  });
});
