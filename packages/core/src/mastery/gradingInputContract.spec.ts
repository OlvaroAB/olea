// `[D-083]` / `GRD-1` (`ol-2jod.13`), exercised at the mastery-side unit this bead (`ol-0r92.4` /
// `MAT-4`) owns. The behaviour under test is the same behaviour
// `features/F5-explain-it-back.md`'s "F5.2 — Compare her explanation against retrieved source
// content" and "F5.3 — Identify omissions, errors and confusions" already describe (the five
// relation scenarios at that file's lines 142-178, and the degradation scenario at its line
// 248) — those scenarios are tagged against the eventual wire-level implementation
// (`service/explainBackJudge.spec`, `core/grading/gradingPipeline.spec`), which is separate,
// not-yet-built work; this file proves the mastery-side decision those callers will build their
// request from. Concept ids below are structural placeholders ("concept-x", "concept-y"), never
// fixture vocabulary — INV-3.

import { describe, expect, it } from 'vitest';
import type { SourceBlockRef } from '../grading/gradingPipeline.js';
import {
  buildGradingSourceMaterial,
  buildSchedulingObservationField,
  type ConceptDefiningPassages,
  type GradingRetrievalInput,
} from './gradingInputContract.js';

function block(blockId: string, text = `text for ${blockId}`): SourceBlockRef {
  return { blockId, text };
}

function passages(conceptId: string, ...blockIds: readonly string[]): ConceptDefiningPassages {
  return { conceptId, passages: blockIds.map((id) => block(id)) };
}

describe('buildGradingSourceMaterial', () => {
  it('a concept-only explanation retrieves only the subject, and the denominator is its own material', () => {
    const input: GradingRetrievalInput = {
      subject: { subjectConceptId: 'concept-x' },
      subjectDefiningPassages: passages('concept-x', 'x-1', 'x-2'),
      relation: { kind: 'concept-only' },
    };

    const result = buildGradingSourceMaterial(input);

    expect(result.sourceBlocks.map((b) => b.blockId)).toEqual(['x-1', 'x-2']);
    expect(result.omissionDenominator?.map((b) => b.blockId)).toEqual(['x-1', 'x-2']);
    expect(result.candidateEdgeNomination).toBeNull();
  });

  // features/F5-explain-it-back.md:142 and :152 — "stated in one document" and "implied across
  // two" retrieve identically, one shape (`edge-provenance`).
  it("a relation stated in one document (or implied across two) is a lookup against the edge's own provenance", () => {
    const input: GradingRetrievalInput = {
      subject: { subjectConceptId: 'concept-x' },
      subjectDefiningPassages: passages('concept-x', 'x-1'),
      relation: {
        kind: 'relation',
        neighbourConceptId: 'concept-y',
        provenance: { kind: 'edge-provenance', passages: [block('edge-1'), block('edge-2')] },
      },
      neighbourDefiningPassages: passages('concept-y', 'y-1'),
    };

    const result = buildGradingSourceMaterial(input);

    // Retrieval carries all three parts.
    expect(result.sourceBlocks.map((b) => b.blockId)).toEqual(['x-1', 'edge-1', 'edge-2', 'y-1']);
    // The denominator is subject material plus edge provenance, nothing wider (F5.3) — the
    // neighbour's own defining passage ("y-1") is retrieval context, never part of the
    // denominator.
    expect(result.omissionDenominator?.map((b) => b.blockId)).toEqual(['x-1', 'edge-1', 'edge-2']);
    expect(result.candidateEdgeNomination).toBeNull();
  });

  // features/F5-explain-it-back.md:161 — the first "written nowhere" sub-case.
  it('a relation she asserted herself, with no textual provenance, retrieves her linking note and degrades the denominator', () => {
    const input: GradingRetrievalInput = {
      subject: { subjectConceptId: 'concept-x' },
      subjectDefiningPassages: passages('concept-x', 'x-1'),
      relation: {
        kind: 'relation',
        neighbourConceptId: 'concept-y',
        provenance: { kind: 'asserted-no-provenance', linkingNote: block('her-note') },
      },
      neighbourDefiningPassages: passages('concept-y', 'y-1'),
    };

    const result = buildGradingSourceMaterial(input);

    expect(result.sourceBlocks.map((b) => b.blockId)).toEqual(['x-1', 'y-1', 'her-note']);
    // No provenance exists to ground omissions — F5.3's degradation. `null`, never `[]`: see the
    // module doc for why the distinction is load-bearing.
    expect(result.omissionDenominator).toBeNull();
    expect(result.candidateEdgeNomination).toBeNull();
  });

  // features/F5-explain-it-back.md:170 — the second "written nowhere" sub-case, and the one that
  // is ALSO a candidate edge nomination.
  it('no edge exists at all — grading still runs on both concepts, denominator degrades, and a candidate edge is nominated', () => {
    const input: GradingRetrievalInput = {
      subject: { subjectConceptId: 'concept-x' },
      subjectDefiningPassages: passages('concept-x', 'x-1'),
      relation: {
        kind: 'relation',
        neighbourConceptId: 'concept-y',
        provenance: { kind: 'no-edge' },
      },
      neighbourDefiningPassages: passages('concept-y', 'y-1'),
    };

    const result = buildGradingSourceMaterial(input);

    expect(result.sourceBlocks.map((b) => b.blockId)).toEqual(['x-1', 'y-1']);
    expect(result.omissionDenominator).toBeNull();
    expect(result.candidateEdgeNomination).toEqual({
      subjectConceptId: 'concept-x',
      neighbourConceptId: 'concept-y',
    });
  });

  it('throws when the subject defining passages name a different concept than the subject', () => {
    const input: GradingRetrievalInput = {
      subject: { subjectConceptId: 'concept-x' },
      subjectDefiningPassages: passages('concept-wrong', 'x-1'),
      relation: { kind: 'concept-only' },
    };

    expect(() => buildGradingSourceMaterial(input)).toThrow(/subjectDefiningPassages/);
  });

  it('throws when relation.kind is "relation" but neighbourDefiningPassages was not supplied', () => {
    const input: GradingRetrievalInput = {
      subject: { subjectConceptId: 'concept-x' },
      subjectDefiningPassages: passages('concept-x', 'x-1'),
      relation: {
        kind: 'relation',
        neighbourConceptId: 'concept-y',
        provenance: { kind: 'no-edge' },
      },
    };

    expect(() => buildGradingSourceMaterial(input)).toThrow(/neighbourDefiningPassages/);
  });

  it('throws when the neighbour defining passages name a different concept than the relation names', () => {
    const input: GradingRetrievalInput = {
      subject: { subjectConceptId: 'concept-x' },
      subjectDefiningPassages: passages('concept-x', 'x-1'),
      relation: {
        kind: 'relation',
        neighbourConceptId: 'concept-y',
        provenance: { kind: 'no-edge' },
      },
      neighbourDefiningPassages: passages('concept-wrong', 'y-1'),
    };

    expect(() => buildGradingSourceMaterial(input)).toThrow(/neighbourDefiningPassages/);
  });

  it('is pure: the same input always produces an equal result', () => {
    const input: GradingRetrievalInput = {
      subject: { subjectConceptId: 'concept-x' },
      subjectDefiningPassages: passages('concept-x', 'x-1'),
      relation: {
        kind: 'relation',
        neighbourConceptId: 'concept-y',
        provenance: { kind: 'edge-provenance', passages: [block('edge-1')] },
      },
      neighbourDefiningPassages: passages('concept-y', 'y-1'),
    };

    expect(buildGradingSourceMaterial(input)).toEqual(buildGradingSourceMaterial(input));
  });
});

// `[D-185]` (`ol-0r92.34`): F5.3a's scheduling observation widened from
// explain-back-only to any instrument kind that can name a subject-plus-
// context pair (the sibling generator-refusal ruling, `ol-0r92.33`).
// `buildSchedulingObservationField` is the one producer every instrument
// kind's grade-write path shares — it takes no `instrumentType` at all, so
// these cases are run once per kind named in the ruling to make "the
// function does not distinguish kinds" an explicit, per-kind fact rather
// than an inference from a single example.
describe('buildSchedulingObservationField — kind-general producer, [D-185]', () => {
  it.each(['mcq', 'qa', 'cloze', 'explain-back'] as const)(
    'builds { neighbourConceptId } when neighbourUseDemonstrated is true for a %s-shaped caller',
    (_kind) => {
      const field = buildSchedulingObservationField({
        neighbourUseDemonstrated: true,
        neighbourConceptId: 'concept-y',
      });
      expect(field).toEqual({ neighbourConceptId: 'concept-y' });
    },
  );

  it.each(['mcq', 'qa', 'cloze', 'explain-back'] as const)(
    'returns undefined (never null) when neighbourUseDemonstrated is false for a %s-shaped caller',
    (_kind) => {
      const field = buildSchedulingObservationField({
        neighbourUseDemonstrated: false,
        neighbourConceptId: 'concept-y',
      });
      expect(field).toBeUndefined();
    },
  );

  it('returns undefined when neighbourUseDemonstrated is undefined — an instrument kind with no such judgement at all (e.g. a plain MCQ)', () => {
    const field = buildSchedulingObservationField({ neighbourUseDemonstrated: undefined });
    expect(field).toBeUndefined();
  });

  it('throws when neighbourUseDemonstrated is true but no neighbourConceptId was supplied, regardless of kind', () => {
    expect(() => buildSchedulingObservationField({ neighbourUseDemonstrated: true })).toThrow(
      /neighbourConceptId/,
    );
  });

  it('never scores: the only field on the result is neighbourConceptId — no mastery estimate, no numeric shape a fold could read', () => {
    const field = buildSchedulingObservationField({
      neighbourUseDemonstrated: true,
      neighbourConceptId: 'concept-y',
    });
    expect(Object.keys(field as object)).toEqual(['neighbourConceptId']);
  });
});
