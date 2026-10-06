/**
 * Her rejection is honoured wherever a link Olea's reading makes would contribute (`[D-537]`,
 * `ol-egov.141.89.7.77`): `readModelDecidedContainment` is the single source every reader takes
 * those links from, and nothing else reads a placement she took out as one that counts.
 *
 * Today the grove is the only reader; nothing yet produces a reading-based objectives match for
 * the ranking (`../oracle/rank.ts`'s `objectivesAlignmentOf`: "the semantic alignment lane must
 * set `alignment: 'semantic'` on the citations it adds"). Three guards keep the future ranking
 * reader on this source:
 * 1. **Behaviour**: the read's `edges` never hold a pair whose latest choice is declined; those
 *    are in `declinedPlacements`, each marked `correction: 'declined'`, for putting back only.
 * 2. **Type**: a declined placement is not assignable to `ModelDecidedContainmentEdge`
 *    (`./reconcile.ts`'s `_assertDeclinedPlacementIsNeverAnEdge`, checked by the typecheck), so
 *    it cannot be handed to a reader that takes the links that count.
 * 3. **Source scan**: stored alignment results are read raw only by the read itself, the module
 *    that defines the view, and the scope-reading writer (which decides what to send and builds no
 *    link). A new reader of them, such as a ranking path, fails here and is pointed at the read.
 *
 * It also pins where her control is stated: once, by the grove provider that hands the view the
 * working control, for objectives only.
 *
 * Scenarios: olea-service `features/F8-concepts-scope.md`, tagged
 * `@auto:core/outcome/reconcile.single-source.ol-egov.141.89.7.77.spec`.
 *
 * INV-3: every course code, concept name, path and sentence below is invented.
 */

import { readdirSync, readFileSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  COURSE,
  DOCUMENTS,
  everyBasisAligned,
  K_MODEL,
  O_MISS,
  projectionOf,
  seedCourse,
  switchesOn,
} from '../../test/support/model-decided-fixtures.js';
import { FolderSource } from '../vault/folder-source.js';
import { objectivesDeclarationOf, recordContainmentCorrection } from './containment-correction.js';
import { readModelDecidedContainment } from './reconcile.js';
import type { OutcomeRecord } from './types.js';

const PACKAGES = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');

/** Source with comments removed, so a doc paragraph never satisfies or trips a check. */
function codeOf(path: string): string {
  return readFileSync(path, 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:'"`])\/\/.*$/gm, '$1');
}

/** Every non-spec TypeScript source under core/src and plugin/src, relative to `packages/`. */
function sources(): readonly string[] {
  const out: string[] = [];
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) walk(path);
      else if (
        entry.name.endsWith('.ts') &&
        !entry.name.endsWith('.spec.ts') &&
        !entry.name.endsWith('.test.ts')
      ) {
        out.push(relative(PACKAGES, path).split('\\').join('/'));
      }
    }
  };
  for (const root of ['core/src', 'plugin/src']) walk(join(PACKAGES, root));
  return out.sort();
}

describe('guard 1 — the links that count never hold a placement she took out', () => {
  let root: string;
  let vault: FolderSource;
  let outcomes: readonly OutcomeRecord[];

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'olea-single-source-'));
    vault = new FolderSource(root);
    outcomes = await seedCourse(vault);
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it('a declined pair is in declinedPlacements only, marked declined; no edge carries a correction', async () => {
    const miss = outcomes.find((o) => o.id === O_MISS) as OutcomeRecord;
    await recordContainmentCorrection(
      vault,
      await objectivesDeclarationOf(miss, COURSE),
      K_MODEL,
      'declined',
      { now: () => 't1' },
    );
    const read = await readModelDecidedContainment(vault, {
      correctionControlAvailable: { objectives: true, 'assessment-brief': true },
      courseId: COURSE,
      outcomes,
      documents: DOCUMENTS,
      alignments: projectionOf(everyBasisAligned()),
      switches: switchesOn(['objectives', 'assessment-brief']),
    });
    expect(read.status).toBe('read');
    if (read.status !== 'read') return;
    expect(read.edges.map((e) => [e.outcomeId, e.conceptKey])).not.toContainEqual([
      O_MISS,
      K_MODEL,
    ]);
    for (const edge of read.edges) expect('correction' in edge).toBe(false);
    expect(read.declinedPlacements.map((d) => [d.outcomeId, d.conceptKey, d.correction])).toEqual([
      [O_MISS, K_MODEL, 'declined'],
    ]);
  });
});

describe('guard 2 — a declined placement cannot be passed where a link that counts is expected', () => {
  it('reconcile.ts carries the compile-time tripwire the typecheck enforces', () => {
    const code = codeOf(join(PACKAGES, 'core/src/outcome/reconcile.ts'));
    expect(code).toMatch(
      /type _assertDeclinedPlacementIsNeverAnEdge = AssertNever<\s*Extract<ModelDecidedDeclinedPlacement, ModelDecidedContainmentEdge>\s*>;/,
    );
    expect(code).toMatch(/readonly correction\?: never;/);
  });
});

describe('guard 3 — stored alignment results are read raw only by the read, its view module and the writer', () => {
  /**
   * The allowed readers. A new entry needs a reason it cannot take its links from
   * `readModelDecidedContainment`: a reader of objectives or stated-scope alignment that bypasses
   * the read would count a link she took out.
   */
  const ALLOWED = [
    'core/src/index.ts', // re-exports
    'core/src/outcome/reconcile.ts', // the read: her choices are applied here
    'core/src/outcome/scope-reading-project.ts', // defines the views
    'plugin/src/scope-reading/', // the writer: decides what to send, builds no link
  ];
  const RAW_READ =
    /\b(alignmentResultsForDocument|alignmentResultView|alignmentFreshness)\b|\.alignments\s*\.\s*(get|values|entries|keys|forEach|has)\b/;

  it('no other core or plugin source reads them', () => {
    const offenders = sources().filter(
      (path) =>
        !ALLOWED.some(
          (allowed) => path === allowed || (allowed.endsWith('/') && path.startsWith(allowed)),
        ) && RAW_READ.test(codeOf(join(PACKAGES, path))),
    );
    expect(
      offenders,
      'take links from readModelDecidedContainment, whose edges drop every placement she took out ([D-537])',
    ).toEqual([]);
  });

  it('the scan still finds the read itself, so a renamed view cannot pass it silently', () => {
    expect(RAW_READ.test(codeOf(join(PACKAGES, 'core/src/outcome/reconcile.ts')))).toBe(true);
  });
});

describe('her correction control is stated once, by the grove that renders it, for objectives only', () => {
  const PROVIDER = 'plugin/src/grove/provider.ts';

  it('only the type’s own module and the grove provider name the statement', () => {
    const naming = sources().filter((path) =>
      /\bcorrectionControlAvailable\b/.test(codeOf(join(PACKAGES, path))),
    );
    expect(naming).toEqual(['core/src/outcome/reconcile.ts', PROVIDER]);
  });

  it('the grove provider states it for objectives, and never for a stated scope', () => {
    const code = codeOf(join(PACKAGES, PROVIDER));
    const statements =
      code.match(/\{\s*objectives:\s*true,\s*'assessment-brief':\s*false\s*\}/g) ?? [];
    expect(statements).toHaveLength(1);
    expect(code).not.toMatch(/'assessment-brief'\s*:\s*true/);
  });

  it('no source states the earlier single-flag form', () => {
    const offenders = sources().filter((path) =>
      /correctionControlAvailable\s*:\s*true\b/.test(codeOf(join(PACKAGES, path))),
    );
    expect(offenders).toEqual([]);
  });
});
