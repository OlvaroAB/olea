// Scenarios: features/F1-sources.md, "Correction, resegmentation and continuity at part grain",
// the lineage cases (ol-egov.141.89.5.43; D-465 item 8; PERSISTENCE.md 2.2). Test id:
// @auto:plugin/ingestion/materiality/transcript-lineage.ol-egov.141.89.5.43.spec
//
// Continuity across versions comes only from lineage: the same path edited in place, or a rename
// Olea saw (`onSourceRenamed`). Her declaration of lineage has no clause or affordance yet, so none
// is built or tested. A lecture link, equal text in another file, or a file at a new path with the
// old one deleted is never lineage: the instruments are withheld, never healed. Synthetic only.
import { describe, expect, it } from 'vitest';
import {
  citeTranscriptPart,
  cue,
  type Harness,
  harness,
  historyAdded,
  historyOf,
  homeNote,
  LECTURE,
  MemoryVault,
  partCues,
  seedHistory,
  spoken,
  transcriptOf,
} from './transcript-fixtures.ol-egov.141.89.5.43.js';

const TRANSCRIPT = 'Course A/Lecture 3/transcript.txt';
const HOME = 'Course A/Lecture 3/transcript (Olea).md';
const IDS = ['q-four', 'q-two'] as const;

async function seeded(): Promise<{ vault: MemoryVault; h: Harness }> {
  const vault = new MemoryVault();
  vault.files.set(TRANSCRIPT, transcriptOf(LECTURE));
  vault.files.set(HOME, homeNote('Invented lecture topic', IDS));
  await citeTranscriptPart(vault, 'q-four', TRANSCRIPT, 4);
  await citeTranscriptPart(vault, 'q-two', TRANSCRIPT, 2);
  await seedHistory(vault, IDS);
  const h = harness({ transcriptPartGrain: true });
  await h.pass(vault);
  return { vault, h };
}

async function pathsOf(h: Harness): Promise<readonly (string | undefined)[]> {
  const anchors = await h.store.loadAll();
  return IDS.map((id) => anchors.get(id)?.sourcePath);
}

function expectNothingHealedOrJudged(h: Harness): void {
  expect(h.judge.judge).not.toHaveBeenCalled();
  expect(h.actions.onRelocationProposed).not.toHaveBeenCalled();
  expect(h.actions.suspend).not.toHaveBeenCalled();
  expect(h.actions.enqueue).not.toHaveBeenCalled();
}

describe('continuity survives a correction, a move and a rename seen while Olea runs', () => {
  it('one logical source through three revisions; practice on unchanged text stays valid, with no judge call', async () => {
    const { vault, h } = await seeded();
    const history = historyOf(vault);

    // Revision two: edited in place, a cue added outside both cited passages.
    vault.files.set(TRANSCRIPT, transcriptOf([cue(80), ...LECTURE]));
    await h.pass(vault);
    expect(await h.withheld(IDS)).toEqual(new Set());

    // Revision three: renamed.
    const renamed = 'Course A/Lecture 3/lecture three transcript.txt';
    vault.move(TRANSCRIPT, renamed);
    expect(await h.trigger.onSourceRenamed(vault, TRANSCRIPT, renamed)).toBe(2);
    await h.pass(vault);
    expect(await pathsOf(h)).toEqual([renamed, renamed]);
    expect(await h.withheld(IDS)).toEqual(new Set());

    // Then moved to another folder.
    const moved = 'Course A/Transcripts/lecture three transcript.txt';
    vault.move(renamed, moved);
    expect(await h.trigger.onSourceRenamed(vault, renamed, moved)).toBe(2);
    await h.pass(vault);
    expect(await pathsOf(h)).toEqual([moved, moved]);
    expect(await h.withheld(IDS)).toEqual(new Set());
    expect((await h.store.loadAll()).get('q-four')?.text).toBe(spoken(partCues(4)));

    expectNothingHealedOrJudged(h);
    expect(historyAdded(history, vault)).toEqual([]);
  });

  it('a rename keeps a hold the anchor already carried', async () => {
    const { vault, h } = await seeded();
    vault.files.set(TRANSCRIPT, transcriptOf([...LECTURE, ...partCues(4)]));
    await h.pass(vault);
    const renamed = 'Course A/Lecture 3/renamed.txt';
    vault.move(TRANSCRIPT, renamed);
    await h.trigger.onSourceRenamed(vault, TRANSCRIPT, renamed);
    const anchor = (await h.store.loadAll()).get('q-four');
    expect(anchor?.sourcePath).toBe(renamed);
    expect(anchor?.pendingRevalidation?.reason).toBe('passage-ambiguous');
  });

  it('a rename to a file that no longer reads as a transcript moves nothing, and the instruments are withheld', async () => {
    const { vault, h } = await seeded();
    const note = 'Course A/Lecture 3/now a note.md';
    vault.move(TRANSCRIPT, note);
    expect(await h.trigger.onSourceRenamed(vault, TRANSCRIPT, note)).toBe(0);
    await h.pass(vault);
    expect(await h.withheld(IDS)).toEqual(new Set(IDS));
    expectNothingHealedOrJudged(h);
  });
});

describe('a move Olea did not see', () => {
  it('arrives as a delete and a create: withheld before the next presentation, nothing healed onto the new file', async () => {
    const { vault, h } = await seeded();
    const history = historyOf(vault);
    vault.move(TRANSCRIPT, 'Course A/Transcripts/transcript.txt');
    await h.pass(vault);
    expect(await pathsOf(h)).toEqual([TRANSCRIPT, TRANSCRIPT]);
    const anchors = await h.store.loadAll();
    for (const id of IDS) {
      expect(anchors.get(id)?.pendingRevalidation?.reason).toBe('passage-missing');
    }
    expect(await h.withheld(IDS)).toEqual(new Set(IDS));
    expectNothingHealedOrJudged(h);
    expect(historyAdded(history, vault)).toEqual([]);
  });
});

describe('a whole-file replacement', () => {
  it('with lineage (re-exported over the same file, paragraphs cut differently, cited text unchanged): found by text, no judge call', async () => {
    const { vault, h } = await seeded();
    // Every pair of cues merged into one paragraph, and a fix in part 6, which nothing cites.
    const reExport = LECTURE.map((text, k) =>
      k === 16 ? `${text} An added closing remark.` : text,
    );
    const paired: string[] = [];
    for (let k = 0; k < reExport.length; k += 2) {
      paired.push(`${reExport[k]}\n${reExport[k + 1] ?? ''}`.trim());
    }
    vault.files.set(TRANSCRIPT, transcriptOf(paired));
    await h.pass(vault);
    expect(await h.withheld(IDS)).toEqual(new Set());
    expect((await h.store.loadAll()).get('q-two')?.text).toBe(spoken(partCues(2)));
    expectNothingHealedOrJudged(h);
  });

  it('without lineage (same text at a new path, the old file deleted, no rename seen): withheld, never moved onto the new file', async () => {
    const { vault, h } = await seeded();
    vault.files.delete(TRANSCRIPT);
    vault.files.set('Course A/Lecture 3/transcript (re-export).txt', transcriptOf(LECTURE));
    await h.pass(vault);
    expect(await pathsOf(h)).toEqual([TRANSCRIPT, TRANSCRIPT]);
    expect(await h.withheld(IDS)).toEqual(new Set(IDS));
    expectNothingHealedOrJudged(h);
  });

  it('that keeps the old file: the old file’s instruments are unchanged and still served', async () => {
    const { vault, h } = await seeded();
    vault.files.set(
      'Course A/Lecture 3/transcript v2.txt',
      transcriptOf([cue(81), ...LECTURE.slice(0, 9)]),
    );
    await h.pass(vault);
    expect(await pathsOf(h)).toEqual([TRANSCRIPT, TRANSCRIPT]);
    expect(await h.withheld(IDS)).toEqual(new Set());
    expectNothingHealedOrJudged(h);
  });
});

describe('a lecture link is never lineage', () => {
  it('two transcripts linked from one lecture note; the deleted one’s instruments are withheld, never healed onto the other', async () => {
    const { vault, h } = await seeded();
    const other = 'Course A/Lecture 3/transcript (captions).txt';
    vault.files.set(other, transcriptOf(LECTURE));
    vault.files.set(
      'Course A/Lecture 3/Lecture 3.md',
      '# Lecture 3\n\n[[transcript.txt]] and [[transcript (captions).txt]] with [[slides.pdf]].\n',
    );
    await h.pass(vault);
    expect(await h.withheld(IDS)).toEqual(new Set());

    vault.files.delete(TRANSCRIPT);
    await h.pass(vault);
    expect(await pathsOf(h)).toEqual([TRANSCRIPT, TRANSCRIPT]);
    expect(await h.withheld(IDS)).toEqual(new Set(IDS));
    expectNothingHealedOrJudged(h);
  });
});
