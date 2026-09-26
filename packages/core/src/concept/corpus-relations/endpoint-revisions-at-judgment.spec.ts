/**
 * End-to-end: the judgment-time stamp (`./verdict.ts`'s `reconcileCorpusVerdicts`, threaded
 * through `./batch.ts`'s `runCorpusRelationBatch`) and the later freshness read
 * (`./endpoint-revision-lookup.ts`'s `buildEndpointRevisionLookup`, `./eligibility.ts`'s
 * `evaluatePropositionFreshnessWithLookup`) agreeing bit-for-bit — `ol-egov.141.89.4.14`.
 *
 * The whole point of this bead: judgment time and read time must run `computeConceptRevision`
 * over the SAME introducing-path set, or an unchanged concept would never compare `'current'`
 * again. This suite proves the round-trip with one caller-supplied path/revision map used both
 * to stamp (via `endpointRevisionStamping`) and to build the read-time lookup.
 *
 * INV-3: every key, path and revision string here is coined. No course code, note title or
 * wording comes from any real vault.
 */

import { describe, expect, it, vi } from 'vitest';
import type { Provenance } from '../../extract/types.js';
import type { VaultPath } from '../../vault/types.js';
import { runCorpusRelationBatch } from './batch.js';
import {
  evaluatePropositionFreshnessWithLookup,
  type JudgedEndpointRevision,
} from './eligibility.js';
import {
  buildEndpointRevisionLookup,
  type PathRevisionLookup,
} from './endpoint-revision-lookup.js';
import type { CorpusConcept } from './types.js';
import type { CorpusRelationVerdictPort } from './verdict.js';

function anchor(sourcePath: VaultPath): Provenance {
  return { sourcePath, location: { page: 1, charRange: { start: 0, end: 10 } } };
}

// Osmosis: one introducing path. Diffusion basics: TWO — wider than `anchorOf`'s one passage,
// exercising the same "topic concept with several introducing paths" case
// `./endpoint-revision-lookup.ts`'s own doc names.
const INTRODUCING_PATHS: Record<string, readonly VaultPath[]> = {
  Osmosis: ['Lecture 1.md'],
  'Diffusion basics': ['Lecture 2.md', 'Lecture 3.md'],
};

function introducingPathsOf(concept: CorpusConcept): readonly VaultPath[] {
  return INTRODUCING_PATHS[concept.name] ?? [];
}

function concept(name: string): CorpusConcept {
  return { name, aliases: [], anchor: anchor(INTRODUCING_PATHS[name]?.[0] ?? 'Lecture 1.md') };
}

async function judgeWithRevisions(revisionsAtJudgment: Record<string, string>) {
  const osmosis = concept('Osmosis');
  const diffusion = concept('Diffusion basics');
  const port: CorpusRelationVerdictPort = {
    verdict: vi.fn().mockResolvedValue({
      verdicts: [
        {
          a: 'Osmosis',
          b: 'Diffusion basics',
          type: 'prerequisite',
          direction: 'b-to-a', // diffusion (from) -> osmosis (to)
          confidence: 0.8,
        },
      ],
    }),
  };
  const result = await runCorpusRelationBatch(port, {
    newConcepts: [osmosis],
    allConcepts: [osmosis, diffusion],
    signals: [{ kind: 'embedding-proximity', a: 'Osmosis', b: 'Diffusion basics' }],
    passageText: () => 'some passage text',
    endpointRevisionStamping: {
      introducingPaths: introducingPathsOf,
      pathRevision: (path) => revisionsAtJudgment[path],
    },
  });
  expect(result.relations).toHaveLength(1);
  const [relation] = result.relations;
  if (relation === undefined) throw new Error('unreachable: length checked above');
  return relation;
}

function judgedRevisionsFor(relation: {
  readonly fromKey?: string;
  readonly toKey?: string;
  readonly endpointRevisions?: { readonly from: string; readonly to: string };
}): { readonly from: JudgedEndpointRevision; readonly to: JudgedEndpointRevision } {
  return {
    from: { key: 'ck-diffusion', revisionAtJudgment: relation.endpointRevisions?.from },
    to: { key: 'ck-osmosis', revisionAtJudgment: relation.endpointRevisions?.to },
  };
}

describe('endpoint revisions: judged at one time, read at another (ol-egov.141.89.4.14)', () => {
  const R1 = { 'Lecture 1.md': 'rev-1', 'Lecture 2.md': 'rev-1', 'Lecture 3.md': 'rev-1' };

  it('unchanged revisions: judge with R, then the lookup over the SAME revisions reads current', async () => {
    const relation = await judgeWithRevisions(R1);
    expect(relation.endpointRevisions).toBeDefined();

    const currentRevisionOf: PathRevisionLookup = (path) => R1[path as keyof typeof R1];
    const lookup = buildEndpointRevisionLookup(
      [
        { key: 'ck-osmosis', anchor: { kind: 'note', noteUid: null, notePath: 'Lecture 1.md' } },
        {
          key: 'ck-diffusion',
          anchor: {
            kind: 'topic',
            course: 'course-a',
            name: 'coined-diffusion',
            aliases: [],
            introducingPaths: INTRODUCING_PATHS['Diffusion basics'],
          },
        },
      ],
      currentRevisionOf,
    );

    const { from, to } = judgedRevisionsFor(relation);
    const freshness = evaluatePropositionFreshnessWithLookup(from, to, lookup);
    expect(freshness.from).toBe('current');
    expect(freshness.to).toBe('current');
    expect(freshness.evidenceState).toBe('current');
  });

  it('change one path: the lookup over a moved revision reads stale for that endpoint', async () => {
    const relation = await judgeWithRevisions(R1);

    const changed = { ...R1, 'Lecture 3.md': 'rev-CHANGED' }; // one of diffusion's two paths
    const currentRevisionOf: PathRevisionLookup = (path) => changed[path as keyof typeof changed];
    const lookup = buildEndpointRevisionLookup(
      [
        { key: 'ck-osmosis', anchor: { kind: 'note', noteUid: null, notePath: 'Lecture 1.md' } },
        {
          key: 'ck-diffusion',
          anchor: {
            kind: 'topic',
            course: 'course-a',
            name: 'coined-diffusion',
            aliases: [],
            introducingPaths: INTRODUCING_PATHS['Diffusion basics'],
          },
        },
      ],
      currentRevisionOf,
    );

    const { from, to } = judgedRevisionsFor(relation);
    const freshness = evaluatePropositionFreshnessWithLookup(from, to, lookup);
    expect(freshness.from).toBe('stale'); // diffusion: the endpoint whose path moved
    expect(freshness.to).toBe('current'); // osmosis: untouched
    expect(freshness.evidenceState).toBe('stale');
  });

  it("drop one path's revision: the lookup with no record for it reads unverified, never current", async () => {
    const relation = await judgeWithRevisions(R1);

    const dropped: Partial<typeof R1> = { ...R1 };
    delete dropped['Lecture 3.md']; // one of diffusion's two paths now has no revision on record
    const currentRevisionOf: PathRevisionLookup = (path) => dropped[path as keyof typeof R1];
    const lookup = buildEndpointRevisionLookup(
      [
        { key: 'ck-osmosis', anchor: { kind: 'note', noteUid: null, notePath: 'Lecture 1.md' } },
        {
          key: 'ck-diffusion',
          anchor: {
            kind: 'topic',
            course: 'course-a',
            name: 'coined-diffusion',
            aliases: [],
            introducingPaths: INTRODUCING_PATHS['Diffusion basics'],
          },
        },
      ],
      currentRevisionOf,
    );

    const { from, to } = judgedRevisionsFor(relation);
    const freshness = evaluatePropositionFreshnessWithLookup(from, to, lookup);
    expect(freshness.from).toBe('unverified'); // diffusion: one path's current revision unknown
    expect(freshness.to).toBe('current');
    // unverified collapses to the same abstain as stale for the two-valued serve decision.
    expect(freshness.evidenceState).toBe('stale');
  });

  it('unknown at JUDGMENT time (never a guess): a path with no revision then means no endpointRevisions is stamped at all', async () => {
    const missingAtJudgment: Partial<typeof R1> = { ...R1 };
    delete missingAtJudgment['Lecture 3.md'];
    const relation = await judgeWithRevisions(missingAtJudgment as Record<string, string>);
    expect(relation.endpointRevisions).toBeUndefined();
  });
});
