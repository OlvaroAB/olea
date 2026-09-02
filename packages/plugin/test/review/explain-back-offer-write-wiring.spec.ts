/**
 * `[D-178 / LOG-3]` item 2's production caller (`ol-0r92.28`): `view.ts`'s
 * `syncConfusionRoutingOffer` is where the F2.12 offer/decline pair is
 * actually written, by calling through to `ReviewSession`'s
 * `recordExplainBackOfferShown`/`recordExplainBackOfferDeclined` (never a
 * vault port directly — see `ports.ts`'s `ExplainBackOfferLogPort` doc).
 *
 * Scenario: `features/F5-explain-it-back.md`'s "the offer and decline
 * record" feature block — @auto:plugin/review/explain-back-offer-write-wiring.spec.
 *
 * **Why this is a source-text assertion, not a mounted-DOM test.** Same
 * constraint `view-focus-document.spec.ts`/`note-missing-header.spec.ts`
 * document: `view.ts` imports `ItemView` from `obsidian`, whose `package.json`
 * `main` is `""`, so it cannot be loaded under Vitest at all. The session-level
 * "the pair is written with matching ids" behaviour lives in `session.spec.ts`
 * (`recordExplainBackOfferShown`/`recordExplainBackOfferDeclined` are pure
 * `ReviewSession` methods and fully mountable); this file only pins that
 * `view.ts` actually calls them from the right branches, in the right order,
 * and that the accept path does not.
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

/** The body of `syncConfusionRoutingOffer`, isolated so assertions about it can't be satisfied by unrelated code elsewhere in the file. */
const SYNC_START = VIEW.indexOf('private syncConfusionRoutingOffer(');
const SYNC_END = VIEW.indexOf('private renderConfusionRoutingBanner(');
if (SYNC_START === -1 || SYNC_END === -1) {
  throw new Error(
    'explain-back-offer-write-wiring.spec.ts: syncConfusionRoutingOffer/renderConfusionRoutingBanner markers moved in view.ts',
  );
}
const SYNC_BODY = VIEW.slice(SYNC_START, SYNC_END);

/** The body of `handleAcceptConfusionOffer`, isolated the same way. */
const ACCEPT_START = VIEW.indexOf('private handleAcceptConfusionOffer(');
if (ACCEPT_START === -1) {
  throw new Error(
    'explain-back-offer-write-wiring.spec.ts: handleAcceptConfusionOffer marker moved in view.ts',
  );
}
// The method is the last one of its kind in the F2.12 section; a fixed-size
// slice comfortably covers a short method body without needing a second
// marker that could itself drift.
const ACCEPT_BODY = VIEW.slice(ACCEPT_START, ACCEPT_START + 800);

describe('ReviewView.syncConfusionRoutingOffer — the D-178/LOG-3 item 2 write (ol-0r92.28)', () => {
  it('the offer-arrives branch calls session.recordExplainBackOfferShown(offer.instrument) and stores the result as offerEventId', () => {
    const arrivesMatch = /this\.confusionBanner\s*=\s*\{[\s\S]*?\}/.exec(SYNC_BODY) ?? undefined;
    expect(
      arrivesMatch,
      'expected an assignment building the new confusionBanner state',
    ).not.toBeUndefined();
    const arrivesBlock = arrivesMatch?.[0] ?? '';

    expect(arrivesBlock).toMatch(
      /offerEventId:\s*session\.recordExplainBackOfferShown\(offer\.instrument\)/,
    );
  });

  it('the clears-unaccepted branch calls session.recordExplainBackOfferDeclined with the banner’s own instrument and offerEventId, BEFORE clearing the banner', () => {
    const declineCallIndex = SYNC_BODY.indexOf('session.recordExplainBackOfferDeclined(');
    const clearIndex = SYNC_BODY.lastIndexOf('this.confusionBanner = null;');

    expect(
      declineCallIndex,
      'expected a call to session.recordExplainBackOfferDeclined',
    ).toBeGreaterThan(-1);
    expect(clearIndex, 'expected the clears-unaccepted branch to null the banner').toBeGreaterThan(
      -1,
    );
    expect(declineCallIndex).toBeLessThan(clearIndex);

    const declineCall = SYNC_BODY.slice(declineCallIndex, clearIndex);
    expect(declineCall).toMatch(/this\.confusionBanner\.instrument/);
    expect(declineCall).toMatch(/this\.confusionBanner\.offerEventId/);
  });

  it('does not call recordExplainBackOfferShown/Declined a second time from anywhere else in the method', () => {
    const shownCalls = SYNC_BODY.match(/recordExplainBackOfferShown\(/g) ?? [];
    const declinedCalls = SYNC_BODY.match(/recordExplainBackOfferDeclined\(/g) ?? [];
    expect(shownCalls).toHaveLength(1);
    expect(declinedCalls).toHaveLength(1);
  });
});

describe('ReviewView.handleAcceptConfusionOffer — accepting is never recorded as a decline (D-178/LOG-3 item 2)', () => {
  it('does not call session.recordExplainBackOfferDeclined — accepting evidences itself via the explain-back review record instead', () => {
    expect(ACCEPT_BODY).not.toMatch(/recordExplainBackOfferDeclined/);
  });

  it('still clears this.confusionBanner directly, the same way it always has', () => {
    expect(ACCEPT_BODY).toMatch(/this\.confusionBanner\s*=\s*null;/);
  });
});
