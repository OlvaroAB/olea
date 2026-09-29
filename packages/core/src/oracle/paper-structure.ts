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
 */

import { hashText } from '../ingestion/hash.js';
import { canonicalJson } from '../outcome/canonical-json.js';
import type {
  PaperEmptySlot,
  PaperEmptySlotReasonCode,
  PaperExtent,
  PaperFormatClass,
  PaperGapKind,
  PaperGeneratorTaskId,
  PaperIntendedDemandBasis,
  PaperMarks,
  PaperPartDemandReading,
  PaperPurpose,
  PaperReuseFingerprint,
  PaperStructuredGroup,
  PaperStructuredPart,
  PaperStructuredShape,
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
  | 'marks-invalid';

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
 * 1. **No held stimulus.** A group whose need is `'needed'` and whose held stimulus is `null` names
 *    every part in it, nested groups included, `no-held-stimulus` — unless the part already has an
 *    earlier reason of its own, which wins (`[D-438]` sections 5.4: rank, demand, source, then
 *    stimulus). A group whose need is `'not-needed'` or `'not-identified'` names nothing: not
 *    knowing whether a stimulus is needed is not a reason to refuse the group.
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
): ReadonlyMap<string, PaperEmptyOutcome> {
  const out = new Map(ownEmpty);

  for (const g of shape.groups) {
    if (g.stimulusNeed.status !== 'needed' || g.heldStimulus !== null) continue;
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
  /** Every held source a slot grounds in, and every structure-reading revision the template came from. */
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
