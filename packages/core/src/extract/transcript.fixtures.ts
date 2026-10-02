/**
 * Synthetic transcript fixtures and an in-memory vault for the transcript
 * specs (`ol-egov.141.89.8.49`). An invented "course A", invented sentences:
 * nothing here is real course or vault content (the repository is public).
 */

import type { ListOptions, Unsubscribe, VaultPath, VaultSource } from '../vault/types.js';

export class MemoryVault implements VaultSource {
  readonly writes: string[] = [];
  private readonly files = new Map<string, string>();

  constructor(entries: Record<string, string>) {
    for (const [path, content] of Object.entries(entries)) this.files.set(path, content);
  }

  async list(options: ListOptions = {}): Promise<readonly VaultPath[]> {
    const under = options.under;
    return [...this.files.keys()]
      .filter((p) => under === undefined || p === under || p.startsWith(`${under}/`))
      .sort();
  }

  async read(path: VaultPath): Promise<string> {
    const text = this.files.get(path);
    if (text === undefined) throw new Error(`not found: ${path}`);
    return text;
  }

  async readBinary(path: VaultPath): Promise<Uint8Array> {
    return new TextEncoder().encode(await this.read(path));
  }

  async write(path: VaultPath, content: string): Promise<void> {
    this.writes.push(path);
    this.files.set(path, content);
  }

  async exists(path: VaultPath): Promise<boolean> {
    return this.files.has(path);
  }

  watch(): Unsubscribe {
    return () => {};
  }
}

/** A short untimed lecture: three paragraphs, mixed line endings and stray blank-line whitespace. */
export const SHORT_PLAIN =
  'Welcome to week one of course A.\nToday we look at two ideas.\n\n' +
  'First, the idea of a worked example.   \r\n\r\n   \t\n' +
  'Second, the idea of a counter-example, which is just as useful.\n';

/** Many sentences, so the greedy packer and the long-paragraph cutter are both exercised. */
function sentence(n: number): string {
  return `Point ${n} of the invented lecture states a small claim about topic ${n % 7}.`;
}

/** Paragraphs of 3 sentences each (each ~230 chars), 40 of them: packs into several parts. */
export const LONG_PLAIN = Array.from({ length: 40 }, (_, p) =>
  [sentence(p * 3), sentence(p * 3 + 1), sentence(p * 3 + 2)].join(' '),
).join('\n\n');

/** One paragraph with no blank line, far over the limit: cut into pieces of its own. */
export const ONE_HUGE_PARAGRAPH = Array.from({ length: 80 }, (_, i) => sentence(i)).join(' ');

/** A single unbroken token longer than the limit: cut hard, not at whitespace. */
export const UNBROKEN_TOKEN = 'x'.repeat(3200);

export const DECLARED_MARKDOWN =
  '---\nrole: Lecture Transcript\ncourse: course A\n---\n\n# Week one\n\nWelcome to the lecture.\n\nSecond paragraph of speech.\n';

export const UNDECLARED_MARKDOWN =
  '---\ncourse: course A\n---\n\n# My notes\n\nSomething I wrote myself.\n';
