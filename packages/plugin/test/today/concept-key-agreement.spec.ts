/**
 * Investigation for `ol-egov.141.89.9.26` (service repo): does the Today
 * panel, the registry and the grove key the same concept the same way?
 *
 * Found by `ol-egov.141.89.9.15`: `createVaultScopeSource` derives concept
 * keys through `enumerateVaultInstruments` (content-derived, provisional —
 * `provisionalConceptKey`), while `createVaultTrendsSource` derives them
 * through `extractConceptsFromVault`, which stamps an opaque, persisted key
 * (`resolveConceptKey`/`mintOpaqueConceptKey`).
 *
 * **What this suite actually finds, over one synthetic vault with a
 * note-bound (tier 1) and a topic-derived (tier 2) concept:**
 *
 *  - `createVaultScopeSource` (Today's own F6.2 cross-course scope reading),
 *    `createLocalRegistryProvider` and `createLocalGroveProvider` all key
 *    every concept IDENTICALLY — all three call `enumerateVaultInstruments`
 *    with no `stampConceptKeys` option, so all three read the same
 *    provisional key `provisionalConceptKey` derives. This is also the exact
 *    key every production review ever WRITES to the log:
 *    `session/build.ts#buildReviewSession` (the composer behind every real
 *    review, via `session-builder/provider.ts`) enumerates the vault the
 *    same unstamped way. The bead's own framing (scope source is the
 *    outlier; trends + registry agree, stamped) does not hold once measured:
 *    the registry does not stamp, and neither does the review-log write path.
 *  - `createVaultTrendsSource` is the one outlier: it calls
 *    `extractConceptsFromVault`, which defaults `stampConceptKeys` to `true`.
 *    Its `conceptId` never matches the provisional key any of the other
 *    three readers compute, or the key a real review ever gets logged under.
 *  - This is not merely a cross-reader naming disagreement: it is a live bug
 *    in the Today panel's OWN F6.2 mastery overview and F6.5 insights.
 *    `buildTodayPanel` folds `entries` (read by `readReviewHistory`, whose
 *    `conceptIds` always carry the provisional key a real review logged)
 *    against `concepts` (from `createVaultTrendsSource`, carrying the stamped
 *    key). `computeAllConceptMastery`/`masteryDistribution` join by that id,
 *    so a real concept that DOES have review history reads as `seed` (never
 *    reviewed) the instant a trends source is wired — which production's
 *    `main.ts` always does. The second describe block below demonstrates
 *    this directly, by folding the SAME real entries against each reader's
 *    own id list.
 *
 * **Deliberately NOT fixed by this bead.** The obvious in-file fix —
 * `createVaultTrendsSource` calling the unstamped `extractConcepts` instead
 * of `extractConceptsFromVault`, matching `createVaultScopeSource` right
 * above it in this same file — was tried and reverted: it regresses
 * `ol-2zfj.50` (`features/F8-concepts-scope.md`'s own scenario, "every
 * production extraction path mints concept keys, not just the composition
 * root" — `packages/plugin/test/concept/production-callers.spec.ts`, which
 * exercises this exact call site and asserts it stamps). The two contracted
 * behaviours are in genuine tension: `[D-174]`'s scenario requires THIS
 * reader to stamp; the review-log fold needs it not to, or needs every other
 * production key-deriving call site (`registry/provider.ts`,
 * `grove/provider.ts`, `session/build.ts` and its callers,
 * `generation/routing.ts`, `gap/provider.ts`, `paper/provider.ts`,
 * `privacy/export-bundle.ts`, `ingestion/materiality/
 * citation-revision-wiring.ts`) migrated to stamp alongside it. Closing
 * either side alone reopens the other, and doing the wider migration touches
 * files this bead does not own. See `ol-egov.141.89.9.26`'s close notes for
 * the two-directions-collide finding as filed evidence, and this suite's own
 * assertions for the measured state as it stands: current production code is
 * UNCHANGED by this investigation.
 *
 * Every course code and concept name below is invented (INV-3).
 */

import {
  appendReviewLogRecord,
  computeAllConceptMastery,
  type GroveCell,
  type RegistryConceptEntry,
} from 'olea-core';
import { describe, expect, it } from 'vitest';
import { createLocalGroveProvider } from '../../src/grove/provider.js';
import type { EditInstrumentPort, OpenSourceLocationPort } from '../../src/registry/provider.js';
import { createLocalRegistryProvider } from '../../src/registry/provider.js';
import {
  createVaultScopeSource,
  createVaultTrendsSource,
  localToday,
  readReviewHistory,
} from '../../src/today/data-source.js';
import { memoryVault } from '../review/memory-vault.js';

const DEVICE = 'olea-testdevice1';
const COURSE = 'TESTC101';
const BOUND_CONCEPT = 'Widget theory';
const TOPIC_CONCEPT = 'Gadget theory';

class FakeDataHost {
  blob: unknown = null;
  async loadData(): Promise<unknown> {
    return this.blob;
  }
  async saveData(data: unknown): Promise<void> {
    this.blob = data;
  }
}

class FakeEditPort implements EditInstrumentPort {
  async edit(): Promise<void> {
    // no-op
  }
}

class NoopOpenSourceLocationPort implements OpenSourceLocationPort {
  async open(): Promise<void> {
    // no-op
  }
}

/**
 * One course, one note-bound (tier 1) concept, one topic-derived (tier 2)
 * concept, and a registered objectives document naming both — so
 * `createVaultScopeSource`/`createLocalGroveProvider` both read the course as
 * `'declared'`, with real `GroveCell`s (a `state`, not only a name) for both
 * concepts, rather than the `'inferred'` status a course with no registered
 * source reads (`GroveVolunteerCell`, no growth stage at all).
 */
function fixtureVault() {
  return memoryVault({
    '05 Zettelkasten/Widget theory.md': '# Widget theory\n',
    'Notes/bound.md': [
      '---',
      `topic: [${BOUND_CONCEPT}]`,
      `course: ${COURSE}`,
      '---',
      '',
      'Bound front::Bound back',
      '',
    ].join('\n'),
    'Notes/loose.md': [
      '---',
      `topic: [${TOPIC_CONCEPT}]`,
      `course: ${COURSE}`,
      '---',
      '',
      'Loose front::Loose back',
      '',
    ].join('\n'),
    '03 Research/Objectives.md': [
      '---',
      'role: objectives',
      `course: ${COURSE}`,
      '---',
      '',
      `The course covers ${BOUND_CONCEPT} and ${TOPIC_CONCEPT} in depth.`,
      '',
    ].join('\n'),
  });
}

async function declaredCellsFromScopeSource(
  vault: ReturnType<typeof fixtureVault>,
  now: Date,
): Promise<readonly GroveCell[]> {
  const models = await createVaultScopeSource({
    vault,
    deviceId: DEVICE,
    now: () => now,
  }).listCourseGroveModels();
  const model = (models ?? []).find((m) => m.course === COURSE);
  if (model === undefined || model.status !== 'declared') {
    throw new Error(`expected ${COURSE} declared, got ${model?.status}`);
  }
  return model.cells;
}

async function registryEntries(
  vault: ReturnType<typeof fixtureVault>,
  now: Date,
): Promise<readonly RegistryConceptEntry[]> {
  const provider = createLocalRegistryProvider({
    vault,
    deviceId: DEVICE,
    settingsHost: new FakeDataHost(),
    now: () => now,
    editPort: new FakeEditPort(),
    openSourceLocationPort: new NoopOpenSourceLocationPort(),
  });
  const state = await provider.load();
  if (state.kind !== 'model') throw new Error(`expected a registry model, got ${state.kind}`);
  return state.model.concepts;
}

async function declaredCellsFromGrove(
  vault: ReturnType<typeof fixtureVault>,
  now: Date,
): Promise<readonly GroveCell[]> {
  const provider = createLocalGroveProvider({
    vault,
    deviceId: DEVICE,
    settingsHost: new FakeDataHost(),
    now: () => now,
  });
  const state = await provider.load();
  if (state.kind !== 'model') throw new Error(`expected a grove model, got ${state.kind}`);
  const section = state.courses.find((c) => c.course === COURSE);
  if (section === undefined || section.model.status !== 'declared') {
    throw new Error(`expected ${COURSE} declared in the grove, got ${section?.model.status}`);
  }
  return section.model.cells;
}

describe('concept key agreement — scope source, registry and grove (ol-egov.141.89.9.26)', () => {
  const NOW = new Date('2026-09-01T09:00:00Z');

  it('scope source, registry and grove key both concepts IDENTICALLY (all three read enumerateVaultInstruments unstamped)', async () => {
    const vault = fixtureVault();

    const scopeCells = await declaredCellsFromScopeSource(vault, NOW);
    const registryRows = await registryEntries(vault, NOW);
    const groveCells = await declaredCellsFromGrove(vault, NOW);

    const scopeKeyByName = new Map(scopeCells.map((c) => [c.conceptName, c.conceptKey]));
    const registryKeyByName = new Map(registryRows.map((r) => [r.originalName, r.key]));
    const groveKeyByName = new Map(groveCells.map((c) => [c.conceptName, c.conceptKey]));

    for (const name of [BOUND_CONCEPT, TOPIC_CONCEPT]) {
      const scopeKey = scopeKeyByName.get(name);
      const registryKey = registryKeyByName.get(name);
      const groveKey = groveKeyByName.get(name);
      expect(scopeKey, `scope source missing ${name}`).toBeDefined();
      expect(registryKey, `registry missing ${name}`).toBeDefined();
      expect(groveKey, `grove missing ${name}`).toBeDefined();
      expect(registryKey).toBe(scopeKey);
      expect(groveKey).toBe(scopeKey);
    }
  });

  it('createVaultTrendsSource keys BOTH concepts differently from scope source, registry and grove (the real outlier, still true today)', async () => {
    const vault = fixtureVault();

    const scopeCells = await declaredCellsFromScopeSource(vault, NOW);
    const scopeKeyByName = new Map(scopeCells.map((c) => [c.conceptName, c.conceptKey]));

    const trendsConcepts = await createVaultTrendsSource({ vault }).listConceptCourses();
    expect(trendsConcepts).not.toBeNull();
    const trendsKeyByName = new Map(
      (trendsConcepts ?? []).map((c) => [c.displayName, c.conceptId]),
    );

    for (const name of [BOUND_CONCEPT, TOPIC_CONCEPT]) {
      const scopeKey = scopeKeyByName.get(name);
      const trendsKey = trendsKeyByName.get(name);
      expect(scopeKey, `scope source missing ${name}`).toBeDefined();
      expect(trendsKey, `trends source missing ${name}`).toBeDefined();
      // The measured divergence: not equal, and not even the same shape
      // (`concept-prov1:...` vs `concept-key1:...`).
      expect(trendsKey).not.toBe(scopeKey);
    }
  });
});

/**
 * The live consequence: `buildTodayPanel` (via `buildMasteryOverview`/
 * `buildInsights`, `olea-core`'s `today/panel.ts`) folds `entries` — read by
 * `readReviewHistory`, whose `conceptIds` always carry whichever key a real
 * review actually logged (the provisional key every production write path
 * uses) — against `concepts`, supplied by whichever `TodayTrendsSource` is
 * wired. Production (`main.ts`) always wires `createVaultTrendsSource`.
 *
 * This suite writes ONE real review for each concept, keyed by the exact
 * provisional key `createVaultScopeSource` (and the registry, and the grove)
 * independently derive for it — i.e. the key a real review actually gets
 * logged under — then folds those same log entries against each reader's own
 * concept-id list, the same join `masteryDistribution`/`computeAllConceptMastery`
 * performs inside `buildTodayPanel`.
 */
describe('the live bug: folding real review history against createVaultTrendsSource ids reads stale (ol-egov.141.89.9.26, currently open)', () => {
  const NOW = new Date('2026-09-01T09:00:00Z');
  const REVIEWED_AT = '2026-08-25T09:00:00Z';
  const AFTER_REVIEW = new Date('2026-09-10T09:00:00Z');

  async function vaultWithOneReviewPerConcept(): Promise<ReturnType<typeof fixtureVault>> {
    const vault = fixtureVault();
    // The exact keys a real review logs under — derived the same way
    // `createVaultScopeSource`, the registry and the grove all derive them
    // (`enumerateVaultInstruments`, unstamped).
    const scopeCells = await declaredCellsFromScopeSource(vault, NOW);
    const keyByName = new Map(scopeCells.map((c) => [c.conceptName, c.conceptKey]));
    let eventCounter = 0;
    for (const name of [BOUND_CONCEPT, TOPIC_CONCEPT]) {
      const conceptId = keyByName.get(name);
      if (conceptId === undefined) throw new Error(`missing scope key for ${name}`);
      eventCounter += 1;
      await appendReviewLogRecord(
        vault,
        {
          timestamp: REVIEWED_AT,
          instrumentId: `qa:${conceptId}:1`,
          instrumentType: 'qa',
          conceptIds: [conceptId],
          rating: 'good',
          wasUnsure: false,
          durationMs: 1200,
          selectionContext: {
            dueState: 'due',
            examProximity: null,
            yieldRank: null,
            instrumentTypesOffered: ['qa'],
            planVersion: null,
          },
        },
        { deviceId: DEVICE, generateEventId: () => `agree-${eventCounter}` },
      );
    }
    return vault;
  }

  it('scope source, registry and grove all read BOTH concepts as sprout (real review history correctly folded)', async () => {
    const vault = await vaultWithOneReviewPerConcept();

    const scopeCells = await declaredCellsFromScopeSource(vault, AFTER_REVIEW);
    const registryRows = await registryEntries(vault, AFTER_REVIEW);
    const groveCells = await declaredCellsFromGrove(vault, AFTER_REVIEW);

    for (const name of [BOUND_CONCEPT, TOPIC_CONCEPT]) {
      const scopeState = scopeCells.find((c) => c.conceptName === name)?.state;
      const registryState = registryRows.find((r) => r.originalName === name)?.mastery.state;
      const groveState = groveCells.find((c) => c.conceptName === name)?.state;
      expect(scopeState, `scope state for ${name}`).toBe('sprout');
      expect(registryState, `registry state for ${name}`).toBe('sprout');
      expect(groveState, `grove state for ${name}`).toBe('sprout');
    }
  });

  it('CHARACTERIZATION (bug, not yet fixed): folding the SAME real entries against createVaultTrendsSource ids reads seed, not sprout', async () => {
    const vault = await vaultWithOneReviewPerConcept();

    const { entries } = await readReviewHistory(vault, DEVICE, {
      today: localToday(AFTER_REVIEW),
      probeDays: 400,
    });
    const trendsConcepts = await createVaultTrendsSource({ vault }).listConceptCourses();
    expect(trendsConcepts).not.toBeNull();
    const trendsIds = (trendsConcepts ?? []).map((c) => c.conceptId);

    const masteryViaTrends = computeAllConceptMastery(entries, trendsIds);

    const displayNameById = new Map(
      (trendsConcepts ?? []).map((c) => [c.conceptId, c.displayName] as const),
    );
    expect(masteryViaTrends.size).toBe(2);
    for (const [conceptId, { state }] of masteryViaTrends) {
      const name = displayNameById.get(conceptId) ?? conceptId;
      // Neither stamped id `createVaultTrendsSource` reports ever appears in
      // a real review-log entry's `conceptIds`, so `computeAllConceptMastery`
      // finds zero scored events for it — exactly as if she had never
      // reviewed either concept, though the assertions immediately above
      // (scope source, registry, grove — over the SAME entries) all read
      // `sprout`. This is the live bug this investigation surfaces, filed
      // rather than fixed — see this file's module doc for why the obvious
      // one-line fix was tried and reverted.
      expect(state, `mastery via trends source's own id, for ${name}`).toBe('seed');
    }
  });
});
