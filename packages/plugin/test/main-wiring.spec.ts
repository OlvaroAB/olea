/**
 * Scenario: `features/F2-review.md`, "F2.2 — the plugin's own wiring reaches
 * the review view" — @auto:plugin/main-wiring.spec.
 *
 * `main.ts` imports `obsidian`, whose `package.json` `main` is `""`, so it
 * cannot be loaded under Vitest at all — no fake, no shim, no import. That is a
 * documented constraint of this package and not a licence to leave the wiring
 * unasserted, because the specific defect this lane repaired was *entirely* a
 * wiring defect: `ReviewView` was complete and correct for three passes and
 * `main.ts` never called `registerView` for it, so the whole review feature was
 * unreachable while every test in the package stayed green.
 *
 * A source-level assertion is the only instrument that can catch that class of
 * regression, and this repo already uses the technique where it is the only one
 * available (`today/styles.spec.ts` asserts a stylesheet against the view that
 * emits its classes; `review/rating-source.spec.ts` asserts the absence of a
 * duplicate mapping). What it can check is *reachability* — that each surface
 * is registered and each entry point calls the composer. What it cannot check
 * is that Obsidian then does what its API says; that stays `@manual`, and the
 * two smoke scenarios in `features/F2-review.md` are exactly it.
 */

import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const srcDir = fileURLToPath(new URL('../src/', import.meta.url));

/** Source with prose removed — a doc paragraph describing the wiring must not satisfy an assertion about it. */
function codeOf(relativePath: string): string {
  return readFileSync(srcDir + relativePath, 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\/.*$/gm, '');
}

const main = codeOf('main.ts');

function everySourceFile(dir = ''): readonly string[] {
  const out: string[] = [];
  for (const entry of readdirSync(srcDir + dir, { withFileTypes: true })) {
    const path = dir + entry.name;
    if (entry.isDirectory()) out.push(...everySourceFile(`${path}/`));
    else if (entry.name.endsWith('.ts')) out.push(path);
  }
  return out.sort();
}

describe('the review view is registered, not merely written', () => {
  it('registers the review view type alongside the Today view', () => {
    expect(main).toMatch(/registerView\(\s*VIEW_TYPE_OLEA_REVIEW/);
    expect(main).toMatch(/registerView\(\s*VIEW_TYPE_OLEA_TODAY/);
  });

  it('constructs a real ReviewView against a session provider', () => {
    expect(main).toMatch(/new ReviewView\(\s*leaf,\s*\(\) => this\.composeReviewSession\(\),/);
  });

  it('composes that session through the tested composer, not inline here', () => {
    expect(main).toMatch(/openReviewSession\(\{/);
  });
});

describe('the Today panel refreshes after a review session closes — ol-h3wy', () => {
  // `TodayView.refresh` carried a doc comment saying it was "called by
  // main.ts after a session" while nothing called it — a completed review
  // wrote to the log and changed what was due, and the panel kept showing
  // whatever it had computed when it was opened. This is the source-level
  // check for the wiring `today/refresh.ts`'s module doc describes; the
  // dispatch logic itself is unit-tested directly in `test/today/refresh.spec.ts`
  // against fakes, since it does not import `obsidian`.

  it('ReviewView is given a close callback, not just the session provider', () => {
    expect(main).toMatch(
      /new ReviewView\(\s*leaf,\s*\(\) => this\.composeReviewSession\(\),\s*\(\) => \{\s*void this\.refreshTodayViews\(\);/,
    );
  });

  it('refreshTodayViews calls the tested mechanism against the real workspace and view type', () => {
    expect(main).toMatch(/refreshOpenTodayViews\(this\.app\.workspace,\s*VIEW_TYPE_OLEA_TODAY\)/);
  });

  it('revealing the Today panel refreshes it too, not only closing review', () => {
    // Covers the other half of "goes stale mid-review": switching to an
    // already-open Today tab without closing the review tab. Both call sites
    // go through the one method, asserted by count rather than by name so a
    // future rename cannot silently drop one.
    expect(main.match(/this\.refreshTodayViews\(\)/g)?.length).toBeGreaterThanOrEqual(2);
  });
});

describe('every port the session needs is the real one', () => {
  it.each([
    ['reviewLog', /reviewLog:\s*createVaultReviewLogPort\(vault, deviceId\)/],
    ['suspendPort', /suspendPort:\s*createVaultSuspendPort\(vault, deviceId\)/],
    ['editPort', /editPort:\s*createObsidianEditPort\(this\.app\)/],
    ['noteExists', /noteExists:\s*createVaultNoteExistsPort\(vault\)/],
    ['clock', /clock:\s*systemClock/],
  ])('%s is wired to its real implementation', (_name, pattern) => {
    expect(main).toMatch(pattern);
  });

  it('threads the stable device id into the review log, not a fresh one', () => {
    // `ensureDeviceId` is idempotent (`device-id.ts`): every call after the
    // first is a read of the already-persisted id, never a re-mint, so a
    // second call site does not split this install's history across two
    // filenames (C5.2). `onload` awaits it once, and the ingestion-tick
    // handler (`ol-2zfj.19`) awaits it again to thread the same id into
    // `createVaultMisconceptionStore` — there is no `this.deviceId` cache to
    // reuse instead. The count below tracks known call sites rather than
    // asserting "exactly once", so a future accidental duplicate still has to
    // be a deliberate edit to this test.
    expect(main.match(/ensureDeviceId\(/g)).toHaveLength(2);
  });
});

describe('both entry points reach the same session', () => {
  it('the "Start today’s review" command opens the view', () => {
    expect(main).toMatch(/startReview:\s*\(\)\s*=>\s*\{\s*void this\.revealReviewView\(\);/);
  });

  it("the Today panel's one action opens the same view, by the same call", () => {
    // Two call sites of one method, rather than two implementations: F6.1's
    // "Start review is the one way in" is only true if it is literally one way.
    expect(main.match(/this\.revealReviewView\(\)/g)?.length).toBeGreaterThanOrEqual(2);
  });

  it('reveals an existing review tab rather than stacking a second one', () => {
    expect(main).toMatch(/getLeavesOfType\(VIEW_TYPE_OLEA_REVIEW\)/);
    expect(main).toMatch(/revealLeaf/);
  });
});

describe('the placeholder is gone, not merely bypassed', () => {
  it('no module still imports or names startReviewPlaceholder', () => {
    const offenders = everySourceFile().filter((file) =>
      /startReviewPlaceholder/.test(codeOf(file)),
    );
    expect(offenders).toEqual([]);
  });

  it('card creation is still honestly a placeholder, because it is still unbuilt', () => {
    // The rule is "no placeholder beside a built feature", not "no
    // placeholders" — P2-T04 has not landed, and a silent no-op command would
    // be worse than one that says so.
    expect(main).toMatch(/createCard:\s*createCardPlaceholder/);
  });
});

describe('the settings tab reaches a real Worker transport (ol-k57j)', () => {
  // Same class of defect this file's own module doc opens with: a wiring gap
  // invisible to every component test because each one injects its own
  // double for exactly the seam that's missing in production. The seam here
  // is `WorkerTaskTransport` (`worker/transport.ts`'s module doc), and this
  // is what proves `main.ts` actually hands the tab a real,
  // `requestUrl`-backed factory rather than nothing at all.

  it('constructs the setting tab with itself as the data host and the real transport factory', () => {
    expect(main).toMatch(
      /new OleaSettingTab\(this\.app,\s*this,\s*this,\s*createRecordingTransport,\s*\{ vault, deviceId \}\)/,
    );
  });

  it('imports the real transport factory from worker/obsidian-transport, not a stub', () => {
    expect(main).toMatch(
      /import\s*\{\s*createObsidianWorkerTransport\s*\}\s*from\s*'\.\/worker\/obsidian-transport\.js'/,
    );
  });
});

describe('the keyword index store is actually constructed (ol-tuvx)', () => {
  // ol-tuvx's diagnosis, verbatim: `ObsidianKeywordIndexStore` was a
  // finished adapter named only inside a comment about the narrow-port
  // pattern it follows — nothing ever called `new
  // ObsidianKeywordIndexStore(...)`. These are the source-level checks that
  // the specific defect (never constructed, not merely untested) cannot
  // recur silently: every unit test for the store and the engine already
  // passed while this gap existed, because each one supplies its own fake
  // of exactly the seam that was missing here.

  it('constructs a real ObsidianKeywordIndexStore over itself as the data host', () => {
    expect(main).toMatch(/store:\s*new ObsidianKeywordIndexStore\(this\)/);
  });

  it('builds the keyword index wiring through the tested composer, not inline here', () => {
    expect(main).toMatch(/this\.keywordIndex\s*=\s*await buildKeywordIndexWiring\(\{/);
  });

  it('wires the real vault event stream into it, not a no-op watcher', () => {
    expect(main).toMatch(/watch:\s*\(handler\)\s*=>\s*vault\.watch\(handler\)/);
  });

  it('registers the unsubscribe for teardown, so onunload actually stops it', () => {
    expect(main).toMatch(/this\.register\(this\.keywordIndex\.unsubscribe\)/);
  });
});

describe('the embedding cache is actually drained (ol-odb0.1)', () => {
  // Same defect shape as ol-tuvx and the review-view gap this file opens
  // with, one layer up: `EmbeddingCacheEngine`, `WorkerEmbeddingProvider`
  // and `PendingIndexingSink` all had their own component tests, and none
  // of them proved anything called the composition that ties them together
  // in production.

  it('builds the retrieval wiring through the tested composer, against the real data host and the real transport factory', () => {
    expect(main).toMatch(
      /this\.retrieval\s*=\s*await buildRetrievalWiring\(\{\s*dataHost:\s*this,\s*createTransport:\s*createRecordingTransport,/,
    );
  });

  it('the ingestion tick interval also drains embeddings, not just the queue', () => {
    expect(main).toMatch(
      /void this\.tickIngestionAndMaybeRunCorpusRelations\(\);\s*void this\.drainEmbeddings\(capability\);/,
    );
  });

  it('the drain is gated on device capability (D-002\'s "mobile enqueues, desktop drains", generalised)', () => {
    expect(main).toMatch(/if\s*\(!capability\.canDrain\)\s*return;/);
  });

  it('feeds both the ingestion sink and the keyword index into the drain', () => {
    expect(main).toMatch(/sink:\s*this\.ingestion\.sink,/);
    expect(main).toMatch(/keywordIndex:\s*this\.keywordIndex\.engine/);
  });
});

describe('the explain-back grading pipeline has a real production caller (ol-drfy)', () => {
  // Same defect shape this file's own module doc opens with, one layer up
  // again: `gradeExplainBack` and the `JudgeCaller` port (`ol-p4t02`) were
  // closed with an implementation and a caller nowhere outside their own
  // module and specs — the wiring register's `JudgeCaller` finding. These
  // assertions are the source-level proof that `main.ts` composes a real
  // `WorkerJudgeCaller` over the real transport, not a fake, and that a real
  // (if not yet invoked-by-anything-else) call to `gradeExplainBack` exists
  // in production code — see `grading/wiring.ts`'s module doc for why
  // nothing currently invokes `gradeExplainBackAttempt` in turn.

  it('builds the grading wiring through the tested composer, against the real data host and the real transport factory', () => {
    expect(main).toMatch(
      /this\.grading\s*=\s*await buildGradingWiring\(\{\s*dataHost:\s*this,\s*createTransport:\s*createRecordingTransport,/,
    );
  });

  it('exposes a production entry point that reaches gradeExplainBack through the composed wiring', () => {
    expect(main).toMatch(
      /async gradeExplainBackAttempt\(\s*input:\s*GradeExplainBackInput,\s*\):\s*Promise<PendingExplainBackGrading \| null> \{\s*if \(this\.grading === null\) return null;\s*return gradeExplainBackAttempt\(this\.grading, input\);/,
    );
  });
});

describe('F2.12 confusion routing has a real production entry point (ol-p4t05)', () => {
  // `grading/wiring.ts`'s module doc names `ol-p4t05` as the intended next
  // caller of `gradeExplainBackAttempt` above: routing a repeated card
  // failure INTO the explain-back pipeline. This is the source-level proof
  // that a real, composed decision function (`evaluateConfusionRouting`,
  // delegating to `olea-core`'s pure F2.12 logic) now exists as a production
  // method on the plugin class — reachable the moment the review rating flow
  // (a concurrently-owned lane's files, `review/**`, not this bead's) wires
  // the call site. See `grading/wiring.ts`'s own doc for why nothing
  // currently invokes `evaluateConfusionRouting` in turn.

  it('exposes a production entry point that evaluates confusion routing through the composed wiring', () => {
    expect(main).toMatch(
      /evaluateConfusionRouting\(input:\s*ConfusionRoutingInput\):\s*ConfusionRoutingDecision \{\s*return evaluateConfusionRouting\(input\);/,
    );
  });

  it('imports the composed decision function from grading/wiring, not a bare re-export of olea-core', () => {
    expect(main).toMatch(
      /import\s*\{\s*buildGradingWiring,\s*evaluateConfusionRouting,\s*type GradingWiring,\s*gradeExplainBackAttempt,\s*\}\s*from\s*'\.\/grading\/wiring\.js'/,
    );
  });
});

describe('the concept-reading stage has a real production caller (EXT-7, ol-5nle)', () => {
  // Same defect shape as `JudgeCaller` above, one bead earlier in the same
  // ownership chain: `readConcepts` and `ConceptReaderPort` (`ol-2zfj.1`)
  // were closed with the reading stage complete and the port deliberately
  // unimplemented — the D-072 escape hatch, and the wiring register's
  // `ConceptReaderPort` finding. These assertions are the source-level proof
  // that `main.ts` composes a real `WorkerConceptReader` over the real
  // transport, not a fake, and that a real (if not yet invoked-by-anything-
  // else) call to `readConcepts` exists in production code — see
  // `concept/wiring.ts`'s module doc for why nothing currently invokes
  // `readConceptsFromVault` in turn.

  it('builds the concept wiring through the tested composer, against the real data host and the real transport factory', () => {
    expect(main).toMatch(
      /this\.concept\s*=\s*await buildConceptWiring\(\{\s*dataHost:\s*this,\s*createTransport:\s*createRecordingTransport,/,
    );
  });

  it('exposes a production entry point that reaches readConcepts through the composed wiring', () => {
    expect(main).toMatch(
      /async readConceptsFromVault\(options:\s*ReadConceptsFromVaultOptions\s*=\s*\{\}\)\s*\{\s*if \(this\.concept === null\) return null;\s*return readConceptsFromVault\(this\.concept, new ObsidianSource\(this\.app\), options\);/,
    );
  });
});

describe('the gap/coverage screen is registered and reachable (ol-2tyj)', () => {
  // `GapView` and `createLocalGapProvider` were both complete and tested —
  // this is the same defect shape this file's own module doc opens with:
  // nothing in `main.ts` ever called `registerView` for it or gave it a
  // production caller.

  it('registers the gap view type alongside Review and Today', () => {
    expect(main).toMatch(/registerView\(\s*VIEW_TYPE_OLEA_GAP/);
  });

  it('constructs a real GapView against the real, on-device provider', () => {
    expect(main).toMatch(
      /new GapView\(\s*leaf,\s*createLocalGapProvider\(\{\s*vault,\s*deviceId,\s*settingsHost:\s*this,/,
    );
  });

  it('the command palette entry opens it', () => {
    expect(main).toMatch(/openGap:\s*\(\)\s*=>\s*\{\s*void this\.revealGapView\(\);/);
  });

  it('reveals an existing leaf rather than stacking a second one, same shape as Today', () => {
    expect(main).toMatch(/getLeavesOfType\(VIEW_TYPE_OLEA_GAP\)/);
    expect(main.match(/revealLeaf/g)?.length).toBeGreaterThanOrEqual(3);
  });

  it('refreshes open gap leaves alongside the background study-plan refresh', () => {
    expect(main).toMatch(
      /if \(this\.review !== null\) this\.review\.plan = result\.plan;\s*void this\.refreshGapViews\(\);/,
    );
  });

  it('refreshGapViews reuses the tested Today-refresh mechanism against the real workspace and the gap view type', () => {
    expect(main).toMatch(/refreshOpenTodayViews\(this\.app\.workspace,\s*VIEW_TYPE_OLEA_GAP\)/);
  });
});

describe('the bulk-review triage view is registered and reachable (F3.3, ol-jie3)', () => {
  // Same defect shape this file's own module doc opens with: `BulkReviewController`
  // and `BulkReviewView` are both complete and tested (`bulk-review.spec.ts`), and
  // this is the source-level proof that `main.ts` actually registers the view,
  // wires it to the real cache/accept-port/edit-port, and gives the command
  // palette a real handler — the D-072 reachability chain, by file:line.

  it('registers the bulk-review view type', () => {
    expect(main).toMatch(/registerView\(\s*VIEW_TYPE_OLEA_BULK_REVIEW/);
  });

  it('constructs a real BulkReviewView against a controller factory', () => {
    expect(main).toMatch(/new BulkReviewView\(\s*leaf,\s*\(\)\s*=>\s*createBulkReviewController\(/);
  });

  it('wires the controller to the real cache, the real accept port, and a real edit port', () => {
    expect(main).toMatch(/cache:\s*generationWiring\.cache,/);
    expect(main).toMatch(/acceptPort:\s*generationWiring\.acceptPort,/);
    expect(main).toMatch(/editPort:\s*createObsidianEditPort\(this\.app\),/);
  });

  it('the "Review drafts in bulk" command opens the view', () => {
    expect(main).toMatch(/openBulkReview:\s*\(\)\s*=>\s*\{\s*void this\.revealBulkReviewView\(\);/);
  });

  it('reveals an existing leaf rather than stacking a second one, same shape as Gap/Today/Session', () => {
    expect(main).toMatch(/getLeavesOfType\(VIEW_TYPE_OLEA_BULK_REVIEW\)/);
    expect(main).toMatch(/refreshOpenTodayViews\(workspace,\s*VIEW_TYPE_OLEA_BULK_REVIEW\)/);
  });
});

describe("component 3.3's delivered ranking weights have a real production caller ([D-110], ol-v7r5.3)", () => {
  // Same defect shape this file's own module doc opens with: `rank-weights-provider.ts`,
  // `rank/wiring.ts` and their fetch/decode logic were all complete and tested
  // (`test/rank/*.spec.ts`) while nothing in `main.ts` ever called
  // `buildRankWeightsWiring` or threaded its result into
  // `createLocalStudyPlanProvider` — ol-v7r5.3's own close evidence recorded the
  // exact seam as not yet crossed because `main.ts` was a live concurrent lane's
  // file at the time. These assertions are the source-level proof that the seam
  // is now crossed.

  it('builds the rank-weights wiring through the tested composer, against the real data host and the real HTTP GET adapter', () => {
    expect(main).toMatch(
      /this\.rankWeights\s*=\s*await buildRankWeightsWiring\(\{\s*dataHost:\s*this,\s*httpGet:\s*obsidianRankWeightsGet,/,
    );
  });

  it('imports the real composer and transport adapter, not stubs', () => {
    expect(main).toMatch(
      /import\s*\{\s*obsidianRankWeightsGet\s*\}\s*from\s*'\.\/rank\/obsidian-rank-weights-transport\.js'/,
    );
    expect(main).toMatch(
      /import\s*\{\s*buildRankWeightsWiring,\s*type RankWeightsWiring\s*\}\s*from\s*'\.\/rank\/wiring\.js'/,
    );
  });

  it('threads the delivered weights into the study-plan provider, omitting the key when unconfigured rather than passing undefined (exactOptionalPropertyTypes, F7.8)', () => {
    expect(main).toMatch(
      /\.\.\.\(this\.rankWeights\?\.readRankWeights\s*\?\s*\{ readRankWeights: this\.rankWeights\.readRankWeights \}\s*:\s*\{\}\)/,
    );
  });
});

describe('the materiality trigger is actually constructed and fed (ol-2zfj.15)', () => {
  // Same defect shape this file's own module doc opens with: `buildMaterialityWiring`,
  // `MaterialityTrigger` and every free gate under `ingestion/materiality/` were
  // complete and unit-tested (`test/ingestion/materiality/*.spec.ts`), and
  // `wiring.ts`'s own module doc named the exact gap — nothing in this package
  // ever called `buildMaterialityWiring`. These are the source-level checks
  // that the specific defect (never constructed, not merely untested) cannot
  // recur silently.

  it('builds the materiality wiring through the tested composer, against the real data host, with the transport-backed judge (ol-2zfj.18)', () => {
    expect(main).toMatch(
      /this\.materiality\s*=\s*buildMaterialityWiring\(\{\s*dataHost:\s*this,\s*clock:\s*\{\s*now:\s*\(\)\s*=>\s*Date\.now\(\)\s*\},\s*judge:\s*this\.buildMaterialityJudge\(\),/,
    );
  });

  it('the judge helper degrades to null on the same unconfigured-Worker condition as every other AI-gated wiring (F7.8)', () => {
    expect(main).toMatch(
      /private buildMaterialityJudge\(\): WorkerMaterialityJudge \| null \{\s*const transport = this\.retrieval\?\.transport;\s*if \(transport === null \|\| transport === undefined\) return null;\s*return new WorkerMaterialityJudge\(\{ transport \}\);/,
    );
  });

  it('wires the real vault event stream into it, filtered to modify events', () => {
    expect(main).toMatch(
      /vault\.watch\(\(event\)\s*=>\s*\{\s*if\s*\(event\.kind\s*!==\s*'modify'\)\s*return;\s*void this\.evaluateMaterialityChange\(vault,\s*event\.path\);/,
    );
  });

  it('registers that subscription for teardown', () => {
    expect(main).toMatch(/this\.register\(\s*vault\.watch\(\(event\)/);
  });

  it('feeds the trigger from a real file read, tracked previous-text, and never lets a failure propagate', () => {
    expect(main).toMatch(/currentText = await vault\.read\(path\);/);
    expect(main).toMatch(
      /await this\.materiality\.evaluate\(path,\s*currentText,\s*previousText\);/,
    );
    expect(main).toMatch(/this\.materialityPreviousText\.record\(path,\s*currentText\);/);
  });

  it('imports the real composer and the real previous-text tracker, not stubs', () => {
    expect(main).toMatch(
      /import\s*\{\s*buildMaterialityWiring,\s*type MaterialityEvaluationResult,\s*type MaterialityTrigger,?\s*\}\s*from\s*'\.\/ingestion\/materiality\/wiring\.js'/,
    );
    expect(main).toMatch(
      /import\s*\{\s*createInMemoryPreviousTextTracker,\s*type PreviousTextTracker,?\s*\}\s*from\s*'\.\/ingestion\/materiality\/previous-text\.js'/,
    );
  });
});

describe('C7.9 containment relations reach both session-composition call sites (ol-v7r5.7)', () => {
  // `session/build.ts`'s own module doc named this exact gap: `this.relations`
  // was folded on every ingestion-session close and read by nothing, so the
  // containment co-presence filter (`session/containment.ts`) was a no-op in
  // both real callers. These are the source-level proof that both now pass
  // the live, served fold rather than omitting `relations` — the same
  // reachability shape this file's own module doc opens with.

  it('holds the served-edges helper over the live relation fold, never re-deriving null per call site', () => {
    expect(main).toMatch(
      /private servedRelationEdges\(\):\s*readonly ConceptRelation\[\]\s*\{\s*return this\.relations === null \? \[\] : servedRelations\(this\.relations\);/,
    );
  });

  it('composeReviewSession (the review command) threads it into openReviewSession', () => {
    expect(main).toMatch(/relations:\s*this\.servedRelationEdges\(\),\s*\}\);/);
  });

  it("the Today panel's instrument source is given the same fold", () => {
    expect(main).toMatch(
      /instruments:\s*createVaultInstrumentSource\(\{\s*vault,\s*scheduler,\s*deviceId,\s*now:\s*\(\)\s*=>\s*new Date\(\),[\s\S]*?relations:\s*this\.servedRelationEdges\(\),\s*\}\),/,
    );
  });

  it('imports servedRelations from olea-core, not a local reimplementation', () => {
    expect(main).toMatch(/servedRelations,/);
  });
});

describe('F6.9 rhythm plumbing has real production wiring (ol-v7r5.6)', () => {
  // `packages/core/src/today/rhythm.ts`'s own module doc named the one input
  // with anywhere to come from — a per-course last-material-arrival
  // timestamp — and said nothing built it. These are the source-level checks
  // that `main.ts` actually records one, on the materiality trigger path, and
  // actually threads the result into the Today panel.

  it('builds both rhythm stores unconditionally in onload, alongside the materiality trigger', () => {
    expect(main).toMatch(/this\.materialArrivals\s*=\s*new ObsidianMaterialArrivalStore\(this\);/);
    expect(main).toMatch(/this\.termWindowStore\s*=\s*new ObsidianTermWindowStore\(this\);/);
  });

  it('records an arrival from the real materiality-evaluation result, not on every raw edit', () => {
    expect(main).toMatch(
      /const result = await this\.materiality\.evaluate\(path, currentText, previousText\);\s*await this\.recordMaterialArrivalIfObserved\(path, currentText, result\);/,
    );
    expect(main).toMatch(
      /result\.kind === 'judge-unavailable' \|\| \(result\.kind === 'verdict' && result\.verdict\.material\)/,
    );
  });

  it('derives course association the same way concept extraction does — her frontmatter, then the course folder', () => {
    expect(main).toMatch(
      /notePathCourses\(path, fm === null \? \[\] : readList\(fm, 'course'\)\.items\)/,
    );
  });

  it("the Today panel's load call is given the real rhythm source, not omitted", () => {
    expect(main).toMatch(
      /rhythm:\s*createRhythmSource\(\{\s*materialArrivals:\s*this\.materialArrivals,\s*termWindow:\s*this\.termWindowStore,\s*\}\),/,
    );
  });

  it('imports the real stores and composer, not stubs', () => {
    expect(main).toMatch(
      /import\s*\{\s*ObsidianMaterialArrivalStore\s*\}\s*from\s*'\.\/today\/material-arrival-store\.js'/,
    );
    expect(main).toMatch(
      /import\s*\{\s*ObsidianTermWindowStore\s*\}\s*from\s*'\.\/today\/term-window-store\.js'/,
    );
    expect(main).toMatch(/createRhythmSource,/);
  });
});

describe("TRG-1's material verdict is a second consumer feeding F3.3's generation sweep, for the authored-note case (ol-0r92.12, [AUTH-1b])", () => {
  // `findings/sis4-authored-generation.md` (private, `ol-sis4`) traced the
  // exact gap: F3.3's generation hook only ever fired from a drained
  // ingestion job over the four non-markdown formats `KNOWN_FORMATS` covers,
  // so a markdown note she authors herself could never reach it. David's
  // ruled mechanism (2026-08-28): TRG-1's material-change verdict, already
  // computed for F6.9 on every note vault-wide, becomes a second caller of
  // the SAME `onUnitsLanded` hook the ingestion path drives — no fifth
  // ingestion format, no markdown ingestion path. These are the
  // source-level checks that the second caller actually exists and reuses
  // the same materiality gate rather than inventing its own.

  it('evaluateMaterialityChange calls the new consumer right alongside the F6.9 one, from the same verdict', () => {
    expect(main).toMatch(
      /const result = await this\.materiality\.evaluate\(path, currentText, previousText\);\s*await this\.recordMaterialArrivalIfObserved\(path, currentText, result\);\s*await this\.triggerAuthoredNoteGenerationIfObserved\(path, currentText, result\);/,
    );
  });

  it('the new consumer is gated on the SAME observedMaterialChange reading as F6.9 — no independent debounce', () => {
    expect(main).toMatch(
      /private observedMaterialChange\(result: MaterialityEvaluationResult\): boolean \{\s*return \(\s*result\.kind === 'judge-unavailable' \|\| \(result\.kind === 'verdict' && result\.verdict\.material\)\s*\);\s*\}/,
    );
    expect(main).toMatch(
      /private async recordMaterialArrivalIfObserved\(\s*path: VaultPath,\s*currentText: string,\s*result: MaterialityEvaluationResult,\s*\): Promise<void> \{\s*if \(this\.materialArrivals === null\) return;\s*if \(!this\.observedMaterialChange\(result\)\) return;/,
    );
    expect(main).toMatch(
      /private async triggerAuthoredNoteGenerationIfObserved\(\s*path: VaultPath,\s*currentText: string,\s*result: MaterialityEvaluationResult,\s*\): Promise<void> \{\s*if \(!this\.observedMaterialChange\(result\)\) return;/,
    );
  });

  it('synthesises exactly one ExtractedUnit whose embeddedIn.notePath is the note itself — no new ingestion format', () => {
    expect(main).toMatch(
      /embeddedIn:\s*\{\s*notePath:\s*path,\s*blockStart:\s*0,\s*blockEnd:\s*currentText\.length\s*\},/,
    );
  });

  it('delegates to onUnitsLanded — the SAME F3.3 hook the ingestion path calls, not a second sweep entry point', () => {
    expect(main).toMatch(/await this\.onUnitsLanded\(\[unit\]\);/);
  });
});

describe('the withdrawn draft-cards command does not exist (F4.5)', () => {
  // `OLEA_COMMAND_DRAFT_CARDS` / `DraftCardsModal` shipped in wave-2 round-2
  // and was withdrawn: F4.5 rules out a student-invoked draft verb by name
  // ("there is no 'Draft 6?' — because Olea is already drafting",
  // `[D-063]`). This is the reachability check's mirror image — proving the
  // surface is GONE, not merely proving something else is present, so a
  // future re-add of the command or the modal fails here rather than
  // sailing back in silently.

  it('main.ts never references the withdrawn modal or handler', () => {
    expect(main).not.toMatch(/DraftCardsModal/);
    expect(main).not.toMatch(/openDraftCardsModal/);
    expect(main).not.toMatch(/draftCards:/);
  });
});

describe('C7.8 course detection has a real trigger and a real host (ol-0r92.7)', () => {
  // `course-setup/confirmation-view.ts`'s own module doc named this exact
  // gap: the confirmation surface renders into any container it is given,
  // but nothing in the plugin ever gave it one, and nothing ever called
  // `detectCourseProposals` to decide when to. These are the source-level
  // checks that both now have a real caller in `onload`, following this
  // file's own established shape for a wiring defect a mocked-port test
  // cannot see.

  it('imports the real detector from olea-core and the real modal host, not stubs', () => {
    expect(main).toMatch(/detectCourseProposals,/);
    expect(main).toMatch(
      /import\s*\{\s*CourseSetupModal\s*\}\s*from\s*'\.\/course-setup\/setup-modal\.js'/,
    );
  });

  it('watches create/rename events, not modify — a new course code arrives only through those', () => {
    expect(main).toMatch(
      /if\s*\(event\.kind\s*!==\s*'create'\s*&&\s*event\.kind\s*!==\s*'rename'\)\s*return;\s*this\.checkForCourseSetupProposals\(vault\);/,
    );
  });

  it('runs a cold-start scan in onload without awaiting it', () => {
    expect(main).toMatch(/this\.checkForCourseSetupProposals\(vault\);/);
  });

  it('lists the vault and calls the real olea-core detector against the session-seen set', () => {
    expect(main).toMatch(
      /const proposals:\s*readonly CourseDetectionProposal\[\]\s*=\s*detectCourseProposals\(\s*paths,\s*this\.courseSetupSeenCodes,\s*\);/,
    );
  });

  it('opens the real modal host with the proposal, never a placeholder', () => {
    expect(main).toMatch(
      /new CourseSetupModal\(this\.app,\s*\{\s*proposal:\s*\{\s*suggestedName:\s*next\.code,\s*rootPath:\s*next\.rootPath\s*\},/,
    );
  });

  it('confirming marks the code seen and chains to the next detected proposal, rather than stacking modals', () => {
    expect(main).toMatch(
      /onConfirm:\s*\(result\)\s*=>\s*\{\s*this\.courseSetupModalOpen = false;\s*new Notice\(`Olea: "\$\{result\.name\}" confirmed as a course\.`\);\s*void this\.openNextCourseSetupProposal\(vault\);/,
    );
  });

  it('dismissing (no confirm) also chains to the next proposal, so one unanswered modal cannot block the rest', () => {
    expect(main).toMatch(
      /onDismiss:\s*\(\)\s*=>\s*\{\s*this\.courseSetupModalOpen = false;\s*void this\.openNextCourseSetupProposal\(vault\);/,
    );
  });

  it('never persists a CourseRecord at the confirmation call site — no store or schema import for one', () => {
    expect(main).not.toMatch(/CourseRecord/);
    expect(main).not.toMatch(/ObsidianCourseStore/);
  });
});
