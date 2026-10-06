import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { FolderSource } from '../vault/folder-source.js';
import type { VaultPath } from '../vault/types.js';
import type { OutcomePageState, OutcomeRevisionPages } from './retire-on-revision.js';
import {
  attachConceptToOutcome,
  isOutcomeRecord,
  listOutcomeRecords,
  outcomeRecordPath,
  type ResolveOutcomeInput,
  type ResolveOutcomeOptions,
  resolveOutcomes,
  retireOutcomesOnRevision,
} from './store.js';
import type { OutcomeRecord } from './types.js';

// Scenarios: olea-service/features/F4-oracle.md, F4.1 — "an outcome records the latest version that
// stated it" and the six after it, tagged `@auto:core/outcome/store.revision.ol-egov.141.89.7.68.spec`
// (ol-egov.141.89.7.68, [D-531], [D-272]). Synthetic values only.

const PATH = '03 Courses/SYNTH101/Objectives.pdf' as VaultPath;
const OTHER_PATH = '03 Courses/SYNTH101/Other.pdf' as VaultPath;
const PROVENANCE = { promptVersion: 'p1', modelVersion: 'm1' };
const NOW = () => '2026-10-06';

const ALPHA = 'Describe the synthetic alpha process in a closed system';
const BETA = 'Compare the two synthetic beta models of transport';
const GAMMA = 'Evaluate the synthetic gamma method against a baseline';
const DELTA = 'Construct a synthetic delta argument from given premises';

function input(label: string, path: VaultPath = PATH, blockIndex = 0): ResolveOutcomeInput {
  return { courses: ['SYNTH101'], source: { path, blockIndex }, label, provenance: PROVENANCE };
}

function open(digest: string): ResolveOutcomeOptions {
  return { now: NOW, revision: { digest, restates: true } };
}

function reread(digest: string): ResolveOutcomeOptions {
  return { now: NOW, revision: { digest, restates: false } };
}

const extracted = (page: number): OutcomePageState => ({
  page,
  reading: 'read',
  outcomesExtracted: true,
});

/** Version `digest` of the synthetic document, its two pages both extracted (or only those named). */
function readInFull(
  digest: string,
  known: readonly string[],
  history: readonly OutcomePageState[] = [extracted(1), extracted(2)],
): OutcomeRevisionPages {
  return {
    sourcePath: PATH,
    revisionDigest: digest,
    expectedPages: [1, 2],
    history,
    knownRevisions: known,
  };
}

async function recordById(vault: FolderSource, id: string): Promise<OutcomeRecord | undefined> {
  return (await listOutcomeRecords(vault)).find(({ record }) => record.id === id)?.record;
}

describe('retire on revision — the outcome store ([D-531])', () => {
  let root: string;
  let vault: FolderSource;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'olea-outcome-revision-'));
    vault = new FolderSource(root);
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it('an outcome records the latest version that stated it: stamped on mint, restamped by an open delivery of a later version', async () => {
    const [alpha, beta] = await resolveOutcomes(vault, [input(ALPHA), input(BETA)], open('rev-1'));
    expect(alpha?.statedInRevision).toBe('rev-1');
    expect(beta?.statedInRevision).toBe('rev-1');
    // A record minted with no revision carries no stamp, as before this rule.
    const [gamma] = await resolveOutcomes(vault, [input(GAMMA)], { now: NOW });
    expect(gamma !== undefined && 'statedInRevision' in gamma).toBe(false);

    const [alphaAgain, gammaAgain] = await resolveOutcomes(
      vault,
      [input(ALPHA), input(GAMMA)],
      open('rev-2'),
    );
    expect(alphaAgain?.id).toBe(alpha?.id);
    expect(alphaAgain?.statedInRevision).toBe('rev-2');
    expect(gammaAgain?.id).toBe(gamma?.id);
    expect(gammaAgain?.statedInRevision).toBe('rev-2');
    expect((await recordById(vault, alpha?.id ?? ''))?.statedInRevision).toBe('rev-2');
    // Beta was not stated by this delivery: its stamp is untouched.
    expect((await recordById(vault, beta?.id ?? ''))?.statedInRevision).toBe('rev-1');

    // A record already stamped with the delivery's version is not rewritten.
    const path = outcomeRecordPath(alpha?.id ?? '');
    const before = await vault.read(path);
    await resolveOutcomes(vault, [input(ALPHA)], open('rev-2'));
    expect(await vault.read(path)).toBe(before);
  });

  it('isOutcomeRecord accepts a record with no stamp and rejects an empty or non-string one', async () => {
    const [alpha] = await resolveOutcomes(vault, [input(ALPHA)], open('rev-1'));
    expect(isOutcomeRecord(alpha)).toBe(true);
    const { statedInRevision: _stamp, ...unstamped } = alpha as OutcomeRecord;
    expect(isOutcomeRecord(unstamped)).toBe(true);
    expect(isOutcomeRecord({ ...unstamped, statedInRevision: '' })).toBe(false);
    expect(isOutcomeRecord({ ...unstamped, statedInRevision: 7 })).toBe(false);
  });

  it('once a version is read in full, each outcome it did not state is retired: kept, unchanged otherwise, no reason stored', async () => {
    const [alpha, beta, gamma] = await resolveOutcomes(
      vault,
      [input(ALPHA), input(BETA), input(GAMMA)],
      open('rev-1'),
    );
    const [elsewhere] = await resolveOutcomes(vault, [input(BETA, OTHER_PATH)], open('rev-x'));
    const [unstamped] = await resolveOutcomes(vault, [input(DELTA, PATH, 5)], { now: NOW });

    // Version 2 states alpha and beta on page 1, and nothing else on page 2.
    await resolveOutcomes(vault, [input(ALPHA), input(BETA)], open('rev-2'));
    const gammaBefore = await recordById(vault, gamma?.id ?? '');

    const retired = await retireOutcomesOnRevision(vault, readInFull('rev-2', ['rev-1', 'rev-2']), {
      now: NOW,
    });
    expect(retired.map((record) => record.id)).toEqual([gamma?.id]);

    const listed = await listOutcomeRecords(vault);
    expect(listed).toHaveLength(5); // withdrawal, never deletion
    const gammaAfter = await recordById(vault, gamma?.id ?? '');
    expect(gammaAfter?.status).toBe('retired');
    // Every other field unchanged, and no reason field: revision is the only cause of retirement.
    expect({ ...gammaAfter, status: 'active' }).toEqual(gammaBefore);
    expect(Object.keys(gammaAfter ?? {}).sort()).toEqual(Object.keys(gammaBefore ?? {}).sort());

    expect((await recordById(vault, alpha?.id ?? ''))?.status).toBe('active');
    expect((await recordById(vault, beta?.id ?? ''))?.status).toBe('active');
    expect((await recordById(vault, elsewhere?.id ?? ''))?.status).toBe('active');
    expect((await recordById(vault, unstamped?.id ?? ''))?.status).toBe('active');
  });

  it('the retire pass refuses a version not yet read in full, and writes nothing', async () => {
    const [, gamma] = await resolveOutcomes(vault, [input(ALPHA), input(GAMMA)], open('rev-1'));
    await resolveOutcomes(vault, [input(ALPHA)], open('rev-2'));
    const path = outcomeRecordPath(gamma?.id ?? '');
    const before = await vault.read(path);

    const waiting = readInFull(
      'rev-2',
      ['rev-1', 'rev-2'],
      [extracted(1), { page: 2, reading: 'not-read', outcomesExtracted: false }],
    );
    expect(await retireOutcomesOnRevision(vault, waiting, { now: NOW })).toEqual([]);
    expect(await vault.read(path)).toBe(before);
  });

  it('a reread retires nothing: an outcome the reread happens not to state stays active', async () => {
    const [alpha, beta, gamma] = await resolveOutcomes(
      vault,
      [input(ALPHA), input(BETA), input(GAMMA)],
      open('rev-1'),
    );
    await resolveOutcomes(vault, [input(ALPHA), input(BETA)], open('rev-2'));
    const version2 = readInFull('rev-2', ['rev-1', 'rev-2']);
    await retireOutcomesOnRevision(vault, version2, { now: NOW });

    // Version 2 delivered again; this time the extraction states only alpha.
    await resolveOutcomes(vault, [input(ALPHA)], reread('rev-2'));
    const again = await retireOutcomesOnRevision(vault, version2, { now: NOW });
    expect(again).toEqual([]);
    expect((await recordById(vault, alpha?.id ?? ''))?.status).toBe('active');
    expect((await recordById(vault, beta?.id ?? ''))?.status).toBe('active');
    expect((await recordById(vault, gamma?.id ?? ''))?.status).toBe('retired');
  });

  it('a duplicate delivery never reinstates or restamps; only an unmatched wording mints, stamped', async () => {
    const [, gamma] = await resolveOutcomes(vault, [input(ALPHA), input(GAMMA)], open('rev-1'));
    await resolveOutcomes(vault, [input(ALPHA)], open('rev-2'));
    await retireOutcomesOnRevision(vault, readInFull('rev-2', ['rev-1', 'rev-2']), { now: NOW });
    const path = outcomeRecordPath(gamma?.id ?? '');
    const retiredBytes = await vault.read(path);

    const [gammaAgain, delta] = await resolveOutcomes(
      vault,
      [input(GAMMA), input(DELTA)],
      reread('rev-2'),
    );
    expect(gammaAgain?.id).toBe(gamma?.id);
    expect(gammaAgain?.status).toBe('retired');
    expect(await vault.read(path)).toBe(retiredBytes);
    expect(delta?.status).toBe('active');
    expect(delta?.statedInRevision).toBe('rev-2');
  });

  it('a later version that states a retired outcome again reinstates it: same record, stamped, links kept ([D-272])', async () => {
    const [, gamma] = await resolveOutcomes(vault, [input(ALPHA), input(GAMMA)], open('rev-1'));
    await attachConceptToOutcome(vault, gamma?.id ?? '', 'concept-key1:synthetic', { now: NOW });
    await resolveOutcomes(vault, [input(ALPHA)], open('rev-2'));
    await retireOutcomesOnRevision(vault, readInFull('rev-2', ['rev-1', 'rev-2']), { now: NOW });
    expect((await recordById(vault, gamma?.id ?? ''))?.status).toBe('retired');

    const [, gammaBack] = await resolveOutcomes(vault, [input(ALPHA), input(GAMMA)], open('rev-3'));
    expect(gammaBack?.id).toBe(gamma?.id);
    expect(gammaBack?.status).toBe('active');
    expect(gammaBack?.statedInRevision).toBe('rev-3');
    const stored = await recordById(vault, gamma?.id ?? '');
    expect(stored?.status).toBe('active');
    expect(stored?.statedInRevision).toBe('rev-3');
    expect(stored?.conceptKeys).toEqual(['concept-key1:synthetic']);
    expect((await listOutcomeRecords(vault)).length).toBe(2);

    // Version 3 read in full retires nothing it stated.
    const retired = await retireOutcomesOnRevision(
      vault,
      readInFull('rev-3', ['rev-1', 'rev-2', 'rev-3']),
      { now: NOW },
    );
    expect(retired).toEqual([]);
  });

  it('a reload mid-revision loses nothing: the rule reads only stored stamps and page states', async () => {
    const [alpha, beta, gamma] = await resolveOutcomes(
      vault,
      [input(ALPHA), input(BETA), input(GAMMA)],
      open('rev-1'),
    );
    // Session one: version 2's first delivery (page 1) lands, then the app reloads.
    await resolveOutcomes(vault, [input(ALPHA)], open('rev-2'));
    const pageOne = [extracted(1)];
    expect(
      await retireOutcomesOnRevision(vault, readInFull('rev-2', ['rev-1', 'rev-2'], pageOne), {
        now: NOW,
      }),
    ).toEqual([]);

    // Session two: a fresh vault handle, nothing carried in memory; page 2's delivery lands.
    const reopened = new FolderSource(root);
    await resolveOutcomes(reopened, [input(BETA)], open('rev-2'));
    const retired = await retireOutcomesOnRevision(
      reopened,
      readInFull('rev-2', ['rev-1', 'rev-2'], [...pageOne, extracted(2)]),
      { now: NOW },
    );
    expect(retired.map((record) => record.id)).toEqual([gamma?.id]);
    expect((await recordById(reopened, alpha?.id ?? ''))?.status).toBe('active');
    expect((await recordById(reopened, beta?.id ?? ''))?.status).toBe('active');
  });
});
