/**
 * ol-egov.141.89.7.110, `[D-622]` (decision sheet v85, row 11): every request, "ask again" included,
 * evaluates the unlock rule again at the moment she asks, and a request for an assessment that has
 * passed composes nothing and says so over the course's current state. Scenarios:
 * features/F4-oracle.md, "a request re-checks the rule". Synthetic course SYN101 only; the
 * generation port only counts calls. The device zone is set through process.env.TZ inside a test
 * and restored afterwards.
 */
import { listPaperRecords, type PaperItemGenerationRequest, type VaultSource } from 'olea-core';
import { afterEach, describe, expect, it } from 'vitest';
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
const EXAM = '02 Assignments/exam.md';
const EXAM_2 = '02 Assignments/exam2.md';

function assessment(due: string): string {
  return `---\nclass: ${COURSE}\ntype: exam\nweight: 1\ndue: ${due}\nstatus: pending\n---\n`;
}

/** One exam due 2026-09-22 unless `dues` says otherwise; `dues` maps an assignments path to its due date. */
function buildVault(
  dues: Readonly<Record<string, string>> = { [EXAM]: '2026-09-22' },
): VaultSource {
  return memoryVault({
    [BASE_PATH]: BASE_FILE,
    '05 Zettelkasten/Widget theory.md': '# Widget theory\n',
    'Notes/one.md': '---\ntopic: [Widget theory]\ncourse: SYN101\n---\n\nFront::Back\n',
    ...Object.fromEntries(Object.entries(dues).map(([path, due]) => [path, assessment(due)])),
  });
}

const GENERATED = (request: PaperItemGenerationRequest): PaperItemPortOutcome => ({
  status: 'generated',
  taskId: request.taskId,
  promptVersion: 'v1',
  response: { ok: true, result: { cards: [{ front: 'q', back: 'a' }] } },
});
const OUTAGE: PaperItemPortOutcome = { status: 'unavailable', reason: 'transport-failure' };

function rig(vault: VaultSource = buildVault(), start: string = TODAY) {
  let now = start;
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

const savedTz = process.env.TZ;
afterEach(() => {
  if (savedTz === undefined) delete process.env.TZ;
  else process.env.TZ = savedTz;
});

/** Loads the offered state and returns the assessment it was offered for. */
async function offeredAt(r: ReturnType<typeof rig>) {
  const state = await r.provider.load(COURSE);
  if (state.kind !== 'unlocked-not-pulled') throw new Error(`expected an offer, got ${state.kind}`);
  return state.offeredFor;
}

describe('a request for an assessment that has passed ([D-622])', () => {
  it('the offered state names the assessment the rule fired for', async () => {
    const r = rig();
    expect(await offeredAt(r)).toEqual({ path: EXAM, due: '2026-09-22' });
  });

  it('stale view, nothing ahead: assessment-passed over the current no-assessment-ahead state, nothing composed', async () => {
    const r = rig();
    const offered = await offeredAt(r);
    r.setNow(AFTER_DUE);
    const result = await r.provider.requestPaper(COURSE, offered);
    expect(result).toEqual({
      kind: 'assessment-passed',
      course: COURSE,
      current: { kind: 'no-assessment-ahead', course: COURSE, undatedAssessment: false },
    });
    expect(r.calls()).toBe(0);
    expect(await listPaperRecords(r.vault)).toHaveLength(0);
  });

  it('a later assessment now inside the window: still assessment-passed, and the current state offers the later one', async () => {
    const r = rig(buildVault({ [EXAM]: '2026-09-22', [EXAM_2]: '2026-09-27' }));
    const offered = await offeredAt(r);
    r.setNow('2026-09-23T12:00:00Z');
    const result = await r.provider.requestPaper(COURSE, offered);
    expect(result).toEqual({
      kind: 'assessment-passed',
      course: COURSE,
      current: {
        kind: 'unlocked-not-pulled',
        course: COURSE,
        offeredFor: { path: EXAM_2, due: '2026-09-27' },
      },
    });
    expect(r.calls()).toBe(0);
    expect(await listPaperRecords(r.vault)).toHaveLength(0);
  });

  it('a later assessment outside the window: assessment-passed over the locked state', async () => {
    const r = rig(buildVault({ [EXAM]: '2026-09-22', [EXAM_2]: '2026-10-30' }));
    const offered = await offeredAt(r);
    r.setNow('2026-09-23T12:00:00Z');
    const result = await r.provider.requestPaper(COURSE, offered);
    expect(result.kind).toBe('assessment-passed');
    if (result.kind !== 'assessment-passed') return;
    expect(result.current.kind).toBe('locked');
    expect(r.calls()).toBe(0);
  });

  it('the offered assessment moved later: not passed, so the current state comes back on its own', async () => {
    const r = rig();
    const offered = await offeredAt(r);
    await r.vault.write(EXAM, assessment('2026-10-30'));
    r.setNow('2026-09-23T12:00:00Z');
    const result = await r.provider.requestPaper(COURSE, offered);
    expect(result.kind).toBe('locked');
    expect(r.calls()).toBe(0);
  });

  it('the offered assessment gone from the table: the date she was offered decides', async () => {
    const r = rig();
    const offered = await offeredAt(r);
    r.setNow(AFTER_DUE);
    const result = await r.provider.requestPaper(COURSE, {
      path: '02 Assignments/no-longer-there.md',
      due: offered?.due ?? '',
    });
    expect(result.kind).toBe('assessment-passed');
    expect(r.calls()).toBe(0);
  });

  it('ask again with the offer kept, after the due day: assessment-passed, nothing composed', async () => {
    const r = rig();
    const offered = await offeredAt(r);
    r.setAnswer(() => OUTAGE);
    await expect(r.provider.requestPaper(COURSE, offered)).rejects.toThrow();
    r.setNow(AFTER_DUE);
    r.setAnswer(GENERATED);
    r.resetCalls();
    const result = await r.provider.requestPaper(COURSE, offered);
    expect(result.kind).toBe('assessment-passed');
    expect(r.calls()).toBe(0);
    expect(await listPaperRecords(r.vault)).toHaveLength(0);
  });

  it('while the offered assessment is ahead and the rule fires, the request composes', async () => {
    const r = rig();
    const offered = await offeredAt(r);
    const result = await r.provider.requestPaper(COURSE, offered);
    expect(result.kind).toBe('ready');
    expect(r.calls()).toBeGreaterThan(0);
  });
});

describe('expiry at local midnight, at the request ([D-621], [D-622])', () => {
  /** Offered at `offeredIso`, requested at `requestIso`, in zone `tz`; the request's kind. */
  async function requestedKind(
    tz: string,
    due: string,
    offeredIso: string,
    requestIso: string,
  ): Promise<string> {
    process.env.TZ = tz;
    const r = rig(buildVault({ [EXAM]: due }), offeredIso);
    const offered = await offeredAt(r);
    r.setNow(requestIso);
    const result = await r.provider.requestPaper(COURSE, offered);
    expect(r.calls() === 0).toBe(result.kind !== 'ready');
    return result.kind;
  }

  it('UTC+01:00: offered at local 23:30 on the due day, passed at local 00:30 the day after', async () => {
    // Etc/GMT-1 is UTC+01:00 all year. 2026-09-22T23:30Z is local 00:30 on 09-23; its UTC date is
    // still the due day, so counting on the UTC date would compose.
    expect(new Date('2026-09-22T23:30:00Z').toISOString().slice(0, 10)).toBe('2026-09-22');
    expect(
      await requestedKind(
        'Etc/GMT-1',
        '2026-09-22',
        '2026-09-22T22:30:00Z',
        '2026-09-22T23:30:00Z',
      ),
    ).toBe('assessment-passed');
  });

  it('Europe/London, the spring change: due 03-29, offered at local 23:30 BST, passed at local 00:30 on 03-30', async () => {
    // 2026-03-29T22:30Z is local 23:30 BST on 03-29; 2026-03-29T23:30Z is local 00:30 BST on 03-30,
    // whose UTC date is still 03-29.
    expect(
      await requestedKind(
        'Europe/London',
        '2026-03-29',
        '2026-03-29T22:30:00Z',
        '2026-03-29T23:30:00Z',
      ),
    ).toBe('assessment-passed');
  });

  it('America/Santiago, the repeated hour: due 04-04, offered at the second local 23:30, passed at local 00:30 on 04-05', async () => {
    // At local 24:00 on 2026-04-04 the clock goes back to 23:00 (UTC-3 to UTC-4).
    // 2026-04-05T03:30Z is the second local 23:30 on 04-04 (UTC-4); 2026-04-05T04:30Z is local 00:30
    // on 04-05.
    expect(
      await requestedKind(
        'America/Santiago',
        '2026-04-04',
        '2026-04-05T03:30:00Z',
        '2026-04-05T04:30:00Z',
      ),
    ).toBe('assessment-passed');
  });

  it('the due day itself is not passed: offered and requested at local 23:30 on the due day composes', async () => {
    expect(
      await requestedKind(
        'Etc/GMT-1',
        '2026-09-22',
        '2026-09-22T12:00:00Z',
        '2026-09-22T22:30:00Z',
      ),
    ).toBe('ready');
  });
});
