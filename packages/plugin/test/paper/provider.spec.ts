/**
 * `provider.ts` tests — the practice-paper command/view's own composition (F4.11,
 * `[D-250]`/`[D-252]`/`[D-262]`, `[PAPER-8]` / `ol-egov.141.6.1`).
 *
 * Scenarios: olea-service/features/F4-oracle.md — "F4.11 — Practice-paper command and view
 * surface [PAPER-8]" and the retagged "the paper's face states the gap and points at the held
 * questions" scenario in "F4.11 — Assessment demand and the gap it admits" — all tagged
 * `@auto:plugin/paper/provider.spec`.
 *
 * **Why `enumerateVaultInstruments` (a real production vault walk) is not exercised here.**
 * `createLocalPracticePaperProvider.requestPaper` calls it directly; faking a vault shape that
 * walk would actually parse into `ConceptRecord`s is that module's own concern (`concept/`'s
 * specs), not this bead's `owns`. The "grounding label" scenario below instead calls
 * `assemble.ts`'s `buildBlueprintInputForCourse` directly with a literal `ConceptRecord[]` — the
 * exact seam `requestPaper` hands `enumeration.concepts` into — so this still exercises the real
 * `buildPaperBlueprint`/`fillPaperBlueprintSlots`/`createPaper`/`buildReadyStateFromRecord` chain
 * end to end, just not the vault-walk step that produces the concepts in production.
 */

import type { VaultSource } from 'olea-core';
import {
  addManualAssessmentEntry,
  attachConceptToOutcome,
  buildPaperBlueprint,
  type ConceptRecord,
  createPaper,
  enumerateVaultInstruments,
  fillPaperBlueprintSlots,
  type PaperCompositionAccount,
  type PaperItemGenerationPort,
  type PaperRecord,
  resolveOutcome,
} from 'olea-core';
import { describe, expect, it } from 'vitest';
import { buildBlueprintInputForCourse } from '../../src/paper/assemble.js';
import {
  buildReadyStateFromRecord,
  type CreateLocalPracticePaperProviderDeps,
  createLocalPracticePaperProvider,
} from '../../src/paper/provider.js';
import { memoryVault } from '../review/memory-vault.js';

const BASE_PATH = '02 Assignments/Assignments.base';

/** The exact `.base` fixture shape `plan/provider.spec.ts`'s `studyVault` already establishes for `readAssessments` — reused rather than re-derived, since this bead is not re-testing that reader's own column-matching acceptance criteria. */
const ASSIGNMENTS_BASE_FILE = [
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

function fakeVault(extraFiles: Record<string, string> = {}): VaultSource {
  return memoryVault({ [BASE_PATH]: ASSIGNMENTS_BASE_FILE, ...extraFiles });
}

function assessmentNote(course: string, type: string, due: string): string {
  return `---\nclass: ${course}\ntype: ${type}\nweight: 1\ndue: ${due}\nstatus: pending\n---\n`;
}

const CONFIGURED_SETTINGS = {
  load: async () => ({ version: 1 as const, assignmentsBasePath: BASE_PATH }),
};
const UNCONFIGURED_SETTINGS = {
  load: async () => ({ version: 1 as const, assignmentsBasePath: '' }),
};

function baseDeps(
  overrides: Partial<CreateLocalPracticePaperProviderDeps> = {},
): CreateLocalPracticePaperProviderDeps {
  return {
    vault: fakeVault(),
    settingsStore: CONFIGURED_SETTINGS,
    generationPort: async () => null,
    now: () => new Date('2026-09-19T00:00:00Z'),
    ...overrides,
  };
}

describe('createLocalPracticePaperProvider — load()', () => {
  it('reads assignments-not-configured when no assignments Base is set', async () => {
    const provider = createLocalPracticePaperProvider(
      baseDeps({ settingsStore: UNCONFIGURED_SETTINGS }),
    );
    const state = await provider.load('COURSEA');
    expect(state.kind).toBe('assignments-not-configured');
  });

  it('reads no-assessment-ahead when every assessment has already passed', async () => {
    const vault = fakeVault({
      '02 Assignments/exam.md': assessmentNote('COURSEA', 'exam', '2026-01-01'),
    });
    const provider = createLocalPracticePaperProvider(baseDeps({ vault }));
    const state = await provider.load('COURSEA');
    expect(state.kind).toBe('no-assessment-ahead');
  });

  it('reads unlocked-not-pulled when an assessment sits inside the ratified proximity window', async () => {
    const vault = fakeVault({
      '02 Assignments/exam.md': assessmentNote('COURSEA', 'exam', '2026-09-22'),
    });
    const provider = createLocalPracticePaperProvider(baseDeps({ vault }));
    const state = await provider.load('COURSEA');
    expect(state.kind).toBe('unlocked-not-pulled');
  });

  it('reads locked, with a date and a day count, when far from the assessment with no real coverage evidence', async () => {
    const vault = fakeVault({
      '02 Assignments/exam.md': assessmentNote('COURSEA', 'exam', '2026-12-01'),
    });
    const provider = createLocalPracticePaperProvider(baseDeps({ vault }));
    const state = await provider.load('COURSEA');
    expect(state).toMatchObject({ kind: 'locked', nearestAssessmentDue: '2026-12-01' });
    if (state.kind === 'locked') expect(state.daysUntilNearest).toBeGreaterThan(0);
  });

  it('with no assignments Base configured, a manual entry still reaches this course — F1.2 (ol-egov.141.8.10)', async () => {
    const vault = fakeVault();
    await addManualAssessmentEntry(vault, {
      course: 'COURSEA',
      type: 'exam',
      due: '2026-09-22',
      status: 'pending',
    });
    const provider = createLocalPracticePaperProvider(
      baseDeps({ vault, settingsStore: UNCONFIGURED_SETTINGS }),
    );
    const state = await provider.load('COURSEA');
    // Same window/date the base-backed "unlocked-not-pulled" scenario above
    // exercises — proving the manual entry, not a Base row, drove this.
    expect(state.kind).toBe('unlocked-not-pulled');
  });

  it('with no assignments Base configured and no manual entry at all, still reads assignments-not-configured', async () => {
    const vault = fakeVault();
    const provider = createLocalPracticePaperProvider(
      baseDeps({ vault, settingsStore: UNCONFIGURED_SETTINGS }),
    );
    const state = await provider.load('COURSEA');
    expect(state.kind).toBe('assignments-not-configured');
  });
});

describe('createLocalPracticePaperProvider — real Outcome coverage (ol-2zfj.172, F4.11 ruling 4a)', () => {
  const CONCEPT_NOTE = '05 Zettelkasten/Widget theory.md';

  function vaultWithOneConcept(extraFiles: Record<string, string> = {}): VaultSource {
    return fakeVault({
      [CONCEPT_NOTE]: '# Widget theory\n',
      'Notes/one.md': [
        '---',
        'topic: [Widget theory]',
        'course: COURSEA',
        '---',
        '',
        'Front::Back',
        '',
      ].join('\n'),
      ...extraFiles,
    });
  }

  async function courseConceptKey(vault: VaultSource, course: string): Promise<string> {
    const enumeration = await enumerateVaultInstruments(vault);
    const record = enumeration.concepts.find((c) => c.courses.includes(course));
    if (record === undefined) throw new Error('fixture note did not yield a concept — check it');
    return record.key;
  }

  it('reads a nonzero outcomeCoverageShare and fires the coverage leg, far from any assessment, once a real Outcome attaches the course’s concept', async () => {
    const vault = vaultWithOneConcept({
      '02 Assignments/exam.md': assessmentNote('COURSEA', 'exam', '2026-12-01'),
    });

    const conceptKey = await courseConceptKey(vault, 'COURSEA');
    const outcome = await resolveOutcome(vault, {
      courses: ['COURSEA'],
      source: { path: CONCEPT_NOTE, blockIndex: 0 },
      label: 'Cellular respiration',
      provenance: { promptVersion: 'v1', modelVersion: 'model-a' },
    });
    await attachConceptToOutcome(vault, outcome.id, conceptKey);

    const provider = createLocalPracticePaperProvider(baseDeps({ vault }));
    const state = await provider.load('COURSEA');
    // Assessment is far outside the ratified proximity window, so this can only be
    // 'unlocked-not-pulled' via the coverage leg — the leg the pre-wiring policy zero could
    // never reach (unlock.ts's own module doc, pre-`ol-2zfj.172`).
    expect(state.kind).toBe('unlocked-not-pulled');
  });

  it('stays locked far from an assessment when no Outcome attaches any concept — unchanged from before this wiring', async () => {
    const vault = vaultWithOneConcept({
      '02 Assignments/exam.md': assessmentNote('COURSEA', 'exam', '2026-12-01'),
    });
    const provider = createLocalPracticePaperProvider(baseDeps({ vault }));
    const state = await provider.load('COURSEA');
    expect(state.kind).toBe('locked');
  });
});

describe('createLocalPracticePaperProvider — requestPaper()', () => {
  it('greys out to ai-unavailable, and reads no vault at all, when no Worker is configured', async () => {
    const reads: string[] = [];
    const vault = fakeVault();
    const originalRead = vault.read.bind(vault);
    vault.read = async (path: string) => {
      reads.push(path);
      return originalRead(path);
    };
    const provider = createLocalPracticePaperProvider(
      baseDeps({ vault, generationPort: async () => null }),
    );
    const result = await provider.requestPaper('COURSEA');
    expect(result.kind).toBe('ai-unavailable');
    expect(reads).toEqual([]);
  });
});

describe('the real blueprint/generation/store chain — grounding labels', () => {
  it('labels an item grounded in her own note covered-by-her-material', async () => {
    const vault = fakeVault();
    const concepts: readonly ConceptRecord[] = [
      {
        key: 'concept-1',
        name: 'Krebs cycle',
        tier: 1,
        courses: ['COURSEA'],
        sourcePaths: ['01 Courses/COURSEA/Krebs cycle.md'],
        boundNotePath: '01 Courses/COURSEA/Krebs cycle.md',
        definition: 'her own explanation of the Krebs cycle',
      },
    ];
    const input = await buildBlueprintInputForCourse(
      vault,
      concepts,
      [{ course: 'COURSEA', type: 'exam', due: '2026-09-22' }],
      'COURSEA',
      '2026-09-19',
    );
    const blueprint = buildPaperBlueprint(input);
    const alwaysGenerates: PaperItemGenerationPort = async (request) => ({
      status: 'generated',
      taskId: request.taskId,
      promptVersion: 'v1',
      response: { questions: [] },
    });
    const filled = await fillPaperBlueprintSlots(blueprint, alwaysGenerates);
    const record = await createPaper(vault, {
      course: 'COURSEA',
      asOf: '2026-09-19',
      compositionAccount: {
        formatVersion: blueprint.formatVersion,
        course: blueprint.course,
        asOf: blueprint.asOf,
        alpha: blueprint.alpha,
        formatClass: blueprint.formatClass,
        intendedDemand: blueprint.intendedDemand,
        steering: blueprint.steering,
        structureSummary: blueprint.structureSummary,
        eligibleCount: blueprint.eligibleCount,
        unbuiltDemand: blueprint.unbuiltDemand,
        partial: blueprint.partial,
      },
      items: filled.items,
      emptySlots: filled.emptySlots,
    });

    const state = buildReadyStateFromRecord('COURSEA', record);
    expect(state.items).toHaveLength(1);
    expect(state.items[0]?.groundingLabel).toBe('covered-by-her-material');
    expect(state.partial).toBe(false);
    expect(state.partialStatement).toBeNull();
  });
});

describe('buildReadyStateFromRecord — the demand-gap face statement', () => {
  function paperRecordWithUnbuiltDemand(): PaperRecord {
    const compositionAccount: PaperCompositionAccount = {
      formatVersion: 'paper-blueprint-v1',
      course: 'COURSEA',
      asOf: '2026-09-19',
      alpha: 0.5,
      formatClass: 'written',
      intendedDemand: 'interpret-printed-result',
      steering: {},
      structureSummary: { sittingCount: 1, currentCount: 1, historicalCount: 0 },
      eligibleCount: 1,
      unbuiltDemand: {
        demand: 'interpret-printed-result',
        pointerSourceRefs: ['01 Courses/COURSEA/Past papers/2025.pdf'],
      },
      partial: true,
    };
    return {
      id: 'paper-key1:test',
      course: 'COURSEA',
      generatedAt: '2026-09-19T00:00:00.000Z',
      asOf: '2026-09-19',
      compositionAccount,
      items: [],
      emptySlots: [
        {
          slotId: 'slot-0',
          conceptKey: 'concept-1',
          conceptName: 'Data interpretation',
          reasonCode: 'demand-unsupported',
          reason: 'intended demand "interpret-printed-result" is not declared served',
        },
      ],
      responses: [],
      handoffs: [],
      explanationResults: [],
      status: 'active',
      schemaVersion: 1,
    };
  }

  it('states the gap before any item, naming the demand and pointing at the held past papers — [D-262] ruling 4', () => {
    const state = buildReadyStateFromRecord('COURSEA', paperRecordWithUnbuiltDemand());
    expect(state.partial).toBe(true);
    expect(state.partialStatement).not.toBeNull();
    expect(state.partialStatement?.sentence).toContain('partial');
    expect(state.partialStatement?.sentence).toContain('read a printed result');
    expect(state.partialStatement?.pointerPaths).toEqual([
      '01 Courses/COURSEA/Past papers/2025.pdf',
    ]);
  });

  it('carries no statement at all when no demand went unbuilt', () => {
    const record = paperRecordWithUnbuiltDemand();
    const served: PaperRecord = {
      ...record,
      compositionAccount: { ...record.compositionAccount, unbuiltDemand: null, partial: false },
    };
    const state = buildReadyStateFromRecord('COURSEA', served);
    expect(state.partial).toBe(false);
    expect(state.partialStatement).toBeNull();
  });
});
