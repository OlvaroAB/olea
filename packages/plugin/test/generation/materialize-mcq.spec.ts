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
 * `buildSuccessionEvent` rather than reimplementing them. `accept.ts` is now
 * a real production caller of this parameter (`ol-2zfj.39` —
 * `accept.spec.ts`'s own `[D-133] predecessor threading` suite exercises it
 * end to end); this suite stays as the direct, unit-level proof of the
 * stamping/append mechanics themselves.
 *
 * The third `describe` below (`[D-181]`, `ol-2zfj.52`) covers the citation
 * sidecar: a supplied `sourceCitation` is written keyed by the frozen
 * instrument id, an absent one writes no sidecar file at all (omitted,
 * never fabricated), and the last test proves the round trip end to end
 * through `enumerateVaultInstruments` — the same reader
 * `session/enumerate.spec.ts` unit-tests directly against a pre-written
 * sidecar record.
 *
 * The fourth `describe` below (`[D-220 / DIST-3]`, `ol-egov.109`,
 * `ol-0r92.52`) covers the distractor-provenance sidecar beside it: one
 * entry per distractor whose grounding survived generation, keyed by text
 * (never position — `distractor-provenance-store.ts`'s own module doc
 * explains why), no sidecar at all when nothing was grounded, and never an
 * entry for the correct answer.
 */
import {
  enumerateVaultInstruments,
  parseMcqBlocks,
  readDistractorProvenance,
  readInstrumentCitation,
  reviewLogPath,
} from 'olea-core';
import { describe, expect, it } from 'vitest';
import { ensureHomeNoteForConcept } from '../../src/generation/home-note.js';
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

  it('a leading BOM on a frontmatter note still lands the block after frontmatter, not before it (ol-2zfj.51)', async () => {
    // A BOM-prefixed note is still recognised as opening with frontmatter
    // (block/parse.ts's fix for ol-2zfj.51) — so this file's own block-0
    // special case (module doc's `ol-p3t07b` note) still inserts after it
    // rather than pushing the frontmatter down past the new MCQ block, which
    // is exactly the defect that would silently unbind the note's concept.
    const notePath = '01 Courses/COGS214/Week 2.md';
    const original = '﻿---\ncourse: coined-course\n---\n\n# Week 2\n\nSome coined prose.\n';
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

    const written = vault.raw(notePath) ?? '';
    // The BOM is still the very first byte of the file (INV-2), and the
    // frontmatter block is still first — not buried after the inserted MCQ
    // block the way it would be if this fell back to literal-offset-zero.
    expect(written.startsWith('﻿---\ncourse: coined-course\n---\n')).toBe(true);
    expect(written).toContain('Some coined prose.');

    const { instruments, invalid } = parseMcqBlocks(written);
    expect(invalid).toEqual([]);
    expect(instruments).toHaveLength(1);
    expect(instruments[0]?.id).toBe(result.instrumentId);
  });

  it("materializes into a bare-drop's home note (`[D-179]` / `[SRC-2]`) as a real, schedulable instrument — the existing path reused unmodified", async () => {
    // `pipeline.ts` and `home-note.spec.ts` cover creation/idempotency/the
    // INV-6 collision guard directly; this proves the OTHER half — that
    // once `ensureHomeNoteForConcept` hands back a note path, this file's
    // existing insert-and-stamp path needs no changes to write into it, and
    // the result actually binds through `enumerateVaultInstruments` (via
    // the `topic:` `ensureHomeNoteForConcept` grew) rather than landing
    // invisible to the queue.
    const sourcePath = '01 Courses/GEOL204/Lecture 4.pdf';
    const vault = new MemoryVaultSource();
    const notePath = await ensureHomeNoteForConcept(vault, sourcePath, 'Stratigraphy');
    if (notePath === null) throw new Error('test setup: expected a home note path');

    const result = await materializeAcceptedDraft(vault, {
      sourcePath: notePath,
      question: {
        stem: 'Which structure preserves the storm record?',
        correctAnswer: 'Hummocky stratification',
        distractors: ['Ripple lamination', 'Cementation', 'Bioturbation', 'Paraconformity'],
        feedback: 'See the lecture notes.',
      },
    });

    const enumeration = await enumerateVaultInstruments(vault);
    expect(enumeration.unbound).toEqual([]); // bound, not silently lost — see ol-p3t07b's failure mode
    const record = enumeration.records.find((r) => r.instrumentId === result.instrumentId);
    expect(record).toBeDefined();
    // Course is folder-derived (F3.1/F3.3), never read from the home note's own content.
    expect(record?.courses).toEqual(['GEOL204']);
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

// `[D-181]` (`ol-2zfj.52`) — see this file's module doc.
describe('materializeAcceptedDraft — [D-181] citation sidecar', () => {
  function question() {
    return {
      stem: 's',
      correctAnswer: 'a',
      distractors: ['w', 'x', 'y', 'z'],
      feedback: 'f',
    };
  }

  it('writes the sidecar, keyed by the frozen instrument id, when the draft carries a citation', async () => {
    const notePath = 'note-with-citation.md';
    const vault = new MemoryVaultSource({ [notePath]: 'prose\n' });

    const result = await materializeAcceptedDraft(vault, {
      sourcePath: notePath,
      question: question(),
      sourceCitation: {
        sourcePath: 'coined-source.pdf',
        page: 4,
        section: 'Coined section heading',
      },
    });

    expect(await readInstrumentCitation(vault, result.instrumentId)).toEqual({
      sourcePath: 'coined-source.pdf',
      page: 4,
      section: 'Coined section heading',
    });
  });

  it('writes no sidecar file at all when the draft carries no citation — omitted, never fabricated', async () => {
    const notePath = 'note-no-citation.md';
    const vault = new MemoryVaultSource({ [notePath]: 'prose\n' });

    const result = await materializeAcceptedDraft(vault, {
      sourcePath: notePath,
      question: question(),
    });

    expect(await readInstrumentCitation(vault, result.instrumentId)).toBeUndefined();
    expect(await vault.list({ under: '.olea/citations' })).toEqual([]);
  });

  it('end to end: enumerateVaultInstruments reads the freshly-written citation back as sourceProvenance', async () => {
    // Same bare-drop home-note fixture as the suite above, so the
    // materialized instrument is actually bound and reachable through the
    // vault-walk this citation is meant to be read by.
    const sourcePath = '01 Courses/GEOL204/Lecture 4.pdf';
    const vault = new MemoryVaultSource();
    const notePath = await ensureHomeNoteForConcept(vault, sourcePath, 'Stratigraphy');
    if (notePath === null) throw new Error('test setup: expected a home note path');

    const result = await materializeAcceptedDraft(vault, {
      sourcePath: notePath,
      question: {
        stem: 'Which structure preserves the storm record?',
        correctAnswer: 'Hummocky stratification',
        distractors: ['Ripple lamination', 'Cementation', 'Bioturbation', 'Paraconformity'],
        feedback: 'See the lecture notes.',
      },
      sourceCitation: { sourcePath, page: 4, section: 'Storm deposits' },
    });

    const enumeration = await enumerateVaultInstruments(vault);
    const record = enumeration.records.find((r) => r.instrumentId === result.instrumentId);
    expect(record).toBeDefined();
    // Never coupled to whatever grain `citationToSourceProvenance` fills
    // `location.charRange` with (`enumerate.ts`'s own concern) — only that
    // the cited document and page/section made the round trip.
    expect(record?.sourceProvenance?.sourcePath).toBe(sourcePath);
    expect(record?.sourceProvenance?.location.page).toBe(4);
    expect(record?.sourceProvenance?.location.section).toBe('Storm deposits');
  });
});

// `[D-220 / DIST-3]` (`ol-egov.109`, `ol-0r92.52`) — see this file's module doc.
describe('materializeAcceptedDraft — [D-220] distractor-provenance sidecar', () => {
  it('writes an entry per grounded distractor, keyed by the frozen instrument id', async () => {
    const notePath = 'note-with-grounding.md';
    const vault = new MemoryVaultSource({ [notePath]: 'prose\n' });

    const result = await materializeAcceptedDraft(vault, {
      sourcePath: notePath,
      question: {
        stem: 's',
        correctAnswer: 'a',
        distractors: ['w', 'x', 'y', 'z'],
        feedback: 'f',
        distractorGrounding: [
          { believes: 'Believes W', source_says: 'Source says about W' },
          { believes: 'Believes X', source_says: 'Source says about X' },
          null,
          { believes: 'Believes Z', source_says: 'Source says about Z' },
        ],
      },
    });

    expect(await readDistractorProvenance(vault, result.instrumentId)).toEqual({
      entries: [
        { text: 'w', believes: 'Believes W', source_says: 'Source says about W' },
        { text: 'x', believes: 'Believes X', source_says: 'Source says about X' },
        { text: 'z', believes: 'Believes Z', source_says: 'Source says about Z' },
      ],
    });
  });

  it('writes no sidecar file at all when distractorGrounding is absent — omitted, never fabricated', async () => {
    const notePath = 'note-no-grounding.md';
    const vault = new MemoryVaultSource({ [notePath]: 'prose\n' });

    const result = await materializeAcceptedDraft(vault, {
      sourcePath: notePath,
      question: {
        stem: 's',
        correctAnswer: 'a',
        distractors: ['w', 'x', 'y', 'z'],
        feedback: 'f',
      },
    });

    expect(await readDistractorProvenance(vault, result.instrumentId)).toBeUndefined();
    expect(await vault.list({ under: '.olea/distractor-provenance' })).toEqual([]);
  });

  it('writes no sidecar file at all when every grounding entry is null — omitted, never an empty record', async () => {
    const notePath = 'note-all-null-grounding.md';
    const vault = new MemoryVaultSource({ [notePath]: 'prose\n' });

    const result = await materializeAcceptedDraft(vault, {
      sourcePath: notePath,
      question: {
        stem: 's',
        correctAnswer: 'a',
        distractors: ['w', 'x'],
        feedback: 'f',
        distractorGrounding: [null, null],
      },
    });

    expect(await readDistractorProvenance(vault, result.instrumentId)).toBeUndefined();
    expect(await vault.list({ under: '.olea/distractor-provenance' })).toEqual([]);
  });

  it('never writes an entry for the correct answer', async () => {
    const notePath = 'note-correct-answer-check.md';
    const vault = new MemoryVaultSource({ [notePath]: 'prose\n' });

    const result = await materializeAcceptedDraft(vault, {
      sourcePath: notePath,
      question: {
        stem: 's',
        correctAnswer: 'Chunking',
        distractors: ['w', 'x'],
        feedback: 'f',
        distractorGrounding: [
          { believes: 'Believes W', source_says: 'Source says about W' },
          { believes: 'Believes X', source_says: 'Source says about X' },
        ],
      },
    });

    const found = await readDistractorProvenance(vault, result.instrumentId);
    expect(found?.entries.some((entry) => entry.text === 'Chunking')).toBe(false);
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
