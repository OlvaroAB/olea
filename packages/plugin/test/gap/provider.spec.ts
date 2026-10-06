/**
 * `createLocalGapProvider` tests (`ol-2tyj`).
 *
 * Every fixture string here is INVENTED — course codes, concept names,
 * question text — per INV-3; nothing below is drawn from a real vault. The
 * base fixture is the gap-view twin of `plan/provider.spec.ts`'s own —
 * deliberately, since both compose over `composeOracleRanking` and this suite
 * is not re-testing that module's or `buildGapView`'s own acceptance
 * criteria a second time. What it tests is the WIRING this bead adds: the
 * settings gate, the two concurrent vault walks, the join between them, and
 * the honest pass-through of `sourceCoverage` into `model.scope`.
 */
import { studyPlanEnvelope } from 'olea-contracts';
import type { PaperDemand, Scheduler } from 'olea-core';
import {
  addManualAssessmentEntry,
  createFsrsScheduler,
  daysBetween,
  enumerateVaultInstruments,
  extractConcepts,
  instrumentTargetStorePath,
  questionBindingOf,
  type RetrievabilityInput,
  type RetrievabilityOutput,
  writeInstrumentTarget,
} from 'olea-core';
import { describe, expect, it } from 'vitest';
import {
  ASSESSMENT_BRIEF_ATTRIBUTION_CLAUSE,
  gapRowBasisKey,
  gapRowLine,
  masteryGapLine,
  masteryGapMeta,
  masteryGapNarrative,
  OBJECTIVES_ATTRIBUTION_CLAUSE,
  rankedCourseFraming,
  readinessNote,
} from '../../src/gap/copy.js';
import { createLocalGapProvider } from '../../src/gap/provider.js';
import { createLocalStudyPlanProvider } from '../../src/plan/provider.js';
import type { ObsidianDataHost } from '../../src/plan/settings-store.js';
import { STUDY_PLAN_SETTINGS_STORAGE_KEY } from '../../src/plan/settings-store.js';
import { memoryVault } from '../review/memory-vault.js';

/**
 * A `Scheduler` whose `retrievability` always answers the same fixed
 * probability, regardless of the instrument or state it is asked about —
 * the identical helper `plan/provider.spec.ts` uses for the same C5.6/
 * `[D-264]` wiring proof, mirrored here rather than imported (test-only,
 * no shared module owns it).
 */
function fixedRetrievabilityScheduler(recallProbability: number): Scheduler {
  const real = createFsrsScheduler();
  return {
    schedule: (input) => real.schedule(input),
    retrievability(input: RetrievabilityInput): RetrievabilityOutput {
      return { instrumentId: input.instrumentId, recallProbability };
    },
  };
}

const DEVICE = 'olea-testdevice1';
const BASE_PATH = '02 Assignments/Assignments.base';

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

const QUIZ_DUE = '2026-09-01';
const QUIZ = `---\nclass: TESTC101\ntype: Quiz\nweight: 10\ndue: ${QUIZ_DUE}\nstatus: upcoming\n---\n\n# Quiz 1\n`;

/**
 * `[D-410]`: every fixture row below carries one edge to `QUIZ`, so its
 * concept-level `proximityScore` (the highest `examProximityScore` across
 * surviving edges) is this one value — computed the same way
 * `rank.ts`'s `computeExamProximityScore` does (`1 / (1 + daysUntilDue /
 * proximityHalfLifeDays)`), from the fixture's own `due` date and the
 * `now` each test supplies, rather than a pasted result. `14` is
 * `rank.ts`'s `DECLARED_FALLBACK_PROXIMITY_HALF_LIFE_DAYS` — every test
 * below relies on the declared fallback (no `readRankWeights`/`options`
 * override supplies a different half-life).
 */
function quizProximityScore(now: Date): number {
  const daysUntilDue = daysBetween(now, new Date(`${QUIZ_DUE}T00:00:00.000Z`));
  const DECLARED_FALLBACK_PROXIMITY_HALF_LIFE_DAYS = 14;
  return 1 / (1 + daysUntilDue / DECLARED_FALLBACK_PROXIMITY_HALF_LIFE_DAYS);
}

/**
 * One course, one cited concept, one note carrying both the topic binding
 * and a real instrument — so `buildMaterialPresence`'s `instrumentCount` is
 * exercised, not just its `notePaths` half.
 */
function gapVault() {
  return memoryVault({
    '05 Zettelkasten/Widget theory.md': '# Widget theory\n',
    'Notes/one.md': [
      '---',
      'topic: [Widget theory]',
      'course: TESTC101',
      '---',
      '',
      'Front::Back',
      '',
    ].join('\n'),
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
    '02 Assignments/Quiz 1.md': QUIZ,
  });
}

describe('createLocalGapProvider — not configured', () => {
  it('returns "unavailable" rather than a fabricated model when no Base path is set', async () => {
    const provider = createLocalGapProvider({
      vault: gapVault(),
      deviceId: DEVICE,
      settingsHost: new FakeDataHost(),
      now: () => new Date('2026-08-10T09:00:00-04:00'),
    });

    const state = await provider.load();
    expect(state.kind).toBe('unavailable');
  });
});

describe('createLocalGapProvider — configured', () => {
  it('composes a real GapViewModel, with the row classified by what her material holds and the scope rendered honestly', async () => {
    const provider = createLocalGapProvider({
      vault: gapVault(),
      deviceId: DEVICE,
      settingsHost: hostWithBasePath(BASE_PATH),
      now: () => new Date('2026-08-10T09:00:00-04:00'),
    });

    const state = await provider.load();
    expect(state.kind).toBe('model');
    if (state.kind !== 'model') throw new Error('expected a model');

    const course = state.model.courses.find((c) => c.course === 'TESTC101');
    expect(course?.status).toBe('ranked');
    if (course?.status !== 'ranked') throw new Error('expected TESTC101 to rank');

    const row = course.rows.find((r) => r.conceptName === 'Widget theory');
    expect(row).toBeDefined();
    // She has a topic-bound note AND a card on it — never a material-gap
    // (F4.10) or a coverage-gap (F4.5); this is F4.3's "you know it badly"
    // class by elimination, since nothing has been reviewed yet.
    expect(row?.gapClass).toBe('mastery-gap');
    expect(row?.notePaths).toEqual(['Notes/one.md']);
    expect(row?.instrumentCount).toBe(1);

    // ol-cvsc: the one source (the past paper) was actually read, so the
    // scope grants the exhaustiveness claim — this is the assertion the
    // N-013 mutation (see the task report) turns red when the
    // `sourceCoverage` pass-through is deleted.
    expect(state.model.scope.sources).toHaveLength(1);
    expect(state.model.scope.canStateExhaustiveness).toBe(true);
  });

  it('a fresh install with no review log yet still composes a model — mastery reads new, not unknown', async () => {
    const provider = createLocalGapProvider({
      vault: gapVault(),
      deviceId: DEVICE,
      settingsHost: hostWithBasePath(BASE_PATH),
      now: () => new Date('2026-08-10T09:00:00-04:00'),
    });

    const state = await provider.load();
    if (state.kind !== 'model') throw new Error('expected a model');
    const course = state.model.courses.find((c) => c.course === 'TESTC101');
    if (course?.status !== 'ranked') throw new Error('expected TESTC101 to rank');
    const row = course.rows.find((r) => r.conceptName === 'Widget theory');
    expect(row?.masteryState).toBe('seed');
  });

  it('a vault that throws mid-walk resolves to "unavailable", not a crash', async () => {
    const vault = gapVault();
    const originalList = vault.list.bind(vault);
    let calls = 0;
    vault.list = async (options) => {
      calls += 1;
      if (calls > 1) throw new Error('simulated read failure');
      return originalList(options);
    };

    const provider = createLocalGapProvider({
      vault,
      deviceId: DEVICE,
      settingsHost: hostWithBasePath(BASE_PATH),
      now: () => new Date('2026-08-10T09:00:00-04:00'),
    });

    const state = await provider.load();
    expect(state.kind).toBe('unavailable');
  });
});

describe('createLocalGapProvider — the concept-name join is case-sensitive on both sides (R1/R2), and ol-5y40 fixes it at the composition seam', () => {
  it('a topic value that does not byte-match her Zettelkasten note title still resolves as her material — never a false material-gap', async () => {
    // Her Zettelkasten note is titled "Widget Theory" (capital W, capital
    // T) — the vocabulary `composeOracleRanking`'s tier-3 pass matches
    // against by default (`concept/evidence.ts`'s `zettelVocabulary`,
    // titles verbatim). Her `topic:` property on the note that actually
    // carries the card reads "widget theory" (all lowercase) — a plausible
    // authoring slip, not a wikilink. `extractConcepts`'s tier-1 binding
    // (`resolveTitle`) requires an exact string match, so this topic value
    // binds to NOTHING and the concept record is minted at tier 2, named
    // "widget theory" verbatim (R1/R2: never case-folded — the extraction
    // side of this is untouched by the fix below).
    //
    // The past paper cites "Widget Theory" (matching her note's title).
    // `findMentionedTerms` matches case-insensitively but returns the
    // VOCABULARY's own casing (R2), so the resulting edge — and therefore
    // the ranking's `conceptName` — is "Widget Theory", not "widget theory".
    //
    // `evidence-edge/build.ts`'s name→key lookup is exact-match, so it would
    // otherwise miss and fall back to "Widget Theory" as the (wrong) key —
    // which never matches `buildMaterialPresence`'s map (keyed by the real
    // `ConceptRecord.key`), reading as a material-gap (F4.10) even though
    // `Notes/one.md` is right there. `ol-5y40`'s fix
    // (`oracle/compose.ts`'s `resolveCaseInsensitiveConceptKeys`) repairs
    // exactly this fallback, case- and course-scoped, before the edge ever
    // reaches `rankOracle` or `buildMaterialPresence` — so this row now
    // reads the same as the base fixture's exact-case case: she has a
    // topic-bound note AND a card on it, `mastery-gap` by elimination.
    const vault = memoryVault({
      '05 Zettelkasten/Widget Theory.md': '# Widget Theory\n',
      'Notes/one.md': [
        '---',
        'topic: widget theory',
        'course: TESTC101',
        '---',
        '',
        'Front::Back',
        '',
      ].join('\n'),
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
        'Explain the core mechanism behind Widget Theory and why it matters.',
        '',
      ].join('\n'),
      [BASE_PATH]: BASE_FILE,
      '02 Assignments/Quiz 1.md': QUIZ,
    });

    const provider = createLocalGapProvider({
      vault,
      deviceId: DEVICE,
      settingsHost: hostWithBasePath(BASE_PATH),
      now: () => new Date('2026-08-10T09:00:00-04:00'),
    });

    const state = await provider.load();
    if (state.kind !== 'model') throw new Error('expected a model');
    const course = state.model.courses.find((c) => c.course === 'TESTC101');
    if (course?.status !== 'ranked') throw new Error('expected TESTC101 to rank');

    const row = course.rows.find((r) => r.conceptName === 'Widget Theory');
    expect(row).toBeDefined();
    // The fix: never the alarming, wrong "we don't have it" reading — she
    // has a topic-bound note AND a card on it, so this is F4.3's
    // "you know it badly" class by elimination, exactly as the base fixture
    // (`createLocalGapProvider — configured`, above) reads when the casing
    // matches byte-for-byte.
    expect(row?.gapClass).toBe('mastery-gap');
    expect(row?.notePaths).toEqual(['Notes/one.md']);
    expect(row?.instrumentCount).toBe(1);
  });

  it('a genuinely distinct concept in a DIFFERENT course, sharing a name only by casefold, is never collapsed onto it', async () => {
    // Two DIFFERENT courses each author their own case variant of the same
    // casefolded topic string — R1/R2 mints two distinct `ConceptRecord`s
    // for "widget theory" (TESTC101) and "WIDGET THEORY" (OTHERC202), since
    // they are not byte-identical. Only TESTC101 has a past paper, citing
    // "Widget Theory" (matching the Zettelkasten note's own casing, neither
    // note's exact topic casing). A fold that matched on casefolded name
    // ALONE — ignoring course — would resolve the TESTC101 edge onto
    // whichever concept happened to be inserted last into the lookup map
    // (here, OTHERC202's), pulling OTHERC202's note into TESTC101's row.
    // The course-scoped fallback (`oracle/compose.ts`'s
    // `resolveCaseInsensitiveConceptKeys`) must resolve it onto TESTC101's
    // own record only.
    const vault = memoryVault({
      '05 Zettelkasten/Widget Theory.md': '# Widget Theory\n',
      'Notes/one.md': [
        '---',
        'topic: widget theory',
        'course: TESTC101',
        '---',
        '',
        'Front::Back',
        '',
      ].join('\n'),
      'Notes/other.md': [
        '---',
        'topic: WIDGET THEORY',
        'course: OTHERC202',
        '---',
        '',
        'A different, unrelated card::for a different course',
        '',
      ].join('\n'),
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
        'Explain the core mechanism behind Widget Theory and why it matters.',
        '',
      ].join('\n'),
      [BASE_PATH]: BASE_FILE,
      '02 Assignments/Quiz 1.md': QUIZ,
    });

    const provider = createLocalGapProvider({
      vault,
      deviceId: DEVICE,
      settingsHost: hostWithBasePath(BASE_PATH),
      now: () => new Date('2026-08-10T09:00:00-04:00'),
    });

    const state = await provider.load();
    if (state.kind !== 'model') throw new Error('expected a model');
    const course = state.model.courses.find((c) => c.course === 'TESTC101');
    if (course?.status !== 'ranked') throw new Error('expected TESTC101 to rank');

    const row = course.rows.find((r) => r.conceptName === 'Widget Theory');
    expect(row).toBeDefined();
    // Resolves onto TESTC101's own note, not OTHERC202's — the course-scoped
    // match, not a bare name-only fold.
    expect(row?.gapClass).toBe('mastery-gap');
    expect(row?.notePaths).toEqual(['Notes/one.md']);
  });
});

describe('createLocalGapProvider — threads the delivered rank weights ([D-110], ol-v7r5.55 [IL-D7])', () => {
  it('with readRankWeights absent, composes with the declared fallback (blend weights 1, 1 and 1)', async () => {
    const now = new Date('2026-08-10T09:00:00-04:00');
    const provider = createLocalGapProvider({
      vault: gapVault(),
      deviceId: DEVICE,
      settingsHost: hostWithBasePath(BASE_PATH),
      now: () => now,
    });

    const state = await provider.load();
    if (state.kind !== 'model') throw new Error('expected a model');
    const course = state.model.courses.find((c) => c.course === 'TESTC101');
    if (course?.status !== 'ranked') throw new Error('expected TESTC101 to rank');
    const row = course.rows.find((r) => r.conceptName === 'Widget theory');
    // She has no review log yet, so masteryState is 'seed' (see the "fresh
    // install" test above) and need is unknown, ordered at 1 ([D-348]); at
    // the declared fallback weights (1, 1, 1) `priorityScore` is relevance +
    // 1 + proximity ([D-410]).
    expect(row?.masteryState).toBe('seed');
    expect(row?.priorityScore).toBeGreaterThan(0);
    expect(row?.priorityScore).toBeCloseTo(
      (row?.assessmentRelevance ?? 0) + 1 + quizProximityScore(now),
      10,
    );
  });

  it('with readRankWeights delivering blend weights, the fallback is NOT taken — priorityScore uses the delivered need weight rather than the declared 1 ([D-332])', async () => {
    const now = new Date('2026-08-10T09:00:00-04:00');
    let calls = 0;
    const readRankWeights = async () => {
      calls += 1;
      return {
        masteryNeedWeight: { seed: 0.2, sprout: 0.2, sapling: 0.2, tree: 0.2, unknown: 0.2 },
        blendWeights: { relevance: 1, need: 0.2 },
      };
    };

    const fallbackProvider = createLocalGapProvider({
      vault: gapVault(),
      deviceId: DEVICE,
      settingsHost: hostWithBasePath(BASE_PATH),
      now: () => now,
    });
    const deliveredProvider = createLocalGapProvider({
      vault: gapVault(),
      deviceId: DEVICE,
      settingsHost: hostWithBasePath(BASE_PATH),
      now: () => now,
      readRankWeights,
    });

    const fallbackState = await fallbackProvider.load();
    const deliveredState = await deliveredProvider.load();
    if (fallbackState.kind !== 'model' || deliveredState.kind !== 'model') {
      throw new Error('expected models');
    }

    const fallbackCourse = fallbackState.model.courses.find((c) => c.course === 'TESTC101');
    const deliveredCourse = deliveredState.model.courses.find((c) => c.course === 'TESTC101');
    if (fallbackCourse?.status !== 'ranked' || deliveredCourse?.status !== 'ranked') {
      throw new Error('expected TESTC101 to rank in both');
    }

    const fallbackRow = fallbackCourse.rows.find((r) => r.conceptName === 'Widget theory');
    const deliveredRow = deliveredCourse.rows.find((r) => r.conceptName === 'Widget theory');

    // `readRankWeights` is read on every `load()`, not cached, mirroring
    // `plan/provider.ts`'s posture.
    expect(calls).toBe(1);
    // [D-332]: priority = relevance + need weight × need + proximity weight ×
    // proximity ([D-410]). With no review log, need is unknown and ordered at
    // 1 ([D-348]), so the delivered need weight (0.2) against the declared
    // fallback (1) must lower the score by exactly 0.8 — proving the
    // delivered options object, not the declared constants, drove the
    // arithmetic. (The delivered stage ladder moves nothing since [D-332].)
    // The delivered `blendWeights` supplies no `proximity`, so it still
    // resolves to the declared fallback (1) — same as the fallback run.
    expect(deliveredRow?.priorityScore).toBeCloseTo(
      (deliveredRow?.assessmentRelevance ?? 0) + 0.2 + quizProximityScore(now),
      10,
    );
    expect(deliveredRow?.priorityScore).toBeCloseTo((fallbackRow?.priorityScore ?? 0) - 0.8, 10);
    expect(deliveredRow?.priorityScore).not.toBeCloseTo(fallbackRow?.priorityScore ?? 0, 5);
  });

  it('with readRankWeights resolving undefined (unconfigured/offline/expired), still falls back to the declared constants', async () => {
    const readRankWeights = async () => undefined;
    const provider = createLocalGapProvider({
      vault: gapVault(),
      deviceId: DEVICE,
      settingsHost: hostWithBasePath(BASE_PATH),
      now: () => new Date('2026-08-10T09:00:00-04:00'),
      readRankWeights,
    });

    const baseline = await createLocalGapProvider({
      vault: gapVault(),
      deviceId: DEVICE,
      settingsHost: hostWithBasePath(BASE_PATH),
      now: () => new Date('2026-08-10T09:00:00-04:00'),
    }).load();

    const state = await provider.load();
    if (state.kind !== 'model' || baseline.kind !== 'model') throw new Error('expected models');
    const course = state.model.courses.find((c) => c.course === 'TESTC101');
    const baselineCourse = baseline.model.courses.find((c) => c.course === 'TESTC101');
    if (course?.status !== 'ranked' || baselineCourse?.status !== 'ranked') {
      throw new Error('expected TESTC101 to rank in both');
    }
    const row = course.rows.find((r) => r.conceptName === 'Widget theory');
    const baselineRow = baselineCourse.rows.find((r) => r.conceptName === 'Widget theory');
    expect(row?.priorityScore).toBeCloseTo(baselineRow?.priorityScore ?? -1, 10);
  });
});

/**
 * C5.6/`[D-264]` (`ol-egov.141.89.10.22`): before this bead, this call site
 * never passed `retrievability` to `composeOracleRanking` at all — every
 * concept's `retrievabilityWeight` read as the neutral default (1)
 * regardless of her real recall state, unlike `plan/provider.ts` and
 * `session-builder/provider.ts`, which already threaded it (`ol-v7r5.53`).
 * D-264 ruling 1 counts only an unaided (`'independent'` support) success as
 * eligible recall evidence, so every fixture below carries one.
 */
describe('createLocalGapProvider — threads retrievability into the ranking (C5.6/[D-264], ol-egov.141.89.10.22)', () => {
  const NOW = () => new Date('2026-08-10T09:00:00-04:00');

  async function vaultWithIndependentReview() {
    const vault = gapVault();
    // The join key `resolveRetrievabilityScores` actually iterates: the concept's permanent key
    // (`[D-357]`), read back from this vault's own `.olea/concepts/` sidecar — the key the
    // provider's stamped walk resolves for `GapRow.conceptKey`, never the display name.
    const conceptKey = (await extractConcepts(vault, { stampConceptKeys: true })).find(
      (concept) => concept.name === 'Widget theory',
    )?.key;
    if (conceptKey === undefined) throw new Error('fixture vault has no Widget theory concept');
    await vault.write(
      '.olea/reviews/2026-08-09.olea-testdevice1.jsonl',
      `${JSON.stringify({
        schemaVersion: 5,
        kind: 'review',
        eventId: 'r1',
        timestamp: '2026-08-09T09:00:00-04:00',
        instrumentId: 'qa:widget-theory:1',
        instrumentType: 'qa',
        conceptIds: [conceptKey],
        rating: 'good',
        supportLevelShown: 'independent',
        wasUnsure: false,
        durationMs: 1200,
        selectionContext: {
          dueState: 'due',
          examProximity: null,
          yieldRank: null,
          instrumentTypesOffered: ['qa'],
          planVersion: null,
        },
      })}\n`,
    );
    return vault;
  }

  function priorityScoreOf(
    state: Awaited<ReturnType<ReturnType<typeof createLocalGapProvider>['load']>>,
  ) {
    if (state.kind !== 'model') throw new Error('expected a model');
    const course = state.model.courses.find((c) => c.course === 'TESTC101');
    if (course?.status !== 'ranked') throw new Error('expected TESTC101 to rank');
    const row = course.rows.find((r) => r.conceptName === 'Widget theory');
    const score = row?.priorityScore;
    if (score === undefined) throw new Error('expected a priorityScore on the ranked row');
    return score;
  }

  it('REGRESSION (fails pre-fix): an injected Scheduler with a lower recall probability raises priorityScore by exactly the recall it lost ([D-332]: need = 1 - recall, added)', async () => {
    const neutral = await createLocalGapProvider({
      vault: await vaultWithIndependentReview(),
      deviceId: DEVICE,
      settingsHost: hostWithBasePath(BASE_PATH),
      now: NOW,
      scheduler: fixedRetrievabilityScheduler(1),
    }).load();

    const halved = await createLocalGapProvider({
      vault: await vaultWithIndependentReview(),
      deviceId: DEVICE,
      settingsHost: hostWithBasePath(BASE_PATH),
      now: NOW,
      scheduler: fixedRetrievabilityScheduler(0.5),
    }).load();

    const neutralScore = priorityScoreOf(neutral);
    const halvedScore = priorityScoreOf(halved);
    // Pre-fix, `gap/provider.ts` passed no `retrievability` at all, so both
    // schedulers were never consulted and `halvedScore` equalled
    // `neutralScore` exactly — this is the failing assertion the lane rules
    // ask to be shown red before the fix: `expect(halvedScore).toBeCloseTo(neutralScore * 0.5, 10)`
    // with `halvedScore === neutralScore` (unaffected) fails that check.
    expect(neutralScore).toBeGreaterThan(0);
    // Recall 1 is need 0; recall 0.5 is need 0.5, added at need weight 1.
    expect(halvedScore).toBeCloseTo(neutralScore + 0.5, 10);
  });

  it('with no scheduler override at all, production now defaults to a real FSRS Scheduler — retrievability is no longer always neutral', async () => {
    const withDefault = await createLocalGapProvider({
      vault: await vaultWithIndependentReview(),
      deviceId: DEVICE,
      settingsHost: hostWithBasePath(BASE_PATH),
      now: NOW,
    }).load();

    const neutralControl = await createLocalGapProvider({
      vault: await vaultWithIndependentReview(),
      deviceId: DEVICE,
      settingsHost: hostWithBasePath(BASE_PATH),
      now: NOW,
      scheduler: fixedRetrievabilityScheduler(1),
    }).load();

    // A real FSRS read one day after a single 'good' rating is not exactly
    // 1 (some decay has already happened), so the default (no override)
    // path must differ from the neutral control — proof this call site now
    // builds and consults a real `Scheduler` by default.
    expect(priorityScoreOf(withDefault)).not.toBe(priorityScoreOf(neutralControl));
  });

  // `gap/provider.ts` and `plan/provider.ts` both read the permanent concept
  // key (`[D-357]`), but each vault below mints its own — a permanent key is
  // a random nonce persisted per vault, never derived from content — so a
  // single hardcoded `conceptIds` value can never join to both vaults' real
  // keys at once. This test proves the acceptance criterion's actual
  // claim — the SAME vault/review state produces the SAME priority score
  // through both providers — by discovering each provider's own real key
  // first (a bare load/fetch against a review-free vault; the opaque mint
  // is stable on a SECOND call against the SAME vault instance, since the
  // key store persists it), then keying an independent-success review with
  // that provider's own key before the scored call.
  it("the gap view and the study plan compute the identical priority score for the same underlying concept and review state (the bead's acceptance criterion)", async () => {
    const scheduler = fixedRetrievabilityScheduler(0.5);
    const reviewFor = (conceptKey: string) =>
      `${JSON.stringify({
        schemaVersion: 5,
        kind: 'review',
        eventId: 'r1',
        timestamp: '2026-08-09T09:00:00-04:00',
        instrumentId: 'qa:widget-theory:1',
        instrumentType: 'qa',
        conceptIds: [conceptKey],
        rating: 'good',
        supportLevelShown: 'independent',
        wasUnsure: false,
        durationMs: 1200,
        selectionContext: {
          dueState: 'due',
          examProximity: null,
          yieldRank: null,
          instrumentTypesOffered: ['qa'],
          planVersion: null,
        },
      })}\n`;

    const gapVaultForKey = gapVault();
    const gapKeyState = await createLocalGapProvider({
      vault: gapVaultForKey,
      deviceId: DEVICE,
      settingsHost: hostWithBasePath(BASE_PATH),
      now: NOW,
    }).load();
    if (gapKeyState.kind !== 'model') throw new Error('expected a model');
    const gapKeyCourse = gapKeyState.model.courses.find((c) => c.course === 'TESTC101');
    if (gapKeyCourse?.status !== 'ranked') throw new Error('expected TESTC101 to rank');
    const gapKey = gapKeyCourse.rows.find((r) => r.conceptName === 'Widget theory')?.conceptKey;
    if (gapKey === undefined) throw new Error('missing gap conceptKey');
    await gapVaultForKey.write(
      '.olea/reviews/2026-08-09.olea-testdevice1.jsonl',
      reviewFor(gapKey),
    );

    const planVaultForKey = gapVault();
    const planKeyRaw = await createLocalStudyPlanProvider({
      vault: planVaultForKey,
      deviceId: DEVICE,
      settingsHost: hostWithBasePath(BASE_PATH),
      now: NOW,
    }).fetchPlan();
    const planKeyCourse = studyPlanEnvelope
      .parse(planKeyRaw)
      .body.courses.find((c) => c.course === 'TESTC101');
    if (planKeyCourse?.status !== 'ranked')
      throw new Error('expected TESTC101 to rank in the plan');
    const planKey = planKeyCourse.concepts[0]?.conceptId;
    if (planKey === undefined) throw new Error('missing plan conceptId');
    await planVaultForKey.write(
      '.olea/reviews/2026-08-09.olea-testdevice1.jsonl',
      reviewFor(planKey),
    );

    const gapState = await createLocalGapProvider({
      vault: gapVaultForKey,
      deviceId: DEVICE,
      settingsHost: hostWithBasePath(BASE_PATH),
      now: NOW,
      scheduler,
    }).load();

    const planRaw = await createLocalStudyPlanProvider({
      vault: planVaultForKey,
      deviceId: DEVICE,
      settingsHost: hostWithBasePath(BASE_PATH),
      now: NOW,
      scheduler,
    }).fetchPlan();

    const gapScore = priorityScoreOf(gapState);
    const plan = studyPlanEnvelope.parse(planRaw);
    const planCourse = plan.body.courses.find((c) => c.course === 'TESTC101');
    if (planCourse?.status !== 'ranked') throw new Error('expected TESTC101 to rank in the plan');
    const planWeight = planCourse.concepts[0]?.weight;
    if (planWeight === undefined) throw new Error('expected a weight on the ranked plan concept');

    // Both retrievability-adjusted, both halved from the neutral (0.5
    // scheduler over an independent-success review): if either provider
    // still omitted `retrievability`, its own score would read the FULL,
    // un-halved value instead and this equality would fail.
    expect(gapScore).toBeCloseTo(planWeight, 10);
  });

  /**
   * `ol-egov.141.89.10.79` acceptance bullet 2: the order this view would
   * show BEFORE real recall reached the `[D-332]` need term (both concepts
   * tied on need, so relevance alone decides — the neutral(1) scheduler
   * below stands in for that, since an untied `retrievability` map was
   * already ruled out as reachable through this provider's public deps by
   * every test above) versus AFTER (one concept's real, near-total need
   * overturns whichever concept the relevance-only read ranked first).
   * Reported as a count: exactly one row-order change on this fixture.
   */
  it('REPORT (order before/after as a count): real recall for the lower-relevance concept overturns the relevance-only order', async () => {
    const vault = memoryVault({
      '05 Zettelkasten/Widget theory.md': '# Widget theory\n',
      '05 Zettelkasten/Gadget theory.md': '# Gadget theory\n',
      'Notes/one.md': [
        '---',
        'topic: [Widget theory]',
        'course: TESTC101',
        '---',
        '',
        'Front::Back',
        '',
      ].join('\n'),
      'Notes/two.md': [
        '---',
        'topic: [Gadget theory]',
        'course: TESTC101',
        '---',
        '',
        'Front::Back',
        '',
      ].join('\n'),
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
        '## Question 2 (10 marks)',
        '',
        'Explain the core mechanism behind Gadget theory and why it matters.',
        '',
      ].join('\n'),
      [BASE_PATH]: BASE_FILE,
      '02 Assignments/Quiz 1.md': QUIZ,
    });

    const concepts = await extractConcepts(vault, { stampConceptKeys: true });
    const widgetKey = concepts.find((c) => c.name === 'Widget theory')?.key;
    const gadgetKey = concepts.find((c) => c.name === 'Gadget theory')?.key;
    if (widgetKey === undefined || gadgetKey === undefined) {
      throw new Error('fixture vault missing one of the two concepts');
    }

    const reviewFor = (conceptKey: string, instrumentId: string) =>
      `${JSON.stringify({
        schemaVersion: 5,
        kind: 'review',
        eventId: `r-${instrumentId}`,
        timestamp: '2026-08-09T09:00:00-04:00',
        instrumentId,
        instrumentType: 'qa',
        conceptIds: [conceptKey],
        rating: 'good',
        supportLevelShown: 'independent',
        wasUnsure: false,
        durationMs: 1200,
        selectionContext: {
          dueState: 'due',
          examProximity: null,
          yieldRank: null,
          instrumentTypesOffered: ['qa'],
          planVersion: null,
        },
      })}\n`;

    await vault.write(
      '.olea/reviews/2026-08-09.olea-testdevice1.jsonl',
      reviewFor(widgetKey, 'qa:widget-theory:1') + reviewFor(gadgetKey, 'qa:gadget-theory:1'),
    );

    async function ranked(scheduler: Scheduler) {
      const state = await createLocalGapProvider({
        vault,
        deviceId: DEVICE,
        settingsHost: hostWithBasePath(BASE_PATH),
        now: NOW,
        scheduler,
      }).load();
      if (state.kind !== 'model') throw new Error('expected a model');
      const course = state.model.courses.find((c) => c.course === 'TESTC101');
      if (course?.status !== 'ranked') throw new Error('expected TESTC101 to rank');
      return course.rows;
    }

    // BEFORE: both concepts read neutral recall (need 0, tied) — the D-332
    // need term contributes nothing, so order is relevance alone.
    const beforeRows = await ranked(fixedRetrievabilityScheduler(1));
    const widgetBefore = beforeRows.find((r) => r.conceptName === 'Widget theory');
    const gadgetBefore = beforeRows.find((r) => r.conceptName === 'Gadget theory');
    if (widgetBefore === undefined || gadgetBefore === undefined) {
      throw new Error('expected both concepts ranked');
    }
    // Both concepts' one surviving edge is to `QUIZ`, so both carry the same
    // proximity ([D-410]) — added here rather than dropped, since "need 0,
    // tied" was never a claim about proximity.
    const proximity = quizProximityScore(NOW());
    expect(widgetBefore.priorityScore).toBeCloseTo(
      (widgetBefore.assessmentRelevance ?? -1) + proximity,
      10,
    );
    expect(gadgetBefore.priorityScore).toBeCloseTo(
      (gadgetBefore.assessmentRelevance ?? -1) + proximity,
      10,
    );

    const widgetRel = widgetBefore.assessmentRelevance ?? 0;
    const gadgetRel = gadgetBefore.assessmentRelevance ?? 0;
    const [higherName, lowerName, lowerInstrument] =
      widgetRel >= gadgetRel
        ? (['Widget theory', 'Gadget theory', 'qa:gadget-theory:1'] as const)
        : (['Gadget theory', 'Widget theory', 'qa:widget-theory:1'] as const);

    // AFTER: give the lower-relevance concept real, near-total need
    // (recall near 0) — enough to overturn ANY relevance gap the BEFORE
    // read showed — while the higher-relevance concept stays neutral.
    const afterScheduler: Scheduler = {
      schedule: (input) => createFsrsScheduler().schedule(input),
      retrievability(input: RetrievabilityInput): RetrievabilityOutput {
        return {
          instrumentId: input.instrumentId,
          recallProbability: input.instrumentId === lowerInstrument ? 0.001 : 1,
        };
      },
    };
    const afterRows = await ranked(afterScheduler);
    const higherAfter = afterRows.find((r) => r.conceptName === higherName);
    const lowerAfter = afterRows.find((r) => r.conceptName === lowerName);
    if (higherAfter === undefined || lowerAfter === undefined) {
      throw new Error('expected both concepts ranked');
    }
    // Need is now KNOWN (not unknown) for both — proves acceptance bullet
    // 1 on two concepts at once, not just the one-row REGRESSION test above.
    // Both still carry the same proximity ([D-410]) as the BEFORE read (same
    // vault, same `due`, same `now` — the scheduler is the only thing that
    // changed), added here rather than dropped.
    expect(lowerAfter.priorityScore).toBeCloseTo(
      (lowerAfter.assessmentRelevance ?? 0) + 0.999 + proximity,
      6,
    );
    expect(higherAfter.priorityScore).toBeCloseTo(
      (higherAfter.assessmentRelevance ?? 0) + proximity,
      10,
    );

    // BEFORE, by construction, `higherName` ranked first (bigger relevance,
    // tied need). AFTER, its real near-total need overturns that — exactly
    // one row-order change on this fixture vault (acceptance bullet 2).
    expect(beforeRows.indexOf(widgetBefore) < beforeRows.indexOf(gadgetBefore)).toBe(
      higherName === 'Widget theory',
    );
    expect(afterRows.indexOf(higherAfter) < afterRows.indexOf(lowerAfter)).toBe(false);
    const orderChangedCount =
      beforeRows.map((r) => r.conceptName).join('|') ===
      afterRows.map((r) => r.conceptName).join('|')
        ? 0
        : 1;
    expect(orderChangedCount).toBe(1);
  });
});

/**
 * `ol-egov.141.89.10.74` (`[D-399]`, F4.2): the copy and the per-row basis
 * map (`gap/copy.ts#gapRowEvidenceBases`) landed in olea PR 4 (9460d6d), but
 * nothing wired the map from the provider through to the view's own
 * `rankedCourseFraming` call (`gap/view.ts`'s `renderCourse`) — so a
 * brief-only concept, once she declares a scope, was unreachable and would
 * have read as objectives-based. This proves the WIRING: `createLocalGapProvider`
 * (the production `GapViewDeps`, mounted by `gap/view.ts`'s `GapView`) must
 * hand back the same edges' bases the ranking was composed from, keyed
 * exactly as `GapView.renderCourse` reads them before calling
 * `rankedCourseFraming` — reproduced here since `view.ts` itself has no test
 * file (no `obsidian` runtime under Vitest; see that module's own doc).
 */
describe("createLocalGapProvider — threads the ranking edges' evidence bases through to GapViewState ([D-399], ol-egov.141.89.10.74)", () => {
  /**
   * One course that ALREADY has a past-paper-cited concept ("Widget theory",
   * the base fixture's own row), plus a second assignment note that DECLARES
   * a scope (a `scope:` frontmatter property, F1.7/D-399) naming a concept
   * ("Gadget theory") no past paper or objectives document ever mentions.
   * That concept's only evidence-edge basis is `'assessment-brief'`, so its
   * `GapRow` reaches the view with an empty `citations` array — the exact
   * shape an objectives-only row has, which is why the bead exists.
   */
  function vaultWithBriefOnlyConcept() {
    return memoryVault({
      '05 Zettelkasten/Widget theory.md': '# Widget theory\n',
      '05 Zettelkasten/Gadget theory.md': '# Gadget theory\n',
      'Notes/one.md': [
        '---',
        'topic: [Widget theory]',
        'course: TESTC101',
        '---',
        '',
        'Front::Back',
        '',
      ].join('\n'),
      // Binds Gadget theory to TESTC101 (a topic-bound note with its own
      // card), same as `Notes/one.md` does for Widget theory — otherwise the
      // concept has no course to rank under at all. No past paper below ever
      // mentions Gadget theory, so its only evidence-edge basis is the
      // declared-scope brief further down.
      'Notes/two.md': [
        '---',
        'topic: [Gadget theory]',
        'course: TESTC101',
        '---',
        '',
        'Front::Back',
        '',
      ].join('\n'),
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
      '02 Assignments/Quiz 1.md': QUIZ,
      // The declared-scope leg ([D-399]): a scope-aliased frontmatter
      // property naming Gadget theory, on an assignment no past paper cites.
      '02 Assignments/Essay 1.md':
        '---\nclass: TESTC101\ntype: Assignment\nweight: 20\ndue: 2026-10-01\nstatus: upcoming\n' +
        'scope: Covers Gadget theory in depth.\n---\n\n# Essay 1\n',
    });
  }

  it('a brief-only row (empty citations, an assessment-brief edge) is named as the brief in the framing the provider hands the view, never objectives', async () => {
    const provider = createLocalGapProvider({
      vault: vaultWithBriefOnlyConcept(),
      deviceId: DEVICE,
      settingsHost: hostWithBasePath(BASE_PATH),
      now: () => new Date('2026-08-10T09:00:00-04:00'),
    });

    const state = await provider.load();
    expect(state.kind).toBe('model');
    if (state.kind !== 'model') throw new Error('expected a model');

    const course = state.model.courses.find((c) => c.course === 'TESTC101');
    if (course?.status !== 'ranked') throw new Error('expected TESTC101 to rank');

    const briefRow = course.rows.find((r) => r.conceptName === 'Gadget theory');
    expect(briefRow).toBeDefined();
    if (briefRow === undefined) throw new Error('expected a Gadget theory row');
    // The exact shape the bead's description warns about: no citations at all.
    expect(briefRow.citations).toEqual([]);

    // The wiring itself: the provider's returned state carries the edges'
    // bases (`GapViewState.bases`), and this row's own basis is named as
    // the brief — not silently absent, and not defaulted to objectives.
    expect(state.bases).toBeDefined();
    const rowBases = state.bases?.get(gapRowBasisKey(briefRow.course, briefRow.conceptKey));
    expect(rowBases?.has('assessment-brief')).toBe(true);
    expect(rowBases?.has('objectives')).toBe(false);

    // The reachability proof: reproducing exactly what `GapView.renderCourse`
    // does with `state.bases` (`gap/view.ts`) must read the brief basis, not
    // the unsupplied-`bases` inference that reads every empty-citations row
    // as objectives-based. Before this bead's wiring, `state.bases` was
    // `undefined` here, and this assertion read the OBJECTIVES clause.
    const framing = rankedCourseFraming(course.rows, state.bases);
    const sentence = framing.join(' ');
    expect(sentence).toContain(ASSESSMENT_BRIEF_ATTRIBUTION_CLAUSE);
    expect(sentence).not.toContain(OBJECTIVES_ATTRIBUTION_CLAUSE);
  });
});

/**
 * `ol-egov.141.89.2.27` (B5, `[D-437]` design section 4.7 and 4.8, `[D-349]`): the demand rule's
 * composition root. The gap view's provider reads each instrument's demand through the B1 reading
 * (`readInstrumentDemand` against the instrument's CURRENT block), projects it, and gives the
 * ruled rule the declared demands, so each concept whose declared demands were read carries the
 * demands not met now on its row. A concept whose declared demands were not read carries
 * NOTHING: absent is not empty.
 *
 * The declared demands come through `readDeclaredDemands`, which production does not pass yet
 * (the examiner-scope reading has no per-concept reader), so the first describe below is what
 * production runs today. Target records are written here with the writer, in a spec file; the
 * provider's own source never names it.
 */
describe('createLocalGapProvider — the demand rule, live ([D-437] B5, [D-349])', () => {
  const NOW = () => new Date('2026-08-10T09:00:00-04:00');
  const CURRENT = fixedRetrievabilityScheduler(1);
  const STALE = fixedRetrievabilityScheduler(0.1);

  /** The fixture vault with one independent, successful review of its one card, yesterday. */
  async function reviewedCardWorld() {
    const vault = gapVault();
    const enumeration = await enumerateVaultInstruments(vault, {
      concepts: { stampConceptKeys: true },
    });
    const record = enumeration.records[0];
    if (record === undefined || record.instrumentType !== 'qa') {
      throw new Error('fixture vault has no card');
    }
    const conceptKey = record.conceptIds[0];
    if (conceptKey === undefined) throw new Error('fixture card names no concept');
    await vault.write(
      '.olea/reviews/2026-08-09.olea-testdevice1.jsonl',
      `${JSON.stringify({
        schemaVersion: 5,
        kind: 'review',
        eventId: 'r1',
        timestamp: '2026-08-09T09:00:00-04:00',
        instrumentId: record.instrumentId,
        instrumentType: 'qa',
        conceptIds: [conceptKey],
        rating: 'good',
        supportLevelShown: 'independent',
        wasUnsure: false,
        durationMs: 1200,
        selectionContext: {
          dueState: 'due',
          examProximity: null,
          yieldRank: null,
          instrumentTypesOffered: ['qa'],
          planVersion: null,
        },
      })}\n`,
    );
    async function declare(demand: PaperDemand): Promise<void> {
      await writeInstrumentTarget(vault, {
        instrumentId: record?.instrumentId ?? '',
        declaredDemand: demand,
        origin: 'heading-cue',
        questionBinding: await questionBindingOf(
          record?.instrumentType === 'qa' ? record.card : { type: 'qa', front: '', back: '' },
        ),
        authoredAt: '2026-08-01T10:00:00.000Z',
        generator: { taskId: 'cards.generate.v1', promptVersion: '1.8.0' },
      });
    }
    return { vault, conceptKey, instrumentId: record.instrumentId, declare };
  }

  type Loaded = Awaited<ReturnType<ReturnType<typeof createLocalGapProvider>['load']>>;

  function widgetRow(state: Loaded) {
    if (state.kind !== 'model') throw new Error('expected a model');
    const course = state.model.courses.find((c) => c.course === 'TESTC101');
    if (course?.status !== 'ranked') throw new Error('expected TESTC101 to rank');
    const row = course.rows.find((r) => r.conceptName === 'Widget theory');
    if (row === undefined) throw new Error('expected the Widget theory row');
    return row;
  }

  function providerFor(
    vault: ReturnType<typeof gapVault>,
    extra: Partial<Parameters<typeof createLocalGapProvider>[0]> = {},
  ) {
    return createLocalGapProvider({
      vault,
      deviceId: DEVICE,
      settingsHost: hostWithBasePath(BASE_PATH),
      now: NOW,
      scheduler: CURRENT,
      ...extra,
    });
  }

  describe('the declared demands were read: each concept carries what is not met now', () => {
    it('a card declaring recall-a-fact, reviewed and current, meets it and leaves calculate unmet', async () => {
      const world = await reviewedCardWorld();
      await world.declare('recall-a-fact');
      const row = widgetRow(
        await providerFor(world.vault, {
          readDeclaredDemands: async () =>
            new Map([[world.conceptKey, ['recall-a-fact', 'calculate'] as const]]),
        }).load(),
      );
      expect(row.unmetDemands).toEqual(['calculate']);
    });

    it('a card declaring the demand meets it: the row carries [], because the demands were read', async () => {
      const world = await reviewedCardWorld();
      await world.declare('calculate');
      const row = widgetRow(
        await providerFor(world.vault, {
          readDeclaredDemands: async () => new Map([[world.conceptKey, ['calculate'] as const]]),
        }).load(),
      );
      expect(row.unmetDemands).toEqual([]);
    });

    it('an instrument with no target record is unspecified: its success meets nothing', async () => {
      const world = await reviewedCardWorld();
      const row = widgetRow(
        await providerFor(world.vault, {
          readDeclaredDemands: async () =>
            new Map([[world.conceptKey, ['recall-a-fact'] as const]]),
        }).load(),
      );
      expect(row.unmetDemands).toEqual(['recall-a-fact']);
      // Reading assigned it nothing.
      expect(await world.vault.exists(instrumentTargetStorePath(world.instrumentId))).toBe(false);
    });

    it('a success that is no longer current (the ruled qualifying-review rule) does not meet it', async () => {
      const world = await reviewedCardWorld();
      await world.declare('recall-a-fact');
      const row = widgetRow(
        await providerFor(world.vault, {
          scheduler: STALE,
          readDeclaredDemands: async () =>
            new Map([[world.conceptKey, ['recall-a-fact'] as const]]),
        }).load(),
      );
      expect(row.unmetDemands).toEqual(['recall-a-fact']);
    });

    it('a concept whose demands were read but has no review at all has every declared demand unmet', async () => {
      const vault = gapVault();
      const key = (await extractConcepts(vault, { stampConceptKeys: true })).find(
        (concept) => concept.name === 'Widget theory',
      )?.key;
      if (key === undefined) throw new Error('fixture vault has no Widget theory concept');
      const row = widgetRow(
        await providerFor(vault, {
          readDeclaredDemands: async () => new Map([[key, ['recall-a-fact'] as const]]),
        }).load(),
      );
      expect(row.unmetDemands).toEqual(['recall-a-fact']);
    });

    it('a concept the reader named no demands for is absent from the row, never []', async () => {
      const world = await reviewedCardWorld();
      const row = widgetRow(
        await providerFor(world.vault, {
          readDeclaredDemands: async () =>
            new Map([['concept-key1:some-other-concept', ['calculate'] as const]]),
        }).load(),
      );
      expect(row).not.toHaveProperty('unmetDemands');
    });
  });

  describe('a multiple-choice instrument is read against its own block (row 38)', () => {
    /** The fixture plus a second note holding one multiple-choice block on the same concept, reviewed successfully yesterday. */
    async function reviewedQuizWorld() {
      const vault = gapVault();
      await vault.write(
        'Notes/two.md',
        [
          '---',
          'topic: [Widget theory]',
          'course: TESTC101',
          '---',
          '',
          '```olea-mcq',
          'stem: Which one is it?',
          'answer: Alpha',
          'distractor: Beta',
          'distractor: Gamma',
          '```',
          '',
        ].join('\n'),
      );
      const enumeration = await enumerateVaultInstruments(vault, {
        concepts: { stampConceptKeys: true },
      });
      const record = enumeration.records.find((r) => r.instrumentType === 'mcq');
      if (record === undefined || record.instrumentType !== 'mcq') {
        throw new Error('fixture vault has no multiple-choice block');
      }
      const conceptKey = record.conceptIds[0];
      if (conceptKey === undefined) throw new Error('fixture block names no concept');
      await vault.write(
        '.olea/reviews/2026-08-09.olea-testdevice1.jsonl',
        `${JSON.stringify({
          schemaVersion: 5,
          kind: 'review',
          eventId: 'q1',
          timestamp: '2026-08-09T09:00:00-04:00',
          instrumentId: record.instrumentId,
          instrumentType: 'mcq',
          conceptIds: [conceptKey],
          rating: 'good',
          wasUnsure: false,
          durationMs: 1200,
          selectionContext: {
            dueState: 'due',
            examProximity: null,
            yieldRank: null,
            instrumentTypesOffered: ['mcq'],
            planVersion: null,
          },
        })}\n`,
      );
      async function declare(demand: PaperDemand, origin: 'sweep' | 'heading-cue') {
        await writeInstrumentTarget(vault, {
          instrumentId: record?.instrumentId ?? '',
          declaredDemand: demand,
          origin,
          questionBinding: await questionBindingOf(
            record?.instrumentType === 'mcq' ? record.mcq : { type: 'mcq', stem: '', answer: '' },
          ),
          authoredAt: '2026-08-01T10:00:00.000Z',
          generator: { taskId: 'quiz.generate.v1', promptVersion: '2.4.0' },
        });
      }
      return { vault, conceptKey, declare };
    }

    it("the sweep's recall intent on a multiple-choice block is intent that meets nothing: a quiz answer never shows unaided recall", async () => {
      const world = await reviewedQuizWorld();
      await world.declare('recall-a-fact', 'sweep');
      const row = widgetRow(
        await providerFor(world.vault, {
          readDeclaredDemands: async () =>
            new Map([[world.conceptKey, ['recall-a-fact'] as const]]),
        }).load(),
      );
      expect(row.unmetDemands).toEqual(['recall-a-fact']);
    });

    it('a multiple-choice block declaring another demand meets it, since recognition has no ladder', async () => {
      const world = await reviewedQuizWorld();
      await world.declare('compare-or-choose', 'heading-cue');
      const row = widgetRow(
        await providerFor(world.vault, {
          readDeclaredDemands: async () =>
            new Map([[world.conceptKey, ['compare-or-choose'] as const]]),
        }).load(),
      );
      expect(row.unmetDemands).toEqual([]);
    });
  });

  describe('the declared demands were not read (production today): absent is not empty', () => {
    it('with no reader, no row carries unmetDemands, and no target record is even looked for', async () => {
      const world = await reviewedCardWorld();
      await world.declare('recall-a-fact');
      const touched: string[] = [];
      const exists = world.vault.exists.bind(world.vault);
      const read = world.vault.read.bind(world.vault);
      world.vault.exists = async (path) => {
        touched.push(path);
        return exists(path);
      };
      world.vault.read = async (path) => {
        touched.push(path);
        return read(path);
      };
      const row = widgetRow(await providerFor(world.vault).load());
      expect(row).not.toHaveProperty('unmetDemands');
      expect(touched.filter((path) => path.startsWith('.olea/instrument-targets'))).toEqual([]);
    });

    it('a reader that resolves undefined (nothing read) reads the same as no reader', async () => {
      const world = await reviewedCardWorld();
      const row = widgetRow(
        await providerFor(world.vault, { readDeclaredDemands: async () => undefined }).load(),
      );
      expect(row).not.toHaveProperty('unmetDemands');
    });

    it('a reader that throws degrades to nothing read: the view still composes, and shows no demand', async () => {
      const world = await reviewedCardWorld();
      const state = await providerFor(world.vault, {
        readDeclaredDemands: async () => {
          throw new Error('simulated reader failure');
        },
      }).load();
      expect(state.kind).toBe('model');
      expect(widgetRow(state)).not.toHaveProperty('unmetDemands');
    });
  });

  describe('what she sees does not change (no new wording; D-414 guards are ol-egov.141.89.9.70)', () => {
    it('every line the view writes for a row is byte-identical whether or not the row carries unmet demands', async () => {
      const world = await reviewedCardWorld();
      await world.declare('recall-a-fact');
      const without = widgetRow(await providerFor(world.vault).load());
      const withUnmet = widgetRow(
        await providerFor(world.vault, {
          readDeclaredDemands: async () =>
            new Map([[world.conceptKey, ['recall-a-fact', 'calculate'] as const]]),
        }).load(),
      );
      expect(withUnmet.unmetDemands).toEqual(['calculate']);
      const wording = (row: typeof without) =>
        JSON.stringify([
          gapRowLine(row),
          masteryGapLine(row),
          masteryGapMeta(row),
          masteryGapNarrative(row),
          readinessNote(row),
        ]);
      expect(wording(withUnmet)).toBe(wording(without));
    });

    it('T9 at the view: target records and declared demands change unmetDemands only, never the ranking or the mastery reading', async () => {
      const world = await reviewedCardWorld();
      const baseline = widgetRow(await providerFor(world.vault).load());
      await world.declare('recall-a-fact');
      const live = widgetRow(
        await providerFor(world.vault, {
          readDeclaredDemands: async () => new Map([[world.conceptKey, ['calculate'] as const]]),
        }).load(),
      );
      expect(live.unmetDemands).toEqual(['calculate']);
      expect(live.masteryState).toBe(baseline.masteryState);
      expect(live.priorityScore).toBe(baseline.priorityScore);
      expect(live.assessmentRelevance).toBe(baseline.assessmentRelevance);
      expect(live.oracleRank).toBe(baseline.oracleRank);
      expect(live.rank).toBe(baseline.rank);
      expect(live.gapScore).toBe(baseline.gapScore);
    });
  });
});

describe('createLocalGapProvider — manual entries as the F1.2 fallback (ol-egov.141.89.10.112)', () => {
  function filesWithoutTable() {
    return {
      '05 Zettelkasten/Widget theory.md': '# Widget theory\n',
      'Notes/one.md': [
        '---',
        'topic: [Widget theory]',
        'course: TESTC101',
        '---',
        '',
        'Front::Back',
        '',
      ].join('\n'),
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
    };
  }

  it('with a blank Base path and one manual entry, load renders a model for that course', async () => {
    const vault = memoryVault(filesWithoutTable());
    await addManualAssessmentEntry(vault, { course: 'TESTC101', type: 'Quiz', due: '2026-09-01' });
    const provider = createLocalGapProvider({
      vault,
      deviceId: DEVICE,
      settingsHost: new FakeDataHost(),
      now: () => new Date('2026-08-10T09:00:00-04:00'),
    });
    const state = await provider.load();
    expect(state.kind).toBe('model');
    if (state.kind !== 'model') throw new Error('expected a model');
    const course = state.model.courses.find((c) => c.course === 'TESTC101');
    expect(course?.status).toBe('ranked');
  });

  it('with a blank Base path and no manual entry, load stays unavailable', async () => {
    const provider = createLocalGapProvider({
      vault: memoryVault(filesWithoutTable()),
      deviceId: DEVICE,
      settingsHost: new FakeDataHost(),
      now: () => new Date('2026-08-10T09:00:00-04:00'),
    });
    expect((await provider.load()).kind).toBe('unavailable');
  });
});

/**
 * `ol-egov.141.89.9.93` (F4.3, `[D-348]`, registry §22): the production gap view supplies need
 * with its basis. Before this bead `gap/provider.ts` handed `buildGapView` no `need`, so every
 * mastery-gap row with built practice read "recall here hasn't caught up" — a concept she has
 * never attempted included — and `copy.ts`'s unknown branch was never reached in production.
 *
 * Need is read from the same readiness fold, with the same validity projection, that the
 * ranking's own need term reads (`oracle/compose.ts`), so the two never disagree about one
 * concept (`[D-371]`). Supplying it also scores each row relevance × need × credit (the
 * attainment chain spec, section 2.5); the REPORT test records what that does to row order.
 *
 * Every string here is invented (INV-3).
 */
describe('createLocalGapProvider — need with its basis ([D-348], F4.3, ol-egov.141.89.9.93)', () => {
  const NOW = () => new Date('2026-08-10T09:00:00-04:00');
  const LOG = '.olea/reviews/2026-08-09.olea-testdevice1.jsonl';

  function recallReview(conceptKey: string, instrumentId: string, eventId: string): string {
    return `${JSON.stringify({
      schemaVersion: 5,
      kind: 'review',
      eventId,
      timestamp: '2026-08-09T09:00:00-04:00',
      instrumentId,
      instrumentType: 'qa',
      conceptIds: [conceptKey],
      rating: 'good',
      supportLevelShown: 'independent',
      wasUnsure: false,
      durationMs: 1200,
      selectionContext: {
        dueState: 'due',
        examProximity: null,
        yieldRank: null,
        instrumentTypesOffered: ['qa'],
        planVersion: null,
      },
    })}\n`;
  }

  async function keyOf(vault: ReturnType<typeof memoryVault>, name: string): Promise<string> {
    const key = (await extractConcepts(vault, { stampConceptKeys: true })).find(
      (concept) => concept.name === name,
    )?.key;
    if (key === undefined) throw new Error(`fixture vault has no ${name} concept`);
    return key;
  }

  async function rowsOf(vault: ReturnType<typeof memoryVault>, scheduler: Scheduler) {
    const state = await createLocalGapProvider({
      vault,
      deviceId: DEVICE,
      settingsHost: hostWithBasePath(BASE_PATH),
      now: NOW,
      scheduler,
    }).load();
    if (state.kind !== 'model') throw new Error('expected a model');
    const course = state.model.courses.find((c) => c.course === 'TESTC101');
    if (course?.status !== 'ranked') throw new Error('expected TESTC101 to rank');
    return course.rows;
  }

  const DEFICIT_WORDING = /hasn't caught up|\bweak|struggl|\bbehind\b/i;

  it('REGRESSION (fails pre-fix): built practice with no eligible evidence reads need unknown at the declared value, and its line says unknown, never a shortfall', async () => {
    // The base fixture: her note and one built card on Widget theory, and no review at all.
    const rows = await rowsOf(gapVault(), fixedRetrievabilityScheduler(1));
    const row = rows.find((r) => r.conceptName === 'Widget theory');
    if (row === undefined) throw new Error('expected Widget theory to be ranked');
    expect(row.gapClass).toBe('mastery-gap');
    expect(row.instrumentCount).toBe(1);

    // Pre-fix: `row.need` was undefined, and the line below read "hasn't caught up".
    expect(row.need?.basis).toBe('unknown');
    expect(row.need?.value).toBe(1);
    expect(row.need?.readiness.weakest).toBeNull();

    const line = gapRowLine(row);
    expect(line).toBe(masteryGapLine(row));
    expect(line).toContain('Olea has no recall evidence for it yet');
    expect(line).toContain('this says nothing about what you know');
    expect(line).not.toMatch(DEFICIT_WORDING);
  });

  it('REGRESSION (fails pre-fix): an unaided recall success reads need estimated at one minus readiness, the same need the ranking read, and keeps the estimated wording', async () => {
    const vault = gapVault();
    const widgetKey = await keyOf(vault, 'Widget theory');
    await vault.write(LOG, recallReview(widgetKey, 'qa:widget-theory:1', 'r1'));

    const rows = await rowsOf(vault, fixedRetrievabilityScheduler(0.4));
    const row = rows.find((r) => r.conceptName === 'Widget theory');
    if (row === undefined) throw new Error('expected Widget theory to be ranked');

    expect(row.need?.basis).toBe('estimated');
    expect(row.need?.value).toBeCloseTo(0.6, 12);
    expect(row.need?.readiness.weakest?.instrumentId).toBe('qa:widget-theory:1');

    // One evidence rule for one concept ([D-371]): the ranking's need term is the same number.
    // At the declared fallback weights (1, 1, 1) the blend is relevance + need + proximity.
    const rankingNeed =
      row.priorityScore - (row.assessmentRelevance ?? Number.NaN) - quizProximityScore(NOW());
    expect(rankingNeed).toBeCloseTo(row.need?.value ?? Number.NaN, 10);

    expect(gapRowLine(row)).toContain("recall here hasn't caught up");
  });

  it('REGRESSION (fails pre-fix): with need supplied, each row scores relevance × need × credit and reads no priority (att.md 2.5)', async () => {
    const vault = gapVault();
    const widgetKey = await keyOf(vault, 'Widget theory');
    await vault.write(LOG, recallReview(widgetKey, 'qa:widget-theory:1', 'r1'));

    for (const scheduler of [fixedRetrievabilityScheduler(0.4), fixedRetrievabilityScheduler(1)]) {
      const row = (await rowsOf(vault, scheduler)).find((r) => r.conceptName === 'Widget theory');
      if (row?.need === undefined) throw new Error('expected need on the row');
      expect(row.gapScore).toBeCloseTo(
        (row.assessmentRelevance ?? Number.NaN) * row.need.value * row.readiness.weight,
        12,
      );
    }
    // Unknown need scores at the declared value 1: relevance × credit.
    const unknown = (await rowsOf(gapVault(), fixedRetrievabilityScheduler(1))).find(
      (r) => r.conceptName === 'Widget theory',
    );
    expect(unknown?.gapScore).toBeCloseTo(
      (unknown?.assessmentRelevance ?? Number.NaN) * (unknown?.readiness.weight ?? Number.NaN),
      12,
    );
  });

  it('REPORT: supplying need changes the gap view order where relevance and need trade off (one change on this fixture)', async () => {
    // Widget theory is asked in two past papers and Gadget theory in one, so their relevance
    // differs; both carry one edge to the same quiz, so proximity is equal.
    const vault = memoryVault({
      '05 Zettelkasten/Widget theory.md': '# Widget theory\n',
      '05 Zettelkasten/Gadget theory.md': '# Gadget theory\n',
      'Notes/one.md': [
        '---',
        'topic: [Widget theory]',
        'course: TESTC101',
        '---',
        '',
        'Front::Back',
        '',
      ].join('\n'),
      'Notes/two.md': [
        '---',
        'topic: [Gadget theory]',
        'course: TESTC101',
        '---',
        '',
        'Front::Back',
        '',
      ].join('\n'),
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
        '## Question 2 (10 marks)',
        '',
        'Explain the core mechanism behind Gadget theory and why it matters.',
        '',
      ].join('\n'),
      '03 Research/TESTC101 Past Paper 2024.md': [
        '---',
        'role: past-paper',
        'course: TESTC101',
        '---',
        '',
        '# TESTC101 Past Paper — 2024',
        '',
        '## Question 1 (10 marks)',
        '',
        'Compare Widget theory with an older account.',
        '',
      ].join('\n'),
      [BASE_PATH]: BASE_FILE,
      '02 Assignments/Quiz 1.md': QUIZ,
    });
    const widgetKey = await keyOf(vault, 'Widget theory');
    const gadgetKey = await keyOf(vault, 'Gadget theory');
    await vault.write(
      LOG,
      recallReview(widgetKey, 'qa:widget-theory:1', 'r-w') +
        recallReview(gadgetKey, 'qa:gadget-theory:1', 'r-g'),
    );
    // Widget theory recalled at 0.7 (need 0.3), Gadget theory at 0.5 (need 0.5).
    const scheduler: Scheduler = {
      schedule: (input) => createFsrsScheduler().schedule(input),
      retrievability: (input: RetrievabilityInput): RetrievabilityOutput => ({
        instrumentId: input.instrumentId,
        recallProbability: input.instrumentId === 'qa:widget-theory:1' ? 0.7 : 0.5,
      }),
    };
    const rows = await rowsOf(vault, scheduler);
    const widget = rows.find((r) => r.conceptName === 'Widget theory');
    const gadget = rows.find((r) => r.conceptName === 'Gadget theory');
    if (widget === undefined || gadget === undefined) throw new Error('expected both ranked');
    const rW = widget.assessmentRelevance ?? Number.NaN;
    const rG = gadget.assessmentRelevance ?? Number.NaN;
    // The precondition for a flip, stated rather than assumed: the relevance gap is smaller than
    // the need gap (so the additive blend orders by need) while the relevance ratio is larger than
    // the need ratio (so the product orders by relevance).
    expect(rW - rG).toBeLessThan(0.5 - 0.3);
    expect(rW / rG).toBeGreaterThan(0.5 / 0.3);

    // Before: the gap score was the ranking's priority × the credit.
    const before = [...rows]
      .sort(
        (a, b) =>
          b.priorityScore * b.readiness.weight - a.priorityScore * a.readiness.weight ||
          a.oracleRank - b.oracleRank,
      )
      .map((r) => r.conceptName);
    // After: relevance × need × credit, the view's own order.
    const after = [...rows].sort((a, b) => a.rank - b.rank).map((r) => r.conceptName);
    expect(before).toEqual(['Gadget theory', 'Widget theory']);
    expect(after).toEqual(['Widget theory', 'Gadget theory']);
  });
});

/**
 * `ol-egov.141.89.9.94` (F4.3; `[D-338]` item 3, `[D-347]` as ruled, `[D-371]`): every current
 * reading the production gap view supplies applies one evidence rule. Proven-invalid evidence
 * never counts. A sound review she withheld keeps counting, because availability is not validity
 * (`[D-347]`'s clarification; the attainment matching rule, section 7, judgement J1).
 *
 * Before this bead the provider supplied no current-recognition map, so the recognition credit
 * read `mastery.evidence.tiersSucceeded.recognition`: any past success, an answer on an item later
 * proven defective included, since the mastery join removes proven-invalid evidence at the top
 * stage only. The credit now reads `readAllCurrentRecognition`: a correct answer, current, on an
 * instrument still standing (the attainment chain spec, section 2.5).
 *
 * Every string here is invented (INV-3).
 */
describe('createLocalGapProvider — current readings apply one evidence rule ([D-338] item 3, [D-347], ol-egov.141.89.9.94)', () => {
  const NOW = () => new Date('2026-08-10T09:00:00-04:00');
  const LOG = '.olea/reviews/2026-08-09.olea-testdevice1.jsonl';
  const QUIZ_ITEM = 'mcq:widget-theory:1';
  const CARD = 'qa:widget-theory:1';

  function review(
    conceptKey: string,
    instrumentId: string,
    instrumentType: 'mcq' | 'qa',
    eventId: string,
  ): string {
    return `${JSON.stringify({
      schemaVersion: 5,
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
    })}\n`;
  }

  /** A suspension written after the review; `reason` omitted reads unknown (`[D-345]`). */
  function suspend(
    conceptKey: string,
    instrumentId: string,
    reason: 'defect' | 'own-choice' | undefined,
  ): string {
    return `${JSON.stringify({
      schemaVersion: 6,
      kind: 'suspend',
      eventId: `s-${instrumentId}`,
      timestamp: '2026-08-09T10:00:00-04:00',
      instrumentId,
      conceptIds: [conceptKey],
      ...(reason !== undefined ? { reason } : {}),
    })}\n`;
  }

  async function widgetRow(lines: (key: string) => string, scheduler: Scheduler) {
    const vault = gapVault();
    const key = (await extractConcepts(vault, { stampConceptKeys: true })).find(
      (concept) => concept.name === 'Widget theory',
    )?.key;
    if (key === undefined) throw new Error('fixture vault has no Widget theory concept');
    await vault.write(LOG, lines(key));
    const state = await createLocalGapProvider({
      vault,
      deviceId: DEVICE,
      settingsHost: hostWithBasePath(BASE_PATH),
      now: NOW,
      scheduler,
    }).load();
    if (state.kind !== 'model') throw new Error('expected a model');
    const course = state.model.courses.find((c) => c.course === 'TESTC101');
    if (course?.status !== 'ranked') throw new Error('expected TESTC101 to rank');
    const row = course.rows.find((r) => r.conceptName === 'Widget theory');
    if (row === undefined) throw new Error('expected Widget theory to be ranked');
    return row;
  }

  it('control: a correct, current quiz answer on a standing item earns the credit on a recall-style assessment', async () => {
    const row = await widgetRow(
      (key) => review(key, QUIZ_ITEM, 'mcq', 'r1'),
      fixedRetrievabilityScheduler(1),
    );
    expect(row.assessmentFormat).toBe('recall-style');
    expect(row.readiness.applied).toBe(true);
    expect(row.readiness.weight).toBe(0.6);
  });

  it('REGRESSION (fails pre-fix): a correct quiz answer on an item later suspended as defective earns no recognition credit ([D-338] item 3)', async () => {
    const row = await widgetRow(
      (key) => review(key, QUIZ_ITEM, 'mcq', 'r1') + suspend(key, QUIZ_ITEM, 'defect'),
      fixedRetrievabilityScheduler(1),
    );
    // Pre-fix: applied, weight 0.6 — the mastery join's `tiersSucceeded.recognition` still read
    // the defective item's answer.
    expect(row.readiness.applied).toBe(false);
    expect(row.readiness.weight).toBe(1);
  });

  it('REGRESSION (fails pre-fix): a correct quiz answer whose recall estimate is now below the retention target earns no credit (att.md 2.5)', async () => {
    const row = await widgetRow(
      (key) => review(key, QUIZ_ITEM, 'mcq', 'r1'),
      fixedRetrievabilityScheduler(0.5),
    );
    // Pre-fix: applied — any past success earned the credit.
    expect(row.readiness.applied).toBe(false);
    expect(row.readiness.weight).toBe(1);
  });

  it('PIN ([D-347] as ruled): her suspension with no defect recorded keeps the sound quiz answer counting for the credit', async () => {
    for (const reason of ['own-choice', undefined] as const) {
      const row = await widgetRow(
        (key) => review(key, QUIZ_ITEM, 'mcq', 'r1') + suspend(key, QUIZ_ITEM, reason),
        fixedRetrievabilityScheduler(1),
      );
      expect(row.readiness.applied).toBe(true);
    }
  });

  it('PIN ([D-347] as ruled, [D-338] item 3): need keeps a sound review she suspended, and drops one suspended as defective', async () => {
    for (const reason of ['own-choice', undefined] as const) {
      const row = await widgetRow(
        (key) => review(key, CARD, 'qa', 'r1') + suspend(key, CARD, reason),
        fixedRetrievabilityScheduler(0.4),
      );
      expect(row.need?.basis).toBe('estimated');
      expect(row.need?.value).toBeCloseTo(0.6, 12);
    }
    const defective = await widgetRow(
      (key) => review(key, CARD, 'qa', 'r1') + suspend(key, CARD, 'defect'),
      fixedRetrievabilityScheduler(0.4),
    );
    expect(defective.need?.basis).toBe('unknown');
    expect(gapRowLine(defective)).toContain('Olea has no recall evidence for it yet');
  });
});
