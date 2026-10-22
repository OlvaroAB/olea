/**
 * [D-382] / [D-331] (ol-egov.141.89.10.135, discovered from ol-egov.141.89.10.5): Home's
 * active-session block is EXECUTED, not source-pinned, and the exemption is shown as behaviour.
 * While a sitting is open, `HomeView.renderActiveSession` states the frozen composition's own
 * sentence, and the ordinary offer card below it is relabelled 'Next session' (the future-session
 * preview). The preview is exempt from matching the active sentence: after steering changes, the
 * preview says the new thing under its label while the active block keeps the frozen one. The
 * two are never asserted to agree.
 *
 * Mounting: `view.ts` imports `ItemView` from `obsidian` (not loadable under Vitest), so the
 * module is mocked with a minimal `ItemView` over a fake DOM. The state fed to the real
 * `HomeView` comes from the real `createLocalHomeProvider` over the real `StudySessionHolder`,
 * so the frozen sentence and the preview sentence are each produced by the production code that
 * produces them. Course codes and concept names are invented (INV-3).
 */
import { createFsrsScheduler } from 'olea-core';
import { describe, expect, it, vi } from 'vitest';

vi.setConfig({ testTimeout: 30_000 });

class FakeEl {
  text = '';
  cls = '';
  value = '';
  readonly children: FakeEl[] = [];
  readonly style: Record<string, string> = {};
  readonly classList = {
    add: (..._c: string[]): void => {},
    remove: (..._c: string[]): void => {},
  };
  readonly ownerDocument = { createElementNS: (_ns: string, tag: string) => fakeEl(tag) };
  constructor(readonly tag: string) {}
  createEl(tag: string, options?: { text?: string; cls?: string; value?: string }): FakeEl {
    const child = fakeEl(tag);
    child.text = options?.text ?? '';
    child.cls = options?.cls ?? '';
    child.value = options?.value ?? '';
    this.children.push(child);
    return child;
  }
  createDiv(options?: { text?: string; cls?: string }): FakeEl {
    return this.createEl('div', options);
  }
  createSpan(options?: { text?: string; cls?: string }): FakeEl {
    return this.createEl('span', options);
  }
  empty(): void {
    this.children.length = 0;
  }
  /** Every descendant (and this element) with the given class token, in document order. */
  withClass(token: string): FakeEl[] {
    return [
      ...(this.cls.split(' ').includes(token) ? [this] : []),
      ...this.children.flatMap((child) => child.withClass(token)),
    ];
  }
}

/** Any DOM method the view calls that this fake does not model is a harmless no-op. */
function fakeEl(tag: string): FakeEl {
  return new Proxy(new FakeEl(tag), {
    get: (target, prop, receiver) =>
      prop in target || typeof prop === 'symbol' || prop === 'then'
        ? Reflect.get(target, prop, receiver)
        : () => undefined,
  });
}

vi.mock('obsidian', () => ({
  ItemView: class {
    contentEl: unknown;
    constructor(_leaf: unknown) {
      this.contentEl = (globalThis as { __rootFactory?: () => unknown }).__rootFactory?.();
    }
  },
}));

import {
  GOVERNING_FRESH_FOR_SECONDS,
  GOVERNING_GOVERNS_FOR_SECONDS,
  type StudyPlanEnvelope,
} from 'olea-contracts';
import {
  HOME_NEXT_SESSION_EYEBROW,
  HOME_OFFER_EYEBROW,
  sessionCompositionSentence,
} from '../../src/home/copy.js';
import { createLocalHomeProvider } from '../../src/home/provider.js';
import { HomeView, type HomeViewDeps } from '../../src/home/view.js';
import type { ObsidianDataHost } from '../../src/plan/settings-store.js';
import { STUDY_PLAN_SETTINGS_STORAGE_KEY } from '../../src/plan/settings-store.js';
import { createStudySessionHolder } from '../../src/session/holder.js';
import { groupingWhySentence } from '../../src/session-builder/copy.js';
import { composeStudySessionForRequest } from '../../src/session-builder/provider.js';
import { memoryVault } from '../review/memory-vault.js';

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

const REQUEST = { budgetMinutes: 20 };
const ASKED_FOR_TESTC202 = {
  budgetMinutes: 20,
  courseOrTopic: { kind: 'course' as const, label: 'TESTC202' },
};

function planFavouring(course: string): StudyPlanEnvelope {
  return {
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
      allocation: [
        {
          courseId: course,
          share: 1,
          minBlockSeconds: 1,
          contributions: [{ name: 'risk', value: 0.5 }],
          reason: `${course} gets its share.`,
        },
      ],
    },
  };
}

const vault = memoryVault(VAULT_FILES);
const settingsHost = new FakeDataHost();
const deps = {
  vault,
  deviceId: DEVICE,
  settingsHost,
  now: () => NOW,
  scheduler: createFsrsScheduler(),
};

/** The frozen composition of the sitting: Start was pressed with nothing steered. */
async function frozenAtStart() {
  const result = await composeStudySessionForRequest(
    { ...deps, plan: () => planFavouring('TESTC101') },
    REQUEST,
    NOW,
  );
  if (result === null) throw new Error('expected a composed result');
  return result.composed.full;
}

function mountHome(
  holder: ReturnType<typeof createStudySessionHolder>,
  plan?: () => StudyPlanEnvelope | null,
) {
  const provider = createLocalHomeProvider({
    ...deps,
    studySessionHolder: holder,
    ...(plan !== undefined ? { plan } : {}),
  });
  const root = fakeEl('root');
  (globalThis as { __rootFactory?: () => unknown }).__rootFactory = () => root;
  const viewDeps: HomeViewDeps = {
    load: (request: Parameters<typeof provider.load>[0]) => provider.load(request),
    openRetrospective: () => {},
    startSession: () => {},
    openGrove: () => {},
    dismiss: async () => {},
  } as unknown as HomeViewDeps;
  const view = new HomeView({} as never, viewDeps);
  return { view, root };
}

/** The active-session block's eyebrow-and-prose, and the offer card's, as the screen shows them. */
function cards(root: FakeEl) {
  const all = root.withClass('olea-card');
  const byEyebrow = (label: string) =>
    all.find((card) => card.withClass('olea-eyebrow').some((e) => e.text === label));
  const linesOf = (card: FakeEl | undefined) =>
    card?.withClass('olea-home-offer-reason-line').map((line) => line.text) ?? [];
  return {
    active: byEyebrow(HOME_OFFER_EYEBROW),
    preview: byEyebrow(HOME_NEXT_SESSION_EYEBROW),
    activeLines: linesOf(byEyebrow(HOME_OFFER_EYEBROW)),
    previewLines: linesOf(byEyebrow(HOME_NEXT_SESSION_EYEBROW)),
  };
}

describe('[D-382]/[D-331] Home with a sitting open (executed HomeView.renderActiveSession and renderOffer)', () => {
  it('the active-session block states the frozen composition’s sentence, and the preview card beneath it carries its own Next session label', async () => {
    const frozen = await frozenAtStart();
    expect(frozen.focusReason).toBeDefined();
    const holder = createStudySessionHolder();
    holder.enter(NOW, frozen);
    const { view, root } = mountHome(holder, () => planFavouring('TESTC101'));
    await view.onOpen();

    const { active, preview, activeLines } = cards(root);
    expect(active).toBeDefined();
    expect(preview).toBeDefined();
    expect(activeLines).toContain(sessionCompositionSentence(frozen.focusReason ?? ''));
    // The active block is the one whose label is the ordinary offer label; the preview is relabelled.
    expect(root.withClass('olea-eyebrow').map((e) => e.text)).toEqual(
      expect.arrayContaining([HOME_OFFER_EYEBROW, HOME_NEXT_SESSION_EYEBROW]),
    );
  });

  it('[D-421] the frozen grouping sentence sits beside the course sentence in the active block only', async () => {
    const frozen = await frozenAtStart();
    const holder = createStudySessionHolder();
    holder.enter(NOW, { ...frozen, groupingSignal: 'relatedness' });
    const { view, root } = mountHome(holder, () => planFavouring('TESTC101'));
    await view.onOpen();
    const { activeLines } = cards(root);
    expect(activeLines).toEqual([
      sessionCompositionSentence(frozen.focusReason ?? ''),
      groupingWhySentence('relatedness'),
    ]);
  });

  it('steering changes after Start: the preview says the new sentence under Next session, the active block keeps the frozen one, and the two differ', async () => {
    const frozen = await frozenAtStart();
    const frozenSentence = sessionCompositionSentence(frozen.focusReason ?? '');
    const holder = createStudySessionHolder();
    holder.enter(NOW, frozen);
    const { view, root } = mountHome(holder, () => planFavouring('TESTC101'));
    await view.onOpen();
    const before = cards(root);
    expect(before.activeLines).toContain(frozenSentence);
    // Unsteered, the preview composes the same thing the sitting was started on.
    expect(before.previewLines.join('\n')).toContain('TESTC101');

    // She asks for the other course on Home (the course-or-topic steering input). The view holds
    // it as sticky state and `refresh()` re-previews over it; the sitting is untouched.
    (view as unknown as { courseOrTopic: unknown }).courseOrTopic =
      ASKED_FOR_TESTC202.courseOrTopic;
    await view.refresh();

    const after = cards(root);
    // What the steered composition itself says (the same composer Start would sit).
    const steered = await composeStudySessionForRequest(
      { ...deps, plan: () => planFavouring('TESTC101') },
      ASKED_FOR_TESTC202,
      NOW,
    );
    if (steered === null) throw new Error('expected a composed result');
    const previewSentence = sessionCompositionSentence(steered.composed.full.focusReason ?? '');
    expect(previewSentence).toContain('TESTC202');
    expect(after.previewLines).toContain(previewSentence);
    expect(after.previewLines).not.toContain(frozenSentence);
    expect(after.activeLines).toEqual([frozenSentence]);
    expect(after.activeLines).not.toContain(previewSentence);
    expect(previewSentence).not.toBe(frozenSentence);
    expect(holder.getSitting().status).toBe('active');
  });

  it('no sitting open: no active block, and the offer card keeps its ordinary label', async () => {
    const holder = createStudySessionHolder();
    const { view, root } = mountHome(holder);
    await view.onOpen();
    const eyebrows = root.withClass('olea-eyebrow').map((e) => e.text);
    expect(eyebrows).toContain(HOME_OFFER_EYEBROW);
    expect(eyebrows).not.toContain(HOME_NEXT_SESSION_EYEBROW);
  });
});
