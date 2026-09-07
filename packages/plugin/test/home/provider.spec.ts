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
import {
  GOVERNING_FRESH_FOR_SECONDS,
  GOVERNING_GOVERNS_FOR_SECONDS,
  type StudyPlanEnvelope,
} from 'olea-contracts';
import { createFsrsScheduler } from 'olea-core';
import { describe, expect, it } from 'vitest';
import { createLocalHomeProvider } from '../../src/home/provider.js';
import type { HomeViewState } from '../../src/home/view.js';
import type { ObsidianDataHost } from '../../src/plan/settings-store.js';
import { STUDY_PLAN_SETTINGS_STORAGE_KEY } from '../../src/plan/settings-store.js';
import { DEFAULT_SESSION_BUDGET_MINUTES } from '../../src/session-builder/copy.js';
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

describe('createLocalHomeProvider — load, no assignments Base configured', () => {
  it('is a dashboard with no courses and an unavailable session, rather than an error', async () => {
    const state = await provider(fixtureVault(), new FakeDataHost()).load();
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
    const { courses } = dashboard(await provider(vault, hostWithBasePath(BASE_PATH)).load());

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
    const { courses } = dashboard(await provider(vault, hostWithBasePath(BASE_PATH)).load());
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
    const { courses } = dashboard(await provider(vault, hostWithBasePath(BASE_PATH)).load());
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

    const before = dashboard(await home.load()).courses.find((r) => r.course === 'TESTC101');
    expect(before?.quiet?.kind).toBe('retrospective-offer');
    if (before?.quiet?.kind !== 'retrospective-offer') throw new Error('expected an offer');

    await home.dismiss(before.quiet.assessmentPath);

    const after = dashboard(await home.load()).courses.find((r) => r.course === 'TESTC101');
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

function allocationEntry(courseId: string, share: number) {
  return {
    courseId,
    share,
    minBlockSeconds: 1,
    contributions: [{ name: 'risk', value: 0.5 }],
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
    const state = await provider(twoCourseVault(), hostWithBasePath(BASE_PATH), () => plan).load();
    const courses = coursesOf(sessionModel(state));
    expect(courses.has('TESTC101')).toBe(true);
    expect(courses.has('TESTC202')).toBe(false);
  });

  it('the same plan with the two shares swapped swaps which course Home shows', async () => {
    const plan = planFixtureWithAllocation([
      allocationEntry('TESTC101', 0),
      allocationEntry('TESTC202', 1),
    ]);
    const state = await provider(twoCourseVault(), hostWithBasePath(BASE_PATH), () => plan).load();
    const courses = coursesOf(sessionModel(state));
    expect(courses.has('TESTC202')).toBe(true);
    expect(courses.has('TESTC101')).toBe(false);
  });

  it('with no `plan` thunk supplied at all, both courses share the headline session — the interim proportional split, unchanged from before this bead', async () => {
    const state = await provider(twoCourseVault(), hostWithBasePath(BASE_PATH)).load();
    const courses = coursesOf(sessionModel(state));
    expect(courses.has('TESTC101')).toBe(true);
    expect(courses.has('TESTC202')).toBe(true);
  });
});
