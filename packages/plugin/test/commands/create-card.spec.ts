/**
 * `create-card.ts` tests (F2.1, C1.4, `ol-0r92.76`).
 *
 * Scenario: `features/F2-review.md` (olea-service), "F2.1 — Inline card
 * creation" — the two scenarios naming
 * `@auto:plugin/commands/create-card.spec`.
 *
 * Never imports `obsidian` — `resolveCreateCardOutcome`/`createCardNoticeText`
 * are pure functions over a source string and an offset pair, the same split
 * `register-commands.spec.ts` uses for the command-wiring logic that IS
 * testable without a real Obsidian host.
 */
import { describe, expect, it } from 'vitest';
import {
  CREATE_CARD_NO_SELECTION_NOTICE,
  createCardNoticeText,
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

  it('resolves to no-selection when start and end coincide (nothing marked)', () => {
    const source = 'Mitochondria is the powerhouse of the cell.\n';
    const outcome = resolveCreateCardOutcome(source, { start: 5, end: 5 });
    expect(outcome).toEqual({ kind: 'no-selection' });
  });

  it('resolves to no-selection on a reversed/empty range too, rather than throwing', () => {
    const source = 'Mitochondria is the powerhouse of the cell.\n';
    const outcome = resolveCreateCardOutcome(source, { start: 10, end: 3 });
    expect(outcome).toEqual({ kind: 'no-selection' });
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

  it('gives the honest no-selection notice, naming that Q&A is not yet available', () => {
    const text = createCardNoticeText({ kind: 'no-selection' });
    expect(text).toBe(CREATE_CARD_NO_SELECTION_NOTICE);
    expect(text).toMatch(/isn't built yet/);
  });

  it('surfaces the rejection reason in the notice text', () => {
    const text = createCardNoticeText({ kind: 'rejected', message: 'boom' });
    expect(text).toBe("Olea: couldn't create a card there — boom");
  });
});
