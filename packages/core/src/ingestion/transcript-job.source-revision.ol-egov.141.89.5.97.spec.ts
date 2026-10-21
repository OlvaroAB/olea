/**
 * `ol-egov.141.89.5.97` ([D-518], [D-567]): a drained transcript job hands its parts to the sink
 * with the bytes hash of the version they were read from, the value a question's citation records
 * as `sourceRevision` and the citation pass compares against. A file that changes while it is read
 * is read again, never paired with another version's text. Synthetic data only (INV-3).
 */
import { describe, expect, it } from 'vitest';
import { LONG_PLAIN, MemoryVault } from '../extract/transcript.fixtures.js';
import type { ExtractedUnit } from '../extract/types.js';
import type { VaultPath } from '../vault/types.js';
import { hashContent } from './hash.js';
import { createTranscriptAwareJobRunner } from './transcript-job.js';

const PATH = 'Course A/lecture.txt';

function job() {
  return {
    contentHash: 'h',
    label: PATH,
    payload: { kind: 'transcript', sourcePath: PATH, transcriptFormat: 'plain-text' },
    attempts: 0,
  };
}

describe('a transcript job records the version its parts were read from', () => {
  it('the sink receives one entry: the path and the SHA-256 of its bytes', async () => {
    const delivered: {
      units: readonly ExtractedUnit[];
      revisions?: ReadonlyMap<string, string>;
    }[] = [];
    const runner = createTranscriptAwareJobRunner({
      vault: new MemoryVault({ [PATH]: LONG_PLAIN }),
      sink: {
        async receive(units, revisions) {
          delivered.push({ units, ...(revisions !== undefined ? { revisions } : {}) });
        },
      },
      fallback: async () => ({ ok: true }),
    });
    expect(await runner(job())).toEqual({ ok: true });
    expect(delivered).toHaveLength(1);
    const expected = await hashContent(new TextEncoder().encode(LONG_PLAIN));
    expect([...(delivered[0]?.revisions ?? new Map())]).toEqual([[PATH, expected]]);
    expect(delivered[0]?.units.every((unit) => unit.provenance.sourcePath === PATH)).toBe(true);
  });

  it('a file that changes while it is read is read again: nothing is delivered, and the job is retried', async () => {
    class ChangingVault extends MemoryVault {
      private binaryReads = 0;
      override async readBinary(path: VaultPath): Promise<Uint8Array> {
        this.binaryReads += 1;
        const text = await this.read(path);
        return new TextEncoder().encode(this.binaryReads === 1 ? text : `${text}\nA later cue.`);
      }
    }
    let delivered = 0;
    const runner = createTranscriptAwareJobRunner({
      vault: new ChangingVault({ [PATH]: LONG_PLAIN }),
      sink: {
        async receive() {
          delivered += 1;
        },
      },
      fallback: async () => ({ ok: true }),
    });
    expect(await runner(job())).toEqual({ ok: false, retryable: true });
    expect(delivered).toBe(0);
  });
});
