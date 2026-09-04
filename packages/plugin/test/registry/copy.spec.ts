import type { SoloLevel } from 'olea-contracts';
import type { RegistryInstrumentSummary } from 'olea-core';
import { describe, expect, it } from 'vitest';
import {
  aliasesLine,
  coursesLine,
  DUPLICATE_TITLE_LABEL,
  duplicateTitleLine,
  EXPLAIN_BACK_HISTORY_CONTESTED_MARKER,
  EXPLAIN_BACK_HISTORY_HEADING,
  explainBackDepthPhrase,
  explainBackHistoryRowLine,
  explainBackLine,
  instrumentLabel,
  instrumentMixLine,
  masteryStatedLine,
  NOTE_OFFER_ACCEPT_ACTION,
  NOTE_OFFER_DECLINE_ACTION,
  NOTE_OFFER_LINE,
  NOTHING_BUILT_YET_LABEL,
  REGISTRY_ALL_FILTER_LABEL,
  REGISTRY_CLOSE_ACTION,
  REGISTRY_FILTER_EMPTY_LINE,
  REGISTRY_NEEDS_TENDING_FILTER_LABEL,
  REGISTRY_NOTHING_BUILT_FILTER_LABEL,
  REGISTRY_OPEN_ACTION,
  REGISTRY_PUT_IT_BACK_ACTION,
  REGISTRY_WITHDRAWN_FILTER_LABEL,
  REGISTRY_WITHDRAWN_KEPT_LABEL,
  RESTORE_CONCEPT_ACTION,
  RESTORE_INSTRUMENT_ACTION,
  registryAggregateLine,
  THIN_NOTE_LABEL,
  thinNoteLine,
  vitalityLabel,
  WITHDRAW_CONCEPT_ACTION,
  WITHDRAW_INSTRUMENT_ACTION,
  WITHDRAWN_LABEL,
  WITHDRAWN_NOTE,
} from '../../src/registry/copy.js';

function instrument(
  type: RegistryInstrumentSummary['instrumentType'],
  pruned = false,
): RegistryInstrumentSummary {
  return {
    instrumentId: `test:${type}:${pruned ? 'withdrawn' : 'active'}`,
    instrumentType: type,
    conceptIds: ['test:concept'],
    notePath: '05 Zettelkasten/Test note.md',
    noteTitle: 'Test note',
    blockId: null,
    heading: null,
    sourceLocations: [],
    explainBackHistory: [],
    pruned,
  };
}

const ALL_SOLO_LEVELS: readonly SoloLevel[] = [
  'prestructural',
  'unistructural',
  'multistructural',
  'relational',
  'extended-abstract',
];

/** Every exported string constant/function's output this module owns, gathered once so the vocabulary sweep below is exhaustive rather than a hand-picked sample. */
function everyStringThisModuleCanProduce(): readonly string[] {
  return [
    WITHDRAWN_LABEL,
    WITHDRAWN_NOTE,
    WITHDRAW_CONCEPT_ACTION,
    RESTORE_CONCEPT_ACTION,
    WITHDRAW_INSTRUMENT_ACTION,
    RESTORE_INSTRUMENT_ACTION,
    vitalityLabel('holding'),
    vitalityLabel('tending'),
    vitalityLabel('early'),
    coursesLine([]),
    coursesLine(['TESTC101']),
    aliasesLine(['Old name']) ?? '',
    explainBackLine({ attempted: true, attemptCount: 2 }) ?? '',
    instrumentLabel('qa'),
    instrumentLabel('cloze'),
    instrumentLabel('mcq'),
    masteryStatedLine('sapling', { value: 'holding', weakest: null, instrumentsRead: 0 }),
    EXPLAIN_BACK_HISTORY_HEADING,
    EXPLAIN_BACK_HISTORY_CONTESTED_MARKER,
    ...ALL_SOLO_LEVELS.map((level) => explainBackDepthPhrase(level)),
    explainBackHistoryRowLine({
      eventId: 'r-eb-1',
      timestamp: '2026-01-10T09:00:00-04:00',
      soloLevel: 'relational',
      contested: false,
    }),
    explainBackHistoryRowLine({
      eventId: 'r-eb-2',
      timestamp: '2026-01-20T09:00:00-04:00',
      soloLevel: 'prestructural',
      contested: true,
    }),
    NOTE_OFFER_LINE,
    NOTE_OFFER_ACCEPT_ACTION,
    NOTE_OFFER_DECLINE_ACTION,
    DUPLICATE_TITLE_LABEL,
    duplicateTitleLine(['05 Zettelkasten/Test note.md', '05 Zettelkasten/Other/Test note.md']),
    THIN_NOTE_LABEL,
    thinNoteLine(0),
    thinNoteLine(1),
    thinNoteLine(6),
    REGISTRY_ALL_FILTER_LABEL,
    REGISTRY_NEEDS_TENDING_FILTER_LABEL,
    REGISTRY_NOTHING_BUILT_FILTER_LABEL,
    REGISTRY_WITHDRAWN_FILTER_LABEL,
    REGISTRY_OPEN_ACTION,
    REGISTRY_CLOSE_ACTION,
    REGISTRY_PUT_IT_BACK_ACTION,
    NOTHING_BUILT_YET_LABEL,
    REGISTRY_WITHDRAWN_KEPT_LABEL,
    REGISTRY_FILTER_EMPTY_LINE,
    registryAggregateLine(0, 0),
    registryAggregateLine(1, 0),
    registryAggregateLine(27, 2),
    instrumentMixLine([]),
    instrumentMixLine([instrument('qa', true)]),
    instrumentMixLine([instrument('qa'), instrument('qa'), instrument('cloze'), instrument('mcq')]),
  ];
}

describe('registry copy — vocabulary registry compliance', () => {
  it('no action label offers Delete — F8.5 hard clamp: no surface may offer Delete', () => {
    // The clamp is about the AFFORDANCE, not the word: F8.5 also requires
    // stating, as a fact, that nothing is deleted (`WITHDRAWN_NOTE` does
    // exactly that) — a hard ban on the substring would make honestly
    // reassuring her impossible. What must never appear is a *button* or
    // *action* reading "Delete".
    const actionLabels = [
      WITHDRAW_CONCEPT_ACTION,
      RESTORE_CONCEPT_ACTION,
      WITHDRAW_INSTRUMENT_ACTION,
      RESTORE_INSTRUMENT_ACTION,
    ];
    for (const label of actionLabels) {
      expect(label.toLowerCase()).not.toContain('delete');
    }
  });

  it('WITHDRAWN_NOTE states the "not deleted" fact without ever offering a Delete action alongside it', () => {
    expect(WITHDRAWN_NOTE.toLowerCase()).toContain('nothing is deleted');
  });

  it('never prints "graft" or "offshoot" — [D-135]: graft never printed, offshoot stays internal', () => {
    for (const line of everyStringThisModuleCanProduce()) {
      expect(line.toLowerCase()).not.toContain('graft');
      expect(line.toLowerCase()).not.toContain('offshoot');
    }
  });

  it('never prints "split" or "merge" — no shipped affordance for either ([D-135], F8.6)', () => {
    for (const line of everyStringThisModuleCanProduce()) {
      expect(line.toLowerCase()).not.toContain('split');
      expect(line.toLowerCase()).not.toContain('merge');
    }
  });

  it('never prints "prune" — registry §3: prefer the plain term in student-facing copy', () => {
    for (const line of everyStringThisModuleCanProduce()) {
      expect(line.toLowerCase()).not.toContain('prune');
    }
  });

  it('withdrawal copy states a fact about the record, never a compliance judgement', () => {
    expect(WITHDRAWN_NOTE.toLowerCase()).not.toMatch(/should|must|forgot|behind/);
  });
});

describe('vitalityLabel', () => {
  it('renders the three ratified words exactly (registry §1)', () => {
    expect(vitalityLabel('holding')).toBe('holding');
    expect(vitalityLabel('tending')).toBe('needs tending');
    expect(vitalityLabel('early')).toBe('too early to say');
  });
});

describe('masteryStatedLine', () => {
  it('states stage and vitality together, never a distribution (registry §1 — "one concept... stated")', () => {
    const line = masteryStatedLine('sapling', {
      value: 'tending',
      weakest: null,
      instrumentsRead: 1,
    });
    expect(line).toBe('sapling — needs tending');
  });
});

describe('coursesLine', () => {
  it('states no association as a fact, never as a gap to fill', () => {
    expect(coursesLine([])).toBe('No course association yet.');
  });

  it('lists every course, verbatim, M:N', () => {
    expect(coursesLine(['TESTC101', 'TESTC202'])).toBe('courses: TESTC101, TESTC202');
  });
});

describe('aliasesLine', () => {
  it('is null with no prior name', () => {
    expect(aliasesLine([])).toBeNull();
  });

  it('states the prior name as a fact', () => {
    expect(aliasesLine(['Old name'])).toBe('Previous name: Old name');
  });
});

describe('explainBackLine', () => {
  it('is null when never attempted', () => {
    expect(explainBackLine({ attempted: false, attemptCount: 0 })).toBeNull();
  });

  it('states the count, never a judgement about whether it is enough', () => {
    expect(explainBackLine({ attempted: true, attemptCount: 1 })).toBe('Explained back 1 time.');
  });
});

// Scenario: olea-service/features/F8-concepts-scope.md — "F8.4b — The
// explain-back history surface", tagged `@auto:plugin/registry/copy.spec`.
describe('explainBackDepthPhrase (F8.4b, GLOSSARY SOLO rule 5)', () => {
  it('never prints the raw SOLO enum name for any level', () => {
    for (const level of ALL_SOLO_LEVELS) {
      expect(explainBackDepthPhrase(level).toLowerCase()).not.toBe(level);
      expect(explainBackDepthPhrase(level).toLowerCase()).not.toContain(level);
    }
  });

  it('never prints a number, for any level', () => {
    for (const level of ALL_SOLO_LEVELS) {
      expect(explainBackDepthPhrase(level)).not.toMatch(/\d/);
    }
  });

  it('the top level matches the vocabulary registry\'s own V5 worked example verbatim ("explained at full depth")', () => {
    expect(explainBackDepthPhrase('extended-abstract')).toBe('at full depth');
  });

  it('every level produces a distinct phrase — no two SOLO levels collapse to the same reported reading', () => {
    const phrases = ALL_SOLO_LEVELS.map((level) => explainBackDepthPhrase(level));
    expect(new Set(phrases).size).toBe(ALL_SOLO_LEVELS.length);
  });
});

describe('explainBackHistoryRowLine (F8.4b)', () => {
  it('states the depth phrase and the date, with no contested marker on an uncontested row', () => {
    const line = explainBackHistoryRowLine({
      eventId: 'r-eb-1',
      timestamp: '2026-01-10T09:00:00-04:00',
      soloLevel: 'relational',
      contested: false,
    });
    expect(line).toBe('Explained with the points tied together on 10 Jan 2026.');
  });

  it('appends the [D-095] contested marker, naming the re-review state, when this row is contested', () => {
    const line = explainBackHistoryRowLine({
      eventId: 'r-eb-1',
      timestamp: '2026-01-10T09:00:00-04:00',
      soloLevel: 'relational',
      contested: true,
    });
    expect(line).toBe('Explained with the points tied together on 10 Jan 2026. (under re-review)');
  });

  it('never carries the answer text, the grader feedback, or a raw number/percentage — only the depth phrase and the date', () => {
    const line = explainBackHistoryRowLine({
      eventId: 'r-eb-1',
      timestamp: '2026-01-10T09:00:00-04:00',
      soloLevel: 'prestructural',
      contested: false,
    });
    expect(line).not.toMatch(/\d%|\bscore\b/i);
  });
});

describe('duplicateTitleLine ([D-203])', () => {
  it('states the structural reason and names both notes', () => {
    const line = duplicateTitleLine([
      '05 Zettelkasten/Concept A.md',
      '05 Zettelkasten/Outcrop/Concept A.md',
    ]);
    expect(line).toContain('Two of your notes share this title');
    expect(line).toContain('05 Zettelkasten/Concept A.md');
    expect(line).toContain('05 Zettelkasten/Outcrop/Concept A.md');
  });

  it('states what clears it — renaming one of the notes — never a chooser between them', () => {
    const line = duplicateTitleLine(['a.md', 'b.md']);
    expect(line.toLowerCase()).toContain('rename');
    // No pick-one wording anywhere in the line — the clause's own "nothing is
    // chosen for her".
    expect(line.toLowerCase()).not.toMatch(/choose|pick|select/);
  });
});

describe('thinNoteLine ([D-214])', () => {
  it('states the measured word count as a fact about length', () => {
    expect(thinNoteLine(6)).toContain('6 words');
    expect(thinNoteLine(1)).toContain('1 word');
    expect(thinNoteLine(1)).not.toContain('1 words');
  });

  it('states the empty case honestly rather than "0 words"', () => {
    expect(thinNoteLine(0).toLowerCase()).toContain('empty');
  });

  it('states what clears it — writing more — and offers no affordance that edits the note from here', () => {
    const line = thinNoteLine(4);
    expect(line.toLowerCase()).toContain('keep writing');
    // Never a link/button verb that would open or edit the note from this
    // copy — the only edit is hers, in Obsidian, on her own time.
    expect(line.toLowerCase()).not.toMatch(/\bopen\b|\bedit\b|\bclick\b/);
  });

  it('reads distinctly from duplicateTitleLine — a different structural reason, never the same wording', () => {
    const thin = thinNoteLine(4);
    const duplicate = duplicateTitleLine(['a.md', 'b.md']);
    expect(thin).not.toBe(duplicate);
    expect(thin.toLowerCase()).not.toContain('share this title');
  });

  it('never states a judgement on what she wrote — a fact about length only', () => {
    for (const count of [0, 1, 6, 19]) {
      expect(thinNoteLine(count).toLowerCase()).not.toMatch(
        /should|must|forgot|behind|not enough effort/,
      );
    }
  });
});

// Scenario: olea-service/features/F8-concepts-scope.md — "F8.4 — The closed row and the chip
// filter bar", tagged `@manual`. ol-l5og.18.1 (design-fidelity sweep against
// docs/design/dsn3-registry/registry-surface.html frame 01).
describe('registryAggregateLine (frame 01\'s "27 across two courses")', () => {
  it('states the concept count alone when no concept carries a course yet', () => {
    expect(registryAggregateLine(0, 0)).toBe('0 concepts');
    expect(registryAggregateLine(1, 0)).toBe('1 concept');
  });

  it('states the count across the course count, pluralizing both independently', () => {
    expect(registryAggregateLine(27, 2)).toBe('27 concepts across 2 courses');
    expect(registryAggregateLine(1, 1)).toBe('1 concept across 1 course');
  });
});

describe('instrumentMixLine (frame 01\'s "3 Q&A · 1 cloze · 2 MCQ")', () => {
  it('reads "nothing built yet" with no active instrument', () => {
    expect(instrumentMixLine([])).toBe(NOTHING_BUILT_YET_LABEL);
    expect(instrumentMixLine([instrument('qa', true)])).toBe(NOTHING_BUILT_YET_LABEL);
  });

  it('counts active instruments by type, in a fixed reading order, excluding withdrawn ones', () => {
    const line = instrumentMixLine([
      instrument('mcq'),
      instrument('qa'),
      instrument('qa'),
      instrument('cloze'),
      instrument('qa', true),
    ]);
    expect(line).toBe('2 Q&A · 1 cloze · 1 MCQ');
  });
});
