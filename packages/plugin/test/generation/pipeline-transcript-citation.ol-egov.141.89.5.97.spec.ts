// `ol-egov.141.89.5.97` ([D-567], [D-518], [D-543]): the sweep's citation for a question drafted
// from a lecture transcript records the version its parts were read from (plain text and declared
// Markdown alike) and names the part the question was drafted from only when the request's single
// grounding chunk stands once inside one part; otherwise it names no part, and the whole transcript
// is protected. Units and versions come from the production transcript job runner, as they reach
// the sweep in production. Every transcript, course and sentence is invented ("course A").
import {
  type ConceptRecord,
  createTranscriptAwareJobRunner,
  digestPassage,
  type ExtractedUnit,
} from 'olea-core';
import { describe, expect, it } from 'vitest';
import { createVaultDraftCacheStore } from '../../src/generation/cache-store.js';
import { runGenerationSweep } from '../../src/generation/pipeline.js';
import {
  bytesHashOf,
  LECTURE,
  MemoryVault,
  partCues,
  spoken,
  transcriptOf,
} from '../ingestion/materiality/transcript-fixtures.ol-egov.141.89.5.43.js';

const TXT = '01 Courses/COURSEA/Lecture 3/transcript.txt';
const MD = '01 Courses/COURSEA/Lecture 3/transcript.md';
const declared = (cues: readonly string[]): string =>
  `---\nrole: lecture transcript\n---\n\n${transcriptOf(cues)}`;

const concept = (): ConceptRecord => ({
  key: 'k-invented',
  name: 'Invented lecture topic',
  tier: 2,
  courses: ['COURSEA'],
  sourcePaths: [TXT],
});

/** What the production transcript runner hands the sink for `path`: its parts and its version. */
async function landed(
  vault: MemoryVault,
  path: string,
  transcriptFormat: 'plain-text' | 'markdown',
): Promise<{ units: readonly ExtractedUnit[]; revisions: ReadonlyMap<string, string> }> {
  let delivered: { units: readonly ExtractedUnit[]; revisions: ReadonlyMap<string, string> } = {
    units: [],
    revisions: new Map(),
  };
  const runner = createTranscriptAwareJobRunner({
    vault,
    sink: {
      async receive(units, revisions) {
        delivered = { units, revisions: revisions ?? new Map() };
      },
    },
    fallback: async () => ({ ok: true }),
  });
  const outcome = await runner({
    contentHash: 'h',
    label: path,
    payload: { kind: 'transcript', sourcePath: path, transcriptFormat },
    attempts: 0,
  });
  expect(outcome).toEqual({ ok: true });
  return delivered;
}

/** One sweep over the landed units, the drafting request carrying `sourceChunks`. */
async function sweep(
  vault: MemoryVault,
  arrival: { units: readonly ExtractedUnit[]; revisions: ReadonlyMap<string, string> },
  sourceChunks: readonly string[],
) {
  const cache = createVaultDraftCacheStore(vault);
  await runGenerationSweep([...arrival.units], {
    vault,
    cache,
    draftDeps: {} as never,
    listConceptsForCourse: async () => [concept()],
    draftForConcept: async () =>
      ({
        status: 'drafted',
        request: { courseCode: 'COURSEA', conceptName: 'Invented lecture topic', sourceChunks },
        response: {
          ok: true,
          stamp: { contractVersion: 1, promptVersion: '1.0.0', modelId: 'test-model' },
          result: {
            questions: [
              {
                stem: 'Which invented statement holds?',
                correctAnswer: 'Alpha',
                distractors: ['Beta', 'Gamma', 'Delta'],
                feedback: 'Invented feedback.',
              },
            ],
          },
        },
      }) as never,
    sourceRevisions: arrival.revisions,
  });
  const [record] = await cache.listPending();
  if (record === undefined) throw new Error('nothing was drafted');
  return record;
}

/** A part's text as the reader cuts it from the plain-text lecture: its cues as paragraphs. */
const partText = (p: number): string => partCues(p).join('\n\n');

describe('a transcript citation names the part its question was drafted from, or none (ol-egov.141.89.5.97)', () => {
  it('drafted from part 4 alone: part 4 is named, never the first part that landed, and the version is recorded', async () => {
    const vault = new MemoryVault();
    vault.files.set(TXT, transcriptOf(LECTURE));
    const arrival = await landed(vault, TXT, 'plain-text');
    expect(arrival.units[0]?.provenance.location.page).toBe(1);
    const record = await sweep(vault, arrival, [partText(4)]);
    expect(record.sourceCitation).toEqual({
      sourcePath: TXT,
      page: 4,
      passageDigest: await digestPassage(spoken(partCues(4))),
      sourceRevision: await bytesHashOf(transcriptOf(LECTURE)),
    });
  });

  it('drafted from several passages: no part is named, the version is recorded, and the whole transcript is protected', async () => {
    const vault = new MemoryVault();
    vault.files.set(TXT, transcriptOf(LECTURE));
    const record = await sweep(vault, await landed(vault, TXT, 'plain-text'), [
      partText(2),
      partText(4),
    ]);
    expect(record.sourceCitation?.passageDigest).toBeUndefined();
    expect(record.sourceCitation?.sourceRevision).toBe(await bytesHashOf(transcriptOf(LECTURE)));
  });

  it('a single chunk that is not in this transcript, or runs across two parts, names no part', async () => {
    const vault = new MemoryVault();
    vault.files.set(TXT, transcriptOf(LECTURE));
    const arrival = await landed(vault, TXT, 'plain-text');
    const elsewhere = await sweep(vault, arrival, ['An invented sentence from another note.']);
    expect(elsewhere.sourceCitation?.passageDigest).toBeUndefined();

    const vault2 = new MemoryVault();
    vault2.files.set(TXT, transcriptOf(LECTURE));
    const across = await sweep(vault2, await landed(vault2, TXT, 'plain-text'), [
      `${partCues(3)[2]}\n\n${partCues(4)[0]}`,
    ]);
    expect(across.sourceCitation?.passageDigest).toBeUndefined();
  });

  it('a declared-Markdown transcript records its version too, and names the part drafted from', async () => {
    const vault = new MemoryVault();
    vault.files.set(MD, declared(LECTURE));
    const arrival = await landed(vault, MD, 'markdown');
    expect(arrival.revisions.get(MD)).toBe(await bytesHashOf(declared(LECTURE)));
    const record = await sweep(vault, arrival, [partText(4)]);
    expect(record.sourceCitation).toEqual({
      sourcePath: MD,
      page: 4,
      passageDigest: await digestPassage(spoken(partCues(4))),
      sourceRevision: await bytesHashOf(declared(LECTURE)),
    });
  });
});
