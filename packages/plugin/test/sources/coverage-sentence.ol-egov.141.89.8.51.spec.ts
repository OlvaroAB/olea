/**
 * The coverage sentence names transcript parts (`ol-egov.141.89.8.51`; D-466, D-448). A transcript
 * with parts still waiting counts beside a deck with pages still waiting. Every string is invented.
 */
import type { SourceCoverage, VaultPath } from 'olea-core';
import { newPendingEntry, summariseCoverageScope, withReadingState } from 'olea-core';
import { describe, expect, it } from 'vitest';
import {
  coverageClosingLine,
  coverageScopeStatement,
  isNotFullyReadYet,
  scopeSourceLine,
} from '../../src/gap/copy.js';

function row(path: string, format: SourceCoverage['format']): SourceCoverage {
  return {
    sourcePath: path as VaultPath,
    kinds: ['registered-file'],
    role: 'past-paper',
    format,
    duplicateSourcePaths: [],
    courses: ['SYNTH101'],
    outcome: 'extracted',
    pages: 2,
    units: 6,
    citations: 2,
    limitations: [],
  };
}

const DECK = row('Courses/SYNTH101/Deck 4.pdf', 'pdf');
const TRANSCRIPT = row('Courses/SYNTH101/Lecture 4.txt', 'pdf');

function waiting(path: VaultPath, parts: number, readFirst: number) {
  return {
    sourcePath: path,
    revisionDigest: 'rev-1',
    entries: Array.from({ length: parts }, (_, i) =>
      i < readFirst
        ? withReadingState(newPendingEntry(path, i + 1), { kind: 'read', method: 'text-layer' })
        : newPendingEntry(path, i + 1),
    ),
  };
}

describe('the coverage sentence names transcript parts (ol-egov.141.89.8.51)', () => {
  it('counts a deck and a transcript together, in the ruled words', () => {
    const manifests = new Map([
      [DECK.sourcePath, waiting(DECK.sourcePath, 3, 1)],
      // Five of twelve parts read; the other seven are waiting.
      [TRANSCRIPT.sourcePath, waiting(TRANSCRIPT.sourcePath, 12, 5)],
    ]);
    const scope = summariseCoverageScope([DECK, TRANSCRIPT], { manifests });
    expect(scope.sources.every(isNotFullyReadYet)).toBe(true);
    const lines = coverageScopeStatement(scope);
    expect(lines).toContain(
      '2 of your sources are not fully read yet: some pages or transcript parts are still waiting to be read, so this list may grow.',
    );
    expect(scope.sources.map(scopeSourceLine)).toContain(
      `${TRANSCRIPT.sourcePath} — not fully read yet`,
    );
    // Never absent, never "no reader" for a transcript with parts waiting, and no exhaustive line.
    expect(lines.join(' ')).not.toContain('no reader');
    expect(coverageClosingLine(scope)).toBeNull();
  });

  it('a transcript with every part read stops counting', () => {
    const manifests = new Map([[TRANSCRIPT.sourcePath, waiting(TRANSCRIPT.sourcePath, 12, 12)]]);
    const scope = summariseCoverageScope([TRANSCRIPT], { manifests });
    expect(scope.sources.some(isNotFullyReadYet)).toBe(false);
  });
});
