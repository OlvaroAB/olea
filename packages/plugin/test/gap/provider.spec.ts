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
import type { Scheduler } from 'olea-core';
import {
  createFsrsScheduler,
  type RetrievabilityInput,
  type RetrievabilityOutput,
} from 'olea-core';
import { describe, expect, it } from 'vitest';
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

const QUIZ =
  '---\nclass: TESTC101\ntype: Quiz\nweight: 10\ndue: 2026-09-01\nstatus: upcoming\n---\n\n# Quiz 1\n';

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
  it('with readRankWeights absent, composes with the declared fallback (masteryNeedWeight.seed = 1)', async () => {
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
    // She has no review log yet, so masteryState is 'seed' (see the "fresh
    // install" test above) — the declared fallback's `masteryNeedWeight.seed`
    // is 1, the identity, so `priorityScore` equals the raw pre-mastery score.
    expect(row?.masteryState).toBe('seed');
    expect(row?.priorityScore).toBeGreaterThan(0);
  });

  it('with readRankWeights delivering a masteryNeedWeight, the fallback is NOT taken — priorityScore scales by the delivered factor rather than the declared 1', async () => {
    let calls = 0;
    const readRankWeights = async () => {
      calls += 1;
      return {
        masteryNeedWeight: { seed: 0.2, sprout: 0.2, sapling: 0.2, tree: 0.2, unknown: 0.2 },
      };
    };

    const fallbackProvider = createLocalGapProvider({
      vault: gapVault(),
      deviceId: DEVICE,
      settingsHost: hostWithBasePath(BASE_PATH),
      now: () => new Date('2026-08-10T09:00:00-04:00'),
    });
    const deliveredProvider = createLocalGapProvider({
      vault: gapVault(),
      deviceId: DEVICE,
      settingsHost: hostWithBasePath(BASE_PATH),
      now: () => new Date('2026-08-10T09:00:00-04:00'),
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
    // seed's delivered weight (0.2) vs. the declared fallback (1): the
    // delivered priority score must be exactly a fifth of the fallback's —
    // proving the delivered options object, not the declared constants,
    // drove the arithmetic.
    expect(deliveredRow?.priorityScore).toBeCloseTo((fallbackRow?.priorityScore ?? 0) * 0.2, 10);
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
    await vault.write(
      '.olea/reviews/2026-08-09.olea-testdevice1.jsonl',
      `${JSON.stringify({
        schemaVersion: 5,
        kind: 'review',
        eventId: 'r1',
        timestamp: '2026-08-09T09:00:00-04:00',
        instrumentId: 'qa:widget-theory:1',
        instrumentType: 'qa',
        // The join key `resolveRetrievabilityScores` actually iterates —
        // `provisionalConceptKey`'s derivation (`concept-key.ts`), not the
        // display name — confirmed against this exact fixture's own
        // `GapRow.conceptKey`.
        conceptIds: ['concept-prov1:Widget theory'],
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

  it('REGRESSION (fails pre-fix): an injected Scheduler with a lower recall probability scales priorityScore down by exactly that factor', async () => {
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
    expect(halvedScore).toBeCloseTo(neutralScore * 0.5, 10);
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

  // `gap/provider.ts` (`enumerateVaultInstruments`) and `plan/provider.ts`
  // (`extractConceptsFromVault`) mint two DIFFERENT concept-key shapes for
  // the identical vault content — a provisional, content-derived key here
  // vs an opaque, persisted-key-store mint there (`concept-key.ts`'s own
  // module doc names this residual gap; not this bead's to close). So a
  // single hardcoded `conceptIds` value can never join to both providers'
  // real keys at once. This test proves the acceptance criterion's actual
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
});
