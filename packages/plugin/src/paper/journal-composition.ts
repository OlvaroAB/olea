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
 * - *structure*: the slot plan (slot id, concept, task, in order). The flat blueprint carries no
 *   structured shape (a past-paper reading sets only its length, `assemble.ts`), so the structured
 *   shape is the degenerate one (`structureBasis: 'none-read'`, no sections, groups or parts) and
 *   is used for the digest only: it is never persisted on the paper (`PaperRecord.structure` stays
 *   absent, which says "no structured reading", not "empty"). The structured blueprint builder
 *   (`ol-egov.141.89.7.4`) replaces it with the real shape;
 * - *authoring specification*: purpose, extent, emphasis, weighting, format class, generator tasks.
 *
 * The day the paper is asked for is deliberately NOT an input: an unchanged paper asked for again
 * tomorrow resumes; a paper whose slots changed does not.
 *
 * **An unfinished paper resumes on the plan it started with (`[D-548]`, `ol-egov.141.89.7.87`).**
 * The paper's length follows her stored past-paper reading, so a reading that arrives, is replaced
 * or goes away while a paper is unfinished would change the slot plan, and with it every component
 * the plan feeds (the structure digest, the generator tasks, the sources of slots added or
 * dropped). That is not a change to that paper: its structure is its own recorded plan, at its own
 * recorded length (David's ruling: "a paper she left unfinished picks up where it stopped, on the
 * plan it started with"). So each journal records the length its plan was made at (`olea-core`'s
 * `PaperJournalExtent`), and when the course's open journal was made at another length, the
 * composition is planned again at that recorded length (`ComposePaperThroughJournalInput.extent`)
 * and compared with it there:
 *
 * - all four components and the plan agree: the paper resumes on that plan, its plan-time empty
 *   slots and its composition account's reading summary are the ones it started with, nothing
 *   already written is drafted again, and no changed-material sentence is owed;
 * - something else changed (her sources, the scope, the authoring): the journal is set aside naming
 *   exactly what changed at its own length, never the reading, and the fresh paper takes the new
 *   length.
 *
 * A journal opened before the length was recorded was planned with no past-paper reading
 * (`assemble.ts` passed none until `[D-548]`), so its recorded length is the declared one for its
 * extent. The new length applies from the next new paper.
 *
 * **Nothing here is student-visible.** No wording, no state the view renders. An unfinished result is
 * data (counts and a journal id, no reason text and no content, D-005) for the caller to act on.
 */

import {
  canonicalJson,
  comparePaperReuseFingerprints,
  DEFAULT_PAPER_PURPOSE,
  discardPaperJournal,
  extentSlotCountTarget,
  finalizePaperFromJournal,
  hashText,
  listPaperJournals,
  openPaperJournal,
  PAPER_STRUCTURE_FORMAT_VERSION,
  type PaperBlueprint,
  type PaperBlueprintSlot,
  type PaperGeneratedItem,
  type PaperJournalOpenDecision,
  type PaperJournalPlanSlot,
  type PaperJournalRecord,
  type PaperRecord,
  type PaperReuseFingerprint,
  type PaperSlotGenerator,
  type PaperStoreOptions,
  type PaperStructuredShape,
  paperCompositionAccountFromBlueprint,
  paperJournalOwedSlotIds,
  paperReuseFingerprint,
  runPaperJournal,
  type VaultSource,
} from 'olea-core';
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
  /**
   * `[D-548]`: the slot count `blueprint` was planned at, and the same composition planned at
   * another slot count (`buildPaperBlueprint` with `slotCount`). With it, a journal this call opens
   * records its length, and an unfinished paper made at another length resumes on its own plan (see
   * the module doc). Omitted: the paper is composed as `blueprint` only and no length is recorded,
   * exactly as before.
   */
  readonly extent?: {
    readonly slotCount: number;
    readonly planAt: (slotCount: number) => PaperBlueprint;
  };
  /** Injectable for deterministic tests (`now`, `generateId`). */
  readonly options?: PaperStoreOptions;
}

type PaperJournalExtent = NonNullable<PaperJournalRecord['extent']>;

type SetAsideJournal = {
  readonly journalId: string;
  readonly changed: readonly (keyof PaperReuseFingerprint)[];
};

export type ComposePaperThroughJournalResult =
  /** Every slot landed or ended empty: the paper exists, complete or an explicitly qualified partial. */
  | {
      readonly kind: 'finished';
      readonly record: PaperRecord;
      readonly resume: PaperJournalOpenDecision;
      /** `[D-532]`: saved progress was discarded because her sources or the course's scope changed (never for a change to Olea's own authoring settings alone). */
      readonly materialChanged: boolean;
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

/** The four reuse inputs of one planned composition (module doc). */
async function fingerprintOf(
  blueprint: PaperBlueprint,
  scope: PaperCompositionScope,
  plan: readonly PaperJournalPlanSlot[],
): Promise<PaperReuseFingerprint> {
  return paperReuseFingerprint({
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
}

/**
 * `[D-548]`: the length a journal's plan was made at. A journal opened before the length was
 * recorded was planned with no past-paper reading, so its length is the declared one for the extent
 * (module doc); an extent that changed since is an authoring change the reuse check names anyway.
 */
function recordedExtentOf(
  journal: PaperJournalRecord,
  blueprint: PaperBlueprint,
): PaperJournalExtent {
  return (
    journal.extent ?? {
      slotCount: extentSlotCountTarget(blueprint.steering.extent, null),
      structureSummary: null,
    }
  );
}

/** The course's open journal `openPaperJournal` would try first: the most recently updated. */
async function latestOpenJournal(
  vault: VaultSource,
  course: string,
): Promise<PaperJournalRecord | undefined> {
  return (await listPaperJournals(vault))
    .map((entry) => entry.record)
    .filter((record) => record.course === course && record.status === 'open')
    .sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : a.updatedAt > b.updatedAt ? -1 : 0))[0];
}

/**
 * `[D-548]`: which composition this request runs. When the course's open journal was made at
 * another length, the composition is planned again at that length and compared with it there: a
 * match resumes the paper on its own plan; a mismatch sets the journal aside naming what changed at
 * its own length, and the request runs the new composition. Otherwise, the new composition, as
 * before.
 */
async function compositionForRequest(
  input: ComposePaperThroughJournalInput,
  options: PaperStoreOptions,
): Promise<{
  readonly blueprint: PaperBlueprint;
  readonly extent: PaperJournalExtent | undefined;
  readonly setAside: readonly SetAsideJournal[];
}> {
  const { vault, blueprint, scope } = input;
  if (input.extent === undefined) return { blueprint, extent: undefined, setAside: [] };
  const extent: PaperJournalExtent = {
    slotCount: input.extent.slotCount,
    structureSummary: blueprint.structureSummary,
  };
  const open = await latestOpenJournal(vault, blueprint.course);
  if (open === undefined) return { blueprint, extent, setAside: [] };
  const recorded = recordedExtentOf(open, blueprint);
  if (recorded.slotCount === extent.slotCount) return { blueprint, extent, setAside: [] };

  const startedOn = input.extent.planAt(recorded.slotCount);
  const startedPlan = planOf(startedOn);
  const comparison = comparePaperReuseFingerprints(
    open.fingerprint,
    await fingerprintOf(startedOn, scope, startedPlan),
  );
  const samePlan = canonicalJson(open.plan) === canonicalJson(startedPlan);
  if (comparison.compatible && samePlan) {
    return { blueprint: startedOn, extent: recorded, setAside: [] };
  }
  // The same rule `openPaperJournal` applies: a matching fingerprint over a different plan is named
  // a structure change rather than trusted.
  const changed: readonly (keyof PaperReuseFingerprint)[] = comparison.compatible
    ? ['structure']
    : comparison.changed;
  await discardPaperJournal(vault, open.id, { reason: 'reuse-incompatible', changed }, options);
  return { blueprint, extent, setAside: [{ journalId: open.id, changed }] };
}

export async function composePaperThroughJournal(
  input: ComposePaperThroughJournalInput,
): Promise<ComposePaperThroughJournalResult> {
  const { vault, scope, port } = input;
  const options = input.options ?? {};
  const composition = await compositionForRequest(input, options);
  const { blueprint, extent } = composition;
  const plan = planOf(blueprint);
  const fingerprint = await fingerprintOf(blueprint, scope, plan);

  const opened = await openPaperJournal(
    vault,
    { course: blueprint.course, fingerprint, plan, ...(extent !== undefined ? { extent } : {}) },
    options,
  );
  const journalId = opened.journal.id;
  const discarded = [...composition.setAside, ...(opened.discarded ?? [])];
  const decision: PaperJournalOpenDecision =
    opened.decision === 'fresh' && composition.setAside.length > 0
      ? 'discarded-and-fresh'
      : opened.decision;
  // `[D-532]`: only a discard that names her sources or the scope is "her material changed".
  // And only when the set-aside journal held at least one landed slot: no landed slot, no saved progress.
  const materialDiscards = discarded.filter((d) =>
    d.changed.some((part) => part === 'sourceVersions' || part === 'scope'),
  );
  let materialChanged = false;
  if (materialDiscards.length > 0) {
    const journals = await listPaperJournals(vault);
    materialChanged = materialDiscards.some((d) =>
      Object.values(journals.find((j) => j.record.id === d.journalId)?.record.outcomes ?? {}).some(
        (outcome) => outcome.status === 'landed',
      ),
    );
  }
  const run = await runPaperJournal(
    vault,
    journalId,
    { generate: slotGeneratorOver(blueprint, port) },
    options,
  );

  if (run.kind === 'ready') {
    // `[D-548]`: a resumed paper states the past-paper readings its plan was made from, not the
    // ones held now (a journal recorded before the length was had none).
    const account = paperCompositionAccountFromBlueprint(blueprint);
    const record = await finalizePaperFromJournal(
      vault,
      journalId,
      {
        asOf: blueprint.asOf,
        compositionAccount:
          input.extent !== undefined && opened.decision === 'resumed'
            ? {
                ...account,
                structureSummary: recordedExtentOf(opened.journal, blueprint).structureSummary,
              }
            : account,
        planTimeEmptySlots: blueprint.emptySlots,
      },
      options,
    );
    return { kind: 'finished', record, resume: decision, materialChanged };
  }
  return {
    kind: 'unfinished',
    reason: run.kind === 'unfinished' ? 'service-unavailable' : 'authoring-spec-changed',
    journalId,
    plannedSlotCount: plan.length,
    owedSlotCount: paperJournalOwedSlotIds(run.journal).length,
    resume: decision,
  };
}
