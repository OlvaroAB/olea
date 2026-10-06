/**
 * `[D-477]` (`ol-egov.141.89.7.53`), built under `ol-egov.141.89.7.43`: which stored Outcome record
 * each extracted candidate is, when one source block states several outcomes. The pure rule
 * (`./source-identity.ts`) and the store that applies it (`./store.ts`'s `resolveOutcomes`).
 *
 * Every course, label, path and count here is invented.
 */

import { describe, expect, it } from 'vitest';
import { OverlapVault } from '../../test/support/overlap-vault.js';
import type { ListOptions, Unsubscribe, VaultPath, VaultSource } from '../vault/types.js';
import {
  type KeyedOutcomeRecord,
  matchOutcomeCandidates,
  normalizeOutcomeLabel,
  OUTCOME_LABEL_NEAR_MATCH_THRESHOLD,
  outcomeLabelDigest,
  outcomeLabelJaccard,
} from './source-identity.js';
import {
  isOutcomeRecord,
  OUTCOME_STORE_FOLDER,
  outcomeRecordPath,
  type ResolveOutcomeInput,
  resolveOutcome,
  resolveOutcomes,
} from './store.js';
import type { OutcomeRecord } from './types.js';

const DOC = '02 Assignments/Gadget objectives.pdf' as VaultPath;
const PROVENANCE = { promptVersion: 'v1', modelVersion: 'model-a' };
const NOW = () => '2026-10-06';

function input(blockIndex: number, label: string, path: VaultPath = DOC): ResolveOutcomeInput {
  return { courses: ['COURSEA'], source: { path, blockIndex }, label, provenance: PROVENANCE };
}

/** A fresh, deterministic id source: `n1`, `n2`, ... in mint order. */
function counter(): () => string {
  let n = 0;
  return () => `n${++n}`;
}

function recordFiles(vault: { paths(): readonly VaultPath[] }): readonly VaultPath[] {
  return vault.paths().filter((path) => path.startsWith(`${OUTCOME_STORE_FOLDER}/`));
}

/** A record written before `[D-477]`: no `labelDigest` in its source. */
function legacyRecord(id: string, blockIndex: number, label: string, mintedAt = '2026-09-20') {
  const record: OutcomeRecord = {
    id: `outcome-key1:${id}`,
    courses: ['COURSEA'],
    source: { path: DOC, blockIndex },
    label,
    conceptKeys: [],
    status: 'active',
    provenance: PROVENANCE,
    mintedAt,
    schemaVersion: 1,
  };
  return { path: outcomeRecordPath(record.id), content: `${JSON.stringify(record, null, 2)}\n` };
}

const VERBS = [
  'Explain',
  'Describe',
  'Compare',
  'Evaluate',
  'Outline',
  'Identify',
  'Apply',
  'Assess',
];
const PARTS = [
  'widget crank',
  'gadget lid',
  'sprocket hinge',
  'lever spring',
  'gear housing',
  'pulley belt',
];

/** 48 invented outcomes: eight on each of six blocks. */
function fortyEight(): readonly ResolveOutcomeInput[] {
  return PARTS.flatMap((part, blockIndex) =>
    VERBS.map((verb) => input(blockIndex, `${verb} the ${part}`)),
  );
}

/**
 * An in-memory vault whose every call waits a seeded number of turns (0 to 20 microtasks; a write
 * also 0 or 1 macrotask, so it can land after a later read), so overlapping calls interleave
 * differently per seed and identically for one seed.
 */
class JitterVault implements VaultSource {
  private readonly files = new Map<VaultPath, string>();
  private state: number;

  constructor(seed: number) {
    this.state = seed >>> 0;
  }

  private next(): number {
    this.state = (this.state * 1664525 + 1013904223) >>> 0;
    return this.state;
  }

  private async jitter(): Promise<void> {
    const turns = this.next() % 21;
    for (let i = 0; i < turns; i++) await Promise.resolve();
  }

  async list(options: ListOptions = {}): Promise<readonly VaultPath[]> {
    await this.jitter();
    return [...this.files.keys()]
      .filter((path) => options.under === undefined || path.startsWith(`${options.under}/`))
      .filter(
        (path) =>
          options.extensions === undefined ||
          options.extensions.some((ext) => path.endsWith(`.${ext}`)),
      )
      .sort();
  }

  async read(path: VaultPath): Promise<string> {
    await this.jitter();
    const content = this.files.get(path);
    if (content === undefined) throw new Error(`JitterVault: no such file: ${path}`);
    return content;
  }

  async readBinary(path: VaultPath): Promise<Uint8Array> {
    return new TextEncoder().encode(await this.read(path));
  }

  async write(path: VaultPath, content: string): Promise<void> {
    await this.jitter();
    if (this.next() % 2 === 1) await new Promise((resolve) => setTimeout(resolve, 0));
    this.files.set(path, content);
  }

  async exists(path: VaultPath): Promise<boolean> {
    await this.jitter();
    return this.files.has(path);
  }

  watch(): Unsubscribe {
    return () => undefined;
  }

  paths(): readonly VaultPath[] {
    return [...this.files.keys()].sort();
  }

  snapshot(): ReadonlyMap<VaultPath, string> {
    return new Map(this.files);
  }
}

describe('the wording key: normalisation, digest and near score', () => {
  it('normalises case, punctuation, symbols and spacing, and digests as v1 plus SHA-256 hex', async () => {
    expect(normalizeOutcomeLabel('  Explain: the Widget–Crank (part 2)!  ')).toBe(
      'explain the widget crank part 2',
    );
    const digest = await outcomeLabelDigest('Explain the widget crank.');
    expect(digest).toMatch(/^v1:[0-9a-f]{64}$/);
    expect(await outcomeLabelDigest('EXPLAIN  the widget crank')).toBe(digest);
    expect(await outcomeLabelDigest('Explain the widget lid')).not.toBe(digest);
  });

  it('scores token-set Jaccard, matching at the threshold and not below it', () => {
    expect(OUTCOME_LABEL_NEAR_MATCH_THRESHOLD).toBe(0.8);
    // 4 shared of 5 distinct tokens: exactly 0.8.
    expect(outcomeLabelJaccard('alpha beta gamma delta', 'alpha beta gamma delta epsilon')).toBe(
      0.8,
    );
    // 3 shared of 5: 0.6.
    expect(outcomeLabelJaccard('alpha beta gamma delta', 'alpha beta gamma epsilon')).toBe(0.6);
    expect(outcomeLabelJaccard('...', 'alpha')).toBe(0);
  });
});

describe('matchOutcomeCandidates (pure)', () => {
  async function keyed(id: string, blockIndex: number, label: string, mintedAt = '2026-09-20') {
    const record = JSON.parse(
      legacyRecord(id, blockIndex, label, mintedAt).content,
    ) as OutcomeRecord;
    return { record, key: await outcomeLabelDigest(label) } satisfies KeyedOutcomeRecord;
  }
  async function candidate(blockIndex: number, label: string) {
    return { source: { path: DOC, blockIndex }, label, digest: await outcomeLabelDigest(label) };
  }

  it('groups candidates with one wording on one block, and keeps other blocks apart', async () => {
    const groups = matchOutcomeCandidates(
      [],
      [
        await candidate(0, 'Explain the widget crank'),
        await candidate(0, 'explain the widget crank.'),
        await candidate(1, 'Explain the widget crank'),
      ],
    );
    expect(groups.map((group) => group.members)).toEqual([[0, 1], [2]]);
    expect(groups.every((group) => group.match === undefined)).toBe(true);
  });

  it('claims each stored record for one near wording at most, the closest first', async () => {
    const stored = [await keyed('s', 0, 'alpha beta gamma delta epsilon zeta eta theta')];
    const groups = matchOutcomeCandidates(stored, [
      // 7 of 9: below the floor.
      await candidate(0, 'alpha beta gamma delta epsilon zeta eta iota'),
      // 8 of 9: 0.89.
      await candidate(0, 'alpha beta gamma delta epsilon zeta eta theta iota'),
      // 8 of 8 tokens, different wording: 1.0, the closest.
      await candidate(0, 'theta eta zeta epsilon delta gamma beta alpha'),
    ]);
    expect(groups.map((group) => group.match?.how)).toEqual([undefined, undefined, 'near']);
    expect(groups[2]?.match?.record.id).toBe('outcome-key1:s');
  });

  it('never near-claims a record another wording took exactly, and picks the earliest of equal keys', async () => {
    const stored = [
      await keyed('later', 0, 'alpha beta gamma delta', '2026-09-21'),
      await keyed('earlier', 0, 'alpha beta gamma delta', '2026-09-20'),
    ];
    const groups = matchOutcomeCandidates(stored, [
      await candidate(0, 'alpha beta gamma delta epsilon'),
      await candidate(0, 'Alpha, beta, gamma, delta'),
    ]);
    expect(groups[0]?.match).toBeUndefined();
    expect(groups[1]?.match).toEqual({ record: stored[1]?.record, how: 'exact' });
  });
});

describe('resolveOutcomes: several outcomes on one block ([D-477])', () => {
  it('mints 48 distinct records for 48 outcomes stated eight to a block, each with its digest', async () => {
    const vault = new OverlapVault();
    const records = await resolveOutcomes(vault, fortyEight(), { now: NOW, generateId: counter() });

    expect(new Set(records.map((record) => record.id)).size).toBe(48);
    expect(recordFiles(vault)).toHaveLength(48);
    for (const [index, record] of records.entries()) {
      expect(record.label).toBe(fortyEight()[index]?.label);
      expect(record.source.labelDigest).toBe(await outcomeLabelDigest(record.label));
      expect(isOutcomeRecord(record)).toBe(true);
    }
  });

  it('returns the same 48 ids on rereading, writing nothing', async () => {
    const vault = new OverlapVault();
    const first = await resolveOutcomes(vault, fortyEight(), { now: NOW, generateId: counter() });
    const writes = vault.landed.length;

    const again = await resolveOutcomes(vault, fortyEight(), { now: NOW, generateId: counter() });
    const oneByOne: OutcomeRecord[] = [];
    for (const candidate of fortyEight()) oneByOne.push(await resolveOutcome(vault, candidate));

    expect(again.map((record) => record.id)).toEqual(first.map((record) => record.id));
    expect(oneByOne.map((record) => record.id)).toEqual(first.map((record) => record.id));
    expect(vault.landed.length).toBe(writes);
  });

  it('keeps the id through small wording drift, and mints anew when the wording changed', async () => {
    const vault = new OverlapVault();
    const stated = 'Explain how the widget crank transfers torque to the gadget lid';
    const [original] = await resolveOutcomes(vault, [input(3, stated)], { now: NOW });
    if (original === undefined) throw new Error('expected a record');
    const storedBytes = vault.raw(outcomeRecordPath(original.id));

    // Three later rereadings, one at a time: within one extraction the exact wording would take
    // the record, and a second wording beside it is a second outcome.
    const punctuation = await resolveOutcome(
      vault,
      input(3, 'Explain how the widget crank transfers torque to the gadget lid.'),
    );
    const drifted = await resolveOutcome(
      vault,
      input(3, 'Explain how the widget crank transfers its torque to the gadget lid'),
    );
    const changed = await resolveOutcome(
      vault,
      input(3, 'Explain how the widget crank stores energy'),
    );

    expect(punctuation?.id).toBe(original.id);
    expect(drifted?.id).toBe(original.id);
    expect(changed?.id).not.toBe(original.id);
    expect(recordFiles(vault)).toHaveLength(2);
    // A match rewrites nothing: label, digest and self-rating stay as first minted.
    expect(vault.raw(outcomeRecordPath(original.id))).toBe(storedBytes);
  });

  it('never folds two wordings of one extraction together, however alike', async () => {
    const vault = new OverlapVault();
    const records = await resolveOutcomes(
      vault,
      [
        input(0, 'Explain how the widget crank transfers torque to the gadget lid'),
        input(0, 'Explain how the widget crank transfers torque to the gadget base'),
      ],
      { now: NOW },
    );
    expect(new Set(records.map((record) => record.id)).size).toBe(2);
  });

  it('resolves two identical candidates in one extraction to one record', async () => {
    const vault = new OverlapVault();
    const [first, second] = await resolveOutcomes(
      vault,
      [input(0, 'Explain the widget crank'), input(0, 'Explain the widget crank')],
      { now: NOW },
    );
    expect(second?.id).toBe(first?.id);
    expect(recordFiles(vault)).toHaveLength(1);
  });
});

describe('records written before the discriminator ([D-477])', () => {
  it('are claimed by their own wording only; the block’s other outcomes mint, and nothing is rewritten', async () => {
    const legacy = legacyRecord('legacy-crank', 2, 'Explain the widget crank');
    const vault = new OverlapVault({ [legacy.path]: legacy.content });

    const records = await resolveOutcomes(
      vault,
      [
        input(2, 'Describe the gadget lid'),
        input(2, 'Explain the widget crank'),
        input(2, 'Compare the sprocket hinge'),
      ],
      { now: NOW, generateId: counter() },
    );

    expect(records.map((record) => record.id)).toEqual([
      'outcome-key1:n1',
      'outcome-key1:legacy-crank',
      'outcome-key1:n2',
    ]);
    expect(vault.raw(legacy.path)).toBe(legacy.content);
  });

  it('are claimed by one near wording at most', async () => {
    const legacy = legacyRecord(
      'legacy',
      2,
      'Explain how the widget crank transfers torque to the gadget lid',
    );
    const vault = new OverlapVault({ [legacy.path]: legacy.content });

    const records = await resolveOutcomes(
      vault,
      [
        input(2, 'Explain how the widget crank transfers its torque to the gadget lid'),
        input(2, 'Explain how a widget crank transfers torque to the gadget lid'),
      ],
      { now: NOW, generateId: counter() },
    );

    expect(records.filter((record) => record.id === 'outcome-key1:legacy')).toHaveLength(1);
    expect(new Set(records.map((record) => record.id)).size).toBe(2);
  });

  it('are left unclaimed when no wording matches, and never claimed from another block', async () => {
    const legacy = legacyRecord('legacy-crank', 2, 'Explain the widget crank');
    const vault = new OverlapVault({ [legacy.path]: legacy.content });

    const records = await resolveOutcomes(
      vault,
      [
        input(2, 'Describe the gadget lid'),
        input(2, 'Compare the sprocket hinge'),
        input(3, 'Explain the widget crank'),
      ],
      { now: NOW, generateId: counter() },
    );

    expect(records.map((record) => record.id)).not.toContain('outcome-key1:legacy-crank');
    expect(new Set(records.map((record) => record.id)).size).toBe(3);
    expect(recordFiles(vault)).toHaveLength(4);
    expect(vault.raw(legacy.path)).toBe(legacy.content);
  });

  it('several on one block (the shape the old overlapping mints left) are each matched by their own wording', async () => {
    const crank = legacyRecord('legacy-crank', 1, 'Explain the widget crank');
    const lid = legacyRecord('legacy-lid', 1, 'Describe the gadget lid');
    const crankTwin = legacyRecord(
      'legacy-crank-twin',
      1,
      'Explain the widget crank',
      '2026-09-22',
    );
    const vault = new OverlapVault({
      [crank.path]: crank.content,
      [lid.path]: lid.content,
      [crankTwin.path]: crankTwin.content,
    });

    const records = await resolveOutcomes(
      vault,
      [
        input(1, 'Describe the gadget lid'),
        input(1, 'Explain the widget crank'),
        input(1, 'Compare the sprocket hinge'),
      ],
      { now: NOW, generateId: counter() },
    );

    expect(records.map((record) => record.id)).toEqual([
      'outcome-key1:legacy-lid',
      'outcome-key1:legacy-crank',
      'outcome-key1:n1',
    ]);
  });
});

describe('resolution is independent of timing ([D-477], ol-egov.141.89.104.53)', () => {
  async function run(
    mode: 'sequential' | 'all-at-once' | 'one-batch',
    seed: number,
  ): Promise<{ ids: readonly string[]; files: ReadonlyMap<VaultPath, string> }> {
    const vault = new JitterVault(seed);
    const options = { now: NOW, generateId: counter() };
    const candidates = fortyEight();
    let records: readonly OutcomeRecord[];
    if (mode === 'one-batch') {
      records = await resolveOutcomes(vault, candidates, options);
    } else if (mode === 'all-at-once') {
      records = await Promise.all(
        candidates.map((candidate) => resolveOutcome(vault, candidate, options)),
      );
    } else {
      const inTurn: OutcomeRecord[] = [];
      for (const candidate of candidates)
        inTurn.push(await resolveOutcome(vault, candidate, options));
      records = inTurn;
    }
    return { ids: records.map((record) => record.id), files: vault.snapshot() };
  }

  it('gives the same 48 records one at a time, all at once under jittered I/O, and in one batch', async () => {
    const reference = await run('sequential', 1);
    expect(new Set(reference.ids).size).toBe(48);
    for (const seed of [1, 2, 3, 4, 5]) {
      for (const mode of ['all-at-once', 'one-batch'] as const) {
        const result = await run(mode, seed);
        expect(result.ids).toEqual(reference.ids);
        expect(result.files).toEqual(reference.files);
      }
    }
  });

  it('two overlapping extractions give what one after the other gives', async () => {
    const first = fortyEight().slice(0, 24);
    const second = fortyEight().slice(16);

    const inTurn = new JitterVault(7);
    const inTurnOptions = { now: NOW, generateId: counter() };
    const a = await resolveOutcomes(inTurn, first, inTurnOptions);
    const b = await resolveOutcomes(inTurn, second, inTurnOptions);

    const together = new JitterVault(7);
    const togetherOptions = { now: NOW, generateId: counter() };
    const [c, d] = await Promise.all([
      resolveOutcomes(together, first, togetherOptions),
      resolveOutcomes(together, second, togetherOptions),
    ]);

    expect(c?.map((record) => record.id)).toEqual(a.map((record) => record.id));
    expect(d?.map((record) => record.id)).toEqual(b.map((record) => record.id));
    expect(together.snapshot()).toEqual(inTurn.snapshot());
    expect(recordFiles(together)).toHaveLength(48);
  });
});

describe('one document delivered in more than one job, each numbering its units from 0', () => {
  // Job 1 carries the text pages (units 0 and 1); job 2 carries one vision page as its unit 0.
  const textJob = [
    input(0, 'Explain the widget crank'),
    input(0, 'Describe the gadget lid'),
    input(1, 'Compare the sprocket hinge'),
  ];
  const visionJob = [input(0, 'Outline the lever spring'), input(0, 'Identify the gear housing')];

  it('keeps every outcome apart, and rereading either job returns the same records', async () => {
    const vault = new OverlapVault();
    const options = { now: NOW, generateId: counter() };
    const text = await resolveOutcomes(vault, textJob, options);
    const vision = await resolveOutcomes(vault, visionJob, options);
    const ids = [...text, ...vision].map((record) => record.id);
    expect(new Set(ids).size).toBe(5);

    const writes = vault.landed.length;
    const [visionAgain, textAgain] = await Promise.all([
      resolveOutcomes(vault, visionJob, options),
      resolveOutcomes(vault, textJob, options),
    ]);
    expect([...(textAgain ?? []), ...(visionAgain ?? [])].map((record) => record.id)).toEqual(ids);
    expect(vault.landed.length).toBe(writes);
  });

  it('a record from one job written before the discriminator is not taken by the other job’s outcomes', async () => {
    const legacy = legacyRecord('legacy-crank', 0, 'Explain the widget crank');
    const vault = new OverlapVault({ [legacy.path]: legacy.content });

    const vision = await resolveOutcomes(vault, visionJob, { now: NOW, generateId: counter() });
    expect(vision.map((record) => record.id)).not.toContain('outcome-key1:legacy-crank');
    expect(new Set(vision.map((record) => record.id)).size).toBe(2);

    const [crank] = await resolveOutcomes(vault, textJob, { now: NOW, generateId: counter() });
    expect(crank?.id).toBe('outcome-key1:legacy-crank');
  });
});

describe('isOutcomeRecord and the optional digest', () => {
  it('accepts a record without labelDigest and rejects a present non-string one', () => {
    const record = JSON.parse(legacyRecord('x', 0, 'Explain the widget crank').content) as unknown;
    expect(isOutcomeRecord(record)).toBe(true);
    const withBadDigest = {
      ...(record as OutcomeRecord),
      source: { path: DOC, blockIndex: 0, labelDigest: 7 },
    };
    expect(isOutcomeRecord(withBadDigest)).toBe(false);
  });

  it('never stores a digest a caller supplies', async () => {
    const vault = new OverlapVault();
    const record = await resolveOutcome(vault, {
      ...input(0, 'Explain the widget crank'),
      source: { path: DOC, blockIndex: 0, labelDigest: 'v1:not-the-digest' },
    });
    expect(record.source.labelDigest).toBe(await outcomeLabelDigest('Explain the widget crank'));
  });
});
