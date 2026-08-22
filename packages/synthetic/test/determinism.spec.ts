/**
 * "Same seed, byte-identical stream" — SYN-1's first acceptance clause, asserted
 * rather than asserted-about.
 *
 * Two halves, and both are needed. The byte-identity tests prove the property
 * holds today; the source scan proves it holds for a reason, by forbidding the
 * three ambient-entropy calls that would make it fail *intermittently* instead
 * of visibly. A single `Date.now()` in the generator turns this suite from a
 * guarantee into a coin toss that lands heads most of the time, which is the
 * worst possible state for a fixture other suites will be built on.
 */

import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  generateStream,
  PERSONA_IDS,
  streamSpec,
  toJsonl,
  twoDeviceSameDayStreams,
} from '../src/index.js';

const SRC_DIR = fileURLToPath(new URL('../src', import.meta.url));

describe('determinism', () => {
  it.each(PERSONA_IDS)('%s: same seed, byte-identical stream', (persona) => {
    const spec = streamSpec(persona, 'determinism-seed', {
      days: persona === 'single-session' ? 1 : 90,
    });
    const first = generateStream(spec);
    const second = generateStream(spec);

    expect(toJsonl(second.entries)).toBe(toJsonl(first.entries));
    expect(second.provenance).toEqual(first.provenance);
    expect(second.groundTruth).toEqual(first.groundTruth);
  });

  it.each(PERSONA_IDS)(
    '%s: a different seed gives different bytes (or no bytes at all)',
    (persona) => {
      const a = generateStream(streamSpec(persona, 'seed-alpha'));
      const b = generateStream(streamSpec(persona, 'seed-beta'));
      if (a.entries.length === 0) {
        // `empty-history` has nothing to differ in, which is the point of it.
        expect(b.entries).toHaveLength(0);
        return;
      }
      expect(toJsonl(b.entries)).not.toBe(toJsonl(a.entries));
    },
  );

  it('is stable across repeated generation of the same spec, ten times over', () => {
    const spec = streamSpec('struggler', 'stability');
    const expected = toJsonl(generateStream(spec).entries);
    for (let i = 0; i < 10; i += 1) {
      expect(toJsonl(generateStream(spec).entries)).toBe(expected);
    }
  });

  it('does not depend on the ambient timezone', () => {
    // Every timestamp carries its own offset and is built by shifting the
    // instant, never by reading the host's zone (see src/time.ts). Changing
    // TZ mid-process is observed by `Date`'s local getters, which this package
    // never calls — so if one crept in, this would go red.
    const spec = streamSpec('crammer', 'tz');
    const before = process.env.TZ;
    process.env.TZ = 'UTC';
    const utc = toJsonl(generateStream(spec).entries);
    process.env.TZ = 'Pacific/Kiritimati';
    const kiritimati = toJsonl(generateStream(spec).entries);
    process.env.TZ = before;
    expect(kiritimati).toBe(utc);
  });

  it('two-device edge fixtures are deterministic too', () => {
    const a = twoDeviceSameDayStreams('two-device-determinism');
    const b = twoDeviceSameDayStreams('two-device-determinism');
    expect(toJsonl(b.deviceA.entries)).toBe(toJsonl(a.deviceA.entries));
    expect(toJsonl(b.deviceB.entries)).toBe(toJsonl(a.deviceB.entries));
  });

  it('no source file reaches for ambient entropy', () => {
    const forbidden: readonly { readonly pattern: RegExp; readonly why: string }[] = [
      { pattern: /Math\.random\s*\(/, why: 'unseeded randomness' },
      { pattern: /Date\.now\s*\(/, why: 'wall clock' },
      { pattern: /randomUUID\s*\(/, why: 'unseeded event ids' },
      { pattern: /new Date\s*\(\s*\)/, why: 'wall clock' },
      { pattern: /performance\.now\s*\(/, why: 'wall clock' },
    ];
    const offenders: string[] = [];
    for (const file of readdirSync(SRC_DIR)) {
      if (!file.endsWith('.ts')) continue;
      const lines = readFileSync(join(SRC_DIR, file), 'utf8').split('\n');
      lines.forEach((line, index) => {
        // Prose in a doc comment may legitimately name these; only code counts.
        const trimmed = line.trim();
        if (trimmed.startsWith('*') || trimmed.startsWith('//')) return;
        for (const { pattern, why } of forbidden) {
          if (pattern.test(line)) offenders.push(`${file}:${index + 1} (${why})  ${trimmed}`);
        }
      });
    }
    expect(offenders).toEqual([]);
  });
});
