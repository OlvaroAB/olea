// Scenarios: features/F1-sources.md, "Correction, resegmentation and continuity at part grain"
// (ol-egov.141.89.5.126; David's handback of 2026-10-22, section 2.5 item 2; D-465 item 8, D-467,
// D-567). Test id:
// @auto:plugin/ingestion/materiality/transcript-recut-structure.ol-egov.141.89.5.126.spec
//
// A re-cut that keeps the spoken words but changes the structure the words are grounded in (who
// speaks, whether a claim is endorsed, the order of the parts) is not a free exit. The reader
// parses no speaker label and no endorsement (the label and marker are text inside a part), so a
// label or marker that changes is a word that changed; the cases below pin that every such re-cut
// reaches the judge, while a re-cut that changes nothing but cue boundaries stays a free exit.
// Every transcript is synthetic (invented words, "course A").
import { describe, expect, it } from 'vitest';
import {
  citeTranscriptPart,
  citeWholeTranscript,
  cue,
  type Harness,
  harness,
  historyOf,
  homeNote,
  LECTURE,
  MemoryVault,
  seedHistory,
  spoken,
  transcriptOf,
} from './transcript-fixtures.ol-egov.141.89.5.43.js';

const TRANSCRIPT = 'Course A/Lecture 3/transcript.txt';
const HOME = 'Course A/Lecture 3/transcript (Olea).md';
const PART = 'q-part';
const WHOLE = 'q-whole';
const IDS = [PART, WHOLE] as const;

/** Cue k as the lecturer says it, with a plain label on its line. */
function said(k: number, label: string, marker = ''): string {
  return `${label}: ${marker}${cue(k)}`;
}

/** Cues 0..17; cues 9 to 11 (part 4) are the lecturer's, the rest are labelled alike. */
function labelled(overrides: Record<number, string> = {}): string[] {
  return LECTURE.map((_, k) => overrides[k] ?? said(k, 'Lecturer'));
}

async function seed(cues: readonly string[]): Promise<{ vault: MemoryVault; h: Harness }> {
  const vault = new MemoryVault();
  vault.files.set(TRANSCRIPT, transcriptOf(cues));
  vault.files.set(HOME, homeNote('Invented lecture topic', IDS));
  await citeTranscriptPart(vault, PART, TRANSCRIPT, 4);
  await citeWholeTranscript(vault, WHOLE, TRANSCRIPT);
  await seedHistory(vault, IDS);
  const h = harness({ transcriptPartGrain: true });
  await h.pass(vault);
  expect(h.judge.judge).not.toHaveBeenCalled();
  return { vault, h };
}

/** Part 4's three cues, as one part: the cited part holds cues 9 to 11. */
function partFour(cues: readonly string[]): readonly string[] {
  return cues.slice(9, 12);
}

describe('control: a same-words re-cut with the same speakers, markers and order', () => {
  it('only the cue boundaries move: free exit for both grains, nothing judged, nothing withheld', async () => {
    const cues = labelled();
    const { vault, h } = await seed(cues);
    // Pair every two cues into one paragraph: the same words, labels and order, other part cuts.
    const paired: string[] = [];
    for (let k = 0; k < cues.length; k += 2) paired.push(`${cues[k]}\n${cues[k + 1]}`);
    vault.files.set(TRANSCRIPT, transcriptOf(paired));
    await h.pass(vault);
    expect(h.judge.judge).not.toHaveBeenCalled();
    expect(h.actions.suspend).not.toHaveBeenCalled();
    expect(await h.withheld(IDS)).toEqual(new Set());
  });

  it('a label written with paired emphasis is the same speaker: still a free exit', async () => {
    const cues = labelled();
    const { vault, h } = await seed(cues);
    vault.files.set(
      TRANSCRIPT,
      transcriptOf(cues.map((text) => text.replace(/^Lecturer:/, '**Lecturer:**'))),
    );
    await h.pass(vault);
    expect(h.judge.judge).not.toHaveBeenCalled();
    expect(await h.withheld(IDS)).toEqual(new Set());
  });
});

describe('(a) a changed speaker label on the cited part, the spoken words kept', () => {
  it('the cited part is now the student speaking: judged, the part-named and the whole-transcript questions both withheld', async () => {
    const cues = labelled();
    const { vault, h } = await seed(cues);
    const recut = labelled({ 9: said(9, 'Student') });
    vault.files.set(TRANSCRIPT, transcriptOf(recut));
    await h.pass(vault);
    expect(h.judge.judge).toHaveBeenCalled();
    expect(h.judge.judge.mock.calls.map((call) => call[0]?.currentText)).toEqual(
      expect.arrayContaining([spoken(partFour(recut)), spoken(recut)]),
    );
    expect(await h.withheld(IDS)).toEqual(new Set(IDS));
  });

  it('two cues swap speakers while every word and every label stays in the file: judged', async () => {
    const cues = labelled({ 10: said(10, 'Student') });
    const { vault, h } = await seed(cues);
    // The label now heads the other cue; the multiset of words is unchanged.
    const recut = labelled({ 9: said(9, 'Student') });
    vault.files.set(TRANSCRIPT, transcriptOf(recut));
    await h.pass(vault);
    expect(h.judge.judge).toHaveBeenCalled();
    expect(await h.withheld(IDS)).toEqual(new Set(IDS));
  });
});

describe('(b) a changed endorsement marker on the cited part, the spoken words kept', () => {
  it('"asserted" becomes "quoted, not endorsed" on the cited cue: judged, both questions withheld', async () => {
    const cues = labelled({ 9: said(9, 'Lecturer', '[asserted] ') });
    const { vault, h } = await seed(cues);
    const recut = labelled({ 9: said(9, 'Lecturer', '[quoted, not endorsed] ') });
    vault.files.set(TRANSCRIPT, transcriptOf(recut));
    await h.pass(vault);
    expect(h.judge.judge).toHaveBeenCalled();
    expect(await h.withheld(IDS)).toEqual(new Set(IDS));
  });

  it('a marker written as quotation marks around the cue: judged, both questions withheld', async () => {
    const cues = labelled();
    const { vault, h } = await seed(cues);
    const recut = labelled({ 9: `Lecturer: "${cue(9)}"` });
    vault.files.set(TRANSCRIPT, transcriptOf(recut));
    await h.pass(vault);
    expect(h.judge.judge).toHaveBeenCalled();
    expect(await h.withheld(IDS)).toEqual(new Set(IDS));
  });
});

describe('(c) a changed part order, the spoken words kept', () => {
  /** Parts 2 and 5 exchange places; part 4 (the cited part) is untouched. */
  function reordered(cues: readonly string[]): string[] {
    return [
      ...cues.slice(0, 3),
      ...cues.slice(12, 15),
      ...cues.slice(6, 12),
      ...cues.slice(3, 6),
      ...cues.slice(15),
    ];
  }

  it('whole-transcript citation: the parts come in another order: judged and withheld', async () => {
    const cues = labelled();
    const { vault, h } = await seed(cues);
    vault.files.set(TRANSCRIPT, transcriptOf(reordered(cues)));
    await h.pass(vault);
    expect(h.judge.judge.mock.calls.map((call) => call[0]?.currentText)).toContain(
      spoken(reordered(cues)),
    );
    expect((await h.withheld(IDS)).has(WHOLE)).toBe(true);
  });

  // The anchor of a part-named citation holds that part's text alone (and its digest); the order
  // of the other parts is in no persisted field. Detecting that the cited part now follows other
  // material needs a stored neighbourhood: a new persisted field, which this bead may not add.
  // Asserted as the desired behaviour and expected to fail until a decision gives it a home.
  it.fails('part-named citation: the parts around the cited part come in another order: judged and withheld', async () => {
    const cues = labelled();
    const { vault, h } = await seed(cues);
    // Parts 4 and 5 exchange places: the cited part is intact but follows other material.
    const recut = [
      ...cues.slice(0, 9),
      ...cues.slice(12, 15),
      ...cues.slice(9, 12),
      ...cues.slice(15),
    ];
    vault.files.set(TRANSCRIPT, transcriptOf(recut));
    await h.pass(vault);
    expect((await h.withheld(IDS)).has(PART)).toBe(true);
  });
});
