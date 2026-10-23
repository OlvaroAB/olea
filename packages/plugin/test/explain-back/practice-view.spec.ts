/**
 * `[D-603]`, `[D-611]`, `[D-614]` (`ol-egov.141.89.6.129`): in v0.9 the explain-back view is
 * ungraded practice. After an answer it shows her explanation, the supporting passages the prompt
 * already carries under "From your notes", the reflection prompts for the prompt's shape (no
 * answer field), and "Done" and "Try again" — and nothing that grades.
 *
 * Scenarios: `features/F5-explain-it-back.md` (olea-service), "F5.2 / F5.3 / F5.4 / [D-603],
 * [D-611] — after an answer, the view shows the supporting passages and the reflection prompts,
 * and nothing that grades" (every scenario tagged `plugin/explain-back/practice-view.spec`).
 *
 * Behavioural: the real `ExplainBackModal` renders into `./practice-view-harness.ts`'s DOM
 * stand-in, with `obsidian` mocked (it cannot load under Vitest). Coined concepts and passages
 * only (INV-3).
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { digestPassage } from 'olea-core';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  EXPLAIN_BACK_DISCARD_LABEL,
  EXPLAIN_BACK_DONE_LABEL,
  EXPLAIN_BACK_PASSAGES_HEADING,
  EXPLAIN_BACK_PRACTICE_NOTICE,
  EXPLAIN_BACK_REFLECTION_ADD_OR_REPHRASE,
  EXPLAIN_BACK_REFLECTION_READ_ALONGSIDE,
  EXPLAIN_BACK_SUBMIT_LABEL,
  explainBackReflectionPrompts,
} from '../../src/explain-back/copy.js';
import type { ViewPracticeExplanationInput } from '../../src/explain-back/practice-record.js';
import { EXPLAIN_BACK_SKIP_LABEL } from '../../src/explain-back/skip.js';
import { isoWithLocalOffset } from '../../src/review/ports.js';
import {
  EDGE_PASSAGES,
  type FakeEl,
  INSTRUMENT,
  introducingPassageFor,
  NEIGHBOUR_NAME,
  NEIGHBOUR_PASSAGES,
  NOW,
  relationPartner,
  retrieveFor,
  SUBJECT_KEY,
  SUBJECT_NAME,
  SUBJECT_PASSAGES,
  submit,
  type ViewInternals,
} from './practice-view-harness.js';

vi.mock('obsidian', async () => (await import('./practice-view-harness.js')).fakeObsidian());
vi.mock('../../src/sprig/render-sprig.js', async () => {
  const { FakeEl } = await import('./practice-view-harness.js');
  return { renderSprig: () => new FakeEl('svg') };
});

// The first import of the view (and `olea-core` behind it) can outlast a test's own timeout on a
// loaded machine; it is made once, here, so each test times only its own work.
beforeAll(async () => {
  await import('../../src/explain-back/modal.js');
}, 120_000);

const CONCEPT_PROMPTS = [
  EXPLAIN_BACK_REFLECTION_READ_ALONGSIDE,
  EXPLAIN_BACK_REFLECTION_ADD_OR_REPHRASE,
] as const;
const RELATION_PROMPT = `What do these passages say links ${SUBJECT_NAME} and ${NEIGHBOUR_NAME}?`;

/** Every string any graded path ever printed on this view, and the classes it drew them with. */
const GRADED_STRINGS = [
  'You explained this',
  "What your notes cover that this didn't",
  'Worth a closer look',
  "That's the first time this concept has been explained at full depth.",
  'Keep this',
  'Check this',
  'Checking against your notes…',
  'See in registry',
  'holds up',
];
const GRADED_CLASSES = [
  'olea-explain-back-outcome',
  'olea-explain-back-encouragement',
  'olea-explain-back-feedback',
  'olea-explain-back-region',
  'olea-explain-back-region-omission',
  'olea-explain-back-region-confusion',
  'olea-explain-back-region-covered',
  'olea-explain-back-registry-action',
];
/** Words that would say whether, or how far, her explanation matches the passages. */
const JUDGING_WORDS =
  /\b(correct|incorrect|partial|right|wrong|missed|missing|matches|depth|verdict|score|gap|well done|good job)\b/i;

interface Opened {
  readonly modal: ViewInternals;
  readonly root: FakeEl;
  readonly practice: ReturnType<typeof vi.fn>;
  readonly marker: ReturnType<typeof vi.fn>;
  readonly retrieve: ReturnType<typeof vi.fn>;
  /** Every text and class each render drew, in order, so a path is checked as she saw it. */
  readonly drawn: { texts: string[]; classes: string[]; phases: string[] };
}

async function openView(
  options: {
    readonly seed?: 'concept' | 'relation' | 'freeform';
    readonly topicMatch?: 'unique' | 'none';
    readonly marker?: (input: unknown) => Promise<void>;
    readonly passages?: readonly (typeof SUBJECT_PASSAGES)[number][];
  } = {},
): Promise<Opened> {
  const { ExplainBackModal } = await import('../../src/explain-back/modal.js');
  const seed = options.seed ?? 'concept';
  const ids = ['attempt-1', 'attempt-2', 'attempt-3', 'attempt-4'];
  let clock = NOW.getTime();
  const practice = vi.fn(async (input: ViewPracticeExplanationInput) => ({
    written: true as const,
    record: { attemptId: input.attemptId } as never,
    path: '.olea/reviews/x.jsonl' as never,
    contentId: 'content-1',
  }));
  const marker = vi.fn(options.marker ?? (async () => {}));
  const retrieve = vi.fn(async (query: string) => options.passages ?? (await retrieveFor(query)));
  const modal = new ExplainBackModal(
    {} as never,
    {
      retrieveSourceBlocks: retrieve,
      generateInstrumentId: () => ids.shift() ?? 'extra',
      now: () => {
        clock += 1000;
        return new Date(clock);
      },
      recordFeedbackShown: marker,
      recordPracticeExplanation: practice,
      ...(seed === 'relation'
        ? {
            resolveCausesPartner: (subject: string) =>
              subject === SUBJECT_KEY ? relationPartner() : undefined,
            resolveIntroducingPassage: introducingPassageFor,
          }
        : {}),
      ...(seed === 'freeform' && options.topicMatch === 'unique'
        ? {
            matchFreeformTopicConcept: () => ({ kind: 'unique' as const, conceptId: SUBJECT_KEY }),
          }
        : {}),
    },
    seed === 'freeform' ? { kind: 'freeform' } : { kind: 'instrument', instrument: INSTRUMENT },
  ) as unknown as ViewInternals;
  const drawn = { texts: [] as string[], classes: [] as string[], phases: [] as string[] };
  const render = modal.render.bind(modal);
  modal.render = () => {
    render();
    drawn.phases.push(modal.state.phase);
    drawn.texts.push(...modal.contentEl.texts());
    drawn.classes.push(...modal.contentEl.allClasses());
  };
  modal.onOpen();
  if (seed === 'freeform') {
    const topic = modal.contentEl.fields()[0];
    if (topic === undefined) throw new Error('no topic field');
    topic.value = 'the coined process';
    modal.contentEl.button('Continue').click();
  }
  await vi.waitFor(() => expect(modal.state.phase).toBe('answering'));
  return { modal, root: modal.contentEl, practice, marker, retrieve, drawn };
}

async function answer(opened: Opened, text: string): Promise<void> {
  submit(opened.root, text, EXPLAIN_BACK_SUBMIT_LABEL);
  await vi.waitFor(() => expect(opened.modal.state.phase).toBe('passages'));
}

/** The reflection prompts as drawn: the texts after the last passage and before the end controls. */
function reflectionPromptsOn(root: FakeEl): string[] {
  return root
    .all()
    .filter((el) => el.tag === 'p' && el.classes.length === 0)
    .map((el) => el.text)
    .filter(
      (text) =>
        text.length > 0 &&
        (CONCEPT_PROMPTS as readonly string[]).concat(RELATION_PROMPT).includes(text),
    );
}

function passageTextsOn(root: FakeEl): string[] {
  return root
    .withClass('olea-explain-back-item')
    .flatMap((row) => row.withClass('olea-explain-back-item-text'))
    .map((el) => el.text);
}

let consoleError: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => {
  consoleError.mockRestore();
});

describe('after an answer to a concept prompt, the concept’s passages and then its two reflection prompts', () => {
  it('shows her explanation, then "From your notes" over the passages the prompt carries, then the two prompts', async () => {
    const opened = await openView();
    await answer(opened, 'Alpha drives a process.\nIt is measured by a rate.');

    const texts = opened.root.texts();
    const explanationAt = texts.indexOf('Alpha drives a process.');
    const headingAt = texts.indexOf(EXPLAIN_BACK_PASSAGES_HEADING);
    expect(explanationAt).toBeGreaterThan(-1);
    expect(texts).toContain('It is measured by a rate.');
    expect(headingAt).toBeGreaterThan(explanationAt);
    expect(passageTextsOn(opened.root)).toEqual(SUBJECT_PASSAGES.map((p) => p.block.text));
    const lastPassageAt = texts.lastIndexOf(SUBJECT_PASSAGES[1]?.block.text ?? '');
    expect(lastPassageAt).toBeGreaterThan(headingAt);
    expect(reflectionPromptsOn(opened.root)).toEqual([...CONCEPT_PROMPTS]);
    expect(texts.indexOf(EXPLAIN_BACK_REFLECTION_READ_ALONGSIDE)).toBeGreaterThan(lastPassageAt);
  });

  it('each passage carries its note’s label, never an invented source', async () => {
    const opened = await openView();
    await answer(opened, 'An answer.');
    const cites = opened.root.withClass('olea-explain-back-cite').map((el) => el.text);
    expect(cites).toEqual(['alpha', 'alpha']);
  });

  it('the passages are the ones the prompt already carries: nothing is searched after she submits', async () => {
    const opened = await openView();
    const lookupsAtOpen = opened.retrieve.mock.calls.length;
    await answer(opened, 'An answer.');
    expect(opened.retrieve.mock.calls.length).toBe(lookupsAtOpen);
  });

  it('no reflection prompt has an answer field: nothing on the passages phase takes input', async () => {
    const opened = await openView();
    await answer(opened, 'An answer.');
    expect(opened.root.fields()).toEqual([]);
  });
});

describe('after an answer to a relation prompt, the relation’s passages and then its three reflection prompts', () => {
  it('shows the subject’s defining passages, the edge’s own provenance passages and the neighbour’s defining passages', async () => {
    const opened = await openView({ seed: 'relation' });
    await answer(opened, 'Alpha raises the rate, and Beta follows.');

    const shown = passageTextsOn(opened.root);
    const expected = [...SUBJECT_PASSAGES, ...EDGE_PASSAGES, ...NEIGHBOUR_PASSAGES].map(
      (p) => p.block.text,
    );
    expect([...shown].sort()).toEqual([...expected].sort());
    expect(new Set(shown).size).toBe(shown.length);
  });

  it('below them, the two concept prompts and the relation’s, naming both concepts, with no answer field', async () => {
    const opened = await openView({ seed: 'relation' });
    await answer(opened, 'An answer.');
    expect(reflectionPromptsOn(opened.root)).toEqual([...CONCEPT_PROMPTS, RELATION_PROMPT]);
    expect(opened.root.fields()).toEqual([]);
  });
});

describe('the reflection prompts are the same whatever she wrote', () => {
  it('a long, careful answer and a single sentence are followed by the identical prompts', async () => {
    const long = await openView();
    await answer(
      long,
      'Alpha drives the first coined process because the coined rate rises, and that rise is what the process depends on, step by step.',
    );
    const short = await openView();
    await answer(short, 'Alpha does it.');
    expect(reflectionPromptsOn(long.root)).toEqual(reflectionPromptsOn(short.root));
  });

  it('no prompt asserts a gap, an error or a judgment of adequacy, or supplies an answer', () => {
    for (const shape of [
      { kind: 'concept' } as const,
      { kind: 'relation', concept: SUBJECT_NAME, neighbour: NEIGHBOUR_NAME } as const,
    ]) {
      for (const prompt of explainBackReflectionPrompts(shape)) {
        expect(prompt).not.toMatch(JUDGING_WORDS);
        for (const p of SUBJECT_PASSAGES) expect(prompt).not.toContain(p.block.text);
        expect(prompt).not.toContain('The first coined process.');
      }
    }
  });
});

describe('the submit control reads "Show the passages", with no wait line', () => {
  it('the answering phase’s submit control is "Show the passages"', async () => {
    const opened = await openView();
    expect(opened.root.buttonLabels()).toContain('Show the passages');
  });

  it('while the marker is written, her question and explanation stay on screen and no wait line appears', async () => {
    let release: () => void = () => {};
    const opened = await openView({
      marker: () =>
        new Promise<void>((resolve) => {
          release = resolve;
        }),
    });
    submit(opened.root, 'An answer.', EXPLAIN_BACK_SUBMIT_LABEL);
    await vi.waitFor(() => expect(opened.marker).toHaveBeenCalledTimes(1));
    expect(opened.modal.state.phase).toBe('revealing');
    expect(opened.root.texts()).toContain('An answer.');
    expect(opened.root.withClass('olea-explain-back-loading')).toEqual([]);
    expect(opened.root.texts().join(' ')).not.toMatch(/checking|wait|loading/i);
    release();
    await vi.waitFor(() => expect(opened.modal.state.phase).toBe('passages'));
  });
});

describe('the practice notice is on every prompt', () => {
  it.each([
    ['an instrument’s concept prompt', { seed: 'concept' as const }],
    ['an instrument’s relation prompt', { seed: 'relation' as const }],
    [
      'a free-form topic that matched one concept',
      { seed: 'freeform' as const, topicMatch: 'unique' as const },
    ],
    [
      'a free-form topic that matched none',
      { seed: 'freeform' as const, topicMatch: 'none' as const },
    ],
  ])('%s carries the notice while she answers and after', async (_label, options) => {
    const opened = await openView(options);
    expect(opened.root.texts()).toContain(EXPLAIN_BACK_PRACTICE_NOTICE);
    await answer(opened, 'An answer.');
    expect(opened.root.texts()).toContain(EXPLAIN_BACK_PRACTICE_NOTICE);
    // The placeholder practice-only notice it replaces is gone.
    expect(opened.drawn.texts.join(' ')).not.toContain('scored evidence');
  });

  it('the refusal for a free-form topic with nothing to explain against carries it too', async () => {
    const opened = await (async () => {
      const { ExplainBackModal } = await import('../../src/explain-back/modal.js');
      const modal = new ExplainBackModal(
        {} as never,
        { retrieveSourceBlocks: async () => [], generateInstrumentId: () => 'q-1', now: () => NOW },
        { kind: 'freeform' },
      ) as unknown as ViewInternals;
      modal.onOpen();
      const topic = modal.contentEl.fields()[0];
      if (topic === undefined) throw new Error('no topic field');
      topic.value = 'an unindexed topic';
      modal.contentEl.button('Continue').click();
      await vi.waitFor(() => expect(modal.state.phase).toBe('refused'));
      return modal;
    })();
    expect(opened.contentEl.texts()).toContain(EXPLAIN_BACK_PRACTICE_NOTICE);
  });
});

describe('the passages end with "Done" and "Try again"', () => {
  it('those are the only controls, and none keeps, accepts or checks a result', async () => {
    const opened = await openView();
    await answer(opened, 'An answer.');
    expect(opened.root.buttonLabels()).toEqual([
      EXPLAIN_BACK_DONE_LABEL,
      EXPLAIN_BACK_DISCARD_LABEL,
    ]);
  });

  it('"Try again" returns to answering with her text still in the field, and the passages gone', async () => {
    const opened = await openView();
    await answer(opened, 'My first answer.');
    opened.root.button(EXPLAIN_BACK_DISCARD_LABEL).click();
    expect(opened.modal.state.phase).toBe('answering');
    const [textarea] = opened.root.fields();
    expect(textarea?.value).toBe('My first answer.');
    expect(opened.root.texts()).not.toContain(EXPLAIN_BACK_PASSAGES_HEADING);
  });

  it('"Done" closes the view', async () => {
    const opened = await openView();
    await answer(opened, 'An answer.');
    opened.root.button(EXPLAIN_BACK_DONE_LABEL).click();
    expect(opened.root.children).toEqual([]);
  });
});

describe('nothing is shown after a skip', () => {
  it('a skip shows no passage, no reflection prompt and no line about the prompt: only the way out', async () => {
    const opened = await openView();
    opened.root.button(EXPLAIN_BACK_SKIP_LABEL).click();
    expect(opened.modal.state.phase).toBe('skipped');
    expect(opened.root.texts()).toEqual([EXPLAIN_BACK_DONE_LABEL]);
    expect(opened.drawn.texts).not.toContain(EXPLAIN_BACK_PASSAGES_HEADING);
    expect(opened.marker).not.toHaveBeenCalled();
    expect(opened.practice).not.toHaveBeenCalled();
  });

  it('a prompt closed without an answer closes with nothing drawn after it', async () => {
    const opened = await openView();
    const drawnBefore = opened.drawn.phases.length;
    opened.modal.onClose();
    expect(opened.root.children).toEqual([]);
    expect(opened.drawn.phases.length).toBe(drawnBefore);
    expect(opened.marker).not.toHaveBeenCalled();
    expect(opened.practice).not.toHaveBeenCalled();
  });
});

describe('no path through the view shows anything that grades', () => {
  const paths: Array<[string, (opened: Opened) => Promise<void>, Parameters<typeof openView>[0]]> =
    [
      ['an answer to a concept prompt', (o) => answer(o, 'An answer.'), { seed: 'concept' }],
      ['an answer to a relation prompt', (o) => answer(o, 'An answer.'), { seed: 'relation' }],
      [
        'a second answer after "Try again"',
        async (o) => {
          await answer(o, 'An answer.');
          o.root.button(EXPLAIN_BACK_DISCARD_LABEL).click();
          await answer(o, 'A second answer.');
        },
        { seed: 'concept' },
      ],
      [
        '"Done"',
        async (o) => {
          await answer(o, 'An answer.');
          o.root.button(EXPLAIN_BACK_DONE_LABEL).click();
        },
        { seed: 'concept' },
      ],
      ['a skip', async (o) => o.root.button(EXPLAIN_BACK_SKIP_LABEL).click(), { seed: 'concept' }],
      ['a prompt closed without an answer', async (o) => o.modal.onClose(), { seed: 'concept' }],
    ];

  it.each(paths)(
    '%s: no depth line, finding, misconception region, follow-up or first-full-depth sentence',
    async (_label, walk, options) => {
      const opened = await openView(options);
      await walk(opened);
      const everything = opened.drawn.texts.join('\n');
      for (const graded of GRADED_STRINGS) expect(everything).not.toContain(graded);
      for (const cls of GRADED_CLASSES) expect(opened.drawn.classes).not.toContain(cls);
      // Nothing says whether, or how far, her explanation matches the passages. Her own words and
      // the passages are hers and her notes'; every other line is the view's.
      const viewsOwn = opened.drawn.texts.filter(
        (text) =>
          !text.includes('answer') &&
          ![...SUBJECT_PASSAGES, ...EDGE_PASSAGES, ...NEIGHBOUR_PASSAGES].some(
            (p) => p.block.text === text,
          ),
      );
      for (const text of viewsOwn) expect(text).not.toMatch(JUDGING_WORDS);
    },
  );
});

describe('the exposure marker is written before the passages render', () => {
  it('the passages render only once the marker write has settled', async () => {
    const events: string[] = [];
    let release: () => void = () => {};
    const opened = await openView({
      marker: () => {
        events.push('write:start');
        return new Promise<void>((resolve) => {
          release = () => {
            events.push('write:settled');
            resolve();
          };
        });
      },
    });
    const render = opened.modal.render;
    opened.modal.render = () => {
      events.push(`render:${opened.modal.state.phase}`);
      render();
    };
    submit(opened.root, 'An answer.', EXPLAIN_BACK_SUBMIT_LABEL);
    await vi.waitFor(() => expect(opened.marker).toHaveBeenCalledTimes(1));
    expect(events).not.toContain('render:passages');
    expect(opened.drawn.texts).not.toContain(EXPLAIN_BACK_PASSAGES_HEADING);
    release();
    await vi.waitFor(() => expect(opened.modal.state.phase).toBe('passages'));
    expect(events).toEqual(['render:revealing', 'write:start', 'write:settled', 'render:passages']);
    expect(opened.marker).toHaveBeenCalledWith({
      timestamp: expect.any(String),
      instrumentId: INSTRUMENT.instrumentId,
      attemptId: 'attempt-1',
    });
  });
});

describe('"Try again" keeps the earlier exposure', () => {
  it('the second answer is a separate attempt whose entry names the passages shown after the first', async () => {
    const opened = await openView();
    await answer(opened, 'My first answer.');
    opened.root.button(EXPLAIN_BACK_DISCARD_LABEL).click();
    await answer(opened, 'My second answer.');
    opened.root.button(EXPLAIN_BACK_DONE_LABEL).click();
    await vi.waitFor(() => expect(opened.practice).toHaveBeenCalledTimes(2));

    const [first, second] = opened.practice.mock.calls.map(
      ([input]) => input as ViewPracticeExplanationInput,
    );
    const digests = await Promise.all(SUBJECT_PASSAGES.map((p) => digestPassage(p.block.text)));
    expect(first?.attemptId).toBe('attempt-1');
    expect(first?.passagesShownInView).toEqual([]);
    expect(second?.attemptId).toBe('attempt-2');
    expect(second?.passagesShownInView).toEqual([
      { attemptId: 'attempt-1', passageFingerprints: digests },
    ]);
    // Nothing of the first exposure is erased: both markers were written, each before its passages.
    expect(
      opened.marker.mock.calls.map(([input]) => (input as { attemptId: string }).attemptId),
    ).toEqual(['attempt-1', 'attempt-2']);
  });

  it('a third answer names both earlier attempts', async () => {
    const opened = await openView();
    await answer(opened, 'One.');
    opened.root.button(EXPLAIN_BACK_DISCARD_LABEL).click();
    await answer(opened, 'Two.');
    opened.root.button(EXPLAIN_BACK_DISCARD_LABEL).click();
    await answer(opened, 'Three.');
    opened.root.button(EXPLAIN_BACK_DONE_LABEL).click();
    await vi.waitFor(() => expect(opened.practice).toHaveBeenCalledTimes(3));
    const third = opened.practice.mock.calls[2]?.[0] as ViewPracticeExplanationInput;
    expect(third.passagesShownInView.map((shown) => shown.attemptId)).toEqual([
      'attempt-1',
      'attempt-2',
    ]);
  });
});

describe('"Done" and "Try again" each write the practice entry', () => {
  it('"Try again" writes the answer it leaves, once, with what the view knows of it', async () => {
    const opened = await openView();
    await answer(opened, 'My answer.');
    opened.root.button(EXPLAIN_BACK_DISCARD_LABEL).click();
    await vi.waitFor(() => expect(opened.practice).toHaveBeenCalledTimes(1));
    const input = opened.practice.mock.calls[0]?.[0] as ViewPracticeExplanationInput;
    expect(input).toEqual({
      timestamp: expect.any(String),
      instrumentId: INSTRUMENT.instrumentId,
      attemptId: 'attempt-1',
      conceptIds: [SUBJECT_KEY],
      promptShape: 'concept',
      durationMs: expect.any(Number),
      answer: 'My answer.',
      passagesShownInView: [],
    });
    // The offer behind the prompt is the composition root's to close over; no flag is invented.
    expect(Object.keys(input)).not.toContain('trigger');
    expect(Object.keys(input)).not.toContain('localCheckFlagged');
  });

  it('"Done" writes the answer it leaves, once, dated when she left it', async () => {
    const opened = await openView({ seed: 'relation' });
    await answer(opened, 'My answer.');
    opened.root.button(EXPLAIN_BACK_DONE_LABEL).click();
    await vi.waitFor(() => expect(opened.practice).toHaveBeenCalledTimes(1));
    const input = opened.practice.mock.calls[0]?.[0] as ViewPracticeExplanationInput;
    expect(input.promptShape).toBe('relation');
    expect(input.attemptId).toBe('attempt-1');
    expect(Date.parse(input.timestamp)).toBeGreaterThan(NOW.getTime());
    expect(input.timestamp).toBe(isoWithLocalOffset(new Date(Date.parse(input.timestamp))));
  });

  it('a second click on the same answer writes nothing more', async () => {
    const opened = await openView();
    await answer(opened, 'My answer.');
    const done = opened.root.button(EXPLAIN_BACK_DONE_LABEL);
    done.click();
    done.click();
    await vi.waitFor(() => expect(opened.practice).toHaveBeenCalledTimes(1));
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(opened.practice).toHaveBeenCalledTimes(1);
  });

  it('a write that fails is never thrown at her, and is logged without content', async () => {
    const opened = await openView();
    opened.practice.mockRejectedValueOnce(new Error('vault refused'));
    await answer(opened, 'My private answer.');
    opened.root.button(EXPLAIN_BACK_DONE_LABEL).click();
    await vi.waitFor(() => expect(consoleError).toHaveBeenCalledTimes(1));
    const logged = JSON.stringify(consoleError.mock.calls[0]?.[0]);
    expect(logged).not.toContain('My private answer.');
    expect(logged).not.toContain('attempt-1');
  });

  it('a free-form topic that matched no concept writes no entry: the record needs a concept', async () => {
    const opened = await openView({ seed: 'freeform', topicMatch: 'none' });
    await answer(opened, 'My answer.');
    opened.root.button(EXPLAIN_BACK_DONE_LABEL).click();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(opened.practice).not.toHaveBeenCalled();
  });

  it('closing the passages without "Done" or "Try again" writes no entry (only those two save it)', async () => {
    const opened = await openView();
    await answer(opened, 'My answer.');
    opened.modal.onClose();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(opened.practice).not.toHaveBeenCalled();
  });
});

describe('an instrument whose lookup found no passage', () => {
  it('is offered as today, and after an answer the same view renders with an empty list', async () => {
    const opened = await openView({ passages: [] });
    await answer(opened, 'An answer.');
    expect(opened.root.texts()).toContain(EXPLAIN_BACK_PASSAGES_HEADING);
    expect(passageTextsOn(opened.root)).toEqual([]);
    expect(reflectionPromptsOn(opened.root)).toEqual([...CONCEPT_PROMPTS]);
  });
});

describe('the production caller wires the practice write (reachability, [D-072])', () => {
  const mainTs = readFileSync(fileURLToPath(new URL('../../src/main.ts', import.meta.url)), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\/.*$/gm, '');

  it('openExplainBackModal hands the view createRecordPracticeExplanation, under the resolved trigger and offer reference', () => {
    expect(mainTs).toMatch(
      /import \{ createRecordPracticeExplanation \} from '\.\/explain-back\/practice-record\.js';/,
    );
    const start = mainTs.indexOf('private openExplainBackModal(');
    const body = mainTs.slice(start, mainTs.indexOf('.open();', start));
    expect(body).toMatch(
      /\.\.\.\(nonAttemptTrigger !== undefined\s*\?\s*\{\s*recordPracticeExplanation: createRecordPracticeExplanation\(\{\s*vault,\s*deviceId: \(\) => ensureDeviceId\(this\),\s*trigger: nonAttemptTrigger,\s*offerEventId: nonAttemptOfferEventId,\s*\}\),\s*\}\s*:\s*\{\}\),/,
    );
  });
});
