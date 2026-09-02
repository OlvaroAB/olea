/**
 * `createRetrospectiveOfferEventLog` (`[D-134]` Q5, `ol-0r92.16`) — the F8.8
 * scenario "offer, open and dismiss are ordinary events in the local event
 * log... no new storage" asserted headless, at the wiring layer this module
 * owns. `packages/core/src/review-log/write.spec.ts`'s `appendRetrospective
 * OfferRecord` suite covers the append/parse contract itself; this suite
 * covers the plugin-side reader/writer built on top of it.
 */

import { REVIEW_LOG_FOLDER } from 'olea-core';
import { describe, expect, it } from 'vitest';
import {
  createRetrospectiveOfferEventLog,
  recordOfferedEvents,
} from '../../src/retrospective/offer-events.js';
import { memoryVault } from '../review/memory-vault.js';

const DEVICE = 'olea-testdevice1';
const NOW = new Date('2026-09-01T09:00:00Z');
const ASSESSMENT_A = 'Courses/TESTC101/Final.md';
const ASSESSMENT_B = 'Courses/TESTC202/Midterm.md';

describe('createRetrospectiveOfferEventLog', () => {
  it('is empty against a vault with no history', async () => {
    const log = createRetrospectiveOfferEventLog({
      vault: memoryVault(),
      deviceId: DEVICE,
      now: () => NOW,
    });
    expect(await log.load()).toEqual([]);
  });

  it('round-trips an appended event through the review log, not a data.json blob', async () => {
    const vault = memoryVault();
    const log = createRetrospectiveOfferEventLog({ vault, deviceId: DEVICE, now: () => NOW });

    await log.append({
      kind: 'retrospective-offered',
      assessmentPath: ASSESSMENT_A,
      timestamp: NOW.toISOString(),
    });

    const events = await log.load();
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      kind: 'retrospective-offered',
      assessmentPath: ASSESSMENT_A,
    });

    // Every write landed under the review-log folder — no separate store, no
    // data.json key, exactly [D-134] Q5's "no new storage".
    for (const path of vault.writes) {
      expect(path.startsWith(`${REVIEW_LOG_FOLDER}/`)).toBe(true);
    }
  });

  it('keeps offer/open/dismiss events for different assessments distinct', async () => {
    const vault = memoryVault();
    const log = createRetrospectiveOfferEventLog({ vault, deviceId: DEVICE, now: () => NOW });

    await log.append({
      kind: 'retrospective-offered',
      assessmentPath: ASSESSMENT_A,
      timestamp: NOW.toISOString(),
    });
    await log.append({
      kind: 'retrospective-dismissed',
      assessmentPath: ASSESSMENT_B,
      timestamp: NOW.toISOString(),
    });

    const events = await log.load();
    expect(events.map((e) => e.assessmentPath).sort()).toEqual([ASSESSMENT_A, ASSESSMENT_B].sort());
  });

  it('never mistakes an ordinary review event for an offer event when both share a device log', async () => {
    // Same file family (C5.2): an ordinary review line sits in the same
    // daily file this log reads. Only retrospective-offer kinds should ever
    // come back from `load()`.
    const vault = memoryVault();
    const log = createRetrospectiveOfferEventLog({ vault, deviceId: DEVICE, now: () => NOW });
    const reviewLine = {
      schemaVersion: 5,
      kind: 'review',
      eventId: 'r1',
      timestamp: NOW.toISOString(),
      instrumentId: 'qa:x:1',
      instrumentType: 'qa',
      conceptIds: ['x'],
      rating: 'good',
      wasUnsure: false,
      durationMs: null,
      selectionContext: {
        dueState: 'due',
        examProximity: null,
        yieldRank: null,
        instrumentTypesOffered: ['qa'],
        planVersion: null,
      },
    };
    const day = NOW.toISOString().slice(0, 10);
    await vault.write(
      `${REVIEW_LOG_FOLDER}/${day}.${DEVICE}.jsonl`,
      `${JSON.stringify(reviewLine)}\n`,
    );

    await log.append({
      kind: 'retrospective-opened',
      assessmentPath: ASSESSMENT_A,
      timestamp: NOW.toISOString(),
    });

    const events = await log.load();
    expect(events).toHaveLength(1);
    expect(events[0]?.kind).toBe('retrospective-opened');
  });
});

describe('recordOfferedEvents (`ol-0r92.26`, D7.1 as amended by `[D-178]`)', () => {
  it('appends a retrospective-offered event for each assessment path handed to it', async () => {
    const vault = memoryVault();
    const log = createRetrospectiveOfferEventLog({ vault, deviceId: DEVICE, now: () => NOW });

    await recordOfferedEvents(log, [ASSESSMENT_A, ASSESSMENT_B], () => NOW);

    const events = await log.load();
    expect(
      events
        .filter((e) => e.kind === 'retrospective-offered')
        .map((e) => e.assessmentPath)
        .sort(),
    ).toEqual([ASSESSMENT_A, ASSESSMENT_B].sort());
  });

  it('writes nothing when handed no paths', async () => {
    const vault = memoryVault();
    const log = createRetrospectiveOfferEventLog({ vault, deviceId: DEVICE, now: () => NOW });

    await recordOfferedEvents(log, [], () => NOW);

    expect(await log.load()).toEqual([]);
  });
});
