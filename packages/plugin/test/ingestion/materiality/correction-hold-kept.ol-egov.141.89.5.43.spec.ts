// Scenario: features/F1-sources.md "a correction's hold is kept through every later pass until it is
// reconciled" (ol-egov.141.89.5.43; D-467, D-473). Test id:
// @auto:plugin/ingestion/materiality/correction-hold-kept.ol-egov.141.89.5.43.spec
//
// [D-467]: an instrument whose slide claim a lecturer's correction invalidates is withheld until its
// grounding is reconciled, though its cited file is unchanged. [D-473] stores that withholding as a
// reason on the citation anchor and requires a build that does not know the reason to keep the hold.
// Nothing yet writes that reason (no producer of a lecturer correction keyed to a slide claim exists),
// so the hold here is an invented reason string, standing for a value this build does not resolve.
// What is pinned: no later pass of this build replaces or lifts it, whatever happens to the cited
// file, and unaffected instruments keep their own handling. Every fixture is INVENTED.
import { citationStorePath, digestPassage, hashContent } from 'olea-core';
import { describe, expect, it } from 'vitest';
import type { PendingReason } from '../../../src/ingestion/materiality/citation-hash-store.js';
import { SOURCE_REVISION_REASON } from '../../../src/ingestion/materiality/citation-revision-wiring.js';
import {
  harness,
  historyAdded,
  historyOf,
  homeNote,
  MemoryVault,
  seedHistory,
  sidecar,
} from './transcript-fixtures.ol-egov.141.89.5.43.js';

/** Invented: a withholding reason this build does not know (as a newer build's correction reason would be). */
const CORRECTION_HOLD = 'reason-from-a-newer-build' as PendingReason;

const DECK = 'Course A/Lecture 3/slides.pdf';
const DECK_HOME = 'Course A/Lecture 3/slides (Olea).md';
const deckV1 = new TextEncoder().encode('invented deck bytes, version one');
const deckV2 = new TextEncoder().encode('invented deck bytes, version two');

async function deckVault(): Promise<MemoryVault> {
  const vault = new MemoryVault();
  vault.files.set(DECK_HOME, homeNote('Invented slide topic', ['q-claim', 'q-other']));
  vault.binaries.set(DECK, deckV1);
  const revision = await hashContent(deckV1);
  vault.files.set(
    citationStorePath('q-claim'),
    sidecar({ instrumentId: 'q-claim', sourcePath: DECK, page: 2, sourceRevision: revision }),
  );
  vault.files.set(
    citationStorePath('q-other'),
    sidecar({ instrumentId: 'q-other', sourcePath: DECK, page: 3, sourceRevision: revision }),
  );
  await seedHistory(vault, ['q-claim', 'q-other']);
  return vault;
}

describe('a correction hold this build does not resolve is kept ([D-467], [D-473])', () => {
  it('a slide-grounded instrument stays withheld through a deck change and its revert; the other page follows its own bytes', async () => {
    const vault = await deckVault();
    const h = harness({ transcriptPartGrain: false });
    await h.pass(vault);
    await h.store.setPendingRevalidation('q-claim', 'h-correction', 500, CORRECTION_HOLD);
    const history = historyOf(vault);

    vault.binaries.set(DECK, deckV2);
    await h.pass(vault);
    const changed = await h.store.loadAll();
    expect(changed.get('q-claim')?.pendingRevalidation?.reason).toBe(CORRECTION_HOLD);
    expect(changed.get('q-claim')?.pendingRevalidation?.sinceContentHash).toBe('h-correction');
    expect(changed.get('q-other')?.pendingRevalidation?.reason).toBe(SOURCE_REVISION_REASON);
    expect(await h.withheld(['q-claim', 'q-other'])).toEqual(new Set(['q-claim', 'q-other']));

    vault.binaries.set(DECK, deckV1);
    await h.pass(vault);
    const reverted = await h.store.loadAll();
    expect(reverted.get('q-claim')?.pendingRevalidation?.reason).toBe(CORRECTION_HOLD);
    expect(reverted.get('q-other')?.pendingRevalidation).toBeUndefined();
    expect(await h.withheld(['q-claim', 'q-other'])).toEqual(new Set(['q-claim']));

    expect(h.judge.judge).not.toHaveBeenCalled();
    expect(h.actions.suspend).not.toHaveBeenCalled();
    expect(h.actions.enqueue).not.toHaveBeenCalled();
    expect(historyAdded(history, vault)).toEqual([]);
  });

  const NOTE = 'Course A/Lecture 3/notes.md';
  const NOTE_HOME = 'Course A/Lecture 3/notes (Olea).md';
  const PASSAGE = 'An invented claim states that the sample value rises with depth.';
  const noteWith = (passage: string): string =>
    `# Invented heading\n\nAn opening line about something else.\n\n${passage}\n`;

  async function noteVault(): Promise<MemoryVault> {
    const vault = new MemoryVault();
    vault.files.set(NOTE_HOME, homeNote('Invented note topic', ['q-note']));
    vault.files.set(NOTE, noteWith(PASSAGE));
    vault.files.set(
      citationStorePath('q-note'),
      `${JSON.stringify({
        instrumentId: 'q-note',
        sourcePath: NOTE,
        page: 1,
        passageDigest: await digestPassage(PASSAGE),
        schemaVersion: 2,
      })}\n`,
    );
    await seedHistory(vault, ['q-note']);
    return vault;
  }

  it('a passage that goes missing and comes back does not lift the hold', async () => {
    const vault = await noteVault();
    const h = harness({ transcriptPartGrain: false });
    await h.pass(vault);
    await h.store.setPendingRevalidation('q-note', 'h-correction', 500, CORRECTION_HOLD);

    vault.files.set(NOTE, noteWith('Something entirely unrelated now stands here instead.'));
    await h.pass(vault);
    expect((await h.store.loadAll()).get('q-note')?.pendingRevalidation?.reason).toBe(
      CORRECTION_HOLD,
    );

    vault.files.set(NOTE, noteWith(PASSAGE));
    await h.pass(vault);
    const pending = (await h.store.loadAll()).get('q-note')?.pendingRevalidation;
    expect(pending?.reason).toBe(CORRECTION_HOLD);
    expect(pending?.sinceContentHash).toBe('h-correction');
    expect(await h.withheld(['q-note'])).toEqual(new Set(['q-note']));
  });

  it('an edited passage under the hold is never judged or rewritten by this build', async () => {
    const vault = await noteVault();
    const h = harness({ transcriptPartGrain: false });
    await h.pass(vault);
    await h.store.setPendingRevalidation('q-note', 'h-correction', 500, CORRECTION_HOLD);
    const history = historyOf(vault);

    vault.files.set(NOTE, noteWith(PASSAGE.replace('rises', 'falls')));
    await h.pass(vault);
    await h.pass(vault);

    expect(h.judge.judge).not.toHaveBeenCalled();
    expect(h.actions.suspend).not.toHaveBeenCalled();
    expect(h.actions.enqueue).not.toHaveBeenCalled();
    expect((await h.store.loadAll()).get('q-note')?.pendingRevalidation?.reason).toBe(
      CORRECTION_HOLD,
    );
    expect(historyAdded(history, vault)).toEqual([]);
  });
});
