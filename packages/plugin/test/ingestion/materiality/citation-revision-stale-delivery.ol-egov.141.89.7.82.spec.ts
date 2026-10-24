/**
 * `ol-egov.141.89.7.82` ([D-515], [D-518]; sheet v59, "Image-page revision digest", Accept): with
 * the vision page runner's revision digest switched on, a question drafted from an image page is
 * shown while the file is unchanged and held when it changes, and a stale delivery (a reading of
 * older bytes landing after the file changed) never restores an older question's eligibility.
 *
 * Composed as main.ts composes it (`../vision-digest-on-harness.ol-egov.141.89.7.82.ts`): the real
 * extraction and vision runners built by `buildIngestionRunner`, `onUnitsLanded` handing each
 * delivery that carries a digest to the real `CitationRevisionTrigger`, and the real suspend port.
 * What she is shown is read with the checks as they ship: `review/open-session.ts`
 * sourceCheckAtPresentation (a materialised question) and draftSourceCheckAtPresentation (a pending
 * draft), and accept through `generation/accept.ts` (whose materialiser runs
 * `materialize-mcq.ts` assertCitedSourceUnchanged). A question drafted from a delivery is drafted by
 * the real generation sweep (`generation/pipeline.ts` runGenerationSweep) from the units and digests
 * main.ts hands it, and a rewrite's successor by the real revision job; only the Worker's drafting
 * reply is faked. Every string and byte is invented (INV-3).
 */
import {
  type ConceptRecord,
  enumerateVaultInstruments,
  hashContent,
  readReviewLogHistory,
  suspendedInstrumentIds,
} from 'olea-core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createDraftAcceptPort } from '../../../src/generation/accept.js';
import {
  createVaultDraftCacheStore,
  type DraftCacheStore,
} from '../../../src/generation/cache-store.js';
import { StaleSourceRevisionError } from '../../../src/generation/materialize-mcq.js';
import { runGenerationSweep } from '../../../src/generation/pipeline.js';
import { runInstrumentRevisionJob } from '../../../src/generation/revision-job-runner.js';
import type { DraftRecord } from '../../../src/generation/types.js';
import type { DraftQuizCardsDeps } from '../../../src/retrieval/draft-quiz-cards.js';
import {
  draftSourceCheckAtPresentation,
  sourceCheckAtPresentation,
} from '../../../src/review/open-session.js';
import { currentInputNotes } from '../../generation/input-notes-fixture.js';
import {
  COURSE,
  type Composition,
  compose,
  DEVICE,
  DOC,
  heldIds,
  type Landing,
  NOW,
  pagesOf,
  pdfBytes,
  rewrites,
} from '../vision-digest-on-harness.ol-egov.141.89.7.82.js';

/** Page 1 is read from its text layer; page 2 has none, so it is read from its image. */
const V0 = pdfBytes(['Synthetic heath handout, page one, first draft', '']);
const V1 = pdfBytes(['Synthetic heath handout, page one, second draft', '']);
const V2 = pdfBytes(['Synthetic heath handout, page one, third draft', '']);
const READING_V0 = 'Synthetic figure: a heath transect, a year before the fire.';
const READING_V1 = 'Synthetic figure: a heath transect, before the fire.';
const READING_V2 = 'Synthetic figure: a heath transect, two winters after the fire.';

function draftReply(conceptName: string) {
  return {
    status: 'drafted' as const,
    request: { courseCode: COURSE, conceptName, sourceChunks: ['synthetic chunk'] },
    response: {
      ok: true as const,
      stamp: { contractVersion: 1, promptVersion: '1.0.0', modelId: 'test-model' },
      result: {
        questions: [
          {
            stem: `Which synthetic stage does the figure show for ${conceptName}?`,
            correctAnswer: 'Regrowth',
            distractors: ['Ignition', 'Dormancy', 'Flooding'],
            feedback: 'Synthetic feedback.',
          },
        ],
      },
    },
  };
}

/** What the generation sweep drafts from one delivery, as main.ts hands it that delivery. */
async function sweepDraft(
  run: Composition,
  landing: Landing | undefined,
  conceptName: string,
): Promise<{ cache: DraftCacheStore; draft: DraftRecord }> {
  const cache = createVaultDraftCacheStore(run.vault);
  const concept: ConceptRecord = {
    key: `k-${conceptName}`,
    name: conceptName,
    tier: 2,
    courses: [COURSE],
    sourcePaths: [],
  };
  await runGenerationSweep(landing?.units ?? [], {
    vault: run.vault,
    cache,
    draftDeps: {} as never,
    listConceptsForCourse: async () => [concept],
    // `ol-egov.141.89.2.39` ([D-628]): the call reports the note it drew from, as a production one does.
    draftForConcept: async () =>
      ({
        ...draftReply(conceptName),
        inputNotes: await currentInputNotes(run.vault, DOC),
      }) as never,
    now: () => NOW,
    ...(landing?.revisions !== undefined ? { sourceRevisions: landing.revisions } : {}),
  });
  const draft = (await cache.listPending()).find((record) => record.conceptName === conceptName);
  if (draft === undefined) throw new Error('the sweep drafted nothing');
  return { cache, draft };
}

/** The revision job draining the successor the rewrite enqueued for `predecessor`. */
async function successorDraft(run: Composition, predecessor: string): Promise<DraftRecord> {
  const input = run.enqueued.find(
    (entry) =>
      (entry.payload as { predecessorInstrumentId?: string }).predecessorInstrumentId ===
      predecessor,
  );
  if (input === undefined) throw new Error('no successor was enqueued');
  const cache = createVaultDraftCacheStore(run.vault);
  await runInstrumentRevisionJob(
    {
      vault: run.vault,
      cache,
      draftDeps: () =>
        ({
          transport: { send: async () => draftReply('successor').response },
        }) as unknown as DraftQuizCardsDeps,
      // `[D-628]`: retrieval here is a double, so no note beyond the rewritten passage's own.
      draftForConcept: async () => ({ ...draftReply('successor'), inputNotes: [] }) as never,
      now: () => NOW,
    },
    input.payload as never,
  );
  const draft = (await cache.listPending()).find(
    (record) => record.predecessorInstrumentId === predecessor,
  );
  if (draft === undefined) throw new Error('the revision job drafted nothing');
  return draft;
}

let events = 0;
function acceptPort(run: Composition) {
  return createDraftAcceptPort({
    vault: run.vault,
    cache: createVaultDraftCacheStore(run.vault),
    deviceId: DEVICE,
    now: () => NOW,
    generateEventId: () => `event-${++events}`,
  });
}

/** Accepts a pending draft as she would; the materialised question's id. */
async function accept(run: Composition, draft: DraftRecord): Promise<string> {
  return (await acceptPort(run).accept(draft.draftId, 'accepted')).instrumentId;
}

/** Whether a pending draft is shown, by the presentation check as it ships. */
async function draftShown(run: Composition, draft: DraftRecord): Promise<string> {
  return draftSourceCheckAtPresentation(run.vault, [draft])(draft.draftId);
}

/** Whether a materialised question is shown, composed as `openReviewSession` composes the check. */
async function shown(run: Composition, instrumentId: string): Promise<string> {
  const records = (
    await enumerateVaultInstruments(run.vault, { concepts: { stampConceptKeys: true } })
  ).records;
  const check = sourceCheckAtPresentation(
    run.citationStore,
    async () => suspendedInstrumentIds((await readReviewLogHistory(run.vault)).entries),
    {
      vault: run.vault,
      recordOf: (id) => records.find((record) => record.instrumentId === id),
    },
  );
  return check(instrumentId);
}

function imageLanding(run: Composition): Landing | undefined {
  return run.landings.filter((landing) => pagesOf(landing).join() === '2').at(-1);
}

beforeEach(() => {
  // The rewrite counts a cited page with no text yet in a log line; counts only, never content.
  vi.spyOn(console, 'info').mockImplementation(() => {});
});
afterEach(() => {
  vi.restoreAllMocks();
});

describe('[D-515] ruled: a question drafted from an image page carries the file version it was drafted from', () => {
  it('is shown while the file is unchanged, held when it changes, and rewritten from the new reading', async () => {
    const d1 = await hashContent(V1);
    const d2 = await hashContent(V2);
    const run = await compose(V1, { registered: false });
    run.readings.set(d1, READING_V1);
    run.readings.set(d2, READING_V2);

    await run.deliver('doc-v1');
    expect(imageLanding(run)?.revisions?.get(DOC)).toBe(d1);
    const { draft } = await sweepDraft(run, imageLanding(run), 'Synthetic heath succession');
    expect(draft.sourceCitation).toMatchObject({ sourcePath: DOC, page: 2, sourceRevision: d1 });
    expect(await draftShown(run, draft)).toBe('clear');
    const question = await accept(run, draft);

    await run.pass();
    expect(await heldIds(run)).toEqual([]);
    expect(await shown(run, question)).toBe('clear');
    await run.pass();
    expect(await shown(run, question)).toBe('clear');

    // The file changes: the next pass holds the question, and it is not shown.
    run.vault.put(DOC, V2);
    await run.pass();
    expect(await heldIds(run)).toEqual([question]);
    expect(await shown(run, question)).toBe('check-failed');

    // The changed file's image page lands: the question is rewritten from the new reading.
    await run.deliver('doc-v2');
    expect(Object.fromEntries(rewrites(run))).toEqual({
      [question]: { text: READING_V2, revision: d2 },
    });
    expect(await shown(run, question)).toBe('suspended');
  });
});

describe('sheet v59: a stale delivery never restores an older question’s eligibility', () => {
  it('a reading of the older version landing after the newer version’s rewrite leaves the rewritten question the one shown', async () => {
    const d1 = await hashContent(V1);
    const d2 = await hashContent(V2);
    const run = await compose(V1, { registered: false });
    run.readings.set(d1, READING_V1);
    run.readings.set(d2, READING_V2);

    // A question drafted from version 1's image page, accepted and shown.
    await run.deliver('doc-v1');
    const { draft } = await sweepDraft(run, imageLanding(run), 'Synthetic heath succession');
    const predecessor = await accept(run, draft);
    await run.pass();
    expect(await shown(run, predecessor)).toBe('clear');

    // A second read of version 1 (a catch-up, or a note embedding the file): its text page lands
    // and its image page's reading is under way.
    await run.enqueueSource('doc-v1-again');
    expect(await run.engine.tick()).toMatchObject({ kind: 'ran', outcome: 'done' });
    const hold = run.holdNextVision();
    const staleTick = run.engine.tick();
    await hold.entered;

    // The file changes; the pass holds the question; version 2 is read and the question rewritten.
    run.vault.put(DOC, V2);
    await run.pass();
    expect(await heldIds(run)).toEqual([predecessor]);
    await run.deliver('doc-v2');
    expect(Object.fromEntries(rewrites(run))).toEqual({
      [predecessor]: { text: READING_V2, revision: d2 },
    });
    const successorRecord = await successorDraft(run, predecessor);
    expect(successorRecord.sourceCitation).toMatchObject({
      sourcePath: DOC,
      page: 2,
      sourceRevision: d2,
    });
    expect(await draftShown(run, successorRecord)).toBe('clear');
    const successor = await accept(run, successorRecord);
    await run.pass();
    expect(await shown(run, successor)).toBe('clear');
    expect(await shown(run, predecessor)).toBe('suspended');
    const heldBefore = await heldIds(run);

    // The older reading lands now, with the digest of the bytes it read.
    hold.release();
    expect(await staleTick).toMatchObject({ kind: 'ran', outcome: 'done' });
    const stale = imageLanding(run);
    expect(stale?.revisions?.get(DOC)).toBe(d1);
    expect(stale?.units.map((unit) => unit.text)).toEqual([READING_V1]);

    // The rewrite: nothing rewritten again, no hold raised or lifted, before or after a pass.
    expect(run.enqueued).toHaveLength(1);
    expect(await heldIds(run)).toEqual(heldBefore);
    await run.pass();
    await run.pass();
    expect(run.enqueued).toHaveLength(1);
    expect(await heldIds(run)).toEqual(heldBefore);
    // What she is shown: the successor, never the predecessor.
    expect(await shown(run, successor)).toBe('clear');
    expect(await shown(run, predecessor)).toBe('suspended');

    // The sweep main.ts hands the same delivery: its question records version 1's bytes, so it is
    // not shown and is refused at accept while the file holds version 2.
    const { draft: staleDraft } = await sweepDraft(run, stale, 'Synthetic heath fire');
    expect(staleDraft.sourceCitation).toMatchObject({ page: 2, sourceRevision: d1 });
    expect(await draftShown(run, staleDraft)).toBe('check-failed');
    await expect(accept(run, staleDraft)).rejects.toThrow(StaleSourceRevisionError);
  });

  it('a successor drafted from the older version’s text is neither shown nor accepted while the file holds newer bytes', async () => {
    const d0 = await hashContent(V0);
    const d1 = await hashContent(V1);
    const d2 = await hashContent(V2);
    const run = await compose(V0, { registered: false });
    run.readings.set(d0, READING_V0);
    run.readings.set(d1, READING_V1);
    run.readings.set(d2, READING_V2);

    // A question drafted from version 0's image page, accepted; the file changes to version 1 and
    // the pass holds the question for version 1's bytes.
    await run.deliver('doc-v0');
    const { draft } = await sweepDraft(run, imageLanding(run), 'Synthetic heath succession');
    const predecessor = await accept(run, draft);
    await run.pass();
    run.vault.put(DOC, V1);
    await run.pass();
    expect(await heldIds(run)).toEqual([predecessor]);

    // Version 1's text page lands (its image page has no text yet, so the question stays held), and
    // its image page's reading is under way when the file changes again, before any pass sees it.
    await run.enqueueSource('doc-v1');
    expect(await run.engine.tick()).toMatchObject({ kind: 'ran', outcome: 'done' });
    expect(run.enqueued).toHaveLength(0);
    const hold = run.holdNextVision();
    const staleTick = run.engine.tick();
    await hold.entered;
    run.vault.put(DOC, V2);
    hold.release();
    expect(await staleTick).toMatchObject({ kind: 'ran', outcome: 'done' });
    expect(imageLanding(run)?.revisions?.get(DOC)).toBe(d1);

    // The hold was raised for version 1's bytes, so the question is rewritten from version 1's
    // reading, and the successor records version 1's bytes.
    expect(Object.fromEntries(rewrites(run))).toEqual({
      [predecessor]: { text: READING_V1, revision: d1 },
    });
    const successorRecord = await successorDraft(run, predecessor);
    expect(successorRecord.sourceCitation).toMatchObject({ page: 2, sourceRevision: d1 });

    // While the file holds version 2: not shown, refused at accept, and the predecessor stays out.
    expect(await draftShown(run, successorRecord)).toBe('check-failed');
    await expect(accept(run, successorRecord)).rejects.toThrow(StaleSourceRevisionError);
    expect(await shown(run, predecessor)).toBe('suspended');
    await run.pass();
    expect(await draftShown(run, successorRecord)).toBe('check-failed');
    expect(await shown(run, predecessor)).toBe('suspended');
    // Nothing older is restored by a later pass either: no second rewrite from older text.
    expect(run.enqueued).toHaveLength(1);
    expect(await hashContent(await run.vault.readBinary(DOC))).toBe(d2);
  });
});
