/**
 * `ol-egov.141.89.7.25` (`[D-432]`): the per-basis switch, the held-out exposure rule and the
 * lexical-fallback label (`./basis-switch.ts`). The gate it reads is pre-registered in
 * `olea-service/findings/ilb-scp-per-basis-gate.md` (sections 3 to 5 and 7).
 *
 * Every digest, hash, path and name below is invented; no gate result has been recorded for any
 * basis, so every passing record here is a test double.
 */

import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { FolderSource } from '../vault/folder-source.js';
import {
  attributeBasisSources,
  type BasisGateInput,
  type BasisGateRecord,
  type BasisSwitchState,
  type ConceptBasisReading,
  classifyHeldOutLook,
  describeBasisSwitch,
  edgeEvidenceSource,
  HELD_OUT_CELL_MINIMUMS,
  type HeldOutExposureEvent,
  type HeldOutExposureRecord,
  NO_BASIS_GATE,
  PER_BASIS_GATE_PREREGISTRATION,
  RANKING_BASES,
  readConceptBasis,
  resolveBasisSwitches,
} from './basis-switch.js';
import { buildConceptAssessmentEdges } from './build.js';
import type { ConceptAssessmentEdge, ConceptEvidenceBasis } from './types.js';

const SET = 'sha256:held-out-set-1';
const FROZEN = 'cfg:frozen-1';
const ADAPTED = 'cfg:adapted-after-look';

const registered = (heldOutSetHash: string, digest: string): HeldOutExposureEvent => ({
  kind: 'registered',
  heldOutSetHash,
  frozenConfigurationDigest: digest,
});
const looked = (heldOutSetHash: string, configurationDigest: string): HeldOutExposureEvent => ({
  kind: 'looked',
  heldOutSetHash,
  configurationDigest,
});

/** The pre-registered order: the set sealed with its frozen configuration, then that configuration's one look. */
const SEALED_AND_LOOKED: HeldOutExposureRecord = {
  events: [registered(SET, FROZEN), looked(SET, FROZEN)],
};

const ENOUGH_CELLS = {
  decidedNotAttested: HELD_OUT_CELL_MINIMUMS.decidedNotAttested,
  decidedNotAttestedCourses: HELD_OUT_CELL_MINIMUMS.courses,
  attested: HELD_OUT_CELL_MINIMUMS.attested,
  attestedCourses: HELD_OUT_CELL_MINIMUMS.courses,
} as const;

function record(
  basis: ConceptEvidenceBasis,
  overrides: Partial<BasisGateRecord> = {},
): BasisGateRecord {
  return {
    basis,
    preRegistration: PER_BASIS_GATE_PREREGISTRATION,
    look: { heldOutSetHash: SET, configurationDigest: FROZEN },
    cells: ENOUGH_CELLS,
    verdict: { kind: 'switch-on' },
    evidence: { report: 'findings/invented-benchmark.md#objectives', recordedBy: 'ol-test.1' },
    ...overrides,
  };
}

function gate(records: readonly BasisGateRecord[], exposure = SEALED_AND_LOOKED): BasisGateInput {
  return { records, exposure };
}

function offReason(state: BasisSwitchState): string | undefined {
  return state.status === 'off' ? state.reason : undefined;
}

describe('per-basis switch (AC1): default off, on only from a recorded held-out pass', () => {
  it('with no gate input, every basis is off and says why (no-gate-record), never a quiet default', () => {
    for (const switches of [resolveBasisSwitches(), resolveBasisSwitches(NO_BASIS_GATE)]) {
      for (const basis of RANKING_BASES) {
        expect(switches[basis].status).toBe('off');
        expect(offReason(switches[basis])).toBe('no-gate-record');
        expect(describeBasisSwitch(switches[basis])).toMatch(
          /on the lexical fallback: no held-out gate result recorded$/,
        );
      }
    }
    expect(RANKING_BASES).toEqual(['objectives', 'past-paper', 'assessment-brief']);
  });

  it('a recorded pass turns on its own basis only: a pass on objectives never carries to past papers or briefs', () => {
    const switches = resolveBasisSwitches(gate([record('objectives')]));
    expect(switches.objectives.status).toBe('on');
    expect(offReason(switches['past-paper'])).toBe('no-gate-record');
    expect(offReason(switches['assessment-brief'])).toBe('no-gate-record');
  });

  it('exactly the declared minimums are enough; one cell or one course short is not, and it says so with the counts', () => {
    expect(resolveBasisSwitches(gate([record('objectives')])).objectives.status).toBe('on');
    const cases = [
      [{ decidedNotAttested: 28 }, 'decided-not-attested-cells'],
      [{ decidedNotAttestedCourses: 1 }, 'decided-not-attested-courses'],
      [{ attested: 9 }, 'attested-cells'],
      [{ attestedCourses: 1 }, 'attested-courses'],
    ] as const;
    for (const [short, expected] of cases) {
      const state = resolveBasisSwitches(
        gate([record('past-paper', { cells: { ...ENOUGH_CELLS, ...short } })]),
      )['past-paper'];
      expect(state.status).toBe('off');
      if (state.status !== 'off' || state.reason !== 'too-few-held-out-cells') {
        throw new Error('expected too-few-held-out-cells');
      }
      expect(state.shortfall).toEqual([expected]);
      expect(describeBasisSwitch(state)).toContain(
        'past papers: on the lexical fallback: not enough held-out cells for a reading',
      );
    }
  });

  it('a record whose verdict says switch on but whose counts fall short stays off: the minimums are re-checked, not taken on trust', () => {
    const state = resolveBasisSwitches(
      gate([record('assessment-brief', { cells: { ...ENOUGH_CELLS, attested: 3 } })]),
    )['assessment-brief'];
    expect(offReason(state)).toBe('too-few-held-out-cells');
    expect(describeBasisSwitch(state)).toContain('attested 3 of 10 in 2 of 2 courses');
  });

  it('a recorded too-few-cells verdict stays off and says so even when the counts look sufficient', () => {
    const state = resolveBasisSwitches(
      gate([record('assessment-brief', { verdict: { kind: 'too-few-cells' } })]),
    )['assessment-brief'];
    expect(offReason(state)).toBe('too-few-held-out-cells');
  });

  it('a gate not met stays off and names the conditions, a harm breach as "limit breached"', () => {
    const state = resolveBasisSwitches(
      gate([
        record('objectives', {
          verdict: { kind: 'gate-not-met', failed: ['harm-limit', 'beats-verbatim'] },
        }),
      ]),
    ).objectives;
    expect(offReason(state)).toBe('gate-not-met');
    expect(describeBasisSwitch(state)).toBe(
      'objectives: on the lexical fallback: gate not met (limit breached; does not beat the verbatim path)',
    );
  });

  it('refuses a record judged under another pre-registration, one with no evidence, and a second record for the same basis', () => {
    const refusal = (records: readonly BasisGateRecord[]): unknown => {
      const state = resolveBasisSwitches(gate(records)).objectives;
      return state.status === 'off' && state.reason === 'record-refused' ? state.refusal : state;
    };
    expect(refusal([record('objectives', { preRegistration: 'a-looser-gate' })])).toBe(
      'other-pre-registration',
    );
    expect(
      refusal([record('objectives', { evidence: { report: ' ', recordedBy: 'ol-test.1' } })]),
    ).toBe('no-evidence');
    expect(
      refusal([record('objectives', { evidence: { report: 'findings/x.md', recordedBy: '' } })]),
    ).toBe('no-evidence');
    expect(refusal([record('objectives'), record('objectives')])).toBe('more-than-one-record');
  });
});

describe('held-out exposure (AC3): one pre-registered look per set; anything after it is post hoc', () => {
  const look = { heldOutSetHash: SET, configurationDigest: FROZEN };

  it('the frozen configuration, registered before any look and looking first, is pre-registered', () => {
    expect(classifyHeldOutLook(look, SEALED_AND_LOOKED)).toEqual({ standing: 'pre-registered' });
  });

  it('starts empty: with nothing registered or looked at, no look can pass', () => {
    expect(classifyHeldOutLook(look, { events: [] })).toEqual({
      standing: 'post-hoc',
      reason: 'set-not-registered',
    });
  });

  it('a configuration adapted after the look is post hoc on that set', () => {
    const exposure: HeldOutExposureRecord = {
      events: [registered(SET, FROZEN), looked(SET, FROZEN), looked(SET, ADAPTED)],
    };
    expect(
      classifyHeldOutLook({ heldOutSetHash: SET, configurationDigest: ADAPTED }, exposure),
    ).toEqual({ standing: 'post-hoc', reason: 'not-the-frozen-configuration' });
  });

  it('renaming gives no fresh test: re-registering the same set for the adapted configuration is refused, for both configurations', () => {
    const exposure: HeldOutExposureRecord = {
      events: [
        registered(SET, FROZEN),
        looked(SET, FROZEN),
        registered(SET, ADAPTED),
        looked(SET, ADAPTED),
      ],
    };
    for (const configurationDigest of [FROZEN, ADAPTED]) {
      expect(classifyHeldOutLook({ heldOutSetHash: SET, configurationDigest }, exposure)).toEqual({
        standing: 'post-hoc',
        reason: 'set-registered-twice',
      });
    }
  });

  it('a look taken before the set was registered contaminates it', () => {
    const exposure: HeldOutExposureRecord = {
      events: [looked(SET, FROZEN), registered(SET, FROZEN), looked(SET, FROZEN)],
    };
    expect(classifyHeldOutLook(look, exposure)).toEqual({
      standing: 'post-hoc',
      reason: 'looked-before-registration',
    });
  });

  it('when another configuration looked first, the frozen one is no longer the first look', () => {
    const exposure: HeldOutExposureRecord = {
      events: [registered(SET, FROZEN), looked(SET, ADAPTED), looked(SET, FROZEN)],
    };
    expect(classifyHeldOutLook(look, exposure)).toEqual({
      standing: 'post-hoc',
      reason: 'not-the-first-look',
    });
  });

  it('a record naming a look the exposure record does not hold cannot pass', () => {
    expect(classifyHeldOutLook(look, { events: [registered(SET, FROZEN)] })).toEqual({
      standing: 'post-hoc',
      reason: 'look-not-recorded',
    });
  });

  it('a post hoc result cannot pass the gate on that set, whatever its verdict and counts; a new sealed set can', () => {
    const adaptedRecord = record('objectives', {
      look: { heldOutSetHash: SET, configurationDigest: ADAPTED },
    });
    const onOldSet = resolveBasisSwitches(
      gate([adaptedRecord], {
        events: [registered(SET, FROZEN), looked(SET, FROZEN), looked(SET, ADAPTED)],
      }),
    ).objectives;
    expect(onOldSet.status).toBe('off');
    if (onOldSet.status !== 'off' || onOldSet.reason !== 'post-hoc') {
      throw new Error('expected post hoc');
    }
    expect(onOldSet.postHoc).toBe('not-the-frozen-configuration');
    expect(describeBasisSwitch(onOldSet)).toContain('post hoc');

    const NEW_SET = 'sha256:held-out-set-2';
    const onNewSet = resolveBasisSwitches(
      gate(
        [record('objectives', { look: { heldOutSetHash: NEW_SET, configurationDigest: ADAPTED } })],
        {
          events: [
            registered(SET, FROZEN),
            looked(SET, FROZEN),
            looked(SET, ADAPTED),
            registered(NEW_SET, ADAPTED),
            looked(NEW_SET, ADAPTED),
          ],
        },
      ),
    ).objectives;
    expect(onNewSet.status).toBe('on');
  });
});

describe('enabling is recorded with its evidence (AC4)', () => {
  it('the on state carries the whole record it was resolved from, and its statement names the configuration and the evidence', () => {
    const passing = record('objectives');
    const state = resolveBasisSwitches(gate([passing])).objectives;
    if (state.status !== 'on') throw new Error('expected on');
    expect(state.record).toBe(passing);
    const statement = describeBasisSwitch(state);
    expect(statement).toContain(FROZEN);
    expect(statement).toContain('findings/invented-benchmark.md#objectives');
    expect(statement).toContain('ol-test.1');
    // On is still the lexical fallback until alignment results with that configuration are read.
    expect(statement).toContain('its edges are the lexical fallback');
  });
});

describe('the fallback label (AC2): lexical edges are labelled lexical fallback, a non-match reads not assessed', () => {
  const edge = (basis: ConceptAssessmentEdge['basis'], conceptKey = 'k:widget') =>
    ({
      conceptName: conceptKey,
      conceptKey,
      assessmentPath: '02 Assignments/Quiz 1.md',
      course: 'TESTC101',
      yieldRank: 1,
      confidence: 1,
      citations: [],
      basis,
    }) as ConceptAssessmentEdge;

  it('every edge of every basis is lexical fallback, with the switch off (switch-off) and with it on (alignment-pending)', () => {
    const off = attributeBasisSources(resolveBasisSwitches());
    const on = attributeBasisSources(
      resolveBasisSwitches(
        gate([record('objectives'), record('past-paper'), record('assessment-brief')]),
      ),
    );
    for (const basis of [...RANKING_BASES, undefined]) {
      expect(edgeEvidenceSource(edge(basis), off)).toBe('lexical-fallback');
      expect(edgeEvidenceSource(edge(basis), on)).toBe('lexical-fallback');
    }
    for (const basis of RANKING_BASES) {
      expect(off[basis]).toMatchObject({ source: 'lexical-fallback', cause: 'switch-off' });
      expect(on[basis]).toMatchObject({ source: 'lexical-fallback', cause: 'alignment-pending' });
      expect(off[basis].statement).not.toBe('');
    }
  });

  it('a pending document with no lexical match reads not assessed — never excluded, never not aligned', () => {
    const pending = attributeBasisSources(resolveBasisSwitches(gate([record('objectives')])));
    const edges = [edge('objectives', 'k:widget')];
    const missing: ConceptBasisReading = readConceptBasis(
      edges,
      { course: 'TESTC101', conceptKey: 'k:cog', basis: 'objectives' },
      pending,
    );
    expect(missing).toEqual({ reading: 'not-assessed', cause: 'alignment-pending' });
    expect(
      readConceptBasis(
        edges,
        { course: 'TESTC101', conceptKey: 'k:widget', basis: 'objectives' },
        pending,
      ),
    ).toEqual({
      reading: 'matched',
      source: 'lexical-fallback',
      cause: 'alignment-pending',
      edgeCount: 1,
    });
    // With the switch off a non-match is still only not assessed.
    expect(
      readConceptBasis(
        edges,
        { course: 'TESTC101', conceptKey: 'k:cog', basis: 'objectives' },
        attributeBasisSources(resolveBasisSwitches()),
      ),
    ).toEqual({ reading: 'not-assessed', cause: 'switch-off' });
    // The reading has two values and no third: nothing it returns can say excluded or not aligned.
    const readings: ConceptBasisReading['reading'][] = ['matched', 'not-assessed'];
    expect(JSON.stringify(readings)).not.toMatch(/exclu|not-aligned|negative/);
  });
});

describe('buildConceptAssessmentEdges reports the switch and changes no edge with it', () => {
  let root: string;
  let source: FolderSource;

  async function write(relPath: string, content: string): Promise<void> {
    const full = join(root, ...relPath.split('/'));
    await mkdir(join(full, '..'), { recursive: true });
    await writeFile(full, content, 'utf8');
  }

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'olea-basis-switch-'));
    source = new FolderSource(root);
    await write('05 Zettelkasten/Widget theory.md', '# Widget theory\n');
    await write('05 Zettelkasten/Cog principle.md', '# Cog principle\n');
    await write(
      '03 Research/TESTC101 Course Objectives.md',
      '---\nrole: objectives\ncourse: TESTC101\n---\n\n# Objectives\n\n- Relate Widget theory to outcomes.\n',
    );
    await write(
      '02 Assignments/Assignments.base',
      'filters:\n  and:\n    - file.inFolder("02 Assignments")\n    - file.ext == "md"\nproperties:\n  class:\n  type:\n  weight:\n  due:\n  status:\n',
    );
    await write(
      '02 Assignments/Quiz 1.md',
      '---\nclass: TESTC101\ntype: Quiz\nweight: 10\ndue: 2026-09-01\nstatus: upcoming\n---\n\n# Quiz 1\n',
    );
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it('default: every basis reported off and lexical fallback; with objectives switched on, the same edges, labelled alignment-pending, and the unmatched concept not assessed', async () => {
    const options = { basePath: '02 Assignments/Assignments.base', concepts: [] };
    const off = await buildConceptAssessmentEdges(source, options);
    for (const basis of RANKING_BASES) {
      expect(off.basisSources[basis]).toMatchObject({
        source: 'lexical-fallback',
        cause: 'switch-off',
      });
    }
    expect(off.edges.map((e) => [e.conceptName, e.basis])).toEqual([
      ['Widget theory', 'objectives'],
    ]);

    const on = await buildConceptAssessmentEdges(source, {
      ...options,
      basisGate: gate([record('objectives')]),
    });
    expect(JSON.stringify(on.edges)).toBe(JSON.stringify(off.edges));
    expect(on.basisSources.objectives).toMatchObject({
      source: 'lexical-fallback',
      cause: 'alignment-pending',
    });
    expect(on.basisSources['past-paper'].cause).toBe('switch-off');
    expect(
      readConceptBasis(
        on.edges,
        { course: 'TESTC101', conceptKey: 'Cog principle', basis: 'objectives' },
        on.basisSources,
      ),
    ).toEqual({ reading: 'not-assessed', cause: 'alignment-pending' });
  });
});
