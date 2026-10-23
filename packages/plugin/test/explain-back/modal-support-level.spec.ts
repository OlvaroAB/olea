/**
 * `ol-l7ew` [DOS-C5a] — the support level an explain-back attempt was shown
 * at, which `[D-281]` item 3 (`ol-95vv.10`) makes one of the four pieces of
 * evidence the top growth stage requires.
 *
 * Two instruments, for the reason `modal-duration.spec.ts`'s own header
 * gives: `modal.ts` extends Obsidian's `Modal` and cannot load under Vitest,
 * so what the view RENDERS is asserted against its source text with comments
 * stripped, while the rule that turns rendered scaffolding into a ladder
 * value is a pure function in `solo-review.ts` and is tested directly.
 *
 * The rule is `[D-094]`'s own, quoted in `olea-contracts`' `supportLevel`
 * doc: record what was SHOWN, never what she said. The answering phase
 * offers no hint and keeps no source open beside her, so `'independent'` is
 * the true reading — not a default, and the constant that says so sits next
 * to the render method whose behaviour it describes.
 *
 * **v0.9 (`[D-603]`, `ol-egov.141.89.6.129`):** no review is written, so the view resolves no
 * rung; the practice explanation's writer records the support shown before each answer (D7.1,
 * `[D-614]`: `'independent'` when no passage had been shown, `'guided'` when one had). What stays
 * the view's to guarantee is the fact that makes `'independent'` true: nothing is open beside her
 * while she writes. That is checked by rendering the real answering phase
 * (`./practice-view-harness.ts`, `obsidian` mocked); the resolver's rules stay, tested below.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { beforeAll, describe, expect, it, vi } from 'vitest';
// `ADMITTED_SUPPORT_LEVELS` is `[D-281]`'s own list and lives in
// `olea-core`'s `mastery/rollup.ts`, which another lane owns; it is not
// re-exported from that package's index, so it is read here by deep path
// rather than copied into this file. A copy would be the drift these
// assertions exist to catch.
import { ADMITTED_SUPPORT_LEVELS } from '../../../core/src/mastery/rollup.js';
import { supportLevelShownForExplainBack } from '../../src/explain-back/solo-review.js';
import {
  INSTRUMENT,
  NOW,
  retrieveFor,
  SUBJECT_PASSAGES,
  type ViewInternals,
} from './practice-view-harness.js';

vi.mock('obsidian', async () => (await import('./practice-view-harness.js')).fakeObsidian());
vi.mock('../../src/sprig/render-sprig.js', async () => {
  const { FakeEl } = await import('./practice-view-harness.js');
  return { renderSprig: () => new FakeEl('svg') };
});

// The first import of the view (and `olea-core` behind it) can outlast a test's own timeout on a
// loaded machine; it is made once, here, so each test times only its own work.
beforeAll(async () => {
  await import('../../src/explain-back/modal.js');
}, 120_000);

const srcDir = fileURLToPath(new URL('../../src/', import.meta.url));

function codeOf(relativePath: string): string {
  return readFileSync(srcDir + relativePath, 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\/.*$/gm, '');
}

const modal = codeOf('explain-back/modal.ts');

describe('an attempt made with no help on screen records the independent level, and that level admits the top stage', () => {
  it('no hint offered and no source open resolves to independent', () => {
    expect(
      supportLevelShownForExplainBack({ hintOffered: false, sourceShownWhileAnswering: false }),
    ).toBe('independent');
  });

  it('independent is on [D-281]s admitted list, so such an attempt can reach the top stage', () => {
    expect(ADMITTED_SUPPORT_LEVELS).toContain('independent');
  });

  it('the answering phase shows her no passage and no hint: the prompt’s passages exist, and none is on screen', async () => {
    const { ExplainBackModal } = await import('../../src/explain-back/modal.js');
    const view = new ExplainBackModal(
      {} as never,
      {
        retrieveSourceBlocks: retrieveFor,
        generateInstrumentId: () => 'attempt-1',
        now: () => NOW,
      },
      { kind: 'instrument', instrument: INSTRUMENT },
    ) as unknown as ViewInternals;
    view.onOpen();
    await vi.waitFor(() => expect(view.state.phase).toBe('answering'));
    const texts = view.contentEl.texts();
    for (const passage of SUBJECT_PASSAGES) expect(texts).not.toContain(passage.block.text);
    expect(view.contentEl.withClass('olea-explain-back-item')).toEqual([]);
    expect(texts.join(' ')).not.toMatch(/hint/i);
  });

  it('v0.9: the view resolves no rung itself; the practice explanation’s writer records what was shown', () => {
    // The class body: the dormant review write's parameter type still declares the field.
    const view = modal.slice(modal.indexOf('export class ExplainBackModal'));
    expect(view).not.toMatch(/supportLevelShown|sealAttemptSupport/);
    expect(modal).not.toMatch(/EXPLAIN_BACK_ANSWERING_SUPPORT_SHOWN/);
    expect(modal).toMatch(/await practiceExplanationInput\(\{/);
  });
});

describe('an attempt made with the source open beside her records that level, and it does not admit the top stage', () => {
  it('a source kept open while she answers resolves to guided, whatever else is on screen', () => {
    expect(
      supportLevelShownForExplainBack({ hintOffered: false, sourceShownWhileAnswering: true }),
    ).toBe('guided');
    expect(
      supportLevelShownForExplainBack({ hintOffered: true, sourceShownWhileAnswering: true }),
    ).toBe('guided');
  });

  it('an offered hint with no source resolves to prompted', () => {
    expect(
      supportLevelShownForExplainBack({ hintOffered: true, sourceShownWhileAnswering: false }),
    ).toBe('prompted');
  });

  it('guided is not admitted, so an attempt shown the source cannot reach the top stage', () => {
    expect(ADMITTED_SUPPORT_LEVELS).not.toContain('guided');
  });
});

describe('an attempt whose support level is genuinely unknown stays unknown', () => {
  it('an unobservable presentation resolves to no value at all, never to independent', () => {
    expect(supportLevelShownForExplainBack(null)).toBeUndefined();
  });
});
