/**
 * The grove's separate listing of model-decided concepts (`[D-433]`, `ol-egov.141.89.7.26`), behind
 * her correction control (`[D-533]`). Scenarios: olea-service `features/F8-concepts-scope.md`,
 * section "`[D-433]` — Model-decided containment and scope standing", tagged
 * `@auto:core/scope/grove.model-decided.ol-egov.141.89.7.26.spec`.
 *
 * **The golden** (`grove.model-decided.identity.golden.json`) was written from the code as it
 * stood BEFORE this bead touched `./grove.ts` (`56d2121d`, today's call), and is compared byte for
 * byte as compact JSON (`JSON.stringify`, never field by field). Regenerate it only deliberately, and never after the change (that proves nothing):
 * `OLEA_WRITE_GROVE_MODEL_DECIDED_GOLDEN=1 pnpm exec vitest run <this file>`.
 *
 * INV-3: every course code, concept name, path and sentence below is invented.
 */

import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  aligned,
  COURSE,
  DOCUMENTS,
  everyBasisAligned,
  groveInput,
  K_EXACT,
  K_MODEL,
  K_MODEL2,
  O_EXACT,
  O_MISS,
  OBJ_REF,
  offGates,
  PAPER_REF,
  projectionOf,
  seedCourse,
  switchesOn,
} from '../../test/support/model-decided-fixtures.js';
import { resolveBasisSwitches } from '../evidence-edge/basis-switch.js';
import {
  type ModelDecidedContainmentRead,
  type ReadModelDecidedContainmentInput,
  readModelDecidedContainment,
} from '../outcome/reconcile.js';
import { FolderSource } from '../vault/folder-source.js';
import { type BuildGroveModelResult, buildGroveModel } from './grove.js';

const GOLDEN = fileURLToPath(
  new URL('./grove.model-decided.identity.golden.json', import.meta.url),
);

function serialize(result: BuildGroveModelResult): string {
  return JSON.stringify({ model: result.model, nextGroundStreaks: [...result.nextGroundStreaks] });
}

/** The golden as compact JSON: the bytes compared, whatever the file's own formatting. */
function golden(): string {
  return JSON.stringify(JSON.parse(readFileSync(GOLDEN, 'utf8')));
}

describe("ol-egov.141.89.7.26 — today's grove, pinned before this change", () => {
  it("today's call: the grove model is the golden's bytes", () => {
    const actual = serialize(buildGroveModel(groveInput()));
    if (process.env.OLEA_WRITE_GROVE_MODEL_DECIDED_GOLDEN === '1') {
      writeFileSync(GOLDEN, `${JSON.stringify(JSON.parse(actual), null, 2)}\n`);
    } else if (!existsSync(GOLDEN)) {
      throw new Error('golden missing: regenerate it deliberately (module doc)');
    }
    expect(actual).toBe(golden());
  });
});

describe('the grove from the real read', () => {
  let root: string;
  let vault: FolderSource;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'olea-grove-model-decided-'));
    vault = new FolderSource(root);
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  type Overrides = Partial<Omit<ReadModelDecidedContainmentInput, 'outcomes'>>;

  async function readFor(overrides: Overrides): Promise<ModelDecidedContainmentRead> {
    const outcomes = await seedCourse(vault);
    return readModelDecidedContainment(vault, {
      correctionControlAvailable: true,
      courseId: COURSE,
      documents: DOCUMENTS,
      alignments: projectionOf(everyBasisAligned()),
      switches: switchesOn(['objectives', 'assessment-brief', 'past-paper']),
      attached: [{ outcomeId: O_EXACT, conceptKey: K_EXACT }],
      outcomes,
      ...overrides,
    });
  }

  function groveWith(read: ModelDecidedContainmentRead): string {
    return serialize(buildGroveModel({ ...groveInput(), modelDecided: read }));
  }

  it('her correction control unavailable, every switch on: the golden', async () => {
    const read = await readFor({ correctionControlAvailable: false });
    expect(groveWith(read)).toBe(golden());
  });

  it('her correction control not stated: the golden', async () => {
    const read = await readFor({
      correctionControlAvailable: undefined as unknown as boolean,
    });
    expect(groveWith(read)).toBe(golden());
  });

  it('her control available, every switch off: the golden', async () => {
    const read = await readFor({ switches: resolveBasisSwitches() });
    expect(groveWith(read)).toBe(golden());
  });

  it.each(offGates())(
    'her control available, containment switches off ($name): the golden',
    async ({ gate }) => {
      const read = await readFor({ switches: resolveBasisSwitches(gate) });
      expect(groveWith(read)).toBe(golden());
    },
  );

  it('a model-decided concept no registered source names is listed apart, with its own count; the declared and built counts and the cells are the switch-off values', async () => {
    const read = await readFor({ switches: switchesOn(['objectives']) });
    expect(read.status === 'read' ? read.edges.map((e) => e.conceptKey) : []).toEqual([K_MODEL]);
    const result = buildGroveModel({ ...groveInput(), modelDecided: read });
    const today = JSON.parse(readFileSync(GOLDEN, 'utf8')).model;
    expect(result.model.status).toBe('declared');
    if (result.model.status !== 'declared') return;
    const { modelDecided, volunteers, ...rest } = result.model;
    const { volunteers: todayVolunteers, ...todayRest } = today;
    expect(rest).toEqual(todayRest);
    expect(result.model.summary.denominatorCount).toBe(today.summary.denominatorCount);
    expect(result.model.summary.builtCount).toBe(today.summary.builtCount);
    expect(modelDecided).toEqual({
      count: 1,
      concepts: [{ conceptKey: K_MODEL, conceptName: 'Flange Rule', outcomeIds: [O_MISS] }],
    });
    // Not shown as a volunteer; the other volunteer stays one.
    expect(volunteers.map((v) => v.conceptKey)).toEqual(
      todayVolunteers
        .map((v: { conceptKey: string }) => v.conceptKey)
        .filter((key: string) => key !== K_MODEL),
    );
  });

  it('a model-decided concept already declared is counted once, as declared, never listed apart', async () => {
    const read = await readFor({
      switches: switchesOn(['objectives']),
      attached: [],
      alignments: projectionOf([
        { source: OBJ_REF, conceptKey: K_EXACT, result: aligned([O_MISS]) },
      ]),
    });
    expect(read.status === 'read' ? read.edges.map((e) => e.conceptKey) : []).toEqual([K_EXACT]);
    const result = buildGroveModel({ ...groveInput(), modelDecided: read });
    expect(result.model.status === 'declared' ? result.model.modelDecided : 'not declared').toEqual(
      {
        count: 0,
        concepts: [],
      },
    );
  });

  it('past-paper alignment and stated-scope standing give no grove entry', async () => {
    const read = await readFor({
      switches: switchesOn(['objectives', 'assessment-brief', 'past-paper']),
      alignments: projectionOf([
        { source: PAPER_REF, conceptKey: K_MODEL, result: aligned([O_MISS]) },
        ...everyBasisAligned().filter((f) => f.source.documentKind === 'stated-scope'),
      ]),
    });
    expect(read.status === 'read' ? read.standings.map((s) => s.conceptKey) : []).toEqual([
      K_MODEL2,
    ]);
    const result = buildGroveModel({ ...groveInput(), modelDecided: read });
    expect(result.model.status === 'declared' ? result.model.modelDecided : 'not declared').toEqual(
      {
        count: 0,
        concepts: [],
      },
    );
    const today = JSON.parse(readFileSync(GOLDEN, 'utf8')).model;
    expect(result.model.status === 'declared' ? result.model.volunteers : []).toEqual(
      today.volunteers,
    );
  });
});
