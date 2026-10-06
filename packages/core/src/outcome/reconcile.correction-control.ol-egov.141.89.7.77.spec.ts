/**
 * Her correction control for links Olea's reading makes under a course's objectives (`[D-537]`,
 * `ol-egov.141.89.7.77`): the read's half. The statement that her control exists is split per
 * basis, the read returns the placements she took out apart from the ones that count, and her
 * choice is keyed on the course and the objective's wording, so it holds across a rename or move of
 * the document. Scenarios: olea-service `features/F8-concepts-scope.md`, the `[D-537]` feature,
 * tagged `@auto:core/outcome/reconcile.correction-control.ol-egov.141.89.7.77.spec`.
 *
 * INV-3: every course code, concept name, path and sentence below is invented.
 */

import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  aligned,
  COURSE,
  CURRENT,
  DOCUMENTS,
  everyBasisAligned,
  K_EXACT,
  K_MODEL,
  K_MODEL2,
  O_EXACT,
  O_MISS,
  OBJ_REF,
  outcome,
  projectionOf,
  READER,
  SCOPE_Q1,
  seedCourse,
  switchesOn,
} from '../../test/support/model-decided-fixtures.js';
import type { ConceptKeyCanonicalIndex } from '../concept/key-store.js';
import { FolderSource } from '../vault/folder-source.js';
import type { VaultPath } from '../vault/types.js';
import {
  containmentCorrectionPath,
  objectivesDeclarationOf,
  readContainmentCorrection,
  recordContainmentCorrection,
} from './containment-correction.js';
import {
  type CorrectionControlAvailability,
  type ModelDecidedContainmentRead,
  type ReadModelDecidedContainmentInput,
  readModelDecidedContainment,
} from './reconcile.js';
import type { OutcomeRecord } from './types.js';

const IDENTITY: ConceptKeyCanonicalIndex = { canonicalOf: (k) => k, superseded: new Map() };
const OBJECTIVES_ONLY: CorrectionControlAvailability = {
  objectives: true,
  'assessment-brief': false,
};
const BOTH: CorrectionControlAvailability = { objectives: true, 'assessment-brief': true };
/** What the reconciliation attaches by exact name in this course: read once, as that attachment. */
const ATTACHED = [{ outcomeId: O_EXACT, conceptKey: K_EXACT }];

function pairs(read: ModelDecidedContainmentRead) {
  return {
    edges: read.status === 'read' ? read.edges.map((e) => [e.outcomeId, e.conceptKey]) : [],
    standings: read.status === 'read' ? read.standings.map((s) => [s.scopeKey, s.conceptKey]) : [],
    declined:
      read.status === 'read' ? read.declinedPlacements.map((d) => [d.outcomeId, d.conceptKey]) : [],
  };
}

describe('[D-537] — the statement that her correction control exists is per basis', () => {
  let root: string;
  let vault: FolderSource;
  let outcomes: readonly OutcomeRecord[];

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'olea-correction-control-flag-'));
    vault = new FolderSource(root);
    outcomes = await seedCourse(vault);
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  async function read(correctionControlAvailable: unknown) {
    return readModelDecidedContainment(vault, {
      correctionControlAvailable: correctionControlAvailable as CorrectionControlAvailability,
      courseId: COURSE,
      outcomes,
      documents: DOCUMENTS,
      alignments: projectionOf(everyBasisAligned()),
      switches: switchesOn(['objectives', 'assessment-brief', 'past-paper']),
      canonicalKeys: IDENTITY,
      attached: ATTACHED,
    });
  }

  it('her control for objectives only: objectives placements count, and a stated scope stays off whatever its switch says', async () => {
    expect(pairs(await read(OBJECTIVES_ONLY))).toEqual({
      edges: [[O_MISS, K_MODEL]],
      standings: [],
      declined: [],
    });
  });

  it('each half enables only its own basis', async () => {
    expect(pairs(await read({ objectives: false, 'assessment-brief': true }))).toEqual({
      edges: [],
      standings: [[SCOPE_Q1, K_MODEL2]],
      declined: [],
    });
    expect(pairs(await read(BOTH)).edges).toEqual([[O_MISS, K_MODEL]]);
  });

  it('neither half, an earlier single-flag statement, or a value that is not literally true: disabled before anything is read', async () => {
    for (const statement of [
      { objectives: false, 'assessment-brief': false },
      true,
      false,
      undefined,
      null,
      { objectives: 'yes', 'assessment-brief': 'yes' },
      { objectives: 1 },
      {},
    ]) {
      expect(await read(statement)).toEqual({
        status: 'disabled',
        reason: 'correction-control-unavailable',
      });
    }
  });

  it('her control for objectives with only the assessment-brief switch on reads nothing: the existing checks still come first', async () => {
    const result = await readModelDecidedContainment(vault, {
      correctionControlAvailable: OBJECTIVES_ONLY,
      courseId: COURSE,
      outcomes,
      documents: DOCUMENTS,
      alignments: projectionOf(everyBasisAligned()),
      switches: switchesOn(['assessment-brief', 'past-paper']),
      canonicalKeys: IDENTITY,
    });
    expect(result).toEqual({ status: 'disabled', reason: 'no-containment-basis-on' });
  });
});

describe('[D-537] — the read returns the placements she took out, apart from the ones that count', () => {
  let root: string;
  let vault: FolderSource;
  let outcomes: readonly OutcomeRecord[];

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'olea-correction-control-read-'));
    vault = new FolderSource(root);
    outcomes = await seedCourse(vault);
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  type Overrides = Partial<Omit<ReadModelDecidedContainmentInput, 'canonicalKeys'>>;

  async function read(overrides: Overrides = {}) {
    return readModelDecidedContainment(vault, {
      correctionControlAvailable: OBJECTIVES_ONLY,
      courseId: COURSE,
      outcomes,
      documents: DOCUMENTS,
      alignments: projectionOf(everyBasisAligned()),
      switches: switchesOn(['objectives']),
      canonicalKeys: IDENTITY,
      attached: ATTACHED,
      ...overrides,
    });
  }

  async function missDeclaration(courseId = COURSE) {
    return objectivesDeclarationOf(
      outcomes.find((o) => o.id === O_MISS) as OutcomeRecord,
      courseId,
    );
  }

  async function choose(kind: 'declined' | 'accepted', at: string, courseId = COURSE) {
    await recordContainmentCorrection(vault, await missDeclaration(courseId), K_MODEL, kind, {
      now: () => at,
    });
  }

  it('taken out: not among the links that count, and listed apart with its provenance and declaration, marked declined', async () => {
    await choose('declined', 't1');
    const result = await read();
    expect(result.status).toBe('read');
    if (result.status !== 'read') return;
    expect(result.edges).toEqual([]);
    expect(result.declinedPlacements).toEqual([
      {
        outcomeId: O_MISS,
        conceptKey: K_MODEL,
        basis: 'objectives',
        decidedBy: 'model',
        correction: 'declined',
        declaration: await missDeclaration(),
        provenance: {
          task: READER.task,
          promptVersion: READER.promptVersion,
          modelId: READER.modelId,
          source: OBJ_REF,
          digests: { ...CURRENT, frozenConfiguration: 'sha256:config-c' },
        },
      },
    ]);
  });

  it('put back: counts again, and is no longer listed as taken out', async () => {
    await choose('declined', 't1');
    await choose('accepted', 't2');
    expect(pairs(await read())).toEqual({
      edges: [[O_MISS, K_MODEL]],
      standings: [],
      declined: [],
    });
  });

  it("a placement she took out is listed only while the read's other conditions hold", async () => {
    await choose('declined', 't1');
    expect(pairs(await read({ switches: switchesOn(['assessment-brief']) }))).toEqual({
      edges: [],
      standings: [],
      declined: [],
    });
    const stale = projectionOf([
      {
        source: OBJ_REF,
        conceptKey: K_MODEL,
        result: aligned([O_MISS]),
        digests: { coverage: 'sha256:moved' },
      },
    ]);
    expect(pairs(await read({ alignments: stale })).declined).toEqual([]);
  });

  it('an unreadable history is in neither list, so no control is offered for it', async () => {
    await vault.write(await containmentCorrectionPath(await missDeclaration(), K_MODEL), 'torn');
    expect(pairs(await read())).toEqual({ edges: [], standings: [], declined: [] });
  });

  it("a history in the earlier path-keyed shape at the pair's path fails closed", async () => {
    await vault.write(
      await containmentCorrectionPath(await missDeclaration(), K_MODEL),
      `${JSON.stringify({
        declaration: { kind: 'objectives', sourcePath: OBJ_REF.sourcePath, wordingKey: 'v1:x' },
        conceptKey: K_MODEL,
        events: [{ kind: 'accepted', at: 't0' }],
        schemaVersion: 1,
      })}\n`,
    );
    expect(pairs(await read())).toEqual({ edges: [], standings: [], declined: [] });
  });

  it('her choice holds when the objectives document is renamed or moved', async () => {
    await choose('declined', 't1');
    for (const path of ['03 Research/Aims A.md', 'Archive/2026/Objectives A.md'] as VaultPath[]) {
      // The renamed document's declarations, re-read under its new path (the same wording).
      const renamedRef = { ...OBJ_REF, sourcePath: path };
      const reread = outcomes.map((o) => ({ ...o, source: { ...o.source, path } }));
      const result = await read({
        outcomes: reread,
        documents: [{ source: renamedRef, currentDigests: CURRENT }],
        alignments: projectionOf([
          { source: renamedRef, conceptKey: K_MODEL, result: aligned([O_MISS]) },
        ]),
      });
      expect(pairs(result)).toEqual({ edges: [], standings: [], declined: [[O_MISS, K_MODEL]] });
      expect(
        result.status === 'read' ? result.declinedPlacements[0]?.provenance.source : null,
      ).toEqual(renamedRef);
    }
  });

  it('her choice holds across an unrelated edit that re-mints the objective on another unit, and is listed for putting back', async () => {
    await choose('declined', 't1');
    const moved = await outcome('outcome-key1:o-miss-moved', 'Analyse a loaded frame', 7);
    const newRevision = { ...OBJ_REF, revisionDigest: 'rev-objectives-3' };
    const result = await read({
      outcomes: [...outcomes.filter((o) => o.id !== O_MISS), moved],
      documents: [{ source: newRevision, currentDigests: CURRENT }],
      alignments: projectionOf([
        { source: newRevision, conceptKey: K_MODEL, result: aligned([moved.id]) },
      ]),
    });
    expect(pairs(result)).toEqual({ edges: [], standings: [], declined: [[moved.id, K_MODEL]] });
  });

  it('rewording the objective is new evidence; her choice about the earlier wording is kept', async () => {
    await choose('declined', 't1');
    const reworded = await outcome('outcome-key1:o-reworded', 'Model the load path of a frame', 3);
    const result = await read({
      outcomes: [...outcomes.filter((o) => o.id !== O_MISS), reworded],
      alignments: projectionOf([
        { source: OBJ_REF, conceptKey: K_MODEL, result: aligned([reworded.id]) },
      ]),
    });
    expect(pairs(result)).toEqual({ edges: [[reworded.id, K_MODEL]], standings: [], declined: [] });
    const kept = await readContainmentCorrection(vault, await missDeclaration(), K_MODEL);
    expect(kept.kind === 'record' ? kept.record.events.map((e) => e.kind) : []).toEqual([
      'declined',
    ]);
  });

  it('her choice is per course: the same objective read for another course still stands there', async () => {
    await choose('declined', 't1');
    const shared = outcomes.map((o) => ({ ...o, courses: [COURSE, 'COURSEB'] }));
    const forB = await read({
      courseId: 'COURSEB',
      outcomes: shared,
      alignments: projectionOf([
        { source: OBJ_REF, conceptKey: K_MODEL, result: aligned([O_MISS]), courseId: 'COURSEB' },
      ]),
    });
    expect(pairs(forB).edges).toEqual([[O_MISS, K_MODEL]]);
    expect(pairs(await read({ outcomes: shared })).declined).toEqual([[O_MISS, K_MODEL]]);
  });
});
