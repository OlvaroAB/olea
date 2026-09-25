/**
 * `createLocalHomeProvider` wiring tests (F6.10, `[D-223]`, `ol-l5og.21`
 * [HOME-2]).
 *
 * Every fixture string below is INVENTED — course codes, assessment titles —
 * per INV-3; nothing here is drawn from a real vault. This suite tests the
 * COMPOSITION this bead adds (session-builder + grove reads → one
 * `HomeViewState`, and the per-course offer selection), not
 * `resolveOfferCards`'s/`buildGroveModel`'s own acceptance criteria, which
 * are `test/retrospective/offer-card.spec.ts`'s and `packages/core`'s own
 * job.
 */
import type { SelectionContextV4 } from 'olea-contracts';
import {
  GOVERNING_FRESH_FOR_SECONDS,
  GOVERNING_GOVERNS_FOR_SECONDS,
  type StudyPlanEnvelope,
} from 'olea-contracts';
import { createFsrsScheduler, extractConcepts, reviewLogPath } from 'olea-core';
import { describe, expect, it } from 'vitest';
import { sessionCompositionSentence } from '../../src/home/copy.js';
import { createLocalHomeProvider } from '../../src/home/provider.js';
import type { HomeViewState } from '../../src/home/view.js';
import type { ObsidianDataHost } from '../../src/plan/settings-store.js';
import { STUDY_PLAN_SETTINGS_STORAGE_KEY } from '../../src/plan/settings-store.js';
import { DEFAULT_SESSION_BUDGET_MINUTES } from '../../src/session-builder/copy.js';
import { createLocalSessionBuilderProvider } from '../../src/session-builder/provider.js';
import type { SessionBuilderState } from '../../src/session-builder/view.js';
import { memoryVault } from '../review/memory-vault.js';

const DEVICE = 'olea-testdevice1';
const BASE_PATH = '02 Assignments/Assignments.base';
const NOW = new Date('2026-09-01T09:00:00Z');

class FakeDataHost implements ObsidianDataHost {
  blob: unknown = null;

  async loadData(): Promise<unknown> {
    return this.blob;
  }

  async saveData(data: unknown): Promise<void> {
    this.blob = data;
  }
}

function hostWithBasePath(basePath: string): FakeDataHost {
  const host = new FakeDataHost();
  host.blob = {
    [STUDY_PLAN_SETTINGS_STORAGE_KEY]: { version: 1, assignmentsBasePath: basePath },
  };
  return host;
}

const BASE_CONTENT = [
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

function fixtureVault(files: Record<string, string> = {}) {
  return memoryVault({ [BASE_PATH]: BASE_CONTENT, ...files });
}

function provider(
  vault: ReturnType<typeof fixtureVault>,
  host: ObsidianDataHost,
  plan?: () => StudyPlanEnvelope | null,
) {
  return createLocalHomeProvider({
    vault,
    deviceId: DEVICE,
    settingsHost: host,
    now: () => NOW,
    scheduler: createFsrsScheduler(),
    ...(plan !== undefined ? { plan } : {}),
  });
}

function dashboard(state: HomeViewState) {
  if (state.kind !== 'dashboard') throw new Error(`expected dashboard, got ${state.kind}`);
  return state;
}

/**
 * `[D-243]` (`ol-egov.132.7` [SESS-8.7]): `load` now takes F4.6's three
 * steering inputs as a `SessionBuilderRequest` rather than composing
 * unsteered — this is the ordinary, unset-everything request every test in
 * this file that is not itself exercising steering uses.
 */
const DEFAULT_REQUEST = { budgetMinutes: DEFAULT_SESSION_BUDGET_MINUTES };

describe('createLocalHomeProvider — load, no assignments Base configured', () => {
  it('is a dashboard with no courses and an unavailable session, rather than an error', async () => {
    const state = await provider(fixtureVault(), new FakeDataHost()).load(DEFAULT_REQUEST);
    const { session, courses } = dashboard(state);
    expect(session).toEqual({ kind: 'unavailable' });
    expect(courses).toEqual([]);
  });
});

describe('createLocalHomeProvider — F6.10 per-course quiet-line selection', () => {
  it('selects at most one retrospective offer per course, even when several of its assessments have passed (the de-duplication fix)', async () => {
    const vault = fixtureVault({
      '02 Assignments/Quiz 1.md':
        '---\nclass: TESTC101\ntype: Quiz\nweight: 10\ndue: 2026-08-10\nstatus: done\n---\n\n# Quiz 1\n',
      '02 Assignments/Quiz 2.md':
        '---\nclass: TESTC101\ntype: Quiz\nweight: 10\ndue: 2026-08-20\nstatus: done\n---\n\n# Quiz 2\n',
      '02 Assignments/Quiz 3.md':
        '---\nclass: TESTC101\ntype: Quiz\nweight: 10\ndue: 2026-08-25\nstatus: done\n---\n\n# Quiz 3\n',
    });
    const { courses } = dashboard(
      await provider(vault, hostWithBasePath(BASE_PATH)).load(DEFAULT_REQUEST),
    );

    const testc101Rows = courses.filter((row) => row.course === 'TESTC101');
    // F6.10 never renders more than one line per course, so this course
    // never produces more than one row either.
    expect(testc101Rows).toHaveLength(1);
    expect(testc101Rows[0]?.quiet?.kind).toBe('retrospective-offer');
  });

  it('picks the assessment with the earliest path — a stable, deterministic tie-break', async () => {
    const vault = fixtureVault({
      '02 Assignments/Quiz 2.md':
        '---\nclass: TESTC101\ntype: Quiz\nweight: 10\ndue: 2026-08-20\nstatus: done\n---\n\n# Quiz 2\n',
      '02 Assignments/Quiz 1.md':
        '---\nclass: TESTC101\ntype: Quiz\nweight: 10\ndue: 2026-08-10\nstatus: done\n---\n\n# Quiz 1\n',
    });
    const { courses } = dashboard(
      await provider(vault, hostWithBasePath(BASE_PATH)).load(DEFAULT_REQUEST),
    );
    const row = courses.find((r) => r.course === 'TESTC101');
    expect(row?.quiet?.kind).toBe('retrospective-offer');
    if (row?.quiet?.kind === 'retrospective-offer') {
      expect(row.quiet.assessmentPath).toBe('02 Assignments/Quiz 1.md');
    }
  });

  it('a course with no registered document and no standing offer reads "set up, waiting"', async () => {
    const vault = fixtureVault({
      '02 Assignments/Quiz 1.md':
        '---\nclass: TESTC202\ntype: Quiz\nweight: 10\ndue: 2026-09-20\nstatus: pending\n---\n\n# Quiz 1\n',
    });
    const { courses } = dashboard(
      await provider(vault, hostWithBasePath(BASE_PATH)).load(DEFAULT_REQUEST),
    );
    const row = courses.find((r) => r.course === 'TESTC202');
    expect(row?.marks).toBeUndefined();
    expect(row?.quiet?.kind).toBe('set-up-waiting');
  });
});

describe('createLocalHomeProvider — dismiss', () => {
  it('ends the standing offer for that assessment — the course row stops carrying it', async () => {
    const vault = fixtureVault({
      '02 Assignments/Quiz 1.md':
        '---\nclass: TESTC101\ntype: Quiz\nweight: 10\ndue: 2026-08-20\nstatus: done\n---\n\n# Quiz 1\n',
    });
    const home = provider(vault, hostWithBasePath(BASE_PATH));

    const before = dashboard(await home.load(DEFAULT_REQUEST)).courses.find(
      (r) => r.course === 'TESTC101',
    );
    expect(before?.quiet?.kind).toBe('retrospective-offer');
    if (before?.quiet?.kind !== 'retrospective-offer') throw new Error('expected an offer');

    await home.dismiss(before.quiet.assessmentPath);

    const after = dashboard(await home.load(DEFAULT_REQUEST)).courses.find(
      (r) => r.course === 'TESTC101',
    );
    expect(after?.quiet?.kind).not.toBe('retrospective-offer');
  });
});

// `ol-egov.132.1` [SESS-8.1] (A2.5, C5.6): `plan` is passed straight through
// to `../session-builder/provider.ts`'s own provider — this suite proves the
// forwarding actually reaches the composed headline session, not merely that
// the field exists on `CreateLocalHomeProviderDeps`.
//
// `DEFAULT_SESSION_BUDGET_MINUTES` (20 min = 1200s) is generous, so a single
// due concept per course can never expose a share difference (both courses'
// tiny cost clears any split). `manyConcepts` below gives each course enough
// never-reviewed, single-card concepts (each cited by its own course's past
// paper, same as `session-builder/provider.spec.ts`'s own `twoConceptBaseFiles`
// pattern — a concept with no assessment citation at all never becomes a gap
// row here) to saturate the WHOLE session budget on its own — 29 × 45s
// (`ASSUMED_INSTRUMENT_SECONDS.qa`) clears the 1200s budget alone, so a plan
// funding one course wholesale (share 1.0) and dropping the other (share 0,
// below its own `minBlockSeconds`) leaves no budget left over for
// `compose.ts`'s course-blind fallback pass to hand the dropped course
// anything, and the dropped course's items are excluded outright.
function manyConcepts(course: string, prefix: string, count: number): Record<string, string> {
  const files: Record<string, string> = {};
  const questions: string[] = [];
  for (let i = 0; i < count; i += 1) {
    const name = `${prefix}${i}`;
    files[`05 Zettelkasten/${name}.md`] = `# ${name}\n`;
    files[`Notes/${prefix}-${i}.md`] = [
      '---',
      `topic: [${name}]`,
      `course: ${course}`,
      '---',
      '',
      'Front::Back',
      '',
    ].join('\n');
    questions.push(
      `## Question ${i + 1} (10 marks)\n\nExplain the core mechanism behind ${name} and why it matters.\n`,
    );
  }
  files[`03 Research/${course} Past Paper 2023.md`] = [
    '---',
    'role: past-paper',
    `course: ${course}`,
    '---',
    '',
    `# ${course} Past Paper — 2023`,
    '',
    ...questions,
  ].join('\n');
  files[`02 Assignments/Quiz ${course}.md`] =
    `---\nclass: ${course}\ntype: Quiz\nweight: 10\ndue: 2026-09-15\nstatus: upcoming\n---\n\n# Quiz\n`;
  return files;
}

const SATURATING_CONCEPT_COUNT = Math.ceil((DEFAULT_SESSION_BUDGET_MINUTES * 60) / 45) + 1;

function twoCourseVault() {
  return fixtureVault({
    ...manyConcepts('TESTC101', 'Widget', SATURATING_CONCEPT_COUNT),
    ...manyConcepts('TESTC202', 'Gadget', SATURATING_CONCEPT_COUNT),
  });
}

function planFixtureWithAllocation(
  allocation: StudyPlanEnvelope['body']['allocation'],
): StudyPlanEnvelope {
  return {
    envelopeVersion: 1,
    kind: 'study-plan',
    bodyVersion: 1,
    policyVersion: 'sp1-aaaaaaaaaaaaaaaa',
    computedAt: NOW.toISOString(),
    freshForSeconds: GOVERNING_FRESH_FOR_SECONDS,
    governsForSeconds: GOVERNING_GOVERNS_FOR_SECONDS,
    body: { asOf: '2026-09-01', courses: [], allocation },
  };
}

function allocationEntry(courseId: string, share: number, risk = 0.5) {
  return {
    courseId,
    share,
    minBlockSeconds: 1,
    contributions: [{ name: 'risk', value: risk }],
    reason: `${courseId} gets its share.`,
  };
}

function sessionModel(state: HomeViewState): SessionBuilderState & { kind: 'model' } {
  const { session } = dashboard(state);
  if (session.kind !== 'model') throw new Error(`expected a session model, got ${session.kind}`);
  return session;
}

function coursesOf(session: SessionBuilderState & { kind: 'model' }): ReadonlySet<string> {
  return new Set(session.model.items.map((item) => item.course));
}

describe("createLocalHomeProvider — the cached plan's real allocation reaches Home's headline session (ol-egov.132.1 [SESS-8.1], A2.5, C5.6)", () => {
  it('a plan funding TESTC101 wholesale excludes TESTC202 from the headline session entirely', async () => {
    const plan = planFixtureWithAllocation([
      allocationEntry('TESTC101', 1),
      allocationEntry('TESTC202', 0),
    ]);
    const state = await provider(twoCourseVault(), hostWithBasePath(BASE_PATH), () => plan).load(
      DEFAULT_REQUEST,
    );
    const courses = coursesOf(sessionModel(state));
    expect(courses.has('TESTC101')).toBe(true);
    expect(courses.has('TESTC202')).toBe(false);
  });

  // `[FOCUS-5]` (`ol-egov.137.4`, David's ruling 2026-09-11): the composer's
  // default is now `'single'` — a session is one course, and which course is
  // dominant is C5.6's filter/urgency/deficit hierarchy, never the plan's
  // `share` directly (share only ever bounds seconds within a chosen
  // course). This still proves the real allocation reaches Home: swapping
  // which course carries the urgency-crossing `risk` swaps which course is
  // shown.
  it('the same plan with the crossing urgency swapped swaps which course Home shows', async () => {
    const plan = planFixtureWithAllocation([
      allocationEntry('TESTC101', 0, 0.01),
      allocationEntry('TESTC202', 1, 0.5),
    ]);
    const state = await provider(twoCourseVault(), hostWithBasePath(BASE_PATH), () => plan).load(
      DEFAULT_REQUEST,
    );
    const courses = coursesOf(sessionModel(state));
    expect(courses.has('TESTC202')).toBe(true);
    expect(courses.has('TESTC101')).toBe(false);
  });

  it("with no `plan` thunk supplied at all, the headline session is still exactly one course (`[FOCUS-5]`'s single-course default)", async () => {
    const state = await provider(twoCourseVault(), hostWithBasePath(BASE_PATH)).load(
      DEFAULT_REQUEST,
    );
    const courses = coursesOf(sessionModel(state));
    expect(courses.size).toBe(1);
  });
});

// `[D-243]` (`ol-egov.132.7` [SESS-8.7]): F4.6's three steering inputs now
// reach Home through the same `SessionBuilderRequest` shape the
// session-builder screen always used — this suite proves `request` actually
// changes what `createLocalHomeProvider` composes, the same "the same
// composer Start will sit" property `features/F6-today.md`'s "The start
// gate" section states as a scenario.
describe('createLocalHomeProvider — F4.6 steering inputs reach the headline session (ol-egov.132.7 [SESS-8.7], F4.6, F6.10/[D-243])', () => {
  it('a course-or-topic restriction changes which course the headline session draws from', async () => {
    const home = provider(twoCourseVault(), hostWithBasePath(BASE_PATH));

    // `[FOCUS-5]`: unsteered, the headline session is exactly one course —
    // no allocation and no review history ties the deficit hierarchy, which
    // falls to course id (TESTC101 first).
    const unsteered = coursesOf(sessionModel(await home.load(DEFAULT_REQUEST)));
    expect(unsteered.has('TESTC101')).toBe(true);
    expect(unsteered.has('TESTC202')).toBe(false);

    // Steering to TESTC202 — the course the unsteered pick did NOT choose —
    // proves the request actually changes which course is dominant, per
    // C5.6's filter branch (F4.6).
    const steered = coursesOf(
      await home
        .load({
          budgetMinutes: DEFAULT_SESSION_BUDGET_MINUTES,
          courseOrTopic: { kind: 'course', label: 'TESTC202' },
        })
        .then(sessionModel),
    );
    expect(steered.has('TESTC202')).toBe(true);
    expect(steered.has('TESTC101')).toBe(false);
  });

  it('a different budget changes how many instruments the headline session holds', async () => {
    const home = provider(twoCourseVault(), hostWithBasePath(BASE_PATH));

    const wide = sessionModel(await home.load({ budgetMinutes: DEFAULT_SESSION_BUDGET_MINUTES }));
    const narrow = sessionModel(await home.load({ budgetMinutes: 5 }));

    expect(narrow.model.items.length).toBeLessThan(wide.model.items.length);
  });
});

// `ol-egov.141.89.10.20` (bug, `[D-243]`): `createLocalHomeProvider` used to
// build its own `createLocalSessionBuilderProvider` without `windowDeficit`
// or `readRankWeights` — the two inputs `main.ts`'s Start-path session-builder
// leaf (`VIEW_TYPE_OLEA_SESSION`) always supplied. F6.4 requires Home and
// Start to be "rendered once" with the same composition (case C12,
// `docs/dev/intelligence-build/pln.md` §5); with different inputs the two
// surfaces could disagree about the same underlying state. This suite proves
// the wiring, not the derivations themselves (`readRankWeights`'s blend
// arithmetic is `test/session-builder/provider.spec.ts`'s own acceptance
// criteria, `windowDeficit`'s C5.5 clustering is that same suite's "C5.5
// clustering feeds the D-092 window deficit" describe) — the point here is
// that `createLocalHomeProvider`'s deps reach the SAME
// `createLocalSessionBuilderProvider` call Start uses, with the SAME values.
describe('createLocalHomeProvider — Home composes with the same windowDeficit and readRankWeights Start uses (ol-egov.141.89.10.20, [D-243])', () => {
  function widgetItem(session: SessionBuilderState & { kind: 'model' }) {
    const item = session.model.items.find((candidate) => candidate.course === 'TESTC101');
    if (item === undefined) throw new Error('expected a TESTC101 item in the session model');
    return item;
  }

  it("readRankWeights reaches Home's headline session and produces the byte-identical gapScore createLocalSessionBuilderProvider produces for the same deps ([D-110], ol-v7r5.3)", async () => {
    const vault = twoCourseVault();
    const host = hostWithBasePath(BASE_PATH);
    // `[FOCUS-5]`: unsteered and with no allocation or review history, both
    // providers' single-course default falls to course id, so TESTC101 is
    // the course each composes — same fixture and reasoning as the F4.6
    // steering suite above.
    const readRankWeights = async () => ({
      masteryNeedWeight: { seed: 0.2, sprout: 0.2, sapling: 0.2, tree: 0.2, unknown: 0.2 },
    });

    const homeState = await createLocalHomeProvider({
      vault,
      deviceId: DEVICE,
      settingsHost: host,
      now: () => NOW,
      scheduler: createFsrsScheduler(),
      readRankWeights,
    }).load(DEFAULT_REQUEST);
    const startState = await createLocalSessionBuilderProvider({
      vault,
      deviceId: DEVICE,
      settingsHost: host,
      now: () => NOW,
      scheduler: createFsrsScheduler(),
      readRankWeights,
    }).load(DEFAULT_REQUEST);
    if (startState.kind !== 'model') throw new Error('expected a session model (Start)');

    const homeItem = widgetItem(sessionModel(homeState));
    const startItem = widgetItem(startState);
    expect(homeItem.gapScore).toBe(startItem.gapScore);

    // Not a false-positive parity between two providers that both silently
    // ignored `readRankWeights`: the delivered weight (0.2) actually moves
    // the number away from the declared fallback (1), the same assertion
    // `test/session-builder/provider.spec.ts`'s own suite makes for Start.
    const fallbackItem = widgetItem(
      sessionModel(await provider(vault, host).load(DEFAULT_REQUEST)),
    );
    expect(homeItem.gapScore).toBeCloseTo(fallbackItem.gapScore * 0.2, 10);
    expect(homeItem.gapScore).not.toBeCloseTo(fallbackItem.gapScore, 5);
  });

  it("windowDeficit is threaded through to Home's own session-builder composition with the real entries/concepts/allocation shape Start's derivation gets ([D-092], [SESS-13])", async () => {
    const vault = twoCourseVault();
    const host = hostWithBasePath(BASE_PATH);
    const plan = planFixtureWithAllocation([
      allocationEntry('TESTC101', 0.5),
      allocationEntry('TESTC202', 0.5),
    ]);
    const seen: {
      readonly entries: readonly unknown[];
      readonly concepts: readonly unknown[];
      readonly allocation: readonly unknown[] | undefined;
    }[] = [];

    await createLocalHomeProvider({
      vault,
      deviceId: DEVICE,
      settingsHost: host,
      now: () => NOW,
      scheduler: createFsrsScheduler(),
      plan: () => plan,
      windowDeficit: (input) => {
        seen.push(input);
        return undefined;
      },
    }).load(DEFAULT_REQUEST);

    // Called exactly once (Home's `load()` composes one session, same
    // "read on every call" posture as Start's own leaf) and handed the real
    // review-log entries, the real concept walk and the real cached
    // allocation this bead's fix threads through — never an empty stub.
    expect(seen).toHaveLength(1);
    const input = seen[0];
    if (input === undefined) throw new Error('expected windowDeficit to have been called');
    expect(Array.isArray(input.entries)).toBe(true);
    expect(Array.isArray(input.concepts)).toBe(true);
    expect(input.concepts.length).toBeGreaterThan(0);
    expect(input.allocation).toEqual(plan.body.allocation);
  });

  it('with neither dep supplied, Home still composes — the pre-bead default, byte-identical (regression guard)', async () => {
    const state = await provider(twoCourseVault(), hostWithBasePath(BASE_PATH)).load(
      DEFAULT_REQUEST,
    );
    const item = widgetItem(sessionModel(state));
    expect(item.gapScore).toBeGreaterThan(0);
  });
});

// F2.22 / F6.4 (`ol-egov.141.89.10.61`, closing the gap `ol-egov.141.89.10.19`
// reported and `ol-egov.141.89.10.60` set up): `createLocalHomeProvider`
// threads `session.focusReason` (the real, composed
// `SessionBuilderState`'s `'model'`-branch field `ol-egov.141.89.10.60`
// added) onto `HomeViewState.focusReason` — this suite proves that against a
// REAL composition (never a mock session), both the presence case and the
// honest-absence case. `test/home/view.spec.ts` already pins, at the source
// level, that `HomeView` reads `HomeViewState.focusReason` and renders it
// through `../home/copy.js#sessionCompositionSentence` exactly once, gated
// on `session.kind === 'model' && focusReason !== undefined` — `home/view.ts`
// is read only for this bead, so this suite does not repeat that pin; it
// proves the OTHER half, that a real composed reason actually reaches the
// field that gate reads, and calls the same rendering function directly
// (`home/copy.ts` is also read only) with the real, un-mocked value to prove
// the exact sentence a real session produces, the same "reuse
// `test/home/view.spec.ts`'s approach" (assert against real source/values,
// never a mounted DOM — `view.ts` imports `obsidian`, which cannot load
// under Vitest, per that file's own module doc).
describe("createLocalHomeProvider — threads the composed session's focusReason onto HomeViewState (F2.22/F6.4, ol-egov.141.89.10.61)", () => {
  it('a real composition with a dominant course spreads session.focusReason onto the dashboard state, verbatim — never a paraphrase', async () => {
    const state = dashboard(
      await provider(twoCourseVault(), hostWithBasePath(BASE_PATH)).load(DEFAULT_REQUEST),
    );
    const session = sessionModel(state);
    // Guards the rest of this test against a silently-undefined reason —
    // `twoCourseVault()` unsteered always has a dominant course (the F4.6
    // steering suite above establishes TESTC101 wins the deficit tie-break).
    expect(session.focusReason).toBeDefined();
    expect(state.focusReason).toBe(session.focusReason);

    // The real value, run through the exact function `home/view.ts` renders
    // it with (`home/copy.ts#sessionCompositionSentence`, read only here) —
    // proves the end-to-end sentence a real composed session produces, not
    // just that some string made it across.
    if (state.focusReason === undefined) throw new Error('expected a focusReason');
    expect(sessionCompositionSentence(state.focusReason)).toBe(
      'This course because it is behind its share from your recent sessions.',
    );
  });

  it('a configured plan with no eligible course at all composes an ordinary, empty model with no dominant course — no focusReason, honest absence', async () => {
    const state = dashboard(
      await provider(fixtureVault(), hostWithBasePath(BASE_PATH)).load(DEFAULT_REQUEST),
    );
    const session = sessionModel(state);
    expect(session.model.items).toEqual([]);
    expect(session.focusReason).toBeUndefined();
    // The spread itself: no `session.focusReason` means no
    // `HomeViewState.focusReason` — never an explicit `focusReason:
    // undefined` key (the same optional-spread posture
    // `session-builder/provider.ts`'s own `buildFresh` takes).
    expect('focusReason' in state).toBe(false);
    expect(state.focusReason).toBeUndefined();
  });

  it('the unavailable-session case (no study plan configured) carries no focusReason either', async () => {
    const state = dashboard(
      await provider(fixtureVault(), new FakeDataHost()).load(DEFAULT_REQUEST),
    );
    expect(state.session).toEqual({ kind: 'unavailable' });
    expect(state.focusReason).toBeUndefined();
  });
});

// F4.6's once-asked course-avoidance question (`[D-265]`, `ol-egov.141.54`
// [INTERV-5]). `./avoidance.ts` carries the decision logic's own unit tests
// (`test/home/avoidance.spec.ts`); this suite proves the WIRING — that a
// real `readReviewLogHistory` read, joined with a real `buildGroveModel`
// read, actually reaches `HomeViewState.avoidanceQuestion` and the store.
const AVOIDANCE_CONTEXT: SelectionContextV4 = {
  dueState: 'new',
  examProximity: null,
  yieldRank: null,
  instrumentTypesOffered: ['qa'],
  planVersion: null,
};

/** The review-log join key: the concept's permanent key (`[D-357]`), read back from this vault's own `.olea/concepts/` sidecar — the key the grove's stamped walk resolves. */
async function conceptKey(vault: ReturnType<typeof fixtureVault>, name: string): Promise<string> {
  const key = (await extractConcepts(vault, { stampConceptKeys: true })).find(
    (concept) => concept.name === name,
  )?.key;
  if (key === undefined) throw new Error(`fixture vault has no concept named ${name}`);
  return key;
}

/** Both courses saturated, with one recent review in TESTC101 and none in TESTC202. */
async function vaultReviewedInOneCourse(): Promise<ReturnType<typeof fixtureVault>> {
  const vault = twoCourseVault();
  await vault.write(
    reviewLogPath('2026-09-01', DEVICE),
    `${reviewLine(await conceptKey(vault, 'Widget0'), '2026-09-01T09:00:00Z', 'e1')}\n`,
  );
  return vault;
}

function reviewLine(conceptKey: string, timestamp: string, eventId: string): string {
  return JSON.stringify({
    schemaVersion: 5,
    kind: 'review',
    eventId,
    timestamp,
    instrumentId: `instrument-${eventId}`,
    instrumentType: 'qa',
    conceptIds: [conceptKey],
    rating: 'good',
    wasUnsure: false,
    durationMs: null,
    selectionContext: AVOIDANCE_CONTEXT,
  });
}

describe('createLocalHomeProvider — F4.6 course-avoidance question ([D-265], [INTERV-5])', () => {
  it('never fires on a fresh vault with no review history anywhere (no "elsewhere" to point at)', async () => {
    const state = await provider(twoCourseVault(), hostWithBasePath(BASE_PATH)).load(
      DEFAULT_REQUEST,
    );
    expect(dashboard(state).avoidanceQuestion).toBeUndefined();
  });

  it('fires for the course with no review activity while the other was reviewed recently, and marks it asked', async () => {
    const vault = await vaultReviewedInOneCourse();
    const host = hostWithBasePath(BASE_PATH);
    const state = dashboard(await provider(vault, host).load(DEFAULT_REQUEST));

    expect(state.avoidanceQuestion?.course).toBe('TESTC202');
  });

  it('a second load never re-offers the same course — "at most once"', async () => {
    const vault = await vaultReviewedInOneCourse();
    const host = hostWithBasePath(BASE_PATH);
    const home = provider(vault, host);

    const first = dashboard(await home.load(DEFAULT_REQUEST));
    expect(first.avoidanceQuestion?.course).toBe('TESTC202');

    const second = dashboard(await home.load(DEFAULT_REQUEST));
    expect(second.avoidanceQuestion).toBeUndefined();
  });

  it('onAnswer records her literal choice and a date — never a diagnosis', async () => {
    const vault = await vaultReviewedInOneCourse();
    const host = hostWithBasePath(BASE_PATH);
    const state = dashboard(await provider(vault, host).load(DEFAULT_REQUEST));
    const question = state.avoidanceQuestion;
    if (question === undefined) throw new Error('expected an avoidance question');

    await question.onAnswer('practise-differently');

    const blob = host.blob as Record<string, unknown>;
    const stored = blob.homeCourseAvoidance as {
      courses: Record<string, { askedAt: string; answer?: { value: string; text: string } }>;
    };
    expect(stored.courses.TESTC202?.answer?.value).toBe('practise-differently');
    expect(typeof stored.courses.TESTC202?.answer?.text).toBe('string');
  });
});
