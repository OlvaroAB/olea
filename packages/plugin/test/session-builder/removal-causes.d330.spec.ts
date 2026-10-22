/**
 * `ol-egov.141.89.10.134` — executed tests for `[D-330]`'s four instrument-removal causes
 * (suspended or withdrawn by her, its note gone, its cited passage marked changed under `[D-293]`),
 * on the plugin's real production composition path. Closes three gaps an earlier read found:
 *
 *  (1) nothing showed all four causes take ONE path at composition (core's `it.each` passes the
 *      same input for every row, so it cannot tell causes apart);
 *  (2) no plugin test ran the mid-session extension end to end with a pending-revalidation
 *      instrument (`main-wiring.spec.ts` pins source text only);
 *  (3) nothing asserted that a removal writes no penalty entry (no rating, no review-log record).
 *
 * ## What is driven
 *
 * - Composition: `composeStudySessionForRequest` (`session-builder/provider.ts`) — the one
 *   composer behind "Olea: Start today's review" and Home — then `openReviewSession`
 *   (`review/open-session.ts`) over it, as `composed-review-path.spec.ts` does.
 * - Extension: `main.ts` cannot be imported under Vitest (it imports `obsidian`; see
 *   `extend-with-account-progression.spec.ts`). So the extension tests drive the two production
 *   functions `main.ts`'s `extendDefaultStudySession` (`main.ts:4203`) calls, with the same inputs:
 *   `composeStudySessionForRequest` (with `citationHashStore`, the course pinned) and
 *   `extendComposedStudySessionWithAccount`. `main.ts` itself is not driven.
 *
 * ## How each cause reaches composition
 *
 * - suspended / withdrawn: the identical `kind: 'suspend'` log record (F2.6 port / F8.5 prune);
 *   folded by `suspendedInstrumentIds` in `provider.ts` before the concept index is built.
 * - note gone: the note is absent from the vault, so the instrument is never enumerated and never
 *   reaches the index. There is no separate removal step: composition is the same path. A note
 *   that vanishes AFTER a session is open is handled only at presentation (`ReviewSession`'s
 *   `note-missing` phase); the last tests in this file assert exactly that.
 * - cited passage changed: the pending-revalidation fact in the plugin's `CitationHashStore`,
 *   resolved by `resolveCitationPendingRevalidation` into `citationPendingRevalidation`.
 *
 * Every id, course code and concept name is invented (INV-3).
 */
import { appendSuspendRecord, createFsrsScheduler, enumerateVaultInstruments } from 'olea-core';
import { describe, expect, it } from 'vitest';
import { extendComposedStudySessionWithAccount } from '../../../core/src/study-session/compose.js';
import { ObsidianCitationHashStore } from '../../src/ingestion/materiality/citation-hash-store.js';
import type { ObsidianDataHost } from '../../src/plan/settings-store.js';
import { STUDY_PLAN_SETTINGS_STORAGE_KEY } from '../../src/plan/settings-store.js';
import { openReviewSession, type ReviewSessionPorts } from '../../src/review/open-session.js';
import {
  type Clock,
  createVaultReviewLogPort,
  createVaultSuspendPort,
  type EditPort,
  isoWithLocalOffset,
} from '../../src/review/ports.js';
import { createStudySessionHolder } from '../../src/session/holder.js';
import { DEFAULT_SESSION_BUDGET_MINUTES } from '../../src/session-builder/copy.js';
import { composeStudySessionForRequest } from '../../src/session-builder/provider.js';
import { type MemoryVault, memoryVault } from '../review/memory-vault.js';

const DEVICE = 'olea-testdevice1';
const NOW = new Date('2026-08-10T09:00:00-04:00');
const COURSE = 'TESTC101';
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

class FakeDataHost implements ObsidianDataHost {
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

const NOTES = {
  widget: 'Notes/one.md',
  gadget: 'Notes/two.md',
  gizmo: 'Notes/three.md',
} as const;
type NoteKey = keyof typeof NOTES;

/** Three concepts, one Q&A card each, one course, all cited by one past paper. `without` omits a note ("note gone"). */
function threeConceptVault(without?: NoteKey): MemoryVault {
  const note = (topic: string, card: string): string =>
    ['---', `topic: [${topic}]`, `course: ${COURSE}`, '---', '', card, ''].join('\n');
  const files: Record<string, string> = {
    '05 Zettelkasten/Widget theory.md': '# Widget theory\n',
    '05 Zettelkasten/Gadget theory.md': '# Gadget theory\n',
    '05 Zettelkasten/Gizmo theory.md': '# Gizmo theory\n',
    [NOTES.widget]: note('Widget theory', 'Front::Back'),
    [NOTES.gadget]: note('Gadget theory', 'Front2::Back2'),
    [NOTES.gizmo]: note('Gizmo theory', 'Front3::Back3'),
    [`03 Research/${COURSE} Past Paper 2023.md`]: [
      '---',
      'role: past-paper',
      `course: ${COURSE}`,
      '---',
      '',
      `# ${COURSE} Past Paper — 2023`,
      '',
      '## Question 1 (10 marks)',
      '',
      'Explain the core mechanism behind Widget theory and why it matters.',
      '',
      '## Question 2 (10 marks)',
      '',
      'Explain the core mechanism behind Gadget theory and why it matters.',
      '',
      '## Question 3 (10 marks)',
      '',
      'Explain the core mechanism behind Gizmo theory and why it matters.',
      '',
    ].join('\n'),
    [ASSIGNMENTS_BASE_PATH]: BASE_FILE,
    '02 Assignments/Quiz 1.md': `---\nclass: ${COURSE}\ntype: Quiz\nweight: 10\ndue: 2026-09-01\nstatus: upcoming\n---\n\n# Quiz 1\n`,
  };
  if (without !== undefined) delete files[NOTES[without]];
  return memoryVault(files);
}

interface Ids {
  readonly widget: string;
  readonly gadget: string;
  readonly gizmo: string;
  readonly conceptIds: Readonly<Record<NoteKey, readonly string[]>>;
}

/** Instrument ids are derived from the vault, never hard-coded. */
async function idsOf(vault: MemoryVault): Promise<Ids> {
  const enumeration = await enumerateVaultInstruments(vault, {
    concepts: { stampConceptKeys: true },
  });
  const find = (path: string) => {
    const record = enumeration.records.find((r) => r.notePath === path);
    if (record === undefined) throw new Error(`expected an instrument enumerated for ${path}`);
    return record;
  };
  const [w, g, z] = [find(NOTES.widget), find(NOTES.gadget), find(NOTES.gizmo)];
  return {
    widget: w.instrumentId,
    gadget: g.instrumentId,
    gizmo: z.instrumentId,
    conceptIds: { widget: w.conceptIds, gadget: g.conceptIds, gizmo: z.conceptIds },
  };
}

function deps(vault: MemoryVault, extra: object = {}) {
  return {
    vault,
    deviceId: DEVICE,
    settingsHost: new FakeDataHost(),
    now: () => NOW,
    scheduler: createFsrsScheduler(),
    ...extra,
  };
}

/** The composed session's instrument ids, in the order she meets them. */
async function composedIds(vault: MemoryVault, extra: object = {}): Promise<readonly string[]> {
  const result = await composeStudySessionForRequest(
    deps(vault, extra),
    { budgetMinutes: DEFAULT_SESSION_BUDGET_MINUTES },
    NOW,
  );
  if (result === null) throw new Error('expected a composed result, got null');
  return result.composed.full.model.items.map((item) => item.instrumentId);
}

function reviewPorts(
  vault: MemoryVault,
  noteExists: ReviewSessionPorts['noteExists'] = { exists: async (p) => vault.exists(p) },
): ReviewSessionPorts {
  const editPort: EditPort = { async edit() {} };
  return {
    reviewLog: createVaultReviewLogPort(vault, DEVICE),
    suspendPort: createVaultSuspendPort(vault, DEVICE),
    editPort,
    noteExists,
    clock: { now: () => NOW } satisfies Clock,
    draftAcceptPort: {
      accept() {
        throw new Error('removal-causes.d330.spec: no draft item should call accept');
      },
      reject() {
        throw new Error('removal-causes.d330.spec: no draft item should call reject');
      },
    },
  };
}

/** The real "Start today's review" chain: `composeStudySessionForRequest` into `openReviewSession`. */
async function openThroughProductionPath(
  vault: MemoryVault,
  ports: ReviewSessionPorts = reviewPorts(vault),
  extra: object = {},
) {
  const outcome = await openReviewSession({
    vault,
    scheduler: createFsrsScheduler(),
    deviceId: DEVICE,
    ports,
    probeDays: 30,
    studySessionHolder: createStudySessionHolder(),
    composeDefaultStudySession: async () => {
      const result = await composeStudySessionForRequest(
        deps(vault, extra),
        { budgetMinutes: DEFAULT_SESSION_BUDGET_MINUTES },
        NOW,
      );
      return result?.composed.full ?? null;
    },
  });
  if (!outcome.ok) throw new Error(`expected an opened session, got: ${String(outcome.error)}`);
  return outcome;
}

type Cause = 'suspended' | 'withdrawn' | 'note-gone' | 'passage-changed';
const CAUSES: readonly Cause[] = ['suspended', 'withdrawn', 'note-gone', 'passage-changed'];

/**
 * Builds a fresh vault and applies `cause` to the instrument of `target`. Returns what composition
 * needs. "Suspended" goes through the F2.6 port, "withdrawn" through the F8.5 prune's own write
 * (`registry/ports.ts` wraps this same `appendSuspendRecord` call).
 */
async function applyCause(cause: Cause, target: NoteKey) {
  const ids = await idsOf(threeConceptVault());
  const targetId = ids[target];
  const vault = threeConceptVault(cause === 'note-gone' ? target : undefined);
  let extra: object = {};
  if (cause === 'suspended') {
    await createVaultSuspendPort(vault, DEVICE).suspend(targetId, ids.conceptIds[target]);
  } else if (cause === 'withdrawn') {
    await appendSuspendRecord(
      vault,
      {
        kind: 'suspend',
        timestamp: isoWithLocalOffset(NOW),
        instrumentId: targetId,
        conceptIds: [...ids.conceptIds[target]],
      },
      { deviceId: DEVICE },
    );
  } else if (cause === 'passage-changed') {
    const citationHashStore = new ObsidianCitationHashStore(new FakeDataHost());
    await citationHashStore.save(targetId, {
      sourcePath: NOTES[target],
      text: 'the material as last observed',
      conceptIds: [],
    });
    await citationHashStore.setPendingRevalidation(targetId, 'test-hash-current', Date.now());
    extra = { citationHashStore };
  }
  return { vault, extra, ids, targetId };
}

/** Every record in the vault's review log, parsed. */
async function reviewLogRecords(vault: MemoryVault): Promise<readonly Record<string, unknown>[]> {
  const paths = await vault.list({ under: '.olea/reviews', extensions: ['jsonl'] });
  const records: Record<string, unknown>[] = [];
  for (const path of paths) {
    for (const line of (await vault.read(path)).split('\n')) {
      if (line.trim() !== '') records.push(JSON.parse(line) as Record<string, unknown>);
    }
  }
  return records;
}

function reviewLogWrites(vault: MemoryVault): number {
  return vault.writes.filter((p) => p.startsWith('.olea/reviews')).length;
}

describe('D-330 acceptance 1 — each removal cause takes one composition path', () => {
  it('baseline: three instruments compose in one stable order', async () => {
    const vault = threeConceptVault();
    const ids = await idsOf(vault);
    const order = await composedIds(vault);
    expect([...order].sort()).toEqual([ids.widget, ids.gadget, ids.gizmo].sort());
    expect(await composedIds(threeConceptVault())).toEqual(order);
  });

  it.each(CAUSES)(
    '%s: the instrument is removed, the rest keep their baseline order, nothing takes its place',
    async (cause) => {
      const baseline = await composedIds(threeConceptVault());
      // The middle one, so "order kept" and "no substitute" are both visible.
      const middle = baseline[1];
      if (middle === undefined) throw new Error('expected three baseline items');
      const ids = await idsOf(threeConceptVault());
      const target = (['widget', 'gadget', 'gizmo'] as const).find((k) => ids[k] === middle);
      if (target === undefined) throw new Error('middle item is not one of the three');

      const { vault, extra } = await applyCause(cause, target);
      const after = await composedIds(vault, extra);

      expect(after).not.toContain(middle);
      expect(after).toEqual(baseline.filter((id) => id !== middle));
      expect(after).toHaveLength(baseline.length - 1);
    },
  );

  it('all four causes land on the same composed session: identical ids in identical order', async () => {
    const baseline = await composedIds(threeConceptVault());
    const middle = baseline[1];
    const ids = await idsOf(threeConceptVault());
    const target = (['widget', 'gadget', 'gizmo'] as const).find((k) => ids[k] === middle);
    if (target === undefined) throw new Error('middle item is not one of the three');
    const results: (readonly string[])[] = [];
    for (const cause of CAUSES) {
      const { vault, extra } = await applyCause(cause, target);
      results.push(await composedIds(vault, extra));
    }
    for (const result of results) expect(result).toEqual(results[0]);
  });

  it('the same holds for the first and last baseline item (no position is special)', async () => {
    const baseline = await composedIds(threeConceptVault());
    const ids = await idsOf(threeConceptVault());
    for (const index of [0, baseline.length - 1]) {
      const removed = baseline[index];
      const target = (['widget', 'gadget', 'gizmo'] as const).find((k) => ids[k] === removed);
      if (target === undefined) throw new Error('baseline item is not one of the three');
      for (const cause of CAUSES) {
        const { vault, extra } = await applyCause(cause, target);
        expect(await composedIds(vault, extra)).toEqual(baseline.filter((id) => id !== removed));
      }
    }
  });
});

describe('D-330 acceptance 2 — the mid-session extension drops a pending-revalidation instrument', () => {
  /**
   * `main.ts`'s `extendDefaultStudySession`, minus Obsidian: a session composed and held, then the
   * cited passage of its middle instrument is marked changed, then the same recomposition the
   * method performs (store passed, course pinned, budget widened) and
   * `extendComposedStudySessionWithAccount`.
   */
  async function extendAfter(cause: 'passage-changed' | 'suspended') {
    const vault = threeConceptVault();
    const ids = await idsOf(vault);
    const first = await composeStudySessionForRequest(
      deps(vault),
      { budgetMinutes: DEFAULT_SESSION_BUDGET_MINUTES },
      NOW,
    );
    if (first === null) throw new Error('expected a composed result');
    const previous = first.composed.full;
    const before = previous.model.items.map((i) => i.instrumentId);
    const middle = before[1];
    if (middle === undefined) throw new Error('expected three items');
    const target = (['widget', 'gadget', 'gizmo'] as const).find((k) => ids[k] === middle);
    if (target === undefined) throw new Error('middle item is not one of the three');

    let extra: object = {};
    if (cause === 'passage-changed') {
      const citationHashStore = new ObsidianCitationHashStore(new FakeDataHost());
      await citationHashStore.save(middle, {
        sourcePath: NOTES[target],
        text: 'the material as last observed',
        conceptIds: [],
      });
      await citationHashStore.setPendingRevalidation(middle, 'test-hash-current', Date.now());
      extra = { citationHashStore };
    } else {
      await createVaultSuspendPort(vault, DEVICE).suspend(middle, ids.conceptIds[target]);
    }

    const widerBudgetMinutes = previous.model.budgetMinutes + DEFAULT_SESSION_BUDGET_MINUTES;
    const result = await composeStudySessionForRequest(
      deps(vault, extra),
      {
        budgetMinutes: DEFAULT_SESSION_BUDGET_MINUTES,
        courseOrTopic: { kind: 'course', label: COURSE },
      },
      NOW,
    );
    if (result === null) throw new Error('expected a re-composed result');
    const extended = extendComposedStudySessionWithAccount(
      { ...result.composedInput, budgetMinutes: widerBudgetMinutes },
      previous,
    );
    return { before, middle, previous, extended };
  }

  it('a pending-revalidation instrument is dropped from the open session; survivors keep order; nothing replaces it', async () => {
    const { before, middle, previous, extended } = await extendAfter('passage-changed');
    expect(extended).not.toBe(previous);
    const after = extended.model.items.map((i) => i.instrumentId);
    expect(after).toEqual(before.filter((id) => id !== middle));
    expect(extended.model.items.map((i) => i.position)).toEqual([1, 2]);
  });

  it('the dropped instrument is accounted for as set aside for a changed cited passage', async () => {
    const { middle, extended } = await extendAfter('passage-changed');
    const entry = extended.setAside?.instruments.find((e) => e.instrumentId === middle);
    expect(entry?.reason).toBe('cited-passage-changed');
  });

  // FINDING (reported with this bead): the extension applies only the cited-passage removal to the
  // items it carries forward (`extendComposedStudySessionWithAccount`'s doc: "the only removal this
  // function applies"). An instrument suspended AFTER the session opened is still carried; the
  // product removes it at presentation (`ReviewSession`, `ol-egov.141.89.5.59`), which the next
  // suite exercises. D-330 says all four causes apply "including within an already-open session".
  // This asserts what the product actually does today.
  it('a suspended instrument is NOT dropped by the extension itself (kept for presentation to handle)', async () => {
    const { before, previous, extended } = await extendAfter('suspended');
    expect(extended).toBe(previous);
    expect(extended.model.items.map((i) => i.instrumentId)).toEqual(before);
  });
});

describe('D-330 acceptance 3 — no cause writes a rating or penalty entry for the removed instrument', () => {
  it.each(CAUSES)('%s: opening the session writes nothing to the review log', async (cause) => {
    const baseline = await composedIds(threeConceptVault());
    const middle = baseline[1];
    const ids = await idsOf(threeConceptVault());
    const target = (['widget', 'gadget', 'gizmo'] as const).find((k) => ids[k] === middle);
    if (target === undefined) throw new Error('middle item is not one of the three');

    const { vault, targetId, extra } = await applyCause(cause, target);
    const logBefore = await reviewLogRecords(vault);
    const writesBefore = reviewLogWrites(vault);

    const outcome = await openThroughProductionPath(vault, reviewPorts(vault), extra);
    // The removed instrument is not in the served queue, so the log check is about a real removal.
    expect(outcome.scheduledQueue.map((i) => i.instrument.instrumentId)).not.toContain(targetId);
    expect(outcome.scheduledQueue).toHaveLength(2);
    await outcome.session.start();

    expect(reviewLogWrites(vault)).toBe(writesBefore);
    const logAfter = await reviewLogRecords(vault);
    expect(logAfter).toEqual(logBefore);
    // Whatever record exists for the removed instrument is only the suspension itself
    // (suspended, withdrawn); never a rating or any other kind.
    const forTarget = logAfter.filter((r) => r.instrumentId === targetId);
    const expectedKinds = cause === 'suspended' || cause === 'withdrawn' ? ['suspend'] : [];
    expect(forTarget.map((r) => r.kind)).toEqual(expectedKinds);
    expect(logAfter.some((r) => r.kind === 'rating' || r.kind === 'review')).toBe(false);
  });

  it('note gone AFTER the session opened: presentation shows note-missing, removing it writes nothing and loses no other item', async () => {
    const vault = threeConceptVault();
    const gone = new Set<string>();
    const ports = reviewPorts(vault, { exists: async (p) => !gone.has(p) });
    const outcome = await openThroughProductionPath(vault, ports);
    const queue = outcome.scheduledQueue.map((i) => i.instrument.instrumentId);
    expect(queue).toHaveLength(3);
    const first = outcome.scheduledQueue[0];
    if (first === undefined) throw new Error('expected a first item');
    gone.add(first.instrument.sourcePath);
    const writesBefore = reviewLogWrites(vault);

    await outcome.session.start();
    expect(outcome.session.getViewModel().phase).toBe('note-missing');
    await outcome.session.removeMissingNote();

    const vm = outcome.session.getViewModel();
    expect(vm.phase).toBe('front');
    if (vm.phase === 'front') expect(vm.instrument.instrumentId).toBe(queue[1]);
    expect(reviewLogWrites(vault)).toBe(writesBefore);
    expect(await reviewLogRecords(vault)).toEqual([]);
  });
});
