/**
 * `paperRecoveredStructureFromReadings` — her stored past-paper readings, restated as the
 * practice paper's recovered structure (F4.11 input (b), `[D-548]`, `ol-egov.141.89.7.87`).
 * Pure: no I/O, no clock, no model call.
 *
 * **What it is for.** Olea already stores a reading of each registered past paper the Worker could
 * read (`../outcome/scope-reading-types.ts`, `[D-429]`). F4.11 sets the paper's extent "within the
 * range the course's own assessment evidence demonstrates", and `./paper-blueprint.ts`'s
 * `extentSlotCountTarget` already reads that range from a `PaperRecoveredStructure`: the median
 * past-paper item count for a standard paper, clamped 1 to 8. This module is the one place a stored
 * reading becomes that structure, so the paper's length follows her past papers once a reading
 * exists, and stays the declared standard extent while none does (`null`).
 *
 * **Which readings count.** One per paper revision the caller says is current, and only when both
 * hold:
 *
 * - its structure view is `current` (the current revision, by a reader version the caller
 *   accepts): a stale revision or a stale reader is never handed out (`structureView`'s own rule);
 * - its processing state is `recorded`: read in full and a structure found. A paper read only in
 *   part (`partly-read`) undercounts its own questions, so its count is not the paper's count; a
 *   structure whose state is not yet written (a crash between the two writes) reads as not yet
 *   known. Neither counts.
 *
 * **What is carried, and what is not.** Each counted reading is one sitting, its sections restated
 * with their label, question form, item count and marks. Marks the paper does not state stay
 * `'unknown'` (`[D-431]`), never zero. Nothing else is carried:
 *
 * - **No regime.** No production fact records a paper's regime (the plugin's
 *   `scope-reading/declared-demands.ts` module doc), so every sitting reads `regime: 'unknown'`,
 *   and the structure's `currentCount` and `historicalCount` count only sittings whose regime is
 *   known: none. F4.2 makes the regime a qualifier on a sentence, never a numerical decay, so the
 *   length does not depend on it.
 * - **No seal, and so no demand and no source pointer.** Nothing records a sealed mark either.
 *   F4.11 lets a sealed paper inform structure and composition "the same as any other past paper"
 *   and keeps it from grounding an item; demand is read from non-sealed papers only. So every
 *   registered paper's sections count toward the length, and no section carries `demands` and no
 *   sitting a `sourceRef`: the paper's intended demand and its face statement stay exactly as they
 *   were (`./paper-blueprint.ts`'s `dominantDemand` reads nothing here), and no past paper's text
 *   reaches a generated item.
 *
 * The item count is the sections' own, which is what `extentSlotCountTarget` sums.
 *
 * **Groups and parts: the template a structured paper is shaped on (`[D-559]`,
 * `ol-egov.141.89.7.93`).** Of the counted readings, the FIRST in the caller's order whose stored
 * reading carries both question groups and question parts is restated as the structure's
 * `template` (`PaperStructureTemplate`): its groups, its parts, its printed total and its time
 * allowance, with nothing of the anchors. The caller's order is the registered papers' paths,
 * sorted, so the choice is stable and is no claim that one sitting is more representative than
 * another (Class B, declared, flagged on the bead). A reading with sections only, groups without
 * parts, or parts without groups gives no template, and the paper is composed flat exactly as
 * before. The stored reading is checked only shallowly by the store, so a template whose groups or
 * parts are not well formed (a missing id, an unknown kind or stimulus, a mark that is neither
 * stated nor unknown, two parts with one id) is not handed out at all: it is never repaired here.
 *
 * **A part's demand is not read into the template.** Demand is read from non-sealed papers only
 * (F4.11, `[D-262]`; scp.md 3.2, the blueprint row: "a sealed paper as evidence" is refused), and
 * nothing on the client records a seal, which is why no section carries `demands` above. A part's
 * demand record is the same evidence at the part grain, so it is left unread too, and every part of
 * a structured paper reads `not-read` (`./paper-structure.ts`). For the same reason a compound part
 * is not decomposed into two slots: the decomposition is read from its demand verdict. What reads
 * them once a seal is recorded is that bead's change, here and nowhere else.
 */

import type { DocumentStateView, StructureView } from '../outcome/scope-reading-project.js';
import type { ScopePaperStructure } from '../outcome/scope-reading-types.js';
import {
  PAPER_QUESTION_GROUP_KINDS,
  PAPER_STIMULUS_FORMS,
  PAPER_STIMULUS_NOT_IDENTIFIED_REASONS,
  type PaperMarks,
  type PaperQuestionGroup,
  type PaperRecoveredSection,
  type PaperRecoveredSitting,
  type PaperRecoveredStructure,
  type PaperStimulus,
  type PaperStimulusForm,
  type PaperStructureTemplate,
  type PaperTemplatePart,
  type PaperTimeAllowance,
} from './paper-types.js';

/** One past paper revision's stored reading, as the scope-reading projection labels it against what the caller says is current. */
export interface PastPaperStoredReading {
  /** `documentStateView` for the revision the caller says is current. */
  readonly state: DocumentStateView;
  /** `structureView` for the same revision, under the caller's reader policy. */
  readonly structure: StructureView;
}

/** `true` when this reading's count is the paper's count: a current structure over a revision read in full. See the module doc. */
export function pastPaperReadingCounts(reading: PastPaperStoredReading): boolean {
  return (
    reading.structure.status === 'current' &&
    reading.state.status === 'known' &&
    reading.state.state.kind === 'recorded'
  );
}

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);
const isId = (value: unknown): value is string => typeof value === 'string' && value.length > 0;
const isText = (value: unknown): value is string => typeof value === 'string';
const isTextList = (value: unknown): value is readonly string[] =>
  Array.isArray(value) && value.every(isText);
const includes = (list: readonly string[], value: unknown): boolean =>
  typeof value === 'string' && list.includes(value);

function marksOf(value: unknown): PaperMarks | null {
  if (!isObject(value)) return null;
  if (value.status === 'unknown') return { status: 'unknown' };
  if (
    value.status === 'stated' &&
    typeof value.value === 'number' &&
    Number.isFinite(value.value) &&
    value.value >= 0
  ) {
    return { status: 'stated', value: value.value };
  }
  return null;
}

function timeAllowanceOf(value: unknown): PaperTimeAllowance | null {
  if (!isObject(value)) return null;
  if (value.status === 'unknown') return { status: 'unknown' };
  if (
    value.status === 'stated' &&
    typeof value.minutes === 'number' &&
    Number.isFinite(value.minutes) &&
    value.minutes >= 0
  ) {
    return { status: 'stated', minutes: value.minutes };
  }
  return null;
}

/** The three stimulus states, read as stored; anything else is not a stimulus. Anchors are kept as given (the template never reads them). */
function stimulusOf(value: unknown): PaperStimulus<unknown> | null {
  if (!isObject(value)) return null;
  if (value.status === 'identified') {
    return includes(PAPER_STIMULUS_FORMS, value.form)
      ? { status: 'identified', form: value.form as PaperStimulusForm, anchor: value.anchor }
      : null;
  }
  if (value.status === 'none') return { status: 'none' };
  if (value.status !== 'not-identified') return null;
  if (value.form !== undefined && !includes(PAPER_STIMULUS_FORMS, value.form)) return null;
  if (value.reason !== undefined && !includes(PAPER_STIMULUS_NOT_IDENTIFIED_REASONS, value.reason))
    return null;
  return value as PaperStimulus<unknown>;
}

function templateGroupOf(value: unknown): PaperQuestionGroup<unknown> | null {
  if (!isObject(value)) return null;
  if (!isId(value.id) || !includes(PAPER_QUESTION_GROUP_KINDS, value.kind)) return null;
  if (!isText(value.label) || !isTextList(value.memberLabels)) return null;
  if (value.parentGroupId !== undefined && !isId(value.parentGroupId)) return null;
  if (
    value.choose !== undefined &&
    !(typeof value.choose === 'number' && Number.isInteger(value.choose) && value.choose >= 1)
  ) {
    return null;
  }
  const stimulus = stimulusOf(value.stimulus);
  if (stimulus === null) return null;
  return value as unknown as PaperQuestionGroup<unknown>;
}

function templatePartOf(value: unknown): PaperTemplatePart | null {
  if (!isObject(value)) return null;
  if (!isId(value.id) || !isId(value.groupId)) return null;
  if (!isText(value.label) || !isText(value.questionForm)) return null;
  const marks = marksOf(value.marks);
  if (marks === null || !isObject(value.dependsOn)) return null;
  const dependsOn = value.dependsOn;
  let dependency: PaperTemplatePart['dependsOn'];
  if (dependsOn.status === 'unknown') dependency = { status: 'unknown' };
  else if (dependsOn.status === 'stated' && isTextList(dependsOn.onPartIds)) {
    dependency = { status: 'stated', onPartIds: [...dependsOn.onPartIds] };
  } else return null;
  return {
    id: value.id,
    label: value.label,
    groupId: value.groupId,
    questionForm: value.questionForm,
    marks,
    dependsOn: dependency,
  };
}

/**
 * One stored reading's groups and parts as a `PaperStructureTemplate`, or `null` when it carries no
 * groups, no parts, or any group or part that is not well formed, or two groups or two parts that
 * share an id. Never repairs and never throws: stored data is checked only shallowly by the store.
 * Pure.
 */
export function paperStructureTemplateOf(
  reading: ScopePaperStructure,
): PaperStructureTemplate | null {
  const rawGroups: unknown = reading.groups;
  const rawParts: unknown = reading.parts;
  if (!Array.isArray(rawGroups) || !Array.isArray(rawParts)) return null;
  if (rawGroups.length === 0 || rawParts.length === 0) return null;
  const groups: PaperQuestionGroup<unknown>[] = [];
  for (const raw of rawGroups) {
    const group = templateGroupOf(raw);
    if (group === null) return null;
    groups.push(group);
  }
  const parts: PaperTemplatePart[] = [];
  for (const raw of rawParts) {
    const part = templatePartOf(raw);
    if (part === null) return null;
    parts.push(part);
  }
  if (new Set(groups.map((g) => g.id)).size !== groups.length) return null;
  if (new Set(parts.map((p) => p.id)).size !== parts.length) return null;
  const totalMarks = marksOf(reading.totalMarks);
  const timeAllowance = timeAllowanceOf(reading.timeAllowance);
  if (totalMarks === null || timeAllowance === null) return null;
  return { groups, parts, totalMarks, timeAllowance };
}

/**
 * The recovered structure the paper's length is read from, or `null` when no reading counts (none
 * stored, none current, none read in full): the declared standard extent then stands, exactly as
 * with no past papers. Readings keep the caller's order. `template` is the first counted reading's
 * groups and parts that form one (module doc), absent when none does.
 */
export function paperRecoveredStructureFromReadings(
  readings: readonly PastPaperStoredReading[],
): PaperRecoveredStructure | null {
  const sittings: PaperRecoveredSitting[] = [];
  let template: PaperStructureTemplate | null = null;
  for (const reading of readings) {
    if (!pastPaperReadingCounts(reading) || reading.structure.status !== 'current') continue;
    template ??= paperStructureTemplateOf(reading.structure.reading);
    const sections: PaperRecoveredSection[] = reading.structure.reading.sections.map((section) => ({
      label: section.label,
      questionForm: section.questionForm,
      itemCount: section.itemCount,
      marks:
        section.marks.status === 'stated'
          ? { status: 'stated', value: section.marks.value }
          : { status: 'unknown' },
    }));
    sittings.push({ regime: 'unknown', sections });
  }
  if (sittings.length === 0) return null;
  return {
    sittingCount: sittings.length,
    currentCount: 0,
    historicalCount: 0,
    sittings,
    ...(template !== null ? { template } : {}),
  };
}
