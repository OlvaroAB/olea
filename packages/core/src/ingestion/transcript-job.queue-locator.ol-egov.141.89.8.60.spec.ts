/**
 * The queue path marks transcript parts (`ol-egov.141.89.8.60`, D-465/D-466): a part read through
 * the ingestion queue cites by part or time, never by page. Synthetic data only (INV-3).
 */
import { describe, expect, it } from 'vitest';
import { LONG_PLAIN, MemoryVault } from '../extract/transcript.fixtures.js';
import type { ExtractedUnit } from '../extract/types.js';
import { formatSourceCitation, passageGrainLabel } from '../registry/citation.js';
import { createTranscriptAwareJobRunner } from './transcript-job.js';

describe('the queue path sets the transcriptPart marker', () => {
  it('every unit a transcript job hands the sink carries it, and cites as part n, never as a page', async () => {
    const received: ExtractedUnit[] = [];
    const runner = createTranscriptAwareJobRunner({
      vault: new MemoryVault({ 'a/lecture.txt': LONG_PLAIN }),
      sink: {
        async receive(units) {
          received.push(...units);
        },
      },
      fallback: async () => ({ ok: true }),
    });
    const out = await runner({
      contentHash: 'h',
      label: 'a/lecture.txt',
      payload: { kind: 'transcript', sourcePath: 'a/lecture.txt', transcriptFormat: 'plain-text' },
      attempts: 0,
    });
    expect(out).toEqual({ ok: true });
    expect(received.length).toBeGreaterThan(2);
    for (const unit of received) {
      expect(unit.provenance.location.transcriptPart).toBeDefined();
    }
    // Ordinals stay in `page`; the registry reads them as the part number.
    expect(received.map((u) => u.provenance.location.page)).toEqual(received.map((_, i) => i + 1));
    const third = received[2];
    if (third === undefined) throw new Error('unreachable');
    const location = { sourcePath: third.provenance.sourcePath, transcriptPart: { part: 3 } };
    expect(passageGrainLabel(location)).toBe('part 3');
    expect(formatSourceCitation(location)).not.toMatch(/p\. |slide /);
  });
});
