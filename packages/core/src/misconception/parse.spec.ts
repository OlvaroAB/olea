import { describe, expect, it } from 'vitest';
import { parseMisconceptionEvent, parseMisconceptionLog } from './parse.js';
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

describe('parseMisconceptionLog — the belief-specific field ([D-485] part 1, ol-egov.141.89.6.88)', () => {
  const STAMP = { taskId: 'task-resolve', promptVersion: '0.0.1', modelId: 'model-x' };
  const decisions = [
    { misconceptionId: 'm-1', option: 'demonstrates', provenance: STAMP },
    { misconceptionId: 'm-2', option: 'silent', provenance: STAMP },
    { misconceptionId: 'm-3', option: null, provenance: null },
  ];
  const BELIEF_SPECIFIC = {
    ...RESOLUTION,
    eventId: 'e3',
    beliefResolution: { targetMisconceptionIds: ['m-1'], decisions },
  };

  it('round-trips both shapes byte for byte (INV-2)', () => {
    for (const event of [RESOLUTION, BELIEF_SPECIFIC]) {
      const line = JSON.stringify(event);
      const parsed = parseMisconceptionEvent(JSON.parse(line));
      expect(parsed).not.toBeNull();
      expect(JSON.stringify(parsed)).toBe(line);
    }
  });

  it('a line without the field parses with no beliefResolution key at all', () => {
    const parsed = parseMisconceptionEvent(JSON.parse(JSON.stringify(RESOLUTION)));
    expect(parsed).not.toBeNull();
    expect(Object.keys(parsed ?? {})).not.toContain('beliefResolution');
  });

  it('the field holds record ids, option literals and the D7.3 stamp only (D-005)', () => {
    const parsed = parseMisconceptionEvent(JSON.parse(JSON.stringify(BELIEF_SPECIFIC)));
    const field = parsed?.kind === 'resolution-evidence' ? parsed.beliefResolution : undefined;
    expect(Object.keys(field ?? {})).toEqual(['targetMisconceptionIds', 'decisions']);
    expect(field?.decisions).toHaveLength(3);
    for (const decision of field?.decisions ?? []) {
      expect(Object.keys(decision)).toEqual(['misconceptionId', 'option', 'provenance']);
      if (decision.provenance !== null) {
        expect(Object.keys(decision.provenance)).toEqual(['taskId', 'promptVersion', 'modelId']);
      }
    }
  });

  const malformed: ReadonlyArray<readonly [string, unknown]> = [
    ['the field is null', null],
    ['the target has no decision', { targetMisconceptionIds: ['m-9'], decisions }],
    ['the target was decided silent', { targetMisconceptionIds: ['m-2'], decisions }],
    ['the target had no decision made', { targetMisconceptionIds: ['m-3'], decisions }],
    ['a target is repeated', { targetMisconceptionIds: ['m-1', 'm-1'], decisions }],
    [
      'a decision is repeated',
      { targetMisconceptionIds: ['m-1'], decisions: [...decisions, decisions[0]] },
    ],
    [
      'an option is outside the four',
      {
        targetMisconceptionIds: [],
        decisions: [{ misconceptionId: 'm-1', option: 'probably', provenance: STAMP }],
      },
    ],
    [
      'an option has no stamp',
      {
        targetMisconceptionIds: [],
        decisions: [{ misconceptionId: 'm-1', option: 'silent', provenance: null }],
      },
    ],
    [
      'a stamp has no option',
      {
        targetMisconceptionIds: [],
        decisions: [{ misconceptionId: 'm-1', option: null, provenance: STAMP }],
      },
    ],
    [
      'a record id is empty',
      {
        targetMisconceptionIds: [],
        decisions: [{ misconceptionId: '', option: 'silent', provenance: STAMP }],
      },
    ],
    [
      'a stamp has an empty prompt version',
      {
        targetMisconceptionIds: [],
        decisions: [
          { misconceptionId: 'm-1', option: 'silent', provenance: { ...STAMP, promptVersion: '' } },
        ],
      },
    ],
    ['the targets are not a list', { targetMisconceptionIds: 'm-1', decisions }],
  ];

  for (const [name, field] of malformed) {
    it(`reports the line invalid, never folding it concept-wide, when ${name}`, () => {
      const line = JSON.stringify({ ...RESOLUTION, beliefResolution: field });
      const result = parseMisconceptionLog(`${line}\n`);
      expect(result.events).toEqual([]);
      expect(result.invalidLines).toHaveLength(1);
    });
  }

  it('accepts a demonstrates decision that is not a target, and an empty field', () => {
    for (const field of [
      { targetMisconceptionIds: [], decisions },
      { targetMisconceptionIds: [], decisions: [] },
    ]) {
      const result = parseMisconceptionLog(
        `${JSON.stringify({ ...RESOLUTION, beliefResolution: field })}\n`,
      );
      expect(result.invalidLines).toEqual([]);
      expect(result.events).toHaveLength(1);
    }
  });
});
