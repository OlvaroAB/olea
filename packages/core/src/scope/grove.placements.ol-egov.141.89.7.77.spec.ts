/**
 * The grove's section for links Olea's reading makes under a course's objectives (`[D-537]`,
 * `ol-egov.141.89.7.77`): each placed concept with the wording of every objective it is placed
 * under and the document to open, the placements she took out listed apart for putting back, and
 * a concept whose every placement she took out a volunteer again. Never in the declared count or
 * the built count. Scenarios: olea-service `features/F8-concepts-scope.md`, the `[D-537]` feature,
 * tagged `@auto:core/scope/grove.placements.ol-egov.141.89.7.77.spec`.
 *
 * INV-3: every course code, concept name, path and sentence below is invented.
 */

import { readFileSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  aligned,
  COURSE,
  CURRENT,
  DOC,
  DOCUMENTS,
  groveInput,
  K_EXACT,
  K_MODEL,
  O_ALIAS,
  O_MISS,
  OBJ_REF,
  outcome,
  projectionOf,
  seedCourse,
  switchesOn,
} from '../../test/support/model-decided-fixtures.js';
import {
  objectivesDeclarationOf,
  recordContainmentCorrection,
} from '../outcome/containment-correction.js';
import {
  type ModelDecidedContainmentRead,
  type ReadModelDecidedContainmentInput,
  readModelDecidedContainment,
} from '../outcome/reconcile.js';
import type { ScopeRevisionRef } from '../outcome/scope-reading-project.js';
import type { OutcomeRecord } from '../outcome/types.js';
import { FolderSource } from '../vault/folder-source.js';
import type { VaultPath } from '../vault/types.js';
import { buildGroveModel, type GroveCourseModel } from './grove.js';

const GOLDEN = fileURLToPath(
  new URL('./grove.model-decided.identity.golden.json', import.meta.url),
);
const TODAY = JSON.parse(readFileSync(GOLDEN, 'utf8')).model;

const DOC2 = '03 Research/Objectives A2.md' as VaultPath;
const OBJ2_REF: ScopeRevisionRef = {
  documentKind: 'objectives',
  sourcePath: DOC2,
  revisionDigest: 'rev-objectives-a2',
};

type Declared = Extract<GroveCourseModel, { readonly status: 'declared' }>;

describe('[D-537] — the grove lists each placement with its objective, and the ones she took out apart', () => {
  let root: string;
  let vault: FolderSource;
  let outcomes: readonly OutcomeRecord[];

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'olea-grove-placements-'));
    vault = new FolderSource(root);
    outcomes = await seedCourse(vault);
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  /** K_MODEL placed under O_MISS and O_ALIAS, both of the objectives document. */
  async function read(
    overrides: Partial<ReadModelDecidedContainmentInput> = {},
  ): Promise<ModelDecidedContainmentRead> {
    return readModelDecidedContainment(vault, {
      correctionControlAvailable: { objectives: true, 'assessment-brief': false },
      courseId: COURSE,
      outcomes,
      documents: DOCUMENTS,
      alignments: projectionOf([
        { source: OBJ_REF, conceptKey: K_MODEL, result: aligned([O_MISS, O_ALIAS]) },
      ]),
      switches: switchesOn(['objectives']),
      ...overrides,
    });
  }

  function wordings(records: readonly OutcomeRecord[] = outcomes): ReadonlyMap<string, string> {
    return new Map(records.map((o) => [o.id, o.label]));
  }

  /** `null` supplies no wordings at all. */
  function grove(
    modelDecided: ModelDecidedContainmentRead,
    objectiveWordings: ReadonlyMap<string, string> | null = wordings(),
  ): Declared {
    const { model } = buildGroveModel({
      ...groveInput(),
      modelDecided,
      ...(objectiveWordings !== null ? { objectiveWordings } : {}),
    });
    if (model.status !== 'declared') throw new Error('expected a declared course');
    return model;
  }

  async function declaration(id: string) {
    return objectivesDeclarationOf(outcomes.find((o) => o.id === id) as OutcomeRecord, COURSE);
  }

  async function choose(id: string, kind: 'declined' | 'accepted', at: string) {
    await recordContainmentCorrection(vault, await declaration(id), K_MODEL, kind, {
      now: () => at,
    });
  }

  it('one entry per concept, with the wording of each objective it is placed under and the document to open', async () => {
    const model = grove(await read());
    expect(model.modelDecided).toEqual({
      count: 1,
      concepts: [
        {
          conceptKey: K_MODEL,
          conceptName: 'Flange Rule',
          outcomeIds: [O_ALIAS, O_MISS],
          placements: [
            {
              outcomeId: O_MISS,
              conceptKey: K_MODEL,
              wording: 'Analyse a loaded frame',
              documentPath: DOC,
              declaration: await declaration(O_MISS),
            },
            {
              outcomeId: O_ALIAS,
              conceptKey: K_MODEL,
              wording: 'Gizmo rule',
              documentPath: DOC,
              declaration: await declaration(O_ALIAS),
            },
          ],
        },
      ],
      declined: [],
    });
    expect(model.volunteers.map((v) => v.conceptKey)).not.toContain(K_MODEL);
  });

  it('never enters the declared count, the built count or the declared cells', async () => {
    const model = grove(await read());
    expect(model.summary).toEqual(TODAY.summary);
    expect(model.cells).toEqual(TODAY.cells);
    expect(model.materialGaps).toEqual(TODAY.materialGaps);
  });

  it('taking one placement out leaves the others standing, and lists it apart for putting back', async () => {
    await choose(O_MISS, 'declined', 't1');
    const model = grove(await read());
    expect(model.modelDecided?.count).toBe(1);
    expect(model.modelDecided?.concepts[0]?.placements.map((p) => p.outcomeId)).toEqual([O_ALIAS]);
    expect(model.modelDecided?.declined).toEqual([
      {
        outcomeId: O_MISS,
        conceptKey: K_MODEL,
        conceptName: 'Flange Rule',
        wording: 'Analyse a loaded frame',
        documentPath: DOC,
        declaration: await declaration(O_MISS),
      },
    ]);
    expect(model.volunteers.map((v) => v.conceptKey)).not.toContain(K_MODEL);
  });

  it('a concept whose every placement she took out is a volunteer again, and its placements stay listed to put back', async () => {
    await choose(O_MISS, 'declined', 't1');
    await choose(O_ALIAS, 'declined', 't2');
    const model = grove(await read());
    expect(model.modelDecided?.count).toBe(0);
    expect(model.modelDecided?.concepts).toEqual([]);
    expect(model.modelDecided?.declined.map((d) => [d.conceptKey, d.outcomeId])).toEqual([
      [K_MODEL, O_MISS],
      [K_MODEL, O_ALIAS],
    ]);
    expect(model.volunteers).toEqual(TODAY.volunteers);
  });

  it('putting one back lists it as a placement again', async () => {
    await choose(O_MISS, 'declined', 't1');
    await choose(O_MISS, 'accepted', 't2');
    const model = grove(await read());
    expect(model.modelDecided?.concepts[0]?.placements.map((p) => p.outcomeId)).toEqual([
      O_MISS,
      O_ALIAS,
    ]);
    expect(model.modelDecided?.declined).toEqual([]);
  });

  it('a placement whose objective wording is not supplied is not listed, and its concept stays where it was', async () => {
    const onlyAlias = new Map([[O_ALIAS, 'Gizmo rule']]);
    const partial = grove(await read(), onlyAlias);
    expect(partial.modelDecided?.concepts[0]?.placements.map((p) => p.outcomeId)).toEqual([
      O_ALIAS,
    ]);
    const none = grove(await read(), null);
    expect(none.modelDecided).toEqual({ count: 0, concepts: [], declined: [] });
    expect(none.volunteers).toEqual(TODAY.volunteers);
  });

  it('a concept already declared is never listed, standing or taken out', async () => {
    const alignments = projectionOf([
      { source: OBJ_REF, conceptKey: K_EXACT, result: aligned([O_MISS]) },
    ]);
    await recordContainmentCorrection(vault, await declaration(O_ALIAS), K_EXACT, 'declined', {
      now: () => 't1',
    });
    const both = projectionOf([
      { source: OBJ_REF, conceptKey: K_EXACT, result: aligned([O_MISS, O_ALIAS]) },
    ]);
    expect(grove(await read({ alignments })).modelDecided).toEqual({
      count: 0,
      concepts: [],
      declined: [],
    });
    expect(grove(await read({ alignments: both })).modelDecided).toEqual({
      count: 0,
      concepts: [],
      declined: [],
    });
  });

  it('one wording in two documents of the course is one placement: one judgement, one control', async () => {
    const twin = await outcome('outcome-key1:o-miss-twin', 'Analyse a loaded frame', 0);
    const twinElsewhere: OutcomeRecord = { ...twin, source: { ...twin.source, path: DOC2 } };
    const both = [...outcomes, twinElsewhere];
    const model = grove(
      await read({
        outcomes: both,
        documents: [...DOCUMENTS, { source: OBJ2_REF, currentDigests: CURRENT }],
        alignments: projectionOf([
          { source: OBJ_REF, conceptKey: K_MODEL, result: aligned([O_MISS]) },
          { source: OBJ2_REF, conceptKey: K_MODEL, result: aligned([twinElsewhere.id]) },
        ]),
      }),
      wordings(both),
    );
    const placements = model.modelDecided?.concepts[0]?.placements ?? [];
    expect(placements.map((p) => [p.wording, p.documentPath])).toEqual([
      ['Analyse a loaded frame', DOC],
    ]);
  });
});
