// PERMANENT SUITE (C5.2, D7.1, P2-T03, D-020, `ol-t3sd`, `ol-tka5`) — golden
// fixtures for the review-log JSONL format. Mirrors the convention
// `test/frontmatter/golden.spec.ts` and `test/block/vault-lossless.spec.ts` set:
// fixtures live under `packages/core/fixtures/`, this suite asserts their exact
// parsed shape by name, and `fixtures/review-log/README.md` explains what each
// file is for.
//
// INV-2 discipline: extended, never pruned — WITH ONE DELIBERATE EXCEPTION.
// The v1, v2 and v3 files are exactly as before: still here, unmodified on
// disk, every describe block that was ever here still here. The v1 file is
// the frozen evidence that a semester of pre-suspension history still parses;
// the v2 files are the same kind of evidence for pre-`conceptIds` history;
// the v3 file is that evidence for pre-per-concept-mastery history, and it
// carries the one record in the suite whose mastery value cannot be
// attributed to a concept.
//
// **The v4 fixture is the exception, and it is rewritten in place to v5, not
// kept alongside it** (`ol-tka5`, `[D-109]`). `[D-109]` rules review-log v5 a
// migrate-in-place bump: no real v4 record ever existed anywhere (prod dark,
// no BRAT install), so unlike every earlier bump, there is no history at v4
// this suite protects by keeping the old file — the v4 fixture was itself
// synthetic test data invented for this suite, not a semester of a real
// device's output. `2026-08-10.device-workstation.v4.jsonl` is gone;
// `2026-08-10.device-workstation.v5.jsonl` carries the same six lines with
// `schemaVersion` bumped, plus a seventh line demonstrating the three new
// fields this bead adds. v1–v3 are untouched and out of scope for this
// exception, per `[D-109]`'s own text.
//
// What *did* have to move, and the distinction matters: assertions naming "the
// current version". `parseReviewLog` returns current-shape entries by contract,
// so a v1 record read today comes back as v5, and an assertion that it comes
// back as v2 was an assertion about which version was current rather than about
// the fixture. Those are retargeted. Every assertion about a *frozen* shape —
// the raw bytes on disk, the field values carried through, the key shape of a
// record — is untouched, and the raw-bytes guards below are applied to the v2
// and v3 files too, so a future migration of a fixture fails loudly here.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { ReviewLogEntry, ReviewLogRecord, SuspendLogRecord } from 'olea-contracts';
import { describe, expect, it } from 'vitest';
import { mergeReviewLogRecords } from '../../src/review-log/merge.js';
import { parseReviewLog } from '../../src/review-log/parse.js';
import { suspendedInstrumentIds } from '../../src/review-log/suspension.js';

const FIXTURE_ROOT = join(import.meta.dirname, '..', '..', 'fixtures', 'review-log');

function readFixture(name: string): string {
  return readFileSync(join(FIXTURE_ROOT, name), 'utf8');
}

/**
 * The frozen v1 file. Named `.v1-legacy` on disk so no one regenerates it by
 * reflex — it is the only proof left that the v1 read path and the `upgradeV1`
 * migration work, and migrating it would delete the test along with the data.
 */
const DESKTOP_V1_FIXTURE = '2026-08-10.device-desktop.v1-legacy.jsonl';
const MOBILE_FIXTURE = '2026-08-10.device-mobile.jsonl';
const CRASH_FIXTURE = '2026-08-10.device-crash.jsonl';
const TABLET_SUSPEND_FIXTURE = '2026-08-10.device-tablet.v2-suspend.jsonl';
const PHONE_SUSPEND_FIXTURE = '2026-08-10.device-phone.v2-suspend.jsonl';
/** The v3 file — frozen history since the `ol-g6zg` bump. */
const LAPTOP_V3_FIXTURE = '2026-08-10.device-laptop.v3.jsonl';
/**
 * The v5 file — what the writer produces today (`ol-tka5`, `[D-109]`).
 * Rewritten in place from the retired v4 fixture rather than kept alongside
 * it — see this file's header for why that is the one exception to "extended,
 * never pruned" here.
 */
const WORKSTATION_V5_FIXTURE = '2026-08-10.device-workstation.v5.jsonl';

/** Every v2 file on disk. Guarded as a group so a new one cannot skip the check. */
const V2_FIXTURES = [
  MOBILE_FIXTURE,
  CRASH_FIXTURE,
  TABLET_SUSPEND_FIXTURE,
  PHONE_SUSPEND_FIXTURE,
] as const;

/**
 * The v4 `selectionContext` key shape — v1's, minus `masteryAtTime`, which
 * moved up onto the record with `ol-g6zg` so that it could be keyed by
 * `conceptIds` (an object cannot be keyed by a field it cannot see). The five
 * that remain are still explicit-null-or-value, never omitted.
 */
const SELECTION_CONTEXT_KEYS = [
  'dueState',
  'examProximity',
  'yieldRank',
  'instrumentTypesOffered',
  'planVersion',
].sort();

/**
 * The current (v4) review-record key shape, **excluding `masteryAtTime`**,
 * which is the one legitimately-omissible key on the record — absent means "not
 * recorded", which is what every writer means until C5.4 exists. Every key
 * listed here is mandatory. `conceptId` became `conceptIds` with the `ol-t3sd`
 * bump; every other key is exactly as it was, which is the assertion this list
 * is actually making.
 */
const RECORD_KEYS = [
  'schemaVersion',
  'kind',
  'eventId',
  'timestamp',
  'instrumentId',
  'instrumentType',
  'conceptIds',
  'rating',
  'wasUnsure',
  'durationMs',
  'selectionContext',
].sort();

const SUSPEND_RECORD_KEYS = [
  'schemaVersion',
  'kind',
  'eventId',
  'timestamp',
  'instrumentId',
  'conceptIds',
].sort();

/**
 * The order the current record schema's `parse` emits, which every record on
 * disk at that version must also be written in. Load-bearing rather than
 * cosmetic: `merge.ts` compares duplicate `eventId`s by serialised form, so a
 * fixture written in a different key order would be a different string for the
 * same event.
 *
 * `masteryAtTime` lands last and `selectionContext` did not move, so this list
 * doubles as the statement that v4 is v3's order with one key appended.
 */
const RECORD_KEY_ORDER = [
  'schemaVersion',
  'kind',
  'eventId',
  'timestamp',
  'instrumentId',
  'instrumentType',
  'rating',
  'wasUnsure',
  'durationMs',
  'selectionContext',
  'conceptIds',
  'masteryAtTime',
  // `ol-tka5` (v5): appended in schema declaration order, same discipline as
  // `masteryAtTime` above — all three optional, all three omissible.
  'supportLevelShown',
  'explainBackGrade',
  'schedulingObservation',
];

/** Every key a v5 review record may omit — `ol-tka5`'s three additions, plus
 * `masteryAtTime` from `ol-g6zg` — because nothing produces them for every
 * record yet. `RECORD_KEYS` below lists only what is mandatory. */
const OPTIONAL_RECORD_KEYS = [
  'masteryAtTime',
  'supportLevelShown',
  'explainBackGrade',
  'schedulingObservation',
] as const;

/** The union's runtime narrowing, used as the test's own reading of `kind`. */
function reviews(entries: readonly ReviewLogEntry[]): ReviewLogRecord[] {
  return entries.filter((e): e is ReviewLogRecord => e.kind === 'review');
}

function suspensions(entries: readonly ReviewLogEntry[]): SuspendLogRecord[] {
  return entries.filter((e): e is SuspendLogRecord => e.kind !== 'review');
}

/**
 * Fails a future edit that starts *omitting* a nullable key instead of
 * writing `null` for it — the regression this bead's acceptance criteria
 * names explicitly. Checked directly against the on-disk golden fixtures
 * (the actual format contract) rather than only against writer output, so a
 * regression anywhere in the pipeline — schema, writer, or a hand-edited
 * fixture — is caught here.
 */
function expectFullKeyShape(record: ReviewLogRecord): void {
  const keys = Object.keys(record);
  expect(keys.filter((k) => !(OPTIONAL_RECORD_KEYS as readonly string[]).includes(k)).sort()).toEqual(
    RECORD_KEYS,
  );
  // Every optional key is absent for exactly one reason: nothing was
  // recorded. A key present with an undefined value would be a third state,
  // and `JSON.stringify` would erase the difference on the way to disk.
  for (const key of OPTIONAL_RECORD_KEYS) {
    expect(keys.includes(key)).toBe((record as Record<string, unknown>)[key] !== undefined);
  }
  expect(Object.keys(record.selectionContext).sort()).toEqual(SELECTION_CONTEXT_KEYS);
}

describe('review-log golden fixtures — device-desktop (frozen v1 history, well-formed, full day)', () => {
  const result = parseReviewLog(readFixture(DESKTOP_V1_FIXTURE));

  it('the fixture on disk really is v1, with no kind field — the migration has something to migrate', () => {
    // Asserted against the raw bytes, not the parsed result: if someone
    // "helpfully" migrates this file, every other test here would still pass
    // and the v1 read path would silently stop being covered.
    const raw = readFixture(DESKTOP_V1_FIXTURE);
    for (const line of raw.split('\n').filter((l) => l.trim() !== '')) {
      expect(JSON.parse(line).schemaVersion).toBe(1);
      expect(JSON.parse(line)).not.toHaveProperty('kind');
    }
  });

  it('parses all three records with zero invalid lines', () => {
    expect(result.records).toHaveLength(3);
    expect(result.invalidLines).toEqual([]);
  });

  it('upgrades every v1 record to a current review event — never discarded, never guessed at', () => {
    // Retargeted from 2 to 3 by `ol-t3sd`, 3 to 4 by `ol-g6zg`, and 4 to 5 by
    // `ol-tka5`, because `parseReviewLog` returns current-shape entries by
    // contract and the current shape moved. The assertion itself — "a v1 line
    // comes back as a review event at the version this build reads, not as a
    // v1 line" — is the same one.
    for (const record of result.records) {
      expect(record.schemaVersion).toBe(5);
      expect(record.kind).toBe('review');
    }
  });

  it('every upgraded v1 record names exactly one concept — the migration invents nothing', () => {
    // A v1 record carries one `conceptId` because one is all that was ever
    // captured. `upgradeV2` maps it to a one-element list and stops; anything
    // longer here would mean a second binding had been guessed at from current
    // vault state and written into her append-only history as a fact.
    for (const record of result.records) {
      expect(record.conceptIds).toHaveLength(1);
    }
  });

  it('every record carries the full key shape, explicit nulls included', () => {
    for (const record of reviews(result.records)) expectFullKeyShape(record);
  });

  it('covers qa, cloze, and explain-back — including the non-FSRS-scheduled type D7.1 still logs', () => {
    expect(reviews(result.records).map((r) => r.instrumentType)).toEqual([
      'qa',
      'cloze',
      'explain-back',
    ]);
  });

  it('the explain-back record has a null rating and null durationMs (F2.16)', () => {
    const explainBack = reviews(result.records).find((r) => r.instrumentType === 'explain-back');
    expect(explainBack?.rating).toBeNull();
    expect(explainBack?.durationMs).toBeNull();
  });

  it('every record is Phase A shaped: examProximity, yieldRank, planVersion explicit null', () => {
    for (const record of reviews(result.records)) {
      expect(record.selectionContext.examProximity).toBeNull();
      expect(record.selectionContext.yieldRank).toBeNull();
      expect(record.selectionContext.planVersion).toBeNull();
    }
  });

  it('the upgrade preserves every original field value verbatim — it swaps and moves, it never rewrites', () => {
    const raw = readFixture(DESKTOP_V1_FIXTURE)
      .split('\n')
      .filter((l) => l.trim() !== '')
      .map((l) => JSON.parse(l) as Record<string, unknown>);

    result.records.forEach((upgraded, i) => {
      const original = raw[i];
      if (original === undefined) throw new Error('fixture/record count mismatch');
      const {
        schemaVersion: _v,
        kind: _k,
        conceptIds,
        masteryAtTime,
        selectionContext,
        ...carried
      } = upgraded as Record<string, unknown>;
      const {
        schemaVersion: _origV,
        conceptId,
        selectionContext: origContext,
        ...origRest
      } = original;
      expect(carried).toEqual(origRest);

      // The first field that changed, and the only shape it may take.
      expect(conceptIds).toEqual([conceptId]);

      // The second: `masteryAtTime` left `selectionContext` for the record.
      // Every other context field is carried through byte for byte, and the
      // mastery value itself is neither dropped nor reassigned — a v1 record
      // names one concept, so there is exactly one concept it can belong to.
      const { masteryAtTime: origMastery, ...origContextRest } = origContext as Record<
        string,
        unknown
      >;
      expect(selectionContext).toEqual(origContextRest);
      expect(masteryAtTime).toEqual(
        origMastery === null
          ? undefined
          : { attribution: 'per-concept', byConcept: { [conceptId as string]: origMastery } },
      );
    });
  });
});

describe('review-log golden fixtures — device-mobile (second device, same day)', () => {
  const result = parseReviewLog(readFixture(MOBILE_FIXTURE));

  it('parses both records with zero invalid lines', () => {
    expect(result.records).toHaveLength(2);
    expect(result.invalidLines).toEqual([]);
  });

  it("carries a duplicate (by eventId) of the desktop file's second record", () => {
    const desktop = parseReviewLog(readFixture(DESKTOP_V1_FIXTURE)).records;
    const desktopDup = desktop.find((r) => r.eventId === '22222222-2222-4222-8222-222222222222');
    const mobileDup = result.records.find(
      (r) => r.eventId === '22222222-2222-4222-8222-222222222222',
    );
    expect(mobileDup).toEqual(desktopDup);
  });

  it('a v1 record upgraded and a v2 record read natively serialise identically', () => {
    // Not a stylistic point. `merge.ts` compares duplicate `eventId`s by their
    // serialised form, so if the upgrade emitted keys in a different order than
    // the v2 read path, the same event arriving from an old device and a new
    // one would look like an id collision and throw — losing a real record to
    // a formatting difference.
    const desktop = parseReviewLog(readFixture(DESKTOP_V1_FIXTURE)).records;
    const upgraded = desktop.find((r) => r.eventId === '22222222-2222-4222-8222-222222222222');
    const native = result.records.find((r) => r.eventId === '22222222-2222-4222-8222-222222222222');
    expect(JSON.stringify(upgraded)).toBe(JSON.stringify(native));
  });
});

describe('review-log golden fixtures — device-crash (partial trailing line)', () => {
  const result = parseReviewLog(readFixture(CRASH_FIXTURE));

  it('recovers the one complete record written before the crash', () => {
    expect(result.records).toHaveLength(1);
    expect(result.records[0]?.eventId).toBe('11111111-1111-4111-8111-111111111111');
  });

  it('reports the truncated line as invalid rather than throwing or silently dropping it', () => {
    expect(result.invalidLines).toHaveLength(1);
    expect(result.invalidLines[0]?.lineNumber).toBe(2);
    expect(result.invalidLines[0]?.raw).toContain(
      '"eventId":"55555555-5555-4555-8555-555555555555"',
    );
  });
});

describe('review-log golden fixtures — two-device same-day merge', () => {
  const desktop = parseReviewLog(readFixture(DESKTOP_V1_FIXTURE)).records;
  const mobile = parseReviewLog(readFixture(MOBILE_FIXTURE)).records;

  it('merges to 4 unique records: 3 from desktop, 1 new from mobile, the shared one collapsed', () => {
    const merged = mergeReviewLogRecords(desktop, mobile);
    expect(merged.records).toHaveLength(4);
    expect(merged.duplicateEventIds).toEqual(['22222222-2222-4222-8222-222222222222']);
  });

  it('is commutative: merging mobile-first gives the identical result', () => {
    const forward = mergeReviewLogRecords(desktop, mobile);
    const backward = mergeReviewLogRecords(mobile, desktop);
    expect(backward).toEqual(forward);
  });

  it('is idempotent: merging the same two files twice changes nothing about the resulting records', () => {
    // `duplicateEventIds` legitimately grows on the "twice" call (every
    // event really was seen twice), but `records` — the actual merged log —
    // is exactly the same either way.
    const once = mergeReviewLogRecords(desktop, mobile);
    const twice = mergeReviewLogRecords(desktop, mobile, desktop, mobile);
    expect(twice.records).toEqual(once.records);
  });
});

describe('review-log golden fixtures — device-tablet (v2 suspension events, D-020)', () => {
  const result = parseReviewLog(readFixture(TABLET_SUSPEND_FIXTURE));

  it('parses all six lines with zero invalid lines', () => {
    expect(result.records).toHaveLength(6);
    expect(result.invalidLines).toEqual([]);
  });

  it('the union discriminates: reviews and suspension events come out of one file, told apart by kind', () => {
    expect(result.records.map((r) => r.kind)).toEqual([
      'review',
      'suspend',
      'review',
      'unsuspend',
      'suspend',
      'unsuspend',
    ]);
    expect(reviews(result.records)).toHaveLength(2);
    expect(suspensions(result.records)).toHaveLength(4);
  });

  it('a suspension record carries exactly six keys — no review fields nulled out, no reason, no deviceId', () => {
    for (const entry of suspensions(result.records)) {
      expect(Object.keys(entry).sort()).toEqual(SUSPEND_RECORD_KEYS);
    }
  });

  it('every suspension record carries the concept binding made at event time (INV-4)', () => {
    // The instrument→concept binding is not reconstructible later if the
    // instrument is edited or deleted, and this log cannot be backfilled.
    for (const entry of suspensions(result.records)) {
      expect(entry.conceptIds.length).toBeGreaterThan(0);
      for (const conceptId of entry.conceptIds) expect(conceptId.length).toBeGreaterThan(0);
    }
  });

  it('and names exactly one concept, because these lines were written as v2', () => {
    // The same restraint as on the review side: `upgradeV2` widened the field
    // and nothing else. A v2 suspend that came back with two concepts would
    // mean the migration had consulted the vault.
    for (const entry of suspensions(result.records)) {
      expect(entry.conceptIds).toHaveLength(1);
    }
  });

  it('review records in the same file are unaffected — full key shape, explicit nulls', () => {
    for (const record of reviews(result.records)) expectFullKeyShape(record);
  });

  it('projects to exactly the one instrument whose latest event is a suspend', () => {
    expect(suspendedInstrumentIds(result.records)).toEqual(new Set(['cloze:bioturbation:1']));
  });

  it('the out-of-order pair resolves by timestamp, not by line order', () => {
    // In the file, `mcq:appoggiatura:1`'s 11:15 unsuspend is written on the
    // line BEFORE its 09:40 suspend. A positional fold would report it
    // suspended.
    const mcqEvents = suspensions(result.records).filter(
      (e) => e.instrumentId === 'mcq:appoggiatura:1',
    );
    expect(mcqEvents.map((e) => e.kind)).toEqual(['unsuspend', 'suspend']);
    expect(suspendedInstrumentIds(result.records).has('mcq:appoggiatura:1')).toBe(false);
  });

  it('an unsuspend with no preceding suspend is a no-op, not an error', () => {
    const orphan = suspensions(result.records).filter(
      (e) => e.instrumentId === 'explain-back:cementation:1',
    );
    expect(orphan.map((e) => e.kind)).toEqual(['unsuspend']);
    expect(suspendedInstrumentIds(result.records).has('explain-back:cementation:1')).toBe(false);
  });

  it('a review of an instrument never puts it in, or takes it out of, the suspended set', () => {
    expect(suspendedInstrumentIds(result.records).has('qa:imbrication:1')).toBe(false);
    expect(suspendedInstrumentIds(reviews(result.records))).toEqual(new Set());
  });
});

describe('review-log golden fixtures — two devices suspending the same day (D-020, F2.6)', () => {
  const tablet = parseReviewLog(readFixture(TABLET_SUSPEND_FIXTURE)).records;
  const phone = parseReviewLog(readFixture(PHONE_SUSPEND_FIXTURE)).records;

  it('both device files parse cleanly', () => {
    expect(parseReviewLog(readFixture(PHONE_SUSPEND_FIXTURE)).invalidLines).toEqual([]);
    expect(phone.map((r) => r.kind)).toEqual(['suspend', 'unsuspend']);
  });

  it('the same suspend event on both devices merges to one, exactly as a duplicated review does', () => {
    const merged = mergeReviewLogRecords(tablet, phone);
    expect(merged.duplicateEventIds).toEqual(['bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb']);
    const suspendsOfCloze = suspensions(merged.records).filter(
      (e) => e.instrumentId === 'cloze:bioturbation:1' && e.kind === 'suspend',
    );
    expect(suspendsOfCloze).toHaveLength(1);
  });

  it("a suspend on one device and an unsuspend on the other both survive — neither is the merger's to resolve", () => {
    const merged = mergeReviewLogRecords(tablet, phone);
    const clozeEvents = suspensions(merged.records).filter(
      (e) => e.instrumentId === 'cloze:bioturbation:1',
    );
    expect(clozeEvents.map((e) => e.kind)).toEqual(['suspend', 'unsuspend']);
  });

  it('the projection over the merged log — not the merge — decides who won', () => {
    const merged = mergeReviewLogRecords(tablet, phone);
    // Suspended on the tablet at 09:20, unsuspended on the phone at 13:00.
    expect(suspendedInstrumentIds(merged.records)).toEqual(new Set());
    // And on the tablet alone it is still suspended: the two answers differ
    // because the histories differ, which is exactly what a projection should do.
    expect(suspendedInstrumentIds(tablet)).toEqual(new Set(['cloze:bioturbation:1']));
  });

  it('merging is commutative and idempotent for suspension events too', () => {
    const forward = mergeReviewLogRecords(tablet, phone);
    const backward = mergeReviewLogRecords(phone, tablet);
    expect(backward.records).toEqual(forward.records);
    expect(mergeReviewLogRecords(tablet, phone, tablet, phone).records).toEqual(forward.records);
    expect(suspendedInstrumentIds(backward.records)).toEqual(
      suspendedInstrumentIds(forward.records),
    );
  });

  it('a v1 file, a v2 review file and two v2 suspension files all merge into one coherent day', () => {
    // The real end state: her vault holds a semester of v1 history alongside
    // everything written since the bump, and one merged list has to make sense
    // of all of it.
    const desktopV1 = parseReviewLog(readFixture(DESKTOP_V1_FIXTURE)).records;
    const mobile = parseReviewLog(readFixture(MOBILE_FIXTURE)).records;
    const merged = mergeReviewLogRecords(desktopV1, mobile, tablet, phone);

    expect(merged.records.every((r) => r.schemaVersion === 5)).toBe(true);
    // Chronological, with suspension and review events interleaved.
    const instants = merged.records.map((r) => Date.parse(r.timestamp));
    expect(instants).toEqual([...instants].sort((a, b) => a - b));
    expect(suspendedInstrumentIds(merged.records)).toEqual(new Set());
  });
});

describe('every v2 fixture on disk really is still v2 — the files are extended, never migrated', () => {
  // The exact guard the v1 file has carried since D-020, extended to the v2
  // files by `ol-t3sd` for the same reason: if someone "helpfully" migrates one,
  // every other test here would still pass and the v2 read path plus `upgradeV2`
  // would silently stop being covered. Asserted against the raw bytes, not the
  // parsed result.
  for (const name of V2_FIXTURES) {
    it(`${name} carries schemaVersion 2 and a singular conceptId on every complete line`, () => {
      const raw = readFixture(name);
      for (const line of raw.split('\n').filter((l) => l.trim() !== '')) {
        let parsed: Record<string, unknown>;
        try {
          parsed = JSON.parse(line) as Record<string, unknown>;
        } catch {
          // The crash fixture's deliberately truncated trailing line. It is
          // part of the fixture and is not a complete record; skipping it here
          // is the same allowance `parse.spec.ts` makes.
          continue;
        }
        expect(parsed.schemaVersion).toBe(2);
        expect(parsed).toHaveProperty('conceptId');
        expect(parsed).not.toHaveProperty('conceptIds');
      }
    });
  }
});

describe('review-log golden fixtures — device-laptop (v3, the current writer output)', () => {
  const result = parseReviewLog(readFixture(LAPTOP_V3_FIXTURE));

  it('the fixture on disk really is v3, with conceptIds and no singular conceptId', () => {
    const raw = readFixture(LAPTOP_V3_FIXTURE);
    for (const line of raw.split('\n').filter((l) => l.trim() !== '')) {
      const parsed = JSON.parse(line) as Record<string, unknown>;
      expect(parsed.schemaVersion).toBe(3);
      expect(parsed).toHaveProperty('conceptIds');
      expect(parsed).not.toHaveProperty('conceptId');
    }
  });

  it('parses all four lines with zero invalid lines', () => {
    expect(result.records).toHaveLength(4);
    expect(result.invalidLines).toEqual([]);
  });

  it('every review record reaches the current key shape, explicit nulls included', () => {
    for (const record of reviews(result.records)) expectFullKeyShape(record);
  });

  it('a suspension record carries exactly six keys — no review fields nulled out, no reason, no deviceId', () => {
    for (const entry of suspensions(result.records)) {
      expect(Object.keys(entry).sort()).toEqual(SUSPEND_RECORD_KEYS);
    }
  });

  it('the file is written in the exact key order the schema emits', () => {
    // Not a style check. `merge.ts` compares duplicate `eventId`s by serialised
    // form, so a fixture in a different key order is a different string for the
    // same event and would be reported as a collision rather than a duplicate.
    const raw = readFixture(LAPTOP_V3_FIXTURE);
    for (const line of raw.split('\n').filter((l) => l.trim() !== '')) {
      const keys = Object.keys(JSON.parse(line) as Record<string, unknown>);
      const expected = RECORD_KEY_ORDER.filter((k) => keys.includes(k));
      expect(keys).toEqual(expected);
    }
  });

  it('carries the case no earlier version could express: one instrument, two concepts', () => {
    const multi = reviews(result.records).find(
      (r) => r.eventId === '77777777-7777-4777-8777-777777777777',
    );
    expect(multi?.conceptIds).toEqual(['imbrication', 'bioturbation']);
  });

  it('her authored order is preserved verbatim — nothing here sorts a concept list', () => {
    // R1/R2. `['imbrication','bioturbation']` is not sorted; a reader that
    // canonicalised the list would silently reorder what she wrote.
    const multi = reviews(result.records).find(
      (r) => r.eventId === '77777777-7777-4777-8777-777777777777',
    );
    expect(multi?.conceptIds).not.toEqual([...(multi?.conceptIds ?? [])].sort());
  });

  it('a suspension names the same two concepts as the review of that instrument', () => {
    // The point of moving the suspend record in step with the review record:
    // "what did she stop studying?" and "what did she practise?" must not
    // answer with different numbers of concepts for the same instrument.
    const suspend = suspensions(result.records).find(
      (e) => e.instrumentId === 'cloze:imbrication-bioturbation:1',
    );
    expect(suspend?.conceptIds).toEqual(['imbrication', 'bioturbation']);
  });

  it('an explain-back record can name several concepts and still carry null rating and duration (F2.16)', () => {
    const explainBack = reviews(result.records).find((r) => r.instrumentType === 'explain-back');
    expect(explainBack?.rating).toBeNull();
    expect(explainBack?.durationMs).toBeNull();
    expect(explainBack?.conceptIds).toEqual(['cementation', 'appoggiatura']);
  });
});

describe('a v1 file and a v3 file describing the same event (ol-t3sd)', () => {
  const desktopV1 = parseReviewLog(readFixture(DESKTOP_V1_FIXTURE)).records;
  const laptopV3 = parseReviewLog(readFixture(LAPTOP_V3_FIXTURE)).records;
  const SHARED = '11111111-1111-4111-8111-111111111111';

  it('a record migrated v1 -> v2 -> v3 and one read natively as v3 serialise identically', () => {
    // The v3 restatement of the property the v1/v2 pair already proves, and the
    // reason `upgradeV2` returns through `.parse` rather than as an object
    // literal: zod emits keys in schema order, so both paths produce the same
    // bytes for the same event.
    const migrated = desktopV1.find((r) => r.eventId === SHARED);
    const native = laptopV3.find((r) => r.eventId === SHARED);
    expect(migrated).toBeDefined();
    expect(native).toBeDefined();
    expect(JSON.stringify(migrated)).toBe(JSON.stringify(native));
  });

  it('they collapse to one event on merge, not to an id collision', () => {
    const merged = mergeReviewLogRecords(desktopV1, laptopV3);
    expect(merged.duplicateEventIds).toEqual([SHARED]);
    expect(merged.records.filter((r) => r.eventId === SHARED)).toHaveLength(1);
  });
});

describe('a whole vault of every version merges into one coherent day', () => {
  it('v1, v2 review, v2 suspension and v3 files all reach the current shape together', () => {
    // The real end state after two schema bumps: her vault holds history at
    // three versions, several devices' files for the same day, and one merged
    // list has to make sense of all of it.
    const desktopV1 = parseReviewLog(readFixture(DESKTOP_V1_FIXTURE)).records;
    const mobile = parseReviewLog(readFixture(MOBILE_FIXTURE)).records;
    const tablet = parseReviewLog(readFixture(TABLET_SUSPEND_FIXTURE)).records;
    const phone = parseReviewLog(readFixture(PHONE_SUSPEND_FIXTURE)).records;
    const laptop = parseReviewLog(readFixture(LAPTOP_V3_FIXTURE)).records;
    const merged = mergeReviewLogRecords(desktopV1, mobile, tablet, phone, laptop);

    expect(merged.records.every((r) => r.schemaVersion === 5)).toBe(true);
    expect(merged.records.every((r) => r.conceptIds.length >= 1)).toBe(true);

    const instants = merged.records.map((r) => Date.parse(r.timestamp));
    expect(instants).toEqual([...instants].sort((a, b) => a - b));

    // Exactly one record in the whole merged day names more than one concept,
    // and it is the one that was *written* at v3. Every migrated record names
    // one, because that is all its file ever held.
    const multi = merged.records.filter((r) => r.conceptIds.length > 1);
    expect(multi.map((r) => r.eventId).sort()).toEqual([
      '66666666-6666-4666-8666-666666666666',
      '77777777-7777-4777-8777-777777777777',
      '88888888-8888-4888-8888-888888888888',
    ]);

    // The projection still resolves suspension across every version: the
    // multi-concept instrument was suspended at 10:05 and never unsuspended.
    expect(suspendedInstrumentIds(merged.records)).toEqual(
      new Set(['cloze:imbrication-bioturbation:1']),
    );
  });
});

describe('the v3 fixture on disk is still v3 — extended, never migrated (`ol-g6zg`)', () => {
  // The same guard the v1 and v2 files carry, for the same reason: this file is
  // now the only proof left that the v3 read path and `upgradeV3` work, and the
  // only place the un-attributable mastery case exists at all. A well-meaning
  // migration of it would leave every other test here passing.
  it('carries schemaVersion 3 and masteryAtTime inside selectionContext on every review line', () => {
    const raw = readFixture(LAPTOP_V3_FIXTURE);
    for (const line of raw.split('\n').filter((l) => l.trim() !== '')) {
      const parsed = JSON.parse(line) as Record<string, unknown>;
      expect(parsed.schemaVersion).toBe(3);
      expect(parsed).not.toHaveProperty('masteryAtTime');
      if (parsed.kind !== 'review') continue;
      expect(parsed.selectionContext).toHaveProperty('masteryAtTime');
    }
  });

  it('still carries the record that cannot be attributed — two concepts, one mastery state', () => {
    // If this line ever stops looking like this, the `not-attributable` arm of
    // the v4 field has no evidence behind it anywhere in the repo.
    const raw = readFixture(LAPTOP_V3_FIXTURE);
    const line = raw
      .split('\n')
      .map((l) => (l.trim() === '' ? undefined : (JSON.parse(l) as Record<string, unknown>)))
      .find((l) => l?.eventId === '77777777-7777-4777-8777-777777777777');
    expect(line).toBeDefined();
    expect(line?.conceptIds).toEqual(['imbrication', 'bioturbation']);
    expect((line?.selectionContext as Record<string, unknown> | undefined)?.masteryAtTime).toBe(
      'sprout',
    );
  });
});

describe('migrating the v3 fixture — attribute where you can, decline where you cannot', () => {
  const result = parseReviewLog(readFixture(LAPTOP_V3_FIXTURE));

  it('a single-concept v3 record becomes a one-entry map — the same statement, the new shape', () => {
    const single = reviews(result.records).find(
      (r) => r.eventId === '11111111-1111-4111-8111-111111111111',
    );
    expect(single?.masteryAtTime).toEqual({
      attribution: 'per-concept',
      byConcept: { imbrication: 'sprout' },
    });
  });

  it('the two-concept record keeps its value and refuses to attribute it', () => {
    // The crux of the whole v4 decision. `"sprout"` was really recorded, so it
    // is not thrown away; which of the two concepts it described was never
    // captured, so it is not assigned — not to the first, not to both. Assigning
    // it would persist a guess into an append-only log, where it is
    // indistinguishable from a fact forever.
    const multi = reviews(result.records).find(
      (r) => r.eventId === '77777777-7777-4777-8777-777777777777',
    );
    expect(multi?.masteryAtTime).toEqual({ attribution: 'not-attributable', recorded: 'sprout' });
    expect(multi?.conceptIds).toEqual(['imbrication', 'bioturbation']);
  });

  it('a v3 record whose masteryAtTime was null comes back with no field at all', () => {
    // `null` meant "not recorded" and absence means "not recorded". Nothing is
    // lost in translating one to the other, and nothing is added.
    const explainBack = reviews(result.records).find(
      (r) => r.eventId === '66666666-6666-4666-8666-666666666666',
    );
    expect(explainBack?.masteryAtTime).toBeUndefined();
    expect(Object.hasOwn(explainBack ?? {}, 'masteryAtTime')).toBe(false);
  });

  it('the rest of selectionContext survives the move byte for byte', () => {
    for (const record of reviews(result.records)) {
      expectFullKeyShape(record);
      expect(record.selectionContext.examProximity).toBeNull();
      expect(record.selectionContext.yieldRank).toBeNull();
      expect(record.selectionContext.planVersion).toBeNull();
    }
  });

  it('a v3 suspension only has its version stamped forward', () => {
    const suspend = suspensions(result.records)[0];
    expect(suspend?.schemaVersion).toBe(5);
    expect(Object.keys(suspend ?? {}).sort()).toEqual(SUSPEND_RECORD_KEYS);
  });
});

describe('review-log golden fixtures — device-workstation (v5, the current writer output, `ol-tka5`)', () => {
  const result = parseReviewLog(readFixture(WORKSTATION_V5_FIXTURE));

  it('the fixture on disk really is v5, with masteryAtTime on the record and not in the context', () => {
    const raw = readFixture(WORKSTATION_V5_FIXTURE);
    for (const line of raw.split('\n').filter((l) => l.trim() !== '')) {
      const parsed = JSON.parse(line) as Record<string, unknown>;
      expect(parsed.schemaVersion).toBe(5);
      expect(parsed).toHaveProperty('conceptIds');
      if (parsed.kind !== 'review') continue;
      expect(parsed.selectionContext).not.toHaveProperty('masteryAtTime');
    }
  });

  it('parses all seven lines with zero invalid lines', () => {
    // Six lines carried forward from the retired v4 fixture (bumped in
    // place), plus a seventh added for this bead demonstrating the three new
    // fields together.
    expect(result.records).toHaveLength(7);
    expect(result.invalidLines).toEqual([]);
  });

  it('every review record carries the current key shape, explicit nulls included', () => {
    for (const record of reviews(result.records)) expectFullKeyShape(record);
  });

  it('the file is written in the exact key order the schema emits', () => {
    // Not a style check. `merge.ts` compares duplicate `eventId`s by serialised
    // form, so a fixture in a different key order is a different string for the
    // same event and would be reported as a collision rather than a duplicate.
    const raw = readFixture(WORKSTATION_V5_FIXTURE);
    for (const line of raw.split('\n').filter((l) => l.trim() !== '')) {
      const keys = Object.keys(JSON.parse(line) as Record<string, unknown>);
      const expected = RECORD_KEY_ORDER.filter((k) => keys.includes(k));
      expect(keys).toEqual(expected);
    }
  });

  it('carries a per-concept map with two independent entries — the shape no earlier version could express', () => {
    // v3 could say "this two-concept review happened while mastery was sprout".
    // It could not say *whose*. This is the sentence the version exists to make
    // sayable — structurally, regardless of what the two entries' values
    // happen to be.
    //
    // `ol-gwuo`: this line was authored pre-D-049 with two DIFFERENT
    // retired-vocabulary states ("coming" and "shaky"). D-049/VOC-1's collapse
    // maps both onto the single ratified word `sprout`, so both entries below
    // read the same value today — a known, accepted side effect of the
    // migration (INV-2 forbids editing this frozen-adjacent line to
    // manufacture difference; see the README). The two entries are still
    // independently attributed map entries, which is what this test checks.
    // The case of two *differing* values lives on `16161616-...` below.
    const multi = reviews(result.records).find(
      (r) => r.eventId === '12121212-1212-4121-8121-121212121212',
    );
    expect(multi?.conceptIds).toEqual(['imbrication', 'bioturbation']);
    expect(multi?.masteryAtTime).toEqual({
      attribution: 'per-concept',
      byConcept: { imbrication: 'sprout', bioturbation: 'sprout' },
    });
  });

  it('carries a record with two genuinely different mastery states across concepts (`ol-gwuo`)', () => {
    // Added because `12121212-...` (above) was authored pre-D-049 with two
    // DIFFERENT retired-vocabulary states and the vocabulary collapse made
    // both entries read identically. This new line demonstrates, post-
    // migration, the case v3 could never express at all: one instrument, two
    // concepts, two distinct current-vocabulary mastery states in one record.
    const multi = reviews(result.records).find(
      (r) => r.eventId === '16161616-1616-4161-8161-161616161616',
    );
    expect(multi?.conceptIds).toEqual(['imbrication', 'cementation']);
    expect(multi?.masteryAtTime).toEqual({
      attribution: 'per-concept',
      byConcept: { imbrication: 'sprout', cementation: 'sapling' },
    });
    // Adjacent growth stages (sprout → sapling), chosen from the ratified
    // four-value enum (`masteryState` in `review-log.ts`) — a fixture VALUE
    // choice, not a schema change.
    expect(multi?.masteryAtTime?.attribution).toBe('per-concept');
    if (multi?.masteryAtTime?.attribution === 'per-concept') {
      const values = Object.values(multi.masteryAtTime.byConcept);
      expect(new Set(values).size).toBeGreaterThan(1);
    }
  });

  it('the map names exactly the concepts the record names — enforced at the record, not the field', () => {
    for (const record of reviews(result.records)) {
      const mastery = record.masteryAtTime;
      if (mastery?.attribution !== 'per-concept') continue;
      expect(Object.keys(mastery.byConcept).sort()).toEqual([...record.conceptIds].sort());
    }
  });

  it('a record with no mastery recorded simply has no field — the state every writer produces today', () => {
    const unrecorded = reviews(result.records).find(
      (r) => r.eventId === '13131313-1313-4131-8131-131313131313',
    );
    expect(unrecorded?.masteryAtTime).toBeUndefined();
    // And the neighbouring context fields are still explicit nulls: the two
    // absences mean different things and are encoded differently on purpose.
    expect(Object.hasOwn(unrecorded?.selectionContext ?? {}, 'planVersion')).toBe(true);
    expect(unrecorded?.selectionContext.planVersion).toBeNull();
  });

  it('no line on disk carries the not-attributable form — no writer can produce it', () => {
    // It is reachable only as `upgradeV3`'s output for a v3 record, and nothing
    // rewrites a log file, so it can never be written. A fixture carrying one
    // would be describing a state the system cannot reach.
    expect(readFixture(WORKSTATION_V5_FIXTURE)).not.toContain('not-attributable');
  });

  it('an explain-back record can name several concepts, record no rating and no mastery (F2.16)', () => {
    const explainBack = reviews(result.records).find(
      (r) => r.instrumentType === 'explain-back' && r.eventId === '14141414-1414-4141-8141-141414141414',
    );
    expect(explainBack?.rating).toBeNull();
    expect(explainBack?.durationMs).toBeNull();
    expect(explainBack?.conceptIds).toEqual(['cementation', 'appoggiatura']);
    expect(explainBack?.masteryAtTime).toBeUndefined();
    // This is the plain "attempted, ungraded" case — no explainBackGrade at
    // all — which is exactly the gap `ol-tka5`'s bead names: an explain-back
    // attempt recorded with nowhere to put a verdict, unless one is graded.
    expect(explainBack?.explainBackGrade).toBeUndefined();
  });

  // `ol-tka5`: the seventh line, added for this bead's v5 bump. A graded
  // re-grade of the ungraded attempt above, demonstrating all three new
  // fields together on one record.
  describe('the seventh line — supportLevelShown, explainBackGrade and schedulingObservation together', () => {
    const graded = reviews(result.records).find(
      (r) => r.eventId === '17171717-1717-4171-8171-171717171717',
    );

    it('exists, is explain-back, and carries no rating (F2.16)', () => {
      expect(graded).toBeDefined();
      expect(graded?.instrumentType).toBe('explain-back');
      expect(graded?.rating).toBeNull();
      expect(graded?.durationMs).toBeNull();
    });

    it('carries an objective support level (D-094, principle 16, F2.20)', () => {
      expect(graded?.supportLevelShown).toBe('guided');
    });

    it('carries a graded SOLO verdict pointing at opaque content, never her text (D-005)', () => {
      expect(graded?.explainBackGrade).toEqual({
        soloLevel: 'relational',
        contentRef: 'content:cementation-grade-1',
        revisionOf: '14141414-1414-4141-8141-141414141414',
        artifactProvenance: {
          taskId: 'grade.explain-back.v1',
          promptVersion: '2026-08-26',
          modelId: 'workers-ai:test-model',
        },
      });
    });

    it('`revisionOf` names the earlier ungraded attempt on disk in this same file', () => {
      const original = reviews(result.records).find(
        (r) => r.eventId === '14141414-1414-4141-8141-141414141414',
      );
      expect(original).toBeDefined();
      expect(graded?.explainBackGrade?.revisionOf).toBe(original?.eventId);
    });

    it('carries a scheduling observation naming a neighbour concept, never its own subject (C5.11)', () => {
      expect(graded?.schedulingObservation).toEqual({ neighbourConceptId: 'imbrication' });
      expect(graded?.conceptIds).not.toContain(graded?.schedulingObservation?.neighbourConceptId);
    });
  });
});

describe('a v1 file, a v3 file and a v5 file describing the same event (`ol-g6zg`, `ol-tka5`)', () => {
  const desktopV1 = parseReviewLog(readFixture(DESKTOP_V1_FIXTURE)).records;
  const laptopV3 = parseReviewLog(readFixture(LAPTOP_V3_FIXTURE)).records;
  const workstationV5 = parseReviewLog(readFixture(WORKSTATION_V5_FIXTURE)).records;
  const SHARED = '11111111-1111-4111-8111-111111111111';

  it('all three paths into v5 serialise identically', () => {
    // The v5 restatement of the property each earlier bump proved, and the
    // reason every hop of the migration returns through `.parse` rather than as
    // an object literal: zod emits keys in schema order, so a record reaching
    // one device through the full v1→v2→v3→v5 chain, another through v3→v5, and
    // a third natively produce the same bytes for the same event.
    const viaV1 = desktopV1.find((r) => r.eventId === SHARED);
    const viaV3 = laptopV3.find((r) => r.eventId === SHARED);
    const native = workstationV5.find((r) => r.eventId === SHARED);
    expect(viaV1).toBeDefined();
    expect(viaV3).toBeDefined();
    expect(native).toBeDefined();
    expect(JSON.stringify(viaV1)).toBe(JSON.stringify(native));
    expect(JSON.stringify(viaV3)).toBe(JSON.stringify(native));
  });

  it('they collapse to one event on merge, not to an id collision', () => {
    const merged = mergeReviewLogRecords(desktopV1, laptopV3, workstationV5);
    expect(merged.duplicateEventIds).toEqual([SHARED]);
    expect(merged.records.filter((r) => r.eventId === SHARED)).toHaveLength(1);
  });
});

describe('a whole vault of all four versions merges into one coherent day', () => {
  it('v1, v2 review, v2 suspension, v3 and v5 files all reach the current shape together', () => {
    // The real end state after four schema bumps: her vault holds history at
    // four readable versions, six devices' files for the same day, and one
    // merged list has to make sense of all of it.
    const desktopV1 = parseReviewLog(readFixture(DESKTOP_V1_FIXTURE)).records;
    const mobile = parseReviewLog(readFixture(MOBILE_FIXTURE)).records;
    const tablet = parseReviewLog(readFixture(TABLET_SUSPEND_FIXTURE)).records;
    const phone = parseReviewLog(readFixture(PHONE_SUSPEND_FIXTURE)).records;
    const laptop = parseReviewLog(readFixture(LAPTOP_V3_FIXTURE)).records;
    const workstation = parseReviewLog(readFixture(WORKSTATION_V5_FIXTURE)).records;
    const merged = mergeReviewLogRecords(desktopV1, mobile, tablet, phone, laptop, workstation);

    expect(merged.records.every((r) => r.schemaVersion === 5)).toBe(true);
    expect(merged.records.every((r) => r.conceptIds.length >= 1)).toBe(true);

    const instants = merged.records.map((r) => Date.parse(r.timestamp));
    expect(instants).toEqual([...instants].sort((a, b) => a - b));

    // Exactly one record in the whole merged day declines to attribute its
    // mastery, and it is the two-concept review that was *written* at v3. Every
    // other non-null value in the day came from a single-concept record, where
    // there was only ever one concept it could belong to.
    const declined = reviews(merged.records).filter(
      (r) => r.masteryAtTime?.attribution === 'not-attributable',
    );
    expect(declined.map((r) => r.eventId)).toEqual(['77777777-7777-4777-8777-777777777777']);

    // Two records name two concepts each with a per-concept mastery map — the
    // shape only v4 can express — but only one of them holds two genuinely
    // *distinct* values today. `12121212-...` was authored pre-D-049 with two
    // different retired-vocabulary states; the D-049/VOC-1 collapse maps both
    // onto the ratified word `sprout`, so its two entries now coincide
    // (`ol-gwuo`; INV-2 forbids editing that frozen-adjacent line to
    // manufacture difference). `16161616-...` is the fixture line added for
    // `ol-gwuo` specifically to keep this case demonstrated post-migration.
    const perConceptMulti = reviews(merged.records).filter(
      (r) =>
        r.masteryAtTime?.attribution === 'per-concept' &&
        Object.keys(r.masteryAtTime.byConcept).length > 1,
    );
    expect(perConceptMulti.map((r) => r.eventId).sort()).toEqual(
      ['12121212-1212-4121-8121-121212121212', '16161616-1616-4161-8161-161616161616'].sort(),
    );

    const distinctPerConcept = perConceptMulti.filter((r) => {
      if (r.masteryAtTime?.attribution !== 'per-concept') return false;
      return new Set(Object.values(r.masteryAtTime.byConcept)).size > 1;
    });
    expect(distinctPerConcept.map((r) => r.eventId)).toEqual([
      '16161616-1616-4161-8161-161616161616',
    ]);

    // The projection still resolves suspension across every version.
    expect(suspendedInstrumentIds(merged.records)).toEqual(
      new Set(['cloze:imbrication-bioturbation:1', 'cloze:imbrication-bioturbation:2']),
    );
  });
});
