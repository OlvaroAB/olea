/**
 * ol-h3wy, run 11: **when the review tab should tell the rest of the plugin that
 * her due counts have moved.**
 *
 * WHAT RUN 10 FIXED AND WHAT IT MISSED. `TodayView.refresh` existed with a doc
 * comment claiming `main.ts` called it after every session, and nothing ever did.
 * Run 10 wired `refreshOpenTodayViews` at two points: `ReviewView.onClose`, and
 * `revealTodayView`. Both are real, and both are EDGE-TRIGGERED ON A DELIBERATE
 * ACT — she must close the review tab, or explicitly re-open Today.
 *
 * The case that leaves is not an edge case, it is the default layout.
 * `revealTodayView` puts Today in the RIGHT SIDEBAR (`workspace.getRightLeaf`),
 * so the ordinary arrangement is Today visible in the sidebar while she reviews
 * in the main tab. Ratings are written to the log per item, not at session end
 * (`session.ts` `logAndAdvance`). She works through the whole queue, the review
 * tab stays open because there is no reason to close it, and the panel beside it
 * keeps showing the count it computed before she started. That is the bead's own
 * sentence — "she finishes reviewing, looks at Today, and sees the same number
 * she started with" — still true after the fix that was supposed to end it, just
 * by a different route.
 *
 * THE FIRING POLICY, AND WHY IT IS A MODULE RATHER THAN TWO LINES IN THE VIEW.
 * `ReviewView` imports `obsidian`, so nothing in it can be executed under Vitest
 * and any test of it is a regex over its source. That is how the original defect
 * survived: the claim lived in a comment, and a comment cannot be run. So the
 * decision lives here instead, obsidian-free and directly executable — the same
 * move `today/refresh.ts` made for the sweep itself.
 *
 * WHAT IS DELIBERATELY NOT HERE: a notification per rating. That would make the
 * sidebar a live counter ticking down as she answers, and `loadTodayPanel`
 * re-walks the vault and replays the whole log on every call, so it is both a
 * per-card cost and a visible change to what review feels like. Whether the
 * count should move under her mid-card is a product question with an owner, and
 * it is not this bug. Completion and close are the two moments she actually
 * looks, and they are cheap.
 */

/** The one phase that means the queue is done and the counts have settled. */
const COMPLETE = 'complete';

/**
 * Decides when the review tab should announce that due counts may have changed.
 *
 * Two firing points, both of which really happen:
 *   - the session reaching `complete`, which is the queue running out with the
 *     tab still open — the case run 10's `onClose` wiring could not see;
 *   - the tab closing, whatever it did first, which covers closing early after
 *     some ratings and is what run 10 already had.
 *
 * Completion fires **once**. Closing after a completion fires again, and that
 * second refresh is deliberate rather than sloppy: it is idempotent, it costs
 * one recompute, and suppressing it would mean reasoning about whether anything
 * could have changed in between — which is exactly the kind of "surely nothing
 * happened" assumption this bead was.
 */
export class ReviewActivityNotifier {
  private announcedCompletion = false;
  private announcedClose = false;

  constructor(private readonly notify: (() => void) | undefined) {}

  /**
   * Call after every render with the session's current phase. Fires the first
   * time that phase is `complete` and never again for completion.
   */
  observePhase(phase: string): void {
    if (phase !== COMPLETE) return;
    if (this.announcedCompletion) return;
    this.announcedCompletion = true;
    this.fire();
  }

  /** Call from `onClose`. Fires once per view, whatever the session did. */
  observeClose(): void {
    if (this.announcedClose) return;
    this.announcedClose = true;
    this.fire();
  }

  private fire(): void {
    // Best effort, exactly like the sweep it triggers: a Today panel that fails
    // to redraw must not take the review tab down with it, least of all while
    // she is closing it.
    try {
      this.notify?.();
    } catch {
      // Swallowed on purpose — see above.
    }
  }
}
