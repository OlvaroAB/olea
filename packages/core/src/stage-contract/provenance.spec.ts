/**
 * Producer provenance shared by both stage contracts (`ol-egov.141.89.20`).
 *
 * INV-3: every string here is coined; no real content.
 */

import { describe, expect, it } from 'vitest';
import {
  codeProvenance,
  failedCallProvenance,
  modelProvenance,
  type StageSeamContext,
  stageProvenanceProblems,
  toArtifactProvenance,
} from './provenance.js';

const context: StageSeamContext = {
  seat: 'candidate',
  taskId: 'example.decide.v1',
  stamp: { promptVersion: 'p-1', modelId: 'm-1' },
  evidenceDigests: ['digest-a', 'digest-b'],
};

describe('stage provenance', () => {
  it('stamps a model outcome with seat, task, stamp and evidence digests', () => {
    expect(modelProvenance(context)).toEqual({
      producer: {
        kind: 'model',
        seat: 'candidate',
        taskId: 'example.decide.v1',
        stamp: { promptVersion: 'p-1', modelId: 'm-1' },
      },
      evidenceDigests: ['digest-a', 'digest-b'],
    });
  });

  it('drops the stamp on a failed call, since no response carried one', () => {
    expect(failedCallProvenance(context).producer).toEqual({
      kind: 'model',
      seat: 'candidate',
      taskId: 'example.decide.v1',
      stamp: null,
    });
  });

  it('maps to the persisted D7.3 shape only when a real stamp exists', () => {
    expect(toArtifactProvenance(modelProvenance(context))).toEqual({
      taskId: 'example.decide.v1',
      promptVersion: 'p-1',
      modelId: 'm-1',
    });
    expect(toArtifactProvenance(failedCallProvenance(context))).toBeNull();
    expect(toArtifactProvenance(codeProvenance('empty-input', []))).toBeNull();
  });

  it('accepts well-formed provenance and rejects malformed provenance', () => {
    expect(stageProvenanceProblems(modelProvenance(context))).toEqual([]);
    expect(stageProvenanceProblems(codeProvenance('empty-input', []))).toEqual([]);
    expect(
      stageProvenanceProblems({ producer: { kind: 'code', rule: '' }, evidenceDigests: [] }),
    ).toContain('provenance.producer.rule is not a non-empty string');
    expect(
      stageProvenanceProblems({ producer: { kind: 'code', rule: 'r' }, evidenceDigests: [''] }),
    ).toContain('provenance.evidenceDigests is not a list of non-empty strings');
    expect(
      stageProvenanceProblems({
        producer: { kind: 'model', seat: 'third', taskId: 't', stamp: null },
        evidenceDigests: [],
      }),
    ).toContain('provenance.producer.seat is not candidate or fallback');
  });

  it('allows an escalation record only on an outcome the fallback seat produced', () => {
    const escalation = { from: modelProvenance(context).producer, because: 'undecided' };
    expect(
      stageProvenanceProblems({ ...modelProvenance({ ...context, seat: 'fallback' }), escalation }),
    ).toEqual([]);
    expect(stageProvenanceProblems({ ...modelProvenance(context), escalation })).toContain(
      'provenance.escalation is present but the producer is not the fallback seat',
    );
  });
});
