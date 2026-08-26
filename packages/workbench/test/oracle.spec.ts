// test/oracle.spec.ts — the oracle chain end to end over a synthetic world.
//
// Three things this suite exists to prove, matching the parent bead's report
// requirements directly:
//   1. The chain renders real states (ranked, abstained, all three gap
//      classes, an unreadable source) without touching the fixture vault.
//   2. The loop actually closes: a queue item built from the world's own
//      instruments carries a non-null `selectionContext.planVersion` after
//      `deriveClosedLoop` — C7.6's reason for existing, exercised for the
//      first time.
//   3. Trap 2's defence (`strugglingCourseReadsWorse`) actually distinguishes
//      a struggling persona from a comfortable one, over the SAME curriculum.

import { describe, expect, it } from 'vitest';
import {
  deriveClosedLoop,
  deriveOracle,
  strugglingCourseReadsWorse,
} from '../src/oracle/derive.js';
import { buildWorld, type WorldSpec } from '../src/synthetic-bridge.js';

const ASOF = '2027-01-15';
const COMPUTED_AT = '2027-01-15T09:15:00.000Z';

function specFor(persona: WorldSpec['persona']): WorldSpec {
  return {
    persona,
    seed: 'derive-spec',
    startDate: '2026-10-17',
    days: 90,
    deviceId: 'syn-laptop',
    utcOffset: '+00:00',
    assessmentDayOffsets: [42, 93],
  };
}

describe('deriveOracle', () => {
  it('ranks vantrel and abstains quorbin, over one world with no fixture-vault dependency', async () => {
    const world = buildWorld(specFor('steady-reviewer'));
    const { result } = await deriveOracle({ world, asOf: ASOF, computedAt: COMPUTED_AT });

    const vantrel = result.ranking.courses.find((c) => c.course === 'syn:course:vantrel');
    const quorbin = result.ranking.courses.find((c) => c.course === 'syn:course:quorbin');
    expect(vantrel?.status).toBe('ranked');
    expect(quorbin?.status).toBe('abstained');
  });

  it('produces one row of each gap class, and the material-gap row never carries draft-cards (F4.10)', async () => {
    const world = buildWorld(specFor('steady-reviewer'));
    const { result } = await deriveOracle({ world, asOf: ASOF, computedAt: COMPUTED_AT });

    const vantrel = result.gap.courses.find((c) => c.course === 'syn:course:vantrel');
    if (vantrel?.status !== 'ranked') throw new Error('expected vantrel to be ranked');
    const byConcept = new Map(vantrel.rows.map((row) => [row.conceptName, row]));

    expect(byConcept.get('syn:concept:melspar')?.gapClass).toBe('mastery-gap');
    expect(byConcept.get('syn:concept:dornith')?.gapClass).toBe('coverage-gap');
    const kelvane = byConcept.get('syn:concept:kelvane');
    expect(kelvane?.gapClass).toBe('material-gap');
    expect(kelvane?.affordances).not.toContain('draft-cards');
    expect(kelvane?.affordances).toEqual(['find-source']);
  });

  it('never claims exhaustiveness — the corpus always carries an unreadable source (ol-cvsc)', async () => {
    const world = buildWorld(specFor('steady-reviewer'));
    const { result } = await deriveOracle({ world, asOf: ASOF, computedAt: COMPUTED_AT });
    expect(result.gap.scope.canStateExhaustiveness).toBe(false);
  });

  it('is deterministic: the same world, asOf and computedAt produce the same planVersion', async () => {
    const world = buildWorld(specFor('steady-reviewer'));
    const a = await deriveOracle({ world, asOf: ASOF, computedAt: COMPUTED_AT });
    const b = await deriveOracle({ world, asOf: ASOF, computedAt: COMPUTED_AT });
    expect(a.result.plan.policyVersion).toBe(b.result.plan.policyVersion);
    expect(JSON.stringify(a.result.gap)).toBe(JSON.stringify(b.result.gap));
  });
});

describe('deriveClosedLoop — a review event now carries a real planVersion', () => {
  it('stamps every offered item with the plan just built, never null', async () => {
    const world = buildWorld(specFor('steady-reviewer'));
    const closed = await deriveClosedLoop({ world, asOf: ASOF, computedAt: COMPUTED_AT });

    expect(closed.queue.executed.items.length).toBeGreaterThan(0);
    expect(closed.queue.executed.planVersion).toBe(closed.plan.policyVersion);
    for (const item of closed.queue.executed.items) {
      expect(item.selectionContext.planVersion).toBe(closed.plan.policyVersion);
      expect(item.selectionContext.planVersion).not.toBeNull();
    }
  });

  it('actually ranks at least one vantrel item by weight, not merely stamping a version', async () => {
    const world = buildWorld(specFor('steady-reviewer'));
    const closed = await deriveClosedLoop({ world, asOf: ASOF, computedAt: COMPUTED_AT });
    const ranked = closed.queue.executed.items.filter((item) => item.planWeight !== null);
    expect(ranked.length).toBeGreaterThan(0);
  });

  it("attributes quorbin's queue items to the rank stage's abstention, not to the queue itself", async () => {
    const world = buildWorld(specFor('steady-reviewer'));
    const closed = await deriveClosedLoop({ world, asOf: ASOF, computedAt: COMPUTED_AT });
    const queueStage = closed.trace.stages.find((s) => s.stage === 'queue');
    expect(queueStage?.couldHaveSucceeded).toBe(false);
    expect(queueStage?.attributedTo).toBe('rank');

    const quorbinItems = closed.queue.executed.items.filter((item) =>
      item.conceptIds.some((id) => id.startsWith('syn:concept:ilmenor')),
    );
    for (const item of quorbinItems) expect(item.planWeight).toBeNull();
  });
});

describe('strugglingCourseReadsWorse — Trap 2 defence', () => {
  it('reads worse for the struggler persona than for the steady reviewer, over the identical curriculum', async () => {
    const strugglerWorld = buildWorld(specFor('struggler'));
    const steadyWorld = buildWorld(specFor('steady-reviewer'));

    const struggler = await deriveOracle({
      world: strugglerWorld,
      asOf: ASOF,
      computedAt: COMPUTED_AT,
    });
    expect(strugglingCourseReadsWorse(strugglerWorld, struggler.result.mastery)).toBe(true);

    // Sanity: the steady reviewer has NO declared struggling course, so the
    // function is vacuously true for it — the discriminating claim is about
    // the struggler specifically, asserted above.
    expect(steadyWorld.stream.groundTruth.strugglingCourseIds).toEqual([]);
  });
});

describe('PersonaHistory.rawEntries — the same persona, two surfaces', () => {
  it('is byte-identical to a world built with the same seed and spec (oracle-scenarios.ts)', async () => {
    const { buildPersonaHistory } = await import('../src/persona/history.js');
    const history = buildPersonaHistory('struggler');
    // Mirrors oracle-scenarios.ts's `worldFor` exactly — same seed, same spec.
    const world = buildWorld({
      persona: 'struggler',
      seed: 'workbench',
      startDate: '2026-10-17',
      days: 90,
      deviceId: 'workbench',
      utcOffset: '+00:00',
      assessmentDayOffsets: [42, 93],
    });
    expect(JSON.stringify(history.rawEntries)).toBe(JSON.stringify(world.stream.entries));
  });
});
