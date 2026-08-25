/**
 * `materializeAcceptedDraft` tests (F3.4, F2.15, INV-6, `ol-p3t07a`).
 *
 * Proves the composition — `insertMcqBlock` + locate-the-inserted-block +
 * `stampMcqId` — actually writes a parseable, id-bearing MCQ block into the
 * note, leaving the rest of the note's bytes untouched (INV-2's spirit,
 * checked via subtraction).
 */
import { parseMcqBlocks } from 'olea-core';
import { describe, expect, it } from 'vitest';
import { materializeAcceptedDraft } from '../../src/generation/materialize-mcq.js';
import { MemoryVaultSource } from './fakes.js';

describe('materializeAcceptedDraft', () => {
  it('inserts a parseable MCQ block at the top of the note and mints a stable id', async () => {
    const notePath = '01 Courses/COGS214/Week 2.md';
    const original = '# Week 2\n\nSome of her own prose about working memory.\n';
    const vault = new MemoryVaultSource({ [notePath]: original });

    const result = await materializeAcceptedDraft(vault, {
      sourcePath: notePath,
      question: {
        stem: 'What limits working memory capacity?',
        correctAnswer: 'Chunking',
        distractors: ['A', 'B', 'C', 'D'],
        feedback: 'See the lecture notes.',
      },
    });

    expect(result.instrumentId).toMatch(/^mcq-/);

    const written = vault.raw(notePath);
    expect(written).toBeDefined();
    // Her original prose survives byte-for-byte as a suffix of the new content.
    expect(written).toContain(original);

    const { instruments, invalid } = parseMcqBlocks(written!);
    expect(invalid).toEqual([]);
    expect(instruments).toHaveLength(1);
    expect(instruments[0]?.id).toBe(result.instrumentId);
    expect(instruments[0]?.stem).toBe('What limits working memory capacity?');
    expect(instruments[0]?.feedback).toBe('See the lecture notes.');
  });

  it('a blank feedback field is refused before anything is written (mcq-generated.ts, reused unmodified)', async () => {
    const notePath = 'note.md';
    const vault = new MemoryVaultSource({ [notePath]: 'prose\n' });

    await expect(
      materializeAcceptedDraft(vault, {
        sourcePath: notePath,
        question: {
          stem: 's',
          correctAnswer: 'a',
          distractors: ['a', 'b', 'c', 'd'],
          feedback: '   ',
        },
      }),
    ).rejects.toThrow(/feedback/i);

    expect(vault.raw(notePath)).toBe('prose\n');
  });
});
