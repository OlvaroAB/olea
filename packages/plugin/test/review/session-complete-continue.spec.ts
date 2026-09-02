/**
 * The regression guard for `ol-0r92.32` (`[D-091]`, component register
 * §3.7): the review session-complete screen (`view.ts`'s `renderComplete`)
 * used to offer only `Close`, which reads as the declared target for
 * today's due queue becoming a hard cap the moment she reaches it — exactly
 * what `[D-091]` rules out ("she is always free to outrun it") and what the
 * pass6 design kit (`docs/design/pass6-walkthrough` in the service repo)
 * names against its own walkthrough.
 *
 * **Why this is a source-text assertion, not a mounted-DOM test.** Same
 * constraint `note-missing-header.spec.ts` and `view-focus-document.spec.ts`
 * document: `view.ts` imports `ItemView` from `obsidian`, whose
 * `package.json` `main` is `""`, so it cannot be loaded under Vitest at
 * all. The invariants below are pure properties of this file's text —
 * `renderComplete` builds BOTH the continue and the close affordance,
 * unconditionally and as siblings, and the continue handler sources its
 * extension items from the SAME `this.openSession` provider every ordinary
 * open already uses, never a second, invented source.
 */

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const __dirname = dirname(fileURLToPath(import.meta.url));

/** Source with comments stripped — a doc paragraph describing the fix must not satisfy an assertion about it. */
function codeOf(relativePath: string): string {
  return readFileSync(join(__dirname, '..', '..', relativePath), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\/.*$/gm, '');
}

const VIEW = codeOf('src/review/view.ts');

const RENDER_COMPLETE_START = VIEW.indexOf('private renderComplete(');
const RENDER_COMPLETE_END = VIEW.indexOf('private async continueSessionAfterComplete(');
if (RENDER_COMPLETE_START === -1 || RENDER_COMPLETE_END === -1) {
  throw new Error(
    'session-complete-continue.spec.ts: renderComplete/continueSessionAfterComplete markers moved in view.ts',
  );
}
const RENDER_COMPLETE_BODY = VIEW.slice(RENDER_COMPLETE_START, RENDER_COMPLETE_END);

const CONTINUE_METHOD_END_MARKER = '\n}\n'; // end of the ReviewView class
const CONTINUE_METHOD_BODY = VIEW.slice(
  RENDER_COMPLETE_END,
  VIEW.indexOf(CONTINUE_METHOD_END_MARKER, RENDER_COMPLETE_END) + CONTINUE_METHOD_END_MARKER.length,
);

describe('ReviewView.renderComplete — Close is never the only exit (ol-0r92.32, [D-091])', () => {
  it('imports the continue label from copy.ts rather than typing the word "Close" a second meaning into it', () => {
    expect(VIEW).toMatch(/SESSION_COMPLETE_CONTINUE_LABEL[\s\S]{0,200}from '\.\/copy\.js'/);
  });

  it('builds a "keep going" button referencing SESSION_COMPLETE_CONTINUE_LABEL inside renderComplete', () => {
    expect(RENDER_COMPLETE_BODY).toContain('SESSION_COMPLETE_CONTINUE_LABEL');
  });

  it('still builds the Close button — leaving stays available, it is just never the only affordance', () => {
    expect(RENDER_COMPLETE_BODY).toMatch(/text:\s*'Close'/);
  });

  it('builds both buttons unconditionally, as siblings — neither is behind an `if`', () => {
    expect(RENDER_COMPLETE_BODY).not.toMatch(/\bif\s*\(/);
  });

  it('both actions are appended to the same actions row, not two separately-gated containers', () => {
    const actionsDivCount = (
      RENDER_COMPLETE_BODY.match(/createDiv\(\{\s*cls:\s*'olea-review-actions-row'/g) ?? []
    ).length;
    expect(actionsDivCount).toBe(1);
    const buttonCount = (RENDER_COMPLETE_BODY.match(/createEl\('button'/g) ?? []).length;
    expect(buttonCount).toBe(2);
  });

  it('the "keep going" click handler calls continueSessionAfterComplete, never leaf.detach directly', () => {
    const keepGoingBlock = RENDER_COMPLETE_BODY.slice(
      RENDER_COMPLETE_BODY.indexOf('SESSION_COMPLETE_CONTINUE_LABEL'),
      RENDER_COMPLETE_BODY.indexOf("text: 'Close'"),
    );
    expect(keepGoingBlock).toContain('continueSessionAfterComplete');
    expect(keepGoingBlock).not.toContain('leaf.detach');
  });
});

describe('ReviewView.continueSessionAfterComplete — extends from the SAME plan, never a second policy (ol-0r92.32, [D-091])', () => {
  it('sources its extension items from this.openSession — the identical provider onOpen uses, not a new one', () => {
    expect(CONTINUE_METHOD_BODY).toContain('this.openSession()');
  });

  it("hands the fresh queue to the CURRENT session's continueWith rather than discarding what she already did", () => {
    expect(CONTINUE_METHOD_BODY).toMatch(/this\.session\?\.continueWith\(/);
  });

  it('does not re-import or call executeStudyPlan/composeQueue itself — it invents no second selection mechanism', () => {
    expect(CONTINUE_METHOD_BODY).not.toMatch(/executeStudyPlan|composeQueue/);
  });
});
