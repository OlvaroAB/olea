/**
 * `createProcessNowAction` tests — `[D-152]` (F3.3, `ol-0r92.21`). See
 * `features/F3-learn-from-anything.md`'s "F3.3 / [D-152] — A manual
 * process-now action is a timing override, not a second pipeline" scenarios
 * (private repo, `olea-service`), which this file's `describe`/`it` names
 * are written to satisfy directly.
 *
 * Runs entirely against fakes — no `obsidian` import anywhere in this file,
 * matching `ingestion/arrival-watch.spec.ts`'s own posture one file over.
 */
import type {
  EnqueueInput,
  EnqueueResult,
  ExtractedUnit,
  ListOptions,
  TickResult,
  Unsubscribe,
  VaultEvent,
  VaultPath,
  VaultSource,
} from 'olea-core';
import { describe, expect, it, vi } from 'vitest';
import {
  buildAuthoredNoteUnit,
  createProcessNowAction,
  isProcessNowSupported,
  processNowNotice,
} from '../../src/ingestion/process-now.js';

/** In-memory `VaultSource` supporting both text and binary content, plus a `write` that throws — so any test asserting INV-6 ("nothing is written") fails loudly rather than silently passing if a write ever slipped in. */
class MemoryVaultSource implements VaultSource {
  private readonly text = new Map<string, string>();
  private readonly binary = new Map<string, Uint8Array>();

  setText(path: VaultPath, content: string): void {
    this.text.set(path, content);
  }

  setBinary(path: VaultPath, bytes: Uint8Array): void {
    this.binary.set(path, bytes);
  }

  async list(_options: ListOptions = {}): Promise<readonly VaultPath[]> {
    return [...this.text.keys(), ...this.binary.keys()].sort();
  }

  async read(path: VaultPath): Promise<string> {
    const found = this.text.get(path);
    if (found === undefined) throw new Error(`MemoryVaultSource.read: not found (${path})`);
    return found;
  }

  async readBinary(path: VaultPath): Promise<Uint8Array> {
    const found = this.binary.get(path);
    if (!found) throw new Error(`MemoryVaultSource.readBinary: not found (${path})`);
    return found;
  }

  async write(): Promise<void> {
    throw new Error(
      'MemoryVaultSource.write: process-now must never write to the vault (INV-6) — see this test file',
    );
  }

  async exists(path: VaultPath): Promise<boolean> {
    return this.text.has(path) || this.binary.has(path);
  }

  watch(_handler: (event: VaultEvent) => void): Unsubscribe {
    return () => {};
  }
}

/** Records every `enqueue` call and returns a scriptable result — same role `arrival-watch.spec.ts`'s own `RecordingEnqueuer` fills, extended with a settable result for the duplicate/already-processed scenario. */
class RecordingEnqueuer {
  readonly calls: EnqueueInput[] = [];
  nextResult: EnqueueResult = { status: 'queued' };

  async enqueue(input: EnqueueInput): Promise<EnqueueResult> {
    this.calls.push(input);
    return this.nextResult;
  }
}

/** A promise plus its own resolver, pulled out separately — avoids the `let x: T | null = null` narrowing quirk a `new Promise((resolve) => { x = resolve; })` pattern runs into at the call site below. */
function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

/** A scriptable `tick`, returning each entry of `results` in order (repeating the last) and counting calls. */
function scriptedTick(results: readonly TickResult[]): {
  tick: () => Promise<TickResult>;
  calls: number[];
} {
  const calls: number[] = [];
  return {
    tick: async () => {
      calls.push(calls.length);
      const r = results[Math.min(calls.length - 1, results.length - 1)];
      if (r === undefined) throw new Error('scriptedTick: no result configured');
      return r;
    },
    calls,
  };
}

describe('isProcessNowSupported', () => {
  it('accepts markdown notes and every known non-markdown source format', () => {
    expect(isProcessNowSupported('Courses/BIO101/lecture-4.md')).toBe(true);
    expect(isProcessNowSupported('Lectures/week2.pdf')).toBe(true);
    expect(isProcessNowSupported('Slides/deck.pptx')).toBe(true);
    expect(isProcessNowSupported('Handout.docx')).toBe(true);
    expect(isProcessNowSupported('Scan.png')).toBe(true);
  });

  it('declines a format no extractor claims', () => {
    expect(isProcessNowSupported('Audio/lecture.mp3')).toBe(false);
  });
});

describe('buildAuthoredNoteUnit — the shape shared with the debounce-driven authored-note path', () => {
  it('synthesizes one unit whose source and embedding note are both the note itself', () => {
    const unit = buildAuthoredNoteUnit('Zettelkasten/idea.md', 'her own words');
    expect(unit).toEqual<ExtractedUnit>({
      text: 'her own words',
      provenance: {
        sourcePath: 'Zettelkasten/idea.md',
        location: { page: 1, charRange: { start: 0, end: 'her own words'.length } },
        embeddedIn: {
          notePath: 'Zettelkasten/idea.md',
          blockStart: 0,
          blockEnd: 'her own words'.length,
        },
      },
    });
  });
});

describe('processNow — an authored markdown note reuses the authored-note trigger path', () => {
  it('reads the note and hands the exact buildAuthoredNoteUnit shape to onAuthoredNoteUnits', async () => {
    const vault = new MemoryVaultSource();
    vault.setText('Courses/BIO101/lecture-4.md', 'today we covered teratogens');
    const enqueuer = new RecordingEnqueuer();
    const received: ExtractedUnit[][] = [];

    const action = createProcessNowAction({
      vault,
      enqueuer,
      tick: async () => {
        throw new Error('an authored note never ticks the queue engine');
      },
      onAuthoredNoteUnits: (units) => {
        received.push([...units]);
      },
    });

    const outcome = await action.processNow('Courses/BIO101/lecture-4.md');

    expect(outcome).toEqual({ kind: 'ran' });
    expect(received).toEqual([
      [buildAuthoredNoteUnit('Courses/BIO101/lecture-4.md', 'today we covered teratogens')],
    ]);
    expect(enqueuer.calls).toHaveLength(0);
  });
});

describe('processNow — a known non-markdown source bypasses only the ENQUEUE debounce', () => {
  it('enqueues with no lastChangedAt, so the debounce never evaluates for this call', async () => {
    const vault = new MemoryVaultSource();
    vault.setBinary('Lectures/week2.pdf', new Uint8Array([1, 2, 3]));
    const enqueuer = new RecordingEnqueuer();
    const scripted = scriptedTick([{ kind: 'idle', reason: 'nothing-eligible' }]);

    const action = createProcessNowAction({
      vault,
      enqueuer,
      tick: scripted.tick,
      onAuthoredNoteUnits: () => {
        throw new Error('a source file never reaches the authored-note hook');
      },
    });

    await action.processNow('Lectures/week2.pdf');

    expect(enqueuer.calls).toHaveLength(1);
    expect(enqueuer.calls[0]).toMatchObject({
      label: 'Lectures/week2.pdf',
      payload: { kind: 'source', sourcePath: 'Lectures/week2.pdf', format: 'pdf' },
    });
    expect(enqueuer.calls[0]).not.toHaveProperty('lastChangedAt');
    expect(typeof enqueuer.calls[0]?.contentHash).toBe('string');
  });

  it('idempotency (D-002) is untouched: content-hash dedup still applies through the same enqueue call', async () => {
    const vault = new MemoryVaultSource();
    vault.setBinary('Lectures/week2.pdf', new Uint8Array([1, 2, 3]));
    const enqueuer = new RecordingEnqueuer();
    enqueuer.nextResult = { status: 'duplicate', existingStatus: 'queued' };
    const scripted = scriptedTick([{ kind: 'idle', reason: 'nothing-eligible' }]);

    const action = createProcessNowAction({
      vault,
      enqueuer,
      tick: scripted.tick,
      onAuthoredNoteUnits: vi.fn(),
    });

    const outcome = await action.processNow('Lectures/week2.pdf');

    // Not re-enqueued as a second job, and — since it wasn't already 'done'
    // — the action still attempts one immediate drain (the queue may still
    // need to run it).
    expect(enqueuer.calls).toHaveLength(1);
    expect(outcome).toEqual({ kind: 'queued', offline: false });
  });
});

describe('processNow — an already-completed job is reported as already processed, not re-run', () => {
  it('a content hash already recorded done is never re-enqueued or drained', async () => {
    const vault = new MemoryVaultSource();
    vault.setBinary('Lectures/week2.pdf', new Uint8Array([1, 2, 3]));
    const enqueuer = new RecordingEnqueuer();
    enqueuer.nextResult = { status: 'duplicate', existingStatus: 'done' };
    const tick = vi.fn(async (): Promise<TickResult> => {
      throw new Error('already-done content must never trigger a drain attempt');
    });

    const action = createProcessNowAction({
      vault,
      enqueuer,
      tick,
      onAuthoredNoteUnits: vi.fn(),
    });

    const outcome = await action.processNow('Lectures/week2.pdf');

    expect(outcome).toEqual({ kind: 'already-processed' });
    expect(tick).not.toHaveBeenCalled();
  });
});

describe('processNow — repeat invocations while a run is live for the same note collapse to one', () => {
  it('a second call for the SAME path while the first is in flight is coalesced', async () => {
    const vault = new MemoryVaultSource();
    vault.setText('Zettelkasten/idea.md', 'text');
    const enqueuer = new RecordingEnqueuer();
    const gate = deferred<void>();

    const action = createProcessNowAction({
      vault,
      enqueuer,
      tick: async () => {
        throw new Error('not exercised in this test');
      },
      onAuthoredNoteUnits: async () => {
        await gate.promise; // holds the first call "in flight" until we release it below.
      },
    });

    const first = action.processNow('Zettelkasten/idea.md');
    // Give the first call a turn of the microtask queue to register itself
    // as in-flight before the second call is issued.
    await Promise.resolve();
    const second = action.processNow('Zettelkasten/idea.md');

    expect(await second).toEqual({ kind: 'coalesced' });
    gate.resolve();
    expect(await first).toEqual({ kind: 'ran' });
  });

  it('two DIFFERENT paths never coalesce with each other', async () => {
    const vault = new MemoryVaultSource();
    vault.setText('a.md', 'a');
    vault.setText('b.md', 'b');
    const enqueuer = new RecordingEnqueuer();
    const seen: VaultPath[] = [];

    const action = createProcessNowAction({
      vault,
      enqueuer,
      tick: async () => {
        throw new Error('not exercised in this test');
      },
      onAuthoredNoteUnits: (units) => {
        seen.push(units[0]?.provenance.sourcePath ?? '');
      },
    });

    const [outcomeA, outcomeB] = await Promise.all([
      action.processNow('a.md'),
      action.processNow('b.md'),
    ]);

    expect(outcomeA).toEqual({ kind: 'ran' });
    expect(outcomeB).toEqual({ kind: 'ran' });
    expect(seen.sort()).toEqual(['a.md', 'b.md']);
  });
});

describe('processNow — offline, a source file is queued and says so, and nothing is force-drained', () => {
  it('enqueues (still bypassing the debounce) but never calls tick while offline', async () => {
    const vault = new MemoryVaultSource();
    vault.setBinary('Lectures/week2.pdf', new Uint8Array([1]));
    const enqueuer = new RecordingEnqueuer();
    const tick = vi.fn(async (): Promise<TickResult> => {
      throw new Error('must never attempt a drain while offline');
    });

    const action = createProcessNowAction({
      vault,
      enqueuer,
      tick,
      onAuthoredNoteUnits: vi.fn(),
      isOnline: () => false,
    });

    const outcome = await action.processNow('Lectures/week2.pdf');

    expect(enqueuer.calls).toHaveLength(1);
    expect(tick).not.toHaveBeenCalled();
    expect(outcome).toEqual({ kind: 'queued', offline: true });
    expect(processNowNotice(outcome)).toMatch(/offline/i);
  });
});

describe('processNow — online, a queued source file is drained immediately rather than waiting for the next tick', () => {
  it('calls tick() before returning, and reports the drained outcome', async () => {
    const vault = new MemoryVaultSource();
    vault.setBinary('Lectures/week2.pdf', new Uint8Array([1]));
    const enqueuer = new RecordingEnqueuer();
    const tick = vi.fn(async (): Promise<TickResult> => {
      const hash = enqueuer.calls[0]?.contentHash;
      return { kind: 'ran', contentHash: hash ?? '', outcome: 'done' };
    });

    const action = createProcessNowAction({
      vault,
      enqueuer,
      tick,
      onAuthoredNoteUnits: vi.fn(),
      isOnline: () => true,
    });

    const outcome = await action.processNow('Lectures/week2.pdf');

    expect(tick).toHaveBeenCalledTimes(1);
    expect(outcome).toEqual({ kind: 'processed' });
  });

  it('a transient-error deferral reports queued, not failed', async () => {
    const vault = new MemoryVaultSource();
    vault.setBinary('Lectures/week2.pdf', new Uint8Array([1]));
    const enqueuer = new RecordingEnqueuer();

    const action = createProcessNowAction({
      vault,
      enqueuer,
      tick: async () => {
        const hash = enqueuer.calls[0]?.contentHash ?? '';
        return { kind: 'ran', contentHash: hash, outcome: 'deferred' };
      },
      onAuthoredNoteUnits: vi.fn(),
    });

    expect(await action.processNow('Lectures/week2.pdf')).toEqual({
      kind: 'queued',
      offline: false,
    });
  });

  it('a non-retryable failure is reported honestly, not as queued or processed', async () => {
    const vault = new MemoryVaultSource();
    vault.setBinary('Lectures/week2.pdf', new Uint8Array([1]));
    const enqueuer = new RecordingEnqueuer();

    const action = createProcessNowAction({
      vault,
      enqueuer,
      tick: async () => {
        const hash = enqueuer.calls[0]?.contentHash ?? '';
        return { kind: 'ran', contentHash: hash, outcome: 'failed' };
      },
      onAuthoredNoteUnits: vi.fn(),
    });

    expect(await action.processNow('Lectures/week2.pdf')).toEqual({ kind: 'failed' });
  });

  it('a job that ticks but is not ours (something else was queued ahead of it) is still honestly queued', async () => {
    const vault = new MemoryVaultSource();
    vault.setBinary('Lectures/week2.pdf', new Uint8Array([1]));
    const enqueuer = new RecordingEnqueuer();

    const action = createProcessNowAction({
      vault,
      enqueuer,
      tick: async () => ({ kind: 'ran', contentHash: 'some-other-job', outcome: 'done' }),
      onAuthoredNoteUnits: vi.fn(),
    });

    expect(await action.processNow('Lectures/week2.pdf')).toEqual({
      kind: 'queued',
      offline: false,
    });
  });
});

describe('processNow — INV-6 is untouched: nothing is written into her vault by this action itself', () => {
  it('an authored note never calls vault.write', async () => {
    const vault = new MemoryVaultSource();
    vault.setText('Zettelkasten/idea.md', 'text');
    const enqueuer = new RecordingEnqueuer();

    const action = createProcessNowAction({
      vault,
      enqueuer,
      tick: async () => {
        throw new Error('not exercised');
      },
      onAuthoredNoteUnits: vi.fn(),
    });

    await expect(action.processNow('Zettelkasten/idea.md')).resolves.toEqual({ kind: 'ran' });
  });

  it('a source file never calls vault.write', async () => {
    const vault = new MemoryVaultSource();
    vault.setBinary('Lectures/week2.pdf', new Uint8Array([1]));
    const enqueuer = new RecordingEnqueuer();

    const action = createProcessNowAction({
      vault,
      enqueuer,
      tick: async () => ({ kind: 'idle', reason: 'nothing-eligible' }),
      onAuthoredNoteUnits: vi.fn(),
    });

    await action.processNow('Lectures/week2.pdf');
    // MemoryVaultSource.write throws if ever called — reaching here at all
    // (nothing threw) is the assertion.
  });
});

describe('processNow — a file neither markdown nor a known source format is declined honestly', () => {
  it('reads, hashes and enqueues nothing for an unsupported extension', async () => {
    const vault = new MemoryVaultSource();
    const enqueuer = new RecordingEnqueuer();
    const tick = vi.fn();
    const onAuthoredNoteUnits = vi.fn();

    const action = createProcessNowAction({ vault, enqueuer, tick, onAuthoredNoteUnits });
    const outcome = await action.processNow('Audio/lecture.mp3');

    expect(outcome).toEqual({ kind: 'unsupported' });
    expect(enqueuer.calls).toHaveLength(0);
    expect(tick).not.toHaveBeenCalled();
    expect(onAuthoredNoteUnits).not.toHaveBeenCalled();
  });
});

describe('processNow — never lets a read/hash/enqueue failure propagate', () => {
  it('a vault read failure resolves to an honest error outcome rather than throwing', async () => {
    const vault = new MemoryVaultSource(); // never seeded — read/readBinary always throw
    const enqueuer = new RecordingEnqueuer();

    const action = createProcessNowAction({
      vault,
      enqueuer,
      tick: async () => {
        throw new Error('not exercised');
      },
      onAuthoredNoteUnits: vi.fn(),
    });

    await expect(action.processNow('Zettelkasten/ghost.md')).resolves.toEqual({ kind: 'error' });
  });
});
