import { describe, expect, it } from 'vitest';
import {
  ARTIFACT_ENVELOPE_VERSION,
  DEPTH_GATE_BODY_VERSION,
  DEPTH_GATE_CONTRACT_ID,
  DEPTH_GATE_KIND,
  type DepthGateEnvelope,
  depthGateEnvelope,
  envelopeFreshness,
  OPERATING_FRESH_FOR_SECONDS,
  OPERATING_GOVERNS_FOR_SECONDS,
  readArtifactEnvelope,
} from './artifact-envelope.js';
import { contracts } from './registry.js';

/**
 * `[D-352]` (`ol-egov.141.89.9.24`) — the growth-stage depth gate's own
 * delivered-parameters package (component register row 3.1), mirroring the
 * ranking-weights envelope (row 3.3, `[D-110]`) this file's sibling
 * `artifact-envelope.spec.ts` already covers generically. This file tests
 * only what is specific to THIS kind: its body shape, its registration, and
 * that it reads through the shared envelope machinery exactly like every
 * other kind — the unknown-version/staleness machinery itself is already
 * exercised by `artifact-envelope.spec.ts` and is not re-tested here.
 *
 * `'relational'` below is the SOLO level `packages/core/src/mastery/
 * rollup.ts`'s `DEPTH_GATE_SOLO_LEVEL` declares today — used here only as a
 * structurally valid fixture value, not asserting anything about that
 * module's own declared fallback (which stays this bead's responsibility to
 * leave unchanged, not this test's to pin).
 */
function validDepthGateEnvelope(): DepthGateEnvelope {
  return {
    envelopeVersion: ARTIFACT_ENVELOPE_VERSION,
    kind: 'depth-gate',
    bodyVersion: DEPTH_GATE_BODY_VERSION,
    policyVersion: 'dg1-0123456789abcdef',
    computedAt: '2026-09-25T09:00:00.000Z',
    freshForSeconds: OPERATING_FRESH_FOR_SECONDS,
    governsForSeconds: OPERATING_GOVERNS_FOR_SECONDS,
    body: { depthGate: 'relational' },
  };
}

describe('the depth-gate envelope (register 3.1, [D-352])', () => {
  it('accepts a well-formed depth-gate artifact', () => {
    expect(depthGateEnvelope.safeParse(validDepthGateEnvelope()).success).toBe(true);
  });

  it('is registered under its own contract id', () => {
    expect(contracts.has(DEPTH_GATE_CONTRACT_ID)).toBe(true);
  });

  it('rejects a body naming something that is not a SOLO level', () => {
    const bad = { ...validDepthGateEnvelope(), body: { depthGate: 'mastered' } };
    expect(depthGateEnvelope.safeParse(bad).success).toBe(false);
  });

  it('rejects a body with no depthGate field at all', () => {
    const bad = { ...validDepthGateEnvelope(), body: {} };
    expect(depthGateEnvelope.safeParse(bad).success).toBe(false);
  });

  it('reads through the shared decoder as a known artifact', () => {
    const read = readArtifactEnvelope(depthGateEnvelope, DEPTH_GATE_KIND, validDepthGateEnvelope());
    expect(read.status).toBe('ok');
    if (read.status === 'ok') {
      expect(read.artifact.body.depthGate).toBe('relational');
    }
  });

  it("is unreadable, not merely wrong, under another kind's tag", () => {
    const wrongKind = { ...validDepthGateEnvelope(), kind: 'rank-weights' };
    const read = readArtifactEnvelope(depthGateEnvelope, DEPTH_GATE_KIND, wrongKind);
    expect(read).toEqual({ status: 'unreadable', reason: 'wrong-kind' });
  });

  it('is unreadable under an unknown body version, discard-and-rebuild per the module doc', () => {
    const futureBody = { ...validDepthGateEnvelope(), bodyVersion: 2 };
    const read = readArtifactEnvelope(depthGateEnvelope, DEPTH_GATE_KIND, futureBody);
    expect(read).toEqual({ status: 'unreadable', reason: 'unknown-body-version' });
  });

  it('is unreadable under an unknown envelope version, without looking at the body', () => {
    const futureEnvelope = { ...validDepthGateEnvelope(), envelopeVersion: 99 };
    const read = readArtifactEnvelope(depthGateEnvelope, DEPTH_GATE_KIND, futureEnvelope);
    expect(read).toEqual({ status: 'unreadable', reason: 'unknown-envelope-version' });
  });

  it('uses the operating freshness class, matching the rank-weights precedent (row 3.3)', () => {
    const artifact = validDepthGateEnvelope();
    const computedAt = new Date(artifact.computedAt);

    const stillFresh = new Date(computedAt.getTime() + (OPERATING_FRESH_FOR_SECONDS - 1) * 1000);
    expect(envelopeFreshness(artifact, stillFresh).state).toBe('fresh');

    const stale = new Date(computedAt.getTime() + (OPERATING_FRESH_FOR_SECONDS + 1) * 1000);
    expect(envelopeFreshness(artifact, stale).state).toBe('stale');

    const expired = new Date(computedAt.getTime() + (OPERATING_GOVERNS_FOR_SECONDS + 1) * 1000);
    expect(envelopeFreshness(artifact, expired).state).toBe('expired');
  });
});
