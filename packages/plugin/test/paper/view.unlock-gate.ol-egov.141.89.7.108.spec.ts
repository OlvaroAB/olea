/**
 * The practice-paper unlock gate, observed through the shipped view over the real provider
 * (ol-egov.141.89.7.108). Synthetic course SYN101 only; the generation port only counts calls.
 *
 * Block A pins the gate's required behaviour. Block B records what the shipped code does at the
 * edges (a stale view, an "ask again", the local-midnight boundary) and asserts nothing about the
 * values it sees: each probe is evidence for a reader, not a verdict. When `OLEA_C4_RECORD_OUT`
 * names a file, the observations are written there as JSON; otherwise nothing is written.
 */
import { writeFileSync } from 'node:fs';
import {
  attachConceptToOutcome,
  enumerateVaultInstruments,
  listPaperRecords,
  type PaperItemGenerationRequest,
  resolveOutcome,
  type VaultSource,
} from 'olea-core';
import { afterAll, describe, expect, it, vi } from 'vitest';
import type {
  PaperItemPortOutcome,
  PaperSlotOutcomePort,
} from '../../src/oracle/paper-item-port.js';
import { memoryVault } from '../review/memory-vault.js';

vi.mock('obsidian', () => ({
  ItemView: class {
    contentEl: unknown;
    constructor(_leaf: unknown) {
      this.contentEl = (globalThis as { __rootFactory?: () => unknown }).__rootFactory?.();
    }
  },
}));

import {
  createLocalPracticePaperProvider,
  type PracticePaperViewDeps,
} from '../../src/paper/provider.js';
import { PaperView } from '../../src/paper/view.js';
import { FakeEl } from './fake-dom.helper.js';

const COURSE = 'SYN101';
const BASE_PATH = '02 Assignments/Assignments.base';
const BASE_FILE = [
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
].join('\n');
const CONCEPT_NOTE = '05 Zettelkasten/Widget theory.md';

/** One fixed synthetic calendar. */
const TODAY = '2026-09-19T00:00:00Z';
const DUE_WITHIN_WINDOW = '2026-09-22'; // 3 days after TODAY
const DUE_FAR = '2026-12-01';
const DUE_PASSED = '2026-01-01';
const AFTER_DUE = '2026-09-25T00:00:00Z';

function assessment(due: string): string {
  return `---\nclass: ${COURSE}\ntype: exam\nweight: 1\ndue: ${due}\nstatus: pending\n---\n`;
}

function buildVault(due: string): VaultSource {
  return memoryVault({
    [BASE_PATH]: BASE_FILE,
    [CONCEPT_NOTE]: '# Widget theory\n',
    'Notes/one.md': [
      '---',
      'topic: [Widget theory]',
      `course: ${COURSE}`,
      '---',
      '',
      'Front::Back',
      '',
    ].join('\n'),
    '02 Assignments/exam.md': assessment(due),
  });
}

const GENERATED = (request: PaperItemGenerationRequest): PaperItemPortOutcome => ({
  status: 'generated',
  taskId: request.taskId,
  promptVersion: 'v1',
  response: { ok: true, result: { cards: [{ front: 'q', back: 'a' }] } },
});
const OUTAGE: PaperItemPortOutcome = { status: 'unavailable', reason: 'transport-failure' };

interface Rig {
  readonly vault: VaultSource;
  readonly root: FakeEl;
  readonly view: PaperView;
  readonly events: string[];
  readonly setNow: (iso: string) => void;
  readonly setAnswer: (answer: (r: PaperItemGenerationRequest) => PaperItemPortOutcome) => void;
  readonly portCalls: () => number;
  readonly resetPortCalls: () => void;
  readonly lastRequest: () => { kind: string; items: number } | null;
}

/** The real view over the real provider; only the generation port is a counter. */
function rig(vault: VaultSource, nowIso: string): Rig {
  let now = nowIso;
  let answer = GENERATED;
  let calls = 0;
  let last: { kind: string; items: number } | null = null;
  const events: string[] = [];
  const port: PaperSlotOutcomePort = async (request) => {
    calls += 1;
    events.push('port:call');
    return answer(request);
  };
  const provider = createLocalPracticePaperProvider({
    vault,
    settingsStore: {
      load: async () => ({ version: 1 as const, assignmentsBasePath: BASE_PATH }),
    },
    generationPort: async () => port,
    now: () => new Date(now),
  });
  const deps: PracticePaperViewDeps = {
    ...provider,
    load: async (course) => {
      const state = await provider.load(course);
      events.push(`load:${state.kind}`);
      return state;
    },
    requestPaper: async (course) => {
      try {
        const result = await provider.requestPaper(course);
        last = { kind: result.kind, items: result.kind === 'ready' ? result.items.length : 0 };
        return result;
      } catch (error) {
        last = { kind: 'threw', items: 0 };
        throw error;
      }
    },
  };
  const root = new FakeEl('root');
  (globalThis as { __rootFactory?: () => unknown }).__rootFactory = () => root;
  const view = new PaperView({} as never, deps, COURSE);
  return {
    vault,
    root,
    view,
    events,
    setNow: (iso) => {
      now = iso;
    },
    setAnswer: (next) => {
      answer = next;
    },
    portCalls: () => calls,
    resetPortCalls: () => {
      calls = 0;
    },
    lastRequest: () => last,
  };
}

const requestButtons = (r: Rig) => r.root.find('button');

/** Lets the view's fire-and-forget pull finish: waits until the composing line is gone. */
async function settle(r: Rig): Promise<void> {
  for (let i = 0; i < 200; i += 1) {
    await new Promise((resolve) => setTimeout(resolve, 5));
    if (!r.root.allText().includes('Composing your practice paper')) return;
  }
}

async function pressRequest(r: Rig): Promise<void> {
  const [button] = requestButtons(r);
  if (button === undefined) throw new Error('no request button on screen');
  button.click();
  await settle(r);
}

/** Declares ten outcomes for the course and attaches the course concept to `attached` of them. */
async function declareOutcomes(vault: VaultSource, attached: number): Promise<void> {
  const enumeration = await enumerateVaultInstruments(vault);
  const conceptKey = enumeration.concepts.find((c) => c.courses.includes(COURSE))?.key;
  if (conceptKey === undefined) throw new Error('fixture note did not yield a concept');
  for (let i = 0; i < 10; i += 1) {
    const outcome = await resolveOutcome(vault, {
      courses: [COURSE],
      source: { path: CONCEPT_NOTE, blockIndex: i },
      label: `Topic ${i}`,
      provenance: { promptVersion: 'v1', modelVersion: 'model-a' },
    });
    if (i < attached) await attachConceptToOutcome(vault, outcome.id, conceptKey);
  }
}

describe('C4 view gate: required behaviour', () => {
  it('offers the request for an assessment inside the window, loads before any port call, and pressing it produces items', async () => {
    const r = rig(buildVault(DUE_WITHIN_WINDOW), TODAY);
    await r.view.refresh();
    expect(r.events).toEqual(['load:unlocked-not-pulled']);
    expect(requestButtons(r)).toHaveLength(1);
    expect(r.portCalls()).toBe(0);

    await pressRequest(r);
    expect(r.portCalls()).toBeGreaterThan(0);
    expect(r.events.indexOf('load:unlocked-not-pulled')).toBeLessThan(
      r.events.indexOf('port:call'),
    );
    expect(r.lastRequest()?.kind).toBe('ready');
    expect(r.lastRequest()?.items).toBeGreaterThan(0);
  });

  it('shows the locked copy and no button for an assessment outside the window with low coverage', async () => {
    const vault = buildVault(DUE_FAR);
    const r = rig(vault, TODAY);
    await r.view.refresh();
    expect(r.events).toEqual(['load:locked']);
    expect(requestButtons(r)).toHaveLength(0);
    expect(r.root.allText()).toContain('is not available yet');
    expect(r.portCalls()).toBe(0);
    expect(await listPaperRecords(vault)).toHaveLength(0);
  });

  it('shows no button and makes no port call when every assessment has passed', async () => {
    const vault = buildVault(DUE_PASSED);
    const r = rig(vault, TODAY);
    await r.view.refresh();
    expect(r.events).toEqual(['load:no-assessment-ahead']);
    expect(requestButtons(r)).toHaveLength(0);
    expect(r.portCalls()).toBe(0);
    expect(await listPaperRecords(vault)).toHaveLength(0);
  });

  it('coverage leg: far from the assessment, offered with 3 of 10 topics covered, locked with 2 of 10', async () => {
    const atGate = buildVault(DUE_FAR);
    await declareOutcomes(atGate, 3);
    const open = rig(atGate, TODAY);
    await open.view.refresh();
    expect(open.events).toEqual(['load:unlocked-not-pulled']);
    expect(requestButtons(open)).toHaveLength(1);

    const belowGate = buildVault(DUE_FAR);
    await declareOutcomes(belowGate, 2);
    const shut = rig(belowGate, TODAY);
    await shut.view.refresh();
    expect(shut.events).toEqual(['load:locked']);
    expect(requestButtons(shut)).toHaveLength(0);
    expect(shut.portCalls()).toBe(0);
  });
});

interface Observation {
  readonly case: string;
  readonly nowIso: string;
  readonly loadKind: string;
  readonly offered: boolean;
  readonly portCalls: number;
  readonly itemsLanded: number;
  readonly finalKind: string;
}
const observations: Observation[] = [];

function loadKindOf(r: Rig): string {
  return r.events.find((e) => e.startsWith('load:'))?.slice('load:'.length) ?? 'none';
}

describe('C4 probes: observed, not asserted', () => {
  afterAll(() => {
    const out = process.env.OLEA_C4_RECORD_OUT;
    if (out) {
      writeFileSync(
        out,
        `${JSON.stringify({ schema: 'c4-view-probes/1', observations }, null, 2)}\n`,
      );
    }
  });

  it('5. stale: the rule fires at render, the clock passes the due date, then the button is pressed', async () => {
    const r = rig(buildVault(DUE_WITHIN_WINDOW), TODAY);
    await r.view.refresh();
    const offered = requestButtons(r).length > 0;
    r.setNow(AFTER_DUE);
    if (offered) await pressRequest(r);
    observations.push({
      case: 'stale',
      nowIso: TODAY,
      loadKind: loadKindOf(r),
      offered,
      portCalls: r.portCalls(),
      itemsLanded: r.lastRequest()?.items ?? 0,
      finalKind: r.lastRequest()?.kind ?? 'not-requested',
    });
    expect(observations.at(-1)).toBeDefined();
  });

  it('6. ask again: the first request fails as unfinished, the clock passes the due date, the re-offered button is pressed', async () => {
    const r = rig(buildVault(DUE_WITHIN_WINDOW), TODAY);
    r.setAnswer(() => OUTAGE);
    await r.view.refresh();
    const offered = requestButtons(r).length > 0;
    if (offered) await pressRequest(r);
    const reOffered = requestButtons(r).length > 0;
    r.setNow(AFTER_DUE);
    r.setAnswer(GENERATED);
    r.resetPortCalls();
    if (reOffered) await pressRequest(r);
    observations.push({
      case: 'ask-again (port calls and items are the second press only)',
      nowIso: TODAY,
      loadKind: loadKindOf(r),
      offered: reOffered,
      portCalls: r.portCalls(),
      itemsLanded: r.lastRequest()?.items ?? 0,
      finalKind: r.lastRequest()?.kind ?? 'not-requested',
    });
    expect(observations.at(-1)).toBeDefined();
  });

  it('7. midnight, 7 days before the due day at local 00:30 in UTC+01:00', async () => {
    const nowIso = '2026-09-14T23:30:00Z';
    const r = rig(buildVault(DUE_WITHIN_WINDOW), nowIso);
    await r.view.refresh();
    const offered = requestButtons(r).length > 0;
    observations.push({
      case: 'midnight-day-minus-7',
      nowIso,
      loadKind: loadKindOf(r),
      offered,
      portCalls: r.portCalls(),
      itemsLanded: 0,
      finalKind: 'not-requested',
    });
    expect(observations.at(-1)).toBeDefined();
  });

  it('8. midnight, the day after the due day at local 00:30 in UTC+01:00', async () => {
    const nowIso = '2026-09-22T23:30:00Z';
    const r = rig(buildVault(DUE_WITHIN_WINDOW), nowIso);
    await r.view.refresh();
    const offered = requestButtons(r).length > 0;
    if (offered) await pressRequest(r);
    observations.push({
      case: 'midnight-day-plus-1',
      nowIso,
      loadKind: loadKindOf(r),
      offered,
      portCalls: r.portCalls(),
      itemsLanded: r.lastRequest()?.items ?? 0,
      finalKind: r.lastRequest()?.kind ?? 'not-requested',
    });
    expect(observations.at(-1)).toBeDefined();
  });
});
