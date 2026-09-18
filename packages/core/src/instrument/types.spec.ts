// [D-263 / PROBE-1] (ol-egov.141.47) ruled the shape this file pins; [PROBE-2] (ol-0r92.78)
// is the schema bead that lands it. No F<n>.<m> scenario applies — this is a Class C schema
// addition with no student-facing surface of its own (`[PROBE-3]` / ol-0r92.79 builds the
// generator and the production caller these types support).
import { describe, expect, it } from 'vitest';
import {
  EXPOSURE_DIMENSIONS,
  type ExposureDimensionResult,
  isApplicationBoundary,
  isExposureDimensionResult,
  isExposureProvenance,
  isProbeMetadata,
  type ProbeMetadata,
} from './types.js';

function fullExposure(
  overrides: Partial<Record<string, string | null>> = {},
): ExposureDimensionResult {
  const base: Record<string, string | null> = {
    'exact-item': null,
    scenario: null,
    'decisive-solution-pattern': null,
    'assistance-shown': null,
  };
  return { ...base, ...overrides } as ExposureDimensionResult;
}

const validBoundary = {
  targetConceptId: 'concept-erosion-rate',
  heldSource: { sourcePath: 'Sources/Lecture 3.pdf', page: 4, section: 'Bedform stratification' },
  boundarySpecRef: 'boundary-spec-1',
};

describe('EXPOSURE_DIMENSIONS', () => {
  it('is exactly the four dimensions [D-263] ruling 3 names, in its own order', () => {
    expect(EXPOSURE_DIMENSIONS).toEqual([
      'exact-item',
      'scenario',
      'decisive-solution-pattern',
      'assistance-shown',
    ]);
  });
});

describe('isExposureDimensionResult', () => {
  it('accepts all four dimensions present, every one null (first recorded exposure everywhere)', () => {
    expect(isExposureDimensionResult(fullExposure())).toBe(true);
  });

  it('accepts a mix of null and a matched instrument id', () => {
    expect(isExposureDimensionResult(fullExposure({ scenario: 'mcq-old-1' }))).toBe(true);
  });

  it('rejects a missing dimension key', () => {
    const { scenario: _omit, ...rest } = fullExposure();
    expect(isExposureDimensionResult(rest)).toBe(false);
  });

  it('rejects an empty-string match (must be a non-empty instrument id or null)', () => {
    expect(isExposureDimensionResult(fullExposure({ 'exact-item': '' }))).toBe(false);
  });

  it('rejects non-objects', () => {
    expect(isExposureDimensionResult(null)).toBe(false);
    expect(isExposureDimensionResult('nope')).toBe(false);
  });
});

describe('isExposureProvenance', () => {
  it('accepts a well-formed provenance record', () => {
    expect(isExposureProvenance({ perDimension: fullExposure() })).toBe(true);
  });

  it('rejects a malformed perDimension', () => {
    expect(isExposureProvenance({ perDimension: { scenario: null } })).toBe(false);
  });
});

describe('isApplicationBoundary', () => {
  it('accepts a well-formed boundary, citation-shaped held source', () => {
    expect(isApplicationBoundary(validBoundary)).toBe(true);
  });

  it('accepts a held source with no page/section (omit-never-fabricate, matching citation-store.ts)', () => {
    expect(
      isApplicationBoundary({
        ...validBoundary,
        heldSource: { sourcePath: 'Sources/Notes.docx' },
      }),
    ).toBe(true);
  });

  it('rejects a missing targetConceptId', () => {
    const { targetConceptId: _omit, ...rest } = validBoundary;
    expect(isApplicationBoundary(rest)).toBe(false);
  });

  it('rejects a missing boundarySpecRef', () => {
    const { boundarySpecRef: _omit, ...rest } = validBoundary;
    expect(isApplicationBoundary(rest)).toBe(false);
  });

  it('rejects a heldSource missing sourcePath', () => {
    expect(isApplicationBoundary({ ...validBoundary, heldSource: { page: 4 } })).toBe(false);
  });
});

describe('isProbeMetadata — the purpose/boundary pairing [D-263] ruling 1 requires', () => {
  it('accepts wording-robustness with no applicationBoundary', () => {
    const metadata: ProbeMetadata = {
      purpose: 'wording-robustness',
      exposureProvenance: { perDimension: fullExposure() },
    };
    expect(isProbeMetadata(metadata)).toBe(true);
  });

  it('accepts application with a full applicationBoundary', () => {
    const metadata: ProbeMetadata = {
      purpose: 'application',
      applicationBoundary: validBoundary,
      exposureProvenance: { perDimension: fullExposure({ 'exact-item': 'mcq-1' }) },
    };
    expect(isProbeMetadata(metadata)).toBe(true);
  });

  it('rejects application with no applicationBoundary', () => {
    expect(
      isProbeMetadata({
        purpose: 'application',
        exposureProvenance: { perDimension: fullExposure() },
      }),
    ).toBe(false);
  });

  it('rejects wording-robustness carrying an applicationBoundary — unrepresentable at the type level, checked here at the runtime/JSON boundary', () => {
    expect(
      isProbeMetadata({
        purpose: 'wording-robustness',
        applicationBoundary: validBoundary,
        exposureProvenance: { perDimension: fullExposure() },
      }),
    ).toBe(false);
  });

  it('rejects an unknown purpose value', () => {
    expect(
      isProbeMetadata({
        purpose: 'unheard-of',
        exposureProvenance: { perDimension: fullExposure() },
      }),
    ).toBe(false);
  });

  it('rejects a missing exposureProvenance', () => {
    expect(isProbeMetadata({ purpose: 'wording-robustness' })).toBe(false);
  });
});

describe('migration — instrument records written before [D-263]', () => {
  // `ProbeMetadata` is a wholly new, additive bundle (this file's module-level "PROBE
  // METADATA" comment, and docs/dev/verdict-seam-design.md §9): nothing before [PROBE-2]
  // ever produced one, so every pre-existing instrument simply has none. There is no
  // migration FUNCTION for the same reason [D-109] gives review-log v5 none — there is
  // nothing real to migrate FROM — but the absence case still needs to be a defined,
  // tested outcome rather than an assumption.
  interface RecordShapeOnceWired {
    readonly instrumentId: string;
    readonly probeMetadata?: ProbeMetadata;
  }

  it('a pre-existing record with no probeMetadata field is a valid, ordinary (non-probe) instrument', () => {
    const preExisting: RecordShapeOnceWired = { instrumentId: 'mcq-existing-1' };
    expect(preExisting.probeMetadata).toBeUndefined();
    expect('probeMetadata' in preExisting).toBe(false);
  });

  it('isProbeMetadata is never the presence check — a caller tests the optional field itself, never defaults an absent one into a fabricated purpose', () => {
    expect(isProbeMetadata(undefined)).toBe(false);
    // The correct reading of that `false` at a call site is "this value is not valid
    // ProbeMetadata", not "treat this instrument as an ordinary one" — that reading
    // comes from the field being absent (`?.probeMetadata === undefined`), checked
    // before this guard is ever called, exactly as `explainBackGrade.optional()`
    // (contracts/review-log.ts) is read by its own callers.
  });
});
