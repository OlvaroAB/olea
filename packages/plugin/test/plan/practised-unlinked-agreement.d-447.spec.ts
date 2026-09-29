/**
 * `[D-447]` option (b), ruled 2026-09-29 (row 27 of the decision-sheet rulings): an otherwise
 * eligible course concept does not disappear from ordinary course planning because assessment
 * alignment is incomplete. `olea-core`'s `composeOracleRanking` admits a concept she has practised
 * that no assessment reaches, at the need-only treatment, for a caller that opts in
 * (`ol-egov.141.89.10.96`). The session composition opted in; the cached plan did not, so the plan
 * Home reads (its per-course allocation, its quiet line, the queue order, the top-band signal) reads
 * such a course as abstained while the session Start composes ranks its practised concepts.
 *
 * **The plan CANNOT take the door yet, and this file is where that is pinned
 * (`ol-egov.141.89.10.99`).** Opting the plan in was built and run: `buildStudyPlan` then throws on
 * every refresh, because `packages/contracts/src/study-plan.ts` requires each planned concept to
 * carry at least one citation ("a ranked concept with no evidence is the case that abstains", a
 * line older than `[D-329]`), and an admitted concept has none by design (unknown relevance, no
 * citation). `refreshStudyPlan` swallows the throw and keeps the old plan, so the plan would stop
 * refreshing for as long as any practised, unlinked concept existed. Loosening that schema is a
 * contract amendment (a persisted, vendored schema): not this lane's, and not taken here.
 *
 * So the file has three parts:
 *
 *  - the SESSION side, live: the composed session ranks the practised concept, and only it, on the
 *    course shape where the door is the only thing eligible. This is the reference the plan must
 *    agree with, and it protects the session's own opt-in;
 *  - the PLAN side, written first and marked `it.fails` with the blocker named: what the plan must
 *    do once its artifact can carry an entry with no citation (rank it, agree with the session, let
 *    the allocation inputs read her practice). Each goes red the day the plan can do it, which is
 *    the signal to remove `.fails` (and to add `admitPractisedUnlinkedConcepts: true` to
 *    `plan/provider.ts`'s `composeOracleRanking` call, if that has not been done);
 *  - the plan as it stands, live: unchanged with no practice, and no course with no assessment
 *    record is touched (`[D-373]`'s door, which is a separate question).
 *
 * Home is not a separate composition. `home/provider.ts` builds its headline session with
 * `createLocalSessionBuilderProvider` over the same `plan` thunk, which calls
 * `composeStudySessionForRequest` — the session this file composes.
 *
 * Every course code, concept name, path and question below is invented (INV-3).
 */
import type { StudyPlanEnvelope } from 'olea-contracts';
import { studyPlanEnvelope } from 'olea-contracts';
import type { VaultInstrumentRecord } from 'olea-core';
import { createFsrsScheduler, enumerateVaultInstruments } from 'olea-core';
import { describe, expect, it } from 'vitest';
import { createLocalStudyPlanProvider } from '../../src/plan/provider.js';
import type { ObsidianDataHost } from '../../src/plan/settings-store.js';
import { STUDY_PLAN_SETTINGS_STORAGE_KEY } from '../../src/plan/settings-store.js';
import { DEFAULT_SESSION_BUDGET_MINUTES } from '../../src/session-builder/copy.js';
import { composeStudySessionForRequest } from '../../src/session-builder/provider.js';
import { memoryVault } from '../review/memory-vault.js';

const DEVICE = 'olea-testdevice1';
const COURSE = 'TESTC101';
const BASE_PATH = '02 Assignments/Assignments.base';
const NOW = new Date('2026-08-10T09:00:00-04:00');

class FakeDataHost implements ObsidianDataHost {
  blob: unknown = {
    [STUDY_PLAN_SETTINGS_STORAGE_KEY]: { version: 1, assignmentsBasePath: BASE_PATH },
  };
  async loadData(): Promise<unknown> {
    return this.blob;
  }
  async saveData(data: unknown): Promise<void> {
    this.blob = data;
  }
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

const QUIZ = (course: string): string =>
  `---\nclass: ${course}\ntype: Quiz\nweight: 10\ndue: 2026-09-01\nstatus: upcoming\n---\n\n# Quiz 1\n`;

const PAST_PAPER = [
  '---',
  'role: past-paper',
  `course: ${COURSE}`,
  '---',
  '',
  `# ${COURSE} Past Paper 2023`,
  '',
  '## Question 1 (10 marks)',
  '',
  'Explain the core mechanism behind Widget theory and why it matters.',
  '',
].join('\n');

const note = (topic: string, front: string): string =>
  ['---', `topic: [${topic}]`, `course: ${COURSE}`, '---', '', `${front}::Back`, ''].join('\n');

/**
 * One course with an assessment record, three concepts each with one card: Widget theory (a past
 * paper cites it, so an assessment edge reaches it), Gadget lore (no edge) and Sprocket craft (no
 * edge). `linked: false` drops the past paper, so no concept has an edge and the course, without
 * the door, has nothing to rank.
 */
function vaultOf(options: { readonly linked: boolean }) {
  return memoryVault({
    '05 Zettelkasten/Widget theory.md': '# Widget theory\n',
    '05 Zettelkasten/Gadget lore.md': '# Gadget lore\n',
    '05 Zettelkasten/Sprocket craft.md': '# Sprocket craft\n',
    'Notes/widget.md': note('Widget theory', 'Widget front'),
    'Notes/gadget.md': note('Gadget lore', 'Gadget front'),
    'Notes/sprocket.md': note('Sprocket craft', 'Sprocket front'),
    ...(options.linked ? { [`03 Research/${COURSE} Past Paper 2023.md`]: PAST_PAPER } : {}),
    [BASE_PATH]: BASE_FILE,
    '02 Assignments/Quiz 1.md': QUIZ(COURSE),
  });
}

async function instrumentAt(
  vault: ReturnType<typeof memoryVault>,
  notePath: string,
): Promise<VaultInstrumentRecord> {
  // Stamped, as the plan's and the session's own walks are (`[D-357]`): a record names its concept
  // by the permanent key her review log carries.
  const enumeration = await enumerateVaultInstruments(vault, {
    concepts: { stampConceptKeys: true },
  });
  const record = enumeration.records.find((r) => r.notePath === notePath);
  if (record === undefined) throw new Error(`expected ${notePath} to enumerate as an instrument`);
  return record;
}

/** One independent, rated success on the instrument, the day before `NOW`. */
async function practise(
  vault: ReturnType<typeof memoryVault>,
  record: VaultInstrumentRecord,
): Promise<void> {
  await vault.write(
    `.olea/reviews/2026-08-09.${DEVICE}.jsonl`,
    `${JSON.stringify({
      schemaVersion: 6,
      kind: 'review',
      eventId: `r-${record.instrumentId}`,
      timestamp: '2026-08-09T09:00:00-04:00',
      instrumentId: record.instrumentId,
      instrumentType: record.instrumentType,
      conceptIds: [...record.conceptIds],
      rating: 'good',
      supportLevelShown: 'independent',
      wasUnsure: false,
      durationMs: 1200,
      selectionContext: {
        dueState: 'due',
        examProximity: null,
        yieldRank: null,
        instrumentTypesOffered: [record.instrumentType],
        planVersion: null,
      },
    })}\n`,
  );
}

function conceptKeyOf(record: VaultInstrumentRecord): string {
  const key = record.conceptIds[0];
  if (key === undefined) throw new Error('expected the instrument to carry a concept key');
  return key;
}

async function fetchPlan(
  vault: ReturnType<typeof memoryVault>,
  extra: Partial<Parameters<typeof createLocalStudyPlanProvider>[0]> = {},
): Promise<StudyPlanEnvelope> {
  return studyPlanEnvelope.parse(
    await createLocalStudyPlanProvider({
      vault,
      deviceId: DEVICE,
      settingsHost: new FakeDataHost(),
      now: () => NOW,
      ...extra,
    }).fetchPlan(),
  );
}

function planCourse(plan: StudyPlanEnvelope, course: string) {
  const found = plan.body.courses.find((c) => c.course === course);
  if (found === undefined) throw new Error(`expected ${course} in the plan`);
  return found;
}

/** The concept keys the plan ranks for a course, sorted; `[]` for an abstained course. */
function plannedKeys(plan: StudyPlanEnvelope, course: string): readonly string[] {
  const found = planCourse(plan, course);
  if (found.status !== 'ranked') return [];
  return found.concepts.map((c) => c.conceptId).sort();
}

/** The concept keys the composed session ranks for a course (the rows it fills from), sorted. */
async function sessionKeys(
  vault: ReturnType<typeof memoryVault>,
  plan: StudyPlanEnvelope | null,
  course: string,
): Promise<readonly string[]> {
  const result = await composeStudySessionForRequest(
    {
      vault,
      deviceId: DEVICE,
      settingsHost: new FakeDataHost(),
      now: () => NOW,
      scheduler: createFsrsScheduler(),
      ...(plan !== null ? { plan: () => plan } : {}),
    },
    { budgetMinutes: DEFAULT_SESSION_BUDGET_MINUTES },
    NOW,
  );
  if (result === null) throw new Error('expected a composed result (plan not configured)');
  return result.composedInput.rows
    .filter((row) => row.course === course)
    .map((row) => row.conceptKey)
    .sort();
}

describe('the composed session ranks a practised concept no assessment reaches — the reference the plan must agree with ([D-447] option (b))', () => {
  it('on a course where only practised, unlinked concepts are eligible, the session ranks exactly the practised one', async () => {
    // No past paper: no concept has an edge, so without the door this course ranks nothing.
    const vault = vaultOf({ linked: false });
    const gadget = await instrumentAt(vault, 'Notes/gadget.md');
    await practise(vault, gadget);

    // Exactly the practised concept: the never-practised ones (Widget, Sprocket) stay out.
    expect(await sessionKeys(vault, null, COURSE)).toEqual([conceptKeyOf(gadget)]);
  });

  it('with no practice at all it ranks nothing there', async () => {
    const vault = vaultOf({ linked: false });

    expect(await sessionKeys(vault, null, COURSE)).toEqual([]);
  });
});

describe('the cached plan today: blocked on the plan contract, so it does not take the D-447 door (ol-egov.141.89.10.99)', () => {
  it('with no practice the plan is what it was: only the linked concept is planned', async () => {
    const vault = vaultOf({ linked: true });
    const widget = await instrumentAt(vault, 'Notes/widget.md');

    expect(plannedKeys(await fetchPlan(vault), COURSE)).toEqual([conceptKeyOf(widget)]);
  });

  it('a course where nothing is practised abstains in the plan and the session ranks nothing for it', async () => {
    const vault = vaultOf({ linked: false });

    const plan = await fetchPlan(vault);
    expect(planCourse(plan, COURSE).status).toBe('abstained');
    expect(await sessionKeys(vault, plan, COURSE)).toEqual([]);
  });

  it("does not open `[D-373]`'s door either: a course with no assessment record at all is not in the plan, practice or not", async () => {
    // No assessment note and no Base row for this course: serving it on need alone is a separate
    // question, and is not opened by anything in this file.
    const vault = memoryVault({
      '05 Zettelkasten/Gadget lore.md': '# Gadget lore\n',
      'Notes/gadget.md': note('Gadget lore', 'Gadget front'),
      '05 Zettelkasten/Widget theory.md': '# Widget theory\n',
      'Notes/widget.md': note('Widget theory', 'Widget front'),
      [`03 Research/${COURSE} Past Paper 2023.md`]: PAST_PAPER,
      [BASE_PATH]: BASE_FILE,
      // The only assessment record belongs to another course, so COURSE has none.
      '02 Assignments/Quiz 1.md': QUIZ('TESTD200'),
    });
    await practise(vault, await instrumentAt(vault, 'Notes/gadget.md'));

    const plan = await fetchPlan(vault);
    expect(plan.body.courses.map((c) => c.course)).not.toContain(COURSE);
  });
});

/**
 * Written first, expected to fail until the plan artifact can carry a concept with no citation.
 * `it.fails` passes while its body fails and goes red once the body passes, so a fix cannot land
 * unnoticed and these cannot rot green-by-skip.
 */
describe('the cached plan admits a practised concept no assessment reaches ([D-447] option (b)) — EXPECTED TO FAIL until ol-egov.141.89.10.99 is unblocked', () => {
  it.fails('ranks it at unknown relevance beside a linked concept, which keeps its evidence-based entry; a never-practised unlinked concept stays out', async () => {
    const vault = vaultOf({ linked: true });
    const widget = await instrumentAt(vault, 'Notes/widget.md');
    const gadget = await instrumentAt(vault, 'Notes/gadget.md');
    const sprocket = await instrumentAt(vault, 'Notes/sprocket.md');
    await practise(vault, gadget);

    const course = planCourse(await fetchPlan(vault), COURSE);
    if (course.status !== 'ranked') throw new Error('expected the course to rank');

    const byKey = new Map(course.concepts.map((c) => [c.conceptId, c]));
    const gadgetEntry = byKey.get(conceptKeyOf(gadget));
    // `[D-329]`'s unknown-relevance entry: no citation, no nearest assessment claimed.
    expect(gadgetEntry).toBeDefined();
    expect(gadgetEntry?.citations).toEqual([]);
    expect(gadgetEntry?.examProximityDays).toBeNull();

    // The linked concept is what it was: cited by the past paper.
    expect(byKey.get(conceptKeyOf(widget))?.citations.length).toBeGreaterThan(0);

    // The ruling names practised concepts: an unlinked one she never practised is not planned.
    expect(byKey.has(conceptKeyOf(sprocket))).toBe(false);
  });

  it.fails('a course where only practised, unlinked concepts are eligible ranks in the plan, and the plan and the session agree on it', async () => {
    const vault = vaultOf({ linked: false });
    const gadget = await instrumentAt(vault, 'Notes/gadget.md');
    await practise(vault, gadget);

    const plan = await fetchPlan(vault);
    expect(planCourse(plan, COURSE).status).toBe('ranked');

    const fromPlan = plannedKeys(plan, COURSE);
    expect(fromPlan).toEqual([conceptKeyOf(gadget)]);

    // The session Start composes, handed the very plan Home would read from the cache.
    expect(await sessionKeys(vault, plan, COURSE)).toEqual(fromPlan);
  });

  it.fails('the allocation inputs the plan sends read her practice on the admitted concept; an abstained course reads none', async () => {
    const requested: Array<
      readonly { readonly courseId: string; readonly evidenceVolume: number }[]
    > = [];
    const readPlanPolicy: NonNullable<
      Parameters<typeof createLocalStudyPlanProvider>[0]['readPlanPolicy']
    > = async (request) => {
      requested.push(request.courses);
      return {
        asOf: request.asOf,
        rankWeights: {
          proximityHalfLifeDays: 14,
          assessmentWeightDivisor: 40,
          masteryNeedWeight: { seed: 1, sprout: 1, sapling: 1, tree: 1, unknown: 1 },
        },
        allocation: request.courses.map((c) => ({
          courseId: c.courseId,
          share: 1 / request.courses.length,
          minBlockSeconds: 180,
          contributions: [{ name: 'risk', value: 1 }],
          reason: 'a fixed share, for this test only.',
        })),
        floorsFundable: true,
      };
    };

    const practised = vaultOf({ linked: false });
    await practise(practised, await instrumentAt(practised, 'Notes/gadget.md'));
    await fetchPlan(practised, { readPlanPolicy });

    const idle = vaultOf({ linked: false });
    await fetchPlan(idle, { readPlanPolicy });

    const volumeOf = (call: (typeof requested)[number] | undefined): number | undefined =>
      call?.find((c) => c.courseId === COURSE)?.evidenceVolume;
    expect(volumeOf(requested[0])).toBeGreaterThan(0);
    expect(volumeOf(requested[1])).toBe(0);
  });
});
