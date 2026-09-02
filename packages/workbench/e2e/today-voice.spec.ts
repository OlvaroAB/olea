/**
 * `@auto-web` — F6.1's "the panel never asks her for anything"
 * (`features/F6-today.md`, previously `@manual` only): "nothing on it is
 * phrased as an instruction, a goal, or a consequence of not acting."
 *
 * This is a lexical backstop, not a substitute for the manual read the
 * scenario asks for — `plugin/today/copy.ts`'s own `allTodayStrings()` test
 * already checks specific claims (no forward scheduling, no completeness
 * claim, no target framing) at the unit level, and neither that nor this
 * file can judge TONE the way a human reading end to end can. What this DOES
 * add: a real-browser sweep of every PROSE element actually rendered across
 * every wired Today state, for a short, deliberately narrow list of
 * imperative/obligation/threat phrasing — the shape an instruction or a
 * "consequence of not acting" reliably takes in English. `.olea-today-*`
 * button labels are excluded on purpose: naming the one available action
 * ("Start review") is not the same claim as instructing her to take it, and
 * F6.1's own "one kit decision this panel does take" already covers why that
 * one imperative verb is allowed to exist.
 */
import { expect, test } from '@playwright/test';
import { frame, gotoState, TODAY_STATES } from './helpers.js';

/** Prose elements only — never a button, a code, or a bare number/label. */
const PROSE_SELECTORS = [
  '.olea-today-note',
  '.olea-today-new',
  '.olea-today-insight-text',
  '.olea-today-insight-scope',
  '.olea-today-mastery-tending',
  '.olea-today-mastery-total',
  '.olea-today-term-dates-pointer-text',
].join(', ');

/**
 * Narrow on purpose: each phrase is a reliable marker of an instruction, a
 * goal, or a consequence of inaction, and none of it appears in any string
 * `copy.ts` currently defines (verified by reading the module). A phrase
 * broad enough to also flag legitimate factual copy would be worse than no
 * check at all — see this file's own module doc.
 */
const FORBIDDEN_PATTERN =
  /\b(must|should|need to|make sure|don't forget|do not forget|keep it up|keep going|remember to|before it'?s too late|or you('| wi)ll|please\b)/i;

for (const stateId of TODAY_STATES) {
  test(`${stateId}: no rendered prose reads as an instruction, a goal, or a consequence of not acting`, async ({
    page,
  }) => {
    await gotoState(page, 'today', stateId, 'obsidian-dark');
    const texts = await frame(page).locator(PROSE_SELECTORS).allTextContents();
    for (const text of texts) {
      expect(text, `${stateId}: "${text}" reads as an instruction/goal/threat`).not.toMatch(
        FORBIDDEN_PATTERN,
      );
    }
  });
}
