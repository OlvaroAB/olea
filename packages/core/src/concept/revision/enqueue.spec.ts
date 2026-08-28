/**
 * `buildSuccessorRevisionEnqueueInput` — the queue-payload half of a
 * `'revised'` outcome. INV-3: every string here is coined.
 */

import { describe, expect, it } from 'vitest';
import { buildSuccessorRevisionEnqueueInput } from './enqueue.js';
import type { RevisionEvent } from './types.js';

describe('buildSuccessorRevisionEnqueueInput', () => {
  const event: RevisionEvent = {
    instrumentId: 'inst-001',
    at: 1_000,
    oldContentHash: 'aaaa',
    newContentHash: 'bbbb',
    change: 'the claim changed',
  };

  it('keys contentHash on the NEW passage hash, for cross-device idempotency', () => {
    const result = buildSuccessorRevisionEnqueueInput(event, 'the updated passage text');
    expect(result.contentHash).toBe('bbbb');
  });

  it('labels the job with the predecessor instrument id', () => {
    const result = buildSuccessorRevisionEnqueueInput(event, 'the updated passage text');
    expect(result.label).toBe('instrument-revision:inst-001');
  });

  it('carries the new passage text and predecessor id in the payload, opaque to the engine', () => {
    const result = buildSuccessorRevisionEnqueueInput(event, 'the updated passage text');
    expect(result.payload).toEqual({
      kind: 'instrument-revision',
      predecessorInstrumentId: 'inst-001',
      newPassageText: 'the updated passage text',
    });
  });
});
