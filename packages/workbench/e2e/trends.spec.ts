/**
 * `@auto-web` — F6.2's mastery overview and F6.5's observed-pattern insights
 * (`ol-lohq`, `ol-p6t04`), driven in a real browser against the real
 * `TodayView` — the same product class `today-panel.spec.ts` already drives
 * for F6.1, mounted here over a synthetic persona stream instead of the real
 * fixture vault (`trends-scenarios.ts`'s module doc; N-015 applies — nothing
 * here is evidence about the alpha user, and no threshold is tuned from it).
 *
 * WB-2 (`ol-z6x2`), first-tranche coverage: `visual-regression.spec.ts`
 * already screenshots all six states; this is the surface's first
 * assertion-level coverage. Rather than assert a guessed detector outcome
 * per persona (this is one fixed seed, not the 40-seed statistical claim
 * `test/trends-scenarios.spec.ts` makes — see that file for the real
 * separating-margin evidence), each test reads the SAME ground truth the
 * pane rendered from — the top-document inspector's independently-reported
 * detector status — and asserts the rendered DOM agrees with it. That is
 * exactly `today-panel.spec.ts`'s ol-h3wy pattern (on-screen vs. a fresh
 * read) applied to this surface's own render/data seam.
 *
 * Nothing here retags a `features/` scenario — see the run's handback note.
 */
import { expect, type Page, test } from '@playwright/test';
import { frame, gotoState, TRENDS_STATES } from './helpers.js';

/** One inspector row's value text, from the top-document inspector. */
async function inspectorRowValue(page: Page, label: string): Promise<string> {
  const row = page.locator('[data-wb-inspector] .wb-inspector-row', {
    has: page.locator('.wb-inspector-label', { hasText: label }),
  });
  return ((await row.locator('.wb-inspector-value').textContent()) ?? '').trim();
}

type DetectorStatus = 'observed' | 'not-observed' | 'not-enough-history';

function detectorStatusOf(rowValue: string): DetectorStatus {
  if (rowValue.startsWith('observed')) return 'observed';
  if (rowValue.startsWith('not-enough-history')) return 'not-enough-history';
  if (rowValue.startsWith('not-observed')) return 'not-observed';
  throw new Error(`trends.spec: unrecognised detector status row ${JSON.stringify(rowValue)}`);
}

/**
 * Mirrors `TodayView.renderInsightsBody`'s own predicate exactly (`view.ts`):
 * the section renders iff at least one detector observed something, or both
 * declined for want of history. A "not-observed, not-observed" pair (a
 * pattern that was looked for and genuinely isn't there) renders nothing —
 * silence is a result, not an omission (F6.5's own module doc).
 */
function expectedInsightsSection(
  spacing: DetectorStatus,
  effort: DetectorStatus,
): 'observed-lines' | 'too-early-note' | 'absent' {
  const allDeclined = spacing === 'not-enough-history' && effort === 'not-enough-history';
  const anyObserved = spacing === 'observed' || effort === 'observed';
  if (!anyObserved && !allDeclined) return 'absent';
  if (!anyObserved && allDeclined) return 'too-early-note';
  return 'observed-lines';
}

for (const state of TRENDS_STATES) {
  test(`${state}: the rendered insights section agrees with the inspector's independently-read detector status`, async ({
    page,
  }) => {
    await gotoState(page, 'trends', state, 'obsidian-dark');

    const spacingRow = await inspectorRowValue(page, 'spacing insight (F6.5a)');
    const effortRow = await inspectorRowValue(page, 'effort insight (F6.5b)');
    const spacing = detectorStatusOf(spacingRow);
    const effort = detectorStatusOf(effortRow);
    const expected = expectedInsightsSection(spacing, effort);

    const section = frame(page).locator('.olea-today-insights');
    if (expected === 'absent') {
      await expect(section).toHaveCount(0);
      return;
    }
    await expect(section).toBeVisible();
    if (expected === 'too-early-note') {
      await expect(section.locator('.olea-today-note')).toBeVisible();
      await expect(section.locator('.olea-today-insight')).toHaveCount(0);
    } else {
      await expect(section.locator('.olea-today-insight')).not.toHaveCount(0);
      // The scope sentence only accompanies real findings, never the
      // too-early note (`renderInsightsBody`'s early return skips it).
      await expect(section.locator('.olea-today-insight-scope')).toBeVisible();
    }
  });
}

test('trends-course-behind vs. trends-course-behind-neutralised: the SAME seed, one bit flipped, and the rendered insight disappears with it', async ({
  page,
}) => {
  await gotoState(page, 'trends', 'trends-course-behind', 'obsidian-dark');
  const effortBefore = detectorStatusOf(await inspectorRowValue(page, 'effort insight (F6.5b)'));
  expect(effortBefore).toBe('observed');
  await expect(frame(page).locator('.olea-today-insight')).not.toHaveCount(0);

  await gotoState(page, 'trends', 'trends-course-behind-neutralised', 'obsidian-dark');
  const effortAfter = detectorStatusOf(await inspectorRowValue(page, 'effort insight (F6.5b)'));
  expect(effortAfter).not.toBe('observed');
});

test("every trends state: the mastery overview's course count on screen matches the inspector's independently-read count", async ({
  page,
}) => {
  for (const state of TRENDS_STATES) {
    await gotoState(page, 'trends', state, 'obsidian-dark');
    const masteryRow = await inspectorRowValue(page, 'mastery');
    const courseCourseCountMatch = /^(\d+) course/.exec(masteryRow);
    const onScreenCount = await frame(page).locator('.olea-today-mastery-course').count();
    if (courseCourseCountMatch === null) {
      // "can't count (null)" — no mastery section renders at all.
      expect(masteryRow).toBe("can't count (null)");
      expect(onScreenCount).toBe(0);
    } else {
      expect(onScreenCount).toBe(Number(courseCourseCountMatch[1]));
    }
  }
});

test('FLOW: "Start review" is real and honestly inert on this surface — clicking it says why, rather than doing nothing', async ({
  page,
}) => {
  await gotoState(page, 'trends', 'trends-healthy', 'obsidian-dark');
  const primaryAction = frame(page).locator('.olea-today-primary-action');
  await expect(primaryAction).toBeVisible();
  await primaryAction.click();
  const notice = page.locator('[data-wb-notice]');
  await expect(notice).toBeVisible();
  await expect(notice).toContainText('trends half of the Today pane');
});
