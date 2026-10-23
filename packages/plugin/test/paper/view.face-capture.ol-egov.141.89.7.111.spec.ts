/**
 * The practice paper's face, captured as HTML through the shipped view (ol-egov.141.89.7.111).
 *
 * `PaperView` renders only where `obsidian` can be stood in for, so a reading that needs the
 * paper's face as she receives it renders a ready state through the real view here, with the same
 * `obsidian` stand-in the other paper specs use and a small DOM fake that records tags, classes and
 * text. When `OLEA_FACE_STATE_IN` names a JSON file holding a ready state, that state is rendered and
 * the HTML is written to `OLEA_FACE_HTML_OUT`; with neither variable set, a built-in invented ready
 * state is rendered and its structure asserted. The state is only ever read from the file named,
 * and nothing here reads a vault. Invented material only.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';

vi.mock('obsidian', () => ({
  ItemView: class {
    contentEl: unknown;
    constructor(_leaf: unknown) {
      this.contentEl = (globalThis as { __faceRootFactory?: () => unknown }).__faceRootFactory?.();
    }
  },
}));

import type { PracticePaperCourseState, PracticePaperViewDeps } from '../../src/paper/provider.js';
import {
  PAPER_HANDOFF_ALREADY_DONE,
  PAPER_HANDOFF_BUTTON_LABEL,
  PaperView,
} from '../../src/paper/view.js';

/** Records what the view draws: tag, class, text, children. Serialises to HTML. */
class HtmlEl {
  text = '';
  cls = '';
  readonly children: HtmlEl[] = [];
  constructor(readonly tag: string) {}
  createEl(tag: string, options?: { text?: string; cls?: string }): HtmlEl {
    const child = new HtmlEl(tag);
    child.text = options?.text ?? '';
    child.cls = options?.cls ?? '';
    this.children.push(child);
    return child;
  }
  createDiv(options?: { cls?: string }): HtmlEl {
    return this.createEl('div', options);
  }
  addClass(_cls: string): void {}
  empty(): void {
    this.children.length = 0;
  }
  addEventListener(_type: string, _handler: () => void): void {}
  html(): string {
    const open =
      this.cls === '' ? `<${this.tag}>` : `<${this.tag} class="${escapeHtml(this.cls)}">`;
    return `${open}${escapeHtml(this.text)}${this.children.map((c) => c.html()).join('')}</${this.tag}>`;
  }
  innerHtml(): string {
    return `${escapeHtml(this.text)}${this.children.map((c) => c.html()).join('')}`;
  }
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** The view over a given ready state; returns the HTML it draws. */
async function renderFace(state: PracticePaperCourseState): Promise<string> {
  const root = new HtmlEl('div');
  (globalThis as { __faceRootFactory?: () => unknown }).__faceRootFactory = () => root;
  const deps = {
    load: async () => state,
    requestPaper: async () => {
      throw new Error('the face capture never requests a paper');
    },
    handOffItem: async () => {
      throw new Error('the face capture never hands an item off');
    },
  } as unknown as PracticePaperViewDeps;
  const view = new PaperView({} as never, deps, 'Course Zarp');
  await view.refresh();
  return root.innerHtml();
}

const item = (slotId: string, conceptName: string, groundingLabel: string) => ({
  slotId,
  conceptName,
  intendedDemand: 'recall-a-fact',
  groundingLabel,
  response: null,
});
const marks = (value: number) => ({ status: 'stated', value });

/** An invented structured paper: two sections, one question with two parts under a passage, one handed off. */
const SYNTHETIC_READY_STATE = {
  kind: 'ready',
  course: 'Course Zarp',
  record: {
    id: 'paper-synthetic',
    handoffs: [
      { slotId: 'p3', elicitingContextLabel: 'from a practice paper', handedOffAt: '2026-01-01' },
    ],
    structure: {
      formatVersion: 'paper-structure-v1',
      structureBasis: 'current-or-transitional',
      structureSlotCount: 3,
      sections: [
        { sectionId: 's-a', label: 'Section Alpha', marks: marks(30), groupIds: ['g-q1'] },
        { sectionId: 's-b', label: 'Section Beta', marks: marks(10), groupIds: ['g-q2'] },
      ],
      groups: [
        {
          groupId: 'g-q1',
          kind: 'parent-question',
          sectionId: 's-a',
          label: 'Question one',
          slotIds: ['p1', 'p2'],
          stimulusNeed: { status: 'needed', form: 'extract' },
          heldStimulus: { form: 'extract', sourceId: 'Notes/Invented source.md', chunkIndex: 0 },
        },
        {
          groupId: 'g-q2',
          kind: 'parent-question',
          sectionId: 's-b',
          label: 'Question two',
          slotIds: ['p3'],
          stimulusNeed: { status: 'not-needed' },
          heldStimulus: null,
        },
      ],
      parts: [
        {
          slotId: 'p1',
          groupId: 'g-q1',
          label: '1(a)',
          questionForm: 'short answer',
          marks: marks(10),
          dependsOn: { status: 'unknown' },
          demand: { status: 'read', demand: 'recall-a-fact' },
        },
        {
          slotId: 'p2',
          groupId: 'g-q1',
          label: '1(b)',
          questionForm: 'short answer',
          marks: marks(20),
          dependsOn: { status: 'unknown' },
          demand: { status: 'read', demand: 'recall-a-fact' },
        },
        {
          slotId: 'p3',
          groupId: 'g-q2',
          label: '2',
          questionForm: 'short answer',
          marks: marks(10),
          dependsOn: { status: 'unknown' },
          demand: { status: 'read', demand: 'recall-a-fact' },
        },
      ],
      totalMarks: marks(40),
      timeAllowance: { status: 'unknown' },
    },
  },
  partial: false,
  partialStatement: null,
  incompleteStatement: null,
  items: [
    item('p1', 'Blorn', 'your notes cover this'),
    item('p2', 'Skrit', 'course scope only'),
    item('p3', 'Vemmel', 'your notes cover this'),
  ],
  emptySlots: [],
  materialChanged: false,
  passages: [
    {
      groupId: 'g-q1',
      text: 'A blorn is read off the skrit scale at noon.',
      sourceId: 'Notes/Invented source.md',
      slotIds: ['p1', 'p2'],
    },
  ],
} as unknown as PracticePaperCourseState;

const stateIn = process.env.OLEA_FACE_STATE_IN;
const htmlOut = process.env.OLEA_FACE_HTML_OUT;

describe('the practice paper face, through the shipped view', () => {
  if (stateIn) {
    it('renders the named ready state and writes its HTML', async () => {
      if (!htmlOut) throw new Error('OLEA_FACE_STATE_IN is set without OLEA_FACE_HTML_OUT');
      const state = JSON.parse(readFileSync(stateIn, 'utf8')) as PracticePaperCourseState;
      expect(state.kind).toBe('ready');
      const html = await renderFace(state);
      expect(html).toContain('<h2>');
      writeFileSync(htmlOut, html);
    });
    return;
  }

  it('draws sections, part numbers, concepts, grounding labels, marks, the passage and the controls', async () => {
    const html = await renderFace(SYNTHETIC_READY_STATE);
    if (htmlOut) writeFileSync(htmlOut, html);

    expect(html.startsWith('<h2>Practice paper: Course Zarp</h2>')).toBe(true);
    expect(html).toContain('class="olea-paper-whole-allocation">Whole paper [40]');
    expect(html.match(/class="olea-paper-section"/g)).toHaveLength(2);
    expect(html).toContain(
      '<h3>Section Alpha<span class="olea-paper-allocation"> [30]</span></h3>',
    );
    expect(html).toContain('<h3>Section Beta<span class="olea-paper-allocation"> [10]</span></h3>');
    expect(html.match(/class="olea-paper-question"/g)).toHaveLength(1);
    expect(html).toContain('<strong>1</strong>');
    expect(html.match(/class="olea-paper-part-number"/g)).toHaveLength(3);
    expect(html).toContain(
      '<span class="olea-paper-part-number">1(a) </span><strong>Blorn</strong>',
    );
    expect(html).toContain('<strong>Skrit</strong><span> — course scope only</span>');
    expect(html).toContain('<strong>Vemmel</strong><span> — your notes cover this</span>');
    expect(html).toContain('<span class="olea-paper-allocation"> [10]</span>');
    expect(html).toContain('<span class="olea-paper-allocation"> [20]</span>');

    // The passage sits above its group's first part, once, with its source's path.
    expect(html.match(/class="olea-paper-passage"/g)).toHaveLength(1);
    expect(html.indexOf('olea-paper-passage-text')).toBeLessThan(html.indexOf('Blorn'));
    expect(html.indexOf('Blorn')).toBeLessThan(html.indexOf('Skrit'));
    expect(html).toContain('A blorn is read off the skrit scale at noon.');
    expect(html).toContain('<li>Notes/Invented source.md</li>');

    // Hand-off controls: a button on each part not yet handed off, the past-tense line on the one that was.
    expect(
      html.match(new RegExp(`<button>${PAPER_HANDOFF_BUTTON_LABEL}</button>`, 'g')),
    ).toHaveLength(2);
    expect(html).toContain(PAPER_HANDOFF_ALREADY_DONE);
  });
});
