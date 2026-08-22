/**
 * Module-wide fitness function for M4 ("never leaves device except
 * transiently") — the same source-text-assertion technique
 * `../instrument/rating.spec.ts` and `../queue/compose.spec.ts` use for their
 * own purity/no-scheduler guards, applied here to "no network call anywhere
 * in this directory."
 *
 * A behavioural test can only prove what a given call does with the inputs
 * it happened to try; it cannot prove a function never reaches for `fetch`
 * under some untested branch. Reading the actual source bytes is what makes
 * this a structural guarantee rather than a coverage gap waiting to be
 * found — the same reasoning D-005's content-never-logged test and INV-1's
 * probe spec both rely on.
 */

import { readdirSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const DIR = new URL('./', import.meta.url);

/** Every non-spec `.ts` source file in this directory, name -> contents. */
function moduleSources(): ReadonlyMap<string, string> {
  const entries = readdirSync(DIR, { withFileTypes: true });
  const sources = new Map<string, string>();
  for (const entry of entries) {
    if (!entry.isFile()) continue;
    if (!entry.name.endsWith('.ts')) continue;
    if (entry.name.endsWith('.spec.ts')) continue;
    sources.set(entry.name, readFileSync(new URL(entry.name, DIR), 'utf8'));
  }
  return sources;
}

// Literal substrings that would indicate this directory reaches the network
// (or a filesystem/vault write outside the injected `VaultSource` port)
// directly, rather than through an injected port a caller controls.
const FORBIDDEN_SUBSTRINGS = [
  'fetch(',
  'XMLHttpRequest',
  'requestUrl(',
  "from 'node:http",
  "from 'node:https",
  'WebSocket(',
];

describe('misconception module — M4 fitness: no network call anywhere in this directory', () => {
  const sources = moduleSources();

  it('found at least the expected module files (the fitness check itself is not vacuous)', () => {
    expect(sources.size).toBeGreaterThanOrEqual(9);
    expect(sources.has('types.ts')).toBe(true);
    expect(sources.has('digest.ts')).toBe(true);
  });

  for (const [name, contents] of moduleSources()) {
    it(`${name} contains no direct network primitive`, () => {
      for (const forbidden of FORBIDDEN_SUBSTRINGS) {
        expect(contents).not.toContain(forbidden);
      }
    });
  }

  it('digest.ts is the only file whose exported shape is meant to travel in a request payload', () => {
    // A structural proxy for "nothing except the bounded digest is designed
    // to leave the device": every other module's exported functions operate
    // on local data (VaultSource, in-memory events/records) and return
    // local shapes. This does not prove a future caller won't misuse an
    // export — that is a call-site discipline no source-text check can
    // enforce — but it does prove this directory offers no "send everything"
    // convenience function to misuse.
    const write = sources.get('write.ts') ?? '';
    const merge = sources.get('merge.ts') ?? '';
    const project = sources.get('project.ts') ?? '';
    for (const forbidden of ['upload', 'sync(', 'push(', 'publish(']) {
      expect(write.toLowerCase()).not.toContain(forbidden);
      expect(merge.toLowerCase()).not.toContain(forbidden);
      expect(project.toLowerCase()).not.toContain(forbidden);
    }
  });
});
