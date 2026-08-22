import { describe, expect, it } from 'vitest';
import { parseMisconceptionLog } from './parse.js';
import type { MisconceptionEvent } from './types.js';

const OBSERVED: MisconceptionEvent = {
  schemaVersion: 1,
  kind: 'observed',
  eventId: 'e1',
  timestamp: '2026-08-16T09:00:00-04:00',
  originInstrumentId: 'explain-back:concept-alpha:1',
  originReviewEventId: null,
  misconceptionId: 'm-1',
  conceptId: 'concept-alpha',
  confusedWithConceptId: null,
  statement: 'Believes X always implies Y.',
  correction: 'X implies Y only under condition Z.',
  citation: { path: 'Courses/Sample/notes.md', blockIndex: 1 },
};

const RESOLUTION: MisconceptionEvent = {
  schemaVersion: 1,
  kind: 'resolution-evidence',
  eventId: 'e2',
  timestamp: '2026-08-16T10:00:00-04:00',
  originInstrumentId: 'explain-back:concept-alpha:2',
  originReviewEventId: 'review-e2',
  conceptId: 'concept-alpha',
  evidenceKind: 'explanation',
};

describe('parseMisconceptionLog', () => {
  it('parses a well-formed observed and resolution-evidence line', () => {
    const content = `${JSON.stringify(OBSERVED)}\n${JSON.stringify(RESOLUTION)}\n`;
    const result = parseMisconceptionLog(content);
    expect(result.events).toEqual([OBSERVED, RESOLUTION]);
    expect(result.invalidLines).toEqual([]);
  });

  it('tolerates a crash-truncated trailing line: reports it, keeps every complete record around it', () => {
    const content = `${JSON.stringify(OBSERVED)}\n{"schemaVersion":1,"kind":"observ`;
    const result = parseMisconceptionLog(content);
    expect(result.events).toEqual([OBSERVED]);
    expect(result.invalidLines).toHaveLength(1);
    expect(result.invalidLines[0]?.lineNumber).toBe(2);
  });

  it('tolerates a blank line silently, not as an invalid line', () => {
    const content = `${JSON.stringify(OBSERVED)}\n\n${JSON.stringify(RESOLUTION)}\n`;
    const result = parseMisconceptionLog(content);
    expect(result.events).toEqual([OBSERVED, RESOLUTION]);
    expect(result.invalidLines).toEqual([]);
  });

  it('reports a line whose kind is unrecognised, rather than throwing', () => {
    const badLine = JSON.stringify({ ...OBSERVED, kind: 'something-else' });
    const result = parseMisconceptionLog(`${badLine}\n`);
    expect(result.events).toEqual([]);
    expect(result.invalidLines).toHaveLength(1);
  });

  it('rejects an observed line missing a required field', () => {
    const { statement: _drop, ...withoutStatement } = OBSERVED;
    const result = parseMisconceptionLog(`${JSON.stringify(withoutStatement)}\n`);
    expect(result.events).toEqual([]);
    expect(result.invalidLines).toHaveLength(1);
  });

  it('rejects a resolution-evidence line with an evidenceKind outside recall/explanation', () => {
    const bad = { ...RESOLUTION, evidenceKind: 'recognition' };
    const result = parseMisconceptionLog(`${JSON.stringify(bad)}\n`);
    expect(result.events).toEqual([]);
    expect(result.invalidLines).toHaveLength(1);
  });

  it('rejects a schemaVersion this build does not understand, rather than guessing its shape', () => {
    const bad = { ...OBSERVED, schemaVersion: 99 };
    const result = parseMisconceptionLog(`${JSON.stringify(bad)}\n`);
    expect(result.events).toEqual([]);
    expect(result.invalidLines).toHaveLength(1);
  });

  it('returns an empty result for empty content, without throwing', () => {
    const result = parseMisconceptionLog('');
    expect(result.events).toEqual([]);
    expect(result.invalidLines).toEqual([]);
  });
});
