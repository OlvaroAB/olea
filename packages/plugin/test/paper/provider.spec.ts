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

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { VaultSource } from 'olea-core';
import {
  addManualAssessmentEntry,
  attachConceptToOutcome,
  buildPaperBlueprint,
  type ConceptRecord,
  createPaper,
  enumerateVaultInstruments,
  fillPaperBlueprintSlots,
  listPaperJournals,
  listPaperRecords,
  type PaperCompositionAccount,
  type PaperGeneratedItem,
  type PaperItemGenerationPort,
  type PaperItemGenerationRequest,
  type PaperRecord,
  readInstrumentCitation,
  resolveOutcome,
} from 'olea-core';
import { describe, expect, it } from 'vitest';
import type {
  PaperItemPortOutcome,
  PaperSlotOutcomePort,
} from '../../src/oracle/paper-item-port.js';
import { buildBlueprintInputForCourse } from '../../src/paper/assemble.js';
import {
  buildReadyStateFromRecord,
  type CreateLocalPracticePaperProviderDeps,
  createLocalPracticePaperProvider,
  PracticePaperUnfinishedError,
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

  // ol-egov.141.89.7.61: the locked state carries the counts and whether they are known, so the
  // wording (held for David) can state a count and its source and never a measured zero. No share,
  // ratio or percentage is carried.
  it('a locked course with no declared outcome carries its coverage as unknown, not as a measured zero', async () => {
    const vault = vaultWithOneConcept({
      '02 Assignments/exam.md': assessmentNote('COURSEA', 'exam', '2026-12-01'),
    });
    const state = await createLocalPracticePaperProvider(baseDeps({ vault })).load('COURSEA');
    expect(state.kind).toBe('locked');
    if (state.kind !== 'locked') return;
    expect(state.coverage.outcomeCoverageKnown).toBe(false);
    expect(state.coverage.outcomeCount).toBe(0);
    expect(state.coverage.conceptCoverageKnown).toBe(true);
    expect(state.coverage.conceptCount).toBe(1);
    expect(state.coverage.attachedConceptCount).toBe(0);
  });

  it('a locked course with a declared outcome carries its counts as known, and no share, ratio or percentage', async () => {
    const vault = vaultWithOneConcept({
      '02 Assignments/exam.md': assessmentNote('COURSEA', 'exam', '2026-12-01'),
    });
    await resolveOutcome(vault, {
      courses: ['COURSEA'],
      source: { path: CONCEPT_NOTE, blockIndex: 0 },
      label: 'Cellular respiration',
      provenance: { promptVersion: 'v1', modelVersion: 'model-a' },
    });
    const state = await createLocalPracticePaperProvider(baseDeps({ vault })).load('COURSEA');
    expect(state.kind).toBe('locked');
    if (state.kind !== 'locked') return;
    expect(state.coverage).toEqual({
      outcomeCount: 1,
      attachedOutcomeCount: 0,
      outcomeCoverageKnown: true,
      conceptCount: 1,
      conceptCoverageKnown: true,
      attachedConceptCount: 0,
    });
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

/**
 * `handOffItem()` (`ol-0r92.135`, F4.11 ruling 1, `[D-252]`/`[D-367]`/`[D-391]`/`[D-407]`) — the
 * caller `PaperView`'s per-item control invokes. Exercises the real `handOffPaperItem` +
 * `ensureHomeNoteForConcept` + citation-sidecar chain end to end, against a hand-built
 * `PaperRecord` (same "construct the record directly" technique the demand-gap suite above
 * already uses) rather than driving the whole blueprint/generation pipeline, which is not this
 * bead's `owns`.
 */
describe('createLocalPracticePaperProvider — handOffItem()', () => {
  const HANDOFF_COMPOSITION_ACCOUNT: PaperCompositionAccount = {
    formatVersion: 'paper-blueprint-v1',
    course: 'COURSEA',
    asOf: '2026-09-19',
    alpha: 0.5,
    formatClass: 'written',
    intendedDemand: 'recall-a-fact',
    steering: {},
    structureSummary: { sittingCount: 1, currentCount: 1, historicalCount: 0 },
    eligibleCount: 1,
    unbuiltDemand: null,
    partial: false,
  };

  function quizItem(overrides: Partial<PaperGeneratedItem> = {}): PaperGeneratedItem {
    return {
      slotId: 'slot-0',
      conceptKey: 'concept-1',
      conceptName: 'Krebs cycle',
      taskId: 'quiz.generate.v1',
      promptVersion: 'v1',
      intendedDemand: 'recall-a-fact',
      groundingTier: 'T2',
      groundingLabel: 'covered-by-her-material',
      heldSourceKind: 'notes',
      heldSourceId: null,
      response: {
        result: {
          questions: [
            {
              stem: 'What does the Krebs cycle produce?',
              correctAnswer: 'ATP',
              distractors: ['DNA', 'RNA'],
              feedback: 'The Krebs cycle produces ATP.',
            },
          ],
        },
      },
      ...overrides,
    };
  }

  async function paperWithItems(
    vault: VaultSource,
    items: readonly PaperGeneratedItem[],
  ): Promise<PaperRecord> {
    return createPaper(vault, {
      course: 'COURSEA',
      asOf: '2026-09-19',
      compositionAccount: HANDOFF_COMPOSITION_ACCOUNT,
      items,
      emptySlots: [],
    });
  }

  const HANDOFF_NOTE_PATH = 'Practice paper hand-offs/COURSEA.md';

  it('enters the item as a real, queueable instrument and writes its citation sidecar', async () => {
    const vault = fakeVault();
    const record = await paperWithItems(vault, [quizItem()]);
    const provider = createLocalPracticePaperProvider(baseDeps({ vault }));

    const result = await provider.handOffItem('COURSEA', record.id, 'slot-0', 'Krebs cycle');

    expect(result.instrumentWritten).toBe(true);
    expect(result.record.handoffs).toHaveLength(1);
    expect(result.record.handoffs[0]).toMatchObject({
      slotId: 'slot-0',
      elicitingContextLabel: 'from a practice paper',
    });

    expect(await vault.exists(HANDOFF_NOTE_PATH)).toBe(true);
    const content = await vault.read(HANDOFF_NOTE_PATH);
    expect(content).toContain(`id: ${result.instrumentId}`);
    expect(content).toContain('paper-origin:');
    // Concept binding (`generation/home-note.ts`'s own rule): without this, the entered item
    // would be invisible to `enumerateVaultInstruments`/the ordinary review queue.
    expect(content).toMatch(/topic:\s*\n\s*-\s*Krebs cycle/);

    // `[D-181]` citation sidecar, self-referential — so a later authorship check never reads this
    // item as unverified (materialize-mcq.ts's own precedent).
    const citation = await readInstrumentCitation(vault, result.instrumentId);
    expect(citation?.sourcePath).toBe(HANDOFF_NOTE_PATH);
  });

  it('is idempotent — a repeat call for the same slot changes nothing on disk ([D-391])', async () => {
    const vault = fakeVault();
    const record = await paperWithItems(vault, [quizItem()]);
    const provider = createLocalPracticePaperProvider(baseDeps({ vault }));

    const first = await provider.handOffItem('COURSEA', record.id, 'slot-0', 'Krebs cycle');
    const noteAfterFirst = await vault.read(HANDOFF_NOTE_PATH);

    const second = await provider.handOffItem('COURSEA', record.id, 'slot-0', 'Krebs cycle');

    expect(second.instrumentWritten).toBe(false);
    expect(second.instrumentId).toBe(first.instrumentId);
    expect(second.record.handoffs).toHaveLength(1);
    expect(await vault.read(HANDOFF_NOTE_PATH)).toBe(noteAfterFirst);
  });

  it('a second, different item from the same course reuses one home note and grows its topic:', async () => {
    const vault = fakeVault();
    const record = await paperWithItems(vault, [
      quizItem(),
      quizItem({ slotId: 'slot-1', conceptKey: 'concept-2', conceptName: 'Calvin cycle' }),
    ]);
    const provider = createLocalPracticePaperProvider(baseDeps({ vault }));

    await provider.handOffItem('COURSEA', record.id, 'slot-0', 'Krebs cycle');
    const result2 = await provider.handOffItem('COURSEA', record.id, 'slot-1', 'Calvin cycle');

    expect(result2.instrumentWritten).toBe(true);
    const content = await vault.read(HANDOFF_NOTE_PATH);
    expect(content).toContain('Krebs cycle');
    expect(content).toContain('Calvin cycle');
    // Two distinct instruments, one note.
    expect((content.match(/```olea-mcq/g) ?? []).length).toBe(2);
  });
});

/**
 * `[D-430]` (row 17, `ol-egov.141.89.7.5`): `requestPaper` composes through the resumable journal
 * and the three-outcome port. The journal and the fingerprint are exercised in
 * `journal-composition.spec.ts`; this suite proves the provider's own seam: what it hands the view,
 * what it throws, that a repeat request resumes, and that nothing the view can see has changed.
 */
describe('createLocalPracticePaperProvider — requestPaper() through the journal ([D-430])', () => {
  const CONCEPT_NOTE = '05 Zettelkasten/Widget theory.md';

  function requestVault(): VaultSource {
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
      '02 Assignments/exam.md': assessmentNote('COURSEA', 'exam', '2026-09-22'),
    });
  }

  let nonce = 0;
  const port = (
    answer: (request: PaperItemGenerationRequest) => PaperItemPortOutcome,
  ): { readonly port: PaperSlotOutcomePort; readonly calls: PaperItemGenerationRequest[] } => {
    const calls: PaperItemGenerationRequest[] = [];
    return {
      calls,
      port: async (request) => {
        calls.push(request);
        return answer(request);
      },
    };
  };
  const generatedAnswer = (request: PaperItemGenerationRequest): PaperItemPortOutcome => ({
    status: 'generated',
    taskId: request.taskId,
    promptVersion: 'v1',
    response: { ok: true, result: { cards: [{ front: 'q', back: 'a' }] } },
  });
  const OUTAGE: PaperItemPortOutcome = { status: 'unavailable', reason: 'transport-failure' };

  function providerWith(vault: VaultSource, generationPort: PaperSlotOutcomePort | null) {
    return createLocalPracticePaperProvider({
      ...baseDeps({ vault }),
      generationPort: async () => generationPort,
      now: () => new Date(`2026-09-19T00:00:00.${String(nonce++ % 1000).padStart(3, '0')}Z`),
    });
  }

  it('a finished journal hands the view the same ready state it always got: items, empty slots, and a record that says complete', async () => {
    const vault = requestVault();
    const scripted = port(generatedAnswer);
    const state = await providerWith(vault, scripted.port).requestPaper('COURSEA');
    if (state.kind !== 'ready') throw new Error(`expected ready, got ${state.kind}`);
    expect(state.items.length).toBeGreaterThan(0);
    expect(state.record.completion).toEqual({ status: 'complete' });
    expect(state.record.journalId).toBeDefined();
    expect(Object.keys(state).sort()).toEqual(
      [
        'course',
        'emptySlots',
        'incompleteStatement',
        'items',
        'kind',
        'partial',
        'partialStatement',
        'record',
      ].sort(),
    );
    expect(scripted.calls).toHaveLength(state.items.length);
  });

  it('an outage rejects with an unfinished error carrying counts and an id only, and keeps the journal; no paper exists', async () => {
    const vault = requestVault();
    const down = port(() => OUTAGE);
    const provider = providerWith(vault, down.port);
    const caught = await provider.requestPaper('COURSEA').then(
      () => null,
      (error: unknown) => error,
    );
    expect(caught).toBeInstanceOf(PracticePaperUnfinishedError);
    const unfinished = caught as PracticePaperUnfinishedError;
    expect(unfinished).toMatchObject({
      course: 'COURSEA',
      reason: 'service-unavailable',
    });
    expect(unfinished.owedSlotCount).toBeGreaterThan(0);
    expect(unfinished.journalId).toMatch(/^paper-journal-key1:/);
    // Content-free (D-005): the message names counts, never a concept, a note or a reason string.
    expect(unfinished.message).not.toMatch(/Widget|transport-failure/);
    expect((await listPaperRecords(vault)).length).toBe(0);
  });

  it('the next request resumes the kept journal and finishes it, drafting only what was owed', async () => {
    const vault = requestVault();
    await providerWith(vault, port(() => OUTAGE).port)
      .requestPaper('COURSEA')
      .catch(() => undefined);

    const up = port(generatedAnswer);
    const state = await providerWith(vault, up.port).requestPaper('COURSEA');
    expect(state.kind).toBe('ready');
    expect(up.calls.length).toBeGreaterThan(0);
    expect((await listPaperRecords(vault)).length).toBe(1);
  });

  it('the declared scope reaches the fingerprint: an Outcome attached after the outage discards the kept journal, naming scope', async () => {
    const vault = requestVault();
    await providerWith(vault, port(() => OUTAGE).port)
      .requestPaper('COURSEA')
      .catch(() => undefined);

    const enumeration = await enumerateVaultInstruments(vault);
    const conceptKey = enumeration.concepts.find((c) => c.courses.includes('COURSEA'))?.key;
    if (conceptKey === undefined)
      throw new Error('fixture note did not yield a concept — check it');
    const outcome = await resolveOutcome(vault, {
      courses: ['COURSEA'],
      source: { path: CONCEPT_NOTE, blockIndex: 0 },
      label: 'Cellular respiration',
      provenance: { promptVersion: 'v1', modelVersion: 'model-a' },
    });
    await attachConceptToOutcome(vault, outcome.id, conceptKey);

    const up = port(generatedAnswer);
    const state = await providerWith(vault, up.port).requestPaper('COURSEA');
    expect(state.kind).toBe('ready');
    const discarded = (await listPaperJournals(vault)).filter(
      (entry) => entry.record.status === 'discarded',
    );
    expect(discarded).toHaveLength(1);
    expect(discarded[0]?.record.discard).toMatchObject({
      reason: 'reuse-incompatible',
      changed: ['scope'],
    });
  });

  it('a concept added to the course after the outage changes the eligible scope: the kept journal is discarded, naming scope', async () => {
    const vault = requestVault();
    await providerWith(vault, port(() => OUTAGE).port)
      .requestPaper('COURSEA')
      .catch(() => undefined);

    await vault.write('05 Zettelkasten/Gadget theory.md', '# Gadget theory\n');
    await vault.write(
      'Notes/two.md',
      ['---', 'topic: [Gadget theory]', 'course: COURSEA', '---', '', 'Front::Back', ''].join('\n'),
    );

    const state = await providerWith(vault, port(generatedAnswer).port).requestPaper('COURSEA');
    expect(state.kind).toBe('ready');
    const discarded = (await listPaperJournals(vault)).filter(
      (entry) => entry.record.status === 'discarded',
    );
    expect(discarded).toHaveLength(1);
    expect(discarded[0]?.record.discard?.changed).toContain('scope');
  });

  it('a grounding refusal is handed over as a qualified partial by source gap, and is not an outage', async () => {
    const vault = requestVault();
    const state = await providerWith(
      vault,
      port(() => ({ status: 'refused', reason: 'empty-result' })).port,
    ).requestPaper('COURSEA');
    if (state.kind !== 'ready') throw new Error(`expected ready, got ${state.kind}`);
    expect(state.record.completion).toEqual({ status: 'qualified-partial', gaps: ['source'] });
    expect(state.items).toEqual([]);
    expect(state.emptySlots.map((slot) => slot.reasonCode)).toContain('generator-refused');
  });

  it('a second press while the first is composing shares its work: one call per slot, one paper, one journal', async () => {
    const vault = requestVault();
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const calls: PaperItemGenerationRequest[] = [];
    const slow: PaperSlotOutcomePort = async (request) => {
      calls.push(request);
      await gate;
      return generatedAnswer(request);
    };
    const provider = providerWith(vault, slow);
    const first = provider.requestPaper('COURSEA');
    const second = provider.requestPaper('COURSEA');
    release();
    const [a, b] = await Promise.all([first, second]);
    if (a.kind !== 'ready' || b.kind !== 'ready') throw new Error('expected ready');
    expect(b.record.id).toBe(a.record.id);
    expect(calls.length).toBe(a.items.length);
    expect((await listPaperRecords(vault)).length).toBe(1);
  });

  it('once a request has settled, the next press composes a fresh paper (F4.11 ruling 5)', async () => {
    const vault = requestVault();
    const provider = providerWith(vault, port(generatedAnswer).port);
    const first = await provider.requestPaper('COURSEA');
    const second = await provider.requestPaper('COURSEA');
    if (first.kind !== 'ready' || second.kind !== 'ready') throw new Error('expected ready');
    expect(second.record.id).not.toBe(first.record.id);
  });

  it('still greys out to ai-unavailable, reading no vault, when no Worker is configured', async () => {
    const vault = requestVault();
    const reads: string[] = [];
    const originalRead = vault.read.bind(vault);
    vault.read = async (path: string) => {
      reads.push(path);
      return originalRead(path);
    };
    const result = await providerWith(vault, null).requestPaper('COURSEA');
    expect(result.kind).toBe('ai-unavailable');
    expect(reads).toEqual([]);
    expect((await listPaperRecords(vault)).length).toBe(0);
  });
});

describe('the paper path uses the three-outcome port and the view is unchanged ([D-430], ol-egov.141.89.7.5)', () => {
  const srcDir = fileURLToPath(new URL('../../src/', import.meta.url));
  const codeOf = (path: string) =>
    readFileSync(srcDir + path, 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/\/\/.*$/gm, '');

  it('the paper generation port is built from createWorkerPaperSlotOutcomePort, not the flat adapter', () => {
    const port = codeOf('paper/generation-port.ts');
    expect(port).toMatch(/createWorkerPaperSlotOutcomePort\(\{ transport \}\)/);
    expect(port).not.toMatch(/createWorkerPaperItemGenerationPort/);
  });

  it('requestPaper composes through the journal and no longer fills the blueprint in one flat pass', () => {
    const provider = codeOf('paper/provider.ts');
    expect(provider).toMatch(/composePaperThroughJournal\(/);
    expect(provider).not.toMatch(/fillPaperBlueprintSlots/);
    expect(provider).not.toMatch(/\bcreatePaper\(/);
  });

  it('the flat adapter has no production caller left on the paper path', () => {
    for (const file of ['paper/provider.ts', 'paper/wiring.ts', 'paper/generation-port.ts']) {
      expect(codeOf(file)).not.toMatch(/createWorkerPaperItemGenerationPort/);
    }
  });

  it('never calls the core classifier directly: the outcome port owns the zero-question rule', () => {
    for (const file of [
      'paper/provider.ts',
      'paper/journal-composition.ts',
      'paper/generation-port.ts',
    ]) {
      expect(codeOf(file)).not.toMatch(/classifyPaperSlotWorkerResult/);
    }
  });

  it('adds no state beyond [D-457]: the view neither names the journal nor the error class, and reads the notice from the provider', () => {
    const view = codeOf('paper/view.ts');
    expect(view).not.toMatch(/PracticePaperUnfinishedError|journal|completion/i);
  });
});
