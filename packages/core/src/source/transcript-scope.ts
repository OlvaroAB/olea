/**
 * The mention-is-not-scope guard (D-465, PROPOSAL 4.7, F8.4; `ol-egov.141.89.3.42`).
 *
 * A concept a transcript opens that no examiner document attests is `volunteer`. The declared-scope
 * name set (F8.1's denominator, `../scope/coverage.ts` `isVolunteer`) is built ONLY from examiner
 * attestations; a transcript mention can never enter it, by construction rather than by a check.
 */

export type ConceptAttestationOrigin = 'examiner' | 'transcript' | 'other';

export interface ConceptAttestation {
  readonly conceptName: string;
  readonly origin: ConceptAttestationOrigin;
}

/** The declared-scope names: examiner attestations only. */
export function declaredScopeNamesFrom(
  attestations: readonly ConceptAttestation[],
): ReadonlySet<string> {
  return new Set(attestations.filter((a) => a.origin === 'examiner').map((a) => a.conceptName));
}
