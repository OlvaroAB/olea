/**
 * Shared fixtures for `ol-egov.141.89.5.43`'s citation-pass tests (transcript part grain, lineage,
 * and the kept correction hold). Every transcript, course, lecture and sentence here is INVENTED
 * ("course A", an invented lecturer); nothing comes from a real vault. Not a spec file.
 */
import {
  appendReviewLogRecord,
  appendSuspendRecord,
  citationStorePath,
  digestPassage,
  type EnqueueInput,
  hashContent,
  type ListOptions,
  type RevisionJudgePort,
  type RevisionJudgeVerdict,
  type Unsubscribe,
  type VaultEvent,
  type VaultPath,
  type VaultSource,
} from 'olea-core';
import { vi } from 'vitest';
import { ObsidianCitationHashStore } from '../../../src/ingestion/materiality/citation-hash-store.js';
import { CitationRevisionTrigger } from '../../../src/ingestion/materiality/citation-revision-wiring.js';
import { readTranscriptVersion } from '../../../src/ingestion/materiality/transcript-grain.js';
import { resolveCitationPendingRevalidation } from '../../../src/session-builder/provider.js';

/** Text files and binaries; `readBinary` of a text file is its UTF-8 bytes, as on disk. */
export class MemoryVault implements VaultSource {
  readonly files = new Map<string, string>();
  readonly binaries = new Map<string, Uint8Array>();
  async list(options: ListOptions = {}): Promise<readonly VaultPath[]> {
    const extensions = options.extensions?.map((e) => e.toLowerCase());
    return [...new Set([...this.files.keys(), ...this.binaries.keys()])]
      .filter(
        (p) =>
          extensions === undefined ||
          extensions.includes(p.slice(p.lastIndexOf('.') + 1).toLowerCase()),
      )
      .sort();
  }
  async read(path: VaultPath): Promise<string> {
    const content = this.files.get(path);
    if (content === undefined) throw new Error(`not found: ${path}`);
    return content;
  }
  async readBinary(path: VaultPath): Promise<Uint8Array> {
    const bytes = this.binaries.get(path);
    if (bytes !== undefined) return bytes;
    const text = this.files.get(path);
    if (text === undefined) throw new Error(`not found: ${path}`);
    return new TextEncoder().encode(text);
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
  /** Every file's content, for a before/after comparison. */
  snapshot(): ReadonlyMap<string, string> {
    const out = new Map<string, string>(this.files);
    for (const [path, bytes] of this.binaries) out.set(path, `binary:${[...bytes].join(',')}`);
    return out;
  }
  move(from: VaultPath, to: VaultPath): void {
    const text = this.files.get(from);
    if (text === undefined) throw new Error(`not found: ${from}`);
    this.files.delete(from);
    this.files.set(to, text);
  }
}

export class FakeDataHost {
  blob: Record<string, unknown> = {};
  async loadData(): Promise<unknown> {
    return this.blob;
  }
  async saveData(data: unknown): Promise<void> {
    this.blob = data as Record<string, unknown>;
  }
}

export const COURSE = 'COURSEA';

/** An Olea home note holding one multiple-choice instrument per id. */
export function homeNote(topic: string, ids: readonly string[]): string {
  const blocks = ids.flatMap((id) => [
    '```olea-mcq',
    `id: ${id}`,
    `stem: Which invented statement about ${topic} holds (${id})?`,
    'answer: Alpha',
    'distractor: Beta',
    'distractor: Gamma',
    'distractor: Delta',
    'distractor: Epsilon',
    '```',
    '',
  ]);
  return ['---', `topic: [${topic}]`, `course: ${COURSE}`, '---', '', ...blocks].join('\n');
}

/**
 * A citation sidecar as generation writes it: path, part number at drafting, the version's bytes
 * hash and, when the citation names its part (`[D-567]`), the digest of that part's spoken text.
 * With no digest the citation names no part and the whole transcript is its grain.
 */
export function sidecar(args: {
  readonly instrumentId: string;
  readonly sourcePath: VaultPath;
  readonly page: number;
  readonly sourceRevision?: string;
  readonly passageDigest?: string;
}): string {
  return `${JSON.stringify({
    instrumentId: args.instrumentId,
    sourcePath: args.sourcePath,
    page: args.page,
    ...(args.passageDigest !== undefined ? { passageDigest: args.passageDigest } : {}),
    ...(args.sourceRevision !== undefined ? { sourceRevision: args.sourceRevision } : {}),
    schemaVersion: 2,
  })}\n`;
}

export async function bytesHashOf(text: string): Promise<string> {
  return hashContent(new TextEncoder().encode(text));
}

/**
 * Writes the sidecar for `instrumentId` as generation writes it for a question drafted from part
 * `page` alone (`ol-egov.141.89.5.97`, `[D-567]`): the transcript's current bytes as the drafted
 * version, and the part named by the digest of its spoken text.
 */
export async function citeTranscriptPart(
  vault: MemoryVault,
  instrumentId: string,
  sourcePath: VaultPath,
  page: number,
): Promise<void> {
  const text = vault.files.get(sourcePath);
  if (text === undefined) throw new Error(`no transcript at ${sourcePath}`);
  const read = await readTranscriptVersion(vault, sourcePath);
  if (read.kind !== 'read') throw new Error(`${sourcePath} does not read as a transcript`);
  const part = read.version.parts.find((candidate) => candidate.ordinal === page);
  if (part === undefined) throw new Error(`no part ${page} in ${sourcePath}`);
  vault.files.set(
    citationStorePath(instrumentId),
    sidecar({
      instrumentId,
      sourcePath,
      page,
      sourceRevision: await bytesHashOf(text),
      passageDigest: await digestPassage(part.spoken),
    }),
  );
}

/**
 * Writes the sidecar for a question drafted from several passages of the transcript
 * (`ol-egov.141.89.5.97`, `[D-567]`): the current bytes as the drafted version and no part named,
 * so the whole transcript is protected.
 */
export async function citeWholeTranscript(
  vault: MemoryVault,
  instrumentId: string,
  sourcePath: VaultPath,
): Promise<void> {
  const text = vault.files.get(sourcePath);
  if (text === undefined) throw new Error(`no transcript at ${sourcePath}`);
  vault.files.set(
    citationStorePath(instrumentId),
    sidecar({ instrumentId, sourcePath, page: 1, sourceRevision: await bytesHashOf(text) }),
  );
}

const SYLLABLES = [
  'ka',
  'lo',
  'mi',
  'ne',
  'ru',
  'sa',
  'te',
  'vi',
  'zo',
  'pa',
  'do',
  'ge',
  'hu',
  'ji',
  'qe',
  'wo',
] as const;

/** An invented six-letter word, distinct for every `n` below 4096. */
export function inventedWord(n: number): string {
  const at = (i: number): string => SYLLABLES[i % 16] as string;
  return `${at(n)}${at(Math.floor(n / 16))}${at(Math.floor(n / 256))}`;
}

/**
 * One invented cue of a synthetic lecture (one paragraph, seven sentences, about 470 characters).
 * Its content words are invented and unique to `k`; only the glue words recur, as in speech. Three
 * cues fit in one transcript part (the part rule packs paragraphs up to 1500 characters), so a
 * transcript of cues 0..17 has six parts and part `p` holds cues `3(p-1)` to `3(p-1)+2`.
 */
export function cue(k: number): string {
  const w = (i: number): string => inventedWord(k * 40 + i + 17);
  return [
    `The ${w(0)} of the ${w(1)} is ${w(2)} when the ${w(3)} ${w(4)} the ${w(5)}.`,
    `So a ${w(6)} ${w(7)} can ${w(8)} the ${w(9)} in ${w(10)} and ${w(11)}.`,
    `This means the ${w(12)} ${w(13)} keeps its ${w(14)} through the ${w(15)} ${w(16)}.`,
    `Remember that every ${w(17)} ${w(18)} has a ${w(19)} ${w(20)} and a ${w(21)}.`,
    `We will see the ${w(22)} ${w(23)} again with the ${w(24)} ${w(25)} next week.`,
    `Notice how the ${w(26)} ${w(27)} turns into ${w(28)} under ${w(29)} ${w(30)}.`,
    `That is why the ${w(31)} ${w(32)} matters for the ${w(33)} ${w(34)}.`,
  ].join(' ');
}

/** A plain-text transcript: cues as paragraphs, a blank line between them. */
export function transcriptOf(cues: readonly string[]): string {
  return `${cues.join('\n\n')}\n`;
}

/** Cues 0..17: six parts of three cues. */
export const LECTURE: readonly string[] = Array.from({ length: 18 }, (_, k) => cue(k));

/** The cues of part `p` (1-based) of {@link LECTURE}. */
export function partCues(p: number): readonly string[] {
  return LECTURE.slice(3 * (p - 1), 3 * (p - 1) + 3);
}

/** A passage's spoken text, as the anchor holds it (whitespace collapsed). */
export function spoken(cues: readonly string[]): string {
  return cues.join(' ').replace(/\s+/g, ' ').trim();
}

/** One earlier review per instrument: her history, which no citation pass may touch. */
export async function seedHistory(vault: MemoryVault, ids: readonly string[]): Promise<void> {
  let day = 1;
  for (const instrumentId of ids) {
    await appendReviewLogRecord(
      vault,
      {
        timestamp: `2026-09-0${day}T09:00:00Z`,
        instrumentId,
        instrumentType: 'mcq',
        conceptIds: ['invented-concept'],
        rating: 'good',
        wasUnsure: false,
        durationMs: null,
        selectionContext: {
          dueState: 'new',
          examProximity: null,
          yieldRank: null,
          instrumentTypesOffered: ['mcq'],
          planVersion: null,
        },
      },
      { deviceId: 'device-synthetic', generateEventId: () => `review-${instrumentId}` },
    );
    day += 1;
  }
}

/** Every line of the review log: her history. */
export function historyOf(vault: MemoryVault): readonly string[] {
  return [...vault.files]
    .filter(([path]) => path.startsWith('.olea/reviews/'))
    .flatMap(([, content]) => content.split('\n').filter((line) => line.trim() !== ''));
}

/**
 * Her history afterwards: every earlier line is still there, byte for byte, and the only lines
 * added are suspensions of `suspended` (a judged change to a cited passage). Returns the
 * instrument ids of the suspensions added, in order.
 */
export function historyAdded(before: readonly string[], vault: MemoryVault): readonly string[] {
  const after = historyOf(vault);
  for (const line of before) {
    if (!after.includes(line)) throw new Error('an earlier review-log line was changed or removed');
  }
  return after
    .filter((line) => !before.includes(line))
    .map((line) => {
      const entry = JSON.parse(line) as { kind?: string; instrumentId?: string };
      if (entry.kind !== 'suspend' || entry.instrumentId === undefined) {
        throw new Error(`a citation pass added a review-log entry of kind ${String(entry.kind)}`);
      }
      return entry.instrumentId;
    });
}

export interface Harness {
  readonly store: ObsidianCitationHashStore;
  readonly trigger: CitationRevisionTrigger;
  readonly judge: RevisionJudgePort & { judge: ReturnType<typeof vi.fn> };
  readonly actions: {
    enqueue: ReturnType<typeof vi.fn>;
    suspend: ReturnType<typeof vi.fn>;
    onRelocationProposed: ReturnType<typeof vi.fn>;
  };
  /** The instruments composition withholds now (the production resolver over the same store). */
  withheld(ids: readonly string[]): Promise<ReadonlySet<string>>;
  pass(vault: MemoryVault): ReturnType<CitationRevisionTrigger['tick']>;
}

export function harness(options: {
  readonly transcriptPartGrain: boolean;
  readonly verdict?: RevisionJudgeVerdict;
}): Harness {
  const store = new ObsidianCitationHashStore(new FakeDataHost());
  const judge: RevisionJudgePort & { judge: ReturnType<typeof vi.fn> } = {
    judge: vi.fn(async () => options.verdict ?? { material: true, reason: 'scripted' }),
  };
  const trigger = new CitationRevisionTrigger({
    store,
    judge,
    clock: { now: () => 1_000 },
    transcriptPartGrain: options.transcriptPartGrain,
  });
  // The suspension lands in the vault the pass reads, as the production suspend port's does.
  let passVault: MemoryVault | undefined;
  const actions = {
    enqueue: vi.fn(async (_input: EnqueueInput) => undefined),
    suspend: vi.fn(async (instrumentId: string, conceptIds: readonly string[]) => {
      if (passVault === undefined) return;
      await appendSuspendRecord(
        passVault,
        {
          kind: 'suspend',
          timestamp: '2026-10-01T09:00:00Z',
          instrumentId,
          conceptIds: conceptIds.length > 0 ? [...conceptIds] : ['invented-concept'],
        },
        { deviceId: 'device-synthetic' },
      );
    }),
    onRelocationProposed: vi.fn(),
  };
  return {
    store,
    trigger,
    judge,
    actions,
    withheld: (ids) => resolveCitationPendingRevalidation(store, ids),
    pass: (vault) => {
      passVault = vault;
      return trigger.tick(vault, actions);
    },
  };
}
