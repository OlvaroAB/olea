/**
 * `ol-2zfj.27`: what a misconception record carries once the judge is bound to concept ids
 * (`[D-482]` item 4), and whether every consumer of that record resolves it.
 *
 * The record is built through the REAL producer chain, not hand-written: the permitted list comes
 * from `explain-back/request.ts`'s `permittedConceptIdsFor`, the resolver from
 * `explain-back/observation.ts`'s `buildExplainBackObservationContext`, and the event from
 * `olea-core`'s `buildObservationEventsFromAcceptedGrading` (the function
 * `grading/wiring.ts`'s accept step calls), folded by `projectMisconceptions`. Each consumer is
 * then handed exactly that record. A consumer that resolves by name or alias while the record
 * carries a concept key misses every bound record, silently.
 *
 * INV-3: every concept name, key and statement here is coined.
 */

import type { CorpusConcept, MisconceptionRecord } from 'olea-core';
import {
  buildMisconceptionDigest,
  buildObservationEventsFromAcceptedGrading,
  checkConfusionPairingResolution,
  corroborateConfusionPairings,
  corroborateConfusionPairs,
  deriveRelationSet,
  OPAQUE_CONCEPT_KEY_PREFIX,
  projectMisconceptions,
} from 'olea-core';
import { describe, expect, it } from 'vitest';
import { gatherCorpusRelationVaultContext } from '../../src/concept/corpusRelationSignals.js';
import { buildExplainBackObservationContext } from '../../src/explain-back/observation.js';
import { permittedConceptIdsFor } from '../../src/explain-back/request.js';

const WIDGET_KEY = `${OPAQUE_CONCEPT_KEY_PREFIX}:widget-nonce`;
const GADGET_KEY = `${OPAQUE_CONCEPT_KEY_PREFIX}:gadget-nonce`;

const SOURCE_BLOCK = {
  block: { blockId: 'blk-1', text: 'A widget turns; a gadget does not.' },
  path: 'Courses/Sample/widget.md',
  blockIndex: 0,
};

/** One accepted candidate run through the real producer chain; returns the outcomes and the folded records. */
async function produce(candidate: { concept: string; confusedWith?: string }) {
  const context = buildExplainBackObservationContext({
    subjectConceptId: WIDGET_KEY,
    permittedConceptIds: permittedConceptIdsFor(WIDGET_KEY, GADGET_KEY),
    originInstrumentId: 'explain-back:widget:1',
    originReviewEventId: null,
    sourceBlocks: [SOURCE_BLOCK],
    records: [],
    now: () => new Date('2026-10-06T09:00:00.000Z'),
  });
  const outcomes = await buildObservationEventsFromAcceptedGrading(
    [
      {
        ...candidate,
        statement: 'Believes a widget and a gadget both turn.',
        correction: 'Only a widget turns.',
        correctionSourceBlockIds: ['blk-1'],
        statementAuthorship: 'hers',
      },
    ],
    context,
    { embedder: null, generateEventId: () => 'evt-1', generateMisconceptionId: () => 'm-1' },
  );
  const events = outcomes.flatMap((outcome) => (outcome.skipped ? [] : [outcome.result.event]));
  return { outcomes, records: projectMisconceptions(events) };
}

async function boundConfusionRecords(): Promise<readonly MisconceptionRecord[]> {
  return (await produce({ concept: WIDGET_KEY, confusedWith: GADGET_KEY })).records;
}

function corpusConcept(name: string, key: string): CorpusConcept {
  return {
    name,
    aliases: [],
    key,
    anchor: {
      sourcePath: `${name}.md`,
      location: { page: 1, charRange: { start: 0, end: 10 } },
    },
  };
}

const noFiles = {
  list: () => Promise.resolve([]),
  read: () => Promise.reject(new Error('no such file')),
  readBinary: () => Promise.reject(new Error('no such file')),
  write: () => Promise.reject(new Error('read-only')),
  exists: () => Promise.resolve(false),
  watch: () => () => undefined,
};

describe('ol-2zfj.27: the producer records concept keys, never names', () => {
  it('a bound confusion is recorded with the subject key and the neighbour key', async () => {
    const records = await boundConfusionRecords();
    expect(records).toHaveLength(1);
    expect(records[0]?.conceptId).toBe(WIDGET_KEY);
    expect(records[0]?.confusedWithConceptId).toBe(GADGET_KEY);
  });

  it('a candidate that names a concept by its name, not its key, is not recorded at all', async () => {
    const { outcomes, records } = await produce({ concept: 'Widget', confusedWith: 'Gadget' });
    expect(records).toEqual([]);
    expect(outcomes.map((outcome) => (outcome.skipped ? outcome.reason : 'recorded'))).toEqual([
      'unresolved-concept',
    ]);
  });
});

describe('ol-2zfj.27: every consumer resolves a bound record', () => {
  it('assessment-error-adjacency (corpusRelationSignals) nominates the pair from the two keys', async () => {
    const records = await boundConfusionRecords();
    const { signals } = await gatherCorpusRelationVaultContext(
      noFiles,
      [corpusConcept('Widget', WIDGET_KEY), corpusConcept('Gadget', GADGET_KEY)],
      { assessmentErrorAdjacency: { records } },
    );
    expect(signals.filter((signal) => signal.kind === 'assessment-error-adjacency')).toEqual([
      { kind: 'assessment-error-adjacency', a: 'Widget', b: 'Gadget' },
    ]);
  });

  it('confusion-pairing corroboration resolves both keys and corroborates the served edge', async () => {
    const records = await boundConfusionRecords();
    const relations = deriveRelationSet([
      {
        type: 'contrasts-with',
        from: 'Widget',
        to: 'Gadget',
        provenance: 'model-proposed',
        confidence: 0.7,
        introducingPassages: {
          from: {
            sourcePath: 'Widget.md',
            location: { page: 1, charRange: { start: 0, end: 10 } },
          },
          to: { sourcePath: 'Gadget.md', location: { page: 1, charRange: { start: 0, end: 10 } } },
        },
      },
    ]);
    const concepts = [
      { name: 'Widget', aliases: [], key: WIDGET_KEY },
      { name: 'Gadget', aliases: [], key: GADGET_KEY },
    ];

    const result = corroborateConfusionPairs(relations, records, concepts);
    expect(result.unresolvedRecords).toBe(0);
    expect(checkConfusionPairingResolution(result).ok).toBe(true);

    const verdicts = corroborateConfusionPairings(relations, records, concepts);
    expect(verdicts.map((verdict) => verdict.verdict)).toEqual(['corroborated']);
  });

  it('the judge digest selects the record by the subject key', async () => {
    const records = await boundConfusionRecords();
    const digest = buildMisconceptionDigest(records, { conceptIds: [WIDGET_KEY] });
    expect(digest.map((entry) => entry.conceptId)).toEqual([WIDGET_KEY]);
  });
});
