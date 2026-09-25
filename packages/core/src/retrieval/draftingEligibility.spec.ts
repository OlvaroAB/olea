import { describe, expect, it } from 'vitest';
import { draftingEligibility } from './draftingEligibility.js';
import type { AssessSupportOutcome } from './groundedContext.js';

function assessed(
  verdict: 'sufficient' | 'partial' | 'insufficient' | 'conflicting',
): AssessSupportOutcome {
  return { status: 'assessed', supported: verdict === 'sufficient', reason: 'because', verdict };
}

describe('draftingEligibility (`[ILB-EVD-4]`, evd.md §3)', () => {
  it('authors on sufficient', () => {
    expect(draftingEligibility(assessed('sufficient'))).toEqual({ author: true });
  });

  it('refuses not-enough-in-notes on partial', () => {
    expect(draftingEligibility(assessed('partial'))).toEqual({
      author: false,
      refusal: 'not-enough-in-notes',
    });
  });

  it('refuses not-enough-in-notes on insufficient', () => {
    expect(draftingEligibility(assessed('insufficient'))).toEqual({
      author: false,
      refusal: 'not-enough-in-notes',
    });
  });

  it('refuses notes-disagree on conflicting', () => {
    expect(draftingEligibility(assessed('conflicting'))).toEqual({
      author: false,
      refusal: 'notes-disagree',
    });
  });

  // [D-289] point 2 (`ol-egov.141.89.1.6`): an empty evidence package is an
  // operational outcome grouped with `unavailable`/`could-not-decide` and is
  // never a verdict about her notes. `ol-egov.141.89.2.12` is the bug this
  // regression test guards: this arm used to read `insufficient-evidence` as
  // "not enough in her notes", the same message a genuinely thin-but-present
  // package gets, which is exactly the fact-about-her-notes claim D-289
  // forbids for an operational outcome.
  it('refuses could-not-check on insufficient-evidence (an empty package, not a claim about her notes)', () => {
    expect(draftingEligibility({ status: 'insufficient-evidence' })).toEqual({
      author: false,
      refusal: 'could-not-check',
    });
  });

  it('refuses could-not-check on unavailable (an operational failure, never a claim about her notes)', () => {
    expect(draftingEligibility({ status: 'unavailable' })).toEqual({
      author: false,
      refusal: 'could-not-check',
    });
  });

  it('refuses could-not-check on could-not-decide', () => {
    expect(draftingEligibility({ status: 'could-not-decide' })).toEqual({
      author: false,
      refusal: 'could-not-check',
    });
  });

  it('is pure: the same outcome always maps to the same eligibility', () => {
    const outcome = assessed('sufficient');
    expect(draftingEligibility(outcome)).toEqual(draftingEligibility(outcome));
  });

  it('ignores the optional missing field — it changes nothing about eligibility, only what a refusal surface may show', () => {
    const withMissing: AssessSupportOutcome = {
      status: 'assessed',
      supported: false,
      reason: 'because',
      verdict: 'partial',
      missing: ['a worked example'],
    };
    expect(draftingEligibility(withMissing)).toEqual({
      author: false,
      refusal: 'not-enough-in-notes',
    });
  });
});
