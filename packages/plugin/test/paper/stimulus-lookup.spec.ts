/**
 * `createHeldMaterialStimulusLookup` (`../../src/paper/stimulus-lookup.ts`, `[D-562]`,
 * `ol-egov.141.89.7.93`): the production shared-passage lookup is an adapter over `olea-core`'s
 * `lookUpPaperGroupStimulus`, handing it the group's concepts' held sources with each one's
 * assessment-paper status. The pick rule itself is core's and tested there
 * (`packages/core/src/oracle/paper-stimulus.spec.ts`).
 *
 * Scenario: olea-service/features/F4-oracle.md, "a group that shares material is requested with one
 * passage from her held material" ("never taken from a sealed paper or written by the model"; the
 * composition half is `journal-composition.spec.ts`, the production chain `provider.spec.ts`).
 * Synthetic notes and paths only (INV-3).
 */
import type { PaperHeldSource } from 'olea-core';
import { describe, expect, it } from 'vitest';
import type { PaperStimulusLookupRequest } from '../../src/paper/journal-composition.js';
import {
  createHeldMaterialStimulusLookup,
  stimulusSourcesFor,
} from '../../src/paper/stimulus-lookup.js';

const TABLE = ['| Year | Units |', '| --- | --- |', '| 2020 | 10 |'].join('\n');
const PROSE = Array.from({ length: 40 }, (_, i) => `word${i}`).join(' ');

const notes = (sourceId: string, chunks: readonly string[]): PaperHeldSource => ({
  kind: 'notes',
  sourceId,
  chunks,
});

const request = (
  conceptKeys: readonly string[],
  form: 'table' | 'scenario' = 'table',
): PaperStimulusLookupRequest => ({
  course: 'COURSEA',
  groupId: 'q1',
  need: { status: 'needed', form },
  conceptKeys,
});

const CONCEPTS = [
  { conceptKey: 'k-a', heldSources: [notes('Notes/a.md', ['no table here'])] },
  { conceptKey: 'k-b', heldSources: [notes('Notes/b.md', [`  ${TABLE}\n`])] },
  { conceptKey: 'k-c', heldSources: [] },
];

const known =
  (paths: readonly string[] = []) =>
  async () =>
    new Set(paths);

describe('the production shared-passage lookup', () => {
  it('searches the held sources of the group’s concepts, in the order named, and returns her chunk exactly as held', async () => {
    const lookup = createHeldMaterialStimulusLookup({
      concepts: CONCEPTS,
      assessmentPaperPaths: known(),
    });
    expect(await lookup(request(['k-a', 'k-b', 'k-c']))).toEqual({
      status: 'held',
      stimulus: { form: 'table', sourceId: 'Notes/b.md', chunkIndex: 0 },
      text: `  ${TABLE}\n`,
    });
  });

  it('says none is held only when it looked in known, non-assessment material and found none', async () => {
    const lookup = createHeldMaterialStimulusLookup({
      concepts: CONCEPTS,
      assessmentPaperPaths: known(),
    });
    expect(await lookup(request(['k-a']))).toEqual({ status: 'none-held' });
    // A concept with no held source adds nothing, so nothing was searched: never "none held".
    expect(await lookup(request(['k-c']))).toEqual({
      status: 'not-looked',
      reason: 'no-searchable-material',
    });
  });

  it('never takes a passage from a document registered as a past paper or an assessment record’s note', async () => {
    const lookup = createHeldMaterialStimulusLookup({
      concepts: CONCEPTS,
      assessmentPaperPaths: known(['Notes/b.md']),
    });
    expect(await lookup(request(['k-a', 'k-b']))).toEqual({ status: 'none-held' });
    expect(stimulusSourcesFor(CONCEPTS, ['k-a', 'k-b'], new Set(['Notes/b.md']))).toEqual([
      {
        sourceId: 'Notes/a.md',
        kind: 'notes',
        chunks: ['no table here'],
        isAssessmentPaper: false,
      },
      { sourceId: 'Notes/b.md', kind: 'notes', chunks: [`  ${TABLE}\n`], isAssessmentPaper: true },
    ]);
  });

  it('reads a source’s status as unknown when the registrations could not be read, or its id is not a path: nothing is searched and none is never claimed', async () => {
    const failing = createHeldMaterialStimulusLookup({
      concepts: CONCEPTS,
      assessmentPaperPaths: async () => {
        throw new Error('could not read');
      },
    });
    expect(await failing(request(['k-a', 'k-b']))).toEqual({
      status: 'not-looked',
      reason: 'assessment-status-unknown',
    });
    const unknown = createHeldMaterialStimulusLookup({
      concepts: CONCEPTS,
      assessmentPaperPaths: async () => null,
    });
    expect(await unknown(request(['k-b']))).toEqual({
      status: 'not-looked',
      reason: 'assessment-status-unknown',
    });
    // `assemble.ts`'s concept-key fallback id is not a vault path: its document is not known.
    const keyed = [{ conceptKey: 'k-d', heldSources: [notes('k-d', [PROSE])] }];
    expect(stimulusSourcesFor(keyed, ['k-d'], new Set())[0]?.isAssessmentPaper).toBeNull();
    expect(
      await createHeldMaterialStimulusLookup({
        concepts: keyed,
        assessmentPaperPaths: known(),
      })(request(['k-d'], 'scenario')),
    ).toEqual({ status: 'not-looked', reason: 'assessment-status-unknown' });
  });

  it('reads the assessment papers at most once, and only when a group is looked for', async () => {
    let reads = 0;
    const lookup = createHeldMaterialStimulusLookup({
      concepts: CONCEPTS,
      assessmentPaperPaths: async () => {
        reads += 1;
        return new Set<string>();
      },
    });
    expect(reads).toBe(0);
    await lookup(request(['k-a']));
    await lookup(request(['k-b']));
    expect(reads).toBe(1);
  });
});
