// `ol-egov.141.89.5.97` ([D-567], [D-543], [D-508], [D-465], [D-455], [D-426]): lecture-transcript
// citations followed with part grain switched on in production. Through the production
// construction: `buildCitationRevisionWiring` with `transcriptPartGrain: true` (as `main.ts`
// builds it), the composition's withholding (`resolveCitationPendingRevalidation`) and the session's
// presentation-time check (`sourceCheckAtPresentation`, as `review/open-session.ts` builds it). A
// question drafted from one part is followed at that part; one drafted from several passages names
// no part and the whole transcript is protected, as a note is. Every transcript, course and
// sentence is invented ("course A"); nothing comes from a real vault. No Worker is called.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  type EnqueueInput,
  enumerateVaultInstruments,
  type InstrumentRevisionJobPayload,
  type RevisionJudgeInput,
  type RevisionJudgeVerdict,
  readReviewLogHistory,
  suspendedInstrumentIds,
} from 'olea-core';
import { describe, expect, it, vi } from 'vitest';
import { ObsidianCitationHashStore } from '../../../src/ingestion/materiality/citation-hash-store.js';
import { buildCitationRevisionWiring } from '../../../src/ingestion/materiality/citation-revision-wiring.js';
import { sourceCheckAtPresentation } from '../../../src/review/open-session.js';
import { resolveCitationPendingRevalidation } from '../../../src/session-builder/provider.js';
import {
  bytesHashOf,
  citeTranscriptPart,
  citeWholeTranscript,
  cue,
  FakeDataHost,
  historyAdded,
  historyOf,
  homeNote,
  inventedWord,
  LECTURE,
  MemoryVault,
  partCues,
  seedHistory,
  spoken,
  transcriptOf,
} from './transcript-fixtures.ol-egov.141.89.5.43.js';

const TRANSCRIPT = 'Course A/Lecture 3/transcript.txt';
const HOME = 'Course A/Lecture 3/transcript (Olea).md';

/** The production trigger, the composition's withholding and the session's presentation check, over one store. */
function production(verdict: RevisionJudgeVerdict = { material: true, reason: 'scripted' }) {
  const store = new ObsidianCitationHashStore(new FakeDataHost());
  const judge = { judge: vi.fn(async (_input: RevisionJudgeInput) => verdict) };
  const trigger = buildCitationRevisionWiring({
    store,
    judge,
    clock: { now: () => 1_000 },
    transcriptPartGrain: true,
  });
  let passVault: MemoryVault | undefined;
  const actions = {
    enqueue: vi.fn(async (_input: EnqueueInput) => undefined),
    suspend: vi.fn(async (instrumentId: string, conceptIds: readonly string[]) => {
      if (passVault === undefined) return;
      const { appendSuspendRecord } = await import('olea-core');
      await appendSuspendRecord(
        passVault,
        {
          kind: 'suspend',
          timestamp: '2026-10-01T09:00:00Z',
          instrumentId,
          conceptIds: conceptIds.length > 0 ? [...conceptIds] : ['invented-concept'],
        },
        { deviceId: 'device-synthetic' },
      );
    }),
  };
  return {
    store,
    judge,
    trigger,
    actions,
    pass: (vault: MemoryVault) => {
      passVault = vault;
      return trigger.tick(vault, actions);
    },
    /**
     * The ids she is shown now: not withheld by composition, and `'clear'` at presentation (the
     * session's check, reading the vault fresh, as `open-session.ts` wires it).
     */
    presented: async (vault: MemoryVault, ids: readonly string[]): Promise<ReadonlySet<string>> => {
      const withheld = await resolveCitationPendingRevalidation(store, ids);
      const { records } = await enumerateVaultInstruments(vault, {
        concepts: { stampConceptKeys: true },
      });
      const check = sourceCheckAtPresentation(
        store,
        async () => suspendedInstrumentIds((await readReviewLogHistory(vault)).entries),
        {
          vault,
          recordOf: (instrumentId) =>
            records.find((record) => record.instrumentId === instrumentId),
        },
      );
      const shown = new Set<string>();
      for (const id of ids) {
        if (!withheld.has(id) && (await check(id)) === 'clear') shown.add(id);
      }
      return shown;
    },
  };
}

/** q-four drafted from part 4 alone, q-two from part 2 alone, q-all from several passages. */
async function lectureVault(): Promise<MemoryVault> {
  const vault = new MemoryVault();
  vault.files.set(TRANSCRIPT, transcriptOf(LECTURE));
  vault.files.set(HOME, homeNote('Invented lecture topic', ['q-four', 'q-two', 'q-all']));
  await citeTranscriptPart(vault, 'q-four', TRANSCRIPT, 4);
  await citeTranscriptPart(vault, 'q-two', TRANSCRIPT, 2);
  await citeWholeTranscript(vault, 'q-all', TRANSCRIPT);
  await seedHistory(vault, ['q-four', 'q-two', 'q-all']);
  return vault;
}

const ALL = ['q-four', 'q-two', 'q-all'] as const;

async function seeded() {
  const vault = await lectureVault();
  const p = production();
  await p.pass(vault);
  return { vault, p };
}

describe('first sighting: presented when the transcript is the version drafted from (ol-egov.141.89.5.97)', () => {
  it('a question drafted from one part, and one drafted from several passages, are presented before and after the first pass', async () => {
    const vault = await lectureVault();
    const p = production();
    // Before any pass (no anchor yet): the file is the version each citation records.
    expect(await p.presented(vault, ALL)).toEqual(new Set(ALL));
    await p.pass(vault);
    const anchors = await p.store.loadAll();
    expect(anchors.get('q-four')?.text).toBe(spoken(partCues(4)));
    expect(anchors.get('q-four')?.passageDigest).toBeDefined();
    // The several-passage question names no part: the whole transcript is its anchor, no digest.
    expect(anchors.get('q-all')?.text).toBe(spoken(LECTURE));
    expect(anchors.get('q-all')?.passageDigest).toBeUndefined();
    expect(await p.presented(vault, ALL)).toEqual(new Set(ALL));
    expect(p.judge.judge).not.toHaveBeenCalled();
  });

  it('a transcript changed between drafting and first sighting withholds both kinds, by the recorded version, never by a part number', async () => {
    const vault = await lectureVault();
    vault.files.set(TRANSCRIPT, transcriptOf([cue(90), ...LECTURE]));
    const p = production();
    expect(await p.presented(vault, ALL)).toEqual(new Set());
    await p.pass(vault);
    expect(await p.presented(vault, ALL)).toEqual(new Set());
    expect(p.judge.judge).not.toHaveBeenCalled();
  });

  it('a declared-Markdown transcript is presented on first sighting and stays presented, not withheld for good', async () => {
    const md = 'Course A/Lecture 3/transcript.md';
    const declared = (cues: readonly string[]): string =>
      `---\nrole: lecture transcript\n---\n\n${transcriptOf(cues)}`;
    const vault = new MemoryVault();
    vault.files.set(md, declared(LECTURE));
    vault.files.set(HOME, homeNote('Invented lecture topic', ['q-md-part', 'q-md-all']));
    await citeTranscriptPart(vault, 'q-md-part', md, 4);
    await citeWholeTranscript(vault, 'q-md-all', md);
    const p = production();
    const ids = ['q-md-part', 'q-md-all'];
    expect(await p.presented(vault, ids)).toEqual(new Set(ids));
    await p.pass(vault);
    await p.pass(vault);
    expect(await p.presented(vault, ids)).toEqual(new Set(ids));
    // A correction inside part 4 reaches the judge as that region, for the part-named question;
    // the whole-transcript question is withheld too, since its whole transcript changed.
    const cues = [...LECTURE];
    cues[9] = (cues[9] as string).replace(inventedWord(9 * 40 + 1 + 17), inventedWord(4020));
    vault.files.set(md, declared(cues));
    expect(await p.presented(vault, ids)).toEqual(new Set());
    await p.pass(vault);
    expect(p.judge.judge.mock.calls.map((call) => call[0]?.currentText)).toEqual(
      expect.arrayContaining([spoken(cues.slice(9, 12)), spoken(cues)]),
    );
  });
});

describe('a citation that names no part protects the whole transcript ([D-567], [D-543])', () => {
  it('any content change, even outside every cited part, withholds it before its next presentation and sends it down the rewrite route; the part-named questions are untouched', async () => {
    const { vault, p } = await seeded();
    const history = historyOf(vault);
    // A cue appended after the last part: no part-named question cites it.
    const cues = [...LECTURE, cue(91)];
    vault.files.set(TRANSCRIPT, transcriptOf(cues));
    // Before any pass: the session's own check sets it aside; the part-named ones are presented.
    expect(await p.presented(vault, ALL)).toEqual(new Set(['q-four', 'q-two']));

    await p.pass(vault);
    expect(p.judge.judge).toHaveBeenCalledTimes(1);
    expect(p.judge.judge.mock.calls[0]?.[0]).toEqual({
      previousText: spoken(LECTURE),
      currentText: spoken(cues),
    });
    expect(p.actions.suspend.mock.calls.map((call) => call[0])).toEqual(['q-all']);
    const job = p.actions.enqueue.mock.calls[0]?.[0]?.payload as InstrumentRevisionJobPayload;
    expect(job.predecessorInstrumentId).toBe('q-all');
    expect(job.newPassageText).toBe(spoken(cues));
    expect(job.sourceRevision).toBe(await bytesHashOf(transcriptOf(cues)));
    expect(await p.presented(vault, ALL)).toEqual(new Set(['q-four', 'q-two']));
    expect(historyAdded(history, vault)).toEqual(['q-all']);
  });

  it('an immaterial verdict still withholds and rewrites rather than restores ([D-508])', async () => {
    const vault = await lectureVault();
    const p = production({ material: false, reason: 'scripted' });
    await p.pass(vault);
    vault.files.set(TRANSCRIPT, transcriptOf([...LECTURE, cue(92)]));
    await p.pass(vault);
    expect(p.actions.suspend.mock.calls.map((call) => call[0])).toEqual(['q-all']);
    expect(await p.presented(vault, ['q-all'])).toEqual(new Set());
  });

  it('the same words re-cut (a cue split in two, two merged): unchanged, no judge call, still presented', async () => {
    const { vault, p } = await seeded();
    const [first, second, third] = partCues(4) as [string, string, string];
    const cut = first.indexOf(' So a ');
    vault.files.set(
      TRANSCRIPT,
      transcriptOf([
        ...LECTURE.slice(0, 9),
        first.slice(0, cut),
        first.slice(cut + 1),
        `${second}\n${third}`,
        ...LECTURE.slice(12),
      ]),
    );
    await p.pass(vault);
    expect(p.judge.judge).not.toHaveBeenCalled();
    expect(await p.presented(vault, ALL)).toEqual(new Set(ALL));
  });
});

describe('the part-named dev cases of ol-egov.141.89.5.43, through the production construction and the presentation check', () => {
  it('a cue inserted outside the cited parts: found by text, no judge call; the part-named questions are presented and her history is unchanged', async () => {
    const { vault, p } = await seeded();
    const history = historyOf(vault);
    vault.files.set(
      TRANSCRIPT,
      transcriptOf([...LECTURE.slice(0, 3), cue(93), ...LECTURE.slice(3)]),
    );
    await p.pass(vault);
    expect(p.judge.judge).toHaveBeenCalledTimes(1); // the whole-transcript question only
    expect(p.judge.judge.mock.calls[0]?.[0]?.previousText).toBe(spoken(LECTURE));
    expect(await p.presented(vault, ['q-four', 'q-two'])).toEqual(new Set(['q-four', 'q-two']));
    expect(historyAdded(history, vault)).toEqual(['q-all']);
  });

  it('a cue inserted inside a cited part: set aside at once, then one judge call with that part alone; the other part-named question is presented', async () => {
    const { vault, p } = await seeded();
    const [first, second, third] = partCues(4) as [string, string, string];
    const cues = [...LECTURE.slice(0, 9), first, cue(94), second, third, ...LECTURE.slice(12)];
    vault.files.set(TRANSCRIPT, transcriptOf(cues));
    expect(await p.presented(vault, ['q-four', 'q-two'])).toEqual(new Set(['q-two']));
    await p.pass(vault);
    expect(p.judge.judge.mock.calls.map((call) => call[0])).toContainEqual({
      previousText: spoken(partCues(4)),
      currentText: spoken([first, cue(94), second, third]),
    });
    expect(p.actions.suspend.mock.calls.map((call) => call[0]).sort()).toEqual(['q-all', 'q-four']);
    expect(await p.presented(vault, ['q-four', 'q-two'])).toEqual(new Set(['q-two']));
  });

  it('a term correction in part 4: judged as that region; the question on part 2 is still presented', async () => {
    const { vault, p } = await seeded();
    const history = historyOf(vault);
    const cues = [...LECTURE];
    cues[10] = (cues[10] as string).replace(inventedWord(10 * 40 + 3 + 17), inventedWord(4021));
    vault.files.set(TRANSCRIPT, transcriptOf(cues));
    expect(await p.presented(vault, ['q-four', 'q-two'])).toEqual(new Set(['q-two']));
    await p.pass(vault);
    expect(p.judge.judge.mock.calls.map((call) => call[0])).toContainEqual({
      previousText: spoken(partCues(4)),
      currentText: spoken(cues.slice(9, 12)),
    });
    expect(await p.presented(vault, ['q-four', 'q-two'])).toEqual(new Set(['q-two']));
    expect([...historyAdded(history, vault)].sort()).toEqual(['q-all', 'q-four']);
  });

  it('a replacement with lineage (re-exported over the same file, cut differently, cited text unchanged): found by text, presented, no judge call for the part', async () => {
    const { vault, p } = await seeded();
    // Same words, new paragraphing: two cues merged at the start.
    vault.files.set(
      TRANSCRIPT,
      transcriptOf([`${LECTURE[0]}\n${LECTURE[1]}`, ...LECTURE.slice(2)]),
    );
    await p.pass(vault);
    expect(p.judge.judge).not.toHaveBeenCalled();
    expect(await p.presented(vault, ALL)).toEqual(new Set(ALL));
  });

  it('a replacement without lineage (a new path, the old file deleted, nothing declared): withheld, never moved', async () => {
    const { vault, p } = await seeded();
    vault.move(TRANSCRIPT, 'Course A/Lecture 3/transcript v2.txt');
    await p.pass(vault);
    expect(await p.presented(vault, ALL)).toEqual(new Set());
    expect((await p.store.loadAll()).get('q-four')?.sourcePath).toBe(TRANSCRIPT);
    expect(p.judge.judge).not.toHaveBeenCalled();
  });

  it('a move Olea saw (the rename handler calls onSourceRenamed): followed to the new path and presented, no judge call', async () => {
    const { vault, p } = await seeded();
    const moved = 'Course A/Lecture 3/moved/transcript.txt';
    vault.move(TRANSCRIPT, moved);
    expect(await p.trigger.onSourceRenamed(vault, TRANSCRIPT, moved)).toBe(3);
    expect(await p.presented(vault, ALL)).toEqual(new Set(ALL));
    await p.pass(vault);
    expect(p.judge.judge).not.toHaveBeenCalled();
    expect(await p.presented(vault, ALL)).toEqual(new Set(ALL));
  });

  it('a move Olea did not see (a delete and a create): withheld, not healed', async () => {
    const { vault, p } = await seeded();
    vault.move(TRANSCRIPT, 'Course A/Lecture 3/moved/transcript.txt');
    expect(await p.presented(vault, ALL)).toEqual(new Set());
    await p.pass(vault);
    expect(await p.presented(vault, ALL)).toEqual(new Set());
  });
});

// `main.ts` cannot be imported under Vitest (see `transcript-wiring.ol-egov.141.89.8.55.spec.ts`), so
// its wiring is read from its source with prose removed.
describe('main.ts switches part grain on and follows a rename it sees (ol-egov.141.89.5.97)', () => {
  const main = readFileSync(fileURLToPath(new URL('../../../src/main.ts', import.meta.url)), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\/.*$/gm, '');

  it('buildCitationRevisionWiring is constructed with transcriptPartGrain: true', () => {
    const start = main.indexOf('this.citationRevision = buildCitationRevisionWiring({');
    expect(start).toBeGreaterThan(-1);
    const end = main.indexOf('\n    });', start);
    expect(main.slice(start, end)).toContain('transcriptPartGrain: true');
  });

  it('one rename handler calls both onSourceRenamed and processedRevisionFeed.renamed with the old and new path', () => {
    const start = main.indexOf(
      "if (event.kind !== 'rename' || event.oldPath === undefined) return;",
    );
    expect(start).toBeGreaterThan(-1);
    const handler = main.slice(start, main.indexOf('}),', start));
    expect(handler).toContain('this.citationRevision?.onSourceRenamed(vault, oldPath, newPath)');
    expect(handler).toContain('processedRevisionFeed.renamed(oldPath, newPath)');
  });
});
