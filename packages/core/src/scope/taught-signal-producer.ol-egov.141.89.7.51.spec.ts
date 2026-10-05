/**
 * F8.2 step two's producer (`ol-egov.141.89.7.51`; F8.2 as amended by `[D-465]`, C3.6) — the
 * four core scenarios of "Step two's producer" in the service repo's
 * `features/F8-concepts-scope.md`, asserted against the pure function. The grove-provider
 * scenarios (a deck opens it whatever its file dates, a transcript opens it and leaves scope
 * alone, the grove view and Home agree) are `packages/plugin/test/grove/
 * taught-signal.ol-egov.141.89.7.51.spec.ts`'s job.
 *
 * Every course code, concept name, path and sentence below is invented (INV-3).
 */
import { describe, expect, it } from 'vitest';
import type { ConceptMaterialPresence } from '../gap/build.js';
import type { Source } from '../source/types.js';
import type { ConceptCitation } from '../tier3-evidence/types.js';
import type { VaultPath } from '../vault/types.js';
import { classifyDeclaredConcept, type TaughtSignalEvidence } from './coverage.js';
import { buildGroveModel } from './grove.js';
import { produceTaughtSignals, type StepTwoMaterial } from './taught-signal-producer.js';

const COURSE_A = 'TESTA101';
const COURSE_B = 'TESTB202';
const FLUX = { key: 'key-flux', name: 'Tirreb flux' };
const VOSSANE = { key: 'key-vossane', name: 'Vossane' };
const QUARN = { key: 'key-quarn', name: 'Quarn' };

const NOTHING: TaughtSignalEvidence = {
  inWeekSlideDeck: false,
  inWeekTranscript: false,
  calendarSessionWithSlideSequence: false,
  outcomesDocumentOrder: false,
  manualGroveConfirmation: false,
};

function deck(path: string, courses: readonly string[], ...texts: string[]): StepTwoMaterial {
  return {
    path: path as VaultPath,
    courses,
    kind: 'deck',
    units: texts.map((text) => ({ text })),
  };
}

function transcript(path: string, courses: readonly string[], text: string): StepTwoMaterial {
  return { path: path as VaultPath, courses, kind: 'transcript', units: [{ text }] };
}

function registered(path: string, role: Source['role'], course = COURSE_A): Source {
  return {
    path: path as VaultPath,
    role,
    course,
    kind: 'registered-file',
    format: path.endsWith('.pdf') ? 'pdf' : path.endsWith('.pptx') ? 'pptx' : null,
  };
}

describe('step two reads the decks and supplied transcripts of the course (ol-egov.141.89.7.51)', () => {
  it('a deck of the course naming the concept sets inWeekSlideDeck, a transcript sets inWeekTranscript, and the later steps stay false', () => {
    const signals = produceTaughtSignals({
      course: COURSE_A,
      concepts: [FLUX, VOSSANE],
      material: [
        deck('01 Courses/TESTA101/deck-3.pdf', [COURSE_A], 'This week: Tirreb flux in practice.'),
        transcript('01 Courses/TESTA101/talk-4.txt', [COURSE_A], 'Today we meet the Vossane.'),
      ],
      sources: [],
    });
    expect(signals.get(FLUX.key)).toEqual({ ...NOTHING, inWeekSlideDeck: true });
    expect(signals.get(VOSSANE.key)).toEqual({ ...NOTHING, inWeekTranscript: true });
  });

  it('a name only inside the shared template heading of a deck page is furniture, as tier 3 reads it, and does not count', () => {
    const heading = 'Tirreb flux lecture series';
    const signals = produceTaughtSignals({
      course: COURSE_A,
      concepts: [FLUX],
      material: [
        {
          path: '01 Courses/TESTA101/deck-5.pdf' as VaultPath,
          courses: [COURSE_A],
          kind: 'deck',
          units: [{ text: `${heading} - an unrelated slide`, matchFrom: heading.length }],
        },
      ],
      sources: [],
    });
    expect(signals.get(FLUX.key)).toEqual(NOTHING);
  });
});

describe('a past paper or an objectives document is never a deck, whatever its extension (ol-egov.141.89.7.51)', () => {
  it('a concept named only in a registered past paper (a PDF) and a registered objectives deck gets both step-two fields false', () => {
    const pastPaper = 'Papers/TESTA101 paper.pdf';
    const objectives = 'Papers/TESTA101 outcomes.pptx';
    const signals = produceTaughtSignals({
      course: COURSE_A,
      concepts: [FLUX],
      // Classified `deck` by extension alone, as the client's lecture-file rule would: the
      // registration is what keeps them out, never the extension.
      material: [
        deck(pastPaper, [COURSE_A], 'Question 2. Explain Tirreb flux. (8 marks)'),
        deck(objectives, [COURSE_A], 'Students will be able to describe Tirreb flux.'),
      ],
      sources: [registered(pastPaper, 'past-paper'), registered(objectives, 'objectives')],
    });
    const evidence = signals.get(FLUX.key);
    expect(evidence?.inWeekSlideDeck).toBe(false);
    expect(evidence?.inWeekTranscript).toBe(false);
    expect(
      classifyDeclaredConcept({
        hasMaterial: false,
        instrumentCount: 0,
        priorGroundStreak: 0,
        ...(evidence !== undefined ? { taughtSignal: evidence } : {}),
      }),
    ).toEqual({ kind: 'material-gap' });
  });

  it('the same bytes registered as a past paper at another path are still the past paper, not a deck', () => {
    const signals = produceTaughtSignals({
      course: COURSE_A,
      concepts: [FLUX],
      material: [
        {
          ...deck('01 Courses/TESTA101/a-copy.pdf', [COURSE_A], 'Explain Tirreb flux.'),
          duplicatePaths: ['Papers/TESTA101 paper.pdf' as VaultPath],
        },
      ],
      sources: [registered('Papers/TESTA101 paper.pdf', 'past-paper')],
    });
    expect(signals.get(FLUX.key)).toEqual(NOTHING);
  });

  it('a deck registered as course material is still a deck', () => {
    const path = 'Papers/TESTA101 week 3.pdf';
    const signals = produceTaughtSignals({
      course: COURSE_A,
      concepts: [FLUX],
      material: [deck(path, [COURSE_A], 'Tirreb flux, worked through.')],
      sources: [registered(path, 'course-material')],
    });
    expect(signals.get(FLUX.key)?.inWeekSlideDeck).toBe(true);
  });
});

describe("another course's material does not open the concept (ol-egov.141.89.7.51)", () => {
  it('a concept of course A named only in a deck and a transcript of course B gets both fields false for course A', () => {
    const material = [
      deck('01 Courses/TESTB202/deck-1.pdf', [COURSE_B], 'Tirreb flux, again.'),
      transcript('01 Courses/TESTB202/talk-1.txt', [COURSE_B], 'We return to Tirreb flux.'),
    ];
    const forA = produceTaughtSignals({
      course: COURSE_A,
      concepts: [FLUX],
      material,
      sources: [],
    });
    expect(forA.get(FLUX.key)).toEqual(NOTHING);

    // The same material does open course B's own concept of that wording.
    const forB = produceTaughtSignals({
      course: COURSE_B,
      concepts: [{ key: 'key-flux-b', name: FLUX.name }],
      material,
      sources: [],
    });
    expect(forB.get('key-flux-b')).toEqual({
      ...NOTHING,
      inWeekSlideDeck: true,
      inWeekTranscript: true,
    });
  });

  it('a file attributed to no course opens nothing', () => {
    const signals = produceTaughtSignals({
      course: COURSE_A,
      concepts: [FLUX],
      material: [deck('Loose/deck.pdf', [], 'Tirreb flux.')],
      sources: [],
    });
    expect(signals.get(FLUX.key)).toEqual(NOTHING);
  });
});

describe('a name inside a longer word does not count (ol-egov.141.89.7.51)', () => {
  it('a deck naming the concept only as part of a longer word leaves inWeekSlideDeck false, and the concept keeps today’s reading', () => {
    const signals = produceTaughtSignals({
      course: COURSE_A,
      concepts: [QUARN],
      material: [
        deck('01 Courses/TESTA101/deck-2.pdf', [COURSE_A], 'The Quarnel field, step by step.'),
      ],
      sources: [],
    });
    const evidence = signals.get(QUARN.key);
    expect(evidence).toEqual(NOTHING);
    expect(
      classifyDeclaredConcept({
        hasMaterial: false,
        instrumentCount: 0,
        priorGroundStreak: 0,
        ...(evidence !== undefined ? { taughtSignal: evidence } : {}),
      }),
    ).toEqual(
      classifyDeclaredConcept({ hasMaterial: false, instrumentCount: 0, priorGroundStreak: 0 }),
    );
  });

  it('the whole word does count, in any letter case — the examiner-side rule exactly', () => {
    const signals = produceTaughtSignals({
      course: COURSE_A,
      concepts: [QUARN],
      material: [deck('01 Courses/TESTA101/deck-2.pdf', [COURSE_A], 'the quarn, step by step.')],
      sources: [],
    });
    expect(signals.get(QUARN.key)?.inWeekSlideDeck).toBe(true);
  });
});

describe('with no deck or transcript naming it, nothing changes (ol-egov.141.89.7.51)', () => {
  const objectivesPath = '03 Research/outcomes.md' as VaultPath;
  const concepts = [
    { ...FLUX, tier: 2 as const, courses: [COURSE_A], sourcePaths: [] as VaultPath[] },
    { ...VOSSANE, tier: 2 as const, courses: [COURSE_A], sourcePaths: [] as VaultPath[] },
  ];
  const citations: ConceptCitation[] = [FLUX, VOSSANE].map((c) => ({
    conceptName: c.name,
    kind: 'objectives',
    sourcePath: objectivesPath,
    course: COURSE_A,
    provenance: {
      sourcePath: objectivesPath,
      location: { page: 1, charRange: { start: 0, end: 1 } },
    },
  }));
  const materialPresence = new Map<string, ConceptMaterialPresence>(
    concepts.map((c) => [c.key, { notePaths: [], instrumentCount: 0 }]),
  );
  const baseInput = {
    course: COURSE_A,
    concepts,
    sources: [registered(objectivesPath, 'objectives')],
    citations,
    materialPresence,
    mastery: new Map(),
  };

  it('a concept no deck or transcript names receives every taught-signal field false, and the grove reads exactly as it did before this producer', () => {
    const signals = produceTaughtSignals({
      course: COURSE_A,
      concepts,
      material: [
        deck('01 Courses/TESTA101/deck-7.pdf', [COURSE_A], 'Unrelated slides on something else.'),
        transcript('01 Courses/TESTA101/talk-7.txt', [COURSE_A], 'Nothing named here.'),
      ],
      sources: baseInput.sources,
    });
    expect(signals.get(FLUX.key)).toEqual(NOTHING);
    expect(signals.get(VOSSANE.key)).toEqual(NOTHING);

    const before = buildGroveModel(baseInput);
    const after = buildGroveModel({ ...baseInput, taughtSignals: signals });
    expect(after).toEqual(before);
    if (after.model.status !== 'declared') throw new Error('expected a declared course');
    expect(after.model.materialGaps.map((gap) => gap.conceptName)).toEqual([
      FLUX.name,
      VOSSANE.name,
    ]);
  });

  it('when the grove is built, only the concept a deck or transcript names opens, and the count and its sources are the examiner documents’ alone', () => {
    const signals = produceTaughtSignals({
      course: COURSE_A,
      concepts,
      material: [transcript('01 Courses/TESTA101/talk-8.txt', [COURSE_A], 'Today: the Vossane.')],
      sources: baseInput.sources,
    });
    const before = buildGroveModel(baseInput);
    const after = buildGroveModel({ ...baseInput, taughtSignals: signals });
    if (before.model.status !== 'declared' || after.model.status !== 'declared') {
      throw new Error('expected a declared course');
    }
    expect(after.model.cells.map((cell) => [cell.conceptName, cell.state])).toEqual([
      [VOSSANE.name, 'ground'],
    ]);
    expect(after.model.materialGaps.map((gap) => gap.conceptName)).toEqual([FLUX.name]);
    expect(after.model.summary.denominatorCount).toBe(before.model.summary.denominatorCount);
    expect(after.model.summary.denominatorSourcePaths).toEqual(
      before.model.summary.denominatorSourcePaths,
    );
    expect(after.model.volunteers).toEqual(before.model.volunteers);
  });
});
