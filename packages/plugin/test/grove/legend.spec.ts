/**
 * The grove legend's stage meanings (`[D-631]`, F8.1's legend paragraph, `ol-egov.141.89.6.144`): each
 * meaning reachable by hover, keyboard focus and tap, the top stage's v0.9 qualification visible with
 * no interaction, and every meaning the stage table's own. Scenarios: olea-service
 * `features/F2-review.md`, tagged `@auto:plugin/grove/legend.spec`.
 *
 * `obsidian` cannot load under Vitest, so `ItemView` is stood in by a bare base with a small fake
 * element (as `view.placements.ol-egov.141.89.7.77.spec.ts` does). Hover and focus are CSS rules, so
 * they are checked against `styles.css`; tap is the click handler, exercised on the fake.
 *
 * INV-3: nothing here is her content.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { MASTERY_DISPLAY } from 'olea-core';
import { describe, expect, it, vi } from 'vitest';

class FakeElement {
  readonly children: FakeElement[] = [];
  readonly attributes = new Map<string, string>();
  readonly listeners = new Map<string, (() => void)[]>();
  classes: string[] = [];
  text = '';

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

  toggleClass(cls: string, on: boolean): void {
    this.classes = this.classes.filter((c) => c !== cls);
    if (on) this.classes.push(cls);
  }

  setAttribute(name: string, value: string): void {
    this.attributes.set(name, value);
  }

  addEventListener(type: string, listener: () => void): void {
    this.listeners.set(type, [...(this.listeners.get(type) ?? []), listener]);
  }

  click(): void {
    for (const listener of this.listeners.get('click') ?? []) listener();
  }

  all(): FakeElement[] {
    return this.children.flatMap((child) => [child, ...child.all()]);
  }

  find(cls: string): FakeElement[] {
    return this.all().filter((el) => el.classes.includes(cls));
  }

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

const STAGES = ['seed', 'sprout', 'sapling', 'tree'] as const;

async function mount() {
  const view = new GroveView(
    {} as never,
    {
      load: async () => ({
        kind: 'model' as const,
        courses: [
          {
            course: 'TESTC101',
            model: {
              status: 'declared' as const,
              course: 'TESTC101',
              cells: [
                {
                  conceptKey: 'concept-key1:a',
                  conceptName: 'Concept A',
                  state: 'seed' as const,
                  stall: false,
                  pastPaperCitationCount: 0,
                },
              ],
              materialGaps: [],
              volunteers: [],
              summary: {
                builtCount: 1,
                denominatorCount: 1,
                denominatorSourcePaths: [],
                pastPaperSourcePaths: [],
                readCompleteness: 'complete',
                pendingSections: [],
              },
            },
            offerCards: [],
            unreadableFiles: [],
            registerCandidates: [],
          },
        ],
      }),
      openRetrospective: () => undefined,
      dismiss: async () => undefined,
      registerSource: async () => undefined,
      app: { workspace: { openLinkText: async () => undefined } } as never,
    } as never,
  );
  await view.onOpen();
  const root = (view as unknown as { contentEl: FakeElement }).contentEl;
  const legend = root.find('olea-grove-legend')[0] as FakeElement;
  return { root, legend };
}

const css = readFileSync(fileURLToPath(new URL('../../styles.css', import.meta.url)), 'utf8');

describe('the grove legend carries the stage meanings ([D-631])', () => {
  it('each stage has a focusable control and a meaning that is the stage table’s, character for character', async () => {
    const { legend } = await mount();
    const items = legend.find('olea-grove-legend-stage');
    expect(items).toHaveLength(4);
    items.forEach((item, i) => {
      const stage = STAGES[i] as (typeof STAGES)[number];
      const trigger = item.find('olea-grove-legend-stage-trigger')[0] as FakeElement;
      const meaning = item.find('olea-grove-legend-meaning')[0] as FakeElement;
      expect(trigger.tag).toBe('button'); // focusable and operable by keyboard, with no extra wiring
      expect(trigger.allText()).toEqual([MASTERY_DISPLAY[stage].label]);
      expect(meaning.text).toBe(MASTERY_DISPLAY[stage].meaning);
      expect(trigger.attributes.get('aria-describedby')).toBe(meaning.attributes.get('id'));
    });
    expect(COPY.groveStageMeaning('tree')).toBe(MASTERY_DISPLAY.tree.meaning);
  });

  it('by hover and by keyboard focus: the stylesheet shows the meaning on :hover and on the control’s :focus-visible, and hides it otherwise', () => {
    expect(css).toMatch(/\.olea-grove-legend-meaning\s*\{[^}]*display:\s*none/);
    expect(css).toMatch(/\.olea-grove-legend-stage:hover\s+\.olea-grove-legend-meaning/);
    expect(css).toMatch(
      /\.olea-grove-legend-stage-trigger:focus-visible\)\s*\.olea-grove-legend-meaning/,
    );
  });

  it('by tap: a tap opens the meaning, a second tap closes it, with aria-expanded following', async () => {
    const { legend } = await mount();
    const item = legend.find('olea-grove-legend-stage')[3] as FakeElement;
    const trigger = item.find('olea-grove-legend-stage-trigger')[0] as FakeElement;
    expect(item.classes).not.toContain('is-open');
    expect(trigger.attributes.get('aria-expanded')).toBe('false');
    trigger.click();
    expect(item.classes).toContain('is-open');
    expect(trigger.attributes.get('aria-expanded')).toBe('true');
    trigger.click();
    expect(item.classes).not.toContain('is-open');
    expect(trigger.attributes.get('aria-expanded')).toBe('false');
    expect(css).toMatch(/\.olea-grove-legend-stage\.is-open\s+\.olea-grove-legend-meaning/);
  });

  it('with no interaction, the legend itself shows "Explanation checking isn’t available yet", read from the stage table', async () => {
    const { legend } = await mount();
    const [line] = legend.find('olea-grove-legend-qualification');
    expect(line?.text).toBe("Explanation checking isn't available yet.");
    expect(MASTERY_DISPLAY.tree.meaning.endsWith(line?.text ?? '?')).toBe(true);
    expect(COPY.groveTreeQualification()).toBe(line?.text);
    // Not hidden by the stylesheet: the qualification has no display:none rule, unlike the meanings.
    expect(css).not.toMatch(/\.olea-grove-legend-qualification\s*\{[^}]*display:\s*none/);
  });
});
