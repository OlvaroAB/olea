/**
 * `@auto-web` — C3's ingestion arrival signal and F1.5/F8.1's registration
 * state, both driven in a real browser against the REAL `GroveView`
 * (`packages/plugin/src/grove/view.ts`) and the REAL `TodayView`
 * (`packages/plugin/src/today/view.ts`), fed hand-built `GroveCourseModel`/
 * `RhythmCourseInput` fixtures rather than a real vault walk
 * (`grove-scenarios.ts`'s and `today-scenarios.ts`'s own module docs).
 *
 * Reachability: proves the SCREENS — the grove's three-way registration
 * status, F8.3's count-and-denominator summary, and the Today panel's
 * cross-course scope and rhythm sections — against the real components,
 * never `packages/plugin/src/main.ts`'s own production
 * `createLocalGroveProvider`/`createRhythmSource` vault-walk wiring, same
 * posture `registry.spec.ts`'s own doc states for its surface.
 *
 * Scenarios asserted (`olea-service`'s `features/C3-ingestion.md` and
 * `features/F1-sources.md`, both tagged `@auto-web:ingestion.spec.ts`):
 *   - grove: the F8.1 "no source registered" designed empty state
 *   - grove: the F8.3 count-and-denominator summary, a named material gap
 *     and a volunteer concept, all on one declared course
 *   - today: the cross-course scope section states the same no-source fact
 *     at its own compact grain
 *   - today: a genuinely quiet course states its own honest arrival gap
 *   - today: material arriving inside the quiet window renders no rhythm
 *     line at all
 */
import { expect, type Page, test } from '@playwright/test';
import { frame, gotoState } from './helpers.js';

function groveRoot(page: Page) {
  return frame(page).locator('.olea-grove-root');
}

function todayBody(page: Page) {
  return frame(page).locator('.olea-today-body');
}

test('grove-no-source: no registered objectives document or past paper renders the designed empty state', async ({
  page,
}) => {
  await gotoState(page, 'grove', 'grove-no-source', 'obsidian-dark');
  const course = groveRoot(page).locator('.olea-grove-course').first();
  await expect(course.locator('.olea-grove-course-heading')).toHaveText('No grove yet');
  await expect(course.locator('.olea-grove-no-source-body')).toHaveText(
    'No objectives document or past paper has been registered for this course yet. Register one (F1.5) to see its grove.',
  );
});

test('grove-declared: the summary states count and denominator source, never a ratio, with a named material gap and a volunteer', async ({
  page,
}) => {
  await gotoState(page, 'grove', 'grove-declared', 'obsidian-dark');
  const course = groveRoot(page).locator('.olea-grove-course').first();

  await expect(course.locator('.olea-grove-summary-line')).toHaveText(
    '1 of 2 built, from 1 registered source.',
  );
  await expect(course.locator('.olea-grove-material-gap-label')).toHaveText('No material yet');
  const volunteers = course.locator('.olea-grove-volunteers');
  await expect(volunteers.locator('.olea-grove-volunteer-heading')).toHaveText('Also growing here');
  await expect(volunteers.locator('.olea-grove-concept')).toHaveText('syn:concept:florzik');
});

test('today-scope-not-declared: the cross-course scope section states the same no-source fact grove/copy.ts states, at its own grain', async ({
  page,
}) => {
  await gotoState(page, 'today', 'today-scope-not-declared', 'obsidian-dark');
  const scope = todayBody(page).locator('.olea-today-mastery', {
    hasText: 'What each course declares',
  });
  await expect(scope.locator('.olea-today-mastery-label')).toHaveText('What each course declares');
  const row = scope.locator('.olea-today-mastery-course').first();
  await expect(row.locator('.olea-today-mastery-code')).toHaveText('syn:course:vantrel');
  await expect(row.locator('.olea-today-mastery-total')).toHaveText(
    'No objectives document or past paper registered yet.',
  );
});

test('today-rhythm-quiet: a genuinely quiet course states its own honest arrival gap', async ({
  page,
}) => {
  await gotoState(page, 'today', 'today-rhythm-quiet', 'obsidian-dark');
  const rhythm = todayBody(page).locator('.olea-today-insights');
  await expect(rhythm.locator('.olea-today-insights-label')).toHaveText('What has arrived');
  await expect(rhythm.locator('.olea-today-mastery-code')).toHaveText('syn:course:vantrel');
  await expect(rhythm.locator('.olea-today-insight-text')).toHaveText(
    'nothing from this course has arrived in 31 days.',
  );
});

test('today-rhythm-fresh: material arriving inside the quiet window renders no rhythm line at all', async ({
  page,
}) => {
  await gotoState(page, 'today', 'today-rhythm-fresh', 'obsidian-dark');
  await expect(todayBody(page).locator('.olea-today-insights-label')).toHaveCount(0);
});
