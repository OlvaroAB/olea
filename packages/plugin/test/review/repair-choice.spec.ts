import { describe, expect, it } from 'vitest';
import {
  buildRepairChoice,
  REPAIR_CHOICE_HISTORY_LINE,
  REPAIR_CHOICE_NONE_OF_THESE_CONSEQUENCE_LINE,
  REPAIR_CHOICE_NONE_OF_THESE_LABEL,
  REPAIR_CHOICE_QUESTION,
  type RepairChoiceCandidate,
  resolveRepairChoice,
} from '../../src/review/repair-choice.js';

const NOW = 1_700_000_000_000;

function candidate(notePath: string, meetsCertaintyTest: boolean): RepairChoiceCandidate {
  return { notePath, meetsCertaintyTest };
}

describe('buildRepairChoice', () => {
  it('throws on an empty candidate list', () => {
    expect(() => buildRepairChoice({ instrumentId: 'i1', candidates: [], now: NOW })).toThrow();
  });

  it('repairs silently for one candidate that meets the certainty test [D-090, D-392 binding condition 3]', () => {
    const outcome = buildRepairChoice({
      instrumentId: 'i1',
      candidates: [candidate('note-a.md', true)],
      now: NOW,
    });
    expect(outcome).toEqual({ kind: 'silent', instrumentId: 'i1', notePath: 'note-a.md' });
  });

  it('goes to her for one candidate that fails the certainty test [D-392 binding condition 3]', () => {
    const outcome = buildRepairChoice({
      instrumentId: 'i1',
      candidates: [candidate('note-a.md', false)],
      now: NOW,
    });
    expect(outcome.kind).toBe('choice-needed');
    if (outcome.kind !== 'choice-needed') throw new Error('unreachable');
    expect(outcome.proposal).toEqual({
      instrumentId: 'i1',
      candidates: [candidate('note-a.md', false)],
      status: 'proposed',
      proposedAt: NOW,
    });
  });

  it('never repairs silently with more than one candidate, even if every one meets the certainty test on its own [D-392 binding condition 2]', () => {
    const outcome = buildRepairChoice({
      instrumentId: 'i1',
      candidates: [candidate('note-a.md', true), candidate('note-b.md', true)],
      now: NOW,
    });
    expect(outcome.kind).toBe('choice-needed');
    if (outcome.kind !== 'choice-needed') throw new Error('unreachable');
    expect(outcome.proposal.candidates.map((c) => c.notePath)).toEqual(['note-a.md', 'note-b.md']);
    expect(outcome.proposal.status).toBe('proposed');
  });

  it('groups a mix of certain and uncertain candidates into one choice, never several', () => {
    const outcome = buildRepairChoice({
      instrumentId: 'i1',
      candidates: [candidate('note-a.md', true), candidate('note-b.md', false)],
      now: NOW,
    });
    expect(outcome.kind).toBe('choice-needed');
    if (outcome.kind !== 'choice-needed') throw new Error('unreachable');
    expect(outcome.proposal.candidates).toHaveLength(2);
  });
});

describe('resolveRepairChoice', () => {
  function proposalFor(...candidates: RepairChoiceCandidate[]) {
    const outcome = buildRepairChoice({ instrumentId: 'i1', candidates, now: NOW });
    if (outcome.kind !== 'choice-needed') throw new Error('expected choice-needed');
    return outcome.proposal;
  }

  it('attaches the id to the chosen candidate alone [D-392 binding condition 2]', () => {
    const proposal = proposalFor(candidate('note-a.md', true), candidate('note-b.md', true));
    const result = resolveRepairChoice(proposal, { kind: 'candidate', notePath: 'note-b.md' });
    expect(result).toEqual({
      kind: 'attached',
      instrumentId: 'i1',
      notePath: 'note-b.md',
      proposal: { ...proposal, status: 'confirmed', resolvedNotePath: 'note-b.md' },
    });
  });

  it('makes a second attachment for the same id impossible [D-392 binding condition 1]', () => {
    const proposal = proposalFor(candidate('note-a.md', true), candidate('note-b.md', true));
    const first = resolveRepairChoice(proposal, { kind: 'candidate', notePath: 'note-a.md' });
    if (first.kind !== 'attached') throw new Error('expected attached');

    // Re-answering the ORIGINAL proposal is the caller-bug case (see "unknown-candidate" test
    // below is a different failure mode); the case this test targets is answering the UPDATED
    // (already-resolved) proposal a second time, which must not attach note-b as well.
    const second = resolveRepairChoice(first.proposal, {
      kind: 'candidate',
      notePath: 'note-b.md',
    });
    expect(second).toEqual({ kind: 'already-resolved', proposal: first.proposal });
  });

  it('refuses a second answer after a decline too', () => {
    const proposal = proposalFor(candidate('note-a.md', true), candidate('note-b.md', true));
    const declined = resolveRepairChoice(proposal, { kind: 'none-of-these' });
    if (declined.kind !== 'declined') throw new Error('expected declined');

    const second = resolveRepairChoice(declined.proposal, {
      kind: 'candidate',
      notePath: 'note-a.md',
    });
    expect(second).toEqual({ kind: 'already-resolved', proposal: declined.proposal });
  });

  it('records "none of these" as declined, leaving the id unattached with the proposal otherwise intact [D-392 binding condition 1]', () => {
    const proposal = proposalFor(candidate('note-a.md', true), candidate('note-b.md', false));
    const result = resolveRepairChoice(proposal, { kind: 'none-of-these' });
    expect(result).toEqual({
      kind: 'declined',
      instrumentId: 'i1',
      proposal: { ...proposal, status: 'declined' },
    });
    if (result.kind !== 'declined') throw new Error('unreachable');
    expect(result.proposal.resolvedNotePath).toBeUndefined();
    // Every candidate's identity survives a decline exactly as offered.
    expect(result.proposal.candidates).toEqual(proposal.candidates);
  });

  it('rejects an answer naming a candidate this proposal never offered', () => {
    const proposal = proposalFor(candidate('note-a.md', true), candidate('note-b.md', true));
    const result = resolveRepairChoice(proposal, {
      kind: 'candidate',
      notePath: 'note-nonexistent.md',
    });
    expect(result).toEqual({ kind: 'unknown-candidate', notePath: 'note-nonexistent.md' });
    // And the proposal itself is untouched by the rejected answer.
    expect(proposal.status).toBe('proposed');
  });

  it('never mutates the proposal object it is given', () => {
    const proposal = proposalFor(candidate('note-a.md', true), candidate('note-b.md', true));
    const before = JSON.parse(JSON.stringify(proposal));
    resolveRepairChoice(proposal, { kind: 'candidate', notePath: 'note-a.md' });
    expect(proposal).toEqual(before);
  });
});

// Row 11 of the 2026-09-29 rulings (`ol-v7r5.111`): the wording of the grouped choice, given
// exactly. `repair-choice-consequence.spec.ts` proves each claim these strings make.
describe('the grouped choice wording (ruled 2026-09-29, row 11)', () => {
  it('asks the ruled question and offers the ruled option, exactly', () => {
    expect(REPAIR_CHOICE_QUESTION).toBe('Which of these passages does this card refer to?');
    expect(REPAIR_CHOICE_NONE_OF_THESE_LABEL).toBe('None of these.');
  });

  it('the question does not presuppose that the card moved: it names no destination and no yes-or-no', () => {
    const lower = REPAIR_CHOICE_QUESTION.toLowerCase();
    expect(lower).not.toMatch(/moved|now|still|did it|has it|is it/);
    expect(REPAIR_CHOICE_QUESTION.endsWith('?')).toBe(true);
  });

  it('states the consequence of "None of these." as the state the code produces, not the drafted "leaves it as it is"', () => {
    expect(REPAIR_CHOICE_NONE_OF_THESE_CONSEQUENCE_LINE).toBe(
      "None of these leaves the card without a passage: it won't be shown, and you won't be asked again.",
    );
    expect(REPAIR_CHOICE_NONE_OF_THESE_CONSEQUENCE_LINE.toLowerCase()).not.toContain('as it is');
    // It opens with the option it explains, so the two cannot drift apart.
    expect(
      REPAIR_CHOICE_NONE_OF_THESE_CONSEQUENCE_LINE.startsWith(
        REPAIR_CHOICE_NONE_OF_THESE_LABEL.replace(/\.$/, ''),
      ),
    ).toBe(true);
  });

  it('says the practice history stays with the card, and never that it validates a passage', () => {
    expect(REPAIR_CHOICE_HISTORY_LINE).toBe(
      'Its practice history stays with the card, whichever you choose.',
    );
    const lower = REPAIR_CHOICE_HISTORY_LINE.toLowerCase();
    for (const claim of [
      'confirm',
      'verif',
      'valid',
      'prove',
      'proof',
      'vouch',
      'still know',
      'carries over',
      'counts',
      'credit',
    ]) {
      expect(lower).not.toContain(claim);
    }
  });

  it('none of the strings uses engineering vocabulary or a word the registry keeps for another meaning', () => {
    for (const text of [
      REPAIR_CHOICE_QUESTION,
      REPAIR_CHOICE_NONE_OF_THESE_LABEL,
      REPAIR_CHOICE_HISTORY_LINE,
      REPAIR_CHOICE_NONE_OF_THESE_CONSEQUENCE_LINE,
    ]) {
      const lower = text.toLowerCase();
      for (const word of [
        'duplicate',
        'repair',
        'candidate',
        'digest',
        'instrument',
        'anchor',
        'block',
        'identity',
        'withheld',
        'withdrawn',
        'deferred',
        'sorry',
      ]) {
        expect(lower).not.toContain(word);
      }
    }
  });
});
