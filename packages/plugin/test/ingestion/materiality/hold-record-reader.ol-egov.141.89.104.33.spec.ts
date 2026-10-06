/**
 * [D-500] / [D-502] (ol-egov.141.89.104.33): the hold-record reader and the consumer hold check,
 * the reader floor's second piece. Every hold this build can read holds; an unknown reason or an
 * unknown version keeps the hold; bytes that name no readable passage are not a hold, are left
 * untouched and are reported; an unreadable store is never read as no holds. Reading writes
 * nothing. Synthetic text only (invented terms from the validation fixture world).
 */
import { describe, expect, it } from 'vitest';
import {
  CITATION_ANCHOR_STORAGE_KEY,
  ObsidianCitationHashStore,
} from '../../../src/ingestion/materiality/citation-hash-store.js';
import {
  type CitedPassage,
  checkHolds,
  citedPassagesOf,
  classifyHoldRecord,
  type HoldStoreRead,
  heldEffect,
  holdCoversPassage,
  mergeHoldReads,
  NEWER_FACT_HOLD_REASON,
  readHoldText,
  resolveHoldWithheldInstruments,
  summariseHoldRead,
} from '../../../src/ingestion/materiality/hold-record-reader.js';

const SOURCE = 'Orm course/Lecture 4 transcript.md';
const OTHER_SOURCE = 'Orm course/Lecture 5 transcript.md';
const D1 = `p1:${'a'.repeat(64)}`;
const D2 = `p1:${'b'.repeat(64)}`;
const D1_UNDER_RULE_2 = `p2:${'a'.repeat(64)}`;

/** `null` for no digest: an explicit `undefined` would take the default. */
const passage = (sourcePath = SOURCE, passageDigest: string | null = D1) => ({
  sourcePath,
  ...(passageDigest !== null ? { passageDigest } : {}),
});

const record = (overrides: Record<string, unknown> = {}) => ({
  id: 'hold-1',
  factId: 'cor:9',
  passage: passage(),
  reason: NEWER_FACT_HOLD_REASON,
  ...overrides,
});

const line = (value: unknown) => JSON.stringify(value);
const text = (...lines: string[]) => `${lines.join('\n')}\n`;
const citing = (sourcePath = SOURCE, passageDigest: string | null = D1): CitedPassage => ({
  sourcePath,
  ...(passageDigest !== null ? { passageDigest } : {}),
});

describe('classifyHoldRecord: what counts as a hold', () => {
  it('reads a complete envelope with the known reason', () => {
    const hold = classifyHoldRecord(record());
    expect(hold).toEqual({
      id: 'hold-1',
      factId: 'cor:9',
      passage: { sourcePath: SOURCE, passageDigest: D1 },
      reason: NEWER_FACT_HOLD_REASON,
      reasonRecognised: true,
      envelopeComplete: true,
    });
  });

  it('keeps a reason it has never seen as the raw string, and it is still a hold (O5, M8)', () => {
    const hold = classifyHoldRecord(record({ reason: 'zz-future' }));
    expect(hold?.reason).toBe('zz-future');
    expect(hold?.reasonRecognised).toBe(false);
    expect(
      checkHolds(readHoldText(text(line(record({ reason: 'zz-future' })))), [citing()]),
    ).toEqual({
      held: true,
      cause: 'hold',
      reasons: [{ reason: 'zz-future', recognised: false, factId: 'cor:9' }],
    });
  });

  it('a lecturer-correction reason this reader cannot evaluate is a hold like any other (M8b)', () => {
    const hold = classifyHoldRecord(record({ reason: 'lecturer-correction' }));
    expect(hold).not.toBeNull();
    expect(hold?.reasonRecognised).toBe(false);
  });

  it('a newer version marker and unknown fields are ignored; the passage still holds (O3)', () => {
    const hold = classifyHoldRecord(
      record({ version: 7, schemaVersion: 99, kindDetail: { anything: [1, 2] }, extra: 'x' }),
    );
    expect(hold?.passage).toEqual({ sourcePath: SOURCE, passageDigest: D1 });
    expect(hold?.envelopeComplete).toBe(true);
    const unknownPassageFields = classifyHoldRecord(
      record({
        passage: { ...passage(), quote: 'Skell causes', window: [3, 9], structure: 'part 9' },
      }),
    );
    expect(unknownPassageFields?.passage).toEqual({ sourcePath: SOURCE, passageDigest: D1 });
  });

  it('a missing or malformed reason, id or fact id never drops a hold whose passage reads', () => {
    for (const overrides of [
      { reason: undefined },
      { reason: 42 },
      { reason: '' },
      { id: undefined },
      { id: 7 },
      { factId: null },
    ]) {
      const hold = classifyHoldRecord(record(overrides));
      expect(hold, JSON.stringify(overrides)).not.toBeNull();
      expect(hold?.envelopeComplete).toBe(false);
      expect(hold?.passage.sourcePath).toBe(SOURCE);
    }
  });

  it('a digest field that is not a usable string still holds by its source', () => {
    const hold = classifyHoldRecord(record({ passage: { sourcePath: SOURCE, passageDigest: 12 } }));
    expect(hold?.passage).toEqual({ sourcePath: SOURCE, digestUnreadable: true });
    expect(hold?.envelopeComplete).toBe(false);
    expect(holdCoversPassage(hold?.passage ?? {}, citing(SOURCE, D2))).toBe(true);
  });

  it('a record that names no readable passage is not a hold', () => {
    for (const value of [
      null,
      42,
      'hold',
      [record()],
      {},
      record({ passage: undefined }),
      record({ passage: 'p1:abc' }),
      record({ passage: [SOURCE] }),
      record({ passage: {} }),
      record({ passage: { sourcePath: '', passageDigest: '' } }),
      record({ passage: { sourcePath: 3, passageDigest: 4 } }),
    ]) {
      expect(classifyHoldRecord(value), JSON.stringify(value)).toBeNull();
    }
  });
});

describe('readHoldText: torn, corrupt and repeated lines', () => {
  it('a torn final line is not a hold, is reported by line, and the holds before it hold', () => {
    const full = line(record({ id: 'hold-2', passage: passage(OTHER_SOURCE, D2) }));
    const torn = full.slice(0, 31);
    const read = readHoldText(`${line(record())}\n${torn}`);
    expect(read.holds.map((hold) => hold.id)).toEqual(['hold-1']);
    expect(read.unreadable).toEqual([{ line: 2, kind: 'torn', length: torn.length }]);
  });

  it('a corrupt line between two readable holds is reported, and both holds still hold (M2)', () => {
    const read = readHoldText(
      text(
        line(record()),
        '\u0000\u0000\u0000{"id":"hold-',
        line(record({ id: 'hold-3', passage: passage(OTHER_SOURCE, D2) })),
      ),
    );
    expect(read.holds.map((hold) => hold.id)).toEqual(['hold-1', 'hold-3']);
    expect(read.unreadable).toEqual([{ line: 2, kind: 'not-json', length: 15 }]);
    expect(checkHolds(read, [citing()]).held).toBe(true);
    expect(checkHolds(read, [citing(OTHER_SOURCE, D2)]).held).toBe(true);
  });

  it('a hold appended straight after a torn fragment, on the same line, is read and holds', () => {
    const fragment = line(record({ id: 'hold-0' })).slice(0, 40);
    const read = readHoldText(text(`${fragment}${line(record({ id: 'hold-9' }))}`));
    expect(read.holds.map((hold) => hold.id)).toEqual(['hold-9']);
    expect(read.unreadable).toEqual([{ line: 1, kind: 'torn', length: fragment.length }]);
  });

  it('a fragment cut inside a string, followed by a hold, still yields the hold', () => {
    const fragment = '{"id":"hold-0","passage":{"sourcePath":"Orm course/Lec';
    const read = readHoldText(text(`${fragment}${line(record({ id: 'hold-9' }))}`));
    expect(read.holds.map((hold) => hold.id)).toEqual(['hold-9']);
    expect(read.unreadable.map((entry) => entry.kind)).toEqual(['torn']);
  });

  it('two records written back to back with no newline are both read', () => {
    const read = readHoldText(
      text(
        `${line(record())}${line(record({ id: 'hold-4', passage: passage(OTHER_SOURCE, D2) }))}`,
      ),
    );
    expect(read.holds.map((hold) => hold.id)).toEqual(['hold-1', 'hold-4']);
    expect(read.unreadable).toEqual([]);
  });

  it('an unterminated final line that parses is a whole record', () => {
    const read = readHoldText(line(record()));
    expect(read.holds).toHaveLength(1);
    expect(read.unreadable).toEqual([]);
  });

  it('a line that parses but names no passage is reported as not a hold', () => {
    const read = readHoldText(
      text(line({ factId: 'cor:9', kind: 'correction' }), line([1, 2]), '"x"'),
    );
    expect(read.holds).toEqual([]);
    expect(read.unreadable.map((entry) => [entry.line, entry.kind])).toEqual([
      [1, 'not-a-hold'],
      [2, 'not-a-hold'],
      [3, 'not-a-hold'],
    ]);
  });

  it('a repeated publication reads as one hold (M10)', () => {
    const read = readHoldText(text(line(record()), line(record()), line(record())));
    expect(read.holds).toHaveLength(1);
  });

  it('two distinct holds on one passage are both kept', () => {
    const read = readHoldText(
      text(line(record()), line(record({ id: 'hold-b', factId: 'cor:12' }))),
    );
    expect(read.holds).toHaveLength(2);
    const check = checkHolds(read, [citing()]);
    expect(check.held && check.cause === 'hold' ? check.reasons.map((r) => r.factId) : []).toEqual([
      'cor:9',
      'cor:12',
    ]);
  });

  it('tolerates a byte-order mark, CR line ends and blank lines', () => {
    const read = readHoldText(
      `﻿${line(record())}\r\n\r\n   \n${line(record({ id: 'hold-5', passage: passage(OTHER_SOURCE) }))}\r\n`,
    );
    expect(read.holds.map((hold) => hold.id)).toEqual(['hold-1', 'hold-5']);
    expect(read.unreadable).toEqual([]);
  });

  it('an empty text is read, with no holds', () => {
    expect(readHoldText('')).toEqual({ status: 'read', holds: [], unreadable: [] });
  });

  it('a long corrupt line full of braces is reported without unbounded work', () => {
    const corrupt = `x${'{'.repeat(20_000)}`;
    const started = Date.now();
    const read = readHoldText(text(corrupt, line(record())));
    expect(Date.now() - started).toBeLessThan(5_000);
    expect(read.unreadable).toEqual([{ line: 1, kind: 'not-json', length: corrupt.length }]);
    expect(read.holds).toHaveLength(1);
  });
});

describe('mergeHoldReads', () => {
  const one = readHoldText(text(line(record())));
  const two = readHoldText(
    text(line(record()), line(record({ id: 'hold-6', passage: passage(OTHER_SOURCE) }))),
  );

  it('an unavailable part makes the whole unavailable, never fewer holds', () => {
    expect(mergeHoldReads([one, { status: 'unavailable' }, two])).toEqual({
      status: 'unavailable',
    });
  });

  it('no store anywhere is absent', () => {
    expect(mergeHoldReads([])).toEqual({ status: 'absent' });
    expect(mergeHoldReads([{ status: 'absent' }, { status: 'absent' }])).toEqual({
      status: 'absent',
    });
  });

  it('combines the holds of every part, one hold per repeated publication', () => {
    const merged = mergeHoldReads([one, { status: 'absent' }, two]);
    expect(merged.status === 'read' ? merged.holds.map((hold) => hold.id) : []).toEqual([
      'hold-1',
      'hold-6',
    ]);
  });
});

describe('holdCoversPassage', () => {
  it('equal digests under one rule match, even across a renamed or moved source', () => {
    expect(holdCoversPassage(passage(), citing())).toBe(true);
    expect(holdCoversPassage(passage(), citing(OTHER_SOURCE, D1))).toBe(true);
  });

  it('different digests under one rule do not match, even in the same source', () => {
    expect(holdCoversPassage(passage(), citing(SOURCE, D2))).toBe(false);
  });

  it('digests that cannot be compared fall back to the source, so the hold covers it', () => {
    expect(holdCoversPassage(passage(SOURCE, null), citing(SOURCE, D2))).toBe(true);
    expect(holdCoversPassage(passage(), citing(SOURCE, null))).toBe(true);
    expect(holdCoversPassage(passage(SOURCE, 'not-a-digest'), citing(SOURCE, D2))).toBe(true);
    expect(holdCoversPassage(passage(SOURCE, D1_UNDER_RULE_2), citing(SOURCE, D2))).toBe(true);
  });

  it('uncomparable digests in a different source do not match', () => {
    expect(holdCoversPassage(passage(SOURCE, null), citing(OTHER_SOURCE, D1))).toBe(false);
    expect(holdCoversPassage({ passageDigest: D1_UNDER_RULE_2 }, citing(SOURCE, D1))).toBe(false);
  });
});

describe('checkHolds and heldEffect: the consumer hold check', () => {
  const holding = readHoldText(text(line(record())));

  it('an instrument citing a held passage is not shown, not support and not reviewable', () => {
    const check = checkHolds(holding, [citing()]);
    expect(check.held).toBe(true);
    expect(heldEffect('instrument', check)).toEqual({
      display: 'not-shown',
      supportUse: false,
      reviewEligible: false,
    });
  });

  it('an explanation claim citing a held passage is shown withdrawn', () => {
    expect(heldEffect('explanation-claim', checkHolds(holding, [citing()]))).toEqual({
      display: 'shown-withdrawn',
      supportUse: false,
      reviewEligible: false,
    });
  });

  it('one held passage among several cited holds the artifact', () => {
    expect(checkHolds(holding, [citing(OTHER_SOURCE, D2), citing()]).held).toBe(true);
  });

  it('a different passage of the same source is untouched', () => {
    const check = checkHolds(holding, [citing(SOURCE, D2)]);
    expect(check).toEqual({ held: false });
    expect(heldEffect('instrument', check)).toBeNull();
  });

  it('no hold store at all holds nothing', () => {
    expect(checkHolds({ status: 'absent' }, [citing()])).toEqual({ held: false });
  });

  it('a store that cannot be read is never read as no holds', () => {
    const unavailable: HoldStoreRead = { status: 'unavailable' };
    expect(checkHolds(unavailable, [citing(OTHER_SOURCE, D2)])).toEqual({
      held: true,
      cause: 'hold-store-unavailable',
    });
    expect(heldEffect('instrument', checkHolds(unavailable, [citing()]))?.display).toBe(
      'not-shown',
    );
  });

  it('an artifact that cites no passage is untouched, even when the store cannot be read', () => {
    expect(checkHolds({ status: 'unavailable' }, [])).toEqual({ held: false });
    expect(checkHolds(holding, [])).toEqual({ held: false });
  });

  it('resolves the withheld set to union with the anchor pending set', () => {
    const held = resolveHoldWithheldInstruments(holding, [
      { instrumentId: 'i:7', cited: [citing()] },
      { instrumentId: 'i:12', cited: [citing(OTHER_SOURCE, D2)] },
      { instrumentId: 'i:13', cited: [] },
    ]);
    expect([...held]).toEqual(['i:7']);
  });
});

describe('the hold check beside the citation anchor table', () => {
  class RecordingDataHost {
    blob: Record<string, unknown> = {};
    writes = 0;
    async loadData(): Promise<unknown> {
      return this.blob;
    }
    async saveData(data: unknown): Promise<void> {
      this.writes += 1;
      this.blob = data as Record<string, unknown>;
    }
  }

  it('a hold on where the anchor now stands holds the instrument; reading writes nothing (M11)', async () => {
    const host = new RecordingDataHost();
    host.blob = {
      [CITATION_ANCHOR_STORAGE_KEY]: {
        'i:7': {
          sourcePath: OTHER_SOURCE,
          text: 'Skell causes the Orm level to drop.',
          conceptIds: ['concept-skell'],
          passageDigest: D2,
          // [D-473]: an anchor reason this build does not know is kept, and the anchor still loads.
          pendingRevalidation: { sinceContentHash: 'k1', since: 1, reason: 'zz-future' },
        },
      },
    };
    const before = JSON.stringify(host.blob);
    const store = new ObsidianCitationHashStore(host);
    const anchor = (await store.loadAll()).get('i:7');
    const sidecar = { sourcePath: SOURCE, passageDigest: D1 };
    const holds = readHoldText(text(line(record({ passage: passage(OTHER_SOURCE, D2) }))));
    const check = checkHolds(holds, citedPassagesOf(sidecar, anchor));
    expect(check.held).toBe(true);
    expect(checkHolds(holds, citedPassagesOf(sidecar, undefined)).held).toBe(false);
    expect(host.writes).toBe(0);
    expect(JSON.stringify(host.blob)).toBe(before);
  });
});

describe('summariseHoldRead: counts only', () => {
  it('reports counts and never a path, digest, fact id or reason text', () => {
    const read = readHoldText(
      text(
        line(record()),
        line(record({ id: 'hold-7', reason: 'zz-future', passage: passage(OTHER_SOURCE, D2) })),
        line(record({ id: undefined, passage: { sourcePath: 'Orm course/Notes.md' } })),
        '{"id":',
        line({ nothing: true }),
      ),
    );
    const summary = summariseHoldRead(read);
    expect(summary).toEqual({
      status: 'read',
      holds: 3,
      unrecognisedReasons: 1,
      incompleteEnvelopes: 1,
      torn: 0,
      notJson: 1,
      notAHold: 1,
    });
    const serialised = JSON.stringify(summary);
    for (const content of ['Orm', 'cor:9', 'zz-future', D1, 'hold-']) {
      expect(serialised.includes(content), content).toBe(false);
    }
    expect(summariseHoldRead({ status: 'unavailable' }).status).toBe('unavailable');
  });
});
