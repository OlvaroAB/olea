import { describe, expect, it, vi } from 'vitest';
import type { JobRunnerView, JobRunOutcome } from '../ingestion/types.js';
import { createGenerationAwareJobRunner } from './job-runner.js';

function jobView(payload: unknown): JobRunnerView {
  return { contentHash: 'hash-1', label: 'label', payload, attempts: 0 };
}

const OK: JobRunOutcome = { ok: true };

describe('createGenerationAwareJobRunner', () => {
  it('routes a generation payload to deps.draft, never to the fallback', async () => {
    const draft = vi.fn().mockResolvedValue(OK);
    const fallback = vi.fn().mockResolvedValue(OK);
    const runner = createGenerationAwareJobRunner({ draft, fallback });

    const job = jobView({
      kind: 'generation',
      courseCode: 'A',
      conceptKey: 'ck',
      conceptName: 'Photosynthesis',
      instrumentKind: 'mcq',
      trigger: 'arrival',
    });
    const outcome = await runner(job);

    expect(outcome).toBe(OK);
    expect(draft).toHaveBeenCalledWith(job);
    expect(fallback).not.toHaveBeenCalled();
  });

  it('falls through to deps.fallback for any other payload kind', async () => {
    const draft = vi.fn().mockResolvedValue(OK);
    const fallback = vi.fn().mockResolvedValue(OK);
    const runner = createGenerationAwareJobRunner({ draft, fallback });

    const job = jobView({ kind: 'source', sourcePath: 'x.pdf', format: 'pdf' });
    const outcome = await runner(job);

    expect(outcome).toBe(OK);
    expect(fallback).toHaveBeenCalledWith(job);
    expect(draft).not.toHaveBeenCalled();
  });

  it('falls through for a malformed generation-shaped payload (missing required fields)', async () => {
    const draft = vi.fn().mockResolvedValue(OK);
    const fallback = vi.fn().mockResolvedValue(OK);
    const runner = createGenerationAwareJobRunner({ draft, fallback });

    const job = jobView({ kind: 'generation', courseCode: 'A' }); // missing conceptKey/conceptName/instrumentKind/trigger
    await runner(job);

    expect(fallback).toHaveBeenCalledWith(job);
    expect(draft).not.toHaveBeenCalled();
  });
});
