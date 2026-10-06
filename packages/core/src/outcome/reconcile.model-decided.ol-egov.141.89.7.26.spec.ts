/**
 * Model-decided containment and scope standing (`[D-433]`, `ol-egov.141.89.7.26`), with her
 * correction history (`[D-533]`, A strengthened). Scenarios: olea-service
 * `features/F8-concepts-scope.md`, section "`[D-433]` — Model-decided containment and scope
 * standing", tagged `@auto:core/outcome/reconcile.model-decided.ol-egov.141.89.7.26.spec`.
 *
 * **The golden** (`reconcile.model-decided.identity.golden.json`) was written from the code as it
 * stood BEFORE this bead touched `./reconcile.ts` (`56d2121d`, today's call, no model-decided code
 * in the tree), and is compared byte for byte as compact JSON (`JSON.stringify`, never field by
 * field): the report and the exact text of every file the run leaves in the vault. Regenerate it only deliberately, and never after the change (that proves nothing):
 * `OLEA_WRITE_RECONCILE_MODEL_DECIDED_GOLDEN=1 pnpm exec vitest run <this file>`.
 *
 * INV-3: every course code, concept name, path and sentence below is invented.
 */

import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  aligned,
  CONCEPTS,
  CONFIG_OTHER,
  COURSE,
  CURRENT,
  DOCUMENTS,
  everyBasisAligned,
  K_EXACT,
  K_MODEL,
  K_MODEL2,
  K_NEAR,
  NOW,
  O_EXACT,
  O_MISS,
  O_NEAR,
  OBJ_REF,
  offGates,
  outcome,
  PAPER_REF,
  projectionOf,
  Q1_REF,
  READER,
  SCOPE_Q1,
  seedCourse,
  switchesOn,
  vaultFiles,
  writeOutcome,
} from '../../test/support/model-decided-fixtures.js';
import type { ConceptKeyCanonicalIndex } from '../concept/key-store.js';
import { resolveBasisSwitches } from '../evidence-edge/basis-switch.js';
import { FolderSource } from '../vault/folder-source.js';
import {
  containmentCorrectionPath,
  objectivesDeclarationOf,
  readContainmentCorrection,
  recordContainmentCorrection,
  statedScopeDeclarationOf,
} from './containment-correction.js';
import {
  OUTCOME_CONCEPT_NEAR_MATCH_RECORD_SCHEMA_VERSION,
  outcomeConceptNearMatchRecordPath,
} from './near-match.js';
import {
  type CorrectionControlAvailability,
  type ModelDecidedContainmentRead,
  type ReadModelDecidedContainmentInput,
  readModelDecidedContainment,
  reconcileOutcomeConcepts,
} from './reconcile.js';
import type { OutcomeRecord } from './types.js';

const GOLDEN = fileURLToPath(
  new URL('./reconcile.model-decided.identity.golden.json', import.meta.url),
);
/** The golden as compact JSON: the bytes compared, whatever the file's own formatting. */
function golden(): string {
  return JSON.stringify(JSON.parse(readFileSync(GOLDEN, 'utf8')));
}
const IDENTITY: ConceptKeyCanonicalIndex = { canonicalOf: (k) => k, superseded: new Map() };
/** `[D-537]`: the statement is per basis. Both halves, for the suites that read both bases. */
const BOTH_CONTROLS: CorrectionControlAvailability = { objectives: true, 'assessment-brief': true };
const NO_CONTROL: CorrectionControlAvailability = { objectives: false, 'assessment-brief': false };
/** What the reconciliation attaches by exact name and alias in this course. */
const ATTACHED_BY_NAME = [
  { outcomeId: O_EXACT, conceptKey: K_EXACT },
  { outcomeId: 'outcome-key1:o-alias', conceptKey: 'concept-key1:gizmo' },
];

type ReadOptions = Omit<
  ReadModelDecidedContainmentInput,
  'outcomes' | 'attached' | 'canonicalKeys'
>;

/** Her control available, the given switches, every basis aligned. */
function readOptions(overrides: Partial<ReadOptions> = {}): ReadOptions {
  return {
    correctionControlAvailable: BOTH_CONTROLS,
    courseId: COURSE,
    documents: DOCUMENTS,
    alignments: projectionOf(everyBasisAligned()),
    switches: switchesOn(['objectives', 'assessment-brief', 'past-paper']),
    ...overrides,
  };
}

function edges(read: ModelDecidedContainmentRead) {
  return read.status === 'read' ? read.edges.map((e) => [e.outcomeId, e.conceptKey]) : [];
}

function standings(read: ModelDecidedContainmentRead) {
  return read.status === 'read' ? read.standings.map((s) => [s.scopeKey, s.conceptKey]) : [];
}

describe('ol-egov.141.89.7.26 — off is exactly today: the golden pinned before this change', () => {
  let root: string;
  let vault: FolderSource;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'olea-reconcile-model-decided-'));
    vault = new FolderSource(root);
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  async function runAndSerialize(options?: ReadOptions): Promise<string> {
    const outcomes = await seedCourse(vault);
    const report = await reconcileOutcomeConcepts(vault, outcomes, CONCEPTS, {
      now: () => NOW,
      ...(options !== undefined ? { modelDecided: options } : {}),
    });
    return JSON.stringify({ report, files: await vaultFiles(root) });
  }

  it("today's call: the report and every file it leaves are the golden's bytes", async () => {
    const actual = await runAndSerialize();
    if (process.env.OLEA_WRITE_RECONCILE_MODEL_DECIDED_GOLDEN === '1') {
      writeFileSync(GOLDEN, `${JSON.stringify(JSON.parse(actual), null, 2)}\n`);
    } else if (!existsSync(GOLDEN)) {
      throw new Error('golden missing: regenerate it deliberately (module doc)');
    }
    expect(actual).toBe(golden());
  });

  it('her correction control not available (false): the golden, whatever the switches say', async () => {
    expect(await runAndSerialize(readOptions({ correctionControlAvailable: NO_CONTROL }))).toBe(
      golden(),
    );
  });

  it('her correction control not stated at all: the golden, whatever the switches say', async () => {
    const { correctionControlAvailable: _omitted, ...rest } = readOptions();
    expect(await runAndSerialize(rest as ReadOptions)).toBe(golden());
  });

  it('a truthy value that is not true is not her control: the golden', async () => {
    const options = {
      ...readOptions(),
      correctionControlAvailable: { objectives: 'yes', 'assessment-brief': 'yes' },
    } as unknown as ReadOptions;
    expect(await runAndSerialize(options)).toBe(golden());
  });

  it('the earlier single-flag statement is not her control for any basis ([D-537]): the golden', async () => {
    const options = {
      ...readOptions(),
      correctionControlAvailable: true,
    } as unknown as ReadOptions;
    expect(await runAndSerialize(options)).toBe(golden());
  });

  it('her control available, every basis switch off (the production default): the golden', async () => {
    expect(await runAndSerialize(readOptions({ switches: resolveBasisSwitches() }))).toBe(golden());
  });

  it('her control available, switches omitted (default all off): the golden', async () => {
    const { switches: _omitted, ...rest } = readOptions();
    expect(await runAndSerialize(rest)).toBe(golden());
  });
});

describe.each(offGates())('a containment switch off ($name) counts nothing', ({ gate }) => {
  let root: string;
  let vault: FolderSource;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'olea-reconcile-model-decided-off-'));
    vault = new FolderSource(root);
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it('the reconciliation is the golden, and the read reads nothing', async () => {
    const switches = resolveBasisSwitches(gate);
    expect(switches.objectives.status).toBe('off');
    expect(switches['assessment-brief'].status).toBe('off');
    const outcomes = await seedCourse(vault);
    const read = await readModelDecidedContainment(vault, {
      ...readOptions({ switches }),
      outcomes,
    });
    expect(read).toEqual({ status: 'disabled', reason: 'no-containment-basis-on' });
    const report = await reconcileOutcomeConcepts(vault, outcomes, CONCEPTS, {
      now: () => NOW,
      modelDecided: readOptions({ switches }),
    });
    expect(JSON.stringify({ report, files: await vaultFiles(root) })).toBe(golden());
  });
});

describe('readModelDecidedContainment — when a model-decided link counts', () => {
  let root: string;
  let vault: FolderSource;
  let outcomes: readonly OutcomeRecord[];

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'olea-model-decided-read-'));
    vault = new FolderSource(root);
    outcomes = await seedCourse(vault);
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  async function read(overrides: Partial<ReadOptions> = {}, attached = true) {
    return readModelDecidedContainment(vault, {
      ...readOptions(overrides),
      outcomes,
      canonicalKeys: IDENTITY,
      ...(attached ? { attached: ATTACHED_BY_NAME } : {}),
    });
  }

  it('her control unavailable: disabled first, whatever the switches say', async () => {
    expect(await read({ correctionControlAvailable: NO_CONTROL })).toEqual({
      status: 'disabled',
      reason: 'correction-control-unavailable',
    });
  });

  it('with the objectives switch on, a current aligned result gives an edge marked model-decided, with its provenance and declaration', async () => {
    const result = await read({ switches: switchesOn(['objectives']) });
    expect(result.status).toBe('read');
    if (result.status !== 'read') return;
    const miss = outcomes.find((o) => o.id === O_MISS) as OutcomeRecord;
    expect(result.edges).toEqual([
      {
        outcomeId: O_MISS,
        conceptKey: K_MODEL,
        basis: 'objectives',
        decidedBy: 'model',
        declaration: await objectivesDeclarationOf(miss, COURSE),
        provenance: {
          task: READER.task,
          promptVersion: READER.promptVersion,
          modelId: READER.modelId,
          source: OBJ_REF,
          digests: { ...CURRENT, frozenConfiguration: 'sha256:config-c' },
        },
      },
    ]);
    expect(result.standings).toEqual([]);
  });

  it('the same concept reached by an exact match and by alignment counts once, as declared', async () => {
    // K_EXACT is aligned under O_EXACT, which the reconciliation attaches by exact name.
    expect(edges(await read({ switches: switchesOn(['objectives']) }))).not.toContainEqual([
      O_EXACT,
      K_EXACT,
    ]);
    // A stored attachment (an earlier run) counts the same as one made in this run.
    const stored = { ...(outcomes[0] as OutcomeRecord), conceptKeys: [K_EXACT] };
    outcomes = [stored, ...outcomes.slice(1)];
    expect(edges(await read({ switches: switchesOn(['objectives']) }, false))).not.toContainEqual([
      O_EXACT,
      K_EXACT,
    ]);
  });

  it('her near-match decision outranks the model: declined or confirmed gives no edge; a pending proposal does not stop one', async () => {
    // Seeded: O_NEAR/K_NEAR declined.
    expect(edges(await read({ switches: switchesOn(['objectives']) }))).not.toContainEqual([
      O_NEAR,
      K_NEAR,
    ]);
    const write = (status: 'proposed' | 'confirmed') =>
      vault.write(
        outcomeConceptNearMatchRecordPath(O_NEAR, K_NEAR),
        `${JSON.stringify({
          outcomeId: O_NEAR,
          conceptKey: K_NEAR,
          status,
          reason: 'token-set-containment',
          proposedAt: NOW,
          ...(status === 'confirmed' ? { confirmedAt: NOW } : {}),
          schemaVersion: OUTCOME_CONCEPT_NEAR_MATCH_RECORD_SCHEMA_VERSION,
        })}\n`,
      );
    await write('confirmed');
    expect(edges(await read({ switches: switchesOn(['objectives']) }))).not.toContainEqual([
      O_NEAR,
      K_NEAR,
    ]);
    await write('proposed');
    expect(edges(await read({ switches: switchesOn(['objectives']) }))).toContainEqual([
      O_NEAR,
      K_NEAR,
    ]);
    // A near-match record this build cannot read fails closed for its pair.
    await vault.write(outcomeConceptNearMatchRecordPath(O_NEAR, K_NEAR), 'torn');
    expect(edges(await read({ switches: switchesOn(['objectives']) }))).not.toContainEqual([
      O_NEAR,
      K_NEAR,
    ]);
  });

  it('a retired outcome, or an id naming no active declaration of that document and course, gains no edge', async () => {
    const other = await outcome('outcome-key1:o-elsewhere', 'Explain a cog', 0);
    const otherDoc = {
      ...other,
      source: { ...other.source, path: '03 Research/Objectives B.md' },
    };
    const otherCourse = await outcome('outcome-key1:o-other-course', 'Grind a cog', 6);
    outcomes = [...outcomes, otherDoc, { ...otherCourse, courses: ['COURSEB'] }];
    const result = await read({
      switches: switchesOn(['objectives']),
      alignments: projectionOf([
        { source: OBJ_REF, conceptKey: K_MODEL2, result: aligned(['outcome-key1:o-retired']) },
        { source: OBJ_REF, conceptKey: K_MODEL, result: aligned(['outcome-key1:o-elsewhere']) },
        { source: OBJ_REF, conceptKey: K_NEAR, result: aligned(['outcome-key1:o-other-course']) },
        { source: OBJ_REF, conceptKey: K_EXACT, result: aligned(['outcome-key1:unknown']) },
      ]),
    });
    expect(result).toEqual({ status: 'read', edges: [], standings: [], declinedPlacements: [] });
  });

  it('a result that is not current, not aligned, or from another configuration counts nothing', async () => {
    const variants = [
      // Stale against the current revision: a result for an older revision.
      { ...base(), source: { ...OBJ_REF, revisionDigest: 'rev-objectives-1' } },
      { ...base(), digests: { closedList: 'sha256:moved' } },
      { ...base(), digests: { coverage: 'sha256:moved' } },
      { ...base(), digests: { batchPlan: 'sha256:moved' } },
      { ...base(), digests: { frozenConfiguration: CONFIG_OTHER } },
      { ...base(), result: { kind: 'not-aligned' as const, reason: 'searched' as const } },
      { ...base(), result: { kind: 'cannot-tell' as const, reason: 'ambiguous' as const } },
      { ...base(), result: { kind: 'pending' as const, reason: 'unavailable' as const } },
      { ...base(), provenance: null },
    ];
    for (const variant of variants) {
      const result = await read({
        switches: switchesOn(['objectives']),
        alignments: projectionOf([variant]),
      });
      expect(edges(result)).toEqual([]);
    }
    // Produced under configuration C, while the switch's passing configuration is another.
    expect(
      edges(
        await read({
          switches: switchesOn(['objectives'], CONFIG_OTHER),
          alignments: projectionOf([base()]),
        }),
      ),
    ).toEqual([]);
    function base() {
      return { source: OBJ_REF, conceptKey: K_MODEL, result: aligned([O_MISS]) };
    }
  });

  it('each basis is enabled on its own', async () => {
    const objectivesOnly = await read({ switches: switchesOn(['objectives']) });
    expect(edges(objectivesOnly)).toEqual([[O_MISS, K_MODEL]]);
    expect(standings(objectivesOnly)).toEqual([]);
    const briefOnly = await read({ switches: switchesOn(['assessment-brief']) });
    expect(edges(briefOnly)).toEqual([]);
    expect(standings(briefOnly)).toEqual([[SCOPE_Q1, K_MODEL2]]);
  });

  it('with the assessment-brief switch on, stated-scope alignment gives standing on that assessment only, with its provenance', async () => {
    const result = await read({ switches: switchesOn(['assessment-brief']) });
    expect(result.status === 'read' ? result.standings : undefined).toEqual([
      {
        scopeKey: SCOPE_Q1,
        conceptKey: K_MODEL2,
        basis: 'assessment-brief',
        decidedBy: 'model',
        declaration: statedScopeDeclarationOf(SCOPE_Q1),
        provenance: {
          task: READER.task,
          promptVersion: READER.promptVersion,
          modelId: READER.modelId,
          source: Q1_REF,
          digests: { ...CURRENT, frozenConfiguration: 'sha256:config-c' },
        },
      },
    ]);
  });
});

describe('past-paper alignment never creates containment or scope standing', () => {
  let root: string;
  let vault: FolderSource;
  let outcomes: readonly OutcomeRecord[];

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'olea-model-decided-paper-'));
    vault = new FolderSource(root);
    outcomes = await seedCourse(vault);
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  /** An active outcome read from the paper itself, so only the past-paper guard can refuse its edge. */
  async function withPaperOutcome(): Promise<readonly OutcomeRecord[]> {
    const fromPaper = await outcome('outcome-key1:o-paper', 'Explain a sprocket', 0);
    return [
      ...outcomes,
      { ...fromPaper, source: { ...fromPaper.source, path: PAPER_REF.sourcePath } },
    ];
  }

  it('a current aligned past-paper result gives nothing, even with every switch on', async () => {
    const result = await readModelDecidedContainment(vault, {
      ...readOptions({
        alignments: projectionOf([
          {
            source: PAPER_REF,
            conceptKey: K_MODEL2,
            result: aligned(['outcome-key1:o-paper', O_MISS]),
          },
        ]),
      }),
      outcomes: await withPaperOutcome(),
    });
    expect(result).toEqual({ status: 'read', edges: [], standings: [], declinedPlacements: [] });
  });

  it("a caller naming the paper's path as an objectives document reads nothing from it", async () => {
    outcomes = await withPaperOutcome();
    const result = await readModelDecidedContainment(vault, {
      ...readOptions({
        alignments: projectionOf([
          {
            source: PAPER_REF,
            conceptKey: K_MODEL2,
            result: aligned(['outcome-key1:o-paper', O_MISS]),
          },
        ]),
        documents: [
          { source: { ...PAPER_REF, documentKind: 'objectives' }, currentDigests: CURRENT },
        ],
      }),
      outcomes,
    });
    expect(result).toEqual({ status: 'read', edges: [], standings: [], declinedPlacements: [] });
  });

  it('only the past-paper switch on: disabled, so a historical paper is never current scope', async () => {
    const result = await readModelDecidedContainment(vault, {
      ...readOptions({ switches: switchesOn(['past-paper']) }),
      outcomes,
    });
    expect(result).toEqual({ status: 'disabled', reason: 'no-containment-basis-on' });
  });
});

describe('the reconciliation report lists model-decided edges apart, and never writes them', () => {
  let root: string;
  let vault: FolderSource;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'olea-model-decided-report-'));
    vault = new FolderSource(root);
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it('the edge sits apart from exact and alias attachments; outcome and near-match files are the golden bytes', async () => {
    const outcomes = await seedCourse(vault);
    const report = await reconcileOutcomeConcepts(vault, outcomes, CONCEPTS, {
      now: () => NOW,
      modelDecided: readOptions({ switches: switchesOn(['objectives', 'assessment-brief']) }),
    });
    const pinned = JSON.parse(readFileSync(GOLDEN, 'utf8'));
    const { modelDecided, ...today } = report;
    expect(today).toEqual(pinned.report);
    expect(modelDecided?.edges.map((e) => [e.outcomeId, e.conceptKey, e.decidedBy])).toEqual([
      [O_MISS, K_MODEL, 'model'],
    ]);
    expect(modelDecided?.standings.map((s) => [s.scopeKey, s.conceptKey])).toEqual([
      [SCOPE_Q1, K_MODEL2],
    ]);
    // O_MISS's stored concept keys do not gain K_MODEL; no near-match or correction file is written.
    expect(await vaultFiles(root)).toEqual(pinned.files);
  });
});

describe('her correction history undoes a model-decided link at read time', () => {
  let root: string;
  let vault: FolderSource;
  let outcomes: readonly OutcomeRecord[];

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'olea-model-decided-correction-'));
    vault = new FolderSource(root);
    outcomes = await seedCourse(vault);
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  async function read(overrides: Partial<ReadOptions> = {}) {
    return readModelDecidedContainment(vault, {
      ...readOptions({ switches: switchesOn(['objectives', 'assessment-brief']), ...overrides }),
      outcomes,
      canonicalKeys: IDENTITY,
      attached: ATTACHED_BY_NAME,
    });
  }

  async function declineMiss(kind: 'declined' | 'accepted' = 'declined', at = '2026-10-06T09:00') {
    const miss = outcomes.find((o) => o.id === O_MISS) as OutcomeRecord;
    await recordContainmentCorrection(
      vault,
      await objectivesDeclarationOf(miss, COURSE),
      K_MODEL,
      kind,
      {
        now: () => at,
      },
    );
  }

  it('her correction excludes the edge, and nothing written before it is edited or removed', async () => {
    const before = await vaultFiles(root);
    expect(edges(await read())).toContainEqual([O_MISS, K_MODEL]);
    await declineMiss();
    expect(edges(await read())).not.toContainEqual([O_MISS, K_MODEL]);
    const after = await vaultFiles(root);
    for (const [path, text] of Object.entries(before)) expect(after[path]).toBe(text);
  });

  it('a later run of the same evidence never re-creates it', async () => {
    await declineMiss();
    // Alignment runs again: a newer current aligned result for the same pair.
    const rerun = projectionOf([
      {
        source: OBJ_REF,
        conceptKey: K_MODEL,
        result: { kind: 'aligned', recordIds: [O_MISS], refs: [1, 2] },
      },
    ]);
    expect(edges(await read({ alignments: rerun }))).toEqual([]);
  });

  it('her rejection persists across an unrelated edit that re-mints the declaration on another unit ([D-477])', async () => {
    await declineMiss();
    // The edit inserted a page before O_MISS's: extraction minted a new record for the same wording.
    const moved = await outcome('outcome-key1:o-miss-moved', 'Analyse a loaded frame', 7);
    const retiredOld = outcomes.map((o) =>
      o.id === O_MISS ? { ...o, status: 'retired' as const } : o,
    );
    outcomes = [...retiredOld, moved];
    await writeOutcome(vault, moved);
    const newRevision = { ...OBJ_REF, revisionDigest: 'rev-objectives-3' };
    const result = await read({
      documents: [{ source: newRevision, currentDigests: CURRENT }],
      alignments: projectionOf([
        {
          source: newRevision,
          conceptKey: K_MODEL,
          result: aligned(['outcome-key1:o-miss-moved']),
        },
      ]),
    });
    expect(edges(result)).toEqual([]);
    expect(standings(result)).toEqual([]);
  });

  it('changed declaration wording is new evidence, and her correction of the old one is kept', async () => {
    await declineMiss();
    const reworded = await outcome('outcome-key1:o-reworded', 'Model the load path of a frame', 3);
    outcomes = [...outcomes.filter((o) => o.id !== O_MISS), reworded];
    const result = await read({
      alignments: projectionOf([
        { source: OBJ_REF, conceptKey: K_MODEL, result: aligned(['outcome-key1:o-reworded']) },
      ]),
    });
    expect(edges(result)).toEqual([['outcome-key1:o-reworded', K_MODEL]]);
    const miss = await outcome(O_MISS, 'Analyse a loaded frame', 3);
    const kept = await readContainmentCorrection(
      vault,
      await objectivesDeclarationOf(miss, COURSE),
      K_MODEL,
    );
    expect(kept.kind === 'record' ? kept.record.events.map((e) => e.kind) : []).toEqual([
      'declined',
    ]);
  });

  it('her reversal is a later entry; the edge reads again only while the switch is on, her control available and the result current', async () => {
    await declineMiss('declined', 't1');
    await declineMiss('accepted', 't2');
    expect(edges(await read())).toContainEqual([O_MISS, K_MODEL]);
    expect(edges(await read({ switches: resolveBasisSwitches() }))).toEqual([]);
    expect(edges(await read({ correctionControlAvailable: NO_CONTROL }))).toEqual([]);
    expect(
      edges(
        await read({
          alignments: projectionOf([
            {
              source: OBJ_REF,
              conceptKey: K_MODEL,
              result: aligned([O_MISS]),
              digests: { coverage: 'sha256:moved' },
            },
          ]),
        }),
      ),
    ).toEqual([]);
  });

  it('her acceptance never makes a link count on its own, and never writes it into her outcome', async () => {
    await declineMiss('accepted', 't1');
    expect(edges(await read({ switches: resolveBasisSwitches() }))).toEqual([]);
    expect(edges(await read({ correctionControlAvailable: NO_CONTROL }))).toEqual([]);
    const report = await reconcileOutcomeConcepts(vault, outcomes, CONCEPTS, {
      now: () => NOW,
      modelDecided: readOptions({ switches: switchesOn(['objectives']) }),
    });
    expect(report.attached.map((a) => a.outcomeId)).not.toContain(O_MISS);
    const stored = JSON.parse(
      readFileSync(join(root, '.olea/outcomes/outcome-key1%3Ao-miss.json'), 'utf8'),
    );
    expect(stored.conceptKeys).toEqual([]);
  });

  it('an unreadable history excludes its pair, so a rejection inside it is never lost', async () => {
    const miss = outcomes.find((o) => o.id === O_MISS) as OutcomeRecord;
    await vault.write(
      await containmentCorrectionPath(await objectivesDeclarationOf(miss, COURSE), K_MODEL),
      '{"declaration": ',
    );
    const result = await read();
    expect(edges(result)).toEqual([]);
    expect(standings(result)).toEqual([[SCOPE_Q1, K_MODEL2]]);
  });

  it('a stated-scope standing is corrected by its own history, on that assessment only', async () => {
    await recordContainmentCorrection(
      vault,
      statedScopeDeclarationOf(SCOPE_Q1),
      K_MODEL2,
      'declined',
      {
        now: () => 't1',
      },
    );
    const result = await read();
    expect(standings(result)).toEqual([]);
    expect(edges(result)).toEqual([[O_MISS, K_MODEL]]);
  });

  it('her correction never touches an exact or alias attachment, or a near-match decision', async () => {
    await reconcileOutcomeConcepts(vault, outcomes, CONCEPTS, { now: () => NOW });
    const settled = await vaultFiles(root);
    await declineMiss();
    const after = await vaultFiles(root);
    const added = Object.keys(after).filter((path) => !(path in settled));
    expect(added).toHaveLength(1);
    expect(added[0]?.startsWith('.olea/outcome-containment-corrections/')).toBe(true);
    for (const [path, text] of Object.entries(settled)) expect(after[path]).toBe(text);
  });
});

describe('a clause alone never enables a model-decided link', () => {
  // `[D-537]` (`ol-egov.141.89.7.77`): the statement is per basis now, and the grove provider that
  // renders her working control states it, for objectives only. That one setter is pinned in
  // `./reconcile.single-source.ol-egov.141.89.7.77.spec.ts`; this keeps the earlier single-flag
  // form from ever coming back.
  it('no core or plugin source states her correction control in the earlier single-flag form', () => {
    const packages = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
    const pattern = /correctionControlAvailable\s*:\s*true\b/;
    const offenders: string[] = [];
    const walk = (dir: string): void => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const path = join(dir, entry.name);
        if (entry.isDirectory()) walk(path);
        else if (
          entry.name.endsWith('.ts') &&
          !entry.name.endsWith('.spec.ts') &&
          pattern.test(readFileSync(path, 'utf8'))
        ) {
          offenders.push(path);
        }
      }
    };
    for (const root of ['core/src', 'plugin/src']) walk(join(packages, root));
    // The bead that ships her working correction control is the one that may add such a caller.
    expect(offenders).toEqual([]);
  });
});
