/**
 * ol-egov.141.89.7.110 (HELD, decision sheet v85): a request evaluates the unlock rule again at the
 * moment she asks. Scenarios: features/F4-oracle.md, "a request re-checks the rule". Synthetic
 * course SYN101 only; the generation port only counts calls.
 */
import { listPaperRecords, type PaperItemGenerationRequest, type VaultSource } from 'olea-core';
import { describe, expect, it } from 'vitest';
import type {
  PaperItemPortOutcome,
  PaperSlotOutcomePort,
} from '../../src/oracle/paper-item-port.js';
import { createLocalPracticePaperProvider } from '../../src/paper/provider.js';
import { memoryVault } from '../review/memory-vault.js';

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
const TODAY = '2026-09-19T12:00:00Z';
const AFTER_DUE = '2026-09-25T12:00:00Z';

function buildVault(): VaultSource {
  return memoryVault({
    [BASE_PATH]: BASE_FILE,
    '05 Zettelkasten/Widget theory.md': '# Widget theory\n',
    'Notes/one.md': '---\ntopic: [Widget theory]\ncourse: SYN101\n---\n\nFront::Back\n',
    '02 Assignments/exam.md': `---\nclass: ${COURSE}\ntype: exam\nweight: 1\ndue: 2026-09-22\nstatus: pending\n---\n`,
  });
}

const GENERATED = (request: PaperItemGenerationRequest): PaperItemPortOutcome => ({
  status: 'generated',
  taskId: request.taskId,
  promptVersion: 'v1',
  response: { ok: true, result: { cards: [{ front: 'q', back: 'a' }] } },
});
const OUTAGE: PaperItemPortOutcome = { status: 'unavailable', reason: 'transport-failure' };

function rig() {
  const vault = buildVault();
  let now = TODAY;
  let answer: (r: PaperItemGenerationRequest) => PaperItemPortOutcome = GENERATED;
  let calls = 0;
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
  return {
    vault,
    provider,
    setNow: (iso: string) => {
      now = iso;
    },
    setAnswer: (next: typeof answer) => {
      answer = next;
    },
    calls: () => calls,
    resetCalls: () => {
      calls = 0;
    },
  };
}

describe('a request evaluates the unlock rule again (ol-egov.141.89.7.110)', () => {
  it('stale view: loaded while the rule fired, requested after the due day, composes nothing', async () => {
    const r = rig();
    expect((await r.provider.load(COURSE)).kind).toBe('unlocked-not-pulled');
    r.setNow(AFTER_DUE);
    const result = await r.provider.requestPaper(COURSE);
    expect(result).toEqual({
      kind: 'no-assessment-ahead',
      course: COURSE,
      undatedAssessment: false,
    });
    expect(r.calls()).toBe(0);
    expect(await listPaperRecords(r.vault)).toHaveLength(0);
  });

  it('ask again: after an unfinished paper and a due day that has passed, composes nothing', async () => {
    const r = rig();
    r.setAnswer(() => OUTAGE);
    await expect(r.provider.requestPaper(COURSE)).rejects.toThrow();
    r.setNow(AFTER_DUE);
    r.setAnswer(GENERATED);
    r.resetCalls();
    const result = await r.provider.requestPaper(COURSE);
    expect(result.kind).toBe('no-assessment-ahead');
    expect(r.calls()).toBe(0);
    expect(await listPaperRecords(r.vault)).toHaveLength(0);
  });

  it('while the rule still fires, the request composes as before', async () => {
    const r = rig();
    const result = await r.provider.requestPaper(COURSE);
    expect(result.kind).toBe('ready');
    expect(r.calls()).toBeGreaterThan(0);
  });
});
