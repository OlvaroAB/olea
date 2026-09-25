/**
 * The Today panel, the registry and the grove key the same concept the same
 * way — the permanent `.olea/concepts/` key (`[D-357]`, `ol-egov.141.89.9.30`).
 *
 * Found by `ol-egov.141.89.9.26` (from `ol-egov.141.89.9.15`) and pinned here
 * until `[D-357]` landed: `createVaultScopeSource`, `createLocalRegistryProvider`,
 * `createLocalGroveProvider` and `session/build.ts#buildReviewSession` (the
 * composer behind every review she logs) all enumerated unstamped and keyed
 * each concept by the content-derived stand-in (`provisionalConceptKey`),
 * while `createVaultTrendsSource` read the permanent key through
 * `extractConceptsFromVault`. Today's own F6.2 mastery overview and F6.5
 * insights therefore folded review history keyed one way against concepts
 * keyed the other, and a concept she had reviewed read as `seed`.
 *
 * `[D-357]` (David, 2026-09-25, option A): every path that composes a review
 * or lists concepts writes and reads the permanent key, before the first
 * installable release — the trends source keeps stamping (`ol-2zfj.50`'s
 * scenario, `production-callers.spec.ts`) and every other reader joined it.
 * This suite holds the result over one synthetic vault with a note-bound
 * (tier 1) and a topic-derived (tier 2) concept: all four readers agree on
 * each concept's key, the key is the permanent one, a real review folds to
 * the same growth stage through every reader, and a registry rename or
 * withdrawal is read by Today under that same key.
 *
 * Every course code and concept name below is invented (INV-3).
 */

import {
  appendReviewLogRecord,
  computeAllConceptMastery,
  type GroveCell,
  isConceptPruned,
  OPAQUE_CONCEPT_KEY_PREFIX,
  type RegistryConceptEntry,
  type RegistryOverrides,
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

function registryProvider(
  vault: ReturnType<typeof fixtureVault>,
  now: Date,
  onOverridesChanged?: (overrides: RegistryOverrides) => void,
) {
  return createLocalRegistryProvider({
    vault,
    deviceId: DEVICE,
    settingsHost: new FakeDataHost(),
    now: () => now,
    editPort: new FakeEditPort(),
    openSourceLocationPort: new NoopOpenSourceLocationPort(),
    ...(onOverridesChanged !== undefined ? { onOverridesChanged } : {}),
  });
}

async function registryEntries(
  vault: ReturnType<typeof fixtureVault>,
  now: Date,
): Promise<readonly RegistryConceptEntry[]> {
  const provider = registryProvider(vault, now);
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

describe('concept key agreement — scope source, registry, grove and trends source ([D-357])', () => {
  const NOW = new Date('2026-09-01T09:00:00Z');

  it('scope source, registry and grove key both concepts identically, by the permanent key', async () => {
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
      expect(scopeKey?.startsWith(`${OPAQUE_CONCEPT_KEY_PREFIX}:`)).toBe(true);
      expect(registryKey).toBe(scopeKey);
      expect(groveKey).toBe(scopeKey);
    }
  });

  it('createVaultTrendsSource keys both concepts exactly as the scope source, registry and grove do', async () => {
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
      expect(trendsKey).toBe(scopeKey);
    }
  });

  it('a registry rename and a registry withdrawal are read by Today under the same permanent key', async () => {
    const vault = fixtureVault();
    let overrides: RegistryOverrides | undefined;
    const provider = registryProvider(vault, NOW, (next) => {
      overrides = next;
    });
    const state = await provider.load();
    if (state.kind !== 'model') throw new Error(`expected a registry model, got ${state.kind}`);
    const bound = state.model.concepts.find((c) => c.originalName === BOUND_CONCEPT);
    const loose = state.model.concepts.find((c) => c.originalName === TOPIC_CONCEPT);
    if (bound === undefined || loose === undefined) throw new Error('registry missing a concept');

    await provider.rename(bound, 'Widget theory, renamed');
    await provider.withdrawConcept(loose);
    if (overrides === undefined) throw new Error('the registry reported no override change');

    const trendsConcepts = await createVaultTrendsSource({
      vault,
      registryOverrides: overrides,
    }).listConceptCourses();
    const trendsById = new Map((trendsConcepts ?? []).map((c) => [c.conceptId, c]));
    expect(trendsById.get(bound.key)?.displayName).toBe('Widget theory, renamed');
    expect(trendsById.has(loose.key)).toBe(true);
    expect(isConceptPruned(overrides, loose.key)).toBe(true);
  });
});

/**
 * The join `buildTodayPanel` (via `buildMasteryOverview`/`buildInsights`,
 * `olea-core`'s `today/panel.ts`) performs: `entries` — read by
 * `readReviewHistory`, whose `conceptIds` carry whichever key a real review
 * logged — against `concepts`, supplied by the wired `TodayTrendsSource`
 * (production's `main.ts` always wires `createVaultTrendsSource`).
 *
 * This suite writes ONE review for each concept, keyed by the exact key
 * `createVaultScopeSource` (and the registry, and the grove) derive for it —
 * the key a real review is logged under — then folds those same entries
 * against each reader's own concept-id list.
 */
describe('real review history folds to the same growth stage through every reader ([D-357])', () => {
  const NOW = new Date('2026-09-01T09:00:00Z');
  const REVIEWED_AT = '2026-08-25T09:00:00Z';
  const AFTER_REVIEW = new Date('2026-09-10T09:00:00Z');

  async function vaultWithOneReviewPerConcept(): Promise<ReturnType<typeof fixtureVault>> {
    const vault = fixtureVault();
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

  it('scope source, registry and grove all read both concepts as sprout', async () => {
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

  it("folding the same entries against createVaultTrendsSource's ids reads sprout too — Today sees the review", async () => {
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
      expect(state, `mastery via trends source's own id, for ${name}`).toBe('sprout');
    }
  });
});
