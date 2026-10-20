/**
 * Scenario: "a pending card draft asks for her answer before showing its own" —
 * @auto:plugin/review/first-serve-reveal-gate.card-draft.ol-egov.141.89.105.6.spec
 * (F3.3, `[D-097]`, `[D-189]`, `[D-555]`). Synthetic fixtures only.
 *
 * The session and keymap halves run for real over an adapted card draft; the label half is a
 * source-text assertion because `view.ts` imports `obsidian` and cannot load under Vitest (same
 * constraint `first-serve-reveal-gate.spec.ts` documents).
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createFsrsScheduler } from 'olea-core';
import { describe, expect, it } from 'vitest';
import { toDraftReviewQueueItem } from '../../src/generation/review-adapter.js';
import type { DraftRecord } from '../../src/generation/types.js';
import { hintsFor, resolveReviewKey } from '../../src/review/keymap.js';
import { ReviewSession } from '../../src/review/session.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

const DRAFT: DraftRecord = {
  draftId: 'card-draft-1',
  status: 'pending',
  courseCode: 'TEST101',
  conceptName: 'Working memory',
  conceptIds: ['concept-key-1'],
  sourcePath: 'Courses/TEST101/Week 2.md',
  createdAt: '2026-08-25T09:00:00-07:00',
  instrumentType: 'qa',
  card: { front: 'What limits working memory?', back: 'Chunking.' },
  provenance: { taskId: 'cards.generate.v1', promptVersion: '1.0.0', modelId: 'test-model' },
  firstServedAt: null,
};

function session(accepted: string[]): ReviewSession {
  return new ReviewSession({
    queue: [toDraftReviewQueueItem(DRAFT)],
    scheduler: createFsrsScheduler(),
    reviewLog: { async recordReview() {} } as never,
    suspendPort: { async suspend() {} } as never,
    editPort: { async edit() {} } as never,
    noteExists: {
      async exists() {
        return true;
      },
    } as never,
    clock: { now: () => new Date('2026-08-25T10:00:00-07:00') },
    draftAcceptPort: {
      async accept(id: string) {
        accepted.push(id);
        return {} as never;
      },
      async reject() {
        return {} as never;
      },
    } as never,
  } as never);
}

describe('a pending card draft at its first presentation', () => {
  it('shows the front only, then the reveal; rating it accepts the draft', async () => {
    const accepted: string[] = [];
    const s = session(accepted);
    await s.start();
    const front = s.getViewModel();
    expect(front.phase).toBe('front');
    if (front.phase !== 'front') return;
    expect(front.instrument.draftId).toBe('card-draft-1');
    expect(accepted).toEqual([]);
    s.reveal();
    expect(s.getViewModel().phase).toBe('reveal');
    await s.rate('good');
    expect(accepted).toEqual(['card-draft-1']);
  });

  it('offers no edit/reject before the reveal, by keyboard, and offers them at the reveal', () => {
    const front = { kind: 'card-front', isNewDraft: true } as const;
    const reveal = { kind: 'card-reveal', isNewDraft: true } as const;
    expect(resolveReviewKey({ key: 'e' }, front)).toBeNull();
    expect(resolveReviewKey({ key: 's' }, front)).toBeNull();
    expect(JSON.stringify(hintsFor(front))).not.toMatch(/Edit|Reject/i);
    expect(resolveReviewKey({ key: 'e' }, reveal)).not.toBeNull();
    expect(resolveReviewKey({ key: 's' }, reveal)).not.toBeNull();
    expect(JSON.stringify(hintsFor(reveal))).toMatch(/Reject/i);
  });
});

describe('the reveal label ([D-555])', () => {
  const VIEW = readFileSync(join(__dirname, '..', '..', 'src/review/view.ts'), 'utf8');
  const start = VIEW.indexOf('private renderReveal(');
  const reveal = VIEW.slice(start, VIEW.indexOf('private ', start + 20));

  it('draws "From your own note" only when the item is neither a pending draft nor Olea-generated', () => {
    const labelAt = reveal.indexOf("'From your own note'");
    expect(labelAt).toBeGreaterThan(-1);
    const before = reveal.slice(Math.max(0, labelAt - 160), labelAt);
    expect(before).toMatch(/instrument\.draftId === null/);
    expect(before).toMatch(/instrument\.oleaGenerated !== true/);
  });
});
