/**
 * The batch trigger (`[EXT-5]`, `ol-2zfj.7`) — batch boundaries only, never
 * per document arrival. This suite is the acceptance criteria's "a test
 * fails on the wrong trigger" oracle.
 */

import { describe, expect, it } from 'vitest';
import { shouldRunCorpusRelationBatch } from './trigger.js';

describe('shouldRunCorpusRelationBatch', () => {
  it('fires on an ingestion session closing, regardless of concept count', () => {
    const result = shouldRunCorpusRelationBatch({
      ingestionSessionClosed: true,
      newConceptsSinceLastRun: 0,
      n: 20,
    });
    expect(result.shouldRun).toBe(true);
    expect(result.reason).toBe('ingestion-session-closed');
  });

  it('fires once N new concepts have accumulated, with no session boundary', () => {
    const result = shouldRunCorpusRelationBatch({
      ingestionSessionClosed: false,
      newConceptsSinceLastRun: 20,
      n: 20,
    });
    expect(result.shouldRun).toBe(true);
    expect(result.reason).toBe('concept-threshold-reached');
  });

  it('does NOT fire below the threshold with no session boundary', () => {
    const result = shouldRunCorpusRelationBatch({
      ingestionSessionClosed: false,
      newConceptsSinceLastRun: 19,
      n: 20,
    });
    expect(result.shouldRun).toBe(false);
    expect(result.reason).toBeUndefined();
  });

  it('NEVER fires from a per-document shape — the input type has no such field to pass', () => {
    // This is the structural half of the guarantee: TypeScript's own shape
    // for CorpusRelationBatchTriggerInput has no `documentArrived` (or
    // similarly per-document) field, so a caller cannot wire this function
    // to the per-document ingestion event even by accident. The behavioural
    // half: a single document arriving changes neither boundary by itself
    // — it must first cross the N threshold or close a session, proven by
    // the two negative-and-positive cases above.
    const singleDocumentArrival = {
      ingestionSessionClosed: false,
      newConceptsSinceLastRun: 1,
      n: 20,
    };
    expect(shouldRunCorpusRelationBatch(singleDocumentArrival).shouldRun).toBe(false);
  });

  it('N is required — omitting it is a type error, not a silently chosen default', () => {
    // @ts-expect-error — n has no default, per this module's doc.
    shouldRunCorpusRelationBatch({ ingestionSessionClosed: false, newConceptsSinceLastRun: 5 });
  });
});
