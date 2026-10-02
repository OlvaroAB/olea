/**
 * F8.5 / D-465: one lecture is one teaching event; repetition carries no weight
 * (`ol-egov.141.89.3.43`). Synthetic data only (INV-3).
 */

import { describe, expect, it } from 'vitest';
import { CONCEPT_SIZE_SECONDS_MULTIPLIER } from '../study-session/build.js';
import { readConcepts } from './read.js';
import { readConceptExtent, readConceptSize } from './size.js';
import {
  explanation,
  MemoryVault,
  NOTE_PATH,
  oneConceptReader,
  partProvenance,
  SLIDES_PATH,
  slideProvenance,
  TRANSCRIPT_PATH,
} from './transcript-fixtures.ol-egov.141.89.3.43.js';

const BUDGET = { maxPassages: 500 };

async function readFrom(transcript: string) {
  const result = await readConcepts(
    new MemoryVault({ [TRANSCRIPT_PATH]: transcript }),
    oneConceptReader,
    {
      budget: BUDGET,
    },
  );
  if (result.outcome !== 'read') throw new Error('expected a read');
  const concept = result.concepts.find((c) => c.name === 'Osmotic balance');
  if (concept === undefined) throw new Error('expected the concept');
  return { concept, passages: concept.alsoIn.length + 1 };
}

/** What a session slot costs and what size reads, the two things allocation takes from size. */
function allocationOf(c: { size: { band: 'fine' | 'coarse' } }): number {
  return CONCEPT_SIZE_SECONDS_MULTIPLIER[c.size.band];
}

describe('F8.5: repetition carries no weight', () => {
  it('re-cutting the cues changes nothing', async () => {
    const paragraphs = Array.from({ length: 6 }, (_, i) => explanation(`topic ${i}`));
    const fine = await readFrom(paragraphs.join('\n\n'));
    // The same words, each paragraph broken in three: the cue boundaries fall elsewhere.
    const recut = await readFrom(
      paragraphs
        .flatMap((p) => {
          const a = p.indexOf('. ', Math.floor(p.length / 3)) + 1;
          const b = p.indexOf('. ', Math.floor((2 * p.length) / 3)) + 1;
          return [p.slice(0, a), p.slice(a + 1, b), p.slice(b + 1)];
        })
        .join('\n\n'),
    );
    expect(fine.passages).not.toBe(recut.passages);
    expect(recut.concept.size).toEqual(fine.concept.size);
    expect(allocationOf(recut.concept)).toBe(allocationOf(fine.concept));
  });

  it('a duplicated explanation changes nothing, and no concept becomes coarse by passage count', async () => {
    const once = await readFrom(explanation('first'));
    const thrice = await readFrom(
      [explanation('first'), explanation('first'), explanation('first')].join('\n\n'),
    );
    expect(thrice.passages).toBeGreaterThan(once.passages);
    expect(thrice.concept.size).toEqual(once.concept.size);
    expect(thrice.concept.size.band).toBe('fine');
    expect(allocationOf(thrice.concept)).toBe(allocationOf(once.concept));
  });

  it('length and duration carry no weight', async () => {
    const short = await readFrom(explanation('short'));
    const long = await readFrom(
      Array.from({ length: 10 }, (_, i) => explanation(`long ${i}`)).join('\n\n'),
    );
    expect(long.concept.size).toEqual(short.concept.size);
    expect(allocationOf(long.concept)).toBe(allocationOf(short.concept));
    // And no cue time moves it either.
    const timed = (s: number) => [
      partProvenance(TRANSCRIPT_PATH, 1, s),
      partProvenance(TRANSCRIPT_PATH, 2, s + 600),
    ];
    const [a, ...ra] = timed(5);
    const [b, ...rb] = timed(9000);
    const extent = (anchor: typeof a, alsoIn: typeof ra) =>
      readConceptExtent({ anchor, alsoIn, sourcePaths: [] });
    expect(extent(a, ra)).toEqual(extent(b, rb));
  });

  it('a same-event transcript that repeats the slides adds no corroboration', () => {
    const slides = [1, 2].map(slideProvenance);
    const parts = [1, 2, 3, 4].map((n) => partProvenance(TRANSCRIPT_PATH, n));
    const eventOf = (p: string) =>
      p === SLIDES_PATH || p === TRANSCRIPT_PATH || p === NOTE_PATH ? 'lecture-4' : undefined;
    const slidesOnly = readConceptSize({
      anchor: slides[0],
      alsoIn: slides.slice(1),
      sourcePaths: [NOTE_PATH],
    });
    const withTranscript = readConceptSize({
      anchor: slides[0],
      alsoIn: [...slides.slice(1), ...parts],
      sourcePaths: [NOTE_PATH],
      teachingEventOf: eventOf,
    });
    expect(withTranscript.extent.passageCount).toBe(slidesOnly.extent.passageCount);
    expect(withTranscript.extent.noteCount).toBe(slidesOnly.extent.noteCount);
    expect(withTranscript.band).toBe(slidesOnly.band);
    // The transcript's own path is never one of her notes.
    expect(withTranscript.extent.noteCount).toBe(slidesOnly.extent.noteCount);
  });
});
