/**
 * The grove view's section for links Olea's reading makes under a course's objectives (`[D-537]`,
 * `ol-egov.141.89.7.77`), mounted: S1's heading and note with its own count, below the declared
 * concepts and above "Also growing here"; each placed concept with the wording of each objective
 * it falls under, which opens the document; one C1 control per placement ("Not part of this"); and
 * the collapsed list she took out, with the put-back line and "Put back" on each. Clicking a
 * control calls the provider's handler and reads the grove again.
 *
 * `obsidian` cannot load under Vitest (its `main` is empty), so `ItemView` is stood in by a bare
 * base whose `contentEl` is the small fake element below: just the calls `view.ts` makes.
 * Scenarios: olea-service `features/F8-concepts-scope.md`, tagged
 * `@auto:plugin/grove/view.placements.ol-egov.141.89.7.77.spec`.
 *
 * INV-3: every course code, concept name, path and sentence below is invented.
 */

import type { ContainmentDeclaration, GroveCourseModel, VaultPath } from 'olea-core';
import { describe, expect, it, vi } from 'vitest';

class FakeElement {
  readonly children: FakeElement[] = [];
  readonly attributes = new Map<string, string>();
  readonly listeners = new Map<string, ((event: { preventDefault(): void }) => void)[]>();
  classes: string[] = [];
  text = '';
  disabled = false;

  constructor(readonly tag: string) {}

  createEl(tag: string, options: { cls?: string; text?: string } = {}): FakeElement {
    const child = new FakeElement(tag);
    if (options.cls !== undefined) child.classes = options.cls.split(/\s+/);
    if (options.text !== undefined) child.text = options.text;
    this.children.push(child);
    return child;
  }

  createDiv(options: { cls?: string; text?: string } = {}): FakeElement {
    return this.createEl('div', options);
  }

  createSpan(options: { cls?: string; text?: string } = {}): FakeElement {
    return this.createEl('span', options);
  }

  appendChild(child: FakeElement): FakeElement {
    this.children.push(child);
    return child;
  }

  empty(): void {
    this.children.length = 0;
  }

  addClass(cls: string): void {
    this.classes.push(cls);
  }

  setAttribute(name: string, value: string): void {
    this.attributes.set(name, value);
  }

  addEventListener(type: string, listener: (event: { preventDefault(): void }) => void): void {
    this.listeners.set(type, [...(this.listeners.get(type) ?? []), listener]);
  }

  click(): void {
    for (const listener of this.listeners.get('click') ?? []) listener({ preventDefault() {} });
  }

  /** Every element below this one, depth first, in document order. */
  all(): FakeElement[] {
    return this.children.flatMap((child) => [child, ...child.all()]);
  }

  find(cls: string): FakeElement[] {
    return this.all().filter((el) => el.classes.includes(cls));
  }

  one(cls: string): FakeElement {
    const found = this.find(cls);
    if (found.length !== 1) throw new Error(`expected one .${cls}, found ${found.length}`);
    return found[0] as FakeElement;
  }

  /** All text in this subtree, in document order. */
  allText(): string[] {
    return [this.text, ...this.children.flatMap((child) => child.allText())].filter(
      (t) => t !== '',
    );
  }
}

vi.mock('obsidian', () => ({
  ItemView: class {
    contentEl = new FakeElement('div');
    constructor(readonly leaf: unknown) {}
  },
}));
vi.mock('../../src/sprig/render-sprig.js', () => ({ renderSprig: () => new FakeElement('svg') }));
vi.mock('../../src/course-setup/register-source-modal.js', () => ({
  RegisterSourceFileModal: class {},
  RegisterSourceRoleModal: class {},
}));

const { GroveView } = await import('../../src/grove/view.js');
const COPY = await import('../../src/grove/copy.js');

const DOC = '03 Research/Objectives.md' as VaultPath;
const DECLARATION_1: ContainmentDeclaration = {
  kind: 'objectives',
  courseId: 'TESTC101',
  wordingKey: 'v1:one',
};
const DECLARATION_2: ContainmentDeclaration = {
  kind: 'objectives',
  courseId: 'TESTC101',
  wordingKey: 'v1:two',
};

function model(): Extract<GroveCourseModel, { readonly status: 'declared' }> {
  return {
    status: 'declared',
    course: 'TESTC101',
    cells: [
      {
        conceptKey: 'concept-key1:a',
        conceptName: 'Concept A',
        state: 'seed',
        stall: false,
        pastPaperCitationCount: 0,
      },
    ],
    materialGaps: [],
    volunteers: [{ conceptKey: 'concept-key1:c', conceptName: 'Concept C' }],
    summary: {
      builtCount: 1,
      denominatorCount: 1,
      denominatorSourcePaths: [DOC],
      pastPaperSourcePaths: [],
      readCompleteness: 'complete',
      pendingSections: [],
    },
    modelDecided: {
      count: 1,
      concepts: [
        {
          conceptKey: 'concept-key1:b',
          conceptName: 'Concept B',
          outcomeIds: ['outcome-key1:o1', 'outcome-key1:o2'],
          placements: [
            {
              outcomeId: 'outcome-key1:o1',
              conceptKey: 'concept-key1:b',
              wording: 'Describe how gear trains change speed',
              documentPath: DOC,
              declaration: DECLARATION_1,
            },
            {
              outcomeId: 'outcome-key1:o2',
              conceptKey: 'concept-key1:b',
              wording: 'Compare drive belts and chains',
              documentPath: DOC,
              declaration: DECLARATION_2,
            },
          ],
        },
      ],
      declined: [
        {
          outcomeId: 'outcome-key1:o1',
          conceptKey: 'concept-key1:d',
          conceptName: 'Concept D',
          wording: 'Describe how gear trains change speed',
          documentPath: DOC,
          declaration: DECLARATION_1,
        },
      ],
    },
  };
}

async function mount(declared = model()) {
  const takeOut = vi.fn(async () => undefined);
  const putBack = vi.fn(async () => undefined);
  const openLinkText = vi.fn(async () => undefined);
  const load = vi.fn(async () => ({
    kind: 'model' as const,
    courses: [
      {
        course: 'TESTC101',
        model: declared,
        offerCards: [],
        unreadableFiles: [],
        registerCandidates: [],
      },
    ],
    placementControl: { takeOut, putBack },
  }));
  const view = new GroveView({} as never, {
    load,
    openRetrospective: () => undefined,
    dismiss: async () => undefined,
    registerSource: async () => undefined,
    app: { workspace: { openLinkText } } as never,
  });
  await view.onOpen();
  const root = (view as unknown as { contentEl: FakeElement }).contentEl;
  return { root, load, takeOut, putBack, openLinkText };
}

/** Lets a click's `.then(() => this.refresh())` run. */
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

describe('[D-537] — the grove view renders Olea’s reading of the objectives, with her controls', () => {
  it('the section sits after the declared concepts and before "Also growing here", with S1’s heading, note and its own count', async () => {
    const { root } = await mount();
    const order = root.all();
    const grid = order.indexOf(root.one('olea-grove-concepts'));
    const section = order.indexOf(root.one('olea-grove-placements'));
    const volunteers = order.indexOf(root.one('olea-grove-volunteers'));
    expect(grid).toBeLessThan(section);
    expect(section).toBeLessThan(volunteers);
    expect(root.one('olea-grove-placements-heading').allText()).toEqual([
      "Olea's reading of this course's objectives",
      '1',
    ]);
    expect(root.one('olea-grove-placements-note').text).toBe(
      "The objectives don't name these concepts, but Olea reads each one as part of the objective shown under it. They aren't counted above.",
    );
    expect(COPY.GROVE_PLACEMENTS_HEADING).toBe("Olea's reading of this course's objectives");
  });

  it('each placed concept is listed once, with the wording of each objective it falls under, which opens the document', async () => {
    const { root, openLinkText } = await mount();
    const concepts = root.find('olea-grove-placement-concept');
    expect(concepts.map((c) => c.one('olea-grove-concept-name').text)).toEqual(['Concept B']);
    const wordings = concepts[0]?.find('olea-grove-placement-wording') ?? [];
    expect(wordings.map((w) => [w.tag, w.text])).toEqual([
      ['a', 'Describe how gear trains change speed'],
      ['a', 'Compare drive belts and chains'],
    ]);
    wordings[1]?.click();
    expect(openLinkText).toHaveBeenCalledWith(DOC, '', false);
  });

  it('one "Not part of this" per placement; choosing it calls her control for that placement and reads the grove again', async () => {
    const { root, load, takeOut } = await mount();
    const section = root.one('olea-grove-placements');
    const buttons = section.find('olea-grove-placement-take-out').filter((b) => b.tag === 'button');
    expect(buttons.map((b) => b.text)).toEqual(['Not part of this', 'Not part of this']);
    const loads = load.mock.calls.length;
    buttons[1]?.click();
    await settle();
    expect(takeOut).toHaveBeenCalledWith({
      declaration: DECLARATION_2,
      conceptKey: 'concept-key1:b',
    });
    expect(load.mock.calls.length).toBe(loads + 1);
  });

  it('the placements she took out are in a collapsed list with the put-back line, each with "Put back"', async () => {
    const { root, load, putBack } = await mount();
    const list = root.one('olea-grove-placements-taken-out');
    expect(list.tag).toBe('details');
    expect(list.attributes.has('open')).toBe(false);
    expect(list.one('olea-grove-placements-taken-out-line').tag).toBe('summary');
    expect(list.one('olea-grove-placements-taken-out-line').text).toBe(
      'You took these out. Olea keeps your choice when the document is edited, unless the objective itself is reworded.',
    );
    const row = list.one('olea-grove-placement-row');
    expect(row.allText()).toEqual([
      'Concept D',
      'Describe how gear trains change speed',
      'Put back',
    ]);
    const loads = load.mock.calls.length;
    row.one('olea-grove-placement-put-back').click();
    await settle();
    expect(putBack).toHaveBeenCalledWith({
      declaration: DECLARATION_1,
      conceptKey: 'concept-key1:d',
    });
    expect(load.mock.calls.length).toBe(loads + 1);
  });

  it('a failed choice still reads the grove again, so an unreadable history shows nothing for its pair', async () => {
    const { root, load, takeOut } = await mount();
    takeOut.mockRejectedValueOnce(new Error('unreadable'));
    const loads = load.mock.calls.length;
    root.find('olea-grove-placement-take-out')[0]?.click();
    await settle();
    expect(load.mock.calls.length).toBe(loads + 1);
  });

  it('only the placements she took out: the heading and the collapsed list, no note, no count, no placed concept', async () => {
    const declared = model();
    const { root } = await mount({
      ...declared,
      modelDecided: {
        count: 0,
        concepts: [],
        declined: declared.modelDecided?.declined ?? [],
      },
    });
    expect(root.one('olea-grove-placements-heading').allText()).toEqual([
      "Olea's reading of this course's objectives",
    ]);
    expect(root.find('olea-grove-placements-note')).toEqual([]);
    expect(root.find('olea-grove-placement-concept')).toEqual([]);
    expect(root.find('olea-grove-placements-taken-out')).toHaveLength(1);
  });

  it('nothing placed and nothing taken out, or no reading at all: no section', async () => {
    const declared = model();
    const empty = await mount({
      ...declared,
      modelDecided: { count: 0, concepts: [], declined: [] },
    });
    expect(empty.root.find('olea-grove-placements')).toEqual([]);
    const { modelDecided: _absent, ...today } = declared;
    const none = await mount(today);
    expect(none.root.find('olea-grove-placements')).toEqual([]);
  });

  it('every word the section shows is S1’s, C1’s or the put-back line', async () => {
    const { root } = await mount();
    const shown = new Set(root.one('olea-grove-placements').allText());
    const allowed = new Set([
      COPY.GROVE_PLACEMENTS_HEADING,
      COPY.GROVE_PLACEMENTS_NOTE,
      COPY.GROVE_PLACEMENT_TAKE_OUT_ACTION,
      COPY.GROVE_PLACEMENT_PUT_BACK_ACTION,
      COPY.GROVE_PLACEMENTS_TAKEN_OUT_LINE,
      // Data, not words: the count, concept names and the objectives' own wording.
      '1',
      'Concept B',
      'Concept D',
      'Describe how gear trains change speed',
      'Compare drive belts and chains',
    ]);
    expect([...shown].filter((text) => !allowed.has(text))).toEqual([]);
  });
});
