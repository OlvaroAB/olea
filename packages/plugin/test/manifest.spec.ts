import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const __dirname = dirname(fileURLToPath(import.meta.url));
const manifest = JSON.parse(readFileSync(join(__dirname, '..', 'manifest.json'), 'utf8'));
const versions = JSON.parse(readFileSync(join(__dirname, '..', 'versions.json'), 'utf8'));

describe('plugin manifest (locked contract — CLAUDE conventions)', () => {
  it('has the locked plugin id and isDesktopOnly=false', () => {
    expect(manifest.id).toBe('olea');
    expect(manifest.isDesktopOnly).toBe(false);
  });

  it('declares a well-formed semver version and minAppVersion', () => {
    expect(manifest.version).toMatch(/^\d+\.\d+\.\d+/);
    expect(manifest.minAppVersion).toMatch(/^\d+\.\d+\.\d+$/);
  });

  it('versions.json has an entry for the current manifest version pointing at its minAppVersion', () => {
    expect(versions[manifest.version]).toBe(manifest.minAppVersion);
  });
});
