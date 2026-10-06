/**
 * The practice paper's unfinished and partial states (F4.11, `[D-457]`, vocabulary registry
 * section 31). Scenarios: olea-service/features/F4-oracle.md, "F4.11 — The practice paper's
 * unfinished and partial states say so in the ruled sentences", tagged
 * `@auto:plugin/paper/paper-states.ol-egov.141.89.7.44.spec`. Course A, synthetic.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { PaperCompositionAccount, PaperEmptySlot, PaperRecord } from 'olea-core';
import { describe, expect, it } from 'vitest';
import {
  buildIncompletePaperStatement,
  INCOMPLETE_PAPER_SENTENCE,
  omittedPartLine,
  UNFINISHED_PAPER_SENTENCE,
} from '../../src/paper/copy.js';
import {
  buildReadyStateFromRecord,
  PracticePaperUnfinishedError,
  unfinishedPaperNotice,
} from '../../src/paper/provider.js';

const UNFINISHED = "Olea couldn't finish this paper. Ask again to continue from where it stopped.";
const INCOMPLETE = 'This paper is incomplete. Some planned questions could not be written.';
const BANNED = /covers? less of the course|less of the course/i;

function slot(
  id: string,
  reasonCode: PaperEmptySlot['reasonCode'],
  reason: string,
): PaperEmptySlot {
  return { slotId: id, conceptKey: `k-${id}`, conceptName: `Concept ${id}`, reasonCode, reason };
}

function record(
  emptySlots: readonly PaperEmptySlot[],
  completion?: PaperRecord['completion'],
): PaperRecord {
  const compositionAccount: PaperCompositionAccount = {
    formatVersion: 'paper-blueprint-v1',
    course: 'COURSEA',
    asOf: '2026-09-19',
    alpha: 0.5,
    formatClass: 'written',
    intendedDemand: 'recall-a-fact',
    steering: {},
    structureSummary: null,
    eligibleCount: 3,
    unbuiltDemand: null,
    partial: false,
  };
  return {
    id: 'paper-key1:test',
    course: 'COURSEA',
    generatedAt: '2026-09-19T00:00:00.000Z',
    asOf: '2026-09-19',
    compositionAccount,
    items: [],
    emptySlots,
    responses: [],
    handoffs: [],
    explanationResults: [],
    status: 'active',
    schemaVersion: completion === undefined ? 1 : 2,
    ...(completion === undefined ? {} : { completion }),
  } as PaperRecord;
}

function unfinishedError(reason: 'service-unavailable' | 'authoring-spec-changed') {
  return new PracticePaperUnfinishedError({
    course: 'COURSEA',
    reason,
    journalId: 'paper-journal-key1:x',
    plannedSlotCount: 3,
    owedSlotCount: 2,
  });
}

describe('the unfinished state', () => {
  it('the ruled sentence is verbatim', () => {
    expect(UNFINISHED_PAPER_SENTENCE).toBe(UNFINISHED);
  });

  it('an outage shows that sentence and nothing else about the paper', () => {
    expect(unfinishedPaperNotice(unfinishedError('service-unavailable'))).toBe(UNFINISHED);
  });

  it('names no omitted part, reason, count or service detail', () => {
    const notice = unfinishedPaperNotice(unfinishedError('service-unavailable')) ?? '';
    expect(notice).not.toMatch(/\d|journal|COURSEA|unavailable|retry|reason/i);
  });

  it('a journal set aside for another authoring specification is not told "continue"', () => {
    expect(unfinishedPaperNotice(unfinishedError('authoring-spec-changed'))).toBeNull();
    expect(unfinishedPaperNotice(new Error('boom'))).toBeNull();
  });

  it('the view offers the existing request again and adds no new control', () => {
    const view = readFileSync(
      fileURLToPath(new URL('../../src/paper/view.ts', import.meta.url)),
      'utf8',
    );
    expect(view).toMatch(/unfinishedPaperNotice\(error\)/);
    expect(view).toMatch(/this\.renderRequestButton\(root, course\)/);
    expect(view.match(/createEl\('button'/g)?.length).toBe(2); // request, per-item hand-off
  });
});

describe('the partial state', () => {
  it('the ruled sentence is verbatim', () => {
    expect(INCOMPLETE_PAPER_SENTENCE).toBe(INCOMPLETE);
  });

  it('lists each omitted part by name, keeping only its reason code, never the recorded prose', () => {
    const state = buildReadyStateFromRecord(
      'COURSEA',
      record(
        [
          slot('a', 'no-held-source', 'no held source for this concept'),
          slot('b', 'demand-unsupported', 'intended demand is not declared served'),
        ],
        { status: 'qualified-partial', gaps: ['source', 'capability'] },
      ),
    );
    expect(state.incompleteStatement).toEqual({
      sentence: INCOMPLETE,
      omittedParts: [
        { conceptName: 'Concept a', reasonCode: 'no-held-source' },
        { conceptName: 'Concept b', reasonCode: 'demand-unsupported' },
      ],
    });
    expect(JSON.stringify(state.incompleteStatement)).not.toMatch(/held source|declared served/);
  });

  it('each omitted part reads with its ruled reason, and a code with none ruled reads by name alone ([D-519])', () => {
    const statement = buildIncompletePaperStatement({ status: 'qualified-partial' }, [
      slot('a', 'no-held-source', 'r'),
      slot('b', 'demand-unsupported', 'r'),
      slot('c', 'no-held-stimulus', 'r'),
      slot('d', 'depends-on-empty-part', 'r'),
      slot('e', 'generator-refused', 'r'),
      slot('f', 'some-future-code' as PaperEmptySlot['reasonCode'], 'r'),
    ]);
    expect(statement?.omittedParts.map((p) => omittedPartLine(p))).toEqual([
      'Concept a — Nothing of yours covers this yet.',
      "Concept b — Olea can't yet write this kind of question.",
      'Concept c — This question needs a case, extract, table or figure, and none of your material supplies one.',
      'Concept d — This part builds on an earlier part that could not be written.',
      "Concept e — Olea couldn't write a question on this that stays within your material.",
      'Concept f',
    ]);
  });

  it('the view renders an omitted part through its ruled line', () => {
    const view = readFileSync(
      fileURLToPath(new URL('../../src/paper/view.ts', import.meta.url)),
      'utf8',
    );
    expect(view).toMatch(/omitted\.createEl\('li', \{ text: omittedPartLine\(part\) \}\)/);
    expect(view).not.toMatch(/part\.reason|slot\.reason/);
    // The older empty-slot list is not drawn beside the statement, so no part is listed twice.
    expect(view).toMatch(/state\.incompleteStatement === null && state\.emptySlots\.length > 0/);
  });

  it('a part set aside for extent (rank) is not an omitted part', () => {
    const statement = buildIncompletePaperStatement({ status: 'qualified-partial' }, [
      slot('a', 'no-held-source', 'r1'),
      slot('c', 'rank-excluded', 'ranked below the cut'),
    ]);
    expect(statement?.omittedParts.map((p) => p.conceptName)).toEqual(['Concept a']);
  });

  it('a complete paper and a flat paper carry no statement', () => {
    const empties = [slot('c', 'rank-excluded', 'ranked below the cut')];
    expect(
      buildReadyStateFromRecord('COURSEA', record(empties, { status: 'complete' }))
        .incompleteStatement,
    ).toBeNull();
    expect(buildReadyStateFromRecord('COURSEA', record(empties)).incompleteStatement).toBeNull();
  });

  it('the view draws the statement before the item list', () => {
    const view = readFileSync(
      fileURLToPath(new URL('../../src/paper/view.ts', import.meta.url)),
      'utf8',
    );
    expect(view.indexOf('state.incompleteStatement')).toBeGreaterThan(-1);
    expect(view.indexOf('state.incompleteStatement')).toBeLessThan(
      view.indexOf("cls: 'olea-paper-items'"),
    );
  });
});

describe('the banned framing', () => {
  it('neither sentence nor any listed omitted part reads as covering less of the course', () => {
    const statement = buildIncompletePaperStatement({ status: 'qualified-partial' }, [
      slot('a', 'no-held-source', 'no held source for this concept'),
    ]);
    const all = [UNFINISHED_PAPER_SENTENCE, statement?.sentence, JSON.stringify(statement)];
    for (const text of all) expect(text).not.toMatch(BANNED);
  });
});
