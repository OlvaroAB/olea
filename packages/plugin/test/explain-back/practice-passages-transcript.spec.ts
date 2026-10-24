/**
 * `[D-633]` (`ol-egov.141.89.6.146`): the transcript protections that have a meaning for a passage
 * on the practice view, reusing drafting's code (`../../src/source-origin.ts`): a claim that cannot
 * ground (inaudible, a visual the transcript does not carry, a disputed term) is not shown, the
 * self-contained statements of the same part are, and a student's or question's turn is not shown as
 * an explanation. No new words. Protections that need a model or another surface are not built;
 * `../../src/explain-back/transcript-protections.ts` lists each with the reason.
 *
 * Scenarios: `features/F5-explain-it-back.md` (olea-service), tagged
 * `plugin/explain-back/practice-passages-transcript.spec`. Synthetic data only.
 */

import { beforeAll, describe, expect, it, vi } from 'vitest';
import type { ExplainBackSourceBlock } from '../../src/explain-back/request.js';
import {
  protectTranscriptPassage,
  protectTranscriptPassages,
} from '../../src/explain-back/transcript-protections.js';
import { answerPassages, openPassages, shownPassages } from './practice-passages-open.js';

vi.mock('obsidian', async () => (await import('./practice-view-harness.js')).fakeObsidian());
vi.mock('../../src/sprig/render-sprig.js', async () => {
  const { FakeEl } = await import('./practice-view-harness.js');
  return { renderSprig: () => new FakeEl('svg') };
});
// Real behaviour, except that a part carrying this fixture marker is attributed to an audience turn:
// a transcript part carries no speaker label today, so the real function never says so itself.
vi.mock('../../src/source-origin.js', async (importActual) => {
  const actual = await importActual<typeof import('../../src/source-origin.js')>();
  return {
    ...actual,
    sourceChunkOriginOf: (path: string, text: string, host?: never) =>
      text.includes('AUDIENCE-TURN-FIXTURE')
        ? { kind: 'transcript' as const, speakerRole: 'other-speaker' as const }
        : actual.sourceChunkOriginOf(path, text, host),
  };
});

beforeAll(async () => {
  await import('../../src/explain-back/modal.js');
}, 120_000);

function part(path: string, text: string, index = 0): ExplainBackSourceBlock {
  return {
    block: { blockId: `${path}#${index}#0`, text },
    path,
    blockIndex: index,
    part: index + 1,
  };
}

const SAFE_1 = 'The coined process raises the coined rate.';
const SAFE_2 = 'Each cycle then repeats.';
const INAUDIBLE = 'The rate was [inaudible] per cycle.';
const VISUAL = 'As you can see, the third graph shows it.';

describe('a transcript passage is shown only as far as it may ground ([D-633], C3.6)', () => {
  it('cuts a claim that cannot ground and keeps the self-contained statements unchanged', () => {
    const shown = protectTranscriptPassage(
      part('Course/Lecture 2.txt', `${SAFE_1} ${INAUDIBLE} ${SAFE_2}`),
    );
    expect(shown?.block.text).toBe(`${SAFE_1} ${SAFE_2}`);
    expect(shown?.block.blockId).toBe('Course/Lecture 2.txt#0#0');
    expect(shown?.part).toBe(1);
  });

  it('cuts a claim that depends on a visual the transcript does not carry', () => {
    const shown = protectTranscriptPassage(part('Course/Lecture 2.txt', `${SAFE_1} ${VISUAL}`));
    expect(shown?.block.text).toBe(SAFE_1);
  });

  it('drops a part left with nothing to show', () => {
    expect(protectTranscriptPassage(part('Course/Lecture 2.txt', INAUDIBLE))).toBeNull();
  });

  it('leaves a part with no flagged claim, and a note that is not a transcript, as they are', () => {
    const clean = part('Course/Lecture 2.txt', `${SAFE_1} ${SAFE_2}`);
    expect(protectTranscriptPassage(clean)).toBe(clean);
    const note = part('Course/Plain note.md', `${SAFE_1} ${INAUDIBLE}`);
    expect(protectTranscriptPassage(note)).toBe(note);
  });

  it('does not act on what needs a model or another surface: a rejected claim and a clean part are shown as read', () => {
    const rejected = part(
      'Course/Lecture 2.txt',
      'Some say the rate falls. I reject that; it rises.',
    );
    expect(protectTranscriptPassage(rejected)).toBe(rejected);
  });

  it('a .md note is a transcript only when its frontmatter says so', () => {
    const host = { frontmatterFor: () => ({ role: 'transcript' }) as Record<string, unknown> };
    const md = part('Course/Lecture 2.md', `${SAFE_1} ${INAUDIBLE}`);
    expect(protectTranscriptPassage(md, host)?.block.text).toBe(SAFE_1);
    expect(protectTranscriptPassage(md)).toBe(md);
  });

  it('a turn attributed to a student or an audience question is not shown as an explanation', () => {
    const turn = part('Course/Lecture 2.txt', 'AUDIENCE-TURN-FIXTURE a question about the rate.');
    expect(protectTranscriptPassage(turn)).toBeNull();
    const kept = part('Course/Lecture 2.txt', SAFE_1, 1);
    expect(protectTranscriptPassages([turn, kept])).toEqual([kept]);
  });
});

describe('the view shows the protected passages and no new words', () => {
  it('shows the cut text, drops the emptied part, and adds nothing beside the passages', async () => {
    const view = await openPassages({
      retrieve: async () => [
        part('Course/Lecture 2.txt', `${SAFE_1} ${INAUDIBLE} ${SAFE_2}`, 0),
        part('Course/Lecture 2.txt', INAUDIBLE, 1),
        {
          block: { blockId: 'Course/Plain note.md#0#0', text: 'A plain note statement.' },
          path: 'Course/Plain note.md',
          blockIndex: 0,
        },
      ],
    });
    await answerPassages(view, 'My explanation.');
    const shown = shownPassages(view.root);
    expect(shown.map((p) => p.text)).toEqual([`${SAFE_1} ${SAFE_2}`, 'A plain note statement.']);
    expect(shown.map((p) => p.label)).toEqual(['Lecture 2 (part 1)', 'Plain note']);
    expect(view.root.texts().join(' ')).not.toMatch(/inaudible|lecturer|speaker|unclear|withheld/i);
  });
});
