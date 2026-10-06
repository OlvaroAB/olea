/**
 * The per-basis switch for the reading-based ranking bases, and the lexical-fallback label
 * (`[D-432]`, `ol-egov.141.89.7.25`; the gate it reads is pre-registered by `ol-egov.141.89.7.27`
 * in `olea-service/findings/ilb-scp-per-basis-gate.md`, sections 3 to 5 and 7).
 *
 * **What it decides.** Today every ranking basis (objectives, past papers, assessment briefs)
 * comes from verbatim whole-word name matching: `./build.ts` and `../tier3-evidence/build.ts`.
 * `[D-432]` lets the wire stage read a basis from the alignment stage instead, one basis at a
 * time, and only on held-out evidence. This module holds the state that says which bases may, and
 * the label every lexically matched edge carries meanwhile. **It switches nothing on**: with no
 * recorded gate result (the production default, {@link NO_BASIS_GATE}) every basis is off, and
 * `./build.ts` builds exactly the verbatim edges it always built.
 *
 * **The one route to "on".** A basis reads `on` only through {@link resolveBasisSwitches}, and only
 * from a {@link BasisGateRecord} that (1) names the pre-registration it was judged under
 * ({@link PER_BASIS_GATE_PREREGISTRATION}), (2) carries its evidence (the per-basis result block
 * and the bead that recorded it), (3) was taken on a pre-registered look at a sealed held-out set
 * ({@link classifyHeldOutLook}), (4) meets the declared cell minimums
 * ({@link HELD_OUT_CELL_MINIMUMS}) whatever its verdict says, and (5) records the verdict
 * `switch-on`. There is no caller-supplied "on" state: a caller passes records and the exposure
 * record, never a resolved switch. A pass on one basis never carries to another.
 *
 * **Enabling is Class C, and its evidence travels with it** (findings section 7). The `on` state
 * carries the whole record it was resolved from (configuration digest, held-out set, cell counts,
 * evidence), so whatever reads the switch can say why it is on. Recording that enabling, with the
 * gate's evidence, is the wire bead's (`ol-egov.141.89.7.5`). **A moved threshold needs a
 * decision bead**: the cell minimums below and the gate's other parameters (findings section 4)
 * are declared, not fitted, and none of them moves without one. A record judged under a different
 * pre-registration is refused, never adopted; there is deliberately no option, flag or override
 * that loosens any of this.
 *
 * **The fallback** (findings section 5) is today's verbatim path, kept for a basis that is off and
 * for any document whose alignment is pending. Every edge it serves is labelled
 * {@link EvidenceSource} `'lexical-fallback'` in {@link BasisSourceAttribution}, never
 * `'alignment'`, and a concept it does not match reads **not assessed**
 * ({@link readConceptBasis}): never excluded, never "not aligned", never a negative. `./build.ts`
 * reads no alignment result yet, so every edge it builds is the fallback, whatever the switch
 * says; a basis that is on serves the fallback as `alignment-pending` until the wire stage supplies
 * results stamped with the passing configuration's digest.
 *
 * **Where the label stops.** It is internal: the build result's `basisSources`, the statements
 * {@link describeBasisSwitch} writes for reports, and the harness. It is not student copy, and it
 * never reaches `oracle.rank.v1`'s request, whose `bases` entries carry `basis` and `confidence`
 * only (`../oracle/rank-request-bases.ts`) and so can present nothing as alignment: saying
 * "pending" or "fallback" there is a contract change (scp.md S.11 open question 3), not done here.
 * Saying it in a sentence she reads is a Class C copy change, not done here either.
 */

import type { ConceptAssessmentEdge, ConceptEvidenceBasis } from './types.js';

/** The three ranking bases a switch exists for, in a fixed order. */
export const RANKING_BASES: readonly ConceptEvidenceBasis[] = [
  'objectives',
  'past-paper',
  'assessment-brief',
];

/**
 * The pre-registration every gate record must have been judged under: `ol-egov.141.89.7.27`'s
 * per-basis gate (`olea-service/findings/ilb-scp-per-basis-gate.md`). A record naming anything
 * else is refused. Changing this value is changing the gate, and needs a decision bead.
 *
 * @provenance declared
 */
export const PER_BASIS_GATE_PREREGISTRATION = 'ol-egov.141.89.7.27';

/**
 * The too-few-cells rule (findings section 3.4), counted from real held-out cells with locked
 * targets only. **The sentence:** a basis is read only on at least 29 decided cells whose target
 * is not attested, because zero unsupported claims on 29 such cells bounds the unsupported rate at
 * or below one in ten (one-sided 95 percent: `1 - 0.05^(1/29)` is 0.098, and 28 cells give
 * 0.1015), and on at least 10 attested cells, because fewer support no claim; each spread over at
 * least two held-out courses, so one course cannot carry a basis alone.
 *
 * Declared arithmetic, never fitted, and the same for every basis. A record whose counts fall
 * short leaves its basis off and says so, whatever verdict it carries. These numbers move only
 * through a decision bead.
 *
 * @provenance declared
 */
export const HELD_OUT_CELL_MINIMUMS = {
  decidedNotAttested: 29,
  attested: 10,
  courses: 2,
} as const;

/** The five conditions of the per-basis gate (findings section 3), each named for a report. */
export type PerBasisGateCondition =
  | 'harm-limit'
  | 'beats-verbatim'
  | 'not-an-echo'
  | 'enough-cells'
  | 'one-look';

/** A basis's held-out cell counts, from real cells with locked targets (findings section 3.4). */
export interface HeldOutCellCounts {
  /** Decided cells whose target is not attested (a cannot-tell target counts here, read strictly). */
  readonly decidedNotAttested: number;
  /** Held-out courses holding at least one of those cells. */
  readonly decidedNotAttestedCourses: number;
  /** Cells whose target is attested. */
  readonly attested: number;
  /** Held-out courses holding at least one of those cells. */
  readonly attestedCourses: number;
}

/**
 * One look at a held-out set: which sealed set (its manifest's content hash, so renaming the file
 * gives the same set) and which configuration (its frozen digest, so renaming a configuration
 * gives the same configuration, and changing it gives a new one). Nothing here carries a name.
 */
export interface HeldOutLook {
  readonly heldOutSetHash: string;
  readonly configurationDigest: string;
}

/**
 * One entry of the exposure record, in the order it happened: a sealed set registered with the
 * frozen configuration that may be scored on it, or a look taken at a set.
 */
export type HeldOutExposureEvent =
  | {
      readonly kind: 'registered';
      readonly heldOutSetHash: string;
      readonly frozenConfigurationDigest: string;
    }
  | ({ readonly kind: 'looked' } & HeldOutLook);

/**
 * Held-out exposure, per configuration (findings section 3.5): every registration and every look,
 * append-only, in order. The harness keeps the canonical copy
 * (`olea-service/scripts/harness/ilb-scp/held-out-exposure.json`, started empty); the benchmark
 * (`ol-egov.141.89.7.5`) appends its one look before it reads a held-out cell.
 */
export interface HeldOutExposureRecord {
  readonly events: readonly HeldOutExposureEvent[];
}

/** No set registered, nothing looked at: the state the record starts in. */
export const NO_HELD_OUT_EXPOSURE: HeldOutExposureRecord = { events: [] };

/** Why a look cannot pass the gate on its set (findings section 7). */
export type PostHocReason =
  /** No registration for the set precedes the look: nothing was sealed for it to be scored against. */
  | 'set-not-registered'
  /** The set was registered more than once; a second registration is a renamed configuration, not a fresh test. */
  | 'set-registered-twice'
  /** Someone looked at the set before it was registered. */
  | 'looked-before-registration'
  /** The configuration is not the one frozen for the set: adapted after a look, or never registered. */
  | 'not-the-frozen-configuration'
  /** An earlier look at the same set exists, by any configuration; a second look describes and selects nothing. */
  | 'not-the-first-look'
  /** The record names a look the exposure record does not hold. */
  | 'look-not-recorded';

/** Whether a look can pass the gate on its set. */
export type HeldOutLookStanding =
  | { readonly standing: 'pre-registered' }
  | { readonly standing: 'post-hoc'; readonly reason: PostHocReason };

/**
 * Classifies one look against the exposure record. **Pre-registered** only when the set's single
 * registration precedes every look at it, names this configuration as the frozen one, and the
 * first look at the set is this configuration's. Everything else is **post hoc** and cannot pass
 * the gate on that set: a configuration adapted after a look has a new digest, a renamed one
 * gains nothing (identity is the digest, and a second registration is refused), and a pass needs a
 * new, sealed set.
 */
export function classifyHeldOutLook(
  look: HeldOutLook,
  exposure: HeldOutExposureRecord,
): HeldOutLookStanding {
  const forSet = exposure.events.filter((event) => event.heldOutSetHash === look.heldOutSetHash);
  const registrations = forSet.filter((event) => event.kind === 'registered');
  if (registrations.length === 0) return postHoc('set-not-registered');
  if (registrations.length > 1) return postHoc('set-registered-twice');
  const registration = registrations[0];
  if (forSet[0]?.kind !== 'registered' || registration === undefined) {
    return postHoc('looked-before-registration');
  }
  if (registration.frozenConfigurationDigest !== look.configurationDigest) {
    return postHoc('not-the-frozen-configuration');
  }
  const firstLook = forSet.find((event) => event.kind === 'looked');
  if (firstLook === undefined) return postHoc('look-not-recorded');
  if (firstLook.configurationDigest !== look.configurationDigest) {
    return postHoc('not-the-first-look');
  }
  return { standing: 'pre-registered' };
}

function postHoc(reason: PostHocReason): HeldOutLookStanding {
  return { standing: 'post-hoc', reason };
}

/** The verdict the benchmark recorded for one basis, in findings section 6's three forms. */
export type BasisGateVerdict =
  | { readonly kind: 'switch-on' }
  | { readonly kind: 'gate-not-met'; readonly failed: readonly PerBasisGateCondition[] }
  | { readonly kind: 'too-few-cells' };

/**
 * One basis's recorded gate result: the declared input a switch is resolved from. Written by the
 * benchmark's one held-out look (`ol-egov.141.89.7.5`); nothing in `ol-egov.141.89.7.25` writes
 * one, so no basis is on.
 */
export interface BasisGateRecord {
  readonly basis: ConceptEvidenceBasis;
  /** Must equal {@link PER_BASIS_GATE_PREREGISTRATION}. */
  readonly preRegistration: string;
  /** The look the result was read from; classified by {@link classifyHeldOutLook}. */
  readonly look: HeldOutLook;
  readonly cells: HeldOutCellCounts;
  readonly verdict: BasisGateVerdict;
  /** Enabling is recorded with its evidence: where the per-basis result block is, and who recorded it. */
  readonly evidence: { readonly report: string; readonly recordedBy: string };
}

/** What a switch is resolved from: the recorded results and the exposure record they are checked against. */
export interface BasisGateInput {
  /** At most one record per basis; a second is refused rather than chosen between. */
  readonly records: readonly BasisGateRecord[];
  readonly exposure: HeldOutExposureRecord;
}

/** No gate result recorded: every basis off. The production default. */
export const NO_BASIS_GATE: BasisGateInput = { records: [], exposure: NO_HELD_OUT_EXPOSURE };

/** A count that falls short of {@link HELD_OUT_CELL_MINIMUMS}. */
export type HeldOutCellShortfall =
  | 'decided-not-attested-cells'
  | 'decided-not-attested-courses'
  | 'attested-cells'
  | 'attested-courses';

/** Why a gate record is refused outright. */
export type GateRecordRefusal = 'other-pre-registration' | 'no-evidence' | 'more-than-one-record';

/** Why a basis is off, with what a report needs to say so. */
export type BasisOffReason =
  | { readonly reason: 'no-gate-record' }
  | {
      readonly reason: 'too-few-held-out-cells';
      readonly cells: HeldOutCellCounts;
      readonly shortfall: readonly HeldOutCellShortfall[];
    }
  | { readonly reason: 'gate-not-met'; readonly failed: readonly PerBasisGateCondition[] }
  | { readonly reason: 'post-hoc'; readonly postHoc: PostHocReason }
  | { readonly reason: 'record-refused'; readonly refusal: GateRecordRefusal };

/** One basis's switch: off with its reason, or on with the record that turned it on. */
export type BasisSwitchState =
  | ({ readonly basis: ConceptEvidenceBasis; readonly status: 'off' } & BasisOffReason)
  | {
      readonly basis: ConceptEvidenceBasis;
      readonly status: 'on';
      /** The record it was resolved from; its `look.configurationDigest` is the only configuration whose results may serve this basis. */
      readonly record: BasisGateRecord;
    };

/** Every basis's switch. */
export type BasisSwitches = Readonly<Record<ConceptEvidenceBasis, BasisSwitchState>>;

/** The counts that fall short of {@link HELD_OUT_CELL_MINIMUMS}, in a fixed order; empty when none do. */
export function heldOutCellShortfall(cells: HeldOutCellCounts): readonly HeldOutCellShortfall[] {
  const short: HeldOutCellShortfall[] = [];
  if (!(cells.decidedNotAttested >= HELD_OUT_CELL_MINIMUMS.decidedNotAttested)) {
    short.push('decided-not-attested-cells');
  }
  if (!(cells.decidedNotAttestedCourses >= HELD_OUT_CELL_MINIMUMS.courses)) {
    short.push('decided-not-attested-courses');
  }
  if (!(cells.attested >= HELD_OUT_CELL_MINIMUMS.attested)) short.push('attested-cells');
  if (!(cells.attestedCourses >= HELD_OUT_CELL_MINIMUMS.courses)) short.push('attested-courses');
  return short;
}

/**
 * Resolves every basis's switch from recorded gate results. Omitted, every basis is off with
 * `no-gate-record`. The checks run in a fixed order and the first that fails decides the reason:
 * one record per basis, the pre-registration, the evidence, the look's standing, the cell
 * minimums (whatever the verdict says), then the verdict itself.
 */
export function resolveBasisSwitches(gate: BasisGateInput = NO_BASIS_GATE): BasisSwitches {
  return {
    objectives: resolveOne('objectives', gate),
    'past-paper': resolveOne('past-paper', gate),
    'assessment-brief': resolveOne('assessment-brief', gate),
  };
}

function resolveOne(basis: ConceptEvidenceBasis, gate: BasisGateInput): BasisSwitchState {
  const records = gate.records.filter((record) => record.basis === basis);
  const record = records[0];
  if (record === undefined) return { basis, status: 'off', reason: 'no-gate-record' };
  if (records.length > 1) return refused(basis, 'more-than-one-record');
  if (record.preRegistration !== PER_BASIS_GATE_PREREGISTRATION) {
    return refused(basis, 'other-pre-registration');
  }
  if (record.evidence.report.trim() === '' || record.evidence.recordedBy.trim() === '') {
    return refused(basis, 'no-evidence');
  }
  const standing = classifyHeldOutLook(record.look, gate.exposure);
  if (standing.standing === 'post-hoc') {
    return { basis, status: 'off', reason: 'post-hoc', postHoc: standing.reason };
  }
  const shortfall = heldOutCellShortfall(record.cells);
  if (shortfall.length > 0 || record.verdict.kind === 'too-few-cells') {
    return {
      basis,
      status: 'off',
      reason: 'too-few-held-out-cells',
      cells: record.cells,
      shortfall,
    };
  }
  if (record.verdict.kind === 'gate-not-met') {
    return { basis, status: 'off', reason: 'gate-not-met', failed: record.verdict.failed };
  }
  return { basis, status: 'on', record };
}

function refused(basis: ConceptEvidenceBasis, refusal: GateRecordRefusal): BasisSwitchState {
  return { basis, status: 'off', reason: 'record-refused', refusal };
}

// ---------------------------------------------------------------------------------------------
// The fallback label
// ---------------------------------------------------------------------------------------------

/** Where an edge's evidence came from (findings section 5.1). */
export type EvidenceSource = 'lexical-fallback' | 'alignment';

/** Why a basis is served by the lexical fallback: its switch is off, or it is on and its documents' alignment is pending. */
export type FallbackCause = 'switch-off' | 'alignment-pending';

/**
 * How one basis's edges were served in one build. `source` is `'lexical-fallback'` for every basis
 * today: `./build.ts` reads no alignment result, so even a basis whose switch is on serves the
 * fallback, as `alignment-pending`. The wire stage (`ol-egov.141.89.7.5`) is what may first
 * serve `'alignment'`, from results stamped with the switch's configuration digest, and only for
 * the documents those results cover.
 */
export interface BasisSourceAttribution {
  readonly basis: ConceptEvidenceBasis;
  readonly switchState: BasisSwitchState;
  readonly source: 'lexical-fallback';
  readonly cause: FallbackCause;
  /** {@link describeBasisSwitch}'s statement, never blank. Internal: reports and the harness, not student copy. */
  readonly statement: string;
}

/** Every basis's attribution, as `./build.ts` returns it on `basisSources`. */
export type BasisSourceAttributions = Readonly<
  Record<ConceptEvidenceBasis, BasisSourceAttribution>
>;

/** The attribution for every basis, given its switch. */
export function attributeBasisSources(switches: BasisSwitches): BasisSourceAttributions {
  const one = (basis: ConceptEvidenceBasis): BasisSourceAttribution => {
    const switchState = switches[basis];
    return {
      basis,
      switchState,
      source: 'lexical-fallback',
      cause: switchState.status === 'on' ? 'alignment-pending' : 'switch-off',
      statement: describeBasisSwitch(switchState),
    };
  };
  return {
    objectives: one('objectives'),
    'past-paper': one('past-paper'),
    'assessment-brief': one('assessment-brief'),
  };
}

/** The source of one edge's evidence, read from its basis's attribution (an edge with no `basis` is past-paper, as the edge type documents). */
export function edgeEvidenceSource(
  edge: Pick<ConceptAssessmentEdge, 'basis'>,
  attributions: BasisSourceAttributions,
): EvidenceSource {
  return attributions[edge.basis ?? 'past-paper'].source;
}

/**
 * What one basis says about one concept in one course. There are two readings and no third: the
 * fallback matched the name (an edge, labelled lexical fallback), or it did not, which reads **not
 * assessed** (findings sections 5.3 and 5.4). A lexical non-match is never excluded, never "not
 * aligned" and never a negative, whether the basis is off or its documents are pending.
 */
export type ConceptBasisReading =
  | {
      readonly reading: 'matched';
      readonly source: 'lexical-fallback';
      readonly cause: FallbackCause;
      readonly edgeCount: number;
    }
  | { readonly reading: 'not-assessed'; readonly cause: FallbackCause };

/** Reads one (course, concept, basis) off a build's edges and attributions. */
export function readConceptBasis(
  edges: readonly ConceptAssessmentEdge[],
  target: {
    readonly course: string;
    readonly conceptKey: string;
    readonly basis: ConceptEvidenceBasis;
  },
  attributions: BasisSourceAttributions,
): ConceptBasisReading {
  const attribution = attributions[target.basis];
  const edgeCount = edges.filter(
    (edge) =>
      edge.course === target.course &&
      edge.conceptKey === target.conceptKey &&
      (edge.basis ?? 'past-paper') === target.basis,
  ).length;
  return edgeCount === 0
    ? { reading: 'not-assessed', cause: attribution.cause }
    : { reading: 'matched', source: attribution.source, cause: attribution.cause, edgeCount };
}

// ---------------------------------------------------------------------------------------------
// Statements for reports (findings section 5.5): never blank, never a quiet default
// ---------------------------------------------------------------------------------------------

const BASIS_LABEL: Readonly<Record<ConceptEvidenceBasis, string>> = {
  objectives: 'objectives',
  'past-paper': 'past papers',
  'assessment-brief': 'briefs',
};

const CONDITION_LABEL: Readonly<Record<PerBasisGateCondition, string>> = {
  'harm-limit': 'limit breached',
  'beats-verbatim': 'does not beat the verbatim path',
  'not-an-echo': 'not above the base rate',
  'enough-cells': 'not enough held-out cells',
  'one-look': 'not the one pre-registered look',
};

/**
 * One line a report shows for a basis's switch, in findings section 5.5's words, with the counts.
 * **Internal**: for benchmark reports, the harness and logs (it carries digests and report paths,
 * never content). It is not student copy and no surface renders it.
 */
export function describeBasisSwitch(state: BasisSwitchState): string {
  const label = BASIS_LABEL[state.basis];
  if (state.status === 'on') {
    const { record } = state;
    return (
      `${label}: alignment switched on by the held-out gate (configuration ` +
      `${record.look.configurationDigest}, held-out set ${record.look.heldOutSetHash}; evidence ` +
      `${record.evidence.report}, recorded by ${record.evidence.recordedBy}); until alignment ` +
      'results with that configuration are read, its edges are the lexical fallback'
    );
  }
  const fallback = `${label}: on the lexical fallback`;
  switch (state.reason) {
    case 'no-gate-record':
      return `${fallback}: no held-out gate result recorded`;
    case 'too-few-held-out-cells': {
      const { cells } = state;
      const min = HELD_OUT_CELL_MINIMUMS;
      return (
        `${fallback}: not enough held-out cells for a reading (decided not attested ` +
        `${cells.decidedNotAttested} of ${min.decidedNotAttested} in ` +
        `${cells.decidedNotAttestedCourses} of ${min.courses} courses; attested ${cells.attested} ` +
        `of ${min.attested} in ${cells.attestedCourses} of ${min.courses} courses)`
      );
    }
    case 'gate-not-met':
      return state.failed.length === 0
        ? `${fallback}: gate not met`
        : `${fallback}: gate not met (${state.failed.map((c) => CONDITION_LABEL[c]).join('; ')})`;
    case 'post-hoc':
      return `${fallback}: the held-out result is post hoc (${state.postHoc}) and cannot pass on that set`;
    case 'record-refused':
      return `${fallback}: gate record refused (${state.refusal})`;
  }
}
