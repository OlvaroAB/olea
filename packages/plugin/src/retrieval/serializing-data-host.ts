/**
 * `SerializingDataHost` — closes the cross-store write exposure
 * `GateStagePersistence`'s own module doc names (`[JEV-11]`, `ol-3ux7.96`):
 * `data.json` is ONE file, and every `ObsidianDataHost`-pattern store in
 * this plugin (`../grove/ground-streak-store.ts`, `../plan/settings-
 * store.ts`, `../registry/overrides-store.ts`, and others) takes the SAME
 * plugin instance as its host and calls `loadData()`/`saveData()` directly
 * against it. `GateStagePersistence` only serializes THIS recorder's own
 * writes against each other — it has no way to see, let alone wait for, a
 * completely unrelated store's independent `save()` call. The only place
 * that sees every one of those calls is the shared host itself, which is
 * why this wraps the host rather than the recorder.
 *
 * **Why `loadData`/`saveData` alone are NOT enough, and `readModifyWrite`
 * exists.** Serializing individual `loadData`/`saveData` calls stops two
 * calls from running concurrently, but a read-modify-write is TWO separate
 * calls (a `loadData` then, later, a `saveData`) — and if a caller issues
 * them as two separate host calls, another caller's ENTIRE read-modify-write
 * can run in between: `load(A)`, `load(B)`, `save(B)`, `save(A)` still
 * discards `B`, even though no two individual calls ever overlapped in
 * time. `readModifyWrite(mutate)` closes this by making the whole
 * load-then-mutate-then-save sequence ONE link in the queue, so nothing else
 * can run between the read and the write it informs.
 * `ObsidianGateStageStore.save` (`./gate-stage-store.ts`) uses this when the
 * host it is given supports it (see that file — it still falls back to a
 * plain, non-atomic `loadData`/`saveData` pair for a host that does not,
 * which is the honest, unfixed shape every sibling store still has).
 *
 * Lives here (`retrieval/`), not a more plugin-generic location, because
 * this bead is what motivates and owns it — `main.ts` wires it in by
 * overriding its own `loadData`/`saveData` to delegate here, which is what
 * makes EVERY store built with `this` as its host benefit from the
 * overlap-serialization half, without editing any of those stores' own
 * files (this bead does not own them).
 *
 * **What this does and does not fix.** It serializes every operation issued
 * through the ONE host it wraps — for `main.ts`, that is every store in the
 * plugin, since they all take `this`. **It does not make every store's
 * read-modify-write atomic** — only a caller that uses `readModifyWrite`
 * gets that; a store still calling bare `loadData()`-then-`saveData()` (as
 * `ground-streak-store.ts`, `settings-store.ts` and `overrides-store.ts` all
 * still do) gets its individual calls serialized against everything else,
 * but its own two-call read-modify-write can still be interleaved by
 * another caller's read-modify-write landing between them — see this bead's
 * close notes for the explicit check naming which sibling stores this is
 * still true for.
 */

export interface RawDataHost {
  loadData(): Promise<unknown>;
  saveData(data: unknown): Promise<void>;
}

export class SerializingDataHost implements RawDataHost {
  private chain: Promise<unknown> = Promise.resolve();

  constructor(private readonly raw: RawDataHost) {}

  loadData(): Promise<unknown> {
    return this.enqueue(() => this.raw.loadData());
  }

  saveData(data: unknown): Promise<void> {
    return this.enqueue(() => this.raw.saveData(data)) as Promise<void>;
  }

  /**
   * Runs `loadData` → `mutate` → `saveData` as ONE atomic unit against this
   * host's queue — see the module doc's "why `loadData`/`saveData` alone are
   * NOT enough" for the race this exists to close. `mutate` receives
   * whatever `loadData()` returned (including `undefined`/`null` for an
   * empty store) and returns what gets saved.
   */
  readModifyWrite(mutate: (current: unknown) => unknown | Promise<unknown>): Promise<void> {
    return this.enqueue(async () => {
      const current = await this.raw.loadData();
      const next = await mutate(current);
      await this.raw.saveData(next);
    });
  }

  private enqueue<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.chain.catch(() => undefined).then(operation);
    this.chain = result.catch(() => undefined);
    return result;
  }
}
