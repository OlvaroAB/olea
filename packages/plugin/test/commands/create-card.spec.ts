/**
 * `create-card.ts` tests (F2.1, C1.4, `ol-0r92.76`; Q&A entry surface
 * `[D-268]`/`ol-0r92.77` [H-qa-card-modal]).
 *
 * Scenario: `features/F2-review.md` (olea-service), "F2.1 — Inline card
 * creation" — the scenarios naming `@auto:plugin/commands/create-card.spec`.
 *
 * Never imports `obsidian` — `resolveCreateCardOutcome`/`createCardNoticeText`/
 * `createQaCardFromEntry` are pure functions over a source string and either
 * an offset pair or a confirmed front/back pair, the same split
 * `register-commands.spec.ts` uses for the command-wiring logic that IS
 * testable without a real Obsidian host. `QaCardModal` itself (real
 * `contentEl`/`Modal` glue) is not exercised here — see
 * `test/commands/qa-card-modal.spec.ts`.
 */
import { describe, expect, it } from 'vitest';
import {
  createCardNoticeText,
  createQaCardFromEntry,
  resolveCreateCardOutcome,
} from '../../src/commands/create-card.js';

describe('resolveCreateCardOutcome', () => {
  it('clozes a marked span, leaving the rest of the note untouched', () => {
    const source = 'Mitochondria is the powerhouse of the cell.\n';
    const start = source.indexOf('powerhouse');
    const end = start + 'powerhouse'.length;

    const outcome = resolveCreateCardOutcome(source, { start, end });

    expect(outcome.kind).toBe('clozed');
    if (outcome.kind !== 'clozed') throw new Error('expected clozed');
    expect(outcome.clozeText).toBe('powerhouse');
    expect(outcome.content).toBe('Mitochondria is the ==powerhouse== of the cell.\n');
  });

  it('resolves to no-selection when start and end coincide (nothing marked), carrying the cursor offset', () => {
    const source = 'Mitochondria is the powerhouse of the cell.\n';
    const outcome = resolveCreateCardOutcome(source, { start: 5, end: 5 });
    expect(outcome).toEqual({ kind: 'no-selection', cursorOffset: 5 });
  });

  it('resolves to no-selection on a reversed/empty range too, rather than throwing — cursorOffset is the range start', () => {
    const source = 'Mitochondria is the powerhouse of the cell.\n';
    const outcome = resolveCreateCardOutcome(source, { start: 10, end: 3 });
    expect(outcome).toEqual({ kind: 'no-selection', cursorOffset: 10 });
  });

  it('resolves to rejected, with the underlying reason, for a span crossing two lines', () => {
    const source = 'first line\nsecond line\n';
    const outcome = resolveCreateCardOutcome(source, { start: 6, end: 17 });
    expect(outcome.kind).toBe('rejected');
    if (outcome.kind !== 'rejected') throw new Error('expected rejected');
    expect(outcome.message).toMatch(/cannot span more than one line/);
  });

  it('resolves to rejected for a span inside a heading, not a paragraph or list item', () => {
    const source = '# What is a mitochondrion?\n';
    const start = source.indexOf('mitochondrion');
    const end = start + 'mitochondrion'.length;
    const outcome = resolveCreateCardOutcome(source, { start, end });
    expect(outcome.kind).toBe('rejected');
    if (outcome.kind !== 'rejected') throw new Error('expected rejected');
    expect(outcome.message).toMatch(/not inside a paragraph or list item/);
  });
});

describe('createCardNoticeText', () => {
  it('has nothing to say on a successful cloze — the edit itself is the feedback', () => {
    expect(createCardNoticeText({ kind: 'clozed', content: 'x', clozeText: 'y' })).toBeNull();
  });

  it('has nothing to say on no-selection either — QaCardModal is the feedback surface now (`[D-268]`)', () => {
    expect(createCardNoticeText({ kind: 'no-selection', cursorOffset: 5 })).toBeNull();
  });

  it('surfaces the rejection reason in the notice text', () => {
    const text = createCardNoticeText({ kind: 'rejected', message: 'boom' });
    expect(text).toBe("Olea: couldn't create a card there — boom");
  });
});

describe('createQaCardFromEntry — F2.1 Q&A half, `[D-268]`', () => {
  it('creates a card anchored to the block the cursor sits in', () => {
    const source = 'What is a mitochondrion?\n\nSome other paragraph.\n';
    const cursorOffset = source.indexOf('What is');

    const outcome = createQaCardFromEntry({
      source,
      cursorOffset,
      front: 'What is a mitochondrion?',
      back: 'The powerhouse of the cell.',
    });

    expect(outcome.kind).toBe('created');
    if (outcome.kind !== 'created') throw new Error('expected created');
    // Default style is `multi-line` (card-format.ts's own default), so
    // front and back land on separate lines around the `?` separator rather
    // than joined by `::`.
    expect(outcome.content).toMatch(/What is a mitochondrion\?\n\?\nThe powerhouse of the cell\./);
    expect(outcome.content).toContain('Some other paragraph.');
  });

  it('anchors to the last block when the cursor sits at the end of the document', () => {
    const source = 'A single paragraph, nothing after it.\n';

    const outcome = createQaCardFromEntry({
      source,
      cursorOffset: source.length,
      front: 'front',
      back: 'back',
    });

    expect(outcome.kind).toBe('created');
    if (outcome.kind !== 'created') throw new Error('expected created');
    expect(outcome.content).toMatch(/front\n\?\nback/);
  });

  it('rejects rather than throws when the anchor block cannot carry a card (a thematic break)', () => {
    const source = 'First paragraph.\n\n---\n\nSecond paragraph.\n';
    const cursorOffset = source.indexOf('---');

    const outcome = createQaCardFromEntry({
      source,
      cursorOffset,
      front: 'front',
      back: 'back',
    });

    expect(outcome.kind).toBe('rejected');
    if (outcome.kind !== 'rejected') throw new Error('expected rejected');
    expect(outcome.message).toMatch(/cannot create a card from a thematicBreak block/);
  });

  it('rejects a blank front or back rather than writing an empty card', () => {
    const source = 'A paragraph.\n';
    const outcome = createQaCardFromEntry({ source, cursorOffset: 0, front: '  ', back: 'back' });
    expect(outcome.kind).toBe('rejected');
    if (outcome.kind !== 'rejected') throw new Error('expected rejected');
    expect(outcome.message).toMatch(/needs both a front and a back/);
  });
});
