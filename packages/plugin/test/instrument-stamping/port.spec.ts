/**
 * Scenarios: `features/F2-review.md`, "F2.15b — First sight of a
 * vault-authored instrument stamps its durable marker" —
 * `@auto:plugin/instrument-stamping/port.spec`.
 *
 * `stampOnFirstSight` (`ol-2zfj.53`) is the write half of `[D-030]`/`[D-177]`
 * that had no production caller for a hand-authored instrument. This suite
 * drives it directly against a real, in-memory vault and real `olea-core`
 * parsing/enumeration — no fakes for the parts that decide what gets written.
 * INV-3: every fixture below is coined for this suite.
 */

import type { VaultInstrumentRecord } from 'olea-core';
import { enumerateVaultInstruments, PROVISIONAL_ID_PREFIX, removeSpans } from 'olea-core';
import { describe, expect, it, vi } from 'vitest';
import {
  createStampOnFirstSightPort,
  stampOnFirstSight,
} from '../../src/instrument-stamping/port.js';
import { memoryVault } from '../review/memory-vault.js';

const FRONTMATTER = (topic: string, course = 'TEST101') =>
  ['---', `topic: ${topic}`, `course: ${course}`, '---', ''].join('\n');

const MCQ_BLOCK = [
  '```olea-mcq',
  'stem: Which structure is it?',
  'answer: The right one',
  'distractor: d1',
  'distractor: d2',
  'distractor: d3',
  'distractor: d4',
  '```',
].join('\n');

async function recordsFor(vault: ReturnType<typeof memoryVault>): Promise<{
  readonly records: readonly VaultInstrumentRecord[];
  readonly recordsById: ReadonlyMap<string, VaultInstrumentRecord>;
}> {
  const found = await enumerateVaultInstruments(vault);
  return {
    records: found.records,
    recordsById: new Map(found.records.map((r) => [r.instrumentId, r])),
  };
}

function only(
  records: readonly VaultInstrumentRecord[],
  type: VaultInstrumentRecord['instrumentType'],
): VaultInstrumentRecord {
  const record = records.find((r) => r.instrumentType === type);
  if (!record) throw new Error(`fixture has no ${type} instrument`);
  return record;
}

describe('stampOnFirstSight — MCQ', () => {
  function vault() {
    return memoryVault({
      'Courses/TEST101/one.md': [FRONTMATTER('[Alpha]'), '## Q1', '', MCQ_BLOCK, ''].join('\n'),
    });
  }

  it('stamps an unstamped MCQ block, once, and returns the durable id', async () => {
    const v = vault();
    const { records } = await recordsFor(v);
    const record = only(records, 'mcq');
    expect(record.instrumentId).toContain(PROVISIONAL_ID_PREFIX);

    const result = await stampOnFirstSight(v, record, { generateMcqId: () => 'mcq-fixed1' });

    expect(result.instrumentId).toBe('mcq-fixed1');
    expect(v.writes).toEqual(['Courses/TEST101/one.md']);
    expect(v.contentOf('Courses/TEST101/one.md')).toContain('id: mcq-fixed1');
  });

  it('INV-2: the write is byte-identical to the original outside the inserted `id:` line', async () => {
    const v = vault();
    const before = v.contentOf('Courses/TEST101/one.md') ?? '';
    const { records } = await recordsFor(v);
    const record = only(records, 'mcq');

    await stampOnFirstSight(v, record, { generateMcqId: () => 'mcq-fixed1' });
    const after = v.contentOf('Courses/TEST101/one.md') ?? '';
    expect(after).not.toBe(before);
    expect(after).toContain('id: mcq-fixed1\n');

    const insertedStart = after.indexOf('id: mcq-fixed1');
    const insertedEnd = insertedStart + 'id: mcq-fixed1\n'.length;
    expect(removeSpans(after, [{ start: insertedStart, end: insertedEnd }])).toBe(before);
  });

  it('is idempotent: a second call over the durably-stamped id writes nothing more', async () => {
    const v = vault();
    const { records } = await recordsFor(v);
    const record = only(records, 'mcq');
    const first = await stampOnFirstSight(v, record, { generateMcqId: () => 'mcq-fixed1' });
    expect(v.writes).toHaveLength(1);

    // Re-enumerate: the record for the now-stamped block carries the durable,
    // non-provisional id (`instrument-id.spec.ts`'s own `.toBe` assertion for
    // this case).
    const { records: after } = await recordsFor(v);
    const restamped = only(after, 'mcq');
    expect(restamped.instrumentId).toBe(first.instrumentId);
    expect(restamped.instrumentId).not.toContain(PROVISIONAL_ID_PREFIX);

    const second = await stampOnFirstSight(v, restamped);
    expect(second.instrumentId).toBe(first.instrumentId);
    expect(v.writes).toHaveLength(1); // no new write — a durable MCQ id never even reaches vault.read
  });

  it('an already-durable MCQ never reads the vault at all — the prefix check alone is sufficient', async () => {
    const v = vault();
    const { records } = await recordsFor(v);
    const record = only(records, 'mcq');
    await stampOnFirstSight(v, record, { generateMcqId: () => 'mcq-fixed1' });
    const { records: after } = await recordsFor(v);
    const durable = only(after, 'mcq');

    const readSpy = vi.spyOn(v, 'read');
    await stampOnFirstSight(v, durable);
    expect(readSpy).not.toHaveBeenCalled();
  });
});

describe('stampOnFirstSight — Q&A', () => {
  function vault() {
    return memoryVault({
      'Courses/TEST101/qa.md': [
        FRONTMATTER('[Alpha]'),
        '## Q1',
        '',
        'The front::The back',
        '',
      ].join('\n'),
    });
  }

  it("stamps the durable block id onto the card's OWN line, not a separate anchor line", async () => {
    const v = vault();
    const { records } = await recordsFor(v);
    const record = only(records, 'qa');
    expect(record.blockId).toBeNull();

    const result = await stampOnFirstSight(v, record, { generateBlockId: () => 'durable1' });

    expect(result.instrumentId).toContain('^durable1');
    const content = v.contentOf('Courses/TEST101/qa.md') ?? '';
    expect(content).toContain('The front::The back ^durable1');
  });

  it('the stamped id survives a heading rename — it is anchored on the card, not the heading', async () => {
    const v = vault();
    const { records } = await recordsFor(v);
    const record = only(records, 'qa');
    const stamped = await stampOnFirstSight(v, record, { generateBlockId: () => 'durable1' });

    await v.write(
      'Courses/TEST101/qa.md',
      (v.contentOf('Courses/TEST101/qa.md') ?? '').replace('## Q1', '## A totally new title'),
    );
    const { records: after } = await recordsFor(v);
    const renamed = only(after, 'qa');
    expect(renamed.instrumentId).toBe(stamped.instrumentId);
  });

  it('the durable id it returns is exactly what a FRESH enumeration would derive — even for a card that was not first under its heading', async () => {
    // Regression: the returned id must use ordinal `1` under the card's own
    // new block-id anchor (globally unique, so always the sole occupant),
    // never the ordinal it had under the OLD heading anchor it shared with
    // a sibling. Reusing the stale ordinal would mint an id
    // `enumerateVaultInstruments` could never itself reproduce on the next
    // full walk — silently orphaning this exact review the moment the vault
    // is re-enumerated.
    const v = memoryVault({
      'Courses/TEST101/two.md': [
        FRONTMATTER('[Alpha]'),
        '## Shared heading',
        '',
        'First front::First back',
        '',
        'Second front::Second back',
        '',
      ].join('\n'),
    });
    const { records } = await recordsFor(v);
    const second = records
      .filter((r) => r.instrumentType === 'qa')
      .find((r) => r.card.raw.startsWith('Second'));
    if (!second) throw new Error('fixture has a second qa record');
    expect(second.ordinal).toBe(2); // the OLD, heading-shared anchor's ordinal

    const result = await stampOnFirstSight(v, second, { generateBlockId: () => 'durable2' });
    expect(result.instrumentId).toBe('prov1:Courses/TEST101/two.md#^durable2:1');

    const { records: after } = await recordsFor(v);
    const fresh = after.find((r) => r.instrumentType === 'qa' && r.blockId === 'durable2');
    expect(fresh?.instrumentId).toBe(result.instrumentId);
  });

  it('an already-stamped Q&A card is recognised as durable via its own blockId, not the (always prov1:-prefixed) instrumentId string', async () => {
    const v = vault();
    const { records } = await recordsFor(v);
    const record = only(records, 'qa');
    await stampOnFirstSight(v, record, { generateBlockId: () => 'durable1' });

    const { records: after } = await recordsFor(v);
    const durable = only(after, 'qa');
    expect(durable.instrumentId).toContain(PROVISIONAL_ID_PREFIX); // the documented asymmetry
    expect(durable.blockId).toBe('durable1');

    const readSpy = vi.spyOn(v, 'read');
    const result = await stampOnFirstSight(v, durable);
    expect(result.instrumentId).toBe(durable.instrumentId);
    expect(readSpy).not.toHaveBeenCalled();
  });
});

describe('stampOnFirstSight — cloze', () => {
  function vault() {
    return memoryVault({
      'Courses/TEST101/cloze.md': [
        FRONTMATTER('[Alpha]'),
        '## Q1',
        '',
        'A ==blank== in a sentence.',
        '',
      ].join('\n'),
    });
  }

  it('stamps a cloze id into the frontmatter map, never the card line (C5.3)', async () => {
    const v = vault();
    const { records } = await recordsFor(v);
    const record = only(records, 'cloze');

    const result = await stampOnFirstSight(v, record, { generateClozeId: () => 'cloze-fixed1' });

    expect(result.instrumentId).toBe('cloze-fixed1');
    const content = v.contentOf('Courses/TEST101/cloze.md') ?? '';
    expect(content).toContain('olea-cloze-ids');
    expect(content).toContain('A ==blank== in a sentence.'); // the card's own line is untouched
  });

  it('the second call after stamping is a true no-op (read-then-mint)', async () => {
    const v = vault();
    const { records } = await recordsFor(v);
    const record = only(records, 'cloze');
    await stampOnFirstSight(v, record, { generateClozeId: () => 'cloze-fixed1' });
    expect(v.writes).toHaveLength(1);

    const { records: after } = await recordsFor(v);
    const durable = only(after, 'cloze');
    expect(durable.instrumentId).toBe('cloze-fixed1');

    await stampOnFirstSight(v, durable);
    expect(v.writes).toHaveLength(1);
  });
});

describe('stampOnFirstSight — two unstamped instruments sharing one note and one anchor', () => {
  it('stamping the first relocates correctly when the second sits under its OWN block id anchor (span drift, not anchor drift)', async () => {
    const v = memoryVault({
      'Courses/TEST101/two.md': [
        FRONTMATTER('[Alpha]'),
        '## Shared heading',
        '',
        'First front::First back',
        '',
        'Second front::Second back ^already-anchored',
        '',
      ].join('\n'),
    });

    // Both records captured from ONE enumeration — exactly what
    // `open-session.ts` hands `ReviewSession` for a whole session, so both
    // stamps below run against records whose `span` was captured before
    // either write happened.
    const { records } = await recordsFor(v);
    const qas = records.filter((r) => r.instrumentType === 'qa');
    expect(qas).toHaveLength(2);
    const first = qas.find((r) => r.card.raw.startsWith('First'));
    const second = qas.find((r) => r.card.raw.startsWith('Second'));
    if (!first || !second) throw new Error('fixture has two qa records');
    // The second card already carries its own block id — its anchor is
    // stable regardless of what happens to its sibling.
    expect(second.blockId).toBe('already-anchored');

    const firstResult = await stampOnFirstSight(v, first, {
      generateBlockId: () => 'durablefirst',
    });
    expect(firstResult.instrumentId).toContain('^durablefirst');

    // The second record's `span` is now stale — the first stamp inserted
    // ` ^durablefirst` earlier in the same note. `locateCurrentSpan`'s
    // anchor+ordinal re-derivation must still find it, since its own
    // `^already-anchored` anchor is untouched by the first card's stamp.
    const secondResult = await stampOnFirstSight(v, second);
    expect(secondResult.instrumentId).toBe(second.instrumentId); // already durable — no-op

    const content = v.contentOf('Courses/TEST101/two.md') ?? '';
    expect(content).toContain('First front::First back ^durablefirst');
    expect(content).toContain('Second front::Second back ^already-anchored');
  });

  /**
   * A genuine, PRE-EXISTING gap in `olea-core`'s shipped id scheme
   * (`session/enumerate.ts` + `session/instrument-id.ts`), reproduced at the
   * core level and confirmed independent of this port (see this bead's
   * report): when two instruments share a HEADING anchor (neither has its
   * own block id yet), stamping one changes ITS anchor key from
   * `h:<heading>` to `^<its new block id>` — which would silently reassign
   * the *other* instrument's ordinal-within-`h:<heading>`, and therefore its
   * derived id, if nothing guarded against it. This pre-dates `ol-2zfj.53`;
   * it was merely unreachable in production until something (this trigger)
   * actually wrote a block id into a hand-authored card sharing a heading
   * with an unstamped sibling. A real fix means changing `enumerate.ts`'s/
   * `instrument-id.ts`'s anchor-and-ordinal rule, a different bead's `owns`
   * and a persisted-identity (Class C-shaped) change — filed as `ol-8ae9`
   * (`discovered-from: ol-2zfj.53`) rather than attempted here.
   *
   * This port's own, narrower fix: only stamp the CURRENTLY-last occupant of
   * a shared heading anchor (`located.anchorOccupancy === record.ordinal`).
   * Removing the last occupant shifts nobody, because nothing comes after
   * it. The two cases below are the same fixture, driven in the two
   * possible review orders, proving neither ever corrupts a sibling and
   * both eventually get every card stamped.
   */
  it('reviewing the NON-last sibling first: declines safely, then succeeds once it becomes last', async () => {
    const v = memoryVault({
      'Courses/TEST101/siblings.md': [
        FRONTMATTER('[Alpha]'),
        '## Shared heading',
        '',
        'First front::First back',
        '',
        'Second front::Second back',
        '',
      ].join('\n'),
    });

    const { records } = await recordsFor(v);
    const qas = records.filter((r) => r.instrumentType === 'qa');
    const first = qas.find((r) => r.card.raw.startsWith('First'));
    const second = qas.find((r) => r.card.raw.startsWith('Second'));
    if (!first || !second) throw new Error('fixture has two qa records');
    expect(first.ordinal).toBe(1);
    expect(second.ordinal).toBe(2); // second is currently "last"

    // "First" is reviewed first (composeQueue's order need not match source
    // order) but is NOT last under the shared heading — declined, safely.
    const firstAttempt = await stampOnFirstSight(v, first, {
      generateBlockId: () => 'durablefirst',
    });
    expect(firstAttempt.instrumentId).toBe(first.instrumentId);
    let content = v.contentOf('Courses/TEST101/siblings.md') ?? '';
    expect(content).toContain('First front::First back\n'); // untouched
    expect(content).not.toContain('durablefirst');

    // "Second" IS currently last — stamps.
    const secondResult = await stampOnFirstSight(v, second, {
      generateBlockId: () => 'durablesecond',
    });
    expect(secondResult.instrumentId).toContain('^durablesecond');
    content = v.contentOf('Courses/TEST101/siblings.md') ?? '';
    expect(content).toContain('Second front::Second back ^durablesecond');

    // "First" is now the sole (and therefore last) occupant of the heading
    // — a later review of it succeeds, converging to both cards stamped.
    const { records: after } = await recordsFor(v);
    const firstStillUnstamped = after.find(
      (r) => r.instrumentType === 'qa' && r.card.raw.startsWith('First'),
    );
    if (!firstStillUnstamped) throw new Error('fixture still has a first qa record');
    const retryResult = await stampOnFirstSight(v, firstStillUnstamped, {
      generateBlockId: () => 'durablefirst-retry',
    });
    expect(retryResult.instrumentId).toContain('^durablefirst-retry');
    content = v.contentOf('Courses/TEST101/siblings.md') ?? '';
    expect(content).toContain('First front::First back ^durablefirst-retry');
  });

  it('reviewing the LAST sibling first: both stamp on their own first review, in either order', async () => {
    const v = memoryVault({
      'Courses/TEST101/siblings2.md': [
        FRONTMATTER('[Alpha]'),
        '## Shared heading',
        '',
        'First front::First back',
        '',
        'Second front::Second back',
        '',
      ].join('\n'),
    });

    const { records } = await recordsFor(v);
    const qas = records.filter((r) => r.instrumentType === 'qa');
    const first = qas.find((r) => r.card.raw.startsWith('First'));
    const second = qas.find((r) => r.card.raw.startsWith('Second'));
    if (!first || !second) throw new Error('fixture has two qa records');

    const secondResult = await stampOnFirstSight(v, second, {
      generateBlockId: () => 'durablesecond',
    });
    expect(secondResult.instrumentId).toContain('^durablesecond');

    const firstResult = await stampOnFirstSight(v, first, {
      generateBlockId: () => 'durablefirst',
    });
    expect(firstResult.instrumentId).toContain('^durablefirst'); // now last, stamps immediately
  });
});

describe('createStampOnFirstSightPort', () => {
  it('resolves an instrument id through a recordsById map built once, closing over one vault', async () => {
    const v = memoryVault({
      'Courses/TEST101/one.md': [FRONTMATTER('[Alpha]'), '## Q1', '', MCQ_BLOCK, ''].join('\n'),
    });
    const { records, recordsById } = await recordsFor(v);
    const record = only(records, 'mcq');
    const port = createStampOnFirstSightPort(v, recordsById, { generateMcqId: () => 'mcq-fixed1' });

    const result = await port(record.instrumentId);
    expect(result.instrumentId).toBe('mcq-fixed1');
  });

  it('an unrecognised instrument id is returned unchanged, never thrown on', async () => {
    const v = memoryVault({});
    const port = createStampOnFirstSightPort(v, new Map());
    const result = await port('prov1:nowhere#h:none:1');
    expect(result.instrumentId).toBe('prov1:nowhere#h:none:1');
  });
});
