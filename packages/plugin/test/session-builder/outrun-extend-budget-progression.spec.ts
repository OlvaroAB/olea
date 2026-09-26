/**
 * Bead: `ol-egov.141.89.10.4` (a follow-up filed from `ol-egov.141.89.10.65`'s
 * report) — does a SECOND "keep going" (F2.17/C5.8's outrun-the-target
 * extend) actually widen the session further than the first, or does it add
 * nothing?
 *
 * ## The clause
 *
 * F2.17/C5.8, and F2.18's own restatement: "the budget is a per-session
 * declared target, never a cap... when she outruns the plan, the extension
 * is composed under the same plan's shares"; F2.18: "where she outruns it,
 * C5.8's outrun extends this course's own material under the same plan's
 * shares." Neither names a number of times she may outrun it — outrunning
 * is something she can keep doing, and each time the session should keep
 * growing under the one policy, never stall silently.
 *
 * `main.ts`'s own `extendDefaultStudySession` doc (`[SESS-8.6]`,
 * `ol-egov.132.6`) states the intended mechanism: each call widens by "one
 * more `DEFAULT_SESSION_BUDGET_MINUTES`-sized step" from wherever the
 * session currently stands. That is the design this suite holds the real
 * code to — not a specific number of extra items, just that a second outrun
 * reaches further than the first, the way the doc already says it should.
 *
 * ## The defect this suite proves, through the REAL core functions
 *
 * `main.ts` cannot be imported under Vitest (`main.ts` imports `obsidian`,
 * whose `package.json` `main` is `""` — see `test/main-wiring.spec.ts`'s own
 * module doc), so this suite drives the exact two production functions
 * `extendDefaultStudySession` calls — `composeStudySessionForRequest`
 * (`session-builder/provider.ts`) and `extendComposedStudySession`
 * (`olea-core`) — the same way, with the same inputs, twice in a row, and
 * reconstructs the returned session two ways:
 *
 * - `todaysReconstruction`: exactly what `main.ts` returns today —
 *   `{ ...previous, model: { ...previous.model, items } }`. `items` is
 *   updated; `budgetMinutes` is not.
 * - `fixedReconstruction`: `{ ...previous, model: { ...previous.model,
 *   budgetMinutes: widerBudgetMinutes, items } }` — the widened figure
 *   carried forward too.
 *
 * Case 1 shows `todaysReconstruction` making a second extend land on the
 * IDENTICAL `widerBudgetMinutes` the first one already used (because it
 * reads the never-updated `previous.model.budgetMinutes`), so nothing new
 * is appended — the outrun silently does nothing the second time. Case 2
 * shows `fixedReconstruction` carrying the widened figure forward, so the
 * second extend computes a genuinely wider budget and keeps appending.
 *
 * `test/main-wiring.spec.ts`'s own `ol-egov.141.89.10.4` block pins the
 * source-level fix (`main.ts` must actually return `fixedReconstruction`'s
 * shape); this file is the behavioural proof that the fix, not the bug,
 * matches the clause's "she can keep outrunning it" posture.
 */
import {
  type ComposedStudySession,
  createFsrsScheduler,
  extendComposedStudySession,
} from 'olea-core';
import { describe, expect, it } from 'vitest';
import type { ObsidianDataHost } from '../../src/plan/settings-store.js';
import { STUDY_PLAN_SETTINGS_STORAGE_KEY } from '../../src/plan/settings-store.js';
import { DEFAULT_SESSION_BUDGET_MINUTES } from '../../src/session-builder/copy.js';
import { composeStudySessionForRequest } from '../../src/session-builder/provider.js';
import { memoryVault } from '../review/memory-vault.js';

const DEVICE = 'olea-testdevice1';
const NOW = new Date('2026-08-10T09:00:00-04:00');
const COURSE = 'TESTC101';
const ASSIGNMENTS_BASE_PATH = '02 Assignments/Assignments.base';
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

/** `session-builder/provider.spec.ts`/`composed-review-path.spec.ts`'s own fake, reused as-is. */
class FakeSettingsHost implements ObsidianDataHost {
  private blob: unknown = {
    [STUDY_PLAN_SETTINGS_STORAGE_KEY]: { version: 1, assignmentsBasePath: ASSIGNMENTS_BASE_PATH },
  };
  async loadData(): Promise<unknown> {
    return this.blob;
  }
  async saveData(data: unknown): Promise<void> {
    this.blob = data;
  }
}

/**
 * `count` never-reviewed Q&A cards, one per concept, all in one course, all
 * invented (INV-3) — enough of them (well past three
 * `DEFAULT_SESSION_BUDGET_MINUTES`-sized widenings' worth, at the "qa" type's
 * 45-second assumed duration) that a THIRD widening still has real, eligible
 * material left to add, so a reconstruction that fails to widen further is
 * distinguishable from one that has simply run out of candidates.
 */
function manyConceptVault(count: number): ReturnType<typeof memoryVault> {
  const files: Record<string, string> = {
    [ASSIGNMENTS_BASE_PATH]: BASE_FILE,
    '02 Assignments/Quiz 1.md': `---\nclass: ${COURSE}\ntype: Quiz\nweight: 10\ndue: 2026-09-01\nstatus: upcoming\n---\n\n# Quiz 1\n`,
  };
  // `composed-review-path.spec.ts`'s own finding (this file's module doc):
  // a concept only becomes a ranked `GapRow` — and so only reaches
  // composition at all — once an assessment cites it. One past paper, one
  // invented question per concept, is the cheapest way to give all `count`
  // concepts a citation without `count` separate assessment files.
  const questions: string[] = [];
  for (let i = 0; i < count; i++) {
    const concept = `Outrun concept ${i}`;
    files[`05 Zettelkasten/${concept}.md`] = `# ${concept}\n`;
    files[`Notes/outrun-note-${i}.md`] = [
      '---',
      `topic: [${concept}]`,
      `course: ${COURSE}`,
      '---',
      '',
      `Outrun front ${i}::Outrun back ${i}`,
      '',
    ].join('\n');
    questions.push(
      `## Question ${i + 1} (10 marks)\n\nExplain the core mechanism behind ${concept} and why it matters.\n`,
    );
  }
  files[`03 Research/${COURSE} Past Paper 2023.md`] = [
    '---',
    'role: past-paper',
    `course: ${COURSE}`,
    '---',
    '',
    `# ${COURSE} Past Paper — 2023`,
    '',
    ...questions,
  ].join('\n');
  return memoryVault(files);
}

/** The minimal, real deps `main.ts`'s `composeDefaultStudySession`/`extendDefaultStudySession` assemble — `composed-review-path.spec.ts`'s own `realComposeDefaultStudySession` pattern. */
function composeDeps(vault: ReturnType<typeof memoryVault>) {
  return {
    vault,
    deviceId: DEVICE,
    settingsHost: new FakeSettingsHost(),
    now: () => NOW,
    scheduler: createFsrsScheduler(),
  };
}

async function composeInitial(
  vault: ReturnType<typeof memoryVault>,
): Promise<ComposedStudySession> {
  const result = await composeStudySessionForRequest(
    composeDeps(vault),
    { budgetMinutes: DEFAULT_SESSION_BUDGET_MINUTES },
    NOW,
  );
  if (result === null) throw new Error('expected a composed session (study plan not configured?)');
  const composed = result.composed.full;
  if (composed === null) throw new Error('expected a non-empty composed session');
  return composed;
}

/**
 * Reproduces `main.ts`'s `extendDefaultStudySession`, line for line, up to
 * the one line this bead's defect and fix disagree about: the returned
 * session's own reconstruction. `persistWidenedBudget` selects which of the
 * two reconstructions to return — `false` is today's actual `main.ts`
 * source (`test/main-wiring.spec.ts`'s `ol-egov.141.89.10.4` block pins that
 * this is what it says today), `true` is the fix.
 *
 * `courseOrTopic` is pinned inline to `previous.dominantCourse` rather than
 * through `frozenCourseOrTopicFilter` — this suite's fixture is one course,
 * so re-deriving that already-separately-tested pin would add fixture
 * complexity this bead's own regression does not need; the two functions
 * agree exactly on a single-course composition.
 */
async function simulateExtend(
  vault: ReturnType<typeof memoryVault>,
  previous: ComposedStudySession,
  persistWidenedBudget: boolean,
): Promise<ComposedStudySession | null> {
  const courseOrTopic =
    previous.dominantCourse === undefined
      ? undefined
      : ({ kind: 'course', label: previous.dominantCourse } as const);
  const result = await composeStudySessionForRequest(
    composeDeps(vault),
    {
      budgetMinutes: DEFAULT_SESSION_BUDGET_MINUTES,
      ...(courseOrTopic !== undefined ? { courseOrTopic } : {}),
    },
    NOW,
  );
  if (result === null) return null;

  const widerBudgetMinutes = previous.model.budgetMinutes + DEFAULT_SESSION_BUDGET_MINUTES;
  const items = extendComposedStudySession(
    { ...result.composedInput, budgetMinutes: widerBudgetMinutes },
    previous,
  );
  return persistWidenedBudget
    ? { ...previous, model: { ...previous.model, budgetMinutes: widerBudgetMinutes, items } }
    : { ...previous, model: { ...previous.model, items } };
}

describe('ol-egov.141.89.10.4: a second outrun-the-target extend, proved through the real composer and extend functions', () => {
  it("today's reconstruction (persistWidenedBudget: false): the first extend widens, but model.budgetMinutes is never updated on the returned session", async () => {
    const vault = manyConceptVault(100);
    const session0 = await composeInitial(vault);

    const afterFirst = await simulateExtend(vault, session0, false);
    if (afterFirst === null) throw new Error('expected the first extend to widen the session');
    expect(afterFirst.model.items.length).toBeGreaterThan(session0.model.items.length);

    // The defect, isolated: the returned session's own budgetMinutes did not
    // move, even though this extend just composed at a wider one.
    expect(afterFirst.model.budgetMinutes).toBe(session0.model.budgetMinutes);
  });

  it("today's reconstruction (persistWidenedBudget: false): a SECOND outrun then lands on the identical wider budget the first one already used, and appends nothing new — FAILS the clause's 'she can keep outrunning it' posture", async () => {
    const vault = manyConceptVault(100);
    const session0 = await composeInitial(vault);
    const afterFirst = await simulateExtend(vault, session0, false);
    if (afterFirst === null) throw new Error('expected the first extend to widen the session');

    const afterSecond = await simulateExtend(vault, afterFirst, false);
    if (afterSecond === null) throw new Error('expected the second extend to run');

    // This is the bug, stated as the failing assertion the fix must clear:
    // the second "keep going" should add MORE than the first (there are 100
    // eligible concepts, far more than three widening steps can exhaust),
    // but with today's reconstruction it adds exactly zero.
    expect(afterSecond.model.items.length).toBe(afterFirst.model.items.length);
  });

  it('the fix (persistWidenedBudget: true): budgetMinutes carries the widened figure forward, so a second outrun computes a genuinely wider budget and keeps appending', async () => {
    const vault = manyConceptVault(100);
    const session0 = await composeInitial(vault);

    const afterFirst = await simulateExtend(vault, session0, true);
    if (afterFirst === null) throw new Error('expected the first extend to widen the session');
    expect(afterFirst.model.budgetMinutes).toBe(
      session0.model.budgetMinutes + DEFAULT_SESSION_BUDGET_MINUTES,
    );

    const afterSecond = await simulateExtend(vault, afterFirst, true);
    if (afterSecond === null) throw new Error('expected the second extend to widen further');
    expect(afterSecond.model.budgetMinutes).toBe(
      session0.model.budgetMinutes + 2 * DEFAULT_SESSION_BUDGET_MINUTES,
    );
    expect(afterSecond.model.items.length).toBeGreaterThan(afterFirst.model.items.length);
  });
});
