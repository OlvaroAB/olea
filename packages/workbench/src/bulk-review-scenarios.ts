/**
 * F3.3's bulk-review triage path (`ol-jie3`), mounted against the REAL
 * `BulkReviewController`/`BulkReviewView` from `packages/plugin` — the same
 * "workbench mounts the real product view against real deps" discipline
 * every other surface in this package uses (see `trends-scenarios.ts`'s own
 * module doc for the contrast case this is NOT).
 *
 * `BulkReviewController`'s own deps (`DraftCacheStore`, `DraftAcceptPort`,
 * `BulkReviewEditPort`) are all Obsidian-free by construction
 * (`bulk-review.ts`'s module doc), so this file wires the REAL
 * `createVaultDraftCacheStore` and `createDraftAcceptPort` from
 * `packages/plugin/src/generation/` over a `MemoryVaultSource` seeded with a
 * handful of synthetic pending drafts — the identical recipe
 * `bulk-review.spec.ts` (plugin package, Vitest) already uses over its own
 * `MemoryVaultSource` fake, just run here against the browser build. Only
 * the edit port is workbench-local (real Obsidian navigation has nothing to
 * hand off to here — same posture every other surface's edit/navigate stub
 * takes), and it is exposed to the inspector so a click is visible on
 * screen, not just in the vault.
 *
 * Course codes and note titles below are coined vocabulary
 * (`syn:course:…`), never real course names — same fixture-vocabulary
 * discipline `generate-scenarios.ts` states for its own synthetic corpus.
 */

import {
  BulkReviewController,
  type BulkReviewEditPort,
  createDraftAcceptPort,
  createVaultDraftCacheStore,
  type DraftCacheStore,
  type DraftRecord,
} from './bulk-review-bridge.js';
import { MemoryVaultSource } from './vault/memory-source.js';

/** Fixed so a screenshot taken twice is the same screenshot (the same discipline every other state builder in this package follows). */
const NOW = new Date('2027-01-15T09:00:00-08:00');
const DEVICE_ID = 'workbench-bulk-review';

export interface BulkReviewWorkbenchState {
  readonly id: string;
  readonly label: string;
  readonly group: 'bulk-review';
  readonly note: string;
}

export const BULK_REVIEW_STATES: readonly BulkReviewWorkbenchState[] = [
  {
    id: 'bulk-review-two-groups',
    label: 'Two documents — the density F3.3 names',
    group: 'bulk-review',
    note:
      "Two source notes, three pending drafts between them (one document carries two — its " +
      '"Accept remainder" button is the F3.3/ol-p3t07a batch action, resolving every still-' +
      'pending item in that group through the identical accept() a single click already uses). ' +
      'Every draft, edit and reject below runs through the REAL DraftAcceptPort — an accept ' +
      'genuinely materializes an MCQ block into the synthetic vault and appends a real verdict ' +
      'record; nothing here is a rendered mock.',
  },
  {
    id: 'bulk-review-empty',
    label: 'Nothing pending — the honest empty state',
    group: 'bulk-review',
    note:
      'No pending drafts anywhere in the vault. F3.3 draws a designed empty state here, never a ' +
      'bare unexplained blank list.',
  },
];

export function findBulkReviewState(
  id: string,
): { readonly id: string; readonly note: string } | undefined {
  const found = BULK_REVIEW_STATES.find((s) => s.id === id);
  return found === undefined ? undefined : { id: found.id, note: found.note };
}

function draftRecord(overrides: Partial<DraftRecord> & Pick<DraftRecord, 'draftId'>): DraftRecord {
  return {
    status: 'pending',
    courseCode: 'syn:course:vantrel',
    conceptName: 'syn:concept:default',
    conceptIds: ['syn:concept-key:default'],
    sourcePath: '01 Courses/syn:course:vantrel/Week 2.md',
    createdAt: '2027-01-10T09:00:00-08:00',
    question: {
      stem: 'A synthetic stem for the bulk-review workbench state.',
      correctAnswer: 'Correct answer',
      distractors: ['Distractor A', 'Distractor B', 'Distractor C', 'Distractor D'],
      feedback: 'Synthetic feedback.',
    },
    provenance: { taskId: 'quiz.generate.v1', promptVersion: '1.0.0', modelId: 'workbench-fixture' },
    firstServedAt: null,
    ...overrides,
  };
}

const NOTE_A = '01 Courses/syn:course:vantrel/Week 2.md';
const NOTE_B = '01 Courses/syn:course:melspar/Week 4.md';

const TWO_GROUPS_RECORDS: readonly DraftRecord[] = [
  draftRecord({
    draftId: 'draft-a1',
    courseCode: 'syn:course:vantrel',
    conceptName: 'syn:concept:alpha',
    conceptIds: ['syn:concept-key:alpha'],
    sourcePath: NOTE_A,
    createdAt: '2027-01-10T09:00:00-08:00',
    question: {
      stem: 'What does the alpha mechanism regulate?',
      correctAnswer: 'The synthetic rate constant',
      distractors: ['A fixed offset', 'Nothing measurable', 'The prior draft', 'A random seed'],
      feedback: 'See Week 2.',
    },
  }),
  draftRecord({
    draftId: 'draft-a2',
    courseCode: 'syn:course:vantrel',
    conceptName: 'syn:concept:beta',
    conceptIds: ['syn:concept-key:beta'],
    sourcePath: NOTE_A,
    createdAt: '2027-01-10T09:05:00-08:00',
    question: {
      stem: 'Which condition triggers the beta pathway?',
      correctAnswer: 'A synthetic threshold crossing',
      distractors: ['A calendar date', 'A random draw', 'Nothing — it never triggers', 'A manual reset'],
      feedback: 'See Week 2.',
    },
  }),
  draftRecord({
    draftId: 'draft-b1',
    courseCode: 'syn:course:melspar',
    conceptName: 'syn:concept:vorlex',
    conceptIds: ['syn:concept-key:vorlex'],
    sourcePath: NOTE_B,
    createdAt: '2027-01-11T09:00:00-08:00',
    question: {
      stem: 'What is the vorlex quantity measured in?',
      correctAnswer: 'Synthetic units',
      distractors: ['Real units', 'No units at all', 'Currency', 'Time'],
      feedback: 'See Week 4.',
    },
  }),
];

export interface BulkReviewScenario {
  readonly stateId: string;
  readonly controller: BulkReviewController;
  readonly editPort: RecordingBulkReviewEditPort;
  readonly cache: DraftCacheStore;
}

export class RecordingBulkReviewEditPort implements BulkReviewEditPort {
  readonly edited: Array<{ sourcePath: string; blockId: string | null }> = [];
  /** Fired after every recorded edit, so `main.ts` can keep the inspector's own copy current without polling — same "notify, don't poll" shape `onOverridesChanged` uses elsewhere in this codebase. */
  onEdit: (() => void) | null = null;
  async edit(instrument: { readonly sourcePath: string; readonly blockId: string | null }): Promise<void> {
    this.edited.push({ sourcePath: instrument.sourcePath, blockId: instrument.blockId });
    this.onEdit?.();
  }
}

/** Builds one fresh vault + cache + controller per open — matching `BulkReviewControllerProvider`'s own doc ("building a controller is synchronous, but loading it is not"). */
export function buildBulkReviewScenario(stateId: string): BulkReviewScenario {
  const records = stateId === 'bulk-review-empty' ? [] : TWO_GROUPS_RECORDS;
  const noteBodies: Record<string, string> = {};
  for (const record of records) {
    noteBodies[record.sourcePath] = `# ${record.sourcePath}\n\nHer prose.\n`;
  }
  const encoder = new TextEncoder();
  const files = new Map<string, Uint8Array>(
    Object.entries(noteBodies).map(([path, body]) => [path, encoder.encode(body)]),
  );
  const vault = MemoryVaultSource.fromBytes(files);
  const cache = createVaultDraftCacheStore(vault);
  const acceptPort = createDraftAcceptPort({ vault, cache, deviceId: DEVICE_ID, now: () => NOW });
  const editPort = new RecordingBulkReviewEditPort();
  const controller = new BulkReviewController({ cache, acceptPort, editPort });

  return { stateId, controller, editPort, cache };
}

/** Seeds the cache before the view's first `load()` — `main.ts` awaits this before mounting. */
export async function seedBulkReviewScenario(scenario: BulkReviewScenario): Promise<void> {
  const records = scenario.stateId === 'bulk-review-empty' ? [] : TWO_GROUPS_RECORDS;
  for (const record of records) await scenario.cache.put(record);
}
