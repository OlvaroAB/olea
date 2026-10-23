// Scenarios: features/F1-sources.md, block "Feature: D-467 — A lecturer correcting a slide" (ol-zjke;
// [D-625], [D-467], [D-473]). Test id: @auto:plugin/ingestion/slide-correction.ol-zjke.spec
//
// The cue-gated route: a transcript's cue-flagged sentence is judged against the instruments of the
// decks its lecture links, and only an attributable, clear correction holds anything: the instruments
// placed on the corrected claim, and those the judgement could not place (counted apart). The hold
// is the citation anchor's `lecturer-correction` reason, which the session builder and the
// presentation-time check withhold and no later citation pass lifts or overwrites.
//
// Every course, deck, slide, transcript and sentence here is INVENTED ("course A", an invented
// lecturer); nothing comes from a real vault. The judge is a fake returning controlled verdicts.
import {
  appendSuspendRecord,
  citationStorePath,
  type ExtractedUnit,
  enumerateVaultInstruments,
  hashContent,
  type LectureBundle,
  type PersistedKeywordIndex,
  readReviewLogHistory,
  suspendedInstrumentIds,
  type VaultPath,
  type WorkerTaskRequest,
} from 'olea-core';
import { describe, expect, it, vi } from 'vitest';
import { readLectureBundles } from '../../src/ingestion/lecture-links.js';
import { stripQuestionBlocks } from '../../src/ingestion/materiality/citation-material.js';
import { SOURCE_REVISION_REASON } from '../../src/ingestion/materiality/citation-revision-wiring.js';
import {
  applySlideCorrections,
  type LandedTranscript,
  LECTURER_CORRECTION_REASON,
  landedTranscripts,
  type RestsOnCorrectedClaim,
  readSlideCorrectionJudgement,
  SLIDE_CORRECTION_JUDGE_TASK_ID,
  type SlideCorrectionJudgement,
  type SlideCorrectionJudgePort,
  type SlideCorrectionJudgeRequest,
  type SlideCorrectionRouteDeps,
  slideCorrectionFinished,
  slidePassageReader,
  WorkerSlideCorrectionJudge,
  WorkerSlideCorrectionJudgeError,
} from '../../src/ingestion/slide-correction.js';
import { sourceCheckAtPresentation } from '../../src/review/open-session.js';
import {
  harness,
  historyAdded,
  historyOf,
  homeNote,
  MemoryVault,
  seedHistory,
  sidecar,
} from './materiality/transcript-fixtures.ol-egov.141.89.5.43.js';

const DECK = 'Course A/Lecture 3/slides.pdf';
const DECK_HOME = 'Course A/Lecture 3/slides (Olea).md';
const OTHER_DECK = 'Course A/Lecture 4/slides.pdf';
const TRANSCRIPT = 'Course A/Lecture 3/lecture.txt';
const LECTURE_NOTE = 'Course A/Lecture 3/Lecture 3.md';
const deckV1 = new TextEncoder().encode('invented deck bytes, version one');
const deckV2 = new TextEncoder().encode('invented deck bytes, version two');

/** Which slide page each invented instrument cites. */
const PAGES: Readonly<Record<string, number>> = { 'q-claim': 2, 'q-other': 3, 'q-third': 4 };

const CORRECTING_PART =
  'Today we look at the invented sample once more. There is a mistake on slide two: the invented ' +
  'value falls with depth, it does not rise. Now on to the next invented topic.';
const PLAIN_PART =
  'Today we look at the invented sample once more. The invented value is measured at each depth. ' +
  'Now on to the next invented topic.';

async function deckVault(
  ids: readonly string[] = ['q-claim', 'q-other'],
  /** Her earlier reviews (the fixture dates them one day apart, so at most nine). */
  reviewed: readonly string[] = ids,
): Promise<MemoryVault> {
  const vault = new MemoryVault();
  vault.files.set(DECK_HOME, homeNote('Invented slide topic', ids));
  vault.binaries.set(DECK, deckV1);
  const revision = await hashContent(deckV1);
  for (const instrumentId of ids) {
    vault.files.set(
      citationStorePath(instrumentId),
      sidecar({
        instrumentId,
        sourcePath: DECK,
        page: PAGES[instrumentId] ?? Number(instrumentId.replace(/\D/g, '')),
        sourceRevision: revision,
      }),
    );
  }
  await seedHistory(vault, reviewed);
  return vault;
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

/** Her lecture note links the deck and the transcript: one lecture bundle. */
function linkedBundles(): readonly LectureBundle[] {
  return readLectureBundles({
    resolvedLinks: () => new Map([[LECTURE_NOTE, [DECK, TRANSCRIPT]]]),
    frontmatterFor: () => undefined,
  });
}

/** Her lecture note links the transcript to a different lecture's deck only. */
function unrelatedBundles(): readonly LectureBundle[] {
  return readLectureBundles({
    resolvedLinks: () => new Map([['Course A/Lecture 4/Lecture 4.md', [OTHER_DECK]]]),
    frontmatterFor: () => undefined,
  });
}

function transcriptOf(part: string, version = 'invented-transcript-version'): LandedTranscript {
  return { path: TRANSCRIPT, version, parts: [{ ordinal: 1, text: part }] };
}

/** The instrument a candidate's own text names (the invented stems carry `(q-…)`). */
function idInItem(item: string): string {
  return /\((q-[\w-]+)\)/.exec(item)?.[1] ?? 'unknown';
}

const STAMP = { promptVersion: 'slide-correction-invented-v1', modelId: 'invented-model' };

/** A fake judge: the two booleans, and each candidate placed by the instrument its text names. */
function fakeJudge(
  verdict: { readonly attributableToLecturer: boolean; readonly clear: boolean },
  place: (instrumentId: string) => RestsOnCorrectedClaim = (id) =>
    id === 'q-claim' ? 'yes' : id === 'q-third' ? 'unclear' : 'no',
): SlideCorrectionJudgePort & { judge: ReturnType<typeof vi.fn> } {
  return {
    judge: vi.fn(
      async (request: SlideCorrectionJudgeRequest): Promise<SlideCorrectionJudgement> => ({
        ...verdict,
        placements: request.candidates.map((candidate) => place(idInItem(candidate.item))),
        stamp: STAMP,
      }),
    ),
  };
}

function routeDeps(
  vault: MemoryVault,
  store: SlideCorrectionRouteDeps['store'],
  judge: SlideCorrectionJudgePort | null,
  overrides: Partial<SlideCorrectionRouteDeps> = {},
): SlideCorrectionRouteDeps {
  return {
    vault,
    store,
    judge,
    clock: { now: () => 5_000 },
    bundles: linkedBundles,
    slidePassage: slidePassageReader(deckIndex([2, 3, 4])),
    ...overrides,
  };
}

/** The production presentation-time check, over the same store and a fresh vault walk. */
async function atPresentation(
  vault: MemoryVault,
  store: SlideCorrectionRouteDeps['store'],
  ids: readonly string[],
): Promise<Readonly<Record<string, string>>> {
  const { records } = await enumerateVaultInstruments(vault, {
    concepts: { stampConceptKeys: true },
  });
  const check = sourceCheckAtPresentation(
    store,
    async () => suspendedInstrumentIds((await readReviewLogHistory(vault)).entries),
    { vault, recordOf: (id) => records.find((record) => record.instrumentId === id) },
  );
  const out: Record<string, string> = {};
  for (const id of ids) out[id] = await check(id);
  return out;
}

describe('a lecturer correcting a slide ([D-467], [D-625])', () => {
  it('a clear attributable correction withholds the instrument resting on the corrected claim, before its next presentation', async () => {
    const vault = await deckVault();
    const h = harness({ transcriptPartGrain: false });
    await h.pass(vault);
    const history = historyOf(vault);
    const judge = fakeJudge({ attributableToLecturer: true, clear: true });

    const report = await applySlideCorrections(
      routeDeps(vault, h.store, judge),
      transcriptOf(CORRECTING_PART),
    );

    expect(report).toMatchObject({
      cues: 1,
      calls: 1,
      judgedCorrection: 1,
      unresolved: 0,
      heldYes: 1,
      heldUnclear: 0,
      candidatesWithoutPassage: 0,
      anchorsCreated: 0,
    });
    expect(slideCorrectionFinished(report)).toBe(true);
    const anchors = await h.store.loadAll();
    const pending = anchors.get('q-claim')?.pendingRevalidation;
    expect(pending?.reason).toBe(LECTURER_CORRECTION_REASON);
    expect(pending?.raisedBy).toEqual({
      kind: 'model',
      seat: 'candidate',
      taskId: SLIDE_CORRECTION_JUDGE_TASK_ID,
      stamp: STAMP,
    });
    expect(await h.withheld(['q-claim', 'q-other'])).toEqual(new Set(['q-claim']));
    expect((await atPresentation(vault, h.store, ['q-claim']))['q-claim']).toBe('check-failed');
    // Her history is untouched: the hold is a local anchor fact, never a review-log entry.
    expect(historyAdded(history, vault)).toEqual([]);
  });

  it('the rule applies to the affected claim and preserves unaffected material: the other instrument on the same deck is still served', async () => {
    const vault = await deckVault();
    const h = harness({ transcriptPartGrain: false });
    await h.pass(vault);
    const judge = fakeJudge({ attributableToLecturer: true, clear: true });

    await applySlideCorrections(routeDeps(vault, h.store, judge), transcriptOf(CORRECTING_PART));

    expect((await h.store.loadAll()).get('q-other')?.pendingRevalidation).toBeUndefined();
    expect(await atPresentation(vault, h.store, ['q-claim', 'q-other'])).toEqual({
      'q-claim': 'check-failed',
      'q-other': 'clear',
    });
  });

  it('the request carries the part, the sentence offsets, and each candidate as its slide passage and its own text; no path travels', async () => {
    const vault = await deckVault();
    const h = harness({ transcriptPartGrain: false });
    await h.pass(vault);
    const judge = fakeJudge({ attributableToLecturer: true, clear: true });

    await applySlideCorrections(routeDeps(vault, h.store, judge), transcriptOf(CORRECTING_PART));

    expect(judge.judge).toHaveBeenCalledTimes(1);
    const request = judge.judge.mock.calls[0]?.[0] as SlideCorrectionJudgeRequest;
    expect(request.correction.passage).toBe(CORRECTING_PART);
    const { start, end } = request.correction.sentence;
    expect(CORRECTING_PART.slice(start, end)).toBe(
      'There is a mistake on slide two: the invented value falls with depth, it does not rise.',
    );
    expect(request.candidates).toHaveLength(2);
    const byId = new Map(request.candidates.map((c) => [idInItem(c.item), c]));
    expect(byId.get('q-claim')?.slidePassage).toContain('Invented slide 2');
    expect(byId.get('q-other')?.slidePassage).toContain('Invented slide 3');
    expect(byId.get('q-claim')?.item).toMatch(/^Question: .*\nAnswer: Alpha$/);
    const wire = JSON.stringify(request);
    expect(wire).not.toContain('Course A');
    expect(wire).not.toContain('.pdf');
  });

  it('an ambiguous disagreement stays unresolved: nothing is withheld and nothing is reconciled either way', async () => {
    for (const verdict of [
      { attributableToLecturer: true, clear: false },
      { attributableToLecturer: false, clear: true },
    ]) {
      const vault = await deckVault();
      const h = harness({ transcriptPartGrain: false });
      await h.pass(vault);
      const before = await h.store.loadAll();
      // The judgement even places q-claim on the claim; an unresolved verdict still holds nothing.
      const judge = fakeJudge(verdict, () => 'yes');

      const report = await applySlideCorrections(
        routeDeps(vault, h.store, judge),
        transcriptOf(CORRECTING_PART),
      );

      expect(report).toMatchObject({
        cues: 1,
        calls: 1,
        judgedCorrection: 0,
        unresolved: 1,
        heldYes: 0,
        heldUnclear: 0,
      });
      expect(await h.store.loadAll()).toEqual(before);
      expect(await h.withheld(['q-claim', 'q-other'])).toEqual(new Set());
    }
  });

  it('only a sentence the cue flags reaches the model: a transcript with none asks nothing and withholds nothing', async () => {
    const vault = await deckVault();
    const h = harness({ transcriptPartGrain: false });
    await h.pass(vault);
    const judge = fakeJudge({ attributableToLecturer: true, clear: true });
    const bundles = vi.fn(linkedBundles);

    const report = await applySlideCorrections(
      routeDeps(vault, h.store, judge, { bundles }),
      transcriptOf(PLAIN_PART),
    );

    expect(report).toMatchObject({ cues: 0, calls: 0, heldYes: 0, heldUnclear: 0 });
    expect(judge.judge).not.toHaveBeenCalled();
    // No cue: not even her links are read.
    expect(bundles).not.toHaveBeenCalled();
    expect(await h.withheld(['q-claim', 'q-other'])).toEqual(new Set());
  });

  it('a correction is judged only against the decks its lecture links: with none, no judgement is requested and it stays unresolved', async () => {
    const vault = await deckVault();
    const h = harness({ transcriptPartGrain: false });
    await h.pass(vault);
    const judge = fakeJudge({ attributableToLecturer: true, clear: true });

    for (const bundles of [() => [], unrelatedBundles]) {
      const report = await applySlideCorrections(
        routeDeps(vault, h.store, judge, { bundles }),
        transcriptOf(CORRECTING_PART),
      );
      expect(report).toMatchObject({ cues: 1, calls: 0, unresolved: 1, noLinkedDeck: 1 });
    }
    expect(judge.judge).not.toHaveBeenCalled();
    expect(await h.withheld(['q-claim', 'q-other'])).toEqual(new Set());
  });

  it('the hold is the stored lecturer-correction reason: a later pass neither lifts nor overwrites it, through a deck change and its revert', async () => {
    const vault = await deckVault();
    const h = harness({ transcriptPartGrain: false });
    await h.pass(vault);
    await applySlideCorrections(
      routeDeps(vault, h.store, fakeJudge({ attributableToLecturer: true, clear: true })),
      transcriptOf(CORRECTING_PART),
    );
    const held = (await h.store.loadAll()).get('q-claim')?.pendingRevalidation;
    expect(held?.reason).toBe(LECTURER_CORRECTION_REASON);
    const history = historyOf(vault);

    await h.pass(vault);
    expect((await h.store.loadAll()).get('q-claim')?.pendingRevalidation).toEqual(held);

    vault.binaries.set(DECK, deckV2);
    await h.pass(vault);
    const changed = await h.store.loadAll();
    expect(changed.get('q-claim')?.pendingRevalidation).toEqual(held);
    expect(changed.get('q-other')?.pendingRevalidation?.reason).toBe(SOURCE_REVISION_REASON);
    expect(await h.withheld(['q-claim', 'q-other'])).toEqual(new Set(['q-claim', 'q-other']));

    vault.binaries.set(DECK, deckV1);
    await h.pass(vault);
    const reverted = await h.store.loadAll();
    expect(reverted.get('q-claim')?.pendingRevalidation).toEqual(held);
    expect(reverted.get('q-other')?.pendingRevalidation).toBeUndefined();
    expect(await h.withheld(['q-claim', 'q-other'])).toEqual(new Set(['q-claim']));
    expect(await atPresentation(vault, h.store, ['q-claim', 'q-other'])).toEqual({
      'q-claim': 'check-failed',
      'q-other': 'clear',
    });

    // The pass made no judge call, suspension or rewrite for the held instrument.
    expect(h.judge.judge).not.toHaveBeenCalled();
    expect(h.actions.suspend).not.toHaveBeenCalled();
    expect(h.actions.enqueue).not.toHaveBeenCalled();
    expect(historyAdded(history, vault)).toEqual([]);
  });

  it('the same transcript version judged again writes nothing new: the hold keeps its key and its first time', async () => {
    const vault = await deckVault();
    const h = harness({ transcriptPartGrain: false });
    await h.pass(vault);
    let now = 5_000;
    const deps = routeDeps(
      vault,
      h.store,
      fakeJudge({ attributableToLecturer: true, clear: true }),
      {
        clock: { now: () => now },
      },
    );
    await applySlideCorrections(deps, transcriptOf(CORRECTING_PART));
    const first = (await h.store.loadAll()).get('q-claim')?.pendingRevalidation;
    now = 9_000;
    await applySlideCorrections(deps, transcriptOf(CORRECTING_PART));
    expect((await h.store.loadAll()).get('q-claim')?.pendingRevalidation).toEqual(first);
    expect(first?.since).toBe(5_000);
  });

  it('an instrument the judgement cannot place is withheld as well, and the report counts it apart', async () => {
    const vault = await deckVault(['q-claim', 'q-other', 'q-third']);
    const h = harness({ transcriptPartGrain: false });
    await h.pass(vault);

    const report = await applySlideCorrections(
      routeDeps(vault, h.store, fakeJudge({ attributableToLecturer: true, clear: true })),
      transcriptOf(CORRECTING_PART),
    );

    expect(report).toMatchObject({ judgedCorrection: 1, heldYes: 1, heldUnclear: 1 });
    const anchors = await h.store.loadAll();
    expect(anchors.get('q-third')?.pendingRevalidation?.reason).toBe(LECTURER_CORRECTION_REASON);
    expect(anchors.get('q-other')?.pendingRevalidation).toBeUndefined();
    expect(await h.withheld(['q-claim', 'q-other', 'q-third'])).toEqual(
      new Set(['q-claim', 'q-third']),
    );
    expect(await atPresentation(vault, h.store, ['q-claim', 'q-other', 'q-third'])).toEqual({
      'q-claim': 'check-failed',
      'q-other': 'clear',
      'q-third': 'check-failed',
    });
  });

  it('a Worker that is not configured, or a device offline, greys the route out: nothing held, nothing thrown', async () => {
    const vault = await deckVault();
    const h = harness({ transcriptPartGrain: false });
    await h.pass(vault);
    const before = await h.store.loadAll();

    const unconfigured = await applySlideCorrections(
      routeDeps(vault, h.store, null),
      transcriptOf(CORRECTING_PART),
    );
    expect(unconfigured).toMatchObject({ cues: 1, calls: 0, judgeUnavailable: 1, heldYes: 0 });
    expect(slideCorrectionFinished(unconfigured)).toBe(false);

    const judge = fakeJudge({ attributableToLecturer: true, clear: true });
    const offline = await applySlideCorrections(
      routeDeps(vault, h.store, judge, { isOnline: () => false }),
      transcriptOf(CORRECTING_PART),
    );
    expect(offline).toMatchObject({ calls: 0, judgeUnavailable: 1 });
    expect(judge.judge).not.toHaveBeenCalled();

    expect(await h.store.loadAll()).toEqual(before);
    expect(await h.withheld(['q-claim', 'q-other'])).toEqual(new Set());
  });

  it('a configured Worker that fails mid-call holds nothing and does not throw', async () => {
    const vault = await deckVault();
    const h = harness({ transcriptPartGrain: false });
    await h.pass(vault);
    const judge = {
      judge: vi.fn(async () => {
        throw new WorkerSlideCorrectionJudgeError('invented failure');
      }),
    };
    const report = await applySlideCorrections(
      routeDeps(vault, h.store, judge),
      transcriptOf(CORRECTING_PART),
    );
    expect(report).toMatchObject({ calls: 1, callsFailed: 1, heldYes: 0, unresolved: 0 });
    expect(slideCorrectionFinished(report)).toBe(false);
    expect(await h.withheld(['q-claim', 'q-other'])).toEqual(new Set());
  });

  it('an instrument drafted since the last citation pass gets the anchor that pass would write, then the hold, and the next pass keeps both', async () => {
    const vault = await deckVault();
    const h = harness({ transcriptPartGrain: false });

    const report = await applySlideCorrections(
      routeDeps(vault, h.store, fakeJudge({ attributableToLecturer: true, clear: true })),
      transcriptOf(CORRECTING_PART),
    );

    expect(report).toMatchObject({ heldYes: 1, anchorsCreated: 1 });
    const created = (await h.store.loadAll()).get('q-claim');
    expect(created?.sourcePath).toBe(DECK_HOME);
    expect(created?.text).toBe(stripQuestionBlocks(vault.files.get(DECK_HOME) ?? ''));
    expect(created?.pendingRevalidation?.reason).toBe(LECTURER_CORRECTION_REASON);

    await h.pass(vault);
    const after = await h.store.loadAll();
    expect(after.get('q-claim')).toEqual(created);
    // The pass's own first sighting of the unaffected instrument reads the same baseline.
    expect(after.get('q-other')?.text).toBe(created?.text);
    expect(after.get('q-other')?.sourcePath).toBe(created?.sourcePath);
    expect(await h.withheld(['q-claim', 'q-other'])).toEqual(new Set(['q-claim']));
  });

  it('a candidate whose cited slide has no text is counted and not sent; a suspended instrument is not a candidate', async () => {
    const vault = await deckVault(['q-claim', 'q-other', 'q-third']);
    await appendSuspendRecord(
      vault,
      {
        kind: 'suspend',
        timestamp: '2026-10-01T09:00:00Z',
        instrumentId: 'q-third',
        conceptIds: ['invented-concept'],
      },
      { deviceId: 'device-synthetic' },
    );
    const h = harness({ transcriptPartGrain: false });
    await h.pass(vault);
    const judge = fakeJudge({ attributableToLecturer: true, clear: true });

    const report = await applySlideCorrections(
      // Page 3 (q-other's slide) has no text-layer block: a scanned slide.
      routeDeps(vault, h.store, judge, { slidePassage: slidePassageReader(deckIndex([2, 4])) }),
      transcriptOf(CORRECTING_PART),
    );

    expect(report).toMatchObject({ candidatesWithoutPassage: 1, calls: 1, heldYes: 1 });
    const request = judge.judge.mock.calls[0]?.[0] as SlideCorrectionJudgeRequest;
    expect(request.candidates.map((c) => idInItem(c.item))).toEqual(['q-claim']);
    expect((await h.store.loadAll()).get('q-third')?.pendingRevalidation).toBeUndefined();
  });

  it('candidates go in batches of at most 24 per call', async () => {
    const ids = Array.from({ length: 30 }, (_, i) => `q-${i + 1}`);
    const vault = await deckVault(ids, ids.slice(0, 3));
    const h = harness({ transcriptPartGrain: false });
    await h.pass(vault);
    const judge = fakeJudge({ attributableToLecturer: true, clear: true }, (id) =>
      id === 'q-27' ? 'yes' : 'no',
    );

    const report = await applySlideCorrections(
      routeDeps(vault, h.store, judge, {
        slidePassage: slidePassageReader(deckIndex(ids.map((_, i) => i + 1))),
      }),
      transcriptOf(CORRECTING_PART),
    );

    expect(report).toMatchObject({ calls: 2, heldYes: 1, heldUnclear: 0 });
    const sizes = judge.judge.mock.calls.map(
      (call) => (call[0] as SlideCorrectionJudgeRequest).candidates.length,
    );
    expect(sizes).toEqual([24, 6]);
    expect(await h.withheld(ids)).toEqual(new Set(['q-27']));
  });
});

describe('the Worker judgement port (slide-correction.judge.v1)', () => {
  const request: SlideCorrectionJudgeRequest = {
    correction: {
      passage: CORRECTING_PART,
      sentence: {
        start: CORRECTING_PART.indexOf('There is'),
        end: CORRECTING_PART.indexOf('rise.') + 'rise.'.length,
      },
    },
    candidates: [
      { slidePassage: 'Invented slide 2.', item: 'Question: one?\nAnswer: Alpha' },
      { slidePassage: 'Invented slide 3.', item: 'Question: two?\nAnswer: Alpha' },
      { slidePassage: 'Invented slide 4.', item: 'Question: three?\nAnswer: Alpha' },
      { slidePassage: 'Invented slide 5.', item: 'Question: four?\nAnswer: Alpha' },
    ],
  };

  it('sends the fixed envelope and reads every placement, an unplaced, twice-placed or malformed candidate reading unclear', async () => {
    const sent: WorkerTaskRequest[] = [];
    const judge = new WorkerSlideCorrectionJudge({
      transport: {
        send: async (envelope) => {
          sent.push(envelope);
          return {
            ok: true,
            result: {
              attributableToLecturer: true,
              clear: true,
              candidates: [
                { index: 0, restsOnCorrectedClaim: 'yes' },
                { index: 1, restsOnCorrectedClaim: 'no' },
                { index: 1, restsOnCorrectedClaim: 'no' },
                { index: 2, restsOnCorrectedClaim: 'maybe' },
                { index: 9, restsOnCorrectedClaim: 'yes' },
              ],
            },
            stamp: STAMP,
          };
        },
      },
    });

    const judgement = await judge.judge(request);

    expect(sent).toEqual([
      {
        contractVersion: 2,
        taskId: 'slide-correction.judge.v1',
        payload: {
          correction: request.correction,
          candidates: request.candidates,
        },
      },
    ]);
    expect(judgement).toEqual({
      attributableToLecturer: true,
      clear: true,
      placements: ['yes', 'unclear', 'unclear', 'unclear'],
      stamp: STAMP,
    });
  });

  it('a refusal, or a reply without the two booleans, throws; a reply with no stamp reads null', () => {
    expect(() => readSlideCorrectionJudgement({ ok: false, code: 'INVENTED' }, 1)).toThrow(
      WorkerSlideCorrectionJudgeError,
    );
    expect(() => readSlideCorrectionJudgement({ ok: true, result: { clear: true } }, 1)).toThrow(
      WorkerSlideCorrectionJudgeError,
    );
    expect(() => readSlideCorrectionJudgement('not an object', 1)).toThrow(
      WorkerSlideCorrectionJudgeError,
    );
    expect(
      readSlideCorrectionJudgement(
        { ok: true, result: { attributableToLecturer: false, clear: false } },
        2,
      ),
    ).toEqual({
      attributableToLecturer: false,
      clear: false,
      placements: ['unclear', 'unclear'],
      stamp: null,
    });
  });
});

describe('the route inputs', () => {
  it('only transcript parts are read as a landed transcript, with the version the landing named', () => {
    const units: ExtractedUnit[] = [
      {
        text: 'second part',
        provenance: { sourcePath: TRANSCRIPT, location: { page: 2, transcriptPart: {} } },
      },
      {
        text: 'first part',
        provenance: { sourcePath: TRANSCRIPT, location: { page: 1, transcriptPart: {} } },
      },
      { text: 'a slide', provenance: { sourcePath: DECK, location: { page: 1 } } },
    ];
    expect(landedTranscripts(units, new Map([[TRANSCRIPT, 'v-invented']]))).toEqual([
      {
        path: TRANSCRIPT,
        version: 'v-invented',
        parts: [
          { ordinal: 1, text: 'first part' },
          { ordinal: 2, text: 'second part' },
        ],
      },
    ]);
    expect(landedTranscripts(units.slice(2))).toEqual([]);
  });

  it("the slide passage is the cited page's extracted blocks, joined; none for a page or deck the index lacks", () => {
    const reader = slidePassageReader(deckIndex([2, 2, 3]));
    expect(reader(DECK, 2)).toBe(
      'Invented slide 2: the invented value rises with depth (claim 2).\n\n' +
        'Invented slide 2: the invented value rises with depth (claim 2).',
    );
    expect(reader(DECK, 5)).toBeUndefined();
    expect(reader('Course A/elsewhere.pdf' as VaultPath, 2)).toBeUndefined();
    expect(slidePassageReader(null)(DECK, 2)).toBeUndefined();
  });
});
