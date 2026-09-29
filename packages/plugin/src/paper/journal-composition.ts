/**
 * `composePaperThroughJournal` — composes one practice paper through its resumable journal
 * (`[D-430]`, ruled 2026-09-29, decision sheet row 17; `ol-egov.141.89.7.5`).
 *
 * `provider.ts`'s `requestPaper` used to fill the blueprint in one pass through the flat
 * `fillPaperBlueprintSlots`: a service outage part-way through failed the whole request, threw away
 * the slots already paid for, and the next request began again. This composition puts core's journal
 * (`olea-core`'s `oracle/paper-journal.ts`) between the blueprint and the paper:
 *
 * 1. **Plan.** The blueprint's filled slots, in order, become the journal's plan (the flat blueprint
 *    states no dependency between slots, so none is recorded), and the four reuse inputs become its
 *    fingerprint (below). `openPaperJournal` resumes the course's open journal when all four agree,
 *    and discards it, naming the components that changed, when any one does.
 * 2. **Run.** `runPaperJournal` drafts only what the journal still owes, recording each slot as it
 *    lands. A slot that stays unavailable after its one retry is OWED, never an empty reason, and the
 *    run stops there (an outage rarely ends mid-run).
 * 3. **Finish, or keep.** A journal with nothing owed is finished into the paper, once, with its
 *    completion classified: complete, or an explicitly qualified partial (a source or capability
 *    gap). A journal with work owed hands nothing over and is kept for the next request. Only a
 *    qualified partial is ever handed over with holes; a paper with holes because the service was
 *    down does not exist.
 *
 * **The three outcomes are read apart, by the port, not the classifier.** The generator is built from
 * `PaperSlotOutcomePort` (`../oracle/paper-item-port.ts`, `createWorkerPaperSlotOutcomePort`), which
 * reads the real Worker envelope and also reads a stamped success carrying no questions as a refusal
 * (`empty-result`), the service's real refusal for these tasks. `classifyPaperSlotWorkerResult`
 * alone does not know that rule: it calls a zero-question success "generated". So this module never
 * calls the classifier; it consumes the port's three outcomes and maps them one to one onto the
 * journal's (`generated`, `refused`, `unavailable`). A port that throws is an outage.
 *
 * **The reuse fingerprint, for a flat blueprint.** The four inputs (`[D-430]`: "compatible source
 * versions, scope, structure and authoring specifications, not merely unchanged course settings"):
 *
 * - *source versions*: for each filled slot, the held source it grounds in and a digest of the
 *   chunks actually sent (her note's text as it stood), so an edited note is a changed source;
 * - *scope*: the eligible concept keys and the declared Outcomes with their concepts;
 * - *structure*: the slot plan (slot id, concept, task, in order). No structure has been read from a
 *   past paper on this path (`assemble.ts`: `structure: null`), so the structured shape is the
 *   degenerate one (`structureBasis: 'none-read'`, no sections, groups or parts) and is used for the
 *   digest only: it is never persisted on the paper (`PaperRecord.structure` stays absent, which
 *   says "no structured reading", not "empty"). The structured blueprint builder
 *   (`ol-egov.141.89.7.4`) replaces it with the real shape;
 * - *authoring specification*: purpose, extent, emphasis, weighting, format class, generator tasks.
 *
 * The day the paper is asked for is deliberately NOT an input: an unchanged paper asked for again
 * tomorrow resumes; a paper whose slots changed does not.
 *
 * **Nothing here is student-visible.** No wording, no state the view renders. An unfinished result is
 * data (counts and a journal id, no reason text and no content, D-005) for the caller to act on.
 */

import {
  DEFAULT_PAPER_PURPOSE,
  hashText,
  type PaperBlueprint,
  type PaperBlueprintSlot,
  type PaperGeneratedItem,
  type PaperRecord,
  type PaperStoreOptions,
  paperCompositionAccountFromBlueprint,
  type VaultSource,
} from 'olea-core';
import {
  finalizePaperFromJournal,
  openPaperJournal,
  type PaperJournalOpenDecision,
  type PaperJournalPlanSlot,
  type PaperSlotGenerator,
  paperJournalOwedSlotIds,
  runPaperJournal,
} from 'olea-core/src/oracle/paper-journal.js';
import { paperReuseFingerprint } from 'olea-core/src/oracle/paper-structure.js';
import {
  PAPER_STRUCTURE_FORMAT_VERSION,
  type PaperStructuredShape,
} from 'olea-core/src/oracle/paper-types.js';
import type { PaperItemPortOutcome, PaperSlotOutcomePort } from '../oracle/paper-item-port.js';

/** The scope the paper was composed over: what the fingerprint's `scope` component digests. */
export interface PaperCompositionScope {
  readonly eligibleConceptKeys: readonly string[];
  readonly outcomes: readonly {
    readonly outcomeId: string;
    readonly conceptKeys: readonly string[];
  }[];
}

export interface ComposePaperThroughJournalInput {
  readonly vault: VaultSource;
  readonly blueprint: PaperBlueprint;
  readonly scope: PaperCompositionScope;
  /** The three-outcome port. Never the flat adapter: an outage must reach the journal as an outage. */
  readonly port: PaperSlotOutcomePort;
  /** Injectable for deterministic tests (`now`, `generateId`). */
  readonly options?: PaperStoreOptions;
}

export type ComposePaperThroughJournalResult =
  /** Every slot landed or ended empty: the paper exists, complete or an explicitly qualified partial. */
  | {
      readonly kind: 'finished';
      readonly record: PaperRecord;
      readonly resume: PaperJournalOpenDecision;
    }
  /**
   * Work is owed, so no paper was created. `'service-unavailable'`: a slot stayed unavailable after
   * its one retry (an outage); the journal is kept and the next request resumes it.
   * `'authoring-spec-changed'`: a resumed slot came back under a different prompt version than the
   * landed items, so the journal was set aside; the next request starts afresh. Counts and an id only.
   */
  | {
      readonly kind: 'unfinished';
      readonly reason: 'service-unavailable' | 'authoring-spec-changed';
      readonly journalId: string;
      readonly plannedSlotCount: number;
      readonly owedSlotCount: number;
      readonly resume: PaperJournalOpenDecision;
    };

/**
 * The degenerate structured shape of a paper composed from a flat blueprint: no structure was read,
 * so there are no sections, groups or parts. Used for the reuse digest only (module doc).
 */
function flatStructureShape(blueprint: PaperBlueprint): PaperStructuredShape {
  return {
    formatVersion: PAPER_STRUCTURE_FORMAT_VERSION,
    structureBasis: 'none-read',
    structureSlotCount: blueprint.slots.length + blueprint.emptySlots.length,
    sections: [],
    groups: [],
    parts: [],
    totalMarks: { status: 'unknown' },
    timeAllowance: { status: 'unknown' },
  };
}

async function sourceVersionsOf(
  blueprint: PaperBlueprint,
): Promise<readonly { readonly sourceId: string; readonly revisionDigest: string }[]> {
  const seen = new Set<string>();
  const out: { sourceId: string; revisionDigest: string }[] = [];
  for (const slot of blueprint.slots) {
    const sourceId = slot.heldSourceId ?? `concept:${slot.conceptKey}`;
    const revisionDigest = await hashText(JSON.stringify(slot.sourceChunks));
    const key = `${sourceId}\u0000${revisionDigest}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ sourceId, revisionDigest });
  }
  return out;
}

function planOf(blueprint: PaperBlueprint): readonly PaperJournalPlanSlot[] {
  return blueprint.slots.map((slot) => ({
    slotId: slot.slotId,
    conceptKey: slot.conceptKey,
    conceptName: slot.conceptName,
    taskId: slot.taskId,
    dependsOnSlotIds: [],
  }));
}

/** The generated item, built exactly as `fillPaperBlueprintSlots` builds it (parity is pinned by `journal-composition.spec.ts`). */
function itemFrom(
  slot: PaperBlueprintSlot,
  generated: Extract<PaperItemPortOutcome, { readonly status: 'generated' }>,
): PaperGeneratedItem {
  return {
    slotId: slot.slotId,
    conceptKey: slot.conceptKey,
    conceptName: slot.conceptName,
    ...(slot.outcomeId !== undefined ? { outcomeId: slot.outcomeId } : {}),
    taskId: generated.taskId,
    promptVersion: generated.promptVersion,
    intendedDemand: slot.intendedDemand,
    groundingTier: slot.groundingTier,
    groundingLabel: slot.groundingLabel,
    heldSourceKind: slot.heldSourceKind,
    heldSourceId: slot.heldSourceId,
    response: generated.response,
  };
}

/** The journal's generator over the three-outcome port: one call per slot, the outcomes mapped one to one. */
function slotGeneratorOver(
  blueprint: PaperBlueprint,
  port: PaperSlotOutcomePort,
): PaperSlotGenerator {
  const bySlotId = new Map(blueprint.slots.map((slot) => [slot.slotId, slot]));
  return async ({ slot }) => {
    const planned = bySlotId.get(slot.slotId);
    if (planned === undefined) return { status: 'unavailable', reason: 'slot-not-in-blueprint' };
    const outcome = await port({
      taskId: planned.taskId,
      courseCode: blueprint.course,
      conceptName: planned.conceptName,
      sourceChunks: planned.sourceChunks,
      purpose: 'readiness',
    });
    if (outcome.status === 'generated') {
      return { status: 'generated', item: itemFrom(planned, outcome) };
    }
    return outcome;
  };
}

export async function composePaperThroughJournal(
  input: ComposePaperThroughJournalInput,
): Promise<ComposePaperThroughJournalResult> {
  const { vault, blueprint, scope, port } = input;
  const options = input.options ?? {};
  const plan = planOf(blueprint);

  const fingerprint = await paperReuseFingerprint({
    sourceVersions: await sourceVersionsOf(blueprint),
    scope: {
      eligibleConceptKeys: scope.eligibleConceptKeys,
      outcomes: scope.outcomes,
    },
    structure: {
      shape: flatStructureShape(blueprint),
      slotPlan: plan.map(({ slotId, conceptKey, taskId }) => ({ slotId, conceptKey, taskId })),
    },
    authoringSpec: {
      purpose: blueprint.purpose ?? DEFAULT_PAPER_PURPOSE,
      extent: blueprint.steering.extent ?? null,
      emphasis: blueprint.steering.emphasis ?? null,
      alpha: blueprint.alpha,
      formatClass: blueprint.formatClass,
      generatorTasks: blueprint.slots.map((slot) => slot.taskId),
    },
  });

  const opened = await openPaperJournal(
    vault,
    { course: blueprint.course, fingerprint, plan },
    options,
  );
  const journalId = opened.journal.id;
  const run = await runPaperJournal(
    vault,
    journalId,
    { generate: slotGeneratorOver(blueprint, port) },
    options,
  );

  if (run.kind === 'ready') {
    const record = await finalizePaperFromJournal(
      vault,
      journalId,
      {
        asOf: blueprint.asOf,
        compositionAccount: paperCompositionAccountFromBlueprint(blueprint),
        planTimeEmptySlots: blueprint.emptySlots,
      },
      options,
    );
    return { kind: 'finished', record, resume: opened.decision };
  }
  return {
    kind: 'unfinished',
    reason: run.kind === 'unfinished' ? 'service-unavailable' : 'authoring-spec-changed',
    journalId,
    plannedSlotCount: plan.length,
    owedSlotCount: paperJournalOwedSlotIds(run.journal).length,
    resume: opened.decision,
  };
}
