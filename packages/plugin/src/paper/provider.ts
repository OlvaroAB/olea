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
 * `resolveAssessments` — F1.2's Base-or-manual-fallback choice, `ol-egov.141.8.10` — and, since
 * `ol-2zfj.172`, real Outcome coverage and Outcome labels via
 * `listOutcomeRecords`/`outcomeConceptCoverage`) and which are still honestly degraded because no
 * production reader exists yet anywhere in this repo (taughtSignal, mastery, past-paper demand).
 * Composing those remaining readers is a separate, multi-bead effort this bead's own `owns`
 * (`packages/plugin/src/paper/`) does not cover.
 *
 * **The paper's length follows her stored past-paper reading (`[D-548]`, `ol-egov.141.89.7.87`).**
 * `requestPaper` reads the course's past-paper structure through `readPastPaperStructure`
 * ({@link pastPaperStructureReaderForVault} in production: SCP's store over her vault, read the way
 * `../scope-reading/declared-demands.ts` reads it) and passes it to `assemble.ts`, so a standard
 * paper plans the median past-paper item count, clamped 1 to 8; with no reading, or a read that
 * fails, the declared standard extent stands, exactly as before. The slot count the paper was
 * planned at, and the same composition planned at another count, go to the journal, so a paper she
 * left unfinished resumes on the plan it started with and the new length applies from the next new
 * paper (`./journal-composition.ts`). Nothing she reads changes wording.
 *
 * **The paper is written in its structured form when her stored reading has groups and parts
 * (`[D-559]`, `ol-egov.141.89.7.93`).** The same read carries the first counted reading's groups and
 * parts (`PaperRecoveredStructure.template`, `olea-core`'s `paperRecoveredStructureFromReadings`),
 * and `requestPaper` passes them to the composition, which takes whole questions of that reading,
 * writes parts in dependency order with the earlier part's question beside a dependent one, and
 * records the structure on the journal and the paper. A reading with sections only, or none, is the
 * flat paper as before. A group that shares material is asked of the shared-passage lookup
 * (`[D-562]`): in production `./stimulus-lookup.ts`'s, over the held sources of the group's concepts
 * (the blueprint input's own), with every document registered now as a past paper
 * (`readRegisteredPastPaperPaths`, any course) and every resolved assessment record's note kept out
 * of it. A held passage reaches the face beside its group's parts (`PracticePaperReadyState.passages`,
 * her text and its source's path, never stored). The ruled sentences for a partial paper are the
 * view's, unchanged.
 *
 * **While a past paper's structure reading is pending, its local grouping shapes the paper
 * (`[D-559]`, `ol-egov.141.89.7.60`).** When no counted reading gives a template, `requestPaper`
 * asks the same reader's `pendingPaperTemplate` (production: {@link pastPaperStructureReaderForVault})
 * for the template of the course's first past paper whose reading is pending, from the local
 * grouping of its text (`./past-paper-grouping.ts`, whose module doc states which papers count as
 * pending and the mapping rule). Readings come first: once a paper's reading exists, its grouping
 * is not consulted. Nothing new is stored: the grouping is recomputed per request, and its
 * unresolved list is never read or shown. The paper's length is the readings' alone (`[D-548]`).
 *
 * **F1.2's fallback now reaches this provider (`ol-egov.141.8.10`).** `loadCourseState` no longer
 * exits to `'assignments-not-configured'` on a blank/unreadable Base alone — it reads through
 * `resolveAssessments` first and only reports that state when NEITHER a real Base NOR any manual
 * entry (any course) produced a record; a single manual entry is enough to graduate past it, even
 * for a different course than the one being loaded (that course then reads its own, ordinary
 * `'no-assessment-ahead'`/`'locked'`/`'unlocked-not-pulled'` state off whatever `records` it has).
 */

import type { ReviewLogEntry } from 'olea-contracts';
import {
  type AssessmentRecord,
  buildPaperBlueprint,
  documentStateView,
  enumerateVaultInstruments,
  extentSlotCountTarget,
  handOffPaperItem,
  isEligiblePaperConcept,
  listOutcomeRecords,
  outcomeConceptCoverage,
  type PaperEmptySlot,
  type PaperGroundingLabel,
  type PaperHandoffResult,
  type PaperRecord,
  type PaperRecoveredStructure,
  type PaperScopeConcept,
  type PaperStructureTemplate,
  type PastPaperStoredReading,
  paperDaysUntilDue,
  paperGroupsNeedingStimulus,
  paperRecoveredStructureFromReadings,
  type ReadingPolicy,
  readReviewLogHistory,
  resolveAssessments,
  type ScopeReadingProjection,
  type ScopeRevisionRef,
  structureView,
  type UnitManifest,
  type VaultPath,
  type VaultSource,
  writeInstrumentCitation,
} from 'olea-core';
import { ensureHomeNoteForConcept } from '../generation/home-note.js';
import type { PaperSlotOutcomePort } from '../oracle/paper-item-port.js';
import type { PersistedStudyPlanConfig } from '../plan/settings-store.js';
import {
  currentRevisionsFromManifests,
  type RegisteredPastPaper,
  registeredPastPapersFrom,
} from '../scope-reading/declared-demands.js';
import { createScopeReadingPersistence } from '../scope-reading/persistence.js';
import { localToday } from '../today/data-source.js';
import { buildBlueprintInputForCourse } from './assemble.js';
import type { IncompletePaperStatement, PartialPaperStatement } from './copy.js';
import {
  AUTHORING_SPEC_CHANGED_SENTENCE,
  buildIncompletePaperStatement,
  buildPartialPaperStatement,
  UNFINISHED_PAPER_SENTENCE,
} from './copy.js';
import type { PaperDemand } from './demand.js';
import {
  composePaperThroughJournal,
  type PaperFacePassageText,
  type PaperStimulusLookup,
} from './journal-composition.js';
import {
  createPendingPaperTemplateReader,
  groupPastPaperText,
  markdownPastPapersOf,
  type PastPaperExtract,
} from './past-paper-grouping.js';
import { createHeldMaterialStimulusLookup } from './stimulus-lookup.js';
import { evaluatePracticePaperUnlockForCourse } from './unlock.js';

/**
 * Where a handed-off item's instrument enters the vault (`[D-391]`/`[D-407]`'s `PaperHandoffTarget.
 * notePath`, "the caller's" per that type's own doc) — `ol-0r92.135`'s own Class B default, not a
 * ruling: F4.11/`[D-252]`/`[D-367]`/`[D-391]`/`[D-407]` say WHAT the hand-off is and WHAT it
 * stamps, never WHICH note a fresh instrument is entered into.
 *
 * **Why a course-scoped Olea home note, not one of her own authored notes.** The item must land
 * where the ordinary review queue can actually find it: `enumerateVaultInstruments` binds an
 * instrument to a concept only through its note's own `topic:` frontmatter
 * (`generation/home-note.ts`'s module doc), so the destination note MUST carry `item.conceptName`
 * in `topic:` or the handed-off item would be entered but never queued — silently defeating the
 * whole point of the act. Reusing `ensureHomeNoteForConcept` unmodified (this module's existing
 * `[D-179]` mechanism) gets that binding for free and keeps the destination in Olea's own layer
 * (INV-6 Part Two, `[D-097]`) — no consent question about WHOSE note is written into, only about
 * the hand-off act itself, which her button press already supplies. A synthetic, extension-less
 * "source path" under this folder (never a real document) makes `homeNotePathForSource` derive one
 * stable note per course, reusing every existing collision/marker/topic-growth guarantee that
 * module already has tests for.
 *
 * **Reversible, non-persisted.** Nothing durable names this folder: `[D-407]`'s own `paper-origin:`
 * field on the entered block carries only `paperId`/`slotId`, never a path, and
 * `paperItemInstrumentId` derives the instrument id from those two ids alone — so moving this
 * folder, or replacing it with a different destination rule entirely, changes where a FUTURE
 * hand-off's note lands and nothing about any hand-off already made. Flagged for retroactive
 * review, per `CLAUDE.md`'s Class B ladder.
 */
const PRACTICE_PAPER_HANDOFF_FOLDER = 'Practice paper hand-offs';

/**
 * `[D-622]` (ol-egov.141.89.7.110): the nearest unpassed assessment when the unlock rule fired,
 * the one a request is offered for. `path` is its assignments-table record; `due` is the date it
 * had then, kept for a record that has since left the table.
 */
export interface OfferedAssessment {
  readonly path: string;
  readonly due: string;
}

/** One face-ready item — the labels the view renders alongside her response, never the blueprint's internal weight/rank fields she has no reason to see. */
export interface PracticePaperFaceItem {
  readonly slotId: string;
  readonly conceptName: string;
  readonly intendedDemand: PaperDemand;
  readonly groundingLabel: PaperGroundingLabel;
  readonly response: unknown;
}

/**
 * `[D-562]`: a group's held passage as the face shows it, above the group's parts: her text exactly
 * as held, and its source's path (`PaperHeldStimulus.sourceId`), shown the way the partial banner
 * shows its pointer paths. No wording of Olea's. Never persisted: the record keeps the pointer only.
 */
export interface PracticePaperFacePassage {
  readonly groupId: string;
  readonly text: string;
  readonly sourceId: string;
  /** The group's parts, nested groups included, in printed order. */
  readonly slotIds: readonly string[];
}

/** What the view renders once a paper has been composed. `partialStatement` is placed BEFORE `items` by the view — ruling 4: "before she opens it" — never a footnote after them. */
export interface PracticePaperReadyState {
  readonly kind: 'ready';
  readonly course: string;
  readonly record: PaperRecord;
  readonly partial: boolean;
  readonly partialStatement: PartialPaperStatement | null;
  /** `[D-457]`: derived from the record's own completion and empty slots, never persisted. Null for a complete or flat paper. */
  readonly incompleteStatement: IncompletePaperStatement | null;
  readonly items: readonly PracticePaperFaceItem[];
  readonly emptySlots: readonly PaperEmptySlot[];
  /** `[D-532]`: saved progress was discarded because her material changed; the view shows the ruled sentence once, above the paper. */
  readonly materialChanged: boolean;
  /** `[D-562]`: each group's held passage, for the view to show above the group's first item. `[]` when none is held. */
  readonly passages: readonly PracticePaperFacePassage[];
}

/** The coverage counts a locked paper may state (F4.11, `[D-252]`): counts and whether known, never a share. */
export interface LockedCoverageCounts {
  readonly outcomeCount: number;
  /** Declared outcomes with at least one attached concept: the count the unlock gate reads. */
  readonly attachedOutcomeCount: number;
  readonly outcomeCoverageKnown: boolean;
  readonly conceptCount: number;
  readonly conceptCoverageKnown: boolean;
  readonly attachedConceptCount: number;
}

export type PracticePaperCourseState =
  /** F4.11: "the affordance is absent" — never present with a reason when nothing is ahead. */
  | {
      readonly kind: 'no-assessment-ahead';
      readonly course: string;
      /** `[D-532]`: the course has an assessment record with no usable date (and none ahead), so the view explains it rather than saying there is none. */
      readonly undatedAssessment: boolean;
    }
  /** Present, with a reason (`copy.ts`'s `buildLockedCopy`) — see that function's doc for the F8.3 gap this composition cannot yet fill honestly. */
  | {
      readonly kind: 'locked';
      readonly course: string;
      readonly daysUntilNearest: number;
      readonly nearestAssessmentDue: string;
      /**
       * ol-egov.141.89.7.61: the counts the locked reason states, with whether each is known (a
       * course with no active declaration is unknown, never a measured zero). Counts only: the
       * share the unlock rule reads is internal and never carried here (F8.3). The sentence that
       * states them is held for a ruling.
       */
      readonly coverage: LockedCoverageCounts;
      /** `[D-532]`: the smallest declared-topic count with her material behind it that unlocks the paper, computed from the unlock gate; null when no scope is declared. */
      readonly topicsNeeded: number | null;
      /** `[D-532]`: the proximity window in days, read from the unlock gate. */
      readonly windowDays: number;
    }
  /** Unlocked, not yet pulled — she has not yet invoked the one affordance. */
  | {
      readonly kind: 'unlocked-not-pulled';
      readonly course: string;
      /** `[D-622]`: the assessment the rule fired for, which the view hands back with the request. */
      readonly offeredFor?: OfferedAssessment;
    }
  /** F7.8's grey-out: unlocked, but no Worker configured to generate items with. */
  | { readonly kind: 'ai-unavailable'; readonly course: string }
  /** The assignments Base itself is not configured — same precondition every other course-scoped screen in this plugin already gates on. */
  | { readonly kind: 'assignments-not-configured' }
  | PracticePaperReadyState;

/**
 * `[D-548]`'s reader of the course's past-paper structure, and, when it carries one,
 * `pendingPaperTemplate`: `[D-559]`'s fallback while a past paper's reading is pending
 * (`ol-egov.141.89.7.60`, `./past-paper-grouping.ts`). The two travel together because they read
 * the same registrations, store and manifests, and the fallback is asked only when the readings give
 * no template. A plain function is a reader without the fallback.
 */
export type PastPaperStructureReader = ((
  course: string,
) => Promise<PaperRecoveredStructure | null>) & {
  /** The local grouping's template for the course's first past paper whose reading is pending, or `null`. */
  readonly pendingPaperTemplate?: (course: string) => Promise<PaperStructureTemplate | null>;
};

export interface CreateLocalPracticePaperProviderDeps {
  readonly vault: VaultSource;
  readonly settingsStore: { load(): Promise<PersistedStudyPlanConfig> };
  /**
   * The three-outcome port (`[D-430]`): a slot's call ends `generated`, `refused` or `unavailable`
   * and never throws, so the journal can keep an outage apart from a refusal. `null` is F7.8's
   * grey-out (no Worker configured).
   */
  readonly generationPort: () => Promise<PaperSlotOutcomePort | null>;
  readonly now: () => Date;
  /**
   * `[D-548]` (`ol-egov.141.89.7.87`): the course's past-paper reading, as the paper's recovered
   * structure, or `null` when no reading counts. Production:
   * {@link pastPaperStructureReaderForVault}. Omitted, or a read that throws: none, so the paper
   * keeps the declared standard extent (an unfinished paper keeps its own length either way,
   * `./journal-composition.ts`). Its `pendingPaperTemplate`, when present, is asked only when no
   * counted reading gives a template (`[D-559]`, `ol-egov.141.89.7.60`); a fallback that throws
   * gives none, and the paper is composed flat.
   */
  readonly readPastPaperStructure?: PastPaperStructureReader;
  /**
   * `[D-562]` (`ol-egov.141.89.7.93`): the shared-material lookup a structured paper's groups are
   * asked of, overriding the production one below (tests). Omitted, with
   * `readRegisteredPastPaperPaths` omitted too: the composition does not look, so a group that
   * shares material is written without it and is never `no-held-stimulus`
   * (`./journal-composition.ts`).
   */
  readonly stimulusLookup?: PaperStimulusLookup;
  /**
   * `[D-562]`: the vault paths of the documents registered now as past papers, of any course. With
   * it, each request builds the production lookup (`./stimulus-lookup.ts`) over the blueprint
   * input's held sources, keeping these papers and every resolved assessment record's note out of
   * it. A read that throws leaves every source's status unknown, so nothing is searched and no
   * group is claimed to have none (`../paper/wiring.ts` supplies it from her review log).
   */
  readonly readRegisteredPastPaperPaths?: () => Promise<readonly VaultPath[]>;
}

/**
 * `[D-548]`: the course's past-paper structure from the scope-reading projection — one reading per
 * paper registered now as a past paper of `course`, at the revision the caller says is current, and
 * counted only as `olea-core`'s `paperRecoveredStructureFromReadings` allows (a current structure
 * over a revision read in full; no regime, no seal, no demand). `null` when none counts. Pure.
 *
 * `currentRevisions` names only revisions the unit manifest could verify
 * ({@link currentRevisionsFromManifests}); a paper it leaves out has no current revision, and none
 * of its readings counts.
 */
export function pastPaperStructureForCourse(
  projection: ScopeReadingProjection,
  papers: readonly RegisteredPastPaper[],
  currentRevisions: ReadonlyMap<VaultPath, string>,
  course: string,
  policy?: ReadingPolicy,
): PaperRecoveredStructure | null {
  const paths = [
    ...new Set(papers.filter((paper) => paper.courses.includes(course)).map((p) => p.path)),
  ].sort();
  const readings: PastPaperStoredReading[] = [];
  for (const path of paths) {
    const revisionDigest = currentRevisions.get(path);
    if (revisionDigest === undefined) continue;
    const source: ScopeRevisionRef = {
      sourcePath: path,
      documentKind: 'past-paper',
      revisionDigest,
    };
    readings.push({
      state: documentStateView(projection, source),
      structure: structureView(projection, source, policy),
    });
  }
  return paperRecoveredStructureFromReadings(readings);
}

/** What {@link createPastPaperStructureReader} reads through: the same three seams `../scope-reading/declared-demands.ts`'s reader takes. */
export interface PastPaperStructureReaderDeps {
  /** The scope-reading projection: `ScopeReadingPersistence.load` (`../scope-reading/persistence.ts`). */
  readonly loadScopeReadings: () => Promise<ScopeReadingProjection>;
  /** The documents registered NOW as past papers (`registeredPastPapersFrom`). */
  readonly registeredPastPapers: () => Promise<readonly RegisteredPastPaper[]>;
  /** Each path's current revision digest; a path left out has no current revision. */
  readonly currentRevisions: (
    paths: readonly VaultPath[],
  ) => Promise<ReadonlyMap<VaultPath, string>>;
  /** Reader prompt versions accepted. Omitted: any version, the projection's own default. */
  readonly policy?: ReadingPolicy;
}

/** `[D-548]`: the provider's `readPastPaperStructure` over those seams. Reads only; nothing it reads is logged (D-005). Throws when a seam throws. */
export function createPastPaperStructureReader(
  deps: PastPaperStructureReaderDeps,
): (course: string) => Promise<PaperRecoveredStructure | null> {
  return async (course) => {
    const papers = (await deps.registeredPastPapers()).filter((paper) =>
      paper.courses.includes(course),
    );
    if (papers.length === 0) return null;
    const [projection, revisions] = await Promise.all([
      deps.loadScopeReadings(),
      deps.currentRevisions([...new Set(papers.map((paper) => paper.path))].sort()),
    ]);
    return pastPaperStructureForCourse(projection, papers, revisions, course, deps.policy);
  };
}

export interface VaultPastPaperStructureDeps {
  readonly vault: VaultSource;
  /** This install's stable device id (`../device/device-id.ts`): names its own scope-reading files. */
  readonly deviceId: string;
  /** The unit manifest's reader boundary (`../grove/unit-manifest-store.ts`'s `manifestsFor`). */
  readonly manifestsFor: (
    paths: readonly VaultPath[],
  ) => Promise<ReadonlyMap<VaultPath, UnitManifest>>;
  readonly coursesFolder?: VaultPath;
  /** Injectable for tests; production reads `readReviewLogHistory(vault)`, as the writer does. */
  readonly reviewLog?: () => Promise<readonly ReviewLogEntry[]>;
  /** `[D-559]`: where Markdown past papers are found (`registerSources`'s folder). Omitted: its default. */
  readonly sourcesFolder?: VaultPath;
  /** `[D-559]`: how a non-Markdown past paper's text is extracted. Injectable for tests; production: `extractFromVault`. */
  readonly extract?: PastPaperExtract;
}

/**
 * `[D-548]`: the production `readPastPaperStructure` — SCP's store over her vault, her review log's
 * registrations for the papers, and the unit manifest for each paper's current revision, composed
 * exactly as `../scope-reading/declared-demands.ts`'s `declaredDemandsReaderForVault` composes
 * them. The store is opened at each read, so a device id it refuses fails that read, which the
 * provider reads as no reading.
 *
 * `[D-559]` (`ol-egov.141.89.7.60`): it carries `pendingPaperTemplate` over the same seams, plus her
 * Markdown past papers and each paper's own text (`./past-paper-grouping.ts`), so `main.ts`'s
 * existing call reaches the fallback with nothing new passed.
 */
export function pastPaperStructureReaderForVault(
  deps: VaultPastPaperStructureDeps,
): PastPaperStructureReader {
  const reviewLog =
    deps.reviewLog ?? (async () => (await readReviewLogHistory(deps.vault)).entries);
  const seams = {
    loadScopeReadings: () =>
      createScopeReadingPersistence({ vault: deps.vault, deviceId: deps.deviceId }).load(),
    registeredPastPapers: async () =>
      registeredPastPapersFrom(await reviewLog(), deps.coursesFolder),
    currentRevisions: async (paths: readonly VaultPath[]) =>
      currentRevisionsFromManifests(await deps.manifestsFor(paths)),
  };
  const pendingPaperTemplate = createPendingPaperTemplateReader({
    ...seams,
    markdownPastPapers: (course) => markdownPastPapersOf(deps.vault, course, deps.sourcesFolder),
    groupPaper: (path) => groupPastPaperText(deps.vault, path, deps.extract),
  });
  return Object.assign(createPastPaperStructureReader(seams), { pendingPaperTemplate });
}

/** The course's past-paper structure, or `null` with no reader or a read that throws: the declared extent then stands (`[D-548]`). */
async function readPastPaperStructureFor(
  deps: CreateLocalPracticePaperProviderDeps,
  course: string,
): Promise<PaperRecoveredStructure | null> {
  if (deps.readPastPaperStructure === undefined) return null;
  try {
    return await deps.readPastPaperStructure(course);
  } catch {
    return null;
  }
}

/**
 * `[D-559]` (`ol-egov.141.89.7.60`): the local grouping's template while a past paper's reading is
 * pending, or `null` with no fallback on the reader or a read that throws (the flat paper stands).
 */
async function pendingPaperTemplateFor(
  deps: CreateLocalPracticePaperProviderDeps,
  course: string,
): Promise<PaperStructureTemplate | null> {
  const read = deps.readPastPaperStructure?.pendingPaperTemplate;
  if (read === undefined) return null;
  try {
    return await read(course);
  } catch {
    return null;
  }
}

/**
 * The smallest whole number of declared topics that unlocks the paper: the least `t` with
 * `t / topicCount >= gateShare`, using the gate's own comparison (`paper-unlock.ts`), never a float
 * multiplication. Computed from the gate so a moved gate moves the sentence ([D-532], [D-255]).
 */
export function topicsNeededToUnlock(topicCount: number, gateShare: number): number {
  for (let t = 1; t <= topicCount; t += 1) {
    if (t / topicCount >= gateShare) return t;
  }
  return topicCount;
}

/**
 * ol-egov.141.89.7.109: today on the device's own calendar, the date F4.7's session builder counts
 * with (`session-builder/provider.ts`, `localToday`), never the UTC date of the instant.
 */
function isoToday(now: Date): string {
  return localToday(now);
}

/**
 * Reads real assignments-table records for `course` (F1.2's Base-or-manual fallback,
 * `resolveAssessments`), real Outcome coverage (`ol-2zfj.172`) and evaluates the unlock rule
 * against them (`unlock.ts`). No cache — recomputed on every call, same as `requestPaper` (module
 * doc).
 */
async function loadCourseState(
  deps: CreateLocalPracticePaperProviderDeps,
  course: string,
): Promise<PracticePaperCourseState> {
  return (await readCourseUnlock(deps, course)).state;
}

/** `loadCourseState`'s reading, with the course's assessment records and the day it counted from. */
interface CourseUnlockReading {
  readonly state: PracticePaperCourseState;
  readonly courseAssessments: readonly AssessmentRecord[];
  readonly asOf: string;
}

async function readCourseUnlock(
  deps: CreateLocalPracticePaperProviderDeps,
  course: string,
): Promise<CourseUnlockReading> {
  const config = await deps.settingsStore.load();

  const [assessmentsRead, enumeration, outcomeRecords] = await Promise.all([
    resolveAssessments(deps.vault, config.assignmentsBasePath),
    // `[D-357]`: the permanent concept key, the one her review log carries.
    enumerateVaultInstruments(deps.vault, { concepts: { stampConceptKeys: true } }),
    listOutcomeRecords(deps.vault),
  ]);
  const { records } = assessmentsRead;
  // F1.2: "not configured" now means neither a real Base NOR any manual entry produced anything
  // to work from — `resolveAssessments`'s own `source: 'manual'` with zero records is exactly
  // that state (a blank OR unreadable Base, and she has typed nothing by hand either).
  const asOf = isoToday(deps.now());
  if (assessmentsRead.source === 'manual' && records.length === 0) {
    return { state: { kind: 'assignments-not-configured' }, courseAssessments: [], asOf };
  }

  const courseAssessments = records.filter((record) => record.course === course);
  const state = (s: PracticePaperCourseState): CourseUnlockReading => ({
    state: s,
    courseAssessments,
    asOf,
  });

  const courseConceptKeys = enumeration.concepts
    .filter((concept) => concept.courses.includes(course))
    .map((concept) => concept.key);
  const courseOutcomes = outcomeRecords
    .map((entry) => entry.record)
    .filter((record) => record.courses.includes(course));
  const coverage = outcomeConceptCoverage(courseOutcomes, courseConceptKeys);

  const unlock = evaluatePracticePaperUnlockForCourse(
    asOf,
    courseAssessments
      .filter((record) => record.type !== undefined && record.due !== undefined)
      .map((record) => ({ type: record.type as string, due: record.due as string })),
    coverage,
  );

  if (unlock.nearestAssessment === null) {
    // `[D-532]`: a record with no readable date is not the same as none ahead.
    const undatedAssessment = courseAssessments.some(
      (record) => record.due === undefined || paperDaysUntilDue(asOf, record.due) === null,
    );
    return state({ kind: 'no-assessment-ahead', course, undatedAssessment });
  }
  if (!unlock.fires) {
    return state({
      kind: 'locked',
      course,
      daysUntilNearest: unlock.daysUntilNearest ?? 0,
      nearestAssessmentDue: unlock.nearestAssessment.due,
      topicsNeeded:
        coverage.outcomeCoverageKnown === true
          ? topicsNeededToUnlock(coverage.outcomeCount, unlock.coverageGateShare)
          : null,
      windowDays: unlock.proximityWindowDays,
      coverage: {
        outcomeCount: coverage.outcomeCount,
        attachedOutcomeCount: coverage.attachedOutcomeCount,
        outcomeCoverageKnown: coverage.outcomeCoverageKnown === true,
        conceptCount: coverage.conceptCount,
        conceptCoverageKnown: coverage.conceptCoverageKnown === true,
        attachedConceptCount: coverage.attachedConceptCount,
      },
    });
  }
  const nearest = unlock.nearestAssessment;
  const offered = courseAssessments.find(
    (record) => record.due === nearest.due && record.type === nearest.type,
  );
  return state({
    kind: 'unlocked-not-pulled',
    course,
    ...(offered === undefined ? {} : { offeredFor: { path: offered.path, due: nearest.due } }),
  });
}

/**
 * `[D-622]`: whether the assessment a request was offered for has passed, on the day the rule now
 * counts from. Its record's current date decides, so an assessment moved later has not passed; a
 * record gone from the table keeps the date she was offered.
 */
function offeredAssessmentHasPassed(
  reading: CourseUnlockReading,
  offeredFor: OfferedAssessment,
): boolean {
  const record = reading.courseAssessments.find((r) => r.path === offeredFor.path);
  const days = paperDaysUntilDue(reading.asOf, record?.due ?? offeredFor.due);
  return days !== null && days < 0;
}

/**
 * Pure: `PaperRecord` → the view's ready-state, including ruling 4's face statement. Pulled out of
 * `requestPaper` so it is directly testable against a hand-built `PaperRecord` — see
 * `test/paper/provider.spec.ts`'s "face states the gap" scenarios, which construct a record with
 * `compositionAccount.unbuiltDemand` set rather than driving the whole vault/Worker pipeline to
 * reach one (the past-paper structure this composition passes carries no demand reading, so a REAL
 * course can never reach `unbuiltDemand !== null` today — see `assemble.ts`'s module doc — and this
 * is the only way to exercise the render honestly until a demand reader is wired).
 */
export function buildReadyStateFromRecord(
  course: string,
  record: PaperRecord,
  options: {
    readonly materialChanged?: boolean;
    /** `[D-562]`: the held passages' text by group, from the composition (never from the record). */
    readonly passages?: readonly PaperFacePassageText[];
  } = {},
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
    incompleteStatement: buildIncompletePaperStatement(record.completion, record.emptySlots),
    items: record.items.map((item) => ({
      slotId: item.slotId,
      conceptName: item.conceptName,
      intendedDemand: item.intendedDemand,
      groundingLabel: item.groundingLabel,
      response: item.response,
    })),
    emptySlots: record.emptySlots,
    materialChanged: options.materialChanged === true,
    passages: facePassagesOf(record, options.passages ?? []),
  };
}

/**
 * `[D-562]`: the face's passages — each group the record's structure holds a passage for, with the
 * text the composition read for it, its source's path and its parts. A group whose text was not
 * handed over shows nothing (no placeholder, no wording). Pure.
 */
function facePassagesOf(
  record: PaperRecord,
  texts: readonly PaperFacePassageText[],
): readonly PracticePaperFacePassage[] {
  if (record.structure === undefined || texts.length === 0) return [];
  const textByGroup = new Map(texts.map((entry) => [entry.groupId, entry.text] as const));
  const groupById = new Map(record.structure.groups.map((g) => [g.groupId, g] as const));
  return paperGroupsNeedingStimulus(record.structure).flatMap((needing) => {
    const held = groupById.get(needing.groupId)?.heldStimulus;
    const text = textByGroup.get(needing.groupId);
    if (held === null || held === undefined || text === undefined) return [];
    return [{ groupId: needing.groupId, text, sourceId: held.sourceId, slotIds: needing.slotIds }];
  });
}

/**
 * `[D-562]`: which passages the view shows before which item — each passage once, before the first
 * of `state.items` that is one of its group's parts, an outer group's before an inner one's. A
 * passage none of whose parts was written is not shown: there is nothing for it to sit above. Pure.
 */
export function facePassagesBeforeItems(
  state: Pick<PracticePaperReadyState, 'items' | 'passages'>,
): ReadonlyMap<string, readonly PracticePaperFacePassage[]> {
  const out = new Map<string, PracticePaperFacePassage[]>();
  for (const passage of state.passages) {
    const first = state.items.find((item) => passage.slotIds.includes(item.slotId));
    if (first === undefined) continue;
    const before = out.get(first.slotId) ?? [];
    before.push(passage);
    out.set(first.slotId, before);
  }
  return out;
}

/**
 * `[D-430]`: thrown by `requestPaper` when work is owed and no paper was created. The unfinished
 * paper is KEPT in the resumable journal (`./journal-composition.ts`) and the next request resumes
 * it, drafting only the missing parts; nothing is handed over in the meantime, because a paper with
 * holes because the service was down does not exist (only an explicitly qualified partial, a source
 * or capability gap, is ever handed over, and that is a `ready` state).
 *
 * **Data only.** This error carries counts and an id and no words for her; the view reads her
 * sentence from `unfinishedPaperNotice` (`[D-457]`, `[D-532]`), and a request that ends in any error
 * never leaves the composing pane (ol-egov.141.89.7.63). Content-free (D-005): no concept, note or
 * reason string.
 */
export class PracticePaperUnfinishedError extends Error {
  readonly course: string;
  /** `'service-unavailable'`: a part stayed unavailable after its retry. `'authoring-spec-changed'`: a resumed part came back under another prompt version, so the journal was set aside and the next request starts afresh. */
  readonly reason: 'service-unavailable' | 'authoring-spec-changed';
  readonly journalId: string;
  readonly plannedSlotCount: number;
  readonly owedSlotCount: number;

  constructor(params: {
    readonly course: string;
    readonly reason: 'service-unavailable' | 'authoring-spec-changed';
    readonly journalId: string;
    readonly plannedSlotCount: number;
    readonly owedSlotCount: number;
  }) {
    super(
      `The practice paper is not finished: ${params.owedSlotCount} of ${params.plannedSlotCount} parts are still owed, so nothing was handed over.`,
    );
    this.name = 'PracticePaperUnfinishedError';
    this.course = params.course;
    this.reason = params.reason;
    this.journalId = params.journalId;
    this.plannedSlotCount = params.plannedSlotCount;
    this.owedSlotCount = params.owedSlotCount;
  }
}

/**
 * `[D-457]`: the sentence she reads when a request ended unfinished, or null when the error is not
 * one she should be told that about. Only an outage (`'service-unavailable'`) keeps a paper that
 * "Ask again" continues; a journal set aside for another authoring specification starts afresh, so
 * the continue sentence would be untrue and she reads `[D-532]`'s own sentence for it instead.
 */
export function unfinishedPaperNotice(error: unknown): string | null {
  if (!(error instanceof PracticePaperUnfinishedError)) return null;
  return error.reason === 'service-unavailable'
    ? UNFINISHED_PAPER_SENTENCE
    : AUTHORING_SPEC_CHANGED_SENTENCE;
}

export interface PracticePaperViewDeps {
  /** Loads the CURRENT state for `course` — locked/unlocked/absent, never a composed paper (that only happens on `requestPaper`, F4.11 ruling 5: "she pulls it"). */
  readonly load: (course: string) => Promise<PracticePaperCourseState>;
  /** Composes and persists a fresh paper for `course`. The view offers it only when `load` returned `unlocked-not-pulled`, and every request, "ask again" included, evaluates the unlock rule again before composing (ol-egov.141.89.7.110, `[D-622]`): when the assessment it was offered for (`offeredFor`, from that state) has passed, or the rule no longer fires, nothing is composed and the current state comes back. */
  readonly requestPaper: (
    course: string,
    offeredFor?: OfferedAssessment,
  ) => Promise<RequestedPaper>;
  /**
   * Hands ONE item to ordinary review (F4.11 ruling 1, `[D-252]`) — never the whole paper; the
   * view's per-item control is the only caller, and it is never asked to hand off more than one
   * `slotId` per call. Idempotent: a repeat for a `slotId` already on `record.handoffs` writes no
   * new instrument and returns the SAME `instrumentId` (`[D-391]`) — the view relies on this rather
   * than tracking "already pressed" itself. See `PRACTICE_PAPER_HANDOFF_FOLDER`'s doc for where
   * `notePath` and `questionIndex` (always `0`) come from.
   */
  readonly handOffItem: (
    course: string,
    paperId: string,
    slotId: string,
    conceptName: string,
  ) => Promise<PaperHandoffResult>;
}

/**
 * What one request returns: the paper; or, when the assessment it was offered for has passed, that
 * fact with the course's current state (`[D-622]`: the view says so and shows the current state,
 * never the stale offer); or the state the rule gives at the moment of the request when it no
 * longer fires (ol-egov.141.89.7.110), which the view renders as `load`'s would.
 */
export type RequestedPaper =
  | PracticePaperReadyState
  | {
      readonly kind: 'assessment-passed';
      readonly course: string;
      readonly current: PracticePaperCourseState;
    }
  | Exclude<PracticePaperCourseState, { readonly kind: 'unlocked-not-pulled' }>;

/**
 * One `requestPaper`: the blueprint from the live vault, then the paper composed through the
 * resumable journal (`./journal-composition.ts`, `[D-430]`). Finished (complete or an explicitly
 * qualified partial) becomes the ready state; work owed throws `PracticePaperUnfinishedError`.
 */
async function composeRequestedPaper(
  deps: CreateLocalPracticePaperProviderDeps,
  course: string,
): Promise<RequestedPaper> {
  const port = await deps.generationPort();
  if (port === null) return { kind: 'ai-unavailable', course };

  const config = await deps.settingsStore.load();
  const asOf = isoToday(deps.now());
  const [{ records }, enumeration, outcomeRecords, structure] = await Promise.all([
    resolveAssessments(deps.vault, config.assignmentsBasePath),
    // `[D-357]`: the permanent concept key, the one her review log carries.
    enumerateVaultInstruments(deps.vault, { concepts: { stampConceptKeys: true } }),
    listOutcomeRecords(deps.vault),
    // `[D-548]`: her stored past-paper reading sets the length; none keeps the declared extent.
    readPastPaperStructureFor(deps, course),
  ]);

  const input = await buildBlueprintInputForCourse(
    deps.vault,
    enumeration.concepts,
    records,
    course,
    asOf,
    outcomeRecords.map((entry) => entry.record),
    structure,
  );
  const blueprint = buildPaperBlueprint(input);
  // `[D-559]`: a counted reading's groups and parts first; only when none gives them, the local
  // grouping of a past paper whose reading is pending (`ol-egov.141.89.7.60`); neither, flat.
  const template = structure?.template ?? (await pendingPaperTemplateFor(deps, course));
  const stimulusLookup =
    deps.stimulusLookup ?? heldMaterialLookupFor(deps, input.concepts, records);

  const composed = await composePaperThroughJournal({
    vault: deps.vault,
    blueprint,
    // `[D-548]`: the length this composition was planned at, and the same composition at another
    // length, so an unfinished paper resumes on the plan it started with.
    extent: {
      slotCount: extentSlotCountTarget(input.steering?.extent, input.structure),
      planAt: (slotCount) => buildPaperBlueprint({ ...input, slotCount }),
    },
    scope: {
      eligibleConceptKeys: input.concepts
        .filter(isEligiblePaperConcept)
        .map((concept) => concept.conceptKey),
      outcomes: (input.outcomes ?? []).map((outcome) => ({
        outcomeId: outcome.outcomeId,
        conceptKeys: outcome.conceptKeys,
      })),
    },
    // `[D-559]`: her stored reading's groups and parts, else the pending paper's grouping, shape
    // the paper; none, the flat paper.
    template,
    // `[D-562]`: a group that shares material takes one passage from her held material.
    ...(stimulusLookup !== undefined ? { stimulusLookup } : {}),
    port,
  });
  if (composed.kind === 'unfinished') {
    throw new PracticePaperUnfinishedError({
      course,
      reason: composed.reason,
      journalId: composed.journalId,
      plannedSlotCount: composed.plannedSlotCount,
      owedSlotCount: composed.owedSlotCount,
    });
  }
  return buildReadyStateFromRecord(course, composed.record, {
    materialChanged: composed.materialChanged,
    passages: composed.passages,
  });
}

/**
 * `[D-562]`: the production shared-passage lookup for one request, over the held sources the
 * blueprint was built from; `undefined` without `readRegisteredPastPaperPaths` (the composition then
 * does not look). The assessment papers kept out are every document registered now as a past paper,
 * of any course, and every resolved assessment record's note; they are read only if a group is
 * looked for, and a read that throws leaves them unknown.
 */
function heldMaterialLookupFor(
  deps: CreateLocalPracticePaperProviderDeps,
  concepts: readonly PaperScopeConcept[],
  records: readonly AssessmentRecord[],
): PaperStimulusLookup | undefined {
  const readRegistered = deps.readRegisteredPastPaperPaths;
  if (readRegistered === undefined) return undefined;
  return createHeldMaterialStimulusLookup({
    concepts,
    assessmentPaperPaths: async () =>
      new Set<string>([...(await readRegistered()), ...records.map((record) => record.path)]),
  });
}

/**
 * ol-egov.141.89.7.110, `[D-622]`: the unlock rule is evaluated again at the moment of every
 * request, "ask again" included, the same evaluation `load` makes. A view left open past the due
 * date, or an "ask again" after an unfinished paper, no longer composes once the assessment it was
 * offered for has passed (even when a later one now unlocks a paper of its own) or the rule has
 * closed: the current state comes back instead.
 */
async function recheckThenCompose(
  deps: CreateLocalPracticePaperProviderDeps,
  course: string,
  offeredFor: OfferedAssessment | undefined,
): Promise<RequestedPaper> {
  // F7.8's grey-out reads no vault at all (provider.spec.ts), so it is decided before the rule is.
  if ((await deps.generationPort()) === null) return { kind: 'ai-unavailable', course };
  const reading = await readCourseUnlock(deps, course);
  if (offeredFor !== undefined && offeredAssessmentHasPassed(reading, offeredFor)) {
    return { kind: 'assessment-passed', course, current: reading.state };
  }
  if (reading.state.kind !== 'unlocked-not-pulled') return reading.state;
  return composeRequestedPaper(deps, course);
}

/** The production `PracticePaperViewDeps` — see the module doc. */
export function createLocalPracticePaperProvider(
  deps: CreateLocalPracticePaperProviderDeps,
): PracticePaperViewDeps {
  const inFlight = new Map<string, Promise<RequestedPaper>>();
  return {
    load: (course) => loadCourseState(deps, course),

    requestPaper(course, offeredFor) {
      // One composition per course at a time: a second press while the first is composing shares
      // its work (the journal is single-writer, and two runs over one journal would spend twice
      // and race each other's whole-file rewrites). Cleared when the request settles, so the next
      // press, after a finished paper, composes a fresh one (F4.11 ruling 5).
      const running = inFlight.get(course);
      if (running !== undefined) return running;
      const request = recheckThenCompose(deps, course, offeredFor).finally(() => {
        inFlight.delete(course);
      });
      inFlight.set(course, request);
      return request;
    },

    async handOffItem(course, paperId, slotId, conceptName) {
      // Synthetic, extension-less "source path": never a real document, just a stable per-course
      // key `homeNotePathForSource` turns into one reused note (`PRACTICE_PAPER_HANDOFF_FOLDER`'s
      // doc). `ensureHomeNoteForConcept` grows the note's `topic:` to include `conceptName`
      // idempotently, so review-queue binding holds whether this is the note's first item or its
      // fifth.
      const notePath = await ensureHomeNoteForConcept(
        deps.vault,
        `${PRACTICE_PAPER_HANDOFF_FOLDER}/${course}`,
        conceptName,
      );
      if (notePath === null) {
        throw new Error(
          `handOffItem: a note already sits at "${PRACTICE_PAPER_HANDOFF_FOLDER}/${course}.md" ` +
            "and is not one of Olea's own home notes — refusing to write into it (INV-6).",
        );
      }
      // Ruling: the paper view is "the item's" own reader (`paper-items.ts`'s
      // `paperItemMcqCandidate` doc) — see `ol-0r92.135`'s copy-pass notes for why index 0, always,
      // is the only choice consistent with an id that carries no index information.
      const result = await handOffPaperItem(deps.vault, paperId, slotId, {
        notePath,
        questionIndex: 0,
      });
      // `[D-181]`'s citation sidecar, self-referential (`materialize-mcq.ts`'s own precedent for a
      // generated instrument with no separately-citable unit) — written only on the write that
      // actually created the block, never on a repeat hand-off, since `writeInstrumentCitation`
      // itself refuses to overwrite an existing record and a repeat's `instrumentWritten` is
      // `false` by construction (`PaperHandoffResult`'s own doc).
      if (result.instrumentWritten) {
        await writeInstrumentCitation(deps.vault, result.instrumentId, { sourcePath: notePath });
      }
      return result;
    },
  };
}
