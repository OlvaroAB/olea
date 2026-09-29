/**
 * `[D-415]` (`ol-egov.141.89.10.94`, ruled 2026-09-28 on `ol-egov.141.89.10.87`): confirms, from
 * the privacy suite's own side, that a composition record (`../../../core/src/study-session/
 * composition-record.ts`, `[D-331]`/`[D-395]`) carries identifiers and decision facts only — never
 * copied source content or her own wording — and that F7.4's export and full delete both reach it.
 *
 * **Why a privacy-side duplicate of the schema check.** `composition-record.ts` already validates
 * its own shape (`parseCompositionRecord`'s `hasExactKeys`/enum checks) and is out of this bead's
 * owned paths (`owns: packages/plugin/src/privacy/,packages/plugin/test/privacy/`), so it cannot be
 * edited here. This file re-asserts the same field-by-field contract independently, from
 * `test/privacy/`: every string leaf of a real record is checked against its documented kind (an
 * opaque id, a fixed enum value, a timestamp/calendar day, or — the one deliberate exception,
 * `chosen[].rankedReason` — the ranking's own one-clause reason, F2.22/`[D-374]`). A future change
 * that let a new free-text field onto the record, or widened `rankedReason`'s exception to another
 * field, fails this suite even though it cannot edit the schema file itself.
 *
 * **Field inventory (schemaVersion 1), by kind:**
 * - opaque ids (never a display name, note title or path *as content* — `instrumentId` alone may
 *   read as a vault path + anchor per the module doc, since a note with no uid is identified that
 *   way): `compositionId`, `sessionId`, `parentCompositionId`, `course`, `steering.courses[]`,
 *   `steering.conceptIds[]`, `planVersion`, `policyVersions` (keys and values), `planAllocation[]
 *   .courseId`, `planAllocation[].contributions[].name`, `chosen[].instrumentId`,
 *   `chosen[].conceptKey`, `setAside.courses[].courseId`, `setAside.concepts[].conceptKey`,
 *   `setAside.instruments[].instrumentId`, `setAside.instruments[].conceptKey`.
 * - fixed enums: `kind`, `focusPolicy`, `branch`, `groupingSignal`, `chosen[].obligationClass`,
 *   `chosen[].formatMatch`, `chosen[].dedupeReason`, `setAside.courses[].reason`,
 *   `setAside.concepts[].reason`, `setAside.instruments[].reason`.
 * - timestamps/dates: `composedAt` (ISO-8601 with offset), `asOf` (calendar day).
 * - numbers: `schemaVersion`, `budgetMinutes`, `planAllocation[].share`,
 *   `planAllocation[].minBlockSeconds`, `planAllocation[].contributions[].value`,
 *   `declaredConstants.*`.
 * - booleans: `reentry`.
 * - the one free-text field, by design (module doc, F2.22/`[D-374]`): `chosen[].rankedReason`
 *   (verbatim, never regenerated) — a ranking service's own one-clause reasoning, not a copy of her
 *   vault content; it is `null` on every production caller today (`oracle.rank.v1` has none yet).
 *
 * No field carries card text, note titles, or her wording. INV-3: every id and string below is
 * coined for this test.
 */

import type { CalendarDay } from 'olea-core';
import { describe, expect, it } from 'vitest';
import {
  appendCompositionRecord,
  compositionLogPath,
} from '../../../core/src/study-session/composition-log.js';
import {
  type CompositionRecord,
  parseCompositionRecord,
  serializeCompositionRecord,
} from '../../../core/src/study-session/composition-record.js';
import { buildPrivacyExportBundle } from '../../src/privacy/export-bundle.js';
import { runFullDelete } from '../../src/privacy/full-delete.js';
import type { DeleteHttpRequestFn } from '../../src/privacy/types.js';
import { FakeDataHost, MemoryVaultSource } from './fakes.js';

const TODAY: CalendarDay = '2026-08-25';
const DEVICE_ID = 'device-1';
const COMPOSED_AT = '2026-08-25T09:00:00.000-04:00';

const BRANCH_KINDS = [
  'filter',
  'urgency',
  'urgency-unchecked',
  'deficit',
  'only-course',
  'none-behind',
  'none-behind-tie-recency',
  'none-behind-tie-name',
  'longest-without',
  'longest-without-tie-name',
];

const ENUMS = {
  kind: ['compose', 'extend'],
  focusPolicy: ['single', 'every-course'],
  // Every value a record's `branch` may carry (`FOCUS_BRANCH_TEMPLATE`'s keys): a fixed enum of
  // ids, never text. Each kind, without and with the never-practised suffix.
  branch: [...BRANCH_KINDS, ...BRANCH_KINDS.map((kind) => `${kind}+never-practised`)],
  groupingSignal: ['assessment-scope', 'arrival-cohort', 'relatedness', 'none'],
  obligationClass: ['unmet', 'recall-due', 'baseline-due', 'elective'],
  formatMatch: ['preferred-format', 'other-format', 'no-preference'],
  dedupeReason: ['format-match', 'recall-overdue'],
  setAsideCourseReason: ['another-course-chosen'],
  setAsideConceptReason: ['did-not-fit', 'no-instruments', 'yields-to-part'],
  setAsideInstrumentReason: ['cited-passage-changed'],
} as const;

const TIMESTAMP_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})$/;
const CALENDAR_DAY_RE = /^\d{4}-\d{2}-\d{2}$/;

/** A record naming every branch this test wants exercised: a fresh compose, one set-aside of each grain, a ranked reason on its one served item. */
function fixtureRecord(): CompositionRecord {
  return {
    schemaVersion: 1,
    kind: 'compose',
    compositionId: 'composition-key1:fixture-1',
    sessionId: 'composition-key1:fixture-1',
    parentCompositionId: null,
    composedAt: COMPOSED_AT,
    asOf: TODAY,
    reentry: false,
    focusPolicy: 'single',
    course: 'course-syn101',
    branch: 'urgency',
    groupingSignal: 'relatedness',
    steering: { courses: ['course-syn101'], conceptIds: null },
    budgetMinutes: 30,
    planVersion: 'plan-v7',
    policyVersions: { 'rank-weights': 'rw-v3' },
    planAllocation: [
      {
        courseId: 'course-syn101',
        share: 0.6,
        minBlockSeconds: 300,
        contributions: [{ name: 'risk', value: 0.4 }],
      },
    ],
    declaredConstants: {
      urgencyOverrideThreshold: 0.0714,
      withinBlockProximityHalfLifeDays: 3,
      materialArrivalCohortHalfLifeDays: 2,
    },
    chosen: [
      {
        // An instrument id built from a note path + anchor (module doc: the id itself may read as
        // a path for a note with no uid) — the one place a vault path legitimately appears, as an
        // identifier, never as card text.
        instrumentId: 'qa:01 Courses/SYN101/Lecture 1.md#^synthetic-anchor',
        conceptKey: 'key-synthetic-concept',
        obligationClass: 'unmet',
        formatMatch: 'preferred-format',
        dedupeReason: null,
        rankedReason: 'ranked ahead: overdue and scoped to the nearest assessment',
      },
    ],
    setAside: {
      courses: [{ courseId: 'course-other101', reason: 'another-course-chosen' }],
      concepts: [{ conceptKey: 'key-other-concept', reason: 'did-not-fit' }],
      instruments: [
        {
          instrumentId: 'qa:key-synthetic-concept:2',
          conceptKey: 'key-synthetic-concept',
          reason: 'cited-passage-changed',
        },
      ],
    },
  };
}

/** Every leaf this schema version defines, checked against its documented kind. `path` is dotted for a clear failure. */
function assertFieldKinds(record: CompositionRecord): void {
  expect(record.schemaVersion).toBe(1);
  expect(ENUMS.kind).toContain(record.kind);
  expect(typeof record.compositionId).toBe('string');
  expect(typeof record.sessionId).toBe('string');
  expect(
    record.parentCompositionId === null || typeof record.parentCompositionId === 'string',
  ).toBe(true);
  expect(record.composedAt).toMatch(TIMESTAMP_RE);
  expect(record.asOf).toMatch(CALENDAR_DAY_RE);
  expect(typeof record.reentry).toBe('boolean');
  expect(ENUMS.focusPolicy).toContain(record.focusPolicy);
  expect(record.course === null || typeof record.course === 'string').toBe(true);
  expect(record.branch === null || ENUMS.branch.includes(record.branch)).toBe(true);
  expect(ENUMS.groupingSignal).toContain(record.groupingSignal);
  for (const list of [record.steering.courses, record.steering.conceptIds]) {
    if (list === null) continue;
    for (const id of list) expect(typeof id).toBe('string');
  }
  expect(typeof record.budgetMinutes).toBe('number');
  expect(record.planVersion === null || typeof record.planVersion === 'string').toBe(true);
  for (const [kind, version] of Object.entries(record.policyVersions)) {
    expect(typeof kind).toBe('string');
    expect(typeof version).toBe('string');
  }
  for (const entry of record.planAllocation) {
    expect(typeof entry.courseId).toBe('string');
    expect(typeof entry.share).toBe('number');
    expect(typeof entry.minBlockSeconds).toBe('number');
    for (const c of entry.contributions) {
      expect(typeof c.name).toBe('string');
      expect(typeof c.value).toBe('number');
    }
  }
  expect(typeof record.declaredConstants.urgencyOverrideThreshold).toBe('number');
  expect(typeof record.declaredConstants.withinBlockProximityHalfLifeDays).toBe('number');
  expect(typeof record.declaredConstants.materialArrivalCohortHalfLifeDays).toBe('number');
  for (const item of record.chosen) {
    expect(typeof item.instrumentId).toBe('string');
    expect(item.conceptKey === null || typeof item.conceptKey === 'string').toBe(true);
    expect(
      item.obligationClass === null || ENUMS.obligationClass.includes(item.obligationClass),
    ).toBe(true);
    expect(ENUMS.formatMatch).toContain(item.formatMatch);
    expect(item.dedupeReason === null || ENUMS.dedupeReason.includes(item.dedupeReason)).toBe(true);
    // The one designated free-text field (module doc, F2.22/`[D-374]`): checked for TYPE only,
    // never for shape, because arbitrary short prose is exactly what it is documented to carry.
    expect(item.rankedReason === null || typeof item.rankedReason === 'string').toBe(true);
  }
  for (const c of record.setAside.courses) {
    expect(typeof c.courseId).toBe('string');
    expect(ENUMS.setAsideCourseReason).toContain(c.reason);
  }
  for (const c of record.setAside.concepts) {
    expect(typeof c.conceptKey).toBe('string');
    expect(ENUMS.setAsideConceptReason).toContain(c.reason);
  }
  for (const i of record.setAside.instruments) {
    expect(typeof i.instrumentId).toBe('string');
    expect(typeof i.conceptKey).toBe('string');
    expect(ENUMS.setAsideInstrumentReason).toContain(i.reason);
  }
}

/**
 * Walks every string leaf of the canonical JSON and asserts it carries no free prose EXCEPT the
 * one path the module doc names: `chosen[*].rankedReason`. Every other string must be a single
 * "word" by the record's own convention — an id, an enum value, a timestamp, or a vault
 * path+anchor id (`chosen[*].instrumentId` / `setAside.instruments[*].instrumentId`, which may
 * contain spaces because a note's own path can) — never a sentence of her wording pasted in under
 * a new key this test does not already know about.
 */
function assertNoUnexpectedProse(json: unknown, path: string, allowSpaces: boolean): void {
  if (typeof json === 'string') {
    const isRankedReason = /\.chosen\[\d+\]\.rankedReason$/.test(path);
    if (isRankedReason) return; // the one documented exception
    if (!allowSpaces) {
      expect(json.includes(' '), `${path} = ${JSON.stringify(json)}`).toBe(false);
    }
    return;
  }
  if (Array.isArray(json)) {
    // `allowSpaces` is irrelevant one level up from a string leaf; the object branch below
    // recomputes it per key (`instrumentId` alone allows spaces), so it is simply threaded through.
    json.forEach((item, index) => {
      assertNoUnexpectedProse(item, `${path}[${index}]`, allowSpaces);
    });
    return;
  }
  if (json !== null && typeof json === 'object') {
    for (const [key, value] of Object.entries(json)) {
      const isInstrumentId = key === 'instrumentId';
      assertNoUnexpectedProse(value, `${path}.${key}`, isInstrumentId);
    }
  }
}

describe('[D-415] composition record: identifiers and decision facts only', () => {
  it('a real record only ever carries the documented field kinds', () => {
    const record = fixtureRecord();
    expect(parseCompositionRecord(JSON.parse(JSON.stringify(record)))).not.toBeNull();
    assertFieldKinds(record);
  });

  it('no string field carries prose, except the one designated ranked-reason clause', () => {
    const line = serializeCompositionRecord(fixtureRecord());
    const parsed = JSON.parse(line.trimEnd());
    assertNoUnexpectedProse(parsed, '$', false);
  });

  it('the serialized record round-trips through the vault byte-identical (INV-2)', async () => {
    const record = fixtureRecord();
    const vault = new MemoryVaultSource();
    const { path } = await appendCompositionRecord(vault, record, DEVICE_ID);
    expect(path).toBe(compositionLogPath(TODAY, DEVICE_ID));
    expect(await vault.read(path)).toBe(serializeCompositionRecord(record));
  });

  it('F7.4 export carries the composition folder as the exact text on disk', async () => {
    const record = fixtureRecord();
    const vault = new MemoryVaultSource();
    const { path } = await appendCompositionRecord(vault, record, DEVICE_ID);

    const bundle = await buildPrivacyExportBundle({
      vault,
      deviceId: DEVICE_ID,
      today: TODAY,
      probeDays: 30,
      now: () => '2026-08-25T12:00:00.000Z',
    });

    const exported = bundle.oleaFiles.find((file) => file.path === path);
    expect(exported).toBeDefined();
    expect(exported?.content).toBe(await vault.read(path));
    expect(exported?.content).toBe(serializeCompositionRecord(record));
    // It travels as a record, never folded into either event log.
    expect(bundle.reviewLog).toEqual([]);
    expect(bundle.misconceptionLog).toEqual([]);
  });

  it('a full delete clears the composition folder', async () => {
    const record = fixtureRecord();
    const vault = new MemoryVaultSource();
    const { path } = await appendCompositionRecord(vault, record, DEVICE_ID);
    expect(await vault.exists(path)).toBe(true);

    const noServer: DeleteHttpRequestFn = async () => ({ status: 200 });
    const result = await runFullDelete({
      dataHost: new FakeDataHost(),
      vault,
      deviceId: DEVICE_ID,
      today: TODAY,
      probeDays: 30,
      workerConfig: { baseUrl: '', token: '' },
      httpRequest: noServer,
    });

    expect(await vault.exists(path)).toBe(false);
    expect(result.vaultArtifacts.deletedRecordPaths).toContain(path);
    expect(result.remainingOleaPaths).toEqual([]);
  });
});
