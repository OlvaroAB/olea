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
const ACCEPT_END = VIEW.indexOf('private syncStrongRecallOffer(');
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

// ---------------------------------------------------------------------------
// F2.21's strong-recall banner (`ol-v7r5.40`). Same source-text constraint the
// file header states: `view.ts` cannot be loaded under Vitest at all, so this
// pins the wiring, and `session.spec.ts` covers the behaviour.
//
// Scenario: `features/F2-review.md` (olea-service), "Feature: F2.21 wiring" —
// "no new surface — the offer reuses F2.12's banner shape, one action, no
// decline control" — @auto:plugin/review/view.spec.
// ---------------------------------------------------------------------------

/** The body of `renderStrongRecallBanner`, isolated the same way. */
const SR_RENDER_START = VIEW.indexOf('private renderStrongRecallBanner(');
const SR_RENDER_END = VIEW.indexOf('private handleAcceptStrongRecallOffer(');
if (SR_RENDER_START === -1 || SR_RENDER_END === -1) {
  throw new Error('view.spec.ts: renderStrongRecallBanner markers moved in view.ts');
}
const SR_RENDER_BODY = VIEW.slice(SR_RENDER_START, SR_RENDER_END);

/** The body of `syncStrongRecallOffer`, isolated the same way. */
const SR_SYNC_START = VIEW.indexOf('private syncStrongRecallOffer(');
const SR_SYNC_END = VIEW.indexOf('private renderStrongRecallBanner(');
if (SR_SYNC_START === -1 || SR_SYNC_END === -1) {
  throw new Error('view.spec.ts: syncStrongRecallOffer markers moved in view.ts');
}
const SR_SYNC_BODY = VIEW.slice(SR_SYNC_START, SR_SYNC_END);

/** The body of `handleAcceptStrongRecallOffer`, isolated the same way. */
const SR_ACCEPT_START = VIEW.indexOf('private handleAcceptStrongRecallOffer(');
const SR_ACCEPT_END = VIEW.indexOf('private renderHeadingOfferBannerIfAny(');
if (SR_ACCEPT_START === -1 || SR_ACCEPT_END === -1) {
  throw new Error('view.spec.ts: handleAcceptStrongRecallOffer markers moved in view.ts');
}
const SR_ACCEPT_BODY = VIEW.slice(SR_ACCEPT_START, SR_ACCEPT_END);

describe('ReviewView.renderStrongRecallBanner — F2.21’s offer, in F2.12’s own card (no new surface)', () => {
  it('renders nothing when no offer is pending', () => {
    const guard = SR_RENDER_BODY.slice(0, SR_RENDER_BODY.indexOf('createDiv'));
    expect(guard).toMatch(/if \(state === null\) return;/);
  });

  it('reuses F2.12’s banner and prompt classes rather than declaring a fourth style — F2.21: "the same offer shape as F2.12’s"', () => {
    expect(SR_RENDER_BODY).toMatch(/olea-review-confusion-banner/);
    expect(SR_RENDER_BODY).toMatch(/olea-review-confusion-prompt/);
  });

  it('carries an unstyled marker class so a test or a tour can tell which trigger produced the card', () => {
    expect(SR_RENDER_BODY).toMatch(/olea-review-strong-recall-banner/);
  });

  it('renders the offer’s own promptText — F2.21’s "says why it is asking", never a fabricated concept name', () => {
    expect(SR_RENDER_BODY).toMatch(/text:\s*state\.promptText/);
  });

  it('has exactly ONE button — one available action, no decline control (F2.14a)', () => {
    const buttonCalls = SR_RENDER_BODY.match(/createEl\('button'/g) ?? [];
    expect(buttonCalls).toHaveLength(1);
  });

  it('wires the button’s click to handleAcceptStrongRecallOffer', () => {
    expect(SR_RENDER_BODY).toMatch(
      /registerDomEvent\(btn, 'click', \(\) => this\.handleAcceptStrongRecallOffer\(\)\)/,
    );
  });
});

describe('ReviewView.syncStrongRecallOffer — the D7.1 offer/decline pair under the strong-recall trigger', () => {
  it('the offer-arrives branch calls session.recordStrongRecallOfferShown(offer) and stores the result as offerEventId', () => {
    const arrivesMatch = /this\.strongRecallBanner\s*=\s*\{[\s\S]*?\}/.exec(SR_SYNC_BODY);
    expect(
      arrivesMatch,
      'expected an assignment building the new strongRecallBanner state',
    ).not.toBeNull();
    expect(arrivesMatch?.[0] ?? '').toMatch(
      /offerEventId:\s*session\.recordStrongRecallOfferShown\(offer\)/,
    );
  });

  it('the clears-unaccepted branch calls session.recordStrongRecallOfferDeclined BEFORE clearing the banner', () => {
    const declineCallIndex = SR_SYNC_BODY.indexOf('session.recordStrongRecallOfferDeclined(');
    const clearIndex = SR_SYNC_BODY.lastIndexOf('this.strongRecallBanner = null;');

    expect(declineCallIndex).toBeGreaterThan(-1);
    expect(clearIndex).toBeGreaterThan(-1);
    expect(declineCallIndex).toBeLessThan(clearIndex);
  });

  it('does not call recordStrongRecallOfferShown/Declined a second time from anywhere else in the method', () => {
    expect(SR_SYNC_BODY.match(/recordStrongRecallOfferShown\(/g) ?? []).toHaveLength(1);
    expect(SR_SYNC_BODY.match(/recordStrongRecallOfferDeclined\(/g) ?? []).toHaveLength(1);
  });
});

describe('ReviewView.handleAcceptStrongRecallOffer — accepting is never recorded as a decline', () => {
  it('does not call session.recordStrongRecallOfferDeclined', () => {
    expect(SR_ACCEPT_BODY).not.toMatch(/recordStrongRecallOfferDeclined/);
  });

  it('clears this.strongRecallBanner directly, the same way handleAcceptConfusionOffer clears its own', () => {
    expect(SR_ACCEPT_BODY).toMatch(/this\.strongRecallBanner\s*=\s*null;/);
  });

  it('opens explain-back on the offer’s OWN instrument — the proposed concept is one that instrument teaches, so nothing is invented', () => {
    expect(SR_ACCEPT_BODY).toMatch(/this\.openExplainBack\?\.\(pending\.instrument\)/);
    expect(SR_ACCEPT_BODY).not.toMatch(/queueSnapshot/);
  });
});

describe('ReviewView.render — F2.21’s banner is synced and drawn where the other two are', () => {
  it('render() syncs then renders the strong-recall banner, alongside F2.12’s and F5.3a’s', () => {
    const renderStart = VIEW.indexOf('private render(): void {');
    const renderBody = VIEW.slice(renderStart, renderStart + 1200);
    expect(renderBody).toMatch(/this\.syncStrongRecallOffer\(this\.session\);/);
    expect(renderBody).toMatch(/this\.renderStrongRecallBanner\(\);/);
  });
});
