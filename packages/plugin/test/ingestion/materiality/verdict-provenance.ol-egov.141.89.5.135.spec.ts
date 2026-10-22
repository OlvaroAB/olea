/**
 * `[D-598]` (`ol-egov.141.89.5.135`): every writer of a source-change verdict's record stamps who
 * decided it — the judge with the stamp its answer carried, or a code rule with its version — a
 * record written before this change reads unknown, and none of it changes what she sees or does.
 *
 * Scenarios: olea-service `features/C3-ingestion.md`, "Feature: 1.4 / [D-598] — Each source-change
 * verdict keeps who decided it", the three scenarios tagged
 * `@auto:plugin/ingestion/materiality/verdict-provenance.ol-egov.141.89.5.135.spec`.
 *
 * Each code rule's `describe` block below is also that rule's GOLDEN TABLE: the behaviour its
 * version 1 names, case by case, beside the producer the writer stores. A change to what a rule
 * does fails its table; it is then a new version in `verdict-provenance.ts`, never the same number.
 *
 * INV-3: every note, course, sentence and id here is invented.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  citationStorePath,
  digestPassage,
  type EnqueueInput,
  enumerateVaultInstruments,
  type ModelStamp,
  type PersistedStageProducer,
  type RevisionJudgePort,
  type RevisionJudgeVerdict,
  readStoredProducer,
  type WorkerTaskTransport,
} from 'olea-core';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { canonicalizeForMateriality } from '../../../src/ingestion/materiality/canonical.js';
import {
  CITATION_ANCHOR_STORAGE_KEY,
  type CitationAnchorRecord,
  type CitationHashStore,
  ObsidianCitationHashStore,
  type PendingRevalidation,
} from '../../../src/ingestion/materiality/citation-hash-store.js';
import {
  adaptMaterialityJudgeAsRevisionJudge,
  CitationRevisionTrigger,
} from '../../../src/ingestion/materiality/citation-revision-wiring.js';
import { DEFAULT_MATERIALITY_CONSTANTS } from '../../../src/ingestion/materiality/constants.js';
import {
  MATERIALITY_HASH_STORAGE_KEY,
  ObsidianMaterialityHashStore,
} from '../../../src/ingestion/materiality/hash-store.js';
import { computeMaterialityHashes } from '../../../src/ingestion/materiality/hashes.js';
import { ObsidianMaterialityPendingStore } from '../../../src/ingestion/materiality/pending-store.js';
import type {
  MaterialityHashStore,
  MaterialityJudge,
  MaterialityJudgeVerdict,
  MaterialityRecord,
} from '../../../src/ingestion/materiality/types.js';
import {
  carriedSettledBy,
  codeRule,
  VERDICT_CODE_RULES,
} from '../../../src/ingestion/materiality/verdict-provenance.js';
import {
  type MaterialityEvaluationResult,
  MaterialityTrigger,
} from '../../../src/ingestion/materiality/wiring.js';
import { WorkerMaterialityJudge } from '../../../src/ingestion/materiality/workerJudge.js';
import { rearmSpentRetry } from '../../../src/registry/deferred-recheck-retry.js';
import { createLocalRegistryProvider } from '../../../src/registry/provider.js';
import { sourceCheckAtPresentation } from '../../../src/review/open-session.js';
import { resolveCitationPendingRevalidation } from '../../../src/session-builder/provider.js';
import { memoryVault } from '../../review/memory-vault.js';
import * as binary from './source-rewrite-harness.ol-egov.141.89.7.82.js';
import {
  citeTranscriptPart,
  cue,
  harness,
  homeNote,
  LECTURE,
  MemoryVault,
  partCues,
  sidecar,
  transcriptOf,
} from './transcript-fixtures.ol-egov.141.89.5.43.js';

// ---------------------------------------------------------------------------------------------
// Shared
// ---------------------------------------------------------------------------------------------

const STAMP: ModelStamp = { promptVersion: 'p-coined-1.2.0', modelId: 'model-coined-a' };
const JUDGE_TASK = 'materiality.judge.v1';

function judgeProducer(stamp: ModelStamp | null): PersistedStageProducer {
  return { kind: 'model', seat: 'candidate', taskId: JUDGE_TASK, stamp };
}

function rule(id: string, ruleVersion = 1): PersistedStageProducer {
  return { kind: 'code', rule: id, ruleVersion };
}

/** One `data.json`, shared by every store over it, as in production. */
class DataHost {
  blob: Record<string, unknown> = {};
  async loadData(): Promise<unknown> {
    return structuredClone(this.blob);
  }
  async saveData(data: unknown): Promise<void> {
    this.blob = structuredClone(data) as Record<string, unknown>;
  }
}

/** A Worker judge over a scripted response body: the production reader of the D7.3 stamp. */
function workerJudge(material: boolean, stamp: unknown, omitStamp = false): MaterialityJudge {
  const transport: WorkerTaskTransport = {
    send: async () => ({
      ok: true,
      result: { material, reason: 'coined reason' },
      ...(omitStamp ? {} : { stamp }),
    }),
  };
  return new WorkerMaterialityJudge({ transport });
}

const PROVENANCE_KEYS = new Set(['settledBy', 'raisedBy', 'decidedBy']);

/**
 * `value` with each run's own minted concept keys replaced by one placeholder: two runs mint
 * different random keys for the same concept, which is not a difference this suite is about.
 */
function sameConcepts(value: unknown): unknown {
  return JSON.parse(
    JSON.stringify(value).replace(/concept-key1:[0-9a-f-]+/g, 'concept-key1:minted'),
  ) as unknown;
}

/** `value` with every provenance key removed, at any depth. */
function withoutProvenanceKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(withoutProvenanceKeys);
  if (typeof value !== 'object' || value === null) return value;
  return Object.fromEntries(
    Object.entries(value)
      .filter(([key]) => !PROVENANCE_KEYS.has(key))
      .map(([key, inner]) => [key, withoutProvenanceKeys(inner)]),
  );
}

afterEach(() => {
  vi.restoreAllMocks();
});

// ---------------------------------------------------------------------------------------------
// File level: the hash record
// ---------------------------------------------------------------------------------------------

const NOTE = 'Coined course/Kalomi notes.md';
const BASE = 'The invented kalomi rule holds below the venido line.';
const CHANGED =
  'The invented kalomi rule holds below the venido line, and fails once the sarute pressure rises past it.';
const REFLOWED = '# The invented **kalomi** rule holds below the venido line.';
/** One character more than BASE: below the minimum-edit-size floor. */
const SMALL = 'The invented kalomi rule holds below the venido lines.';
const T0 = DEFAULT_MATERIALITY_CONSTANTS.debounceMs + 1;

async function settledRecord(
  text: string,
  extra: Partial<MaterialityRecord> = {},
): Promise<MaterialityRecord> {
  return {
    path: NOTE,
    hashes: await computeMaterialityHashes(text),
    canonicalLength: canonicalizeForMateriality(text).length,
    lastChangedAt: 0,
    lastVerdictAt: 0,
    revision: 1,
    ...extra,
  };
}

function fileWorld() {
  const host = new DataHost();
  const hashStore = new ObsidianMaterialityHashStore(host);
  const pendingStore = new ObsidianMaterialityPendingStore(host);
  const vault = new Map<string, string>();
  return {
    host,
    hashStore,
    vault,
    start: (judge: MaterialityJudge | null, store: MaterialityHashStore = hashStore) =>
      new MaterialityTrigger({
        store,
        clock: { now: () => T0 },
        judge,
        pendingStore,
        readCurrentText: async (path) => vault.get(path) ?? null,
      }),
    record: async (): Promise<MaterialityRecord> => {
      const record = await hashStore.load(NOTE);
      if (record === null) throw new Error('no record');
      return record;
    },
    /** The record exactly as `data.json` holds it. */
    raw: (): Record<string, unknown> =>
      (host.blob[MATERIALITY_HASH_STORAGE_KEY] as Record<string, Record<string, unknown>>)[
        NOTE
      ] as Record<string, unknown>,
  };
}

function answering(verdict: Record<string, unknown>): MaterialityJudge {
  return { judge: vi.fn(async () => verdict as unknown as MaterialityJudgeVerdict) };
}

describe('file level: the judge settles a real change, and its record names the judge with its stamp', () => {
  it.each([
    ['the Worker carried a stamp', workerJudge(true, STAMP), STAMP],
    ['the Worker carried none', workerJudge(true, undefined, true), null],
    ['the Worker carried an unreadable one', workerJudge(true, { promptVersion: 'p-1' }), null],
    ['a judge that attaches no stamp at all', answering({ material: false, reason: 'r' }), null],
    [
      'a judge that attaches an unreadable stamp itself',
      answering({ material: true, reason: 'r', stamp: { promptVersion: 'p-1', modelId: 7 } }),
      null,
    ],
  ])('%s', async (_label, judge, stamp) => {
    const w = fileWorld();
    await w.hashStore.save(await settledRecord(BASE, { settledBy: rule('formatting-only') }));
    const result = await w.start(judge).evaluate(NOTE, CHANGED, BASE);
    expect(result.kind).toBe('verdict');
    const record = await w.record();
    expect(record.revision).toBe(2);
    expect(record.settledBy).toEqual(judgeProducer(stamp));
    expect(readStoredProducer(w.raw().settledBy)).toEqual({
      state: 'known',
      producer: judgeProducer(stamp),
    });
    // The same producer the in-memory decision carries: built once, kept.
    if (result.kind === 'verdict') {
      expect(result.decision.provenance.producer).toEqual(judgeProducer(stamp));
    }
  });
});

describe('rule formatting-only v1 (file level, and the canonical rule the citation grain shares)', () => {
  // The golden table: two texts are formatting-only of each other exactly when their canonical
  // forms are equal. Whitespace, a heading marker, paired emphasis and blank lines are layout;
  // a list or quote marker, an unpaired marker and any word are content.
  it.each([
    ['whitespace', 'Alpha beta.', '  Alpha   beta.  ', true],
    ['a heading marker', '## Alpha beta.', 'Alpha beta.', true],
    ['paired strong emphasis', '**Alpha** beta.', 'Alpha beta.', true],
    ['paired emphasis', '_Alpha_ beta.', 'Alpha beta.', true],
    ['blank lines', 'Alpha\n\n\nbeta.', 'Alpha\nbeta.', true],
    ['a list marker', '- Alpha beta.', 'Alpha beta.', false],
    ['a quote marker', '> Alpha beta.', 'Alpha beta.', false],
    ['an unpaired marker', '**Alpha beta.', 'Alpha beta.', false],
    ['a changed word', 'Alpha beta.', 'Alpha gamma.', false],
    ['a line break inside a line', 'Alpha beta.', 'Alpha\nbeta.', false],
  ])('%s', (_label, a, b, formattingOnly) => {
    expect(canonicalizeForMateriality(a) === canonicalizeForMateriality(b)).toBe(formattingOnly);
  });

  it('pins the canonical form itself', () => {
    expect(canonicalizeForMateriality('#  **Alpha**   _beta_\n\n- gamma  \n')).toBe(
      'Alpha beta\n- gamma',
    );
  });

  it('a formatting-only save settles the record by this rule, replacing whoever settled it before', async () => {
    const w = fileWorld();
    await w.hashStore.save(await settledRecord(BASE, { settledBy: judgeProducer(STAMP) }));
    const judge = answering({ material: true });
    const result = await w.start(judge).evaluate(NOTE, REFLOWED);
    expect(result.kind).toBe('formatting-only');
    expect(judge.judge).not.toHaveBeenCalled();
    const record = await w.record();
    expect(record.hashes).toEqual(await computeMaterialityHashes(REFLOWED));
    expect(record.settledBy).toEqual(rule('formatting-only'));
  });

  it('the restart recovery formatting exit settles the record by this rule too', async () => {
    const w = fileWorld();
    await w.hashStore.save(await settledRecord(BASE, { settledBy: judgeProducer(STAMP) }));
    // A call on CHANGED is lost; by the restart the note reads as BASE, laid out differently.
    const calls: string[] = [];
    const hanging: MaterialityJudge = {
      judge: vi.fn((input) => {
        calls.push(input.currentText);
        return new Promise<MaterialityJudgeVerdict>(() => {});
      }),
    };
    w.vault.set(NOTE, CHANGED);
    void w.start(hanging).evaluate(NOTE, CHANGED, BASE);
    await vi.waitFor(() => expect(calls).toHaveLength(1));
    w.vault.set(NOTE, REFLOWED);

    const judge = answering({ material: true });
    const recovered = await w.start(judge).recoverUnfinishedChecks(T0 + 30_000);
    expect(recovered).toEqual([]);
    expect(judge.judge).not.toHaveBeenCalled();
    const record = await w.record();
    expect(record.hashes).toEqual(await computeMaterialityHashes(REFLOWED));
    expect(record.revision).toBe(1);
    expect(record.settledBy).toEqual(rule('formatting-only'));
  });
});

describe('rule no-groundable-content v1 (file level)', () => {
  // The golden table: a first sighting whose canonical text is empty is settled by this rule.
  it.each([
    ['an empty note', ''],
    ['whitespace and blank lines', '  \n\n \t\n'],
    ['a bare heading marker', '#'],
    ['a heading marker and spaces', '##   \n'],
  ])('%s', async (_label, text) => {
    const w = fileWorld();
    const judge = answering({ material: true });
    const result = await w.start(judge).evaluate(NOTE, text);
    expect(result.kind).toBe('no-groundable-content');
    expect(judge.judge).not.toHaveBeenCalled();
    const record = await w.record();
    expect(record.settledBy).toEqual(rule('no-groundable-content'));
  });

  it('a first sighting with groundable content is not this rule (nothing is settled without a previous text)', async () => {
    const w = fileWorld();
    const result = await w.start(answering({ material: true })).evaluate(NOTE, BASE);
    expect(result.kind).toBe('judge-unavailable');
    expect(await w.hashStore.load(NOTE)).toBeNull();
  });
});

describe('file level: a write that keeps the settled baseline carries who settled it unchanged', () => {
  const CARRIED: readonly [string, PersistedStageProducer | undefined][] = [
    ['a judge-settled record', judgeProducer(STAMP)],
    ['a rule-settled record', rule('formatting-only')],
    ['a record written before this change (no value)', undefined],
  ];

  async function worldWith(settledBy: PersistedStageProducer | undefined, lastChangedAt = 0) {
    const w = fileWorld();
    await w.hashStore.save(
      await settledRecord(BASE, {
        lastChangedAt,
        ...(settledBy !== undefined ? { settledBy } : {}),
      }),
    );
    return w;
  }

  function expectCarried(
    raw: Record<string, unknown>,
    settledBy: PersistedStageProducer | undefined,
  ) {
    if (settledBy === undefined) expect('settledBy' in raw).toBe(false);
    else expect(raw.settledBy).toEqual(settledBy);
  }

  it.each(CARRIED)('a debounced save: %s', async (_label, settledBy) => {
    const w = await worldWith(settledBy, T0 - 10);
    const result = await w.start(answering({ material: true })).evaluate(NOTE, CHANGED, BASE);
    expect(result.kind).toBe('debounced');
    expect((await w.record()).hashes).toEqual(await computeMaterialityHashes(BASE));
    expectCarried(w.raw(), settledBy);
  });

  it.each(CARRIED)('a below-floor save: %s', async (_label, settledBy) => {
    const w = await worldWith(settledBy);
    const result = await w.start(answering({ material: true })).evaluate(NOTE, SMALL, BASE);
    expect(result.kind).toBe('below-floor');
    expectCarried(w.raw(), settledBy);
  });

  it.each(CARRIED)(
    'back at the baseline bytes with an edit still held (the identical-bytes exit): %s',
    async (_label, settledBy) => {
      const w = await worldWith(settledBy);
      const trigger = w.start(answering({ material: true }));
      expect((await trigger.evaluate(NOTE, SMALL, BASE)).kind).toBe('below-floor');
      const result = await trigger.evaluate(NOTE, BASE, SMALL);
      expect(result.kind).toBe('unchanged');
      expectCarried(w.raw(), settledBy);
    },
  );

  it('a value this build cannot read is carried verbatim, and never drops the record', async () => {
    const w = fileWorld();
    const unreadable = { kind: 'person', note: 'from a newer build', at: [1, 2] };
    w.host.blob = {
      [MATERIALITY_HASH_STORAGE_KEY]: {
        [NOTE]: { ...(await settledRecord(BASE)), settledBy: unreadable },
      },
    };
    expect(await w.hashStore.load(NOTE)).not.toBeNull();
    expect(readStoredProducer(w.raw().settledBy)).toEqual({ state: 'unrecognised' });
    const result = await w.start(answering({ material: true })).evaluate(NOTE, SMALL, BASE);
    expect(result.kind).toBe('below-floor');
    expect(w.raw().settledBy).toEqual(unreadable);
  });

  it('carriedSettledBy adds no key to a record that had none', () => {
    expect(carriedSettledBy(null)).toEqual({});
    expect('settledBy' in carriedSettledBy({})).toBe(false);
    expect(carriedSettledBy({ settledBy: rule('formatting-only') })).toEqual({
      settledBy: rule('formatting-only'),
    });
  });
});

// ---------------------------------------------------------------------------------------------
// Citation level: fixtures
// ---------------------------------------------------------------------------------------------

const P_HOME = 'Coined course/Kalomi (Olea).md';
const P_SOURCE = 'Coined course/Kalomi.md';
const P_OTHER = 'Coined course/Venido.md';
const LINE_A = 'The invented sarute dial turns left at dawn.';
const LINE_B = 'The invented kalomi rule holds below the venido line.';
const LINE_C = 'It is bounded by the pavo mark and the lemi mark.';
const LINE_D = 'An invented closing line about the tamo gate.';
const PASSAGE = `${LINE_B}\n${LINE_C}`;
const P_ID = 'q-passage';

function sourceNote(...blocks: string[]): string {
  return ['# Kalomi', '', ...blocks.flatMap((block) => [block, '']), ''].join('\n');
}

const SOURCE_TEXT = sourceNote(LINE_A, PASSAGE, LINE_D);

function actionsDouble() {
  return {
    enqueue: vi.fn(async (_input: EnqueueInput) => undefined),
    suspend: vi.fn(async (_id: string, _concepts: readonly string[]) => undefined),
    onRelocationProposed: vi.fn(),
  };
}

/** A judge double; `stamp` is attached as given (malformed included), as a Worker body would carry it. */
function judgeSaying(
  material: boolean,
  stamp?: unknown,
): RevisionJudgePort & { judge: ReturnType<typeof vi.fn> } {
  return {
    judge: vi.fn(
      async () =>
        ({
          material,
          reason: 'coined',
          ...(stamp !== undefined ? { stamp } : {}),
        }) as RevisionJudgeVerdict,
    ),
  };
}

async function passageWorld(
  options: {
    sourceText?: string;
    passage?: string;
    digest?: string;
    extra?: Record<string, string>;
    judge?: RevisionJudgePort | null;
    passageRules?: ConstructorParameters<typeof CitationRevisionTrigger>[0]['passageRules'];
  } = {},
) {
  const passage = options.passage ?? PASSAGE;
  const digest = options.digest ?? (await digestPassage(passage));
  const vault = new MemoryVault();
  vault.files.set(P_HOME, homeNote('Invented kalomi topic', [P_ID]));
  vault.files.set(P_SOURCE, options.sourceText ?? SOURCE_TEXT);
  vault.files.set(
    citationStorePath(P_ID),
    sidecar({ instrumentId: P_ID, sourcePath: P_SOURCE, page: 1, passageDigest: digest }),
  );
  for (const [path, text] of Object.entries(options.extra ?? {})) vault.files.set(path, text);
  const host = new DataHost();
  const store = new ObsidianCitationHashStore(host);
  const judge = options.judge === undefined ? judgeSaying(true, STAMP) : options.judge;
  const trigger = new CitationRevisionTrigger({
    store,
    judge,
    clock: { now: () => 1_000 },
    ...(options.passageRules !== undefined ? { passageRules: options.passageRules } : {}),
  });
  const acts = actionsDouble();
  return {
    vault,
    host,
    store,
    judge,
    trigger,
    acts,
    pass: () => trigger.tick(vault, acts),
    anchor: async (id = P_ID): Promise<CitationAnchorRecord> => {
      const record = (await store.loadAll()).get(id);
      if (record === undefined) throw new Error(`no anchor for ${id}`);
      return record;
    },
  };
}

const W_NOTE = 'Coined course/Tamo gate.md';
const W_ID = 'q-whole';
const W_PARAGRAPH = 'The invented tamo gate opens at dusk and shuts at the second bell.';
const W_CHANGED = 'The invented tamo gate opens only at dawn, and never at the second bell.';

/** A note with its own question beside the material it cites (a self-referential citation). */
function wholeNote(paragraph: string, id = W_ID): string {
  return `${homeNote('Invented tamo topic', [id])}\n## The tamo gate\n\n${paragraph}\n`;
}

function wholeWorld(judge: RevisionJudgePort | null, store?: CitationHashStore) {
  const vault = new MemoryVault();
  vault.files.set(W_NOTE, wholeNote(W_PARAGRAPH));
  vault.files.set(
    citationStorePath(W_ID),
    sidecar({ instrumentId: W_ID, sourcePath: W_NOTE, page: 1 }),
  );
  const host = new DataHost();
  const real = new ObsidianCitationHashStore(host);
  const trigger = new CitationRevisionTrigger({
    store: store ?? real,
    judge,
    clock: { now: () => 1_000 },
  });
  const acts = actionsDouble();
  return {
    vault,
    host,
    store: real,
    trigger,
    acts,
    pass: () => trigger.tick(vault, acts),
    anchor: async (): Promise<CitationAnchorRecord> => {
      const record = (await real.loadAll()).get(W_ID);
      if (record === undefined) throw new Error('no anchor');
      return record;
    },
  };
}

// ---------------------------------------------------------------------------------------------
// Citation level: who settled the anchor
// ---------------------------------------------------------------------------------------------

describe('rule first-sighting v1: an instrument with no anchor is baselined by the first-sighting rule', () => {
  it('no passage digest: the whole cited note, its question blocks stripped', async () => {
    const w = wholeWorld(null);
    const report = await w.pass();
    expect(report.newlyBaselined).toBe(1);
    const anchor = await w.anchor();
    expect(anchor.text).toContain(W_PARAGRAPH);
    expect(anchor.text).not.toContain('olea-mcq');
    expect(anchor.passageDigest).toBeUndefined();
    expect(anchor.pendingRevalidation).toBeUndefined();
    expect(anchor.settledBy).toEqual(rule('first-sighting'));
  });

  it('a digest naming exactly one passage: the anchor holds that passage', async () => {
    const w = await passageWorld({ judge: null });
    await w.pass();
    const anchor = await w.anchor();
    expect(anchor.text).toBe(PASSAGE);
    expect(anchor.passageDigest).toBe(await digestPassage(PASSAGE));
    expect(anchor.settledBy).toEqual(rule('first-sighting'));
  });

  it('a digest that resolves to no single passage: an empty anchor, settled by the rule, and a hold', async () => {
    const w = await passageWorld({ judge: null, sourceText: sourceNote(PASSAGE, LINE_D, PASSAGE) });
    const report = await w.pass();
    expect(report.passageSeedUnresolved).toBe(1);
    const anchor = await w.anchor();
    expect(anchor.text).toBe('');
    expect(anchor.settledBy).toEqual(rule('first-sighting'));
    expect(anchor.pendingRevalidation?.raisedBy).toEqual(rule('passage-seed-unresolved'));
  });

  it('a question withheld at first sighting whose passage stands again in its note is seeded by the rule', async () => {
    const w = await passageWorld({ judge: null, sourceText: sourceNote(LINE_A, LINE_D) });
    await w.pass();
    expect((await w.anchor()).pendingRevalidation?.reason).toBe('passage-missing');
    w.vault.files.set(P_SOURCE, SOURCE_TEXT);
    await w.pass();
    const anchor = await w.anchor();
    expect(anchor.text).toBe(PASSAGE);
    expect(anchor.pendingRevalidation).toBeUndefined();
    expect(anchor.settledBy).toEqual(rule('first-sighting'));
  });

  it('a transcript part, at the version its citation was drafted from', async () => {
    const vault = new MemoryVault();
    const transcript = 'Course A/Lecture 9/transcript.txt';
    vault.files.set(transcript, transcriptOf(LECTURE));
    vault.files.set(
      'Course A/Lecture 9/transcript (Olea).md',
      homeNote('Invented lecture', ['q-t']),
    );
    await citeTranscriptPart(vault, 'q-t', transcript, 2);
    const h = harness({ transcriptPartGrain: true });
    await h.pass(vault);
    const anchor = (await h.store.loadAll()).get('q-t');
    expect(anchor?.sourcePath).toBe(transcript);
    expect(anchor?.settledBy).toEqual(rule('first-sighting'));
    expect(anchor?.pendingRevalidation).toBeUndefined();
  });
});

describe('rule formatting-only v1 at the citation grain, rule passage-reformatted v1 and rule question-blocks-restripped v1', () => {
  it('formatting-only: an emphasis-only edit to a whole cited note', async () => {
    const w = wholeWorld(judgeSaying(true, STAMP));
    await w.pass();
    w.vault.files.set(W_NOTE, wholeNote(W_PARAGRAPH.replace('tamo gate', '**tamo** gate')));
    const report = await w.pass();
    expect(report.formattingOnly).toBe(1);
    const anchor = await w.anchor();
    expect(anchor.text).toContain('**tamo** gate');
    expect(anchor.settledBy).toEqual(rule('formatting-only'));
  });

  it('formatting-only: an emphasis-only edit to a cited passage (the ladder finds it by canonical text)', async () => {
    const w = await passageWorld();
    await w.pass();
    const emphasised = `${LINE_B}\n**${LINE_C}**`;
    w.vault.files.set(P_SOURCE, sourceNote(LINE_A, emphasised, LINE_D));
    const report = await w.pass();
    expect(report.formattingOnly).toBe(1);
    expect(w.judge?.judge).not.toHaveBeenCalled();
    const anchor = await w.anchor();
    expect(anchor.text).toBe(emphasised);
    expect(anchor.settledBy).toEqual(rule('formatting-only'));
  });

  it.each([
    ['indented and trailing whitespace', `${LINE_B}\n  ${LINE_C}  `],
    ['re-wrapped onto one line', `${LINE_B} ${LINE_C}`],
  ])('passage-reformatted: %s', async (_label, reformatted) => {
    const w = await passageWorld();
    await w.pass();
    w.vault.files.set(P_SOURCE, sourceNote(LINE_A, reformatted, LINE_D));
    const report = await w.pass();
    expect(report.formattingOnly).toBe(1);
    const anchor = await w.anchor();
    expect(anchor.text).toBe(reformatted);
    expect(anchor.settledBy).toEqual(rule('passage-reformatted'));
  });

  it('a changed word is none of these rules: the judge reads it', async () => {
    const w = await passageWorld();
    await w.pass();
    w.vault.files.set(
      P_SOURCE,
      sourceNote(LINE_A, `${LINE_B}\n${LINE_C.replace('pavo', 'kiri')}`, LINE_D),
    );
    const report = await w.pass();
    expect(report.formattingOnly).toBe(0);
    expect(w.judge?.judge).toHaveBeenCalledTimes(1);
  });

  it('question-blocks-restripped: an anchor saved with her unbound blocks left in, the note unchanged', async () => {
    const cited = 'Course A/Notes/kiri rule.md';
    const herNote = [
      '# Kiri rule',
      '',
      'The invented kiri rule holds while the doma level stays under the pelu mark.',
      '',
      'When does the invented kiri rule hold?::Under the pelu mark',
      '',
      'An invented closing line.',
      '',
    ].join('\n');
    const vault = new MemoryVault();
    vault.files.set('Course A/Week 9 (Olea).md', homeNote('Invented kiri topic', ['q-kiri']));
    vault.files.set(cited, herNote);
    vault.files.set(
      citationStorePath('q-kiri'),
      sidecar({ instrumentId: 'q-kiri', sourcePath: cited, page: 1 }),
    );
    const h = harness({ transcriptPartGrain: true });
    await h.pass(vault);
    const anchor = (await h.store.loadAll()).get('q-kiri');
    if (anchor === undefined) throw new Error('no anchor');
    // As an earlier build saved it: her note with her block left in.
    await h.store.save('q-kiri', { ...anchor, text: herNote });
    const report = await h.pass(vault);
    expect(report.formattingOnly).toBe(1);
    expect(h.judge.judge).not.toHaveBeenCalled();
    expect((await h.store.loadAll()).get('q-kiri')?.settledBy).toEqual(
      rule('question-blocks-restripped'),
    );
  });
});

describe('rule passage-relocated v1, rule relocated-exact v1 and rule passage-found-again v1', () => {
  it('passage-relocated: a passage that now stands, exactly, in another note heals there', async () => {
    const w = await passageWorld({
      extra: { [P_OTHER]: sourceNote('An invented venido opening.') },
    });
    await w.pass();
    w.vault.files.set(P_SOURCE, sourceNote(LINE_A, LINE_D));
    w.vault.files.set(P_OTHER, sourceNote('An invented venido opening.', PASSAGE));
    const report = await w.pass();
    expect(report.relocated).toBe(1);
    const anchor = await w.anchor();
    expect(anchor.sourcePath).toBe(P_OTHER);
    expect(anchor.settledBy).toEqual(rule('passage-relocated'));
  });

  it('passage-relocated: a question withheld at first sighting found by its digest in one other note', async () => {
    const w = await passageWorld({
      judge: null,
      sourceText: sourceNote(LINE_A, LINE_D),
      extra: { [P_OTHER]: sourceNote('An invented venido opening.', PASSAGE) },
    });
    await w.pass();
    const anchor = await w.anchor();
    // First sighting looks only in the cited note; the next pass's digest retry heals it.
    expect(anchor.pendingRevalidation?.reason).toBe('passage-missing');
    await w.pass();
    const healed = await w.anchor();
    expect(healed.sourcePath).toBe(P_OTHER);
    expect(healed.settledBy).toEqual(rule('passage-relocated'));
  });

  it('relocated-exact: a whole-note anchor whose material stands verbatim beside another tracked question', async () => {
    const w = wholeWorld(judgeSaying(true, STAMP));
    await w.pass();
    const decoy = 'Coined course/Elsewhere.md';
    const after = new MemoryVault();
    after.files.set(decoy, wholeNote(W_PARAGRAPH, 'q-decoy'));
    after.files.set(
      citationStorePath('q-decoy'),
      sidecar({ instrumentId: 'q-decoy', sourcePath: decoy, page: 1 }),
    );
    const report = await w.trigger.tick(after, w.acts);
    expect(report.relocated).toBe(1);
    const anchor = await w.anchor();
    expect(anchor.sourcePath).toBe(decoy);
    expect(anchor.settledBy).toEqual(rule('relocated-exact'));
  });

  it('a near-only match is proposed, never healed: the anchor and who settled it stay as they were', async () => {
    const w = wholeWorld(judgeSaying(true, STAMP));
    await w.pass();
    const decoy = 'Coined course/Elsewhere.md';
    const after = new MemoryVault();
    after.files.set(decoy, wholeNote(`${W_PARAGRAPH} One invented word more.`, 'q-decoy'));
    after.files.set(
      citationStorePath('q-decoy'),
      sidecar({ instrumentId: 'q-decoy', sourcePath: decoy, page: 1 }),
    );
    const report = await w.trigger.tick(after, w.acts);
    expect(report.relocated).toBe(0);
    const anchor = await w.anchor();
    expect(anchor.sourcePath).toBe(W_NOTE);
    expect(anchor.settledBy).toEqual(rule('first-sighting'));
  });

  it('passage-found-again: a passage withheld as missing stands again, and the hold lifts', async () => {
    const w = await passageWorld();
    await w.pass();
    w.vault.files.set(P_SOURCE, sourceNote(LINE_A, LINE_D));
    await w.pass();
    expect((await w.anchor()).pendingRevalidation?.reason).toBe('passage-missing');
    w.vault.files.set(P_SOURCE, SOURCE_TEXT);
    await w.pass();
    const anchor = await w.anchor();
    expect(anchor.pendingRevalidation).toBeUndefined();
    expect(anchor.text).toBe(PASSAGE);
    expect(anchor.settledBy).toEqual(rule('passage-found-again'));
  });

  it('passage-found-again: an anchor on a retired rule, found cleanly under the current one, is re-seated', async () => {
    const line = 'A single invented line passage about the doma level.';
    const w = await passageWorld({
      judge: null,
      sourceText: sourceNote(line, LINE_D),
      passage: line,
    });
    await w.pass();
    expect((await w.anchor()).passageDigest?.startsWith('p1:')).toBe(true);
    const lineRule = {
      version: 2,
      normalise: (text: string) => text.replace(/\s+/g, ' ').trim(),
      segment: (source: string) => {
        const segments = [];
        let offset = 0;
        for (const text of source.split('\n')) {
          const normalised = text.replace(/\s+/g, ' ').trim();
          if (normalised.length > 0) {
            segments.push({
              level: 'line' as const,
              kind: 'text' as const,
              start: offset,
              end: offset + text.length,
              text,
              normalised,
              lineCount: 1,
            });
          }
          offset += text.length + 1;
        }
        return segments;
      },
    };
    w.vault.files.set(P_SOURCE, sourceNote(LINE_D, 'An invented new opening.', line));
    const later = new CitationRevisionTrigger({
      store: w.store,
      judge: judgeSaying(true, STAMP),
      clock: { now: () => 1_000 },
      passageRules: [lineRule],
    });
    await later.tick(w.vault, w.acts);
    const anchor = await w.anchor();
    expect(anchor.passageDigest).toBe(await digestPassage(line, lineRule));
    expect(anchor.settledBy).toEqual(rule('passage-found-again'));
  });
});

// ---------------------------------------------------------------------------------------------
// Citation level: who raised the hold
// ---------------------------------------------------------------------------------------------

describe('rule cited-text-differs v1: a real difference at the cited passage raises its hold', () => {
  it('with no judge configured, the recorder raises it', async () => {
    const w = wholeWorld(null);
    await w.pass();
    w.vault.files.set(W_NOTE, wholeNote(W_CHANGED));
    const report = await w.pass();
    expect(report.judgeUnavailable).toBe(1);
    const pending = (await w.anchor()).pendingRevalidation;
    expect(pending?.reason).toBeUndefined();
    expect(pending?.raisedBy).toEqual(rule('cited-text-differs'));
    expect(pending?.dispatchedAt).toBeUndefined();
  });

  it('with a judge, the dispatch record raises it first, and the same difference keeps that first value', async () => {
    const w = wholeWorld(adaptMaterialityJudgeAsRevisionJudge(workerJudge(true, STAMP)));
    await w.pass();
    w.vault.files.set(W_NOTE, wholeNote(W_CHANGED));
    await w.pass();
    const pending = (await w.anchor()).pendingRevalidation;
    expect(pending?.dispatchedAt).toBe(1_000);
    expect(pending?.raisedBy).toEqual(rule('cited-text-differs'));
  });

  it('offline, no dispatch is recorded, and the recorder raises it', async () => {
    const vault = new MemoryVault();
    vault.files.set(W_NOTE, wholeNote(W_PARAGRAPH));
    vault.files.set(
      citationStorePath(W_ID),
      sidecar({ instrumentId: W_ID, sourcePath: W_NOTE, page: 1 }),
    );
    const store = new ObsidianCitationHashStore(new DataHost());
    const trigger = new CitationRevisionTrigger({
      store,
      judge: judgeSaying(true, STAMP),
      clock: { now: () => 1_000 },
      isOnline: () => false,
    });
    await trigger.tick(vault, actionsDouble());
    vault.files.set(W_NOTE, wholeNote(W_CHANGED));
    await trigger.tick(vault, actionsDouble());
    const pending = (await store.loadAll()).get(W_ID)?.pendingRevalidation;
    expect(pending?.dispatchedAt).toBeUndefined();
    expect(pending?.raisedBy).toEqual(rule('cited-text-differs'));
  });
});

describe('rule passage-unresolved v1: a passage that cannot be located is withheld with its reason', () => {
  it.each([
    ['gone, nothing like it anywhere', () => sourceNote(LINE_A, LINE_D), 'passage-missing'],
    ['standing twice', () => sourceNote(LINE_A, PASSAGE, LINE_D, PASSAGE), 'passage-ambiguous'],
  ])('%s', async (_label, next, reason) => {
    const w = await passageWorld();
    await w.pass();
    w.vault.files.set(P_SOURCE, next());
    await w.pass();
    expect(w.judge?.judge).not.toHaveBeenCalled();
    const pending = (await w.anchor()).pendingRevalidation;
    expect(pending?.reason).toBe(reason);
    expect(pending?.raisedBy).toEqual(rule('passage-unresolved'));
  });

  it('a whole cited note (her own, apart from the question) with no groundable content left', async () => {
    const cited = 'Coined course/Split source.md';
    const vault = new MemoryVault();
    vault.files.set('Coined course/Split (Olea).md', homeNote('Invented split topic', ['q-split']));
    vault.files.set(cited, sourceNote(LINE_A, LINE_D));
    vault.files.set(
      citationStorePath('q-split'),
      sidecar({ instrumentId: 'q-split', sourcePath: cited, page: 1 }),
    );
    const store = new ObsidianCitationHashStore(new DataHost());
    const judge = judgeSaying(true, STAMP);
    const trigger = new CitationRevisionTrigger({ store, judge, clock: { now: () => 1_000 } });
    await trigger.tick(vault, actionsDouble());
    vault.files.set(cited, '');
    await trigger.tick(vault, actionsDouble());
    expect(judge.judge).not.toHaveBeenCalled();
    const pending = (await store.loadAll()).get('q-split')?.pendingRevalidation;
    expect(pending?.reason).toBe('passage-missing');
    expect(pending?.raisedBy).toEqual(rule('passage-unresolved'));
  });

  it('a re-stated hold for the same state keeps its first value', async () => {
    const w = await passageWorld();
    await w.pass();
    w.vault.files.set(P_SOURCE, sourceNote(LINE_A, LINE_D));
    await w.pass();
    const first = (await w.anchor()).pendingRevalidation;
    await w.pass();
    expect((await w.anchor()).pendingRevalidation).toEqual(first);
  });
});

describe('rule passage-seed-unresolved v1: a citation digest that names no single passage at first sighting', () => {
  it.each([
    ['standing twice', { sourceText: sourceNote(PASSAGE, LINE_D, PASSAGE) }, 'passage-ambiguous'],
    ['absent', { sourceText: sourceNote(LINE_A, LINE_D) }, 'passage-missing'],
    [
      'a rule this build does not carry',
      { digest: `p9:${'a'.repeat(64)}` },
      'passage-rule-unsupported',
    ],
  ] as const)('%s', async (_label, options, reason) => {
    const w = await passageWorld({ judge: null, ...options });
    await w.pass();
    const pending = (await w.anchor()).pendingRevalidation;
    expect(pending?.reason).toBe(reason);
    expect(pending?.raisedBy).toEqual(rule('passage-seed-unresolved'));
  });
});

describe('rule transcript-seed-unresolved v1: a transcript that is not the version its citation was drafted from', () => {
  it('withholds with an empty anchor, settled by first-sighting, the hold raised by this rule', async () => {
    const vault = new MemoryVault();
    const transcript = 'Course A/Lecture 9/transcript.txt';
    vault.files.set(transcript, transcriptOf(LECTURE));
    vault.files.set(
      'Course A/Lecture 9/transcript (Olea).md',
      homeNote('Invented lecture', ['q-t']),
    );
    await citeTranscriptPart(vault, 'q-t', transcript, 2);
    vault.files.set(transcript, transcriptOf([cue(90), ...LECTURE]));
    const h = harness({ transcriptPartGrain: true });
    await h.pass(vault);
    const anchor = (await h.store.loadAll()).get('q-t');
    expect(anchor?.text).toBe('');
    expect(anchor?.settledBy).toEqual(rule('first-sighting'));
    expect(anchor?.pendingRevalidation?.raisedBy).toEqual(rule('transcript-seed-unresolved'));
  });
});

describe('rule source-bytes-changed v1 and rule landed-source-rewrite v1: a cited file checked by its bytes', () => {
  async function heldBinary() {
    const vault = new binary.MemoryVaultSource();
    const v1 = binary.versionBytes('one');
    const v2 = binary.versionBytes('two');
    binary.seedQuestions(vault, [{ id: 'q-file', page: 2, revision: await binary.digestOf(v1) }]);
    vault.binaries.set(binary.DOC, v1);
    const h = binary.setup(vault);
    await h.trigger.tick(vault, h.actions);
    vault.binaries.set(binary.DOC, v2);
    await h.trigger.tick(vault, h.actions);
    return { vault, h, v1, v2 };
  }

  it('source-bytes-changed: bytes that differ from the recorded revision raise the hold', async () => {
    const { h } = await heldBinary();
    const anchor = (await h.store.loadAll()).get('q-file');
    expect(anchor?.pendingRevalidation?.reason).toBe('source-revision-changed');
    expect(anchor?.pendingRevalidation?.raisedBy).toEqual(rule('source-bytes-changed'));
    expect(anchor?.settledBy).toEqual(rule('first-sighting'));
  });

  it('bytes back at the recorded revision lift the hold, and the lift records nothing ([D-522])', async () => {
    const { vault, h, v1 } = await heldBinary();
    vault.binaries.set(binary.DOC, v1);
    await h.trigger.tick(vault, h.actions);
    const anchor = (await h.store.loadAll()).get('q-file');
    expect(anchor?.pendingRevalidation).toBeUndefined();
    expect(anchor?.settledBy).toEqual(rule('first-sighting'));
  });

  it('landed-source-rewrite: text landing for the held bytes rewrites the question, decided by this rule', async () => {
    const { vault, h, v2 } = await heldBinary();
    const result = await h.trigger.onSourceUnitsLanded(
      vault,
      h.actions,
      binary.unitsOf({ 2: ['An invented new line on page two.'] }),
      new Map([[binary.DOC, await binary.digestOf(v2)]]),
    );
    expect(result.rewritten).toBe(1);
    expect(h.judge.judge).not.toHaveBeenCalled();
    const pending = (await h.store.loadAll()).get('q-file')?.pendingRevalidation;
    expect(pending?.raisedBy).toEqual(rule('source-bytes-changed'));
    expect(pending?.decidedBy).toEqual(rule('landed-source-rewrite'));
  });

  it('text landing for other bytes decides nothing', async () => {
    const { vault, h } = await heldBinary();
    await h.trigger.onSourceUnitsLanded(
      vault,
      h.actions,
      binary.unitsOf({ 2: ['An invented new line on page two.'] }),
      new Map([[binary.DOC, await binary.digestOf(binary.versionBytes('three'))]]),
    );
    expect((await h.store.loadAll()).get('q-file')?.pendingRevalidation?.decidedBy).toBeUndefined();
  });
});

describe('rule transcript-part-unrelocatable v1: a part-named question whose part cannot be relocated', () => {
  it('is withheld as passage-unresolved, then rewritten, decided by this rule and not by the judge', async () => {
    const vault = new MemoryVault();
    const transcript = 'Course A/Lecture 9/transcript.txt';
    vault.files.set(transcript, transcriptOf(LECTURE));
    vault.files.set(
      'Course A/Lecture 9/transcript (Olea).md',
      homeNote('Invented lecture', ['q-four']),
    );
    await citeTranscriptPart(vault, 'q-four', transcript, 4);
    const h = harness({ transcriptPartGrain: true });
    await h.pass(vault);
    // Part 4 now stands twice: it cannot be relocated.
    vault.files.set(transcript, transcriptOf([...LECTURE, ...partCues(4)]));
    await h.pass(vault);
    expect(h.judge.judge).not.toHaveBeenCalled();
    expect(h.actions.enqueue).toHaveBeenCalledTimes(1);
    const pending = (await h.store.loadAll()).get('q-four')?.pendingRevalidation;
    expect(pending?.reason).toBe('passage-ambiguous');
    expect(pending?.raisedBy).toEqual(rule('passage-unresolved'));
    expect(pending?.decidedBy).toEqual(rule('transcript-part-unrelocatable'));
  });
});

// ---------------------------------------------------------------------------------------------
// Citation level: who decided the rewrite
// ---------------------------------------------------------------------------------------------

describe('the judge decides a rewrite: decidedBy names the judge with the stamp its answer carried', () => {
  it.each([
    ['a changed claim, stamped', workerJudge(true, STAMP), STAMP, 'revised'],
    ['the same claim, stamped', workerJudge(false, STAMP), STAMP, 'refreshed'],
    ['a changed claim, no stamp carried', workerJudge(true, undefined, true), null, 'revised'],
    ['a changed claim, an unreadable stamp', workerJudge(true, { modelId: '' }), null, 'revised'],
  ] as const)('%s', async (_label, judge, stamp, kind) => {
    const w = wholeWorld(adaptMaterialityJudgeAsRevisionJudge(judge));
    await w.pass();
    w.vault.files.set(W_NOTE, wholeNote(W_CHANGED));
    const report = await w.pass();
    expect(report[kind]).toBe(1);
    expect(w.acts.enqueue).toHaveBeenCalledTimes(1);
    expect(w.acts.suspend).toHaveBeenCalledTimes(1);
    const pending = (await w.anchor()).pendingRevalidation;
    expect(pending?.raisedBy).toEqual(rule('cited-text-differs'));
    expect(pending?.decidedBy).toEqual(judgeProducer(stamp));
    expect(readStoredProducer(pending?.decidedBy)).toEqual({
      state: 'known',
      producer: judgeProducer(stamp),
    });
  });

  it('at passage grain, the judged passage rewrite names the judge too', async () => {
    const w = await passageWorld({ judge: judgeSaying(true, STAMP) });
    await w.pass();
    w.vault.files.set(
      P_SOURCE,
      sourceNote(LINE_A, `${LINE_B}\n${LINE_C.replace('pavo', 'kiri')}`, LINE_D),
    );
    await w.pass();
    expect((await w.anchor()).pendingRevalidation?.decidedBy).toEqual(judgeProducer(STAMP));
  });

  it('a late answer for an older version writes no decidedBy', async () => {
    const host = new DataHost();
    const store = new ObsidianCitationHashStore(host);
    const judge: RevisionJudgePort = {
      judge: vi.fn(async () => {
        // An overlapping pass has already raised the fact for a newer edit.
        await store.setPendingRevalidation(W_ID, 'coined-newer-hash', 999);
        return { material: true, reason: 'coined', stamp: STAMP };
      }),
    };
    const w = wholeWorld(judge, store);
    await w.trigger.tick(w.vault, w.acts);
    w.vault.files.set(W_NOTE, wholeNote(W_CHANGED));
    const report = await w.trigger.tick(w.vault, w.acts);
    expect(report.staleResultDiscarded).toBe(1);
    expect(w.acts.enqueue).not.toHaveBeenCalled();
    const pending = (await store.loadAll()).get(W_ID)?.pendingRevalidation;
    expect(pending?.sinceContentHash).toBe('coined-newer-hash');
    expect(pending?.decidedBy).toBeUndefined();
  });

  it('an in-session retry of a confirmed rewrite writes the decision the first attempt could not', async () => {
    const host = new DataHost();
    const real = new ObsidianCitationHashStore(host);
    let failDecision = true;
    const store: CitationHashStore = Object.assign(
      Object.create(real) as ObsidianCitationHashStore,
      {
        recordDecision: async (id: string, hash: string, decidedBy: PersistedStageProducer) => {
          if (failDecision) {
            failDecision = false;
            throw new Error('coined write failure');
          }
          return real.recordDecision(id, hash, decidedBy);
        },
      },
    );
    const judge = judgeSaying(true, STAMP);
    const w = wholeWorld(judge, store);
    await w.trigger.tick(w.vault, w.acts);
    w.vault.files.set(W_NOTE, wholeNote(W_CHANGED));
    vi.spyOn(console, 'error').mockImplementation(() => {});
    w.acts.enqueue.mockRejectedValueOnce(new Error('coined queue failure'));
    await w.trigger.tick(w.vault, w.acts);
    expect((await real.loadAll()).get(W_ID)?.pendingRevalidation?.decidedBy).toBeUndefined();
    await w.trigger.tick(w.vault, w.acts);
    expect(judge.judge).toHaveBeenCalledTimes(1);
    expect(w.acts.suspend).toHaveBeenCalledTimes(1);
    expect((await real.loadAll()).get(W_ID)?.pendingRevalidation?.decidedBy).toEqual(
      judgeProducer(STAMP),
    );
  });
});

// ---------------------------------------------------------------------------------------------
// The store: carries and the decision compare-and-set
// ---------------------------------------------------------------------------------------------

describe('the citation store carries who raised and decided a difference, and writes a decision once', () => {
  const ANCHOR = { sourcePath: 'Coined course/a.md', text: 'coined text', conceptIds: [] };
  const UNREADABLE = { kind: 'code', rule: 'Not Kebab', ruleVersion: 0 };

  async function storeWith(record: Record<string, unknown>) {
    const host = new DataHost();
    host.blob = { [CITATION_ANCHOR_STORAGE_KEY]: { 'q-s': record } };
    const store = new ObsidianCitationHashStore(host);
    const raw = (): Record<string, unknown> =>
      (host.blob[CITATION_ANCHOR_STORAGE_KEY] as Record<string, Record<string, unknown>>)[
        'q-s'
      ] as Record<string, unknown>;
    return { host, store, raw };
  }

  it('a new difference is raised by the given rule; the same difference keeps its first value', async () => {
    const { store, raw } = await storeWith({ ...ANCHOR, settledBy: rule('first-sighting') });
    await store.setPendingRevalidation('q-s', 'h1', 5, undefined, rule('cited-text-differs'));
    await store.setPendingRevalidation('q-s', 'h1', 6, undefined, rule('passage-unresolved'));
    const pending = raw().pendingRevalidation as Record<string, unknown>;
    expect(pending.raisedBy).toEqual(rule('cited-text-differs'));
    expect(raw().settledBy).toEqual(rule('first-sighting'));
  });

  it('a dispatch record for the same difference keeps raisedBy and decidedBy verbatim, unreadable ones included', async () => {
    const { store, raw } = await storeWith({
      ...ANCHOR,
      settledBy: UNREADABLE,
      pendingRevalidation: {
        sinceContentHash: 'h1',
        since: 5,
        raisedBy: UNREADABLE,
        decidedBy: judgeProducer(STAMP),
      },
    });
    await store.recordDispatch('q-s', 'h1', 7, false, rule('cited-text-differs'));
    const pending = raw().pendingRevalidation as Record<string, unknown>;
    expect(pending.dispatchedAt).toBe(7);
    expect(pending.raisedBy).toEqual(UNREADABLE);
    expect(pending.decidedBy).toEqual(judgeProducer(STAMP));
    expect(raw().settledBy).toEqual(UNREADABLE);
  });

  it('a dispatch record for a new difference is raised by the given rule and decided by no one', async () => {
    const { store, raw } = await storeWith({
      ...ANCHOR,
      pendingRevalidation: { sinceContentHash: 'h0', since: 5, decidedBy: judgeProducer(STAMP) },
    });
    await store.recordDispatch('q-s', 'h1', 7, false, rule('cited-text-differs'));
    const pending = raw().pendingRevalidation as Record<string, unknown>;
    expect(pending.raisedBy).toEqual(rule('cited-text-differs'));
    expect('decidedBy' in pending).toBe(false);
  });

  it('a fact raised before this change gains no key from a dispatch record or a re-stated hold', async () => {
    const { store, raw } = await storeWith({
      ...ANCHOR,
      pendingRevalidation: { sinceContentHash: 'h1', since: 5 },
    });
    await store.recordDispatch('q-s', 'h1', 7, false, rule('cited-text-differs'));
    await store.setPendingRevalidation('q-s', 'h1', 8, undefined, rule('cited-text-differs'));
    const pending = raw().pendingRevalidation as Record<string, unknown>;
    expect('raisedBy' in pending).toBe(false);
    expect('decidedBy' in pending).toBe(false);
    expect('settledBy' in raw()).toBe(false);
  });

  it('a decision is written only while the fact names its difference, and the first one stands', async () => {
    const { store, raw } = await storeWith({
      ...ANCHOR,
      pendingRevalidation: { sinceContentHash: 'h1', since: 5 },
    });
    expect(await store.recordDecision('q-s', 'h-older', judgeProducer(STAMP))).toBe(false);
    expect('decidedBy' in (raw().pendingRevalidation as Record<string, unknown>)).toBe(false);
    expect(await store.recordDecision('q-s', 'h1', judgeProducer(STAMP))).toBe(true);
    expect(await store.recordDecision('q-s', 'h1', rule('landed-source-rewrite'))).toBe(false);
    expect((raw().pendingRevalidation as Record<string, unknown>).decidedBy).toEqual(
      judgeProducer(STAMP),
    );
    expect(await store.recordDecision('q-absent', 'h1', judgeProducer(STAMP))).toBe(false);
  });

  it('an unreadable decision already stored stands', async () => {
    const { store, raw } = await storeWith({
      ...ANCHOR,
      pendingRevalidation: { sinceContentHash: 'h1', since: 5, decidedBy: UNREADABLE },
    });
    expect(await store.recordDecision('q-s', 'h1', judgeProducer(STAMP))).toBe(false);
    expect((raw().pendingRevalidation as Record<string, unknown>).decidedBy).toEqual(UNREADABLE);
  });

  it('re-arming a spent retry carries raisedBy and decidedBy; a fact that had none gains none', () => {
    const spent: PendingRevalidation = {
      sinceContentHash: 'h1',
      since: 5,
      dispatchedAt: 6,
      retriedAt: 7,
      raisedBy: rule('cited-text-differs'),
      decidedBy: UNREADABLE as unknown as PersistedStageProducer,
    };
    expect(rearmSpentRetry(spent, 'h1')).toEqual({
      sinceContentHash: 'h1',
      since: 5,
      dispatchedAt: 6,
      raisedBy: rule('cited-text-differs'),
      decidedBy: UNREADABLE,
    });
    const legacy = rearmSpentRetry({ sinceContentHash: 'h1', since: 5, retriedAt: 7 }, 'h1');
    expect(legacy !== null && 'raisedBy' in legacy).toBe(false);
    expect(legacy !== null && 'decidedBy' in legacy).toBe(false);
  });

  it('pin: the production store implements recordDecision, and main.ts hands that store to the citation pass', () => {
    expect(typeof new ObsidianCitationHashStore(new DataHost()).recordDecision).toBe('function');
    const main = readFileSync(
      fileURLToPath(new URL('../../../src/main.ts', import.meta.url)),
      'utf8',
    );
    expect(main).toContain('this.citationHashStore = new ObsidianCitationHashStore(this);');
    expect(main).toMatch(/buildCitationRevisionWiring\(\{\s*store: this\.citationHashStore,/);
  });
});

describe('citation level: a write that keeps the settled anchor carries who settled it', () => {
  it('a rename Olea saw keeps settledBy and the hold as they were; an anchor with none gains none', async () => {
    const vault = new MemoryVault();
    const transcript = 'Course A/Lecture 9/transcript.txt';
    vault.files.set(transcript, transcriptOf(LECTURE));
    vault.files.set(
      'Course A/Lecture 9/transcript (Olea).md',
      homeNote('Invented lecture', ['q-t', 'q-u']),
    );
    await citeTranscriptPart(vault, 'q-t', transcript, 2);
    await citeTranscriptPart(vault, 'q-u', transcript, 3);
    const h = harness({ transcriptPartGrain: true });
    await h.pass(vault);
    // q-u as an anchor written before this change: no settledBy.
    const before = (await h.store.loadAll()).get('q-u');
    if (before === undefined) throw new Error('no anchor');
    const { settledBy: _dropped, ...legacy } = before;
    await h.store.save('q-u', legacy);
    const moved = 'Course A/Lecture 9/moved/transcript.txt';
    vault.move(transcript, moved);
    expect(await h.trigger.onSourceRenamed(vault, transcript, moved)).toBe(2);
    const after = await h.store.loadAll();
    expect(after.get('q-t')?.sourcePath).toBe(moved);
    expect(after.get('q-t')?.settledBy).toEqual(rule('first-sighting'));
    expect(after.get('q-u')?.sourcePath).toBe(moved);
    expect('settledBy' in (after.get('q-u') ?? {})).toBe(false);
  });
});

// ---------------------------------------------------------------------------------------------
// Records written before this change read unknown, never guessed; malformed values change nothing
// ---------------------------------------------------------------------------------------------

describe('a record written before this change reads unknown, never guessed', () => {
  it('a hash record with a revision count and a verdict date but no provenance reads unknown', async () => {
    const host = new DataHost();
    host.blob = {
      [MATERIALITY_HASH_STORAGE_KEY]: {
        [NOTE]: { ...(await settledRecord(BASE)), revision: 7, lastVerdictAt: 1_700_000_000_000 },
      },
    };
    const record = await new ObsidianMaterialityHashStore(host).load(NOTE);
    expect(record?.revision).toBe(7);
    expect(readStoredProducer(record?.settledBy)).toEqual({ state: 'unknown' });
  });

  it('an anchor and its hold written before this change read unknown', async () => {
    const host = new DataHost();
    host.blob = {
      [CITATION_ANCHOR_STORAGE_KEY]: {
        'q-old': {
          sourcePath: 'Coined course/a.md',
          text: 'coined text',
          conceptIds: [],
          pendingRevalidation: { sinceContentHash: 'h1', since: 5, dispatchedAt: 6, retriedAt: 7 },
        },
      },
    };
    const anchor = (await new ObsidianCitationHashStore(host).loadAll()).get('q-old');
    expect(readStoredProducer(anchor?.settledBy)).toEqual({ state: 'unknown' });
    expect(readStoredProducer(anchor?.pendingRevalidation?.raisedBy)).toEqual({ state: 'unknown' });
    expect(readStoredProducer(anchor?.pendingRevalidation?.decidedBy)).toEqual({
      state: 'unknown',
    });
  });

  it('a malformed value drops no record and no hold, and the registry and the presentation check read exactly as before', async () => {
    const registryNote = 'Coined course/Registry note.md';
    const vault = memoryVault({
      [registryNote]: [
        '---',
        'topic: [Invented concept]',
        'course: TESTC101',
        '---',
        '',
        'Invented front text::Invented back text',
        '',
      ].join('\n'),
    });
    const { records } = await enumerateVaultInstruments(vault);
    const firstId = records[0]?.instrumentId;
    if (firstId === undefined) throw new Error('expected a fixture instrument');
    const cardId: string = firstId;
    const clean = {
      [MATERIALITY_HASH_STORAGE_KEY]: { [NOTE]: await settledRecord(BASE) },
      [CITATION_ANCHOR_STORAGE_KEY]: {
        [cardId]: {
          sourcePath: registryNote,
          text: 'coined text',
          conceptIds: [],
          pendingRevalidation: { sinceContentHash: 'h1', since: 5, dispatchedAt: 6, retriedAt: 7 },
        },
        'q-other': {
          sourcePath: registryNote,
          text: 'coined text',
          conceptIds: [],
          pendingRevalidation: { sinceContentHash: 'h2', since: 5 },
        },
      },
    };
    const malformedValues: unknown[] = [
      'formatting-only',
      null,
      42,
      [{ kind: 'code', rule: 'formatting-only', ruleVersion: 1 }],
      { kind: 'code', rule: 'Not Kebab', ruleVersion: 0 },
      { kind: 'model', seat: 'third', taskId: '', stamp: 'x' },
    ];
    async function readings(blob: Record<string, unknown>) {
      const host = new DataHost();
      host.blob = structuredClone(blob);
      const hashRecord = await new ObsidianMaterialityHashStore(host).load(NOTE);
      const store = new ObsidianCitationHashStore(host);
      const anchors = await store.loadAll();
      const state = await createLocalRegistryProvider({
        vault,
        deviceId: 'olea-testdevice1',
        settingsHost: new DataHost(),
        now: () => new Date('2026-02-01T12:00:00Z'),
        editPort: { edit: async () => {} },
        citationHashStore: store,
      }).load();
      if (state.kind !== 'model') throw new Error(`expected a model, got ${state.kind}`);
      const check = sourceCheckAtPresentation(store);
      return {
        hashRecordKept: hashRecord !== null,
        anchorIds: [...anchors.keys()].sort(),
        holds: [...anchors].map(([id, a]) => [id, a.pendingRevalidation?.sinceContentHash]),
        current: await store.isPendingRevalidationCurrent(cardId, 'h1'),
        withheld: [
          ...(await resolveCitationPendingRevalidation(store, [cardId, 'q-other'])),
        ].sort(),
        presentation: [await check(cardId), await check('q-other')],
        registry: state.suspectInstruments,
      };
    }
    const expected = await readings(clean);
    expect(expected.registry.pendingRevalidation).toEqual([
      { instrumentId: cardId, deferred: true },
    ]);
    for (const bad of malformedValues) {
      const blob = structuredClone(clean) as unknown as {
        [MATERIALITY_HASH_STORAGE_KEY]: Record<string, Record<string, unknown>>;
        [CITATION_ANCHOR_STORAGE_KEY]: Record<
          string,
          Record<string, unknown> & { pendingRevalidation: Record<string, unknown> }
        >;
      };
      (blob[MATERIALITY_HASH_STORAGE_KEY][NOTE] as Record<string, unknown>).settledBy = bad;
      for (const anchor of Object.values(blob[CITATION_ANCHOR_STORAGE_KEY])) {
        anchor.settledBy = bad;
        anchor.pendingRevalidation.raisedBy = bad;
        anchor.pendingRevalidation.decidedBy = bad;
      }
      expect(await readings(blob)).toEqual(expected);
      const host = new DataHost();
      host.blob = blob;
      const anchor = (await new ObsidianCitationHashStore(host).loadAll()).get(cardId);
      expect(readStoredProducer(anchor?.settledBy).state).toBe('unrecognised');
      expect(readStoredProducer(anchor?.pendingRevalidation?.raisedBy).state).toBe('unrecognised');
      expect(readStoredProducer(anchor?.pendingRevalidation?.decidedBy).state).toBe('unrecognised');
    }
  });
});

// ---------------------------------------------------------------------------------------------
// Provenance changes nothing she sees or does
// ---------------------------------------------------------------------------------------------

/** The production store with every provenance argument and field stripped: the world before this change. */
function withoutProvenance(inner: ObsidianCitationHashStore): CitationHashStore {
  return {
    loadAll: () => inner.loadAll(),
    save: (id, record) => {
      const { settledBy: _settledBy, ...rest } = record;
      return inner.save(id, rest);
    },
    remove: (id) => inner.remove(id),
    setPendingRevalidation: (id, hash, since, reason) =>
      inner.setPendingRevalidation(id, hash, since, reason),
    isPendingRevalidationCurrent: (id, hash) => inner.isPendingRevalidationCurrent(id, hash),
    recordDispatch: (id, hash, at, retry) => inner.recordDispatch(id, hash, at, retry),
    grantExplicitRetry: (id, hash) => inner.grantExplicitRetry(id, hash),
  };
}

describe('provenance changes nothing she sees or does', () => {
  /** The same edits, run once with provenance written and once without. */
  async function citationRun(strip: boolean) {
    const vault = new MemoryVault();
    vault.files.set(P_HOME, homeNote('Invented kalomi topic', [P_ID]));
    vault.files.set(P_SOURCE, SOURCE_TEXT);
    vault.files.set(P_OTHER, sourceNote('An invented venido opening.'));
    vault.files.set(
      citationStorePath(P_ID),
      sidecar({
        instrumentId: P_ID,
        sourcePath: P_SOURCE,
        page: 1,
        passageDigest: await digestPassage(PASSAGE),
      }),
    );
    vault.files.set(W_NOTE, wholeNote(W_PARAGRAPH));
    vault.files.set(
      citationStorePath(W_ID),
      sidecar({ instrumentId: W_ID, sourcePath: W_NOTE, page: 1 }),
    );
    const host = new DataHost();
    const real = new ObsidianCitationHashStore(host);
    const store = strip ? withoutProvenance(real) : real;
    const judge = judgeSaying(true, STAMP);
    const trigger = new CitationRevisionTrigger({ store, judge, clock: { now: () => 1_000 } });
    const acts = actionsDouble();
    const ids = [P_ID, W_ID];
    const seen: unknown[] = [];
    const observe = async () => {
      const check = sourceCheckAtPresentation(real);
      seen.push({
        withheld: [...(await resolveCitationPendingRevalidation(real, ids))].sort(),
        presentation: [await check(P_ID), await check(W_ID)],
      });
    };
    const steps: Array<() => void> = [
      () => {},
      () => vault.files.set(P_SOURCE, sourceNote(LINE_A, `${LINE_B}\n  ${LINE_C}  `, LINE_D)),
      () => {
        vault.files.set(P_SOURCE, sourceNote(LINE_A, LINE_D));
        vault.files.set(
          P_OTHER,
          sourceNote('An invented venido opening.', `${LINE_B}\n  ${LINE_C}  `),
        );
      },
      () => vault.files.set(P_OTHER, sourceNote('An invented venido opening.')),
      () =>
        vault.files.set(
          P_OTHER,
          sourceNote('An invented venido opening.', `${LINE_B}\n  ${LINE_C}  `),
        ),
      () => vault.files.set(W_NOTE, wholeNote(W_PARAGRAPH.replace('tamo gate', '**tamo** gate'))),
      () => vault.files.set(W_NOTE, wholeNote(W_CHANGED)),
    ];
    for (const step of steps) {
      step();
      seen.push(await trigger.tick(vault, acts));
      await observe();
    }
    return {
      seen,
      enqueued: acts.enqueue.mock.calls,
      suspended: acts.suspend.mock.calls,
      judged: judge.judge.mock.calls,
      stored: withoutProvenanceKeys(host.blob),
      blob: host.blob,
    };
  }

  it('the same edits withhold, rewrite and show the same questions, with or without provenance written', async () => {
    const withIt = await citationRun(false);
    const without = await citationRun(true);
    expect(sameConcepts(withIt.seen)).toEqual(sameConcepts(without.seen));
    expect(sameConcepts(withIt.enqueued)).toEqual(sameConcepts(without.enqueued));
    expect(sameConcepts(withIt.suspended)).toEqual(sameConcepts(without.suspended));
    expect(withIt.judged).toEqual(without.judged);
    expect(withIt.enqueued).toHaveLength(1);
    // Every stored value matches once the provenance keys are set aside, and the run did write them.
    expect(sameConcepts(withIt.stored)).toEqual(sameConcepts(without.stored));
    expect(JSON.stringify(withIt.blob)).toContain('settledBy');
    expect(JSON.stringify(withIt.blob)).toContain('decidedBy');
    expect(JSON.stringify(without.blob)).not.toMatch(/settledBy|raisedBy|decidedBy/);
  });

  it('the same saves give the same file-level results, with or without provenance written', async () => {
    async function fileRun(strip: boolean) {
      const w = fileWorld();
      await w.hashStore.save(await settledRecord(BASE));
      const store: MaterialityHashStore = strip
        ? {
            load: (path) => w.hashStore.load(path),
            save: (record) => {
              const { settledBy: _settledBy, ...rest } = record;
              return w.hashStore.save(rest);
            },
          }
        : w.hashStore;
      const trigger = w.start(workerJudge(true, STAMP), store);
      const results: MaterialityEvaluationResult[] = [];
      results.push(await trigger.evaluate(NOTE, REFLOWED, BASE));
      results.push(await trigger.evaluate(NOTE, CHANGED, REFLOWED));
      results.push(await trigger.evaluate(NOTE, SMALL, CHANGED));
      results.push(await trigger.evaluate(NOTE, CHANGED, SMALL));
      results.push(await trigger.evaluate('Coined course/Empty.md', ''));
      return { results, stored: withoutProvenanceKeys(w.host.blob), blob: w.host.blob };
    }
    const withIt = await fileRun(false);
    const without = await fileRun(true);
    expect(withIt.results).toEqual(without.results);
    expect(withIt.stored).toEqual(without.stored);
    expect(JSON.stringify(withIt.blob)).toContain('settledBy');
  });

  it('a failed provenance write changes no outcome, and is logged by error name only', async () => {
    class CoinedProvenanceError extends Error {
      override name = 'CoinedProvenanceError';
    }
    const secret = 'coined detail that must not be logged';
    async function run(failing: boolean) {
      const host = new DataHost();
      const real = new ObsidianCitationHashStore(host);
      const store: CitationHashStore = failing
        ? Object.assign(Object.create(real) as ObsidianCitationHashStore, {
            recordDecision: async () => {
              throw new CoinedProvenanceError(secret);
            },
          })
        : real;
      const w = wholeWorld(judgeSaying(true, STAMP), store);
      await w.trigger.tick(w.vault, w.acts);
      w.vault.files.set(W_NOTE, wholeNote(W_CHANGED));
      const report = await w.trigger.tick(w.vault, w.acts);
      return {
        report,
        enqueued: w.acts.enqueue.mock.calls,
        suspended: w.acts.suspend.mock.calls,
        stored: withoutProvenanceKeys(host.blob),
        decidedBy: (await real.loadAll()).get(W_ID)?.pendingRevalidation?.decidedBy,
      };
    }
    const ok = await run(false);
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
    const failed = await run(true);
    expect(failed.report).toEqual(ok.report);
    expect(sameConcepts(failed.enqueued)).toEqual(sameConcepts(ok.enqueued));
    expect(sameConcepts(failed.suspended)).toEqual(sameConcepts(ok.suspended));
    expect(failed.suspended).toHaveLength(1);
    expect(sameConcepts(failed.stored)).toEqual(sameConcepts(ok.stored));
    expect(ok.decidedBy).toEqual(judgeProducer(STAMP));
    expect(failed.decidedBy).toBeUndefined();
    const logged = errors.mock.calls.flat();
    expect(
      logged.some((arg) => typeof arg === 'string' && arg.includes('CoinedProvenanceError')),
    ).toBe(true);
    expect(logged.some((arg) => arg instanceof Error)).toBe(false);
    expect(JSON.stringify(logged)).not.toContain(secret);
  });

  it('every stored entry the change does not touch is byte-identical', async () => {
    const untouchedNote = 'Coined course/Untouched.md';
    const host = new DataHost();
    const untouchedAnchor = {
      sourcePath: 'Coined course/Gone.md',
      text: 'coined text of a question no longer in the vault',
      passageDigest: `p1:${'b'.repeat(64)}`,
      conceptIds: ['coined-concept'],
      pendingRevalidation: { sinceContentHash: 'h9', since: 3, dispatchedAt: 4 },
    };
    host.blob = {
      someOtherStore: { kept: [1, 'two', { three: null }] },
      [MATERIALITY_HASH_STORAGE_KEY]: {
        [untouchedNote]: { ...(await settledRecord(BASE)), path: untouchedNote },
        [NOTE]: await settledRecord(BASE),
      },
      [CITATION_ANCHOR_STORAGE_KEY]: { 'q-untouched': untouchedAnchor },
    };
    const before = JSON.parse(JSON.stringify(host.blob)) as Record<string, Record<string, unknown>>;

    // A formatting-only save on NOTE, through the production hash store.
    const trigger = new MaterialityTrigger({
      store: new ObsidianMaterialityHashStore(host),
      clock: { now: () => T0 },
      judge: answering({ material: true }),
    });
    expect((await trigger.evaluate(NOTE, REFLOWED)).kind).toBe('formatting-only');
    // A citation pass that seeds a new question beside the untouched one.
    const vault = new MemoryVault();
    vault.files.set(W_NOTE, wholeNote(W_PARAGRAPH));
    vault.files.set(
      citationStorePath(W_ID),
      sidecar({ instrumentId: W_ID, sourcePath: W_NOTE, page: 1 }),
    );
    await new CitationRevisionTrigger({
      store: new ObsidianCitationHashStore(host),
      judge: null,
      clock: { now: () => 1_000 },
    }).tick(vault, actionsDouble());

    const after = host.blob as Record<string, Record<string, unknown>>;
    expect(JSON.stringify(after.someOtherStore)).toBe(JSON.stringify(before.someOtherStore));
    expect(JSON.stringify(after[MATERIALITY_HASH_STORAGE_KEY]?.[untouchedNote])).toBe(
      JSON.stringify(before[MATERIALITY_HASH_STORAGE_KEY]?.[untouchedNote]),
    );
    expect(JSON.stringify(after[CITATION_ANCHOR_STORAGE_KEY]?.['q-untouched'])).toBe(
      JSON.stringify(before[CITATION_ANCHOR_STORAGE_KEY]?.['q-untouched']),
    );
    // The touched entries are the ones the change wrote.
    const touchedRecord = after[MATERIALITY_HASH_STORAGE_KEY]?.[NOTE] as
      | MaterialityRecord
      | undefined;
    const touchedAnchor = after[CITATION_ANCHOR_STORAGE_KEY]?.[W_ID] as
      | CitationAnchorRecord
      | undefined;
    expect(touchedRecord?.settledBy).toEqual(rule('formatting-only'));
    expect(touchedAnchor?.settledBy).toEqual(rule('first-sighting'));
  });
});

// ---------------------------------------------------------------------------------------------
// The rule table itself
// ---------------------------------------------------------------------------------------------

describe('the rule table', () => {
  it('every rule starts at version 1, and each stored producer reads back as itself', () => {
    const ids = Object.keys(VERDICT_CODE_RULES) as (keyof typeof VERDICT_CODE_RULES)[];
    expect(ids).toHaveLength(15);
    for (const id of ids) {
      expect(VERDICT_CODE_RULES[id]).toBe(1);
      expect(codeRule(id)).toEqual(rule(id));
      expect(readStoredProducer(JSON.parse(JSON.stringify(codeRule(id))))).toEqual({
        state: 'known',
        producer: rule(id),
      });
    }
  });

  it('codeRule returns a fresh object each time, so no record shares one', () => {
    expect(codeRule('formatting-only')).not.toBe(codeRule('formatting-only'));
  });
});
