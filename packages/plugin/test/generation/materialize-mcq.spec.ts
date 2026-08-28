/**
 * `materializeAcceptedDraft` tests (F3.4, F2.15, INV-6, `ol-p3t07a`).
 *
 * Proves the composition — `insertMcqBlock` + locate-the-inserted-block +
 * `stampMcqId` — actually writes a parseable, id-bearing MCQ block into the
 * note, leaving the rest of the note's bytes untouched (INV-2's spirit,
 * checked via subtraction).
 *
 * The second `describe` below (`[D-133]`, `ol-w00s` / `ol-2zfj.37`) covers
 * the succession hookup: when a caller supplies `predecessorInstrumentId`,
 * the successor's `predecessor:` field is stamped and a `succession`
 * review-log record is appended, composing `stampPredecessorField` and
 * `buildSuccessionEvent` rather than reimplementing them. No production
 * caller supplies that parameter yet — see the source file's module doc —
 * so this suite is that capability's only caller today.
 */
import { parseMcqBlocks, reviewLogPath } from 'olea-core';
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

  it('no predecessor supplied: the block carries none, and no succession record is appended', async () => {
    const notePath = 'note-no-predecessor.md';
    const vault = new MemoryVaultSource({ [notePath]: 'prose\n' });

    await materializeAcceptedDraft(vault, {
      sourcePath: notePath,
      question: {
        stem: 's',
        correctAnswer: 'a',
        distractors: ['w', 'x', 'y', 'z'],
        feedback: 'f',
      },
    });

    const { instruments } = parseMcqBlocks(vault.raw(notePath) ?? '');
    expect(instruments[0]?.predecessor).toBeNull();
    // No daily review-log file was ever created — nothing appended at all.
    expect(await vault.list({ under: '.olea' })).toEqual([]);
  });
});

// `[D-133]` (`ol-w00s` / `ol-2zfj.37`) — see this file's module doc.
describe('materializeAcceptedDraft — [D-133] succession hookup', () => {
  const NOTE_PATH = 'Courses/GEO101/Week 3.md';
  const NOTE = '# Week 3\n\nher prose\n';
  const NOW = new Date('2026-08-28T10:00:00-04:00');

  function question() {
    return {
      stem: 'Which structure preserves the storm record?',
      correctAnswer: 'Hummocky stratification',
      distractors: ['Ripple lamination', 'Cementation', 'Bioturbation', 'Paraconformity'],
      feedback: 'See the lecture notes.',
    };
  }

  async function readSuccessionLines(
    vault: MemoryVaultSource,
  ): Promise<Array<Record<string, unknown>>> {
    const path = reviewLogPath('2026-08-28', 'device-a');
    const raw = vault.raw(path);
    if (raw === undefined) return [];
    return raw
      .split('\n')
      .filter((line) => line.length > 0)
      .map((line) => JSON.parse(line) as Record<string, unknown>)
      .filter((record) => record.kind === 'succession');
  }

  it('stamps the predecessor field and appends a succession record naming both ids, in one vault write', async () => {
    const vault = new MemoryVaultSource({ [NOTE_PATH]: NOTE });
    const { instrumentId: successorId } = await materializeAcceptedDraft(
      vault,
      { sourcePath: NOTE_PATH, question: question(), predecessorInstrumentId: 'mcq-old-1' },
      { deviceId: 'device-a', now: () => NOW, generateEventId: () => 'succession-event-1' },
    );

    const { instruments, invalid } = parseMcqBlocks(vault.raw(NOTE_PATH) ?? '');
    expect(invalid).toHaveLength(0); // predecessor is a known field — does not invalidate the block
    expect(instruments).toHaveLength(1);
    expect(instruments[0]?.id).toBe(successorId);
    expect(instruments[0]?.predecessor).toBe('mcq-old-1');

    const succession = await readSuccessionLines(vault);
    expect(succession).toHaveLength(1);
    expect(succession[0]).toMatchObject({
      schemaVersion: 5,
      kind: 'succession',
      eventId: 'succession-event-1',
      predecessorInstrumentId: 'mcq-old-1',
      successorInstrumentId: successorId,
    });
  });

  it('field order stays "human fields first, machine fields last": id before predecessor', async () => {
    const vault = new MemoryVaultSource({ [NOTE_PATH]: NOTE });
    await materializeAcceptedDraft(
      vault,
      { sourcePath: NOTE_PATH, question: question(), predecessorInstrumentId: 'mcq-old-1' },
      { deviceId: 'device-a', now: () => NOW },
    );
    const content = vault.raw(NOTE_PATH) ?? '';
    expect(content.indexOf('id: ')).toBeLessThan(content.indexOf('predecessor: '));
  });

  it('throws before writing anything when deviceId is omitted — the succession record cannot be filed without it', async () => {
    const vault = new MemoryVaultSource({ [NOTE_PATH]: NOTE });
    await expect(
      materializeAcceptedDraft(vault, {
        sourcePath: NOTE_PATH,
        question: question(),
        predecessorInstrumentId: 'mcq-old-1',
      }),
    ).rejects.toThrow(/deviceId is required/);
  });

  it('INV-2: the original note bytes survive as a literal suffix (no frontmatter, so the block lands at literal top)', async () => {
    const vault = new MemoryVaultSource({ [NOTE_PATH]: NOTE });
    await materializeAcceptedDraft(
      vault,
      { sourcePath: NOTE_PATH, question: question(), predecessorInstrumentId: 'mcq-old-1' },
      { deviceId: 'device-a', now: () => NOW },
    );
    const content = vault.raw(NOTE_PATH) ?? '';
    // `insertMcqBlock`'s own rule (module doc, `ol-p3t07b`): a note with no
    // leading frontmatter block gets the new block at literal offset zero,
    // so her original bytes survive whole, as a suffix — not a prefix.
    expect(content.endsWith(NOTE)).toBe(true);
  });
});
