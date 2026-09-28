/**
 * `view.ts`'s per-item hand-off control (`ol-0r92.135`, F4.11 ruling 1, `[D-252]`/`[D-367]`/
 * `[D-391]`/`[D-407]`) — the one part of `PaperView` this bead's own module doc carves out an
 * exception for ("no test file for this module, and none is expected" no longer holds for this
 * one control).
 *
 * **Why this is a source-text assertion, not a mounted-DOM test.** Same constraint
 * `review/view-button-activation.spec.ts` and `review/view-focus-document.spec.ts` already
 * document: `view.ts` imports `ItemView` from `obsidian`, whose `package.json` `main` is `""`, so
 * it cannot be loaded under Vitest at all — no fake, no shim, no import. The real hand-off
 * BEHAVIOUR (idempotence, the citation sidecar, the home-note concept binding) is exercised where
 * it actually runs, against a real `VaultSource`, in `test/paper/provider.spec.ts`'s
 * `handOffItem()` suite; this file pins only what the DOM layer on top of it does — which of the
 * three ratified strings it shows, when, and that there is exactly one hand-off control per item
 * and no whole-paper one anywhere.
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const RAW_SOURCE = readFileSync(resolve(__dirname, '../../src/paper/view.ts'), 'utf8');
/** Comments stripped — a doc paragraph describing a rule must not satisfy an assertion about it. */
const SOURCE = RAW_SOURCE.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');

function sliceMethod(source: string, startMarker: string, endMarker: string | null): string {
  const start = source.indexOf(startMarker);
  if (start === -1) throw new Error(`view.spec.ts: marker not found: ${startMarker}`);
  const end = endMarker === null ? source.length : source.indexOf(endMarker, start);
  if (endMarker !== null && end === -1) {
    throw new Error(`view.spec.ts: end marker not found: ${endMarker}`);
  }
  return source.slice(start, end);
}

const RENDER_READY_BODY = sliceMethod(
  SOURCE,
  'private renderReady(',
  'private renderHandoffControl(',
);
const RENDER_HANDOFF_CONTROL_BODY = sliceMethod(
  SOURCE,
  'private renderHandoffControl(',
  'private async handOffItem(',
);
const HAND_OFF_ITEM_BODY = sliceMethod(SOURCE, 'private async handOffItem(', null);

describe('PaperView — the three ratified strings (David, 2026-09-27; docs/design/copy-pass-2026-09/paper-item-handoff.md)', () => {
  it('exports the button label, the confirmation and the already-added line verbatim', () => {
    expect(SOURCE).toContain("export const PAPER_HANDOFF_BUTTON_LABEL = 'Add to review';");
    expect(SOURCE).toContain(
      "export const PAPER_HANDOFF_CONFIRMATION = 'Added to your ordinary review, from a practice paper.';",
    );
    expect(SOURCE).toContain("'Already added to your ordinary review, from a practice paper.';");
  });

  it('every sentence that states the record’s context uses the ratified phrase verbatim', () => {
    // The registry ratifies the exact string "from a practice paper" (never a paraphrase) —
    // every occurrence in the confirmation/already-added strings must carry it byte-for-byte.
    expect(RAW_SOURCE).toContain('from a practice paper.');
    expect(RAW_SOURCE).not.toMatch(/from your practice paper|from a paper attempt/);
  });
});

describe('PaperView.renderHandoffControl — one item, one control, never the whole paper (F4.11 ruling 1, [D-252])', () => {
  it('is called exactly once per item, inside renderReady’s own per-item loop, and nowhere else', () => {
    const callSites = SOURCE.match(/this\.renderHandoffControl\(/g) ?? [];
    expect(callSites).toHaveLength(1);
    expect(RENDER_READY_BODY).toContain('this.renderHandoffControl(row, state, item);');
    // The call sits inside the `for (const item of state.items)` loop, not after it.
    const loopStart = RENDER_READY_BODY.indexOf('for (const item of state.items)');
    const callIndex = RENDER_READY_BODY.indexOf('this.renderHandoffControl(');
    expect(loopStart).toBeGreaterThan(-1);
    expect(callIndex).toBeGreaterThan(loopStart);
  });

  it('branches on the durable record — state.record.handoffs — never a view-local flag alone', () => {
    expect(RENDER_HANDOFF_CONTROL_BODY).toMatch(
      /state\.record\.handoffs\.some\(\(h\) => h\.slotId === item\.slotId\)/,
    );
  });

  it('renders no button at all once the slot is already handed off — a static line instead', () => {
    const [beforeReturn, afterReturn] = RENDER_HANDOFF_CONTROL_BODY.split('return;\n    }');
    expect(beforeReturn).toBeDefined();
    expect(afterReturn).toBeDefined();
    // The already-handed-off branch (before the early return) creates a <p>, never a <button>.
    expect(beforeReturn).toContain("row.createEl('p'");
    expect(beforeReturn).not.toContain("createEl('button'");
    // Only past the early return does a button ever get created, for the not-yet-handed-off case.
    expect(afterReturn).toContain("row.createEl('button'");
  });

  it('picks the confirmation when THIS render just did the act, and the already-added line otherwise', () => {
    expect(RENDER_HANDOFF_CONTROL_BODY).toMatch(
      /this\.justHandedOff\.has\(item\.slotId\)\s*\n?\s*\?\s*PAPER_HANDOFF_CONFIRMATION\s*\n?\s*:\s*PAPER_HANDOFF_ALREADY_DONE/,
    );
  });

  it('the button, when rendered, is labelled with the ratified string and wired to handOffItem', () => {
    expect(RENDER_HANDOFF_CONTROL_BODY).toMatch(
      /createEl\('button',\s*\{\s*text:\s*PAPER_HANDOFF_BUTTON_LABEL\s*\}\)/,
    );
    expect(RENDER_HANDOFF_CONTROL_BODY).toContain('void this.handOffItem(state, item, button);');
  });

  it('never offers a whole-paper hand-off: the file creates at most two buttons in total (pull paper, add to review)', () => {
    const buttonCalls = SOURCE.match(/createEl\('button'/g) ?? [];
    expect(buttonCalls).toHaveLength(2);
    // Neither button's click handler is reached from a loop over more than one item at a time —
    // renderHandoffControl (asserted above) is the only per-item call site, and the OTHER button
    // ("Give me a practice paper…") is created once per course, outside any items loop.
    const pullButtonIndex = SOURCE.indexOf(
      "root.createEl('button', { text: 'Give me a practice paper for this course' })",
    );
    expect(pullButtonIndex).toBeGreaterThan(-1);
    expect(SOURCE.slice(pullButtonIndex, pullButtonIndex + 400)).not.toContain('state.items');
  });
});

describe('PaperView.handOffItem — calls olea-core’s handOffPaperItem (via deps.handOffItem) exactly once, idempotently', () => {
  it('disables the button before the write settles, so a fast double-click cannot fire twice', () => {
    const disableIndex = HAND_OFF_ITEM_BODY.indexOf('button.disabled = true;');
    const callIndex = HAND_OFF_ITEM_BODY.indexOf('await this.deps.handOffItem(');
    expect(disableIndex).toBeGreaterThan(-1);
    expect(callIndex).toBeGreaterThan(-1);
    expect(disableIndex).toBeLessThan(callIndex);
  });

  it('passes the paper id, the slot id and the item’s own concept name — questionIndex is fixed at 0 inside deps, not passed from here', () => {
    expect(HAND_OFF_ITEM_BODY).toMatch(
      /this\.deps\.handOffItem\(\s*state\.course,\s*state\.record\.id,\s*item\.slotId,\s*item\.conceptName,?\s*\)/,
    );
  });

  it('marks the slot as just-handed-off and re-renders from the returned record, never by re-loading the course', () => {
    expect(HAND_OFF_ITEM_BODY).toContain('this.justHandedOff.add(item.slotId);');
    expect(HAND_OFF_ITEM_BODY).toContain('this.render({ ...state, record: result.record });');
    expect(HAND_OFF_ITEM_BODY).not.toContain('this.deps.load(');
    expect(HAND_OFF_ITEM_BODY).not.toContain('this.deps.requestPaper(');
  });
});

describe('PaperView — justHandedOff is cleared whenever a fresh ready state replaces the current one', () => {
  it('refresh() clears it before rendering the freshly loaded state', () => {
    const refreshBody = sliceMethod(SOURCE, 'async refresh(): Promise<void> {', 'private render(');
    const clearIndex = refreshBody.indexOf('this.justHandedOff.clear();');
    const loadIndex = refreshBody.indexOf('this.deps.load(');
    const renderIndex = refreshBody.indexOf('this.render(state);');
    expect(clearIndex).toBeGreaterThan(-1);
    expect(loadIndex).toBeGreaterThan(-1);
    expect(clearIndex).toBeGreaterThan(loadIndex);
    expect(renderIndex).toBeGreaterThan(clearIndex);
  });

  it('pullPaper() clears it before rendering the freshly composed paper', () => {
    const pullBody = sliceMethod(SOURCE, 'private async pullPaper(', 'private renderReady(');
    const clearIndex = pullBody.indexOf('this.justHandedOff.clear();');
    const requestIndex = pullBody.indexOf('this.deps.requestPaper(');
    expect(clearIndex).toBeGreaterThan(-1);
    expect(requestIndex).toBeGreaterThan(-1);
    expect(clearIndex).toBeGreaterThan(requestIndex);
  });
});
