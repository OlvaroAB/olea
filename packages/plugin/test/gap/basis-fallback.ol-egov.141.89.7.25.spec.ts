/**
 * `ol-egov.141.89.7.25` (`[D-432]`): nothing she sees may change while every ranking-basis switch
 * is off, and a lexical-fallback edge is never presented as alignment.
 *
 * The first block runs the two shipped providers that read the ranking — the gap view
 * (`createLocalGapProvider`) and the study plan (`createLocalStudyPlanProvider`) — on one synthetic
 * course carrying all three bases (past papers, an objectives document, an assessment's declared
 * scope) and one concept nothing names, and compares every student-visible output (the gap view
 * model, the course framing sentence with its basis attribution, the plan envelope) byte for byte
 * against a golden written from the code as it stood BEFORE the switch existed
 * (`__golden__/basis-fallback.ol-egov.141.89.7.25.json`, generated at `b6a6eb9d`).
 *
 * The second block proves the fallback is never presented as alignment in the gap view: whatever
 * gate input the edges are built with (none, too few cells, every basis switched on with its
 * alignment pending), every edge is labelled lexical fallback and the course framing — the
 * sentence that attributes the ranking to its bases — is the same sentence, with no alignment
 * wording in it. (The ranking request half is `olea-core`'s
 * `evidence-edge/basis-switch.identity.spec.ts`.)
 *
 * To regenerate the golden deliberately (it is the before-state; regenerating it after the switch
 * exists proves nothing): `OLEA_WRITE_BASIS_SWITCH_GOLDEN=1 pnpm exec vitest run <this file>`.
 *
 * INV-3: every course code, concept name, path and sentence below is invented.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  type BasisGateInput,
  type BasisGateRecord,
  composeOracleRanking,
  edgeEvidenceSource,
  enumerateVaultInstruments,
  HELD_OUT_CELL_MINIMUMS,
  NO_BASIS_GATE,
  PER_BASIS_GATE_PREREGISTRATION,
  RANKING_BASES,
} from 'olea-core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { gapRowEvidenceBases, rankedCourseFraming } from '../../src/gap/copy.js';
import { createLocalGapProvider } from '../../src/gap/provider.js';
import type { GapViewState } from '../../src/gap/view.js';
import { createLocalStudyPlanProvider } from '../../src/plan/provider.js';
import type { ObsidianDataHost } from '../../src/plan/settings-store.js';
import { STUDY_PLAN_SETTINGS_STORAGE_KEY } from '../../src/plan/settings-store.js';
import { memoryVault } from '../review/memory-vault.js';

const GOLDEN = fileURLToPath(
  new URL('./__golden__/basis-fallback.ol-egov.141.89.7.25.json', import.meta.url),
);
const DEVICE = 'olea-testdevice1';
const BASE_PATH = '02 Assignments/Assignments.base';
const NOW = () => new Date('2026-08-15T09:00:00-04:00');

class FakeDataHost implements ObsidianDataHost {
  blob: unknown = null;

  async loadData(): Promise<unknown> {
    return this.blob;
  }

  async saveData(data: unknown): Promise<void> {
    this.blob = data;
  }
}

function hostWithBasePath(basePath: string): FakeDataHost {
  const host = new FakeDataHost();
  host.blob = {
    [STUDY_PLAN_SETTINGS_STORAGE_KEY]: { version: 1, assignmentsBasePath: basePath },
  };
  return host;
}

/** One course, all three bases, one concept nothing names. Invented throughout. */
const FILES: Readonly<Record<string, string>> = {
  '05 Zettelkasten/Widget theory.md': '# Widget theory\n',
  '05 Zettelkasten/Gizmo law.md': '# Gizmo law\n',
  '05 Zettelkasten/Sprocket method.md': '# Sprocket method\n',
  '05 Zettelkasten/Flange rule.md': '# Flange rule\n',
  '05 Zettelkasten/Cog principle.md': '# Cog principle\n',
  'Notes/one.md': [
    '---',
    'topic: [Widget theory, Gizmo law, Sprocket method, Flange rule, Cog principle]',
    'course: TESTC101',
    '---',
    '',
    'Front::Back',
    '',
  ].join('\n'),
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

/**
 * The same course with past papers only (no objectives document, no declared scope). The study
 * plan builds here; on the three-basis course above it throws today (see
 * {@link planOutcome}), so this fixture is what pins a real plan envelope.
 */
const PAST_PAPERS_ONLY: Readonly<Record<string, string>> = Object.fromEntries(
  Object.entries(FILES)
    .filter(([path]) => path !== '03 Research/TESTC101 Course Objectives.md')
    .map(([path, content]) => [
      path,
      path === '02 Assignments/Quiz 1.md'
        ? content.replace('scope: Covers Flange rule in depth.\n', '')
        : content,
    ]),
);

/**
 * Concept keys and uids are minted with `crypto.randomUUID()` the first time a vault is read. A
 * counter stands in for it, reset before each provider reads its own fresh vault, so the same
 * fixture always mints the same keys and the golden can be compared byte for byte.
 */
let mintedIds = 0;
function resetMintedIds(): void {
  mintedIds = 0;
}
beforeEach(() => {
  vi.spyOn(globalThis.crypto, 'randomUUID').mockImplementation(() => {
    mintedIds += 1;
    return `00000000-0000-4000-8000-${mintedIds.toString().padStart(12, '0')}`;
  });
});
afterEach(() => {
  vi.restoreAllMocks();
});

/** Maps become sorted entry lists and sets sorted arrays, so nothing a view reads is lost to `JSON.stringify`. */
function canonical(_key: string, value: unknown): unknown {
  if (value instanceof Map) {
    return [...value.entries()].sort(([a], [b]) => (String(a) < String(b) ? -1 : 1));
  }
  if (value instanceof Set) return [...value].sort();
  return value;
}

/**
 * The study plan's outcome, as she would meet it: the envelope, or the refusal. At `b6a6eb9d` a
 * ranked concept whose only evidence is an objectives document or a declared scope carries no
 * past-paper citation, and the plan contract refuses a ranked concept with none
 * (`studyPlanEnvelope`, citations `min(1)`), so the plan throws on the three-basis course. That is
 * a defect of its own (reported on this bead's hand-back, not fixed here); the golden pins it as
 * today's behaviour so this suite proves only that the switch changes nothing.
 */
async function planOutcome(files: Readonly<Record<string, string>>): Promise<unknown> {
  resetMintedIds();
  try {
    return {
      envelope: await createLocalStudyPlanProvider({
        vault: memoryVault(files),
        deviceId: DEVICE,
        settingsHost: hostWithBasePath(BASE_PATH),
        now: NOW,
      }).fetchPlan(),
    };
  } catch (error) {
    return { threw: error instanceof Error ? `${error.name}: ${error.message}` : String(error) };
  }
}

/** Every student-visible output the two providers produce for one fixture. */
async function visibleOutputs(
  files: Readonly<Record<string, string>>,
): Promise<{ readonly value: unknown; readonly framing: string[] }> {
  resetMintedIds();
  const gapState: GapViewState = await createLocalGapProvider({
    vault: memoryVault(files),
    deviceId: DEVICE,
    settingsHost: hostWithBasePath(BASE_PATH),
    now: NOW,
  }).load();
  if (gapState.kind !== 'model') throw new Error('expected the gap view to compose a model');
  const framing = gapState.model.courses.flatMap((course) =>
    course.status === 'ranked' ? [...rankedCourseFraming(course.rows, gapState.bases)] : [],
  );
  return { value: { gap: gapState, framing, plan: await planOutcome(files) }, framing };
}

describe('ol-egov.141.89.7.25: every basis switch off, nothing she sees changes', () => {
  it('the shipped gap view and study plan produce exactly the bytes they produced before the switch existed', async () => {
    const threeBases = await visibleOutputs(FILES);
    const pastPapersOnly = await visibleOutputs(PAST_PAPERS_ONLY);
    // The three-basis fixture reaches the sentence's three-basis form, so the golden pins the
    // whole basis attribution; the second fixture pins a plan envelope that builds.
    expect(threeBases.framing.join(' ')).toContain('past paper');
    expect(threeBases.framing.join(' ')).toContain('course objectives');
    expect(threeBases.framing.join(' ')).toContain('assessment briefs');
    expect(JSON.stringify(pastPapersOnly.value)).toContain('"envelope"');
    const bytes = JSON.stringify(
      { threeBases: threeBases.value, pastPapersOnly: pastPapersOnly.value },
      canonical,
    );
    if (process.env.OLEA_WRITE_BASIS_SWITCH_GOLDEN === '1') {
      mkdirSync(dirname(GOLDEN), { recursive: true });
      writeFileSync(GOLDEN, `${JSON.stringify(JSON.parse(bytes), null, 2)}\n`, 'utf8');
    }
    expect(existsSync(GOLDEN)).toBe(true);
    expect(bytes).toBe(JSON.stringify(JSON.parse(readFileSync(GOLDEN, 'utf8'))));
  });
});

/** A passing gate record for one basis: a test double, since nothing has recorded a pass for any basis. */
function passing(basis: BasisGateRecord['basis']): BasisGateRecord {
  return {
    basis,
    preRegistration: PER_BASIS_GATE_PREREGISTRATION,
    look: { heldOutSetHash: 'sha256:invented-set', configurationDigest: 'cfg:invented' },
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
    {
      kind: 'registered',
      heldOutSetHash: 'sha256:invented-set',
      frozenConfigurationDigest: 'cfg:invented',
    },
    { kind: 'looked', heldOutSetHash: 'sha256:invented-set', configurationDigest: 'cfg:invented' },
  ],
} as const;

const GATES: readonly (readonly [string, BasisGateInput])[] = [
  ['no gate recorded', NO_BASIS_GATE],
  [
    'too few held-out cells',
    {
      records: RANKING_BASES.map((basis) => ({
        ...passing(basis),
        cells: { ...passing(basis).cells, attested: 2 },
      })),
      exposure: SEALED,
    },
  ],
  [
    'every basis switched on, its alignment pending',
    { records: RANKING_BASES.map(passing), exposure: SEALED },
  ],
];

describe('ol-egov.141.89.7.25: the gap view never presents a lexical-fallback edge as alignment', () => {
  it.each(GATES)(
    'with %s, every edge is lexical fallback and the basis attribution sentence is unchanged',
    async (_label, basisGate) => {
      const vault = memoryVault(FILES);
      resetMintedIds();
      const state = await createLocalGapProvider({
        vault,
        deviceId: DEVICE,
        settingsHost: hostWithBasePath(BASE_PATH),
        now: NOW,
      }).load();
      if (state.kind !== 'model') throw new Error('expected the gap view to compose a model');
      const golden = JSON.parse(readFileSync(GOLDEN, 'utf8')) as {
        readonly threeBases: { readonly framing: readonly string[] };
      };

      // The same vault, so the concept keys the provider minted are the ones read back here.
      const { concepts } = await enumerateVaultInstruments(vault, {
        concepts: { stampConceptKeys: true },
      });
      const { edges } = await composeOracleRanking({
        vault,
        basePath: BASE_PATH,
        reviewLog: [],
        asOf: '2026-08-15',
        concepts,
        basisGate,
      });

      for (const basis of RANKING_BASES) {
        expect(edges.basisSources[basis].source).toBe('lexical-fallback');
      }
      for (const edge of edges.edges) {
        expect(edgeEvidenceSource(edge, edges.basisSources)).toBe('lexical-fallback');
      }

      const bases = gapRowEvidenceBases(edges.edges);
      expect(JSON.stringify(bases, canonical)).toBe(JSON.stringify(state.bases, canonical));
      const framing = state.model.courses.flatMap((course) =>
        course.status === 'ranked' ? [...rankedCourseFraming(course.rows, bases)] : [],
      );
      expect(framing).toEqual(golden.threeBases.framing);
      expect(framing.join(' ')).not.toMatch(/align|fallback|lexical|pending/i);
    },
  );
});
