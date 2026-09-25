/**
 * `createLocalRegistryProvider` wiring tests (`ol-4v2l`, F8.4/F8.5).
 *
 * Every fixture string below is INVENTED — course codes, concept names,
 * question text — per INV-3; nothing here is drawn from a real vault. This
 * suite is not re-testing `buildRegistryModel`'s own acceptance criteria
 * (that is `packages/core/src/registry/build.spec.ts`'s job) — it tests the
 * WIRING this bead adds: the vault walk plus whole-log read, the overrides
 * round trip through `data.json`, and the prune/restore round trip through
 * the review log.
 */
import {
  appendDisputeRecord,
  appendReviewLogRecord,
  type ConceptRecord,
  contestClaim,
  createFsrsScheduler,
  listSameAsLinkRecords,
  proposeSameAsLink,
  type RegistryInstrumentSummary,
  type RegistrySourceLocation,
  type RetrievabilityInput,
  type RetrievabilityOutput,
  type Scheduler,
} from 'olea-core';
import { describe, expect, it } from 'vitest';
import { STUDY_PLAN_SETTINGS_STORAGE_KEY } from '../../src/plan/settings-store.js';
import type { ObsidianDataHost } from '../../src/registry/overrides-store.js';
import type { EditInstrumentPort, OpenSourceLocationPort } from '../../src/registry/provider.js';
import { createLocalRegistryProvider } from '../../src/registry/provider.js';
import type { RegistryViewState } from '../../src/registry/view.js';
import { memoryVault, unreadableVault } from '../review/memory-vault.js';

const DEVICE = 'olea-testdevice1';
const NOW = new Date('2026-02-01T12:00:00Z');

class FakeDataHost implements ObsidianDataHost {
  blob: unknown = null;

  async loadData(): Promise<unknown> {
    return this.blob;
  }

  async saveData(data: unknown): Promise<void> {
    this.blob = data;
  }
}

class FakeEditPort implements EditInstrumentPort {
  opened: RegistryInstrumentSummary[] = [];

  async edit(instrument: RegistryInstrumentSummary): Promise<void> {
    this.opened.push(instrument);
  }
}

function fixtureVault() {
  return memoryVault({
    'Notes/one.md': [
      '---',
      'topic: [Concept A]',
      'course: TESTC101',
      '---',
      '',
      'Front text::Back text',
      '',
    ].join('\n'),
  });
}

async function modelFrom(state: RegistryViewState) {
  if (state.kind !== 'model') throw new Error(`expected a model, got ${state.kind}`);
  return state.model;
}

function makeProvider(
  vault: ReturnType<typeof fixtureVault>,
  settingsHost: FakeDataHost,
  editPort: FakeEditPort,
) {
  return createLocalRegistryProvider({
    vault,
    deviceId: DEVICE,
    settingsHost,
    now: () => NOW,
    editPort,
  });
}

describe('createLocalRegistryProvider — load', () => {
  it('composes a browsable model from the vault walk', async () => {
    const provider = makeProvider(fixtureVault(), new FakeDataHost(), new FakeEditPort());
    const model = await modelFrom(await provider.load());
    expect(model.concepts).toHaveLength(1);
    const row = model.concepts[0];
    expect(row?.displayName).toBe('Concept A');
    expect(row?.courses).toEqual(['TESTC101']);
    expect(row?.instruments).toHaveLength(1);
    expect(row?.pruned).toBe(false);
  });

  it('returns unavailable, never throws, when the vault cannot be read', async () => {
    const provider = makeProvider(
      unreadableVault() as ReturnType<typeof fixtureVault>,
      new FakeDataHost(),
      new FakeEditPort(),
    );
    const state = await provider.load();
    expect(state.kind).toBe('unavailable');
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
describe('createLocalRegistryProvider — the no-override holding cut is the ratified 0.90, not 0.8 (ol-owyn)', () => {
  it('a concept whose weakest instrument sits between 0.8 and 0.9 reads "tending", not "holding"', async () => {
    const vault = fixtureVault();
    const before = await modelFrom(
      await makeProvider(vault, new FakeDataHost(), new FakeEditPort()).load(),
    );
    const conceptId = before.concepts[0]?.key;
    if (conceptId === undefined) throw new Error('missing concept key');

    const reviewedAt = '2026-01-01T09:00:00Z';
    await appendReviewLogRecord(
      vault,
      {
        timestamp: reviewedAt,
        instrumentId: 'qa:owyn-probe:1',
        instrumentType: 'qa',
        conceptIds: [conceptId],
        rating: 'good',
        wasUnsure: false,
        durationMs: 1200,
        selectionContext: {
          dueState: 'due',
          examProximity: null,
          yieldRank: null,
          instrumentTypesOffered: ['qa'],
          planVersion: null,
        },
      },
      { deviceId: DEVICE, generateEventId: () => 'owyn1' },
    );

    const provider = createLocalRegistryProvider({
      vault,
      deviceId: DEVICE,
      settingsHost: new FakeDataHost(),
      // Exactly five days after the review's own timestamp — no `holdingCut`
      // override, so this exercises whatever the provider defaults to.
      now: () => new Date(Date.parse(reviewedAt) + 5 * 24 * 60 * 60 * 1000),
      editPort: new FakeEditPort(),
    });
    const after = await modelFrom(await provider.load());
    expect(after.concepts[0]?.vitality.value).toBe('tending');
  });
});

describe('createLocalRegistryProvider — rename (F8.4)', () => {
  it('persists across a reload, and the old name becomes an alias', async () => {
    const host = new FakeDataHost();
    const provider = makeProvider(fixtureVault(), host, new FakeEditPort());
    const before = await modelFrom(await provider.load());
    const entry = before.concepts[0];
    if (entry === undefined) throw new Error('missing entry');

    await provider.rename(entry, 'Renamed concept');

    const after = await modelFrom(await provider.load());
    const row = after.concepts[0];
    expect(row?.key).toBe(entry.key);
    expect(row?.displayName).toBe('Renamed concept');
    expect(row?.aliases).toEqual(['Concept A']);
  });
});

// Scenario: olea-service/features/F8-concepts-scope.md — "F8.4 / [D-183] —
// A later-arriving higher-ranked source proposes a rename rather than
// silently overwriting it", tagged `@auto:plugin/registry/provider.spec`.
//
// `gateRenameProposal`'s own decision logic (does a candidate outrank the
// current tier? does the wording differ? has this exact source+wording
// already been declined?) is exhaustively covered, case by case, at
// `packages/core/src/registry/rename-proposal.spec.ts` — this provider's
// copy is a documented function-for-function mirror of that tested version
// (see `provider.ts`'s own module doc for why it is a copy rather than an
// import). What is genuinely THIS file's own behaviour to prove is the
// WIRING: that `load()` never fabricates a proposal for an ordinary
// concept, and that accept/decline round-trip correctly through the
// existing override store and the session-scoped decline memory.
//
// A real end-to-end trigger — the SAME concept key re-extracted at a
// HIGHER tier with genuinely DIFFERENT wording — has no vault fixture that
// can produce it: `../concept/extract.ts`'s tier-1/tier-3 binding is
// always an EXACT title match against the name already in hand (see that
// file's own doc), so nothing in today's real extraction pipeline ever
// hands the SAME key a NEW name at a NEW tier. That is a second, deeper
// reachability gap this bead's report names alongside the session-only
// persistence one — closing it needs the still-provisional stable-key
// work (`../concept/types.ts`'s own doc on `ConceptRecord.key`), not
// anything in this bead's `owns`. These tests therefore exercise
// accept/decline directly, with a hand-built `RenameProposal` value of the
// same shape a real detection would produce, rather than through a vault
// fixture that cannot exist yet.
describe('createLocalRegistryProvider — rename proposal ([D-183])', () => {
  it('load() proposes nothing for an ordinary concept with no rank-outranking candidate', async () => {
    const provider = makeProvider(fixtureVault(), new FakeDataHost(), new FakeEditPort());
    const model = await modelFrom(await provider.load());
    expect(model.concepts[0]?.renameProposal ?? null).toBeNull();
  });

  it('acceptRenameProposal demotes the frozen wording to an alias and persists across a reload', async () => {
    const host = new FakeDataHost();
    const seen: unknown[] = [];
    const provider = createLocalRegistryProvider({
      vault: fixtureVault(),
      deviceId: DEVICE,
      settingsHost: host,
      now: () => NOW,
      editPort: new FakeEditPort(),
      onOverridesChanged: (overrides) => {
        seen.push(overrides);
      },
    });
    const before = await modelFrom(await provider.load());
    const entry = before.concepts[0];
    if (entry === undefined) throw new Error('missing entry');

    const proposal = {
      key: entry.key,
      currentDisplayName: entry.originalName,
      currentTier: entry.tier,
      candidate: { tier: 1 as const, wording: 'Her own wording for it' },
    };
    await provider.acceptRenameProposal(entry, proposal);
    expect(seen).toHaveLength(1);

    const after = await modelFrom(await provider.load());
    const row = after.concepts[0];
    expect(row?.key).toBe(entry.key);
    expect(row?.displayName).toBe('Her own wording for it');
    expect(row?.aliases).toEqual([entry.originalName]);

    // `[D-206]` (ol-2zfj.59): the winning tier is persisted alongside the
    // rename, not just the wording — read directly off the stored blob
    // since `sourceTier` is not itself rendered by the registry view.
    const stored = (host.blob as Record<string, unknown>).registryOverrides as {
      renames: Record<string, { sourceTier?: number }>;
    };
    expect(stored.renames[entry.key]?.sourceTier).toBe(1);
  });

  // `[D-206]` (ol-2zfj.59): a decline now persists through the same override
  // store every other write here uses, instead of only living in a session
  // `Map`/`Set` this provider instance would lose on the next Obsidian
  // restart. Scenario: olea-service/features/F8-concepts-scope.md — "F8.4 /
  // [D-206] — the rename-proposal baseline survives a restart".
  it('declineRenameProposal persists the decline through the override store, and it survives a fresh provider instance on the same host', async () => {
    const host = new FakeDataHost();
    const seen: unknown[] = [];
    const provider = createLocalRegistryProvider({
      vault: fixtureVault(),
      deviceId: DEVICE,
      settingsHost: host,
      now: () => NOW,
      editPort: new FakeEditPort(),
      onOverridesChanged: (overrides) => {
        seen.push(overrides);
      },
    });
    const before = await modelFrom(await provider.load());
    const entry = before.concepts[0];
    if (entry === undefined) throw new Error('missing entry');

    const proposal = {
      key: entry.key,
      currentDisplayName: entry.originalName,
      currentTier: entry.tier,
      candidate: { tier: 1 as const, wording: 'Her own wording for it' },
    };
    await expect(provider.declineRenameProposal(entry, proposal)).resolves.toBeUndefined();
    expect(seen).toHaveLength(1);
    expect(host.blob).not.toBeNull();

    // Declining left the concept's own name untouched — nothing was accepted.
    const after = await modelFrom(await provider.load());
    expect(after.concepts[0]?.displayName).toBe(entry.originalName);

    // The signature is on the store, readable by a SECOND provider instance
    // backed by the same host — the "Obsidian restart" this bead closes the
    // gap for, since a fresh instance starts with an empty session `Map` and
    // must reconstruct everything it knows from `overrides` alone. (A real
    // re-fire of this exact candidate through `load()` cannot be produced
    // from a vault fixture — see this describe block's own module comment
    // on the reachability gap `ol-zfty` still waits on — so this checks the
    // durable fact the decline was recorded against, which
    // `core/registry/rename-proposal.spec.ts`'s own "declined signature
    // survives across a simulated restart" test already proves is
    // sufficient for `gateRenameCandidate` to keep suppressing it.)
    const restarted = createLocalRegistryProvider({
      vault: fixtureVault(),
      deviceId: DEVICE,
      settingsHost: host,
      now: () => NOW,
      editPort: new FakeEditPort(),
    });
    const afterRestart = await modelFrom(await restarted.load());
    expect(afterRestart.concepts[0]?.renameProposal ?? null).toBeNull();
    const stored = (host.blob as Record<string, unknown>).registryOverrides as {
      declinedRenameSignatures?: readonly string[];
    };
    expect(stored.declinedRenameSignatures).toContain('1:Her own wording for it');
  });
});

describe('createLocalRegistryProvider — withdraw/restore concept (F8.5)', () => {
  it('withdraws and restores, never deleting the row', async () => {
    const host = new FakeDataHost();
    const provider = makeProvider(fixtureVault(), host, new FakeEditPort());
    const before = await modelFrom(await provider.load());
    const entry = before.concepts[0];
    if (entry === undefined) throw new Error('missing entry');

    await provider.withdrawConcept(entry);
    const withdrawn = await modelFrom(await provider.load());
    expect(withdrawn.concepts).toHaveLength(1);
    expect(withdrawn.concepts[0]?.pruned).toBe(true);
    expect(withdrawn.concepts[0]?.instruments).toHaveLength(1);

    await provider.restoreConcept(entry);
    const restored = await modelFrom(await provider.load());
    expect(restored.concepts[0]?.pruned).toBe(false);
  });
});

describe('createLocalRegistryProvider — withdraw/restore instrument (F8.5)', () => {
  it('withdraws and restores an instrument through the review log, never deleting it from the mix', async () => {
    const host = new FakeDataHost();
    const provider = makeProvider(fixtureVault(), host, new FakeEditPort());
    const before = await modelFrom(await provider.load());
    const instrument = before.concepts[0]?.instruments[0];
    if (instrument === undefined) throw new Error('missing instrument');

    await provider.withdrawInstrument(instrument);
    const withdrawn = await modelFrom(await provider.load());
    const withdrawnInstrument = withdrawn.concepts[0]?.instruments[0];
    expect(withdrawnInstrument?.pruned).toBe(true);
    expect(withdrawnInstrument?.instrumentId).toBe(instrument.instrumentId);

    await provider.restoreInstrument(instrument);
    const restored = await modelFrom(await provider.load());
    expect(restored.concepts[0]?.instruments[0]?.pruned).toBe(false);
  });
});

describe('createLocalRegistryProvider — onOverridesChanged (ol-r5j4)', () => {
  it('fires with the freshly-saved overrides on rename, withdraw and restore, and never on load', async () => {
    const host = new FakeDataHost();
    const seen: unknown[] = [];
    const provider = createLocalRegistryProvider({
      vault: fixtureVault(),
      deviceId: DEVICE,
      settingsHost: host,
      now: () => NOW,
      editPort: new FakeEditPort(),
      onOverridesChanged: (overrides) => {
        seen.push(overrides);
      },
    });

    const before = await modelFrom(await provider.load());
    const entry = before.concepts[0];
    if (entry === undefined) throw new Error('missing entry');
    expect(seen).toHaveLength(0); // load() never fires it — only a write does

    await provider.rename(entry, 'Renamed concept');
    expect(seen).toHaveLength(1);

    await provider.withdrawConcept(entry);
    expect(seen).toHaveLength(2);

    await provider.restoreConcept(entry);
    expect(seen).toHaveLength(3);

    // Each call reflects that specific write, not a stale earlier snapshot.
    expect(seen[0]).toMatchObject({ renames: { [entry.key]: { displayName: 'Renamed concept' } } });
    expect(seen[1]).toMatchObject({ prunedConceptKeys: [entry.key] });
    expect(seen[2]).toMatchObject({ prunedConceptKeys: [] });
  });

  it('is optional — omitting it changes nothing about rename/withdraw/restore', async () => {
    const host = new FakeDataHost();
    const provider = makeProvider(fixtureVault(), host, new FakeEditPort());
    const before = await modelFrom(await provider.load());
    const entry = before.concepts[0];
    if (entry === undefined) throw new Error('missing entry');

    await expect(provider.rename(entry, 'Renamed concept')).resolves.toBeUndefined();
  });
});

describe('createLocalRegistryProvider — edit (F8.4: delegated to Obsidian)', () => {
  it('hands the instrument to the injected edit port, and does nothing else', async () => {
    const editPort = new FakeEditPort();
    const provider = makeProvider(fixtureVault(), new FakeDataHost(), editPort);
    const model = await modelFrom(await provider.load());
    const instrument = model.concepts[0]?.instruments[0];
    if (instrument === undefined) throw new Error('missing instrument');

    await provider.editInstrument(instrument);
    expect(editPort.opened).toEqual([instrument]);
  });
});

// Scenario: olea-service/features/F8-concepts-scope.md — "F8.4 / [D-171] —
// The registry carries source provenance", tagged `@auto:plugin/registry/provider.spec`.
describe('createLocalRegistryProvider — openSourceLocation ([D-171])', () => {
  it('calls the injected openSourceLocationPort with the given location', async () => {
    const opened: RegistrySourceLocation[] = [];
    const openSourceLocationPort: OpenSourceLocationPort = {
      open: async (location) => {
        opened.push(location);
      },
    };
    const provider = createLocalRegistryProvider({
      vault: fixtureVault(),
      deviceId: DEVICE,
      settingsHost: new FakeDataHost(),
      now: () => NOW,
      editPort: new FakeEditPort(),
      openSourceLocationPort,
    });

    const location: RegistrySourceLocation = { sourcePath: 'Notes/one.md' };
    await provider.openSourceLocation(location);
    expect(opened).toEqual([location]);
  });

  it('falls back to a logging no-op, never a throw, when no port is wired yet (main.ts follow-up pending)', async () => {
    const provider = makeProvider(fixtureVault(), new FakeDataHost(), new FakeEditPort());
    const location: RegistrySourceLocation = { sourcePath: 'Notes/one.md' };
    await expect(provider.openSourceLocation(location)).resolves.toBeUndefined();
  });
});

// Scenario: olea-service/features/F8-concepts-scope.md — "F8.4 — the
// registry's Sources list shows passage grain once a read has completed",
// tagged `@auto:plugin/registry/provider.spec`.
describe('createLocalRegistryProvider — conceptRecords thunk (ol-2zfj.49 closing step)', () => {
  it('overlays anchor/alsoIn from the folded ConceptRecord onto the matching concept, by key', async () => {
    const vault = fixtureVault();
    const plainProvider = makeProvider(vault, new FakeDataHost(), new FakeEditPort());
    const plain = await modelFrom(await plainProvider.load());
    const entry = plain.concepts[0];
    if (entry === undefined) throw new Error('missing entry');
    // Before any fold: note-grain-only, exactly what F8.4 shipped with.
    expect(entry.sourceLocations).toEqual([{ sourcePath: 'Notes/one.md' }]);

    const folded: readonly ConceptRecord[] = [
      {
        key: entry.key,
        name: entry.originalName,
        tier: 2,
        courses: entry.courses,
        sourcePaths: ['Notes/one.md'],
        anchor: {
          sourcePath: 'Notes/one.md',
          location: {
            page: 3,
            charRange: { start: 0, end: 10 },
            section: 'Invented section title',
          },
        },
      },
    ];

    const withFold = createLocalRegistryProvider({
      vault,
      deviceId: DEVICE,
      settingsHost: new FakeDataHost(),
      now: () => NOW,
      editPort: new FakeEditPort(),
      conceptRecords: () => folded,
    });
    const model = await modelFrom(await withFold.load());
    const row = model.concepts[0];
    expect(row?.key).toBe(entry.key);
    expect(row?.sourceLocations).toEqual([
      { sourcePath: 'Notes/one.md', page: 3, section: 'Invented section title' },
    ]);
  });

  it('is read fresh on every load() — a later thunk value reaches the next load, not just the first', async () => {
    const vault = fixtureVault();
    let folded: readonly ConceptRecord[] | null = null;
    const provider = createLocalRegistryProvider({
      vault,
      deviceId: DEVICE,
      settingsHost: new FakeDataHost(),
      now: () => NOW,
      editPort: new FakeEditPort(),
      conceptRecords: () => folded,
    });

    const before = await modelFrom(await provider.load());
    const entry = before.concepts[0];
    if (entry === undefined) throw new Error('missing entry');
    expect(entry.sourceLocations).toEqual([{ sourcePath: 'Notes/one.md' }]);

    folded = [
      {
        key: entry.key,
        name: entry.originalName,
        tier: 2,
        courses: entry.courses,
        sourcePaths: ['Notes/one.md'],
        anchor: {
          sourcePath: 'Notes/one.md',
          location: { page: 7, charRange: { start: 0, end: 10 } },
        },
      },
    ];

    const after = await modelFrom(await provider.load());
    expect(after.concepts[0]?.sourceLocations).toEqual([{ sourcePath: 'Notes/one.md', page: 7 }]);
  });

  it('falls back to the plain vault walk, unchanged, when the thunk returns null (no read has completed yet)', async () => {
    const vault = fixtureVault();
    const provider = createLocalRegistryProvider({
      vault,
      deviceId: DEVICE,
      settingsHost: new FakeDataHost(),
      now: () => NOW,
      editPort: new FakeEditPort(),
      conceptRecords: () => null,
    });
    const model = await modelFrom(await provider.load());
    expect(model.concepts[0]?.sourceLocations).toEqual([{ sourcePath: 'Notes/one.md' }]);
  });

  it('is optional — omitting it entirely changes nothing about load()', async () => {
    const provider = makeProvider(fixtureVault(), new FakeDataHost(), new FakeEditPort());
    const model = await modelFrom(await provider.load());
    expect(model.concepts[0]?.sourceLocations).toEqual([{ sourcePath: 'Notes/one.md' }]);
  });

  it('never drops a concept the walk just found but the (stale) fold does not know about yet', async () => {
    const vault = memoryVault({
      'Notes/one.md': [
        '---',
        'topic: [Concept A]',
        'course: TESTC101',
        '---',
        '',
        'Front text::Back text',
        '',
      ].join('\n'),
      'Notes/two.md': [
        '---',
        'topic: [Concept B]',
        'course: TESTC101',
        '---',
        '',
        'Front two::Back two',
        '',
      ].join('\n'),
    });
    const provider = createLocalRegistryProvider({
      vault,
      deviceId: DEVICE,
      settingsHost: new FakeDataHost(),
      now: () => NOW,
      editPort: new FakeEditPort(),
      // Stale fold: only knows about a key that matches nothing in this walk.
      conceptRecords: () => [
        {
          key: 'stale-key-not-in-this-walk',
          name: 'Some other concept',
          tier: 2,
          courses: [],
          sourcePaths: [],
        },
      ],
    });
    const model = await modelFrom(await provider.load());
    expect(model.concepts.map((c) => c.displayName).sort()).toEqual(['Concept A', 'Concept B']);
  });
});

// Scenario: olea-service/features/F8-concepts-scope.md — "F8.4b — The
// explain-back history surface", tagged `@auto:plugin/registry/provider.spec`.
describe('createLocalRegistryProvider — explain-back history wiring (F8.4b, [D-175])', () => {
  it('surfaces a graded explain-back attempt on the originating instrument, and marks it contested once a [D-095] dispute quarantines it', async () => {
    const vault = fixtureVault();
    const provider = makeProvider(vault, new FakeDataHost(), new FakeEditPort());
    const before = await modelFrom(await provider.load());
    const instrument = before.concepts[0]?.instruments[0];
    if (instrument === undefined) throw new Error('missing instrument');
    expect(instrument.explainBackHistory).toEqual([]);

    const { record } = await appendReviewLogRecord(
      vault,
      {
        timestamp: '2026-01-20T09:00:00-04:00',
        instrumentId: instrument.instrumentId,
        instrumentType: 'explain-back',
        conceptIds: [...instrument.conceptIds],
        rating: null,
        wasUnsure: false,
        durationMs: 4000,
        selectionContext: {
          dueState: 'due',
          examProximity: null,
          yieldRank: null,
          instrumentTypesOffered: ['explain-back'],
          planVersion: null,
        },
        explainBackGrade: {
          soloLevel: 'relational',
          contentRef: 'content-ref-1',
          revisionOf: null,
          artifactProvenance: { taskId: 'task-1', promptVersion: 'v1', modelId: 'model-1' },
        },
      },
      { deviceId: DEVICE, generateEventId: () => 'event-1' },
    );

    const afterGrade = await modelFrom(await provider.load());
    const historied = afterGrade.concepts[0]?.instruments[0];
    expect(historied?.explainBackHistory).toEqual([
      {
        eventId: 'event-1',
        timestamp: record.timestamp,
        soloLevel: 'relational',
        contested: false,
      },
    ]);

    // This provider is `session/history.ts`'s dispute-blind reader plus a
    // second dispute-only read over the same files — see `disputesFromFiles`'s
    // own doc. Proving that path here, not just at `buildRegistryModel`'s own
    // unit level, is exactly the wiring this suite's own module doc says is
    // its job (build.spec.ts already proves the fold itself).
    const dispute = contestClaim({
      claim: {
        rendering: 'explain-back-grade',
        conceptIds: instrument.conceptIds,
        instrumentId: instrument.instrumentId,
        evidenceBasis: 'evidence-fingerprint-1',
      },
      timestamp: '2026-01-21T09:00:00-04:00',
    });
    await appendDisputeRecord(vault, dispute.record, {
      deviceId: DEVICE,
      generateEventId: () => 'dispute-1',
    });

    const afterDispute = await modelFrom(await provider.load());
    const contested = afterDispute.concepts[0]?.instruments[0];
    expect(contested?.explainBackHistory).toEqual([
      {
        eventId: 'event-1',
        timestamp: record.timestamp,
        soloLevel: 'relational',
        contested: true,
      },
    ]);
  });
});

// Scenarios: olea-service/features/F8-concepts-scope.md, "Feature: F8.4a / `[D-257]`" —
// the identity-section wiring (`ol-egov.141.41` [TRIAGE-6]). `./same-as-identity.spec.ts`
// covers `buildSameAsIdentityProposals`'s own resolve/withhold rules in isolation; this suite
// proves `load()` actually calls it against a real vault walk's concepts, and that
// confirm/decline reach the real `olea-core` functions and are reflected on the next load.
function twoConceptFixtureVault() {
  return memoryVault({
    'Notes/one.md': [
      '---',
      'topic: [Concept One]',
      'course: TESTC101',
      '---',
      '',
      'A long enough introductory paragraph naming Concept One, for the excerpt to draw from.',
      '',
      'Front text one::Back text one',
      '',
    ].join('\n'),
    'Notes/two.md': [
      '---',
      'topic: [Concept Two]',
      'course: TESTC202',
      '---',
      '',
      'A separate introductory paragraph naming Concept Two, on its own note.',
      '',
      'Front text two::Back text two',
      '',
    ].join('\n'),
  });
}

describe('createLocalRegistryProvider — F8.4a concept-identity section ([D-257], TRIAGE-6)', () => {
  it('load() reports no identity proposals when no same-as link exists', async () => {
    const provider = makeProvider(fixtureVault(), new FakeDataHost(), new FakeEditPort());
    const state = await provider.load();
    if (state.kind !== 'model') throw new Error(`expected a model, got ${state.kind}`);
    expect(state.identityProposals).toEqual([]);
  });

  it('surfaces a resolvable proposed same-as link with both names, courses and passage excerpts', async () => {
    const vault = twoConceptFixtureVault();
    const provider = makeProvider(vault, new FakeDataHost(), new FakeEditPort());
    const before = await modelFrom(await provider.load());
    const [conceptOne, conceptTwo] = before.concepts;
    if (conceptOne === undefined || conceptTwo === undefined) throw new Error('missing concepts');

    await proposeSameAsLink(vault, conceptOne.key, conceptTwo.key, { now: () => '2026-09-18' });

    const state = await provider.load();
    if (state.kind !== 'model') throw new Error(`expected a model, got ${state.kind}`);
    expect(state.identityProposals).toHaveLength(1);
    const proposal = state.identityProposals[0];
    expect([proposal?.nameA, proposal?.nameB].sort()).toEqual(['Concept One', 'Concept Two']);
    expect([...(proposal?.coursesA ?? []), ...(proposal?.coursesB ?? [])].sort()).toEqual([
      'TESTC101',
      'TESTC202',
    ]);
    expect(proposal?.passageA.excerpt.length).toBeGreaterThan(0);
    expect(proposal?.passageB.excerpt.length).toBeGreaterThan(0);
  });

  it('confirmIdentityProposal reaches the real confirmSameAsLink, and the proposal stops appearing', async () => {
    const vault = twoConceptFixtureVault();
    const provider = makeProvider(vault, new FakeDataHost(), new FakeEditPort());
    const before = await modelFrom(await provider.load());
    const [conceptOne, conceptTwo] = before.concepts;
    if (conceptOne === undefined || conceptTwo === undefined) throw new Error('missing concepts');
    await proposeSameAsLink(vault, conceptOne.key, conceptTwo.key, { now: () => '2026-09-18' });

    const state = await provider.load();
    if (state.kind !== 'model') throw new Error(`expected a model, got ${state.kind}`);
    const proposal = state.identityProposals[0];
    if (proposal === undefined) throw new Error('missing proposal');

    await provider.confirmIdentityProposal(proposal);

    const link = (await listSameAsLinkRecords(vault))[0]?.record;
    if (link === undefined) throw new Error('missing same-as link record');
    expect(link.status).toBe('confirmed');
    const after = await provider.load();
    if (after.kind !== 'model') throw new Error(`expected a model, got ${after.kind}`);
    expect(after.identityProposals).toEqual([]);
  });

  it('declineIdentityProposal reaches the real declineSameAsLink, and the proposal stops appearing', async () => {
    const vault = twoConceptFixtureVault();
    const provider = makeProvider(vault, new FakeDataHost(), new FakeEditPort());
    const before = await modelFrom(await provider.load());
    const [conceptOne, conceptTwo] = before.concepts;
    if (conceptOne === undefined || conceptTwo === undefined) throw new Error('missing concepts');
    await proposeSameAsLink(vault, conceptOne.key, conceptTwo.key, { now: () => '2026-09-18' });

    const state = await provider.load();
    if (state.kind !== 'model') throw new Error(`expected a model, got ${state.kind}`);
    const proposal = state.identityProposals[0];
    if (proposal === undefined) throw new Error('missing proposal');

    await provider.declineIdentityProposal(proposal);

    const link = (await listSameAsLinkRecords(vault))[0]?.record;
    if (link === undefined) throw new Error('missing same-as link record');
    expect(link.status).toBe('declined');
    const after = await provider.load();
    if (after.kind !== 'model') throw new Error(`expected a model, got ${after.kind}`);
    expect(after.identityProposals).toEqual([]);
  });
});

// [D-110] (`ol-v7r5.55` [IL-D7]): `courseRankingsForNoteOffer` (this module's
// own doc names it the third production `composeOracleRanking` caller) fell
// back to the declared constants unconditionally, because nothing here read
// the delivered `rank-weights` artifact — unlike `plan/provider.ts` and
// `gap/provider.ts`, both already wired. Unlike those two, this call passes
// no `mastery` into `composeOracleRanking` (see the call site's own comment),
// so every concept's `masteryState` reads `'unknown'` here regardless of her
// real review history — a uniform `masteryNeedWeight` change can never
// reorder concepts relative to each other, and `RegistryConceptEntry` only
// ever surfaces the ranking through `noteOffer.eligible`'s rank-ORDER-derived
// "top band" gate (`../concept/note-offer.ts`), not a raw score. So this
// suite proves REACHABILITY — that `deps.readRankWeights` is read on every
// `load()` exactly when the note-offer gate's own ranking call runs, and
// never when it is skipped (no assignments Base configured) — rather than
// re-asserting `rankOracle`'s own arithmetic, which `gap/provider.spec.ts`,
// `session-builder/provider.spec.ts` and `oracle/rank.spec.ts` already cover
// end-to-end for the identical `options` spread this file now shares.
describe('createLocalRegistryProvider — threads the delivered rank weights ([D-110], ol-v7r5.55 [IL-D7])', () => {
  const ASSIGNMENTS_BASE_PATH = '02 Assignments/Assignments.base';
  const ASSIGNMENTS_BASE_FILE = [
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

  function hostWithAssignmentsBase(): FakeDataHost {
    const host = new FakeDataHost();
    host.blob = {
      [STUDY_PLAN_SETTINGS_STORAGE_KEY]: { version: 1, assignmentsBasePath: ASSIGNMENTS_BASE_PATH },
    };
    return host;
  }

  function configuredFixtureVault() {
    return memoryVault({
      'Notes/one.md': [
        '---',
        'topic: [Concept A]',
        'course: TESTC101',
        '---',
        '',
        'Front text::Back text',
        '',
      ].join('\n'),
      [ASSIGNMENTS_BASE_PATH]: ASSIGNMENTS_BASE_FILE,
    });
  }

  it('with the assignments Base configured, readRankWeights is read once per load() — the fallback is not silently taken', async () => {
    let calls = 0;
    const readRankWeights = async () => {
      calls += 1;
      return { proximityHalfLifeDays: 21 };
    };

    const provider = createLocalRegistryProvider({
      vault: configuredFixtureVault(),
      deviceId: DEVICE,
      settingsHost: hostWithAssignmentsBase(),
      now: () => NOW,
      editPort: new FakeEditPort(),
      readRankWeights,
    });

    await modelFrom(await provider.load());
    expect(calls).toBe(1);

    await modelFrom(await provider.load());
    expect(calls).toBe(2);
  });

  it('with readRankWeights omitted, load() still composes cleanly (declared-fallback posture unchanged)', async () => {
    const provider = createLocalRegistryProvider({
      vault: configuredFixtureVault(),
      deviceId: DEVICE,
      settingsHost: hostWithAssignmentsBase(),
      now: () => NOW,
      editPort: new FakeEditPort(),
    });

    const model = await modelFrom(await provider.load());
    expect(model.concepts).toHaveLength(1);
  });

  it('with no assignments Base configured, readRankWeights is never called — the note-offer ranking call never runs', async () => {
    let calls = 0;
    const readRankWeights = async () => {
      calls += 1;
      return { proximityHalfLifeDays: 21 };
    };

    const provider = createLocalRegistryProvider({
      vault: fixtureVault(),
      deviceId: DEVICE,
      settingsHost: new FakeDataHost(), // blob: null — unconfigured
      now: () => NOW,
      editPort: new FakeEditPort(),
      readRankWeights,
    });

    await modelFrom(await provider.load());
    expect(calls).toBe(0);
  });
});

/**
 * C5.6/`[D-264]` (`ol-egov.141.89.10.22`): before this bead,
 * `courseRankingsForNoteOffer` never accepted a `Scheduler`/`now` pair at
 * all, so `composeOracleRanking`'s `retrievability` input was never passed
 * for the note-offer ranking — unlike `plan/provider.ts` and
 * `gap/provider.ts` (once ol-egov.141.89.10.22 also fixes that one), which
 * already thread it. D-264 ruling 1 only counts an unaided (`'independent'`
 * support) success as eligible recall evidence, so the fixture below carries
 * one (`mastery/attainment.ts`'s `instrumentsWithIndependentSuccess`).
 *
 * `deps.scheduler` (added by this bead) is shared with `buildRegistryModel`'s
 * own vitality reading, which already calls `scheduler.retrievability` once
 * per reviewed recall-tier instrument regardless of D-264 eligibility or
 * whether the assignments Base is configured — see the `ol-owyn` suite
 * above. This suite isolates the NOTE-OFFER path's own call by comparing
 * total call counts between an otherwise-identical configured vs
 * unconfigured fixture: the delta is exactly `courseRankingsForNoteOffer`'s
 * own consultation, which is zero before this fix and one after it.
 */
describe('createLocalRegistryProvider — threads retrievability into the note-offer ranking (C5.6/[D-264], ol-egov.141.89.10.22)', () => {
  const ASSIGNMENTS_BASE_PATH = '02 Assignments/Assignments.base';
  const ASSIGNMENTS_BASE_FILE = [
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
  const NOTE = [
    '---',
    'topic: [Concept A]',
    'course: TESTC101',
    '---',
    '',
    'Front text::Back text',
    '',
  ].join('\n');
  // `courseRankingsForNoteOffer`'s `composeOracleRanking` call only ever
  // reaches a concept's `readAllConceptReadiness` fold when that concept has
  // real assessment EVIDENCE (`edges.edges` — the tier-3 citation join), not
  // merely a topic-bound note — a past paper citing the concept's own term,
  // matching `gap/provider.spec.ts`'s identical fixture shape, is what gives
  // it one.
  const PAST_PAPER = [
    '---',
    'role: past-paper',
    'course: TESTC101',
    '---',
    '',
    '# TESTC101 Past Paper — 2023',
    '',
    '## Question 1 (10 marks)',
    '',
    'Explain the core mechanism behind Concept A and why it matters.',
    '',
  ].join('\n');
  const QUIZ =
    '---\nclass: TESTC101\ntype: Quiz\nweight: 10\ndue: 2026-09-01\nstatus: upcoming\n---\n\n# Quiz 1\n';

  function hostWithAssignmentsBase(): FakeDataHost {
    const host = new FakeDataHost();
    host.blob = {
      [STUDY_PLAN_SETTINGS_STORAGE_KEY]: { version: 1, assignmentsBasePath: ASSIGNMENTS_BASE_PATH },
    };
    return host;
  }

  function fixtureVaultWithBase(configured: boolean) {
    return memoryVault({
      '05 Zettelkasten/Concept A.md': '# Concept A\n',
      'Notes/one.md': NOTE,
      '03 Research/TESTC101 Past Paper 2023.md': PAST_PAPER,
      ...(configured
        ? { [ASSIGNMENTS_BASE_PATH]: ASSIGNMENTS_BASE_FILE, '02 Assignments/Quiz 1.md': QUIZ }
        : {}),
    });
  }

  /** Counts every `retrievability` consultation while still answering for real, so both scenarios' vitality/mastery readings stay honest. */
  function trackingScheduler(): { readonly scheduler: Scheduler; readonly calls: () => number } {
    const real = createFsrsScheduler();
    let calls = 0;
    return {
      scheduler: {
        schedule: (input) => real.schedule(input),
        retrievability(input: RetrievabilityInput): RetrievabilityOutput {
          calls += 1;
          return real.retrievability(input);
        },
      },
      calls: () => calls,
    };
  }

  async function callCountFor(configured: boolean): Promise<number> {
    const vault = fixtureVaultWithBase(configured);
    const key = (
      await modelFrom(await makeProvider(vault, new FakeDataHost(), new FakeEditPort()).load())
    ).concepts[0]?.key;
    if (key === undefined) throw new Error('missing concept key');

    await appendReviewLogRecord(
      vault,
      {
        timestamp: '2026-01-01T09:00:00Z',
        instrumentId: 'qa:noteoffer-retrievability:1',
        instrumentType: 'qa',
        conceptIds: [key],
        rating: 'good',
        supportLevelShown: 'independent',
        wasUnsure: false,
        durationMs: 1200,
        selectionContext: {
          dueState: 'due',
          examProximity: null,
          yieldRank: null,
          instrumentTypesOffered: ['qa'],
          planVersion: null,
        },
      },
      { deviceId: DEVICE, generateEventId: () => 'noteoffer-retrievability-1' },
    );

    const tracker = trackingScheduler();
    const provider = createLocalRegistryProvider({
      vault,
      deviceId: DEVICE,
      settingsHost: configured ? hostWithAssignmentsBase() : new FakeDataHost(),
      now: () => new Date('2026-01-02T09:00:00Z'),
      editPort: new FakeEditPort(),
      scheduler: tracker.scheduler,
    });
    const model = await modelFrom(await provider.load());
    if (model.concepts.length === 0)
      throw new Error('expected the fixture concept to be enumerated');
    return tracker.calls();
  }

  it('REGRESSION (fails pre-fix): scheduler.retrievability is consulted one extra time when the note-offer ranking actually runs', async () => {
    const configuredCalls = await callCountFor(true);
    const unconfiguredCalls = await callCountFor(false);
    // Pre-fix, `courseRankingsForNoteOffer` never received or used a
    // `Scheduler`, so both counts equalled buildRegistryModel's own vitality
    // consultation only (`configuredCalls === unconfiguredCalls`) — this is
    // the failing assertion the lane rules ask to be shown red before the
    // fix: `expect(configuredCalls).toBe(unconfiguredCalls + 1)`.
    expect(configuredCalls).toBe(unconfiguredCalls + 1);
  });
});
