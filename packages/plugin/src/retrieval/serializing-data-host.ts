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
 * **What this did and did not fix, as of `ol-3ux7.96`.** It serializes
 * every operation issued through the ONE host it wraps — for `main.ts`,
 * that is every store in the plugin, since they all take `this`. It did
 * NOT make every store's read-modify-write atomic on its own — only a
 * caller that uses `readModifyWrite` gets that.
 *
 * **`ol-ppxj.46` update.** The seventeen sibling stores this doc used to
 * name as still calling a bare `loadData()`-then-`saveData()` pair
 * (`ground-streak-store.ts`, `settings-store.ts`, `overrides-store.ts` and
 * the rest) are now migrated onto `readModifyWrite`, each via its own
 * `merge`/`mutate` function that folds its load-then-decide-then-write
 * logic into one call so no part of the decision is split across two
 * separate host operations. `AtomicDataHost`/`hasReadModifyWrite` below are
 * the shared structural-detection helper this module used to argue for
 * without exporting — added here so a new store does not have to redeclare
 * it (`gate-stage-store.ts` still keeps its own local copy, predating this
 * export; the two are structurally interchangeable). Every store still
 * falls back to the identical plain, non-atomic pair when handed a host
 * without `readModifyWrite` — which is exactly the fake host every existing
 * store test in this plugin still constructs, so none of those tests needed
 * to change.
 */

export interface RawDataHost {
  loadData(): Promise<unknown>;
  saveData(data: unknown): Promise<void>;
}

/**
 * The narrow shape a store's own host port must have to use the atomic
 * `readModifyWrite` path instead of a plain, non-atomic pair — see this
 * module's doc for exactly what the difference closes.
 * `hasReadModifyWrite` detects it structurally (never `instanceof
 * SerializingDataHost`), so a store's own test suite can keep handing it a
 * plain fake `{ loadData, saveData }` host with no `readModifyWrite` and
 * correctly exercise the honest, non-atomic fallback path.
 */
export interface AtomicDataHost extends RawDataHost {
  readModifyWrite(mutate: (current: unknown) => unknown | Promise<unknown>): Promise<void>;
}

export function hasReadModifyWrite(host: RawDataHost): host is AtomicDataHost {
  return typeof (host as Partial<AtomicDataHost>).readModifyWrite === 'function';
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
