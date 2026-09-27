/**
 * `buildGenerationWiring`'s own `now` threading (`ol-3ux7.64.9` [WBX-8]).
 *
 * `createDraftAcceptPort` and `runGenerationSweep` already took an
 * injectable `now` before this bead (`accept.spec.ts`/`pipeline.spec.ts`
 * cover their own default-vs-injected behaviour directly) — what this bead
 * added is `GenerationWiringDeps.now`, forwarded to both from ONE place so
 * `main.ts`'s single clock seam (`this.now`) reaches the whole generation
 * composition, not just the sites `main.ts` calls directly. This file
 * proves that one forwarding hop, not the underlying ports' own behaviour a
 * second time.
 */
import type {
  DeviceCapability,
  ExtractedUnit,
  JobRunner,
  PersistedQueue,
  QueueStore,
} from 'olea-core';
import { DEFAULT_COURSES_FOLDER, hashText, IngestionQueueEngine } from 'olea-core';
import { describe, expect, it } from 'vitest';
import { extractConceptsFromVault } from '../../src/concept/wiring.js';
import type { DraftRecord } from '../../src/generation/types.js';
import { buildGenerationWiring } from '../../src/generation/wiring.js';
import {
  buildGenerationArrivalDeps,
  enqueuePrimaryGenerationCallsForLandedUnits,
} from '../../src/ingestion/generation-queue.js';
import { isoWithLocalOffset } from '../../src/review/ports.js';
import { MemoryVaultSource } from './fakes.js';

const NOTE_PATH = '01 Courses/COGS214/Week 2.md';
const STUBBED_NOW = new Date('2033-11-02T08:00:00.000Z');

function baseRecord(): DraftRecord {
  return {
    draftId: 'draft-1',
    status: 'pending',
    courseCode: 'COGS214',
    conceptName: 'Working memory',
    conceptIds: ['concept-key-1'],
    sourcePath: NOTE_PATH,
    createdAt: '2026-08-25T09:00:00-07:00',
    question: {
      stem: 'What limits working memory capacity?',
      correctAnswer: 'Chunking',
      distractors: ['A', 'B', 'C', 'D'],
      feedback: 'See the lecture notes.',
    },
    provenance: { taskId: 'quiz.generate.v1', promptVersion: '1.0.0', modelId: 'test-model' },
    firstServedAt: null,
  };
}

describe('buildGenerationWiring — now threading', () => {
  it('an injected now reaches acceptPort.reject’s resolvedAt, not real time', async () => {
    const vault = new MemoryVaultSource({ [NOTE_PATH]: '# Week 2\n\nher prose\n' });
    const wiring = buildGenerationWiring({ vault, deviceId: 'device-a', now: () => STUBBED_NOW });
    await wiring.cache.put(baseRecord());

    await wiring.acceptPort.reject('draft-1');

    const resolved = await wiring.cache.get('draft-1');
    expect(resolved?.status).toBe('rejected');
    expect(resolved?.resolvedAt).toBe(isoWithLocalOffset(STUBBED_NOW));
  });

  it('omitted, acceptPort still defaults to the real wall clock — unchanged from before this bead', async () => {
    const vault = new MemoryVaultSource({ [NOTE_PATH]: '# Week 2\n\nher prose\n' });
    const wiring = buildGenerationWiring({ vault, deviceId: 'device-a' });
    await wiring.cache.put(baseRecord());

    const before = Date.now();
    await wiring.acceptPort.reject('draft-1');
    const after = Date.now();

    const resolved = await wiring.cache.get('draft-1');
    const resolvedMs =
      resolved?.resolvedAt === undefined ? Number.NaN : Date.parse(resolved.resolvedAt);
    expect(resolvedMs).toBeGreaterThanOrEqual(before);
    expect(resolvedMs).toBeLessThanOrEqual(after + 1000);
  });
});

/**
 * `GenerationWiring.sourceContentHashFor`/`.buildPromptVersionFor`
 * (`ol-egov.141.89.5.25`, D-381/D-385) — the real, local-state-only
 * implementations `packages/plugin/src/ingestion/generation-queue.ts`'s own
 * doc named as the disclosed follow-up `ol-egov.141.89.5.24` left open.
 * Neither is wired into `main.ts`'s `deps.generation` yet (held pending
 * `[D-261]`'s spend authorisation, same as `hasAnyBuiltKind`'s own real
 * implementation, `generation-job-runner.ts`) — these tests exercise them
 * directly, and the last one drives the REAL `enqueuePrimaryGenerationCalls
 * ForLandedUnits`/`IngestionQueueEngine` pair (never a mock enqueuer) to
 * prove the acceptance criterion end to end: a prompt-version bump
 * supersedes a still-pending job without re-running it.
 */
describe('buildGenerationWiring — sourceContentHashFor / buildPromptVersionFor (ol-egov.141.89.5.25)', () => {
  const ARRIVAL_COURSE_CODE = 'COGS214';
  const ARRIVAL_NOTE_PATH = `${DEFAULT_COURSES_FOLDER}/${ARRIVAL_COURSE_CODE}/Arrival note.md`;
  const ARRIVAL_NOTE_CONTENT =
    '---\ntopic: [Working memory arrival]\ncourse: COGS214\n---\n\n# Arrival note\n\nSynthetic fixture text.\n';

  /** In-memory `QueueStore` — same role `generation-queue.spec.ts`'s own `MemoryStore` fills. */
  class MemoryStore implements QueueStore {
    private state: PersistedQueue | null = null;
    async load(): Promise<PersistedQueue | null> {
      return this.state;
    }
    async save(queue: PersistedQueue): Promise<void> {
      this.state = { ...queue, jobs: queue.jobs.map((j) => ({ ...j })) };
    }
  }

  const desktopCapability: DeviceCapability = { canDrain: true };
  /** Proves the staleness check itself never triggers a re-run: a call would mean `tick()` ran, which no test below does. */
  const neverRuns: JobRunner = async () => {
    throw new Error('JobRunner must not be called by an arrival-time staleness check');
  };

  function mcqDraftRecord(draftId: string, createdAt: string, promptVersion: string): DraftRecord {
    return {
      draftId,
      status: 'pending',
      courseCode: ARRIVAL_COURSE_CODE,
      conceptName: 'Working memory arrival',
      conceptIds: ['unused-concept-id'],
      sourcePath: ARRIVAL_NOTE_PATH,
      createdAt,
      question: {
        stem: 'Placeholder stem',
        correctAnswer: 'A',
        distractors: ['B', 'C', 'D'],
        feedback: 'Placeholder feedback',
      },
      provenance: { taskId: 'quiz.generate.v1', promptVersion, modelId: 'test-model' },
      firstServedAt: null,
    };
  }

  it("sourceContentHashFor hashes the concept's current source note — local vault read, matches hashText directly", async () => {
    const vault = new MemoryVaultSource({ [ARRIVAL_NOTE_PATH]: ARRIVAL_NOTE_CONTENT });
    const wiring = buildGenerationWiring({ vault, deviceId: 'device-a' });
    const concepts = await extractConceptsFromVault(vault, {
      under: `${DEFAULT_COURSES_FOLDER}/${ARRIVAL_COURSE_CODE}`,
    });
    expect(concepts).toHaveLength(1);
    const concept = concepts[0];
    if (concept === undefined) throw new Error('expected exactly one concept');

    const hash = await wiring.sourceContentHashFor(ARRIVAL_COURSE_CODE, concept.key);
    expect(hash).toBe(await hashText(ARRIVAL_NOTE_CONTENT));
  });

  it('sourceContentHashFor answers undefined for an unresolvable concept key — never throws', async () => {
    const vault = new MemoryVaultSource({ [ARRIVAL_NOTE_PATH]: ARRIVAL_NOTE_CONTENT });
    const wiring = buildGenerationWiring({ vault, deviceId: 'device-a' });

    const hash = await wiring.sourceContentHashFor(ARRIVAL_COURSE_CODE, 'no-such-key');
    expect(hash).toBeUndefined();
  });

  it("buildPromptVersionFor answers the most recently CREATED cached draft's promptVersion, per kind", async () => {
    const vault = new MemoryVaultSource({ [ARRIVAL_NOTE_PATH]: ARRIVAL_NOTE_CONTENT });
    const wiring = buildGenerationWiring({ vault, deviceId: 'device-a' });
    await wiring.cache.put(mcqDraftRecord('d1', '2026-01-01T00:00:00-00:00', 'v1'));
    await wiring.cache.put(mcqDraftRecord('d2', '2026-02-01T00:00:00-00:00', 'v2'));

    const promptVersionFor = await wiring.buildPromptVersionFor();
    expect(promptVersionFor('mcq')).toBe('v2');
    expect(promptVersionFor('qa')).toBeUndefined();
  });

  it('real wiring, the real engine: a prompt-version bump supersedes the still-pending arrival job, without re-running it (D-381/D-385)', async () => {
    const vault = new MemoryVaultSource({ [ARRIVAL_NOTE_PATH]: ARRIVAL_NOTE_CONTENT });
    const wiring = buildGenerationWiring({ vault, deviceId: 'device-a' });
    const unit: ExtractedUnit = {
      text: 'x',
      provenance: { sourcePath: ARRIVAL_NOTE_PATH, location: { page: 1 } },
    };
    const engine = await IngestionQueueEngine.create({
      store: new MemoryStore(),
      capability: desktopCapability,
      runner: neverRuns,
    });

    // First arrival sweep: a draft already cached under prompt version v1 is
    // the "last seen stamped" version `buildPromptVersionFor` reports.
    await wiring.cache.put(mcqDraftRecord('d1', '2026-01-01T00:00:00-00:00', 'v1'));
    const promptVersionForV1 = await wiring.buildPromptVersionFor();
    const arrivalDepsV1 = buildGenerationArrivalDeps(
      {
        enqueuer: engine,
        hasAnyBuiltKind: async () => false,
        sourceContentHashFor: wiring.sourceContentHashFor,
        promptVersionFor: promptVersionForV1,
      },
      vault,
    );
    await enqueuePrimaryGenerationCallsForLandedUnits([unit], arrivalDepsV1);
    expect(engine.snapshot().queued).toBe(1);

    // A later draft response stamps a newer prompt version. The note's own
    // content is unchanged — this isolates the prompt-version term.
    await wiring.cache.put(mcqDraftRecord('d2', '2026-02-01T00:00:00-00:00', 'v2'));
    const promptVersionForV2 = await wiring.buildPromptVersionFor();
    expect(promptVersionForV2('mcq')).toBe('v2');
    const arrivalDepsV2 = buildGenerationArrivalDeps(
      {
        enqueuer: engine,
        hasAnyBuiltKind: async () => false,
        sourceContentHashFor: wiring.sourceContentHashFor,
        promptVersionFor: promptVersionForV2,
      },
      vault,
    );
    await enqueuePrimaryGenerationCallsForLandedUnits([unit], arrivalDepsV2);

    const jobs = engine.list();
    expect(jobs).toHaveLength(2);
    const stale = jobs.filter((j) => j.status === 'failed');
    const fresh = jobs.filter((j) => j.status === 'queued');
    expect(stale).toHaveLength(1);
    expect(stale[0]?.failedReason).toContain('superseded');
    expect(fresh).toHaveLength(1);
    // Never re-run: `tick()` is never called above, and `neverRuns` throws if it ever is.
    expect(jobs.some((j) => j.status === 'done')).toBe(false);
  });
});
