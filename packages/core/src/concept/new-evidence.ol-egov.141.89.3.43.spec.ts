/**
 * F8.5 / D-465: genuinely new evidence acts only through the existing rules, and slide and
 * spoken evidence both stay usable (`ol-egov.141.89.3.43`). Synthetic data only (INV-3).
 */

import { describe, expect, it } from 'vitest';
import { formatSourceCitation } from '../registry/citation.js';
import { gatherPassages, readConcepts } from './read.js';
import { readConceptSize } from './size.js';
import {
  explanation,
  MemoryVault,
  oneConceptReader,
  partProvenance,
  SLIDES_PATH,
  slideProvenance,
  TRANSCRIPT_PATH,
} from './transcript-fixtures.ol-egov.141.89.3.43.js';

describe('F8.5: new evidence', () => {
  it('a transcript that adds a missing explanation is read, and moves nothing but what the rules read', async () => {
    const vault = new MemoryVault({ [TRANSCRIPT_PATH]: explanation('missing') });
    const passages = await gatherPassages(vault);
    expect(passages.length).toBeGreaterThan(0);
    for (const p of passages) {
      expect(p.anchor.location.transcriptPart).toBeDefined();
      expect(p.course).toBe('COURSE-A');
    }
    const result = await readConcepts(vault, oneConceptReader, { budget: { maxPassages: 50 } });
    if (result.outcome !== 'read') throw new Error('expected a read');
    const concept = result.concepts.find((c) => c.name === 'Osmotic balance');
    // An omitted concept appears, as one event of evidence, through the ordinary size rule.
    expect(concept?.size.band).toBe('fine');
    expect(concept?.size.extent.passageCount).toBe(1);
    expect(concept?.size.extent.noteCount).toBe(0);
  });

  it('a declared Markdown transcript is read as parts, never as her note blocks', async () => {
    const md = `---\nrole: transcript\n---\n${explanation('declared')}\n`;
    const path = '01 Courses/COURSE-A/Lectures/talk.md';
    const passages = await gatherPassages(new MemoryVault({ [path]: md }));
    expect(passages.length).toBeGreaterThan(0);
    expect(passages.every((p) => p.anchor.location.transcriptPart !== undefined)).toBe(true);
  });

  it('an undeclared Markdown file stays her note', async () => {
    const path = '01 Courses/COURSE-A/Lectures/note.md';
    const passages = await gatherPassages(new MemoryVault({ [path]: `${explanation('hers')}\n` }));
    expect(passages.every((p) => p.anchor.location.transcriptPart === undefined)).toBe(true);
  });

  it('a transcript in no bundle is its own event, counted once, through the existing rule', () => {
    const slides = [1, 2].map(slideProvenance);
    const parts = [1, 2, 3].map((n) => partProvenance(TRANSCRIPT_PATH, n));
    const size = readConceptSize({
      anchor: slides[0],
      alsoIn: [...slides.slice(1), ...parts],
      sourcePaths: [],
    });
    expect(size.extent.passageCount).toBe(3);
    expect(size.band).toBe('coarse'); // more than two events, by the ordinary floor
  });

  it('slide evidence and spoken evidence both stay usable and citable', () => {
    expect(formatSourceCitation({ sourcePath: SLIDES_PATH, page: 3 })).toBe(
      'week-4-slides (slide 3)',
    );
    expect(formatSourceCitation({ sourcePath: TRANSCRIPT_PATH, transcriptPart: { part: 2 } })).toBe(
      'week-4-talk (part 2)',
    );
    expect(
      formatSourceCitation({
        sourcePath: TRANSCRIPT_PATH,
        transcriptPart: { part: 2, startSeconds: 724 },
      }),
    ).toBe('week-4-talk (at 12:04)');
  });
});
