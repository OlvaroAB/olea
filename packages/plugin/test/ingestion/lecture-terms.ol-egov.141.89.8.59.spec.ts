/**
 * `ol-egov.141.89.8.59` (D-465): the term check runs in production. A request for a bundled
 * transcript part carries a term-discrepancy flag when a slide term nearly matches. Through the real
 * lecture bundles (`readLectureBundles`), the host lookup `main.ts` installs, and a real request
 * builder (`WorkerConceptReader`). Synthetic text only (INV-3).
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { VaultPath, WorkerTaskRequest } from 'olea-core';
import { describe, expect, it } from 'vitest';
import { WorkerConceptReader } from '../../src/concept/workerConceptReader.js';
import { readLectureBundles } from '../../src/ingestion/lecture-links.js';
import { lectureTermsLookup } from '../../src/ingestion/lecture-terms.js';
import { isSuppliedTranscriptPath } from '../../src/source-origin.js';

const TRANSCRIPT = 'Week 4/talk.txt' as VaultPath;
const DECK = 'Week 4/slides.pptx' as VaultPath;
const NOTE = 'Week 4/summary.md' as VaultPath;
const OTHER = 'Week 9/solo.txt' as VaultPath;

const port = {
  resolvedLinks: () =>
    new Map<VaultPath, VaultPath[]>([[NOTE, [TRANSCRIPT, DECK]]]) as ReadonlyMap<
      VaultPath,
      readonly VaultPath[]
    >,
  frontmatterFor: () => undefined,
};

const host = () => {
  const frontmatterFor = () => undefined;
  return {
    frontmatterFor,
    lectureTermsFor: lectureTermsLookup({
      bundles: () => readLectureBundles(port as never),
      conceptNamesBySource: () => new Map([[DECK, ['neighbour threshold', 'lattice']]]),
      isTranscript: (p) => isSuppliedTranscriptPath(p, { frontmatterFor }),
    }),
  };
};

class Recording {
  readonly sent: WorkerTaskRequest[] = [];
  async send(request: WorkerTaskRequest): Promise<unknown> {
    this.sent.push(request);
    return { ok: true, stamp: {}, result: { concepts: [] } };
  }
}

const passage = (path: VaultPath, text: string) => ({
  text,
  anchor: { sourcePath: path, location: { page: 1, charRange: { start: 0, end: 10 } } },
  course: 'COURSE-A',
});

describe('the term check in a production request (ol-egov.141.89.8.59)', () => {
  it('gives a bundled transcript the slides concept names, and a path in no bundle none', () => {
    const lookup = host().lectureTermsFor;
    expect(lookup(TRANSCRIPT)).toEqual(['neighbour threshold', 'lattice']);
    expect(lookup(OTHER)).toBeUndefined();
  });

  it('a bundled transcript part carries a term-discrepancy flag when a slide term nearly matches', async () => {
    const transport = new Recording();
    await new WorkerConceptReader({ transport, frontmatterHost: host() }).read({
      passages: [passage(TRANSCRIPT, 'The neighbor threshold rule fires here.')],
    });
    expect(transport.sent[0]?.payload).toEqual({
      sourceChunks: ['The neighbor threshold rule fires here.'],
      sourceChunkOrigins: [
        { kind: 'transcript', speakerRole: 'unknown', flags: ['term-discrepancy'] },
      ],
    });
  });

  it('the same words in a transcript outside any bundle carry no flag', async () => {
    const transport = new Recording();
    await new WorkerConceptReader({ transport, frontmatterHost: host() }).read({
      passages: [passage(OTHER, 'The neighbor threshold rule fires here.')],
    });
    expect(transport.sent[0]?.payload).toEqual({
      sourceChunks: ['The neighbor threshold rule fires here.'],
      sourceChunkOrigins: [{ kind: 'transcript', speakerRole: 'unknown' }],
    });
  });

  it('main.ts installs the lookup from readLectureBundles in the shared host', () => {
    const main = readFileSync(
      fileURLToPath(new URL('../../src/main.ts', import.meta.url)),
      'utf8',
    ).replace(/\/\/.*$/gm, '');
    expect(main).toMatch(
      /lectureTermsFor:\s*lectureTermsLookup\(\{\s*bundles:\s*\(\)\s*=>\s*readLectureBundles\(/,
    );
  });
});
