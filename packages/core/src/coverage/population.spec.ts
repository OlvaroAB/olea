/**
 * The population record and per-unit coverage (`ol-egov.141.89.11.4`; `[D-355]`,
 * `[D-326]`; the standing views chain spec's sections 2.1 and 2.2). Scenarios:
 * `features/F4-oracle.md` (olea-service), "[D-355] and [D-326]: the population record
 * and per-unit coverage", written before this code.
 *
 * Fixture ids are opaque (INV-3).
 */
import type { ReviewLogRecord, VerdictLogRecord } from 'olea-contracts';
import { describe, expect, it } from 'vitest';
import { summariseCoverageScope } from '../gap/coverage.js';
import {
  markConceptExtractionComplete,
  newPendingEntry,
  withReadingState,
} from '../ingestion/unit-manifest/manifest.js';
import type { UnitManifest } from '../ingestion/unit-manifest/types.js';
import { readAllConceptAttainment } from '../mastery/attainment.js';
import { projectInstrumentValidity } from '../mastery/validity.js';
import type { OutcomeRecord } from '../outcome/types.js';
import type { SourceCoverage } from '../tier3-evidence/types.js';
import type { VaultPath } from '../vault/types.js';
import { coverageGateOptionsOf } from './gate.js';
import { buildCoursePopulation, buildCoursePopulations } from './population.js';
import {
  conceptEvidenceFromAttainment,
  conceptExtractionOfScopeSource,
  declarationsFromOutcomeRecords,
  populationReadingOfManifest,
  populationReadingOfScopeSource,
} from './readers.js';
import type {
  ConceptEvidenceState,
  CoursePopulationInput,
  PopulationDeclarationInput,
  PopulationDocumentInput,
} from './types.js';

const COURSE = 'crs-a';

function doc(
  documentId: string,
  overrides: Partial<PopulationDocumentInput> = {},
): PopulationDocumentInput {
  return {
    documentId,
    examiner: true,
    revision: 'r1',
    revisionDate: '2026-01-07',
    reading: { state: 'complete' },
    declarationExtraction: 'finished',
    ...overrides,
  };
}

function aligned(declarationId: string, ...conceptKeys: string[]): PopulationDeclarationInput {
  return { declarationId, documentId: 'doc-1', revision: 'r1', alignment: 'aligned', conceptKeys };
}

function unaligned(
  declarationId: string,
  alignment: 'not-aligned' | 'no-concept',
): PopulationDeclarationInput {
  return { declarationId, documentId: 'doc-1', revision: 'r1', alignment, conceptKeys: [] };
}

/** One course: one examiner document read and extracted, each concept in its own complete source, practised and assessed. */
function course(
  declarations: readonly PopulationDeclarationInput[],
  conceptKeys: readonly string[],
  overrides: Partial<CoursePopulationInput> = {},
): CoursePopulationInput {
  return {
    courseId: COURSE,
    documents: [doc('doc-1')],
    declarations,
    sources: conceptKeys.map((k) => ({ sourceId: `src-${k}`, reading: { state: 'complete' } })),
    conceptExtraction: 'finished',
    concepts: conceptKeys.map((k) => ({ conceptKey: k, sourceIds: [`src-${k}`] })),
    instruments: conceptKeys.map((k) => ({
      instrumentId: `ins-${k}`,
      conceptKeys: [k],
      standing: 'eligible' as const,
    })),
    conceptEvidence: new Map(conceptKeys.map((k) => [k, 'assessed' as ConceptEvidenceState])),
    ...overrides,
  };
}

const unit = (p: ReturnType<typeof buildCoursePopulation>, id: string) => {
  const u = p.units.find((x) => x.declarationId === id);
  if (u === undefined) throw new Error(`no unit ${id}`);
  return u;
};

describe('the denominator counts the examiner declared units, matched or not ([D-355])', () => {
  it('keeps an aligned, an unmatched and an ambiguous unit, each counted once', () => {
    const p = buildCoursePopulation(
      course(
        [aligned('u1', 'c1'), unaligned('u2', 'no-concept'), unaligned('u3', 'not-aligned')],
        ['c1'],
      ),
    );
    expect(p.countedUnit).toBe('declared-unit');
    expect(p.labelRequired).toBe(false);
    expect(p.denominator).toEqual({
      state: 'known',
      value: 3,
      sources: [{ documentId: 'doc-1', revision: 'r1', revisionDate: '2026-01-07' }],
      asOf: '2026-01-07',
    });
    expect(p.units.map((u) => [u.declarationId, u.counted, u.entries])).toEqual([
      ['u1', true, 1],
      ['u2', true, 1],
      ['u3', true, 1],
    ]);
    expect(p.readingState).toEqual({ examiner: 'complete', material: 'complete' });
    expect(p.extractionState).toEqual({ declarations: 'finished', concepts: 'finished' });
  });

  it('counts only declarations from an examiner document of the course', () => {
    const p = buildCoursePopulation(
      course(
        [aligned('u1', 'c1'), { ...aligned('u2', 'c1'), documentId: 'doc-reclassified' }],
        ['c1'],
        {
          documents: [doc('doc-1'), doc('doc-reclassified', { examiner: false })],
        },
      ),
    );
    expect(p.units.map((u) => u.declarationId)).toEqual(['u1']);
    expect(p.denominator.value).toBe(1);
  });

  it('is the same population for shuffled input', () => {
    const decls = [aligned('u2', 'c2', 'c1'), aligned('u1', 'c1'), unaligned('u3', 'no-concept')];
    const a = buildCoursePopulation(course(decls, ['c1', 'c2']));
    const b = buildCoursePopulation(course([...decls].reverse(), ['c2', 'c1']));
    expect(b).toEqual(a);
  });
});

describe('a course with no examiner document has no declared scope and no count', () => {
  it('reads not declared, labelled, with nothing formed that rests on a denominator', () => {
    const p = buildCoursePopulation(course([], ['c1', 'c2'], { documents: [] }));
    expect(p.countedUnit).toBe('concept-labelled');
    expect(p.labelRequired).toBe(true);
    expect(p.denominator).toEqual({ state: 'not-declared', value: null, sources: [], asOf: null });
    expect(p.counts).toBeNull();
    expect(p.unmatched).toBeNull();
    expect(p.volunteers).toBeNull();
    expect(p.exhaustive).toBe('withheld');
    expect(p.exhaustiveWithheldBecause).toContain('no-declared-unit');
    expect(p.readingState.examiner).toBe('none');
    expect(p.extractionState.declarations).toBe('none');
  });

  it('with nothing registered and no concepts, the counted unit is unknown', () => {
    const p = buildCoursePopulation({
      ...course([], [], { documents: [], conceptExtraction: null }),
    });
    expect(p.countedUnit).toBe('unknown');
    expect(p.denominator.state).toBe('not-declared');
    expect(p.readingState.material).toBe('none');
    expect(p.extractionState.concepts).toBe('none');
  });
});

describe('a declared scope not yet fully read or extracted is never a number ([D-326])', () => {
  const cases: [string, Partial<PopulationDocumentInput>, string][] = [
    ['declarations pending', { declarationExtraction: 'pending' }, 'not-yet-known'],
    ['declarations failed', { declarationExtraction: 'failed' }, 'not-yet-known'],
    ['declarations cut short', { declarationExtraction: 'cut-short' }, 'not-yet-known'],
    ['no declaration record', { declarationExtraction: null }, 'not-yet-known'],
    ['no completeness record', { reading: null }, 'not-yet-known'],
    ['unread', { reading: { state: 'unread' } }, 'not-yet-known'],
    ['partly read', { reading: { state: 'partial', unitsRead: 2, unitsTotal: 5 } }, 'partly-read'],
    ['unreadable', { reading: { state: 'unreadable' } }, 'could-not-read'],
  ];
  for (const [label, overrides, state] of cases) {
    it(`${label}: ${state}, no value, the claim withheld`, () => {
      const p = buildCoursePopulation(
        course([aligned('u1', 'c1'), aligned('u2', 'c2')], ['c1', 'c2'], {
          documents: [doc('doc-1', overrides)],
        }),
      );
      expect(p.countedUnit).toBe('declared-unit');
      expect(p.denominator.state).toBe(state);
      expect(p.denominator.value).toBeNull();
      expect(p.exhaustive).toBe('withheld');
    });
  }

  it('a partly read denominator still counts the units it lists, and forms no volunteers', () => {
    const p = buildCoursePopulation(
      course([aligned('u1', 'c1')], ['c1', 'c9'], {
        documents: [doc('doc-1', { reading: { state: 'partial', unitsRead: 1, unitsTotal: 3 } })],
      }),
    );
    expect(p.counts?.material.read).toBe(1);
    expect(p.volunteers).toBeNull();
    expect(p.readingState.examiner).toBe('partial');
  });

  it('an unreadable document store forms nothing and withholds the claim', () => {
    const p = buildCoursePopulation(
      course([aligned('u1', 'c1')], ['c1'], { documentStoreReadable: false }),
    );
    expect(p.countedUnit).toBe('unknown');
    expect(p.denominator.state).toBe('could-not-read');
    expect(p.units).toEqual([]);
    expect(p.inFlight).toBeNull();
    expect(p.exhaustiveWithheldBecause).toContain('document-store-unreadable');
  });
});

describe('a unit reads missing from her material only when all of it was read and extracted', () => {
  it('reads missing and is unmatched over material read in full', () => {
    const p = buildCoursePopulation(
      course([aligned('u1', 'c1'), unaligned('u2', 'no-concept')], ['c1']),
    );
    expect(unit(p, 'u2')).toMatchObject({
      material: 'missing',
      practice: 'none',
      evidence: 'none',
    });
    expect(p.unmatched).toEqual(['u2']);
    expect(p.counts?.material).toEqual({
      read: 1,
      'partly-read': 0,
      missing: 1,
      'not-yet-known': 0,
    });
  });

  const notInFull: [string, Partial<CoursePopulationInput>][] = [
    [
      'a source partly read',
      {
        sources: [
          { sourceId: 'src-c1', reading: { state: 'complete' } },
          { sourceId: 'src-x', reading: { state: 'partial' } },
        ],
      },
    ],
    [
      'a source unread',
      {
        sources: [
          { sourceId: 'src-c1', reading: { state: 'complete' } },
          { sourceId: 'src-x', reading: { state: 'unread' } },
        ],
      },
    ],
    [
      'a source unreadable',
      {
        sources: [
          { sourceId: 'src-c1', reading: { state: 'complete' } },
          { sourceId: 'src-x', reading: { state: 'unreadable' } },
        ],
      },
    ],
    [
      'a source with no record',
      {
        sources: [
          { sourceId: 'src-c1', reading: { state: 'complete' } },
          { sourceId: 'src-x', reading: null },
        ],
      },
    ],
    ['extraction cut short', { conceptExtraction: 'cut-short' }],
    ['extraction pending', { conceptExtraction: 'pending' }],
  ];
  for (const [label, overrides] of notInFull) {
    it(`${label}: the same unit reads not yet known and is not listed`, () => {
      const p = buildCoursePopulation(
        course([aligned('u1', 'c1'), unaligned('u2', 'no-concept')], ['c1'], overrides),
      );
      expect(unit(p, 'u2').material).toBe('not-yet-known');
      expect(p.unmatched).toEqual([]);
    });
  }

  it('a source read and found empty is read in full', () => {
    const p = buildCoursePopulation(
      course([unaligned('u2', 'no-concept')], ['c1'], {
        sources: [
          { sourceId: 'src-c1', reading: { state: 'complete' } },
          { sourceId: 'src-x', reading: { state: 'read-empty' } },
        ],
      }),
    );
    expect(unit(p, 'u2').material).toBe('missing');
  });
});

describe('a unit extracted but not aligned is counted and reads not yet known', () => {
  it('stays with no support and not yet known on every dimension', () => {
    const p = buildCoursePopulation(
      course([aligned('u1', 'c1'), unaligned('u2', 'not-aligned')], ['c1']),
    );
    expect(unit(p, 'u2')).toMatchObject({
      alignment: 'not-aligned',
      support: [],
      counted: true,
      material: 'not-yet-known',
      practice: 'not-yet-known',
      evidence: 'not-yet-known',
    });
    expect(p.unmatched).toEqual([]);
    expect(p.exhaustiveWithheldBecause).toContain('unit-not-aligned');
  });
});

describe("a unit's support is a set, and a broad unit is never dropped for its part", () => {
  it('a broad concept and its own part are one support set, one entry', () => {
    const p = buildCoursePopulation(course([aligned('u1', 'c2', 'c1', 'c1')], ['c1', 'c2']));
    expect(unit(p, 'u1').support).toEqual(['c1', 'c2']);
    expect(unit(p, 'u1').entries).toBe(1);
    expect(p.denominator.value).toBe(1);
  });

  it('one concept aligned to two units supports both, each counted once', () => {
    const p = buildCoursePopulation(course([aligned('u1', 'c1'), aligned('u2', 'c1')], ['c1']));
    expect(unit(p, 'u1').support).toEqual(['c1']);
    expect(unit(p, 'u2').support).toEqual(['c1']);
    expect(p.denominator.value).toBe(2);
  });

  it('a broad unit with no concept of its own stays and never reads every', () => {
    const p = buildCoursePopulation(
      course([unaligned('u-broad', 'no-concept'), aligned('u-part', 'c1')], ['c1']),
    );
    const broad = unit(p, 'u-broad');
    expect(broad.counted).toBe(true);
    expect([broad.material, broad.practice, broad.evidence]).not.toContain('every');
    expect(p.denominator.value).toBe(2);
  });

  it('a withdrawn concept supports nothing and is no volunteer', () => {
    const input = course([aligned('u1', 'c1'), aligned('u2', 'c2')], ['c1', 'c2', 'c3']);
    const p = buildCoursePopulation({
      ...input,
      concepts: input.concepts.map((c) =>
        c.conceptKey === 'c2' || c.conceptKey === 'c3' ? { ...c, withdrawn: true } : c,
      ),
    });
    expect(unit(p, 'u2')).toMatchObject({ alignment: 'no-concept', support: [] });
    expect(p.volunteers).toEqual([]);
  });
});

describe('practice and evidence read the whole support; an unattempted concept is not yet assessed', () => {
  it('an active instrument never attempted: practice every, evidence none', () => {
    const p = buildCoursePopulation(
      course([aligned('u1', 'c1')], ['c1'], {
        conceptEvidence: new Map([['c1', 'not-yet-assessed']]),
      }),
    );
    expect(unit(p, 'u1')).toMatchObject({ practice: 'every', evidence: 'none' });
  });

  for (const standing of ['withdrawn', 'suspended', 'note-gone', 'passage-changed'] as const) {
    it(`an instrument ${standing}: practice none`, () => {
      const p = buildCoursePopulation(
        course([aligned('u1', 'c1')], ['c1'], {
          instruments: [{ instrumentId: 'ins-c1', conceptKeys: ['c1'], standing }],
        }),
      );
      expect(unit(p, 'u1').practice).toBe('none');
      expect(p.inFlight).toEqual(['c1']);
    });
  }

  it('two concepts, one attempted: evidence some, never every', () => {
    const p = buildCoursePopulation(
      course([aligned('u1', 'c1', 'c2')], ['c1', 'c2'], {
        conceptEvidence: new Map<string, ConceptEvidenceState>([
          ['c1', 'assessed'],
          ['c2', 'not-yet-assessed'],
        ]),
        instruments: [{ instrumentId: 'ins-c1', conceptKeys: ['c1'], standing: 'eligible' }],
      }),
    );
    expect(unit(p, 'u1')).toMatchObject({ practice: 'some', evidence: 'some' });
  });

  it('a concept with no attainment reading reads not yet known on evidence', () => {
    const p = buildCoursePopulation(
      course([aligned('u1', 'c1')], ['c1'], { conceptEvidence: new Map() }),
    );
    expect(unit(p, 'u1').evidence).toBe('not-yet-known');
  });

  it('attempts only on a proven-invalid instrument read not yet assessed', () => {
    const review = (eventId: string, instrumentId: string): ReviewLogRecord => ({
      schemaVersion: 6,
      kind: 'review',
      eventId,
      timestamp: '2026-01-10T09:00:00.000Z',
      instrumentId,
      instrumentType: 'qa',
      conceptIds: [instrumentId === 'qa:1' ? 'c1' : 'c2'],
      rating: 'good',
      wasUnsure: false,
      durationMs: 1200,
      selectionContext: {
        dueState: 'due',
        examProximity: null,
        yieldRank: null,
        instrumentTypesOffered: ['qa'],
        planVersion: null,
      },
    });
    const rejected: VerdictLogRecord = {
      schemaVersion: 6,
      kind: 'verdict',
      eventId: 'v1',
      timestamp: '2026-01-11T09:00:00.000Z',
      instrumentId: 'qa:2',
      instrumentType: 'qa',
      conceptIds: ['c2'],
      verdict: 'rejected',
      artifactProvenance: { taskId: 't', promptVersion: 'v0', modelId: 'm' },
    };
    const entries = [review('r1', 'qa:1'), review('r2', 'qa:2'), rejected];
    const evidence = conceptEvidenceFromAttainment(
      readAllConceptAttainment(entries, ['c1', 'c2', 'c3'], projectInstrumentValidity(entries)),
    );
    expect([...evidence]).toEqual([
      ['c1', 'assessed'],
      ['c2', 'not-yet-assessed'],
      ['c3', 'not-yet-assessed'],
    ]);
  });
});

describe('volunteers stay outside the denominator and are listed', () => {
  it('lists concepts aligned to no unit and does not grow the denominator', () => {
    const p = buildCoursePopulation(course([aligned('u1', 'c1')], ['c1', 'c3', 'c2']));
    expect(p.volunteers).toEqual(['c2', 'c3']);
    expect(p.denominator.value).toBe(1);
  });
});

describe('stuck counts processing passes, never renders', () => {
  it('two passes make stuck, one does not; no passes leave it unformed', () => {
    const base = course(
      [aligned('u1', 'c1'), aligned('u2', 'c2'), aligned('u3', 'c3')],
      ['c1', 'c2', 'c3'],
      {
        instruments: [{ instrumentId: 'ins-c3', conceptKeys: ['c3'], standing: 'eligible' }],
      },
    );
    const p = buildCoursePopulation({
      ...base,
      processingPasses: [
        { passId: 'p1', queuedConceptKeys: ['c1'] },
        { passId: 'p2', queuedConceptKeys: ['c1', 'c2'] },
        { passId: 'p2', queuedConceptKeys: ['c2'] },
      ],
    });
    expect(p.inFlight).toEqual(['c1', 'c2']);
    expect(p.stuck).toEqual(['c1']);
    expect(buildCoursePopulation(base).stuck).toBeNull();
  });

  it('a concept with no source in her material is not in flight', () => {
    const input = course([aligned('u1', 'c1')], ['c1'], { instruments: [] });
    const p = buildCoursePopulation({ ...input, concepts: [{ conceptKey: 'c1', sourceIds: [] }] });
    expect(p.inFlight).toEqual([]);
  });
});

describe('the exhaustive claim needs a unit, every unit aligned, and everything read and extracted', () => {
  const allHold = () => course([aligned('u1', 'c1'), aligned('u2', 'c2')], ['c1', 'c2']);

  it('is allowed when every condition holds', () => {
    const p = buildCoursePopulation(allHold());
    expect(p.exhaustive).toBe('allowed');
    expect(p.exhaustiveWithheldBecause).toEqual([]);
  });

  const failing: [string, (i: CoursePopulationInput) => CoursePopulationInput, string][] = [
    ['an empty declared set', (i) => ({ ...i, declarations: [] }), 'no-declared-unit'],
    [
      'one unaligned unit',
      (i) => ({ ...i, declarations: [...i.declarations, unaligned('u3', 'not-aligned')] }),
      'unit-not-aligned',
    ],
    [
      'a unit with no concept',
      (i) => ({ ...i, declarations: [...i.declarations, unaligned('u3', 'no-concept')] }),
      'unit-not-aligned',
    ],
    [
      'the examiner document partly read',
      (i) => ({ ...i, documents: [doc('doc-1', { reading: { state: 'partial' } })] }),
      'examiner-document-not-read-in-full',
    ],
    [
      'declaration extraction cut short',
      (i) => ({ ...i, documents: [doc('doc-1', { declarationExtraction: 'cut-short' })] }),
      'declaration-extraction-unfinished',
    ],
    [
      'a source partly read',
      (i) => ({
        ...i,
        sources: [...i.sources, { sourceId: 'src-x', reading: { state: 'partial' } }],
      }),
      'material-not-read-in-full',
    ],
    [
      'a source unread',
      (i) => ({
        ...i,
        sources: [...i.sources, { sourceId: 'src-x', reading: { state: 'unread' } }],
      }),
      'material-not-read-in-full',
    ],
    [
      'a source unreadable',
      (i) => ({
        ...i,
        sources: [...i.sources, { sourceId: 'src-x', reading: { state: 'unreadable' } }],
      }),
      'material-not-read-in-full',
    ],
    [
      'concept extraction pending',
      (i) => ({ ...i, conceptExtraction: 'pending' }),
      'concept-extraction-unfinished',
    ],
    [
      'the document store unreadable',
      (i) => ({ ...i, documentStoreReadable: false }),
      'document-store-unreadable',
    ],
  ];
  for (const [label, change, reason] of failing) {
    it(`${label} withholds it on its own, and says why`, () => {
      const p = buildCoursePopulation(change(allHold()));
      expect(p.exhaustive).toBe('withheld');
      expect(p.exhaustiveWithheldBecause).toContain(reason);
    });
  }
});

describe('an Outcome record with no concept attached reads not aligned, never missing', () => {
  const outcome = (id: string, overrides: Partial<OutcomeRecord> = {}): OutcomeRecord => ({
    id,
    courses: [COURSE],
    source: { path: 'docs/objectives.pdf' as VaultPath, blockIndex: 0 },
    label: 'label-placeholder',
    conceptKeys: [],
    status: 'active',
    provenance: { promptVersion: 'v0', modelVersion: 'm' },
    mintedAt: '2026-01-01',
    schemaVersion: 1,
    ...overrides,
  });

  it('reads attached keys as aligned and none as not aligned; retired and other courses drop out', () => {
    const decls = declarationsFromOutcomeRecords(
      [
        outcome('o1', { conceptKeys: ['c1'] }),
        outcome('o2'),
        outcome('o3', { status: 'retired', conceptKeys: ['c1'] }),
        outcome('o4', { courses: ['crs-other'], conceptKeys: ['c1'] }),
      ],
      COURSE,
    );
    expect(decls).toEqual([
      {
        declarationId: 'o1',
        documentId: 'docs/objectives.pdf',
        revision: null,
        alignment: 'aligned',
        conceptKeys: ['c1'],
      },
      {
        declarationId: 'o2',
        documentId: 'docs/objectives.pdf',
        revision: null,
        alignment: 'not-aligned',
        conceptKeys: [],
      },
    ]);
    const p = buildCoursePopulation(
      course(decls, ['c1'], { documents: [doc('docs/objectives.pdf')] }),
    );
    expect(unit(p, 'o2').material).toBe('not-yet-known');
    expect(p.unmatched).toEqual([]);
  });
});

describe('readings from the completeness record and the coverage scope', () => {
  const path = 'src/a.pdf' as VaultPath;
  const manifest = (
    ...states: ('read' | 'partial' | 'pending' | 'failed' | 'blank')[]
  ): UnitManifest => ({
    sourcePath: path,
    revisionDigest: 'rev',
    entries: states.map((s, i) => {
      const e = newPendingEntry(path, i + 1);
      switch (s) {
        case 'read':
          return markConceptExtractionComplete(
            withReadingState(e, { kind: 'read', method: 'text-layer' }),
          );
        case 'partial':
          return withReadingState(e, { kind: 'partial', method: 'image', coverage: 'part' });
        case 'failed':
          return withReadingState(e, { kind: 'failed', reason: 'render-failed', retryable: true });
        case 'blank':
          return withReadingState(e, { kind: 'unreadable', reason: 'blank-page' });
        default:
          return e;
      }
    }),
  });

  it('maps each record shape to one reading, never rounding partial up', () => {
    expect(populationReadingOfManifest(manifest('read', 'read'))).toEqual({ state: 'complete' });
    expect(populationReadingOfManifest(manifest('blank'))).toEqual({ state: 'read-empty' });
    expect(populationReadingOfManifest(manifest('read', 'partial'))).toEqual({
      state: 'partial',
      unitsRead: 1,
      unitsTotal: 2,
    });
    expect(populationReadingOfManifest(manifest('read', 'pending'))?.state).toBe('partial');
    expect(populationReadingOfManifest(manifest('failed', 'failed'))).toEqual({
      state: 'unreadable',
    });
    expect(populationReadingOfManifest(manifest('pending', 'pending'))).toEqual({
      state: 'unread',
    });
    expect(populationReadingOfManifest(manifest())).toBeNull();
  });

  it("reads a scope row's record where one exists, else its extractor verdict", () => {
    const row: SourceCoverage = {
      sourcePath: path,
      kinds: ['registered-file'],
      role: 'past-paper',
      format: 'pdf',
      duplicateSourcePaths: [],
      courses: [COURSE],
      outcome: 'extracted',
      pages: 2,
      units: 4,
      citations: 0,
      limitations: [],
    };
    const noRecord = summariseCoverageScope([row]).sources[0];
    const recorded = summariseCoverageScope([row], {
      manifests: new Map([[path, manifest('read', 'partial')]]),
    }).sources[0];
    if (noRecord === undefined || recorded === undefined) throw new Error('no row');
    expect(populationReadingOfScopeSource(noRecord)).toEqual({ state: 'complete' });
    expect(conceptExtractionOfScopeSource(noRecord)).toBeNull();
    expect(populationReadingOfScopeSource(recorded)).toEqual({ state: 'partial' });
    expect(conceptExtractionOfScopeSource(recorded)).toBe('pending');
  });
});

describe("the gap view's gate options from a set of populations", () => {
  it('no declaring course: no options, today unchanged', () => {
    const pops = buildCoursePopulations([course([], ['c1'], { documents: [] })]);
    expect(coverageGateOptionsOf(pops)).toEqual({});
  });

  it('declaring courses: their units, with support only when aligned, and whether any scope is unknown', () => {
    const known = course([aligned('u1', 'c1'), unaligned('u2', 'not-aligned')], ['c1']);
    const unknown = {
      ...course([aligned('u9', 'c9')], ['c9']),
      courseId: 'crs-b',
      documents: [doc('doc-1', { declarationExtraction: 'pending' })],
    };
    expect(coverageGateOptionsOf(buildCoursePopulations([known]))).toEqual({
      declaredUnits: [
        { declarationId: 'u1', conceptKeys: ['c1'] },
        { declarationId: 'u2', conceptKeys: [] },
      ],
      declaredScopeUnknown: false,
    });
    expect(
      coverageGateOptionsOf(buildCoursePopulations([known, unknown])).declaredScopeUnknown,
    ).toBe(true);
  });
});
