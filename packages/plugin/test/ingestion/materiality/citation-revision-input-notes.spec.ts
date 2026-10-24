/**
 * `ol-egov.141.89.2.39` ([D-626], [D-628], [D-576]): the citation pass follows every note a drafted
 * item was drawn from.
 *
 * Scenarios (service repo, `features/F3-learn-from-anything.md`, "Feature: F3.3 / C5.3 — a drafted
 * item records every note it was drawn from, and each protects it"), written before this code:
 *  - "renaming an input note keeps the item": a kept item and a pending draft each drawn from a note
 *    that is then renamed both name the note's new path, and neither is withheld for the rename;
 *  - "a change to any input note routes the item as a change to its cited note does": the batch pass
 *    finding a change to the note the citation does not name routes the item to the same rewrite a
 *    change to its cited note gets, at whole-note grain.
 *
 * Through the production pieces: `CitationRevisionTrigger` (`tick`, `onSourceRenamed`, which
 * `main.ts`'s vault rename handler calls), the citation store, the draft cache, and the presentation
 * checks the session composes. Every note, course and sentence is invented.
 */
import {
  enumerateVaultInstruments,
  readInstrumentCitationRecord,
  readReviewLogHistory,
  suspendedInstrumentIds,
  writeInstrumentCitation,
} from 'olea-core';
import { describe, expect, it } from 'vitest';
import { createVaultDraftCacheStore } from '../../../src/generation/cache-store.js';
import type { DraftRecord } from '../../../src/generation/types.js';
import {
  draftSourceCheckAtPresentation,
  sourceCheckAtPresentation,
} from '../../../src/review/open-session.js';
import { currentInputNotes } from '../../generation/input-notes-fixture.js';
import { harness, MemoryVault } from './transcript-fixtures.ol-egov.141.89.5.43.js';

const COURSE = 'COURSEA';
const FOLDER = `01 Courses/${COURSE}`;
const HOME = `${FOLDER}/Week 1 (Olea).md`;
const NOTE_A = `${FOLDER}/Week 2.md`;
const NOTE_B = `${FOLDER}/Week 3.md`;
const NOTE_B_RENAMED = `${FOLDER}/Week 3, ripples and dunes.md`;

const A1 = 'Invented layers settle in order of their grain size.';
const B1 = 'Invented ripples form under a steady shallow flow.';
const B2 = 'Invented dunes migrate when the flow strengthens.';

const noteOf = (title: string, ...paragraphs: string[]): string =>
  `---\ncourse: ${COURSE}\n---\n\n# ${title}\n\n${paragraphs.join('\n\n')}\n`;

function world(): MemoryVault {
  const vault = new MemoryVault();
  vault.files.set(
    HOME,
    [
      '---',
      'topic: [Invented layering]',
      `course: ${COURSE}`,
      '---',
      '',
      '```olea-mcq',
      'id: q-one',
      'stem: Which invented statement holds?',
      'answer: Alpha',
      'distractor: Beta',
      'distractor: Gamma',
      'distractor: Delta',
      '```',
      '',
    ].join('\n'),
  );
  vault.files.set(NOTE_A, noteOf('Week 2', A1));
  vault.files.set(NOTE_B, noteOf('Week 3', B1, B2));
  return vault;
}

async function keptItem(vault: MemoryVault, citedPath = NOTE_A, notes = [NOTE_A, NOTE_B]) {
  await writeInstrumentCitation(
    vault,
    'q-one',
    { sourcePath: citedPath, page: 1 },
    await currentInputNotes(vault, ...notes),
  );
}

async function pendingDraft(vault: MemoryVault, notes: readonly string[]): Promise<DraftRecord> {
  const record: DraftRecord = {
    draftId: 'd-pending',
    status: 'pending',
    courseCode: COURSE,
    conceptName: 'Invented layering',
    conceptIds: ['concept-key-layering'],
    sourcePath: HOME,
    sourceCitation: { sourcePath: notes.length === 1 ? (notes[0] as string) : NOTE_A, page: 1 },
    inputNotes: await currentInputNotes(vault, ...notes),
    createdAt: '2026-10-24T09:00:00-07:00',
    question: {
      stem: 'Which invented statement about ripples holds?',
      correctAnswer: 'Alpha',
      distractors: ['Beta', 'Gamma', 'Delta'],
      feedback: 'See the invented notes.',
    },
    provenance: { taskId: 'quiz.generate.v1', promptVersion: '2.5.0', modelId: 'test-model' },
    firstServedAt: null,
  };
  await createVaultDraftCacheStore(vault).put(record);
  return record;
}

async function presentKept(vault: MemoryVault, h: ReturnType<typeof harness>, id: string) {
  const { records } = await enumerateVaultInstruments(vault, {
    concepts: { stampConceptKeys: true },
  });
  return sourceCheckAtPresentation(
    h.store,
    async () => suspendedInstrumentIds((await readReviewLogHistory(vault)).entries),
    { vault, recordOf: (instrumentId) => records.find((r) => r.instrumentId === instrumentId) },
    { vault, draftedInstrumentIds: new Set([id]) },
  )(id);
}

describe('renaming an input note keeps the item ([D-576])', () => {
  it('a kept item and a pending draft drawn from a note that is renamed both name the new path, and neither is withheld for the rename', async () => {
    const vault = world();
    await keptItem(vault);
    await pendingDraft(vault, [NOTE_B]);
    const h = harness({ transcriptPartGrain: true });
    await h.pass(vault);

    vault.move(NOTE_B, NOTE_B_RENAMED);
    expect(await h.trigger.onSourceRenamed(vault, NOTE_B, NOTE_B_RENAMED)).toBe(2);

    const citation = await readInstrumentCitationRecord(vault, 'q-one');
    expect(citation?.inputNotes?.map((note) => note.path)).toEqual([NOTE_A, NOTE_B_RENAMED]);
    expect(citation?.sourcePath).toBe(NOTE_A);
    const draft = await createVaultDraftCacheStore(vault).get('d-pending');
    expect(draft?.inputNotes?.map((note) => note.path)).toEqual([NOTE_B_RENAMED]);
    expect(draft?.sourceCitation?.sourcePath).toBe(NOTE_B_RENAMED);

    expect(await presentKept(vault, h, 'q-one')).toBe('clear');
    if (draft === null) throw new Error('the draft went missing');
    expect(await draftSourceCheckAtPresentation(vault, [draft])('d-pending')).toBe('clear');
    const report = await h.pass(vault);
    expect(report.inputNotesRouted).toBe(0);
    expect(h.actions.enqueue).not.toHaveBeenCalled();
    expect(await h.withheld(['q-one'])).toEqual(new Set());
  });

  it('the note its citation names, renamed: the citation and its anchor follow too, so it is not withheld', async () => {
    const vault = world();
    await keptItem(vault, NOTE_B, [NOTE_B]);
    const h = harness({ transcriptPartGrain: true });
    await h.pass(vault);

    vault.move(NOTE_B, NOTE_B_RENAMED);
    await h.trigger.onSourceRenamed(vault, NOTE_B, NOTE_B_RENAMED);
    const citation = await readInstrumentCitationRecord(vault, 'q-one');
    expect(citation?.sourcePath).toBe(NOTE_B_RENAMED);
    expect((await h.store.loadAll()).get('q-one')?.sourcePath).toBe(NOTE_B_RENAMED);
    expect(await presentKept(vault, h, 'q-one')).toBe('clear');
    await h.pass(vault);
    expect(await h.withheld(['q-one'])).toEqual(new Set());
  });

  it('a rename that makes the note another kind of source is not followed', async () => {
    const vault = world();
    await keptItem(vault);
    vault.move(NOTE_B, `${FOLDER}/Week 3.txt`);
    const h = harness({ transcriptPartGrain: true });
    expect(await h.trigger.onSourceRenamed(vault, NOTE_B, `${FOLDER}/Week 3.txt`)).toBe(0);
    const citation = await readInstrumentCitationRecord(vault, 'q-one');
    expect(citation?.inputNotes?.map((note) => note.path)).toEqual([NOTE_A, NOTE_B]);
  });
});

describe('a change to any input note routes the item as a change to its cited note does', () => {
  it('a change to the note its citation does not name: the same rewrite, enqueued then suspended, at whole-note grain', async () => {
    const vault = world();
    await keptItem(vault);
    const h = harness({ transcriptPartGrain: true });
    await h.pass(vault);
    expect(h.actions.enqueue).not.toHaveBeenCalled();

    vault.files.set(NOTE_B, noteOf('Week 3', B1, 'Invented dunes stall when the flow weakens.'));
    const report = await h.pass(vault);

    expect(report.inputNotesRouted).toBe(1);
    expect(h.actions.enqueue).toHaveBeenCalledTimes(1);
    const [input] = h.actions.enqueue.mock.calls[0] ?? [];
    // The successor is drafted from the cited note as it stands, as a whole-note rewrite is.
    expect(input?.payload).toEqual({
      kind: 'instrument-revision',
      predecessorInstrumentId: 'q-one',
      newPassageText: await vault.read(NOTE_A),
    });
    expect(h.actions.suspend.mock.calls.map((call) => call[0])).toEqual(['q-one']);
    const pending = (await h.store.loadAll()).get('q-one')?.pendingRevalidation;
    expect(pending?.raisedBy).toEqual({
      kind: 'code',
      rule: 'input-note-changed',
      ruleVersion: 1,
    });
    expect(pending?.decidedBy).toEqual({
      kind: 'code',
      rule: 'input-note-rewrite',
      ruleVersion: 1,
    });

    // Left alone thereafter: suspended with its check owed, as a completed rewrite is.
    await h.pass(vault);
    expect(h.actions.enqueue).toHaveBeenCalledTimes(1);
  });

  it('a change to its cited note takes the cited-note route it always took, and it too ends in a rewrite', async () => {
    const vault = world();
    await keptItem(vault);
    const h = harness({ transcriptPartGrain: true });
    await h.pass(vault);

    vault.files.set(NOTE_A, noteOf('Week 2', 'Invented layers settle in no particular order.'));
    const report = await h.pass(vault);
    expect(report.inputNotesRouted).toBe(0);
    expect(h.judge.judge).toHaveBeenCalledTimes(1);
    expect(h.actions.enqueue).toHaveBeenCalledTimes(1);
    expect(h.actions.suspend.mock.calls.map((call) => call[0])).toEqual(['q-one']);
  });

  it('a change between drafting and the first pass is routed, never adopted as the baseline', async () => {
    const vault = world();
    await keptItem(vault);
    vault.files.set(NOTE_A, noteOf('Week 2', 'Invented layers settle in no particular order.'));
    const h = harness({ transcriptPartGrain: true });
    const report = await h.pass(vault);
    expect(report.inputNotesRouted).toBe(1);
    expect(report.newlyBaselined).toBe(0);
    expect(h.actions.enqueue).toHaveBeenCalledTimes(1);
    expect(await h.withheld(['q-one'])).toEqual(new Set(['q-one']));
  });
});
