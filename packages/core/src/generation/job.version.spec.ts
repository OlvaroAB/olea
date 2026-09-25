/**
 * D-381 (`ol-egov.141.89.5.18`; chg.md §11's cache-key audit) —
 * `sourceContentHash`/`promptVersion` folded into `generationJobIdentityString`.
 * Kept separate from `job.spec.ts` so the pre-existing suite's assertions
 * (identity stable for the same triple, unaffected by these new optional
 * fields) stay a clean regression signal on their own.
 */
import { describe, expect, it } from 'vitest';
import { generationJobContentHash, generationJobIdentityString } from './job.js';

describe('generationJobIdentityString — D-381 version/content term', () => {
  const base = { courseCode: 'B', conceptKey: 'ck-1', instrumentKind: 'mcq' as const };

  it('omitting both new fields produces the exact same string as before this bead (byte-identical, every current caller)', () => {
    expect(generationJobIdentityString(base)).toBe('generation:B:ck-1:mcq');
  });

  it('an unchanged version reuses the cache: identical sourceContentHash and promptVersion produce the same identity', () => {
    const a = generationJobIdentityString({ ...base, sourceContentHash: 'h1', promptVersion: 'v1' });
    const b = generationJobIdentityString({ ...base, sourceContentHash: 'h1', promptVersion: 'v1' });
    expect(a).toBe(b);
  });

  it('a bumped promptVersion changes the identity string (and therefore the contentHash) for otherwise-unchanged content', async () => {
    const v1 = generationJobIdentityString({ ...base, sourceContentHash: 'h1', promptVersion: 'v1' });
    const v2 = generationJobIdentityString({ ...base, sourceContentHash: 'h1', promptVersion: 'v2' });
    expect(v1).not.toBe(v2);

    const hashV1 = await generationJobContentHash({ ...base, sourceContentHash: 'h1', promptVersion: 'v1' });
    const hashV2 = await generationJobContentHash({ ...base, sourceContentHash: 'h1', promptVersion: 'v2' });
    expect(hashV1).not.toBe(hashV2);
  });

  it('a changed sourceContentHash changes the identity string for an unchanged promptVersion — the content-digest term the audit found entirely missing', () => {
    const a = generationJobIdentityString({ ...base, sourceContentHash: 'h1', promptVersion: 'v1' });
    const b = generationJobIdentityString({ ...base, sourceContentHash: 'h2', promptVersion: 'v1' });
    expect(a).not.toBe(b);
  });

  it('supplying the new fields never collides with the no-fields identity string for the same triple (no accidental "duplicate")', () => {
    const withoutFields = generationJobIdentityString(base);
    const withFields = generationJobIdentityString({ ...base, sourceContentHash: 'h1', promptVersion: 'v1' });
    expect(withFields).not.toBe(withoutFields);
  });
});
