/**
 * Pure logic over the structured paper shape (`./paper-types.ts`, `[D-430]`, ruled 2026-09-29,
 * decision sheet row 17): validation, dependency order, empty propagation, marks, completion,
 * yield against the original structure, and the reuse fingerprint. No I/O, no clock, no model call.
 *
 * **Why this is its own module.** The composition that builds a structured blueprint
 * (`./paper-blueprint.ts`, another lane's file) and the journal that resumes an unfinished paper
 * (`./paper-journal.ts`) both need the same answers to the same questions — "is this shape
 * well-formed", "in what order are parts authored", "which parts end empty and why", "is this paper
 * complete or a qualified partial", "may this journal be resumed" — and two copies of those answers
 * is how a paper and its journal end up disagreeing. They live here once.
 *
 * **What the ruling asked for, and where it is answered.**
 *
 * - *A dependent of an empty part ends empty and is never filled standalone as though independent*
 *   (scp.md 2.6): `propagatePaperEmptiness`.
 * - *A group that needs a stimulus and holds none is a named empty group*: the same function.
 * - *Unknown stays unknown; a total that disagrees with its parts becomes unknown, never corrected;
 *   an answer-k-of-n group counts k, read before any sum*: `countedPaperMarks` and
 *   `reconcilePaperStructureMarks`.
 * - *An explicitly qualified partial paper (a source gap or a capability gap) stays distinct from an
 *   outage*: `classifyPaperCompletion` knows only reasons about her material and the generators; an
 *   outage has no reason code to classify, so it can never be counted here.
 * - *Reuse checks compatible source versions, scope, structure and authoring specification, not
 *   merely unchanged course settings*: `paperReuseFingerprint` takes exactly those four inputs and
 *   `comparePaperReuseFingerprints` names which of them changed.
 * - *`[D-438]` conditions 3 and 4* — an unmet part keeps its original demand; yield is reported
 *   against the original structure: `PaperStructuredPart.demand` is never replaced, and
 *   `paperYieldAgainstStructure` divides by the extent target, not by what was serviceable.
 * - *`[D-559]`: the paper written in its structured form from her stored reading*
 *   (`ol-egov.141.89.7.93`): `selectPaperTemplateParts`, `buildStructuredPaperShape` and
 *   `planStructuredPaper`, in the last section, with the part-to-slot rule stated there. A shape is
 *   recorded on the journal (`./paper-journal.ts`, `[D-560]`), and read back through
 *   `isRecordedPaperStructuredShape`.
 */

import { hashText } from '../ingestion/hash.js';
import { canonicalJson } from '../outcome/canonical-json.js';
import { paperBlueprintCandidateSlotIds } from './paper-blueprint.js';
import {
  PAPER_DEMANDS,
  PAPER_QUESTION_GROUP_KINDS,
  PAPER_STIMULUS_FORMS,
  PAPER_STRUCTURE_FORMAT_VERSION,
  type PaperBlueprint,
  type PaperBlueprintSlot,
  type PaperEmptySlot,
  type PaperEmptySlotReasonCode,
  type PaperExtent,
  type PaperFormatClass,
  type PaperGapKind,
  type PaperGeneratorTaskId,
  type PaperGroupStimulusNeed,
  type PaperHeldStimulus,
  type PaperIntendedDemandBasis,
  type PaperMarks,
  type PaperPartDemandReading,
  type PaperPartDependency,
  type PaperPurpose,
  type PaperQuestionGroup,
  type PaperReuseFingerprint,
  type PaperStimulusForm,
  type PaperStructuredGroup,
  type PaperStructuredPart,
  type PaperStructuredSection,
  type PaperStructuredShape,
  type PaperStructureTemplate,
  type PaperTemplatePart,
} from './paper-types.js';

// --------------------------------------------------------------------------------------------
// Validation
// --------------------------------------------------------------------------------------------

export type PaperStructureProblemCode =
  | 'duplicate-slot-id'
  | 'duplicate-group-id'
  | 'part-group-unknown'
  | 'group-member-mismatch'
  | 'part-not-in-group'
  | 'group-parent-unknown'
  | 'group-cycle'
  | 'group-section-unknown'
  | 'section-group-unknown'
  | 'dependency-unknown'
  | 'self-dependency'
  | 'forward-dependency'
  | 'empty-dependency'
  | 'choice-out-of-range'
  | 'choice-alternatives-mismatch'
  | 'choice-on-non-choice-group'
  | 'marks-invalid'
  /** `buildStructuredPaperShape`: no part was chosen to compose, or a chosen part is not in the template. */
  | 'no-parts'
  /** `buildStructuredPaperShape`: fewer candidate slots than chosen parts, so a part would have no concept. */
  | 'slots-short';

export interface PaperStructureProblem {
  readonly code: PaperStructureProblemCode;
  /** Structural ids only — never a label, so a problem is safe to log (D-005). */
  readonly detail: string;
}

function marksInvalid(marks: PaperMarks): boolean {
  return marks.status === 'stated' && !(Number.isFinite(marks.value) && marks.value >= 0);
}

/**
 * Every way `shape` fails to be a well-formed paper structure, or an empty list. Never throws: a
 * corrupt shape read off disk is reported, not fatal, so a caller decides whether to use it.
 *
 * "Earlier" in the forward-dependency rule means earlier in `shape.parts`, the printed order: a
 * dependency always points backwards, which is also what makes the dependency graph acyclic.
 */
export function validatePaperStructure(
  shape: PaperStructuredShape,
): readonly PaperStructureProblem[] {
  const problems: PaperStructureProblem[] = [];
  const add = (code: PaperStructureProblemCode, detail: string): void => {
    problems.push({ code, detail });
  };

  const partIndex = new Map<string, number>();
  shape.parts.forEach((p, index) => {
    if (partIndex.has(p.slotId)) add('duplicate-slot-id', p.slotId);
    else partIndex.set(p.slotId, index);
  });

  const groupById = new Map<string, PaperStructuredGroup>();
  for (const g of shape.groups) {
    if (groupById.has(g.groupId)) add('duplicate-group-id', g.groupId);
    else groupById.set(g.groupId, g);
  }
  const sectionIds = new Set(shape.sections.map((s) => s.sectionId));

  for (const p of shape.parts) {
    const g = groupById.get(p.groupId);
    if (g === undefined) {
      add('part-group-unknown', p.slotId);
      continue;
    }
    if (!g.slotIds.includes(p.slotId)) add('part-not-in-group', p.slotId);
    if (marksInvalid(p.marks)) add('marks-invalid', p.slotId);
    if (p.dependsOn.status === 'stated') {
      if (p.dependsOn.onSlotIds.length === 0) add('empty-dependency', p.slotId);
      const own = partIndex.get(p.slotId) ?? -1;
      for (const dep of p.dependsOn.onSlotIds) {
        const at = partIndex.get(dep);
        if (dep === p.slotId) add('self-dependency', p.slotId);
        else if (at === undefined) add('dependency-unknown', `${p.slotId}->${dep}`);
        else if (at > own) add('forward-dependency', `${p.slotId}->${dep}`);
      }
    }
  }

  for (const g of shape.groups) {
    for (const slotId of g.slotIds) {
      const p = shape.parts.find((candidate) => candidate.slotId === slotId);
      if (p === undefined || p.groupId !== g.groupId)
        add('group-member-mismatch', `${g.groupId}:${slotId}`);
    }
    if (g.parentGroupId !== undefined && !groupById.has(g.parentGroupId)) {
      add('group-parent-unknown', g.groupId);
    }
    if (g.sectionId !== null && !sectionIds.has(g.sectionId))
      add('group-section-unknown', g.groupId);
    if (g.choice !== undefined) {
      if (g.kind !== 'choice') add('choice-on-non-choice-group', g.groupId);
      const { alternatives, choose } = g.choice;
      if (choose !== null && !(choose >= 1 && choose <= alternatives)) {
        add('choice-out-of-range', g.groupId);
      }
      const members =
        g.slotIds.length + shape.groups.filter((child) => child.parentGroupId === g.groupId).length;
      if (alternatives !== members) add('choice-alternatives-mismatch', g.groupId);
    }
  }

  for (const g of shape.groups) {
    const seen = new Set<string>();
    let at: PaperStructuredGroup | undefined = g;
    while (at?.parentGroupId !== undefined) {
      if (seen.has(at.groupId)) {
        add('group-cycle', g.groupId);
        break;
      }
      seen.add(at.groupId);
      at = groupById.get(at.parentGroupId);
    }
  }

  for (const s of shape.sections) {
    for (const groupId of s.groupIds)
      if (!groupById.has(groupId)) add('section-group-unknown', `${s.sectionId}:${groupId}`);
    if (marksInvalid(s.marks)) add('marks-invalid', s.sectionId);
  }
  if (marksInvalid(shape.totalMarks)) add('marks-invalid', 'total');

  return problems;
}

// --------------------------------------------------------------------------------------------
// Dependency order and empty propagation
// --------------------------------------------------------------------------------------------

/**
 * The parts in authoring order: a part after every part it states a dependency on, otherwise the
 * printed order (a stable topological order). **An unknown dependency adds no edge** — unknown is
 * not independent, but it is not evidence of order either. A cycle (which `validatePaperStructure`
 * refuses) cannot lose a part: its members follow the acyclic remainder in printed order.
 */
export function paperPartsInDependencyOrder(
  shape: PaperStructuredShape,
): readonly PaperStructuredPart[] {
  const known = new Set(shape.parts.map((p) => p.slotId));
  const placed = new Set<string>();
  const out: PaperStructuredPart[] = [];
  const dependenciesOf = (p: PaperStructuredPart): readonly string[] =>
    p.dependsOn.status === 'stated'
      ? p.dependsOn.onSlotIds.filter((id) => known.has(id) && id !== p.slotId)
      : [];

  while (out.length < shape.parts.length) {
    const next = shape.parts.find(
      (p) => !placed.has(p.slotId) && dependenciesOf(p).every((id) => placed.has(id)),
    );
    const chosen = next ?? shape.parts.find((p) => !placed.has(p.slotId));
    if (chosen === undefined) break;
    placed.add(chosen.slotId);
    out.push(chosen);
  }
  return out;
}

/** Why one part ended empty — the slice of `PaperEmptySlot` that does not need the slot's concept. */
export interface PaperEmptyOutcome {
  readonly reasonCode: PaperEmptySlotReasonCode;
  readonly reason: string;
  readonly causedBySlotId?: string;
}

function descendantGroupIds(shape: PaperStructuredShape, groupId: string): Set<string> {
  const out = new Set<string>([groupId]);
  let grew = true;
  while (grew) {
    grew = false;
    for (const g of shape.groups) {
      if (g.parentGroupId !== undefined && out.has(g.parentGroupId) && !out.has(g.groupId)) {
        out.add(g.groupId);
        grew = true;
      }
    }
  }
  return out;
}

/**
 * Every part that ends empty, with its reason, given the parts that were already empty for their
 * own reasons (`ownEmpty`: rank exclusion, an unserved demand, no held source — decided before this
 * function, in that order).
 *
 * 1. **No held stimulus.** A group in `noneHeldGroupIds` — one the composition's stimulus lookup
 *    looked for in her held material and found nothing for (`[D-562]`) — whose need is `'needed'`
 *    and whose held stimulus is `null` names every part in it, nested groups included,
 *    `no-held-stimulus` — unless the part already has an earlier reason of its own, which wins
 *    (`[D-438]` sections 5.4: rank, demand, source, then stimulus). **Only such a group**
 *    (`ol-egov.141.89.7.93`): a needed group the lookup did not look for (a figure, a group with no
 *    form, or no lookup wired at all) is not named, because not looking is not finding none; its
 *    parts are written without shared material (`PaperStructuredGroup.heldStimulus`'s doc). So
 *    with no set given, rule 1 names nothing. A group whose need is `'not-needed'` or
 *    `'not-identified'` names nothing either: not knowing whether a stimulus is needed is not a
 *    reason to refuse the group.
 * 2. **Depends on an empty part.** In dependency order, a part that states a dependency on any
 *    empty part ends `depends-on-empty-part`, with `causedBySlotId` the root of the chain (the
 *    first empty dependency, or that dependency's own root). It is never filled standalone as
 *    though it were independent. An unknown dependency propagates nothing.
 *
 * Pure: returns a new map (`ownEmpty` is not modified); iteration order is dependency order after
 * the caller's own entries.
 */
export function propagatePaperEmptiness(
  shape: PaperStructuredShape,
  ownEmpty: ReadonlyMap<string, PaperEmptyOutcome>,
  noneHeldGroupIds: ReadonlySet<string> = new Set(),
): ReadonlyMap<string, PaperEmptyOutcome> {
  const out = new Map(ownEmpty);

  for (const g of shape.groups) {
    if (g.stimulusNeed.status !== 'needed' || g.heldStimulus !== null) continue;
    if (!noneHeldGroupIds.has(g.groupId)) continue;
    const inside = descendantGroupIds(shape, g.groupId);
    for (const p of shape.parts) {
      if (!inside.has(p.groupId) || out.has(p.slotId)) continue;
      out.set(p.slotId, {
        reasonCode: 'no-held-stimulus',
        reason: 'the group needs a shared stimulus and no held source supplies one',
      });
    }
  }

  for (const p of paperPartsInDependencyOrder(shape)) {
    if (out.has(p.slotId) || p.dependsOn.status !== 'stated') continue;
    const emptyDependency = p.dependsOn.onSlotIds.find((id) => out.has(id));
    if (emptyDependency === undefined) continue;
    const dependency = out.get(emptyDependency);
    const root =
      dependency?.reasonCode === 'depends-on-empty-part' && dependency.causedBySlotId !== undefined
        ? dependency.causedBySlotId
        : emptyDependency;
    out.set(p.slotId, {
      reasonCode: 'depends-on-empty-part',
      reason: 'the part depends on an earlier part that ended empty',
      causedBySlotId: root,
    });
  }
  return out;
}

// --------------------------------------------------------------------------------------------
// Marks
// --------------------------------------------------------------------------------------------

const UNKNOWN_MARKS: PaperMarks = { status: 'unknown' };

function sumMarks(parts: readonly PaperMarks[]): PaperMarks {
  let total = 0;
  for (const m of parts) {
    if (m.status !== 'stated') return UNKNOWN_MARKS;
    total += m.value;
  }
  return { status: 'stated', value: total };
}

export interface PaperCountedMarks {
  /** The marks the paper's parts add up to, per section, read after the answer-k-of-n rule. */
  readonly sections: ReadonlyMap<string, PaperMarks>;
  readonly total: PaperMarks;
}

/**
 * The marks the parts add up to — and only the parts: a stated section or paper total is never an
 * input here, so a total cannot vouch for itself. A group counts the sum of what it holds, except a
 * choice group, which counts `k` alternatives (`choose`), and only when every alternative is worth
 * the same, because "k of n" with unequal alternatives has no single total. Anything unknown inside
 * makes what contains it unknown; nothing unknown is ever counted as zero.
 */
export function countedPaperMarks(shape: PaperStructuredShape): PaperCountedMarks {
  const groupById = new Map(shape.groups.map((g) => [g.groupId, g] as const));
  const partById = new Map(shape.parts.map((p) => [p.slotId, p] as const));
  const cache = new Map<string, PaperMarks>();

  const counted = (groupId: string, visiting: ReadonlySet<string>): PaperMarks => {
    const cached = cache.get(groupId);
    if (cached !== undefined) return cached;
    const g = groupById.get(groupId);
    if (g === undefined || visiting.has(groupId)) return UNKNOWN_MARKS;
    const next = new Set(visiting).add(groupId);
    const members: PaperMarks[] = [
      ...g.slotIds.map((id) => partById.get(id)?.marks ?? UNKNOWN_MARKS),
      ...shape.groups
        .filter((child) => child.parentGroupId === groupId)
        .map((child) => counted(child.groupId, next)),
    ];
    let result: PaperMarks;
    if (g.choice === undefined) {
      result = sumMarks(members);
    } else if (g.choice.choose === null || members.length === 0) {
      result = UNKNOWN_MARKS;
    } else {
      const first = members[0];
      const allEqual =
        first !== undefined &&
        first.status === 'stated' &&
        members.every((m) => m.status === 'stated' && m.value === first.value);
      result =
        allEqual && first.status === 'stated'
          ? { status: 'stated', value: first.value * g.choice.choose }
          : UNKNOWN_MARKS;
    }
    cache.set(groupId, result);
    return result;
  };

  const sections = new Map<string, PaperMarks>();
  for (const s of shape.sections) {
    sections.set(s.sectionId, sumMarks(s.groupIds.map((id) => counted(id, new Set()))));
  }
  const topLevel = shape.groups.filter((g) => g.parentGroupId === undefined);
  return { sections, total: sumMarks(topLevel.map((g) => counted(g.groupId, new Set()))) };
}

export interface PaperMarksDisagreements {
  readonly sectionIds: readonly string[];
  readonly total: boolean;
}

/**
 * The shape with any stated section or paper total that DISAGREES with its counted parts turned to
 * unknown — never corrected to the counted value, and never filled in where the paper printed none
 * (scp.md 2.6: "a total that disagrees with the template becomes unknown, never corrected"). A
 * stated total that cannot be checked because its parts include an unknown stays as stated: the
 * paper printed it, and nothing shows it wrong.
 */
export function reconcilePaperStructureMarks(shape: PaperStructuredShape): {
  readonly shape: PaperStructuredShape;
  readonly disagreements: PaperMarksDisagreements;
} {
  const counted = countedPaperMarks(shape);
  const disagrees = (printed: PaperMarks, sum: PaperMarks | undefined): boolean =>
    printed.status === 'stated' &&
    sum !== undefined &&
    sum.status === 'stated' &&
    printed.value !== sum.value;

  const sectionIds: string[] = [];
  const sections = shape.sections.map((s) => {
    if (!disagrees(s.marks, counted.sections.get(s.sectionId))) return s;
    sectionIds.push(s.sectionId);
    return { ...s, marks: UNKNOWN_MARKS };
  });
  const total = disagrees(shape.totalMarks, counted.total);
  return {
    shape: { ...shape, sections, totalMarks: total ? UNKNOWN_MARKS : shape.totalMarks },
    disagreements: { sectionIds, total },
  };
}

// --------------------------------------------------------------------------------------------
// Completion, yield and demand basis
// --------------------------------------------------------------------------------------------

/** A reason code the completion rule can classify: the union, plus `[D-438]`'s, which joins it with the demand-carriage build. */
export type PaperClassifiableReasonCode = PaperEmptySlotReasonCode | 'source-support-refused';

type GapClassification = PaperGapKind | 'extent' | 'inherited';

const GAP_KIND_BY_REASON: Readonly<Record<PaperClassifiableReasonCode, GapClassification>> = {
  'no-held-source': 'source',
  'no-held-stimulus': 'source',
  'source-support-refused': 'source',
  'generator-refused': 'source',
  'demand-unsupported': 'capability',
  'rank-excluded': 'extent',
  'depends-on-empty-part': 'inherited',
};

/**
 * What kind of shortfall a reason code is. `'extent'` (rank exclusion) is the paper's size, not a
 * gap in her material or the generators; `'inherited'` (a dependent) takes its root's kind. A
 * reason this table does not know classifies as `'source'` — the conservative reading, since a
 * paper with an unexplained hole must be labelled a qualified partial rather than complete.
 */
export function emptySlotGapKind(reasonCode: PaperClassifiableReasonCode): GapClassification {
  return GAP_KIND_BY_REASON[reasonCode] ?? 'source';
}

/**
 * A finished paper's completeness from the slots that ended empty. `'complete'` when no empty slot
 * is a source or capability gap; otherwise a qualified partial naming which of the two kinds
 * qualify it. **An outage never reaches this function**: it has no reason code, because an outage
 * is work owed, and a paper with work owed is not finished (`./paper-journal.ts`).
 */
export function classifyPaperCompletion(
  emptySlots: readonly (Pick<PaperEmptySlot, 'slotId' | 'causedBySlotId'> & {
    readonly reasonCode: PaperClassifiableReasonCode;
  })[],
):
  | { readonly status: 'complete' }
  | { readonly status: 'qualified-partial'; readonly gaps: readonly PaperGapKind[] } {
  const byId = new Map(emptySlots.map((e) => [e.slotId, e] as const));
  const kinds = new Set<PaperGapKind>();
  for (const e of emptySlots) {
    let kind = emptySlotGapKind(e.reasonCode);
    if (kind === 'inherited') {
      const root = e.causedBySlotId === undefined ? undefined : byId.get(e.causedBySlotId);
      kind = root === undefined ? 'source' : emptySlotGapKind(root.reasonCode);
      if (kind === 'inherited') kind = 'source';
    }
    if (kind === 'source' || kind === 'capability') kinds.add(kind);
  }
  if (kinds.size === 0) return { status: 'complete' };
  return { status: 'qualified-partial', gaps: [...kinds].sort() };
}

/**
 * `[D-438]` condition 4: yield against the ORIGINAL structure. One filled slot of eight is one
 * eighth however the other seven were lost, so excluding unserviceable slots from the denominator
 * can never produce a good figure for a paper that covers little of the intended assessment. `null`
 * when the structure named no slots: no figure is better than an invented one.
 */
export function paperYieldAgainstStructure(
  structureSlotCount: number,
  filled: number,
): { readonly structureSlots: number; readonly filled: number; readonly yield: number | null } {
  return {
    structureSlots: structureSlotCount,
    filled,
    yield: structureSlotCount > 0 ? filled / structureSlotCount : null,
  };
}

/** `[D-438]` P1's per-part basis: `'read'` when the paper's own reading supplied the demand (a decided demand or an unsupported operation), `'not-read'` for cannot-tell and pending. */
export function paperIntendedDemandBasis(demand: PaperPartDemandReading): PaperIntendedDemandBasis {
  return demand.status === 'read' || demand.status === 'unsupported' ? 'read' : 'not-read';
}

// --------------------------------------------------------------------------------------------
// The reuse fingerprint
// --------------------------------------------------------------------------------------------

export interface PaperReuseSlotPlanEntry {
  readonly slotId: string;
  readonly conceptKey: string;
  readonly taskId: PaperGeneratorTaskId;
}

/** The four inputs a resumed paper must agree on. There is deliberately no field for "course settings unchanged". */
export interface PaperReuseInputs {
  /**
   * Every held source a slot grounds in, and every structure-reading revision the template came
   * from. **Not the reading a structured paper was shaped on** (`[D-560]`, David 2026-10-21): an
   * unfinished paper resumes on its own recorded structure even when her past-paper reading has
   * changed, so the plugin's composition puts in the slots' sources and any shared passage a group
   * was given, never the reading's revision (`packages/plugin/src/paper/journal-composition.ts`).
   */
  readonly sourceVersions: readonly {
    readonly sourceId: string;
    readonly revisionDigest: string;
  }[];
  readonly scope: {
    readonly eligibleConceptKeys: readonly string[];
    readonly outcomes: readonly {
      readonly outcomeId: string;
      readonly conceptKeys: readonly string[];
    }[];
  };
  readonly structure: {
    readonly shape: PaperStructuredShape;
    /** In authoring order: order is part of the structure. */
    readonly slotPlan: readonly PaperReuseSlotPlanEntry[];
  };
  readonly authoringSpec: {
    readonly purpose: PaperPurpose;
    readonly extent: PaperExtent | null;
    readonly emphasis: string | null;
    readonly alpha: number;
    readonly formatClass: PaperFormatClass;
    readonly generatorTasks: readonly PaperGeneratorTaskId[];
  };
}

const sorted = (values: readonly string[]): string[] => [...values].sort();

/**
 * The four digests. Order-insensitive where order is not meaning (sources, concept keys, outcomes,
 * generator tasks), order-sensitive where it is (the slot plan). A digest is the SHA-256 of the
 * canonical JSON text of its input (`../outcome/canonical-json.ts`), so two devices agree.
 */
export async function paperReuseFingerprint(
  inputs: PaperReuseInputs,
): Promise<PaperReuseFingerprint> {
  const sourceVersions = [...inputs.sourceVersions].sort((a, b) =>
    a.sourceId < b.sourceId
      ? -1
      : a.sourceId > b.sourceId
        ? 1
        : a.revisionDigest < b.revisionDigest
          ? -1
          : 1,
  );
  const scope = {
    eligibleConceptKeys: sorted(inputs.scope.eligibleConceptKeys),
    outcomes: [...inputs.scope.outcomes]
      .map((o) => ({ outcomeId: o.outcomeId, conceptKeys: sorted(o.conceptKeys) }))
      .sort((a, b) => (a.outcomeId < b.outcomeId ? -1 : a.outcomeId > b.outcomeId ? 1 : 0)),
  };
  const authoringSpec = {
    ...inputs.authoringSpec,
    generatorTasks: sorted([...new Set(inputs.authoringSpec.generatorTasks)]),
  };
  const [sourceDigest, scopeDigest, structureDigest, authoringDigest] = await Promise.all([
    hashText(canonicalJson(sourceVersions)),
    hashText(canonicalJson(scope)),
    hashText(canonicalJson(inputs.structure)),
    hashText(canonicalJson(authoringSpec)),
  ]);
  return {
    sourceVersions: sourceDigest,
    scope: scopeDigest,
    structure: structureDigest,
    authoringSpec: authoringDigest,
  };
}

/** One digest over all four: the blueprint digest a journal is keyed by (scp.md 2.6). */
export async function paperBlueprintDigest(fingerprint: PaperReuseFingerprint): Promise<string> {
  return hashText(canonicalJson(fingerprint));
}

const FINGERPRINT_COMPONENTS = ['sourceVersions', 'scope', 'structure', 'authoringSpec'] as const;

export type PaperReuseComparison =
  | { readonly compatible: true }
  | { readonly compatible: false; readonly changed: readonly (keyof PaperReuseFingerprint)[] };

/** Whether a saved fingerprint may be resumed against the current one, and if not, exactly which of the four components differ. */
export function comparePaperReuseFingerprints(
  saved: PaperReuseFingerprint,
  current: PaperReuseFingerprint,
): PaperReuseComparison {
  const changed = FINGERPRINT_COMPONENTS.filter(
    (component) => saved[component] !== current[component],
  );
  return changed.length === 0 ? { compatible: true } : { compatible: false, changed };
}

// --------------------------------------------------------------------------------------------
// Composing a structured paper from a stored reading (`[D-559]`, `ol-egov.141.89.7.93`)
// --------------------------------------------------------------------------------------------
//
// **The part-to-slot rule, in plain English.**
//
// 1. *Which questions the paper takes.* A paper takes whole questions only. A question is the
//    outermost group a part sits in that is not a section (a parent question, a choice, or a shared
//    stimulus, with everything inside it); a part that sits directly in a section, or in no group
//    above its own, is a question on its own. Questions are taken in printed order, each only if it
//    fits in what is left of the paper's length (the blueprint's candidates: its slot cap, or fewer
//    when fewer concepts are eligible) and only if every dependency it states falls on a part
//    already taken or earlier in itself. A question that does not fit, or that depends on a part not
//    taken, is skipped and the next is tried. Nothing is split: a choice keeps all its alternatives.
// 2. *Which concept fills which part.* The parts that state no dependency, in printed order, take
//    the blueprint's candidates in ranking order: the first such part the top-ranked concept, and so
//    on (`paperBlueprintCandidateSlotIds`). So such a part's slot id is that candidate's slot id, and
//    a part whose candidate the blueprint left empty (no held source, an unserved demand) is empty
//    for that reason. **A part that states a dependency is about the concept of the first part it
//    depends on** (in printed order; through a chain, the chain's first part's concept): it builds
//    on that part, so it asks about the same thing (`[D-561]`; Class B, flagged on
//    `ol-egov.141.89.7.93`). It takes one of the candidates left after the parts that state none,
//    the lowest-ranked last, as its slot id only (`paperPartConceptSlotIds`), and
//    `planStructuredPaper` writes it from its earlier part's concept. The candidate whose slot id it
//    took no longer reaches the paper, and is named rank-excluded there, never silently dropped
//    (`[D-258]`). Weighting a part by the concepts aligned to its question (scp.md S.14) needs
//    alignment results, which production does not write yet: today's ranking order is used instead
//    (Class B, flagged on the bead).
// 3. *What a part carries.* Its group, label, question form and marks as the reading states them;
//    its dependencies, mapped from the reading's part ids to slot ids (unknown stays unknown); and a
//    demand of `not-read`, because a part's demand is not read into the paper while no seal is
//    recorded (`./paper-recovered-structure.ts`).
// 4. *What a group carries.* Its kind, label and parent; the parts it directly holds; for a choice,
//    `{ alternatives: how many members the paper prints, choose: k or null }`; its stimulus need
//    (identified: needed, with its form; none: not needed; not identified: not identified); and no
//    held stimulus until the composition's lookup supplies one (`withPaperHeldStimuli`). The
//    reading's sections and its section groups share no id, so a section group stays a group and the
//    shape's `sections` list is empty.
// 5. *Totals.* The printed total and time allowance are kept only when the paper takes every part of
//    the reading; a paper of some of its questions prints neither (unknown, never filled in). A total
//    that disagrees with its parts becomes unknown (`reconcilePaperStructureMarks`).
// 6. *A shape that does not hold together is never used.* A template whose parts name an unknown
//    group, whose groups nest in a cycle, or whose built shape `validatePaperStructure` refuses is
//    refused here, and the caller composes the flat paper instead: nothing here throws at her.

const UNKNOWN_DEPENDENCY: PaperPartDependency = { status: 'unknown' };

/** The parts of one question, in printed order, as `selectPaperTemplateParts` takes them. */
function templateQuestions(template: PaperStructureTemplate): readonly (readonly string[])[] {
  const groupById = new Map(template.groups.map((g) => [g.id, g] as const));
  const questionOf = (part: PaperTemplatePart): string => {
    const own = groupById.get(part.groupId);
    if (own === undefined || own.kind === 'section') return `part:${part.id}`;
    let top = own;
    const seen = new Set<string>([own.id]);
    while (top.parentGroupId !== undefined) {
      const parent = groupById.get(top.parentGroupId);
      if (parent === undefined || parent.kind === 'section' || seen.has(parent.id)) break;
      seen.add(parent.id);
      top = parent;
    }
    return `group:${top.id}`;
  };
  const questions = new Map<string, string[]>();
  for (const part of template.parts) {
    const key = questionOf(part);
    const parts = questions.get(key) ?? [];
    parts.push(part.id);
    questions.set(key, parts);
  }
  return [...questions.values()];
}

/**
 * The template's part ids the paper takes, in printed order, at most `budget` of them: whole
 * questions in printed order, each only if it fits and its stated dependencies fall on parts taken
 * already or earlier in itself (rule 1 above). `[]` when no question fits. Pure.
 */
export function selectPaperTemplateParts(
  template: PaperStructureTemplate,
  budget: number,
): readonly string[] {
  const partById = new Map(template.parts.map((p) => [p.id, p] as const));
  const taken = new Set<string>();
  for (const question of templateQuestions(template)) {
    if (taken.size + question.length > budget) continue;
    const within = new Set<string>();
    let closed = true;
    for (const id of question) {
      const dependsOn: PaperTemplatePart['dependsOn'] = partById.get(id)?.dependsOn ?? {
        status: 'unknown',
      };
      if (dependsOn.status === 'stated') {
        if (dependsOn.onPartIds.length === 0) closed = false;
        for (const dependency of dependsOn.onPartIds) {
          if (dependency === id || !(taken.has(dependency) || within.has(dependency))) {
            closed = false;
          }
        }
      }
      within.add(id);
    }
    if (!closed) continue;
    for (const id of question) taken.add(id);
  }
  return template.parts.filter((p) => taken.has(p.id)).map((p) => p.id);
}

/** The group's stimulus at the paper grain: rule 4's three-way mapping, never collapsed. */
function stimulusNeedOf(group: PaperQuestionGroup<unknown>): PaperGroupStimulusNeed {
  if (group.stimulus.status === 'identified') {
    return { status: 'needed', form: group.stimulus.form };
  }
  return group.stimulus.status === 'none' ? { status: 'not-needed' } : { status: 'not-identified' };
}

export type StructuredPaperShapeResult =
  | { readonly status: 'built'; readonly shape: PaperStructuredShape }
  | { readonly status: 'refused'; readonly problems: readonly PaperStructureProblem[] };

/**
 * The structured shape of a paper that takes `partIds` of `template` (rule 1's choice, in printed
 * order), its parts filling `candidateSlotIds` in order (rule 2). Every group's held stimulus is
 * `null`: the composition's lookup fills it (`withPaperHeldStimuli`). Refused, never thrown, when
 * the template does not hold together or the built shape is not well formed (rule 6). Pure.
 */
export function buildStructuredPaperShape(
  template: PaperStructureTemplate,
  partIds: readonly string[],
  candidateSlotIds: readonly string[],
): StructuredPaperShapeResult {
  const problems: PaperStructureProblem[] = [];
  const refuse = (code: PaperStructureProblemCode, detail: string): StructuredPaperShapeResult => {
    problems.push({ code, detail });
    return { status: 'refused', problems };
  };

  const groupById = new Map<string, PaperQuestionGroup<unknown>>();
  for (const g of template.groups) {
    if (groupById.has(g.id)) return refuse('duplicate-group-id', g.id);
    groupById.set(g.id, g);
  }
  const partById = new Map<string, PaperTemplatePart>();
  for (const p of template.parts) {
    if (partById.has(p.id)) return refuse('duplicate-slot-id', p.id);
    if (!groupById.has(p.groupId)) return refuse('part-group-unknown', p.id);
    partById.set(p.id, p);
  }
  for (const g of template.groups) {
    const seen = new Set<string>([g.id]);
    let at = g;
    while (at.parentGroupId !== undefined) {
      const parent = groupById.get(at.parentGroupId);
      if (parent === undefined) return refuse('group-parent-unknown', at.id);
      if (seen.has(parent.id)) return refuse('group-cycle', g.id);
      seen.add(parent.id);
      at = parent;
    }
  }
  if (partIds.length === 0) return refuse('no-parts', 'none chosen');
  if (partIds.some((id) => !partById.has(id))) return refuse('no-parts', 'not in the template');
  if (candidateSlotIds.length < partIds.length) {
    return refuse('slots-short', `${candidateSlotIds.length}<${partIds.length}`);
  }

  const chosen = new Set(partIds);
  const slotOfPart = new Map<string, string>();
  // Rule 2: the parts that state no dependency take the candidates in ranking order first; a part
  // that states one takes a candidate after them, its concept being its earlier part's.
  const chosenParts = template.parts.filter((p) => chosen.has(p.id));
  const statesDependency = (p: PaperTemplatePart): boolean =>
    p.dependsOn.status === 'stated' && p.dependsOn.onPartIds.length > 0;
  [
    ...chosenParts.filter((p) => !statesDependency(p)),
    ...chosenParts.filter(statesDependency),
  ].forEach((p, index) => {
    const slotId = candidateSlotIds[index];
    if (slotId !== undefined) slotOfPart.set(p.id, slotId);
  });

  const parts: PaperStructuredPart[] = [];
  for (const p of template.parts) {
    const slotId = slotOfPart.get(p.id);
    if (slotId === undefined) continue;
    let dependsOn: PaperPartDependency = UNKNOWN_DEPENDENCY;
    if (p.dependsOn.status === 'stated') {
      const onSlotIds: string[] = [];
      for (const dependency of p.dependsOn.onPartIds) {
        const on = slotOfPart.get(dependency);
        if (on === undefined) return refuse('dependency-unknown', slotId);
        onSlotIds.push(on);
      }
      dependsOn = { status: 'stated', onSlotIds };
    }
    parts.push({
      slotId,
      groupId: p.groupId,
      label: p.label,
      questionForm: p.questionForm,
      marks: p.marks,
      dependsOn,
      demand: { status: 'not-read' },
    });
  }

  const included = new Set<string>();
  for (const p of parts) {
    let at: string | undefined = p.groupId;
    while (at !== undefined && !included.has(at)) {
      included.add(at);
      at = groupById.get(at)?.parentGroupId;
    }
  }
  const groups: PaperStructuredGroup[] = template.groups
    .filter((g) => included.has(g.id))
    .map((g) => ({
      groupId: g.id,
      kind: g.kind,
      sectionId: null,
      ...(g.parentGroupId !== undefined ? { parentGroupId: g.parentGroupId } : {}),
      label: g.label,
      slotIds: parts.filter((p) => p.groupId === g.id).map((p) => p.slotId),
      ...(g.kind === 'choice'
        ? { choice: { alternatives: g.memberLabels.length, choose: g.choose ?? null } }
        : {}),
      stimulusNeed: stimulusNeedOf(g),
      heldStimulus: null,
    }));

  const whole = parts.length === template.parts.length;
  const built: PaperStructuredShape = {
    formatVersion: PAPER_STRUCTURE_FORMAT_VERSION,
    structureBasis: 'current-or-transitional',
    structureSlotCount: parts.length,
    sections: [],
    groups,
    parts,
    totalMarks: whole ? template.totalMarks : UNKNOWN_MARKS,
    timeAllowance: whole ? template.timeAllowance : { status: 'unknown' },
  };
  const { shape } = reconcilePaperStructureMarks(built);
  const invalid = validatePaperStructure(shape);
  if (invalid.length > 0) return { status: 'refused', problems: invalid };
  return { status: 'built', shape };
}

/** A group of the shape whose template needs shared material, with every slot inside it (nested groups included) in printed order. */
export interface PaperGroupNeedingStimulus {
  readonly groupId: string;
  readonly form: PaperStimulusForm | null;
  readonly slotIds: readonly string[];
}

/** The groups the composition's stimulus lookup is asked about (`[D-562]`): every group whose need is `'needed'`, in the shape's order. */
export function paperGroupsNeedingStimulus(
  shape: PaperStructuredShape,
): readonly PaperGroupNeedingStimulus[] {
  return shape.groups.flatMap((g) => {
    if (g.stimulusNeed.status !== 'needed') return [];
    const inside = descendantGroupIds(shape, g.groupId);
    return [
      {
        groupId: g.groupId,
        form: g.stimulusNeed.form,
        slotIds: shape.parts.filter((p) => inside.has(p.groupId)).map((p) => p.slotId),
      },
    ];
  });
}

/** The shape with each needed group in `held` given that held stimulus; every other group is left as it is. Pure. */
export function withPaperHeldStimuli(
  shape: PaperStructuredShape,
  held: ReadonlyMap<string, PaperHeldStimulus>,
): PaperStructuredShape {
  if (held.size === 0) return shape;
  return {
    ...shape,
    groups: shape.groups.map((g) => {
      const stimulus = held.get(g.groupId);
      return stimulus !== undefined && g.stimulusNeed.status === 'needed'
        ? { ...g, heldStimulus: stimulus }
        : g;
    }),
  };
}

/**
 * `[D-562]`, on resume: the needed groups of a RECORDED shape that the lookup found nothing for when
 * the paper was planned, read back from the recorded plan, so a resumed paper is planned exactly as
 * it was without a second field on the journal. A needed group with no held stimulus is a named
 * empty group only when one of its own parts (a part whose nearest needed, unheld group is this
 * one) has no reason of its own (`ownEmptySlotIds`, the blueprint's), states no dependency outside
 * the plan, and still did not reach the plan: nothing but the group's stimulus can have kept it
 * out. Otherwise the group was not looked for and its parts were written without shared material.
 * Where the plan cannot tell (every part of the group was empty for another reason), the group
 * reads as not looked for, the reading that never claims her material lacks something it did not
 * check. Pure.
 */
export function paperNoneHeldGroupIdsFromPlan(
  shape: PaperStructuredShape,
  plannedSlotIds: ReadonlySet<string>,
  ownEmptySlotIds: ReadonlySet<string>,
): ReadonlySet<string> {
  const groupById = new Map(shape.groups.map((g) => [g.groupId, g] as const));
  const unheldNeeded = (g: PaperStructuredGroup | undefined): boolean =>
    g !== undefined && g.stimulusNeed.status === 'needed' && g.heldStimulus === null;
  const nearestUnheld = (groupId: string): string | undefined => {
    const seen = new Set<string>();
    let at: PaperStructuredGroup | undefined = groupById.get(groupId);
    while (at !== undefined && !seen.has(at.groupId)) {
      if (unheldNeeded(at)) return at.groupId;
      seen.add(at.groupId);
      at = at.parentGroupId === undefined ? undefined : groupById.get(at.parentGroupId);
    }
    return undefined;
  };
  // A part written on an earlier part's concept has no reason of its own (`planStructuredPaper`):
  // whatever the blueprint left at its slot id was another concept's.
  const conceptSlot = paperPartConceptSlotIds(shape);
  const out = new Set<string>();
  for (const p of shape.parts) {
    if (plannedSlotIds.has(p.slotId)) continue;
    if (conceptSlot.get(p.slotId) === p.slotId && ownEmptySlotIds.has(p.slotId)) continue;
    const dependencies = p.dependsOn.status === 'stated' ? p.dependsOn.onSlotIds : [];
    if (!dependencies.every((id) => plannedSlotIds.has(id))) continue;
    const groupId = nearestUnheld(p.groupId);
    if (groupId !== undefined) out.add(groupId);
  }
  return out;
}

/** One slot of a structured paper's plan: the journal's plan slot (`./paper-journal.ts`'s `PaperJournalPlanSlot`), field for field. */
export interface PaperStructuredPlanSlot {
  readonly slotId: string;
  readonly conceptKey: string;
  readonly conceptName: string;
  readonly taskId: PaperGeneratorTaskId;
  readonly dependsOnSlotIds: readonly string[];
}

export interface PaperStructuredPlan {
  /** The parts to be written, in dependency order, each with the slots it depends on (every one of them in the plan). */
  readonly plan: readonly PaperStructuredPlanSlot[];
  /**
   * Every slot that ends empty before any call: the parts' own and propagated reasons in dependency
   * order, then the blueprint's empty slots that are not parts (rank exclusion), then the candidates
   * a part written on an earlier part's concept took the place of (rank exclusion, rule 2).
   */
  readonly planTimeEmptySlots: readonly PaperEmptySlot[];
  /**
   * `[D-561]` (rule 2): the blueprint the plan is written from. A part that states a dependency
   * holds, at its own slot id, its earlier part's concept, held source and chunks; the candidate it
   * took the place of is a rank-excluded empty slot. Every other slot is the given blueprint's.
   * Calling this function again over it gives the same plan.
   */
  readonly blueprint: PaperBlueprint;
}

/**
 * `[D-561]` (`ol-egov.141.89.7.93`, Class B): the slot whose concept each part of `shape` is written
 * on, by slot id. A part that states a dependency is written on the concept of the first part it
 * depends on, in printed order, and through a chain on the chain's first part's (rule 2 above);
 * every other part on its own slot's concept. Pure.
 */
export function paperPartConceptSlotIds(shape: PaperStructuredShape): ReadonlyMap<string, string> {
  const index = new Map(shape.parts.map((p, i) => [p.slotId, i] as const));
  const partBySlot = new Map(shape.parts.map((p) => [p.slotId, p] as const));
  const firstDependency = (p: PaperStructuredPart): string | undefined => {
    if (p.dependsOn.status !== 'stated') return undefined;
    let first: string | undefined;
    for (const id of p.dependsOn.onSlotIds) {
      const at = index.get(id);
      if (at === undefined || id === p.slotId) continue;
      if (first === undefined || at < (index.get(first) ?? Number.MAX_SAFE_INTEGER)) first = id;
    }
    return first;
  };
  const out = new Map<string, string>();
  for (const p of shape.parts) {
    const seen = new Set<string>([p.slotId]);
    let root = p.slotId;
    let next = firstDependency(p);
    while (next !== undefined && !seen.has(next)) {
      seen.add(next);
      root = next;
      const at = partBySlot.get(next);
      next = at === undefined ? undefined : firstDependency(at);
    }
    out.set(p.slotId, root);
  }
  return out;
}

const CANDIDATE_RANK = /^slot-(\d+)$/;

/** The rank-excluded empty slot for a candidate whose slot id a part written on an earlier part's concept took (rule 2). */
function displacedCandidate(
  occupant: { readonly conceptKey: string; readonly conceptName: string } & Partial<
    Pick<PaperEmptySlot, 'intendedDemand'>
  >,
  slotId: string,
  taken: ReadonlySet<string>,
): PaperEmptySlot {
  const ranked = `excluded-${CANDIDATE_RANK.exec(slotId)?.[1] ?? slotId}`;
  return {
    slotId: taken.has(ranked) ? `excluded-${slotId}` : ranked,
    conceptKey: occupant.conceptKey,
    conceptName: occupant.conceptName,
    reasonCode: 'rank-excluded',
    reason:
      'its candidate place went to a part that builds on an earlier part and is written on that ' +
      "part's concept; the concepts ranked above it took the paper's other parts",
    ...(occupant.intendedDemand !== undefined ? { intendedDemand: occupant.intendedDemand } : {}),
  };
}

/**
 * The plan of a structured paper over `blueprint` (`[D-559]`): the parts' own empty reasons (the
 * blueprint's: no held source, an unserved demand) and every reason they pass on before any call
 * (`propagatePaperEmptiness`: no held stimulus for a group in `noneHeldGroupIds`, the ones the
 * stimulus lookup found nothing for, then depends on an empty part), so a part whose
 * dependency is already empty is never asked for and never reaches the journal. A part that states
 * a dependency is written on its earlier part's concept (rule 2, `paperPartConceptSlotIds`), so it
 * has no reason of its own: its earlier part's, or its group's, passes to it. `null` when the
 * shape's parts and the blueprint's candidates are not the same slots: the shape was made over
 * another blueprint, and nothing is guessed. Pure.
 */
export function planStructuredPaper(
  blueprint: PaperBlueprint,
  shape: PaperStructuredShape,
  noneHeldGroupIds: ReadonlySet<string> = new Set(),
): PaperStructuredPlan | null {
  const candidates = paperBlueprintCandidateSlotIds(blueprint);
  const partSlotIds = new Set(shape.parts.map((p) => p.slotId));
  if (candidates.length !== partSlotIds.size || candidates.some((id) => !partSlotIds.has(id))) {
    return null;
  }
  const slotById = new Map(blueprint.slots.map((s) => [s.slotId, s] as const));
  const emptyById = new Map(blueprint.emptySlots.map((e) => [e.slotId, e] as const));
  const conceptSlot = paperPartConceptSlotIds(shape);
  const conceptOf = (slotId: string): string => conceptSlot.get(slotId) ?? slotId;
  const onAnother = (slotId: string): boolean => conceptOf(slotId) !== slotId;
  const ownEmpty = new Map<string, PaperEmptyOutcome>();
  for (const p of shape.parts) {
    const empty = onAnother(p.slotId) ? undefined : emptyById.get(p.slotId);
    if (empty === undefined) continue;
    ownEmpty.set(p.slotId, {
      reasonCode: empty.reasonCode,
      reason: empty.reason,
      ...(empty.causedBySlotId !== undefined ? { causedBySlotId: empty.causedBySlotId } : {}),
    });
  }
  const outcomes = propagatePaperEmptiness(shape, ownEmpty, noneHeldGroupIds);
  const ordered = paperPartsInDependencyOrder(shape);

  const plan: PaperStructuredPlanSlot[] = [];
  const planned = new Set<string>();
  const planTimeEmptySlots: PaperEmptySlot[] = [];
  const writtenSlots: PaperBlueprintSlot[] = blueprint.slots.filter((s) => !onAnother(s.slotId));
  const writtenEmpty: PaperEmptySlot[] = blueprint.emptySlots.filter((e) => !onAnother(e.slotId));
  const displaced: PaperEmptySlot[] = [];
  const taken = new Set([...slotById.keys(), ...emptyById.keys()]);
  for (const p of ordered) {
    const outcome = outcomes.get(p.slotId);
    const conceptAt = conceptOf(p.slotId);
    const own = onAnother(p.slotId) ? undefined : emptyById.get(p.slotId);
    const slot = slotById.get(conceptAt);
    if (onAnother(p.slotId)) {
      const occupant = slotById.get(p.slotId) ?? emptyById.get(p.slotId);
      const concept = slot ?? emptyById.get(conceptAt);
      if (occupant !== undefined && occupant.conceptKey !== concept?.conceptKey) {
        const candidate = displacedCandidate(occupant, p.slotId, taken);
        taken.add(candidate.slotId);
        displaced.push(candidate);
      }
      if (slot !== undefined) writtenSlots.push({ ...slot, slotId: p.slotId });
    }
    if (outcome !== undefined) {
      if (own !== undefined) {
        planTimeEmptySlots.push(own);
        continue;
      }
      const concept = slot ?? emptyById.get(conceptAt);
      if (concept === undefined) return null;
      const empty: PaperEmptySlot = {
        slotId: p.slotId,
        conceptKey: concept.conceptKey,
        conceptName: concept.conceptName,
        reasonCode: outcome.reasonCode,
        reason: outcome.reason,
        ...(outcome.causedBySlotId !== undefined ? { causedBySlotId: outcome.causedBySlotId } : {}),
      };
      planTimeEmptySlots.push(empty);
      if (onAnother(p.slotId) && slot === undefined) writtenEmpty.push(empty);
      continue;
    }
    if (slot === undefined) return null;
    const dependsOnSlotIds = p.dependsOn.status === 'stated' ? [...p.dependsOn.onSlotIds] : [];
    if (dependsOnSlotIds.some((id) => !planned.has(id))) return null;
    plan.push({
      slotId: p.slotId,
      conceptKey: slot.conceptKey,
      conceptName: slot.conceptName,
      taskId: slot.taskId,
      dependsOnSlotIds,
    });
    planned.add(p.slotId);
  }
  for (const empty of blueprint.emptySlots) {
    if (!partSlotIds.has(empty.slotId)) planTimeEmptySlots.push(empty);
  }
  planTimeEmptySlots.push(...displaced);
  const rank = new Map(candidates.map((id, index) => [id, index] as const));
  const rankOf = (slotId: string): number => rank.get(slotId) ?? Number.MAX_SAFE_INTEGER;
  return {
    plan,
    planTimeEmptySlots,
    blueprint: {
      ...blueprint,
      slots: writtenSlots.sort((a, b) => rankOf(a.slotId) - rankOf(b.slotId)),
      emptySlots: [...writtenEmpty, ...displaced],
    },
  };
}

// --------------------------------------------------------------------------------------------
// Reading a recorded shape back
// --------------------------------------------------------------------------------------------

const isRecordObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);
const isNonEmptyText = (value: unknown): value is string =>
  typeof value === 'string' && value.length > 0;
const isTextField = (value: unknown): value is string => typeof value === 'string';
const isIdList = (value: unknown): value is readonly string[] =>
  Array.isArray(value) && value.every(isNonEmptyText);
const isWholeNumber = (value: unknown): value is number =>
  typeof value === 'number' && Number.isInteger(value) && value >= 0;
const oneOf = (values: readonly string[], value: unknown): boolean =>
  typeof value === 'string' && values.includes(value);

function isMarksRecord(value: unknown): value is PaperMarks {
  if (!isRecordObject(value)) return false;
  return (
    value.status === 'unknown' ||
    (value.status === 'stated' &&
      typeof value.value === 'number' &&
      Number.isFinite(value.value) &&
      value.value >= 0)
  );
}

function isDependencyRecord(value: unknown): value is PaperPartDependency {
  if (!isRecordObject(value)) return false;
  return value.status === 'unknown' || (value.status === 'stated' && isIdList(value.onSlotIds));
}

function isDemandRecord(value: unknown): value is PaperPartDemandReading {
  if (!isRecordObject(value)) return false;
  if (value.status === 'read') return oneOf(PAPER_DEMANDS, value.demand);
  if (value.status === 'unsupported') {
    return value.commandWord === undefined || isTextField(value.commandWord);
  }
  return value.status === 'cannot-tell' || value.status === 'not-read';
}

function isStimulusNeedRecord(value: unknown): value is PaperGroupStimulusNeed {
  if (!isRecordObject(value)) return false;
  if (value.status === 'needed') {
    return value.form === null || oneOf(PAPER_STIMULUS_FORMS, value.form);
  }
  return value.status === 'not-needed' || value.status === 'not-identified';
}

function isHeldStimulusRecord(value: unknown): value is PaperHeldStimulus | null {
  if (value === null) return true;
  return (
    isRecordObject(value) &&
    oneOf(PAPER_STIMULUS_FORMS, value.form) &&
    isNonEmptyText(value.sourceId) &&
    isWholeNumber(value.chunkIndex)
  );
}

function isGroupRecord(value: unknown): value is PaperStructuredGroup {
  if (!isRecordObject(value)) return false;
  if (!isNonEmptyText(value.groupId) || !oneOf(PAPER_QUESTION_GROUP_KINDS, value.kind))
    return false;
  if (!(value.sectionId === null || isNonEmptyText(value.sectionId))) return false;
  if (value.parentGroupId !== undefined && !isNonEmptyText(value.parentGroupId)) return false;
  if (!isTextField(value.label) || !isIdList(value.slotIds)) return false;
  if (value.choice !== undefined) {
    const choice = value.choice;
    if (!isRecordObject(choice) || !isWholeNumber(choice.alternatives)) return false;
    if (!(choice.choose === null || isWholeNumber(choice.choose))) return false;
  }
  return isStimulusNeedRecord(value.stimulusNeed) && isHeldStimulusRecord(value.heldStimulus);
}

function isPartRecord(value: unknown): value is PaperStructuredPart {
  if (!isRecordObject(value)) return false;
  return (
    isNonEmptyText(value.slotId) &&
    isNonEmptyText(value.groupId) &&
    isTextField(value.label) &&
    isTextField(value.questionForm) &&
    isMarksRecord(value.marks) &&
    isDependencyRecord(value.dependsOn) &&
    isDemandRecord(value.demand)
  );
}

function isSectionRecord(value: unknown): value is PaperStructuredSection {
  if (!isRecordObject(value)) return false;
  return (
    isNonEmptyText(value.sectionId) &&
    isTextField(value.label) &&
    isMarksRecord(value.marks) &&
    isIdList(value.groupIds)
  );
}

function isTimeAllowanceRecord(value: unknown): boolean {
  if (!isRecordObject(value)) return false;
  return (
    value.status === 'unknown' ||
    (value.status === 'stated' &&
      typeof value.minutes === 'number' &&
      Number.isFinite(value.minutes) &&
      value.minutes >= 0)
  );
}

/**
 * `[D-560]`: whether a value read off disk is a structured shape this build can use — every field of
 * the shape it claims, and well formed (`validatePaperStructure` finds nothing). A shape that is not
 * is refused, never repaired. Pure; never throws.
 */
export function isRecordedPaperStructuredShape(value: unknown): value is PaperStructuredShape {
  if (!isRecordObject(value)) return false;
  if (value.formatVersion !== PAPER_STRUCTURE_FORMAT_VERSION) return false;
  if (!oneOf(['current-or-transitional', 'historical-fallback', 'none-read'], value.structureBasis))
    return false;
  if (!isWholeNumber(value.structureSlotCount)) return false;
  if (!Array.isArray(value.sections) || !value.sections.every(isSectionRecord)) return false;
  if (!Array.isArray(value.groups) || !value.groups.every(isGroupRecord)) return false;
  if (!Array.isArray(value.parts) || !value.parts.every(isPartRecord)) return false;
  if (!isMarksRecord(value.totalMarks) || !isTimeAllowanceRecord(value.timeAllowance)) return false;
  return validatePaperStructure(value as unknown as PaperStructuredShape).length === 0;
}
