/**
 * `materializeAcceptedCardDraft` tests (F2.1, F3.4, INV-6, `ol-0r92.116`,
 * ruling `[D-353]`).
 *
 * Mirrors `materialize-mcq.spec.ts`'s own structure, adapted for the card
 * shape and the position-derived identity `[D-353]`'s clarification calls
 * for (see `materialize-card.ts`'s module doc, "THE IDENTITY DERIVATION"):
 *
 * 1. Basic insertion: a parseable Q&A card lands at the top of the note, her
 *    prose survives as a byte-for-byte suffix, and the minted id is a real
 *    `provisionalInstrumentId` — not a hand-rolled format — which the last
 *    test in this file proves directly by recomputing the SAME derivation
 *    from what `parseCards` reads back off the written note.
 * 2. A blank front/back is refused before anything is written.
 * 3. Frontmatter-aware insertion (the identical `ol-p3t07b` fact
 *    `materialize-mcq.spec.ts` pins for MCQ).
 * 4. The `ol-0r92.87` stale-input guard.
 * 5. The retry-orphan fix (`ol-egov.141.89.2.8`'s argument, restated for a
 *    card's block id instead of an MCQ's `id:` field) — same
 *    `InterruptOneNoteWriteVaultSource` wrapper
 *    `materialize-mcq-retry-orphan.spec.ts` defines locally, reproduced here
 *    rather than moved into `fakes.ts` (outside this bead's `owns`).
 */
import {
  citationStorePath,
  type ListOptions,
  parseCards,
  provisionalInstrumentId,
  type Unsubscribe,
  type VaultEvent,
  type VaultPath,
  type VaultSource,
} from 'olea-core';
import { describe, expect, it } from 'vitest';
import {
  materializeAcceptedCardDraft,
  StaleSourceRevisionError,
} from '../../src/generation/materialize-card.js';
import { MemoryVaultSource } from './fakes.js';

const CARD = { front: 'What limits working memory capacity?', back: 'Chunking' };

describe('materializeAcceptedCardDraft', () => {
  it('inserts a parseable Q&A card at the top of the note and mints a provisional, position-derived id', async () => {
    const notePath = '01 Courses/COGS214/Week 2.md';
    const original = '# Week 2\n\nSome of her own prose about working memory.\n';
    const vault = new MemoryVaultSource({ [notePath]: original });

    const result = await materializeAcceptedCardDraft(vault, {
      sourcePath: notePath,
      card: CARD,
    });

    expect(result.instrumentId).toMatch(/^prov1:/);

    const written = vault.raw(notePath);
    expect(written).toBeDefined();
    // Her original prose survives byte-for-byte as a suffix of the new content.
    expect(written).toContain(original);

    const cards = parseCards(written!);
    expect(cards).toHaveLength(1);
    const card = cards[0];
    expect(card?.type).toBe('qa');
    if (card?.type === 'qa') {
      expect(card.front).toBe(CARD.front);
      expect(card.back).toBe(CARD.back);
      expect(card.blockId).not.toBeNull();
    }
  });

  it('a blank front or back is refused before anything is written', async () => {
    const notePath = 'note.md';
    const vault = new MemoryVaultSource({ [notePath]: 'prose\n' });

    await expect(
      materializeAcceptedCardDraft(vault, { sourcePath: notePath, card: { front: '   ', back: 'x' } }),
    ).rejects.toThrow(/front and a back/);
    expect(vault.raw(notePath)).toBe('prose\n');

    await expect(
      materializeAcceptedCardDraft(vault, { sourcePath: notePath, card: { front: 'x', back: '  ' } }),
    ).rejects.toThrow(/front and a back/);
    expect(vault.raw(notePath)).toBe('prose\n');
  });

  it('a leading frontmatter block: the card lands after it, never before (ol-p3t07b, same fact materialize-mcq.ts pins)', async () => {
    const notePath = '01 Courses/COGS214/Week 2.md';
    const original = '---\ncourse: COGS214\ntopic: "[[Working memory]]"\n---\n\n# Week 2\n\nSome prose.\n';
    const vault = new MemoryVaultSource({ [notePath]: original });

    await materializeAcceptedCardDraft(vault, { sourcePath: notePath, card: CARD });

    const written = vault.raw(notePath) ?? '';
    // Frontmatter is still the very first thing in the note.
    expect(written.startsWith('---\ncourse: COGS214\n')).toBe(true);
    // And the card landed after it, before her own prose heading survives intact.
    expect(written).toContain(original.slice(original.indexOf('# Week 2')));
  });

  it('ol-0r92.87: a mismatched expectedSourceContentHash refuses before anything is written', async () => {
    const notePath = 'note.md';
    const vault = new MemoryVaultSource({ [notePath]: 'her unchanged prose\n' });

    await expect(
      materializeAcceptedCardDraft(vault, {
        sourcePath: notePath,
        card: CARD,
        expectedSourceContentHash: 'not-the-real-hash',
      }),
    ).rejects.toThrow(StaleSourceRevisionError);

    expect(vault.raw(notePath)).toBe('her unchanged prose\n');
  });

  it('the returned instrumentId is exactly what provisionalInstrumentId derives from what parseCards reads back — the D-353 identity-reuse claim, proved directly', async () => {
    const notePath = 'note-no-frontmatter.md';
    const vault = new MemoryVaultSource({ [notePath]: '# A note with no frontmatter\n' });

    const result = await materializeAcceptedCardDraft(vault, {
      sourcePath: notePath,
      card: CARD,
      draftId: 'draft-identity-1',
    });

    const written = vault.raw(notePath) ?? '';
    const card = parseCards(written).find((c) => c.type === 'qa' && c.blockId !== null);
    expect(card).toBeDefined();

    // The SAME exported function a later vault walk (`enumerate.ts`) would
    // call, given the SAME inputs a fresh read of this note now yields — no
    // note-uid frontmatter, so `noteUid: null`; the card's own stamped block
    // id as the anchor; ordinal 1, since nothing else in the vault shares
    // that anchor.
    const expected = provisionalInstrumentId({
      noteUid: null,
      notePath,
      blockId: card?.type === 'qa' ? card.blockId : null,
      heading: null,
      ordinal: 1,
      explicitId: null,
      instrumentType: 'qa',
    });
    expect(result.instrumentId).toBe(expected);
  });
});

/**
 * Same wrapper `materialize-mcq-retry-orphan.spec.ts` defines locally —
 * fails a write to `interruptedPath` (the note) exactly once, letting a
 * sidecar write under `.olea/` through untouched.
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

describe('materializeAcceptedCardDraft: retry after an interrupted write (ol-egov.141.89.2.8, restated for cards)', () => {
  const notePath = '01 Courses/COGS214/Week 2.md';
  const original = '# Week 2\n\nSome of her own prose about working memory.\n';
  const sourceCitation = { sourcePath: 'source.pdf', page: 3 };
  const draftId = 'draft-001';

  it('a retry of the SAME draft after the write is interrupted converges on the same instrument id, orphaning nothing', async () => {
    const memory = new MemoryVaultSource({ [notePath]: original });
    const interrupting = new InterruptOneNoteWriteVaultSource(memory, notePath);

    await expect(
      materializeAcceptedCardDraft(interrupting, {
        sourcePath: notePath,
        card: CARD,
        sourceCitation,
        draftId,
      }),
    ).rejects.toThrow(/simulated interruption/);

    expect(memory.raw(notePath)).toBe(original);
    const citationFilesAfterAttempt1 = (await memory.list({ under: '.olea/citations' })).length;
    expect(citationFilesAfterAttempt1).toBe(1);

    const result = await materializeAcceptedCardDraft(memory, {
      sourcePath: notePath,
      card: CARD,
      sourceCitation,
      draftId,
    });

    const citationFilesAfterAttempt2 = await memory.list({ under: '.olea/citations' });
    expect(citationFilesAfterAttempt2).toHaveLength(1);
    expect(citationFilesAfterAttempt2[0]).toBe(citationStorePath(result.instrumentId));

    const written = memory.raw(notePath) ?? '';
    const cards = parseCards(written);
    expect(cards).toHaveLength(1); // not two — the retry did not insert a second card
  });

  it('two DIFFERENT drafts with identical sourcePath and card text derive distinct instrument ids', async () => {
    const sharedNote = 'note-shared.md';
    const memory = new MemoryVaultSource({ [sharedNote]: '# Shared\n' });

    const resultA = await materializeAcceptedCardDraft(memory, {
      sourcePath: sharedNote,
      card: CARD,
      draftId: 'draft-alpha',
    });
    const resultB = await materializeAcceptedCardDraft(memory, {
      sourcePath: sharedNote,
      card: CARD,
      draftId: 'draft-beta',
    });

    expect(resultA.instrumentId).not.toBe(resultB.instrumentId);

    const written = memory.raw(sharedNote) ?? '';
    const cards = parseCards(written);
    expect(cards).toHaveLength(2);
  });
});
