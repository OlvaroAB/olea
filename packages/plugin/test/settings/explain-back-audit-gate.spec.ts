/**
 * `explain-back-audit-gate.ts` tests (`ol-g3a0.1`, F7.8 as amended by
 * `[D-127]`). Pure store logic against a fake `ObsidianDataHost` — no
 * `obsidian` import, no DOM — plus the wording constants, following
 * `../worker/config-store.spec.ts`'s pattern for the identical shape.
 *
 * What this file proves, per `ol-g3a0.1`'s acceptance criterion ("a
 * simulated sustained-failure signal must actually grey the feature ...
 * proven by a test"): the setter round-trips, defaults to clear, never
 * clobbers a sibling key in the same `data.json` blob, and the wording says
 * what is true without blame or the audit's own jargon. The OTHER half of
 * the acceptance criterion — that the flag actually greys
 * `gradeExplainBackAttempt` — is `test/grading/wiring.spec.ts`'s job.
 */
import { describe, expect, it } from 'vitest';
import {
  EXPLAIN_BACK_AUDIT_GATE_BODY,
  EXPLAIN_BACK_AUDIT_GATE_CLEAR,
  EXPLAIN_BACK_AUDIT_GATE_HEADING,
  EXPLAIN_BACK_AUDIT_GATE_STORAGE_KEY,
  isExplainBackKilled,
  ObsidianExplainBackAuditGateStore,
} from '../../src/settings/explain-back-audit-gate.js';

class FakeDataHost {
  blob: unknown = null;
  async loadData(): Promise<unknown> {
    return this.blob;
  }
  async saveData(data: unknown): Promise<void> {
    this.blob = data;
  }
}

describe('ObsidianExplainBackAuditGateStore — load()', () => {
  it('returns the clear state on a fresh install (nothing saved yet)', async () => {
    const store = new ObsidianExplainBackAuditGateStore(new FakeDataHost());
    expect(await store.load()).toEqual(EXPLAIN_BACK_AUDIT_GATE_CLEAR);
  });

  it('returns the clear state on a corrupted or unrecognised value under its key', async () => {
    const host = new FakeDataHost();
    host.blob = { [EXPLAIN_BACK_AUDIT_GATE_STORAGE_KEY]: { garbage: true } };
    const store = new ObsidianExplainBackAuditGateStore(host);
    expect(await store.load()).toEqual(EXPLAIN_BACK_AUDIT_GATE_CLEAR);
  });
});

describe('ObsidianExplainBackAuditGateStore — setSustainedFailure() (the setter the switch is testable through)', () => {
  it('round-trips true', async () => {
    const host = new FakeDataHost();
    const store = new ObsidianExplainBackAuditGateStore(host);

    await store.setSustainedFailure(true);

    const gate = await store.load();
    expect(gate.sustainedFailure).toBe(true);
    expect(isExplainBackKilled(gate)).toBe(true);
  });

  it('round-trips false — clearing after a set', async () => {
    const host = new FakeDataHost();
    const store = new ObsidianExplainBackAuditGateStore(host);

    await store.setSustainedFailure(true);
    await store.setSustainedFailure(false);

    const gate = await store.load();
    expect(isExplainBackKilled(gate)).toBe(false);
  });

  it('never clobbers a sibling key already present in the same data.json blob', async () => {
    const host = new FakeDataHost();
    host.blob = { workerConfig: { version: 1, baseUrl: 'https://worker.example', token: 't' } };

    const store = new ObsidianExplainBackAuditGateStore(host);
    await store.setSustainedFailure(true);

    expect(host.blob).toMatchObject({
      workerConfig: { version: 1, baseUrl: 'https://worker.example', token: 't' },
      [EXPLAIN_BACK_AUDIT_GATE_STORAGE_KEY]: { version: 1, sustainedFailure: true },
    });
  });
});

describe('EXPLAIN_BACK_AUDIT_GATE wording — honest, plain, no blame', () => {
  it('has a non-empty heading distinct from the F7.8 degradation statement heading', () => {
    expect(EXPLAIN_BACK_AUDIT_GATE_HEADING.length).toBeGreaterThan(0);
    expect(EXPLAIN_BACK_AUDIT_GATE_HEADING).not.toBe('Olea works without AI');
  });

  it('names the four capabilities that keep working, same as the F7.8 statement', () => {
    for (const capability of ['cards', 'review', 'scheduling', 'Today panel']) {
      expect(EXPLAIN_BACK_AUDIT_GATE_BODY.toLowerCase()).toContain(capability.toLowerCase());
    }
  });

  it('never blames her — no second-person accusation or fault words', () => {
    expect(EXPLAIN_BACK_AUDIT_GATE_BODY).not.toMatch(
      /\byour\b|\byou\b|\bfault\b|\bmistake\b|\bwrong answer\b/i,
    );
  });

  it("never surfaces the audit machinery's own jargon to her", () => {
    for (const jargon of ['calibration', 'cross-grader', 'cross grade', 'audit', 'false praise']) {
      expect(EXPLAIN_BACK_AUDIT_GATE_BODY.toLowerCase()).not.toContain(jargon);
    }
  });

  it('never claims an error or apologises (V4 — ownership without performance)', () => {
    expect(EXPLAIN_BACK_AUDIT_GATE_BODY).not.toMatch(/\bsorry\b|\berror\b|\bfailed\b|\bbroken\b/i);
  });
});
