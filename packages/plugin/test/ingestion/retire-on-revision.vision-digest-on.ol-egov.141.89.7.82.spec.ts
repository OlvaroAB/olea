/**
 * `[D-531]` with the image-page revision digest switched on (`ol-egov.141.89.7.82`; sheet v59,
 * "Image-page revision digest", Accept): `ingestion/wiring.ts` buildVisionRunner composes the vision
 * page runner with `deliverRevisionDigest` on, so a page read from its image is delivered with the
 * digest of the bytes it read and a document with an image-read page can be read in full.
 *
 * Composed as main.ts composes it (`./vision-digest-on-harness.ol-egov.141.89.7.82.ts`): the real
 * extraction and vision runners, the outcomes trigger with the durable page record as its
 * `revisions`, and that store as the vision runner's manifest sink. The ruling's safety rule for
 * outcomes is pinned here: a stale delivery never restores a retired outcome. Written to
 * olea-service `features/F4-oracle.md`, F4.1. Synthetic text only (INV-3).
 */
import { hashContent } from 'olea-core';
import { describe, expect, it, vi } from 'vitest';
import {
  outcomeRevisionReadInFull,
  planOutcomeDelivery,
} from '../../../core/src/outcome/retire-on-revision.js';
import {
  compose,
  DOC,
  marks,
  outcomesByLabel,
  pagesOf,
  pdfBytes,
} from './vision-digest-on-harness.ol-egov.141.89.7.82.js';

const ALPHA = 'Describe the synthetic alpha process in a closed system';
const BETA = 'Compare the two synthetic beta models of transport';
const GAMMA = 'Explain the synthetic gamma cycle in a shallow basin';
const DELTA = 'Outline the synthetic delta sequence of deposition';
const NOVEL = 'Justify the synthetic epsilon estimate from field data';

/** Page 1 is read from its text layer; page 2 has none, so it is read from its image. */
const V1 = pdfBytes([`${ALPHA}. ${DELTA}`, '']);
const V2 = pdfBytes([`${ALPHA}`, '']);

describe('with the digest on, a document with an image-read page is read in full ([D-531])', () => {
  it('its stale outcomes retire once the image page of the revision is extracted, and only then', async () => {
    const d1 = await hashContent(V1);
    const d2 = await hashContent(V2);
    const run = await compose(V1, { registered: true });
    run.readings.set(d1, `${BETA}. ${GAMMA}`);
    run.readings.set(d2, BETA);

    await run.deliver('doc-v1');
    expect(run.landings.map(pagesOf)).toEqual([[1], [2]]);
    // The image page's delivery carries the digest of the bytes it was read from.
    expect(run.landings.map((landing) => landing.revisions?.get(DOC))).toEqual([d1, d1]);
    let records = await outcomesByLabel(run);
    expect([...records.keys()].sort()).toEqual([ALPHA, BETA, DELTA, GAMMA].sort());
    for (const record of records.values()) {
      expect(record).toMatchObject({ status: 'active', statedInRevision: d1 });
    }
    expect(marks(run)).toEqual([
      { digest: d1, page: 1 },
      { digest: d1, page: 2 },
    ]);
    const first = await run.manifests.outcomeRevisionPagesFor(DOC);
    expect(first === undefined ? false : outcomeRevisionReadInFull(first)).toBe(true);

    // She replaces the file with a revision that drops delta (text page) and gamma (image page).
    run.vault.put(DOC, V2);
    await run.enqueueSource('doc-v2');
    // The text page alone: not read in full, so nothing is retired yet.
    expect(await run.engine.tick()).toMatchObject({ kind: 'ran', outcome: 'done' });
    await run.manifests.idle();
    const partway = await run.manifests.outcomeRevisionPagesFor(DOC);
    expect(partway?.revisionDigest).toBe(d2);
    expect(partway === undefined ? true : outcomeRevisionReadInFull(partway)).toBe(false);
    records = await outcomesByLabel(run);
    expect(records.get(DELTA)?.status).toBe('active');
    expect(records.get(GAMMA)?.status).toBe('active');

    // The image page's reading lands, carrying d2: the revision is read in full.
    await run.drain();
    expect(run.landings.slice(2).map((landing) => landing.revisions?.get(DOC))).toEqual([d2, d2]);
    records = await outcomesByLabel(run);
    expect(records.size).toBe(4);
    expect(records.get(ALPHA)).toMatchObject({ status: 'active', statedInRevision: d2 });
    expect(records.get(BETA)).toMatchObject({ status: 'active', statedInRevision: d2 });
    expect(records.get(DELTA)).toMatchObject({ status: 'retired', statedInRevision: d1 });
    expect(records.get(GAMMA)).toMatchObject({ status: 'retired', statedInRevision: d1 });
    const current = await run.manifests.outcomeRevisionPagesFor(DOC);
    expect(current?.knownRevisions).toEqual([d1, d2].sort());
    expect(current === undefined ? false : outcomeRevisionReadInFull(current)).toBe(true);
  });
});

describe('a stale image delivery restores nothing (sheet v59: stale deliveries must not restore retired outcomes)', () => {
  it('a reading of the older version landing after the newer one was read in full never reinstates, restamps or reopens', async () => {
    const d1 = await hashContent(V1);
    const d2 = await hashContent(V2);
    const run = await compose(V1, { registered: true });
    // The older version's image page states the outcome the newer version drops, one the newer
    // version states, and a wording no record holds.
    run.readings.set(d1, `${DELTA}. ${BETA}. ${NOVEL}`);
    run.readings.set(d2, BETA);

    // Version 1: its text page lands; its image page's reading is under way.
    await run.enqueueSource('doc-v1');
    expect(await run.engine.tick()).toMatchObject({ kind: 'ran', outcome: 'done' });
    const hold = run.holdNextVision();
    const staleTick = run.engine.tick();
    await hold.entered;

    // The file changes while that reading is in flight, and version 2 is read in full.
    run.vault.put(DOC, V2);
    await run.deliver('doc-v2');
    let records = await outcomesByLabel(run);
    expect(records.get(DELTA)).toMatchObject({ status: 'retired', statedInRevision: d1 });
    expect(records.get(ALPHA)).toMatchObject({ status: 'active', statedInRevision: d2 });
    expect(records.get(BETA)).toMatchObject({ status: 'active', statedInRevision: d2 });
    const completed = await run.manifests.outcomeRevisionPagesFor(DOC);
    expect(completed === undefined ? false : outcomeRevisionReadInFull(completed)).toBe(true);
    const marksBefore = marks(run);
    const callsBefore = run.outcomesCalls;

    // The older reading lands now, with the digest of the bytes it read.
    const info = vi.spyOn(console, 'info').mockImplementation(() => {});
    try {
      hold.release();
      expect(await staleTick).toMatchObject({ kind: 'ran', outcome: 'done' });
      await run.manifests.idle();
    } finally {
      info.mockRestore();
    }
    const stale = run.landings.at(-1);
    expect(pagesOf(stale)).toEqual([2]);
    expect(stale?.revisions?.get(DOC)).toBe(d1);
    // It still made its one outcomes call (the strict late-delivery optimisation is deferred).
    expect(run.outcomesCalls).toBe(callsBefore + 1);

    records = await outcomesByLabel(run);
    // Nothing reinstated, nothing restamped, nothing new.
    expect(records.get(DELTA)).toMatchObject({ status: 'retired', statedInRevision: d1 });
    expect(records.get(BETA)).toMatchObject({ status: 'active', statedInRevision: d2 });
    expect(records.get(ALPHA)).toMatchObject({ status: 'active', statedInRevision: d2 });
    expect(records.has(NOVEL)).toBe(false);
    expect(records.size).toBe(3);
    // No page marked for either version.
    expect(marks(run)).toEqual(marksBefore);
    // The newer version stays read in full: its next delivery is a reread, which restates nothing.
    const after = await run.manifests.outcomeRevisionPagesFor(DOC);
    expect(after?.revisionDigest).toBe(d2);
    expect(after === undefined ? false : outcomeRevisionReadInFull(after)).toBe(true);
    expect(planOutcomeDelivery(after, d2).standing).toBe('reread');
    expect(planOutcomeDelivery(after, d1).standing).toBe('late');
  });
});
