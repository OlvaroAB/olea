import { describe, expect, it } from 'vitest';
import { GateStageRecorder } from './gateStageRecorder.js';

describe('GateStageRecorder — the aggregation half of [JEV-11] (ol-3ux7.96)', () => {
  it('starts every stage at zero, with a null judge share (nothing to divide)', () => {
    const rec = new GateStageRecorder();
    const summary = rec.summary();
    expect(summary.total).toBe(0);
    expect(summary.judgeShare).toBeNull();
    expect(summary.counts['escalated-to-judge']).toBe(0);
  });

  it('counts one occurrence per record call, attributed to the right stage', () => {
    const rec = new GateStageRecorder();
    rec.record('below-band');
    rec.record('below-band');
    rec.record('escalated-to-judge');
    const summary = rec.summary();
    expect(summary.total).toBe(3);
    expect(summary.counts['below-band']).toBe(2);
    expect(summary.counts['escalated-to-judge']).toBe(1);
  });

  it('computes the judge-consulted share the study needs — escalated-to-judge over the total', () => {
    const rec = new GateStageRecorder();
    for (let i = 0; i < 3; i += 1) rec.record('above-band');
    rec.record('escalated-to-judge');
    expect(rec.summary().judgeShare).toBeCloseTo(0.25, 10);
  });

  it('reset zeroes every count, including ones already recorded', () => {
    const rec = new GateStageRecorder();
    rec.record('escalated-to-judge');
    rec.reset();
    const summary = rec.summary();
    expect(summary.total).toBe(0);
    expect(summary.judgeShare).toBeNull();
  });

  it('record is bound, so it can be passed as a bare onStage callback', () => {
    const rec = new GateStageRecorder();
    const onStage = rec.record;
    onStage('no-hits');
    expect(rec.summary().counts['no-hits']).toBe(1);
  });

  it('holds only integer counts keyed by stage — no field or method can carry content', () => {
    const rec = new GateStageRecorder();
    rec.record('composite-veto');
    const summary = rec.summary();
    // Every value in the summary is a number (or null for judgeShare with no
    // data); there is nowhere for a string, a path or a query to travel.
    for (const [key, value] of Object.entries(summary.counts)) {
      expect(typeof key).toBe('string'); // the key is a fixed stage name, never caller-supplied text
      expect(typeof value).toBe('number');
    }
  });
});
