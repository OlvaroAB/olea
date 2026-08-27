import { describe, expect, it } from 'vitest';
import { createInMemoryPreviousTextTracker } from '../../../src/ingestion/materiality/previous-text.js';

describe('createInMemoryPreviousTextTracker', () => {
  it('reports undefined for a path never recorded — a safe first sighting', () => {
    const tracker = createInMemoryPreviousTextTracker();
    expect(tracker.get('Courses/GEO101/Lecture 3.md')).toBeUndefined();
  });

  it('returns whatever was last recorded for that exact path', () => {
    const tracker = createInMemoryPreviousTextTracker();
    tracker.record('a.md', 'first version');
    expect(tracker.get('a.md')).toBe('first version');

    tracker.record('a.md', 'second version');
    expect(tracker.get('a.md')).toBe('second version');
  });

  it('keeps separate paths independent', () => {
    const tracker = createInMemoryPreviousTextTracker();
    tracker.record('a.md', 'A text');
    tracker.record('b.md', 'B text');

    expect(tracker.get('a.md')).toBe('A text');
    expect(tracker.get('b.md')).toBe('B text');
    expect(tracker.get('c.md')).toBeUndefined();
  });
});
