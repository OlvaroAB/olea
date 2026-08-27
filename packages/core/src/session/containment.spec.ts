// Scenarios: features/F2-review.md, "F2.14 — Containment co-presence is
// filtered at composition (C7.9)" — @auto:core/session/containment.spec
//
// INV-3: every concept name below is coined for the test. None is drawn from
// any real vault.

import { describe, expect, it } from 'vitest';
import type { ConceptRelation, RelationType } from '../concept/relation.js';
import type { ConceptRecord } from '../concept/types.js';
import type { Provenance } from '../extract/types.js';
import type { QueueCandidate } from '../queue/types.js';
import { filterContainmentCoPresence } from './containment.js';

function passage(sourcePath: string): Provenance {
  return { sourcePath, location: { page: 1, charRange: { start: 0, end: 10 } } };
}

function edge(type: RelationType, from: string, to: string): ConceptRelation {
  return {
    type,
    from,
    to,
    provenance: 'model-proposed',
    confidence: 0.9,
    introducingPassages: { from: passage(`${from}.md`), to: passage(`${to}.md`) },
  };
}

function concept(key: string, name: string): ConceptRecord {
  return { key, name, tier: 2, courses: [], sourcePaths: [`${name}.md`] };
}

function candidate(instrumentId: string, ...conceptIds: string[]): QueueCandidate {
  return {
    instrumentId,
    instrumentType: 'qa',
    conceptIds,
    courses: [],
    state: null,
  };
}

// A part-of B: Mitochondria is part of Cell — Mitochondria is `from`, Cell is
// `to`, the same convention `concept/read.ts`'s `applyContainmentEvidence`
// reads (`relation.to` is the broader side).
const PART = concept('mitochondria-key', 'Mitochondria');
const CONTAINER = concept('cell-key', 'Cell');
const UNRELATED = concept('photosynthesis-key', 'Photosynthesis');

describe('filterContainmentCoPresence', () => {
  it('drops the container when both the container and one of its parts are present', () => {
    const partCandidate = candidate('i-part', PART.key);
    const containerCandidate = candidate('i-container', CONTAINER.key);
    const result = filterContainmentCoPresence(
      [containerCandidate, partCandidate],
      [edge('part-of', PART.name, CONTAINER.name)],
      [PART, CONTAINER],
    );

    expect(result.candidates.map((c) => c.instrumentId)).toEqual(['i-part']);
    expect(result.dropped.map((c) => c.instrumentId)).toEqual(['i-container']);
  });

  it('the part is the side kept, never the side dropped', () => {
    // Same fixture, reversed candidate order — the part must never be the one
    // that yields, regardless of which arrives first.
    const partCandidate = candidate('i-part', PART.key);
    const containerCandidate = candidate('i-container', CONTAINER.key);
    const result = filterContainmentCoPresence(
      [partCandidate, containerCandidate],
      [edge('part-of', PART.name, CONTAINER.name)],
      [PART, CONTAINER],
    );

    expect(result.candidates.some((c) => c.conceptIds.includes(PART.key))).toBe(true);
    expect(result.candidates.some((c) => c.conceptIds.includes(CONTAINER.key))).toBe(false);
  });

  it('a session with no relation data is unaffected — omitted edges is a real no-op', () => {
    const candidates = [candidate('i-part', PART.key), candidate('i-container', CONTAINER.key)];
    const result = filterContainmentCoPresence(candidates, [], [PART, CONTAINER]);
    expect(result.candidates).toEqual(candidates);
    expect(result.dropped).toEqual([]);
  });

  it('the container alone, with no co-present part, is not dropped', () => {
    const candidates = [
      candidate('i-container', CONTAINER.key),
      candidate('i-other', UNRELATED.key),
    ];
    const result = filterContainmentCoPresence(
      candidates,
      [edge('part-of', PART.name, CONTAINER.name)],
      [PART, CONTAINER, UNRELATED],
    );
    expect(result.candidates).toEqual(candidates);
    expect(result.dropped).toEqual([]);
  });

  it('a part-of edge naming a concept this walk did not resolve is dropped, not guessed at', () => {
    const candidates = [candidate('i-part', PART.key), candidate('i-container', CONTAINER.key)];
    const result = filterContainmentCoPresence(
      candidates,
      // "Ghost" resolves to nothing in `concepts` below.
      [edge('part-of', 'Ghost', CONTAINER.name)],
      [PART, CONTAINER],
    );
    expect(result.candidates).toEqual(candidates);
    expect(result.dropped).toEqual([]);
  });

  it('only part-of is read; other relation types are ignored rather than rejected', () => {
    const candidates = [candidate('i-part', PART.key), candidate('i-container', CONTAINER.key)];
    const result = filterContainmentCoPresence(
      candidates,
      [edge('prerequisite', PART.name, CONTAINER.name), edge('is-a', PART.name, CONTAINER.name)],
      [PART, CONTAINER],
    );
    expect(result.candidates).toEqual(candidates);
    expect(result.dropped).toEqual([]);
  });

  it('is deterministic: the same inputs, in any array order, agree on what is dropped', () => {
    const candidates = [
      candidate('i-part', PART.key),
      candidate('i-container', CONTAINER.key),
      candidate('i-other', UNRELATED.key),
    ];
    const edges = [
      edge('part-of', PART.name, CONTAINER.name),
      edge('is-a', UNRELATED.name, CONTAINER.name),
    ];

    const first = filterContainmentCoPresence(candidates, edges, [PART, CONTAINER, UNRELATED]);
    const second = filterContainmentCoPresence([...candidates].reverse(), [...edges].reverse(), [
      UNRELATED,
      CONTAINER,
      PART,
    ]);

    expect(new Set(first.dropped.map((c) => c.instrumentId))).toEqual(
      new Set(second.dropped.map((c) => c.instrumentId)),
    );
    expect(new Set(first.candidates.map((c) => c.instrumentId))).toEqual(
      new Set(second.candidates.map((c) => c.instrumentId)),
    );
  });

  it('an instrument bound to both the part and the container yields whole, per candidate', () => {
    const both = candidate('i-both', PART.key, CONTAINER.key);
    const result = filterContainmentCoPresence(
      [both],
      [edge('part-of', PART.name, CONTAINER.name)],
      [PART, CONTAINER],
    );
    // `i-both` names the container among its conceptIds, so the whole
    // candidate is dropped — this module filters per instrument, the same
    // grain `QueueCandidate.conceptIds` already carries, and there is no
    // sub-instrument split to keep the part's half of a single candidate.
    expect(result.dropped.map((c) => c.instrumentId)).toEqual(['i-both']);
    expect(result.candidates).toEqual([]);
  });
});
