import { describe, expect, it } from 'vitest';
import {
  readLectureBundles,
  teachingEventResolverFrom,
} from '../../src/ingestion/lecture-links.js';
import { createObsidianResolvedLinksPort } from '../../src/ingestion/obsidian-resolved-links.js';

describe('teachingEventResolverFrom (ol-egov.141.89.3.43)', () => {
  it('puts the slides, the transcript and the linking note in one teaching event', () => {
    const port = createObsidianResolvedLinksPort({
      resolvedLinks: {
        'notes/week 4.md': { 'Week 4/talk.txt': 1, 'Week 4/slides.pptx': 1 },
      },
      getCache: () => null,
    });
    const eventOf = teachingEventResolverFrom(readLectureBundles(port));
    const ids = ['Week 4/talk.txt', 'Week 4/slides.pptx', 'notes/week 4.md'].map((p) =>
      eventOf(p as never),
    );
    expect(new Set(ids).size).toBe(1);
    expect(ids[0]).toBeDefined();
    expect(eventOf('notes/elsewhere.md' as never)).toBeUndefined();
  });
});
