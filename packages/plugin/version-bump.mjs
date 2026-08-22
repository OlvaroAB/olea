import { readFileSync, writeFileSync } from 'node:fs';

// Hoisted from the official obsidian-sample-plugin convention. Bumps this
// package's manifest.json version to match package.json (via the
// `npm_package_version` env var pnpm sets while running a package script),
// and appends a version -> minAppVersion entry into versions.json — this is
// the file BRAT's own release tooling and Obsidian's update checker read.
const targetVersion = process.env.npm_package_version;

const manifest = JSON.parse(readFileSync('manifest.json', 'utf8'));
const { minAppVersion } = manifest;
manifest.version = targetVersion;
writeFileSync('manifest.json', `${JSON.stringify(manifest, null, 2)}\n`);

const versions = JSON.parse(readFileSync('versions.json', 'utf8'));
if (!versions[targetVersion]) {
  versions[targetVersion] = minAppVersion;
}
writeFileSync('versions.json', `${JSON.stringify(versions, null, 2)}\n`);
