import { describe, expect, it } from 'vitest';
import type { InstrumentCitation } from './citation-store.js';
import { citationValidityStatus } from './citation-validity.js';

// Scenarios: olea-service/features/F8-concepts-scope.md — instrument passage-citation
// current-validity read ([IL-D8] row 2.9, ol-2zfj.147 part 2), tagged
// `@auto:core/instrument/citation-validity.spec`.

describe('citationValidityStatus', () => {
  const base: InstrumentCitation = {
    sourcePath: 'Sources/Lecture 3.pdf',
    page: 4,
    section: 'Bedform stratification',
    passageDigest: 'digest-abc',
    sourceRevision: 'rev-2',
  };

  it('reads current when the observed digest matches the recorded one', () => {
    const result = citationValidityStatus(base, { currentPassageDigest: 'digest-abc' });
    expect(result.status).toBe('current');
    expect(result.reason.length).toBeGreaterThan(0);
  });

  it('reads superseded when the observed digest disagrees with the recorded one', () => {
    const result = citationValidityStatus(base, { currentPassageDigest: 'digest-changed' });
    expect(result.status).toBe('superseded');
    expect(result.reason.length).toBeGreaterThan(0);
  });

  it('reads unknown, never current, for a legacy record with no passageDigest at all', () => {
    const legacy: InstrumentCitation = { sourcePath: 'Sources/A.pdf' };
    const result = citationValidityStatus(legacy, { currentPassageDigest: 'anything' });
    expect(result.status).toBe('unknown');
  });

  it('reads unknown, never current, when no current observation is supplied', () => {
    const result = citationValidityStatus(base, {});
    expect(result.status).toBe('unknown');
  });

  it('reads unknown when called with no evidence at all (the default parameter)', () => {
    const result = citationValidityStatus(base);
    expect(result.status).toBe('unknown');
  });

  describe('[D-351] pending revalidation', () => {
    it('reads pending when a revalidation for this citation\'s own source revision is outstanding, even if the digest would otherwise read current', () => {
      const result = citationValidityStatus(base, {
        currentPassageDigest: 'digest-abc', // would read 'current' on its own
        pendingRevalidation: { sourceRevision: 'rev-2', isPending: true },
      });
      expect(result.status).toBe('pending');
    });

    it('reads pending even with no digest evidence at all, as long as the revision is scoped correctly', () => {
      const result = citationValidityStatus(base, {
        pendingRevalidation: { sourceRevision: 'rev-2', isPending: true },
      });
      expect(result.status).toBe('pending');
    });
  });

  describe('[D-351] scoping — a signal for the wrong revision never applies to this citation', () => {
    it('a pending signal for an EARLIER revision than the one recorded is ignored, not treated as pending', () => {
      const result = citationValidityStatus(base, {
        currentPassageDigest: 'digest-abc',
        pendingRevalidation: { sourceRevision: 'rev-1', isPending: true },
      });
      // Falls through to the digest comparison exactly as if no pending evidence had been given.
      expect(result.status).toBe('current');
    });

    it('a pending signal for a LATER revision than the one recorded is ignored, not treated as pending', () => {
      const result = citationValidityStatus(base, {
        currentPassageDigest: 'digest-changed',
        pendingRevalidation: { sourceRevision: 'rev-3', isPending: true },
      });
      expect(result.status).toBe('superseded');
    });

    it('a resolved (isPending: false) signal for an earlier revision never manufactures a current verdict — the ruling\'s "a late result for an earlier edit never clears a newer pending state", encoded as: mismatched-revision evidence is simply never honoured either way', () => {
      const result = citationValidityStatus(base, {
        // No current observation supplied — if the mismatched pendingRevalidation were
        // mistakenly honoured as "resolved", a naive implementation might default to
        // 'current'. It must not: with no digest evidence, the answer stays 'unknown'.
        pendingRevalidation: { sourceRevision: 'rev-1', isPending: false },
      });
      expect(result.status).toBe('unknown');
    });

    it('a pending signal is never honoured when the citation itself carries no sourceRevision to scope it against (pre-D-292 record)', () => {
      const legacy: InstrumentCitation = { sourcePath: 'Sources/A.pdf', passageDigest: 'digest-abc' };
      const result = citationValidityStatus(legacy, {
        currentPassageDigest: 'digest-abc',
        pendingRevalidation: { sourceRevision: 'rev-1', isPending: true },
      });
      expect(result.status).toBe('current');
    });
  });

  it('never shadows or duplicates classifyCitationFreshness — a legacy citation with only page/section reads unknown just like the freshness check does', () => {
    const withoutDigest: InstrumentCitation = { sourcePath: 'Sources/A.pdf', page: 1 };
    const result = citationValidityStatus(withoutDigest, { currentPassageDigest: 'digest-abc' });
    expect(result.status).toBe('unknown');
  });
});
