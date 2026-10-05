/**
 * F2.22 / F6.4 (`ol-egov.141.89.10.19`): `home/view.ts`'s own half of "the
 * composition sentence, the same in both places" — the review session's
 * half is pinned in `../review/composition-sentence.spec.ts`, and the
 * shared wording itself in `./copy.spec.ts`'s `sessionCompositionSentence`
 * block.
 *
 * **Why this is a source-text assertion, not a mounted-DOM test.** Same
 * constraint `../review/view.spec.ts` documents at length: `view.ts`
 * imports `ItemView` from `obsidian`, whose `package.json` `main` is `""`,
 * so it cannot be loaded under Vitest at all — no `test/home/view.spec.ts`
 * existed before this bead for exactly this reason.
 */

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const __dirname = dirname(fileURLToPath(import.meta.url));

/** Source with comments stripped — a doc paragraph must not satisfy an assertion about real code. */
function codeOf(relativePath: string): string {
  return readFileSync(join(__dirname, '..', '..', relativePath), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\/.*$/gm, '');
}

const VIEW = codeOf('src/home/view.ts');

const RENDER_OFFER_START = VIEW.indexOf('private renderOffer(');
if (RENDER_OFFER_START === -1) {
  throw new Error('view.spec.ts: renderOffer marker moved in home/view.ts');
}
const RENDER_OFFER_BODY = VIEW.slice(RENDER_OFFER_START, RENDER_OFFER_START + 3600);

/** `[D-382]`/`[D-331]` (`ol-egov.141.89.10.64`, F2.22) — `renderActiveSession`'s own source, for the honest-absence and no-recompute assertions below. */
const ACTIVE_SESSION_START = VIEW.indexOf('private renderActiveSession(');
if (ACTIVE_SESSION_START === -1) {
  throw new Error('view.spec.ts: renderActiveSession marker moved in home/view.ts');
}
const ACTIVE_SESSION_BODY = VIEW.slice(
  ACTIVE_SESSION_START,
  VIEW.indexOf('): void {', ACTIVE_SESSION_START) + 900,
);

describe('HomeView — imports sessionCompositionSentence (F2.22, F6.4)', () => {
  it('imports it from ./copy.js — the same function review/view.ts imports from ../home/copy.js', () => {
    expect(VIEW).toMatch(/sessionCompositionSentence,?\s*\n?\} from '\.\/copy\.js';/);
  });
});

describe('HomeView.render — threads HomeViewState.focusReason and activeSession into renderOffer (D-382, D-331)', () => {
  it('passes state.focusReason and whether a session is active as renderOffer’s third and fourth arguments', () => {
    expect(VIEW).toMatch(
      /this\.renderOffer\(root, state\.session, state\.focusReason, state\.activeSession !== undefined\);/,
    );
  });

  it('calls renderActiveSession with state.activeSession, before renderOffer', () => {
    const activeCallIndex = VIEW.indexOf('this.renderActiveSession(root, state.activeSession)');
    const offerCallIndex = VIEW.indexOf('this.renderOffer(root, state.session,');
    expect(activeCallIndex).toBeGreaterThan(-1);
    expect(offerCallIndex).toBeGreaterThan(-1);
    expect(activeCallIndex).toBeLessThan(offerCallIndex);
  });
});

describe('HomeView.renderOffer — the composition sentence, said once (F2.22)', () => {
  it('accepts focusReason and sessionIsActive as explicit parameters', () => {
    const signature = VIEW.slice(RENDER_OFFER_START, VIEW.indexOf('): void {', RENDER_OFFER_START));
    expect(signature).toMatch(/focusReason: string \| undefined/);
    expect(signature).toMatch(/sessionIsActive: boolean/);
  });

  it('renders through sessionCompositionSentence exactly once — never a hand-typed paraphrase', () => {
    const calls = RENDER_OFFER_BODY.match(/sessionCompositionSentence\(/g) ?? [];
    expect(calls).toHaveLength(1);
  });

  it("is gated on session.kind === 'model' and focusReason !== undefined — honest absence otherwise", () => {
    const guard = RENDER_OFFER_BODY.slice(
      0,
      RENDER_OFFER_BODY.indexOf('sessionCompositionSentence('),
    );
    expect(guard).toMatch(/if \(session\.kind === 'model' && focusReason !== undefined\) \{/);
  });

  it('renders only once per call — the sentence sits beside the headline, not repeated per left-out or by-source line', () => {
    // `allLines`/`leftOutLines`/`newMaterialLines` render in their own loop
    // further down this method; the composition sentence's own `createDiv`
    // call is a single, separate statement, not inside that loop.
    const ownCallIndex = RENDER_OFFER_BODY.indexOf('sessionCompositionSentence(');
    const loopIndex = RENDER_OFFER_BODY.indexOf('for (const line of allLines)');
    expect(loopIndex).toBeGreaterThan(-1);
    expect(ownCallIndex).toBeLessThan(loopIndex);
  });
});

describe('HomeViewState — dashboard variant carries an optional focusReason (F2.22, F6.4)', () => {
  it('declares the field', () => {
    expect(VIEW).toMatch(/readonly focusReason\?: string;/);
  });
});

/**
 * `[D-382]`/`[D-331]` (`ol-egov.141.89.10.64`, F2.22) — while a session is active, Home shows its
 * frozen explanation, read from the persisted composition snapshot, never a live recompute.
 */
describe('HomeViewState — dashboard variant carries an optional activeSession (D-382, D-331)', () => {
  it('declares HomeActiveSession with an optional reason field', () => {
    expect(VIEW).toMatch(
      /export interface HomeActiveSession \{[\s\S]{0,300}readonly reason\?: string;/,
    );
  });

  it('declares the activeSession field on the dashboard variant', () => {
    expect(VIEW).toMatch(/readonly activeSession\?: HomeActiveSession;/);
  });
});

describe('HomeView.renderOffer — the eyebrow is relabelled while a session is active (D-382, D-331)', () => {
  it('reads HOME_NEXT_SESSION_EYEBROW when sessionIsActive, HOME_OFFER_EYEBROW otherwise — never a hand-typed third label', () => {
    expect(RENDER_OFFER_BODY).toMatch(
      /text: sessionIsActive \? HOME_NEXT_SESSION_EYEBROW : HOME_OFFER_EYEBROW,/,
    );
  });

  it('imports HOME_NEXT_SESSION_EYEBROW from ./copy.js', () => {
    expect(VIEW).toMatch(/HOME_NEXT_SESSION_EYEBROW/);
    expect(VIEW).toMatch(/\} from '\.\/copy\.js';/);
  });
});

describe('HomeView.renderActiveSession — the frozen explanation, never a live recompute (D-382, D-331)', () => {
  it('renders nothing when no session is active, or when the frozen record carries no reason — honest absence', () => {
    expect(ACTIVE_SESSION_BODY).toMatch(
      /if \(activeSession === undefined \|\| activeSession\.reason === undefined\) return;/,
    );
  });

  it('renders the frozen reason through sessionCompositionSentence — the same function the live preview uses, never a second wording rule', () => {
    const calls = ACTIVE_SESSION_BODY.match(/sessionCompositionSentence\(/g) ?? [];
    expect(calls).toHaveLength(1);
    expect(ACTIVE_SESSION_BODY).toMatch(/sessionCompositionSentence\(activeSession\.reason\)/);
  });

  it('[D-421] renders the grouping sentence as written, after the course sentence and only when present', () => {
    const courseAt = ACTIVE_SESSION_BODY.indexOf(
      'sessionCompositionSentence(activeSession.reason)',
    );
    const guardAt = ACTIVE_SESSION_BODY.indexOf(
      'if (activeSession.groupingSentence !== undefined) {',
    );
    const textAt = ACTIVE_SESSION_BODY.indexOf('text: activeSession.groupingSentence,');
    expect(courseAt).toBeGreaterThan(-1);
    expect(guardAt).toBeGreaterThan(courseAt);
    expect(textAt).toBeGreaterThan(guardAt);
  });

  it('labels the active-session block HOME_OFFER_EYEBROW — the label the ordinary card carries when nothing is active', () => {
    expect(ACTIVE_SESSION_BODY).toMatch(/text: HOME_OFFER_EYEBROW,/);
  });

  it('never imports or references session/holder.ts, or any sitting-mutating call (enter, growActiveSitting, exit, decide) — reading the snapshot cannot unfreeze or recompose the active session', () => {
    expect(VIEW).not.toMatch(/session\/holder\.js/);
    for (const mutator of ['.enter(', '.growActiveSitting(', '.exit(', '.decide(']) {
      expect(VIEW.includes(mutator)).toBe(false);
    }
  });
});

describe('HomeView Start — hands the steering she chose on Home to the start path (F4.6, D-243, ol-egov.141.89.10.111)', () => {
  it('startSession is typed to take the SessionBuilderRequest', () => {
    expect(VIEW).toMatch(
      /readonly startSession:\s*\(request\?: SessionBuilderRequest\)\s*=>\s*void \| Promise<void>;/,
    );
  });

  it('the Start click passes the same request refresh() sends load(), built by one helper', () => {
    expect(VIEW).toMatch(/private currentRequest\(\): SessionBuilderRequest/);
    expect(VIEW).toMatch(/this\.deps\.startSession\(this\.currentRequest\(\)\)/);
    expect(VIEW).toMatch(/this\.deps\.load\(this\.currentRequest\(\)\)/);
  });

  it('currentRequest carries budget, stated interest and course-or-topic together', () => {
    const start = VIEW.indexOf('private currentRequest(): SessionBuilderRequest');
    expect(start).toBeGreaterThan(-1);
    const body = VIEW.slice(start, start + 600);
    expect(body).toMatch(/budgetMinutes: this\.budgetMinutes/);
    expect(body).toMatch(/focusConceptName: this\.focusConceptName/);
    expect(body).toMatch(/courseOrTopic: this\.courseOrTopic/);
  });
});
