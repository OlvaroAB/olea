/**
 * `createLocalPracticePaperProvider` — the practice-paper command/view's own composition root
 * (F4.11, `[D-250]`/`[D-252]`/`[D-262]`, `[PAPER-8]` / `ol-egov.141.6.1`).
 *
 * Follows the same shape `gap/provider.ts` and `session-builder/provider.ts` already establish:
 * no cache (`load`/`requestPaper` both recompute from the live vault every call — C6, D-002/D-004/
 * D-005/D-008), and every AI-dependent step greys out honestly (F7.8) rather than half-working.
 *
 * **What this composes, and on what basis** — see `assemble.ts` and `unlock.ts`'s own module docs
 * for exactly which of F4.11's four blueprint inputs are read from real, already-wired production
 * data today (course-scoped `ConceptRecord`s via `enumerateVaultInstruments`, real assignments via
 * `readAssessments`) and which are honestly degraded because no production reader exists yet
 * anywhere in this repo (taughtSignal, mastery, Outcome coverage, past-paper structure/demand
 * recovery). Composing those three real readers is a separate, multi-bead effort this bead's own
 * `owns` (`packages/plugin/src/paper/`) does not cover.
 */

import {
  buildPaperBlueprint,
  createPaper,
  enumerateVaultInstruments,
  fillPaperBlueprintSlots,
  type PaperEmptySlot,
  type PaperGroundingLabel,
  type PaperItemGenerationPort,
  type PaperRecord,
  paperCompositionAccountFromBlueprint,
  readAssessments,
  type VaultSource,
} from 'olea-core';
import type { PersistedStudyPlanConfig } from '../plan/settings-store.js';
import { isStudyPlanConfigured } from '../plan/settings-store.js';
import { buildBlueprintInputForCourse } from './assemble.js';
import type { PartialPaperStatement } from './copy.js';
import { buildPartialPaperStatement } from './copy.js';
import type { PaperDemand } from './demand.js';
import { evaluatePracticePaperUnlockForCourse } from './unlock.js';

/** One face-ready item — the labels the view renders alongside her response, never the blueprint's internal weight/rank fields she has no reason to see. */
export interface PracticePaperFaceItem {
  readonly slotId: string;
  readonly conceptName: string;
  readonly intendedDemand: PaperDemand;
  readonly groundingLabel: PaperGroundingLabel;
  readonly response: unknown;
}

/** What the view renders once a paper has been composed. `partialStatement` is placed BEFORE `items` by the view — ruling 4: "before she opens it" — never a footnote after them. */
export interface PracticePaperReadyState {
  readonly kind: 'ready';
  readonly course: string;
  readonly record: PaperRecord;
  readonly partial: boolean;
  readonly partialStatement: PartialPaperStatement | null;
  readonly items: readonly PracticePaperFaceItem[];
  readonly emptySlots: readonly PaperEmptySlot[];
}

export type PracticePaperCourseState =
  /** F4.11: "the affordance is absent" — never present with a reason when nothing is ahead. */
  | { readonly kind: 'no-assessment-ahead'; readonly course: string }
  /** Present, with a reason (`copy.ts`'s `buildLockedCopy`) — see that function's doc for the F8.3 gap this composition cannot yet fill honestly. */
  | {
      readonly kind: 'locked';
      readonly course: string;
      readonly daysUntilNearest: number;
      readonly nearestAssessmentDue: string;
    }
  /** Unlocked, not yet pulled — she has not yet invoked the one affordance. */
  | { readonly kind: 'unlocked-not-pulled'; readonly course: string }
  /** F7.8's grey-out: unlocked, but no Worker configured to generate items with. */
  | { readonly kind: 'ai-unavailable'; readonly course: string }
  /** The assignments Base itself is not configured — same precondition every other course-scoped screen in this plugin already gates on. */
  | { readonly kind: 'assignments-not-configured' }
  | PracticePaperReadyState;

export interface CreateLocalPracticePaperProviderDeps {
  readonly vault: VaultSource;
  readonly settingsStore: { load(): Promise<PersistedStudyPlanConfig> };
  readonly generationPort: () => Promise<PaperItemGenerationPort | null>;
  readonly now: () => Date;
}

function isoToday(now: Date): string {
  return now.toISOString().slice(0, 10);
}

/** Reads real assignments-table records for `course` and evaluates the unlock rule against them (`unlock.ts`). */
async function loadCourseState(
  deps: CreateLocalPracticePaperProviderDeps,
  course: string,
): Promise<PracticePaperCourseState> {
  const config = await deps.settingsStore.load();
  if (!isStudyPlanConfigured(config)) return { kind: 'assignments-not-configured' };

  const { records } = await readAssessments(deps.vault, config.assignmentsBasePath);
  const courseAssessments = records.filter((record) => record.course === course);
  const asOf = isoToday(deps.now());

  const unlock = evaluatePracticePaperUnlockForCourse(
    asOf,
    courseAssessments
      .filter((record) => record.type !== undefined && record.due !== undefined)
      .map((record) => ({ type: record.type as string, due: record.due as string })),
  );

  if (unlock.nearestAssessment === null) return { kind: 'no-assessment-ahead', course };
  if (!unlock.fires) {
    return {
      kind: 'locked',
      course,
      daysUntilNearest: unlock.daysUntilNearest ?? 0,
      nearestAssessmentDue: unlock.nearestAssessment.due,
    };
  }
  return { kind: 'unlocked-not-pulled', course };
}

/**
 * Pure: `PaperRecord` → the view's ready-state, including ruling 4's face statement. Pulled out of
 * `requestPaper` so it is directly testable against a hand-built `PaperRecord` — see
 * `test/paper/provider.spec.ts`'s "face states the gap" scenarios, which construct a record with
 * `compositionAccount.unbuiltDemand` set rather than driving the whole vault/Worker pipeline to
 * reach one (this composition's own `structure: null` default means a REAL course can never reach
 * `unbuiltDemand !== null` today — see `assemble.ts`'s module doc — so this is the only way to
 * exercise the render honestly until a real past-paper structure reader exists).
 */
export function buildReadyStateFromRecord(
  course: string,
  record: PaperRecord,
): PracticePaperReadyState {
  const partialStatement =
    record.compositionAccount.unbuiltDemand === null
      ? null
      : buildPartialPaperStatement(
          record.compositionAccount.unbuiltDemand.demand,
          record.compositionAccount.unbuiltDemand.pointerSourceRefs,
        );

  return {
    kind: 'ready',
    course,
    record,
    partial: record.compositionAccount.partial,
    partialStatement,
    items: record.items.map((item) => ({
      slotId: item.slotId,
      conceptName: item.conceptName,
      intendedDemand: item.intendedDemand,
      groundingLabel: item.groundingLabel,
      response: item.response,
    })),
    emptySlots: record.emptySlots,
  };
}

export interface PracticePaperViewDeps {
  /** Loads the CURRENT state for `course` — locked/unlocked/absent, never a composed paper (that only happens on `requestPaper`, F4.11 ruling 5: "she pulls it"). */
  readonly load: (course: string) => Promise<PracticePaperCourseState>;
  /** Composes and persists a fresh paper for `course`. Never called unless `load` already returned `unlocked-not-pulled` — the view's own job, not this provider's, mirroring every other command-gated affordance in this plugin. */
  readonly requestPaper: (
    course: string,
  ) => Promise<
    PracticePaperReadyState | { readonly kind: 'ai-unavailable'; readonly course: string }
  >;
}

/** The production `PracticePaperViewDeps` — see the module doc. */
export function createLocalPracticePaperProvider(
  deps: CreateLocalPracticePaperProviderDeps,
): PracticePaperViewDeps {
  return {
    load: (course) => loadCourseState(deps, course),

    async requestPaper(course) {
      const port = await deps.generationPort();
      if (port === null) return { kind: 'ai-unavailable', course };

      const config = await deps.settingsStore.load();
      const asOf = isoToday(deps.now());
      const [{ records }, enumeration] = await Promise.all([
        readAssessments(deps.vault, config.assignmentsBasePath),
        enumerateVaultInstruments(deps.vault),
      ]);

      const input = await buildBlueprintInputForCourse(
        deps.vault,
        enumeration.concepts,
        records,
        course,
        asOf,
      );
      const blueprint = buildPaperBlueprint(input);
      const filled = await fillPaperBlueprintSlots(blueprint, port);

      const record = await createPaper(deps.vault, {
        course,
        asOf,
        compositionAccount: paperCompositionAccountFromBlueprint(blueprint),
        items: filled.items,
        emptySlots: filled.emptySlots,
      });

      return buildReadyStateFromRecord(course, record);
    },
  };
}
