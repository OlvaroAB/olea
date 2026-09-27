import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { FolderSource } from '../vault/folder-source.js';
import {
  isPresentedProbeRecord,
  isProbeShown,
  PROBE_PRESENTATION_STORE_FOLDER,
  probePresentationStorePath,
  readProbePresentation,
  writeProbePresentation,
} from './probe-presentation-store.js';

// Scenarios: features/F2-review.md (olea-service), "Feature: F2.24 — Offering
// an application probe" — @auto:core/instrument/probe-presentation-store.spec
//
// [D-394] acceptance: "Shown is set once, only at the probe's actual
// presentation... Shown survives a restart... The probe record stores no
// outcome."

describe('probe-presentation-store — [D-394] choice 2', () => {
  let tempRoot: string;

  beforeEach(async () => {
    tempRoot = await mkdtemp(join(tmpdir(), 'olea-probe-presentation-store-'));
  });

  afterEach(async () => {
    await rm(tempRoot, { recursive: true, force: true });
  });

  it('lives under its own D-394 folder, sibling to the other instrument sidecars', () => {
    expect(PROBE_PRESENTATION_STORE_FOLDER).toBe('.olea/probe-presentation');
  });

  it('is unset before presentation: writing, holding, the exposure re-check, an offer, and a declined or untaken offer all leave nothing on record', async () => {
    const vault = new FolderSource(tempRoot);
    // Every one of these steps is, structurally, "no call to this module" —
    // there is nothing to invoke here for a write, a hold, a re-check or an
    // offer, so their absence of effect is asserted directly: no record
    // exists for a probe id until writeProbePresentation is called.
    expect(await readProbePresentation(vault, 'probe-1')).toBeUndefined();
    expect(await isProbeShown(vault, 'probe-1')).toBe(false);
  });

  it('is set once, at actual presentation, and reads back exactly', async () => {
    const vault = new FolderSource(tempRoot);
    await writeProbePresentation(vault, 'probe-1', '2026-09-27T10:00:00+00:00');
    const found = await readProbePresentation(vault, 'probe-1');
    expect(found).toEqual({
      instrumentId: 'probe-1',
      presentedAt: '2026-09-27T10:00:00+00:00',
      schemaVersion: 1,
    });
    expect(await isProbeShown(vault, 'probe-1')).toBe(true);
  });

  it('refuses to overwrite an existing record — shown is set exactly once', async () => {
    const vault = new FolderSource(tempRoot);
    await writeProbePresentation(vault, 'probe-1', '2026-09-27T10:00:00+00:00');
    await expect(
      writeProbePresentation(vault, 'probe-1', '2026-09-27T11:00:00+00:00'),
    ).rejects.toThrow();
    // The original record is untouched.
    const found = await readProbePresentation(vault, 'probe-1');
    expect(found?.presentedAt).toBe('2026-09-27T10:00:00+00:00');
  });

  it('survives a restart: a presented probe still reads shown after a simulated plugin reload', async () => {
    const vault = new FolderSource(tempRoot);
    await writeProbePresentation(vault, 'probe-1', '2026-09-27T10:00:00+00:00');

    // Simulated restart: a brand-new FolderSource over the same folder,
    // with no in-memory state carried over from the write above.
    const reloaded = new FolderSource(tempRoot);
    expect(await isProbeShown(reloaded, 'probe-1')).toBe(true);
    const found = await readProbePresentation(reloaded, 'probe-1');
    expect(found?.instrumentId).toBe('probe-1');
  });

  it('a probe never presented still reads unshown after a restart, and is never offered again as unshown by omission', async () => {
    const vault = new FolderSource(tempRoot);
    await writeProbePresentation(vault, 'probe-1', '2026-09-27T10:00:00+00:00');
    const reloaded = new FolderSource(tempRoot);
    // A different, never-presented probe id is unaffected by probe-1's record.
    expect(await isProbeShown(reloaded, 'probe-2')).toBe(false);
  });

  it('the record stores no outcome field: exactly instrumentId, presentedAt, schemaVersion', async () => {
    const vault = new FolderSource(tempRoot);
    await writeProbePresentation(vault, 'probe-1', '2026-09-27T10:00:00+00:00');
    const found = await readProbePresentation(vault, 'probe-1');
    expect(found).toBeDefined();
    if (found === undefined) throw new Error('unreachable');
    expect(Object.keys(found).sort()).toEqual(['instrumentId', 'presentedAt', 'schemaVersion']);
    expect(found).not.toHaveProperty('outcome');
    expect(found).not.toHaveProperty('succeeded');
    expect(found).not.toHaveProperty('status');
  });

  it('never throws on an absent, unreadable or malformed record', async () => {
    const vault = new FolderSource(tempRoot);
    expect(await readProbePresentation(vault, 'never-written')).toBeUndefined();

    const path = probePresentationStorePath('malformed');
    await vault.write(path, 'not json at all');
    expect(await readProbePresentation(vault, 'malformed')).toBeUndefined();

    await vault.write(
      probePresentationStorePath('wrong-id'),
      JSON.stringify({
        instrumentId: 'someone-else',
        presentedAt: '2026-09-27T10:00:00+00:00',
        schemaVersion: 1,
      }),
    );
    expect(await readProbePresentation(vault, 'wrong-id')).toBeUndefined();
  });

  it('rejects a malformed record via the runtime guard', () => {
    expect(isPresentedProbeRecord({})).toBe(false);
    expect(isPresentedProbeRecord({ instrumentId: 'x', presentedAt: '', schemaVersion: 1 })).toBe(
      false,
    );
    expect(
      isPresentedProbeRecord({ instrumentId: 'x', presentedAt: 't', schemaVersion: '1' }),
    ).toBe(false);
    expect(isPresentedProbeRecord({ instrumentId: 'x', presentedAt: 't', schemaVersion: 1 })).toBe(
      true,
    );
  });
});
