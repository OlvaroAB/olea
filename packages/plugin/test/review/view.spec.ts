/**
 * F5.3a's reciprocal-prompt banner (`[D-178]`/`[D-204]`, `ol-0r92.25`):
 * `view.ts`'s `renderSchedulingObservationBanner` renders the banner from
 * `ReviewSession.getSchedulingObservationOffer()`'s pending offer, in the
 * F2.12 shape — one prompt paragraph, one accept action, no decline control
 * (F2.14a). `syncSchedulingObservationOffer` is where the write pair fires
 * (`session.recordSchedulingObservationOfferShown`/
 * `recordSchedulingObservationOfferDeclined`), mirroring
 * `syncConfusionRoutingOffer` exactly.
 *
 * Scenario: `features/F5-explain-it-back.md`'s "Feature: F5.3a offer record
 * / [D-178], [D-204]" block — "the F5.3a banner renders from the session's
 * pending scheduling-observation offer" — @auto:plugin/review/view.spec.
 *
 * **Why this is a source-text assertion, not a mounted-DOM test.** Same
 * constraint `explain-back-offer-write-wiring.spec.ts`/`view-focus-document.
 * spec.ts` document: `view.ts` imports `ItemView` from `obsidian`, whose
 * `package.json` `main` is `""`, so it cannot be loaded under Vitest at
 * all. The session-level "the pair is written with matching ids" behaviour
 * lives in `session.spec.ts` (`recordSchedulingObservationOfferShown`/
 * `recordSchedulingObservationOfferDeclined` are pure `ReviewSession`
 * methods and fully mountable); this file only pins that `view.ts` actually
 * renders the banner from the pending offer, in the F2.12 shape, and that
 * the sync method calls the session's own write pair from the right
 * branches.
 */

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const __dirname = dirname(fileURLToPath(import.meta.url));

/** Source with comments stripped — a doc paragraph describing the wiring must not satisfy an assertion about it. */
function codeOf(relativePath: string): string {
  return readFileSync(join(__dirname, '..', '..', relativePath), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\/.*$/gm, '');
}

const VIEW = codeOf('src/review/view.ts');

/** The body of `renderSchedulingObservationBanner`, isolated so assertions about it can't be satisfied by unrelated code elsewhere in the file. */
const RENDER_START = VIEW.indexOf('private renderSchedulingObservationBanner(');
const RENDER_END = VIEW.indexOf('private handleAcceptSchedulingObservationOffer(');
if (RENDER_START === -1 || RENDER_END === -1) {
  throw new Error('view.spec.ts: renderSchedulingObservationBanner markers moved in view.ts');
}
const RENDER_BODY = VIEW.slice(RENDER_START, RENDER_END);

/** The body of `syncSchedulingObservationOffer`, isolated the same way. */
const SYNC_START = VIEW.indexOf('private syncSchedulingObservationOffer(');
const SYNC_END = VIEW.indexOf('private renderSchedulingObservationBanner(');
if (SYNC_START === -1 || SYNC_END === -1) {
  throw new Error('view.spec.ts: syncSchedulingObservationOffer markers moved in view.ts');
}
const SYNC_BODY = VIEW.slice(SYNC_START, SYNC_END);

/** The body of `handleAcceptSchedulingObservationOffer`, isolated the same way. */
const ACCEPT_START = VIEW.indexOf('private handleAcceptSchedulingObservationOffer(');
const ACCEPT_END = VIEW.indexOf('private renderHeadingOfferBannerIfAny(');
if (ACCEPT_START === -1 || ACCEPT_END === -1) {
  throw new Error('view.spec.ts: handleAcceptSchedulingObservationOffer markers moved in view.ts');
}
const ACCEPT_BODY = VIEW.slice(ACCEPT_START, ACCEPT_END);

describe('ReviewView.renderSchedulingObservationBanner — the F5.3a banner, in the F2.12 shape', () => {
  it('renders nothing when no offer is pending', () => {
    const guard = RENDER_BODY.slice(0, RENDER_BODY.indexOf('createDiv'));
    expect(guard).toMatch(/if \(state === null\) return;/);
  });

  it('renders the offer’s own promptText — the reciprocal prompt in her terms, never a fabricated concept name', () => {
    expect(RENDER_BODY).toMatch(/text:\s*state\.promptText/);
  });

  it('has exactly ONE button — one available action, same as F2.12, no decline control (F2.14a)', () => {
    const buttonCalls = RENDER_BODY.match(/createEl\('button'/g) ?? [];
    expect(buttonCalls).toHaveLength(1);
  });

  it('the button carries the shared "Explain it back" copy.ts label, not a hand-typed literal', () => {
    expect(RENDER_BODY).toMatch(/SCHEDULING_OBSERVATION_OFFER_ACCEPT_LABEL/);
  });

  it('wires the button’s click to handleAcceptSchedulingObservationOffer', () => {
    expect(RENDER_BODY).toMatch(
      /registerDomEvent\(btn, 'click', \(\) => this\.handleAcceptSchedulingObservationOffer\(\)\)/,
    );
  });
});

describe('ReviewView.syncSchedulingObservationOffer — the D-178/D-204 write (ol-0r92.25)', () => {
  it('the offer-arrives branch calls session.recordSchedulingObservationOfferShown(offer) and stores the result as offerEventId', () => {
    const arrivesMatch =
      /this\.schedulingObservationBanner\s*=\s*\{[\s\S]*?\}/.exec(SYNC_BODY) ?? undefined;
    expect(
      arrivesMatch,
      'expected an assignment building the new schedulingObservationBanner state',
    ).not.toBeUndefined();
    const arrivesBlock = arrivesMatch?.[0] ?? '';

    expect(arrivesBlock).toMatch(
      /offerEventId:\s*session\.recordSchedulingObservationOfferShown\(offer\)/,
    );
  });

  it('the clears-unaccepted branch calls session.recordSchedulingObservationOfferDeclined BEFORE clearing the banner', () => {
    const declineCallIndex = SYNC_BODY.indexOf('session.recordSchedulingObservationOfferDeclined(');
    const clearIndex = SYNC_BODY.lastIndexOf('this.schedulingObservationBanner = null;');

    expect(
      declineCallIndex,
      'expected a call to session.recordSchedulingObservationOfferDeclined',
    ).toBeGreaterThan(-1);
    expect(clearIndex, 'expected the clears-unaccepted branch to null the banner').toBeGreaterThan(
      -1,
    );
    expect(declineCallIndex).toBeLessThan(clearIndex);
  });

  it('does not call recordSchedulingObservationOfferShown/Declined a second time from anywhere else in the method', () => {
    const shownCalls = SYNC_BODY.match(/recordSchedulingObservationOfferShown\(/g) ?? [];
    const declinedCalls = SYNC_BODY.match(/recordSchedulingObservationOfferDeclined\(/g) ?? [];
    expect(shownCalls).toHaveLength(1);
    expect(declinedCalls).toHaveLength(1);
  });
});

describe('ReviewView.handleAcceptSchedulingObservationOffer — accepting is never recorded as a decline, and never fakes a destination', () => {
  it('does not call session.recordSchedulingObservationOfferDeclined — accepting evidences itself via the explain-back review record instead', () => {
    expect(ACCEPT_BODY).not.toMatch(/recordSchedulingObservationOfferDeclined/);
  });

  it('clears this.schedulingObservationBanner directly, the same way handleAcceptConfusionOffer clears its own', () => {
    expect(ACCEPT_BODY).toMatch(/this\.schedulingObservationBanner\s*=\s*null;/);
  });

  it('looks for a destination among the session’s OWN queued instruments — never fabricates one', () => {
    expect(ACCEPT_BODY).toMatch(/session\.queueSnapshot/);
    expect(ACCEPT_BODY).toMatch(/conceptIds\.includes\(pending\.neighbourConceptId\)/);
  });

  it('only opens explain-back when a real destination was found', () => {
    expect(ACCEPT_BODY).toMatch(
      /if \(destination !== undefined\) this\.openExplainBack\?\.\(destination\);/,
    );
  });
});
