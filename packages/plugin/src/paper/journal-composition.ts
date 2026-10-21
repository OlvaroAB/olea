/**
 * `composePaperThroughJournal` — composes one practice paper through its resumable journal
 * (`[D-430]`, ruled 2026-09-29, decision sheet row 17; `ol-egov.141.89.7.5`), in its structured
 * form when her stored past-paper reading carries groups and parts (`[D-559]`, `[D-560]`,
 * `[D-561]`, `[D-562]`; `ol-egov.141.89.7.93`).
 *
 * `provider.ts`'s `requestPaper` used to fill the blueprint in one pass through the flat
 * `fillPaperBlueprintSlots`: a service outage part-way through failed the whole request, threw away
 * the slots already paid for, and the next request began again. This composition puts core's journal
 * (`olea-core`'s `oracle/paper-journal.ts`) between the blueprint and the paper:
 *
 * 1. **Plan.** The composition becomes the journal's plan and the four reuse inputs its fingerprint
 *    (below). A flat composition's plan is the blueprint's filled slots in order, with no dependency
 *    between them. A structured one's is its parts in dependency order (next section).
 *    `openPaperJournal` resumes the course's open journal when all four agree, and discards it,
 *    naming the components that changed, when any one does.
 * 2. **Run.** `runPaperJournal` drafts only what the journal still owes, recording each slot as it
 *    lands. A slot that stays unavailable after its one retry is OWED, never an empty reason, and the
 *    run stops there (an outage rarely ends mid-run).
 * 3. **Finish, or keep.** A journal with nothing owed is finished into the paper, once, with its
 *    completion classified: complete, or an explicitly qualified partial (a source or capability
 *    gap). A journal with work owed hands nothing over and is kept for the next request. Only a
 *    qualified partial is ever handed over with holes; a paper with holes because the service was
 *    down does not exist.
 *
 * **The structured form (`[D-559]`).** When the provider passes her stored reading's groups and
 * parts (`ComposePaperThroughJournalInput.template`, `olea-core`'s `PaperStructureTemplate`) and the
 * composition can be planned at another length (`extent`), the paper takes whole questions of that
 * reading in printed order, as many as the blueprint has candidates for, and the blueprint is planned
 * again at that many slots, so its candidates are exactly the parts (core's
 * `selectPaperTemplateParts`, `buildStructuredPaperShape` and `planStructuredPaper`, whose module
 * section states the part-to-slot rule). Then:
 *
 * - parts are written in dependency order, and a part whose stated dependency is empty before any
 *   call ends `depends-on-empty-part` and is never requested (a dependency that ends empty while
 *   being written is the journal's to propagate, the same way);
 * - a group whose template shares material is asked of the stimulus lookup
 *   (`ComposePaperThroughJournalInput.stimulusLookup`, `[D-562]`). A held passage is recorded on the
 *   group by source and chunk, and its text travels with each of the group's parts' requests
 *   (`sharedPassage`). A group the lookup found nothing for ends empty, `no-held-stimulus`. A group
 *   it did not look for (the default, until `ol-egov.141.89.7.98`'s lookup is wired) is written
 *   without shared material and is never given that reason;
 * - a dependent part's request carries the earlier parts' questions and answers (`earlierParts`,
 *   `[D-561]`), read off their landed items; a part with no stated dependency carries no such key;
 * - the finished paper records the structure (`PaperRecord.structure`, schema version 2), and its
 *   omitted parts read through the ruled sentences already on the view (`[D-457]`, `[D-519]`).
 *
 * A reading with no groups or parts, a template no question of which fits, or a template that does
 * not hold together composes the flat paper exactly as before. Neither request field is on the wire
 * yet: the port's payload (`../oracle/paper-item-port.ts`) leaves both out until the contract field
 * (`ol-egov.141.89.7.97`) is merged.
 *
 * **The three outcomes are read apart, by the port, not the classifier.** The generator is built from
 * `PaperSlotOutcomePort` (`../oracle/paper-item-port.ts`, `createWorkerPaperSlotOutcomePort`), which
 * reads the real Worker envelope and also reads a stamped success carrying no questions as a refusal
 * (`empty-result`), the service's real refusal for these tasks. `classifyPaperSlotWorkerResult`
 * alone does not know that rule: it calls a zero-question success "generated". So this module never
 * calls the classifier; it consumes the port's three outcomes and maps them one to one onto the
 * journal's (`generated`, `refused`, `unavailable`). A port that throws is an outage.
 *
 * **The reuse fingerprint.** The four inputs (`[D-430]`: "compatible source versions, scope,
 * structure and authoring specifications, not merely unchanged course settings"):
 *
 * - *source versions*: for each slot the plan writes, the held source it grounds in and a digest of
 *   the chunks actually sent (her note's text as it stood), so an edited note is a changed source;
 *   and for each group given a shared passage, that passage's source and a digest of its text. Never
 *   the past-paper reading the structure was shaped on (`[D-560]`, below);
 * - *scope*: the eligible concept keys and the declared Outcomes with their concepts;
 * - *structure*: the structured shape (for a flat paper, the degenerate one: `structureBasis:
 *   'none-read'`, no sections, groups or parts, used for the digest only and never persisted) and
 *   the slot plan (slot id, concept, task, in order);
 * - *authoring specification*: purpose, extent, emphasis, weighting, format class, generator tasks.
 *
 * The day the paper is asked for is deliberately NOT an input: an unchanged paper asked for again
 * tomorrow resumes; a paper whose slots changed does not.
 *
 * **An unfinished paper resumes on what it started with (`[D-548]`, `[D-560]`).** The paper's length
 * and, now, its structure follow her stored past-paper reading, so a reading that arrives, is
 * replaced or goes away while a paper is unfinished would change the slot plan and every component
 * the plan feeds. That is not a change to that paper (David's rulings: "a paper she left unfinished
 * picks up where it stopped, on the plan it started with"; "an unfinished paper always resumes on
 * its own structure, even if her past-paper reading changes. An old journal reads as flat and
 * resumes flat"). So each journal records the length its plan was made at (`PaperJournalExtent`)
 * and, for a structured paper, the structure (journal version 2). When the course's open journal was
 * made at another length, or on another structure (a recorded one where the request would compose
 * another, or flat where the request would now be structured), the composition is planned again as
 * the journal recorded it and compared with it there:
 *
 * - all four components and the plan agree: the paper resumes on that plan and structure, its
 *   plan-time empty slots and its composition account's reading summary are the ones it started
 *   with, nothing already written is drafted again, and no changed-material sentence is owed;
 * - something else changed (her sources, the scope, the authoring): the journal is set aside naming
 *   exactly what changed, never the reading, and the fresh paper takes the new length and structure.
 *
 * Planned again on a recorded structure, the parts take the recorded slots; a group's recorded held
 * passage is asked of the lookup again and must come back the same (its text then travels again;
 * anything else is a changed source); and which needed groups the lookup found nothing for is read
 * back from the recorded plan (core's `paperNoneHeldGroupIdsFromPlan`), so the journal needs no field
 * beyond its structure. A journal opened before the length was recorded was planned with no
 * past-paper reading, so its recorded length is the declared one for its extent; a journal with no
 * recorded structure is flat. `materialChanged` is unchanged: only a discard that names her sources
 * or the scope, of a journal that had something landed.
 *
 * **Nothing here is student-visible.** No wording, no state the view renders. An unfinished result is
 * data (counts and a journal id, no reason text and no content, D-005) for the caller to act on.
 */

import {
  buildStructuredPaperShape,
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
  type PaperEarlierPart,
  type PaperEmptySlot,
  type PaperGeneratedItem,
  type PaperGroupStimulusNeed,
  type PaperHeldStimulus,
  type PaperItemGenerationRequest,
  type PaperJournalOpenDecision,
  type PaperJournalPlanSlot,
  type PaperJournalRecord,
  type PaperRecord,
  type PaperReuseFingerprint,
  type PaperSharedPassage,
  type PaperSlotGenerator,
  type PaperStoreOptions,
  type PaperStructuredShape,
  type PaperStructureTemplate,
  paperBlueprintCandidateSlotIds,
  paperCompositionAccountFromBlueprint,
  paperGroupsNeedingStimulus,
  paperItemEarlierPart,
  paperJournalOwedSlotIds,
  paperNoneHeldGroupIdsFromPlan,
  paperReuseFingerprint,
  planStructuredPaper,
  runPaperJournal,
  selectPaperTemplateParts,
  type VaultSource,
  withPaperHeldStimuli,
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

/** `[D-562]`: what the composition asks the stimulus lookup about one group whose template shares material. */
export interface PaperStimulusLookupRequest {
  readonly course: string;
  readonly groupId: string;
  readonly need: Extract<PaperGroupStimulusNeed, { readonly status: 'needed' }>;
  /** The concepts of every part in the group (nested groups included), in printed order: keys only. */
  readonly conceptKeys: readonly string[];
}

/**
 * `[D-562]`: the lookup's answer for one group — one passage from her held, non-sealed material
 * (`stimulus` by source and chunk, and that chunk's `text` as she wrote it), none found, or not
 * looked for. The same three outcomes as `olea-core`'s stimulus lookup (`ol-egov.141.89.7.98`),
 * with the text the request needs beside a held one.
 */
export type PaperStimulusLookupOutcome =
  | { readonly status: 'held'; readonly stimulus: PaperHeldStimulus; readonly text: string }
  | { readonly status: 'none-held' }
  | { readonly status: 'not-looked'; readonly reason?: string };

export type PaperStimulusLookup = (
  request: PaperStimulusLookupRequest,
) => Promise<PaperStimulusLookupOutcome>;

/** The default lookup: it never looks, so a group that shares material is written without it and is never `no-held-stimulus`. */
export const PAPER_STIMULUS_NOT_LOOKED: PaperStimulusLookup = async () => ({
  status: 'not-looked',
});

export interface ComposePaperThroughJournalInput {
  readonly vault: VaultSource;
  readonly blueprint: PaperBlueprint;
  readonly scope: PaperCompositionScope;
  /** The three-outcome port. Never the flat adapter: an outage must reach the journal as an outage. */
  readonly port: PaperSlotOutcomePort;
  /**
   * `[D-548]`: the slot count `blueprint` was planned at, and the same composition planned at
   * another slot count (`buildPaperBlueprint` with `slotCount`). With it, a journal this call opens
   * records its length, and an unfinished paper made at another length or structure resumes on its
   * own (see the module doc). Omitted: the paper is composed flat as `blueprint` only and no length
   * is recorded, exactly as before.
   */
  readonly extent?: {
    readonly slotCount: number;
    readonly planAt: (slotCount: number) => PaperBlueprint;
  };
  /** `[D-559]`: her stored reading's groups and parts (`PaperRecoveredStructure.template`). Absent or `null`: the flat paper. Read only with `extent`. */
  readonly template?: PaperStructureTemplate | null;
  /** `[D-562]`: the shared-material lookup. Omitted: {@link PAPER_STIMULUS_NOT_LOOKED}. */
  readonly stimulusLookup?: PaperStimulusLookup;
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

/** One composition, ready for the journal: what is written, what is empty before any call, and the structure (absent for a flat paper). */
interface PlannedComposition {
  readonly blueprint: PaperBlueprint;
  readonly plan: readonly PaperJournalPlanSlot[];
  readonly planTimeEmptySlots: readonly PaperEmptySlot[];
  readonly structure: PaperStructuredShape | undefined;
  /** `[D-562]`: each held passage's text, by the slot of every part it travels with. */
  readonly passageBySlot: ReadonlyMap<string, PaperSharedPassage>;
  /** `[D-562]`: each held passage's digest input, by group (her text, digested, never stored). */
  readonly passageVersions: readonly { readonly sourceId: string; readonly text: string | null }[];
  /** `[D-548]`: the length a journal this composition opens records; absent without `extent`. */
  readonly extent: PaperJournalExtent | undefined;
}

/**
 * The degenerate structured shape of a paper composed from a flat blueprint: no structure was read,
 * so there are no sections, groups or parts. Used for the reuse digest only (module doc). Unchanged
 * since `[D-430]`: every flat journal's structure digest was computed from exactly this.
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
  slots: readonly PaperBlueprintSlot[],
  passages: PlannedComposition['passageVersions'],
): Promise<readonly { readonly sourceId: string; readonly revisionDigest: string }[]> {
  const seen = new Set<string>();
  const out: { sourceId: string; revisionDigest: string }[] = [];
  const add = (sourceId: string, revisionDigest: string): void => {
    const key = `${sourceId}\u0000${revisionDigest}`;
    if (seen.has(key)) return;
    seen.add(key);
    out.push({ sourceId, revisionDigest });
  };
  for (const slot of slots) {
    add(
      slot.heldSourceId ?? `concept:${slot.conceptKey}`,
      await hashText(JSON.stringify(slot.sourceChunks)),
    );
  }
  for (const passage of passages) {
    add(passage.sourceId, await hashText(JSON.stringify(passage.text)));
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

/** The flat composition, exactly as before `[D-559]`. */
function flatComposition(
  blueprint: PaperBlueprint,
  extent: PaperJournalExtent | undefined,
): PlannedComposition {
  return {
    blueprint,
    plan: planOf(blueprint),
    planTimeEmptySlots: blueprint.emptySlots,
    structure: undefined,
    passageBySlot: new Map(),
    passageVersions: [],
    extent,
  };
}

/** A held passage as the request carries it: a figure never travels, its content not being text, and a blank chunk is no passage. */
function sharedPassageOf(stimulus: PaperHeldStimulus, text: string): PaperSharedPassage | null {
  if (stimulus.form === 'figure' || text.trim().length === 0) return null;
  return { form: stimulus.form, text };
}

const sameStimulus = (a: PaperHeldStimulus, b: PaperHeldStimulus): boolean =>
  a.form === b.form && a.sourceId === b.sourceId && a.chunkIndex === b.chunkIndex;

/** One lookup call; a lookup that throws has not looked, which is never read as finding none. */
async function askLookup(
  lookup: PaperStimulusLookup,
  request: PaperStimulusLookupRequest,
): Promise<PaperStimulusLookupOutcome> {
  try {
    return await lookup(request);
  } catch {
    return { status: 'not-looked' };
  }
}

/** Every slot of `shape`'s parts that sits under a group with a held passage, mapped to the nearest such passage. */
function passagesBySlot(
  shape: PaperStructuredShape,
  passageByGroup: ReadonlyMap<string, PaperSharedPassage>,
): ReadonlyMap<string, PaperSharedPassage> {
  const groupById = new Map(shape.groups.map((g) => [g.groupId, g] as const));
  const out = new Map<string, PaperSharedPassage>();
  for (const part of shape.parts) {
    const seen = new Set<string>();
    let at = groupById.get(part.groupId);
    while (at !== undefined && !seen.has(at.groupId)) {
      const passage = passageByGroup.get(at.groupId);
      if (passage !== undefined) {
        out.set(part.slotId, passage);
        break;
      }
      seen.add(at.groupId);
      at = at.parentGroupId === undefined ? undefined : groupById.get(at.parentGroupId);
    }
  }
  return out;
}

function conceptKeysOf(blueprint: PaperBlueprint, slotIds: readonly string[]): readonly string[] {
  const conceptBySlot = new Map(
    [...blueprint.slots, ...blueprint.emptySlots].map((s) => [s.slotId, s.conceptKey] as const),
  );
  return slotIds.flatMap((id) => {
    const key = conceptBySlot.get(id);
    return key === undefined ? [] : [key];
  });
}

/**
 * `[D-559]`: the structured composition of a fresh paper, or `null` when the flat one stands (no
 * template, no `extent`, no question that fits, or a template that does not hold together).
 */
async function structuredComposition(
  input: ComposePaperThroughJournalInput,
  lookup: PaperStimulusLookup,
): Promise<PlannedComposition | null> {
  const { template, extent, blueprint } = input;
  if (template === undefined || template === null || extent === undefined) return null;
  const partIds = selectPaperTemplateParts(
    template,
    paperBlueprintCandidateSlotIds(blueprint).length,
  );
  if (partIds.length === 0) return null;
  const planned = extent.planAt(partIds.length);
  const built = buildStructuredPaperShape(
    template,
    partIds,
    paperBlueprintCandidateSlotIds(planned),
  );
  if (built.status !== 'built') return null;

  const held = new Map<string, PaperHeldStimulus>();
  const passageByGroup = new Map<string, PaperSharedPassage>();
  const passageVersions: { sourceId: string; text: string | null }[] = [];
  const noneHeld = new Set<string>();
  for (const group of paperGroupsNeedingStimulus(built.shape)) {
    const outcome = await askLookup(lookup, {
      course: blueprint.course,
      groupId: group.groupId,
      need: { status: 'needed', form: group.form },
      conceptKeys: conceptKeysOf(planned, group.slotIds),
    });
    if (outcome.status === 'none-held') noneHeld.add(group.groupId);
    if (outcome.status !== 'held') continue;
    held.set(group.groupId, outcome.stimulus);
    passageVersions.push({ sourceId: stimulusSourceKey(outcome.stimulus), text: outcome.text });
    const passage = sharedPassageOf(outcome.stimulus, outcome.text);
    if (passage !== null) passageByGroup.set(group.groupId, passage);
  }
  const shape = withPaperHeldStimuli(built.shape, held);
  const structured = planStructuredPaper(planned, shape, noneHeld);
  if (structured === null) return null;
  return {
    blueprint: planned,
    plan: structured.plan,
    planTimeEmptySlots: structured.planTimeEmptySlots,
    structure: shape,
    passageBySlot: passagesBySlot(shape, passageByGroup),
    passageVersions,
    extent: { slotCount: partIds.length, structureSummary: planned.structureSummary },
  };
}

/** The key a held passage's digest is filed under in the fingerprint: its source and chunk, apart from the slots' own sources. */
function stimulusSourceKey(stimulus: PaperHeldStimulus): string {
  return `stimulus:${stimulus.sourceId}#${stimulus.chunkIndex}`;
}

/**
 * `[D-560]`: the composition an open journal was planned as, planned again: at its recorded length,
 * flat or on its recorded structure. `null` when the recorded structure's parts are no longer the
 * candidates of the blueprint planned at that length (fewer concepts are eligible now): the scope
 * changed, and nothing is guessed.
 */
async function recordedComposition(
  input: ComposePaperThroughJournalInput & {
    readonly extent: NonNullable<ComposePaperThroughJournalInput['extent']>;
  },
  journal: PaperJournalRecord,
  recorded: PaperJournalExtent,
  lookup: PaperStimulusLookup,
): Promise<PlannedComposition | null> {
  const startedOn = input.extent.planAt(recorded.slotCount);
  const shape = journal.structure;
  if (shape === undefined) return flatComposition(startedOn, recorded);

  const passageByGroup = new Map<string, PaperSharedPassage>();
  const passageVersions: { sourceId: string; text: string | null }[] = [];
  for (const group of shape.groups) {
    if (group.heldStimulus === null || group.stimulusNeed.status !== 'needed') continue;
    const outcome = await askLookup(lookup, {
      course: startedOn.course,
      groupId: group.groupId,
      need: group.stimulusNeed,
      conceptKeys: conceptKeysOf(
        startedOn,
        paperGroupsNeedingStimulus(shape).find((g) => g.groupId === group.groupId)?.slotIds ?? [],
      ),
    });
    const same = outcome.status === 'held' && sameStimulus(outcome.stimulus, group.heldStimulus);
    // Not the same passage, or none: its text cannot travel again, and the digest says the source changed.
    passageVersions.push({
      sourceId: stimulusSourceKey(group.heldStimulus),
      text: same ? outcome.text : null,
    });
    const passage = same ? sharedPassageOf(group.heldStimulus, outcome.text) : null;
    if (passage !== null) passageByGroup.set(group.groupId, passage);
  }

  const ownEmpty = new Set(startedOn.emptySlots.map((empty) => empty.slotId));
  const noneHeld = paperNoneHeldGroupIdsFromPlan(
    shape,
    new Set(journal.plan.map((slot) => slot.slotId)),
    ownEmpty,
  );
  const structured = planStructuredPaper(startedOn, shape, noneHeld);
  if (structured === null) return null;
  return {
    blueprint: startedOn,
    plan: structured.plan,
    planTimeEmptySlots: structured.planTimeEmptySlots,
    structure: shape,
    passageBySlot: passagesBySlot(shape, passageByGroup),
    passageVersions,
    extent: recorded,
  };
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

/** `[D-561]`: the earlier parts a dependent slot builds on, in paper (plan) order, each read off its landed item; `[]` for a slot that states no dependency. */
function earlierPartsOf(
  slot: PaperJournalPlanSlot,
  dependencyItems: readonly PaperGeneratedItem[],
  planIndex: ReadonlyMap<string, number>,
): readonly PaperEarlierPart[] {
  if (slot.dependsOnSlotIds.length === 0) return [];
  return [...dependencyItems]
    .sort(
      (a, b) =>
        (planIndex.get(a.slotId) ?? Number.MAX_SAFE_INTEGER) -
        (planIndex.get(b.slotId) ?? Number.MAX_SAFE_INTEGER),
    )
    .flatMap((item) => {
      const part = paperItemEarlierPart(item);
      return part === undefined ? [] : [part];
    });
}

/** The journal's generator over the three-outcome port: one call per slot, the outcomes mapped one to one. */
function slotGeneratorOver(
  composition: PlannedComposition,
  port: PaperSlotOutcomePort,
): PaperSlotGenerator {
  const { blueprint } = composition;
  const bySlotId = new Map(blueprint.slots.map((slot) => [slot.slotId, slot]));
  const planIndex = new Map(composition.plan.map((slot, index) => [slot.slotId, index]));
  return async ({ slot, dependencyItems }) => {
    const planned = bySlotId.get(slot.slotId);
    if (planned === undefined) return { status: 'unavailable', reason: 'slot-not-in-blueprint' };
    const earlierParts = earlierPartsOf(slot, dependencyItems, planIndex);
    const sharedPassage = composition.passageBySlot.get(slot.slotId);
    const request: PaperItemGenerationRequest = {
      taskId: planned.taskId,
      courseCode: blueprint.course,
      conceptName: planned.conceptName,
      sourceChunks: planned.sourceChunks,
      purpose: 'readiness',
      // `[D-437]` W1: the slot's demand travels only when it was read from her papers.
      ...(blueprint.intendedDemandBasis === 'read'
        ? { intendedDemand: planned.intendedDemand }
        : {}),
      // `[D-561]`, `[D-562]`: only a dependent part, and only a part of a group given a passage.
      ...(earlierParts.length > 0 ? { earlierParts } : {}),
      ...(sharedPassage !== undefined ? { sharedPassage } : {}),
    };
    const outcome = await port(request);
    if (outcome.status === 'generated') {
      return { status: 'generated', item: itemFrom(planned, outcome) };
    }
    return outcome;
  };
}

/** The four reuse inputs of one planned composition (module doc). */
async function fingerprintOf(
  composition: PlannedComposition,
  scope: PaperCompositionScope,
): Promise<PaperReuseFingerprint> {
  const { blueprint, plan, structure } = composition;
  const planned = new Set(plan.map((slot) => slot.slotId));
  return paperReuseFingerprint({
    sourceVersions: await sourceVersionsOf(
      structure === undefined
        ? blueprint.slots
        : blueprint.slots.filter((slot) => planned.has(slot.slotId)),
      composition.passageVersions,
    ),
    scope: {
      eligibleConceptKeys: scope.eligibleConceptKeys,
      outcomes: scope.outcomes,
    },
    structure: {
      shape: structure ?? flatStructureShape(blueprint),
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
 * `[D-548]`, `[D-560]`: which composition this request runs. When the course's open journal was
 * made at another length or on another structure than this request would compose, the composition
 * is planned again as the journal recorded it and compared there: a match resumes the paper on its
 * own plan and structure; a mismatch sets the journal aside naming what changed, and the request
 * runs the new composition. Otherwise, the new composition, as before.
 */
async function compositionForRequest(
  input: ComposePaperThroughJournalInput,
  options: PaperStoreOptions,
): Promise<{
  readonly composition: PlannedComposition;
  readonly setAside: readonly SetAsideJournal[];
}> {
  const { vault, blueprint, scope } = input;
  const { extent } = input;
  if (extent === undefined) {
    return { composition: flatComposition(blueprint, undefined), setAside: [] };
  }
  const lookup = input.stimulusLookup ?? PAPER_STIMULUS_NOT_LOOKED;
  const current =
    (await structuredComposition(input, lookup)) ??
    flatComposition(blueprint, {
      slotCount: extent.slotCount,
      structureSummary: blueprint.structureSummary,
    });
  const open = await latestOpenJournal(vault, blueprint.course);
  if (open === undefined) return { composition: current, setAside: [] };
  const recorded = recordedExtentOf(open, blueprint);
  // Flat then and flat now, at one length: the new composition is the one the journal recorded, and
  // `openPaperJournal` decides as before. A recorded structure is always planned again as recorded,
  // so it is authoritative however the reading or the lookup has moved since.
  if (
    open.structure === undefined &&
    current.structure === undefined &&
    recorded.slotCount === current.extent?.slotCount
  ) {
    return { composition: current, setAside: [] };
  }

  const startedOn = await recordedComposition({ ...input, extent }, open, recorded, lookup);
  let changed: readonly (keyof PaperReuseFingerprint)[] = ['scope'];
  if (startedOn !== null) {
    const comparison = comparePaperReuseFingerprints(
      open.fingerprint,
      await fingerprintOf(startedOn, scope),
    );
    const samePlan = canonicalJson(open.plan) === canonicalJson(startedOn.plan);
    if (comparison.compatible && samePlan) return { composition: startedOn, setAside: [] };
    // The same rule `openPaperJournal` applies: a matching fingerprint over a different plan is
    // named a structure change rather than trusted.
    changed = comparison.compatible ? ['structure'] : comparison.changed;
  }
  await discardPaperJournal(vault, open.id, { reason: 'reuse-incompatible', changed }, options);
  return { composition: current, setAside: [{ journalId: open.id, changed }] };
}

export async function composePaperThroughJournal(
  input: ComposePaperThroughJournalInput,
): Promise<ComposePaperThroughJournalResult> {
  const { vault, scope, port } = input;
  const options = input.options ?? {};
  const { composition, setAside } = await compositionForRequest(input, options);
  const { blueprint, plan, extent, structure } = composition;
  const fingerprint = await fingerprintOf(composition, scope);

  const opened = await openPaperJournal(
    vault,
    {
      course: blueprint.course,
      fingerprint,
      plan,
      ...(extent !== undefined ? { extent } : {}),
      ...(structure !== undefined ? { structure } : {}),
    },
    options,
  );
  const journalId = opened.journal.id;
  const discarded = [...setAside, ...(opened.discarded ?? [])];
  const decision: PaperJournalOpenDecision =
    opened.decision === 'fresh' && setAside.length > 0 ? 'discarded-and-fresh' : opened.decision;
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
    { generate: slotGeneratorOver(composition, port) },
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
        planTimeEmptySlots: composition.planTimeEmptySlots,
        // `[D-560]`: the structure the journal recorded (the one this composition opened or resumed).
        ...(structure !== undefined ? { structure } : {}),
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
