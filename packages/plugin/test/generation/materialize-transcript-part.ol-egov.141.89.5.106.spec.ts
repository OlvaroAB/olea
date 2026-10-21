// `ol-egov.141.89.5.106` ([D-567], [D-543], C5.3 "Which part"): the accept-time seal leaves a declared
// Markdown transcript's part digest as drafted, so a question drafted from one part is tracked at
// that part after accept. Through the materialize path (`materializeAcceptedDraft`,
// `materializeAcceptedCardDraft`) and the production citation trigger with part grain on. An
// ordinary Markdown note is sealed as before. Every text is invented ("course A").
import { digestPassage, readInstrumentCitation } from 'olea-core';
import { describe, expect, it, vi } from 'vitest';
import { materializeAcceptedCardDraft } from '../../src/generation/materialize-card.js';
import { materializeAcceptedDraft } from '../../src/generation/materialize-mcq.js';
import { ObsidianCitationHashStore } from '../../src/ingestion/materiality/citation-hash-store.js';
import { buildCitationRevisionWiring } from '../../src/ingestion/materiality/citation-revision-wiring.js';
import { readTranscriptVersion } from '../../src/ingestion/materiality/transcript-grain.js';
import {
  bytesHashOf,
  FakeDataHost,
  LECTURE,
  MemoryVault,
  partCues,
  spoken,
  transcriptOf,
} from '../ingestion/materiality/transcript-fixtures.ol-egov.141.89.5.43.js';

const HOME = 'Course A/Lecture 3/topic (Olea).md';
const HOME_TEXT = '---\ntopic: [Invented topic]\ncourse: COURSEA\n---\n\nHome note prose.\n';
const DECLARED = 'Course A/Lecture 3/transcript.md';
const NOTE = 'Course A/Lecture 3/ordinary.md';
const QUESTION = {
  stem: 'Which invented statement holds?',
  correctAnswer: 'Alpha',
  distractors: ['Beta', 'Gamma', 'Delta', 'Epsilon'],
  feedback: 'See the lecture.',
};
const CARD = { front: 'What holds?', back: 'Alpha' };

const declaredText = (): string => `---\nrole: lecture transcript\n---\n\n${transcriptOf(LECTURE)}`;

async function citationFromPart(vault: MemoryVault, page: number) {
  const read = await readTranscriptVersion(vault, DECLARED);
  if (read.kind !== 'read') throw new Error('fixture does not read as a transcript');
  const part = read.version.parts.find((candidate) => candidate.ordinal === page);
  if (part === undefined) throw new Error(`no part ${page}`);
  return {
    sourcePath: DECLARED,
    page,
    sourceRevision: await bytesHashOf(vault.files.get(DECLARED) ?? ''),
    passageDigest: await digestPassage(part.spoken),
  };
}

describe('ol-egov.141.89.5.106: a declared Markdown transcript keeps its part through accept', () => {
  it('a question drafted from one part keeps its part digest through accept and is tracked at that part', async () => {
    const vault = new MemoryVault();
    vault.files.set(HOME, HOME_TEXT);
    vault.files.set(DECLARED, declaredText());
    const drafted = await citationFromPart(vault, 4);

    const { instrumentId } = await materializeAcceptedDraft(vault, {
      sourcePath: HOME,
      question: QUESTION,
      draftId: 'draft-1',
      sourceCitation: drafted,
    });
    const stored = await readInstrumentCitation(vault, instrumentId);
    expect(stored?.passageDigest).toBe(drafted.passageDigest);
    expect(stored?.sourceRevision).toBe(drafted.sourceRevision);

    const store = new ObsidianCitationHashStore(new FakeDataHost());
    const trigger = buildCitationRevisionWiring({
      store,
      judge: { judge: vi.fn(async () => ({ material: true, reason: 'scripted' })) },
      clock: { now: () => 1_000 },
      transcriptPartGrain: true,
    });
    await trigger.tick(vault, { enqueue: async () => undefined, suspend: async () => undefined });
    const anchor = (await store.loadAll()).get(instrumentId);
    expect(anchor?.text).toBe(spoken(partCues(4)));
    expect(anchor?.passageDigest).toBe(drafted.passageDigest);
  });

  it('a card drafted from one part keeps its part digest the same way', async () => {
    const vault = new MemoryVault();
    vault.files.set(HOME, HOME_TEXT);
    vault.files.set(DECLARED, declaredText());
    const drafted = await citationFromPart(vault, 2);
    const { instrumentId } = await materializeAcceptedCardDraft(vault, {
      sourcePath: HOME,
      card: CARD,
      draftId: 'draft-2',
      sourceCitation: drafted,
    });
    expect((await readInstrumentCitation(vault, instrumentId))?.passageDigest).toBe(
      drafted.passageDigest,
    );
  });

  it('a question on an ordinary Markdown note is sealed exactly as before: an unresolvable digest is dropped', async () => {
    const vault = new MemoryVault();
    vault.files.set(HOME, HOME_TEXT);
    vault.files.set(NOTE, `---\nrole: notes\n---\n\n${transcriptOf(LECTURE)}`);
    const { instrumentId } = await materializeAcceptedDraft(vault, {
      sourcePath: HOME,
      question: QUESTION,
      draftId: 'draft-3',
      sourceCitation: {
        sourcePath: NOTE,
        page: 1,
        passageDigest: await digestPassage(spoken(partCues(4))),
      },
    });
    expect((await readInstrumentCitation(vault, instrumentId))?.passageDigest).toBeUndefined();
  });
});
