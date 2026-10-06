/**
 * `ol-egov.141.89.7.81` (`[D-538]`, F4.2, F4.10), mounted: the gap view, fed a model the core build
 * made from a ranking whose concepts rest on the course objectives alone or on an assessment
 * note's own scope alone, in the material-gap and coverage-gap classes, shows each row naming its
 * basis in the signed words, heads the material gaps with the bases actually present, and opens a
 * material gap's page on its header line. The production caller is `main.ts`'s `new GapView(leaf,
 * createLocalGapProvider(...))`; this mounts the same class with a stand-in `load`.
 *
 * `obsidian` cannot load under Vitest (its `main` is empty), so `ItemView` is stood in by a bare
 * base whose `contentEl` is the small fake element below: just the calls `view.ts` makes.
 * Scenarios: olea-service `features/F4-oracle.md`, tagged
 * `@auto:plugin/test/gap/view.row-basis.ol-egov.141.89.7.81.spec`.
 *
 * INV-3: every course code, concept name, path and sentence below is invented.
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
vi.mock('../../src/sprig/render-sprig.js', () => ({ renderSprig: () => new FakeElement('svg') }));

const { GapView } = await import('../../src/gap/view.js');

type ObjectivesCitation = NonNullable<ConceptPriority['factors']['objectivesCitations']>[number];
type AssessmentCitation = NonNullable<ConceptPriority['factors']['briefCitations']>[number];

const COURSE = 'TESTC101';
const OBJECTIVES = '03 Research/Objectives.md' as VaultPath;
const ESSAY = '02 Assignments/Essay 1.md' as VaultPath;

const objectivesCitation: ObjectivesCitation = {
  sourcePath: OBJECTIVES,
  provenance: { sourcePath: OBJECTIVES, location: { page: 1 } },
};
const briefCitation: AssessmentCitation = {
  sourcePath: ESSAY,
  provenance: { sourcePath: ESSAY, location: { page: 1 } },
};

function entry(
  conceptKey: string,
  rank: number,
  factors: Partial<ConceptPriority['factors']>,
): ConceptPriority {
  return {
    conceptName: conceptKey,
    conceptKey,
    course: COURSE,
    rank,
    priorityScore: 1 / rank,
    factors: {
      citations: [],
      distinctSourceCount: 0,
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
      masteryState: 'sprout',
      masteryNeedWeight: 1,
      priorityScore: 1 / rank,
      ...factors,
    },
    citations: [],
    reasoning: 'Invented.',
  };
}

const OBJECTIVES_ONLY = {
  objectivesCitations: [objectivesCitation],
  distinctObjectivesSourceCount: 1,
};
const ASSESSMENT_ONLY = { briefCitations: [briefCitation] };

function model() {
  const ranking: RankOracleResult = {
    courses: [
      {
        course: COURSE,
        status: 'ranked',
        ranked: [
          entry('Material by objectives', 1, OBJECTIVES_ONLY),
          entry('Material by assessment', 2, ASSESSMENT_ONLY),
          entry('Coverage by objectives', 3, OBJECTIVES_ONLY),
          entry('Coverage by assessment', 4, ASSESSMENT_ONLY),
        ],
      },
    ],
    unattributableAssessments: [],
    asOf: '2026-08-16',
  };
  // Notes but no cards: the coverage-gap class. Absent from the map: the material-gap class.
  const notes: ConceptMaterialPresence = {
    notePaths: ['05 Zettelkasten/Invented.md' as VaultPath],
    instrumentCount: 0,
  };
  return buildGapView({
    ranking,
    assessments: [],
    materialPresence: new Map([
      ['Coverage by objectives', notes],
      ['Coverage by assessment', notes],
    ]),
    sourceCoverage: [],
  });
}

async function mount() {
  const view = new GapView({} as never, {
    load: async () => ({ kind: 'model' as const, model: model() }),
  });
  await view.onOpen();
  return (view as unknown as { contentEl: FakeElement }).contentEl;
}

function lineOf(root: FakeElement, conceptName: string): string {
  const row = root
    .find('olea-gap-row')
    .find((el) => el.find('olea-gap-concept').some((c) => c.text === conceptName));
  if (row === undefined) throw new Error(`expected a row for ${conceptName}`);
  const line = row.find('olea-gap-line')[0];
  if (line === undefined) throw new Error(`expected a line for ${conceptName}`);
  return line.text;
}

describe('the gap view shows objectives-only and assessment-only rows naming their basis ([D-538])', () => {
  it('each row line names its basis in the signed words', async () => {
    const root = await mount();
    expect(lineOf(root, 'Material by objectives')).toBe(
      "Its course objectives name it; Olea hasn't found supporting material for it.",
    );
    expect(lineOf(root, 'Material by assessment')).toBe(
      "Its assessments point to it; Olea hasn't found supporting material for it.",
    );
    expect(lineOf(root, 'Coverage by objectives')).toBe(
      'Its course objectives name it; you have notes on it but no cards yet.',
    );
    expect(lineOf(root, 'Coverage by assessment')).toBe(
      'Its assessments point to it; you have notes on it but no cards yet.',
    );
  });

  it('the material-gap heading names the bases present, and not past papers', async () => {
    const root = await mount();
    const headings = root.find('olea-gap-heading').map((el) => el.text);
    expect(headings).toContain(
      'Named by your course objectives, pointed to by your assessments, supporting material not found',
    );
    expect(headings.join(' ')).not.toMatch(/past papers|missing from/);
  });

  it('no row, heading or count says "brief", an absence, or a past-paper count', async () => {
    const root = await mount();
    // The course framing above the rows is not in this ruling's reach: its "assessment briefs"
    // sentence awaits its own copy pass (reported on the bead's hand-back).
    const text = ['olea-gap-line', 'olea-gap-heading', 'olea-gap-counterweight-breakdown'].flatMap(
      (cls) => root.find(cls).map((el) => el.text),
    );
    expect(text.length).toBeGreaterThan(5);
    for (const line of text) {
      expect(line).not.toMatch(/\bbrief\b/i);
      expect(line).not.toMatch(/isn't in your materials|not in your materials|missing from/i);
      expect(line).not.toMatch(/(Appears|Asked) in \d+ past paper/);
    }
    expect(root.find('olea-gap-counterweight-breakdown').map((el) => el.text)).toEqual([
      '2 with nothing built · 2 with no supporting material found',
    ]);
  });

  it('opening the objectives-only material gap shows its basis on the header line', async () => {
    const root = await mount();
    const header = root
      .find('olea-gap-row-header-open')
      .find((el) => el.find('olea-gap-concept').some((c) => c.text === 'Material by objectives'));
    if (header === undefined) throw new Error('expected an openable header');
    header.click();
    expect(root.find('olea-gap-detail-meta').map((el) => el.text)).toEqual([
      'Named by your course objectives · supporting material not found',
    ]);
    expect(root.find('olea-gap-detail-narrative-line').map((el) => el.text)).toEqual([
      "Its course objectives name it; Olea hasn't found supporting material for it.",
      'So Olea has nothing to build practice from yet — this says nothing about what you know.',
    ]);
  });
});
