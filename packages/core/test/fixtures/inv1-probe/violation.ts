// INV-1 PROBE FIXTURE — DELIBERATE VIOLATION. DO NOT FIX. DO NOT IMPORT.
//
// This file exists only to prove that scripts/check-inv1.mjs actually fires
// on a real `obsidian` import outside packages/plugin. It is quarantined so
// it never poisons the real build or the default INV-1 scan:
//
//   - packages/core/tsconfig.json's `include` is scoped to `src/**/*.ts`, and
//     packages/core/test/tsconfig.json explicitly excludes
//     `fixtures/inv1-probe/**`, so `pnpm -r typecheck` / `pnpm -r build`
//     never compile this file.
//   - biome.json excludes `packages/core/test/fixtures/inv1-probe/**` from
//     `files.includes`, so `pnpm -r lint` never scans this file.
//   - No spec file imports this module — vitest never parses it as code.
//   - scripts/check-inv1.mjs's default (no-arg) scan skips any directory
//     named `inv1-probe`, so `node scripts/check-inv1.mjs` still exits 0 on
//     the clean tree even with this file committed.
//
// The only thing that ever looks inside this file is
// packages/core/test/inv1.probe.spec.ts, which shells out to the checker
// with this directory passed explicitly as argv[2] and asserts a non-zero
// exit.
import { Plugin } from "obsidian";

export class ProbeViolation extends Plugin {
  onload(): void {
    // never runs — probe only
  }
}
