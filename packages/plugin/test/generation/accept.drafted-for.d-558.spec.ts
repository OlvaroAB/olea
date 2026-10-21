/**
 * `[D-558]` (`ol-egov.141.89.9.99`): accepting a draft records the concept it was drafted for beside
 * the item in Olea's home note, for both kinds, and enumeration then binds each item to that concept
 * and its courses alone.
 *
 * Scenarios: features/F3-learn-from-anything.md, the `[D-558]` block of the home-note feature —
 * "accepting a question-and-answer card draft records its concept the same way"
 * (@auto:plugin/generation/accept.drafted-for.d-558.spec). Synthetic vault: course D's code sorts
 * first, as on the run that found the defect.
 */
import { enumerateVaultInstruments, parseCards } from 'olea-core';
import { describe, expect, it } from 'vitest';
import { createDraftAcceptPort } from '../../src/generation/accept.js';
import { createVaultDraftCacheStore } from '../../src/generation/cache-store.js';
import { ensureHomeNoteForConcept, hashSourceRevision } from '../../src/generation/home-note.js';
import type { DraftRecord } from '../../src/generation/types.js';
import { MemoryVaultSource } from './fakes.js';

const COURSE_A = 'ZZZ100';
const COURSE_D = 'AAA100';
const SOURCE = `01 Courses/${COURSE_A}/Lecture.pdf`;
const HER_NOTES: Readonly<Record<string, string>> = {
  [`01 Courses/${COURSE_D}/d-note.md`]: '---\ntopic:\n  - Shared idea\n---\n\nSee [[Shared idea]].\n',
  [`01 Courses/${COURSE_A}/a-note.md`]:
    '---\ntopic:\n  - Shared idea\n  - Only-A idea\n---\n\nSee [[Shared idea]].\n',
  '05 Zettelkasten/Shared idea.md': 'A note she wrote.\n',
};

describe('[D-558] accept records the drafted-for concept, both kinds', () => {
  it('an accepted multiple-choice item for the shared concept and an accepted card for the A-only concept keep their own concept and courses', async () => {
    const vault = new MemoryVaultSource(HER_NOTES);
    const { concepts } = await enumerateVaultInstruments(vault);
    const shared = concepts.find((c) => c.name === 'Shared idea')?.key;
    const onlyA = concepts.find((c) => c.name === 'Only-A idea')?.key;
    if (shared === undefined || onlyA === undefined) throw new Error('test setup: concepts missing');
    const cache = createVaultDraftCacheStore(vault);
    const base = {
      status: 'pending' as const,
      courseCode: COURSE_A,
      createdAt: '2026-10-20T09:00:00Z',
      firstServedAt: null,
    };

    // The pipeline's order per concept: ensure the note, hash it, cache the draft.
    const note = await ensureHomeNoteForConcept(vault, SOURCE, 'Shared idea');
    if (note === null) throw new Error('test setup: expected a home note path');
    const mcqDraft: DraftRecord = {
      ...base,
      draftId: 'd-mcq',
      conceptName: 'Shared idea',
      conceptIds: [shared],
      sourcePath: note,
      sourceContentHash: await hashSourceRevision(await vault.read(note)),
      question: {
        stem: 'For the shared idea?',
        correctAnswer: 'r',
        distractors: ['a', 'b', 'c', 'd'],
        feedback: 'f',
      },
      provenance: { taskId: 'quiz.generate.v1', promptVersion: '1.0.0', modelId: 'm' },
    };
    await cache.put(mcqDraft);
    await ensureHomeNoteForConcept(vault, SOURCE, 'Only-A idea');
    const cardDraft: DraftRecord = {
      ...base,
      draftId: 'd-card',
      conceptName: 'Only-A idea',
      conceptIds: [onlyA],
      sourcePath: note,
      sourceContentHash: await hashSourceRevision(await vault.read(note)),
      instrumentType: 'qa',
      card: { front: 'For the only-A idea?', back: 'Because.' },
      provenance: { taskId: 'cards.generate.v1', promptVersion: '1.0.0', modelId: 'm' },
    };
    await cache.put(cardDraft);

    const port = createDraftAcceptPort({
      vault,
      cache,
      deviceId: 'device-a',
      now: () => new Date('2026-10-20T10:00:00Z'),
    });
    const mcq = await port.accept('d-mcq', 'accepted');
    // Not refused as stale: the record sits in the frontmatter, outside a home note's revision hash.
    const card = await port.accept('d-card', 'accepted');

    const text = vault.raw(note) ?? '';
    const blockId = parseCards(text).find((c) => c.type === 'qa')?.blockId;
    expect(text).toContain(
      `olea-drafted-for:\n  ${mcq.instrumentId}: ${shared}\n  ${blockId}: ${onlyA}\n`,
    );

    const { records, unbound } = await enumerateVaultInstruments(vault);
    expect(unbound).toEqual([]);
    const byId = new Map(records.map((r) => [r.instrumentId, r]));
    expect(byId.get(mcq.instrumentId)?.conceptIds).toEqual([shared]);
    expect(byId.get(mcq.instrumentId)?.courses).toEqual([COURSE_D, COURSE_A]);
    expect(byId.get(card.instrumentId)?.instrumentType).toBe('qa');
    expect(byId.get(card.instrumentId)?.conceptIds).toEqual([onlyA]);
    expect(byId.get(card.instrumentId)?.courses).toEqual([COURSE_A]);
  });

  it('accepting into a note she wrote records nothing (INV-6)', async () => {
    const vault = new MemoryVaultSource(HER_NOTES);
    const cache = createVaultDraftCacheStore(vault);
    const notePath = `01 Courses/${COURSE_A}/a-note.md`;
    await cache.put({
      draftId: 'd-hers',
      status: 'pending',
      courseCode: COURSE_A,
      conceptName: 'Only-A idea',
      conceptIds: ['concept-key1:k'],
      sourcePath: notePath,
      createdAt: '2026-10-20T09:00:00Z',
      question: { stem: 'Q?', correctAnswer: 'r', distractors: ['a', 'b', 'c', 'd'], feedback: 'f' },
      provenance: { taskId: 'quiz.generate.v1', promptVersion: '1.0.0', modelId: 'm' },
      firstServedAt: null,
    });
    const port = createDraftAcceptPort({ vault, cache, deviceId: 'device-a' });
    await port.accept('d-hers', 'accepted');
    expect(vault.raw(notePath)).not.toContain('olea-drafted-for');
  });
});
