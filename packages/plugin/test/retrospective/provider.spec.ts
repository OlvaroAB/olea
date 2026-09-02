/**
 * `createLocalRetrospectiveProvider` — D-134 Q6 scope-resolution wiring
 * (`ol-0r92.31`).
 *
 * Before this bead, `load()` always resolved `scopeOrigin: 'evidenced'` —
 * every concept in the course with any review-log entry — even when the
 * chosen assessment stated its own scope (F1.7). This suite proves the fix:
 * a stated scope resolves to the ASSESSMENT's own named concepts via
 * `resolveAssessmentGroupingContext` (course-scoped, exact-normalized-name
 * match), excluding both other reviewed concepts in the same course and any
 * other assessment's own stated scope; the evidenced fallback fires only
 * when the chosen assessment records no scope text at all, and is reported
 * as `scopeOrigin: 'evidenced'` rather than silently blended.
 *
 * INV-3: every course code, concept name and assessment path below is
 * invented for this suite; nothing is drawn from a real vault.
 */
import type { ReviewLogRecord } from 'olea-contracts';
import { reviewLogPath } from 'olea-core';
import { describe, expect, it } from 'vitest';
import { extractConceptsFromVault } from '../../src/concept/wiring.js';
import type { ObsidianDataHost } from '../../src/plan/settings-store.js';
import { STUDY_PLAN_SETTINGS_STORAGE_KEY } from '../../src/plan/settings-store.js';
import { createLocalRetrospectiveProvider } from '../../src/retrospective/provider.js';
import { localToday } from '../../src/today/data-source.js';
import { memoryVault } from '../review/memory-vault.js';

const DEVICE = 'olea-testdevice1';
const BASE_PATH = '02 Assignments/Assignments.base';
const NOW = new Date('2026-09-02T09:00:00-04:00');
const REVIEW_DAY = localToday(NOW);

class FakeDataHost implements ObsidianDataHost {
  blob: unknown = null;

  async loadData(): Promise<unknown> {
    return this.blob;
  }

  async saveData(data: unknown): Promise<void> {
    this.blob = data;
  }
}

function hostWithBasePath(basePath: string): FakeDataHost {
  const host = new FakeDataHost();
  host.blob = {
    [STUDY_PLAN_SETTINGS_STORAGE_KEY]: { version: 1, assignmentsBasePath: basePath },
  };
  return host;
}

const emptyOfferStore = { load: async () => [], append: async () => {} };

const BASE_FILE = [
  'filters:',
  '  and:',
  '    - file.inFolder("02 Assignments")',
  '    - file.ext == "md"',
  'properties:',
  '  class:',
  '  type:',
  '  weight:',
  '  due:',
  '  status:',
  '  scope:',
].join('\n');

function assessmentNote(
  overrides: Readonly<{ due: string; scope?: string }> & Partial<{ status: string }>,
): string {
  const lines = [
    '---',
    'class: TESTC101',
    'type: Quiz',
    'weight: 40',
    `due: ${overrides.due}`,
    `status: ${overrides.status ?? 'done'}`,
    ...(overrides.scope !== undefined ? [`scope: ${overrides.scope}`] : []),
    '---',
    '',
    '# Assessment',
    '',
  ];
  return lines.join('\n');
}

/** A tier-2 (topic-only) concept binding — frontmatter alone is enough to mint the concept (`extract.ts`'s topic loop); no Zettelkasten note or body content is needed. */
function conceptNote(name: string, course: string): string {
  return ['---', `topic: [${name}]`, `course: ${course}`, '---', ''].join('\n');
}

const CONCEPT_FILES: Readonly<Record<string, string>> = {
  'Notes/photosynthesis.md': conceptNote('Photosynthesis', 'TESTC101'),
  'Notes/respiration.md': conceptNote('Respiration', 'TESTC101'),
  'Notes/osmosis.md': conceptNote('Osmosis', 'TESTC101'),
  'Notes/krebs-cycle.md': conceptNote('Krebs Cycle', 'TESTC202'),
};

function reviewRecord(conceptKey: string): ReviewLogRecord {
  return {
    schemaVersion: 5,
    kind: 'review',
    eventId: `r-${conceptKey}`,
    timestamp: NOW.toISOString(),
    instrumentId: `qa:${conceptKey}:1`,
    instrumentType: 'qa',
    conceptIds: [conceptKey],
    rating: 'good',
    wasUnsure: false,
    durationMs: 1000,
    selectionContext: {
      dueState: 'due',
      examProximity: null,
      yieldRank: null,
      instrumentTypesOffered: ['qa'],
      planVersion: null,
    },
  };
}

/**
 * Builds ONE vault instance, mints its concept keys into it via
 * `extractConceptsFromVault`'s `[D-174]` sidecar stamping, then writes a
 * review-log entry for each name in `reviewedNames` using those SAME
 * stamped keys. Deliberately a single vault instance rather than a
 * throwaway one for key discovery plus a separate one for the provider:
 * `[D-174]` mints a key once and looks it up thereafter FROM THE SIDECAR —
 * two independent vaults with no shared sidecar would each mint their own,
 * possibly-different key for "the same" concept, which would silently
 * decouple this suite's review-log fixtures from what the provider's own
 * internal extraction resolves.
 */
async function vaultWithReviewedConcepts(
  files: Readonly<Record<string, string>>,
  reviewedNames: readonly string[],
) {
  const vault = memoryVault({ ...CONCEPT_FILES, ...files });
  const concepts = await extractConceptsFromVault(vault, {});
  const keyByName = new Map(concepts.map((c) => [c.name, c.key] as const));
  const records = reviewedNames.map((name) => {
    const key = keyByName.get(name);
    if (key === undefined) throw new Error(`no concept minted for "${name}"`);
    return reviewRecord(key);
  });
  if (records.length > 0) {
    await vault.write(
      reviewLogPath(REVIEW_DAY, DEVICE),
      records.map((r) => JSON.stringify(r)).join('\n'),
    );
  }
  return vault;
}

describe('createLocalRetrospectiveProvider — D-134 Q6 scope resolution (ol-0r92.31)', () => {
  it("uses the assessment's own stated scope, excluding a reviewed concept from the SAME course that the assessment does not name", async () => {
    const vault = await vaultWithReviewedConcepts(
      {
        [BASE_PATH]: BASE_FILE,
        '02 Assignments/Quiz 1.md': assessmentNote({
          due: '2026-08-20',
          scope: 'Photosynthesis, Respiration',
        }),
      },
      ['Photosynthesis', 'Respiration', 'Osmosis'],
    );

    const provider = createLocalRetrospectiveProvider({
      vault,
      deviceId: DEVICE,
      offerStore: emptyOfferStore,
      settingsHost: hostWithBasePath(BASE_PATH),
      now: () => NOW,
    });

    const result = await provider.load();
    if (result === null) throw new Error('expected a retrospective to load');

    expect(result.reading.scopeOrigin).toBe('assessment-stated');
    expect(result.reading.scopeCount).toBe(2);
    const names = [...result.reading.held, ...result.reading.faded]
      .map((l) => l.conceptName)
      .sort();
    expect(names).toEqual(['Photosynthesis', 'Respiration']);
    expect(names).not.toContain('Osmosis');
  });

  it("excludes another assessment's own stated scope — resolution is per-assessment, never pooled across the course's assessments", async () => {
    const vault = await vaultWithReviewedConcepts(
      {
        [BASE_PATH]: BASE_FILE,
        '02 Assignments/Quiz 1.md': assessmentNote({
          due: '2026-08-20',
          scope: 'Photosynthesis, Respiration',
        }),
        // Due EARLIER than Quiz 1, so pickAssessment's most-recently-due
        // rule chooses Quiz 1 — this second assessment exists only to prove
        // its own scope text never leaks into Quiz 1's resolved scope.
        '02 Assignments/Quiz 2.md': assessmentNote({ due: '2026-08-15', scope: 'Osmosis' }),
      },
      ['Photosynthesis', 'Respiration', 'Osmosis'],
    );

    const provider = createLocalRetrospectiveProvider({
      vault,
      deviceId: DEVICE,
      offerStore: emptyOfferStore,
      settingsHost: hostWithBasePath(BASE_PATH),
      now: () => NOW,
    });

    const result = await provider.load();
    if (result === null) throw new Error('expected a retrospective to load');

    expect(result.reading.assessmentPath).toBe('02 Assignments/Quiz 1.md');
    expect(result.reading.scopeOrigin).toBe('assessment-stated');
    expect(result.reading.scopeCount).toBe(2);
    const names = [...result.reading.held, ...result.reading.faded].map((l) => l.conceptName);
    expect(names).not.toContain('Osmosis');
  });

  it('never pulls in a same-named-differently concept from another course — the resolver is course-scoped', async () => {
    const vault = await vaultWithReviewedConcepts(
      {
        [BASE_PATH]: BASE_FILE,
        '02 Assignments/Quiz 1.md': assessmentNote({
          due: '2026-08-20',
          scope: 'Photosynthesis, Krebs Cycle',
        }),
      },
      ['Photosynthesis', 'Krebs Cycle'],
    );

    const provider = createLocalRetrospectiveProvider({
      vault,
      deviceId: DEVICE,
      offerStore: emptyOfferStore,
      settingsHost: hostWithBasePath(BASE_PATH),
      now: () => NOW,
    });

    const result = await provider.load();
    if (result === null) throw new Error('expected a retrospective to load');

    // "Krebs Cycle" is a TESTC202 concept; Quiz 1 is TESTC101, so the
    // resolver's course filter drops that scope segment as unresolved
    // rather than reaching across courses for a name match.
    expect(result.reading.scopeCount).toBe(1);
    const names = [...result.reading.held, ...result.reading.faded].map((l) => l.conceptName);
    expect(names).toEqual(['Photosynthesis']);
  });

  it('falls back to the evidenced course-wide set, honestly labelled, only when the assessment records no scope at all', async () => {
    const vault = await vaultWithReviewedConcepts(
      {
        [BASE_PATH]: BASE_FILE,
        '02 Assignments/Quiz 1.md': assessmentNote({ due: '2026-08-20' }), // no `scope:` line
      },
      ['Photosynthesis', 'Respiration', 'Osmosis'],
    );

    const provider = createLocalRetrospectiveProvider({
      vault,
      deviceId: DEVICE,
      offerStore: emptyOfferStore,
      settingsHost: hostWithBasePath(BASE_PATH),
      now: () => NOW,
    });

    const result = await provider.load();
    if (result === null) throw new Error('expected a retrospective to load');

    expect(result.reading.scopeOrigin).toBe('evidenced');
    expect(result.reading.scopeCount).toBe(3);
    const names = [...result.reading.held, ...result.reading.faded]
      .map((l) => l.conceptName)
      .sort();
    expect(names).toEqual(['Osmosis', 'Photosynthesis', 'Respiration']);
    // Never every concept in the course silently — a different course's
    // reviewed concept still never appears, evidenced or not.
    expect(names).not.toContain('Krebs Cycle');
    // The gap is stated honestly: no scope text existed to report either.
    expect(result.assessmentScopeText).toBeUndefined();
  });

  it('an assessment-stated scope whose segments all fail to match is still `assessment-stated`, never silently reinterpreted as `evidenced`', async () => {
    const vault = await vaultWithReviewedConcepts(
      {
        [BASE_PATH]: BASE_FILE,
        '02 Assignments/Quiz 1.md': assessmentNote({
          due: '2026-08-20',
          scope: 'Nonexistent Topic',
        }),
      },
      ['Photosynthesis', 'Respiration', 'Osmosis'],
    );

    const provider = createLocalRetrospectiveProvider({
      vault,
      deviceId: DEVICE,
      offerStore: emptyOfferStore,
      settingsHost: hostWithBasePath(BASE_PATH),
      now: () => NOW,
    });

    const result = await provider.load();
    if (result === null) throw new Error('expected a retrospective to load');

    // The scope TEXT existed ("where recorded" is about the text, not
    // match success) — never blended with the course's evidenced set even
    // though every segment missed.
    expect(result.reading.scopeOrigin).toBe('assessment-stated');
    expect(result.reading.scopeCount).toBe(0);
  });
});
