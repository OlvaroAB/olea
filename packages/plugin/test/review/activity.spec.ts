/**
 * ol-h3wy, run 11: the review tab's refresh-firing policy, tested by running it.
 *
 * Run 10 wired the Today refresh to `ReviewView.onClose` and to
 * `revealTodayView`. Both fire only when she deliberately closes review or
 * deliberately re-opens Today. `revealTodayView` opens Today in the RIGHT
 * SIDEBAR, so the default arrangement is Today visible beside an open review
 * tab — and ratings are logged per item. Work the queue to the end without
 * closing the tab and the panel next to it still shows the pre-session count.
 *
 * The tests below are the ones that failed before `ReviewActivityNotifier`
 * existed: reaching `complete` notified nobody, because closing was the only
 * trigger there was.
 */

import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { ReviewActivityNotifier } from '../../src/review/activity';

const VIEW_SOURCE = resolve(
  dirname(fileURLToPath(import.meta.url)),
  '..',
  '..',
  'src',
  'review',
  'view.ts',
);

function recorder(): { calls: number; notify: () => void } {
  const state = { calls: 0, notify: () => {} };
  state.notify = () => {
    state.calls += 1;
  };
  return state;
}

describe('the review tab announces that due counts moved (ol-h3wy)', () => {
  it('notifies when the queue runs out, without the tab being closed', () => {
    // THE REGRESSION. This is the whole point: the tab is still open, she is
    // looking at the completion screen, and Today is in the sidebar beside it.
    const spy = recorder();
    const notifier = new ReviewActivityNotifier(spy.notify);

    notifier.observePhase('front');
    notifier.observePhase('reveal');
    expect(spy.calls, 'mid-session phases must not trigger a recompute').toBe(0);

    notifier.observePhase('complete');
    expect(spy.calls).toBe(1);
  });

  it('notifies only once for completion, however often the screen re-renders', () => {
    // `ReviewView.render()` runs after every dispatch and the complete screen
    // persists, so an unguarded check would refresh on every keystroke there.
    const spy = recorder();
    const notifier = new ReviewActivityNotifier(spy.notify);
    for (let i = 0; i < 5; i += 1) notifier.observePhase('complete');
    expect(spy.calls).toBe(1);
  });

  it('notifies on close, which is what run 10 already had and this keeps', () => {
    const spy = recorder();
    const notifier = new ReviewActivityNotifier(spy.notify);
    notifier.observeClose();
    expect(spy.calls).toBe(1);
  });

  it('notifies on close after an early exit, when some items were rated', () => {
    // Ratings write per item, so a tab closed halfway has already changed the
    // counts. This is the path `onClose` was added for and it must survive.
    const spy = recorder();
    const notifier = new ReviewActivityNotifier(spy.notify);
    notifier.observePhase('front');
    notifier.observePhase('reveal');
    notifier.observeClose();
    expect(spy.calls).toBe(1);
  });

  it('notifies again when a completed session is then closed', () => {
    // Deliberately not suppressed: the second sweep is idempotent and cheap,
    // and suppressing it would rest on "nothing can have changed in between",
    // which is the assumption this bead was.
    const spy = recorder();
    const notifier = new ReviewActivityNotifier(spy.notify);
    notifier.observePhase('complete');
    notifier.observeClose();
    expect(spy.calls).toBe(2);
  });

  it('notifies once for close however many times onClose is invoked', () => {
    const spy = recorder();
    const notifier = new ReviewActivityNotifier(spy.notify);
    notifier.observeClose();
    notifier.observeClose();
    expect(spy.calls).toBe(1);
  });

  it('never notifies for any phase other than complete', () => {
    // Anti-vacuity on the trigger: if the phase check were inverted or dropped,
    // the tests above would still pass while the sidebar recomputed the whole
    // log on every card. Enumerate the real phases from `session.ts`.
    const spy = recorder();
    const notifier = new ReviewActivityNotifier(spy.notify);
    for (const phase of [
      'loading',
      'empty',
      'note-missing',
      'front',
      'reveal',
      'mcq-open',
      'mcq-answered',
    ]) {
      notifier.observePhase(phase);
    }
    expect(spy.calls).toBe(0);
    // …and the corpus above is not the empty set by accident.
    notifier.observePhase('complete');
    expect(spy.calls).toBe(1);
  });

  it('survives a view constructed without a callback', () => {
    // `onReviewActivity` is optional on `ReviewView`; the workbench and the
    // tests build one without it.
    const notifier = new ReviewActivityNotifier(undefined);
    expect(() => {
      notifier.observePhase('complete');
      notifier.observeClose();
    }).not.toThrow();
  });

  it('does not let a failing Today refresh break closing the review tab', () => {
    const notifier = new ReviewActivityNotifier(() => {
      throw new Error('Today panel blew up');
    });
    expect(() => notifier.observeClose()).not.toThrow();
    expect(() => notifier.observePhase('complete')).not.toThrow();
  });
});

/**
 * `ReviewView` imports `obsidian`, whose published `package.json` has `"main": ""`,
 * so it cannot be imported under Vitest at all and the policy above can only be
 * reached through source assertions — the same constraint and the same pattern as
 * `main-wiring.spec.ts`. Weaker than running it, and stated as such; the reason it
 * still earns its place is that the original ol-h3wy defect WAS a disconnected
 * call, and a disconnected call is exactly what a source assertion can see.
 */
describe('ReviewView is actually connected to the notifier (ol-h3wy)', () => {
  const source = readFileSync(VIEW_SOURCE, 'utf8');
  // Comments quote these names to explain them, which would satisfy every regex
  // below without a line of code behind it. Strip them first.
  const code = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

  it('reads as code once comments are stripped, so these assertions see real calls', () => {
    // Anti-vacuity: a stripper that ate the whole file would make everything
    // below fail loudly rather than pass — but one that ate nothing would make
    // them pass on prose alone, which is the direction that matters.
    expect(code).toContain('export class ReviewView');
    expect(code).not.toContain('ol-h3wy');
  });

  it('builds a ReviewActivityNotifier from its optional callback argument', () => {
    expect(code).toMatch(/new ReviewActivityNotifier\(\s*onReviewActivity\s*\)/);
  });

  it('tells the notifier the phase on every render, not only on close', () => {
    // The run-10 gap in one assertion: without this call, finishing the queue
    // with the tab open notifies nobody.
    expect(code).toMatch(/this\.activity\.observePhase\(/);
  });

  it('still tells the notifier when the tab closes', () => {
    expect(code).toMatch(/this\.activity\.observeClose\(\)/);
  });

  it('has no second, hand-rolled refresh path left in the view', () => {
    // The field this replaced. If it comes back, the firing policy has two
    // homes again and they will drift.
    expect(code).not.toContain('onSessionClose');
  });
});
