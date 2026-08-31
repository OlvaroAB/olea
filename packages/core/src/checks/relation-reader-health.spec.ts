// ol-mdvy. Type/reader labels here are opaque placeholders describing the
// SHAPE of an observation — no real vault content, no real course or note
// naming (INV-3). `../concept/relation.ts`'s own vocabulary (`is-a`,
// `part-of`, `contrasts-with`, `prerequisite`) is the ruled, public relation
// type set (C7.10) and is not itself private, so it is used directly.
//
// HOW TO CHECK THIS CHECK CAN FAIL (N-013): one observation reports edges
// produced with no reader firing among otherwise-healthy observations — the
// exact silent-failure shape (an edge folded and never read again) this
// check exists to catch. A second, independent way this check can fail
// (ol-3ux7.20): a directed type reports `directionCorrect: false` — the
// golden fixture's known endpoints came back on the wrong side — even
// though counts and `readerFired` look identical to a healthy run, because
// neither of those fields can see an inverted `from`/`to`.
import { describe, expect, it } from 'vitest';
import { checkRelationReaderFires } from './relation-reader-health.js';

describe('checkRelationReaderFires', () => {
  it('passes when every type that produced edges had its reader fire, on the correct endpoint', () => {
    const observations = [
      {
        type: 'is-a',
        readerName: 'concept-size-containment',
        edgesProduced: 2,
        readerFired: true,
        directionCorrect: true,
      },
      {
        type: 'part-of',
        readerName: 'concept-size-containment',
        edgesProduced: 1,
        readerFired: true,
        directionCorrect: true,
      },
      // Symmetric type — direction does not apply, and `undefined` here
      // must never fail the check on its own.
      {
        type: 'contrasts-with',
        readerName: 'misconception-confusion-pairing',
        edgesProduced: 1,
        readerFired: true,
        directionCorrect: undefined,
      },
      // Nothing produced for this type on this run — reported, never a failure on its own.
      {
        type: 'causes',
        readerName: 'relationship-elaboration',
        edgesProduced: 0,
        readerFired: false,
      },
    ];
    const verdict = checkRelationReaderFires(observations);
    expect(verdict.ok).toBe(true);
    expect(verdict.measured.firing).toEqual(['is-a', 'part-of', 'contrasts-with']);
    expect(verdict.measured.untested).toEqual(['causes']);
    expect(verdict.measured.silent).toEqual([]);
    expect(verdict.measured.directionWrong).toEqual([]);
  });

  it('FAILS when a directed type landed on the wrong endpoint even though the reader technically fired (ol-3ux7.20)', () => {
    // The exact gap this dimension exists to close: `edgesProduced` and
    // `readerFired` are both healthy-looking here — a reader firing on an
    // edge is not the same claim as the edge pointing the right way. Only
    // `directionCorrect` catches a `from`/`to` swap against the canonical
    // reading `ol-2zfj.17` pinned (part-of: `from` is the part, `to` is the
    // whole).
    const observations = [
      {
        type: 'is-a',
        readerName: 'concept-size-containment',
        edgesProduced: 1,
        readerFired: true,
        directionCorrect: true,
      },
      {
        type: 'part-of',
        readerName: 'concept-size-containment',
        edgesProduced: 1,
        readerFired: true,
        // Planted: the golden fixture shows containment evidence landed on
        // the part instead of the whole — from/to inverted.
        directionCorrect: false,
      },
    ];
    const verdict = checkRelationReaderFires(observations);
    expect(verdict.ok).toBe(false);
    expect(verdict.measured.directionWrong).toEqual(['part-of']);
    expect(verdict.measured.firing).toEqual(['is-a', 'part-of']);
    expect(verdict.detail).toContain('part-of');
    expect(verdict.detail).toContain('wrong endpoint');
  });

  it('FAILS when a type produced edges but no wired reader consumed them — the audited 1.2a gap', () => {
    // The real, current shape this check reports for `contrasts-with` /
    // `prerequisite`: the corpus stage really does produce edges (folded
    // into `OleaPlugin.relations`), but nothing production-reachable reads
    // that field afterwards — see this module's own doc.
    const observations = [
      { type: 'is-a', readerName: 'concept-size-containment', edgesProduced: 1, readerFired: true },
      {
        type: 'contrasts-with',
        readerName: 'misconception-confusion-pairing',
        edgesProduced: 1,
        readerFired: false,
      },
      {
        type: 'prerequisite',
        readerName: 'scheduling-order',
        edgesProduced: 1,
        readerFired: false,
      },
    ];
    const verdict = checkRelationReaderFires(observations);
    expect(verdict.ok).toBe(false);
    expect(verdict.measured.silent).toEqual(['contrasts-with', 'prerequisite']);
    expect(verdict.detail).toContain('contrasts-with');
    expect(verdict.detail).toContain('prerequisite');
  });

  it('planted failure: a single silent type among otherwise-firing types still fails the whole check', () => {
    const observations = [
      { type: 'is-a', readerName: 'concept-size-containment', edgesProduced: 5, readerFired: true },
      {
        type: 'part-of',
        readerName: 'concept-size-containment',
        edgesProduced: 5,
        readerFired: true,
      },
      // Planted: this type produced an edge and its reader stayed silent.
      { type: 'drifted-type', readerName: 'some-reader', edgesProduced: 1, readerFired: false },
    ];
    const verdict = checkRelationReaderFires(observations);
    expect(verdict.ok).toBe(false);
    expect(verdict.measured.firing).toEqual(['is-a', 'part-of']);
    expect(verdict.measured.silent).toEqual(['drifted-type']);
  });

  it('reports zero observations as a failure — a check that ran nothing cannot pass (N-013)', () => {
    const verdict = checkRelationReaderFires([]);
    expect(verdict.ok).toBe(false);
  });
});
