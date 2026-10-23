/**
 * The practice-paper unlock re-check, observed through the shipped view over the real provider
 * (ol-egov.141.89.7.110, [D-622]): every request, "ask again" included, re-evaluates the unlock
 * rule; an expired selected assessment shows the ruled passed sentence above the course's current
 * state, never the stale offer. Synthetic course SYN101 only; the generation port only counts
 * calls. Scenarios in `features/F4-oracle.md`.
 */
import { listPaperRecords, type PaperItemGenerationRequest, type VaultSource } from 'olea-core';
import { afterEach, describe, expect, it, vi } from 'vitest';
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

import { ASSESSMENT_PASSED_SENTENCE, buildNoAssessmentAheadCopy } from '../../src/paper/copy.js';
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
const EXAM_PATH = '02 Assignments/exam.md';

const NOW = '2026-09-19T12:00:00Z';
const FIRST_DUE = '2026-09-22';
const PASSED_FOR_FIRST = '2026-09-25T12:00:00Z';
const PASSED_FOR_FIRST_NEXT_INSIDE = '2026-09-23T12:00:00Z';

function assessment(due: string): string {
  return `---\nclass: ${COURSE}\ntype: exam\nweight: 1\ndue: ${due}\nstatus: pending\n---\n`;
}

/** `{ 'exam.md': '2026-09-22', ... }` become assessment files under `02 Assignments/`. */
function buildVault(exams: Record<string, string>): VaultSource {
  const files: Record<string, string> = {
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
  };
  for (const [name, due] of Object.entries(exams))
    files[`02 Assignments/${name}`] = assessment(due);
  return memoryVault(files);
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
  const port: PaperSlotOutcomePort = async (request) => {
    calls += 1;
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
    requestPaper: async (course, offeredFor) => {
      try {
        const result = await provider.requestPaper(course, offeredFor);
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

const ORIGINAL_TZ = process.env.TZ;
afterEach(() => {
  if (ORIGINAL_TZ === undefined) delete process.env.TZ;
  else process.env.TZ = ORIGINAL_TZ;
});

describe('[D-622] the unlock is re-checked on every request', () => {
  it('a stale offer with nothing ahead shows the passed sentence, then the no-upcoming sentence, and composes nothing', async () => {
    const vault = buildVault({ 'exam.md': FIRST_DUE });
    const r = rig(vault, NOW);
    await r.view.refresh();
    expect(requestButtons(r)).toHaveLength(1);
    r.setNow(PASSED_FOR_FIRST);
    await pressRequest(r);

    const text = r.root.allText();
    expect(text).toContain(ASSESSMENT_PASSED_SENTENCE);
    expect(text).toContain(buildNoAssessmentAheadCopy(COURSE));
    expect(text.indexOf(ASSESSMENT_PASSED_SENTENCE)).toBeLessThan(
      text.indexOf(buildNoAssessmentAheadCopy(COURSE)),
    );
    expect(requestButtons(r)).toHaveLength(0);
    expect(r.portCalls()).toBe(0);
    expect(await listPaperRecords(vault)).toHaveLength(0);
  });

  it('a stale offer with a later exam inside the window shows the passed sentence and a fresh offer for the later exam', async () => {
    const r = rig(buildVault({ 'exam.md': FIRST_DUE, 'exam2.md': '2026-09-27' }), NOW);
    await r.view.refresh();
    expect(requestButtons(r)).toHaveLength(1);
    r.setNow(PASSED_FOR_FIRST_NEXT_INSIDE);
    await pressRequest(r);

    const text = r.root.allText();
    expect(text).toContain(ASSESSMENT_PASSED_SENTENCE);
    expect(text).not.toContain(buildNoAssessmentAheadCopy(COURSE));
    expect(requestButtons(r)).toHaveLength(1);
    expect(r.portCalls()).toBe(0);

    await pressRequest(r);
    expect(r.lastRequest()?.kind).toBe('ready');
    expect(r.portCalls()).toBeGreaterThan(0);
    expect(r.root.allText()).not.toContain(ASSESSMENT_PASSED_SENTENCE);
  });

  it('a stale offer with a later exam outside the window shows the passed sentence and the locked reason, with no button', async () => {
    const r = rig(buildVault({ 'exam.md': FIRST_DUE, 'exam2.md': '2026-10-30' }), NOW);
    await r.view.refresh();
    expect(requestButtons(r)).toHaveLength(1);
    r.setNow(PASSED_FOR_FIRST_NEXT_INSIDE);
    await pressRequest(r);

    const text = r.root.allText();
    expect(text).toContain(ASSESSMENT_PASSED_SENTENCE);
    expect(text).toContain('is not available yet');
    expect(text).not.toContain(buildNoAssessmentAheadCopy(COURSE));
    expect(requestButtons(r)).toHaveLength(0);
    expect(r.portCalls()).toBe(0);
  });

  it('asking again after an unfinished paper re-checks too: the passed sentence shows and no paper is made', async () => {
    const vault = buildVault({ 'exam.md': FIRST_DUE });
    const r = rig(vault, NOW);
    r.setAnswer(() => OUTAGE);
    await r.view.refresh();
    await pressRequest(r);
    expect(requestButtons(r)).toHaveLength(1);

    r.setNow(PASSED_FOR_FIRST);
    r.setAnswer(GENERATED);
    r.resetPortCalls();
    await pressRequest(r);

    expect(r.root.allText()).toContain(ASSESSMENT_PASSED_SENTENCE);
    expect(r.portCalls()).toBe(0);
    expect(await listPaperRecords(vault)).toHaveLength(0);
  });

  it('an exam moved later is not reported as passed; the locked reason shows instead', async () => {
    const vault = buildVault({ 'exam.md': FIRST_DUE });
    const r = rig(vault, NOW);
    await r.view.refresh();
    expect(requestButtons(r)).toHaveLength(1);
    await vault.write(EXAM_PATH, assessment('2026-10-30'));
    r.setNow(PASSED_FOR_FIRST_NEXT_INSIDE);
    await pressRequest(r);

    const text = r.root.allText();
    expect(text).not.toContain(ASSESSMENT_PASSED_SENTENCE);
    expect(text).toContain('is not available yet');
    expect(r.portCalls()).toBe(0);
  });

  it('a still-eligible request composes the paper with no passed sentence', async () => {
    const r = rig(buildVault({ 'exam.md': FIRST_DUE }), NOW);
    await r.view.refresh();
    await pressRequest(r);
    expect(r.lastRequest()?.kind).toBe('ready');
    expect(r.root.allText()).not.toContain(ASSESSMENT_PASSED_SENTENCE);
  });

  it('expiry happens at local midnight: 00:30 the day after the due day, in UTC+01:00, has passed', async () => {
    process.env.TZ = 'Etc/GMT-1';
    // On the UTC date this instant would still read the due day.
    expect(new Date('2026-09-22T23:30:00Z').toISOString().slice(0, 10)).toBe('2026-09-22');
    const r = rig(buildVault({ 'exam.md': FIRST_DUE }), '2026-09-22T22:30:00Z');
    await r.view.refresh();
    expect(requestButtons(r)).toHaveLength(1);
    r.setNow('2026-09-22T23:30:00Z');
    await pressRequest(r);

    expect(r.root.allText()).toContain(ASSESSMENT_PASSED_SENTENCE);
    expect(r.portCalls()).toBe(0);
  });

  it('the passed sentence is the ruled wording, verbatim ([D-622])', () => {
    expect(ASSESSMENT_PASSED_SENTENCE).toBe(
      'This assessment has passed, so a practice paper is no longer available for it.',
    );
  });
});
