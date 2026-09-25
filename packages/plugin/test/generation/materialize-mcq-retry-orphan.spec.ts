/**
 * Regression test for `ol-egov.141.89.2.8` (`.olea-harness/ilb-pra/dev-r1/
 * retry-orphan-sidecar.md`, no content — evidence lives there): an interrupted
 * materialisation used to leave a citation sidecar keyed to an id no instrument in the vault
 * carries, because `materializeAcceptedDraft` minted a fresh random id on every call.
 *
 * This wraps `MemoryVaultSource` (`./fakes.js`) so the write to the NOTE itself (`sourcePath`,
 * as opposed to a sidecar write under `.olea/`) throws — simulating a process interrupted after
 * the citation sidecar has already landed but before the note write that would have carried the
 * frozen id lands (the case's own step sequence: "attempt 1 writes a citation record, then is
 * interrupted before the distractor-provenance write — nothing else lands"). A second,
 * un-wrapped call against the same underlying vault is the retry.
 */
import {
  citationStorePath,
  type ListOptions,
  type Unsubscribe,
  type VaultEvent,
  type VaultPath,
  type VaultSource,
} from 'olea-core';
import { describe, expect, it } from 'vitest';
import { materializeAcceptedDraft } from '../../src/generation/materialize-mcq.js';
import { MemoryVaultSource } from './fakes.js';

/**
 * Fails a write to `interruptedPath` (the note `materializeAcceptedDraft` writes into) exactly
 * once, letting every sidecar write under `.olea/` (a different path) through to the wrapped
 * `MemoryVaultSource` untouched. Reproduces "interrupted after the citation sidecar landed,
 * before the note write" without needing to touch `fakes.ts` (outside this bead's `owns`).
 */
class InterruptOneNoteWriteVaultSource implements VaultSource {
  private interrupted = false;

  constructor(
    private readonly inner: MemoryVaultSource,
    private readonly interruptedPath: VaultPath,
  ) {}

  async list(options: ListOptions = {}): Promise<readonly VaultPath[]> {
    return this.inner.list(options);
  }

  async read(path: VaultPath): Promise<string> {
    return this.inner.read(path);
  }

  async readBinary(): Promise<Uint8Array> {
    return this.inner.readBinary();
  }

  async write(path: VaultPath, content: string): Promise<void> {
    if (!this.interrupted && path === this.interruptedPath) {
      this.interrupted = true;
      throw new Error('simulated interruption: process died before this write landed');
    }
    return this.inner.write(path, content);
  }

  async exists(path: VaultPath): Promise<boolean> {
    return this.inner.exists(path);
  }

  watch(handler: (event: VaultEvent) => void): Unsubscribe {
    return this.inner.watch(handler);
  }
}

describe('materializeAcceptedDraft: retry after an interrupted write (ol-egov.141.89.2.8)', () => {
  const notePath = '01 Courses/COGS214/Week 2.md';
  const original = '# Week 2\n\nSome of her own prose about working memory.\n';
  const question = {
    stem: 'What limits working memory capacity?',
    correctAnswer: 'Chunking',
    distractors: ['A', 'B', 'C', 'D'],
    feedback: 'See the lecture notes.',
  };
  const sourceCitation = { sourcePath: 'source.pdf', page: 3 };
  const draftId = 'draft-001';

  it('a retry of the SAME draft after the write is interrupted converges on the same instrument id, orphaning nothing', async () => {
    const memory = new MemoryVaultSource({ [notePath]: original });
    const interrupting = new InterruptOneNoteWriteVaultSource(memory, notePath);

    // Attempt 1: the note write is interrupted (simulated throw) after the
    // citation sidecar has already landed.
    await expect(
      materializeAcceptedDraft(interrupting, {
        sourcePath: notePath,
        question,
        sourceCitation,
        draftId,
      }),
    ).rejects.toThrow(/simulated interruption/);

    // The citation sidecar from attempt 1 is on the vault already, but the
    // note itself carries no instrument yet — exactly the interrupted state
    // the harness case reproduces.
    expect(memory.raw(notePath)).toBe(original);
    const citationFilesAfterAttempt1 = (await memory.list({ under: '.olea/citations' })).length;
    expect(citationFilesAfterAttempt1).toBe(1);

    // Attempt 2 (the retry): same draft id, same call, no interruption this time.
    const result = await materializeAcceptedDraft(memory, {
      sourcePath: notePath,
      question,
      sourceCitation,
      draftId,
    });

    // Exactly one citation sidecar exists — attempt 1's, re-used rather than
    // duplicated or orphaned — and it is keyed by the id the retry actually
    // used, not a different one attempt 1 alone knew about.
    const citationFilesAfterAttempt2 = await memory.list({ under: '.olea/citations' });
    expect(citationFilesAfterAttempt2).toHaveLength(1);
    expect(citationFilesAfterAttempt2[0]).toBe(citationStorePath(result.instrumentId));

    // The note now carries exactly one MCQ block, and it carries the SAME
    // id the (sole) citation sidecar is keyed by — no orphan.
    const written = memory.raw(notePath) ?? '';
    expect(written).toContain(`id: ${result.instrumentId}`);
  });

  it('two DIFFERENT drafts with identical sourcePath and question text derive distinct instrument ids', async () => {
    // The hole a content-only derivation would open: a regenerated
    // duplicate or two sweeps producing the same item text from the SAME
    // source are two different accepted drafts, not a retry of one — they
    // must not collide on the same instrument id the way two retries of
    // the same draft are supposed to. Same sourcePath and question on
    // both calls, so only draftId can be what tells them apart.
    const sharedNote = 'note-shared.md';
    const memory = new MemoryVaultSource({ [sharedNote]: '# Shared\n' });

    const resultA = await materializeAcceptedDraft(memory, {
      sourcePath: sharedNote,
      question,
      draftId: 'draft-alpha',
    });
    const resultB = await materializeAcceptedDraft(memory, {
      sourcePath: sharedNote,
      question,
      draftId: 'draft-beta',
    });

    expect(resultA.instrumentId).not.toBe(resultB.instrumentId);

    // Both instruments actually landed in the note, each under its own id —
    // confirming this isn't a false pass from one silently overwriting the
    // other.
    const written = memory.raw(sharedNote) ?? '';
    expect(written).toContain(`id: ${resultA.instrumentId}`);
    expect(written).toContain(`id: ${resultB.instrumentId}`);
  });
});
