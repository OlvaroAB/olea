/**
 * `ol-egov.141.89.5.73` part 1 ([D-515]): the writer and the accept guard for a non-markdown
 * source's fingerprint. `InstrumentCitation.sourceRevision` is the SHA-256 hex of the source
 * file's raw bytes (the digest the extraction queue keys its jobs by), set at draft time from the
 * drained job's hash (never by re-reading the file in the sweep), carried on the draft, written to
 * the citation sidecar at accept, and checked at accept next to the existing note guard.
 * Synthetic fixtures only.
 */
import type { ConceptRecord, ExtractedUnit } from 'olea-core';
import { hashContent, readInstrumentCitation } from 'olea-core';
import { describe, expect, it } from 'vitest';
import { createDraftAcceptPort } from '../../src/generation/accept.js';
import { createVaultDraftCacheStore } from '../../src/generation/cache-store.js';
import { StaleSourceRevisionError } from '../../src/generation/materialize-mcq.js';
import { runGenerationSweep } from '../../src/generation/pipeline.js';
import type { DraftRecord } from '../../src/generation/types.js';
import { MemoryVaultSource } from './fakes.js';

const NOTE = '01 Courses/COGS214/Week 2.md';
const PDF = '01 Courses/COGS214/Lecture 4.pdf';
const NOW = new Date('2026-08-25T10:00:00-07:00');

/** A vault that also holds raw bytes, counting binary reads. */
class BinaryVault extends MemoryVaultSource {
  readonly binary = new Map<string, Uint8Array>();
  binaryReads = 0;
  override async readBinary(path?: string): Promise<Uint8Array> {
    this.binaryReads += 1;
    const found = path === undefined ? undefined : this.binary.get(path);
    if (found === undefined) throw new Error(`not found: ${path}`);
    return found;
  }
  override async exists(path: string): Promise<boolean> {
    return this.binary.has(path) || super.exists(path);
  }
}

const bytes = (text: string): Uint8Array => new TextEncoder().encode(text);

function concept(): ConceptRecord {
  return { key: 'k1', name: 'Working memory', tier: 2, courses: ['COGS214'], sourcePaths: [NOTE] };
}

const drafted = {
  status: 'drafted' as const,
  request: { courseCode: 'COGS214', conceptName: 'Working memory', sourceChunks: ['chunk'] },
  response: {
    ok: true as const,
    stamp: { contractVersion: 1, promptVersion: '1.0.0', modelId: 'test-model' },
    result: {
      questions: [
        { stem: 'Q?', correctAnswer: 'A', distractors: ['B', 'C', 'D'], feedback: 'because' },
      ],
    },
  },
};

function unit(sourcePath: string, embeddedIn?: string): ExtractedUnit {
  return {
    text: 'x',
    provenance: {
      sourcePath,
      location: { page: 1, charRange: { start: 0, end: 1 } },
      ...(embeddedIn !== undefined
        ? { embeddedIn: { notePath: embeddedIn, blockStart: 0, blockEnd: 10 } }
        : {}),
    },
  };
}

async function sweep(vault: BinaryVault, units: ExtractedUnit[], revisions?: Map<string, string>) {
  const cache = createVaultDraftCacheStore(vault);
  await runGenerationSweep(units, {
    vault,
    cache,
    draftDeps: {} as never,
    listConceptsForCourse: async () => [concept()],
    draftForConcept: async () => drafted as never,
    ...(revisions !== undefined ? { sourceRevisions: revisions } : {}),
  });
  return cache;
}

describe('[D-515] the sweep records the drained job hash on a non-markdown citation', () => {
  it('a standalone PDF source carries sourceRevision equal to the supplied job hash, without reading the file', async () => {
    const vault = new BinaryVault({ [NOTE]: '# Week 2\n' });
    vault.binary.set(PDF, bytes('v1'));
    const jobHash = await hashContent(bytes('v1'));
    const cache = await sweep(vault, [unit(PDF)], new Map([[PDF, jobHash]]));
    const pending = await cache.listPending();
    expect(pending[0]?.sourceCitation?.sourceRevision).toBe(jobHash);
    expect(vault.binaryReads).toBe(0);
  });

  it('a PDF embedded in a note carries it too', async () => {
    const vault = new BinaryVault({ [NOTE]: '# Week 2\n' });
    const cache = await sweep(vault, [unit(PDF, NOTE)], new Map([[PDF, 'h1']]));
    expect((await cache.listPending())[0]?.sourceCitation?.sourceRevision).toBe('h1');
  });

  it('no hash supplied: no sourceRevision', async () => {
    const vault = new BinaryVault({ [NOTE]: '# Week 2\n' });
    const cache = await sweep(vault, [unit(PDF, NOTE)]);
    expect((await cache.listPending())[0]?.sourceCitation?.sourceRevision).toBeUndefined();
  });

  it('a markdown source gets none, even if a hash is supplied for it', async () => {
    const other = '01 Courses/COGS214/Other.md';
    const vault = new BinaryVault({ [NOTE]: '# Week 2\n', [other]: '# o\n' });
    const cache = await sweep(vault, [unit(other, NOTE)], new Map([[other, 'h1']]));
    expect((await cache.listPending())[0]?.sourceCitation?.sourceRevision).toBeUndefined();
  });

  it("a citation to the question's own note gets none", async () => {
    const vault = new BinaryVault({ [NOTE]: '# Week 2\n' });
    const cache = await sweep(vault, [unit(NOTE, NOTE)], new Map([[NOTE, 'h1']]));
    expect((await cache.listPending())[0]?.sourceCitation?.sourceRevision).toBeUndefined();
  });
});

describe('[D-515] accept: the guard and the sidecar', () => {
  async function setUp(draftRevision: string | undefined) {
    const vault = new BinaryVault({ [NOTE]: '# Week 2\n\nher prose\n' });
    vault.binary.set(PDF, bytes('v1'));
    const cache = createVaultDraftCacheStore(vault);
    let n = 0;
    const port = createDraftAcceptPort({
      vault,
      cache,
      deviceId: 'device-a',
      now: () => NOW,
      generateEventId: () => `event-${++n}`,
    });
    const record: DraftRecord = {
      draftId: 'draft-1',
      status: 'pending',
      courseCode: 'COGS214',
      conceptName: 'Working memory',
      conceptIds: ['k1'],
      sourcePath: NOTE,
      createdAt: '2026-08-25T09:00:00-07:00',
      sourceCitation: {
        sourcePath: PDF,
        page: 1,
        ...(draftRevision !== undefined ? { sourceRevision: draftRevision } : {}),
      },
      question: {
        stem: 'Q?',
        correctAnswer: 'A',
        distractors: ['B', 'C', 'D', 'E'],
        feedback: 'f',
      },
      provenance: { taskId: 'quiz.generate.v1', promptVersion: '1.0.0', modelId: 'test-model' },
      firstServedAt: null,
    };
    await cache.put(record);
    return { vault, cache, port };
  }

  it('the cache keeps sourceRevision on the draft (shape guard accepts it)', async () => {
    const { cache } = await setUp('abc123');
    expect((await cache.get('draft-1'))?.sourceCitation?.sourceRevision).toBe('abc123');
  });

  it('accepts when the bytes are unchanged and writes sourceRevision into the sidecar', async () => {
    const { vault, port } = await setUp(await hashContent(bytes('v1')));
    const { instrumentId } = await port.accept('draft-1', 'accepted');
    const stored = await readInstrumentCitation(vault, instrumentId);
    expect(stored?.sourceRevision).toBe(await hashContent(bytes('v1')));
  });

  it('refuses with StaleSourceRevisionError when the bytes changed since drafting, writing nothing', async () => {
    const { vault, port } = await setUp(await hashContent(bytes('v1')));
    vault.binary.set(PDF, bytes('v2'));
    const before = vault.raw(NOTE);
    await expect(port.accept('draft-1', 'accepted')).rejects.toThrow(StaleSourceRevisionError);
    expect(vault.raw(NOTE)).toBe(before);
  });

  it('a missing sourceRevision on a non-markdown citation is not refused at accept', async () => {
    const { vault, port } = await setUp(undefined);
    vault.binary.set(PDF, bytes('anything'));
    const { instrumentId } = await port.accept('draft-1', 'accepted');
    expect((await readInstrumentCitation(vault, instrumentId))?.sourceRevision).toBeUndefined();
  });
});
