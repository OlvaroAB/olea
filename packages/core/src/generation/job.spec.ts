import { describe, expect, it } from 'vitest';
import {
  buildGenerationJobPayload,
  generationJobContentHash,
  generationJobIdentityString,
} from './job.js';

describe('generationJobIdentityString / generationJobContentHash', () => {
  it('is stable for the same (course, concept, kind) triple', async () => {
    const input = { courseCode: 'B', conceptKey: 'ck-1', instrumentKind: 'mcq' as const };
    expect(generationJobIdentityString(input)).toBe(generationJobIdentityString(input));
    expect(await generationJobContentHash(input)).toBe(await generationJobContentHash(input));
  });

  it('differs when the kind differs — D-238 "the unit is the call": a different kind is a different call', async () => {
    const base = { courseCode: 'B', conceptKey: 'ck-1' };
    const mcq = await generationJobContentHash({ ...base, instrumentKind: 'mcq' });
    const qa = await generationJobContentHash({ ...base, instrumentKind: 'qa' });
    expect(mcq).not.toBe(qa);
  });

  it('differs when the concept differs', async () => {
    const base = { courseCode: 'B', instrumentKind: 'mcq' as const };
    const a = await generationJobContentHash({ ...base, conceptKey: 'ck-1' });
    const b = await generationJobContentHash({ ...base, conceptKey: 'ck-2' });
    expect(a).not.toBe(b);
  });

  it('produces a 64-character lowercase hex string, the same shape every ingestion contentHash uses', async () => {
    const hash = await generationJobContentHash({
      courseCode: 'A',
      conceptKey: 'ck',
      instrumentKind: 'cloze',
    });
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe('buildGenerationJobPayload', () => {
  it('carries every field through, tagged kind: generation', () => {
    const payload = buildGenerationJobPayload({
      courseCode: 'C',
      conceptKey: 'ck-9',
      conceptName: 'Osmosis',
      instrumentKind: 'qa',
      trigger: 'arrival',
    });
    expect(payload).toEqual({
      kind: 'generation',
      courseCode: 'C',
      conceptKey: 'ck-9',
      conceptName: 'Osmosis',
      instrumentKind: 'qa',
      trigger: 'arrival',
    });
  });
});
