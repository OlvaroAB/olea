/** Shared synthetic fixtures for the scope-reading driver specs (`ol-egov.141.89.7.52`). Invented ids and wording only. */

import type { ExtractedUnit, OutcomeRecord, WorkerTaskTransport } from 'olea-core';
import { createScopeReadingPersistence } from '../../src/scope-reading/persistence.js';
import { memoryVault } from '../review/memory-vault.js';

export const STAMP = { promptVersion: 'p1', modelId: 'm1' };
export const COURSE = 'TESTC1';

let tick = 0;
const now = () => `2026-10-06T00:00:${String(tick++ % 60).padStart(2, '0')}.000Z`;

export function unit(text: string, page: number, section?: string): ExtractedUnit {
  return {
    text,
    provenance: {
      sourcePath: 'doc-a',
      location: { page, ...(section !== undefined ? { section } : {}) },
    },
  };
}

export const unitsOf = (n: number): ExtractedUnit[] =>
  Array.from({ length: n }, (_, i) => unit(`Unit ${i} text.`, i + 1));

export function conceptNotes(names: readonly string[], course = COURSE) {
  const files: Record<string, string> = {};
  names.forEach((name, i) => {
    files[`Courses/${course}/note-${i}.md`] = [
      '---',
      `topic: [${name}]`,
      `course: ${course}`,
      '---',
      '',
      `Body ${i}.`,
      '',
    ].join('\n');
  });
  return files;
}

export function setup(files: Record<string, string> = {}) {
  const vault = memoryVault(files);
  const persistence = createScopeReadingPersistence({ vault, deviceId: 'olea-dev1', now });
  return { vault, persistence };
}

export function outcome(id: string, blockIndex: number, path = 'doc-o'): OutcomeRecord {
  return {
    id,
    courses: [COURSE],
    source: { path, blockIndex },
    label: `Declaration ${id}`,
    conceptKeys: [],
    status: 'active',
    provenance: { promptVersion: 'p1', modelVersion: 'm1' },
    mintedAt: '2026-10-06',
    schemaVersion: 1,
  } as OutcomeRecord;
}

export interface Sent {
  readonly taskId: string;
  readonly payload: Record<string, unknown>;
}

/** A transport that records every request and answers with `answer(request, n)`; a thrown error is the transport failing. */
export function transport(answer: (sent: Sent, n: number) => unknown) {
  const sent: Sent[] = [];
  const t: WorkerTaskTransport = {
    async send(request) {
      sent.push({ taskId: request.taskId, payload: request.payload as Record<string, unknown> });
      return answer(sent[sent.length - 1] as Sent, sent.length);
    },
  };
  return { transport: t, sent };
}

type WirePassage = { ref: string; role: string };
type WireRecord = { recordId: string; passages: WirePassage[] };
type WireConcept = { handle: string };

/** An alignment answer that attests every concept for every record, citing the record's own passage. */
export function alignAll(sent: Sent, stamp = STAMP): unknown {
  const records = sent.payload.records as WireRecord[];
  const concepts = sent.payload.concepts as WireConcept[];
  return {
    ok: true,
    stamp,
    result: {
      batchId: sent.payload.batchId,
      coverageDigest: (sent.payload.coverage as { digest: string }).digest,
      decisions: records.map((r) => ({
        recordId: r.recordId,
        attests: concepts.map((c) => ({
          handle: c.handle,
          verdict: 'within-scope',
          refs: [(r.passages.find((p) => p.role === 'record') as WirePassage).ref],
        })),
      })),
    },
  };
}

/** An alignment answer that decides every record and attests nothing. */
export function alignNone(sent: Sent, stamp = STAMP): unknown {
  const records = sent.payload.records as WireRecord[];
  return {
    ok: true,
    stamp,
    result: {
      batchId: sent.payload.batchId,
      coverageDigest: (sent.payload.coverage as { digest: string }).digest,
      decisions: records.map((r) => ({ recordId: r.recordId, attests: [] })),
    },
  };
}

export function demandAnswer(sent: Sent, stamp = STAMP): unknown {
  const part = sent.payload.part as { instruction: { ref: string } };
  return {
    ok: true,
    stamp,
    result: {
      verdict: { kind: 'demand', demand: 'calculate' },
      commandWord: 'find',
      refs: [part.instruction.ref],
    },
  };
}
