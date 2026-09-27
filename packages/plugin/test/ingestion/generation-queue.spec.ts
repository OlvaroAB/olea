/**
 * `generation-queue.ts` tests (`ol-2zfj.63` [GEN-3.1], `[D-238]`). See
 * `features/F3-learn-from-anything.md`'s "F3.3/F3.7 — the client ingestion
 * queue's generation policy" scenarios (private repo, cited by path per
 * INV-3), which this file's `describe`/`it` names are written to satisfy.
 */
import type {
  ConceptRecord,
  DeviceCapability,
  EnqueueInput,
  EnqueueResult,
  ExtractedUnit,
  JobRunner,
  JobRunnerView,
  JobRunOutcome,
  PersistedQueue,
  QueueStore,
} from 'olea-core';
import { IngestionQueueEngine } from 'olea-core';
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

/** In-memory `QueueStore` — same role `engine.spec.ts`'s own `MemoryStore` fills, minus Obsidian. */
class MemoryStore implements QueueStore {
  private state: PersistedQueue | null = null;

  async load(): Promise<PersistedQueue | null> {
    return this.state;
  }

  async save(queue: PersistedQueue): Promise<void> {
    this.state = { ...queue, jobs: queue.jobs.map((j) => ({ ...j })) };
  }
}

const desktop: DeviceCapability = { canDrain: true };
/** Never invoked by any test in this file's "stale, not re-run" suite — a call would mean the check itself triggered a run, which is exactly what must not happen. */
const neverRuns: JobRunner = async () => {
  throw new Error('JobRunner must not be called by an enqueue-time staleness check');
};

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

  it('D-381/D-385 (ol-egov.141.89.5.24): sourceContentHash/promptVersion change contentHash but never sourceUnitId', async () => {
    const args = {
      courseCode: 'A',
      conceptKey: 'ck-1',
      conceptName: 'Osmosis',
      instrumentKind: 'mcq' as const,
      trigger: 'arrival' as const,
    };
    const blind = await buildGenerationEnqueueInput(args);
    const versioned = await buildGenerationEnqueueInput({
      ...args,
      sourceContentHash: 'h1',
      promptVersion: 'v1',
    });
    const rebumped = await buildGenerationEnqueueInput({
      ...args,
      sourceContentHash: 'h1',
      promptVersion: 'v2',
    });

    // contentHash differs at every version step...
    expect(versioned.contentHash).not.toBe(blind.contentHash);
    expect(rebumped.contentHash).not.toBe(versioned.contentHash);
    // ...but sourceUnitId — the identity the engine's supersede check keys
    // on — stays the version-blind triple throughout, so the engine can
    // still recognise these as the same unit across a version bump.
    expect(versioned.sourceUnitId).toBe(blind.sourceUnitId);
    expect(rebumped.sourceUnitId).toBe(blind.sourceUnitId);

    // Neither version term leaks into the persisted payload.
    expect(versioned.payload).not.toHaveProperty('sourceContentHash');
    expect(versioned.payload).not.toHaveProperty('promptVersion');
  });
});

/**
 * D-381/D-385 (`ol-egov.141.89.5.24`): with `sourceContentHash`/
 * `promptVersion` now reaching `job.ts`'s identity functions (the describe
 * block above), `IngestionQueueEngine`'s own already-tested supersede
 * mechanism (`engine.spec.ts`'s "supersede on enqueue" suite) takes live
 * effect for generation calls too. These tests run the REAL engine — a
 * mock `JobEnqueuer` recording calls can't demonstrate a job going stale,
 * only that a call happened — and never call `engine.tick()`, so a
 * `JobRunner` invocation would prove the staleness check itself triggered a
 * re-run, which the acceptance criteria forbids.
 */
describe('generation jobs go stale on a version bump, without re-running (D-381/D-385, ol-egov.141.89.5.24)', () => {
  const args = {
    courseCode: 'A',
    conceptKey: 'ck-1',
    conceptName: 'Osmosis',
    instrumentKind: 'mcq' as const,
    trigger: 'arrival' as const,
  };

  it('an unchanged version reuses the cache — the engine reports the second enqueue a duplicate of the first', async () => {
    const engine = await IngestionQueueEngine.create({
      store: new MemoryStore(),
      capability: desktop,
      runner: neverRuns,
    });
    const versioned = { ...args, sourceContentHash: 'h1', promptVersion: 'v1' };

    const first = await enqueueGenerationJob(engine, versioned);
    expect(first).toEqual({ status: 'queued' });
    const second = await enqueueGenerationJob(engine, versioned);
    expect(second.status).toBe('duplicate');
    expect(engine.list()).toHaveLength(1);
  });

  it('a prompt version bump marks the job stale (superseded) WITHOUT re-running it', async () => {
    const engine = await IngestionQueueEngine.create({
      store: new MemoryStore(),
      capability: desktop,
      runner: neverRuns,
    });

    await enqueueGenerationJob(engine, { ...args, sourceContentHash: 'h1', promptVersion: 'v1' });
    expect(engine.snapshot().queued).toBe(1);

    const result = await enqueueGenerationJob(engine, {
      ...args,
      sourceContentHash: 'h1',
      promptVersion: 'v2',
    });
    expect(result).toEqual({ status: 'queued' });

    const jobs = engine.list();
    expect(jobs).toHaveLength(2);
    const stale = jobs.filter((j) => j.status === 'failed');
    const fresh = jobs.filter((j) => j.status === 'queued');
    expect(stale).toHaveLength(1);
    expect(stale[0]?.failedReason).toContain('superseded');
    expect(fresh).toHaveLength(1);
    // Never re-run: no job ever reached `done`, and the fake runner (which
    // throws if invoked) never fired because `tick()` was never called.
    expect(jobs.some((j) => j.status === 'done')).toBe(false);
  });

  it('a source content change marks the job stale (superseded) too, for an unchanged prompt version', async () => {
    const engine = await IngestionQueueEngine.create({
      store: new MemoryStore(),
      capability: desktop,
      runner: neverRuns,
    });

    await enqueueGenerationJob(engine, { ...args, sourceContentHash: 'h1', promptVersion: 'v1' });
    const result = await enqueueGenerationJob(engine, {
      ...args,
      sourceContentHash: 'h2',
      promptVersion: 'v1',
    });
    expect(result).toEqual({ status: 'queued' });

    const jobs = engine.list();
    expect(jobs.filter((j) => j.status === 'failed')).toHaveLength(1);
    expect(jobs.filter((j) => j.status === 'failed')[0]?.failedReason).toContain('superseded');
    expect(jobs.filter((j) => j.status === 'queued')).toHaveLength(1);
  });

  it('never supersedes a generation job that has already completed (done) — INV-2', async () => {
    let ran = 0;
    const alwaysSucceeds: JobRunner = async () => {
      ran++;
      return { ok: true };
    };
    const engine = await IngestionQueueEngine.create({
      store: new MemoryStore(),
      capability: desktop,
      runner: alwaysSucceeds,
    });
    await enqueueGenerationJob(engine, { ...args, sourceContentHash: 'h1', promptVersion: 'v1' });
    await engine.tick(); // -> done
    expect(engine.list()[0]?.status).toBe('done');

    await enqueueGenerationJob(engine, { ...args, sourceContentHash: 'h1', promptVersion: 'v2' });
    expect(engine.list().find((j) => j.status === 'done')).toBeDefined();
    expect(ran).toBe(1); // the version bump enqueued a fresh job but never re-ran the old one
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

  it('D-381/D-385 (ol-egov.141.89.5.24): passes sourceContentHashFor/promptVersionFor through into the enqueued contentHash, without changing the payload', async () => {
    const { enqueuer, deps } = baseDeps({
      listConceptsForCourse: async (courseCode) => [concept('Osmosis', 'ck-1', [courseCode])],
      sourceContentHashFor: async (_course, conceptKey) => `hash-of-${conceptKey}`,
      promptVersionFor: (instrumentKind) => `${instrumentKind}-v7`,
    });
    await enqueuePrimaryGenerationCallsForLandedUnits(
      [embeddedUnit('01 Courses/A/notes.md')],
      deps,
    );
    expect(enqueuer.calls).toHaveLength(1);
    const call = enqueuer.calls[0];
    expect(call?.payload).not.toHaveProperty('sourceContentHash');
    expect(call?.payload).not.toHaveProperty('promptVersion');

    // Same concept/kind, but neither dep supplied — must produce a
    // DIFFERENT contentHash than the versioned call above, proving the
    // version terms actually reached job.ts's identity functions.
    const { enqueuer: blindEnqueuer, deps: blindDeps } = baseDeps({
      listConceptsForCourse: async (courseCode) => [concept('Osmosis', 'ck-1', [courseCode])],
    });
    await enqueuePrimaryGenerationCallsForLandedUnits(
      [embeddedUnit('01 Courses/A/notes.md')],
      blindDeps,
    );
    expect(call?.contentHash).not.toBe(blindEnqueuer.calls[0]?.contentHash);
    // sourceUnitId is unaffected — same (course, concept, kind) unit either way.
    expect(call?.sourceUnitId).toBe(blindEnqueuer.calls[0]?.sourceUnitId);
  });

  it('omits sourceContentHashFor/promptVersionFor with no change in behaviour — every dep is optional and additive', async () => {
    const { enqueuer, deps } = baseDeps({
      listConceptsForCourse: async (courseCode) => [concept('Osmosis', 'ck-1', [courseCode])],
    });
    await enqueuePrimaryGenerationCallsForLandedUnits(
      [embeddedUnit('01 Courses/A/notes.md')],
      deps,
    );
    expect(enqueuer.calls).toHaveLength(1);
    expect(enqueuer.calls[0]?.payload).toMatchObject({
      trigger: 'arrival',
      instrumentKind: DEFAULT_PRIMARY_KIND_FLOOR,
    });
  });
});
