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
  buildPaperBlueprint,
  type ConceptRecord,
  fillPaperBlueprintSlots,
  listPaperJournals,
  listPaperRecords,
  type PaperBlueprint,
  type PaperItemGenerationRequest,
} from 'olea-core';
import { describe, expect, it } from 'vitest';
import type {
  PaperItemPortOutcome,
  PaperSlotOutcomePort,
} from '../../src/oracle/paper-item-port.js';
import { buildBlueprintInputForCourse } from '../../src/paper/assemble.js';
import {
  composePaperThroughJournal,
  type PaperCompositionScope,
} from '../../src/paper/journal-composition.js';
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
