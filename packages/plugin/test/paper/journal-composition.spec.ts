/**
 * `[D-430]` (decision sheet row 17, `ol-egov.141.89.7.5`): the practice paper is composed through
 * its resumable journal, and the slot generator is the three-outcome port.
 *
 * What the ruling asks, and where each is proved below:
 *  - an operational outage KEEPS the unfinished paper and the next request drafts only the missing
 *    parts (the outage and resume suites);
 *  - reuse checks source versions, scope, structure AND authoring specification, naming the
 *    component that changed, never merely unchanged course settings (the reuse suite);
 *  - an explicitly qualified partial (a source or capability gap) stays distinct from an outage:
 *    only a qualified partial is ever handed over, and an outage is work owed, never an empty
 *    reason (the distinctness suite);
 *  - the generator reads the three outcomes apart (the core classifier alone calls a zero-question
 *    success "generated"; `createWorkerPaperSlotOutcomePort` reads it as a refusal), so the wire
 *    here uses the outcome port and never the classifier directly.
 *
 * The journal itself, the fingerprint and the classifier are core's and tested there; this file
 * proves the plugin composition over them, against a real blueprint, a real vault fake and a fake
 * port. Synthetic ids and concept names only (INV-3).
 */

import {
  type BuildPaperBlueprintInput,
  buildPaperBlueprint,
  type ConceptRecord,
  extentSlotCountTarget,
  fillPaperBlueprintSlots,
  listPaperJournals,
  listPaperRecords,
  type PaperBlueprint,
  type PaperItemGenerationRequest,
  type PaperRecoveredStructure,
  type PaperStructureTemplate,
  type WorkerTaskRequest,
} from 'olea-core';
import { describe, expect, it } from 'vitest';
import {
  createWorkerPaperSlotOutcomePort,
  type PaperItemPortOutcome,
  type PaperSlotOutcomePort,
} from '../../src/oracle/paper-item-port.js';
import { buildBlueprintInputForCourse } from '../../src/paper/assemble.js';
import { INCOMPLETE_PAPER_SENTENCE, omittedPartLine } from '../../src/paper/copy.js';
import {
  composePaperThroughJournal,
  type PaperCompositionScope,
  type PaperStimulusLookup,
} from '../../src/paper/journal-composition.js';
import { buildReadyStateFromRecord } from '../../src/paper/provider.js';
import { memoryVault } from '../review/memory-vault.js';

const COURSE = 'COURSEA';
const AS_OF = '2026-09-19';

function concept(index: number, definition = `her own note on topic ${index}`): ConceptRecord {
  return {
    key: `concept-${index}`,
    name: `Topic ${String.fromCharCode(65 + index)}`,
    tier: 1,
    courses: [COURSE],
    sourcePaths: [`01 Courses/${COURSE}/Topic ${index}.md`],
    boundNotePath: `01 Courses/${COURSE}/Topic ${index}.md`,
    definition,
  };
}

/** A real blueprint over `count` concepts, each with one held note. Every slot fills (a `written` course, the default demand). */
async function blueprintOf(
  count: number,
  options: { readonly definitionOf?: (index: number) => string } = {},
): Promise<{ blueprint: PaperBlueprint; scope: PaperCompositionScope }> {
  const concepts = Array.from({ length: count }, (_, index) =>
    concept(index, options.definitionOf?.(index)),
  );
  const input = await buildBlueprintInputForCourse(
    memoryVault(),
    concepts,
    [{ course: COURSE, type: 'exam', due: '2026-09-22' }],
    COURSE,
    AS_OF,
  );
  const blueprint = buildPaperBlueprint(input);
  return {
    blueprint,
    scope: {
      eligibleConceptKeys: concepts.map((c) => c.key),
      outcomes: [],
    },
  };
}

const generated = (
  request: PaperItemGenerationRequest,
  promptVersion = 'v1',
): PaperItemPortOutcome => ({
  status: 'generated',
  taskId: request.taskId,
  promptVersion,
  response: { ok: true, result: { cards: [{ front: 'q', back: 'a' }] } },
});

interface ScriptedPort {
  readonly port: PaperSlotOutcomePort;
  readonly calls: PaperItemGenerationRequest[];
}

/** A port that answers each call by `answer(request, callNumberForThatConcept)`; every call is logged. */
function scriptedPort(
  answer: (request: PaperItemGenerationRequest, attempt: number) => PaperItemPortOutcome,
): ScriptedPort {
  const calls: PaperItemGenerationRequest[] = [];
  const attempts = new Map<string, number>();
  return {
    calls,
    port: async (request) => {
      calls.push(request);
      const attempt = (attempts.get(request.conceptName) ?? 0) + 1;
      attempts.set(request.conceptName, attempt);
      return answer(request, attempt);
    },
  };
}

const OUTAGE: PaperItemPortOutcome = { status: 'unavailable', reason: 'transport-failure' };

/** One counter for the whole file: two composes in a test must never mint the same journal or paper id. */
let nonceCounter = 0;
function freshOptions() {
  return {
    generateId: () => `nonce-${++nonceCounter}`,
    now: () => '2026-09-19T00:00:00.000Z',
  };
}

async function compose(
  vault: ReturnType<typeof memoryVault>,
  blueprint: PaperBlueprint,
  scope: PaperCompositionScope,
  port: PaperSlotOutcomePort,
  options = freshOptions(),
) {
  return composePaperThroughJournal({ vault, blueprint, scope, port, options });
}

describe('a finished journal makes the same paper the flat path made', () => {
  it('every slot generated: the items and empty slots equal what fillPaperBlueprintSlots produces, and the paper is complete', async () => {
    const { blueprint, scope } = await blueprintOf(3);
    expect(blueprint.slots).toHaveLength(3);
    const vault = memoryVault();
    const scripted = scriptedPort((request) => generated(request));

    const result = await compose(vault, blueprint, scope, scripted.port);

    expect(result.kind).toBe('finished');
    if (result.kind !== 'finished') return;
    const flat = await fillPaperBlueprintSlots(blueprint, async (request) => {
      const outcome = generated(request);
      if (outcome.status !== 'generated') throw new Error('unreachable');
      return outcome;
    });
    expect(result.record.items).toEqual(flat.items);
    expect(result.record.emptySlots).toEqual(flat.emptySlots);
    expect(result.record.completion).toEqual({ status: 'complete' });
    expect(result.resume).toBe('fresh');
  });

  it('asks the port for exactly what the flat path asked: the slot task, course, concept, chunks, and purpose readiness', async () => {
    const { blueprint, scope } = await blueprintOf(2);
    const scripted = scriptedPort((request) => generated(request));
    await compose(memoryVault(), blueprint, scope, scripted.port);
    expect(scripted.calls).toEqual(
      blueprint.slots.map((slot) => ({
        taskId: slot.taskId,
        courseCode: COURSE,
        conceptName: slot.conceptName,
        sourceChunks: slot.sourceChunks,
        purpose: 'readiness',
      })),
    );
  });

  it('the journal path sends a slot demand only when the blueprint read it from her papers ([D-437] W1)', async () => {
    const { blueprint, scope } = await blueprintOf(2);
    const readBlueprint: PaperBlueprint = {
      ...blueprint,
      intendedDemandBasis: 'read',
      slots: blueprint.slots.map((slot) => ({ ...slot, intendedDemand: 'recall-a-fact' as const })),
    };
    const read = scriptedPort((request) => generated(request));
    await compose(memoryVault(), readBlueprint, scope, read.port);
    expect(read.calls.map((call) => call.intendedDemand)).toEqual([
      'recall-a-fact',
      'recall-a-fact',
    ]);

    const defaulted = scriptedPort((request) => generated(request));
    await compose(
      memoryVault(),
      { ...blueprint, intendedDemandBasis: 'default-no-reading' },
      scope,
      defaulted.port,
    );
    expect(defaulted.calls).toHaveLength(2);
    for (const call of defaulted.calls) expect('intendedDemand' in call).toBe(false);
  });

  it('a paper with no slot to draft still finishes, keeping the blueprint own empty slots', async () => {
    const { blueprint, scope } = await blueprintOf(0);
    const scripted = scriptedPort((request) => generated(request));
    const result = await compose(memoryVault(), blueprint, scope, scripted.port);
    expect(scripted.calls).toHaveLength(0);
    expect(result.kind).toBe('finished');
    if (result.kind === 'finished') {
      expect(result.record.items).toEqual([]);
      expect(result.record.emptySlots).toEqual(blueprint.emptySlots);
    }
  });

  it('every pull is a fresh paper: a finished journal is never resumed into the next one', async () => {
    const { blueprint, scope } = await blueprintOf(2);
    const vault = memoryVault();
    const first = await compose(vault, blueprint, scope, scriptedPort((r) => generated(r)).port);
    const secondScripted = scriptedPort((r) => generated(r));
    const second = await compose(vault, blueprint, scope, secondScripted.port);
    expect(first.kind === 'finished' && second.kind === 'finished').toBe(true);
    if (first.kind === 'finished' && second.kind === 'finished') {
      expect(second.record.id).not.toBe(first.record.id);
      expect(second.resume).toBe('fresh');
    }
    expect(secondScripted.calls).toHaveLength(2);
    expect(await listPaperRecords(vault)).toHaveLength(2);
  });
});

describe('an outage keeps the unfinished paper; the next request drafts only the missing parts ([D-430])', () => {
  it('stops at the first slot that is still unavailable after its one retry, hands nothing over, and keeps what landed', async () => {
    const { blueprint, scope } = await blueprintOf(3);
    const vault = memoryVault();
    // Slot 0 lands; slot 1 is down on every call.
    const scripted = scriptedPort((request, _attempt) =>
      request.conceptName === blueprint.slots[1]?.conceptName ? OUTAGE : generated(request),
    );

    const result = await compose(vault, blueprint, scope, scripted.port);

    expect(result).toMatchObject({
      kind: 'unfinished',
      reason: 'service-unavailable',
      plannedSlotCount: 3,
      owedSlotCount: 2,
    });
    // One attempt for the landed slot, the outage slot tried twice (the retry), the third never reached.
    expect(scripted.calls.map((c) => c.conceptName)).toEqual([
      blueprint.slots[0]?.conceptName,
      blueprint.slots[1]?.conceptName,
      blueprint.slots[1]?.conceptName,
    ]);
    // No paper exists: an outage never becomes a partial paper.
    expect(await listPaperRecords(vault)).toEqual([]);
    const journals = await listPaperJournals(vault);
    expect(journals).toHaveLength(1);
    expect(journals[0]?.record.status).toBe('open');
    expect(Object.keys(journals[0]?.record.outcomes ?? {})).toEqual(['slot-0', 'slot-1']);
    expect(journals[0]?.record.outcomes['slot-0']?.status).toBe('landed');
    expect(journals[0]?.record.outcomes['slot-1']).toEqual({ status: 'owed', attempts: 2 });
  });

  it('the next request resumes: only the missing parts are drafted, and the paper is finished from the kept work', async () => {
    const { blueprint, scope } = await blueprintOf(3);
    const vault = memoryVault();
    const down = scriptedPort((request) =>
      request.conceptName === blueprint.slots[1]?.conceptName ? OUTAGE : generated(request),
    );
    await compose(vault, blueprint, scope, down.port);

    const up = scriptedPort((request) => generated(request));
    const result = await compose(vault, blueprint, scope, up.port);

    expect(up.calls.map((c) => c.conceptName)).toEqual([
      blueprint.slots[1]?.conceptName,
      blueprint.slots[2]?.conceptName,
    ]);
    expect(result.kind).toBe('finished');
    if (result.kind !== 'finished') return;
    expect(result.resume).toBe('resumed');
    expect(result.record.items.map((item) => item.slotId)).toEqual(['slot-0', 'slot-1', 'slot-2']);
    expect(result.record.completion).toEqual({ status: 'complete' });
    expect((await listPaperJournals(vault))[0]?.record.status).toBe('completed');
    expect(await listPaperRecords(vault)).toHaveLength(1);
  });

  it('an item that landed before the outage is the very item in the finished paper, never regenerated', async () => {
    const { blueprint, scope } = await blueprintOf(2);
    const vault = memoryVault();
    const down = scriptedPort((request) =>
      request.conceptName === blueprint.slots[1]?.conceptName
        ? OUTAGE
        : generated(request, 'v-first'),
    );
    await compose(vault, blueprint, scope, down.port);
    const up = scriptedPort((request) => generated(request, 'v-first'));
    const result = await compose(vault, blueprint, scope, up.port);
    expect(result.kind === 'finished' && result.record.items[0]?.promptVersion).toBe('v-first');
    expect(up.calls).toHaveLength(1);
  });

  it('an outage on the very first slot keeps a journal with nothing landed, and the retry is bounded at one', async () => {
    const { blueprint, scope } = await blueprintOf(2);
    const vault = memoryVault();
    const scripted = scriptedPort(() => OUTAGE);
    const result = await compose(vault, blueprint, scope, scripted.port);
    expect(result).toMatchObject({ kind: 'unfinished', owedSlotCount: 2 });
    expect(scripted.calls).toHaveLength(2);
    expect(await listPaperRecords(vault)).toEqual([]);
  });

  it('a port that throws is an outage too, never a refusal', async () => {
    const { blueprint, scope } = await blueprintOf(1);
    const vault = memoryVault();
    const result = await compose(vault, blueprint, scope, async () => {
      throw new Error('the port broke');
    });
    expect(result).toMatchObject({ kind: 'unfinished', reason: 'service-unavailable' });
    const outcomes = (await listPaperJournals(vault))[0]?.record.outcomes ?? {};
    expect(outcomes['slot-0']?.status).toBe('owed');
  });
});

describe('an outage, a refusal and a partial paper stay three different things', () => {
  it('a refusal is a fact about her material: the slot ends empty, the paper is a qualified partial by source gap, and it is handed over', async () => {
    const { blueprint, scope } = await blueprintOf(3);
    const vault = memoryVault();
    const scripted = scriptedPort((request) =>
      request.conceptName === blueprint.slots[1]?.conceptName
        ? { status: 'refused', reason: 'empty-result' }
        : generated(request),
    );

    const result = await compose(vault, blueprint, scope, scripted.port);

    expect(result.kind).toBe('finished');
    if (result.kind !== 'finished') return;
    expect(result.record.completion).toEqual({ status: 'qualified-partial', gaps: ['source'] });
    expect(result.record.items).toHaveLength(2);
    expect(result.record.emptySlots).toContainEqual(
      expect.objectContaining({
        slotId: 'slot-1',
        reasonCode: 'generator-refused',
        reason: 'generator refused: empty-result',
      }),
    );
    // A refusal is never retried: it says something about her notes, not about the service.
    expect(
      scripted.calls.filter((c) => c.conceptName === blueprint.slots[1]?.conceptName),
    ).toHaveLength(1);
  });

  it('an outage is never recorded as an empty slot, and a refusal is never recorded as owed', async () => {
    const { blueprint, scope } = await blueprintOf(2);
    const vault = memoryVault();
    await compose(
      vault,
      blueprint,
      scope,
      scriptedPort((request) =>
        request.conceptName === blueprint.slots[0]?.conceptName
          ? { status: 'refused', reason: 'empty-result' }
          : OUTAGE,
      ).port,
    );
    const outcomes = (await listPaperJournals(vault))[0]?.record.outcomes ?? {};
    expect(outcomes['slot-0']?.status).toBe('empty');
    expect(outcomes['slot-1']?.status).toBe('owed');
    expect(JSON.stringify(outcomes)).not.toContain('transport-failure');
  });

  it('an unfinished result names no empty reason and no partial: it carries counts and a journal id only', async () => {
    const { blueprint, scope } = await blueprintOf(2);
    const result = await compose(memoryVault(), blueprint, scope, scriptedPort(() => OUTAGE).port);
    if (result.kind !== 'unfinished') throw new Error('expected an unfinished result');
    expect(Object.keys(result).sort()).toEqual(
      ['journalId', 'kind', 'owedSlotCount', 'plannedSlotCount', 'reason', 'resume'].sort(),
    );
  });
});

describe('slots the blueprint left empty before any call qualify the paper too, by kind', () => {
  const planTimeEmpty = (
    reasonCode: 'demand-unsupported' | 'no-held-source' | 'rank-excluded',
  ): PaperBlueprint['emptySlots'][number] => ({
    slotId: `plan-${reasonCode}`,
    conceptKey: 'concept-x',
    conceptName: 'Topic X',
    reasonCode,
    reason: `decided before any call: ${reasonCode}`,
  });

  async function finishedWith(reasonCodes: readonly Parameters<typeof planTimeEmpty>[0][]) {
    const { blueprint, scope } = await blueprintOf(2);
    const withEmpties: PaperBlueprint = {
      ...blueprint,
      emptySlots: [...blueprint.emptySlots, ...reasonCodes.map(planTimeEmpty)],
    };
    const result = await compose(
      memoryVault(),
      withEmpties,
      scope,
      scriptedPort((request) => generated(request)).port,
    );
    if (result.kind !== 'finished') throw new Error('expected a finished paper');
    return result.record;
  }

  it('a capability gap (no generator serves the demand) is a qualified partial by capability, apart from a source gap', async () => {
    expect((await finishedWith(['demand-unsupported'])).completion).toEqual({
      status: 'qualified-partial',
      gaps: ['capability'],
    });
  });

  it('a slot with no held source is a source gap', async () => {
    expect((await finishedWith(['no-held-source'])).completion).toEqual({
      status: 'qualified-partial',
      gaps: ['source'],
    });
  });

  it('both kinds name both, never blurred into one', async () => {
    expect((await finishedWith(['no-held-source', 'demand-unsupported'])).completion).toEqual({
      status: 'qualified-partial',
      gaps: ['capability', 'source'],
    });
  });

  it('a rank-excluded slot is the paper size, not a gap: the paper is complete, and the slot is still named', async () => {
    const record = await finishedWith(['rank-excluded']);
    expect(record.completion).toEqual({ status: 'complete' });
    expect(record.emptySlots.map((slot) => slot.reasonCode)).toContain('rank-excluded');
  });
});

describe('reuse checks all four inputs, and names the one that changed ([D-430])', () => {
  async function unfinishedThenChange(
    change: (base: { blueprint: PaperBlueprint; scope: PaperCompositionScope }) => Promise<{
      blueprint: PaperBlueprint;
      scope: PaperCompositionScope;
    }>,
  ) {
    const base = await blueprintOf(2);
    const vault = memoryVault();
    await compose(vault, base.blueprint, base.scope, scriptedPort(() => OUTAGE).port);
    const changed = await change(base);
    const up = scriptedPort((request) => generated(request));
    const result = await compose(vault, changed.blueprint, changed.scope, up.port);
    return { vault, up, result };
  }

  it('unchanged inputs resume the kept journal, whatever else moved (the day, the course settings)', async () => {
    const { up, result } = await unfinishedThenChange(async (base) => ({
      blueprint: { ...base.blueprint, asOf: '2026-09-20' },
      scope: base.scope,
    }));
    expect(result.kind === 'finished' && result.resume).toBe('resumed');
    expect(up.calls).toHaveLength(2);
  });

  it('a changed source discards the journal naming sourceVersions, and drafts everything afresh', async () => {
    const { vault, up, result } = await unfinishedThenChange(async () =>
      blueprintOf(2, { definitionOf: (index) => `her REVISED note on topic ${index}` }),
    );
    expect(result.kind === 'finished' && result.resume).toBe('discarded-and-fresh');
    expect(up.calls).toHaveLength(2);
    const journals = (await listPaperJournals(vault)).map((entry) => entry.record);
    const discarded = journals.filter((record) => record.status === 'discarded');
    expect(discarded).toHaveLength(1);
    expect(discarded[0]?.discard).toMatchObject({
      reason: 'reuse-incompatible',
      changed: ['sourceVersions'],
    });
  });

  it('a changed scope discards the journal naming scope', async () => {
    const { vault, result } = await unfinishedThenChange(async (base) => ({
      blueprint: base.blueprint,
      scope: {
        eligibleConceptKeys: [...base.scope.eligibleConceptKeys, 'concept-new'],
        outcomes: base.scope.outcomes,
      },
    }));
    expect(result.kind === 'finished' && result.resume).toBe('discarded-and-fresh');
    const discarded = (await listPaperJournals(vault)).filter(
      (entry) => entry.record.status === 'discarded',
    );
    expect(discarded[0]?.record.discard?.changed).toEqual(['scope']);
  });

  it('a changed declared outcome (a concept moved under another outcome) is a scope change', async () => {
    const { vault, result } = await unfinishedThenChange(async (base) => ({
      blueprint: base.blueprint,
      scope: {
        eligibleConceptKeys: base.scope.eligibleConceptKeys,
        outcomes: [{ outcomeId: 'outcome-1', conceptKeys: ['concept-0'] }],
      },
    }));
    expect(result.kind === 'finished' && result.resume).toBe('discarded-and-fresh');
    const discarded = (await listPaperJournals(vault)).filter(
      (entry) => entry.record.status === 'discarded',
    );
    expect(discarded[0]?.record.discard?.changed).toEqual(['scope']);
  });

  it('a changed structure (a different slot plan) discards the journal naming structure', async () => {
    const { vault, result } = await unfinishedThenChange(async () => blueprintOf(3));
    expect(result.kind === 'finished' && result.resume).toBe('discarded-and-fresh');
    const discarded = (await listPaperJournals(vault)).filter(
      (entry) => entry.record.status === 'discarded',
    );
    expect(discarded[0]?.record.discard?.changed).toContain('structure');
  });

  it('a changed authoring specification (steering emphasis) discards the journal naming authoringSpec', async () => {
    const { vault, result } = await unfinishedThenChange(async (base) => ({
      blueprint: {
        ...base.blueprint,
        steering: { ...base.blueprint.steering, emphasis: 'topic a' },
      },
      scope: base.scope,
    }));
    expect(result.kind === 'finished' && result.resume).toBe('discarded-and-fresh');
    const discarded = (await listPaperJournals(vault)).filter(
      (entry) => entry.record.status === 'discarded',
    );
    expect(discarded[0]?.record.discard?.changed).toEqual(['authoringSpec']);
  });
});

describe('prompt versions never mix inside one paper', () => {
  it('a resumed slot stamped with another prompt version discards the journal: no paper, and the next request starts fresh and finishes', async () => {
    const { blueprint, scope } = await blueprintOf(2);
    const vault = memoryVault();
    await compose(
      vault,
      blueprint,
      scope,
      scriptedPort((request) =>
        request.conceptName === blueprint.slots[1]?.conceptName ? OUTAGE : generated(request, 'v1'),
      ).port,
    );

    const changedSpec = await compose(
      vault,
      blueprint,
      scope,
      scriptedPort((request) => generated(request, 'v2')).port,
    );
    expect(changedSpec).toMatchObject({ kind: 'unfinished', reason: 'authoring-spec-changed' });
    expect(await listPaperRecords(vault)).toEqual([]);

    const fresh = scriptedPort((request) => generated(request, 'v2'));
    const next = await compose(vault, blueprint, scope, fresh.port);
    expect(next.kind === 'finished' && next.resume).toBe('fresh');
    expect(fresh.calls).toHaveLength(2);
  });
});

describe('what the journal keeps stays in her vault and holds no server state (C6)', () => {
  it('writes only under the paper store folder, and only journals and papers', async () => {
    const { blueprint, scope } = await blueprintOf(2);
    const vault = memoryVault();
    await compose(vault, blueprint, scope, scriptedPort((r) => generated(r)).port);
    expect(vault.writes.every((path) => path.startsWith('.olea/papers/'))).toBe(true);
  });
});

/**
 * `[D-548]` (`ol-egov.141.89.7.87`, David 2026-10-20): "A paper she left unfinished picks up where
 * it stopped, on the plan it started with." Scenarios: features/F4-oracle.md, "a reading that
 * arrives after a paper started leaves that paper on its recorded plan", "a paper set aside for a
 * change of hers starts afresh at the reading's length, and the reading is not named as the
 * change", and the clarified "a changed source, scope, structure or authoring specification
 * discards the journal, naming which", tagged `@auto:plugin/paper/journal-composition.spec`. Seven
 * synthetic topics: the declared standard extent plans 6 of them; a reading of papers of 3, 4 and 7
 * questions plans 4.
 */
describe('an unfinished paper resumes on the plan it started with ([D-548])', () => {
  const READING: PaperRecoveredStructure = {
    sittingCount: 3,
    currentCount: 0,
    historicalCount: 0,
    sittings: [3, 4, 7].map((itemCount) => ({
      regime: 'unknown' as const,
      sections: [
        { label: 'A', questionForm: 'x', itemCount, marks: { status: 'unknown' as const } },
      ],
    })),
  };

  async function inputOf(
    options: {
      readonly structure?: PaperRecoveredStructure | null;
      readonly definitionOf?: (index: number) => string;
      readonly alpha?: BuildPaperBlueprintInput['alpha'];
    } = {},
  ): Promise<{ input: BuildPaperBlueprintInput; scope: PaperCompositionScope }> {
    const concepts = Array.from({ length: 7 }, (_, index) =>
      concept(index, options.definitionOf?.(index)),
    );
    const assembled = await buildBlueprintInputForCourse(
      memoryVault(),
      concepts,
      [{ course: COURSE, type: 'exam', due: '2026-09-22' }],
      COURSE,
      AS_OF,
      [],
      options.structure ?? null,
    );
    return {
      input: options.alpha === undefined ? assembled : { ...assembled, alpha: options.alpha },
      scope: { eligibleConceptKeys: concepts.map((c) => c.key), outcomes: [] },
    };
  }

  /** The provider's call (`provider.ts`): the blueprint, its slot count, and the same composition at another count. */
  function composeAsProvider(
    vault: ReturnType<typeof memoryVault>,
    composition: { input: BuildPaperBlueprintInput; scope: PaperCompositionScope },
    port: PaperSlotOutcomePort,
  ) {
    const { input, scope } = composition;
    return composePaperThroughJournal({
      vault,
      blueprint: buildPaperBlueprint(input),
      scope,
      port,
      options: freshOptions(),
      extent: {
        slotCount: extentSlotCountTarget(input.steering?.extent, input.structure),
        planAt: (slotCount) => buildPaperBlueprint({ ...input, slotCount }),
      },
    });
  }

  /** Down from the fourth topic on: three questions land, then the paper stops. */
  const downFromTopicD = () =>
    scriptedPort((request) =>
      ['Topic D', 'Topic E', 'Topic F', 'Topic G'].includes(request.conceptName)
        ? OUTAGE
        : generated(request),
    );

  it('records the length its plan was made at on the journal it opens', async () => {
    const vault = memoryVault();
    const result = await composeAsProvider(vault, await inputOf(), downFromTopicD().port);
    expect(result).toMatchObject({ kind: 'unfinished', plannedSlotCount: 6, owedSlotCount: 3 });
    expect((await listPaperJournals(vault))[0]?.record.extent).toEqual({
      slotCount: 6,
      structureSummary: null,
    });
  });

  it('a reading that arrives later leaves the paper on its plan: nothing is discarded, nothing written is drafted again, and the next new paper takes the new length', async () => {
    const vault = memoryVault();
    await composeAsProvider(vault, await inputOf(), downFromTopicD().port);

    const withReading = await inputOf({ structure: READING });
    expect(buildPaperBlueprint(withReading.input).slots).toHaveLength(4);
    const up = scriptedPort((request) => generated(request));
    const resumed = await composeAsProvider(vault, withReading, up.port);

    expect(resumed.kind).toBe('finished');
    if (resumed.kind !== 'finished') return;
    expect(resumed.resume).toBe('resumed');
    expect(resumed.materialChanged).toBe(false);
    expect(up.calls.map((call) => call.conceptName)).toEqual(['Topic D', 'Topic E', 'Topic F']);
    expect(resumed.record.items.map((item) => item.slotId)).toEqual([
      'slot-0',
      'slot-1',
      'slot-2',
      'slot-3',
      'slot-4',
      'slot-5',
    ]);
    // Its plan-time empty slots and its reading summary are the ones it started with.
    expect(resumed.record.emptySlots.map((slot) => [slot.slotId, slot.reasonCode])).toEqual([
      ['excluded-6', 'rank-excluded'],
    ]);
    expect(resumed.record.compositionAccount.structureSummary).toBeNull();
    expect(resumed.record.completion).toEqual({ status: 'complete' });
    const journals = (await listPaperJournals(vault)).map((entry) => entry.record);
    expect(journals.map((journal) => journal.status)).toEqual(['completed']);

    const next = scriptedPort((request) => generated(request));
    const fresh = await composeAsProvider(vault, withReading, next.port);
    expect(fresh.kind === 'finished' && fresh.resume).toBe('fresh');
    expect(fresh.kind === 'finished' && fresh.record.items).toHaveLength(4);
    expect(fresh.kind === 'finished' && fresh.record.compositionAccount.structureSummary).toEqual({
      sittingCount: 3,
      currentCount: 0,
      historicalCount: 0,
    });
    expect(next.calls).toHaveLength(4);
  });

  it('a journal opened before the length was recorded was planned with no reading, and resumes on that plan', async () => {
    const vault = memoryVault();
    const before = await inputOf();
    // The composition as it ran before `[D-548]`: no slot count passed, none recorded.
    await compose(vault, buildPaperBlueprint(before.input), before.scope, downFromTopicD().port);
    expect((await listPaperJournals(vault))[0]?.record).not.toHaveProperty('extent');

    const up = scriptedPort((request) => generated(request));
    const resumed = await composeAsProvider(vault, await inputOf({ structure: READING }), up.port);
    expect(resumed.kind === 'finished' && resumed.resume).toBe('resumed');
    expect(resumed.kind === 'finished' && resumed.record.items).toHaveLength(6);
    expect(up.calls).toHaveLength(3);
  });

  it('a paper started on a reading keeps that length when the reading is no longer read', async () => {
    const vault = memoryVault();
    const started = await composeAsProvider(
      vault,
      await inputOf({ structure: READING }),
      scriptedPort((request) =>
        ['Topic C', 'Topic D'].includes(request.conceptName) ? OUTAGE : generated(request),
      ).port,
    );
    expect(started).toMatchObject({ kind: 'unfinished', plannedSlotCount: 4, owedSlotCount: 2 });

    const up = scriptedPort((request) => generated(request));
    const resumed = await composeAsProvider(vault, await inputOf({ structure: null }), up.port);
    expect(resumed.kind === 'finished' && resumed.resume).toBe('resumed');
    expect(resumed.kind === 'finished' && resumed.record.items).toHaveLength(4);
    expect(
      resumed.kind === 'finished' && resumed.record.compositionAccount.structureSummary,
    ).toEqual({ sittingCount: 3, currentCount: 0, historicalCount: 0 });
    expect(up.calls.map((call) => call.conceptName)).toEqual(['Topic C', 'Topic D']);
  });

  it('a note of hers edited as the reading arrives sets the paper aside naming its sources and nothing else; the fresh paper takes the new length', async () => {
    const vault = memoryVault();
    await composeAsProvider(vault, await inputOf(), downFromTopicD().port);

    const up = scriptedPort((request) => generated(request));
    const result = await composeAsProvider(
      vault,
      await inputOf({
        structure: READING,
        definitionOf: (index) => `her REVISED note on topic ${index}`,
      }),
      up.port,
    );
    expect(result.kind).toBe('finished');
    if (result.kind !== 'finished') return;
    expect(result.resume).toBe('discarded-and-fresh');
    expect(result.materialChanged).toBe(true);
    expect(result.record.items).toHaveLength(4);
    const discarded = (await listPaperJournals(vault)).filter(
      (entry) => entry.record.status === 'discarded',
    );
    expect(discarded.map((entry) => entry.record.discard)).toEqual([
      { reason: 'reuse-incompatible', changed: ['sourceVersions'] },
    ]);
  });

  it('a change to Olea’s own authoring as the reading arrives is named as that alone: the reading is not a change of hers, so no changed-material sentence', async () => {
    const vault = memoryVault();
    await composeAsProvider(vault, await inputOf(), downFromTopicD().port);

    const result = await composeAsProvider(
      vault,
      await inputOf({ structure: READING, alpha: 0.25 }),
      scriptedPort((request) => generated(request)).port,
    );
    expect(result.kind === 'finished' && result.resume).toBe('discarded-and-fresh');
    expect(result.kind === 'finished' && result.materialChanged).toBe(false);
    expect(result.kind === 'finished' && result.record.items).toHaveLength(4);
    const discarded = (await listPaperJournals(vault)).filter(
      (entry) => entry.record.status === 'discarded',
    );
    expect(discarded.map((entry) => entry.record.discard?.changed)).toEqual([['authoringSpec']]);
  });
});

/**
 * `ol-egov.141.89.7.93` (`[D-559]`, `[D-560]`, `[D-561]`, `[D-562]`, David 2026-10-21): the paper
 * written in its structured form from her stored reading. Scenarios: features/F4-oracle.md, under
 * "F4.11 — The structured, resumable practice paper", tagged `@auto:plugin/paper/journal-composition.spec`.
 * Course A and course B are synthetic. Course A's stored reading: question 1 with parts 1(a) and
 * 1(b), 1(b) building on 1(a); question 2 on a shared table, parts 2(a) and 2(b). Its sections plan
 * four questions, so the paper takes all four parts.
 */
describe('the practice paper is written in its structured form from her stored reading ([D-559])', () => {
  const TEMPLATE: PaperStructureTemplate = {
    groups: [
      {
        id: 'q1',
        kind: 'parent-question',
        label: 'Question 1',
        memberLabels: ['1(a)', '1(b)'],
        anchor: { unitIndex: 1 },
        stimulus: { status: 'none' },
      },
      {
        id: 'q2',
        kind: 'shared-stimulus',
        label: 'Use the table',
        memberLabels: ['2(a)', '2(b)'],
        anchor: { unitIndex: 4 },
        stimulus: { status: 'identified', form: 'table', anchor: { unitIndex: 4 } },
      },
    ],
    parts: [
      {
        id: 'p1a',
        label: '1(a)',
        groupId: 'q1',
        questionForm: 'short answer',
        marks: { status: 'stated', value: 2 },
        dependsOn: { status: 'unknown' },
      },
      {
        id: 'p1b',
        label: '1(b)',
        groupId: 'q1',
        questionForm: 'short answer',
        marks: { status: 'unknown' },
        dependsOn: { status: 'stated', onPartIds: ['p1a'] },
      },
      {
        id: 'p2a',
        label: '2(a)',
        groupId: 'q2',
        questionForm: 'short answer',
        marks: { status: 'stated', value: 3 },
        dependsOn: { status: 'unknown' },
      },
      {
        id: 'p2b',
        label: '2(b)',
        groupId: 'q2',
        questionForm: 'short answer',
        marks: { status: 'stated', value: 3 },
        dependsOn: { status: 'unknown' },
      },
    ],
    totalMarks: { status: 'unknown' },
    timeAllowance: { status: 'unknown' },
  };

  /** The same paper read again from another sitting: no dependencies, other labels. */
  const OTHER_TEMPLATE: PaperStructureTemplate = {
    ...TEMPLATE,
    groups: TEMPLATE.groups.map((g) => ({ ...g, label: `${g.label}, another sitting` })),
    parts: TEMPLATE.parts.map((p) => ({ ...p, dependsOn: { status: 'unknown' as const } })),
  };

  const readingOf = (
    template: PaperStructureTemplate | undefined,
    itemCount = 4,
  ): PaperRecoveredStructure => ({
    sittingCount: 1,
    currentCount: 0,
    historicalCount: 0,
    sittings: [
      {
        regime: 'unknown',
        sections: [{ label: 'A', questionForm: 'x', itemCount, marks: { status: 'unknown' } }],
      },
    ],
    ...(template !== undefined ? { template } : {}),
  });

  async function inputOf(
    structure: PaperRecoveredStructure | null,
    options: { readonly definitionOf?: (index: number) => string } = {},
  ): Promise<{ input: BuildPaperBlueprintInput; scope: PaperCompositionScope }> {
    const concepts = Array.from({ length: 7 }, (_, index) =>
      concept(index, options.definitionOf?.(index)),
    );
    const input = await buildBlueprintInputForCourse(
      memoryVault(),
      concepts,
      [{ course: COURSE, type: 'exam', due: '2026-09-22' }],
      COURSE,
      AS_OF,
      [],
      structure,
    );
    return { input, scope: { eligibleConceptKeys: concepts.map((c) => c.key), outcomes: [] } };
  }

  /** The provider's call (`provider.ts`): the blueprint, its length, the same composition at another length, and the reading's template. */
  function composeAsProvider(
    vault: ReturnType<typeof memoryVault>,
    composition: { input: BuildPaperBlueprintInput; scope: PaperCompositionScope },
    port: PaperSlotOutcomePort,
    stimulusLookup?: PaperStimulusLookup,
  ) {
    const { input, scope } = composition;
    return composePaperThroughJournal({
      vault,
      blueprint: buildPaperBlueprint(input),
      scope,
      port,
      options: freshOptions(),
      extent: {
        slotCount: extentSlotCountTarget(input.steering?.extent, input.structure),
        planAt: (slotCount) => buildPaperBlueprint({ ...input, slotCount }),
      },
      template: input.structure?.template ?? null,
      ...(stimulusLookup !== undefined ? { stimulusLookup } : {}),
    });
  }

  /** A quiz item whose question and answer name its concept, so a dependent part's context is checkable. */
  const quizGenerated = (request: PaperItemGenerationRequest): PaperItemPortOutcome => ({
    status: 'generated',
    taskId: request.taskId,
    promptVersion: 'v1',
    response: {
      ok: true,
      stamp: { promptVersion: 'v1' },
      result: {
        questions: [
          {
            stem: `A question on ${request.conceptName}`,
            correctAnswer: `An answer on ${request.conceptName}`,
            distractors: ['x', 'y', 'z'],
            feedback: 'f',
          },
        ],
      },
    },
  });

  it('her stored reading’s groups and parts shape her paper: the plan records each part in its group with the dependencies the reading states, written in dependency order', async () => {
    const vault = memoryVault();
    const scripted = scriptedPort(quizGenerated);
    const result = await composeAsProvider(
      vault,
      await inputOf(readingOf(TEMPLATE)),
      scripted.port,
    );

    expect(result.kind).toBe('finished');
    if (result.kind !== 'finished') return;
    const journal = (await listPaperJournals(vault))[0]?.record;
    expect(journal?.schemaVersion).toBe(2);
    expect(
      journal?.plan.map((slot) => [slot.slotId, slot.conceptName, slot.dependsOnSlotIds]),
    ).toEqual([
      ['slot-0', 'Topic A', []],
      ['slot-1', 'Topic B', ['slot-0']],
      ['slot-2', 'Topic C', []],
      ['slot-3', 'Topic D', []],
    ]);
    expect(journal?.structure?.parts.map((p) => [p.slotId, p.groupId, p.label])).toEqual([
      ['slot-0', 'q1', '1(a)'],
      ['slot-1', 'q1', '1(b)'],
      ['slot-2', 'q2', '2(a)'],
      ['slot-3', 'q2', '2(b)'],
    ]);
    // A dependency the reading does not state adds no order and passes nothing along.
    expect(journal?.structure?.parts[2]?.dependsOn).toEqual({ status: 'unknown' });
    expect(scripted.calls.map((call) => call.conceptName)).toEqual([
      'Topic A',
      'Topic B',
      'Topic C',
      'Topic D',
    ]);
    expect(result.record.structure).toEqual(journal?.structure);
    expect(result.record.schemaVersion).toBe(2);
    expect(result.record.completion).toEqual({ status: 'complete' });
    expect(result.record.emptySlots.map((slot) => slot.reasonCode)).toEqual([
      'rank-excluded',
      'rank-excluded',
      'rank-excluded',
    ]);
    expect(buildReadyStateFromRecord(COURSE, result.record).incompleteStatement).toBeNull();
  });

  it('a part built on a part that could not be written is never requested, and the paper lists both with their ruled reasons', async () => {
    const scripted = scriptedPort((request) =>
      request.conceptName === 'Topic A'
        ? { status: 'refused', reason: 'empty-result' }
        : quizGenerated(request),
    );
    const result = await composeAsProvider(
      memoryVault(),
      await inputOf(readingOf(TEMPLATE)),
      scripted.port,
    );
    expect(result.kind).toBe('finished');
    if (result.kind !== 'finished') return;
    expect(scripted.calls.map((call) => call.conceptName)).toEqual([
      'Topic A',
      'Topic C',
      'Topic D',
    ]);
    const state = buildReadyStateFromRecord(COURSE, result.record);
    expect(state.incompleteStatement?.sentence).toBe(INCOMPLETE_PAPER_SENTENCE);
    expect(INCOMPLETE_PAPER_SENTENCE).toBe(
      'This paper is incomplete. Some planned questions could not be written.',
    );
    expect(state.incompleteStatement?.omittedParts.map(omittedPartLine)).toEqual([
      "Topic A — Olea couldn't write a question on this that stays within your material.",
      'Topic B — This part builds on an earlier part that could not be written.',
    ]);
    expect(result.record.emptySlots.find((slot) => slot.slotId === 'slot-1')).toMatchObject({
      reasonCode: 'depends-on-empty-part',
      causedBySlotId: 'slot-0',
    });
  });

  it('a group needing a table that none of her material supplies: none of its parts is requested, each is listed no-held-stimulus unless it had a reason of its own', async () => {
    const asked: string[] = [];
    const noneHeld: PaperStimulusLookup = async (request) => {
      asked.push(`${request.groupId}:${request.need.form}:${request.conceptKeys.join(',')}`);
      return { status: 'none-held' };
    };
    // Only topics A to C are held, so Topic D (2(b)) has no held source of its own: it keeps that reason.
    const scripted = scriptedPort(quizGenerated);
    const result = await composeAsProvider(
      memoryVault(),
      await inputOf(readingOf(TEMPLATE), {
        definitionOf: (index) => (index >= 3 ? '' : `note ${index}`),
      }),
      scripted.port,
      noneHeld,
    );
    expect(result.kind).toBe('finished');
    if (result.kind !== 'finished') return;
    expect(asked).toHaveLength(1);
    expect(asked[0]?.startsWith('q2:table:')).toBe(true);
    expect(scripted.calls.map((call) => call.conceptName)).toEqual(['Topic A', 'Topic B']);
    const reasons = Object.fromEntries(
      result.record.emptySlots
        .filter((slot) => slot.reasonCode !== 'rank-excluded')
        .map((slot) => [slot.slotId, slot.reasonCode]),
    );
    expect(reasons).toEqual({ 'slot-2': 'no-held-stimulus', 'slot-3': 'no-held-source' });
    expect(
      buildReadyStateFromRecord(COURSE, result.record).incompleteStatement?.omittedParts.map(
        (part) => part.reasonCode,
      ),
    ).toEqual(['no-held-stimulus', 'no-held-source']);
  });

  it('a group whose stimulus Olea has not looked for is never given that reason: it is written without shared material, by default and when the lookup fails', async () => {
    for (const lookup of [
      undefined,
      (async () => {
        throw new Error('the lookup broke');
      }) as PaperStimulusLookup,
    ]) {
      const scripted = scriptedPort(quizGenerated);
      const result = await composeAsProvider(
        memoryVault(),
        await inputOf(readingOf(TEMPLATE)),
        scripted.port,
        lookup,
      );
      expect(result.kind === 'finished' && result.record.completion).toEqual({
        status: 'complete',
      });
      expect(scripted.calls).toHaveLength(4);
      for (const call of scripted.calls) expect('sharedPassage' in call).toBe(false);
      expect(
        result.kind === 'finished' &&
          result.record.emptySlots.some((slot) => slot.reasonCode === 'no-held-stimulus'),
      ).toBe(false);
    }
  });

  it('a group that shares material is requested with the one passage the lookup found, recorded by source and chunk, never its text', async () => {
    const vault = memoryVault();
    const held: PaperStimulusLookup = async () => ({
      status: 'held',
      stimulus: { form: 'table', sourceId: '01 Courses/COURSEA/Topic 2.md', chunkIndex: 0 },
      text: 'a synthetic table of values',
    });
    const scripted = scriptedPort(quizGenerated);
    const result = await composeAsProvider(
      vault,
      await inputOf(readingOf(TEMPLATE)),
      scripted.port,
      held,
    );
    expect(result.kind).toBe('finished');
    expect(scripted.calls.map((call) => call.sharedPassage)).toEqual([
      undefined,
      undefined,
      { form: 'table', text: 'a synthetic table of values' },
      { form: 'table', text: 'a synthetic table of values' },
    ]);
    const group = result.kind === 'finished' ? result.record.structure?.groups[1] : undefined;
    expect(group?.heldStimulus).toEqual({
      form: 'table',
      sourceId: '01 Courses/COURSEA/Topic 2.md',
      chunkIndex: 0,
    });
    const journalText = JSON.stringify((await listPaperJournals(vault))[0]?.record);
    expect(journalText).not.toContain('a synthetic table of values');
  });

  it('a dependent part is requested with the earlier part’s question and answer, and a part with no stated dependency carries none; the port’s payload sends neither yet', async () => {
    const sent: WorkerTaskRequest[] = [];
    const worker = createWorkerPaperSlotOutcomePort({
      transport: {
        send: async (request) => {
          sent.push(request);
          return {
            ok: true,
            stamp: { promptVersion: 'v1' },
            result: {
              questions: [
                {
                  stem: `A question on ${(request.payload as { conceptName: string }).conceptName}`,
                  correctAnswer: 'An answer',
                  distractors: ['x', 'y', 'z'],
                  feedback: 'f',
                },
              ],
            },
          };
        },
      },
    });
    const requests: PaperItemGenerationRequest[] = [];
    const result = await composeAsProvider(
      memoryVault(),
      await inputOf(readingOf(TEMPLATE)),
      async (request) => {
        requests.push(request);
        return worker(request);
      },
    );
    expect(result.kind).toBe('finished');
    expect(requests.map((request) => request.earlierParts)).toEqual([
      undefined,
      [{ question: 'A question on Topic A', answer: 'An answer' }],
      undefined,
      undefined,
    ]);
    for (const request of [requests[0], requests[2], requests[3]]) {
      expect(request !== undefined && 'earlierParts' in request).toBe(false);
    }
    // `ol-egov.141.89.7.97` adds the contract field; until it is merged the payload is today's.
    expect(sent).toHaveLength(4);
    for (const request of sent) {
      expect(Object.keys(request.payload as object).sort()).toEqual([
        'conceptName',
        'courseCode',
        'purpose',
        'sourceChunks',
      ]);
    }
  });

  it('a reading without groups or parts composes as today: no reading, and a reading with sections only, are both the flat paper', async () => {
    for (const structure of [null, readingOf(undefined)]) {
      const vault = memoryVault();
      const composition = await inputOf(structure);
      const scripted = scriptedPort((request) => generated(request));
      const result = await composeAsProvider(vault, composition, scripted.port);
      const flat = buildPaperBlueprint(composition.input);
      expect(scripted.calls).toEqual(
        flat.slots.map((slot) => ({
          taskId: slot.taskId,
          courseCode: COURSE,
          conceptName: slot.conceptName,
          sourceChunks: slot.sourceChunks,
          purpose: 'readiness',
        })),
      );
      const journal = (await listPaperJournals(vault))[0]?.record;
      expect(journal?.schemaVersion).toBe(1);
      expect(journal).not.toHaveProperty('structure');
      expect(journal?.plan.every((slot) => slot.dependsOnSlotIds.length === 0)).toBe(true);
      expect(result.kind === 'finished' && result.record).not.toHaveProperty('structure');
      expect(result.kind === 'finished' && result.record.emptySlots).toEqual(flat.emptySlots);
    }
  });

  it('an unfinished flat paper resumes on its flat plan once a reading with groups and parts is stored: nothing discarded, nothing redrafted, no changed-material sentence; the next new paper is structured', async () => {
    const vault = memoryVault();
    const down = scriptedPort((request) =>
      ['Topic D', 'Topic E', 'Topic F', 'Topic G'].includes(request.conceptName)
        ? OUTAGE
        : generated(request),
    );
    const started = await composeAsProvider(vault, await inputOf(null), down.port);
    expect(started).toMatchObject({ kind: 'unfinished', plannedSlotCount: 6, owedSlotCount: 3 });

    const withParts = await inputOf(readingOf(TEMPLATE));
    const up = scriptedPort((request) => generated(request));
    const resumed = await composeAsProvider(vault, withParts, up.port);
    expect(resumed.kind).toBe('finished');
    if (resumed.kind !== 'finished') return;
    expect(resumed.resume).toBe('resumed');
    expect(resumed.materialChanged).toBe(false);
    expect(up.calls.map((call) => call.conceptName)).toEqual(['Topic D', 'Topic E', 'Topic F']);
    expect(resumed.record.items).toHaveLength(6);
    expect(resumed.record).not.toHaveProperty('structure');
    expect((await listPaperJournals(vault)).map((entry) => entry.record.status)).toEqual([
      'completed',
    ]);

    const next = await composeAsProvider(vault, withParts, scriptedPort(quizGenerated).port);
    expect(next.kind === 'finished' && next.resume).toBe('fresh');
    expect(next.kind === 'finished' && next.record.structure?.parts).toHaveLength(4);
  });

  it('an unfinished structured paper resumes on the structure its journal recorded after her reading changes; the next new paper is composed on the new reading', async () => {
    const vault = memoryVault();
    const down = scriptedPort((request) =>
      request.conceptName === 'Topic C' ? OUTAGE : quizGenerated(request),
    );
    const started = await composeAsProvider(vault, await inputOf(readingOf(TEMPLATE)), down.port);
    expect(started).toMatchObject({ kind: 'unfinished', plannedSlotCount: 4, owedSlotCount: 2 });

    const changed = await inputOf(readingOf(OTHER_TEMPLATE));
    const up = scriptedPort(quizGenerated);
    const resumed = await composeAsProvider(vault, changed, up.port);
    expect(resumed.kind).toBe('finished');
    if (resumed.kind !== 'finished') return;
    expect(resumed.resume).toBe('resumed');
    expect(resumed.materialChanged).toBe(false);
    expect(up.calls.map((call) => call.conceptName)).toEqual(['Topic C', 'Topic D']);
    expect(resumed.record.structure?.groups.map((g) => g.label)).toEqual([
      'Question 1',
      'Use the table',
    ]);
    expect(resumed.record.structure?.parts[1]?.dependsOn).toEqual({
      status: 'stated',
      onSlotIds: ['slot-0'],
    });

    const next = await composeAsProvider(vault, changed, scriptedPort(quizGenerated).port);
    expect(next.kind === 'finished' && next.resume).toBe('fresh');
    expect(next.kind === 'finished' && next.record.structure?.groups.map((g) => g.label)).toEqual([
      'Question 1, another sitting',
      'Use the table, another sitting',
    ]);
  });

  it('a structured paper set aside for an edit of hers is discarded naming its sources only, with the changed-material sentence, and the fresh paper takes the reading as it is', async () => {
    const vault = memoryVault();
    const down = scriptedPort((request) =>
      request.conceptName === 'Topic C' ? OUTAGE : quizGenerated(request),
    );
    await composeAsProvider(vault, await inputOf(readingOf(TEMPLATE)), down.port);
    const result = await composeAsProvider(
      vault,
      await inputOf(readingOf(OTHER_TEMPLATE), {
        definitionOf: (index) => `her REVISED note on topic ${index}`,
      }),
      scriptedPort(quizGenerated).port,
    );
    expect(result.kind).toBe('finished');
    if (result.kind !== 'finished') return;
    expect(result.resume).toBe('discarded-and-fresh');
    expect(result.materialChanged).toBe(true);
    const discarded = (await listPaperJournals(vault)).filter(
      (entry) => entry.record.status === 'discarded',
    );
    expect(discarded.map((entry) => entry.record.discard)).toEqual([
      { reason: 'reuse-incompatible', changed: ['sourceVersions'] },
    ]);
    expect(result.record.structure?.groups[0]?.label).toBe('Question 1, another sitting');
  });

  it('a template no whole question of which fits the paper composes the flat paper', async () => {
    const oneQuestion: PaperStructureTemplate = {
      ...TEMPLATE,
      groups: [TEMPLATE.groups[0] as PaperStructureTemplate['groups'][number]],
      parts: TEMPLATE.parts
        .slice(0, 2)
        .concat(
          TEMPLATE.parts
            .slice(0, 2)
            .map((p) => ({ ...p, id: `${p.id}-more`, dependsOn: { status: 'unknown' as const } })),
        ),
    };
    const vault = memoryVault();
    // One question of four parts, on a paper whose sections plan three.
    const result = await composeAsProvider(
      vault,
      await inputOf(readingOf(oneQuestion, 3)),
      scriptedPort((request) => generated(request)).port,
    );
    expect(result.kind === 'finished' && result.record).not.toHaveProperty('structure');
    expect(result.kind === 'finished' && result.record.items).toHaveLength(3);
  });
});
