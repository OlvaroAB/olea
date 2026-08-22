/**
 * Node-side tests for the parts of the workbench that are not DOM.
 *
 * Scope note: the *rendered* views are checked by looking at them, and will be
 * checked automatically by WB-2 (`ol-z6x2`) in a real browser. Nothing here is a
 * browser test, a screenshot or an `@auto-web` scenario.
 *
 * What is worth asserting without a DOM:
 *
 *  1. `MemoryVaultSource` really is byte-exact, checked against `FolderSource`
 *     reading the same fixture files. The workbench is core's third `VaultSource`
 *     implementation and the first one in a browser; "byte-exact" is the contract
 *     INV-2 is defined over, and the fixture vault deliberately contains CRLF
 *     files and a binary PDF precisely so a normalising reader is caught.
 *  2. Instruments derive from the fixture vault through the core parser path.
 *  3. Every advertised state builds a scenario. A state id in the nav that throws
 *     when selected is the one failure mode a human clicking around would find
 *     late and a test finds instantly.
 *  4. The persona layer (SYN-1's first named consumer). Two things about it are
 *     worth asserting without a browser: that a persona actually reaches the
 *     surface — a claim that cannot tell one persona from another is not
 *     asserting anything, which is `ol-inv2vacuity`'s defect — and that the
 *     synthetic/real log boundary holds in the vault the workbench assembles.
 *  5. That the workbench chrome carries no theme stylesheet (`ol-mioe`). The
 *     rendered isolation needs a browser; that the page never loads a theme
 *     into the chrome document does not.
 */

import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join, posix, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { appendReviewLogRecord, createFsrsScheduler, FolderSource, reviewLogPath } from 'olea-core';
import { describe, expect, it } from 'vitest';
import { WORKBENCH_NOW } from '../src/clock.js';
import {
  buildPersonaHistory,
  checkVaultBoundary,
  NO_PERSONA_HISTORY,
  PERSONA_OPTIONS,
  writePersonaHistory,
} from '../src/persona/history.js';
import { previewSingleInterval } from '../src/plugin-bridge.js';
import { deriveWorkbenchQueue, type WorkbenchQueue } from '../src/queue/derive.js';
import { buildScenario, REVIEW_STATES, WORKBENCH_DEVICE_ID } from '../src/scenarios.js';
import {
  SYNTHETIC_EVENT_ID_PREFIX,
  SYNTHETIC_LOG_FOLDER,
  writeSyntheticStream,
} from '../src/synthetic-bridge.js';
import { MemoryVaultSource } from '../src/vault/memory-source.js';

const FIXTURE_ROOT = resolve(
  dirname(fileURLToPath(import.meta.url)),
  '..',
  '..',
  'core',
  'fixtures',
  'vault',
);

/** The same set of files `build.mjs` copies into `dist/vault/`, read as raw bytes. */
function readFixtureBytes(): Map<string, Uint8Array> {
  const out = new Map<string, Uint8Array>();
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const absolute = join(dir, entry.name);
      if (entry.isDirectory()) walk(absolute);
      else if (entry.isFile()) {
        const vaultPath = relative(FIXTURE_ROOT, absolute).split(sep).join(posix.sep);
        out.set(vaultPath, new Uint8Array(readFileSync(absolute)));
      }
    }
  };
  walk(FIXTURE_ROOT);
  return out;
}

const memory = MemoryVaultSource.fromBytes(readFixtureBytes());
const folder = new FolderSource(FIXTURE_ROOT);

const WORKBENCH_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/** A vault nothing else has written to — the persona tests all write. */
function freshVault(): MemoryVaultSource {
  return MemoryVaultSource.fromBytes(readFixtureBytes());
}

describe('MemoryVaultSource — core VaultSource over bytes, for the browser', () => {
  it('lists exactly the fixture vault, in the same sorted order FolderSource does', async () => {
    // FolderSource skips dotfiles; the fixture vault has none, so the two agree.
    expect(await memory.list()).toEqual(await folder.list());
  });

  it('reads every text file byte-identically to FolderSource', async () => {
    const paths = await memory.list({ extensions: ['md', 'base'] });
    expect(paths.length).toBeGreaterThan(0);
    for (const path of paths) {
      expect(await memory.read(path), path).toBe(await folder.read(path));
    }
  });

  it('preserves CRLF line endings rather than normalising them', async () => {
    const paths = await memory.list({ extensions: ['md'] });
    const contents = await Promise.all(paths.map((path) => memory.read(path)));
    // The fixture vault's own README names CRLF files as deliberate regression
    // fixtures; assert the property, never a particular file's name.
    expect(contents.some((text) => text.includes('\r\n'))).toBe(true);
  });

  it('reads binary files byte-identically', async () => {
    const paths = await memory.list({ extensions: ['pdf'] });
    expect(paths.length).toBeGreaterThan(0);
    for (const path of paths) {
      expect([...(await memory.readBinary(path))], path).toEqual([
        ...(await folder.readBinary(path)),
      ]);
    }
  });

  it('honours the `under` filter and reports existence', async () => {
    const all = await memory.list({ extensions: ['md'] });
    const first = all[0];
    expect(first).toBeDefined();
    if (first === undefined) return;
    const folderName = first.slice(0, first.indexOf('/'));
    const scoped = await memory.list({ under: folderName, extensions: ['md'] });
    expect(scoped.length).toBeGreaterThan(0);
    expect(scoped.every((path) => path.startsWith(`${folderName}/`))).toBe(true);
    expect(await memory.exists(first)).toBe(true);
    expect(await memory.exists('does/not/exist.md')).toBe(false);
  });
});

/**
 * The composed session over the fixture vault, with no persona loaded — every
 * instrument a first exposure. `entries: []` is what `?persona=none` produces.
 */
function composeFixtureSession(
  entries: Parameters<typeof deriveWorkbenchQueue>[0]['entries'] = [],
): Promise<WorkbenchQueue> {
  return deriveWorkbenchQueue({ vault: memory, scheduler: createFsrsScheduler(), entries });
}

describe('the composer, not a synthesiser — real fixture instruments in, a session out', () => {
  it('offers Q&A, cloze and MCQ items drawn from the vault’s own instruments', async () => {
    const queue = await composeFixtureSession();
    expect(queue.qa.length).toBeGreaterThan(0);
    expect(queue.cloze.length).toBeGreaterThan(0);
    expect(queue.mcq.length).toBeGreaterThan(0);
    // Two Q&A items, because `session-complete` runs three items and draws two
    // of them from this list.
    expect(queue.qa.length).toBeGreaterThanOrEqual(2);
  });

  it('every offered item is an instrument the vault actually carries', async () => {
    const queue = await composeFixtureSession();
    const enumerated = new Set(
      queue.session.instruments.records.map((record) => record.instrumentId),
    );
    for (const bucket of [queue.qa, queue.cloze, queue.mcq]) {
      for (const item of bucket) {
        expect(enumerated.has(item.instrument.instrumentId), item.instrument.instrumentId).toBe(
          true,
        );
      }
    }
  });

  it('leaves no wikilink syntax in anything rendered as prose', async () => {
    const queue = await composeFixtureSession();
    const prose: string[] = [];
    for (const item of [...queue.qa, ...queue.cloze, ...queue.mcq]) {
      const instrument = item.instrument;
      if (instrument.type === 'qa') prose.push(instrument.question, instrument.answer);
      else if (instrument.type === 'cloze') {
        prose.push(instrument.before, instrument.clozeText, instrument.after);
      } else {
        prose.push(instrument.stem, ...instrument.options.map((option) => option.label));
      }
    }
    expect(prose.length).toBeGreaterThan(0);
    expect(prose.every((text) => !text.includes('[['))).toBe(true);
  });

  it('presents four MCQ options, exactly one correct (F2.15)', async () => {
    const queue = await composeFixtureSession();
    for (const item of queue.mcq) {
      if (item.instrument.type !== 'mcq') throw new Error('expected an mcq instrument');
      // Three distractors sampled from a pool of at least four, plus the answer.
      expect(item.instrument.options).toHaveLength(4);
      expect(item.instrument.options.filter((option) => option.correct)).toHaveLength(1);
    }
  });

  it('gives every instrument a stable id, unique across the whole corpus', async () => {
    const first = await composeFixtureSession();
    const second = await composeFixtureSession();
    expect(first.qa.map((item) => item.instrument.instrumentId)).toEqual(
      second.qa.map((item) => item.instrument.instrumentId),
    );
    const ids = first.session.instruments.records.map((record) => record.instrumentId);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('decides nothing about selection itself — the queue’s explicit nulls arrive intact', async () => {
    const queue = await composeFixtureSession();
    for (const item of [...queue.qa, ...queue.cloze, ...queue.mcq]) {
      expect(item.selectionContext.yieldRank).toBeNull();
      expect(item.selectionContext.examProximity).toBeNull();
      expect(item.selectionContext.planVersion).toBeNull();
      expect(item.selectionContext.dueState).toBe('new');
      expect(item.priorState).toBeNull();
    }
  });
});

describe('scenarios — every advertised state is reachable', () => {
  it('builds a scenario for each of the twelve states in the nav', async () => {
    const queue = await composeFixtureSession();
    const scheduler = createFsrsScheduler();
    expect(REVIEW_STATES).toHaveLength(12);
    for (const state of REVIEW_STATES) {
      const scenario = buildScenario({ vault: memory, scheduler, queue, stateId: state.id });
      expect(scenario.deps.queue, state.id).toBeDefined();
    }
  });

  it('reaches every state with a persona loaded too, not only from a blank history', async () => {
    const bare = await composeFixtureSession();
    const scheduler = createFsrsScheduler();
    for (const option of PERSONA_OPTIONS) {
      const history = buildPersonaHistory(option.id);
      const queue = await composeFixtureSession(
        history.entriesFor(bare.session.instruments.records),
      );
      for (const state of REVIEW_STATES) {
        const scenario = buildScenario({
          vault: memory,
          scheduler,
          queue,
          stateId: state.id,
          history,
        });
        expect(scenario.deps.queue, `${option.id}/${state.id}`).toBeDefined();
      }
    }
  });

  it('rejects an unknown state id rather than rendering something arbitrary', async () => {
    const queue = await composeFixtureSession();
    expect(() =>
      buildScenario({
        vault: memory,
        scheduler: createFsrsScheduler(),
        queue,
        stateId: 'no-such-state',
      }),
    ).toThrow(/unknown state/);
  });
});

describe('personas — SYN-1 history behind the history-bearing surfaces', () => {
  it('builds a history for every option in the nav', () => {
    for (const option of PERSONA_OPTIONS) {
      const history = buildPersonaHistory(option.id);
      expect(history.id, option.id).toBe(option.id);
      if (option.id === 'none') {
        expect(history.stream, option.id).toBeNull();
      } else {
        expect(history.stream, option.id).not.toBeNull();
      }
    }
  });

  it('stamps every event it loads as synthetic', () => {
    for (const option of PERSONA_OPTIONS) {
      const stream = buildPersonaHistory(option.id).stream;
      if (stream === null) continue;
      for (const entry of stream.entries) {
        expect(entry.eventId.startsWith(SYNTHETIC_EVENT_ID_PREFIX), option.id).toBe(true);
      }
    }
  });

  it('is deterministic: the same persona twice is the same history', () => {
    const first = buildPersonaHistory('crammer').stream;
    const second = buildPersonaHistory('crammer').stream;
    expect(JSON.stringify(second?.entries)).toBe(JSON.stringify(first?.entries));
  });

  /**
   * The discriminating claim. Without it, "the workbench loads a persona" is
   * unfalsifiable: a wiring that built the stream and then threw it away would
   * pass every test above. What has to change is the thing on screen — the FSRS
   * interval preview under the reveal screen's rating buttons is a pure
   * function of `priorState`, so comparing its label across personas asks
   * exactly "did the history reach the surface".
   */
  it('changes what the reveal screen shows, per persona', async () => {
    const bare = await composeFixtureSession();
    const records = bare.session.instruments.records;

    const labelFor = async (
      personaId: (typeof PERSONA_OPTIONS)[number]['id'],
    ): Promise<string | null> => {
      const history = buildPersonaHistory(personaId);
      const queue = await composeFixtureSession(history.entriesFor(records));
      const item = queue.qa[0];
      if (item === undefined) return null;
      return previewSingleInterval(
        createFsrsScheduler(),
        item.instrument.instrumentId,
        item.priorState,
        'good',
        WORKBENCH_NOW,
      ).label;
    };

    const steady = await labelFor('steady-reviewer');
    const struggler = await labelFor('struggler');
    const empty = await labelFor('empty-history');

    // A persona with months of successful review schedules further out than one
    // losing a course, which schedules further out than a deck never met.
    expect(new Set([steady, struggler, empty]).size).toBeGreaterThan(1);
    expect(steady).not.toBe(empty);
  });

  it('derives dueState from the composer rather than assigning it', async () => {
    const bare = await composeFixtureSession();
    const records = bare.session.instruments.records;

    const emptyHistory = await composeFixtureSession(
      buildPersonaHistory('empty-history').entriesFor(records),
    );
    for (const item of emptyHistory.qa) {
      // A valid stream with zero events: never reviewed, so the only honest
      // due state is `new`.
      expect(item.priorState).toBeNull();
      expect(item.selectionContext.dueState).toBe('new');
    }

    const lapsed = await composeFixtureSession(
      buildPersonaHistory('lapsed-returner').entriesFor(records),
    );
    const reviewed = lapsed.session.replay;
    expect(reviewed.replayedCount).toBeGreaterThan(0);
    for (const item of lapsed.qa) {
      // Composed after a real replay, so anything offered is due or overdue —
      // the queue never draws early (F2.8, Phase A).
      expect(['due', 'overdue', 'new']).toContain(item.selectionContext.dueState);
    }
  });

  it('a persona’s history reaches the composer as prior state, not as a decoration', async () => {
    const bare = await composeFixtureSession();
    const records = bare.session.instruments.records;
    const lapsed = await composeFixtureSession(
      buildPersonaHistory('lapsed-returner').entriesFor(records),
    );
    // Every instrument was a first exposure without her; with her, the replay
    // has produced states for the ones her deck reached.
    expect(bare.session.replay.states.size).toBe(0);
    expect(lapsed.session.replay.states.size).toBeGreaterThan(0);
  });

  it('relabelled events keep the synthetic stamp, so the boundary check still sees them', async () => {
    const bare = await composeFixtureSession();
    const entries = buildPersonaHistory('crammer').entriesFor(bare.session.instruments.records);
    expect(entries.length).toBeGreaterThan(0);
    for (const entry of entries) {
      expect(entry.eventId.startsWith(SYNTHETIC_EVENT_ID_PREFIX)).toBe(true);
    }
    // And no two relabelled events collide, which a merge would refuse.
    const ids = entries.map((entry) => entry.eventId);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('gives the empty screen a next-due label derived from her deck, and none when she has no deck', () => {
    expect(buildPersonaHistory('empty-history').nextDueLabel).toBeNull();
    expect(buildPersonaHistory('steady-reviewer').nextDueLabel).not.toBeNull();
  });

  it('an absent persona and an explicit “none” are the same session', async () => {
    const queue = await composeFixtureSession();
    const withoutOption = buildScenario({
      vault: memory,
      scheduler: createFsrsScheduler(),
      queue,
      stateId: 'qa-front',
    });
    const withNone = buildScenario({
      vault: memory,
      scheduler: createFsrsScheduler(),
      queue,
      stateId: 'qa-front',
      history: NO_PERSONA_HISTORY,
    });
    expect(JSON.stringify(withNone.deps.queue)).toBe(JSON.stringify(withoutOption.deps.queue));
    // No history at all, so every instrument is a first exposure — `new`, not
    // the `due` the old hand-written selectionContext asserted.
    expect(withNone.deps.queue[0]?.selectionContext.dueState).toBe('new');
  });
});

describe('the synthetic/real log boundary, in the vault the workbench assembles', () => {
  it('puts a persona’s history under .olea-synthetic/ and never under .olea/', async () => {
    const vault = freshVault();
    const history = buildPersonaHistory('crammer');
    const paths = await writePersonaHistory(vault, history);

    expect(paths.length).toBeGreaterThan(0);
    for (const path of paths) {
      expect(path.startsWith(`${SYNTHETIC_LOG_FOLDER}/`), path).toBe(true);
      expect(path.startsWith('.olea/'), path).toBe(false);
    }
  });

  /**
   * The guard is exercised, not described. Pointing SYN-1's writer at core's
   * own `reviewLogPath` must throw and must leave the vault untouched — the
   * workbench writes to an in-memory vault, so honouring the guard costs it
   * nothing, and a lane that found it inconvenient would be the one thing this
   * test exists to catch.
   */
  it('refuses to write a synthetic stream to a real vault log path, and writes nothing when it does', async () => {
    const vault = freshVault();
    const before = (await vault.list()).length;
    const stream = buildPersonaHistory('steady-reviewer').stream;
    expect(stream).not.toBeNull();
    if (stream === null) return;

    await expect(writeSyntheticStream(vault, stream, { pathFor: reviewLogPath })).rejects.toThrow(
      /refusing to write a synthetic stream/,
    );
    expect((await vault.list()).length).toBe(before);
  });

  it('keeps the two namespaces disjoint once a real session has also written', async () => {
    const vault = freshVault();
    const queue = await deriveWorkbenchQueue({
      vault,
      scheduler: createFsrsScheduler(),
      entries: [],
    });
    await writePersonaHistory(vault, buildPersonaHistory('struggler'));

    // A real review-log record, written the way the product writes one.
    const card = queue.qa[0]?.instrument;
    expect(card).toBeDefined();
    if (card === undefined) return;
    await appendReviewLogRecord(
      vault,
      {
        timestamp: '2027-01-15T10:15:00.000+00:00',
        instrumentId: card.instrumentId,
        instrumentType: card.type,
        conceptIds: [...card.conceptIds],
        rating: 'good',
        wasUnsure: false,
        durationMs: null,
        selectionContext: {
          dueState: 'due',
          examProximity: null,
          yieldRank: null,
          instrumentTypesOffered: ['qa'],
          planVersion: null,
        },
      },
      { deviceId: WORKBENCH_DEVICE_ID, generateEventId: () => 'wb-event-0001' },
    );

    const boundary = await checkVaultBoundary(vault);
    expect(boundary.realLogFiles).toBe(1);
    expect(boundary.realLogRecords).toBe(1);
    expect(boundary.syntheticLogFiles).toBeGreaterThan(0);
    expect(boundary.syntheticLogRecords).toBeGreaterThan(0);
    expect(boundary.syntheticRecordsInRealLog).toEqual([]);
  });
});

describe('ol-mioe — the chrome document loads no theme', () => {
  const html = readFileSync(join(WORKBENCH_ROOT, 'public', 'index.html'), 'utf8');

  it('links only the chrome stylesheet', () => {
    const hrefs = [...html.matchAll(/<link[^>]*href="([^"]+)"/g)].map((m) => m[1]);
    expect(hrefs).toEqual(['./workbench.css']);
  });

  it('makes [data-wb-surface] the host iframe, so the screenshot target is a document boundary', () => {
    expect(/<iframe[^>]*data-wb-surface/.test(html)).toBe(true);
  });
});
