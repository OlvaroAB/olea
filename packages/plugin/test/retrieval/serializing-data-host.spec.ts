/**
 * `SerializingDataHost` — direct unit coverage for the host itself
 * (`ol-ppxj.46`, `[JEV-11]`/`ol-3ux7.96`'s follow-on). See that class's own
 * module doc for the full argument; this file pins the three things this
 * bead's close evidence needs to name explicitly:
 *
 * 1. A pinned EXPECTED-FAILURE (`it.fails`) proving the exposure is real
 *    TODAY for the plain, non-atomic `loadData()`-then-`saveData()` shape
 *    every one of the seventeen sibling stores still uses
 *    (`../grove/ground-streak-store.ts`, `../grove/prior-denominator-
 *    store.ts`, `../grove/read-completeness-store.ts`, `../plan/settings-
 *    store.ts`, `../registry/overrides-store.ts`, `../settings/heading-
 *    offer-setting.ts`, `../today/term-window-store.ts`, `../today/
 *    material-arrival-store.ts`, `../usage/log-store.ts`,
 *    `../ingestion/queue-store.ts`, `../ingestion/materiality/hash-
 *    store.ts`, `../ingestion/materiality/citation-hash-store.ts`,
 *    `../worker/config-store.ts`, `../keyword-index/store.ts`,
 *    `../concept/corpusRelationStateStore.ts`, `../home/scope-growth-
 *    store.ts`, `../retrieval/embedding-cache-store.ts` — every one is
 *    constructed with `this` (the plugin instance) in `main.ts`, whose
 *    overridden `loadData`/`saveData` route to this exact host, and every
 *    one calls `host.loadData()` then, separately, `host.saveData()`).
 *    The test asserts the CORRECT behaviour — both concurrent writes
 *    survive — and is marked `it.fails` so a passing assertion of the loss
 *    never sits in this suite looking like intended behaviour. It stays
 *    red on purpose until the seventeen stores are migrated, at which
 *    point it flips to a real pass and the `.fails` must be removed.
 * 2. The atomic `readModifyWrite` path (already added by `ol-3ux7.96`)
 *    closes the identical race when the caller uses it instead — proving
 *    the fix that already exists inside this host is sufficient, and that
 *    the residual exposure lives entirely in the seventeen callers not
 *    using it (filed as follow-ups on the bead, not fixed here — this bead
 *    owns only this file).
 * 3. An error thrown inside one `readModifyWrite`'s `mutate` does not wedge
 *    the queue for operations enqueued after it.
 */
import { describe, expect, it } from 'vitest';
import { SerializingDataHost } from '../../src/retrieval/serializing-data-host.js';

function delayedRawHost(delayMs: number) {
  let blob: Record<string, unknown> = {};
  return {
    raw: {
      loadData: async (): Promise<unknown> => {
        await new Promise((resolve) => setTimeout(resolve, delayMs));
        return { ...blob };
      },
      saveData: async (data: unknown): Promise<void> => {
        await new Promise((resolve) => setTimeout(resolve, delayMs));
        blob = { ...(data as Record<string, unknown>) };
      },
    },
    readBlob: () => ({ ...blob }),
  };
}

/**
 * The exact non-atomic shape every one of the seventeen sibling stores
 * named in this file's module doc still uses: `host.loadData()`, then,
 * separately, `host.saveData()`.
 */
async function nonAtomicWriteKey(
  host: { loadData(): Promise<unknown>; saveData(data: unknown): Promise<void> },
  key: string,
  value: unknown,
): Promise<void> {
  const current = await host.loadData();
  const blob = typeof current === 'object' && current !== null ? { ...(current as object) } : {};
  await host.saveData({ ...blob, [key]: value });
}

describe('SerializingDataHost', () => {
  // ol-ppxj.46: pinned as an EXPECTED failure (`it.fails`), not a passing
  // assertion of the loss, so this file never locks the bug in as
  // "correct". The assertion below states what SHOULD hold — both
  // concurrent plain loadData()/saveData() writes survive — and it fails
  // today because that shape is not atomic (see the regression trace in
  // this bead's report). This flips to a genuine pass, and the `.fails`
  // must be removed, once the seventeen sibling stores this bead names are
  // migrated onto `readModifyWrite` (filed as follow-ups on ol-ppxj.46, not
  // fixed by this lane).
  it.fails('two interleaved non-atomic loadData()/saveData() cycles on different keys both survive', async () => {
    const file = delayedRawHost(10);
    const host = new SerializingDataHost(file.raw);

    // Store A's cycle starts first...
    const writeA = nonAtomicWriteKey(host, 'storeA', 'a-value');
    // ...but store B's cycle is issued while A's `loadData()` is still the
    // only thing in the queue — its own `loadData()` queues right behind
    // A's, and each half of each store's two-call cycle is its own queue
    // link, so nothing here ever makes B wait for A's *whole* cycle.
    await new Promise((resolve) => setTimeout(resolve, 1));
    const writeB = nonAtomicWriteKey(host, 'storeB', 'b-value');

    await Promise.all([writeA, writeB]);

    const finalBlob = file.readBlob();
    // What a correct, race-free read-modify-write would leave: both keys
    // present. What this non-atomic shape actually leaves today: B's
    // `loadData()` runs before A's `saveData()` lands, so B's save writes a
    // copy of the file that has never seen A's key — A's write is silently
    // discarded, and nothing here throws or logs it.
    expect(finalBlob.storeB).toBe('b-value');
    expect(finalBlob.storeA).toBe('a-value'); // fails today: this is the loss this bead is about
  });

  it('the atomic readModifyWrite path closes the identical race: both writes survive', async () => {
    const file = delayedRawHost(10);
    const host = new SerializingDataHost(file.raw);

    const atomicWriteKey = (key: string, value: unknown) =>
      host.readModifyWrite((current) => {
        const blob = typeof current === 'object' && current !== null ? { ...(current as object) } : {};
        return { ...blob, [key]: value };
      });

    const writeA = atomicWriteKey('storeA', 'a-value');
    await new Promise((resolve) => setTimeout(resolve, 1));
    const writeB = atomicWriteKey('storeB', 'b-value');

    await Promise.all([writeA, writeB]);

    const finalBlob = file.readBlob();
    expect(finalBlob.storeA).toBe('a-value');
    expect(finalBlob.storeB).toBe('b-value'); // neither write is lost
  });

  it('an error in one readModifyWrite mutate does not wedge the queue for operations after it', async () => {
    const file = delayedRawHost(0);
    const host = new SerializingDataHost(file.raw);

    const failing = host.readModifyWrite(() => {
      throw new Error('mutate blew up');
    });
    const succeeding = host.readModifyWrite((current) => {
      const blob = typeof current === 'object' && current !== null ? { ...(current as object) } : {};
      return { ...blob, ok: true };
    });
    const thirdCall = host.loadData();

    await expect(failing).rejects.toThrow('mutate blew up');
    await expect(succeeding).resolves.toBeUndefined();
    await expect(thirdCall).resolves.toEqual({ ok: true });
    expect(file.readBlob()).toEqual({ ok: true });
  });

  it('an error in one readModifyWrite raw.saveData does not wedge the queue either', async () => {
    let calls = 0;
    const raw = {
      loadData: async (): Promise<unknown> => ({}),
      saveData: async (): Promise<void> => {
        calls += 1;
        if (calls === 1) throw new Error('disk full');
      },
    };
    const host = new SerializingDataHost(raw);

    await expect(host.readModifyWrite((c) => c)).rejects.toThrow('disk full');
    await expect(host.readModifyWrite((c) => c)).resolves.toBeUndefined();
    expect(calls).toBe(2);
  });
});
