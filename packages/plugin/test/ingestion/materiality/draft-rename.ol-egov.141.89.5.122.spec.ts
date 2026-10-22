// `ol-egov.141.89.5.122` ([D-576]): a pending first draft that cites a PDF-type source has no citation
// record yet, so a rename Olea saw did not move it, and accepting it afterwards wrote its citation
// with the old path: the new question was withheld at once for a file that is not there. Now the
// rename handler (`onSourceRenamed`, which `main.ts`'s vault rename handler calls) updates the
// draft's own source path through the draft cache, path only; a move Olea did not see is still not
// followed. Every course, file and sentence here is invented.
import { hashContent, readInstrumentCitation } from 'olea-core';
import { describe, expect, it } from 'vitest';
import { createDraftAcceptPort } from '../../../src/generation/accept.js';
import { createVaultDraftCacheStore } from '../../../src/generation/cache-store.js';
import type { DraftRecord } from '../../../src/generation/types.js';
import { harness, homeNote, MemoryVault } from './transcript-fixtures.ol-egov.141.89.5.43.js';

const PDF = 'Course A/Lecture 3/slides.pdf';
const PDF_HOME = 'Course A/Lecture 3/slides.md';
const PDF_RENAMED = 'Course A/Lecture 3/lecture three slides.pdf';
const PDF_BYTES = new TextEncoder().encode('invented slide deck bytes, one version only');
const NOW = new Date('2026-10-22T10:00:00-07:00');

function pendingDraft(draftId: string, citedPath: string, revision: string): DraftRecord {
  return {
    draftId,
    status: 'pending',
    courseCode: 'COURSEA',
    conceptName: 'Invented slide topic',
    conceptIds: ['concept-key-1'],
    sourcePath: PDF_HOME,
    sourceCitation: { sourcePath: citedPath, page: 2, sourceRevision: revision },
    createdAt: '2026-10-22T09:00:00-07:00',
    question: {
      stem: 'Which invented statement about the kalomi rule holds?',
      correctAnswer: 'Alpha',
      distractors: ['Beta', 'Gamma', 'Delta', 'Epsilon'],
      feedback: 'See the invented slides.',
    },
    provenance: { taskId: 'quiz.generate.v1', promptVersion: '1.0.0', modelId: 'test-model' },
    firstServedAt: null,
  };
}

async function setUp() {
  const vault = new MemoryVault();
  vault.binaries.set(PDF, PDF_BYTES);
  vault.files.set(PDF_HOME, homeNote('Invented slide topic', []));
  const cache = createVaultDraftCacheStore(vault);
  const revision = await hashContent(PDF_BYTES);
  await cache.put(pendingDraft('draft-1', PDF, revision));
  const port = createDraftAcceptPort({
    vault,
    cache,
    deviceId: 'device-a',
    now: () => NOW,
    generateEventId: () => 'event-1',
  });
  const h = harness({ transcriptPartGrain: true });
  return { vault, cache, port, h };
}

describe('a pending draft citing a PDF-type source (ol-egov.141.89.5.122)', () => {
  it('a rename Olea saw before acceptance: the accepted question cites the new path and is served', async () => {
    const { vault, cache, port, h } = await setUp();
    vault.binaries.delete(PDF);
    vault.binaries.set(PDF_RENAMED, PDF_BYTES);
    await h.trigger.onSourceRenamed(vault, PDF, PDF_RENAMED);

    expect((await cache.get('draft-1'))?.sourceCitation?.sourcePath).toBe(PDF_RENAMED);

    const { instrumentId } = await port.accept('draft-1', 'accepted');
    expect((await readInstrumentCitation(vault, instrumentId))?.sourcePath).toBe(PDF_RENAMED);
    await h.pass(vault);
    expect(await h.withheld([instrumentId])).toEqual(new Set());
  });

  it('only the path moves: the rest of the draft and its citation stay as drafted', async () => {
    const { vault, cache, h } = await setUp();
    const before = await cache.get('draft-1');
    vault.binaries.delete(PDF);
    vault.binaries.set(PDF_RENAMED, PDF_BYTES);
    await h.trigger.onSourceRenamed(vault, PDF, PDF_RENAMED);
    const after = await cache.get('draft-1');
    expect(after).toEqual({
      ...before,
      sourceCitation: { ...before?.sourceCitation, sourcePath: PDF_RENAMED },
    });
  });

  it('a draft of another source, and a draft already accepted, are not touched', async () => {
    const { vault, cache, h } = await setUp();
    const other = pendingDraft('draft-2', 'Course A/Lecture 4/other.pdf', 'r');
    const accepted = { ...pendingDraft('draft-3', PDF, 'r'), status: 'accepted' as const };
    await cache.put(other);
    await cache.put(accepted);
    vault.binaries.delete(PDF);
    vault.binaries.set(PDF_RENAMED, PDF_BYTES);
    await h.trigger.onSourceRenamed(vault, PDF, PDF_RENAMED);
    expect(await cache.get('draft-2')).toEqual(other);
    expect(await cache.get('draft-3')).toEqual(accepted);
  });

  it('a move Olea did not see (no rename call) is not followed: accepting refuses against the missing file and writes no citation', async () => {
    const { vault, cache, port } = await setUp();
    vault.binaries.delete(PDF);
    vault.binaries.set(PDF_RENAMED, PDF_BYTES);

    expect((await cache.get('draft-1'))?.sourceCitation?.sourcePath).toBe(PDF);
    await expect(port.accept('draft-1', 'accepted')).rejects.toThrow(/never reviewed/);
    expect((await cache.get('draft-1'))?.sourceCitation?.sourcePath).toBe(PDF);
    expect((await cache.get('draft-1'))?.status).toBe('rejected');
    expect([...vault.files.keys()].filter((path) => path.startsWith('.olea/citations/'))).toEqual(
      [],
    );
  });

  it('a file that becomes a note by its new name is not the same source: the draft is left as it was', async () => {
    const { vault, cache, h } = await setUp();
    vault.binaries.delete(PDF);
    vault.files.set('Course A/Lecture 3/slides notes.md', 'invented prose\n');
    await h.trigger.onSourceRenamed(vault, PDF, 'Course A/Lecture 3/slides notes.md');
    expect((await cache.get('draft-1'))?.sourceCitation?.sourcePath).toBe(PDF);
  });
});
