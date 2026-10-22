/**
 * `ol-egov.141.89.7.107` (F4.3, moment E's gap-view claim): no row for a concept with no current
 * successful evidence is DRAWN as ready or covered. The copy is pinned elsewhere; this pins the
 * drawing. Rows go through the real `GapView` and its `renderRow` / `renderMasteryMark`, built by
 * core's real `buildGapView`; only `obsidian` (empty under Vitest) and `renderSprig` are stood in,
 * and the `renderSprig` stub RECORDS the state it was asked to draw and returns a marked element,
 * so a drawn sprig stays visible to the assertions.
 *
 * INV-3: every course code, concept name and path below is invented.
 */

import {
  buildGapView,
  type ConceptMaterialPresence,
  type ConceptPriority,
  type RankOracleResult,
  type VaultPath,
} from 'olea-core';
import { describe, expect, it, vi } from 'vitest';

class FakeElement {
  readonly children: FakeElement[] = [];
  readonly attributes = new Map<string, string>();
  readonly listeners = new Map<string, ((event: { preventDefault(): void }) => void)[]>();
  classes: string[] = [];
  text = '';
  tabIndex = -1;

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

  setText(text: string): void {
    this.text = text;
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

const sprigCalls: string[] = [];
vi.mock('../../src/sprig/render-sprig.js', () => ({
  renderSprig: (opts: { state: string }) => {
    sprigCalls.push(opts.state);
    const el = new FakeElement('svg');
    el.classes = ['olea-sprig-stub'];
    el.setAttribute('data-sprig-state', opts.state);
    return el;
  },
}));

const { GapView } = await import('../../src/gap/view.js');

const COURSE = 'TESTC101';
const ESSAY = '02 Assignments/Essay 1.md' as VaultPath;
const UNKNOWN_ROW = 'Unknown concept';
const SEED_ROW = 'Never practised concept';
const MATERIAL_ROW = 'No material concept';

function entry(conceptKey: string, rank: number, masteryState: string): ConceptPriority {
  return {
    conceptName: conceptKey,
    conceptKey,
    course: COURSE,
    rank,
    priorityScore: 1 / rank,
    factors: {
      citations: [],
      distinctSourceCount: 1,
      contributions: [
        {
          assessmentPath: ESSAY,
          yieldRank: 1,
          yieldScore: 1,
          confidence: 1,
          assessmentWeightKnown: true,
          assessmentWeightScore: 1,
          daysUntilDue: 10,
          examProximityScore: 1,
          evidenceStrength: 1,
          contribution: 1 / rank,
        },
      ],
      preMasteryScore: 1 / rank,
      masteryState,
      masteryNeedWeight: 1,
      priorityScore: 1 / rank,
    },
    citations: [],
    reasoning: 'Invented.',
  } as unknown as ConceptPriority;
}

function model() {
  const ranking: RankOracleResult = {
    courses: [
      {
        course: COURSE,
        status: 'ranked',
        ranked: [
          entry(UNKNOWN_ROW, 1, 'unknown'),
          entry(SEED_ROW, 2, 'seed'),
          entry(MATERIAL_ROW, 3, 'unknown'),
        ],
      },
    ],
    unattributableAssessments: [],
    asOf: '2026-08-16',
  };
  // Cards exist: the mastery-gap class. Absent from the map: the material-gap class.
  const cards: ConceptMaterialPresence = {
    notePaths: ['05 Zettelkasten/Invented.md' as VaultPath],
    instrumentCount: 3,
  };
  return buildGapView({
    ranking,
    assessments: [],
    materialPresence: new Map([
      [UNKNOWN_ROW, cards],
      [SEED_ROW, cards],
    ]),
    sourceCoverage: [],
    need: new Map([[UNKNOWN_ROW, { basis: 'unknown', value: 1, readiness: {} } as never]]),
  });
}

async function mount() {
  sprigCalls.length = 0;
  const view = new GapView({} as never, {
    load: async () => ({ kind: 'model' as const, model: model() }),
  });
  await view.onOpen();
  return (view as unknown as { contentEl: FakeElement }).contentEl;
}

function rowOf(root: FakeElement, conceptName: string): FakeElement {
  const row = root
    .find('olea-gap-row')
    .find((el) => el.find('olea-gap-concept').some((c) => c.text === conceptName));
  if (row === undefined) throw new Error(`expected a drawn row for ${conceptName}`);
  return row;
}

const FORBIDDEN = [
  'ready',
  'readiness',
  'met',
  'covered',
  'done',
  'complete',
  'completed',
  'percent',
  'progress',
  'bar',
  'check',
  'checked',
  'checkmark',
];
const FORBIDDEN_GLYPHS = ['%', '\u2713', '\u2714', '\u2705', '\u2611'];

/** Every forbidden hit in a drawn subtree: class names, text, and element tags. */
function forbiddenHits(root: FakeElement): string[] {
  const hits: string[] = [];
  for (const el of [root, ...root.all()]) {
    const words = [...el.classes, el.text, el.tag]
      .join(' ')
      .toLowerCase()
      .split(/[^a-z]+/)
      .filter((w) => w !== '');
    for (const w of words) if (FORBIDDEN.includes(w)) hits.push(w);
    if (el.tag === 'meter') hits.push(el.tag);
    for (const g of FORBIDDEN_GLYPHS) if (el.text.includes(g)) hits.push(g);
  }
  return hits;
}

function markOf(row: FakeElement): FakeElement {
  const mark = row.find('olea-gap-mastery')[0];
  if (mark === undefined) throw new Error('expected a mastery mark');
  return mark;
}

describe('a gap row with no current successful evidence is never drawn as ready or covered', () => {
  it('draws a row whose need basis and mastery are unknown as the word "unknown" and no sprig', async () => {
    const root = await mount();
    const row = rowOf(root, UNKNOWN_ROW);
    expect(row.classes).toContain('olea-gap-row-mastery-gap');
    const mark = markOf(row);
    expect(mark.allText()).toEqual(['unknown']);
    expect(mark.all().filter((el) => el.tag === 'svg')).toEqual([]);
    expect(sprigCalls).not.toContain('unknown');
    expect(forbiddenHits(row)).toEqual([]);
  });

  it('draws a never-practised concept as the seed sprig and the word "seed", never a later stage', async () => {
    const root = await mount();
    const row = rowOf(root, SEED_ROW);
    expect(row.classes).toContain('olea-gap-row-mastery-gap');
    const mark = markOf(row);
    const sprigs = mark.all().filter((el) => el.classes.includes('olea-sprig-stub'));
    expect(sprigs.map((s) => s.attributes.get('data-sprig-state'))).toEqual(['seed']);
    expect(mark.allText()).toEqual(['seed']);
    expect(sprigCalls).toEqual(['seed']);
    for (const later of ['sprout', 'sapling', 'tree']) {
      expect(sprigCalls).not.toContain(later);
      expect(mark.allText()).not.toContain(later);
    }
    expect(forbiddenHits(row)).toEqual([]);
  });

  it('draws a material-gap row with the "no stage" mark and no sprig', async () => {
    const root = await mount();
    const row = rowOf(root, MATERIAL_ROW);
    expect(row.classes).toContain('olea-gap-row-material-gap');
    const mark = markOf(row);
    expect(mark.classes).toContain('olea-gap-nostage');
    expect(mark.allText()).toEqual(['no stage']);
    expect(mark.all().filter((el) => el.classes.includes('olea-sprig-stub'))).toEqual([]);
    expect(forbiddenHits(row)).toEqual([]);
  });

  it('lists all three rows in the rendered list, none dropped', async () => {
    const root = await mount();
    const names = root
      .find('olea-gap-row')
      .flatMap((r) => r.find('olea-gap-concept').map((c) => c.text));
    expect(names).toEqual(expect.arrayContaining([UNKNOWN_ROW, SEED_ROW, MATERIAL_ROW]));
    expect(root.find('olea-gap-row')).toHaveLength(3);
  });

  it('the forbidden-word scan can fail: a planted class or text is caught', () => {
    const planted = new FakeElement('div');
    planted.createSpan({ cls: 'olea-gap-row-covered', text: 'fine' });
    expect(forbiddenHits(planted)).toEqual(['covered']);
    const text = new FakeElement('div');
    text.createSpan({ text: 'You are Ready for this' });
    expect(forbiddenHits(text)).toEqual(['ready']);
    const glyph = new FakeElement('div');
    glyph.createSpan({ text: '80%' });
    expect(forbiddenHits(glyph)).toEqual(['%']);
    const tag = new FakeElement('div');
    tag.createEl('progress');
    expect(forbiddenHits(tag)).toEqual(['progress']);
  });
});
