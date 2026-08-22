// PERMANENT SUITE — the session pipeline against the real fixture corpus.
// Scenarios: features/F2-review.md, "F2.14 — One entry point composes a session
// from a vault" — @auto:core/session/fixture-vault.spec
//
// `src/session/*.spec.ts` prove specific behaviours against three-note vaults
// small enough to read in one screen. That is the right shape for a unit test
// and the wrong shape for the claim this suite makes, which is that the whole
// pipeline survives contact with a corpus nobody wrote for it: a vault with
// templates, daily notes, base files, PDFs, a README that quotes card
// separators, notes with two topics, notes with none, and instruments in every
// format.
//
// Sibling to `test/instrument/vault-instruments.spec.ts`, which proves the
// corpus *carries* instruments. This one proves they come out the other end as
// a session. Between them they close the `ol-inv2vacuity` failure mode for the
// queue: a pipeline that composed nothing would pass every unit test in this
// package by composing nothing correctly.
//
// Assertions are counts, types and structural relations — never the fixture
// vocabulary. The fixture courses have been rebuilt once already
// (`ol-snpq`/`ol-vs57`); a suite that hardcoded the words would have broken on
// that rebuild and invited someone to paste the new ones in from a private
// source (INV-3).
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { createFsrsScheduler } from '../../src/scheduler/fsrs-scheduler.js';
import { buildReviewSession } from '../../src/session/build.js';
import { toDueInstruments } from '../../src/session/due-instruments.js';
import { summariseDue } from '../../src/today/due.js';
import { FolderSource } from '../../src/vault/folder-source.js';

const vaultRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'fixtures', 'vault');

/**
 * The vault's own index file documents the card separators it documents, so
 * `parseCards` reads real cards out of its prose. Excluded by name, exactly as
 * `test/instrument/vault-instruments.spec.ts` excludes it and for the same
 * reason — see that file's note. A second such file is then a visible decision
 * rather than a silent swallow.
 */
const NOT_A_FIXTURE_NOTE = ['README.md'];

const NOW = new Date('2026-08-20T12:00:00Z');

function session(options: { readonly now?: Date } = {}) {
  return buildReviewSession({
    vault: new FolderSource(vaultRoot),
    scheduler: createFsrsScheduler(),
    now: options.now ?? NOW,
    instruments: { excludePaths: NOT_A_FIXTURE_NOTE },
  });
}

describe('the fixture vault composes into a real session', () => {
  it('enumerates every instrument the corpus carries, in all three formats', async () => {
    const { instruments } = await session();
    const byType = new Map<string, number>();
    for (const record of instruments.records) {
      byType.set(record.instrumentType, (byType.get(record.instrumentType) ?? 0) + 1);
    }

    // Guards every claim below against passing vacuously.
    expect(instruments.records.length).toBeGreaterThanOrEqual(11);
    expect(byType.get('qa') ?? 0).toBeGreaterThanOrEqual(7);
    expect(byType.get('cloze') ?? 0).toBeGreaterThanOrEqual(4);
    expect(byType.get('mcq') ?? 0).toBeGreaterThanOrEqual(2);
  });

  it('reports no invalid MCQ block and no unbound instrument — the vault is the good corpus', async () => {
    const { instruments } = await session();
    // The deliberately-broken blocks live in `fixtures/instruments/`, and an
    // instrument in a note with no `topic:` is invisible to the queue.
    expect(instruments.invalidMcqBlocks).toEqual([]);
    expect(instruments.unbound).toEqual([]);
  });

  it('binds every instrument to a concept and at least one course, across both courses', async () => {
    const { instruments } = await session();
    for (const record of instruments.records) {
      expect(record.conceptIds.length).toBeGreaterThanOrEqual(1);
      for (const conceptId of record.conceptIds) expect(conceptId).not.toBe('');
      expect(record.courses.length).toBeGreaterThanOrEqual(1);
    }
    const courses = new Set(instruments.records.flatMap((r) => r.courses));
    expect(courses.size).toBe(2);
  });

  it('one MCQ carries its own `id:` and keeps it verbatim, un-prefixed', async () => {
    const { instruments } = await session();
    const withOwnId = instruments.records.filter(
      (record) => record.instrumentType === 'mcq' && !record.instrumentId.startsWith('prov1:'),
    );
    // The format can express identity and the corpus exercises it. If this ever
    // reaches zero, the `id:`-wins branch of the seam is untested by real data.
    expect(withOwnId.length).toBeGreaterThanOrEqual(1);
  });

  it('every instrument id is unique — two instruments sharing one would share a schedule', async () => {
    const { instruments } = await session();
    const ids = instruments.records.map((r) => r.instrumentId);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe('what the composed session actually contains', () => {
  it('offers one instrument per concept and defers the rest, each naming what took its slot', async () => {
    const { queue } = await session();
    // Dedupe is over the concept SET (ol-t3sd): winning a slot claims every one
    // of an item's `conceptIds` at once, so across every offered item the
    // concepts claimed, flattened, still contain no duplicate — the same
    // property as before, stated over the union rather than one id each.
    const conceptsOffered = queue.items.flatMap((item) => item.conceptIds);
    expect(new Set(conceptsOffered).size).toBe(conceptsOffered.length);
    expect(queue.items.length).toBeGreaterThanOrEqual(4);
    expect(queue.deferred.length).toBeGreaterThanOrEqual(1);

    const offeredIds = new Set(queue.items.map((item) => item.instrumentId));
    for (const deferral of queue.deferred) {
      expect(offeredIds.has(deferral.deferredBehind)).toBe(true);
      const winner = queue.items.find((item) => item.instrumentId === deferral.deferredBehind);
      // The winner and the deferred instrument need not name identical concept
      // lists under set semantics — only share the one slot that was contested.
      expect(winner?.conceptIds.some((conceptId) => deferral.conceptIds.includes(conceptId))).toBe(
        true,
      );
    }
  });

  it('at least one concept genuinely had a choice to make, so dedupe is not proven vacuously', async () => {
    const { queue, instruments } = await session();
    // An instrument counts toward every one of its `conceptIds`, not just a
    // chosen first one (`ol-t3sd`).
    const perConcept = new Map<string, number>();
    for (const record of instruments.records) {
      for (const conceptId of record.conceptIds) {
        perConcept.set(conceptId, (perConcept.get(conceptId) ?? 0) + 1);
      }
    }
    const multi = [...perConcept.entries()].filter(([, count]) => count >= 2);
    expect(multi.length).toBeGreaterThanOrEqual(1);

    const [conceptId] = multi[0] ?? [];
    if (conceptId === undefined) throw new Error('expected a concept with two or more instruments');
    expect(queue.items.filter((item) => item.conceptIds.includes(conceptId))).toHaveLength(1);
    expect(
      queue.deferred.filter((deferral) => deferral.conceptIds.includes(conceptId)).length,
    ).toBeGreaterThanOrEqual(1);
  });

  it('nothing is lost: every enumerated instrument is offered, deferred, or not due', async () => {
    const { queue, instruments, candidates } = await session();
    const accountedFor = new Set([
      ...queue.items.map((item) => item.instrumentId),
      ...queue.deferred.map((deferral) => deferral.instrumentId),
    ]);
    // Nothing has been reviewed, so nothing can be "not due" — every instrument
    // must be accounted for exactly once.
    expect(accountedFor.size).toBe(instruments.records.length);
    expect(candidates).toHaveLength(instruments.records.length);
  });

  it('every offered item is new, with a null prior state and no prioritisation claimed', async () => {
    const { queue } = await session();
    for (const item of queue.items) {
      expect(item.selectionContext.dueState).toBe('new');
      expect(item.priorState).toBeNull();
      expect(item.selectionContext.yieldRank).toBeNull();
      expect(item.selectionContext.examProximity).toBeNull();
    }
  });

  // CHANGED BY `ol-t3sd`, and this is the sharpest user-visible consequence of
  // the set-valued dedupe key — flagged here rather than smoothed over.
  //
  // The predecessor of this test asserted that a format preference changes
  // *which* instrument wins a concept and **never how many** are offered. That
  // held only because the dedupe key was a single id: every concept picked its
  // winner independently, so the item count was always "one per eligible
  // concept" whatever the preference was.
  //
  // With a set key it does not hold, and cannot be made to hold without
  // inventing a heuristic. An instrument naming two concepts claims both slots,
  // so preferring its format can make one item stand in for what would
  // otherwise have been two — and the reverse, an instrument passed over
  // because a preferred single-concept instrument took one of its concepts,
  // leaves its *other* concept with nothing eligible left. Restoring the old
  // invariant would mean choosing the maximum-cardinality set of instruments
  // rather than the preferred one, which is a prioritisation heuristic; this
  // module's own doc is emphatic that prioritisation belongs to C5.5 and the
  // oracle, and that a "small sensible" one here would silently become the
  // thing the Phase A→B checkpoint measures.
  //
  // What still holds is what F2.17 actually asks for, and it is asserted below:
  // at most one instrument per concept, nothing dropped without being named,
  // and the preference genuinely moving a slot.
  it('a format preference moves which instrument wins a concept, and may change how many are offered', async () => {
    const plain = await session();
    const preferCloze = await buildReviewSession({
      vault: new FolderSource(vaultRoot),
      scheduler: createFsrsScheduler(),
      now: NOW,
      instruments: { excludePaths: NOT_A_FIXTURE_NOTE },
      formatPreference: ['cloze'],
    });

    // F2.17 holds under either preference: no concept is offered twice.
    for (const composed of [plain.queue, preferCloze.queue]) {
      const conceptsOffered = composed.items.flatMap((i) => i.conceptIds);
      expect(new Set(conceptsOffered).size).toBe(conceptsOffered.length);
    }

    // Nothing is dropped under either preference — every eligible instrument is
    // offered or named as deferred. This is the accountability property that
    // replaced the count invariant, and it is the stronger of the two: a count
    // can match while an instrument silently vanishes, this cannot.
    for (const composed of [plain.queue, preferCloze.queue]) {
      const accounted = new Set([
        ...composed.items.map((i) => i.instrumentId),
        ...composed.deferred.map((d) => d.instrumentId),
      ]);
      expect(accounted.size).toBe(plain.instruments.records.length);
    }

    // A preference can only ever cost items, never add them: it reorders which
    // instrument reaches a concept first, and a multi-concept winner absorbs
    // slots that separate winners would have filled one each.
    expect(preferCloze.queue.items.length).toBeLessThanOrEqual(plain.queue.items.length);

    // The corpus has concepts carrying both a card and a cloze, so preferring
    // cloze must actually move at least one slot.
    const clozeOffered = preferCloze.queue.items.filter((i) => i.instrumentType === 'cloze');
    expect(clozeOffered.length).toBeGreaterThanOrEqual(1);
  });

  it('a course filter narrows the session to that course, as a subsequence', async () => {
    const all = await session();
    const oneCourse = all.instruments.records[0]?.courses[0];
    if (oneCourse === undefined) throw new Error('expected a course on the first record');

    const filtered = await buildReviewSession({
      vault: new FolderSource(vaultRoot),
      scheduler: createFsrsScheduler(),
      now: NOW,
      instruments: { excludePaths: NOT_A_FIXTURE_NOTE },
      filter: { courses: [oneCourse] },
    });

    expect(filtered.queue.items.length).toBeGreaterThanOrEqual(1);
    expect(filtered.queue.items.length).toBeLessThan(all.queue.items.length);
    const allIds = all.queue.items.map((i) => i.instrumentId);
    const filteredIds = filtered.queue.items.map((i) => i.instrumentId);
    expect(allIds.filter((id) => filteredIds.includes(id))).toEqual(filteredIds);
  });
});

describe('the Today panel counts the same corpus the queue composes from', () => {
  it('the due total is every enumerated instrument, and the rows sum to it', async () => {
    const built = await session();
    const summary = summariseDue(toDueInstruments(built.instruments.records, built.replay), {
      dueThrough: NOW,
      suspendedInstrumentIds: built.suspended,
    });

    expect(summary.total).toBe(built.instruments.records.length);
    expect(summary.courses.reduce((sum, row) => sum + row.count, 0)).toBe(summary.total);
    expect(summary.courses.length).toBeGreaterThanOrEqual(2);
  });

  it('the panel counts what the queue could offer — never fewer than the session it composes', async () => {
    const built = await session();
    const summary = summariseDue(toDueInstruments(built.instruments.records, built.replay), {
      dueThrough: NOW,
      suspendedInstrumentIds: built.suspended,
    });
    // The panel counts instruments waiting; the session offers at most one per
    // concept. The panel may legitimately exceed the session, never trail it.
    expect(summary.total).toBeGreaterThanOrEqual(built.queue.items.length);
  });
});
