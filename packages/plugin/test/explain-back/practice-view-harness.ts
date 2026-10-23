/**
 * A small DOM stand-in and an opener for `ExplainBackModal`, for the v0.9 practice-view specs
 * (`practice-view.spec.ts`, `practice-no-grading.spec.ts`; `ol-egov.141.89.6.129`).
 *
 * `modal.ts` extends Obsidian's `Modal`, which cannot load under Vitest, so each spec mocks
 * `obsidian` with a `Modal` whose `contentEl` is a {@link FakeEl} (the factory imports this
 * module) and whose `close()` calls `onClose()`, as Obsidian's does. The view then renders for
 * real into the stand-in, and a spec reads what she would see off it: texts in order, buttons,
 * classes, and whether any field takes input.
 *
 * Structural placeholders throughout (INV-3): coined concepts, notes and passages.
 */

import type { ExplainBackSourceBlock } from '../../src/explain-back/request.js';
import type { ReviewInstrument } from '../../src/review/types.js';

interface FakeElOptions {
  readonly cls?: string;
  readonly text?: string;
  readonly type?: string;
  readonly attr?: Readonly<Record<string, string>>;
}

export class FakeEl {
  readonly tag: string;
  readonly classes: string[] = [];
  text = '';
  value = '';
  readonly attr: Record<string, string> = {};
  children: FakeEl[] = [];
  private readonly listeners = new Map<string, Array<() => void>>();

  constructor(tag: string, options: FakeElOptions = {}) {
    this.tag = tag;
    if (options.cls !== undefined) this.classes.push(...options.cls.split(/\s+/).filter(Boolean));
    if (options.text !== undefined) this.text = options.text;
    if (options.type !== undefined) this.attr.type = options.type;
    Object.assign(this.attr, options.attr ?? {});
  }

  createEl(tag: string, options?: FakeElOptions): FakeEl {
    const el = new FakeEl(tag, options);
    this.children.push(el);
    return el;
  }

  createDiv(options?: FakeElOptions): FakeEl {
    return this.createEl('div', options);
  }

  createSpan(options?: FakeElOptions): FakeEl {
    return this.createEl('span', options);
  }

  appendChild(child: unknown): unknown {
    if (child instanceof FakeEl) this.children.push(child);
    return child;
  }

  addEventListener(type: string, listener: () => void): void {
    this.listeners.set(type, [...(this.listeners.get(type) ?? []), listener]);
  }

  empty(): void {
    this.children = [];
    this.text = '';
  }

  addClass(cls: string): void {
    if (!this.classes.includes(cls)) this.classes.push(cls);
  }

  setText(text: string): void {
    this.text = text;
  }

  click(): void {
    for (const listener of this.listeners.get('click') ?? []) listener();
  }

  /** This element and every descendant, in document order. */
  all(): FakeEl[] {
    return [this, ...this.children.flatMap((child) => child.all())];
  }

  /** Every non-empty text, in document order. */
  texts(): string[] {
    return this.all()
      .map((el) => el.text)
      .filter((text) => text !== '');
  }

  /** Every class anywhere in the tree. */
  allClasses(): string[] {
    return this.all().flatMap((el) => el.classes);
  }

  withClass(cls: string): FakeEl[] {
    return this.all().filter((el) => el.classes.includes(cls));
  }

  buttons(): FakeEl[] {
    return this.all().filter((el) => el.tag === 'button');
  }

  buttonLabels(): string[] {
    return this.buttons().map((button) => button.text);
  }

  button(label: string): FakeEl {
    const found = this.buttons().find((button) => button.text === label);
    if (found === undefined) {
      throw new Error(`no "${label}" button; buttons: ${JSON.stringify(this.buttonLabels())}`);
    }
    return found;
  }

  /** Every element she could type into. */
  fields(): FakeEl[] {
    return this.all().filter((el) => el.tag === 'textarea' || el.tag === 'input');
  }
}

/** What the mocked `obsidian` exports to `modal.ts`. */
export function fakeObsidian() {
  return {
    Modal: class {
      readonly contentEl = new FakeEl('div');
      readonly titleEl = new FakeEl('div');
      constructor(readonly app: unknown) {}
      open(): void {
        (this as unknown as { onOpen: () => void }).onOpen();
      }
      close(): void {
        (this as unknown as { onClose: () => void }).onClose();
      }
    },
  };
}

export const NOW = new Date('2026-10-20T14:00:00Z');

export const SUBJECT_KEY = 'concept-a';
export const NEIGHBOUR_KEY = 'concept-b';
export const SUBJECT_NAME = 'Concept Alpha';
export const NEIGHBOUR_NAME = 'Concept Beta';

export function passage(path: string, index: number, text: string): ExplainBackSourceBlock {
  return { block: { blockId: `${path}#${index}#0`, text }, path, blockIndex: index };
}

export const SUBJECT_PASSAGES: readonly ExplainBackSourceBlock[] = [
  passage('notes/alpha.md', 0, 'Alpha drives the first coined process.'),
  passage('notes/alpha.md', 1, 'Alpha is measured by the coined rate.'),
];
export const NEIGHBOUR_PASSAGES: readonly ExplainBackSourceBlock[] = [
  passage('notes/beta.md', 0, 'Beta follows from a raised coined rate.'),
];
export const EDGE_PASSAGES: readonly ExplainBackSourceBlock[] = [
  passage('notes/link.md', 0, 'A higher coined rate brings Beta about.'),
  passage('notes/link.md', 1, 'Beta is the outcome the coined rate leads to.'),
];

export const INSTRUMENT: ReviewInstrument = {
  instrumentId: 'qa:concept-a:1',
  conceptIds: [SUBJECT_KEY],
  courseCode: 'syn:course:a',
  noteTitle: 'Week 1',
  sourcePath: 'notes/alpha.md',
  blockId: null,
  draftId: null,
  type: 'qa',
  question: 'What does Alpha drive?',
  answer: 'The first coined process.',
} as ReviewInstrument;

/** A live causes partner for the subject: the edge, the neighbour by key and wording, and the subject's wording. */
export function relationPartner() {
  return {
    edge: {
      type: 'causes' as const,
      from: SUBJECT_NAME,
      to: NEIGHBOUR_NAME,
      provenance: 'model-proposed' as const,
      confidence: 0.9,
      introducingPassages: {
        from: { sourcePath: 'notes/link.md', location: { kind: 'block', index: 0 } },
        to: { sourcePath: 'notes/link.md', location: { kind: 'block', index: 1 } },
      },
    } as never,
    neighbourConceptId: NEIGHBOUR_KEY,
    neighbourName: NEIGHBOUR_NAME,
    subjectName: SUBJECT_NAME,
  };
}

/** The edge passage a provenance names, by the index its fake location carries. */
export async function introducingPassageFor(provenance: {
  readonly location: unknown;
}): Promise<ExplainBackSourceBlock | null> {
  const index = (provenance.location as { index: number }).index;
  return EDGE_PASSAGES[index] ?? null;
}

/** Retrieval: the neighbour's wording finds the neighbour's passages; anything else the subject's. */
export async function retrieveFor(query: string): Promise<readonly ExplainBackSourceBlock[]> {
  return query === NEIGHBOUR_NAME ? NEIGHBOUR_PASSAGES : SUBJECT_PASSAGES;
}

/** The view's private state and the two internals a spec reaches for. */
export interface ViewInternals {
  readonly state: {
    readonly phase: string;
    readonly attemptId?: string;
    readonly answer?: string;
    readonly durationMs?: number | null;
  };
  render: () => void;
  readonly contentEl: FakeEl;
  onOpen: () => void;
  onClose: () => void;
}

/** Types an answer into the answering phase's textarea and chooses "Show the passages". */
export function submit(root: FakeEl, answer: string, submitLabel: string): void {
  const [textarea] = root.fields().filter((el) => el.tag === 'textarea');
  if (textarea === undefined) throw new Error('no answer box on screen');
  textarea.value = answer;
  root.button(submitLabel).click();
}
