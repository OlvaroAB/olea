/**
 * `ol-egov.141.89.2.14` — a rejected instrument is honoured by every reader that decides what
 * she is served (C5.3 as amended by `[D-396]`: "A rejection follows the item once it is fixed: no
 * edit or repair silently undoes it, and only her own deliberate restore returns it to
 * circulation"; the cross-moment recovery bar, `[D-339]`).
 *
 * ## The production writer this suite rejects through
 *
 * Her rejection of an instrument that exists in her vault is written by exactly one production
 * path: the registry's "reject it" on a withheld item, `registry/provider.ts`'s
 * `rejectWithheldItem` (its `appendVerdictRecord` call), reached from the registry view's reject
 * button (`registry/view.ts`, `deps.rejectWithheldItem(item)`), which `main.ts` registers. The
 * record is the review log's verdict record: `kind: 'verdict'`, `verdict: 'rejected'`, the
 * instrument id, its instrument type and concept ids, no `artifactProvenance` for a block with no
 * generating call. (The other writer of a `rejected` verdict, `generation/accept.ts`'s draft
 * reject, names the draft's own id, never a materialised instrument's.)
 *
 * The case this suite drives is the one the clause names: an item withheld by a structural check
 * (M5, an embedded asset that does not resolve), rejected there, then fixed — the asset resolves
 * again — so the enumeration offers the instrument, under the same id, to every reader.
 *
 * ## The readers
 *
 * - the composer's instrument index and its composed session (`composeStudySessionForRequest`,
 *   the one function Home, the session builder, Start and the review tab all compose through);
 * - the review tab's open, the present-time join a held sitting is served through
 *   (`openReviewSession`), for a sitting composed before she rejected the item;
 * - Today's count, which reads the same composition.
 *
 * Successor drafting after a source change is `../generation/revision-job-runner-rejected.spec.ts`.
 *
 * Every fixture string is invented (INV-3).
 */

import { createFsrsScheduler, enumerateVaultInstruments } from 'olea-core';
import { describe, expect, it } from 'vitest';
import type { ObsidianDataHost } from '../../src/plan/settings-store.js';
import { STUDY_PLAN_SETTINGS_STORAGE_KEY } from '../../src/plan/settings-store.js';
import { createLocalRegistryProvider } from '../../src/registry/provider.js';
import type { RegistryWithheldItem } from '../../src/registry/view.js';
import {
  type OpenReviewSessionInput,
  openReviewSession,
  type ReviewSessionPorts,
} from '../../src/review/open-session.js';
import {
  type Clock,
  createVaultNoteExistsPort,
  createVaultReviewLogPort,
  createVaultSuspendPort,
  type EditPort,
} from '../../src/review/ports.js';
import { createStudySessionHolder, type StudySessionHolder } from '../../src/session/holder.js';
import { DEFAULT_SESSION_BUDGET_MINUTES } from '../../src/session-builder/copy.js';
import { composeStudySessionForRequest } from '../../src/session-builder/provider.js';
import { createVaultInstrumentSource } from '../../src/today/data-source.js';
import { memoryVault } from '../review/memory-vault.js';

const DEVICE = 'olea-testdevice1';
const NOW = new Date('2026-08-10T09:00:00-04:00');
const ASSIGNMENTS_BASE_PATH = '02 Assignments/Assignments.base';
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

class FakeSettingsHost implements ObsidianDataHost {
  private blob: unknown = {
    [STUDY_PLAN_SETTINGS_STORAGE_KEY]: { version: 1, assignmentsBasePath: ASSIGNMENTS_BASE_PATH },
  };
  async loadData(): Promise<unknown> {
    return this.blob;
  }
  async saveData(data: unknown): Promise<void> {
    this.blob = data;
  }
}

const MCQ_NOTE_PATH = 'Notes/one.md';

/** The note carrying the rejectable item: a valid Q&A sibling (so its identity is derivable) and an MCQ embedding `asset`. */
function mcqNote(asset: string): string {
  return [
    '---',
    'topic: [Widget theory]',
    'course: TESTC101',
    '---',
    '',
    'Front::Back',
    '',
    '```olea-mcq',
    `stem: Which figure shows the mechanism? ![[${asset}]]`,
    'answer: The first figure',
    'distractor: The second figure',
    'distractor: The third figure',
    '```',
    '',
  ].join('\n');
}

/**
 * Two concepts in one course, both cited by the same past paper, so the composer serves both
 * (`composed-review-path.spec.ts`'s `twoConceptSameCourseVault`, with an MCQ added to the first
 * note). `figure.png` resolves; `gone.png` does not.
 */
function fixtureVault(mcqAsset: 'figure.png' | 'gone.png') {
  return memoryVault({
    '05 Zettelkasten/Widget theory.md': '# Widget theory\n',
    '05 Zettelkasten/Gadget theory.md': '# Gadget theory\n',
    'figure.png': 'not really a picture',
    [MCQ_NOTE_PATH]: mcqNote(mcqAsset),
    'Notes/two.md': [
      '---',
      'topic: [Gadget theory]',
      'course: TESTC101',
      '---',
      '',
      'Front2::Back2',
      '',
    ].join('\n'),
    '03 Research/TESTC101 Past Paper 2023.md': [
      '---',
      'role: past-paper',
      'course: TESTC101',
      '---',
      '',
      '# TESTC101 Past Paper 2023',
      '',
      '## Question 1 (10 marks)',
      '',
      'Explain the core mechanism behind Widget theory and why it matters.',
      '',
      '## Question 2 (10 marks)',
      '',
      'Explain the core mechanism behind Gadget theory and why it matters.',
      '',
    ].join('\n'),
    [ASSIGNMENTS_BASE_PATH]: BASE_FILE,
    '02 Assignments/Quiz 1.md':
      '---\nclass: TESTC101\ntype: Quiz\nweight: 10\ndue: 2026-09-01\nstatus: upcoming\n---\n\n# Quiz 1\n',
  });
}

type FixtureVault = ReturnType<typeof fixtureVault>;

function registryProvider(vault: FixtureVault, now: () => Date = () => NOW) {
  return createLocalRegistryProvider({
    vault,
    deviceId: DEVICE,
    settingsHost: new FakeSettingsHost(),
    now,
    editPort: {
      async edit() {
        /* no case here opens an editor */
      },
    },
  });
}

async function withheldMcq(vault: FixtureVault): Promise<RegistryWithheldItem> {
  const state = await registryProvider(vault).load();
  if (state.kind !== 'model') throw new Error(`expected a registry model, got ${state.kind}`);
  const item = state.withheldInstruments.find(
    (candidate) => candidate.notePath === MCQ_NOTE_PATH && candidate.kind === 'mcq',
  );
  if (item === undefined || item.identity === undefined) {
    throw new Error('expected the withheld MCQ with a safely derived identity');
  }
  return item;
}

/** She rejects the withheld MCQ from the registry: the production writer. Returns its id. */
async function rejectThroughRegistry(vault: FixtureVault): Promise<string> {
  const item = await withheldMcq(vault);
  await registryProvider(vault).rejectWithheldItem(item);
  const identity = item.identity;
  if (identity === undefined) throw new Error('unreachable: checked above');
  return identity.instrumentId;
}

/** Rejects, then restores through the registry's own restore (her deliberate restore). */
async function rejectThenRestoreThroughRegistry(vault: FixtureVault): Promise<string> {
  const instrumentId = await rejectThroughRegistry(vault);
  // Two clicks never share a millisecond; the restore is a later event than the rejection.
  const later = new Date(NOW.getTime() + 60_000);
  const state = await registryProvider(vault, () => later).load();
  if (state.kind !== 'model') throw new Error(`expected a registry model, got ${state.kind}`);
  const item = state.withheldInstruments.find(
    (candidate) => candidate.notePath === MCQ_NOTE_PATH && candidate.kind === 'mcq',
  );
  if (item?.rejectedAs === undefined) throw new Error('expected a standing rejection to restore');
  await registryProvider(vault, () => later).restoreWithheldItem(item);
  return instrumentId;
}

/** She fixes the block: the embed now resolves. Asserts the fixed instrument keeps its id. */
async function fixAsset(vault: FixtureVault, instrumentId: string): Promise<void> {
  await vault.write(MCQ_NOTE_PATH, mcqNote('figure.png'));
  const enumeration = await enumerateVaultInstruments(vault, {
    concepts: { stampConceptKeys: true },
  });
  expect(enumeration.invalidMcqBlocks).toHaveLength(0);
  expect(enumeration.records.map((record) => record.instrumentId)).toContain(instrumentId);
}

async function compose(vault: FixtureVault) {
  const result = await composeStudySessionForRequest(
    {
      vault,
      deviceId: DEVICE,
      settingsHost: new FakeSettingsHost(),
      now: () => NOW,
      scheduler: createFsrsScheduler(),
    },
    { budgetMinutes: DEFAULT_SESSION_BUDGET_MINUTES },
    NOW,
  );
  if (result === null) throw new Error('expected a composition (the plan is configured)');
  return result;
}

async function conceptKeyOfMcqNote(vault: FixtureVault): Promise<string> {
  const enumeration = await enumerateVaultInstruments(vault, {
    concepts: { stampConceptKeys: true },
  });
  const key = enumeration.records.find((record) => record.notePath === MCQ_NOTE_PATH)
    ?.conceptIds[0];
  if (key === undefined) throw new Error('expected the note to carry a concept key');
  return key;
}

function reviewPorts(vault: FixtureVault): ReviewSessionPorts {
  const editPort: EditPort = {
    async edit() {
      /* no case here edits through the review tab */
    },
  };
  return {
    reviewLog: createVaultReviewLogPort(vault, DEVICE),
    suspendPort: createVaultSuspendPort(vault, DEVICE),
    editPort,
    noteExists: createVaultNoteExistsPort(vault),
    clock: { now: () => NOW } satisfies Clock,
    draftAcceptPort: {
      accept() {
        throw new Error('no draft item in this suite should call accept');
      },
      reject() {
        throw new Error('no draft item in this suite should call reject');
      },
    },
  };
}

async function openReview(vault: FixtureVault, holder: StudySessionHolder) {
  const input: OpenReviewSessionInput = {
    vault,
    scheduler: createFsrsScheduler(),
    deviceId: DEVICE,
    ports: reviewPorts(vault),
    probeDays: 30,
    studySessionHolder: holder,
    composeDefaultStudySession: async () => (await compose(vault)).composed.full,
  };
  const outcome = await openReviewSession(input);
  if (!outcome.ok) throw new Error(`expected the review tab to open: ${String(outcome.error)}`);
  return outcome.scheduledQueue.map((item) => item.instrument.instrumentId);
}

describe('ol-egov.141.89.2.14 — a rejected, since-fixed instrument is never composed', () => {
  it('the composer does not offer it for its concept, nor place it in the session', async () => {
    const vault = fixtureVault('gone.png');
    const instrumentId = await rejectThroughRegistry(vault);
    await fixAsset(vault, instrumentId);

    const result = await compose(vault);
    const offered = result.composedInput.instruments
      .instrumentsFor(await conceptKeyOfMcqNote(vault))
      .map((record) => record.instrumentId);
    expect(offered).not.toContain(instrumentId);
    expect(offered.length).toBeGreaterThan(0); // her sibling card on the same concept still is
    const composedIds = result.composed.full.model.items.map((item) => item.instrumentId);
    expect(composedIds).not.toContain(instrumentId);
  });

  it('control: after her deliberate restore, the same fixed instrument is composed', async () => {
    const vault = fixtureVault('gone.png');
    const instrumentId = await rejectThenRestoreThroughRegistry(vault);
    await fixAsset(vault, instrumentId);

    const result = await compose(vault);
    const offered = result.composedInput.instruments
      .instrumentsFor(await conceptKeyOfMcqNote(vault))
      .map((record) => record.instrumentId);
    expect(offered).toContain(instrumentId);
    const composedIds = result.composed.full.model.items.map((item) => item.instrumentId);
    expect(composedIds).toContain(instrumentId);
  });

  it('the review tab opening onto an idle session never serves it', async () => {
    const vault = fixtureVault('gone.png');
    const instrumentId = await rejectThroughRegistry(vault);
    await fixAsset(vault, instrumentId);

    const served = await openReview(vault, createStudySessionHolder());
    expect(served).not.toContain(instrumentId);
    expect(served.length).toBeGreaterThan(0);
  });

  it("Today's count, read off the same composition, does not count it", async () => {
    const vault = fixtureVault('gone.png');
    const instrumentId = await rejectThroughRegistry(vault);
    await fixAsset(vault, instrumentId);

    const source = createVaultInstrumentSource({
      vault,
      scheduler: createFsrsScheduler(),
      deviceId: DEVICE,
      now: () => NOW,
      studySessionHolder: createStudySessionHolder(),
      composeDefaultStudySession: async () => (await compose(vault)).composed.full,
    });
    const due = await source.listDueCandidates();
    if (due === null) throw new Error('expected a count');
    expect(due.map((instrument) => instrument.instrumentId)).not.toContain(instrumentId);
    expect(due.length).toBeGreaterThan(0);
  });
});

describe('ol-egov.141.89.2.14 — the present-time check: a sitting composed before she rejected the item', () => {
  it('a held sitting that still lists the item does not serve it once it stands rejected', async () => {
    const vault = fixtureVault('figure.png');
    const holder = createStudySessionHolder();

    // The sitting is composed while the item is sound and unrejected: it is served.
    const first = await openReview(vault, holder);
    const enumeration = await enumerateVaultInstruments(vault, {
      concepts: { stampConceptKeys: true },
    });
    const mcqId = enumeration.records.find(
      (record) => record.notePath === MCQ_NOTE_PATH && record.instrumentType === 'mcq',
    )?.instrumentId;
    if (mcqId === undefined) throw new Error('expected the MCQ enumerated');
    expect(first).toContain(mcqId);
    expect(holder.getSitting().status).toBe('active');

    // Mid-sitting its embed stops resolving; she rejects it from the registry; she then fixes it.
    await vault.write(MCQ_NOTE_PATH, mcqNote('gone.png'));
    const rejectedId = await rejectThroughRegistry(vault);
    expect(rejectedId).toBe(mcqId);
    await fixAsset(vault, mcqId);

    // Reopening reads the held sitting, which still lists the item.
    const sitting = holder.getSitting();
    if (sitting.status !== 'active') throw new Error('expected the sitting to still be held');
    expect(sitting.items.model.items.map((item) => item.instrumentId)).toContain(mcqId);
    const served = await openReview(vault, holder);
    expect(served).not.toContain(mcqId);
    expect(served.length).toBeGreaterThan(0);
  });
});
