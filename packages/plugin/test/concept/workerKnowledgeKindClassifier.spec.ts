/**
 * `WorkerKnowledgeKindClassifier` tests (`[KCT-2]`, `ol-fx1k`, `[D-114]`).
 *
 * Runs entirely against a fake `WorkerTaskTransport` — no `obsidian` import
 * anywhere in this file (INV-1), and none needed:
 * `workerKnowledgeKindClassifier.ts` imports nothing Obsidian-specific.
 * Mirrors `workerConceptReader.spec.ts`'s shape exactly, one seam over.
 */

import { TASK_IDS } from 'olea-contracts';
import { KnowledgeKindClassifierUnavailableError, type WorkerTaskRequest } from 'olea-core';
import { describe, expect, it } from 'vitest';
import {
  CONCEPTS_CLASSIFY_CONTRACT_VERSION,
  CONCEPTS_CLASSIFY_TASK_ID,
  WorkerKnowledgeKindClassifier,
  WorkerKnowledgeKindClassifierError,
} from '../../src/concept/workerKnowledgeKindClassifier.js';

/** Records what was sent and answers with whatever the test scripted. */
class RecordingTransport {
  readonly sent: WorkerTaskRequest[] = [];
  constructor(private readonly reply: (request: WorkerTaskRequest) => unknown) {}
  async send(request: WorkerTaskRequest): Promise<unknown> {
    this.sent.push(request);
    return this.reply(request);
  }
}

function okResponse(result: unknown) {
  return { ok: true, stamp: { contractVersion: 1, promptVersion: '1.0.0', modelId: 'm' }, result };
}

const sourceMaterial = [
  {
    text: 'Event-related potentials are voltage deflections time-locked to an event.',
    anchor: {
      sourcePath: 'Courses/PSYCH305/lecture-3.md',
      location: { page: 1, charRange: { start: 0, end: 10 } },
    },
  },
];

describe('WorkerKnowledgeKindClassifier — the frozen vocabulary it mirrors', () => {
  // The module deliberately does not import olea-contracts as a value in
  // production code (see the module doc). This test is what stops the
  // mirror drifting.
  it('sends the task id the frozen catalogue reserves for classification', () => {
    expect(CONCEPTS_CLASSIFY_TASK_ID).toBe(TASK_IDS.CONCEPTS_CLASSIFY);
  });

  it('sends the current contract version', () => {
    expect(CONCEPTS_CLASSIFY_CONTRACT_VERSION).toBe(1);
  });
});

describe('WorkerKnowledgeKindClassifier — the request it builds', () => {
  it('sends the concept name and passage text only — never a vault path (D-005)', async () => {
    const transport = new RecordingTransport(() => okResponse({ kind: 'fact', confidence: 0.8 }));
    const classifier = new WorkerKnowledgeKindClassifier({ transport });

    await classifier.classify({ conceptName: 'Event-related potential', sourceMaterial });

    expect(transport.sent).toHaveLength(1);
    const request = transport.sent[0];
    expect(request?.taskId).toBe('concepts.classify.v1');
    expect(request?.contractVersion).toBe(1);
    expect(request?.payload).toEqual({
      conceptName: 'Event-related potential',
      sourceChunks: ['Event-related potentials are voltage deflections time-locked to an event.'],
    });
  });

  it('sends the transport even for an empty sourceMaterial list — unlike the reader, this port has no INV-5 short-circuit of its own', async () => {
    // `classifyKnowledgeKind` (core) is what refuses on empty source material
    // before ever reaching this port (INV-5, `knowledge-kind.ts`). This class
    // does not re-implement that refusal — it is a faithful transport
    // adapter, not the judgement — matching `WorkerConceptReader`'s stated
    // reasoning for its own belt-and-braces empty check being about a
    // non-conforming caller, not about assuming one.
    const transport = new RecordingTransport(() =>
      okResponse({ kind: 'unclassified', confidence: 0 }),
    );
    const classifier = new WorkerKnowledgeKindClassifier({ transport });

    await classifier.classify({ conceptName: 'X', sourceMaterial: [] });

    expect(transport.sent).toHaveLength(1);
    const payload = transport.sent[0]?.payload as { sourceChunks: string[] } | undefined;
    expect(payload?.sourceChunks).toEqual([]);
  });
});

describe('WorkerKnowledgeKindClassifier — the response it reads', () => {
  it('passes a committed label and its confidence through unchanged', async () => {
    const transport = new RecordingTransport(() =>
      okResponse({ kind: 'principle', confidence: 0.91 }),
    );
    const classifier = new WorkerKnowledgeKindClassifier({ transport });

    const result = await classifier.classify({ conceptName: 'X', sourceMaterial });

    expect(result).toEqual({ kind: 'principle', confidence: 0.91 });
  });

  it("passes the model's own 'unclassified' verdict through — the gate never removes a decline the model already made", async () => {
    const transport = new RecordingTransport(() =>
      okResponse({ kind: 'unclassified', confidence: 0.2 }),
    );
    const classifier = new WorkerKnowledgeKindClassifier({ transport });

    const result = await classifier.classify({ conceptName: 'X', sourceMaterial });

    expect(result).toEqual({ kind: 'unclassified', confidence: 0.2 });
  });

  for (const kind of ['fact', 'category', 'principle'] as const) {
    it(`accepts the candidate label "${kind}"`, async () => {
      const transport = new RecordingTransport(() => okResponse({ kind, confidence: 0.6 }));
      const classifier = new WorkerKnowledgeKindClassifier({ transport });

      const result = await classifier.classify({ conceptName: 'X', sourceMaterial });

      expect(result.kind).toBe(kind);
    });
  }
});

describe('WorkerKnowledgeKindClassifier — refuses rather than trusting an out-of-catalogue label', () => {
  it('throws WorkerKnowledgeKindClassifierError on a kind outside the candidate set', async () => {
    const transport = new RecordingTransport(() =>
      okResponse({ kind: 'theorem', confidence: 0.5 }),
    );
    const classifier = new WorkerKnowledgeKindClassifier({ transport });

    await expect(classifier.classify({ conceptName: 'X', sourceMaterial })).rejects.toThrow(
      WorkerKnowledgeKindClassifierError,
    );
  });

  it('throws when confidence is missing or non-numeric', async () => {
    const transport = new RecordingTransport(() => okResponse({ kind: 'fact' }));
    const classifier = new WorkerKnowledgeKindClassifier({ transport });

    await expect(classifier.classify({ conceptName: 'X', sourceMaterial })).rejects.toThrow(
      WorkerKnowledgeKindClassifierError,
    );
  });

  it('throws when the response body is not an object', async () => {
    const transport = new RecordingTransport(() => 'not an object');
    const classifier = new WorkerKnowledgeKindClassifier({ transport });

    await expect(classifier.classify({ conceptName: 'X', sourceMaterial })).rejects.toThrow(
      WorkerKnowledgeKindClassifierError,
    );
  });

  it('throws when result is missing entirely', async () => {
    const transport = new RecordingTransport(() => ({ ok: true, stamp: {} }));
    const classifier = new WorkerKnowledgeKindClassifier({ transport });

    await expect(classifier.classify({ conceptName: 'X', sourceMaterial })).rejects.toThrow(
      WorkerKnowledgeKindClassifierError,
    );
  });
});

describe('WorkerKnowledgeKindClassifier — KnowledgeKindClassifierUnavailableError mapping', () => {
  it('maps quota-exceeded to budget-exhausted', async () => {
    const transport = new RecordingTransport(() => ({
      ok: false,
      code: 'quota-exceeded',
      message: 'Daily usage limit reached.',
    }));
    const classifier = new WorkerKnowledgeKindClassifier({ transport });

    await expect(classifier.classify({ conceptName: 'X', sourceMaterial })).rejects.toThrow(
      KnowledgeKindClassifierUnavailableError,
    );
    try {
      await classifier.classify({ conceptName: 'X', sourceMaterial });
      expect.unreachable('should have thrown');
    } catch (error) {
      expect((error as KnowledgeKindClassifierUnavailableError).reason).toBe('budget-exhausted');
    }
  });

  it('maps a transport-level failure (no response at all) to offline', async () => {
    const classifier = new WorkerKnowledgeKindClassifier({
      transport: {
        send: async () => {
          throw new Error('network unreachable');
        },
      },
    });

    await expect(classifier.classify({ conceptName: 'X', sourceMaterial })).rejects.toThrow(
      KnowledgeKindClassifierUnavailableError,
    );
    try {
      await classifier.classify({ conceptName: 'X', sourceMaterial });
      expect.unreachable('should have thrown');
    } catch (error) {
      expect((error as KnowledgeKindClassifierUnavailableError).reason).toBe('offline');
    }
  });

  it('does NOT map an unauthenticated or update-required refusal to KnowledgeKindClassifierUnavailableError — that is the composition root job (F7.8)', async () => {
    const transport = new RecordingTransport(() => ({
      ok: false,
      code: 'unauthenticated',
      message: 'This device is not linked.',
    }));
    const classifier = new WorkerKnowledgeKindClassifier({ transport });

    await expect(classifier.classify({ conceptName: 'X', sourceMaterial })).rejects.toThrow(
      WorkerKnowledgeKindClassifierError,
    );
    await expect(classifier.classify({ conceptName: 'X', sourceMaterial })).rejects.not.toThrow(
      KnowledgeKindClassifierUnavailableError,
    );
  });
});
