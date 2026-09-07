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
  createFrontierSessionsCache,
  FRONTIER_GROUP_DISPLAY_CAP,
  FRONTIER_SESSIONS_FALLBACK_FILE,
  FRONTIER_SESSIONS_INDEX_FILE,
  FRONTIER_SURFACE_ORDER,
  FRONTIER_UPPER_BAR_NOTE,
  type FrontierBundle,
  type FrontierIndex,
  type FrontierSessionsIndex,
  type FrontierStateItem,
  frontierBadgeText,
  frontierSessionsShardsForDay,
  itemsUpTo,
  loadFrontierIndex,
  loadFrontierSessionsForDay,
  loadFrontierSessionsIndex,
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

const SESSIONS: { items: FrontierStateItem[] } = {
  items: [
    {
      taskId: 'loop.session.v1',
      tier: 'none',
      round: 'loop',
      context: { date: '2026-06-01', cycle: 1 },
      result: {
        courseShares: [{ courseId: 'AAA101', share: 0.6, seconds: 900, reason: 'exam soon' }],
        allocationSentence: 'Most of today goes to AAA101.',
        items: [
          {
            instrumentId: 'i1',
            instrumentType: 'flashcard',
            conceptId: 'Dornith',
            course: 'AAA101',
            rank: 1,
            reason: 'weakest concept',
          },
        ],
        nextThing: { conceptId: 'Kelvane', course: 'AAA101', reason: 'due next' },
      },
    },
    {
      taskId: 'loop.session.v1',
      tier: 'none',
      round: 'loop',
      context: { date: '2026-07-01', cycle: 2 },
      result: {
        courseShares: [{ courseId: 'BBB101', share: 0.4, seconds: 600, reason: 'steady pace' }],
        allocationSentence: 'BBB101 gets a smaller share today.',
        items: [
          {
            instrumentId: 'i2',
            instrumentType: 'cloze',
            conceptId: 'Ilmenor',
            course: 'BBB101',
            rank: 1,
            reason: 'due today',
          },
        ],
        nextThing: { conceptId: 'Ilmenor', course: 'BBB101', reason: 'due today' },
      },
    },
  ] as unknown as FrontierStateItem[],
};

describe('buildPlanModel — composed session (F9.51)', () => {
  it('renders the session as the first group, ahead of proposals and strain', () => {
    const groups = buildPlanModel([
      SESSIONS.items[0] as FrontierStateItem,
      {
        taskId: 'plan.governor.v1',
        context: { date: '2026-06-01' },
        result: {
          proposals: [{ courseId: 'AAA101', input: 'assessmentPressure', reason: 'exam soon' }],
        },
      },
    ]);
    expect(groups.map((g) => g.heading)).toEqual(['Session — 2026-06-01', 'Proposals']);
  });

  it('renders the lead line, allocation sentence, course shares (percentage and minutes) and items in order', () => {
    const groups = buildPlanModel([SESSIONS.items[0] as FrontierStateItem]);
    expect(groups[0]?.heading).toBe('Session — 2026-06-01');
    expect(groups[0]?.lines.map((l) => l.primary)).toEqual([
      'Next: Kelvane (AAA101)',
      'Most of today goes to AAA101.',
      'AAA101 — 60%, 15 min',
      '1. flashcard — Dornith (AAA101)',
    ]);
    expect(groups[0]?.lines[0]?.detail).toBe('due next');
    expect(groups[0]?.lines[2]?.detail).toBe('exam soon');
    expect(groups[0]?.lines[3]?.detail).toBe('weakest concept');
  });

  it('picks the LATEST session when more than one is given, never merging them', () => {
    const groups = buildPlanModel([
      SESSIONS.items[0] as FrontierStateItem,
      SESSIONS.items[1] as FrontierStateItem,
    ]);
    expect(groups[0]?.heading).toBe('Session — 2026-07-01');
    expect(groups[0]?.lines.map((l) => l.primary)).toEqual([
      'Next: Ilmenor (BBB101)',
      'BBB101 gets a smaller share today.',
      'BBB101 — 40%, 10 min',
      '1. cloze — Ilmenor (BBB101)',
    ]);
  });

  it('adds no session group, and changes nothing else, when no loop.session.v1 item is present', () => {
    const groups = buildPlanModel([
      {
        taskId: 'plan.governor.v1',
        context: { date: '2026-07-01' },
        result: {
          proposals: [{ courseId: 'AAA101', input: 'assessmentPressure', reason: 'exam soon' }],
        },
      },
    ]);
    expect(groups.map((g) => g.heading)).toEqual(['Proposals']);
  });
});

describe('buildFrontierSurfaceModels — composed session selection by scrubbed day', () => {
  const bundle: FrontierBundle = {
    index: {
      world: 'x',
      generatedAt: '',
      surfaces: [
        {
          surface: 'plan',
          title: 'Plan',
          files: ['sessions.json'],
          taskIds: ['plan.governor.v1'],
          tier: 'none',
          answered: 2,
        },
      ],
    },
    states: new Map<string, readonly FrontierStateItem[]>([['sessions.json', SESSIONS.items]]),
  };

  it('renders the latest session at or before the scrubbed day, not a later one', () => {
    const mid = buildFrontierSurfaceModels(bundle, '2026-06-15').find((m) => m.surface === 'plan');
    expect(mid?.groups[0]?.heading).toBe('Session — 2026-06-01');
  });

  it('moves to the next session once the scrubber passes it', () => {
    const late = buildFrontierSurfaceModels(bundle, '2026-08-01').find((m) => m.surface === 'plan');
    expect(late?.groups[0]?.heading).toBe('Session — 2026-07-01');
  });

  it('leaves the plan unanswered before any session has arrived — no change from today', () => {
    const early = buildFrontierSurfaceModels(bundle, '2026-01-01').find(
      (m) => m.surface === 'plan',
    );
    expect(early?.state).toBe('unanswered');
    expect(early?.groups).toEqual([]);
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

  it('a composed session (tier "none") says so rather than "answered by none"', () => {
    expect(
      frontierBadgeText({
        surface: 'plan',
        title: 'Plan',
        state: 'answered',
        tier: 'none',
        taskIds: ['plan.governor.v1'],
        groups: [],
      }),
    ).toBe(`composed locally, no model call · ${FRONTIER_UPPER_BAR_NOTE}`);
  });
});

// ==================================================================================================
// SESSIONS SHARDING (`[HARD-18]`, `ol-3ux7.5.57.14.41`) — `olea-service`'s `scripts/
// simulator-build.mjs` no longer writes a flat `frontier/sessions.json`; it shards a walk into
// `frontier/sessions.NNN.json` files plus `frontier/sessions.index.json`. Every id, cycle number
// and date below is invented (INV-3) — no real frontier material.
// ==================================================================================================

/** A `fetch` stub, exact-URL keyed like `fakeFetch` above, that also records every URL asked for. */
function countingFetch(routes: Record<string, unknown>): {
  fetchFn: typeof fetch;
  calls: string[];
} {
  const calls: string[] = [];
  const fetchFn = (async (url: string) => {
    calls.push(url);
    const body = routes[url];
    if (body === undefined) return new Response('not found', { status: 404 });
    if (body instanceof Error) throw body;
    return new Response(JSON.stringify(body));
  }) as unknown as typeof fetch;
  return { fetchFn, calls };
}

/** An invented `loop.session.v1` item, in `frontier-loop.mjs`'s own shape (`context.cycle`/`date`). */
function inventedSessionItem(cycle: number, date: string): FrontierStateItem {
  return {
    taskId: 'loop.session.v1',
    tier: 'none',
    context: { date, cycle },
    result: { items: [{ conceptId: `coined-concept-${cycle}`, rank: 1 }] },
  };
}

/** A three-shard invented index: cycles 1-3 / 4-6 / 7-9, one day per cycle in August. */
function threeShardIndex(): FrontierSessionsIndex {
  return {
    version: 1,
    shards: [
      {
        file: 'sessions.000.json',
        fromCycle: 1,
        toCycle: 3,
        fromDate: '2026-08-01',
        toDate: '2026-08-03',
        bytes: 100,
      },
      {
        file: 'sessions.001.json',
        fromCycle: 4,
        toCycle: 6,
        fromDate: '2026-08-04',
        toDate: '2026-08-06',
        bytes: 100,
      },
      {
        file: 'sessions.002.json',
        fromCycle: 7,
        toCycle: 9,
        fromDate: '2026-08-07',
        toDate: '2026-08-09',
        bytes: 100,
      },
    ],
  };
}

describe('loadFrontierSessionsIndex', () => {
  it('parses a well-formed three-shard index', async () => {
    const { fetchFn } = countingFetch({
      [`/frontier/${FRONTIER_SESSIONS_INDEX_FILE}`]: threeShardIndex(),
    });
    const index = await loadFrontierSessionsIndex(fetchFn, '/');
    expect(index?.shards).toHaveLength(3);
  });

  it('is null on a 404 — the fallback signal for an older dist', async () => {
    expect(await loadFrontierSessionsIndex(countingFetch({}).fetchFn, '/')).toBeNull();
  });

  it('is null on a shape that is not {shards: [...]}', async () => {
    const { fetchFn } = countingFetch({
      [`/frontier/${FRONTIER_SESSIONS_INDEX_FILE}`]: { notAnIndex: true },
    });
    expect(await loadFrontierSessionsIndex(fetchFn, '/')).toBeNull();
  });

  it('is null, never throws, when fetch itself rejects', async () => {
    const throwing = (async () => {
      throw new Error('network down');
    }) as unknown as typeof fetch;
    expect(await loadFrontierSessionsIndex(throwing, '/')).toBeNull();
  });
});

describe('frontierSessionsShardsForDay', () => {
  const index = threeShardIndex();

  it('picks the one shard whose range brackets the day', () => {
    expect(frontierSessionsShardsForDay(index, '2026-08-05').map((s) => s.file)).toEqual([
      'sessions.001.json',
    ]);
  });

  it('picks the last shard whose range starts at or before a day that falls after every shard', () => {
    // No shard's range literally contains 2026-08-10 — the LATEST session at or before that day
    // is still in the last shard.
    expect(frontierSessionsShardsForDay(index, '2026-08-10').map((s) => s.file)).toEqual([
      'sessions.002.json',
    ]);
  });

  it('is empty when the day precedes every shard — nothing has arrived yet', () => {
    expect(frontierSessionsShardsForDay(index, '2026-07-01')).toEqual([]);
  });

  it('names every shard for an unparseable day, mirroring itemsUpTo', () => {
    expect(frontierSessionsShardsForDay(index, 'not-a-date')).toEqual(index.shards);
  });
});

describe('loadFrontierSessionsForDay', () => {
  it('fetches only the shard covering the day, and caches it — a repeat call for the same day refetches nothing', async () => {
    const { fetchFn, calls } = countingFetch({
      [`/frontier/${FRONTIER_SESSIONS_INDEX_FILE}`]: threeShardIndex(),
      '/frontier/sessions.001.json': { items: [inventedSessionItem(5, '2026-08-05')] },
    });
    const cache = createFrontierSessionsCache();

    const first = await loadFrontierSessionsForDay(fetchFn, '/', cache, '2026-08-05');
    expect(first).toHaveLength(1);
    expect(calls.filter((u) => u === '/frontier/sessions.001.json')).toHaveLength(1);
    expect(calls).not.toContain('/frontier/sessions.000.json');
    expect(calls).not.toContain('/frontier/sessions.002.json');

    const second = await loadFrontierSessionsForDay(fetchFn, '/', cache, '2026-08-05');
    expect(second).toEqual(first);
    // Still exactly one fetch of the index and one of the shard — the cache absorbed the repeat.
    expect(calls.filter((u) => u === `/frontier/${FRONTIER_SESSIONS_INDEX_FILE}`)).toHaveLength(1);
    expect(calls.filter((u) => u === '/frontier/sessions.001.json')).toHaveLength(1);
  });

  it('fetches a later day’s shard on top of an already-cached earlier one, never re-fetching the earlier shard', async () => {
    const { fetchFn, calls } = countingFetch({
      [`/frontier/${FRONTIER_SESSIONS_INDEX_FILE}`]: threeShardIndex(),
      '/frontier/sessions.000.json': { items: [inventedSessionItem(2, '2026-08-02')] },
      '/frontier/sessions.001.json': { items: [inventedSessionItem(5, '2026-08-05')] },
    });
    const cache = createFrontierSessionsCache();

    await loadFrontierSessionsForDay(fetchFn, '/', cache, '2026-08-02');
    await loadFrontierSessionsForDay(fetchFn, '/', cache, '2026-08-05');

    expect(calls.filter((u) => u === '/frontier/sessions.000.json')).toHaveLength(1);
    expect(calls.filter((u) => u === '/frontier/sessions.001.json')).toHaveLength(1);
    expect(calls.filter((u) => u === `/frontier/${FRONTIER_SESSIONS_INDEX_FILE}`)).toHaveLength(1);
  });

  it('falls back to a flat sessions.json, cached, when no index exists (an older dist)', async () => {
    const { fetchFn, calls } = countingFetch({
      [`/frontier/${FRONTIER_SESSIONS_FALLBACK_FILE}`]: {
        items: [inventedSessionItem(1, '2026-08-01')],
      },
    });
    const cache = createFrontierSessionsCache();

    const first = await loadFrontierSessionsForDay(fetchFn, '/', cache, '2026-08-01');
    expect(first).toHaveLength(1);
    const second = await loadFrontierSessionsForDay(fetchFn, '/', cache, '2026-09-01');
    expect(second).toEqual(first);

    expect(calls.filter((u) => u === `/frontier/${FRONTIER_SESSIONS_FALLBACK_FILE}`)).toHaveLength(
      1,
    );
    // The index absence itself is cached (`cache.index` goes from `undefined` to `null`, never
    // re-checked) — one 404 for the whole mount, not one per scrub.
    expect(calls.filter((u) => u === `/frontier/${FRONTIER_SESSIONS_INDEX_FILE}`)).toHaveLength(1);
  });

  it('returns [] when the dist carries neither an index nor a flat file', async () => {
    const cache = createFrontierSessionsCache();
    expect(
      await loadFrontierSessionsForDay(countingFetch({}).fetchFn, '/', cache, '2026-08-01'),
    ).toEqual([]);
  });
});

describe('loadFrontierSurfaces excludes sessions from its generic eager fetch', () => {
  it('never fetches sessions.index.json or sessions.json through the generic per-file path, even when an (older-shaped) index names sessions.json', async () => {
    const oldStyleIndex: FrontierIndex = {
      world: 'PERSONA COINED',
      generatedAt: '2026-09-06T00:00:00.000Z',
      surfaces: [
        {
          surface: 'plan',
          title: 'The plan',
          files: ['sessions.json'],
          taskIds: ['plan.governor.v1'],
          tier: 'none',
          answered: 3,
        },
      ],
    };
    const { fetchFn, calls } = countingFetch({
      '/simulator-frontier.json': oldStyleIndex,
      // A real caller would never reach this from loadFrontierSurfaces — if it did, the
      // assertion below (no such call happened) would fail loudly.
      '/frontier/sessions.json': { items: [inventedSessionItem(1, '2026-08-01')] },
    });
    const bundle = await loadFrontierSurfaces(fetchFn, '/');
    expect(bundle?.states.has('sessions.json')).toBe(false);
    expect(calls).not.toContain('/frontier/sessions.json');
  });
});

describe('buildFrontierSurfaceModels — plan surface merges lazily-loaded sessions (`[HARD-18]`)', () => {
  function bundleWithPlanSurface(governorItems: readonly FrontierStateItem[]): FrontierBundle {
    const index: FrontierIndex = {
      world: 'PERSONA COINED',
      generatedAt: '2026-09-06T00:00:00.000Z',
      surfaces: [
        {
          surface: 'plan',
          title: 'The plan',
          files: governorItems.length > 0 ? ['governor.json'] : [],
          taskIds: ['plan.governor.v1'],
          tier: governorItems.length > 0 ? 'opus' : null,
          answered: governorItems.length,
        },
      ],
    };
    const states = new Map<string, readonly FrontierStateItem[]>();
    if (governorItems.length > 0) states.set('governor.json', governorItems);
    return { index, states };
  }

  it('renders a session group from the SEPARATE sessionItems argument even when no other file answered the plan', () => {
    const bundle = bundleWithPlanSurface([]);
    const models = buildFrontierSurfaceModels(bundle, '2026-08-05', [
      inventedSessionItem(5, '2026-08-05'),
    ]);
    const plan = models.find((m) => m.surface === 'plan');
    expect(plan?.state).toBe('answered');
    expect(plan?.groups.some((g) => g.heading.startsWith('Session'))).toBe(true);
  });

  it('defaults to no session group when the argument is omitted — the old call shape still works', () => {
    const bundle = bundleWithPlanSurface([]);
    const models = buildFrontierSurfaceModels(bundle, '2026-08-05');
    const plan = models.find((m) => m.surface === 'plan');
    expect(plan?.state).toBe('unanswered');
  });

  it('scrub-back applies to the lazily-loaded session items too: a session AFTER the walked day is not shown', () => {
    const bundle = bundleWithPlanSurface([]);
    const models = buildFrontierSurfaceModels(bundle, '2026-08-01', [
      inventedSessionItem(5, '2026-08-05'),
    ]);
    const plan = models.find((m) => m.surface === 'plan');
    expect(plan?.state).toBe('unanswered');
  });

  it('merges lazily-loaded sessions alongside governor content answered through the ordinary eager path', () => {
    const governorItem: FrontierStateItem = {
      taskId: 'plan.governor.v1',
      context: { date: '2026-08-05' },
      result: { proposals: [{ courseId: 'AAA101', input: 'assessmentPressure', reason: 'exam' }] },
    };
    const bundle = bundleWithPlanSurface([governorItem]);
    const models = buildFrontierSurfaceModels(bundle, '2026-08-05', [
      inventedSessionItem(5, '2026-08-05'),
    ]);
    const plan = models.find((m) => m.surface === 'plan');
    expect(plan?.groups.map((g) => g.heading)).toEqual(['Session — 2026-08-05', 'Proposals']);
  });
});
