// Scenarios: features/F1-sources.md, block "Feature: D-467 — A lecturer correcting a slide", the
// scenarios added by ol-zjke.2 (decision sheet v87 row 4, option (a); [D-473], [D-625], [D-097]).
// Test id: @auto:plugin/ingestion/slide-correction-drafts.ol-zjke.2.spec
//
// A pending draft, not yet presented, whose slide claim an attributable, clear lecturer correction
// invalidates is held under its draft hold key in the citation store: the same record and the
// same `lecturer-correction` fact an instrument's hold is. The open session, its presentation
// check, bulk review and acceptance honour it; acceptance carries it to the instrument before the
// instrument exists in her vault; the citation pass and the attainment reading never take the key
// for an instrument.
//
// Every course, deck, slide, transcript, draft and sentence here is INVENTED ("course A", an
// invented lecturer); nothing comes from a real vault. The judge is a fake returning controlled
// verdicts.
import {
  type ComposedStudySession,
  calendarDayFromLocalDate,
  clozeMapKey,
  createFsrsScheduler,
  enumerateVaultInstruments,
  hashContent,
  type LectureBundle,
  type ListOptions,
  type PersistedKeywordIndex,
  parseMcqBlocks,
  type RandomSource,
  readClozeId,
  readReviewLogHistory,
  stampClozeId,
  suspendedInstrumentIds,
  type Unsubscribe,
  type VaultEvent,
  type VaultPath,
  type VaultSource,
} from 'olea-core';
import { describe, expect, it, vi } from 'vitest';
import { readPendingPassageChanges } from '../../src/attainment/passage-changes.js';
import { createDraftAcceptPort, type DraftAcceptPort } from '../../src/generation/accept.js';
import { createBulkReviewController } from '../../src/generation/bulk-review.js';
import { createVaultDraftCacheStore, deriveDraftId } from '../../src/generation/cache-store.js';
import type { DraftRecord } from '../../src/generation/types.js';
import { readLectureBundles } from '../../src/ingestion/lecture-links.js';
import {
  anchorKeyKind,
  CITATION_ANCHOR_STORAGE_KEY,
  type CitationAnchorRecord,
  type CitationHashStore,
  DRAFT_HOLD_KEY_PREFIX,
  draftHoldKey,
  draftIdOfHoldKey,
  ObsidianCitationHashStore,
  readHeldDraftIds,
} from '../../src/ingestion/materiality/citation-hash-store.js';
import { CitationRevisionTrigger } from '../../src/ingestion/materiality/citation-revision-wiring.js';
import {
  applySlideCorrections,
  type LandedTranscript,
  LECTURER_CORRECTION_REASON,
  type RestsOnCorrectedClaim,
  type SlideCorrectionJudgement,
  type SlideCorrectionJudgePort,
  type SlideCorrectionJudgeRequest,
  type SlideCorrectionRouteDeps,
  slideCorrectionFinished,
  slidePassageReader,
} from '../../src/ingestion/slide-correction.js';
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
import { resolveCitationPendingRevalidation } from '../../src/session-builder/provider.js';
import { FakeDataHost } from './materiality/transcript-fixtures.ol-egov.141.89.5.43.js';

const DEVICE = 'olea-testdevice1';
const NOW = new Date('2026-10-20T14:00:00Z');
const fixedRandom: RandomSource = { next: () => 0.42 };

const COURSE = 'COURSEA';
const DECK = 'Course A/Lecture 3/slides.pdf';
const DECK_HOME = 'Course A/Lecture 3/slides (Olea).md';
const TRANSCRIPT = 'Course A/Lecture 3/lecture.txt';
const LECTURE_NOTE = 'Course A/Lecture 3/Lecture 3.md';
const deckBytes = new TextEncoder().encode('invented deck bytes, version one');

const CORRECTING_PART =
  'Today we look at the invented sample once more. There is a mistake on slide two: the invented ' +
  'value falls with depth, it does not rise. Now on to the next invented topic.';

const HOME_NOTE = ['---', 'topic: [Invented slide topic]', `course: ${COURSE}`, '---', ''].join(
  '\n',
);

/**
 * A vault over literal maps: text and binary files, `under` honoured, and two seams for the
 * conversion's crash cases: a write that fails, and an observer called before a write lands.
 */
class DraftVault implements VaultSource {
  readonly files = new Map<string, string>();
  readonly binaries = new Map<string, Uint8Array>();
  failWrite: ((path: VaultPath) => boolean) | undefined;
  beforeWrite: ((path: VaultPath, content: string) => Promise<void>) | undefined;
  async list(options: ListOptions = {}): Promise<readonly VaultPath[]> {
    const extensions = options.extensions?.map((e) => e.toLowerCase());
    return [...new Set([...this.files.keys(), ...this.binaries.keys()])]
      .filter((p) => options.under === undefined || p.startsWith(`${options.under}/`))
      .filter(
        (p) =>
          extensions === undefined ||
          extensions.includes(p.slice(p.lastIndexOf('.') + 1).toLowerCase()),
      )
      .sort();
  }
  async read(path: VaultPath): Promise<string> {
    const content = this.files.get(path);
    if (content === undefined) throw new Error('not found');
    return content;
  }
  async readBinary(path: VaultPath): Promise<Uint8Array> {
    const bytes = this.binaries.get(path);
    if (bytes !== undefined) return bytes;
    return new TextEncoder().encode(await this.read(path));
  }
  async write(path: VaultPath, content: string): Promise<void> {
    if (this.failWrite?.(path) === true) throw new Error('invented write failure');
    await this.beforeWrite?.(path, content);
    this.files.set(path, content);
  }
  async exists(path: VaultPath): Promise<boolean> {
    return this.files.has(path) || this.binaries.has(path);
  }
  watch(_handler: (event: VaultEvent) => void): Unsubscribe {
    return () => {};
  }
}

/** The keyword index's extracted blocks for the deck: one invented text per slide page. */
function deckIndex(pages: readonly number[]): PersistedKeywordIndex {
  return {
    version: 1,
    documents: [
      {
        path: DECK,
        courses: [],
        contentHash: 'invented-hash',
        blocks: pages.map((page, blockIndex) => ({
          blockIndex,
          kind: 'paragraph' as const,
          text: `Invented slide ${page}: the invented value rises with depth (claim ${page}).`,
          location: { page },
        })),
      },
    ],
  };
}

function linkedBundles(): readonly LectureBundle[] {
  return readLectureBundles({
    resolvedLinks: () => new Map([[LECTURE_NOTE, [DECK, TRANSCRIPT]]]),
    frontmatterFor: () => undefined,
  });
}

const TRANSCRIPT_LANDED: LandedTranscript = {
  path: TRANSCRIPT,
  version: 'invented-transcript-version',
  parts: [{ ordinal: 1, text: CORRECTING_PART }],
};

const STAMP = { promptVersion: 'slide-correction-invented-v1', modelId: 'invented-model' };

/** The invented marker each draft's own text carries, by which the fake judge places it. */
function markerIn(item: string): string {
  return /\((d-[\w-]+)\)/.exec(item)?.[1] ?? 'unknown';
}

const PLACE: Readonly<Record<string, RestsOnCorrectedClaim>> = {
  'd-claim': 'yes',
  'd-card': 'yes',
  'd-other': 'no',
};

function fakeJudge(
  onCall?: () => Promise<void>,
): SlideCorrectionJudgePort & { judge: ReturnType<typeof vi.fn> } {
  return {
    judge: vi.fn(
      async (request: SlideCorrectionJudgeRequest): Promise<SlideCorrectionJudgement> => {
        await onCall?.();
        return {
          attributableToLecturer: true,
          clear: true,
          placements: request.candidates.map((c) => PLACE[markerIn(c.item)] ?? 'unclear'),
          stamp: STAMP,
        };
      },
    ),
  };
}

function mcqDraft(
  draftId: string,
  marker: string,
  page: number,
  sourceRevision: string,
): DraftRecord {
  return {
    draftId,
    status: 'pending',
    courseCode: COURSE,
    conceptName: 'Invented concept',
    conceptIds: ['invented-concept-key'],
    sourcePath: DECK_HOME,
    sourceCitation: { sourcePath: DECK, page, sourceRevision },
    createdAt: '2026-10-19T09:00:00Z',
    question: {
      stem: `Which invented statement about the sample holds (${marker})?`,
      correctAnswer: `Alpha ${marker}`,
      distractors: ['Beta', 'Gamma', 'Delta', 'Epsilon'],
      feedback: 'Invented feedback.',
    },
    provenance: { taskId: 'quiz.generate.v1', promptVersion: '1.0.0', modelId: 'test-model' },
    firstServedAt: null,
  };
}

interface World {
  readonly vault: DraftVault;
  host: FakeDataHost;
  store: ObsidianCitationHashStore;
  readonly claim: DraftRecord;
  readonly other: DraftRecord;
  cache(): ReturnType<typeof createVaultDraftCacheStore>;
  acceptPort(): DraftAcceptPort;
  /** A restart: data.json read back from its serialised form, every store and cache built anew. */
  restart(): void;
  correct(overrides?: Partial<SlideCorrectionRouteDeps>): ReturnType<typeof applySlideCorrections>;
}

/** The deck, its Olea home note, and two pending drafts from the same deck: slide 2 and slide 3. */
async function world(): Promise<World> {
  const vault = new DraftVault();
  vault.files.set(DECK_HOME, HOME_NOTE);
  vault.binaries.set(DECK, deckBytes);
  const revision = await hashContent(deckBytes);
  const claim = mcqDraft(
    await deriveDraftId(COURSE, 'Invented concept', 0),
    'd-claim',
    2,
    revision,
  );
  const other = mcqDraft(
    await deriveDraftId(COURSE, 'Invented concept', 1),
    'd-other',
    3,
    revision,
  );
  const seedCache = createVaultDraftCacheStore(vault);
  await seedCache.put(claim);
  await seedCache.put(other);
  const host = new FakeDataHost();
  const w: World = {
    vault,
    host,
    store: new ObsidianCitationHashStore(host),
    claim,
    other,
    cache: () => createVaultDraftCacheStore(vault),
    acceptPort: () =>
      createDraftAcceptPort({
        vault,
        cache: createVaultDraftCacheStore(vault),
        deviceId: DEVICE,
        now: () => NOW,
        holds: () => w.store,
      }),
    restart: () => {
      const next = new FakeDataHost();
      next.blob = JSON.parse(JSON.stringify(w.host.blob)) as Record<string, unknown>;
      w.host = next;
      w.store = new ObsidianCitationHashStore(next);
    },
    correct: (overrides = {}) =>
      applySlideCorrections(
        {
          vault,
          store: w.store,
          judge: fakeJudge(),
          clock: { now: () => 5_000 },
          bundles: linkedBundles,
          slidePassage: slidePassageReader(deckIndex([2, 3])),
          ...overrides,
        },
        TRANSCRIPT_LANDED,
      ),
  };
  return w;
}

/** The instruments now in her vault, composed as a session would serve them (no builder filter). */
async function composedFor(vault: VaultSource): Promise<ComposedStudySession> {
  const enumeration = await enumerateVaultInstruments(vault);
  const items = enumeration.records.map((record, index) => ({
    position: index + 1,
    instrumentId: record.instrumentId,
    instrumentType: record.instrumentType,
    notePath: record.notePath,
    noteTitle: record.noteTitle,
    conceptName: 'Invented concept',
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

/** The production session open over the world's vault, draft cache, citation store and accept port. */
async function openSession(w: World, acceptPort: DraftAcceptPort = w.acceptPort()) {
  const holder = createStudySessionHolder();
  holder.enter(NOW, await composedFor(w.vault));
  const outcome = await openReviewSession({
    vault: w.vault,
    scheduler: createFsrsScheduler(),
    deviceId: DEVICE,
    ports: {
      reviewLog: createVaultReviewLogPort(w.vault, DEVICE),
      suspendPort: createVaultSuspendPort(w.vault, DEVICE),
      editPort: { async edit() {} },
      noteExists: createVaultNoteExistsPort(w.vault),
      clock: { now: () => NOW },
      draftAcceptPort: acceptPort,
    },
    random: fixedRandom,
    probeDays: 30,
    studySessionHolder: holder,
    composeDefaultStudySession: () => Promise.reject(new Error('unreachable')),
    draftCache: w.cache(),
    citationHashStore: w.store,
  } as never);
  if (!outcome.ok) throw new Error('the session failed to open');
  return outcome.session;
}

type Session = Awaited<ReturnType<typeof openSession>>;

/** Answers every multiple-choice item the session presents, recording each one presented. */
async function answerAll(session: Session): Promise<readonly (string | null)[]> {
  const presented: (string | null)[] = [];
  await session.start();
  for (let guard = 0; guard < 20; guard++) {
    const phase = session.getViewModel().phase;
    if (phase !== 'mcq-open') break;
    const item = session.currentItem;
    presented.push(item?.instrument.draftId ?? item?.instrument.instrumentId ?? null);
    await session.mcqAnswer(0);
    await session.mcqNext();
  }
  return presented;
}

/** An accept port that records every draft id it is asked to accept, over the real one. */
function recordingPort(inner: DraftAcceptPort): DraftAcceptPort & { accepted: string[] } {
  const accepted: string[] = [];
  return {
    accepted,
    accept: (draftId, verdict) => {
      accepted.push(draftId);
      return inner.accept(draftId, verdict);
    },
    reject: (draftId) => inner.reject(draftId),
  };
}

/** The production presentation-time check for an instrument, over a fresh vault walk. */
async function instrumentAtPresentation(w: World, instrumentId: string): Promise<string> {
  const { records } = await enumerateVaultInstruments(w.vault);
  const check = sourceCheckAtPresentation(
    w.store,
    async () => suspendedInstrumentIds((await readReviewLogHistory(w.vault)).entries),
    { vault: w.vault, recordOf: (id) => records.find((record) => record.instrumentId === id) },
  );
  return check(instrumentId);
}

async function anchor(store: CitationHashStore, key: string) {
  return (await store.loadAll()).get(key);
}

/** The new multiple-choice ids `content` carries that `before` did not. */
function newMcqIds(before: string, content: string): readonly string[] {
  const old = new Set(parseMcqBlocks(before).instruments.map((i) => i.id));
  return parseMcqBlocks(content)
    .instruments.map((i) => i.id)
    .filter((id): id is string => id !== null && !old.has(id));
}

describe('D-467: a pending draft resting on a corrected slide claim (ol-zjke.2, sheet v87 row 4)', () => {
  describe('scenario: a pending draft resting on the corrected claim is withheld before its first presentation', () => {
    it('the correction holds the draft under its draft hold key, with the lecturer-correction fact, and the opened session does not present it', async () => {
      const w = await world();
      const report = await w.correct();

      expect(report).toMatchObject({ cues: 1, calls: 1, judgedCorrection: 1, heldYes: 1 });
      expect(report.draftsHeld).toBe(1);
      expect(slideCorrectionFinished(report)).toBe(true);
      const hold = await anchor(w.store, draftHoldKey(w.claim.draftId));
      expect(hold?.pendingRevalidation?.reason).toBe(LECTURER_CORRECTION_REASON);
      expect(hold?.pendingRevalidation?.raisedBy).toMatchObject({ kind: 'model', stamp: STAMP });
      expect(hold?.conceptIds).toEqual(w.claim.conceptIds);
      // No instrument exists yet, and nothing was written into her notes.
      expect(w.vault.files.get(DECK_HOME)).toBe(HOME_NOTE);

      const session = await openSession(w);
      const queued = session.queueSnapshot.map((item) => item.instrument.draftId);
      expect(queued).not.toContain(w.claim.draftId);
      expect(queued).toContain(w.other.draftId);
      const check = draftSourceCheckAtPresentation(w.vault, [w.claim, w.other], undefined, w.store);
      expect(await check(w.claim.draftId)).toBe('check-failed');
      expect(await check(w.other.draftId)).toBe('clear');
    });

    it('stays unpresented after Olea restarts: the hold is read back from the persisted store', async () => {
      const w = await world();
      await w.correct();
      w.restart();

      expect(await readHeldDraftIds(w.store, [w.claim.draftId, w.other.draftId])).toEqual(
        new Set([w.claim.draftId]),
      );
      const presented = await answerAll(await openSession(w));
      expect(presented).not.toContain(w.claim.draftId);
      expect(presented).toContain(w.other.draftId);
    });

    it('stays unpresented until its grounding is reconciled: a citation pass neither reads, judges, lifts nor counts the draft key', async () => {
      const w = await world();
      await w.correct();
      const before = await anchor(w.store, draftHoldKey(w.claim.draftId));
      // A draft key with no fact at all (none is written so; a later route might leave one) is
      // still never taken for an instrument whose passage went missing.
      const leftover: CitationAnchorRecord = {
        sourcePath: DECK_HOME,
        text: 'Invented material no note holds.',
        conceptIds: ['invented-concept-key'],
      };
      await w.store.save(draftHoldKey('invented-leftover'), leftover);
      const judge = { judge: vi.fn(async () => ({ material: true, reason: 'scripted' })) };
      const trigger = new CitationRevisionTrigger({
        store: w.store,
        judge,
        clock: { now: () => 9_000 },
        transcriptPartGrain: false,
      });
      const report = await trigger.tick(w.vault, {
        enqueue: vi.fn(async () => undefined),
        suspend: vi.fn(async () => undefined),
        onRelocationProposed: vi.fn(),
      });

      // Never counted as an instrument whose passage could not be found.
      expect(report).toMatchObject({
        tracked: 0,
        stranded: 0,
        relocated: 0,
        relocationProposed: 0,
      });
      expect(judge.judge).not.toHaveBeenCalled();
      expect(await anchor(w.store, draftHoldKey(w.claim.draftId))).toEqual(before);
      expect(await anchor(w.store, draftHoldKey('invented-leftover'))).toEqual(leftover);
      expect((await openSession(w)).queueSnapshot.map((i) => i.instrument.draftId)).not.toContain(
        w.claim.draftId,
      );
    });

    it('a draft queued before the correction landed is withheld at its presentation', async () => {
      const w = await world();
      const port = recordingPort(w.acceptPort());
      const session = await openSession(w, port);
      expect(session.queueSnapshot.map((i) => i.instrument.draftId)).toContain(w.claim.draftId);

      await w.correct();
      const presented = await answerAll(session);

      expect(presented).not.toContain(w.claim.draftId);
      expect(port.accepted).not.toContain(w.claim.draftId);
    });
  });

  describe('scenario: a pending draft resting on another claim of the same slide is still presented', () => {
    it('the second draft from the same deck carries no hold and is presented as before', async () => {
      const w = await world();
      await w.correct();

      expect(await anchor(w.store, draftHoldKey(w.other.draftId))).toBeUndefined();
      const session = await openSession(w);
      await session.start();
      expect(session.getViewModel().phase).toBe('mcq-open');
      expect(session.currentItem?.instrument.draftId).toBe(w.other.draftId);
    });
  });

  describe('scenario: a held draft is not passively accepted', () => {
    it('a session run to its end neither presents nor accepts the held draft, which is still a held pending draft afterwards', async () => {
      const w = await world();
      await w.correct();
      const port = recordingPort(w.acceptPort());

      const presented = await answerAll(await openSession(w, port));

      expect(presented).toEqual([w.other.draftId]);
      expect(port.accepted).toEqual([w.other.draftId]);
      const after = await w.cache().get(w.claim.draftId);
      expect(after?.status).toBe('pending');
      expect(after?.instrumentId).toBeUndefined();
      expect(await readHeldDraftIds(w.store, [w.claim.draftId])).toEqual(
        new Set([w.claim.draftId]),
      );
      expect(w.vault.files.get(DECK_HOME)).not.toContain('(d-claim)');
      // The unaffected draft became an instrument with no hold of its own.
      const otherId = (await w.cache().get(w.other.draftId))?.instrumentId;
      expect(otherId).toBeDefined();
      expect(await anchor(w.store, otherId ?? '')).toBeUndefined();
    });
  });

  describe('scenario: a held draft is offered nowhere else either', () => {
    it('bulk review does not list it, and its batch accept leaves it a held pending draft', async () => {
      const w = await world();
      await w.correct();
      const controller = createBulkReviewController({
        cache: w.cache(),
        acceptPort: w.acceptPort(),
        editPort: { async edit() {} },
        citationHashStore: w.store,
      });

      await controller.load();
      const listed = controller
        .getViewModel()
        .groups.flatMap((group) => group.items.map((item) => item.draftId));
      expect(listed).toEqual([w.other.draftId]);

      const result = await controller.acceptRemainder(DECK_HOME);
      expect(result.accepted).toEqual([w.other.draftId]);
      expect((await w.cache().get(w.claim.draftId))?.status).toBe('pending');
      expect(await readHeldDraftIds(w.store, [w.claim.draftId])).toEqual(
        new Set([w.claim.draftId]),
      );
    });
  });

  describe('scenario: a held draft that becomes an instrument stays held', () => {
    it('accepted explicitly: the instrument is withheld for the same correction, and only then is the draft key released', async () => {
      const w = await world();
      await w.correct();
      const draftFact = (await anchor(w.store, draftHoldKey(w.claim.draftId)))?.pendingRevalidation;

      const { instrumentId } = await w.acceptPort().accept(w.claim.draftId, 'accepted');

      expect(anchorKeyKind(instrumentId)).toBe('instrument');
      expect((await anchor(w.store, instrumentId))?.pendingRevalidation).toEqual(draftFact);
      expect(await anchor(w.store, draftHoldKey(w.claim.draftId))).toBeUndefined();
      expect(await resolveCitationPendingRevalidation(w.store, [instrumentId])).toEqual(
        new Set([instrumentId]),
      );
      expect(await instrumentAtPresentation(w, instrumentId)).toBe('check-failed');
      const presented = await answerAll(await openSession(w));
      expect(presented).not.toContain(instrumentId);
    });

    it('accepted passively, by a session that presented it before the hold landed: the instrument is held', async () => {
      const w = await world();
      const session = await openSession(w);
      await session.start();
      expect(session.currentItem?.instrument.draftId).toBe(w.claim.draftId);

      await w.correct();
      await session.mcqAnswer(0);
      await session.mcqNext();

      const instrumentId = (await w.cache().get(w.claim.draftId))?.instrumentId ?? '';
      expect(instrumentId).not.toBe('');
      expect((await anchor(w.store, instrumentId))?.pendingRevalidation?.reason).toBe(
        LECTURER_CORRECTION_REASON,
      );
      expect(await instrumentAtPresentation(w, instrumentId)).toBe('check-failed');
    });

    it('a card draft too: the hold lands on the card the draft becomes', async () => {
      const w = await world();
      const { question: _mcqContent, ...base } = w.claim;
      const cardRecord: DraftRecord = {
        ...base,
        draftId: await deriveDraftId(COURSE, 'Invented concept', 2),
        instrumentType: 'qa',
        card: { front: 'What does the invented value do with depth (d-card)?', back: 'It rises.' },
      };
      await w.cache().put(cardRecord);
      await w.correct();
      expect(await readHeldDraftIds(w.store, [cardRecord.draftId])).toEqual(
        new Set([cardRecord.draftId]),
      );
      // The instrument keys held at the moment the note holding the card is written.
      const heldAtWrite: string[] = [];
      w.vault.beforeWrite = async (path) => {
        if (path !== DECK_HOME) return;
        for (const [key, record] of await w.store.loadAll()) {
          if (anchorKeyKind(key) === 'instrument' && record.pendingRevalidation !== undefined) {
            heldAtWrite.push(key);
          }
        }
      };

      const { instrumentId } = await w.acceptPort().accept(cardRecord.draftId, 'accepted');

      expect(heldAtWrite).toEqual([instrumentId]);
      expect(anchorKeyKind(instrumentId)).toBe('instrument');
      expect((await anchor(w.store, instrumentId))?.pendingRevalidation?.reason).toBe(
        LECTURER_CORRECTION_REASON,
      );
      expect(await anchor(w.store, draftHoldKey(cardRecord.draftId))).toBeUndefined();
    });

    it('no attainment reading treats the draft as an instrument: the changed-passage reading names the instrument only', async () => {
      const w = await world();
      await w.correct();
      const beforeConversion = await readPendingPassageChanges(w.store, NOW);
      expect(beforeConversion).toEqual({ kind: 'read', changes: [] });

      const { instrumentId } = await w.acceptPort().accept(w.claim.draftId, 'accepted');
      const afterConversion = await readPendingPassageChanges(w.store, NOW);
      expect(afterConversion.kind).toBe('read');
      const named =
        afterConversion.kind === 'read'
          ? afterConversion.changes.flatMap((change) => change.instrumentIds)
          : [];
      expect(named).toEqual([instrumentId]);
    });

    it('at no point is the new instrument presentable without the hold: the hold is in the store before the note that holds the instrument is written', async () => {
      const w = await world();
      await w.correct();
      const seenAtWrite: string[] = [];
      w.vault.beforeWrite = async (path, content) => {
        if (path !== DECK_HOME) return;
        for (const id of newMcqIds(w.vault.files.get(DECK_HOME) ?? '', content)) {
          expect((await anchor(w.store, id))?.pendingRevalidation?.reason).toBe(
            LECTURER_CORRECTION_REASON,
          );
          seenAtWrite.push(id);
        }
      };

      const { instrumentId } = await w.acceptPort().accept(w.claim.draftId, 'accepted');

      expect(seenAtWrite).toEqual([instrumentId]);
    });

    it('a restart before the instrument is written (its note write fails after the hold landed) leaves a held pending draft and nothing presentable', async () => {
      const w = await world();
      await w.correct();
      w.vault.failWrite = (path) => path === DECK_HOME;

      await expect(w.acceptPort().accept(w.claim.draftId, 'accepted')).rejects.toThrow();
      w.vault.failWrite = undefined;
      w.restart();

      expect((await w.cache().get(w.claim.draftId))?.status).toBe('pending');
      expect(await readHeldDraftIds(w.store, [w.claim.draftId])).toEqual(
        new Set([w.claim.draftId]),
      );
      expect(w.vault.files.get(DECK_HOME)).toBe(HOME_NOTE);
      expect(await answerAll(await openSession(w))).not.toContain(w.claim.draftId);

      // The retried conversion completes, and its instrument is held.
      const { instrumentId } = await w.acceptPort().accept(w.claim.draftId, 'accepted');
      expect(await instrumentAtPresentation(w, instrumentId)).toBe('check-failed');
    });

    it('a restart after the instrument is written but before the draft turns accepted leaves both held', async () => {
      const w = await world();
      await w.correct();
      w.vault.failWrite = (path) =>
        path.startsWith('.olea/drafts/') && path.includes(w.claim.draftId);

      await expect(w.acceptPort().accept(w.claim.draftId, 'accepted')).rejects.toThrow();
      w.vault.failWrite = undefined;
      w.restart();

      const [instrumentId] = newMcqIds(HOME_NOTE, w.vault.files.get(DECK_HOME) ?? '');
      expect(instrumentId).toBeDefined();
      expect(await resolveCitationPendingRevalidation(w.store, [instrumentId ?? ''])).toEqual(
        new Set([instrumentId]),
      );
      expect(await instrumentAtPresentation(w, instrumentId ?? '')).toBe('check-failed');
      expect((await w.cache().get(w.claim.draftId))?.status).toBe('pending');
      const presented = await answerAll(await openSession(w));
      expect(presented).not.toContain(w.claim.draftId);
      expect(presented).not.toContain(instrumentId);
    });

    it('a crash between the instrument hold and the draft key release leaves both keys and the instrument held; the leftover is read by nothing, and a re-call releases it', async () => {
      const w = await world();
      await w.correct();
      const failingRemove: CitationHashStore = {
        ...bind(w.store),
        remove: async () => {
          throw new Error('invented store failure');
        },
      };
      const port = createDraftAcceptPort({
        vault: w.vault,
        cache: w.cache(),
        deviceId: DEVICE,
        now: () => NOW,
        holds: () => failingRemove,
      });

      const { instrumentId } = await port.accept(w.claim.draftId, 'accepted');
      w.restart();

      expect(await anchor(w.store, draftHoldKey(w.claim.draftId))).toBeDefined();
      expect(await instrumentAtPresentation(w, instrumentId)).toBe('check-failed');
      expect((await w.cache().get(w.claim.draftId))?.status).toBe('accepted');
      const changes = await readPendingPassageChanges(w.store, NOW);
      expect(
        changes.kind === 'read' ? changes.changes.flatMap((c) => c.instrumentIds) : [],
      ).toEqual([instrumentId]);
      expect(await answerAll(await openSession(w))).not.toContain(instrumentId);

      // A re-call of accept (the idempotent path) releases the leftover, the instrument still held.
      expect((await w.acceptPort().accept(w.claim.draftId, 'accepted')).instrumentId).toBe(
        instrumentId,
      );
      expect(await anchor(w.store, draftHoldKey(w.claim.draftId))).toBeUndefined();
      expect(await instrumentAtPresentation(w, instrumentId)).toBe('check-failed');
    });

    it('accepted while the correction was being judged: the hold lands on the instrument it became', async () => {
      const w = await world();
      const report = await w.correct({
        judge: fakeJudge(async () => {
          await w.acceptPort().accept(w.claim.draftId, 'accepted');
        }),
      });

      const instrumentId = (await w.cache().get(w.claim.draftId))?.instrumentId ?? '';
      expect(report.draftsHeld).toBe(1);
      expect(report.holdWritesFailed).toBe(0);
      expect((await anchor(w.store, instrumentId))?.pendingRevalidation?.reason).toBe(
        LECTURER_CORRECTION_REASON,
      );
      expect(await instrumentAtPresentation(w, instrumentId)).toBe('check-failed');
    });

    it('accepted between the route reading the draft and writing its key, in either order: whichever runs second sees the other', async () => {
      for (const when of ['after-key-write', 'before-key-write'] as const) {
        const w = await world();
        const cache = w.cache();
        let calls = 0;
        const drafts = {
          listPending: () => cache.listPending(),
          get: async (draftId: string) => {
            calls += 1;
            const read = await cache.get(draftId);
            // 'before-key-write': she accepts after the route's first read, which it then acts on.
            if (when === 'before-key-write' && calls === 1 && draftId === w.claim.draftId) {
              await w.acceptPort().accept(draftId, 'accepted');
            }
            // 'after-key-write': she accepts just after the route wrote the draft key.
            if (when === 'after-key-write' && calls === 2 && draftId === w.claim.draftId) {
              await w.acceptPort().accept(draftId, 'accepted');
              return cache.get(draftId);
            }
            return read;
          },
        };
        const report = await w.correct({ drafts });

        const instrumentId = (await w.cache().get(w.claim.draftId))?.instrumentId ?? '';
        expect(instrumentId).not.toBe('');
        expect(report.holdWritesFailed).toBe(0);
        expect((await anchor(w.store, instrumentId))?.pendingRevalidation?.reason).toBe(
          LECTURER_CORRECTION_REASON,
        );
        expect(await instrumentAtPresentation(w, instrumentId)).toBe('check-failed');
      }
    });
  });

  describe('the draft key kind: one constructor, one classifier, and no collision with an instrument id', () => {
    it('a draft hold key is classified as a draft and gives back its draft id; an empty draft id has none', async () => {
      const hex = await deriveDraftId(COURSE, 'Invented concept', 0);
      const uuid = '0b0e4b9e-3c1f-4c3a-9a51-3d0c6b2f7e11';
      for (const draftId of [hex, uuid]) {
        const key = draftHoldKey(draftId);
        expect(key.startsWith(DRAFT_HOLD_KEY_PREFIX)).toBe(true);
        expect(anchorKeyKind(key)).toBe('draft');
        expect(draftIdOfHoldKey(key)).toBe(draftId);
        expect(key).not.toBe(draftId);
      }
      expect(() => draftHoldKey('')).toThrow();
      expect(draftIdOfHoldKey(DRAFT_HOLD_KEY_PREFIX)).toBeUndefined();
    });

    it('no instrument id her vault can carry is read as a draft key: explicit ids are one line, every other id begins prov1', async () => {
      const vault = new DraftVault();
      const mcq = (idLine: string | null, n: number) => [
        '```olea-mcq',
        ...(idLine === null ? [] : [idLine]),
        `stem: Invented stem ${n}?`,
        'answer: Alpha',
        'distractor: Beta',
        'distractor: Gamma',
        'distractor: Delta',
        'distractor: Epsilon',
        '```',
        '',
      ];
      vault.files.set(
        'Course A/Ids.md',
        [
          '---',
          'topic: [Invented ids]',
          `course: ${COURSE}`,
          '---',
          '',
          // The prefix's own word as her explicit id: one line, so never the prefix itself.
          ...mcq('id: draft-hold', 1),
          // No explicit id: a provisional id until it is stamped.
          ...mcq(null, 2),
          '## An invented question?',
          '',
          'Invented front::Invented back ^blk1',
          '',
        ].join('\n'),
      );
      // A note whose path carries a line break: its provisional ids still begin `prov1:`.
      vault.files.set(
        'Course A/odd\nname.md',
        ['---', 'topic: [Invented ids]', '---', '', 'Odd front::Odd back ^blk2', ''].join('\n'),
      );
      const { records } = await enumerateVaultInstruments(vault);
      expect(records.length).toBeGreaterThanOrEqual(4);
      for (const record of records) {
        expect(anchorKeyKind(record.instrumentId)).toBe('instrument');
        expect(draftIdOfHoldKey(record.instrumentId)).toBeUndefined();
        expect(
          record.instrumentId.includes('\n') ? record.instrumentId.startsWith('prov1:') : true,
        ).toBe(true);
      }

      // A stamped cloze id is one line of the frontmatter map: a line break cannot be written there.
      const anchorAt = { noteUid: null, notePath: 'Course A/Cloze.md', heading: null, ordinal: 1 };
      const note = ['---', 'topic: [Invented ids]', '---', '', 'Invented {{cloze}} line.', ''].join(
        '\n',
      );
      expect(() => stampClozeId(note, anchorAt, () => `${DRAFT_HOLD_KEY_PREFIX}x`)).toThrow();
      const stamped = stampClozeId(note, anchorAt, () => 'draft-hold');
      const clozeId = readClozeId(stamped.content, anchorAt);
      expect(clozeMapKey(anchorAt).includes('\n')).toBe(false);
      expect(clozeId).toBe('draft-hold');
      expect(anchorKeyKind(clozeId ?? '')).toBe('instrument');
    });

    it('reader floor: the anchor reader keeps a draft-keyed record through a data.json round trip, and the instrument resolvers never meet it', async () => {
      const host = new FakeDataHost();
      const store = new ObsidianCitationHashStore(host);
      const draftId = await deriveDraftId(COURSE, 'Invented concept', 0);
      const record: CitationAnchorRecord = {
        sourcePath: DECK_HOME,
        text: 'Invented material.',
        conceptIds: ['invented-concept-key'],
        pendingRevalidation: {
          sinceContentHash: 'invented-correction',
          since: 1,
          reason: LECTURER_CORRECTION_REASON,
        },
      };
      await store.save(draftHoldKey(draftId), record);
      const reread = new FakeDataHost();
      reread.blob = JSON.parse(JSON.stringify(host.blob)) as Record<string, unknown>;
      const after = new ObsidianCitationHashStore(reread);

      expect((await after.loadAll()).get(draftHoldKey(draftId))).toEqual(record);
      expect(
        Object.keys(reread.blob[CITATION_ANCHOR_STORAGE_KEY] as Record<string, unknown>),
      ).toEqual([draftHoldKey(draftId)]);
      expect(await readHeldDraftIds(after, [draftId])).toEqual(new Set([draftId]));
      // Looked up by instrument id (the draft id itself is the session's stand-in id for a draft).
      expect(await resolveCitationPendingRevalidation(after, [draftId])).toEqual(new Set());
      expect(await readPendingPassageChanges(after, NOW)).toEqual({ kind: 'read', changes: [] });
    });
  });
});

/** The store's methods bound to it, so one can be replaced in a test without losing the rest. */
function bind(store: ObsidianCitationHashStore): CitationHashStore {
  return {
    loadAll: () => store.loadAll(),
    save: (id, record) => store.save(id, record),
    remove: (id) => store.remove(id),
    setPendingRevalidation: (id, hash, since, reason, raisedBy) =>
      store.setPendingRevalidation(id, hash, since, reason, raisedBy),
    isPendingRevalidationCurrent: (id, hash) => store.isPendingRevalidationCurrent(id, hash),
    recordDispatch: (id, hash, at, retry, raisedBy) =>
      store.recordDispatch(id, hash, at, retry, raisedBy),
  };
}
