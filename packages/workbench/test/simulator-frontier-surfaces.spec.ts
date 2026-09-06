/**
 * `simulator/frontier-surfaces.ts` (`ol-3ux7.5.57.14.8` [MOM-10i]) — the
 * loaders and the model builders that turn a frontier run's replayed outputs
 * into the simulator's per-moment surfaces.
 *
 * `renderFrontierSurfaces` itself builds real DOM (`createDiv`/`createSpan`,
 * the obsidian-shim extensions) and is exercised only by Playwright — the
 * same story `simulator-term-scrubber.spec.ts` tells about the scrubber, and
 * for the same reason: this package's plain-Node Vitest environment has no
 * `document`. What is asserted here is everything that decides WHAT a panel
 * says: which items count as arrived at a walked day, what each surface's
 * groups hold, and — the load-bearing one — that a surface with no replayed
 * output refuses rather than invents.
 *
 * INV-3: every fixture below is coined. No frontier material lives in this
 * repo and none may.
 */
import { describe, expect, it } from 'vitest';
import {
  buildCardsModel,
  buildExplainBackModel,
  buildFrontierSurfaceModels,
  buildGroveModel,
  buildPlanModel,
  buildRankingModel,
  FRONTIER_GROUP_DISPLAY_CAP,
  FRONTIER_SURFACE_ORDER,
  FRONTIER_UPPER_BAR_NOTE,
  type FrontierBundle,
  type FrontierStateItem,
  frontierBadgeText,
  itemsUpTo,
  loadFrontierIndex,
  loadFrontierStateFile,
  loadFrontierSurfaces,
} from '../src/simulator/frontier-surfaces.js';

function fakeFetch(routes: Record<string, unknown>): typeof fetch {
  return (async (url: string) => {
    const body = routes[url];
    if (body === undefined) return new Response('not found', { status: 404 });
    if (body instanceof Error) throw body;
    return new Response(JSON.stringify(body));
  }) as unknown as typeof fetch;
}

const INDEX = {
  world: 'PERSONA CORVAX',
  generatedAt: '2026-09-06T00:00:00.000Z',
  surfaces: [
    {
      surface: 'grove',
      title: 'Grove',
      files: ['concepts.json', 'relations.json'],
      taskIds: ['concepts.extract.v1', 'concepts.relations.v1'],
      tier: 'sonnet',
      answered: 2,
    },
    {
      surface: 'plan',
      title: 'Plan',
      files: [],
      taskIds: ['plan.governor.v1'],
      tier: null,
      answered: 0,
    },
  ],
};

const CONCEPTS = {
  items: [
    {
      taskId: 'concepts.extract.v1',
      tier: 'sonnet',
      context: { stepIndex: 0, date: '2026-05-04' },
      result: { concepts: [{ name: 'Dornith', aliases: ['dorn'] }, { name: 'Kelvane' }] },
    },
    {
      taskId: 'concepts.extract.v1',
      tier: 'sonnet',
      context: { stepIndex: 3, date: '2026-06-01' },
      result: { concepts: [{ name: 'Ilmenor' }, { name: 'Dornith' }] },
    },
  ],
};

const RELATIONS = {
  items: [
    {
      taskId: 'concepts.relations.v1',
      tier: 'sonnet',
      context: { stepIndex: 1, date: '2026-05-11' },
      result: {
        verdicts: [{ a: 'Dornith', b: 'Kelvane', type: 'contrasts-with', confidence: 0.62 }],
      },
    },
  ],
};

describe('loadFrontierIndex', () => {
  it('returns null when the dist carries no index — the public build takes no new code path', async () => {
    expect(await loadFrontierIndex(fakeFetch({}))).toBeNull();
  });

  it('returns null for a body that is not a frontier index', async () => {
    expect(
      await loadFrontierIndex(fakeFetch({ '/simulator-frontier.json': { nope: 1 } })),
    ).toBeNull();
  });

  it('never throws when the fetch itself fails', async () => {
    const throwing = (async () => {
      throw new Error('offline');
    }) as unknown as typeof fetch;
    expect(await loadFrontierIndex(throwing)).toBeNull();
  });

  it('parses a well-formed index and carries an unanswered row through with tier null', async () => {
    const index = await loadFrontierIndex(fakeFetch({ '/simulator-frontier.json': INDEX }));
    expect(index?.world).toBe('PERSONA CORVAX');
    expect(index?.surfaces.map((s) => s.surface)).toEqual(['grove', 'plan']);
    expect(index?.surfaces[1]?.tier).toBeNull();
  });

  it('reads a carried world from its own base, never the dist root', async () => {
    const index = await loadFrontierIndex(
      fakeFetch({ '/worlds/corvax/simulator-frontier.json': INDEX }),
      '/worlds/corvax/',
    );
    expect(index?.world).toBe('PERSONA CORVAX');
  });
});

describe('loadFrontierStateFile', () => {
  it('is empty for a file the build did not carry — absence is the unanswered state, never a throw', async () => {
    expect(await loadFrontierStateFile(fakeFetch({}), '/', 'rankings.json')).toEqual([]);
  });

  it('drops entries that are not state items', async () => {
    const items = await loadFrontierStateFile(
      fakeFetch({ '/frontier/concepts.json': { items: [{ taskId: 'a' }, 42, null, {}] } }),
      '/',
      'concepts.json',
    );
    expect(items).toHaveLength(1);
  });
});

describe('loadFrontierSurfaces', () => {
  it('loads every file the index names, once, keyed by name', async () => {
    const bundle = await loadFrontierSurfaces(
      fakeFetch({
        '/simulator-frontier.json': INDEX,
        '/frontier/concepts.json': CONCEPTS,
        '/frontier/relations.json': RELATIONS,
      }),
    );
    expect(bundle?.states.get('concepts.json')).toHaveLength(2);
    expect(bundle?.states.get('relations.json')).toHaveLength(1);
  });
});

describe('itemsUpTo', () => {
  const items: FrontierStateItem[] = [
    { taskId: 't', context: { date: '2026-05-04' } },
    { taskId: 't', context: { date: '2026-06-01' } },
    { taskId: 't' },
  ];

  it('keeps only what had arrived by the walked day', () => {
    expect(itemsUpTo(items, '2026-05-10')).toHaveLength(2);
  });

  it('includes the walked day itself', () => {
    expect(itemsUpTo(items, '2026-05-04')).toHaveLength(2);
  });

  it('keeps an undated item — undated is not late', () => {
    expect(itemsUpTo(items, '2026-01-01')).toEqual([items[2]]);
  });
});

describe('buildGroveModel', () => {
  it('groups concepts by arrival plan point and never repeats one', () => {
    const { groups, conceptCount } = buildGroveModel(CONCEPTS.items, RELATIONS.items);
    expect(conceptCount).toBe(3);
    expect(groups.map((g) => g.heading)).toEqual([
      'Arrived 2026-05-04',
      'Arrived 2026-06-01',
      'Relations',
    ]);
    expect(groups[1]?.lines.map((l) => l.primary)).toEqual(['Ilmenor']);
  });

  it('renders a relation verdict as the tier stated it, confidence included', () => {
    const { groups } = buildGroveModel([], RELATIONS.items);
    expect(groups[0]?.lines[0]?.primary).toBe('Dornith — contrasts-with — Kelvane');
    expect(groups[0]?.lines[0]?.detail).toBe('confidence 0.62');
  });
});

describe('buildCardsModel', () => {
  it('groups cards by the course the generation call named', () => {
    const groups = buildCardsModel([
      {
        taskId: 'cards.generate.v1',
        context: { date: '2026-05-04', courseCode: 'BBB101' },
        result: { cards: [{ front: 'q1', back: 'a1' }] },
      },
      {
        taskId: 'cards.generate.v1',
        context: { date: '2026-05-04', courseCode: 'AAA101' },
        result: { cards: [{ front: 'q2', back: 'a2' }] },
      },
    ]);
    expect(groups.map((g) => g.heading)).toEqual(['AAA101', 'BBB101']);
    expect(groups[0]?.lines[0]).toMatchObject({ primary: 'q2', detail: 'a2' });
  });

  it('reports the remainder as a count rather than growing the panel without bound', () => {
    const cards = Array.from({ length: FRONTIER_GROUP_DISPLAY_CAP + 5 }, (_, i) => ({
      front: `q${i}`,
      back: 'a',
    }));
    const groups = buildCardsModel([
      { taskId: 'cards.generate.v1', context: { courseCode: 'AAA101' }, result: { cards } },
    ]);
    expect(groups[0]?.lines).toHaveLength(FRONTIER_GROUP_DISPLAY_CAP);
    expect(groups[0]?.total).toBe(FRONTIER_GROUP_DISPLAY_CAP + 5);
  });
});

describe('buildRankingModel', () => {
  it('renders one group per window, in the ranking order the oracle returned', () => {
    const groups = buildRankingModel([
      {
        taskId: 'oracle.rank.v1',
        context: { stepIndex: 2, date: '2026-06-15', courseCode: 'AAA101' },
        result: {
          rankings: [
            { conceptName: 'Dornith', reasoning: 'names the whole unit' },
            { conceptName: 'Kelvane', reasoning: 'one worked example' },
          ],
        },
      },
    ]);
    expect(groups[0]?.heading).toBe('AAA101 — 2026-06-15');
    expect(groups[0]?.lines.map((l) => l.primary)).toEqual(['1. Dornith', '2. Kelvane']);
    expect(groups[0]?.lines[0]?.detail).toBe('names the whole unit');
  });
});

describe('buildExplainBackModel', () => {
  it('keeps the judge verdict and the solo depth as two separate readings', () => {
    const groups = buildExplainBackModel([
      {
        taskId: 'explain-back.judge.v1',
        context: { date: '2026-06-20' },
        result: {
          verdict: 'partial',
          feedback: 'the second half is missing',
          missedPoints: ['stage three'],
        },
      },
      {
        taskId: 'explain-back.solo.v1',
        context: { date: '2026-06-20' },
        result: { soloLevel: 'multistructural', rationale: 'lists parts without joining them' },
      },
    ]);
    expect(groups.map((g) => g.heading)).toEqual([
      'Judge — verdict and rationale',
      'Solo depth — level and rationale',
    ]);
    expect(groups[0]?.lines[0]?.primary).toBe('Verdict: partial');
    expect(groups[0]?.lines[0]?.detail).toContain('Missed: stage three');
    expect(groups[1]?.lines[0]?.primary).toBe('Depth: multistructural');
  });
});

describe('buildPlanModel', () => {
  it('renders the governor proposals and the strain it could not express', () => {
    const groups = buildPlanModel([
      {
        taskId: 'plan.governor.v1',
        context: { date: '2026-07-01' },
        result: {
          proposals: [
            {
              courseId: 'AAA101',
              input: 'assessmentPressure',
              multiplier: 1.4,
              reason: 'exam in nine days',
            },
          ],
          strain: [
            { wanted: 'defer one course a week', whyInexpressible: 'no per-course pause input' },
          ],
        },
      },
    ]);
    expect(groups.map((g) => g.heading)).toEqual([
      'Proposals',
      'Strain — what the plan could not express',
    ]);
    expect(groups[0]?.lines[0]?.primary).toBe('AAA101 — assessmentPressure x1.4');
  });
});

describe('buildFrontierSurfaceModels', () => {
  const bundle: FrontierBundle = {
    index: INDEX as FrontierBundle['index'],
    states: new Map<string, readonly FrontierStateItem[]>([
      ['concepts.json', CONCEPTS.items],
      ['relations.json', RELATIONS.items],
    ]),
  };

  it('answers the grove from concepts and relations at a day past the term start', () => {
    const models = buildFrontierSurfaceModels(bundle, '2026-08-28');
    const grove = models.find((m) => m.surface === 'grove');
    expect(grove?.state).toBe('answered');
    expect(grove?.tier).toBe('sonnet');
    expect(grove?.groups.map((g) => g.heading)).toContain('Relations');
  });

  it('a surface with no replayed output refuses and never invents one', () => {
    const models = buildFrontierSurfaceModels(bundle, '2026-08-28');
    const plan = models.find((m) => m.surface === 'plan');
    expect(plan?.state).toBe('unanswered');
    expect(plan?.groups).toEqual([]);
    expect(plan?.refusal).toContain('Not yet answered');
    expect(plan?.refusal).toContain('plan.governor.v1');
  });

  it('scrubbing back before anything arrived leaves the grove unanswered, not empty-but-answered', () => {
    const models = buildFrontierSurfaceModels(bundle, '2026-01-01');
    const grove = models.find((m) => m.surface === 'grove');
    expect(grove?.state).toBe('unanswered');
    expect(grove?.refusal).toContain('2026-01-01');
  });

  it('scrub-back moves the surfaces with the term', () => {
    const early = buildFrontierSurfaceModels(bundle, '2026-05-04').find(
      (m) => m.surface === 'grove',
    );
    const late = buildFrontierSurfaceModels(bundle, '2026-08-28').find(
      (m) => m.surface === 'grove',
    );
    const headings = (m: typeof early) => m?.groups.map((g) => g.heading) ?? [];
    expect(headings(early)).toEqual(['Arrived 2026-05-04']);
    expect(headings(late)).toContain('Arrived 2026-06-01');
  });

  it('renders in walk order regardless of the order the index listed', () => {
    const reordered: FrontierBundle = {
      ...bundle,
      index: { ...bundle.index, surfaces: [...bundle.index.surfaces].reverse() },
    };
    const order = buildFrontierSurfaceModels(reordered, '2026-08-28').map((m) => m.surface);
    expect(order).toEqual(FRONTIER_SURFACE_ORDER.filter((s) => order.includes(s)));
    expect(order).toEqual(['grove', 'plan']);
  });
});

describe('frontierBadgeText', () => {
  it('names the tier that answered the surface and says what this walk is', () => {
    const models = buildFrontierSurfaceModels(
      {
        index: INDEX as FrontierBundle['index'],
        states: new Map<string, readonly FrontierStateItem[]>([
          ['concepts.json', CONCEPTS.items],
          ['relations.json', RELATIONS.items],
        ]),
      },
      '2026-08-28',
    );
    for (const model of models) {
      expect(frontierBadgeText(model)).toContain(FRONTIER_UPPER_BAR_NOTE);
    }
    expect(frontierBadgeText(models[0] as never)).toContain('answered by sonnet');
  });

  it('a surface nothing answered says so rather than borrowing a neighbour tier', () => {
    expect(
      frontierBadgeText({
        surface: 'plan',
        title: 'Plan',
        state: 'unanswered',
        tier: null,
        taskIds: [],
        groups: [],
      }),
    ).toBe(`no tier answered · ${FRONTIER_UPPER_BAR_NOTE}`);
  });
});
