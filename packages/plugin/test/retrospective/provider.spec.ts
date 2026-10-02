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
import {
  addManualAssessmentEntry,
  appendDisputeRecord,
  appendReviewLogRecord,
  confirmSameAsLink,
  contestClaim,
  proposeSameAsLink,
  resolveDispute,
  reviewLogPath,
} from 'olea-core';
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
    schemaVersion: 6,
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

describe('createLocalRetrospectiveProvider — F1.2 manual entry fallback (ol-egov.141.8.10)', () => {
  it('with no assignments Base configured, a manual entry still produces a retrospective', async () => {
    const vault = await vaultWithReviewedConcepts({}, ['Photosynthesis']);
    await addManualAssessmentEntry(vault, {
      course: 'TESTC101',
      type: 'Quiz',
      due: '2026-01-01',
      status: 'done',
    });

    const provider = createLocalRetrospectiveProvider({
      vault,
      deviceId: DEVICE,
      offerStore: emptyOfferStore,
      settingsHost: new FakeDataHost(), // blank — no assignments Base configured
      now: () => NOW,
    });

    const result = await provider.load();
    if (result === null) throw new Error('expected a retrospective to load from the manual entry');
    expect(result.reading.course).toBe('TESTC101');
  });
});

/**
 * `ol-owyn`: this provider used to fall back to a locally declared `0.8`,
 * never the `[D-115]`-ratified `0.90`, whenever no `holdingCut` override was
 * supplied — which production never does. A single `good`-rated `qa` review,
 * read five days after it was recorded, lands the real FSRS scheduler's
 * retrievability at roughly 0.84 (`>= 0.8`, `< 0.9`) — the old fallback would
 * read `holding`; the ratified cut must read `tending`.
 */
describe('createLocalRetrospectiveProvider — the no-override holding cut is the ratified 0.90, not 0.8 (ol-owyn)', () => {
  it('a concept whose weakest instrument sits between 0.8 and 0.9 reads "faded" (tending), not "held"', async () => {
    const reviewedAt = '2026-01-01T09:00:00Z';
    const providerNow = new Date(Date.parse(reviewedAt) + 5 * 24 * 60 * 60 * 1000);
    const reviewDay = localToday(providerNow);

    const vault = memoryVault({
      // `assessmentNote`'s fixture hardcodes `class: TESTC101` — the concept
      // must share that course, or D-134 Q6's course-scoped resolver (and the
      // evidenced fallback, both course-gated) never puts it in scope.
      'Notes/owyn-retro.md': conceptNote('Owyn Retro Concept', 'TESTC101'),
      [BASE_PATH]: BASE_FILE,
      '02 Assignments/Quiz Owyn.md': assessmentNote({ due: '2025-12-20', status: 'done' }),
    });
    const concepts = await extractConceptsFromVault(vault, {});
    const conceptId = concepts.find((c) => c.name === 'Owyn Retro Concept')?.key;
    if (conceptId === undefined) throw new Error('missing concept key');

    await vault.write(
      reviewLogPath(reviewDay, DEVICE),
      `${JSON.stringify({
        schemaVersion: 6,
        kind: 'review',
        eventId: 'owyn1',
        timestamp: reviewedAt,
        instrumentId: `qa:${conceptId}:1`,
        instrumentType: 'qa',
        conceptIds: [conceptId],
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
      })}\n`,
    );

    const provider = createLocalRetrospectiveProvider({
      vault,
      deviceId: DEVICE,
      offerStore: emptyOfferStore,
      settingsHost: hostWithBasePath(BASE_PATH),
      // Exactly five days after the review's own timestamp — no `holdingCut`
      // override, so this exercises whatever the provider defaults to.
      now: () => providerNow,
    });

    const result = await provider.load();
    if (result === null) throw new Error('expected a retrospective to load');
    expect(result.reading.faded.map((l) => l.conceptName)).toEqual(['Owyn Retro Concept']);
    expect(result.reading.held).toEqual([]);
  });
});

/**
 * `[D-388]` condition 4's identity input, wired to its real production
 * store (`ol-egov.141.89.11.4`): before this bead `load()` never called
 * `listSameAsLinkRecords`, so two identities sharing only a confirmed
 * same-as link never carried into each other's course — the redirect map
 * was always empty and every id was its own identity.
 */
describe('createLocalRetrospectiveProvider — sameAsLinks wired from the vault (ol-egov.141.89.11.4)', () => {
  it('a confirmed same-as link carries a concept into the OTHER identity’s course', async () => {
    const vault = await vaultWithReviewedConcepts(
      {
        [BASE_PATH]: BASE_FILE,
        '02 Assignments/Quiz 1.md': assessmentNote({ due: '2026-08-20', scope: 'Photosynthesis' }),
      },
      [],
    );
    const concepts = await extractConceptsFromVault(vault, {});
    const photoKey = concepts.find((c) => c.name === 'Photosynthesis')?.key;
    const krebsKey = concepts.find((c) => c.name === 'Krebs Cycle')?.key;
    if (photoKey === undefined || krebsKey === undefined) {
      throw new Error('missing concept key for the fixture');
    }
    await proposeSameAsLink(vault, photoKey, krebsKey);
    await confirmSameAsLink(vault, photoKey, krebsKey);

    const provider = createLocalRetrospectiveProvider({
      vault,
      deviceId: DEVICE,
      offerStore: emptyOfferStore,
      settingsHost: hostWithBasePath(BASE_PATH),
      now: () => NOW,
    });

    const result = await provider.load();
    if (result === null) throw new Error('expected a retrospective to load');

    const entry = result.reading.carries.find((c) => c.conceptName === 'Photosynthesis');
    if (entry === undefined) throw new Error('expected a carries entry for Photosynthesis');
    // "Krebs Cycle" (`CONCEPT_FILES`) is a TESTC202 concept — the confirmed
    // link is the ONLY reason its course shows up here, never a shared
    // label (TESTC101's own concept, "Photosynthesis", shares no wording
    // with it at all).
    expect(entry.otherCourses).toEqual(['TESTC202']);
  });
});

/**
 * D-134 Q3's fallback, wired to the course's real last assessment (`ol-
 * egov.141.89.11.4`): before this bead `finalAssessmentScope` always used
 * the coarse evidenced set and `finalAssessmentScopeOrigin` was always
 * omitted, even when the course's own actual last assessment stated its
 * scope in F1.7 text — so a "what carries into the term's last assessment"
 * line always read its basis as Olea's reading, never the examiner's.
 */
describe('createLocalRetrospectiveProvider — finalAssessmentScopeOrigin wired from the last assessment (ol-egov.141.89.11.4)', () => {
  it("reads the basis from the course's actual LAST assessment's own stated scope, not the chosen (earlier) one", async () => {
    const vault = await vaultWithReviewedConcepts(
      {
        [BASE_PATH]: BASE_FILE,
        '02 Assignments/Quiz 1.md': assessmentNote({
          due: '2026-08-20',
          scope: 'Photosynthesis, Osmosis',
        }),
        // Due AFTER `NOW`, so it has not passed and is never `chosen` — but
        // it IS the course's actual last assessment by due date, and its
        // own stated scope is what `finalAssessmentScopeOrigin` should read.
        '02 Assignments/Quiz 3.md': assessmentNote({
          due: '2026-12-01',
          status: 'assigned',
          scope: 'Photosynthesis',
        }),
      },
      [],
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
    const photosynthesis = result.reading.carries.find((c) => c.conceptName === 'Photosynthesis');
    if (photosynthesis === undefined)
      throw new Error('expected a carries entry for Photosynthesis');
    expect(photosynthesis.carriesToFinalAssessment).toBe(true);
    expect(photosynthesis.finalAssessmentBasis).toBe('declared-scope');
    // Osmosis is in Quiz 1's own scope but not in Quiz 3's — it never
    // carries anywhere, proving the basis above is read from Quiz 3's OWN
    // text, not a blanket "the last assessment exists" default.
    expect(result.reading.carries.find((c) => c.conceptName === 'Osmosis')).toBeUndefined();
  });
});

/**
 * `ol-egov.141.89.9.63`: `readReviewHistory`'s `disputes` return already
 * reached `history.disputes` here (same read `entries` comes from), but the
 * `buildRetrospective` call dropped it, so a `[D-095]` grade contest
 * resolved `corrected` never reached this provider's vitality partition even though `buildRetrospective`
 * itself already knew how to use it (`ol-egov.141.89.9.61`). Mirrors
 * `today/data-source.ts`'s own `disputes: history.disputes` forwarding this
 * bead copies the pattern from.
 */
describe('createLocalRetrospectiveProvider — disputes forwarded into vitality (ol-egov.141.89.9.63)', () => {
  async function vaultWithDisputableConcept() {
    const vault = await vaultWithReviewedConcepts(
      {
        [BASE_PATH]: BASE_FILE,
        '02 Assignments/Quiz 1.md': assessmentNote({ due: '2026-08-20', scope: 'Photosynthesis' }),
      },
      ['Photosynthesis'],
    );
    const concepts = await extractConceptsFromVault(vault, {});
    const conceptId = concepts.find((c) => c.name === 'Photosynthesis')?.key;
    if (conceptId === undefined) throw new Error('expected Photosynthesis to mint a concept key');
    return { vault, conceptId, instrumentId: `qa:${conceptId}:1` };
  }

  it('baseline (no disputes): the reviewed concept sets its vitality and lands in held or faded, none too-early', async () => {
    const { vault } = await vaultWithDisputableConcept();
    const provider = createLocalRetrospectiveProvider({
      vault,
      deviceId: DEVICE,
      offerStore: emptyOfferStore,
      settingsHost: hostWithBasePath(BASE_PATH),
      now: () => NOW,
    });

    const result = await provider.load();
    if (result === null) throw new Error('expected a retrospective to load');

    const names = [...result.reading.held, ...result.reading.faded].map((l) => l.conceptName);
    expect(names).toEqual(['Photosynthesis']);
    expect(result.reading.tooEarlyCount).toBe(0);
  });

  async function contestCorrected(
    vault: ReturnType<typeof memoryVault>,
    conceptId: string,
    instrumentId: string,
  ) {
    const opening = contestClaim({
      claim: {
        rendering: 'explain-back-grade',
        conceptIds: [conceptId],
        instrumentId,
        evidenceBasis: 'evidence-fingerprint-1',
      },
      timestamp: '2026-09-02T10:00:00-04:00',
    });
    const { record: openingRecord } = await appendDisputeRecord(vault, opening.record, {
      deviceId: DEVICE,
      generateEventId: () => 'retro-dispute-1',
    });
    const resolution = resolveDispute({
      dispute: openingRecord,
      outcome: 'corrected',
      timestamp: '2026-09-02T11:00:00-04:00',
    });
    await appendDisputeRecord(vault, resolution, {
      deviceId: DEVICE,
      generateEventId: () => 'retro-dispute-2',
    });
  }

  // `ol-egov.141.89.9.68` (rulings of 2026-09-28, `ol-egov.141.89.9.66`): the
  // contest proves ONE review's grade wrong, never the instrument.
  it('a corrected contest no longer drops the instrument’s other reviews: an earlier review still sets vitality', async () => {
    const { vault, conceptId, instrumentId } = await vaultWithDisputableConcept();
    const {
      eventId: _eventId,
      schemaVersion: _schemaVersion,
      kind: _kind,
      ...earlier
    } = reviewRecord(conceptId);
    await appendReviewLogRecord(
      vault,
      { ...earlier, timestamp: '2026-09-01T09:00:00-04:00' },
      { deviceId: DEVICE, generateEventId: () => 'retro-earlier-review' },
    );
    await contestCorrected(vault, conceptId, instrumentId);

    const provider = createLocalRetrospectiveProvider({
      vault,
      deviceId: DEVICE,
      offerStore: emptyOfferStore,
      settingsHost: hostWithBasePath(BASE_PATH),
      now: () => NOW,
    });
    const result = await provider.load();
    if (result === null) throw new Error('expected a retrospective to load');

    const names = [...result.reading.held, ...result.reading.faded].map((l) => l.conceptName);
    expect(names).toEqual(['Photosynthesis']);
    expect(result.reading.tooEarlyCount).toBe(0);
  });

  it('a grade contest against that instrument, resolved corrected, drops its only review out of vitality — it moves to too-early, not held/faded', async () => {
    const { vault, conceptId, instrumentId } = await vaultWithDisputableConcept();
    await contestCorrected(vault, conceptId, instrumentId);

    const provider = createLocalRetrospectiveProvider({
      vault,
      deviceId: DEVICE,
      offerStore: emptyOfferStore,
      settingsHost: hostWithBasePath(BASE_PATH),
      now: () => NOW,
    });

    const result = await provider.load();
    if (result === null) throw new Error('expected a retrospective to load');

    const names = [...result.reading.held, ...result.reading.faded].map((l) => l.conceptName);
    expect(names).toEqual([]);
    expect(result.reading.tooEarlyCount).toBe(1);
  });
});

// `ol-egov.141.89.9.73` (`[D-419]`, `[D-423]`): the evidenced set is the course concepts a review
// scored (the first id of its own list); a concept a review only names as context is not evidence.
describe('createLocalRetrospectiveProvider — the evidenced scope counts a review for its scored concept only (ol-egov.141.89.9.73, D-423)', () => {
  async function evidencedNames(conceptNamesInRecord: readonly string[]): Promise<string[]> {
    const vault = memoryVault({
      ...CONCEPT_FILES,
      [BASE_PATH]: BASE_FILE,
      '02 Assignments/Quiz 1.md': assessmentNote({ due: '2026-08-20' }), // no `scope:` line
    });
    const concepts = await extractConceptsFromVault(vault, {});
    const keyByName = new Map(concepts.map((c) => [c.name, c.key] as const));
    const conceptIds = conceptNamesInRecord.map((name) => {
      const key = keyByName.get(name);
      if (key === undefined) throw new Error(`no concept minted for "${name}"`);
      return key;
    });
    const record: ReviewLogRecord = { ...reviewRecord('unused'), conceptIds };
    await vault.write(reviewLogPath(REVIEW_DAY, DEVICE), JSON.stringify(record));

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
    expect(result.reading.scopeCount).toBe(1);
    return [...result.reading.held, ...result.reading.faded].map((l) => l.conceptName).sort();
  }

  it('lists the first-listed concept of a two-topic review, and not the second', async () => {
    expect(await evidencedNames(['Photosynthesis', 'Respiration'])).toEqual(['Photosynthesis']);
  });

  it('follows the order the record was written in', async () => {
    expect(await evidencedNames(['Respiration', 'Photosynthesis'])).toEqual(['Respiration']);
  });
});

describe('createLocalRetrospectiveProvider — what she had practised by the date (ol-egov.141.89.11.31, D-469)', () => {
  const DUE = '2026-08-20';

  async function vaultWithReviewsOn(
    daysByName: Readonly<Record<string, string>>,
    scope: string | undefined,
  ) {
    const vault = memoryVault({
      ...CONCEPT_FILES,
      [BASE_PATH]: BASE_FILE,
      '02 Assignments/Quiz 1.md': assessmentNote({
        due: DUE,
        ...(scope === undefined ? {} : { scope }),
      }),
    });
    const concepts = await extractConceptsFromVault(vault, {});
    const keyByName = new Map(concepts.map((c) => [c.name, c.key] as const));
    for (const [name, day] of Object.entries(daysByName)) {
      const key = keyByName.get(name);
      if (key === undefined) throw new Error(`no concept minted for "${name}"`);
      await vault.write(
        reviewLogPath(day, DEVICE),
        JSON.stringify({ ...reviewRecord(key), timestamp: `${day}T10:00:00-04:00` }),
      );
    }
    return vault;
  }

  async function load(vault: Awaited<ReturnType<typeof vaultWithReviewsOn>>) {
    const provider = createLocalRetrospectiveProvider({
      vault,
      deviceId: DEVICE,
      offerStore: emptyOfferStore,
      settingsHost: hostWithBasePath(BASE_PATH),
      now: () => NOW,
    });
    const result = await provider.load();
    if (result === null) throw new Error('expected a retrospective to load');
    return result.reading;
  }

  it('passes the assessment date: the day before counts, the assessment day and later do not', async () => {
    const vault = await vaultWithReviewsOn(
      { Photosynthesis: '2026-08-19', Respiration: '2026-08-20', Osmosis: '2026-08-25' },
      'Photosynthesis, Respiration, Osmosis',
    );
    const reading = await load(vault);
    expect(reading.beforeAssessment).toEqual({
      kind: 'counts',
      practised: 1,
      scopeSize: 3,
      explained: 0,
      basis: 'assessment-stated',
    });
  });

  it('a scope edit after the date moves {m} and the line still names the stated basis', async () => {
    const vault = await vaultWithReviewsOn({ Photosynthesis: '2026-08-19' }, 'Photosynthesis');
    expect((await load(vault)).beforeAssessment).toMatchObject({ scopeSize: 1 });
    await vault.write(
      '02 Assignments/Quiz 1.md',
      assessmentNote({ due: DUE, scope: 'Photosynthesis, Respiration' }),
    );
    expect((await load(vault)).beforeAssessment).toMatchObject({
      scopeSize: 2,
      basis: 'assessment-stated',
    });
  });

  it('no stated scope (evidenced) shows the scope limitation, never counts', async () => {
    const vault = await vaultWithReviewsOn({ Photosynthesis: '2026-08-19' }, undefined);
    const reading = await load(vault);
    expect(reading.scopeOrigin).toBe('evidenced');
    expect(reading.beforeAssessment).toEqual({ kind: 'unavailable', reason: 'scope' });
  });

  it('only practice after the date reads as the history limitation, never a zero', async () => {
    const vault = await vaultWithReviewsOn({ Photosynthesis: '2026-08-25' }, 'Photosynthesis');
    expect((await load(vault)).beforeAssessment).toEqual({
      kind: 'unavailable',
      reason: 'history',
    });
  });

  it('a stated scope that resolves to no concept reads as the scope limitation', async () => {
    const vault = await vaultWithReviewsOn({ Photosynthesis: '2026-08-19' }, 'Nothing Matches');
    expect((await load(vault)).beforeAssessment).toEqual({
      kind: 'unavailable',
      reason: 'scope',
    });
  });
});
