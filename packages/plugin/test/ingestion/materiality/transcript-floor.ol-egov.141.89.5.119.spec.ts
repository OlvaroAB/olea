// Scenarios: features/F1-sources.md, "C5.3 / [D-578] — Transcripts relocate at a floor of their own,
// and a part that cannot be relocated is rewritten" (ol-egov.141.89.5.119). Test id:
// @auto:plugin/ingestion/materiality/transcript-floor.ol-egov.141.89.5.119.spec
//
// (1) A lecture transcript's cited part is found again at 0.55 of its distinct words, not one third;
// (2) a note passage keeps one third; (3) a question whose cited transcript part cannot be
// relocated (no candidate, or more than one) is withheld, then rewritten from the current version
// by the route of a whole-transcript question, and the old question is never presented again
// whatever the materiality read answers. Every transcript is synthetic ("course A"); nothing comes
// from a real vault. No Worker is called.
import {
  digestPassage,
  type EnqueueInput,
  enumerateVaultInstruments,
  type InstrumentRevisionJobPayload,
  PASSAGE_RESEMBLANCE_FLOOR,
  type RevisionJudgeInput,
  type RevisionJudgePort,
  type RevisionJudgeVerdict,
  readReviewLogHistory,
  suspendedInstrumentIds,
  TRANSCRIPT_RESEMBLANCE_FLOOR,
} from 'olea-core';
import { describe, expect, it, vi } from 'vitest';
import { ObsidianCitationHashStore } from '../../../src/ingestion/materiality/citation-hash-store.js';
import { buildCitationRevisionWiring } from '../../../src/ingestion/materiality/citation-revision-wiring.js';
import { resolveAnchoredPassage } from '../../../src/ingestion/materiality/passage-grain.js';
import { resolveTranscriptPassage } from '../../../src/ingestion/materiality/transcript-grain.js';
import { sourceCheckAtPresentation } from '../../../src/review/open-session.js';
import { resolveCitationPendingRevalidation } from '../../../src/session-builder/provider.js';
import {
  bytesHashOf,
  citeTranscriptPart,
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
function production(judge: RevisionJudgePort | null) {
  const store = new ObsidianCitationHashStore(new FakeDataHost());
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
    trigger,
    actions,
    pass: (vault: MemoryVault) => {
      passVault = vault;
      return trigger.tick(vault, actions);
    },
    /** The ids she is shown now: not withheld by composition, and clear at presentation. */
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

function scripted(verdict: RevisionJudgeVerdict) {
  return { judge: vi.fn(async (_input: RevisionJudgeInput) => verdict) };
}

async function lectureVault(): Promise<MemoryVault> {
  const vault = new MemoryVault();
  vault.files.set(TRANSCRIPT, transcriptOf(LECTURE));
  vault.files.set(HOME, homeNote('Invented lecture topic', ['q-four', 'q-two']));
  await citeTranscriptPart(vault, 'q-four', TRANSCRIPT, 4);
  await citeTranscriptPart(vault, 'q-two', TRANSCRIPT, 2);
  await seedHistory(vault, ['q-four', 'q-two']);
  return vault;
}

describe('the declared floors', () => {
  it('a transcript part resembles at 0.55; a note passage at one third', () => {
    expect(TRANSCRIPT_RESEMBLANCE_FLOOR).toBe(0.55);
    expect(PASSAGE_RESEMBLANCE_FLOOR).toBeCloseTo(1 / 3, 10);
  });
});

describe('a corrected word inside a cited part is relocated and judged, not withheld', () => {
  // A cited part of one cue: about half its distinct words are the glue of speech, which recur in
  // every window of the lecture (more than a third, less than 0.55 of the part's words).
  it('resolves to the one changed region', () => {
    const cues = [...LECTURE];
    cues[7] = (cues[7] as string).replace(inventedWord(7 * 40 + 5 + 17), inventedWord(4004));
    const stream = spoken(cues).split(' ');
    expect(resolveTranscriptPassage(spoken([LECTURE[7] as string]), stream)).toEqual({
      kind: 'changed',
      text: spoken([cues[7] as string]),
    });
  });

  it('through the citation pass: the changed region reaches the judge and the hold is not an unresolved-passage hold', async () => {
    // Each part is one paragraph of a cue said twice (940 characters, so three never share a part).
    const long = (k: number): string => `${cue(k)} ${cue(k)}`;
    const cues = Array.from({ length: 6 }, (_, k) => long(k));
    const vault = new MemoryVault();
    vault.files.set(TRANSCRIPT, transcriptOf(cues));
    vault.files.set(HOME, homeNote('Invented lecture topic', ['q-three']));
    await citeTranscriptPart(vault, 'q-three', TRANSCRIPT, 3);
    const judge = scripted({ material: true, reason: 'scripted' });
    const p = production(judge);
    await p.pass(vault);
    expect((await p.store.loadAll()).get('q-three')?.text).toBe(spoken([cues[2] as string]));
    const word = inventedWord(2 * 40 + 5 + 17);
    const corrected = [...cues];
    corrected[2] = (cues[2] as string).replaceAll(word, inventedWord(4005));
    vault.files.set(TRANSCRIPT, transcriptOf(corrected));
    await p.pass(vault);
    expect(judge.judge).toHaveBeenCalledTimes(1);
    expect(judge.judge.mock.calls[0]?.[0]).toEqual({
      previousText: spoken([cues[2] as string]),
      currentText: spoken([corrected[2] as string]),
    });
    const reason = (await p.store.loadAll()).get('q-three')?.pendingRevalidation?.reason;
    expect(String(reason)).not.toMatch(/^passage-/);
  });
});

describe('a note passage keeps the one-third floor', () => {
  it('a segment holding about half the passage’s words still counts as a candidate region', async () => {
    const passage = 'The centrifuge must be balanced before every run above two thousand rpm.';
    const edited = 'The centrifuge must be balanced before every run above three thousand rpm.';
    // 6 of the passage's 12 distinct words: above a third, below 0.55.
    const half = 'The centrifuge must be balanced before use.';
    const files: Record<string, string> = { 'A.md': `${edited}\n\n${half}\n` };
    const notes = {
      exists: async (path: string) => files[path] !== undefined,
      material: async (path: string) => files[path] as string,
      markdownPaths: async () => Object.keys(files),
    };
    const resolved = await resolveAnchoredPassage(
      {
        text: passage,
        passageDigest: await digestPassage(passage),
        anchorPath: 'A.md',
        citedPath: 'A.md',
      },
      notes,
    );
    expect(resolved).toEqual({ kind: 'unresolved', reason: 'ambiguous' });
  });
});

/** The ways a cited part cannot be relocated in the new version. */
const CANNOT_RELOCATE: ReadonlyArray<{ name: string; versionOf: () => string }> = [
  {
    name: 'its correspondence is not unique (the cited text now stands twice)',
    versionOf: () => transcriptOf([...LECTURE, ...partCues(4)]),
  },
  {
    name: 'there is none (the part is replaced by unrelated speech)',
    versionOf: () =>
      transcriptOf([...LECTURE.slice(0, 9), cue(80), cue(81), cue(82), ...LECTURE.slice(12)]),
  },
];

const VERDICTS: ReadonlyArray<{ name: string; judge: () => RevisionJudgePort | null }> = [
  { name: 'changed', judge: () => scripted({ material: true, reason: 'scripted' }) },
  { name: 'unchanged', judge: () => scripted({ material: false, reason: 'scripted' }) },
  {
    name: 'uncertain (the read fails)',
    judge: () => ({
      judge: vi.fn(async () => {
        throw new Error('scripted failure');
      }),
    }),
  },
  { name: 'unavailable (no judge)', judge: () => null },
];

describe('a part-named question whose part cannot be relocated is rewritten', () => {
  for (const how of CANNOT_RELOCATE) {
    describe(how.name, () => {
      for (const verdict of VERDICTS) {
        it(`withheld, a successor drafted from the current version, never presented again; the read answers: ${verdict.name}`, async () => {
          const vault = await lectureVault();
          const read = verdict.judge();
          const p = production(read);
          await p.pass(vault);
          const history = historyOf(vault);
          const next = how.versionOf();
          vault.files.set(TRANSCRIPT, next);

          // Before the pass: the session's own check already sets it aside; the other is served.
          expect(await p.presented(vault, ['q-four', 'q-two'])).toEqual(new Set(['q-two']));

          await p.pass(vault);
          await p.pass(vault);
          await p.pass(vault);

          // The read is never what decides this: nothing of the cited part is known to judge.
          if (read !== null)
            expect((read as { judge: ReturnType<typeof vi.fn> }).judge).not.toHaveBeenCalled();
          expect(p.actions.suspend.mock.calls.map((call) => call[0])).toEqual(['q-four']);
          expect(p.actions.enqueue).toHaveBeenCalledTimes(1);
          const job = p.actions.enqueue.mock.calls[0]?.[0]?.payload as InstrumentRevisionJobPayload;
          expect(job.predecessorInstrumentId).toBe('q-four');
          expect(job.sourceRevision).toBe(await bytesHashOf(next));
          expect(job.newPassageText).toBe(
            next
              .split('\n')
              .filter((line) => line.trim() !== '')
              .join(' ')
              .replace(/\s+/g, ' ')
              .trim(),
          );
          // The old question is never presented again, and the unrelated one still is.
          expect(await p.presented(vault, ['q-four', 'q-two'])).toEqual(new Set(['q-two']));
          // Her earlier reviews are unchanged; only the suspension is added.
          expect(historyAdded(history, vault)).toEqual(['q-four']);
        });
      }
    });
  }

  it('the old text coming back after the rewrite does not put the old question back', async () => {
    const vault = await lectureVault();
    const p = production(scripted({ material: false, reason: 'scripted' }));
    await p.pass(vault);
    vault.files.set(TRANSCRIPT, transcriptOf([...LECTURE, ...partCues(4)]));
    await p.pass(vault);
    vault.files.set(TRANSCRIPT, transcriptOf(LECTURE));
    await p.pass(vault);
    await p.pass(vault);
    expect(await p.presented(vault, ['q-four'])).toEqual(new Set());
    expect(p.actions.enqueue).toHaveBeenCalledTimes(1);
  });

  it('a transcript that cannot be read at all is held, not rewritten: there is no current version to draft from', async () => {
    const vault = await lectureVault();
    const p = production(scripted({ material: true, reason: 'scripted' }));
    await p.pass(vault);
    vault.files.delete(TRANSCRIPT);
    await p.pass(vault);
    expect(p.actions.enqueue).not.toHaveBeenCalled();
    expect(await p.presented(vault, ['q-four'])).toEqual(new Set());
  });

  it('a failed enqueue keeps the question withheld and is retried on the next pass', async () => {
    const vault = await lectureVault();
    const p = production(scripted({ material: true, reason: 'scripted' }));
    await p.pass(vault);
    vault.files.set(TRANSCRIPT, transcriptOf([...LECTURE, ...partCues(4)]));
    p.actions.enqueue.mockRejectedValueOnce(new Error('scripted queue failure'));
    await p.pass(vault);
    expect(p.actions.suspend).not.toHaveBeenCalled();
    expect(await p.presented(vault, ['q-four'])).toEqual(new Set());
    await p.pass(vault);
    expect(p.actions.suspend.mock.calls.map((call) => call[0])).toEqual(['q-four']);
    expect(await p.presented(vault, ['q-four'])).toEqual(new Set());
  });
});
