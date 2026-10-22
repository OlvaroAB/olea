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
import type { PaperStructuredShape } from 'olea-core';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import type { PracticePaperCourseState } from '../../src/paper/provider.js';

// `obsidian` has no runtime outside a host: a minimal stand-in lets the DOM layer be mounted for the
// `[D-586]` face tests below. The source-text tests above and below never import the view.
vi.mock('obsidian', () => {
  class El {
    text = '';
    cls = '';
    readonly children: El[] = [];
    constructor(readonly tag: string) {}
    createEl(tag: string, options?: { text?: string; cls?: string }): El {
      const child = new El(tag);
      child.text = options?.text ?? '';
      child.cls = options?.cls ?? '';
      this.children.push(child);
      return child;
    }
    createDiv(options?: { cls?: string }): El {
      return this.createEl('div', options);
    }
    addClass(): void {}
    empty(): void {
      this.children.length = 0;
    }
    addEventListener(): void {}
  }
  class ItemView {
    contentEl = new El('div');
    constructor(readonly leaf: unknown) {}
  }
  return { ItemView };
});

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

// ol-egov.141.89.7.93 ([D-562]): a group's held passage sits above its parts with no word of
// Olea's. The rendered shape is pinned through the mounted view in
// `face-passage.ol-egov.141.89.7.93.spec.ts`; this pins the source: no new string reaches her.
describe('PaperView.renderPassage — her text and its source’s path, and no label or sentence', () => {
  const RENDER_PASSAGE_BODY = sliceMethod(
    SOURCE,
    'private renderPassage(',
    'private renderHandoffControl(',
  );

  it('draws only the passage’s own text and its source’s path', () => {
    expect(RENDER_PASSAGE_BODY).toContain('text: passage.text');
    expect(RENDER_PASSAGE_BODY).toMatch(/text:\s*passage\.sourceId/);
    const texts = RENDER_PASSAGE_BODY.match(/text:\s*[^,}\s]+/g) ?? [];
    expect(texts.map((t) => t.replace(/\s+/g, ' '))).toEqual([
      'text: passage.text',
      'text: passage.sourceId',
    ]);
    // No string literal of any kind carries text in it.
    expect(RENDER_PASSAGE_BODY).not.toMatch(/text:\s*['"`]/);
  });

  it('is drawn inside the per-item loop, before the item’s own row', () => {
    const loopStart = RENDER_READY_BODY.indexOf('for (const item of state.items)');
    const passageCall = RENDER_READY_BODY.indexOf('this.renderPassage(list, passage);');
    const rowIndex = RENDER_READY_BODY.indexOf("const row = list.createEl('li');");
    expect(loopStart).toBeGreaterThan(-1);
    expect(passageCall).toBeGreaterThan(loopStart);
    expect(rowIndex).toBeGreaterThan(passageCall);
  });
});

// ---- `[D-586]` (F4.11): the face prints the stored paper's structure. Synthetic, coined content only.

interface MountedEl {
  readonly tag: string;
  readonly text: string;
  readonly cls: string;
  readonly children: MountedEl[];
}

/** The tree as plain lines: indentation by depth, `tag.cls "text"`. Comparable and readable. */
function serialise(el: MountedEl, depth = 0): string[] {
  const head = `${'  '.repeat(depth)}${el.tag}${el.cls === '' ? '' : `.${el.cls}`}${el.text === '' ? '' : ` ${JSON.stringify(el.text)}`}`;
  return [head, ...el.children.flatMap((c) => serialise(c, depth + 1))];
}

const stated = (value: number) => ({ status: 'stated', value }) as const;
const UNKNOWN = { status: 'unknown' } as const;
const SG = { stimulusNeed: { status: 'not-needed' }, heldStimulus: null } as const;
const SP = {
  questionForm: 'short answer',
  dependsOn: { status: 'unknown' },
  demand: { status: 'not-read' },
} as const;

const SECTIONED = {
  formatVersion: 'paper-structure-v1',
  structureBasis: 'current-or-transitional',
  structureSlotCount: 3,
  sections: [
    { sectionId: 'sA', label: 'Section Glorb', marks: stated(20), groupIds: ['g1'] },
    { sectionId: 'sB', label: 'Section Quill', marks: UNKNOWN, groupIds: ['g2'] },
  ],
  groups: [
    {
      groupId: 'g1',
      kind: 'parent-question',
      sectionId: 'sA',
      label: 'x',
      slotIds: ['p1', 'p2'],
      ...SG,
    },
    { groupId: 'g2', kind: 'parent-question', sectionId: 'sB', label: 'y', slotIds: ['p3'], ...SG },
  ],
  parts: [
    { slotId: 'p1', groupId: 'g1', label: '1(a)', marks: stated(4), ...SP },
    { slotId: 'p2', groupId: 'g1', label: '1(b)', marks: stated(6), ...SP },
    { slotId: 'p3', groupId: 'g2', label: '2', marks: UNKNOWN, ...SP },
  ],
  totalMarks: stated(40),
  timeAllowance: { status: 'unknown' },
} as unknown as PaperStructuredShape;

function readyState(structure: PaperStructuredShape | undefined): PracticePaperCourseState {
  const item = (slotId: string, conceptName: string) => ({
    slotId,
    conceptName,
    intendedDemand: 'recall-a-fact',
    groundingLabel: 'your notes cover this',
    response: null,
  });
  return {
    kind: 'ready',
    course: 'Course Zarp',
    record: { id: 'paper-1', handoffs: [], ...(structure === undefined ? {} : { structure }) },
    partial: false,
    partialStatement: null,
    incompleteStatement: null,
    items: [item('p1', 'Blorn'), item('p2', 'Skrit'), item('p3', 'Vemmel')],
    emptySlots: [],
    materialChanged: false,
    passages: [],
  } as unknown as PracticePaperCourseState;
}

// The first import loads the whole view module graph, which is slow under a full parallel run.
beforeAll(async () => {
  await import('../../src/paper/view.js');
}, 60_000);

async function mount(state: PracticePaperCourseState): Promise<string[]> {
  const { PaperView } = await import('../../src/paper/view.js');
  const view = new PaperView({} as never, { load: async () => state } as never, 'Course Zarp');
  await view.refresh();
  return serialise((view as unknown as { contentEl: MountedEl }).contentEl);
}

describe('PaperView — the sectioned face (F4.11, [D-586])', () => {
  it('prints section headings, question and part numbers, and every stated allocation', async () => {
    const lines = (await mount(readyState(SECTIONED))).join('\n');
    expect(lines).toContain('p.olea-paper-whole-allocation "Whole paper [40]"');
    expect(lines).toContain('h3 "Section Glorb"');
    expect(lines).toContain('span.olea-paper-allocation " [20]"');
    expect(lines).toContain('h3 "Section Quill"');
    expect(lines).toContain('li.olea-paper-question');
    expect(lines).toContain('strong "1"');
    expect(lines).toContain('span.olea-paper-part-number "1(a) "');
    expect(lines).toContain('span.olea-paper-part-number "1(b) "');
    expect(lines).toContain('span.olea-paper-allocation " [4]"');
    expect(lines).toContain('span.olea-paper-allocation " [6]"');
    expect(lines.indexOf('Section Glorb')).toBeLessThan(lines.indexOf('Section Quill'));
  });

  it('draws nothing for an allocation read as unknown: no zero, no estimate, no empty bracket', async () => {
    const lines = await mount(readyState(SECTIONED));
    const quill = lines.slice(lines.findIndex((l) => l.includes('Section Quill')));
    // The section's own marks are unknown: its heading has no allocation child.
    expect(quill[1]).not.toContain('olea-paper-allocation');
    // Part "2" has unknown marks: its row (up to the next row) carries no allocation.
    const row = quill.slice(quill.findIndex((l) => l.includes('"2 "')));
    expect(row.join('\n')).not.toContain('olea-paper-allocation');
    expect(lines.join('\n')).not.toContain('[0]');
  });

  it('the structured face adds no hand-off control: every item row keeps exactly one', async () => {
    const lines = await mount(readyState(SECTIONED));
    expect(lines.filter((l) => l.includes('button "Add to review"'))).toHaveLength(3);
  });
});

describe('PaperView — a paper with no recovered sections prints as before ([D-586])', () => {
  // The expected tree is what `renderReady` produced before this change: one list, one row per
  // item, `strong` name then `span` label then the hand-off button; nothing else.
  const TODAY = [
    'div',
    '  h2 "Practice paper: Course Zarp"',
    '  ul.olea-paper-items',
    ...['Blorn', 'Skrit', 'Vemmel'].flatMap((name) => [
      '    li',
      `      strong ${JSON.stringify(name)}`,
      '      span " — your notes cover this"',
      '      button "Add to review"',
    ]),
  ];

  it('with no stored structure', async () => {
    expect(await mount(readyState(undefined))).toEqual(TODAY);
  });

  it('with a stored structure that holds no sections', async () => {
    expect(await mount(readyState({ ...SECTIONED, sections: [] }))).toEqual(TODAY);
  });
});
