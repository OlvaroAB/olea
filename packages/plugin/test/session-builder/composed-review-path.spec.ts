/**
 * Bead: `ol-egov.141.6.16` — a plugin test composes a review session from
 * seeded instruments through the REAL production session path, not
 * `olea-core`'s builder called directly.
 *
 * ## Why this suite exists
 *
 * `findings/moment-b-zero-item-diagnosis.md` (service repo, `ol-egov.141.6.13`)
 * found that every frontier-loop replay to date composes through
 * `olea-core`'s `buildComposedStudySession` directly
 * (`scripts/harness/frontier-loop.mjs:4252`) and never through the plugin's
 * own session path — so no run has ever proven whether the plugin's own
 * assembly drops a real, eligible instrument. This suite is the cheapest
 * direct answer the diagnosis names (its "What a zero-spend diagnostic run
 * must seed" §3): a client test over a seeded population of non-suspended
 * instruments, composed through the production path, asserting nothing is
 * silently dropped — no calendar, no cassette, no spend.
 *
 * ## The production path this suite drives, hop by hop (file:line)
 *
 * The one live caller ("Olea: Start today's review" / the review tab
 * opening) is `main.ts`'s `composeReviewSession`:
 *
 *  1. `main.ts:3014` `composeReviewSession(opener)` calls
 *     `this.buildReviewSessionInput()` (`main.ts:2940`), which assembles
 *     `OpenReviewSessionInput` — including `composeDefaultStudySession: () =>
 *     this.composeDefaultStudySession()` (`main.ts:2770`) — and hands it to
 *     `opener.open(input)`.
 *  2. `main.ts:2770` `composeDefaultStudySession()` calls
 *     `composeStudySessionForRequest` (`session-builder/provider.ts:748`),
 *     the SAME assembly Home and the session builder view use — "one
 *     composer, two doors" (`main.ts:2770`'s own doc).
 *  3. The opener's `open()` (`open-session.ts`'s `createReviewSessionOpener`,
 *     C5.8's freeze) calls `openReviewSession` (`open-session.ts:355`),
 *     which:
 *     - calls `olea-core`'s `buildReviewSession` (`open-session.ts:378`) —
 *       KEPT only for its vault enumeration (`recordsById`, `candidates`,
 *       `suspended`), never for selection (module doc, "Three decisions
 *       this module makes, and one it refuses to");
 *     - reads the held sitting or calls `composeDefaultStudySession()`
 *       (from step 2) when idle (`open-session.ts:388-425`);
 *     - joins the composer's chosen `StudySessionItem`s against
 *       `composed.recordsById`/`composed.candidates` through
 *       `queueItemsFromComposedSession` (`open-session.ts:433`, defined
 *       `packages/core/src/session/build.ts:401`);
 *     - executes the join through `executeStudyPlanOverComposedRows`
 *       (`open-session.ts:438`, `packages/core/src/plan/execute.ts:366`);
 *     - adapts the executed rows into what the view renders through
 *       `adaptExecutedReviewQueue` (`open-session.ts:466`,
 *       `queue-adapter.ts:488`).
 *
 * This suite drives exactly that chain — `composeStudySessionForRequest`
 * into `openReviewSession` — the identical assembly
 * `open-session.spec.ts`'s own "F6.4 / C5.8 — the review tab reads the one
 * composed-session holder" block already proves reachable from a real,
 * in-memory vault (that file's own module doc: "these three exercise the
 * REAL `composeDefaultStudySession` port"). This file adds the
 * multi-course and suspended/withdrawn cases that suite does not cover.
 *
 * ## A finding case 1 forced a correction on: a session is exactly one course
 *
 * The first version of case 1 seeded one eligible, never-reviewed instrument
 * per course (two courses) and expected an ordinary, unsteered composition
 * to serve BOTH. It served only one (`TESTC101`'s), and a direct read of
 * `study-session/compose.ts` explains why, precisely: `[D-244]`/`[FOCUS-5]`
 * (David's ruling 2026-09-11) removed the old two-course `'focused'` policy
 * "not parked" — `'single'` is now the composer's default `FocusPolicy`,
 * and a session admits exactly one dominant course (chosen by filter,
 * urgency or window deficit), never a second, by ratified design (C5.6,
 * F2.18). `composeSessionRows`'s own `buildOverflow` confirms the other
 * course's row was not lost: it is `unmet`, classified, simply not chosen
 * as this session's course. **This is not the drop this bead was checking
 * for** — a real defect would mean an eligible instrument is unreachable by
 * ANY composition, not merely absent from one particular session alongside
 * another course's material. Case 1 below tests the honest version of the
 * acceptance criterion instead: every eligible, non-suspended instrument
 * seeded across two courses is fully served, on the real path, once its own
 * course is the one the composer is building for — by an unsteered call
 * (proving the default, single-course path serves its dominant course's
 * instrument completely) and again by the SAME steering
 * (`SessionBuilderRequest.courseOrTopic`) the session builder view and
 * `home/provider.ts` already expose to her (F4.6), one course at a time.
 * Confirmed empirically before writing the assertions below: steering to
 * `TESTC101` serves exactly `Notes/one.md`'s instrument, steering to
 * `TESTC202` serves exactly `Notes/two.md`'s — neither course's instrument
 * is ever unreachable.
 *
 * ## What "suspended" and "withdrawn" turn out to be, on this path
 *
 * Reading the two ports that write each state (both real production
 * callers) finds they write the IDENTICAL review-log record. F2.6's
 * suspend action (`review/ports.ts:305` `createVaultSuspendPort`) and
 * F8.5's registry withdrawal/prune action (`registry/ports.ts:69`
 * `createVaultPruneInstrumentPort`) are both thin wrappers over
 * `olea-core`'s `appendSuspendRecord` writing `kind: 'suspend'` — confirmed
 * by `registry/ports.ts`'s own module doc: "a prune here and an in-session
 * suspend (F2.6) are therefore the SAME state, viewed from two surfaces,
 * never two competing withdrawal mechanisms for one instrument." So case 2
 * below seeds two instruments, one suspended through the review port and
 * one "withdrawn" through the registry port, to name each path's real
 * caller — but both land the same `suspend` log entry, folded by the same
 * `suspendedInstrumentIds` (`packages/core/src/review-log/suspension.ts`).
 */

import {
  appendSuspendRecord,
  createFsrsScheduler,
  enumerateVaultInstruments,
  type VaultSource,
} from 'olea-core';
import { describe, expect, it } from 'vitest';
import type { ObsidianDataHost } from '../../src/plan/settings-store.js';
import { STUDY_PLAN_SETTINGS_STORAGE_KEY } from '../../src/plan/settings-store.js';
import {
  openReviewSession,
  type OpenReviewSessionInput,
  type ReviewSessionPorts,
} from '../../src/review/open-session.js';
import {
  type Clock,
  createVaultNoteExistsPort,
  createVaultReviewLogPort,
  createVaultSuspendPort,
  type EditPort,
  isoWithLocalOffset,
} from '../../src/review/ports.js';
import { createStudySessionHolder } from '../../src/session/holder.js';
import { DEFAULT_SESSION_BUDGET_MINUTES } from '../../src/session-builder/copy.js';
import { composeStudySessionForRequest } from '../../src/session-builder/provider.js';
import { memoryVault } from '../review/memory-vault.js';

const DEVICE = 'olea-testdevice1';
const NOW = new Date('2026-08-10T09:00:00-04:00');
const ASSIGNMENTS_BASE_PATH = '02 Assignments/Assignments.base';
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

/** `ol-egov.141.6.16`'s own `ObsidianDataHost` fake — the same shape `open-session.spec.ts`'s F6.4 block and `session-builder/provider.spec.ts`'s `FakeDataHost` already use. */
class FakeSettingsHost implements ObsidianDataHost {
  private blob: unknown = {
    [STUDY_PLAN_SETTINGS_STORAGE_KEY]: { version: 1, assignmentsBasePath: ASSIGNMENTS_BASE_PATH },
  };
  async loadData(): Promise<unknown> {
    return this.blob;
  }
  async saveData(data: unknown): Promise<void> {
    this.blob = data;
  }
}

/**
 * Two courses, one bound concept and one Q&A card each, plus each course's
 * own past paper citing its concept by name — `session-builder/
 * provider.spec.ts`'s own `twoCourseBaseFiles` pattern (that file's "two
 * concepts in TWO DIFFERENT courses" fixture), rebuilt here rather than
 * imported since that helper is not exported. Course codes and concept
 * names are invented (INV-3).
 */
function twoCourseVault(): VaultSource & ReturnType<typeof memoryVault> {
  return memoryVault({
    '05 Zettelkasten/Widget theory.md': '# Widget theory\n',
    '05 Zettelkasten/Gadget theory.md': '# Gadget theory\n',
    'Notes/one.md': [
      '---',
      'topic: [Widget theory]',
      'course: TESTC101',
      '---',
      '',
      'Front::Back',
      '',
    ].join('\n'),
    'Notes/two.md': [
      '---',
      'topic: [Gadget theory]',
      'course: TESTC202',
      '---',
      '',
      'Front2::Back2',
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
    '03 Research/TESTC202 Past Paper 2023.md': [
      '---',
      'role: past-paper',
      'course: TESTC202',
      '---',
      '',
      '# TESTC202 Past Paper — 2023',
      '',
      '## Question 1 (10 marks)',
      '',
      'Explain the core mechanism behind Gadget theory and why it matters.',
      '',
    ].join('\n'),
    [ASSIGNMENTS_BASE_PATH]: BASE_FILE,
    '02 Assignments/Quiz 1.md':
      '---\nclass: TESTC101\ntype: Quiz\nweight: 10\ndue: 2026-09-01\nstatus: upcoming\n---\n\n# Quiz 1\n',
    '02 Assignments/Quiz 2.md':
      '---\nclass: TESTC202\ntype: Quiz\nweight: 10\ndue: 2026-09-01\nstatus: upcoming\n---\n\n# Quiz 2\n',
  });
}

/**
 * Two concepts in the SAME course, both cited by the same past paper's two
 * questions — `session-builder/provider.spec.ts`'s own `twoConceptBaseFiles`
 * pattern (its F2.19 suite's "two never-reviewed, comparably-due concepts"
 * fixture, proven there to compose together, tied at `overdueDays: 0`).
 * Used for case 2 so both the suspended and the withdrawn instrument are
 * ones the real composer would otherwise select, not ones excluded from
 * candidacy for an unrelated reason (a fixture that never ranked either
 * concept could not tell "excluded because suspended" apart from "excluded
 * because it never would have been offered anyway").
 */
function twoConceptSameCourseVault(): VaultSource & ReturnType<typeof memoryVault> {
  return memoryVault({
    '05 Zettelkasten/Widget theory.md': '# Widget theory\n',
    '05 Zettelkasten/Gadget theory.md': '# Gadget theory\n',
    'Notes/one.md': [
      '---',
      'topic: [Widget theory]',
      'course: TESTC101',
      '---',
      '',
      'Front::Back',
      '',
    ].join('\n'),
    'Notes/two.md': [
      '---',
      'topic: [Gadget theory]',
      'course: TESTC101',
      '---',
      '',
      'Front2::Back2',
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
      '## Question 2 (10 marks)',
      '',
      'Explain the core mechanism behind Gadget theory and why it matters.',
      '',
    ].join('\n'),
    [ASSIGNMENTS_BASE_PATH]: BASE_FILE,
    '02 Assignments/Quiz 1.md':
      '---\nclass: TESTC101\ntype: Quiz\nweight: 10\ndue: 2026-09-01\nstatus: upcoming\n---\n\n# Quiz 1\n',
  });
}

/** The real, non-Obsidian ports `ReviewSessionPorts` needs — same minimal shape `open-session.spec.ts`'s own `ports()` helper builds. */
function reviewPorts(vault: ReturnType<typeof memoryVault>): ReviewSessionPorts {
  const editPort: EditPort = {
    async edit() {
      /* no fixture in this suite edits a note */
    },
  };
  return {
    reviewLog: createVaultReviewLogPort(vault, DEVICE),
    suspendPort: createVaultSuspendPort(vault, DEVICE),
    editPort,
    noteExists: createVaultNoteExistsPort(vault),
    clock: { now: () => NOW } satisfies Clock,
    draftAcceptPort: {
      accept() {
        throw new Error('composed-review-path.spec: no draft item in this suite should call accept');
      },
      reject() {
        throw new Error('composed-review-path.spec: no draft item in this suite should call reject');
      },
    },
  };
}

/**
 * The real port `main.ts`'s `composeDefaultStudySession` (`main.ts:2770`)
 * wraps — `open-session.spec.ts`'s F6.4 block's own
 * `realComposeDefaultStudySession` pattern. `courseOrTopic` is omitted by
 * every real `composeDefaultStudySession` call (`main.ts:2770` passes no
 * steering — F4.6's steering is the session builder view's own
 * `SessionBuilderRequest`, `session-builder/view.ts:95`, reaching this SAME
 * function through `provider.ts`'s `load()`); case 1 below passes it only to
 * drive the identical, real assembly through the session builder's own
 * production steering, one course at a time (see the module doc's "a
 * session is exactly one course" note).
 */
function realComposeDefaultStudySession(
  vault: ReturnType<typeof memoryVault>,
  courseOrTopic?: { readonly kind: 'course' | 'topic'; readonly label: string },
) {
  return async () => {
    const result = await composeStudySessionForRequest(
      {
        vault,
        deviceId: DEVICE,
        settingsHost: new FakeSettingsHost(),
        now: () => NOW,
        scheduler: createFsrsScheduler(),
      },
      {
        budgetMinutes: DEFAULT_SESSION_BUDGET_MINUTES,
        ...(courseOrTopic !== undefined ? { courseOrTopic } : {}),
      },
      NOW,
    );
    return result?.composed.full ?? null;
  };
}

/**
 * Drives the exact production chain named in this file's module doc:
 * `composeStudySessionForRequest` (step 2) into `openReviewSession` (step
 * 3) — the same two-call assembly `main.ts:2940`'s `buildReviewSessionInput`
 * and `main.ts:3014`'s `composeReviewSession` perform, minus only the
 * Obsidian workspace glue those methods add (which leaf, which tab —
 * `open-session.ts`'s own module doc: "nothing that can be wrong about
 * *what she is shown*").
 */
async function composeThroughProductionPath(
  vault: ReturnType<typeof memoryVault>,
  courseOrTopic?: { readonly kind: 'course' | 'topic'; readonly label: string },
) {
  const holder = createStudySessionHolder();
  const input: OpenReviewSessionInput = {
    vault,
    scheduler: createFsrsScheduler(),
    deviceId: DEVICE,
    ports: reviewPorts(vault),
    probeDays: 30,
    studySessionHolder: holder,
    composeDefaultStudySession: realComposeDefaultStudySession(vault, courseOrTopic),
  };
  return openReviewSession(input);
}

describe('case 1 (ol-egov.141.6.16 acceptance criterion 1) — non-suspended instruments across two courses reach the served session through the real plugin path', () => {
  it("an unsteered composition serves its (single, ratified) dominant course fully — that course's own eligible instrument is not dropped", async () => {
    const vault = twoCourseVault();
    const enumeration = await enumerateVaultInstruments(vault);
    expect(enumeration.records.length).toBe(2);

    // The real, unsteered production call ("Olea: Start today's review" —
    // `main.ts:2770`'s `composeDefaultStudySession`, no `courseOrTopic`).
    const outcome = await composeThroughProductionPath(vault);
    if (!outcome.ok) {
      throw new Error(`expected a composed session, got a failure: ${String(outcome.error)}`);
    }
    const servedIds = outcome.scheduledQueue.map((item) => item.instrument.instrumentId);

    // `[D-244]`/`[FOCUS-5]`: a session is exactly one course, so exactly one
    // of the two seeded instruments is served here — the module doc's
    // finding. What this asserts is that whichever course the composer
    // chose, THAT course's own eligible instrument reaches the rendered
    // queue whole (one item, not zero, not a partial record) — the
    // within-course completeness half of "none silently dropped."
    expect(servedIds.length).toBe(1);
    const servedRecord = enumeration.records.find((r) => r.instrumentId === servedIds[0]);
    expect(servedRecord).toBeDefined();
    expect(outcome.itemCount).toBe(1);
  });

  it("every eligible instrument, across BOTH courses, is reachable through the real path — steering to each course in turn serves that course's own instrument, none unreachable", async () => {
    const vault = twoCourseVault();
    const enumeration = await enumerateVaultInstruments(vault);
    const byCourse = new Map<string, string>();
    for (const record of enumeration.records) {
      const course = record.courses[0];
      if (course === undefined) throw new Error('expected every enumerated record to carry a course');
      byCourse.set(course, record.instrumentId);
    }
    expect(byCourse.size).toBe(2);

    for (const [course, instrumentId] of byCourse) {
      const outcome = await composeThroughProductionPath(vault, { kind: 'course', label: course });
      if (!outcome.ok) {
        throw new Error(`expected a composed session for ${course}, got: ${String(outcome.error)}`);
      }
      const servedIds = outcome.scheduledQueue.map((item) => item.instrument.instrumentId);

      // The cross-course half of "none silently dropped": TESTC202's
      // instrument is not a phantom that never reaches a served session
      // just because an unsteered call happened to prefer TESTC101 (or vice
      // versa) — steered to its own course, each instrument is served, in
      // full, through the identical production chain (`composeStudySessionForRequest`
      // into `openReviewSession`) case 1's first test already drove.
      expect(servedIds).toContain(instrumentId);
      expect(servedIds.length).toBe(1);
    }
  });
});

describe('case 2 (ol-egov.141.6.16 acceptance criterion 2) — a suspended and a withdrawn instrument, through the real plugin path', () => {
  it('records what the path does with a suspended instrument and a withdrawn instrument (over-inclusion defect ol-egov.141.89.10.13, not fixed here)', async () => {
    const vault = twoConceptSameCourseVault();
    const enumeration = await enumerateVaultInstruments(vault);
    expect(enumeration.records.length).toBe(2);

    const widget = enumeration.records.find((r) => r.notePath === 'Notes/one.md');
    const gadget = enumeration.records.find((r) => r.notePath === 'Notes/two.md');
    if (widget === undefined || gadget === undefined) {
      throw new Error('expected both Widget theory and Gadget theory instruments enumerated');
    }

    // Widget theory: suspended through the real F2.6 production port
    // (`review/ports.ts:305` `createVaultSuspendPort`, the same one
    // `ReviewSession.suspend()` calls).
    await createVaultSuspendPort(vault, DEVICE).suspend(widget.instrumentId, widget.conceptIds);

    // Gadget theory: "withdrawn" through F8.5's registry prune affordance.
    // `registry/ports.ts:60-76`'s `createVaultPruneInstrumentPort` is a
    // direct, no-extra-logic wrapper over this exact `appendSuspendRecord`
    // call (confirmed by that file's own module doc, quoted in this file's
    // module doc above) — called here rather than through
    // `PruneInstrumentPort` itself only because that port's input type
    // (`RegistryInstrumentSummary`) carries several fields this suite has
    // no use for (`sourceLocations`, `explainBackHistory`, …); the write it
    // performs is identical.
    await appendSuspendRecord(
      vault,
      {
        kind: 'suspend',
        timestamp: isoWithLocalOffset(NOW),
        instrumentId: gadget.instrumentId,
        conceptIds: [...gadget.conceptIds],
      },
      { deviceId: DEVICE },
    );

    const outcome = await composeThroughProductionPath(vault);
    if (!outcome.ok) {
      throw new Error(`expected a composed session, got a failure: ${String(outcome.error)}`);
    }
    const servedIds = outcome.scheduledQueue.map((item) => item.instrument.instrumentId);

    // Observed, current behaviour: both the suspended and the withdrawn
    // instrument DO reach the served queue. This is not asserted as
    // correct — it is `ol-egov.141.89.10.13`'s own confirmed finding, read
    // again here through the plugin's real path. `ol-4mse` (the Today
    // panel's mastery fold, `packages/core/src/today/panel.ts` ~line 272)
    // is a separate call site this suite's composed-review-tab path never
    // reaches, so it is not exercised or re-confirmed here.
    expect(servedIds).toContain(widget.instrumentId);
    expect(servedIds).toContain(gadget.instrumentId);

    // What SHOULD hold, and does NOT yet on this real path — a suspended or
    // withdrawn instrument excluded from the served queue. Pinned as an
    // EXPECTED failure (`it.fails`) below, not a passing assertion of the
    // over-inclusion, so this file never locks the bug in as correct.
    //
    // `ol-egov.141.89.10.13` landed `session/build.ts`'s own fix (its
    // `candidates` field, built at `session/build.ts:277-285`, now excludes
    // `suspended`/withdrawn) and a core unit test proving it. Verified here,
    // empirically, that this alone does NOT flip the two `it.fails` below:
    // `composeThroughProductionPath` selects instruments through
    // `composeStudySessionForRequest` (`session-builder/provider.ts:770`,
    // `enumerateVaultInstruments` called directly) into
    // `study-session/compose.ts`'s `buildComposedStudySession` — a path that
    // never calls `session/build.ts`'s `buildReviewSession` and never reads
    // `.suspended` at all (`buildConceptInstrumentIndex(enumeration.records)`,
    // `session-builder/provider.ts:827`/`:911`, takes the raw, unfiltered
    // enumeration). `open-session.ts`'s own `buildReviewSession` call
    // (`:378`) is a SECOND, independent enumeration, used only to fill in
    // `state`/`conceptIds` on the already-selected rows
    // (`queueItemsFromComposedSession`, which never drops a row) — so
    // `session/build.ts`'s fix protects a caller that composes directly over
    // `candidates` (the workbench/simulator, `composeQueue`'s legacy
    // callers), but not this, the real "Olea: Start today's review" path.
    // Remains `it.fails` until a follow-up bead wires suspension into
    // `session-builder/provider.ts`/`study-session/compose.ts` themselves
    // (outside `ol-egov.141.89.10.13`'s `owns`) — see this bead's report.
  });

  it.fails(
    'expected (not yet true): a suspended instrument is excluded from the served queue (ol-egov.141.89.10.13)',
    async () => {
      const vault = twoConceptSameCourseVault();
      const enumeration = await enumerateVaultInstruments(vault);
      const widget = enumeration.records.find((r) => r.notePath === 'Notes/one.md');
      if (widget === undefined) throw new Error('expected the Widget theory instrument enumerated');

      await createVaultSuspendPort(vault, DEVICE).suspend(widget.instrumentId, widget.conceptIds);

      const outcome = await composeThroughProductionPath(vault);
      if (!outcome.ok) throw new Error(`expected a composed session, got: ${String(outcome.error)}`);
      const servedIds = outcome.scheduledQueue.map((item) => item.instrument.instrumentId);

      expect(servedIds).not.toContain(widget.instrumentId);
    },
  );

  it.fails(
    'expected (not yet true): a withdrawn instrument is excluded from the served queue (ol-egov.141.89.10.13)',
    async () => {
      const vault = twoConceptSameCourseVault();
      const enumeration = await enumerateVaultInstruments(vault);
      const gadget = enumeration.records.find((r) => r.notePath === 'Notes/two.md');
      if (gadget === undefined) throw new Error('expected the Gadget theory instrument enumerated');

      await appendSuspendRecord(
        vault,
        {
          kind: 'suspend',
          timestamp: isoWithLocalOffset(NOW),
          instrumentId: gadget.instrumentId,
          conceptIds: [...gadget.conceptIds],
        },
        { deviceId: DEVICE },
      );

      const outcome = await composeThroughProductionPath(vault);
      if (!outcome.ok) throw new Error(`expected a composed session, got: ${String(outcome.error)}`);
      const servedIds = outcome.scheduledQueue.map((item) => item.instrument.instrumentId);

      expect(servedIds).not.toContain(gadget.instrumentId);
    },
  );
});
