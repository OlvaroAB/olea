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
import {
  loadSimulatorWorld,
  loadSimulatorWorldManifest,
  parseWorldAsOf,
  personaTermStart,
  requestedWorldId,
  resolveWorldEntry,
} from '../src/simulator/world.js';

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

/**
 * The multi-world half of `ol-3ux7.5.57.13` [MOM-9b] (F9.S17). Everything
 * here is absent from a single-world dist — `loadSimulatorWorldManifest`
 * returns `null`, `resolveWorldEntry` returns `null`, and the caller then
 * takes the exact root-relative code path it took before this feature — which
 * is what keeps the world selector and the carried-world vault loader off the
 * public build entirely.
 */
describe('personaTermStart', () => {
  it("reads a persona world's declared streamSpec.startDate", () => {
    expect(personaTermStart({ startDate: '2026-05-04', deviceId: 'sim-crammer' })).toBe(
      '2026-05-04',
    );
  });

  it('is undefined for every world that declares none', () => {
    expect(personaTermStart(undefined)).toBeUndefined();
    expect(personaTermStart(null)).toBeUndefined();
    expect(personaTermStart({})).toBeUndefined();
    expect(personaTermStart('2026-05-04')).toBeUndefined();
  });

  it('refuses a malformed date rather than passing it through to date arithmetic', () => {
    expect(personaTermStart({ startDate: '04/05/2026' })).toBeUndefined();
    expect(personaTermStart({ startDate: 42 })).toBeUndefined();
  });
});

describe('requestedWorldId', () => {
  it('reads ?world=', () => {
    expect(requestedWorldId('?world=crammer')).toBe('crammer');
    expect(requestedWorldId('?a=1&world=steady&b=2')).toBe('steady');
  });

  it('is undefined when absent or empty', () => {
    expect(requestedWorldId('')).toBeUndefined();
    expect(requestedWorldId('?other=1')).toBeUndefined();
    expect(requestedWorldId('?world=')).toBeUndefined();
  });
});

describe('loadSimulatorWorldManifest', () => {
  const manifest = {
    defaultWorld: 'real',
    worlds: [
      { id: 'real', label: 'REAL (private)', base: '/', real: true },
      { id: 'crammer', label: 'PERSONA CRAMMER', base: '/worlds/crammer/' },
    ],
  };

  it('parses a well-formed manifest', async () => {
    const result = await loadSimulatorWorldManifest(
      fakeFetch(new Response(JSON.stringify(manifest))),
    );
    expect(result?.defaultWorld).toBe('real');
    expect(result?.worlds.map((w) => w.id)).toEqual(['real', 'crammer']);
  });

  it('is null for a single-world dist (404) — the public build takes no new branch', async () => {
    expect(
      await loadSimulatorWorldManifest(fakeFetch(new Response('nope', { status: 404 }))),
    ).toBeNull();
  });

  it('is null on a network failure or a non-manifest body, never a throw', async () => {
    expect(await loadSimulatorWorldManifest(fakeFetch(new Error('down')))).toBeNull();
    expect(await loadSimulatorWorldManifest(fakeFetch(new Response('[]')))).toBeNull();
    expect(await loadSimulatorWorldManifest(fakeFetch(new Response('{"worlds":[]}')))).toBeNull();
  });

  it('drops a malformed row and keeps the well-formed ones', async () => {
    const result = await loadSimulatorWorldManifest(
      fakeFetch(
        new Response(
          JSON.stringify({
            worlds: [
              { id: 'a' },
              { id: 'b', label: 'B', base: 'no-trailing-slash' },
              ...manifest.worlds,
            ],
          }),
        ),
      ),
    );
    expect(result?.worlds.map((w) => w.id)).toEqual(['real', 'crammer']);
    expect(result?.defaultWorld).toBe('real');
  });
});

describe('resolveWorldEntry', () => {
  const manifest = {
    defaultWorld: 'real',
    worlds: [
      { id: 'real', label: 'REAL (private)', base: '/', real: true },
      { id: 'crammer', label: 'PERSONA CRAMMER', base: '/worlds/crammer/' },
    ],
  };

  it('is null with no manifest, whatever was requested', () => {
    expect(resolveWorldEntry(null, 'crammer')).toBeNull();
    expect(resolveWorldEntry(null, undefined)).toBeNull();
  });

  it('resolves the requested world to its own base', () => {
    expect(resolveWorldEntry(manifest, 'crammer')?.base).toBe('/worlds/crammer/');
  });

  it('falls back to the default world for an absent or unknown id', () => {
    expect(resolveWorldEntry(manifest, undefined)?.id).toBe('real');
    expect(resolveWorldEntry(manifest, 'no-such-world')?.id).toBe('real');
  });
});
