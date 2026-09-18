import { describe, expect, it } from 'vitest';
import type { PaperItemGenerationPort, PaperItemGenerationResult } from './paper-items.js';
import { fillPaperBlueprintSlots } from './paper-items.js';
import type { PaperBlueprint, PaperBlueprintSlot, PaperEmptySlot } from './paper-types.js';

// Scenarios: olea-service/features/F4-oracle.md — "F4.11 — Practice paper product scope", the
// generation-pipeline block, tagged `@auto:core/oracle/paper-items.spec`.

function slot(overrides: Partial<PaperBlueprintSlot> & { slotId: string }): PaperBlueprintSlot {
  return {
    conceptKey: overrides.slotId,
    conceptName: overrides.slotId,
    formatClass: 'recall-style',
    intendedDemand: 'recall-a-fact',
    taskId: 'quiz.generate.v1',
    groundingTier: 'T2',
    groundingLabel: 'covered-by-her-material',
    heldSourceKind: 'notes',
    heldSourceId: 's1',
    sourceChunks: ['grounding text'],
    weight: 1,
    emphasised: false,
    ...overrides,
  };
}

function blueprint(
  overrides: Partial<PaperBlueprint> & { slots: readonly PaperBlueprintSlot[] },
): PaperBlueprint {
  return {
    formatVersion: 'paper-blueprint-v1',
    course: 'COURSEA',
    asOf: '2026-09-16',
    alpha: 0.5,
    formatClass: 'recall-style',
    intendedDemand: 'recall-a-fact',
    steering: {},
    structureSummary: null,
    eligibleCount: overrides.slots.length,
    emptySlots: [],
    unbuiltDemand: null,
    partial: false,
    ...overrides,
  };
}

const alwaysGenerates: PaperItemGenerationPort = async (request) => ({
  status: 'generated',
  taskId: request.taskId,
  promptVersion: 'v1',
  response: { echoed: request.conceptName },
});

describe('fillPaperBlueprintSlots', () => {
  it('calls the port once per filled slot and carries the labels forward', async () => {
    const bp = blueprint({ slots: [slot({ slotId: 'slot-0' })] });
    const result = await fillPaperBlueprintSlots(bp, alwaysGenerates);
    expect(result.items).toHaveLength(1);
    expect(result.items[0]?.groundingLabel).toBe('covered-by-her-material');
    expect(result.items[0]?.promptVersion).toBe('v1');
    // [D-262] ruling 1: the slot's intended demand rides onto the generated item as a record of
    // intent, never a check against what the generator actually produced.
    expect(result.items[0]?.intendedDemand).toBe('recall-a-fact');
    expect(result.emptySlots).toHaveLength(0);
  });

  it("preserves the blueprint's own empty slots (F4.10, no held source)", async () => {
    const bp = blueprint({
      slots: [],
      emptySlots: [
        {
          slotId: 'slot-0',
          conceptKey: 'a',
          conceptName: 'a',
          reasonCode: 'no-held-source',
          reason: 'no held source',
        },
      ],
    });
    const result = await fillPaperBlueprintSlots(bp, alwaysGenerates);
    expect(result.items).toHaveLength(0);
    expect(result.emptySlots).toEqual<readonly PaperEmptySlot[]>([
      {
        slotId: 'slot-0',
        conceptKey: 'a',
        conceptName: 'a',
        reasonCode: 'no-held-source',
        reason: 'no held source',
      },
    ]);
  });

  it('a port refusal becomes an empty slot with reasonCode generator-refused, never an invented item (F4.10 at generation grain)', async () => {
    const refusing: PaperItemGenerationPort = async () =>
      ({
        status: 'refused',
        reason: 'below-composite-threshold',
      }) satisfies PaperItemGenerationResult;
    const bp = blueprint({ slots: [slot({ slotId: 'slot-0' })] });
    const result = await fillPaperBlueprintSlots(bp, refusing);
    expect(result.items).toHaveLength(0);
    expect(result.emptySlots).toHaveLength(1);
    expect(result.emptySlots[0]?.reasonCode).toBe('generator-refused');
    expect(result.emptySlots[0]?.reason).toContain('below-composite-threshold');
  });

  it('never blends a refused slot into the generated items list', async () => {
    const mixed: PaperItemGenerationPort = async (request) =>
      request.conceptName === 'b'
        ? { status: 'refused', reason: 'ungroundable' }
        : alwaysGenerates(request);
    const bp = blueprint({
      slots: [
        slot({ slotId: 'slot-0', conceptKey: 'a', conceptName: 'a' }),
        slot({ slotId: 'slot-1', conceptKey: 'b', conceptName: 'b' }),
      ],
    });
    const result = await fillPaperBlueprintSlots(bp, mixed);
    expect(result.items.map((i) => i.conceptKey)).toEqual(['a']);
    expect(result.emptySlots.map((s) => s.conceptKey)).toEqual(['b']);
  });
});
