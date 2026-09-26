/**
 * `resolveCitationPendingRevalidation` tests (`ol-egov.141.89.5.19`, follow-up from
 * `ol-egov.141.89.5.4`/`ol-egov.141.89.5.13`).
 *
 * `[D-351]`'s pending-revalidation fact lives on `CitationAnchorRecord`
 * (`../../src/ingestion/materiality/citation-hash-store.js`), keyed to the CITED PASSAGE's own
 * content hash (`PendingRevalidation.sinceContentHash`) — a different hash space than
 * `InstrumentCitation.sourceRevision` (`ol-egov.141.89.5.4`'s report, section 5: "the hash-space
 * mismatch"). This bead's Class B design (the bead's own description) resolves that mismatch by
 * having the bridge key pending purely on `instrumentId`, trusting the store's OWN currency check
 * (`isPendingRevalidationCurrent`) rather than any `sourceRevision` comparison — the store already
 * enforces `[D-351]`'s revision scoping internally.
 *
 * This suite covers `resolveCitationPendingRevalidation` in isolation (a fake `CitationHashStore`)
 * and — separately — `composeStudySessionForRequest`'s wiring of it into `study-session/compose.ts`'s
 * `citationPendingRevalidation` input, showing `[D-330]`'s withholding actually fires end to end.
 *
 * Fixture data is invented (INV-3): every instrument id, path and hash below is an opaque test
 * string, never drawn from a real vault.
 */
import { enumerateVaultInstruments } from 'olea-core';
import { describe, expect, it } from 'vitest';
import type { CitationHashStore } from '../../src/ingestion/materiality/citation-hash-store.js';
import { ObsidianCitationHashStore } from '../../src/ingestion/materiality/citation-hash-store.js';
import type { ObsidianDataHost } from '../../src/plan/settings-store.js';
import { STUDY_PLAN_SETTINGS_STORAGE_KEY } from '../../src/plan/settings-store.js';
import {
  composeStudySessionForRequest,
  resolveCitationPendingRevalidation,
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

/** Same base fixture `citation-freshness-resolver.spec.ts` and `provider.spec.ts` use. */
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

async function widgetInstrumentId(): Promise<string> {
  const enumeration = await enumerateVaultInstruments(memoryVault(BASE_FILES));
  const record = enumeration.records.find((r) => r.notePath === 'Notes/one.md');
  if (record === undefined) throw new Error('expected an instrument on Notes/one.md');
  return record.instrumentId;
}

const NO_ANCHORS: CitationHashStore = {
  loadAll: async () => new Map(),
  save: async () => {},
  remove: async () => {},
  setPendingRevalidation: async () => {},
  isPendingRevalidationCurrent: async () => false,
};

describe('resolveCitationPendingRevalidation', () => {
  it('adds an instrument whose anchor record carries a pending fact the store confirms current', async () => {
    const store: CitationHashStore = {
      ...NO_ANCHORS,
      loadAll: async () =>
        new Map([
          [
            'instrument-pending',
            {
              sourcePath: 'Notes/one.md',
              text: 'irrelevant',
              conceptIds: [],
              pendingRevalidation: { sinceContentHash: 'hash-1', since: 1 },
            },
          ],
        ]),
      isPendingRevalidationCurrent: async (id, hash) => id === 'instrument-pending' && hash === 'hash-1',
    };

    const result = await resolveCitationPendingRevalidation(store, ['instrument-pending']);

    expect(result.has('instrument-pending')).toBe(true);
  });

  it('omits an instrument whose anchor record carries no pendingRevalidation at all — unknown never withholds on its own', async () => {
    const store: CitationHashStore = {
      ...NO_ANCHORS,
      loadAll: async () =>
        new Map([['instrument-clean', { sourcePath: 'Notes/one.md', text: 'x', conceptIds: [] }]]),
    };

    const result = await resolveCitationPendingRevalidation(store, ['instrument-clean']);

    expect(result.has('instrument-clean')).toBe(false);
  });

  it('omits an instrument with no anchor record tracked at all', async () => {
    const result = await resolveCitationPendingRevalidation(NO_ANCHORS, ['instrument-untracked']);

    expect(result.has('instrument-untracked')).toBe(false);
  });

  it('[D-351] defers to the store\'s OWN currency check, not the mere presence of a pendingRevalidation field — a structurally-present fact the store says is no longer current (superseded by a newer edit) is not honoured', async () => {
    const store: CitationHashStore = {
      ...NO_ANCHORS,
      loadAll: async () =>
        new Map([
          [
            'instrument-superseded',
            {
              sourcePath: 'Notes/one.md',
              text: 'irrelevant',
              conceptIds: [],
              // Present, but stale — the store's own currency check below says a newer edit has
              // already moved the pending hash on, which is exactly the "late result for an
              // earlier edit" case [D-351] guards against.
              pendingRevalidation: { sinceContentHash: 'hash-old', since: 1 },
            },
          ],
        ]),
      isPendingRevalidationCurrent: async () => false,
    };

    const result = await resolveCitationPendingRevalidation(store, ['instrument-superseded']);

    expect(result.has('instrument-superseded')).toBe(false);
  });

  it('resolves each instrument independently, never leaking one instrument\'s pending state onto another', async () => {
    const store: CitationHashStore = {
      ...NO_ANCHORS,
      loadAll: async () =>
        new Map([
          [
            'instrument-a',
            {
              sourcePath: 'Notes/one.md',
              text: 'x',
              conceptIds: [],
              pendingRevalidation: { sinceContentHash: 'hash-a', since: 1 },
            },
          ],
          ['instrument-b', { sourcePath: 'Notes/two.md', text: 'y', conceptIds: [] }],
        ]),
      isPendingRevalidationCurrent: async (id) => id === 'instrument-a',
    };

    const result = await resolveCitationPendingRevalidation(store, ['instrument-a', 'instrument-b']);

    expect(result.has('instrument-a')).toBe(true);
    expect(result.has('instrument-b')).toBe(false);
  });
});

describe('composeStudySessionForRequest — [D-351]/[D-330] pending-revalidation wiring', () => {
  const scheduler = {
    schedule({ instrumentId: id, now }: { instrumentId: string; now: Date }) {
      return {
        instrumentId: id,
        state: {
          schemaVersion: 1 as const,
          due: now.toISOString(),
          stability: 1,
          difficulty: 5,
          scheduledDays: 1,
          learningStepIndex: 0,
          reps: 1,
          lapses: 0,
          learningState: 'review' as const,
          lastReview: now.toISOString(),
        },
        intervalDays: 1,
      };
    },
    retrievability({ instrumentId: id }: { instrumentId: string }) {
      return { instrumentId: id, recallProbability: 1 };
    },
  };

  it('[D-330] withholds an instrument the store reports as currently pending, including from the composed model — unchanged when no citationHashStore is supplied (unknown never withholds on its own)', async () => {
    const instrumentId = await widgetInstrumentId();
    const vault = memoryVault(BASE_FILES);

    const withoutStore = await composeStudySessionForRequest(
      { vault, deviceId: DEVICE, settingsHost: hostWithBasePath(BASE_PATH), now: () => NOW, scheduler },
      { budgetMinutes: 60 },
      NOW,
    );
    if (withoutStore === null) throw new Error('expected a composed session');
    expect(withoutStore.composed.full.citationRevalidationPending.has(instrumentId)).toBe(false);
    expect(
      withoutStore.composed.full.model.items.some((item) => item.conceptName === 'Widget theory'),
    ).toBe(true);

    const citationHashStore = new ObsidianCitationHashStore(new FakeDataHost());
    await citationHashStore.save(instrumentId, {
      sourcePath: 'Notes/one.md',
      text: 'the widget theory material as last observed',
      conceptIds: [],
    });
    await citationHashStore.setPendingRevalidation(instrumentId, 'hash-current', Date.now());

    const withStore = await composeStudySessionForRequest(
      {
        vault: memoryVault(BASE_FILES),
        deviceId: DEVICE,
        settingsHost: hostWithBasePath(BASE_PATH),
        now: () => NOW,
        scheduler,
        citationHashStore,
      },
      { budgetMinutes: 60 },
      NOW,
    );
    if (withStore === null) throw new Error('expected a composed session');

    expect(withStore.composed.full.citationRevalidationPending.has(instrumentId)).toBe(true);
    // [D-330]: withheld from the model entirely — "Widget theory"'s only instrument is the
    // withheld one, so nothing takes its place.
    expect(
      withStore.composed.full.model.items.some((item) => item.conceptName === 'Widget theory'),
    ).toBe(false);
    // Also carried on `composedInput` — the same object `main.ts`'s `extendDefaultStudySession`
    // reuses to widen an already-open session (`[SESS-8.6]`'s doc), so `[D-330]`'s "including
    // inside an already-open session" is served by this one resolution, never a second one.
    expect(withStore.composedInput.citationPendingRevalidation?.has(instrumentId)).toBe(true);
  });

  it('[D-351] end to end through the provider: a late resolution against an earlier edit\'s hash cannot clear a newer pending state, so the instrument stays withheld', async () => {
    const instrumentId = await widgetInstrumentId();
    const citationHashStore = new ObsidianCitationHashStore(new FakeDataHost());
    await citationHashStore.save(instrumentId, {
      sourcePath: 'Notes/one.md',
      text: 'the widget theory material as last observed',
      conceptIds: [],
    });

    // The first edit raises pending for hash-v1 ...
    await citationHashStore.setPendingRevalidation(instrumentId, 'hash-v1', 1000);
    // ... then a SECOND, newer edit raises pending again, for hash-v2 — `[D-351]`'s "the
    // particular source revision being checked" moves on.
    await citationHashStore.setPendingRevalidation(instrumentId, 'hash-v2', 2000);

    // A verdict computed against the now-superseded hash-v1 (a "late result for an earlier
    // edit") must not read as current — this is the exact guard `citation-revision-wiring.ts`'s
    // `applyOutcome` relies on before it would clear anything.
    expect(await citationHashStore.isPendingRevalidationCurrent(instrumentId, 'hash-v1')).toBe(false);
    expect(await citationHashStore.isPendingRevalidationCurrent(instrumentId, 'hash-v2')).toBe(true);

    const result = await composeStudySessionForRequest(
      {
        vault: memoryVault(BASE_FILES),
        deviceId: DEVICE,
        settingsHost: hostWithBasePath(BASE_PATH),
        now: () => NOW,
        scheduler,
        citationHashStore,
      },
      { budgetMinutes: 60 },
      NOW,
    );
    if (result === null) throw new Error('expected a composed session');

    // The newer pending state (hash-v2) still withholds the instrument end to end — a late
    // result for the earlier edit never cleared it.
    expect(result.composed.full.citationRevalidationPending.has(instrumentId)).toBe(true);
    expect(result.composed.full.model.items.some((item) => item.conceptName === 'Widget theory')).toBe(
      false,
    );
  });
});
