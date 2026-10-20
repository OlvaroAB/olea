/**
 * `ol-egov.141.89.104.56` (`[D-539]`, F4.3): the gap view never lists a concept whose readings
 * would read evidence whose hold check could not be made, as a gap or as a weakness, and adds no
 * words for it. Scenario: olea-service `features/F4-oracle.md`, "a reading that would read evidence
 * whose hold check could not be made is unavailable, never weak and never a gap", tagged
 * `@auto:plugin/gap/hold-unavailable.ol-egov.141.89.104.56.spec`.
 *
 * The provider half runs `createLocalGapProvider` over a memory vault with a stand-in for the hold
 * reader (`readHoldEvidenceUnknown`; no production caller exists until the hold store's location
 * is ruled, `ol-egov.141.89.104.6`). The view half mounts `GapView` over a stand-in `load`, as
 * `view.row-basis.ol-egov.141.89.7.81.spec.ts` does: `obsidian` cannot load under Vitest.
 *
 * INV-3: every course code, concept name, path and id below is invented.
 */

import type { ReviewLogEntry } from 'olea-contracts';
import {
  appendSuccessionRecord,
  buildGapView,
  type ConceptMaterialPresence,
  type ConceptPriority,
  createFsrsScheduler,
  enumerateVaultInstruments,
  extractConcepts,
  questionBindingOf,
  type RankOracleResult,
  type RetrievabilityInput,
  readNeed,
  type Scheduler,
  type VaultInstrumentRecord,
  type VaultPath,
  writeInstrumentTarget,
} from 'olea-core';
import { describe, expect, it, vi } from 'vitest';
import { createLocalGapProvider } from '../../src/gap/provider.js';
import { listedGapRows } from '../../src/gap/readings-unavailable.js';
import type { GapViewState } from '../../src/gap/view.js';
import {
  type CitationHashStore,
  ObsidianCitationHashStore,
} from '../../src/ingestion/materiality/citation-hash-store.js';
import type { ObsidianDataHost } from '../../src/plan/settings-store.js';
import { STUDY_PLAN_SETTINGS_STORAGE_KEY } from '../../src/plan/settings-store.js';
import { memoryVault } from '../review/memory-vault.js';

// ---------------------------------------------------------------------------
// The provider
// ---------------------------------------------------------------------------

const DEVICE = 'olea-testdevice1';
const BASE_PATH = '02 Assignments/Assignments.base';
const NOW = () => new Date('2026-08-10T09:00:00-04:00');
const LOG = '.olea/reviews/2026-08-09.olea-testdevice1.jsonl';

class JsonDataHost implements ObsidianDataHost {
  constructor(public json = 'null') {}
  async loadData(): Promise<unknown> {
    return JSON.parse(this.json);
  }
  async saveData(data: unknown): Promise<void> {
    this.json = JSON.stringify(data);
  }
}

function settingsHost(): JsonDataHost {
  return new JsonDataHost(
    JSON.stringify({
      [STUDY_PLAN_SETTINGS_STORAGE_KEY]: { version: 1, assignmentsBasePath: BASE_PATH },
    }),
  );
}

/** FSRS for scheduling; every recall estimate fixed, so the recognition credit's answer is current. */
function fixedScheduler(recallProbability: number): Scheduler {
  const real = createFsrsScheduler();
  return {
    schedule: (input) => real.schedule(input),
    retrievability: (input: RetrievabilityInput) => ({
      instrumentId: input.instrumentId,
      recallProbability,
    }),
  };
}

const BASE_FILE = [
  'filters:',
  '  and:',
  '    - file.inFolder("02 Assignments")',
  '    - file.ext == "md"',
  'properties:',
  '  class:',
  '  type:',
  '  weight:',
  '  due:',
  '  status:',
].join('\n');

/** One course, one concept named by a past paper, its notes holding the cards given. */
function world(cards: readonly string[] = ['Front::Back']) {
  return memoryVault({
    '05 Zettelkasten/Widget theory.md': '# Widget theory\n',
    ...Object.fromEntries(
      cards.map((card, index) => [
        `Notes/card ${index + 1}.md`,
        ['---', 'topic: [Widget theory]', 'course: TESTC101', '---', '', card, ''].join('\n'),
      ]),
    ),
    '03 Research/TESTC101 Past Paper 2023.md': [
      '---',
      'role: past-paper',
      'course: TESTC101',
      '---',
      '',
      '# TESTC101 Past Paper — 2023',
      '',
      '## Question 1 (10 marks)',
      '',
      'Explain the core mechanism behind Widget theory and why it matters.',
      '',
    ].join('\n'),
    [BASE_PATH]: BASE_FILE,
    '02 Assignments/Quiz 1.md':
      '---\nclass: TESTC101\ntype: Quiz\nweight: 10\ndue: 2026-09-01\nstatus: upcoming\n---\n\n# Quiz 1\n',
  });
}

function reviewLine(
  conceptKey: string,
  instrumentId: string,
  instrumentType: 'mcq' | 'qa',
  eventId: string,
  extra: Record<string, unknown> = {},
): string {
  return `${JSON.stringify({
    schemaVersion: 6,
    kind: 'review',
    eventId,
    timestamp: '2026-08-09T09:00:00-04:00',
    instrumentId,
    instrumentType,
    conceptIds: [conceptKey],
    rating: 'good',
    supportLevelShown: 'independent',
    wasUnsure: false,
    durationMs: 1200,
    selectionContext: {
      dueState: 'due',
      examProximity: null,
      yieldRank: null,
      instrumentTypesOffered: [instrumentType],
      planVersion: null,
    },
    ...extra,
  })}\n`;
}

async function conceptKeyOf(vault: ReturnType<typeof world>): Promise<string> {
  const key = (await extractConcepts(vault, { stampConceptKeys: true })).find(
    (concept) => concept.name === 'Widget theory',
  )?.key;
  if (key === undefined) throw new Error('fixture vault has no Widget theory concept');
  return key;
}

const CARD = 'qa:widget-theory:1';
const QUIZ_ITEM = 'mcq:widget-theory:1';

type Deps = Parameters<typeof createLocalGapProvider>[0];

async function load(vault: ReturnType<typeof world>, extra: Partial<Deps> = {}) {
  return createLocalGapProvider({
    vault,
    deviceId: DEVICE,
    settingsHost: settingsHost(),
    now: NOW,
    scheduler: fixedScheduler(0.95),
    ...extra,
  }).load();
}

type Loaded = Awaited<ReturnType<typeof load>>;

function widgetCourse(state: Loaded) {
  if (state.kind !== 'model') throw new Error('expected a model');
  const course = state.model.courses.find((c) => c.course === 'TESTC101');
  if (course?.status !== 'ranked') throw new Error('expected TESTC101 to rank');
  return course;
}

function widgetRow(state: Loaded) {
  const row = widgetCourse(state).rows.find((r) => r.conceptName === 'Widget theory');
  if (row === undefined) throw new Error('expected the Widget theory row in the model');
  return row;
}

function listed(state: Loaded): readonly string[] {
  if (state.kind !== 'model') throw new Error('expected a model');
  return listedGapRows(widgetCourse(state).rows, state.readingsUnavailable).map(
    (row) => row.conceptName,
  );
}

const unknownOf =
  (...ids: string[]): NonNullable<Deps['readHoldEvidenceUnknown']> =>
  async () =>
    new Set(ids);

describe('the gap provider sets aside a concept whose readings would read unknown evidence ([D-539])', () => {
  it('an unaided recall success whose hold check could not be made: the concept is named unavailable and not listed', async () => {
    const vault = world();
    const key = await conceptKeyOf(vault);
    await vault.write(LOG, reviewLine(key, CARD, 'qa', 'r1'));

    const before = await load(vault);
    expect(listed(before)).toEqual(['Widget theory']);
    expect(widgetRow(before).need?.basis).toBe('estimated');

    const state = await load(vault, { readHoldEvidenceUnknown: unknownOf(CARD) });
    if (state.kind !== 'model') throw new Error('expected a model');
    expect(state.readingsUnavailable).toEqual({ conceptKeys: [key] });
    expect(listed(state)).toEqual([]);
    // The row stays in the model, so the counts the view states are unchanged.
    expect(widgetCourse(state).rows.map((row) => row.conceptKey)).toEqual(
      widgetCourse(before).rows.map((row) => row.conceptKey),
    );
  });

  it('a correct, current quiz answer whose hold check could not be made sets the concept aside too: the credit is unavailable, never withheld', async () => {
    const vault = world();
    const key = await conceptKeyOf(vault);
    await vault.write(LOG, reviewLine(key, QUIZ_ITEM, 'mcq', 'm1'));
    const state = await load(vault, { readHoldEvidenceUnknown: unknownOf(QUIZ_ITEM) });
    if (state.kind !== 'model') throw new Error('expected a model');
    expect(state.readingsUnavailable?.conceptKeys).toEqual([key]);
    expect(listed(state)).toEqual([]);
  });

  it('the hold reader is handed the instruments this load enumerated and the review log it read', async () => {
    const vault = world();
    const key = await conceptKeyOf(vault);
    await vault.write(LOG, reviewLine(key, CARD, 'qa', 'r1'));
    const reader = vi.fn<NonNullable<Deps['readHoldEvidenceUnknown']>>(async () => new Set());
    await load(vault, { readHoldEvidenceUnknown: reader });
    expect(reader).toHaveBeenCalledTimes(1);
    const scope = reader.mock.calls[0]?.[0];
    const enumerated = (
      await enumerateVaultInstruments(vault, { concepts: { stampConceptKeys: true } })
    ).records;
    expect(scope?.records.map((r: VaultInstrumentRecord) => r.instrumentId)).toEqual(
      enumerated.map((r) => r.instrumentId),
    );
    expect(
      scope?.entries.filter((e: ReviewLogEntry) => e.kind === 'review').map((e) => e.eventId),
    ).toEqual(['r1']);
  });

  it('nothing unknown, or unknown evidence no reading reads, leaves the state exactly as without the reader', async () => {
    const vault = world();
    const key = await conceptKeyOf(vault);
    await vault.write(LOG, reviewLine(key, CARD, 'qa', 'r1'));
    const without = await load(vault);
    expect(await load(vault, { readHoldEvidenceUnknown: unknownOf() })).toEqual(without);
    expect(
      await load(vault, { readHoldEvidenceUnknown: unknownOf('qa:nothing-reviewed-it:1') }),
    ).toEqual(without);
  });

  it('evidence excluded on purpose (a changed passage not yet revalidated) stays excluded whatever its hold check says, and sets nothing aside', async () => {
    const vault = world();
    const key = await conceptKeyOf(vault);
    await vault.write(LOG, reviewLine(key, CARD, 'qa', 'r1'));
    const store: CitationHashStore = new ObsidianCitationHashStore(new JsonDataHost());
    await store.save(CARD, {
      sourcePath: 'Notes/card 1.md' as VaultPath,
      text: 'Front::Back',
      conceptIds: [key],
    });
    await store.setPendingRevalidation(
      CARD,
      'sha-of-the-edited-passage',
      Date.parse('2026-08-09T12:00:00-04:00'),
    );
    const excludedOnly = await load(vault, { citationHashStore: store });
    expect(widgetRow(excludedOnly).need?.basis).toBe('unknown');
    const both = await load(vault, {
      citationHashStore: store,
      readHoldEvidenceUnknown: unknownOf(CARD),
    });
    expect(both).toEqual(excludedOnly);
    expect(listed(both)).toEqual(['Widget theory']);
  });

  it('a hold reader that throws fails the load into the existing unavailable state, never a reading over the rest', async () => {
    const vault = world();
    const key = await conceptKeyOf(vault);
    await vault.write(LOG, reviewLine(key, CARD, 'qa', 'r1'));
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const state = await load(vault, {
      readHoldEvidenceUnknown: async () => {
        throw new Error('unreadable');
      },
    });
    error.mockRestore();
    expect(state).toEqual({ kind: 'unavailable' });
  });

  it('the demand rule: a predecessor readiness leaves out (J3) but the demand rule reads sets the concept aside once its demands are read', async () => {
    const vault = world(['Front::Back', 'Second front::Second back']);
    const records = (
      await enumerateVaultInstruments(vault, { concepts: { stampConceptKeys: true } })
    ).records;
    const [older, newer] = records;
    if (older?.instrumentType !== 'qa' || newer?.instrumentType !== 'qa') {
      throw new Error('fixture vault has no two cards');
    }
    const key = older.conceptIds[0];
    if (key === undefined) throw new Error('fixture card names no concept');
    await vault.write(
      LOG,
      reviewLine(key, older.instrumentId, 'qa', 'r1') +
        // A lightly assisted success on the successor: it carries the predecessor's freshness (J3)
        // but is not an unaided success, so readiness reads neither card.
        reviewLine(key, newer.instrumentId, 'qa', 's1', {
          timestamp: '2026-08-09T11:00:00-04:00',
          supportLevelShown: 'prompted',
          hintOpened: false,
        }),
    );
    await appendSuccessionRecord(
      vault,
      {
        timestamp: '2026-08-09T10:00:00-04:00',
        predecessorInstrumentId: older.instrumentId,
        successorInstrumentId: newer.instrumentId,
      },
      { deviceId: DEVICE },
    );
    await writeInstrumentTarget(vault, {
      instrumentId: older.instrumentId,
      declaredDemand: 'recall-a-fact',
      origin: 'heading-cue',
      questionBinding: await questionBindingOf(older.card),
      authoredAt: '2026-08-01T10:00:00.000Z',
      generator: { taskId: 'cards.generate.v1', promptVersion: '1.8.0' },
    });
    const readDeclaredDemands = async () => new Map([[key, ['recall-a-fact'] as const]]);

    // The fixture's own check: the predecessor is carried, so readiness reads nothing.
    const control = await load(vault, { readDeclaredDemands });
    expect(widgetRow(control).need?.basis).toBe('unknown');
    expect(widgetRow(control).unmetDemands).toEqual([]);

    // Readiness and the credit read neither card, so without demands nothing is set aside...
    const noDemands = await load(vault, {
      readHoldEvidenceUnknown: unknownOf(older.instrumentId),
    });
    if (noDemands.kind !== 'model') throw new Error('expected a model');
    expect(noDemands.readingsUnavailable).toBeUndefined();

    // ...but the demand rule reads the predecessor's success, so its answer cannot be given.
    const state = await load(vault, {
      readDeclaredDemands,
      readHoldEvidenceUnknown: unknownOf(older.instrumentId),
    });
    if (state.kind !== 'model') throw new Error('expected a model');
    expect(state.readingsUnavailable?.conceptKeys).toEqual([key]);
    expect(widgetRow(state)).not.toHaveProperty('unmetDemands');
    expect(listed(state)).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// The view
// ---------------------------------------------------------------------------

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
type ViewState = GapViewState;

const COURSE = 'TESTC101';
const PAPER = '03 Research/TESTC101 Past Paper 2023.md' as VaultPath;

function entry(conceptKey: string, rank: number): ConceptPriority {
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
          assessmentPath: PAPER,
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
    },
    citations: [],
    reasoning: 'Invented.',
  };
}

/** Two mastery-gap concepts, the first ranked higher, each with estimated need. */
function model() {
  const ranking: RankOracleResult = {
    courses: [
      {
        course: COURSE,
        status: 'ranked',
        ranked: [entry('Concept set aside', 1), entry('Concept kept', 2)],
      },
    ],
    unattributableAssessments: [],
    asOf: '2026-08-16',
  };
  const built: ConceptMaterialPresence = {
    notePaths: ['05 Zettelkasten/Invented.md' as VaultPath],
    instrumentCount: 2,
  };
  const estimated = readNeed({
    weakest: { instrumentId: 'qa:invented:1', recallProbability: 0.4 },
    instrumentsRead: 1,
  });
  return buildGapView({
    ranking,
    assessments: [],
    materialPresence: new Map([
      ['Concept set aside', built],
      ['Concept kept', built],
    ]),
    need: new Map([
      ['Concept set aside', estimated],
      ['Concept kept', estimated],
    ]),
    currentRecognition: new Map(),
    sourceCoverage: [],
  });
}

async function mount(states: ViewState[]) {
  let call = 0;
  const view = new GapView({} as never, {
    load: async () => states[Math.min(call++, states.length - 1)] as ViewState,
  });
  await view.onOpen();
  return { view, root: (view as unknown as { contentEl: FakeElement }).contentEl };
}

const FULL: ViewState = { kind: 'model', model: model() };
const SET_ASIDE: ViewState = {
  kind: 'model',
  model: model(),
  readingsUnavailable: { conceptKeys: ['Concept set aside'] },
};

function conceptsListed(root: FakeElement): string[] {
  return root.find('olea-gap-concept').map((el) => el.text);
}

describe('the gap view lists nothing for a concept whose readings are unavailable, and adds no words ([D-539])', () => {
  it('the set-aside concept is not listed; the row left takes its place in the list', async () => {
    const { root } = await mount([SET_ASIDE]);
    expect(conceptsListed(root)).toEqual(['Concept kept']);
    expect(root.find('olea-gap-rank').map((el) => el.text)).toEqual(['1']);
    const full = (await mount([FULL])).root;
    expect(conceptsListed(full)).toEqual(['Concept set aside', 'Concept kept']);
  });

  it('every word on the page is one the full page already shows, and the counts it states are unchanged', async () => {
    const { root } = await mount([SET_ASIDE]);
    const full = (await mount([FULL])).root;
    const fullText = new Set(full.allText());
    for (const text of root.allText()) expect(fullText).toContain(text);
    for (const cls of [
      'olea-gap-counterweight-text',
      'olea-gap-counterweight-breakdown',
      'olea-gap-framing',
      'olea-gap-scope-line',
    ]) {
      expect(root.find(cls).map((el) => el.text)).toEqual(full.find(cls).map((el) => el.text));
    }
    // Nothing on the page words the set-aside concept's need, as weakness or as unknown.
    expect(root.allText().join(' ')).not.toContain('Concept set aside');
  });

  it("a page open on a concept whose readings become unavailable closes to the list, never showing the concept's need", async () => {
    const { view, root } = await mount([FULL, SET_ASIDE]);
    const header = root
      .find('olea-gap-row')
      .find((row) => row.find('olea-gap-concept').some((c) => c.text === 'Concept set aside'))
      ?.find('olea-gap-row-header')[0];
    if (header === undefined) throw new Error('expected the row header');
    header.click();
    expect(root.find('olea-gap-detail-title').map((el) => el.text)).toEqual(['Concept set aside']);
    await view.refresh();
    expect(root.find('olea-gap-detail')).toEqual([]);
    expect(conceptsListed(root)).toEqual(['Concept kept']);
  });
});
