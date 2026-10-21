// Scenarios: features/F1-sources.md, "Correction, resegmentation and continuity at part grain"
// (ol-egov.141.89.5.43; D-465 item 8, D-293). Test id:
// @auto:plugin/ingestion/materiality/transcript-part-grain.ol-egov.141.89.5.43.spec
//
// The citation pass with transcript part grain on: a cited transcript passage is found again by its
// text alone, a changed region (and only it) goes to the materiality judge, an ambiguous
// correspondence is withheld before the next presentation, a part number is used only in the
// version it was cited from, and unrelated instruments and her history are untouched in every case.
// Every transcript is synthetic (invented words, "course A"); nothing comes from a real vault.
import { readTranscriptText } from 'olea-core';
import { describe, expect, it } from 'vitest';
import {
  readTranscriptVersion,
  resolveTranscriptPassage,
  transcriptAnchorStandsUnchanged,
} from '../../../src/ingestion/materiality/transcript-grain.js';
import {
  citeTranscriptPart,
  cue,
  type Harness,
  harness,
  historyAdded,
  historyOf,
  homeNote,
  inventedWord,
  LECTURE,
  MemoryVault,
  partCues,
  seedHistory,
  sidecar,
  spoken,
  transcriptOf,
} from './transcript-fixtures.ol-egov.141.89.5.43.js';

const TRANSCRIPT = 'Course A/Lecture 3/transcript.txt';
const HOME = 'Course A/Lecture 3/transcript (Olea).md';
const IDS = ['q-four', 'q-two'] as const;

/** q-four cites part 4, q-two cites part 2, both drafted from the transcript as it stands now. */
async function lectureVault(cues: readonly string[] = LECTURE): Promise<MemoryVault> {
  const vault = new MemoryVault();
  vault.files.set(TRANSCRIPT, transcriptOf(cues));
  vault.files.set(HOME, homeNote('Invented lecture topic', IDS));
  await citeTranscriptPart(vault, 'q-four', TRANSCRIPT, 4);
  await citeTranscriptPart(vault, 'q-two', TRANSCRIPT, 2);
  await seedHistory(vault, IDS);
  return vault;
}

async function seeded(): Promise<{ vault: MemoryVault; h: Harness }> {
  const vault = await lectureVault();
  const h = harness({ transcriptPartGrain: true });
  await h.pass(vault);
  return { vault, h };
}

async function anchorText(h: Harness, id: string): Promise<string | undefined> {
  return (await h.store.loadAll()).get(id)?.text;
}

describe('the synthetic lecture is cut as the tests assume', () => {
  it('six parts of three cues each; part 4 holds cues 9 to 11', () => {
    const read = readTranscriptText(transcriptOf(LECTURE), 'plain-text');
    if (!read.ok) throw new Error('fixture does not read');
    expect(read.parts).toHaveLength(6);
    expect(spoken([read.parts[3]?.text ?? ''])).toBe(spoken(partCues(4)));
  });
});

describe('first sighting: a part number is read only in the version it was cited from', () => {
  it('the drafted version seeds each anchor with its part text; nothing is withheld', async () => {
    const { h } = await seeded();
    expect(await anchorText(h, 'q-four')).toBe(spoken(partCues(4)));
    expect(await anchorText(h, 'q-two')).toBe(spoken(partCues(2)));
    expect(await h.withheld(IDS)).toEqual(new Set());
    expect(h.judge.judge).not.toHaveBeenCalled();
  });

  it('a transcript changed since drafting gives nothing by number: withheld, then seeded once the drafted bytes are back', async () => {
    const vault = await lectureVault();
    const drafted = vault.files.get(TRANSCRIPT) as string;
    // A cue inserted at the start shifts every part: "part 4" now holds other text.
    vault.files.set(TRANSCRIPT, transcriptOf([cue(90), ...LECTURE]));
    const h = harness({ transcriptPartGrain: true });
    await h.pass(vault);
    const anchors = await h.store.loadAll();
    expect(anchors.get('q-four')?.text).toBe('');
    expect(anchors.get('q-four')?.pendingRevalidation?.reason).toBe('passage-missing');
    expect(await h.withheld(IDS)).toEqual(new Set(IDS));
    expect(h.judge.judge).not.toHaveBeenCalled();

    vault.files.set(TRANSCRIPT, drafted);
    await h.pass(vault);
    expect(await anchorText(h, 'q-four')).toBe(spoken(partCues(4)));
    expect(await h.withheld(IDS)).toEqual(new Set());
  });

  it('a citation that records no transcript version is withheld, never seeded by its number', async () => {
    const vault = await lectureVault();
    vault.files.set(
      '.olea/citations/q-four.json',
      sidecar({ instrumentId: 'q-four', sourcePath: TRANSCRIPT, page: 4 }),
    );
    const h = harness({ transcriptPartGrain: true });
    await h.pass(vault);
    expect(await anchorText(h, 'q-four')).toBe('');
    expect(await h.withheld(['q-four'])).toEqual(new Set(['q-four']));
    expect(await h.withheld(['q-two'])).toEqual(new Set());
  });
});

describe('a cue inserted into a transcript', () => {
  it('outside the cited passages: both found by their text, no judge call, both served, history unchanged', async () => {
    const { vault, h } = await seeded();
    const history = historyOf(vault);
    // Between part 1 and part 2: every later part boundary moves.
    vault.files.set(
      TRANSCRIPT,
      transcriptOf([...LECTURE.slice(0, 3), cue(91), ...LECTURE.slice(3)]),
    );
    const before = vault.files.get(TRANSCRIPT);
    await h.pass(vault);
    expect(h.judge.judge).not.toHaveBeenCalled();
    expect(await anchorText(h, 'q-four')).toBe(spoken(partCues(4)));
    expect(await anchorText(h, 'q-two')).toBe(spoken(partCues(2)));
    expect(await h.withheld(IDS)).toEqual(new Set());
    expect(h.actions.suspend).not.toHaveBeenCalled();
    expect(h.actions.enqueue).not.toHaveBeenCalled();
    expect(historyAdded(history, vault)).toEqual([]);
    expect(vault.files.get(TRANSCRIPT)).toBe(before);
  });

  it('inside a cited passage: one judge call with that passage alone, old against new; only that instrument is suspended', async () => {
    const { vault, h } = await seeded();
    const history = historyOf(vault);
    const [first, second, third] = partCues(4) as [string, string, string];
    vault.files.set(
      TRANSCRIPT,
      transcriptOf([...LECTURE.slice(0, 9), first, cue(92), second, third, ...LECTURE.slice(12)]),
    );
    await h.pass(vault);

    expect(h.judge.judge).toHaveBeenCalledTimes(1);
    expect(h.judge.judge.mock.calls[0]?.[0]).toEqual({
      previousText: spoken(partCues(4)),
      currentText: spoken([first, cue(92), second, third]),
    });
    expect(h.actions.suspend).toHaveBeenCalledTimes(1);
    expect(h.actions.suspend.mock.calls[0]?.[0]).toBe('q-four');
    expect(h.actions.enqueue).toHaveBeenCalledTimes(1);
    expect(await h.withheld(IDS)).toEqual(new Set(['q-four']));
    expect(historyAdded(history, vault)).toEqual(['q-four']);
  });
});

describe('a term correction', () => {
  const corrected = (): string[] => {
    const cues = [...LECTURE];
    const original = inventedWord(10 * 40 + 3 + 17);
    cues[10] = (cues[10] as string).replace(original, inventedWord(4000));
    return cues;
  };

  it('reaches the judge as one changed region, old against new, and nothing else of the transcript', async () => {
    const { vault, h } = await seeded();
    const history = historyOf(vault);
    const cues = corrected();
    vault.files.set(TRANSCRIPT, transcriptOf(cues));
    await h.pass(vault);

    expect(h.judge.judge).toHaveBeenCalledTimes(1);
    expect(h.judge.judge.mock.calls[0]?.[0]).toEqual({
      previousText: spoken(partCues(4)),
      currentText: spoken(cues.slice(9, 12)),
    });
    // The instrument on the unchanged part: no judge call, no hold, served.
    expect(await h.withheld(['q-two'])).toEqual(new Set());
    expect(h.actions.suspend.mock.calls.map((call) => call[0])).toEqual(['q-four']);
    expect(historyAdded(history, vault)).toEqual(['q-four']);
  });

  it('an immaterial verdict still rewrites rather than restores ([D-508]); the other instrument is untouched', async () => {
    const vault = await lectureVault();
    const h = harness({ transcriptPartGrain: true, verdict: { material: false, reason: 'x' } });
    await h.pass(vault);
    vault.files.set(TRANSCRIPT, transcriptOf(corrected()));
    await h.pass(vault);
    expect(h.judge.judge).toHaveBeenCalledTimes(1);
    expect(h.actions.suspend.mock.calls.map((call) => call[0])).toEqual(['q-four']);
    expect(await h.withheld(IDS)).toEqual(new Set(['q-four']));
  });
});

describe('resegmentation', () => {
  it('a cue split in two and two others merged: found by text, no judge call, dependants valid', async () => {
    const { vault, h } = await seeded();
    const [first, second, third] = partCues(4) as [string, string, string];
    const cut = first.indexOf(' So a ');
    const split = [first.slice(0, cut), first.slice(cut + 1)];
    const merged = `${second}\n${third}`;
    vault.files.set(
      TRANSCRIPT,
      transcriptOf([...LECTURE.slice(0, 9), ...split, merged, ...LECTURE.slice(12)]),
    );
    await h.pass(vault);
    expect(h.judge.judge).not.toHaveBeenCalled();
    expect(await h.withheld(IDS)).toEqual(new Set());
    expect(await anchorText(h, 'q-four')).toBe(spoken(partCues(4)));
  });
});

describe('a displayed part label is never identity', () => {
  it('"part 3" of two revisions holds different text; only the text decides', async () => {
    const vault = await lectureVault();
    await citeTranscriptPart(vault, 'q-three', TRANSCRIPT, 3);
    vault.files.set(HOME, homeNote('Invented lecture topic', [...IDS, 'q-three']));
    const h = harness({ transcriptPartGrain: true });
    await h.pass(vault);
    const partThreeBefore = await anchorText(h, 'q-three');

    // Revision two opens with a new part of three cues: every part number moves by one.
    vault.files.set(TRANSCRIPT, transcriptOf([cue(93), cue(94), cue(95), ...LECTURE]));
    const revisionTwo = await readTranscriptVersion(vault, TRANSCRIPT);
    if (revisionTwo.kind !== 'read') throw new Error('revision two does not read');
    expect(revisionTwo.version.parts[2]?.spoken).not.toBe(partThreeBefore);

    await h.pass(vault);
    expect(h.judge.judge).not.toHaveBeenCalled();
    expect(await anchorText(h, 'q-three')).toBe(partThreeBefore);
    expect(await h.withheld([...IDS, 'q-three'])).toEqual(new Set());
  });
});

describe('an ambiguous correspondence is withheld, never guessed', () => {
  it('the cited text now stands twice: withheld before the next presentation, nothing judged', async () => {
    const { vault, h } = await seeded();
    vault.files.set(TRANSCRIPT, transcriptOf([...LECTURE, ...partCues(4)]));
    await h.pass(vault);
    expect(h.judge.judge).not.toHaveBeenCalled();
    expect((await h.store.loadAll()).get('q-four')?.pendingRevalidation?.reason).toBe(
      'passage-ambiguous',
    );
    expect(await h.withheld(IDS)).toEqual(new Set(['q-four']));
    expect(h.actions.suspend).not.toHaveBeenCalled();
  });

  it('an edited passage that two regions resemble (a recap reuses its words): withheld, nothing judged', async () => {
    const { vault, h } = await seeded();
    const cues = [...LECTURE];
    cues[10] = (cues[10] as string).replace(inventedWord(10 * 40 + 3 + 17), inventedWord(4001));
    // The lecturer recaps the first cue of part 4 at the end.
    vault.files.set(TRANSCRIPT, transcriptOf([...cues, cue(96), partCues(4)[0] as string]));
    await h.pass(vault);
    expect(h.judge.judge).not.toHaveBeenCalled();
    expect((await h.store.loadAll()).get('q-four')?.pendingRevalidation?.reason).toBe(
      'passage-ambiguous',
    );
    expect(await h.withheld(IDS)).toEqual(new Set(['q-four']));
  });

  it('a passage found again unchanged lifts its own hold', async () => {
    const { vault, h } = await seeded();
    vault.files.set(TRANSCRIPT, transcriptOf([...LECTURE, ...partCues(4)]));
    await h.pass(vault);
    expect(await h.withheld(['q-four'])).toEqual(new Set(['q-four']));
    vault.files.set(TRANSCRIPT, transcriptOf(LECTURE));
    await h.pass(vault);
    expect(await h.withheld(['q-four'])).toEqual(new Set());
  });
});

describe('an unrelated instrument and her history are untouched by a correction', () => {
  it('the other instrument is still served, her reviews are byte-identical, and only the corrected one is suspended', async () => {
    const { vault, h } = await seeded();
    const history = historyOf(vault);
    const cues = [...LECTURE];
    cues[11] = (cues[11] as string).replace(inventedWord(11 * 40 + 30 + 17), inventedWord(4002));
    vault.files.set(TRANSCRIPT, transcriptOf(cues));
    await h.pass(vault);
    await h.pass(vault);
    expect(await h.withheld(['q-two'])).toEqual(new Set());
    expect(h.actions.suspend.mock.calls.map((call) => call[0])).toEqual(['q-four']);
    expect(h.actions.enqueue).toHaveBeenCalledTimes(1);
    expect(historyAdded(history, vault)).toEqual(['q-four']);
  });
});

describe('a declared-Markdown transcript is followed at part grain; an undeclared note is not', () => {
  const MD = 'Course A/Lecture 3/transcript.md';
  const declared = (cues: readonly string[]): string =>
    `---\nrole: lecture transcript\n---\n\n${transcriptOf(cues)}`;

  it('a term correction in a declared transcript reaches the judge as the one changed region', async () => {
    const vault = new MemoryVault();
    vault.files.set(MD, declared(LECTURE));
    vault.files.set(HOME, homeNote('Invented lecture topic', ['q-md']));
    await citeTranscriptPart(vault, 'q-md', MD, 4);
    const h = harness({ transcriptPartGrain: true });
    await h.pass(vault);
    expect(await anchorText(h, 'q-md')).toBe(spoken(partCues(4)));
    const cues = [...LECTURE];
    cues[9] = (cues[9] as string).replace(inventedWord(9 * 40 + 1 + 17), inventedWord(4003));
    vault.files.set(MD, declared(cues));
    await h.pass(vault);
    expect(h.judge.judge).toHaveBeenCalledTimes(1);
    expect(h.judge.judge.mock.calls[0]?.[0]?.currentText).toBe(spoken(cues.slice(9, 12)));
  });

  it('an undeclared Markdown note keeps the ordinary note handling', async () => {
    const vault = new MemoryVault();
    vault.files.set(MD, transcriptOf(LECTURE));
    vault.files.set(HOME, homeNote('Invented lecture topic', ['q-md']));
    await citeTranscriptPart(vault, 'q-md', MD, 4);
    const h = harness({ transcriptPartGrain: true });
    await h.pass(vault);
    // The whole note is the anchor, as for any note of hers without a passage digest.
    expect(await anchorText(h, 'q-md')).toBe(transcriptOf(LECTURE));
  });
});

describe('with part grain off (production today), a transcript citation keeps its current handling', () => {
  it('a plain-text transcript still takes the bytes path', async () => {
    const vault = await lectureVault();
    const h = harness({ transcriptPartGrain: false });
    await h.pass(vault);
    vault.files.set(
      TRANSCRIPT,
      transcriptOf([...LECTURE.slice(0, 3), cue(97), ...LECTURE.slice(3)]),
    );
    await h.pass(vault);
    const anchors = await h.store.loadAll();
    expect(anchors.get('q-four')?.sourcePath).toBe(HOME);
    expect(anchors.get('q-four')?.pendingRevalidation?.reason).toBe('source-revision-changed');
    expect(await h.trigger.onSourceRenamed(vault, TRANSCRIPT, 'Course A/x.txt')).toBe(0);
  });
});

describe('the reader the presentation-time check would share', () => {
  it('stands unchanged only when the passage is there, exactly and once', async () => {
    const vault = await lectureVault();
    const anchor = { sourcePath: TRANSCRIPT, text: spoken(partCues(4)) };
    expect(await transcriptAnchorStandsUnchanged(vault, anchor)).toBe(true);
    vault.files.set(TRANSCRIPT, transcriptOf([...LECTURE, ...partCues(4)]));
    expect(await transcriptAnchorStandsUnchanged(vault, anchor)).toBe(false);
    vault.files.delete(TRANSCRIPT);
    expect(await transcriptAnchorStandsUnchanged(vault, anchor)).toBe(false);
  });

  it('resolves by words, never by where part boundaries fall', () => {
    const words = spoken(LECTURE).split(' ');
    expect(resolveTranscriptPassage(spoken(partCues(4)), words).kind).toBe('present');
  });

  it('a passage that resembles every window only through the glue of speech is ambiguous, never matched', () => {
    // One short cue: half its distinct words are glue words, so every window of an unrelated
    // lecture clears the one-third floor, as one stream-long region. Not localised: withheld.
    const words = spoken(LECTURE).split(' ');
    expect(resolveTranscriptPassage(spoken([cue(98)]), words)).toEqual({
      kind: 'unresolved',
      reason: 'ambiguous',
    });
    // Nothing shared at all: missing.
    expect(resolveTranscriptPassage('zzz yyy xxx www', words)).toEqual({
      kind: 'unresolved',
      reason: 'missing',
    });
  });

  it('the floor’s cost: an edited passage mostly made of words the whole stream shares is withheld, not judged', () => {
    // Synthetic sweep (one word changed): a one-cue passage, 49% of whose distinct words recur
    // throughout the lecture, is withheld; two cues (32%) and more are judged as their one region.
    // More withholding, never a wrong match (PERSISTENCE.md 2.5); a different floor for
    // transcripts would be a threshold change, through a decision.
    const cues = [...LECTURE];
    cues[7] = (cues[7] as string).replace(inventedWord(7 * 40 + 5 + 17), inventedWord(4004));
    const stream = spoken(cues).split(' ');
    expect(resolveTranscriptPassage(spoken([LECTURE[7] as string]), stream)).toEqual({
      kind: 'unresolved',
      reason: 'ambiguous',
    });
    expect(resolveTranscriptPassage(spoken(LECTURE.slice(6, 8)), stream)).toEqual({
      kind: 'changed',
      text: spoken(cues.slice(6, 8)),
    });
  });
});
