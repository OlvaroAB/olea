/**
 * `./endpoint-revision-lookup.ts` — a concept-keyed `EndpointRevisionLookup` built over
 * `ConceptKeyRecord.anchor` and a caller-supplied per-path revision reader. `ol-egov.141.89.4.13`.
 *
 * INV-3: every key, path and revision string here is coined. No course code, note title or
 * wording comes from any real vault.
 */

import { describe, expect, it } from 'vitest';
import type { NoteAnchor, TopicAnchor } from '../key-store.js';
import {
  buildEndpointRevisionLookup,
  computeConceptRevision,
  introducingPathsOfAnchor,
  type PathRevisionLookup,
} from './endpoint-revision-lookup.js';

function noteAnchor(notePath: string): NoteAnchor {
  return { kind: 'note', noteUid: null, notePath };
}

function topicAnchor(introducingPaths?: readonly string[]): TopicAnchor {
  return {
    kind: 'topic',
    course: 'course-a',
    name: 'coined-topic',
    aliases: [],
    ...(introducingPaths !== undefined ? { introducingPaths } : {}),
  };
}

describe('introducingPathsOfAnchor', () => {
  it('reads a note anchor as its one bound path', () => {
    expect(introducingPathsOfAnchor(noteAnchor('notes/a.md'))).toEqual(['notes/a.md']);
  });

  it('reads a topic anchor as its introducingPaths', () => {
    expect(introducingPathsOfAnchor(topicAnchor(['notes/a.md', 'notes/b.md']))).toEqual([
      'notes/a.md',
      'notes/b.md',
    ]);
  });

  it('reads a topic anchor with no introducingPaths field as empty, never undefined', () => {
    expect(introducingPathsOfAnchor(topicAnchor())).toEqual([]);
  });
});

describe('computeConceptRevision', () => {
  const revisions: Record<string, string> = {
    'notes/a.md': 'rev-1',
    'notes/b.md': 'rev-1',
  };
  const lookup: PathRevisionLookup = (path) => revisions[path];

  it('is undefined (unverified) for zero paths', () => {
    expect(computeConceptRevision([], lookup)).toBeUndefined();
  });

  it('is undefined (unverified) when a path has no revision on record', () => {
    expect(computeConceptRevision(['notes/missing.md'], lookup)).toBeUndefined();
  });

  it('is undefined for the whole concept when only one of several paths is missing', () => {
    expect(computeConceptRevision(['notes/a.md', 'notes/missing.md'], lookup)).toBeUndefined();
  });

  it('is defined and stable for a single known path', () => {
    const value = computeConceptRevision(['notes/a.md'], lookup);
    expect(value).toBeDefined();
    expect(computeConceptRevision(['notes/a.md'], lookup)).toBe(value);
  });

  it('is order-independent across multiple known paths', () => {
    expect(computeConceptRevision(['notes/a.md', 'notes/b.md'], lookup)).toBe(
      computeConceptRevision(['notes/b.md', 'notes/a.md'], lookup),
    );
  });

  it('is de-duplicated: repeating a path changes nothing', () => {
    expect(computeConceptRevision(['notes/a.md', 'notes/a.md'], lookup)).toBe(
      computeConceptRevision(['notes/a.md'], lookup),
    );
  });

  it('changes when any one of several paths changes revision', () => {
    const before = computeConceptRevision(['notes/a.md', 'notes/b.md'], lookup);
    const changed: PathRevisionLookup = (path) =>
      path === 'notes/b.md' ? 'rev-2' : revisions[path];
    const after = computeConceptRevision(['notes/a.md', 'notes/b.md'], changed);
    expect(after).toBeDefined();
    expect(after).not.toBe(before);
  });

  it('never collides two distinct path sets by naive concatenation (a real path can carry the separator byte)', () => {
    // Regression guard: joining `path + revision` without a delimiter could make
    // ('notes/a', '.mdrev-1') collide with ('notes/a.md', 'rev-1'). The separator bytes chosen
    // (\u0001 between path and revision, \u0000 between entries) are not valid vault-path
    // characters, so this is a belt-and-suspenders check rather than a live risk.
    const a = computeConceptRevision(['notes/a'], (path) =>
      path === 'notes/a' ? '.mdrev-1' : undefined,
    );
    const b = computeConceptRevision(['notes/a.md'], (path) =>
      path === 'notes/a.md' ? 'rev-1' : undefined,
    );
    expect(a).not.toBe(b);
  });
});

describe('computeConceptRevision — a missing path never fabricates a partial value', () => {
  it('is undefined when only one of two paths is missing, even though the other resolves', () => {
    const value = computeConceptRevision(['notes/a.md', 'notes/missing.md'], (path) =>
      path === 'notes/a.md' ? 'rev-1' : undefined,
    );
    expect(value).toBeUndefined();
  });
});

describe('buildEndpointRevisionLookup', () => {
  const keys = [
    { key: 'ck-note', anchor: noteAnchor('notes/a.md') },
    { key: 'ck-topic-one', anchor: topicAnchor(['notes/b.md']) },
    { key: 'ck-topic-many', anchor: topicAnchor(['notes/b.md', 'notes/c.md']) },
    { key: 'ck-topic-empty', anchor: topicAnchor() },
  ];

  it('reads a defined, stable revision for a note-anchored concept whose path has a revision on record', () => {
    const lookup = buildEndpointRevisionLookup(keys, (path) =>
      path === 'notes/a.md' ? 'rev-1' : undefined,
    );
    const value = lookup('ck-note');
    expect(value).toBeDefined();
    expect(lookup('ck-note')).toBe(value);
  });

  it('reads stale via a changed composite when the underlying path revision moves', () => {
    const before = buildEndpointRevisionLookup(keys, (path) =>
      path === 'notes/a.md' ? 'rev-1' : undefined,
    )('ck-note');
    const after = buildEndpointRevisionLookup(keys, (path) =>
      path === 'notes/a.md' ? 'rev-2' : undefined,
    )('ck-note');
    expect(before).toBeDefined();
    expect(after).toBeDefined();
    expect(after).not.toBe(before);
  });

  it('reads unverified (undefined) for a key with no matching record', () => {
    const lookup = buildEndpointRevisionLookup(keys, () => 'rev-1');
    expect(lookup('ck-unknown')).toBeUndefined();
  });

  it('reads unverified (undefined) for a topic anchor with no introducingPaths recorded', () => {
    const lookup = buildEndpointRevisionLookup(keys, () => 'rev-1');
    expect(lookup('ck-topic-empty')).toBeUndefined();
  });

  it('reads unverified (undefined) for a multi-path topic concept when any one path has no revision on record', () => {
    const lookup = buildEndpointRevisionLookup(keys, (path) =>
      path === 'notes/b.md' ? 'rev-1' : undefined,
    );
    expect(lookup('ck-topic-many')).toBeUndefined();
  });

  it('reads current for a multi-path topic concept only once every path has a matching revision', () => {
    const lookup = buildEndpointRevisionLookup(keys, () => 'rev-1');
    expect(lookup('ck-topic-many')).toBeDefined();
  });

  it('never treats a record it cannot fully resolve as current by default', () => {
    const alwaysUndefined = buildEndpointRevisionLookup(keys, () => undefined);
    for (const { key } of keys) {
      expect(alwaysUndefined(key)).toBeUndefined();
    }
  });
});

describe('integration with ./eligibility.ts', () => {
  // Both sides of a real freshness comparison must build their revision string through
  // `computeConceptRevision` — a bare, hand-typed 'rev-1' on the judgment side would never equal
  // this module's composite output even when nothing changed (module doc). These two tests build
  // `revisionAtJudgment` the same way a future judgment-time writer would: by calling
  // `computeConceptRevision` against the AT-JUDGMENT per-path lookup, then comparing against
  // `buildEndpointRevisionLookup`'s own CURRENT per-path lookup.
  const keys = [
    { key: 'ck-from', anchor: noteAnchor('notes/from.md') },
    { key: 'ck-to', anchor: noteAnchor('notes/to.md') },
  ];

  it('feeds evaluatePropositionFreshnessWithLookup end to end: one stale endpoint beside one current', async () => {
    const { evaluatePropositionFreshnessWithLookup } = await import('./eligibility.js');
    const atJudgmentPathRevisions: Record<string, string> = {
      'notes/from.md': 'rev-1',
      'notes/to.md': 'rev-1',
    };
    const currentPathRevisions: Record<string, string> = {
      'notes/from.md': 'rev-1', // unchanged since judgment
      'notes/to.md': 'rev-2', // moved since judgment
    };
    const revisionAtJudgment = (path: string) =>
      computeConceptRevision([path], (p) => atJudgmentPathRevisions[p]);
    const lookup = buildEndpointRevisionLookup(keys, (path) => currentPathRevisions[path]);
    const freshness = evaluatePropositionFreshnessWithLookup(
      { key: 'ck-from', revisionAtJudgment: revisionAtJudgment('notes/from.md') },
      { key: 'ck-to', revisionAtJudgment: revisionAtJudgment('notes/to.md') },
      lookup,
    );
    expect(freshness.from).toBe('current');
    expect(freshness.to).toBe('stale');
    expect(freshness.overall).toBe('stale');
    expect(freshness.evidenceState).toBe('stale');
  });

  it('reads both endpoints current when neither source has moved', async () => {
    const { evaluatePropositionFreshnessWithLookup } = await import('./eligibility.js');
    const revisionAtJudgment = (path: string) => computeConceptRevision([path], () => 'rev-1');
    const lookup = buildEndpointRevisionLookup(keys, () => 'rev-1');
    const freshness = evaluatePropositionFreshnessWithLookup(
      { key: 'ck-from', revisionAtJudgment: revisionAtJudgment('notes/from.md') },
      { key: 'ck-to', revisionAtJudgment: revisionAtJudgment('notes/to.md') },
      lookup,
    );
    expect(freshness.overall).toBe('current');
    expect(freshness.evidenceState).toBe('current');
  });

  it('reads unverified, never current, when a concept key has no anchor record at all', async () => {
    const { evaluatePropositionFreshnessWithLookup } = await import('./eligibility.js');
    const lookup = buildEndpointRevisionLookup([], () => 'rev-1');
    const freshness = evaluatePropositionFreshnessWithLookup(
      { key: 'ck-from', revisionAtJudgment: 'rev-1' },
      { key: 'ck-to', revisionAtJudgment: 'rev-1' },
      lookup,
    );
    expect(freshness.from).toBe('unverified');
    expect(freshness.to).toBe('unverified');
    expect(freshness.evidenceState).toBe('stale');
  });
});
