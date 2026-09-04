/**
 * `simulator/world.ts` (`ol-3ux7.64.14` [WBX-12]) — the world descriptor
 * fetch and its fallback. `loadSimulatorWorld` never throws and never
 * fabricates a label the fetched file did not say; the FIXTURE fallback is
 * the one shape this package itself ever constructs (INV-3 — no real-vault
 * or persona content here), but the parser has to carry through whatever a
 * private dist's descriptor says without validating its vocabulary.
 */
import { describe, expect, it } from 'vitest';
import { WORKBENCH_NOW } from '../src/clock.js';
import { loadSimulatorWorld, parseWorldAsOf } from '../src/simulator/world.js';

function fakeFetch(response: Response | Error): typeof fetch {
  return (async () => {
    if (response instanceof Error) throw response;
    return response;
  }) as typeof fetch;
}

const FIXTURE_ASOF = WORKBENCH_NOW.toISOString().slice(0, 10);

describe('loadSimulatorWorld', () => {
  it('parses a well-formed descriptor and reports no fallback', async () => {
    const body = { world: 'real', label: 'REAL (private)', asOf: '2026-08-28' };
    const result = await loadSimulatorWorld(fakeFetch(new Response(JSON.stringify(body))));
    expect(result.fallback).toBe(false);
    expect(result.descriptor).toEqual(body);
  });

  it('falls back to FIXTURE + WORKBENCH_NOW on a 404', async () => {
    const result = await loadSimulatorWorld(fakeFetch(new Response('not found', { status: 404 })));
    expect(result.fallback).toBe(true);
    expect(result.descriptor).toEqual({ world: 'fixture', label: 'FIXTURE', asOf: FIXTURE_ASOF });
  });

  it('falls back on a network failure', async () => {
    const result = await loadSimulatorWorld(fakeFetch(new Error('network down')));
    expect(result.fallback).toBe(true);
    expect(result.descriptor.label).toBe('FIXTURE');
  });

  it('falls back on malformed JSON body shape', async () => {
    const result = await loadSimulatorWorld(
      fakeFetch(new Response(JSON.stringify({ oops: true }))),
    );
    expect(result.fallback).toBe(true);
  });

  it('falls back when asOf is not YYYY-MM-DD', async () => {
    const body = { world: 'fixture', label: 'FIXTURE', asOf: 'not-a-date' };
    const result = await loadSimulatorWorld(fakeFetch(new Response(JSON.stringify(body))));
    expect(result.fallback).toBe(true);
  });

  it('falls back on a body that is not valid JSON at all', async () => {
    const result = await loadSimulatorWorld(fakeFetch(new Response('not json')));
    expect(result.fallback).toBe(true);
  });
});

describe('parseWorldAsOf', () => {
  it('parses asOf as local midnight', () => {
    const parsed = parseWorldAsOf({ world: 'fixture', label: 'FIXTURE', asOf: '2027-01-15' });
    expect(parsed.getFullYear()).toBe(2027);
    expect(parsed.getMonth()).toBe(0);
    expect(parsed.getDate()).toBe(15);
    expect(parsed.getHours()).toBe(0);
    expect(parsed.getMinutes()).toBe(0);
  });
});
