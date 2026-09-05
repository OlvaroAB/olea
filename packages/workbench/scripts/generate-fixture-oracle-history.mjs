#!/usr/bin/env node
// generate-fixture-oracle-history.mjs — the fixture vault's OWN review
// history for the walkthrough's fixture-vault oracle (steps 7-8, `ol-0v9n`).
//
// ================================================================================================
// THE BUG THIS REPLACES
// ================================================================================================
// `oracle/fixture-oracle.ts` used to borrow a synthetic persona's stream
// (`packages/synthetic`'s `steady-reviewer`) and relabel it onto the fixture
// vault's real instruments by a POSITIONAL ring-join, the same trick
// `persona/history.ts`'s `entriesFor` uses for the review/today surfaces. That
// join makes sense there because those surfaces only need a plausible SHAPE of
// history. It does not make sense for the oracle: steps 7-8 rank real fixture
// concepts and then look up mastery for them, and the borrowed history landed
// on whichever instrument the ring happened to reach — never the concepts the
// oracle actually ranked. Every row read `seed` ("new"), and the screen's own
// caption had to say so.
//
// ================================================================================================
// WHY A HAND-WRITTEN STORY, NOT A CALL INTO packages/synthetic
// ================================================================================================
// `packages/synthetic`'s generator mints its OWN curriculum internally
// (`curriculum.ts`/`world.ts`): every instrument's `conceptId` is a coined
// `syn:concept:…` value the generator itself assigns, and there is no
// parameter that lets a caller target an external, real concept id instead.
// Making that possible would mean changing the generator's own shape, which
// this bead's owning lane may not do (`packages/synthetic` is out of scope —
// see ol-0v9n). So this script is the "small deterministic generator in the
// workbench" ol-0v9n names as the fallback when the persona machinery's API
// does not allow targeting.
//
// ================================================================================================
// WHAT IT PRODUCES, AND WHY A .ts LITERAL RATHER THAN A COMMITTED .jsonl FILE
// ================================================================================================
// ol-0v9n's own text imagines a JSONL file under the fixture vault's directory
// (`packages/core/fixtures/vault/.olea/reviews/…`). This lane owns
// `packages/workbench/**` only — not `packages/core`'s fixtures — so the
// output instead lands inside this package, at
// `src/oracle/fixture-oracle-history.ts`, as a plain exported array literal of
// `ReviewLogEntry` objects rather than a fetched or `fs`-read asset. That
// keeps the same load path working identically in three different contexts
// this package's data has to survive (a plain `node build.mjs` esbuild
// bundle, a browser runtime with no filesystem, and vitest under Node) with no
// bundler loader configuration anywhere — a `.jsonl` asset would need one in
// at least two of the three. What ol-0v9n actually asked for — generated once,
// committed, deterministic, reviewable in a diff, keyed to the fixture
// vault's REAL concept ids rather than a borrowed stream's — is unaffected by
// the file extension.
//
// Run once, from packages/workbench/:
//
//   node scripts/generate-fixture-oracle-history.mjs
//   pnpm exec biome format --write src/oracle/fixture-oracle-history.ts
//
// The second line matters: this script writes `JSON.stringify` output
// (double-quoted, one array element per line), and the committed file is
// biome-formatted (single-quoted, compact arrays). Skipping the format step
// makes every regeneration look like it drifted from the committed file even
// when the DATA is unchanged — diff the post-format output, never the raw
// generator output, when checking this file against what's committed.
//
// Requires `packages/core` and `packages/contracts` already built
// (`pnpm --filter olea-core --filter olea-contracts build`) — this is a plain
// Node script with no TypeScript loader, so it reads their compiled dist, the
// same convention `node-pipeline.mjs`'s module doc explains in full.
//
// ================================================================================================
// THE SPREAD, AND WHY THESE FOUR SHAPES
// ================================================================================================
// The fixture vault's oracle ranks exactly four concepts today (all under
// GEOL204 — MUSTH104 abstains; `buildFixtureOracle` over the checked-in
// fixture vault is the oracle for this, not a number hand-copied here). Per
// ol-0v9n's "what to watch": the spread must make the product legible, not
// flatter it — at least one high-yield concept she is solid on, and at least
// one low-yield concept she has over-studied without it sticking.
//
// "High-/low-yield" below means each concept's RAW course-material importance
// — `factors.preMasteryScore` in `oracle/rank.ts`, the sum of its assessment
// contributions, before any mastery discount — which is what this vault's
// oracle produces when every concept reads `seed` (i.e. before this file ever
// ran). It is deliberately NOT the same thing as the final, DISPLAYED
// `oracleRank`/`rank` a viewer sees on the walkthrough screen, because that
// rank is `preMasteryScore * masteryNeedWeight`, and `masteryNeedWeight`
// legitimately discounts a concept once she has learned it. So the highest
// pre-mastery-score concept below (Imbrication) is given `tree` and, exactly
// as the real oracle is supposed to behave, DROPS in the displayed rank once
// it does — that drop is the feature working, not a defect in this story.
// Conversely the lowest pre-mastery-score concept (Paraconformity) stays
// near the bottom of the displayed rank regardless of its mastery, because
// low intrinsic yield is never boosted by more attempts — which is exactly
// what "over-studied, still not paying off" needs to show.
//
//   Imbrication (highest pre-mastery yield)          — SOLID.
//     Six spaced recall (qa) successes -> `tree` (C5.4's top state).
//   Hummocky stratification                          — UNTOUCHED.
//     Zero events -> `seed`, honestly: she really has not studied this one,
//     and a genuine "new" belongs in the spread too.
//   Bioturbation                                     — RECOGNISED, NOT RECALLED.
//     Five spaced MCQ successes -> capped at `sapling` (C5.4's
//     recognition-only ceiling), never `tree`.
//   Paraconformity (lowest pre-mastery yield)         — OVER-STUDIED, STILL WEAK.
//     Ten qa attempts, but the RECENT window is mostly `again`/`hard` ->
//     `sprout`. Effort spent, recall not holding — the effort-imbalance
//     point ol-0v9n names.
//
// Nothing here is fitted or tuned against anything (N-015 does not apply: this
// is fixture-vault demo data, not an eval). The ratings are picked by hand to
// land on named C5.4 states through its own published rules
// (`packages/core/src/mastery/rollup.ts`), and this script's own
// `assertExpectedState` calls that exact rollup function to prove each story
// produces the state it claims, rather than asserting it by eye.

import { existsSync } from 'node:fs';
import { writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const workbenchRoot = resolve(here, '..');
const coreDist = resolve(workbenchRoot, '..', 'core', 'dist');
const contractsDist = resolve(workbenchRoot, '..', 'contracts', 'dist');
const fixtureVaultDir = resolve(workbenchRoot, '..', 'core', 'fixtures', 'vault');
const OUTPUT_PATH = join(workbenchRoot, 'src', 'oracle', 'fixture-oracle-history.ts');

/** Loads a fixed set of exports from a package's BUILT dist — see this file's module doc. */
async function loadDist(distRoot, packageLabel, need) {
  const out = {};
  for (const [name, segments] of Object.entries(need)) {
    const file = join(distRoot, ...segments);
    if (!existsSync(file)) {
      throw new Error(
        `generate-fixture-oracle-history.mjs: ${packageLabel} is not built: ${file} is missing.\n` +
          `  Fix: pnpm --filter ${packageLabel} build`,
      );
    }
    const module = await import(pathToFileURL(file).href);
    if (!(name in module)) {
      throw new Error(
        `generate-fixture-oracle-history.mjs: ${packageLabel}'s ${segments.join('/')} no longer exports ${name}.`,
      );
    }
    out[name] = module[name];
  }
  return out;
}

const { extractConcepts, FolderSource, computeConceptMastery } = await loadDist(
  coreDist,
  'olea-core',
  {
    extractConcepts: ['concept', 'extract.js'],
    FolderSource: ['vault', 'folder-source.js'],
    computeConceptMastery: ['mastery', 'rollup.js'],
  },
);
const { reviewLogEntry } = await loadDist(contractsDist, 'olea-contracts', {
  reviewLogEntry: ['review-log.js'],
});

/** One story: a concept's note path, its intended C5.4 state, and the events that produce it. */
const STORIES = [
  {
    notePath: '05 Zettelkasten/Imbrication.md',
    expectedState: 'tree',
    events: [
      { date: '2026-06-03', instrumentType: 'qa', rating: 'good' },
      { date: '2026-06-10', instrumentType: 'qa', rating: 'good' },
      { date: '2026-06-19', instrumentType: 'qa', rating: 'easy' },
      { date: '2026-07-02', instrumentType: 'qa', rating: 'good' },
      { date: '2026-07-20', instrumentType: 'qa', rating: 'good' },
      { date: '2026-08-10', instrumentType: 'qa', rating: 'easy' },
      // The depth gate (`MAT-6`/`ol-95vv.7`, R7): spaced recall alone reaches
      // `sapling` and stops. `tree` is reachable ONLY through an explain-back
      // graded at or above the declared depth threshold (`relational`), so the
      // one concept in this spread that is meant to read `tree` carries one.
      { date: '2026-08-24', instrumentType: 'explain-back', soloLevel: 'relational' },
    ],
  },
  {
    // Zero events, deliberately: a real, untouched concept belongs in
    // the spread beside the studied ones (see this file's module doc).
    notePath: '05 Zettelkasten/Hummocky stratification.md',
    expectedState: 'seed',
    events: [],
  },
  {
    notePath: '05 Zettelkasten/Bioturbation.md',
    expectedState: 'sapling',
    events: [
      { date: '2026-06-05', instrumentType: 'mcq', rating: 'good' },
      { date: '2026-06-12', instrumentType: 'mcq', rating: 'good' },
      { date: '2026-06-25', instrumentType: 'mcq', rating: 'good' },
      { date: '2026-07-15', instrumentType: 'mcq', rating: 'good' },
      { date: '2026-08-01', instrumentType: 'mcq', rating: 'good' },
    ],
  },
  {
    notePath: '05 Zettelkasten/Paraconformity.md',
    expectedState: 'sprout',
    events: [
      { date: '2026-06-02', instrumentType: 'qa', rating: 'again' },
      { date: '2026-06-04', instrumentType: 'qa', rating: 'again' },
      { date: '2026-06-09', instrumentType: 'qa', rating: 'hard' },
      { date: '2026-06-16', instrumentType: 'qa', rating: 'again' },
      { date: '2026-06-23', instrumentType: 'qa', rating: 'hard' },
      { date: '2026-06-30', instrumentType: 'qa', rating: 'again' },
      { date: '2026-07-10', instrumentType: 'qa', rating: 'again' },
      // `MAT-6`: successes on only TWO distinct days, one short of the
      // declared spacing gate (`MIN_SPACED_RETRIEVAL_DAYS`, 3) — which is what
      // keeps this concept at `sprout` under the high-water-mark model. It
      // used to succeed on four days and rely on the retired recent-window
      // rate to hold it down; a high-water mark has no such mechanism, and
      // "ten attempts, mostly failing, never yet reliable across spaced
      // attempts" is the honest shape of the story this row is telling.
      { date: '2026-07-21', instrumentType: 'qa', rating: 'again' },
      { date: '2026-08-05', instrumentType: 'qa', rating: 'again' },
      { date: '2026-08-20', instrumentType: 'qa', rating: 'again' },
    ],
  },
];

function slugOf(notePath) {
  return notePath
    .split('/')
    .pop()
    .replace(/\.md$/, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '');
}

function buildRecords(conceptKey, notePath, events) {
  const slug = slugOf(notePath);
  const instrumentId = `wb-fixture-oracle:${slug}`;
  return events.map((event, index) => {
    const isExplainBack = event.instrumentType === 'explain-back';
    const record = {
      schemaVersion: 5,
      kind: 'review',
      eventId: `wb-fixture-oracle:${slug}:${String(index)}`,
      timestamp: `${event.date}T09:00:00+00:00`,
      // An explain-back rides its own instrument id — one instrument is one
      // instrument type, and the qa id above is already taken.
      instrumentId: isExplainBack ? `${instrumentId}:explain-back` : instrumentId,
      instrumentType: event.instrumentType,
      conceptIds: [conceptKey],
      // F2.16: an explain-back produces no rating. Its verdict rides
      // `explainBackGrade` instead (`contracts/review-log.ts`).
      rating: isExplainBack ? null : event.rating,
      wasUnsure: false,
      durationMs: null,
      selectionContext: {
        dueState: 'due',
        examProximity: null,
        yieldRank: null,
        instrumentTypesOffered: [event.instrumentType],
        planVersion: null,
      },
      ...(isExplainBack
        ? {
            explainBackGrade: {
              soloLevel: event.soloLevel,
              // An opaque placeholder id, never text — the content store this
              // points into holds nothing for a synthetic fixture (D-005).
              contentRef: `wb-fixture-oracle:${slug}:grade:${String(index)}`,
              revisionOf: null,
              artifactProvenance: {
                taskId: 'explain-back-grade',
                promptVersion: 'wb-fixture-oracle',
                modelId: 'wb-fixture-oracle',
              },
            },
          }
        : {}),
    };
    // Throws with the zod issue list on any shape mistake — the same
    // schema `parseReviewLog` validates a real vault's log lines against.
    reviewLogEntry.parse(record);
    return record;
  });
}

function assertExpectedState(conceptKey, notePath, records, expectedState) {
  const { state } = computeConceptMastery(records, conceptKey);
  if (state !== expectedState) {
    throw new Error(
      `generate-fixture-oracle-history.mjs: ${notePath} was written to land on ` +
        `'${expectedState}' but computeConceptMastery says '${state}'. Fix the story, not the label.`,
    );
  }
}

async function main() {
  const vault = new FolderSource(fixtureVaultDir);
  const concepts = await extractConcepts(vault, { includeTier3: true });
  // A story names a concept by the note that anchors its identity —
  // `boundNotePath` (tier 1's Zettelkasten match, or tier 3's mint-on-mention).
  // That is NOT the same field as `sourcePaths`: `sourcePaths` is the material
  // that CITES a concept (its `topic:` taggers, plus — since the F1.3
  // course-attribution widening, `ol-2zfj.33` — any course-folder note that
  // plainly wikilinks it), and per `extract.ts`'s own `keyFor` doc a bound
  // concept's `sourcePaths` deliberately never contains the bound note's own
  // path. Before that widening, a Zettelkasten note with no `topic:` citation
  // anywhere surfaced only as a TIER 3 mint, whose `sourcePaths` IS `[boundNotePath]`
  // (self-referencing) — which is what let this script's original
  // sourcePaths-keyed lookup happen to match all four of this file's targets.
  // The widening promoted them to tier 1 (they're now reachable via a
  // course-folder wikilink), which is a legitimate, understood identity
  // change, not a regression — see `ol-kohr`. Fixing the lookup to key on
  // `boundNotePath` first makes it correct for either tier, rather than
  // correct by accident of which tier a concept happens to land in today.
  const byNotePath = new Map();
  for (const concept of concepts) {
    if (concept.boundNotePath !== undefined) {
      byNotePath.set(concept.boundNotePath, concept);
    } else {
      // A tier-2 concept has no bound note of its own; fall back to the
      // citing material so a future story targeting one of those paths still
      // resolves. Never overwrites a bound-note match.
      for (const path of concept.sourcePaths) {
        if (!byNotePath.has(path)) byNotePath.set(path, concept);
      }
    }
  }

  const allRecords = [];
  const storySummaries = [];
  for (const story of STORIES) {
    const concept = byNotePath.get(story.notePath);
    if (concept === undefined) {
      throw new Error(
        `generate-fixture-oracle-history.mjs: no concept extracted for ${story.notePath} — ` +
          'has the fixture vault changed, or does no concept bind to (or cite) this note ' +
          'path any more? This script targets real, current concept keys and must not fall ' +
          'back to a guessed one.',
      );
    }
    const records = buildRecords(concept.key, story.notePath, story.events);
    assertExpectedState(concept.key, story.notePath, records, story.expectedState);
    allRecords.push(...records);
    storySummaries.push(
      ` *   - ${concept.name} (${concept.key}) -> ${story.expectedState}, ${String(story.events.length)} event(s)`,
    );
  }

  const header = `/**
 * GENERATED by scripts/generate-fixture-oracle-history.mjs — do not hand-edit.
 * Regenerate with: node scripts/generate-fixture-oracle-history.mjs
 *
 * The fixture vault's OWN review history (\`ol-0v9n\`) — deterministic events
 * whose \`conceptIds\` are the real fixture vault's own concept keys (derived
 * from \`extractConcepts\` over \`packages/core/fixtures/vault/\`, never
 * hand-typed), replacing the borrowed synthetic-persona positional join
 * \`oracle/fixture-oracle.ts\` used to rely on. See the generator script's own
 * module doc for the full argument and the spread this produces:
 *
${storySummaries.join('\n')}
 *
 * Every record here is validated against \`olea-contracts\`' \`reviewLogEntry\`
 * schema and its intended C5.4 state is checked against
 * \`computeConceptMastery\` at generation time (see \`assertExpectedState\` in
 * the generator) — this file cannot silently drift from the state the module
 * doc above claims for it.
 */

import type { ReviewLogEntry } from 'olea-contracts';

export const FIXTURE_ORACLE_HISTORY: readonly ReviewLogEntry[] = ${JSON.stringify(allRecords, null, 2)};
`;

  await writeFile(OUTPUT_PATH, header, 'utf8');
  console.log(
    `generate-fixture-oracle-history.mjs: wrote ${String(allRecords.length)} record(s) to ${OUTPUT_PATH}`,
  );
}

await main();
