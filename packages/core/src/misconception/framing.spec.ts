import { describe, expect, it } from 'vitest';
import { FORBIDDEN_VERDICT_PHRASES, misconceptionFramingLine } from './framing.js';
import type { MisconceptionRecord } from './types.js';

const CITATION = { path: 'Courses/Sample/notes.md', blockIndex: 1 };

function record(overrides: Partial<MisconceptionRecord> = {}): MisconceptionRecord {
  return {
    id: 'm-1',
    conceptId: 'concept-alpha',
    confusedWithConceptId: null,
    statement: 'Believes X always implies Y.',
    correction: 'X implies Y only under condition Z.',
    citation: CITATION,
    firstSeen: '2026-08-16T09:00:00-04:00',
    lastSeen: '2026-08-16T09:00:00-04:00',
    occurrenceCount: 1,
    status: 'active',
    originInstrumentId: 'explain-back:concept-alpha:1',
    ...overrides,
  };
}

describe('misconceptionFramingLine — M3 principle-12 framing', () => {
  it("surfaces §4.1's own recurring-active line verbatim when occurrenceCount > 1", () => {
    const line = misconceptionFramingLine(record({ status: 'active', occurrenceCount: 3 }));
    expect(line).toBe('This one keeps coming back — worth ten minutes with the source.');
  });

  it('uses a softer first-occurrence line when it has not recurred yet', () => {
    const line = misconceptionFramingLine(record({ status: 'active', occurrenceCount: 1 }));
    expect(line).not.toContain('keeps coming back');
  });

  it('a fading record reads as progress, not as a lesser verdict', () => {
    const line = misconceptionFramingLine(record({ status: 'fading' }));
    expect(line.toLowerCase()).not.toMatch(/wrong|fail/);
  });

  it('a resolved record reads as quietly settled, no praise-theatre', () => {
    const line = misconceptionFramingLine(record({ status: 'resolved' }));
    expect(line.toLowerCase()).not.toMatch(/great job|congrat|well done|score/);
  });

  it('every framing line is free of every forbidden verdict phrase — the M3 mechanical floor', () => {
    const lines = [
      misconceptionFramingLine(record({ status: 'active', occurrenceCount: 1 })),
      misconceptionFramingLine(record({ status: 'active', occurrenceCount: 5 })),
      misconceptionFramingLine(record({ status: 'fading' })),
      misconceptionFramingLine(record({ status: 'resolved' })),
    ];
    for (const line of lines) {
      for (const phrase of FORBIDDEN_VERDICT_PHRASES) {
        expect(line.toLowerCase()).not.toContain(phrase);
      }
    }
  });

  it("§4.1's own forbidden example is present in the forbidden-phrase list", () => {
    expect(FORBIDDEN_VERDICT_PHRASES).toContain('you keep getting this wrong');
  });
});
