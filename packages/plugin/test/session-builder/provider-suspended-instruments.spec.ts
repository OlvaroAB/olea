/**
 * `ol-egov.141.89.10.30` — a provider-level unit test, narrower than
 * `composed-review-path.spec.ts`'s full production-path proof: this checks,
 * directly against `composeStudySessionForRequest`'s own `composedInput`,
 * that a currently-suspended (or withdrawn — the identical `kind: 'suspend'`
 * log entry, see `review-log/suspension.ts`'s own doc) instrument never
 * reaches the `ConceptInstrumentIndex` this file's `composeStudySessionForRequest`
 * builds — the exact point this bead's description names:
 * `session-builder/provider.ts` "enumerates instruments itself
 * (`provider.ts:770`) and builds the concept-instrument index from all
 * records (`provider.ts:827`, `:911`) into `core/src/study-session/compose.ts`'s
 * `buildComposedStudySession`, none of which reads the suspended set."
 *
 * Written and run failing first, against the code as it stood after
 * `ol-egov.141.89.10.13` landed `session/build.ts`'s own (different) fix —
 * that bead's own follow-up note, and `composed-review-path.spec.ts`'s
 * module doc, both explain why that fix alone does not reach this path:
 * `composeStudySessionForRequest` never calls `session/build.ts`'s
 * `buildReviewSession` and never reads `.suspended` at all.
 */
import { describe, expect, it } from 'vitest';
import { createFsrsScheduler, enumerateVaultInstruments } from 'olea-core';
import type { ObsidianDataHost } from '../../src/plan/settings-store.js';
import { STUDY_PLAN_SETTINGS_STORAGE_KEY } from '../../src/plan/settings-store.js';
import { createVaultSuspendPort } from '../../src/review/ports.js';
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

/** Same `ObsidianDataHost` fake `composed-review-path.spec.ts` and `session-builder/provider.spec.ts`'s own `FakeDataHost` use. */
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
 * Two concepts, same course, both cited by the same past paper — the same
 * `composed-review-path.spec.ts` `twoConceptSameCourseVault` shape (rebuilt
 * here rather than imported since that helper is not exported), so both
 * instruments are ones the composer would otherwise select. Course codes and
 * concept names are invented (INV-3).
 */
function twoConceptSameCourseVault(): ReturnType<typeof memoryVault> {
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

describe('composeStudySessionForRequest excludes a suspended instrument from its own instrument index (ol-egov.141.89.10.30)', () => {
  it("composedInput.instruments never offers a suspended instrument for its concept, and still offers the non-suspended one", async () => {
    const vault = twoConceptSameCourseVault();
    const enumeration = await enumerateVaultInstruments(vault);
    const widget = enumeration.records.find((r) => r.notePath === 'Notes/one.md');
    const gadget = enumeration.records.find((r) => r.notePath === 'Notes/two.md');
    if (widget === undefined || gadget === undefined) {
      throw new Error('expected both Widget theory and Gadget theory instruments enumerated');
    }

    // Suspend Widget theory's instrument through the real F2.6 production
    // port — the same one `ReviewSession.suspend()` calls.
    await createVaultSuspendPort(vault, DEVICE).suspend(widget.instrumentId, widget.conceptIds);

    const result = await composeStudySessionForRequest(
      {
        vault,
        deviceId: DEVICE,
        settingsHost: new FakeSettingsHost(),
        now: () => NOW,
        scheduler: createFsrsScheduler(),
      },
      { budgetMinutes: DEFAULT_SESSION_BUDGET_MINUTES },
      NOW,
    );
    if (result === null) throw new Error('expected a composed result, got null (plan not configured)');

    // conceptIds are opaque keys (`concept-<id>:<name>`), not plain names —
    // looked up by the record's own id, never a literal concept-name string.
    const widgetConceptId = widget.conceptIds[0];
    const gadgetConceptId = gadget.conceptIds[0];
    if (widgetConceptId === undefined || gadgetConceptId === undefined) {
      throw new Error('expected both instruments to carry a concept id');
    }

    const widgetOffered = result.composedInput.instruments
      .instrumentsFor(widgetConceptId)
      .map((r) => r.instrumentId);
    const gadgetOffered = result.composedInput.instruments
      .instrumentsFor(gadgetConceptId)
      .map((r) => r.instrumentId);

    expect(widgetOffered).not.toContain(widget.instrumentId);
    expect(gadgetOffered).toContain(gadget.instrumentId);
  });
});
