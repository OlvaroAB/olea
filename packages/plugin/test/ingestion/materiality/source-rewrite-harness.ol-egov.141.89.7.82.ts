/**
 * Shared harness for the `ol-egov.141.89.7.82` specs ([D-518]): an in-memory vault holding
 * synthetic questions on one non-markdown file, the citation-revision trigger over a real
 * `ObsidianCitationHashStore`, and readers for what the rewrite did. Every string and byte is
 * invented (INV-3).
 */
import type {
  ExtractedUnit,
  ListOptions,
  RevisionJudgePort,
  Unsubscribe,
  VaultEvent,
  VaultPath,
  VaultSource,
} from 'olea-core';
import { citationStorePath, hashContent } from 'olea-core';
import { vi } from 'vitest';
import { ObsidianCitationHashStore } from '../../../src/ingestion/materiality/citation-hash-store.js';
import {
  CitationRevisionTrigger,
  SOURCE_REVISION_REASON,
} from '../../../src/ingestion/materiality/citation-revision-wiring.js';

export const DOC = 'Synthetic/sample handout.pdf' as VaultPath;

export class MemoryVaultSource implements VaultSource {
  readonly files = new Map<string, string>();
  readonly binaries = new Map<string, Uint8Array>();
  async list(options: ListOptions = {}): Promise<readonly VaultPath[]> {
    const extensions = options.extensions?.map((e) => e.toLowerCase());
    return [...this.files.keys()]
      .filter(
        (p) =>
          extensions === undefined ||
          extensions.includes(p.slice(p.lastIndexOf('.') + 1).toLowerCase()),
      )
      .sort() as VaultPath[];
  }
  async read(path: VaultPath): Promise<string> {
    const content = this.files.get(path);
    if (content === undefined) throw new Error(`not found: ${path}`);
    return content;
  }
  async readBinary(path: VaultPath): Promise<Uint8Array> {
    const bytes = this.binaries.get(path);
    if (bytes === undefined) throw new Error(`not found: ${path}`);
    return bytes;
  }
  async write(path: VaultPath, content: string): Promise<void> {
    this.files.set(path, content);
  }
  async exists(path: VaultPath): Promise<boolean> {
    return this.files.has(path) || this.binaries.has(path);
  }
  watch(_handler: (event: VaultEvent) => void): Unsubscribe {
    return () => {};
  }
}

class FakeDataHost {
  blob: Record<string, unknown> = {};
  async loadData(): Promise<unknown> {
    return this.blob;
  }
  async saveData(data: unknown): Promise<void> {
    this.blob = data as Record<string, unknown>;
  }
}

function homeNote(id: string): string {
  return [
    '---',
    'topic: [Synthetic topic]',
    'course: SYN101',
    '---',
    '',
    '```olea-mcq',
    `id: ${id}`,
    `stem: Which synthetic mineral is named in item ${id}?`,
    'answer: Quartz',
    'distractor: Olivine',
    'distractor: Feldspar',
    'distractor: Biotite',
    'distractor: Calcite',
    '```',
    '',
  ].join('\n');
}

/** A question on `DOC`: `page` omitted cites the whole file; `revision` omitted records no file version. */
export interface QuestionSpec {
  readonly id: string;
  readonly page?: number;
  readonly revision?: string;
}

export function seedQuestions(vault: MemoryVaultSource, questions: readonly QuestionSpec[]): void {
  for (const question of questions) {
    vault.files.set(`Synthetic/${question.id} (Olea).md`, homeNote(question.id));
    vault.files.set(
      citationStorePath(question.id),
      `${JSON.stringify({
        instrumentId: question.id,
        sourcePath: DOC,
        ...(question.page !== undefined ? { page: question.page } : {}),
        schemaVersion: 2,
        ...(question.revision !== undefined ? { sourceRevision: question.revision } : {}),
      })}\n`,
    );
  }
}

export function setup() {
  const enqueue = vi.fn(async (_input: unknown): Promise<undefined> => undefined);
  const suspend = vi.fn(
    async (_id: string, _concepts: readonly string[]): Promise<void> => undefined,
  );
  const requestSourceReextraction = vi.fn(async (_path: string): Promise<void> => undefined);
  const store = new ObsidianCitationHashStore(new FakeDataHost());
  const judge: RevisionJudgePort & { judge: ReturnType<typeof vi.fn> } = {
    judge: vi.fn(async () => ({ material: true, reason: 'synthetic' })),
  };
  const trigger = new CitationRevisionTrigger({
    store,
    judge,
    clock: { now: () => 1_000 },
    requestSourceReextraction,
  });
  const actions = { enqueue, suspend };
  return { store, judge, trigger, actions, requestSourceReextraction };
}

export type Harness = ReturnType<typeof setup>;

/** Synthetic bytes for one version of `DOC`. */
export function versionBytes(name: string): Uint8Array {
  return new TextEncoder().encode(`synthetic handout bytes, ${name}`);
}

export function digestOf(bytes: Uint8Array): Promise<string> {
  return hashContent(bytes);
}

/** The units one delivery carries for `DOC`: each page's texts, in order, one unit per text. */
export function unitsOf(pages: Readonly<Record<number, readonly string[]>>): ExtractedUnit[] {
  const units: ExtractedUnit[] = [];
  for (const [page, texts] of Object.entries(pages)) {
    for (const text of texts) {
      units.push({ text, provenance: { sourcePath: DOC, location: { page: Number(page) } } });
    }
  }
  return units;
}

/** What each rewrite enqueued, by the question it replaces: the text it drafts from and the bytes it records. */
export function rewrites(harness: Harness): Map<string, { text: string; revision?: string }> {
  const out = new Map<string, { text: string; revision?: string }>();
  for (const [input] of harness.actions.enqueue.mock.calls) {
    const payload = (
      input as {
        payload: {
          predecessorInstrumentId: string;
          newPassageText: string;
          sourceRevision?: string;
        };
      }
    ).payload;
    out.set(payload.predecessorInstrumentId, {
      text: payload.newPassageText,
      ...(payload.sourceRevision !== undefined ? { revision: payload.sourceRevision } : {}),
    });
  }
  return out;
}

/** The ids whose anchor is still held for a changed file. */
export async function heldIds(harness: Harness): Promise<string[]> {
  const held: string[] = [];
  for (const [id, anchor] of await harness.store.loadAll()) {
    if (anchor.pendingRevalidation?.reason === SOURCE_REVISION_REASON) held.push(id);
  }
  return held.sort();
}
