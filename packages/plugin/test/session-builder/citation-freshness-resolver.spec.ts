/**
 * `resolveCitationFreshness` tests (`ol-egov.141.89.10.33`, discovered from `ol-2zfj.154`'s own
 * follow-up: "Build the production resolver that turns a CitationRecord (passageDigest) plus a
 * current passage observation into the citationFreshness map compose.ts now accepts, and wire
 * it into session-builder/provider.ts").
 *
 * Before this bead, `study-session/compose.ts` accepted an optional `citationFreshness` map but
 * no production caller ever built one — every instrument silently read `'unknown'` by the
 * input's own default. This suite covers the resolver `provider.ts` now supplies, and pins the
 * exact behaviour the bead's acceptance criteria names: a resolved map, all three
 * `CitationFreshnessState` values reachable through it, and — separately — that the wiring is
 * live in `composeStudySessionForRequest` without changing what gets served.
 *
 * Fixture data is invented (INV-3): every instrument id, digest and note path below is an
 * opaque test string, never drawn from a real vault.
 */
import { enumerateVaultInstruments, writeInstrumentCitation } from 'olea-core';
import { describe, expect, it } from 'vitest';
import type { ObsidianDataHost } from '../../src/plan/settings-store.js';
import { STUDY_PLAN_SETTINGS_STORAGE_KEY } from '../../src/plan/settings-store.js';
import {
  composeStudySessionForRequest,
  resolveCitationFreshness,
} from '../../src/session-builder/provider.js';
import { memoryVault } from '../review/memory-vault.js';

const DEVICE = 'olea-testdevice1';
const BASE_PATH = '02 Assignments/Assignments.base';
const NOW = new Date('2026-08-10T09:00:00-04:00');

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
].join('\n');

const QUIZ =
  '---\nclass: TESTC101\ntype: Quiz\nweight: 10\ndue: 2026-09-01\nstatus: upcoming\n---\n\n# Quiz 1\n';

/**
 * `test/gap/provider.spec.ts`'s own fixture, reused verbatim (also the base fixture
 * `session-builder/provider.spec.ts` uses): one course, one cited concept, one note carrying
 * both the topic binding and a real instrument.
 */
const BASE_FILES: Readonly<Record<string, string>> = {
  '05 Zettelkasten/Widget theory.md': '# Widget theory\n',
  'Notes/one.md': [
    '---',
    'topic: [Widget theory]',
    'course: TESTC101',
    '---',
    '',
    'Front::Back',
    '',
  ].join('\n'),
  '03 Research/TESTC101 Past Paper 2023.md': [
    '---',
    'role: past-paper',
    'course: TESTC101',
    '---',
    '',
    '# TESTC101 Past Paper — 2023',
    '',
    '## Question 1 (10 marks)',
    '',
    'Explain the core mechanism behind Widget theory and why it matters.',
    '',
  ].join('\n'),
  [BASE_PATH]: BASE_FILE,
  '02 Assignments/Quiz 1.md': QUIZ,
};

/** The real `instrumentId` `session/enumerate.ts` mints for `Notes/one.md`'s card. */
async function widgetInstrumentId(): Promise<string> {
  const enumeration = await enumerateVaultInstruments(memoryVault(BASE_FILES));
  const record = enumeration.records.find((r) => r.notePath === 'Notes/one.md');
  if (record === undefined) throw new Error('expected an instrument on Notes/one.md');
  return record.instrumentId;
}

describe('resolveCitationFreshness', () => {
  it('reads fresh when a current observation matches the recorded digest', async () => {
    const vault = memoryVault();
    await writeInstrumentCitation(vault, 'instrument-fresh', {
      sourcePath: 'Notes/one.md',
      passageDigest: 'digest-a',
    });

    const result = await resolveCitationFreshness(vault, ['instrument-fresh'], () => 'digest-a');

    expect(result.get('instrument-fresh')).toBe('fresh');
  });

  it('reads stale when a current observation differs from the recorded digest', async () => {
    const vault = memoryVault();
    await writeInstrumentCitation(vault, 'instrument-stale', {
      sourcePath: 'Notes/one.md',
      passageDigest: 'digest-a',
    });

    const result = await resolveCitationFreshness(vault, ['instrument-stale'], () => 'digest-b');

    expect(result.get('instrument-stale')).toBe('stale');
  });

  it('reads unknown for a legacy citation record with no passageDigest, even with a real observation in hand', async () => {
    const vault = memoryVault();
    await writeInstrumentCitation(vault, 'instrument-legacy', {
      sourcePath: 'Notes/one.md',
    });

    const result = await resolveCitationFreshness(vault, ['instrument-legacy'], () => 'digest-a');

    expect(result.get('instrument-legacy')).toBe('unknown');
  });

  it('reads unknown when a digest is recorded but the caller has no current observation (production behaviour today)', async () => {
    const vault = memoryVault();
    await writeInstrumentCitation(vault, 'instrument-unobserved', {
      sourcePath: 'Notes/one.md',
      passageDigest: 'digest-a',
    });

    const result = await resolveCitationFreshness(
      vault,
      ['instrument-unobserved'],
      () => undefined,
    );

    expect(result.get('instrument-unobserved')).toBe('unknown');
  });

  it('omits an instrument with no citation record at all, rather than fabricating one', async () => {
    const vault = memoryVault();

    const result = await resolveCitationFreshness(vault, ['instrument-uncited'], () => 'digest-a');

    expect(result.has('instrument-uncited')).toBe(false);
  });

  it('resolves an independent state per instrument id, never leaking one instrument citation onto another', async () => {
    const vault = memoryVault();
    await writeInstrumentCitation(vault, 'instrument-1', {
      sourcePath: 'Notes/one.md',
      passageDigest: 'digest-a',
    });
    await writeInstrumentCitation(vault, 'instrument-2', {
      sourcePath: 'Notes/two.md',
      passageDigest: 'digest-b',
    });

    const result = await resolveCitationFreshness(
      vault,
      ['instrument-1', 'instrument-2'],
      (citation) => (citation.sourcePath === 'Notes/one.md' ? 'digest-a' : 'digest-mismatch'),
    );

    expect(result.get('instrument-1')).toBe('fresh');
    expect(result.get('instrument-2')).toBe('stale');
  });
});

describe('composeStudySessionForRequest — citation freshness wiring', () => {
  it('surfaces a stale-but-unobserved citation as a queued re-check, and still serves the instrument (unknown is never withheld)', async () => {
    const instrumentId = await widgetInstrumentId();
    const vault = memoryVault(BASE_FILES);
    await writeInstrumentCitation(vault, instrumentId, {
      sourcePath: 'Notes/one.md',
      passageDigest: 'digest-a',
    });

    const result = await composeStudySessionForRequest(
      {
        vault,
        deviceId: DEVICE,
        settingsHost: hostWithBasePath(BASE_PATH),
        now: () => NOW,
        scheduler: {
          schedule({ instrumentId: id, now }) {
            return {
              instrumentId: id,
              state: {
                schemaVersion: 1,
                due: now.toISOString(),
                stability: 1,
                difficulty: 5,
                scheduledDays: 1,
                learningStepIndex: 0,
                reps: 1,
                lapses: 0,
                learningState: 'review',
                lastReview: now.toISOString(),
              },
              intervalDays: 1,
            };
          },
          retrievability({ instrumentId: id }) {
            return { instrumentId: id, recallProbability: 1 };
          },
        },
      },
      { budgetMinutes: 60 },
      NOW,
    );
    if (result === null) throw new Error('expected a composed session (study plan is configured)');

    // Wired: this bead's own instrument, cited with a real `passageDigest`, is reachable
    // through the resolver — but no production observation exists yet (`resolveCitationFreshness`'s
    // own doc), so it reads 'unknown' and is queued for a re-check, never silently 'fresh'.
    expect(result.composed.full.citationRecheckQueued.has(instrumentId)).toBe(true);
    // Not withheld: the instrument is still in the served model, exactly as an instrument with
    // no citation record at all would be — behaviour is unchanged for fresh/unknown instruments.
    const items = result.composed.full.model.items;
    expect(items.some((item) => item.conceptName === 'Widget theory')).toBe(true);
  });

  it('an instrument with no citation record at all is also served, and reads unknown by the same default compose.ts already applies', async () => {
    const vault = memoryVault(BASE_FILES);

    const result = await composeStudySessionForRequest(
      {
        vault,
        deviceId: DEVICE,
        settingsHost: hostWithBasePath(BASE_PATH),
        now: () => NOW,
        scheduler: {
          schedule({ instrumentId: id, now }) {
            return {
              instrumentId: id,
              state: {
                schemaVersion: 1,
                due: now.toISOString(),
                stability: 1,
                difficulty: 5,
                scheduledDays: 1,
                learningStepIndex: 0,
                reps: 1,
                lapses: 0,
                learningState: 'review',
                lastReview: now.toISOString(),
              },
              intervalDays: 1,
            };
          },
          retrievability({ instrumentId: id }) {
            return { instrumentId: id, recallProbability: 1 };
          },
        },
      },
      { budgetMinutes: 60 },
      NOW,
    );
    if (result === null) throw new Error('expected a composed session (study plan is configured)');

    const instrumentId = await widgetInstrumentId();
    expect(result.composed.full.citationRecheckQueued.has(instrumentId)).toBe(true);
    const items = result.composed.full.model.items;
    expect(items.some((item) => item.conceptName === 'Widget theory')).toBe(true);
  });
});
