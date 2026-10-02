// Scenarios: features/F1-sources.md "Explicit format handling for a supplied
// transcript" (ol-egov.141.89.8.49; D-465). Test id:
// @auto:core/transcript/reader.ol-egov.141.89.8.49.spec
//
// Also E2 of PERSISTENCE.md section 3: the part-rule pin (a golden enumeration
// over synthetic fixtures). All text here is invented.

import { describe, expect, it } from 'vitest';
import {
  DECLARED_MARKDOWN,
  LONG_PLAIN,
  MemoryVault,
  ONE_HUGE_PARAGRAPH,
  SHORT_PLAIN,
  UNBROKEN_TOKEN,
  UNDECLARED_MARKDOWN,
} from './transcript.fixtures.js';
import {
  declaresTranscript,
  readTranscriptFromVault,
  readTranscriptText,
  TRANSCRIPT_PART_MAX_CHARS,
  type TranscriptPart,
  transcriptPartsToUnits,
} from './transcript.js';

function partsOf(
  text: string,
  format: 'plain-text' | 'markdown' = 'plain-text',
): readonly TranscriptPart[] {
  const r = readTranscriptText(text, format);
  if (!r.ok) throw new Error(`unexpected failure: ${r.reason}`);
  return r.parts;
}

const nonWhitespace = (s: string): string => s.replace(/\s+/g, '');

describe('a plain-text transcript is read as a transcript, not as a note of hers', () => {
  it('yields ordered parts marked instructor-curated course material at document grain', () => {
    const parts = partsOf(SHORT_PLAIN);
    expect(parts.length).toBeGreaterThan(0);
    expect(parts.map((p) => p.ordinal)).toEqual(parts.map((_, i) => i + 1));
    for (const p of parts) {
      expect(p.authority).toBe('instructor-curated-course-material');
      expect(p.grain).toBe('document');
    }
  });

  it('no part is a voice exemplar or evidence of what she believes', () => {
    for (const p of partsOf(LONG_PLAIN)) {
      expect(p.voiceExemplar).toBe(false);
      expect(p.evidenceOfBelief).toBe(false);
    }
  });

  it('its units carry the ordinal in page and no section', () => {
    const units = transcriptPartsToUnits('01 Courses/A/lecture-1.txt', partsOf(SHORT_PLAIN));
    expect(units.map((u) => u.provenance.location.page)).toEqual([1]);
    expect(units[0]?.provenance.location.section).toBeUndefined();
  });
});

describe('Markdown is a transcript only when it declares so', () => {
  it('reads the declared file with the transcript reader and starts after its frontmatter', () => {
    expect(declaresTranscript(DECLARED_MARKDOWN)).toBe(true);
    const parts = partsOf(DECLARED_MARKDOWN, 'markdown');
    expect(parts[0]?.range.start).toBeGreaterThan(DECLARED_MARKDOWN.indexOf('---\n\n'));
    expect(parts.map((p) => p.text).join('')).not.toContain('role:');
  });

  it('does not read the undeclared file: it keeps the ordinary note path', async () => {
    expect(declaresTranscript(UNDECLARED_MARKDOWN)).toBe(false);
    expect(readTranscriptText(UNDECLARED_MARKDOWN, 'markdown')).toEqual({
      ok: false,
      reason: 'not-declared-transcript',
    });
    const vault = new MemoryVault({ 'a/notes.md': UNDECLARED_MARKDOWN });
    const r = await readTranscriptFromVault(vault, 'a/notes.md', 'markdown');
    expect(r.ok).toBe(false);
  });

  it('accepts both spellings of the declaration and rejects a different role', () => {
    expect(declaresTranscript('---\nrole: transcript\n---\nx\n')).toBe(true);
    expect(declaresTranscript('---\nrole: lecture_transcript\n---\nx\n')).toBe(true);
    expect(declaresTranscript('---\nrole: past-paper\n---\nx\n')).toBe(false);
    expect(declaresTranscript('no frontmatter\n')).toBe(false);
  });
});

describe('an untimed transcript gets no invented timing', () => {
  it('has an ordinal and no time range, start, end or duration', () => {
    for (const p of partsOf(LONG_PLAIN)) {
      expect(Object.keys(p).sort()).toEqual(
        [
          'authority',
          'evidenceOfBelief',
          'grain',
          'ordinal',
          'range',
          'text',
          'voiceExemplar',
        ].sort(),
      );
    }
  });

  it('keeps a timestamp-looking line as text, never reading it as timing', () => {
    const parts = partsOf('00:12:04 Welcome back.\n\n00:13:10 Next idea.\n');
    expect(parts.map((p) => p.text).join('\n')).toContain('00:12:04');
    expect(parts.every((p) => !('timeRange' in p) && !('start' in p))).toBe(true);
  });
});

describe('the original file is never written to, and each part maps back to an offset', () => {
  const fixtures: [string, string, 'plain-text' | 'markdown'][] = [
    ['short', SHORT_PLAIN, 'plain-text'],
    ['long', LONG_PLAIN, 'plain-text'],
    ['huge paragraph', ONE_HUGE_PARAGRAPH, 'plain-text'],
    ['unbroken token', UNBROKEN_TOKEN, 'plain-text'],
    ['declared markdown', DECLARED_MARKDOWN, 'markdown'],
  ];

  it.each(fixtures)(
    '%s: every part is the exact slice at its offsets, in order',
    (_n, text, fmt) => {
      const parts = partsOf(text, fmt);
      let previousEnd = 0;
      for (const p of parts) {
        expect(text.slice(p.range.start, p.range.end)).toBe(p.text);
        expect(p.range.start).toBeGreaterThanOrEqual(previousEnd);
        expect(p.text.length).toBeLessThanOrEqual(
          // A packed part may not exceed the limit; neither may a cut piece.
          TRANSCRIPT_PART_MAX_CHARS,
        );
        expect(p.text).toBe(p.text.trim());
        previousEnd = p.range.end;
      }
    },
  );

  it.each(fixtures)(
    '%s: the parts cover the body text once, in order, with no gap',
    (_n, text, fmt) => {
      const parts = partsOf(text, fmt);
      const body = fmt === 'markdown' ? text.slice(text.indexOf('\n---\n') + 5) : text;
      expect(nonWhitespace(parts.map((p) => p.text).join(''))).toBe(nonWhitespace(body));
    },
  );

  it('writes nothing: the vault sees no write and the bytes are unchanged', async () => {
    const vault = new MemoryVault({ 'a/lecture-1.txt': LONG_PLAIN });
    const result = await readTranscriptFromVault(vault, 'a/lecture-1.txt', 'plain-text');
    expect(result.ok).toBe(true);
    expect(vault.writes).toEqual([]);
    expect(await vault.read('a/lecture-1.txt')).toBe(LONG_PLAIN);
  });

  it('is deterministic over the same text', () => {
    expect(readTranscriptText(LONG_PLAIN, 'plain-text')).toEqual(
      readTranscriptText(LONG_PLAIN, 'plain-text'),
    );
  });
});

describe('edge shapes of the part rule', () => {
  it('an empty or whitespace-only transcript has zero parts (empty-document)', () => {
    for (const text of ['', '  \n\n\t\r\n']) {
      const r = readTranscriptText(text, 'plain-text');
      expect(r).toMatchObject({ ok: true, outcome: 'empty-document', parts: [] });
    }
  });

  it('a declared Markdown file with only frontmatter has zero parts', () => {
    const r = readTranscriptText('---\nrole: transcript\n---\n', 'markdown');
    expect(r).toMatchObject({ ok: true, outcome: 'empty-document' });
  });

  it('an unbroken token is cut at the limit without losing a character', () => {
    const parts = partsOf(UNBROKEN_TOKEN);
    expect(parts.map((p) => p.text.length)).toEqual([1500, 1500, 200]);
  });

  it('an astral character is never split at a hard cut', () => {
    const text = `${'x'.repeat(TRANSCRIPT_PART_MAX_CHARS - 1)}\u{1F600}${'y'.repeat(10)}`;
    const parts = partsOf(text);
    expect(parts.map((p) => p.text).join('')).toBe(text);
    for (const p of parts) expect(p.text).not.toMatch(/[\ud800-\udbff]$/);
  });
});

// E2: the part-rule pin. A change to where parts fall fails this and says why.
describe('E2 — the part rule is frozen (golden enumeration over synthetic fixtures)', () => {
  const enumerate = (text: string, fmt: 'plain-text' | 'markdown'): string =>
    partsOf(text, fmt)
      .map((p) => `${p.ordinal}:${p.range.start}-${p.range.end}`)
      .join(' ');

  const REASON =
    'The transcript part rule changed. Where parts fall is frozen once a build is installed in her vault (PERSISTENCE 2.8; open question 1). Do not update this golden to make it pass.';

  it('short plain text', () => {
    expect(enumerate(SHORT_PLAIN, 'plain-text'), REASON).toBe('1:0-173');
  });
  it('long plain text', () => {
    expect(enumerate(LONG_PLAIN, 'plain-text'), REASON).toBe(
      '1:0-1444 2:1446-2900 3:2902-4356 4:4358-5812 5:5814-7273 6:7275-8328',
    );
  });
  it('one huge paragraph', () => {
    expect(enumerate(ONE_HUGE_PARAGRAPH, 'plain-text'), REASON).toBe(
      '1:0-1498 2:1499-2998 3:2999-4499 4:4500-5509',
    );
  });
  it('unbroken token', () => {
    expect(enumerate(UNBROKEN_TOKEN, 'plain-text'), REASON).toBe(
      '1:0-1500 2:1500-3000 3:3000-3200',
    );
  });
  it('declared Markdown', () => {
    expect(enumerate(DECLARED_MARKDOWN, 'markdown'), REASON).toBe('1:51-115');
  });
});
