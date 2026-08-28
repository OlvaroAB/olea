/**
 * `evaluateCitedPassageRevision` — `[CORP-3]` / `[D-093]`'s item clause,
 * proving the outcome ladder in the order the clause states it: relocate
 * before stranding, hash before judge, same claim before changed claim, and
 * no floor/debounce at this grain (every hash difference reaches the
 * judge).
 *
 * Mirrors `features/F3-learn-from-anything.md`'s
 * `Feature: C5.3 / [D-093] — When the source passage changes underneath an
 * item` scenario cluster.
 *
 * INV-3: every string here is coined. No course code, note title or wording
 * comes from any real vault.
 */

import { describe, expect, it } from 'vitest';
import { hashText } from '../../ingestion/hash.js';
import type { Clock } from '../../ingestion/types.js';
import { evaluateCitedPassageRevision } from './material-change.js';
import type { CitedPassageInput, RevisionJudgePort, RevisionJudgeVerdict } from './types.js';

const clock: Clock = { now: () => 5_000 };

function stubJudge(verdict: RevisionJudgeVerdict): RevisionJudgePort {
  return { judge: async () => verdict };
}

describe('evaluateCitedPassageRevision', () => {
  it('reports unchanged when the hash at the recorded anchor is identical', async () => {
    const text = 'plate boundaries release energy as earthquakes';
    const input: CitedPassageInput = {
      instrumentId: 'inst-1',
      previousText: text,
      previousContentHash: await hashText(text),
      current: { kind: 'found-at-anchor', text },
    };
    const outcome = await evaluateCitedPassageRevision(input, stubJudge({ material: true }), clock);
    expect(outcome).toEqual({ kind: 'unchanged' });
  });

  it('heals a stranded citation silently on an exact relocation match, without calling the judge', async () => {
    let called = false;
    const judge: RevisionJudgePort = {
      judge: async () => {
        called = true;
        return { material: true };
      },
    };
    const oldText = 'sediment compacts into rock over geological time';
    const input: CitedPassageInput = {
      instrumentId: 'inst-2',
      previousText: oldText,
      previousContentHash: await hashText(oldText),
      current: {
        kind: 'not-found',
        relocationCandidates: [
          {
            anchor: {
              sourcePath: 'Note C.md',
              location: { page: 1, charRange: { start: 0, end: 10 } },
            },
            text: '  sediment compacts   into rock over geological time  ',
          },
        ],
      },
    };
    const outcome = await evaluateCitedPassageRevision(input, judge, clock);
    expect(outcome.kind).toBe('relocated');
    expect(called).toBe(false);
  });

  it('proposes a re-bind, never a silent heal, on a near (non-exact) relocation match', async () => {
    const oldText = 'sediment compacts into rock over geological time and pressure';
    const input: CitedPassageInput = {
      instrumentId: 'inst-3',
      previousText: oldText,
      previousContentHash: await hashText(oldText),
      current: {
        kind: 'not-found',
        relocationCandidates: [
          {
            anchor: {
              sourcePath: 'Note C.md',
              location: { page: 1, charRange: { start: 0, end: 10 } },
            },
            text: 'sediment compacts into rock over geological time and heat',
          },
        ],
      },
    };
    const outcome = await evaluateCitedPassageRevision(input, stubJudge({ material: true }), clock);
    expect(outcome.kind).toBe('relocation-proposed');
  });

  it('reports stranded when no relocation candidate matches at all', async () => {
    const oldText = 'sediment compacts into rock over geological time';
    const input: CitedPassageInput = {
      instrumentId: 'inst-4',
      previousText: oldText,
      previousContentHash: await hashText(oldText),
      current: { kind: 'not-found', relocationCandidates: [] },
    };
    const outcome = await evaluateCitedPassageRevision(input, stubJudge({ material: true }), clock);
    expect(outcome).toEqual({ kind: 'stranded' });
  });

  it('reports judge-unavailable when the hash changed but no judge is configured — never fabricates a verdict', async () => {
    const input: CitedPassageInput = {
      instrumentId: 'inst-5',
      previousText: 'the old wording of the passage',
      previousContentHash: await hashText('the old wording of the passage'),
      current: { kind: 'found-at-anchor', text: 'the new wording of the passage' },
    };
    const outcome = await evaluateCitedPassageRevision(input, null, clock);
    expect(outcome).toEqual({ kind: 'judge-unavailable' });
  });

  it('every hash difference reaches the judge, with no size floor at this grain', async () => {
    let seenTexts: { previousText: string; currentText: string } | null = null;
    const judge: RevisionJudgePort = {
      judge: async (i) => {
        seenTexts = i;
        return { material: false };
      },
    };
    const oldText = 'the rate is 3 m/s';
    const newText = 'the rate is not 3 m/s';
    const input: CitedPassageInput = {
      instrumentId: 'inst-6',
      previousText: oldText,
      previousContentHash: await hashText(oldText),
      current: { kind: 'found-at-anchor', text: newText },
    };
    const outcome = await evaluateCitedPassageRevision(input, judge, clock);
    expect(outcome.kind).not.toBe('judge-unavailable');
    expect(outcome.kind).not.toBe('unchanged');
    expect(seenTexts).toEqual({ previousText: oldText, currentText: newText });
  });

  it('same claim: refreshes silently, keeping id and history — produces a RevisionEvent with both hashes', async () => {
    const oldText = 'the process takes several weeks';
    const newText = 'the process takes several weeks (reworded)';
    const input: CitedPassageInput = {
      instrumentId: 'inst-7',
      previousText: oldText,
      previousContentHash: await hashText(oldText),
      current: { kind: 'found-at-anchor', text: newText },
    };
    const outcome = await evaluateCitedPassageRevision(
      input,
      stubJudge({ material: false, reason: 'same claim, reworded' }),
      clock,
    );
    expect(outcome.kind).toBe('refreshed');
    if (outcome.kind === 'refreshed') {
      expect(outcome.event.instrumentId).toBe('inst-7');
      expect(outcome.event.at).toBe(5_000);
      expect(outcome.event.oldContentHash).toBe(await hashText(oldText));
      expect(outcome.event.newContentHash).toBe(await hashText(newText));
      expect(outcome.event.change).toBe('same claim, reworded');
    }
  });

  it('changed claim: suspends the old instrument and names it as the predecessor on the successor job', async () => {
    const oldText = 'the reaction is exothermic';
    const newText = 'the reaction is endothermic';
    const input: CitedPassageInput = {
      instrumentId: 'inst-8',
      previousText: oldText,
      previousContentHash: await hashText(oldText),
      current: { kind: 'found-at-anchor', text: newText },
    };
    const outcome = await evaluateCitedPassageRevision(
      input,
      stubJudge({ material: true, reason: 'sign of the reaction flipped' }),
      clock,
    );
    expect(outcome.kind).toBe('revised');
    if (outcome.kind === 'revised') {
      expect(outcome.predecessorInstrumentId).toBe('inst-8');
      expect(outcome.event.change).toBe('sign of the reaction flipped');
      expect(outcome.successorEnqueueInput.label).toBe('instrument-revision:inst-8');
      expect(outcome.successorEnqueueInput.contentHash).toBe(outcome.event.newContentHash);
    }
  });

  it('a formatting-only difference at the citation grain still reaches the judge, which is the honest source of the same-claim verdict', async () => {
    // Unlike row 1.4's file-level trigger, this module applies no
    // canonicalisation of its own at this grain (see relocate.ts's module
    // doc) — a whitespace-only change still differs in raw hash and is
    // handed to the judge, which is expected to read it as the same claim.
    const oldText = 'water boils at 100 degrees';
    const newText = 'water boils at 100 degrees  ';
    const input: CitedPassageInput = {
      instrumentId: 'inst-9',
      previousText: oldText,
      previousContentHash: await hashText(oldText),
      current: { kind: 'found-at-anchor', text: newText },
    };
    const outcome = await evaluateCitedPassageRevision(
      input,
      stubJudge({ material: false, reason: 'formatting only' }),
      clock,
    );
    expect(outcome.kind).toBe('refreshed');
  });
});
