/**
 * The materiality seam through the Decision contract (`ol-egov.141.89.20`),
 * at both grains: one judge call's settled verdict, and
 * `evaluateCitedPassageRevision`'s outcome run over stub judges.
 *
 * INV-3: every string here is coined; no real content.
 */

import { describe, expect, it } from 'vitest';
import { evaluateCitedPassageRevision } from '../../concept/revision/material-change.js';
import type {
  CitedPassageInput,
  RevisionJudgePort,
  RevisionJudgeVerdict,
} from '../../concept/revision/types.js';
import { hashText } from '../../ingestion/hash.js';
import type { Clock } from '../../ingestion/types.js';
import { decisionEnvelopeProblems } from '../decision.js';
import type { StageSeamContext } from '../provenance.js';
import {
  decisionFromCitedPassageRevision,
  decisionFromRevisionJudge,
  MATERIALITY_VOCABULARY,
} from './revision-judge.js';

const context: StageSeamContext = {
  seat: 'candidate',
  taskId: 'materiality.judge.v1',
  stamp: null,
  evidenceDigests: ['old-digest', 'new-digest'],
};

const clock: Clock = { now: () => 5_000 };

function judge(verdict: RevisionJudgeVerdict): RevisionJudgePort {
  return { judge: async () => verdict };
}

async function changedInput(): Promise<CitedPassageInput> {
  const previousText = 'coined passage, first wording';
  return {
    instrumentId: 'inst-1',
    previousText,
    previousContentHash: await hashText(previousText),
    current: { kind: 'found-at-anchor', text: 'coined passage, second wording' },
  };
}

describe('decisionFromRevisionJudge', () => {
  it('reads material and immaterial as the two verdicts, the reason as payload', () => {
    expect(
      decisionFromRevisionJudge(
        { status: 'fulfilled', value: { material: true, reason: 'claim changed' } },
        context,
      ),
    ).toMatchObject({ kind: 'verdict', verdict: 'material', payload: { reason: 'claim changed' } });
    expect(
      decisionFromRevisionJudge({ status: 'fulfilled', value: { material: false } }, context),
    ).toMatchObject({ kind: 'verdict', verdict: 'immaterial', payload: {} });
  });

  it('reads a rejected call as call-failed and an untyped non-boolean as malformed', () => {
    expect(
      decisionFromRevisionJudge({ status: 'rejected', reason: new Error('down') }, context),
    ).toMatchObject({ kind: 'unavailable', cause: 'call-failed' });
    expect(
      decisionFromRevisionJudge(
        { status: 'fulfilled', value: { material: 'yes' } as unknown as RevisionJudgeVerdict },
        context,
      ),
    ).toMatchObject({ kind: 'unavailable', cause: 'malformed' });
  });
});

describe('decisionFromCitedPassageRevision', () => {
  it('reads refreshed as immaterial and revised as material, carrying the seam outcome', async () => {
    const refreshed = await evaluateCitedPassageRevision(
      await changedInput(),
      judge({ material: false }),
      clock,
    );
    const revised = await evaluateCitedPassageRevision(
      await changedInput(),
      judge({ material: true, reason: 'claim changed' }),
      clock,
    );
    const immaterial = decisionFromCitedPassageRevision(refreshed, context);
    const material = decisionFromCitedPassageRevision(revised, context);
    expect(immaterial).toMatchObject({
      kind: 'verdict',
      verdict: 'immaterial',
      payload: refreshed,
    });
    expect(material).toMatchObject({ kind: 'verdict', verdict: 'material', payload: revised });
    for (const decision of [immaterial, material]) {
      expect(decisionEnvelopeProblems(decision, MATERIALITY_VOCABULARY)).toEqual([]);
    }
  });

  it('reads a missing judge as unavailable not-configured', async () => {
    const outcome = await evaluateCitedPassageRevision(await changedInput(), null, clock);
    expect(outcome.kind).toBe('judge-unavailable');
    const decision = decisionFromCitedPassageRevision(outcome, context);
    expect(decision).toMatchObject({ kind: 'unavailable', cause: 'not-configured' });
    expect(decisionEnvelopeProblems(decision, MATERIALITY_VOCABULARY)).toEqual([]);
  });

  it('returns null for the arms code settles before any decision is asked for', async () => {
    const text = 'coined passage, unchanged';
    const unchanged = await evaluateCitedPassageRevision(
      {
        instrumentId: 'inst-2',
        previousText: text,
        previousContentHash: await hashText(text),
        current: { kind: 'found-at-anchor', text },
      },
      judge({ material: true }),
      clock,
    );
    const stranded = await evaluateCitedPassageRevision(
      {
        instrumentId: 'inst-3',
        previousText: text,
        previousContentHash: await hashText(text),
        current: { kind: 'not-found', relocationCandidates: [] },
      },
      judge({ material: true }),
      clock,
    );
    expect(unchanged.kind).toBe('unchanged');
    expect(stranded.kind).toBe('stranded');
    expect(decisionFromCitedPassageRevision(unchanged, context)).toBeNull();
    expect(decisionFromCitedPassageRevision(stranded, context)).toBeNull();
    expect(
      decisionFromCitedPassageRevision(
        {
          kind: 'relocated',
          candidate: {
            anchor: {
              sourcePath: 'Note A.md',
              location: { page: 1, charRange: { start: 0, end: 5 } },
            },
            text,
          },
        },
        context,
      ),
    ).toBeNull();
  });

  it("names uncertain as the step's undecided word, not a verdict", () => {
    expect(MATERIALITY_VOCABULARY.verdicts).not.toContain('uncertain');
    expect(MATERIALITY_VOCABULARY.undecided).toBe('uncertain');
  });
});
