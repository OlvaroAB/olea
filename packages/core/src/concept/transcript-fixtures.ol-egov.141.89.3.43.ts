/**
 * Shared synthetic fixtures for the one-teaching-event specs (`ol-egov.141.89.3.43`). INV-3: every
 * string is coined; the course, the lecturer and the sentences are invented.
 */

import type { Provenance } from '../extract/types.js';
import type {
  ListOptions,
  Unsubscribe,
  VaultEvent,
  VaultPath,
  VaultSource,
} from '../vault/types.js';
import type { ConceptReaderPort, ConceptReadRequest, ConceptReadResponse } from './read.js';

export class MemoryVault implements VaultSource {
  constructor(private readonly files: Record<string, string>) {}
  list(options: ListOptions = {}): Promise<readonly VaultPath[]> {
    const { under, extensions } = options;
    return Promise.resolve(
      Object.keys(this.files)
        .filter((p) => under === undefined || p === under || p.startsWith(`${under}/`))
        .filter((p) => extensions === undefined || extensions.includes(p.split('.').pop() ?? ''))
        .sort(),
    );
  }
  read(path: VaultPath): Promise<string> {
    const content = this.files[path];
    return content === undefined
      ? Promise.reject(new Error(`no such file ${path}`))
      : Promise.resolve(content);
  }
  readBinary(path: VaultPath): Promise<Uint8Array> {
    return this.read(path).then((t) => new TextEncoder().encode(t));
  }
  write(): Promise<void> {
    return Promise.reject(new Error('read-only'));
  }
  exists(path: VaultPath): Promise<boolean> {
    return Promise.resolve(path in this.files);
  }
  watch(_handler: (event: VaultEvent) => void): Unsubscribe {
    return () => undefined;
  }
}

export const TRANSCRIPT_PATH = '01 Courses/COURSE-A/Lectures/week-4-talk.txt' as VaultPath;
export const SLIDES_PATH = '01 Courses/COURSE-A/Lectures/week-4-slides.pptx' as VaultPath;
export const NOTE_PATH = '01 Courses/COURSE-A/Lectures/week-4-note.md' as VaultPath;

/** A reader that proposes ONE concept anchored on the first passage and also found in all the others. */
export const oneConceptReader: ConceptReaderPort = {
  read(request: ConceptReadRequest): Promise<ConceptReadResponse> {
    const [first, ...rest] = request.passages;
    if (first === undefined) return Promise.resolve({ concepts: [] });
    return Promise.resolve({
      concepts: [
        {
          name: 'Osmotic balance',
          aliases: [],
          anchor: first.anchor,
          alsoIn: rest.map((p) => p.anchor),
        },
      ],
    });
  },
};

/** One explanation as a paragraph: invented prose, 12 short sentences. */
export function explanation(tag: string): string {
  return Array.from(
    { length: 12 },
    (_, i) =>
      `Sentence ${i + 1} of the ${tag} explanation says water moves toward the saltier side.`,
  ).join(' ');
}

export function slideProvenance(page: number): Provenance {
  return { sourcePath: SLIDES_PATH, location: { page, charRange: { start: 0, end: 10 } } };
}

export function partProvenance(
  path: VaultPath,
  ordinal: number,
  startSeconds?: number,
): Provenance {
  return {
    sourcePath: path,
    location: {
      page: ordinal,
      charRange: { start: 0, end: 10 },
      transcriptPart: startSeconds === undefined ? {} : { startSeconds },
    },
  };
}
