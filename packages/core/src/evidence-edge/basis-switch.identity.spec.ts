/**
 * `ol-egov.141.89.7.25` (`[D-432]`): with every ranking-basis switch off, nothing she sees may
 * change. This suite pins the ranking result, the concept↔assessment edges and the
 * `oracle.rank.v1` request bases (`toOracleRankRequestBases`) on one synthetic course that carries
 * all three bases (past papers, an objectives document, an assessment's declared scope) and one
 * concept nothing names, against a golden written from the code as it stood BEFORE the switch
 * existed (`basis-switch.identity.golden.json`, generated at `b6a6eb9d` with no switch code in
 * the tree). The golden is compared byte for byte (`JSON.stringify`), never field by field.
 *
 * The same bytes must come out whatever gate input is passed today (no record, too few cells, a
 * post hoc look, or every basis switched on with its alignment pending), because the edge builder
 * reads no alignment result: every edge it serves is the lexical fallback, labelled so.
 *
 * To regenerate the golden deliberately (it is the before-state; regenerating it after the switch
 * exists proves nothing): `OLEA_WRITE_BASIS_SWITCH_GOLDEN=1 pnpm exec vitest run <this file>`.
 *
 * INV-3: every course code, concept name, path and sentence below is invented.
 */

import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { extractConcepts } from '../concept/extract.js';
import type { ConceptRecord } from '../concept/types.js';
import { type ComposeOracleRankingResult, composeOracleRanking } from '../oracle/compose.js';
import { toOracleRankRequestBases } from '../oracle/rank-request-bases.js';
import { FolderSource } from '../vault/folder-source.js';
import {
  type BasisGateInput,
  type BasisGateRecord,
  edgeEvidenceSource,
  HELD_OUT_CELL_MINIMUMS,
  NO_BASIS_GATE,
  PER_BASIS_GATE_PREREGISTRATION,
} from './basis-switch.js';
import type { ConceptAssessmentEdge, ConceptEvidenceBasis } from './types.js';

const GOLDEN = fileURLToPath(new URL('./basis-switch.identity.golden.json', import.meta.url));
const BASE_PATH = '02 Assignments/Assignments.base';
const AS_OF = '2026-08-15';

/** One course, all three bases, one concept nothing names. Invented throughout. */
const FILES: Readonly<Record<string, string>> = {
  '05 Zettelkasten/Widget theory.md': '---\ntopic: Widget theory\n---\n\n# Widget theory\n',
  '05 Zettelkasten/Gizmo law.md': '---\ntopic: Gizmo law\n---\n\n# Gizmo law\n',
  '05 Zettelkasten/Sprocket method.md': '---\ntopic: Sprocket method\n---\n\n# Sprocket method\n',
  '05 Zettelkasten/Flange rule.md': '---\ntopic: Flange rule\n---\n\n# Flange rule\n',
  '05 Zettelkasten/Cog principle.md': '---\ntopic: Cog principle\n---\n\n# Cog principle\n',
  '03 Research/TESTC101 Past Paper 2023.md': [
    '---',
    'role: past-paper',
    'course: TESTC101',
    '---',
    '',
    '# TESTC101 Past Paper — 2023',
    '',
    '## Question 1 (10 marks)',
    '',
    'Explain the core mechanism behind Widget theory and why it matters.',
    '',
    '## Question 2 (10 marks)',
    '',
    'State Gizmo law and apply it to a loaded frame.',
    '',
  ].join('\n'),
  '03 Research/TESTC101 Past Paper 2024.md': [
    '---',
    'role: past-paper',
    'course: TESTC101',
    '---',
    '',
    '# TESTC101 Past Paper — 2024',
    '',
    '## Question 1 (10 marks)',
    '',
    'Widget theory predicts a specific outcome under load — derive it.',
    '',
  ].join('\n'),
  '03 Research/TESTC101 Course Objectives.md': [
    '---',
    'role: objectives',
    'course: TESTC101',
    '---',
    '',
    '# TESTC101 — Course Objectives',
    '',
    '- Apply the Sprocket method to a gear train.',
    '- Relate Widget theory to measured outcomes.',
    '',
  ].join('\n'),
  [BASE_PATH]: [
    'filters:',
    '  and:',
    '    - file.inFolder("02 Assignments")',
    '    - file.ext == "md"',
    'properties:',
    '  class:',
    '  type:',
    '  weight:',
    '  due:',
    '  status:',
  ].join('\n'),
  '02 Assignments/Quiz 1.md':
    '---\nclass: TESTC101\ntype: Quiz\nweight: 10\ndue: 2026-09-01\nstatus: upcoming\nscope: Covers Flange rule in depth.\n---\n\n# Quiz 1\n',
  '02 Assignments/Test 1.md':
    '---\nclass: TESTC101\ntype: Test\nweight: 30\ndue: 2026-10-01\nstatus: upcoming\n---\n\n# Test 1\n',
};

const SET = 'sha256:invented-held-out-set';
const FROZEN = 'cfg:invented-frozen';

/** A passing record for one basis: a test double, since nothing has recorded a pass for any basis. */
function passing(basis: ConceptEvidenceBasis): BasisGateRecord {
  return {
    basis,
    preRegistration: PER_BASIS_GATE_PREREGISTRATION,
    look: { heldOutSetHash: SET, configurationDigest: FROZEN },
    cells: {
      decidedNotAttested: HELD_OUT_CELL_MINIMUMS.decidedNotAttested,
      decidedNotAttestedCourses: HELD_OUT_CELL_MINIMUMS.courses,
      attested: HELD_OUT_CELL_MINIMUMS.attested,
      attestedCourses: HELD_OUT_CELL_MINIMUMS.courses,
    },
    verdict: { kind: 'switch-on' },
    evidence: { report: 'findings/invented-benchmark.md', recordedBy: 'ol-test.1' },
  };
}

const SEALED = {
  events: [
    { kind: 'registered', heldOutSetHash: SET, frozenConfigurationDigest: FROZEN },
    { kind: 'looked', heldOutSetHash: SET, configurationDigest: FROZEN },
  ],
} as const;

const BASES: readonly ConceptEvidenceBasis[] = ['objectives', 'past-paper', 'assessment-brief'];

/** Every gate input this bead can be handed, each of which must leave her ranking as it was. */
const GATES: readonly (readonly [string, BasisGateInput, 'switch-off' | 'alignment-pending'])[] = [
  ['no gate recorded, passed explicitly', NO_BASIS_GATE, 'switch-off'],
  [
    'too few held-out cells on every basis',
    {
      records: BASES.map((basis) => ({
        ...passing(basis),
        cells: { ...passing(basis).cells, decidedNotAttested: 3 },
      })),
      exposure: SEALED,
    },
    'switch-off',
  ],
  [
    'a post hoc look on every basis',
    {
      records: BASES.map((basis) => ({
        ...passing(basis),
        look: { heldOutSetHash: SET, configurationDigest: 'cfg:adapted' },
      })),
      exposure: SEALED,
    },
    'switch-off',
  ],
  [
    'every basis switched on, its alignment pending',
    { records: BASES.map(passing), exposure: SEALED },
    'alignment-pending',
  ],
];

/** The `oracle.rank.v1` request bases per ranking candidate (course, concept key), in a fixed order. */
function requestBasesByCandidate(edges: readonly ConceptAssessmentEdge[]): readonly unknown[] {
  const byCandidate = new Map<string, ConceptAssessmentEdge[]>();
  for (const edge of edges) {
    const key = `${edge.course}\u0000${edge.conceptKey}`;
    const list = byCandidate.get(key) ?? [];
    list.push(edge);
    byCandidate.set(key, list);
  }
  return [...byCandidate.entries()]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([key, list]) => ({ candidate: key, bases: toOracleRankRequestBases(list) }));
}

/** What the golden pins: the ranking result, the edges, and the request bases, as bytes. */
function identitySnapshot(result: ComposeOracleRankingResult): string {
  return JSON.stringify({
    ranking: result.ranking,
    edges: result.edges.edges,
    assessmentsWithoutCourse: result.edges.assessmentsWithoutCourse,
    assessmentsWithNoEvidence: result.edges.assessmentsWithNoEvidence,
    requestBases: requestBasesByCandidate(result.edges.edges),
  });
}

describe('ol-egov.141.89.7.25: every basis switch off leaves the ranking, edges and request bytes as they were', () => {
  let root: string;
  let source: FolderSource;
  let concepts: readonly ConceptRecord[];

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'olea-basis-switch-identity-'));
    source = new FolderSource(root);
    for (const [relPath, content] of Object.entries(FILES)) {
      const full = join(root, ...relPath.split('/'));
      await mkdir(join(full, '..'), { recursive: true });
      await writeFile(full, content, 'utf8');
    }
    concepts = await extractConcepts(source, {});
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it('the fixture exercises all three bases and a concept nothing names (so the golden covers each path)', async () => {
    const result = await composeOracleRanking({
      vault: source,
      basePath: BASE_PATH,
      reviewLog: [],
      asOf: AS_OF,
      concepts,
    });
    const bases = new Set(result.edges.edges.map((edge) => edge.basis));
    expect([...bases].sort()).toEqual(['assessment-brief', 'objectives', 'past-paper']);
    expect(result.edges.edges.some((edge) => edge.conceptName === 'Cog principle')).toBe(false);
  });

  it('with no switch input (the production default), the bytes equal the golden written before the switch existed', async () => {
    const result = await composeOracleRanking({
      vault: source,
      basePath: BASE_PATH,
      reviewLog: [],
      asOf: AS_OF,
      concepts,
    });
    const actual = identitySnapshot(result);
    if (process.env.OLEA_WRITE_BASIS_SWITCH_GOLDEN === '1') {
      writeFileSync(GOLDEN, `${JSON.stringify(JSON.parse(actual), null, 2)}\n`, 'utf8');
    }
    expect(existsSync(GOLDEN)).toBe(true);
    expect(actual).toBe(JSON.stringify(JSON.parse(readFileSync(GOLDEN, 'utf8'))));
  });

  it.each(GATES)(
    'with %s, the bytes still equal the golden, and every edge is labelled lexical fallback',
    async (_label, basisGate, cause) => {
      const result = await composeOracleRanking({
        vault: source,
        basePath: BASE_PATH,
        reviewLog: [],
        asOf: AS_OF,
        concepts,
        basisGate,
      });
      expect(identitySnapshot(result)).toBe(
        JSON.stringify(JSON.parse(readFileSync(GOLDEN, 'utf8'))),
      );
      for (const basis of BASES) {
        expect(result.edges.basisSources[basis]).toMatchObject({
          source: 'lexical-fallback',
          cause,
        });
      }
      for (const edge of result.edges.edges) {
        expect(edgeEvidenceSource(edge, result.edges.basisSources)).toBe('lexical-fallback');
      }
    },
  );

  it('the ranking request presents no fallback edge as alignment: each bases entry is basis and confidence, nothing else', async () => {
    for (const [, basisGate] of GATES) {
      const result = await composeOracleRanking({
        vault: source,
        basePath: BASE_PATH,
        reviewLog: [],
        asOf: AS_OF,
        concepts,
        basisGate,
      });
      const request = requestBasesByCandidate(result.edges.edges) as readonly {
        readonly bases: readonly object[];
      }[];
      expect(request.length).toBeGreaterThan(0);
      for (const candidate of request) {
        for (const entry of candidate.bases)
          expect(Object.keys(entry)).toEqual(['basis', 'confidence']);
      }
      expect(JSON.stringify(request)).not.toMatch(/align|fallback|pending|lexical/i);
    }
  });
});
