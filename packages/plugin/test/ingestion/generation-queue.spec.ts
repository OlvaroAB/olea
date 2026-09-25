/**
 * `generation-queue.ts` tests (`ol-2zfj.63` [GEN-3.1], `[D-238]`). See
 * `features/F3-learn-from-anything.md`'s "F3.3/F3.7 — the client ingestion
 * queue's generation policy" scenarios (private repo, cited by path per
 * INV-3), which this file's `describe`/`it` names are written to satisfy.
 */
import type {
  ConceptRecord,
  EnqueueInput,
  EnqueueResult,
  ExtractedUnit,
  JobRunnerView,
  JobRunOutcome,
} from 'olea-core';
import { describe, expect, it, vi } from 'vitest';
import {
  buildGenerationEnqueueInput,
  createGenerationAwareJobRunner,
  DEFAULT_PRIMARY_KIND_FLOOR,
  enqueueGenerationJob,
  enqueuePrimaryGenerationCallsForLandedUnits,
  enqueueTriggeredGenerationCall,
  type GenerationArrivalDeps,
  generationJobIdentityString,
  isGenerationJobPayload,
  primaryKindFor,
} from '../../src/ingestion/generation-queue.js';

/** Records every `enqueue` call verbatim — same role `arrival-watch.spec.ts`'s own `RecordingEnqueuer` fills. */
class RecordingEnqueuer {
  readonly calls: EnqueueInput[] = [];

  async enqueue(input: EnqueueInput): Promise<EnqueueResult> {
    this.calls.push(input);
    return { status: 'queued' };
  }
}

function concept(name: string, key: string, courses: readonly string[]): ConceptRecord {
  return { name, key, courses } as ConceptRecord;
}

function embeddedUnit(notePath: string, sourcePath = '01 Courses/A/lecture.pdf'): ExtractedUnit {
  return {
    text: 'x',
    provenance: {
      sourcePath,
      location: { page: 1 },
      embeddedIn: { notePath, blockStart: 0, blockEnd: 1 },
    },
  };
}

describe('primaryKindFor', () => {
  it('prefers the F4.8 format match when known', () => {
    expect(primaryKindFor({ formatMatch: 'qa', recordedPreference: ['mcq'] })).toBe('qa');
  });

  it('falls to the recorded preference, most-preferred first, absent a format', () => {
    expect(primaryKindFor({ formatMatch: null, recordedPreference: ['cloze', 'mcq'] })).toBe(
      'cloze',
    );
  });

  it('falls to the declared floor absent both', () => {
    expect(primaryKindFor({ formatMatch: null, recordedPreference: [] })).toBe(
      DEFAULT_PRIMARY_KIND_FLOOR,
    );
  });
});

describe('isGenerationJobPayload', () => {
  it('accepts a well-formed generation payload', () => {
    expect(
      isGenerationJobPayload({
        kind: 'generation',
        courseCode: 'A',
        conceptKey: 'ck',
        conceptName: 'Osmosis',
        instrumentKind: 'mcq',
        trigger: 'arrival',
      }),
    ).toBe(true);
  });

  it('rejects a non-generation payload', () => {
    expect(isGenerationJobPayload({ kind: 'source', sourcePath: 'x.pdf', format: 'pdf' })).toBe(
      false,
    );
  });

  it('rejects null and non-objects', () => {
    expect(isGenerationJobPayload(null)).toBe(false);
    expect(isGenerationJobPayload('generation')).toBe(false);
  });
});

describe('generationJobIdentityString / buildGenerationEnqueueInput', () => {
  it('is stable for the same (course, concept, kind) triple, distinct for a different one', () => {
    const a = generationJobIdentityString({
      courseCode: 'B',
      conceptKey: 'ck',
      instrumentKind: 'mcq',
    });
    const b = generationJobIdentityString({
      courseCode: 'B',
      conceptKey: 'ck',
      instrumentKind: 'mcq',
    });
    const c = generationJobIdentityString({
      courseCode: 'B',
      conceptKey: 'ck',
      instrumentKind: 'qa',
    });
    expect(a).toBe(b);
    expect(a).not.toBe(c);
  });

  it("produces a stable contentHash so a repeat enqueue is the engine's own dedup, not new state here", async () => {
    const args = {
      courseCode: 'A',
      conceptKey: 'ck-1',
      conceptName: 'Osmosis',
      instrumentKind: 'mcq' as const,
      trigger: 'arrival' as const,
    };
    const first = await buildGenerationEnqueueInput(args);
    const second = await buildGenerationEnqueueInput(args);
    expect(first.contentHash).toBe(second.contentHash);
    expect(first.payload).toEqual({ kind: 'generation', ...args });
  });

  it('carries sourceUnitId as the full (course, concept, kind) identity — ol-egov.141.89.10.49', async () => {
    const args = {
      courseCode: 'A',
      conceptKey: 'ck-1',
      conceptName: 'Osmosis',
      instrumentKind: 'mcq' as const,
      trigger: 'arrival' as const,
    };
    const input = await buildGenerationEnqueueInput(args);
    expect(input.sourceUnitId).toBe(generationJobIdentityString(args));

    // A different instrumentKind for the SAME concept is a different unit —
    // D-238 lets further calls for a new kind coexist with a still-pending
    // call for another kind, so they must never share a sourceUnitId (that
    // would make the engine wrongly retire the still-valid pending call).
    const otherKind = await buildGenerationEnqueueInput({ ...args, instrumentKind: 'qa' });
    expect(otherKind.sourceUnitId).not.toBe(input.sourceUnitId);
  });
});

describe('enqueueGenerationJob / enqueueTriggeredGenerationCall', () => {
  it('enqueues through the given enqueuer', async () => {
    const enqueuer = new RecordingEnqueuer();
    await enqueueGenerationJob(enqueuer, {
      courseCode: 'A',
      conceptKey: 'ck',
      conceptName: 'Osmosis',
      instrumentKind: 'mcq',
      trigger: 'arrival',
    });
    expect(enqueuer.calls).toHaveLength(1);
    expect(isGenerationJobPayload(enqueuer.calls[0]?.payload)).toBe(true);
  });

  it('enqueueTriggeredGenerationCall carries the named trigger and kind through', async () => {
    const enqueuer = new RecordingEnqueuer();
    await enqueueTriggeredGenerationCall(enqueuer, {
      courseCode: 'A',
      conceptKey: 'ck',
      conceptName: 'Osmosis',
      trigger: 'top-band',
      instrumentKind: 'qa',
    });
    const payload = enqueuer.calls[0]?.payload;
    expect(payload).toMatchObject({ trigger: 'top-band', instrumentKind: 'qa' });
  });
});

describe('createGenerationAwareJobRunner', () => {
  function jobView(payload: unknown): JobRunnerView {
    return { contentHash: 'h', label: 'l', payload, attempts: 0 };
  }
  const OK: JobRunOutcome = { ok: true };

  it('routes a generation payload to draft, never fallback', async () => {
    const draft = vi.fn().mockResolvedValue(OK);
    const fallback = vi.fn().mockResolvedValue(OK);
    const runner = createGenerationAwareJobRunner({ draft, fallback });
    const job = jobView({
      kind: 'generation',
      courseCode: 'A',
      conceptKey: 'ck',
      conceptName: 'Osmosis',
      instrumentKind: 'mcq',
      trigger: 'arrival',
    });
    await runner(job);
    expect(draft).toHaveBeenCalledWith(job);
    expect(fallback).not.toHaveBeenCalled();
  });

  it('falls through to fallback for any other payload', async () => {
    const draft = vi.fn().mockResolvedValue(OK);
    const fallback = vi.fn().mockResolvedValue(OK);
    const runner = createGenerationAwareJobRunner({ draft, fallback });
    const job = jobView({ kind: 'source', sourcePath: 'x.pdf', format: 'pdf' });
    await runner(job);
    expect(fallback).toHaveBeenCalledWith(job);
    expect(draft).not.toHaveBeenCalled();
  });
});

describe('enqueuePrimaryGenerationCallsForLandedUnits — D-238 "one call of the primary kind on arrival"', () => {
  function baseDeps(overrides: Partial<GenerationArrivalDeps> = {}): {
    enqueuer: RecordingEnqueuer;
    deps: GenerationArrivalDeps;
  } {
    const enqueuer = new RecordingEnqueuer();
    const deps: GenerationArrivalDeps = {
      enqueuer,
      listConceptsForCourse: async () => [],
      hasAnyBuiltKind: async () => false,
      ...overrides,
    };
    return { enqueuer, deps };
  }

  it('enqueues exactly one primary-kind call per new concept in the landed course', async () => {
    const { enqueuer, deps } = baseDeps({
      listConceptsForCourse: async (courseCode) => [
        concept('Osmosis', 'ck-1', [courseCode]),
        concept('Diffusion', 'ck-2', [courseCode]),
      ],
    });
    await enqueuePrimaryGenerationCallsForLandedUnits(
      [embeddedUnit('01 Courses/A/notes.md')],
      deps,
    );
    expect(enqueuer.calls).toHaveLength(2);
    for (const call of enqueuer.calls) {
      expect(call.payload).toMatchObject({
        trigger: 'arrival',
        instrumentKind: DEFAULT_PRIMARY_KIND_FLOOR,
      });
    }
  });

  it('never enqueues a concept that already has a built kind — D-238 "one call of the primary kind," not one per sweep', async () => {
    const built = new Set(['ck-1']);
    const { enqueuer, deps } = baseDeps({
      listConceptsForCourse: async (courseCode) => [concept('Osmosis', 'ck-1', [courseCode])],
      hasAnyBuiltKind: async (_course, conceptKey) => built.has(conceptKey),
    });
    await enqueuePrimaryGenerationCallsForLandedUnits(
      [embeddedUnit('01 Courses/A/notes.md')],
      deps,
    );
    expect(enqueuer.calls).toHaveLength(0);
  });

  it('uses the F4.8 format match over the declared floor when supplied', async () => {
    const { enqueuer, deps } = baseDeps({
      listConceptsForCourse: async (courseCode) => [concept('Osmosis', 'ck-1', [courseCode])],
      formatMatchFor: () => 'qa',
    });
    await enqueuePrimaryGenerationCallsForLandedUnits(
      [embeddedUnit('01 Courses/A/notes.md')],
      deps,
    );
    expect(enqueuer.calls[0]?.payload).toMatchObject({ instrumentKind: 'qa' });
  });

  it('skips a concept not actually in the landed course', async () => {
    const { enqueuer, deps } = baseDeps({
      listConceptsForCourse: async () => [concept('Osmosis', 'ck-1', ['B'])], // a different course than the unit's own
    });
    await enqueuePrimaryGenerationCallsForLandedUnits(
      [embeddedUnit('01 Courses/A/notes.md')],
      deps,
    );
    expect(enqueuer.calls).toHaveLength(0);
  });

  it("never throws when listConceptsForCourse rejects — logs and continues, matching arrival-watch.ts's posture", async () => {
    const { enqueuer, deps } = baseDeps({
      listConceptsForCourse: async () => {
        throw new Error('vault read failed');
      },
    });
    await expect(
      enqueuePrimaryGenerationCallsForLandedUnits([embeddedUnit('01 Courses/A/notes.md')], deps),
    ).resolves.toBeUndefined();
    expect(enqueuer.calls).toHaveLength(0);
  });

  it('derives the course from a bare-drop source path when no embedding note exists', async () => {
    const bareUnit: ExtractedUnit = {
      text: 'x',
      provenance: { sourcePath: '01 Courses/B/slides.pdf', location: { page: 1 } },
    };
    const { enqueuer, deps } = baseDeps({
      listConceptsForCourse: async (courseCode) => [concept('Ohm’s law', 'ck-1', [courseCode])],
    });
    await enqueuePrimaryGenerationCallsForLandedUnits([bareUnit], deps);
    expect(enqueuer.calls).toHaveLength(1);
    expect(enqueuer.calls[0]?.payload).toMatchObject({ courseCode: 'B' });
  });
});
