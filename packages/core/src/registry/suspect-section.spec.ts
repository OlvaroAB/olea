import { describe, expect, it } from 'vitest';
import type { InstrumentCitation } from '../instrument/citation-store.js';
import { citationValidityStatus } from '../instrument/citation-validity.js';
import {
  deriveRegistrySuspectSection,
  type RegistrySuspectSectionInstrumentEvidence,
} from './suspect-section.js';

// Scenarios: olea-service/features/F2-review.md — the D-397 registry suspect-instrument
// section, tagged `@auto:core/registry/suspect-section.spec`.

describe('deriveRegistrySuspectSection', () => {
  it('is correct and empty for no instruments', () => {
    expect(deriveRegistrySuspectSection([])).toEqual({ pendingRevalidation: [], flagged: [] });
  });

  it('is correct and empty for an instrument with neither reason recorded', () => {
    const result = deriveRegistrySuspectSection([{ instrumentId: 'i-1' }]);
    expect(result).toEqual({ pendingRevalidation: [], flagged: [] });
  });

  describe('pending revalidation', () => {
    it('includes an instrument whose citation validity reads pending', () => {
      const result = deriveRegistrySuspectSection([
        { instrumentId: 'i-1', citationValidity: 'pending' },
      ]);
      expect(result.pendingRevalidation).toEqual([{ instrumentId: 'i-1' }]);
      expect(result.flagged).toEqual([]);
    });

    it('[D-397] excludes "current" — nothing recorded, never a member of this section', () => {
      const result = deriveRegistrySuspectSection([
        { instrumentId: 'i-1', citationValidity: 'current' },
      ]);
      expect(result.pendingRevalidation).toEqual([]);
    });

    it('[D-397] excludes "unknown" — no observation is not a mismatch', () => {
      const result = deriveRegistrySuspectSection([
        { instrumentId: 'i-1', citationValidity: 'unknown' },
      ]);
      expect(result.pendingRevalidation).toEqual([]);
    });

    it('[D-397] excludes "superseded" (a changed passage) — its own destination, never duplicated here', () => {
      const result = deriveRegistrySuspectSection([
        { instrumentId: 'i-1', citationValidity: 'superseded' },
      ]);
      expect(result.pendingRevalidation).toEqual([]);
      expect(result.flagged).toEqual([]);
    });

    it('never triggers from any field other than citationValidity — no lapse/rating/failure-count field exists on the evidence type at all', () => {
      const result = deriveRegistrySuspectSection([{ instrumentId: 'i-1' }]);
      expect(result.pendingRevalidation).toEqual([]);
    });

    describe('[D-400] deferred (registry §24 — PROPOSED, Class B, pending ratification)', () => {
      it('marks the row deferred when the retry has also gone unanswered', () => {
        const result = deriveRegistrySuspectSection([
          { instrumentId: 'i-1', citationValidity: 'pending', retryExhausted: true },
        ]);
        expect(result.pendingRevalidation).toEqual([{ instrumentId: 'i-1', deferred: true }]);
      });

      it('leaves the row as the ordinary pending reading when the retry has not been spent', () => {
        const result = deriveRegistrySuspectSection([
          { instrumentId: 'i-1', citationValidity: 'pending', retryExhausted: false },
        ]);
        expect(result.pendingRevalidation).toEqual([{ instrumentId: 'i-1' }]);
      });

      it('leaves the row as the ordinary pending reading when retryExhausted is not supplied at all', () => {
        const result = deriveRegistrySuspectSection([
          { instrumentId: 'i-1', citationValidity: 'pending' },
        ]);
        expect(result.pendingRevalidation).toEqual([{ instrumentId: 'i-1' }]);
      });

      it('has no effect when citationValidity is not pending — no row exists to mark', () => {
        const result = deriveRegistrySuspectSection([
          { instrumentId: 'i-1', citationValidity: 'current', retryExhausted: true },
        ]);
        expect(result.pendingRevalidation).toEqual([]);
      });

      it('never marks a flagged row deferred — [D-400] names only the pending-revalidation half', () => {
        const result = deriveRegistrySuspectSection([
          {
            instrumentId: 'i-1',
            citationValidity: 'pending',
            retryExhausted: true,
            flagConcern: { resolved: false },
          },
        ]);
        expect(result.pendingRevalidation).toEqual([{ instrumentId: 'i-1', deferred: true }]);
        expect(result.flagged).toEqual([{ instrumentId: 'i-1' }]);
      });
    });

    describe('integration with citationValidityStatus — proves the current-revision tie transitively', () => {
      const citation: InstrumentCitation = {
        sourcePath: 'Sources/Lecture 3.pdf',
        passageDigest: 'digest-abc',
        sourceRevision: 'rev-2',
      };

      it('a revalidation recorded against the current source revision reads pending and is included', () => {
        const status = citationValidityStatus(citation, {
          currentPassageDigest: 'digest-abc',
          pendingRevalidation: { sourceRevision: 'rev-2', isPending: true },
        }).status;
        const result = deriveRegistrySuspectSection([
          { instrumentId: 'i-1', citationValidity: status },
        ]);
        expect(result.pendingRevalidation).toEqual([{ instrumentId: 'i-1' }]);
      });

      it('a revalidation recorded against an OLDER source revision never reads pending, so it is excluded', () => {
        const status = citationValidityStatus(citation, {
          currentPassageDigest: 'digest-abc',
          pendingRevalidation: { sourceRevision: 'rev-1', isPending: true },
        }).status;
        expect(status).not.toBe('pending');
        const result = deriveRegistrySuspectSection([
          { instrumentId: 'i-1', citationValidity: status },
        ]);
        expect(result.pendingRevalidation).toEqual([]);
      });
    });
  });

  describe('flagged', () => {
    it('is correct and empty when no flag evidence is supplied at all (no producer exists yet — rule 5)', () => {
      const result = deriveRegistrySuspectSection([
        { instrumentId: 'i-1' },
        { instrumentId: 'i-2' },
      ]);
      expect(result.flagged).toEqual([]);
    });

    it('includes an instrument with an unresolved recorded concern', () => {
      const result = deriveRegistrySuspectSection([
        { instrumentId: 'i-1', flagConcern: { resolved: false } },
      ]);
      expect(result.flagged).toEqual([{ instrumentId: 'i-1' }]);
    });

    it("clears only through that concern's own recorded resolution", () => {
      const result = deriveRegistrySuspectSection([
        { instrumentId: 'i-1', flagConcern: { resolved: true } },
      ]);
      expect(result.flagged).toEqual([]);
    });
  });

  describe('restart, reopen or the passing of time clears neither reason — this module reads no clock and holds no state', () => {
    const evidence: readonly RegistrySuspectSectionInstrumentEvidence[] = [
      { instrumentId: 'i-1', citationValidity: 'pending' },
      { instrumentId: 'i-2', flagConcern: { resolved: false } },
      // `[D-400]`: a deferred row (registry §24) is exactly as immune to a restart/reopen/clock
      // as the ordinary pending reading above — nothing here reads a clock either.
      { instrumentId: 'i-3', citationValidity: 'pending', retryExhausted: true },
    ];

    it('an identical call, simulating a restart/reopen/advanced clock with unchanged evidence, returns an identical result', () => {
      const first = deriveRegistrySuspectSection(evidence);
      // No mutation, no elapsed-time input, no second call parameter exists to advance — the
      // function signature itself has nothing a restart, reopen or clock could feed.
      const second = deriveRegistrySuspectSection(evidence);
      expect(second).toEqual(first);
    });
  });

  it('buckets several instruments correctly at once, preserving input order and allowing an instrument to appear in both lists', () => {
    const result = deriveRegistrySuspectSection([
      { instrumentId: 'clean', citationValidity: 'current' },
      { instrumentId: 'pending-only', citationValidity: 'pending' },
      { instrumentId: 'flagged-only', flagConcern: { resolved: false } },
      {
        instrumentId: 'both',
        citationValidity: 'pending',
        flagConcern: { resolved: false },
      },
      { instrumentId: 'resolved-flag', flagConcern: { resolved: true } },
    ]);
    expect(result.pendingRevalidation).toEqual([
      { instrumentId: 'pending-only' },
      { instrumentId: 'both' },
    ]);
    expect(result.flagged).toEqual([{ instrumentId: 'flagged-only' }, { instrumentId: 'both' }]);
  });
});
