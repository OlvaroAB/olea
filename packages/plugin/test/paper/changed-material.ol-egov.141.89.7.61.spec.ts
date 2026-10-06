/**
 * The changed-material sentence ([D-532], ol-egov.141.89.7.61, state 4).
 * Scenarios: olea-service features/F4-oracle.md, F4.11, tagged
 * `@auto:plugin/paper/changed-material.ol-egov.141.89.7.61.spec`. Course A, synthetic.
 * Composes through the real journal, then renders through the real `PaperView` with a fake DOM.
 */
import {
  buildPaperBlueprint,
  type ConceptRecord,
  type PaperBlueprint,
  type PaperItemGenerationRequest,
} from 'olea-core';
import { describe, expect, it, vi } from 'vitest';

vi.mock('obsidian', () => ({
  ItemView: class {
    contentEl: unknown;
    constructor(_leaf: unknown) {
      this.contentEl = (globalThis as { __rootFactory?: () => unknown }).__rootFactory?.();
    }
  },
}));

import type {
  PaperItemPortOutcome,
  PaperSlotOutcomePort,
} from '../../src/oracle/paper-item-port.js';
import { buildBlueprintInputForCourse } from '../../src/paper/assemble.js';
import { MATERIAL_CHANGED_SENTENCE } from '../../src/paper/copy.js';
import {
  composePaperThroughJournal,
  type PaperCompositionScope,
} from '../../src/paper/journal-composition.js';
import { buildReadyStateFromRecord } from '../../src/paper/provider.js';
import { PaperView } from '../../src/paper/view.js';
import { memoryVault } from '../review/memory-vault.js';
import { FakeEl } from './fake-dom.helper.js';

const COURSE = 'COURSEA';

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

async function blueprintOf(definitionOf?: (index: number) => string) {
  const concepts = [0, 1].map((i) => concept(i, definitionOf?.(i)));
  const input = await buildBlueprintInputForCourse(
    memoryVault(),
    concepts,
    [{ course: COURSE, type: 'exam', due: '2026-09-22' }],
    COURSE,
    '2026-09-19',
  );
  return {
    blueprint: buildPaperBlueprint(input),
    scope: {
      eligibleConceptKeys: concepts.map((c) => c.key),
      outcomes: [],
    } as PaperCompositionScope,
  };
}

const generated = (request: PaperItemGenerationRequest): PaperItemPortOutcome => ({
  status: 'generated',
  taskId: request.taskId,
  promptVersion: 'v1',
  response: { ok: true, result: { cards: [{ front: 'q', back: 'a' }] } },
});
const OUTAGE: PaperItemPortOutcome = { status: 'unavailable', reason: 'transport-failure' };
const portOf =
  (answer: (r: PaperItemGenerationRequest) => PaperItemPortOutcome): PaperSlotOutcomePort =>
  async (request) =>
    answer(request);

/** The saved attempt: the first topic lands, the rest stay owed. */
const landFirstOnly: PaperSlotOutcomePort = async (request) =>
  request.conceptName === 'Topic A' ? generated(request) : OUTAGE;

let nonce = 0;
const options = () => ({
  generateId: () => `nonce-${++nonce}`,
  now: () => '2026-09-19T00:00:00.000Z',
});

/** An unfinished paper is saved, then `change` is applied and the paper is composed again and rendered. */
async function renderedAfter(
  change: (base: { blueprint: PaperBlueprint; scope: PaperCompositionScope }) => Promise<{
    blueprint: PaperBlueprint;
    scope: PaperCompositionScope;
  }>,
  firstPort: PaperSlotOutcomePort = landFirstOnly,
) {
  const base = await blueprintOf();
  const vault = memoryVault();
  await composePaperThroughJournal({
    vault,
    ...base,
    port: firstPort,
    options: options(),
  });
  const next = await change(base);
  const composed = await composePaperThroughJournal({
    vault,
    ...next,
    port: portOf(generated),
    options: options(),
  });
  if (composed.kind !== 'finished') throw new Error('expected a finished paper');
  return renderState(
    buildReadyStateFromRecord(COURSE, composed.record, {
      materialChanged: composed.materialChanged,
    }),
  );
}

async function renderState(state: ReturnType<typeof buildReadyStateFromRecord>) {
  const root = new FakeEl('root');
  (globalThis as { __rootFactory?: () => unknown }).__rootFactory = () => root;
  const view = new PaperView(
    {} as never,
    {
      load: async () => state,
      requestPaper: async () => state,
      handOffItem: async () => ({}) as never,
    },
    COURSE,
  );
  await view.refresh();
  return root.allText();
}

const count = (text: string) => text.split(MATERIAL_CHANGED_SENTENCE).length - 1;

describe('the ruled sentence', () => {
  it('is verbatim', () => {
    expect(MATERIAL_CHANGED_SENTENCE).toBe(
      'Your material changed since this paper was started, so Olea began a new one.',
    );
  });
});

describe('the changed-material sentence, through the paper view', () => {
  it('shows once, above the items, when saved progress was discarded because her sources changed', async () => {
    const text = await renderedAfter(async () =>
      blueprintOf((i) => `her REVISED note on topic ${i}`),
    );
    expect(count(text)).toBe(1);
    expect(text.indexOf(MATERIAL_CHANGED_SENTENCE)).toBeLessThan(text.indexOf('Topic A'));
  });

  it('shows when the scope changed', async () => {
    const text = await renderedAfter(async (base) => ({
      blueprint: base.blueprint,
      scope: {
        eligibleConceptKeys: [...base.scope.eligibleConceptKeys, 'concept-new'],
        outcomes: [],
      },
    }));
    expect(count(text)).toBe(1);
  });

  it('does not show when only the authoring settings changed', async () => {
    const text = await renderedAfter(async (base) => ({
      blueprint: {
        ...base.blueprint,
        steering: { ...base.blueprint.steering, emphasis: 'topic a' },
      },
      scope: base.scope,
    }));
    expect(count(text)).toBe(0);
  });

  it('does not show when the discarded journal had no landed slot (nothing saved was lost)', async () => {
    const text = await renderedAfter(
      async () => blueprintOf((i) => `her REVISED note on topic ${i}`),
      portOf(() => OUTAGE),
    );
    expect(count(text)).toBe(0);
  });

  it('does not show for a resumed paper or one with no saved progress', async () => {
    const resumed = await renderedAfter(async (base) => base);
    expect(count(resumed)).toBe(0);
    const base = await blueprintOf();
    const composed = await composePaperThroughJournal({
      vault: memoryVault(),
      ...base,
      port: portOf(generated),
      options: options(),
    });
    if (composed.kind !== 'finished') throw new Error('expected a finished paper');
    expect(composed.materialChanged).toBe(false);
    expect(count(await renderState(buildReadyStateFromRecord(COURSE, composed.record)))).toBe(0);
  });
});
