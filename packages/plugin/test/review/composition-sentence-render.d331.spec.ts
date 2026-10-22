/**
 * [D-331] / [D-382] (ol-egov.141.89.10.135, discovered from ol-egov.141.89.10.5): the review
 * screen's header is EXECUTED, not source-pinned. While a sitting is open, the first item's
 * composition sentence is the frozen composition's own (read through the same
 * `recordedSessionReason` / `activeSessionGroupingSentence` reads `main.ts` hands `ReviewView`,
 * over the real `StudySessionHolder`), and a fresh composition that would now say something else
 * does not change it. Home's labelled preview is the other half: `test/home/
 * active-session-vs-preview.d382.spec.ts`.
 *
 * Mounting: `view.ts` imports `ItemView` from `obsidian` (not loadable under Vitest), so the
 * module is mocked with a minimal `ItemView` whose `contentEl` is a fake DOM. The real
 * `ReviewView.onOpen` -> `render` -> `renderHeader` run against a stub review session that
 * serves one front-of-card screen at position 1; everything under test (the sentence source and
 * the view code that draws it) is real. Course codes and concept names are invented (INV-3).
 */
import {
  GOVERNING_FRESH_FOR_SECONDS,
  GOVERNING_GOVERNS_FOR_SECONDS,
  type StudyPlanEnvelope,
} from 'olea-contracts';
import { createFsrsScheduler } from 'olea-core';
import { describe, expect, it, vi } from 'vitest';

vi.setConfig({ testTimeout: 30_000 });

class FakeEl {
  text = '';
  cls = '';
  readonly children: FakeEl[] = [];
  readonly ownerDocument = { activeElement: null as unknown };
  constructor(readonly tag: string) {}
  createEl(tag: string, options?: { text?: string; cls?: string }): FakeEl {
    const child = new FakeEl(tag);
    child.text = options?.text ?? '';
    child.cls = options?.cls ?? '';
    this.children.push(child);
    return child;
  }
  createDiv(options?: { text?: string; cls?: string }): FakeEl {
    return this.createEl('div', options);
  }
  createSpan(options?: { text?: string; cls?: string }): FakeEl {
    return this.createEl('span', options);
  }
  addClass(..._cls: string[]): void {}
  setAttr(_name: string, _value: string): void {}
  empty(): void {
    this.children.length = 0;
  }
  contains(_other: unknown): boolean {
    return false;
  }
  /** Text of every descendant carrying `olea-prose`, in document order. */
  proseLines(): string[] {
    return [
      ...(this.cls.split(' ').includes('olea-prose') ? [this.text] : []),
      ...this.children.flatMap((child) => child.proseLines()),
    ];
  }
}

vi.mock('obsidian', () => ({
  ItemView: class {
    contentEl: unknown;
    navigation = true;
    constructor(_leaf: unknown) {
      this.contentEl = (globalThis as { __rootFactory?: () => unknown }).__rootFactory?.();
    }
    registerDomEvent(): void {}
  },
}));

import { sessionCompositionSentence } from '../../src/home/copy.js';
import type { ObsidianDataHost } from '../../src/plan/settings-store.js';
import { STUDY_PLAN_SETTINGS_STORAGE_KEY } from '../../src/plan/settings-store.js';
import type { ReviewSession } from '../../src/review/session.js';
import { ReviewView } from '../../src/review/view.js';
import {
  activeSessionGroupingSentence,
  recordedSessionReason,
} from '../../src/session/composition-recorder.js';
import { createStudySessionHolder } from '../../src/session/holder.js';
import { groupingWhySentence } from '../../src/session-builder/copy.js';
import { composeStudySessionForRequest } from '../../src/session-builder/provider.js';
import { qaFixture } from './fixtures.js';
import { memoryVault } from './memory-vault.js';

const DEVICE = 'olea-testdevice1';
const BASE_PATH = '02 Assignments/Assignments.base';
const NOW = new Date('2026-09-01T09:00:00Z');

class FakeDataHost implements ObsidianDataHost {
  private blob: unknown = {
    [STUDY_PLAN_SETTINGS_STORAGE_KEY]: { version: 1, assignmentsBasePath: BASE_PATH },
  };
  async loadData(): Promise<unknown> {
    return this.blob;
  }
  async saveData(data: unknown): Promise<void> {
    this.blob = data;
  }
}

function courseFiles(course: string, prefix: string, count: number): Record<string, string> {
  const files: Record<string, string> = {};
  const questions: string[] = [];
  for (let i = 0; i < count; i += 1) {
    const name = `${prefix}${i}`;
    files[`05 Zettelkasten/${name}.md`] = `# ${name}\n`;
    files[`Notes/${prefix}-${i}.md`] =
      `---\ntopic: [${name}]\ncourse: ${course}\n---\n\nFront::Back\n`;
    questions.push(
      `## Question ${i + 1} (10 marks)\n\nExplain the core mechanism behind ${name}.\n`,
    );
  }
  files[`03 Research/${course} Past Paper 2023.md`] =
    `---\nrole: past-paper\ncourse: ${course}\n---\n\n# ${course} Past Paper\n\n${questions.join('\n')}`;
  files[`02 Assignments/Quiz ${course}.md`] =
    `---\nclass: ${course}\ntype: Quiz\nweight: 10\ndue: 2026-09-15\nstatus: upcoming\n---\n\n# Quiz\n`;
  return files;
}

const VAULT_FILES = {
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
  ...courseFiles('TESTC101', 'Widget', 6),
  ...courseFiles('TESTC202', 'Gadget', 6),
};

const PLAN: StudyPlanEnvelope = {
  envelopeVersion: 1,
  kind: 'study-plan',
  bodyVersion: 1,
  policyVersion: 'sp1-aaaaaaaaaaaaaaaa',
  computedAt: NOW.toISOString(),
  freshForSeconds: GOVERNING_FRESH_FOR_SECONDS,
  governsForSeconds: GOVERNING_GOVERNS_FOR_SECONDS,
  body: {
    asOf: '2026-09-01',
    courses: [],
    allocation: ['TESTC101', 'TESTC202'].map((courseId) => ({
      courseId,
      share: 0.5,
      minBlockSeconds: 1,
      contributions: [{ name: 'risk', value: 0.5 }],
      reason: `${courseId} gets its share.`,
    })),
  },
};

type Request = { budgetMinutes: number; courseOrTopic?: { kind: 'course'; label: string } };
const composed = new Map<string, ReturnType<typeof composeOnce>>();
/** Composition over the vault is the slow step; each distinct request is composed once for the file. */
function composeFor(request: Request) {
  const key = JSON.stringify(request);
  const hit = composed.get(key) ?? composeOnce(request);
  composed.set(key, hit);
  return hit;
}
async function composeOnce(request: Request) {
  const result = await composeStudySessionForRequest(
    {
      vault: memoryVault(VAULT_FILES),
      deviceId: DEVICE,
      settingsHost: new FakeDataHost(),
      now: () => NOW,
      scheduler: createFsrsScheduler(),
      plan: () => PLAN,
    },
    request,
    NOW,
  );
  if (result === null) throw new Error('expected a composed result');
  return result.composed.full;
}

/** A review session serving one front-of-card screen at `position` — the only thing the header reads. */
function stubSession(position: number): ReviewSession {
  const viewModel = {
    phase: 'front',
    instrument: qaFixture({ courseCode: 'TESTC101', noteTitle: 'Widget0' }),
    progress: { position, total: 3 },
  };
  const own: Record<string, unknown> = {
    start: async () => {},
    getViewModel: () => viewModel,
    currentItem: null,
  };
  return new Proxy(own, {
    // every offer/notice getter the view polls answers "nothing pending"
    // (`then` stays undefined: a thenable stub would never resolve when awaited.)
    get: (target, prop) =>
      prop in target ? target[prop as string] : prop === 'then' ? undefined : () => null,
  }) as unknown as ReviewSession;
}

async function mountReview(
  holder: ReturnType<typeof createStudySessionHolder>,
  position = 1,
): Promise<{ view: ReviewView; root: FakeEl }> {
  const root = new FakeEl('root');
  (globalThis as { __rootFactory?: () => unknown }).__rootFactory = () => root;
  // The two thunks are exactly the ones `main.ts` hands the view (main.ts:1343-1345).
  const view = new ReviewView(
    {} as never,
    async () => stubSession(position),
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    () => recordedSessionReason(holder.getSitting()),
    () => activeSessionGroupingSentence(holder.getSitting()),
  );
  await view.onOpen();
  return { view, root };
}

const RENDERED_HEADER = (root: FakeEl) => root.proseLines();

describe('[D-331] the review header renders the open sitting’s frozen composition (executed ReviewView.renderHeader)', () => {
  it('first item: the header’s sentence is the frozen composition’s own, drawn through the shared sentence function', async () => {
    const frozen = await composeFor({ budgetMinutes: 20 });
    expect(frozen.focusReason).toBeDefined();
    const holder = createStudySessionHolder();
    holder.enter(NOW, frozen);
    const { root } = await mountReview(holder);
    expect(RENDERED_HEADER(root)).toEqual([sessionCompositionSentence(frozen.focusReason ?? '')]);
  });

  it('a fresh composition would now say something else (another course asked for), yet the open sitting’s header still shows the frozen sentence', async () => {
    const frozen = await composeFor({ budgetMinutes: 20 });
    const holder = createStudySessionHolder();
    holder.enter(NOW, frozen);
    const frozenSentence = sessionCompositionSentence(frozen.focusReason ?? '');

    // What a recomposition would say now: the other course, asked for by name.
    const fresh = await composeFor({
      budgetMinutes: 20,
      courseOrTopic: { kind: 'course', label: 'TESTC202' },
    });
    const freshSentence = sessionCompositionSentence(fresh.focusReason ?? '');
    expect(freshSentence).not.toBe(frozenSentence);
    expect(freshSentence).toContain('TESTC202');

    // Re-render (a second open of the same view over the same sitting).
    const { root } = await mountReview(holder);
    expect(RENDERED_HEADER(root)).toEqual([frozenSentence]);
    expect(RENDERED_HEADER(root).join('\n')).not.toContain('TESTC202');
  });

  it('[D-421] the frozen grouping sentence renders beside the course sentence, as written', async () => {
    const frozen = await composeFor({ budgetMinutes: 20 });
    const holder = createStudySessionHolder();
    holder.enter(NOW, { ...frozen, groupingSignal: 'relatedness' });
    const { root } = await mountReview(holder);
    expect(RENDERED_HEADER(root)).toEqual([
      sessionCompositionSentence(frozen.focusReason ?? ''),
      groupingWhySentence('relatedness') ?? '',
    ]);
  });

  it('said once: from the second item on, the header draws no composition sentence', async () => {
    const holder = createStudySessionHolder();
    holder.enter(NOW, await composeFor({ budgetMinutes: 20 }));
    const { root } = await mountReview(holder, 2);
    expect(RENDERED_HEADER(root)).toEqual([]);
  });

  it('no sitting open: the header draws no sentence (honest absence, nothing stale)', async () => {
    const holder = createStudySessionHolder();
    holder.enter(NOW, await composeFor({ budgetMinutes: 20 }));
    holder.exit();
    const { root } = await mountReview(holder);
    expect(RENDERED_HEADER(root)).toEqual([]);
  });
});
