/**
 * Shared synthetic fixtures for `ol-egov.141.89.7.26`'s model-decided containment suites
 * (`src/outcome/reconcile.model-decided.ol-egov.141.89.7.26.spec.ts` and
 * `src/scope/grove.model-decided.ol-egov.141.89.7.26.spec.ts`).
 *
 * The course, outcomes and grove inputs here are the ones the two goldens were written from, at
 * `56d2121d`, before any model-decided code existed; changing a value here changes what those
 * goldens pin, so do not.
 *
 * INV-3: every course code, concept name, path and sentence below is invented.
 */

import { readdir, readFile } from 'node:fs/promises';
import { join, relative } from 'node:path';
import {
  type BasisGateInput,
  type BasisGateRecord,
  type BasisSwitches,
  HELD_OUT_CELL_MINIMUMS,
  type HeldOutExposureEvent,
  PER_BASIS_GATE_PREREGISTRATION,
  resolveBasisSwitches,
} from '../../src/evidence-edge/basis-switch.js';
import type { ConceptEvidenceBasis } from '../../src/evidence-edge/types.js';
import type { ConceptMaterialPresence } from '../../src/gap/build.js';
import type { ConceptMasteryEvidence, ConceptMasteryResult } from '../../src/mastery/rollup.js';
import {
  OUTCOME_CONCEPT_NEAR_MATCH_RECORD_SCHEMA_VERSION,
  type OutcomeConceptNearMatchRecord,
  outcomeConceptNearMatchRecordPath,
} from '../../src/outcome/near-match.js';
import type { OutcomeConceptRegistryEntry } from '../../src/outcome/reconcile.js';
import type { ScopeReadingLogEntry } from '../../src/outcome/scope-reading-log.js';
import {
  alignmentResultKey,
  paperStructureKey,
  projectScopeReadings,
  type ScopeReadingProjection,
  type ScopeRevisionRef,
} from '../../src/outcome/scope-reading-project.js';
import type { AlignmentResult } from '../../src/outcome/scope-reading-types.js';
import { outcomeLabelDigest } from '../../src/outcome/source-identity.js';
import { outcomeRecordPath } from '../../src/outcome/store.js';
import { OUTCOME_RECORD_SCHEMA_VERSION, type OutcomeRecord } from '../../src/outcome/types.js';
import type { BuildGroveModelInput } from '../../src/scope/grove.js';
import type { Source } from '../../src/source/types.js';
import type { ConceptCitation } from '../../src/tier3-evidence/types.js';
import type { VaultPath, VaultSource } from '../../src/vault/types.js';

export const NOW = '2026-10-06T00:00:00.000Z';
export const COURSE = 'COURSEA';
export const DOC = '03 Research/Objectives A.md' as VaultPath;
export const PAPER = '03 Research/Paper 2024.md' as VaultPath;
export const SCOPE_Q1 = 'scope-key:q1';
export const SCOPE_Q2 = 'scope-key:q2';

export const K_EXACT = 'concept-key1:widget';
export const K_ALIAS = 'concept-key1:gizmo';
export const K_NEAR = 'concept-key1:sprocket';
export const K_MODEL = 'concept-key1:flange';
export const K_MODEL2 = 'concept-key1:cog';

export const CONCEPTS: readonly OutcomeConceptRegistryEntry[] = [
  { key: K_EXACT, name: 'Widget Theory', aliases: [] },
  { key: K_ALIAS, name: 'Gizmo Law', aliases: ['Gizmo Rule'] },
  { key: K_NEAR, name: 'Sprocket Method Basics', aliases: [] },
  { key: K_MODEL, name: 'Flange Rule', aliases: [] },
  { key: K_MODEL2, name: 'Cog Principle', aliases: [] },
];

export const O_EXACT = 'outcome-key1:o-exact';
export const O_ALIAS = 'outcome-key1:o-alias';
export const O_NEAR = 'outcome-key1:o-near';
export const O_MISS = 'outcome-key1:o-miss';
export const O_RETIRED = 'outcome-key1:o-retired';

export async function outcome(
  id: string,
  label: string,
  blockIndex: number,
  status: OutcomeRecord['status'] = 'active',
): Promise<OutcomeRecord> {
  return {
    id,
    courses: [COURSE],
    source: { path: DOC, blockIndex, labelDigest: await outcomeLabelDigest(label) },
    label,
    conceptKeys: [],
    status,
    provenance: { promptVersion: 'v1', modelVersion: 'model-a' },
    mintedAt: '2026-10-01',
    schemaVersion: OUTCOME_RECORD_SCHEMA_VERSION,
  };
}

export async function writeOutcome(vault: VaultSource, record: OutcomeRecord): Promise<void> {
  await vault.write(outcomeRecordPath(record.id), `${JSON.stringify(record, null, 2)}\n`);
}

/** The course's outcomes, written to the vault as the store writes them, and returned as read. */
export async function seedCourse(vault: VaultSource): Promise<readonly OutcomeRecord[]> {
  const outcomes = [
    await outcome(O_EXACT, 'Widget theory', 0),
    await outcome(O_ALIAS, 'Gizmo rule', 1),
    await outcome(O_NEAR, 'Sprocket method', 2),
    await outcome(O_MISS, 'Analyse a loaded frame', 3),
    await outcome(O_RETIRED, 'Design a ratchet', 4, 'retired'),
  ];
  for (const record of outcomes) await writeOutcome(vault, record);
  // Her earlier decision on the near match: declined, written before this run.
  const declined: OutcomeConceptNearMatchRecord = {
    outcomeId: O_NEAR,
    conceptKey: K_NEAR,
    status: 'declined',
    reason: 'token-set-containment',
    proposedAt: '2026-10-02T00:00:00.000Z',
    declinedAt: '2026-10-03T00:00:00.000Z',
    schemaVersion: OUTCOME_CONCEPT_NEAR_MATCH_RECORD_SCHEMA_VERSION,
  };
  await vault.write(
    outcomeConceptNearMatchRecordPath(O_NEAR, K_NEAR),
    `${JSON.stringify(declined, null, 2)}\n`,
  );
  return outcomes;
}

/** Every file under `root`, relative path to text, sorted by path. */
export async function vaultFiles(root: string): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  const walk = async (dir: string): Promise<void> => {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) await walk(path);
      else out[relative(root, path).split('\\').join('/')] = await readFile(path, 'utf8');
    }
  };
  await walk(root);
  return Object.fromEntries(Object.entries(out).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)));
}

// ------------------------------------------------------------------------------------------------
// The per-basis switch
// ------------------------------------------------------------------------------------------------

export const CONFIG_C = 'sha256:config-c';
export const CONFIG_OTHER = 'sha256:config-other';

function onRecord(basis: ConceptEvidenceBasis, configurationDigest: string): BasisGateRecord {
  return {
    basis,
    preRegistration: PER_BASIS_GATE_PREREGISTRATION,
    look: { heldOutSetHash: `set-${basis}`, configurationDigest },
    cells: {
      decidedNotAttested: HELD_OUT_CELL_MINIMUMS.decidedNotAttested,
      decidedNotAttestedCourses: HELD_OUT_CELL_MINIMUMS.courses,
      attested: HELD_OUT_CELL_MINIMUMS.attested,
      attestedCourses: HELD_OUT_CELL_MINIMUMS.courses,
    },
    verdict: { kind: 'switch-on' },
    evidence: { report: 'synthetic-report.md', recordedBy: 'ol-synthetic' },
  };
}

function exposureFor(records: readonly BasisGateRecord[]): HeldOutExposureEvent[] {
  return records.flatMap((record): HeldOutExposureEvent[] => [
    {
      kind: 'registered',
      heldOutSetHash: record.look.heldOutSetHash,
      frozenConfigurationDigest: record.look.configurationDigest,
    },
    { kind: 'looked', ...record.look },
  ]);
}

/** A gate that switches each named basis on under `configurationDigest`, by the one route to "on". */
export function gateOn(
  bases: readonly ConceptEvidenceBasis[],
  configurationDigest = CONFIG_C,
): BasisGateInput {
  const records = bases.map((basis) => onRecord(basis, configurationDigest));
  return { records, exposure: { events: exposureFor(records) } };
}

export function switchesOn(
  bases: readonly ConceptEvidenceBasis[],
  configurationDigest = CONFIG_C,
): BasisSwitches {
  return resolveBasisSwitches(gateOn(bases, configurationDigest));
}

/** Every way a basis reads off (`basis-switch.ts`), for objectives and assessment briefs, with past papers on. */
export function offGates(): readonly { readonly name: string; readonly gate: BasisGateInput }[] {
  const pastPaperOn = onRecord('past-paper', CONFIG_C);
  const with_ = (records: BasisGateRecord[], extra: HeldOutExposureEvent[] = []) => ({
    records: [pastPaperOn, ...records],
    exposure: { events: [...exposureFor([pastPaperOn, ...records]), ...extra] },
  });
  const bases: ConceptEvidenceBasis[] = ['objectives', 'assessment-brief'];
  const tooFew = bases.map((basis) => ({
    ...onRecord(basis, CONFIG_C),
    cells: { decidedNotAttested: 3, decidedNotAttestedCourses: 1, attested: 1, attestedCourses: 1 },
  }));
  const notMet = bases.map((basis) => ({
    ...onRecord(basis, CONFIG_C),
    verdict: { kind: 'gate-not-met' as const, failed: ['harm-limit' as const] },
  }));
  const refused = bases.map((basis) => ({
    ...onRecord(basis, CONFIG_C),
    preRegistration: 'another-preregistration',
  }));
  const postHoc = bases.map((basis) => onRecord(basis, CONFIG_C));
  return [
    { name: 'no gate record at all', gate: { records: [], exposure: { events: [] } } },
    { name: 'no record for either containment basis', gate: with_([]) },
    { name: 'too few held-out cells', gate: with_(tooFew) },
    { name: 'gate not met', gate: with_(notMet) },
    { name: 'a refused record', gate: with_(refused) },
    {
      name: 'post hoc (the look was never recorded)',
      gate: {
        records: [pastPaperOn, ...postHoc],
        exposure: {
          events: [
            ...exposureFor([pastPaperOn]),
            ...postHoc.map(
              (record): HeldOutExposureEvent => ({
                kind: 'registered',
                heldOutSetHash: record.look.heldOutSetHash,
                frozenConfigurationDigest: record.look.configurationDigest,
              }),
            ),
          ],
        },
      },
    },
  ];
}

// ------------------------------------------------------------------------------------------------
// Alignment results ([D-429] store 3), as the projection holds them
// ------------------------------------------------------------------------------------------------

export const CURRENT: {
  readonly closedList: string;
  readonly coverage: string;
  readonly batchPlan: string;
} = {
  closedList: 'sha256:closed-list-now',
  coverage: 'sha256:coverage-now',
  batchPlan: 'sha256:batch-plan-now',
};

export const OBJ_REF: ScopeRevisionRef = {
  documentKind: 'objectives',
  sourcePath: DOC,
  revisionDigest: 'rev-objectives-2',
};
export const Q1_REF: ScopeRevisionRef = {
  documentKind: 'stated-scope',
  sourcePath: SCOPE_Q1,
  revisionDigest: 'rev-q1-1',
};
export const PAPER_REF: ScopeRevisionRef = {
  documentKind: 'past-paper',
  sourcePath: PAPER,
  revisionDigest: 'rev-paper-1',
};

export const READER = {
  task: 'outcomes.align.v1',
  promptVersion: '1.0.0',
  modelId: 'model-synthetic',
};

export interface AlignmentFixture {
  readonly source: ScopeRevisionRef;
  readonly conceptKey: string;
  readonly result: AlignmentResult;
  readonly courseId?: string;
  readonly digests?: {
    readonly closedList?: string;
    readonly coverage?: string;
    readonly batchPlan?: string;
    readonly frozenConfiguration?: string;
  };
  /** Omitted for a pending result; `null` forces none. */
  readonly provenance?: typeof READER | null;
}

export function aligned(recordIds: readonly string[]): AlignmentResult {
  return { kind: 'aligned', recordIds, refs: [1] };
}

const PAPER_STRUCTURE_ID = 'sr1-structure-paper';

/** A projection holding each fixture as the newest result for its key (and a structure for a past paper). */
export function projectionOf(fixtures: readonly AlignmentFixture[]): ScopeReadingProjection {
  const alignmentResult: ScopeReadingLogEntry[] = fixtures.map((fixture, index) => {
    const courseId = fixture.courseId ?? COURSE;
    const provenance =
      fixture.provenance === null
        ? undefined
        : (fixture.provenance ?? (fixture.result.kind === 'pending' ? undefined : READER));
    return {
      schemaVersion: 1,
      eventId: `sr1-fixture-${index}`,
      clock: index + 1,
      recordedAt: NOW,
      kind: 'alignment-result',
      key: alignmentResultKey(courseId, fixture.source, fixture.conceptKey),
      deviceId: 'device-1',
      payload: {
        source: fixture.source,
        courseId,
        conceptKey: fixture.conceptKey,
        result: fixture.result,
        digests: {
          closedList: fixture.digests?.closedList ?? CURRENT.closedList,
          coverage: fixture.digests?.coverage ?? CURRENT.coverage,
          batchPlan: fixture.digests?.batchPlan ?? CURRENT.batchPlan,
          frozenConfiguration: fixture.digests?.frozenConfiguration ?? CONFIG_C,
        },
        coverage: { unitsNotRead: [], pairsNotSent: [] },
        ...(provenance !== undefined ? { provenance } : {}),
        ...(fixture.source.documentKind === 'past-paper'
          ? { structureId: PAPER_STRUCTURE_ID }
          : {}),
      },
    };
  });
  const paperStructure: ScopeReadingLogEntry[] = fixtures.some(
    (f) => f.source.documentKind === 'past-paper',
  )
    ? [
        {
          schemaVersion: 1,
          eventId: PAPER_STRUCTURE_ID,
          clock: 1,
          recordedAt: NOW,
          kind: 'structure',
          key: paperStructureKey(PAPER_REF),
          deviceId: 'device-1',
          payload: {
            source: PAPER_REF,
            provenance: READER,
            reading: {
              sections: [],
              totalMarks: { status: 'unknown' },
              timeAllowance: { status: 'unknown' },
            },
          },
        },
      ]
    : [];
  return projectScopeReadings({ documentState: [], paperStructure, alignmentResult });
}

/** Aligned, current results under every basis: the input every "off" variant must ignore. */
export function everyBasisAligned(): readonly AlignmentFixture[] {
  return [
    { source: OBJ_REF, conceptKey: K_MODEL, result: aligned([O_MISS]) },
    { source: OBJ_REF, conceptKey: K_EXACT, result: aligned([O_EXACT]) },
    { source: OBJ_REF, conceptKey: K_NEAR, result: aligned([O_NEAR]) },
    { source: OBJ_REF, conceptKey: K_MODEL2, result: aligned([O_RETIRED]) },
    { source: Q1_REF, conceptKey: K_MODEL2, result: aligned(['entry-1']) },
    { source: PAPER_REF, conceptKey: K_MODEL2, result: aligned(['part-1']) },
  ];
}

export const DOCUMENTS = [
  { source: OBJ_REF, currentDigests: CURRENT },
  { source: Q1_REF, currentDigests: CURRENT },
  { source: PAPER_REF, currentDigests: CURRENT },
] as const;

// ------------------------------------------------------------------------------------------------
// The grove
// ------------------------------------------------------------------------------------------------

const OBJECTIVES = DOC;

const EVIDENCE: ConceptMasteryEvidence = {
  scoredEventCount: 0,
  scoredSuccessCount: 0,
  explainBackAttempts: 0,
  tiersPracticed: { recognition: false, recall: false, explanation: false },
  gradedExplainBackCount: 0,
  recognitionOnly: false,
  successfulScoredDays: 0,
  deepestSoloLevel: null,
  depthGateCleared: false,
  topStageQualified: false,
};

function groveConcept(key: string, name: string) {
  return {
    key,
    name,
    tier: 2 as const,
    courses: [COURSE],
    sourcePaths: [`Notes/${key}.md` as VaultPath],
  };
}

function presence(key: string, instrumentCount: number): ConceptMaterialPresence {
  return { notePaths: [`Notes/${key}.md` as VaultPath], instrumentCount };
}

function mastery(conceptId: string, state: ConceptMasteryResult['state']): ConceptMasteryResult {
  return { conceptId, state, evidence: EVIDENCE };
}

function source(path: VaultPath, role: Source['role']): Source {
  return { path, role, course: COURSE, kind: 'registered-file', format: null };
}

function citation(
  conceptName: string,
  kind: ConceptCitation['kind'],
  sourcePath: VaultPath,
): ConceptCitation {
  return {
    conceptName,
    kind,
    sourcePath,
    course: COURSE,
    provenance: {
      location: { page: 1, charRange: { start: 0, end: 1 } },
    } as ConceptCitation['provenance'],
  };
}

/** One declared course: two declared concepts with material, one declared name with none, two volunteers. */
export function groveInput(): BuildGroveModelInput {
  return {
    course: COURSE,
    concepts: [
      groveConcept(K_EXACT, 'Widget Theory'),
      groveConcept(K_ALIAS, 'Gizmo Law'),
      groveConcept(K_MODEL, 'Flange Rule'),
      groveConcept(K_MODEL2, 'Cog Principle'),
    ],
    sources: [source(OBJECTIVES, 'objectives'), source(PAPER, 'past-paper')],
    citations: [
      citation('Widget Theory', 'objectives', OBJECTIVES),
      citation('Missing Topic', 'objectives', OBJECTIVES),
      citation('Gizmo Law', 'past-paper', PAPER),
      citation('Widget Theory', 'past-paper', PAPER),
    ],
    materialPresence: new Map([
      [K_EXACT, presence(K_EXACT, 2)],
      [K_ALIAS, presence(K_ALIAS, 0)],
      [K_MODEL, presence(K_MODEL, 1)],
      [K_MODEL2, presence(K_MODEL2, 0)],
    ]),
    mastery: new Map([
      [K_EXACT, mastery(K_EXACT, 'sprout')],
      [K_MODEL, mastery(K_MODEL, 'seed')],
    ]),
  };
}
