/**
 * Guards the hardcoded id lists in `helpers.ts` against drifting from what
 * the app actually offers. See that file's header for why the lists are
 * hardcoded at all (Playwright must know the test list before any browser
 * exists to ask the app). This is the check that makes that an acceptable
 * trade rather than a silent trap: if a state or variable set is ever added,
 * renamed or removed in `packages/workbench/src`, this goes red and names
 * exactly what changed, instead of every other spec in this suite quietly
 * testing a list that no longer matches the product.
 */
import { expect, test } from '@playwright/test';
import {
  discoverMatrix,
  EXPLAIN_STATES,
  GENERATE_STATES,
  ORACLE_STATES,
  RETRIEVE_STATES,
  REVIEW_STATES,
  SESSION_STATES,
  TIMELINE_STATES,
  TODAY_STATES,
  TRENDS_STATES,
  VARIABLE_SETS,
} from './helpers.js';

test('the hardcoded review/today/oracle/retrieve/generate/timeline/explain/session/trends/variable-set lists match the live app', async ({
  page,
}) => {
  await page.goto('/');
  await expect(page.locator('html')).toHaveAttribute('data-wb-ready', 'true', {
    timeout: 10_000,
  });
  const live = await discoverMatrix(page);

  expect(new Set(live.reviewStates), 'review states — see scenarios.ts REVIEW_STATES').toEqual(
    new Set(REVIEW_STATES),
  );
  expect(new Set(live.todayStates), 'today states — see today-scenarios.ts TODAY_STATES').toEqual(
    new Set(TODAY_STATES),
  );
  expect(
    new Set(live.oracleStates),
    'oracle states — see oracle-scenarios.ts ORACLE_STATES',
  ).toEqual(new Set(ORACLE_STATES));
  expect(
    new Set(live.retrieveStates),
    'retrieve states — see retrieve-scenarios.ts RETRIEVE_STATES',
  ).toEqual(new Set(RETRIEVE_STATES));
  expect(
    new Set(live.generateStates),
    'generate states — see generate-scenarios.ts GENERATE_STATES',
  ).toEqual(new Set(GENERATE_STATES));
  expect(
    new Set(live.timelineStates),
    'timeline states — see timeline-scenarios.ts TIMELINE_STATES',
  ).toEqual(new Set(TIMELINE_STATES));
  expect(
    new Set(live.explainStates),
    'explain states — see explain-scenarios.ts EXPLAIN_STATES',
  ).toEqual(new Set(EXPLAIN_STATES));
  expect(
    new Set(live.sessionStates),
    'session states — see session-scenarios.ts SESSION_STATES',
  ).toEqual(new Set(SESSION_STATES));
  expect(
    new Set(live.trendsStates),
    'trends states — see trends-scenarios.ts TRENDS_STATES',
  ).toEqual(new Set(TRENDS_STATES));
  expect(new Set(live.variableSets), 'variable sets — see themes/index.ts VARIABLE_SETS').toEqual(
    new Set(VARIABLE_SETS),
  );
});
