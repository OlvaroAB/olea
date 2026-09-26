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
    expect(main).toMatch(
      /new ReviewView\(\s*leaf,\s*\(\) => this\.composeReviewSession\(reviewSessionOpener\),/,
    );
  });

  it('composes that session through the tested composer, not inline here', () => {
    // `ol-v7r5.35` (`[D-193]`): `composeReviewSession` no longer calls
    // `openReviewSession` inline — it routes through `ReviewSessionOpener.open`
    // (`open-session.ts`, `open-session.spec.ts`'s own suite), which is the
    // one real caller of `openReviewSession` now, one closure per opened tab.
    expect(main).toMatch(/const outcome = await opener\.open\(input\);/);
  });
});

describe('ReviewView reads the composition sentence through the shared study-session holder (F2.22/F6.4, ol-egov.141.89.10.60)', () => {
  // `main.ts` cannot be loaded under Vitest (it imports `obsidian`), so this
  // is the source-level pin for the `getFocusReason` callback `ReviewView`'s
  // own constructor doc names as its real wiring site.
  // `test/session-builder/provider.spec.ts`'s "the composed session's
  // focusReason reaches SessionBuilderState" suite reproduces this exact
  // guard against a real `StudySessionHolder` and proves it resolves active
  // vs. idle correctly — that behaviour cannot be checked here.

  it('passes a getFocusReason callback as the last ReviewView argument, reading the shared holder', () => {
    expect(main).toMatch(
      /\(\) => reviewSessionOpener\.close\(\),\s*\(\) => \{\s*const sitting = this\.studySessionHolder\.getSitting\(\);\s*return sitting\.status === 'active' \? sitting\.items\.focusReason : undefined;\s*\},\s*\);/,
    );
  });

  it('reads this.studySessionHolder — the SAME single instance enterStudySessionHolderForStart enters/exits, never a second one', () => {
    expect(main).toMatch(
      /private readonly studySessionHolder: StudySessionHolder = createStudySessionHolder\(\);/,
    );
    // Constructed exactly once on the class; every reader (including this
    // callback) goes through `this.studySessionHolder`.
    expect(main.match(/createStudySessionHolder\(\)/g)?.length).toBe(1);
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
      /new ReviewView\(\s*leaf,\s*\(\) => this\.composeReviewSession\(reviewSessionOpener\),\s*\(\) => \{\s*void this\.refreshTodayViews\(\);/,
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
    ['reviewLog', /reviewLog:\s*createVaultReviewLogPort\(vault, deviceId, this\.now\)/],
    ['suspendPort', /suspendPort:\s*createVaultSuspendPort\(vault, deviceId, this\.now\)/],
    [
      'explainBackOfferLog',
      /explainBackOfferLog:\s*createVaultExplainBackOfferLogPort\(vault, deviceId, this\.now\)/,
    ],
    ['editPort', /editPort:\s*createObsidianEditPort\(this\.app\)/],
    ['noteExists', /noteExists:\s*createVaultNoteExistsPort\(vault\)/],
    // `ol-3ux7.64.9` [WBX-8]: `{ now: this.now }`, not the `systemClock`
    // singleton by reference — see `main.ts`'s own comment on this line for
    // why a bare `this.clock` would freeze today's clock into this port.
    ['clock', /clock:\s*\{\s*now:\s*this\.now\s*\}/],
  ])('%s is wired to its real implementation', (_name, pattern) => {
    expect(main).toMatch(pattern);
  });

  it('threads the stable device id into the review log, not a fresh one', () => {
    // `ensureDeviceId` is idempotent (`device-id.ts`): every call after the
    // first is a read of the already-persisted id, never a re-mint, so a
    // further call site does not split this install's history across two
    // filenames (C5.2). `onload` awaits it once, the ingestion-tick handler
    // (`ol-2zfj.19`) awaits it again to thread the same id into
    // `createVaultMisconceptionStore`, the citation-revision batch pass
    // (`ol-2zfj.35` [CORP-3b]) awaits it a third time to thread the same id
    // into `createVaultSuspendPort`, `ol-12gs`'s
    // `buildExplainBackObservationContextFor` awaits it a fourth time to
    // thread the same id into its OWN `createVaultMisconceptionStore` read
    // (the accept-and-observe step's misconception-record lookup),
    // `ol-38kp`'s `recordExplainBackSoloGradeAndReview` awaits it a fifth
    // time to thread the same id into `recordSoloGradeAndReview`'s SOLO
    // review-log write, `ol-2zfj.75`'s
    // `buildExplainBackMisconceptionDigestFor` awaits it a sixth time to
    // thread the same id into its OWN `createVaultMisconceptionStore` read
    // (the judge digest's misconception-record lookup), and `ol-0r92.90`'s
    // `persistMisconceptionObservations` awaits it a seventh time to thread
    // the same id into `appendMisconceptionEvent`'s own vault write (the
    // accepted observation event's persistence, keyed to the SAME device
    // this attempt's misconception-record lookup above already used), and
    // `ol-egov.141.89.6.41`'s `recordExplainBackNonAttempt` awaits it an
    // eighth time to thread the same id into `appendNonAttemptRecord`'s own
    // vault write (the on-demand explain-back skip/close event), and
    // `ol-egov.141.89.9.49`'s `openNextCourseSetupProposal` awaits it a
    // ninth time to thread the same id into
    // `readCourseSetupRecognitions`'s own `readReviewHistory` read (F8.7's
    // proposal-time recognition claims) —
    // there is no `this.deviceId` cache to reuse instead in any of the
    // nine. The count below tracks known call sites rather than asserting
    // "exactly once", so a future accidental duplicate still has to be a
    // deliberate edit to this test.
    expect(main.match(/ensureDeviceId\(/g)).toHaveLength(9);
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

  // `ol-0r92.76`: card creation (F2.1) is no longer a placeholder for its
  // cloze branch — `createCardPlaceholder` and `commands/placeholders.ts`
  // are both gone, the same "swap, don't leave both standing" shape this
  // file's own module doc already states for `startReviewPlaceholder` above.
  it('no module still imports or names createCardPlaceholder', () => {
    const offenders = everySourceFile().filter((file) =>
      /createCardPlaceholder/.test(codeOf(file)),
    );
    expect(offenders).toEqual([]);
  });

  it('"Olea: Create card" is wired to the real handler, not a placeholder', () => {
    expect(main).toMatch(/createCard:\s*\(\)\s*=>\s*\{\s*void this\.handleCreateCardCommand\(\);/);
  });

  it('the create-card handler reads the active note and resolves through create-card.ts, not a re-implementation', () => {
    expect(main).toMatch(
      /import\s*\{\s*createCardNoticeText,\s*createQaCardFromEntry,\s*resolveCreateCardOutcome,?\s*\}\s*from\s*'\.\/commands\/create-card\.js'/,
    );
    expect(main).toMatch(/resolveCreateCardOutcome\(source,\s*\{\s*start,\s*end\s*\}\)/);
  });

  // `ol-0r92.77` (`[D-268]` / [H-qa-card-modal]): F2.1's Q&A half is now
  // reachable too — a no-selection invocation opens `QaCardModal` in place
  // of the honest "not yet" notice this branch used to give, and confirming
  // resolves through `create-card.ts`'s `createQaCardFromEntry`.
  it('a no-selection outcome opens QaCardModal (F2.1 Q&A half, `[D-268]`), not a placeholder notice', () => {
    expect(main).toMatch(
      /import\s*\{\s*QaCardModal\s*\}\s*from\s*'\.\/commands\/qa-card-modal\.js'/,
    );
    expect(main).toMatch(/outcome\.kind === 'no-selection'/);
    expect(main).toMatch(/new QaCardModal\(this\.app,/);
    expect(main).toMatch(
      /createQaCardFromEntry\(\{\s*source,\s*cursorOffset,\s*front,\s*back\s*\}\)/,
    );
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
      /new OleaSettingTab\(\s*this\.app,\s*this,\s*this,\s*createRecordingTransport,\s*\{ vault, deviceId, now: this\.now \},\s*headingOfferSetting,?\s*\)/,
    );
  });

  it('imports the real transport factory from worker/obsidian-transport, not a stub', () => {
    expect(main).toMatch(
      /import\s*\{\s*createObsidianWorkerTransport,\s*obsidianHttpRequest\s*\}\s*from\s*'\.\/worker\/obsidian-transport\.js'/,
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

describe('the SOLO review-log write has a real production caller (ol-38kp)', () => {
  // `ol-cqz8` built the tested composition (`explain-back/solo-review.ts`'s
  // `recordSoloGradeAndReview`, wired optionally into `ExplainBackModal`'s
  // `acceptGrading`) but left `main.ts`'s `openExplainBackModal` deps
  // literal without a real instance — the exact defect shape this file's
  // own module doc opens with, one hop further down the same chain
  // `gradeExplainBackAttempt`/`acceptExplainBackGradingWithObservation`
  // above already guard against. These assertions are the source-level
  // proof that a real instance is now supplied, built from the same
  // `GradingWiring`/vault/deviceId construction
  // `buildExplainBackObservationContextFor` already uses for its sibling
  // call just above it.

  it('exposes a production entry point that reaches recordSoloGradeAndReview through the composed grading wiring, guarded on this.grading', () => {
    expect(main).toMatch(
      /async recordExplainBackSoloGradeAndReview\(params:\s*\{[\s\S]*?\}\):\s*Promise<SoloLevel \| undefined> \{\s*if \(this\.grading === null\) return;\s*const outcome = await recordSoloGradeAndReview\(\s*\{\s*grading:\s*this\.grading,\s*vault:\s*new ObsidianSource\(this\.app\),\s*deviceId:\s*await ensureDeviceId\(this\),\s*now:\s*this\.now,\s*\},\s*params,\s*\);/,
    );
  });

  // `ol-iti2` (`[D-217]`): the wrapper forwards the graded level on rather
  // than discarding it — the render path `renderAcceptedPhase` needs to
  // ever take the "level present" branch in production.
  it('forwards the graded SoloLevel back out rather than discarding it', () => {
    expect(main).toMatch(/return outcome\?\.soloLevel;\s*\}/);
  });

  it("supplies that entry point as ExplainBackModal's recordSoloGradeAndReview dep", () => {
    expect(main).toMatch(
      /recordSoloGradeAndReview:\s*\(params\) => this\.recordExplainBackSoloGradeAndReview\(params\),/,
    );
  });

  it('imports recordSoloGradeAndReview from the tested composition module, not a bare re-export', () => {
    expect(main).toMatch(
      /import \{ recordSoloGradeAndReview \} from '\.\/explain-back\/solo-review\.js';/,
    );
  });
});

describe('the explain-back judge digest has a real production caller (ol-2zfj.75, C7.9/F5.6)', () => {
  // `ol-2zfj.70` built `buildMisconceptionDigest` (`olea-core`) and
  // `request.ts`/`modal.ts` already threaded a `misconceptionDigest` field
  // end to end, but nothing ever called `buildMisconceptionDigest` to
  // populate it — every explain-back attempt graded with an empty digest
  // regardless of real history. These assertions are the source-level proof
  // that a real load now happens, off the SAME `createVaultMisconceptionStore`
  // instance `buildExplainBackObservationContextFor` already uses for its
  // sibling read just above it.

  it('exposes a production entry point that loads a real digest off a fresh misconception-store read', () => {
    expect(main).toMatch(
      /async buildExplainBackMisconceptionDigestFor\(\s*conceptIds:\s*readonly string\[\],\s*\):\s*Promise<GradeExplainBackInput\['misconceptionDigest'\]> \{\s*const vault = new ObsidianSource\(this\.app\);\s*const deviceId = await ensureDeviceId\(this\);\s*const store = createVaultMisconceptionStore\(\{ vault, deviceId, now: this\.now \}\);\s*const records = \(await store\.load\(\)\) \?\? \[\];\s*return buildMisconceptionDigest\(records, \{ conceptIds: \[\.\.\.conceptIds\] \}\);/,
    );
  });

  it("supplies that entry point as ExplainBackModal's loadMisconceptionDigest dep", () => {
    expect(main).toMatch(
      /loadMisconceptionDigest:\s*\(conceptIds\) =>\s*this\.buildExplainBackMisconceptionDigestFor\(conceptIds\),/,
    );
  });

  it('imports buildMisconceptionDigest from olea-core', () => {
    expect(main).toMatch(/buildMisconceptionDigest,/);
  });
});

describe('the explain-back full-depth encouragement has a real mastery-state reader (ol-egov.141.89.6.41)', () => {
  // `ol-egov.141.89.6.18` built `isConfirmedFirstFullDepth`
  // (`explain-back/first-full-depth.ts`) and its own caller
  // (`explain-back/modal.ts`'s `computeAcceptGrading`), but left
  // `openExplainBackModal`'s deps literal without a `getMasteryState` at
  // all — `ExplainBackModalDeps.getMasteryState` is optional and defaults
  // to unwired, so production behaviour stayed the safe, suppressed
  // default (no encouragement ever shown) until this bead. These
  // assertions are the source-level proof a real reader is now supplied.

  it('exposes a mastery-state reader that snapshots the review log once, fresh, per modal', () => {
    expect(main).toMatch(
      /private explainBackMasteryStateReader\(\):\s*\(conceptId: string\) => MasteryState \| null \{\s*const vault = new ObsidianSource\(this\.app\);\s*let snapshot: readonly ReviewLogEntry\[\] \| null = null;\s*let depthGateValue: SoloLevel \| undefined;\s*void readReviewLogHistory\(vault\)\s*\.then\(\(\{ entries \}\) => \{\s*snapshot = entries;\s*\}\)/,
    );
  });

  it('resolves mastery state through computeAllConceptMastery, defaulting to null (unconfirmed) while the snapshot is outstanding', () => {
    expect(main).toMatch(
      /return \(conceptId\) => \{\s*if \(snapshot === null\) return null;\s*const options = depthGateValue !== undefined \? \{ depthGate: depthGateValue \} : undefined;\s*return computeAllConceptMastery\(snapshot, \[conceptId\], options\)\.get\(conceptId\)\?\.state \?\? null;\s*\};/,
    );
  });

  it("supplies that reader as ExplainBackModal's getMasteryState dep", () => {
    expect(main).toMatch(/getMasteryState: this\.explainBackMasteryStateReader\(\),/);
  });

  it('imports computeAllConceptMastery from olea-core', () => {
    expect(main).toMatch(/computeAllConceptMastery,/);
  });
});

describe("component 3.1's delivered growth-stage depth gate has a real production caller ([D-352], ol-egov.141.89.9.55)", () => {
  // Same defect shape component 3.3's own describe block above opens with:
  // `depth-gate-provider.ts`, `depth-gate/wiring.ts` and their fetch/decode
  // logic are all complete and tested (`test/depth-gate/*.spec.ts`) — these
  // assertions are the source-level proof `main.ts` actually builds that
  // wiring and threads its result into `explainBackMasteryStateReader`,
  // the one caller in this file that folds mastery through
  // `MasteryRollupOptions.depthGate`.

  it('builds the depth-gate wiring through the tested composer, against the real data host and the real HTTP GET adapter', () => {
    expect(main).toMatch(
      /this\.depthGate\s*=\s*await buildDepthGateWiring\(\{\s*dataHost:\s*this,\s*httpGet:\s*obsidianDepthGateGet,/,
    );
  });

  it('imports the real composer and transport adapter, not stubs', () => {
    expect(main).toMatch(
      /import\s*\{\s*obsidianDepthGateGet\s*\}\s*from\s*'\.\/depth-gate\/obsidian-depth-gate-transport\.js'/,
    );
    expect(main).toMatch(
      /import\s*\{\s*buildDepthGateWiring,\s*type DepthGateWiring\s*\}\s*from\s*'\.\/depth-gate\/wiring\.js'/,
    );
  });

  it('resolves the delivered value once, fresh, alongside the review-log snapshot — the same "open time, read fresh per call" shape as snapshot', () => {
    expect(main).toMatch(/let depthGateValue: SoloLevel \| undefined;/);
    expect(main).toMatch(
      /void \(this\.depthGate\?\.readDepthGate\?\.\(\) \?\? Promise\.resolve\(undefined\)\)\.then\(\(value\) => \{\s*depthGateValue = value;\s*\}\);/,
    );
  });

  it('feeds the resolved value into MasteryRollupOptions.depthGate, omitting the key (so rollup.ts applies DEPTH_GATE_SOLO_LEVEL) rather than passing undefined explicitly', () => {
    expect(main).toMatch(
      /const options = depthGateValue !== undefined \? \{ depthGate: depthGateValue \} : undefined;/,
    );
  });
});

describe("a live causes edge's introducing passages now resolve through a real vault read (ol-egov.141.89.6.49)", () => {
  // `ol-egov.141.89.6.36` built `ExplainBackModalDeps.resolveIntroducingPassage`
  // and its caller (`resolveEdgeIntroducingPassages`, `explain-back/modal.ts`)
  // but left the port unwired here — an omitted dep, so every real vault
  // resolved nothing for an edge's own introducing passages until this
  // bead. These assertions are the source-level proof a real reader
  // (`resolveIntroducingPassageFromVault`, `explain-back/resolve-introducing-passage.ts`)
  // is now supplied, off the SAME `ObsidianSource` instance this modal's
  // other ports share.

  it('builds one ObsidianSource for the modal and supplies resolveIntroducingPassage from it', () => {
    expect(main).toMatch(
      /const nonAttemptTrigger: ExplainBackOfferTrigger \| undefined =\s*seed\.kind === 'freeform' \? 'on-demand' : trigger;\s*const nonAttemptOfferEventId: string \| undefined =[\s\S]*?const vault = new ObsidianSource\(this\.app\);\s*new ExplainBackModal\(/,
    );
    expect(main).toMatch(
      /resolveIntroducingPassage: \(provenance\) =>\s*resolveIntroducingPassageFromVault\(vault, provenance\),/,
    );
  });

  it('imports resolveIntroducingPassageFromVault from ./explain-back/resolve-introducing-passage.js', () => {
    expect(main).toMatch(
      /import \{ resolveIntroducingPassageFromVault \} from '\.\/explain-back\/resolve-introducing-passage\.js';/,
    );
  });
});

describe('the explain-back non-attempt record has a real production caller for every entry point (ol-0r92.104, ol-egov.141.89.6.44)', () => {
  // `ol-0r92.104` built `ExplainBackModalDeps.recordNonAttempt` and its two
  // callers inside `explain-back/modal.ts` (`skipPrompt`, `onClose`'s
  // `'answering'` guard), but left it optional and unwired — a skip wrote
  // nothing in production until `ol-egov.141.89.6.41` wired the `'freeform'`
  // seed with trigger `'on-demand'`. `ol-egov.141.89.6.44` threads a real
  // trigger through `ReviewView`'s single `openExplainBack` callback
  // (`review/view.ts`) for the `'instrument'` seed too, so a skip from any
  // of F2.12's confusion banner, F5.3a's scheduling-observation banner or
  // F2.21's strong-recall banner also records its non-attempt, with that
  // banner's own trigger rather than a fabricated one.

  it('exposes a production entry point that appends a non-attempt record with the given trigger and offer reference', () => {
    expect(main).toMatch(
      /private async recordExplainBackNonAttempt\(\s*trigger: NonAttemptLogRecordInput\['trigger'\],\s*offerEventId: string \| undefined,\s*params: \{ readonly conceptIds: readonly string\[\]; readonly timestamp: string \},\s*\): Promise<void> \{\s*const vault = new ObsidianSource\(this\.app\);\s*const deviceId = await ensureDeviceId\(this\);\s*await appendNonAttemptRecord\(\s*vault,\s*\{\s*conceptIds: \[\.\.\.params\.conceptIds\],\s*timestamp: params\.timestamp,\s*trigger,\s*\.\.\.\(offerEventId !== undefined \? \{ offerEventId \} : \{\}\),\s*\},\s*\{ deviceId \},\s*\);/,
    );
  });

  it("openExplainBackModal takes an optional trigger and offer reference, and resolves 'on-demand' for the 'freeform' seed, the caller's trigger otherwise", () => {
    expect(main).toMatch(
      /private openExplainBackModal\(\s*seed: ExplainBackSeed,\s*trigger\?: ExplainBackOfferTrigger,\s*offerEventId\?: string \| null,\s*onClosed\?: \(\) => void,\s*\): void \{\s*const nonAttemptTrigger: ExplainBackOfferTrigger \| undefined =\s*seed\.kind === 'freeform' \? 'on-demand' : trigger;/,
    );
  });

  it("D-369: the offer reference is dropped for the 'on-demand'/unresolved trigger and never carries a bare null forward", () => {
    expect(main).toMatch(
      /const nonAttemptOfferEventId: string \| undefined =\s*nonAttemptTrigger === 'on-demand' \|\| nonAttemptTrigger === undefined\s*\?\s*undefined\s*:\s*\(offerEventId \?\? undefined\);/,
    );
  });

  it('wires recordNonAttempt whenever a trigger was resolved, for either seed kind, threading the resolved offer reference', () => {
    expect(main).toMatch(
      /\.\.\.\(nonAttemptTrigger !== undefined\s*\?\s*\{\s*recordNonAttempt: \(params: \{ conceptIds: readonly string\[\]; timestamp: string \}\) =>\s*this\.recordExplainBackNonAttempt\(nonAttemptTrigger, nonAttemptOfferEventId, params\),\s*\}\s*: \{\}\),/,
    );
  });

  it("the ReviewView construction site forwards review/view.ts's per-banner trigger and offer reference into openExplainBackModal (ol-egov.141.89.6.53, [D-369])", () => {
    expect(main).toMatch(
      /\(instrument, trigger, offerEventId\) =>\s*this\.openExplainBackModal\(\{ kind: 'instrument', instrument \}, trigger, offerEventId\),/,
    );
  });

  it('imports ExplainBackOfferTrigger from olea-contracts', () => {
    expect(main).toMatch(/ExplainBackOfferTrigger,/);
  });

  it('imports appendNonAttemptRecord and NonAttemptLogRecordInput from olea-core', () => {
    expect(main).toMatch(/appendNonAttemptRecord,/);
    expect(main).toMatch(/NonAttemptLogRecordInput,/);
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
    // `ol-12gs` (`[D-163]`) added `acceptExplainBackGradingWithObservation`
    // and its two context/result types to this same import block — the
    // grading/wiring module is still the one composition root, not a second
    // one this bead invented alongside it.
    expect(main).toMatch(
      /import\s*\{\s*type AcceptExplainBackGradingWithObservationContext,\s*type AcceptExplainBackGradingWithObservationResult,\s*acceptExplainBackGradingWithObservation,\s*buildGradingWiring,\s*evaluateConfusionRouting,\s*type GradingWiring,\s*gradeExplainBackAttempt,\s*\}\s*from\s*'\.\/grading\/wiring\.js'/,
    );
  });
});

describe('an accepted explain-back grading now persists its misconception observation event (ol-0r92.90, [IL-P1c2])', () => {
  // `ol-0r92.89` found `buildObservationEventsFromAcceptedGrading`'s output
  // reached `acceptExplainBackGradingWithObservation` below and was
  // discarded — `appendMisconceptionEvent` (`olea-core`) had no caller
  // anywhere in the plugin. These assertions are the source-level proof that
  // an accepted result's observations now reach the vault, idempotent per
  // attempt (`attemptId`, else `originInstrumentId`; ol-egov.141.89.6.17), through a persistence step this method's own
  // wrapper composes.

  it("persists every accepted result's observations before returning it", () => {
    expect(main).toMatch(
      /async acceptExplainBackGradingWithObservation\(\s*pending:\s*PendingExplainBackGrading,\s*context:\s*AcceptExplainBackGradingWithObservationContext,\s*\):\s*Promise<AcceptExplainBackGradingWithObservationResult \| null> \{\s*if \(this\.grading === null\) return null;\s*const result = await acceptExplainBackGradingWithObservation\(this\.grading, pending, context\);\s*if \(result !== null && result\.status === 'accepted'\) \{\s*await this\.persistMisconceptionObservations\(\s*context\.attemptId\s*\?\?\s*context\.originInstrumentId,\s*result\.observations,\s*result\.resolutionEvidence,\s*\);\s*\}\s*return result;/,
    );
  });

  it('persistMisconceptionObservations is idempotent per attempt (attemptId, falling back to originInstrumentId), memoizing the in-flight Promise itself', () => {
    expect(main).toMatch(
      /private persistMisconceptionObservations\(\s*attemptKey:\s*string,\s*outcomes:\s*readonly AcceptedGradingObservationOutcome\[\],\s*resolutionEvidence:\s*MisconceptionResolutionEvidenceEvent \| null = null,\s*\):\s*Promise<void> \{\s*const existing = this\.persistedMisconceptionObservationsByAttempt\.get\(attemptKey\);\s*if \(existing !== undefined\) return existing;/,
    );
    expect(main).toMatch(
      /this\.persistedMisconceptionObservationsByAttempt\.set\(attemptKey, promise\);\s*return promise;/,
    );
    expect(main).toMatch(
      /private readonly persistedMisconceptionObservationsByAttempt = new Map<string, Promise<void>>\(\);/,
    );
  });

  // `ol-egov.141.89.6.31`: the same persistence step now also appends M2's
  // resolution-evidence event, when `decideResolutionEvidence` (composed one
  // layer down in `grading/wiring.ts`) produced one for the accepted grading.
  it('appends resolutionEvidence through the same appendMisconceptionEvent call, after the observation loop, logging rather than rethrowing on failure', () => {
    expect(main).toMatch(
      /if \(resolutionEvidence !== null\) \{\s*try \{\s*await appendMisconceptionEvent\(vault, resolutionEvidence, deviceId\);\s*\} catch \(error\) \{\s*console\.error\('Olea: failed to persist a misconception resolution-evidence event', error\);\s*\}\s*\}/,
    );
  });

  it('appends the real event through appendMisconceptionEvent for every non-skipped outcome, skipping skipped ones', () => {
    expect(main).toMatch(
      /for \(const outcome of outcomes\) \{\s*if \(outcome\.skipped\) continue;\s*try \{\s*await appendMisconceptionEvent\(vault, outcome\.result\.event, deviceId\);/,
    );
  });

  it('never rethrows an append failure into the accept path it rode on', () => {
    expect(main).toMatch(
      /\} catch \(error\) \{\s*console\.error\('Olea: failed to persist a misconception observation event', error\);\s*\}/,
    );
  });

  it('imports appendMisconceptionEvent and AcceptedGradingObservationOutcome from olea-core', () => {
    expect(main).toMatch(/type AcceptedGradingObservationOutcome,\s*appendMisconceptionEvent,/);
  });
});

describe('accept-time staleness is a direct per-block fingerprint check, not a fresh retrieval (ol-egov.141.89.6.39)', () => {
  // `ol-gavc` gave `sourceRevisionStale` a first live producer by re-running
  // retrieval with the frozen query and comparing the returned block SET
  // against the graded one — but a retrieval that merely ranks or selects a
  // different top-K set could read as stale even when none of the graded
  // passages themselves changed (`ol-egov.141.89.6.16`'s own follow-up).
  // This bead replaces that comparison with a direct read of each graded
  // block's own `{path, blockIndex}` and a content-fingerprint compare —
  // see `test/explain-back/source-fingerprint-staleness.spec.ts` for the
  // regression coverage this source-level pin cannot itself provide (`main.ts`
  // cannot be instantiated under Vitest).

  it('no longer re-retrieves the source blocks against the frozen query', () => {
    expect(main).toMatch(
      /private async buildExplainBackObservationContextFor\(params:\s*\{\s*readonly subjectConceptId:\s*string \| null;\s*readonly originInstrumentId:\s*string;\s*readonly sourceBlocks:\s*readonly ExplainBackSourceBlock\[\];\s*readonly query:\s*string;\s*\}\):\s*Promise<AcceptExplainBackGradingWithObservationContext> \{/,
    );
    expect(main).not.toMatch(/composeExplainBackSourceBlocks\(params\.query\)/);
    expect(main).not.toMatch(/hasExplainBackSourceRevisionChanged/);
  });

  it('computes sourceRevisionStale from a direct fingerprint check against the same vault instance, and passes it through never re-derived', () => {
    expect(main).toMatch(
      /const sourceRevisionStale = await hasExplainBackSourceFingerprintChanged\(\s*vault,\s*params\.sourceBlocks,\s*\);/,
    );
    expect(main).toMatch(
      /sourceRevisionStale,\s*\}\),\s*subjectConceptId: params\.subjectConceptId,/,
    );
  });

  it('imports hasExplainBackSourceFingerprintChanged from the new staleness helper, not observation.ts', () => {
    expect(main).toMatch(
      /import\s*\{\s*hasExplainBackSourceFingerprintChanged\s*\}\s*from\s*'\.\/explain-back\/source-fingerprint-staleness\.js';/,
    );
    expect(main).toMatch(
      /import\s*\{\s*buildExplainBackObservationContext\s*\}\s*from\s*'\.\/explain-back\/observation\.js';/,
    );
  });

  // `ol-egov.141.89.6.31`: `buildExplainBackObservationContext` does not
  // declare `subjectConceptId` on its own return shape (outside this bead's
  // `owns`) — this proves `main.ts` adds it back explicitly rather than
  // silently losing the concept binding the accept step's M2 decision needs.
  it('threads params.subjectConceptId onto the returned context, not just into the observation-context builder call', () => {
    expect(main).toMatch(
      /return \{\s*\.\.\.buildExplainBackObservationContext\(\{[\s\S]*?\}\),\s*subjectConceptId:\s*params\.subjectConceptId,\s*\};/,
    );
  });
});

describe('F5.1 first-suggestion picker has a real production entry point (ol-0r92.22)', () => {
  // Same defect shape `gradeExplainBackAttempt` (ol-drfy) and
  // `evaluateConfusionRouting` (ol-p4t05) already document above: a pure
  // function built and tested in olea-core with no non-test caller anywhere
  // is exactly the six-times-found defect the reachability clause (plan
  // §2.7 clause 5) exists to stop. This is the source-level proof that
  // `main.ts` exposes `pickFirstExplainBackInvitation` as a real,
  // reachable-if-not-yet-invoked-by-anything-else method — see
  // `first-invitation-picker.ts`'s module doc for why no automatic depth
  // signal exists yet to feed it, and this method's own doc comment for why
  // nothing calls it.

  it('imports the picker directly from olea-core, generic candidate type included', () => {
    expect(main).toMatch(/type FirstInvitationCandidate,/);
    expect(main).toMatch(/pickNextExplainBackInvitation,/);
  });

  it('exposes a production entry point delegating to the pure picker', () => {
    expect(main).toMatch(
      /pickFirstExplainBackInvitation<T extends FirstInvitationCandidate>\(\s*candidates:\s*readonly T\[\],\s*alreadyInvitedIds:\s*ReadonlySet<string> \| readonly string\[\] = \[\],\s*\):\s*T \| null \{\s*return pickNextExplainBackInvitation\(candidates, alreadyInvitedIds\);/,
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

describe('the first-read readout has a real per-folder concept feed (ol-9c0k, [D-219])', () => {
  // `ol-0r92.47` shipped `FirstReadFolderView.landedConcepts` as a real,
  // tested slot fed only by an always-empty map — `ingestion/wiring.ts`'s own
  // module doc named the missing half: no incremental per-folder concept
  // producer existed in production. These assertions are the source-level
  // proof that `main.ts` now feeds it for real: a per-folder drain detector
  // on every ingestion tick (`firstReadFoldersJustFinished`, folder grain of
  // the same non-empty-to-empty transition `ingestionSessionJustClosed`
  // detects at engine grain), and one bounded `readConceptsFromVault` call
  // per folder that just drained — never the whole vault, never a new budget
  // constant of its own.

  it('detects which ticked folders just drained, per tick, at folder grain', () => {
    expect(main).toMatch(
      /const currentFirstReadCounts = summarizeFirstReadByFolder\(\s*this\.ingestion\.engine\.list\(\),\s*this\.tickedCourseFolders,\s*\);\s*const justFinished = firstReadFoldersJustFinished\(\s*this\.lastFirstReadCountsByFolder,\s*currentFirstReadCounts,\s*\);/,
    );
  });

  it('fires the per-folder read only for folders that just finished, never on every tick', () => {
    expect(main).toMatch(
      /if \(justFinished\.length > 0\) \{\s*void this\.readLandedConceptsForFinishedFolders\(justFinished\);\s*\}/,
    );
  });

  it('the whole-vault batch read at ingestion-session close is unchanged — the per-folder call is additional, not a replacement', () => {
    expect(main).toMatch(
      /if \(!ingestionSessionJustClosed\(previous, current\)\) return;[\s\S]*?const pass = await readConceptsAndRelations\(/,
    );
  });

  it('the per-folder call is scoped to that folder alone, through the same composed readConceptsFromVault every other caller uses — and adds no budget of its own', () => {
    expect(main).toMatch(
      /const result = await this\.readConceptsFromVault\(\{ under: folder \}\);/,
    );
  });

  it('a folder that could not be read (F7.8 grey-out, or an unrecognised vault) leaves its previously landed concepts untouched, never cleared', () => {
    expect(main).toMatch(
      /if \(result !== null && result\.outcome === 'read'\) \{\s*this\.landedConceptsByFolder\.set\(\s*folder,\s*result\.concepts\.map\(\(concept\) => concept\.name\),\s*\);\s*\}/,
    );
  });

  it('a thrown read error is logged and never propagated out of the tick loop', () => {
    expect(main).toMatch(
      /\} catch \(error\) \{\s*console\.error\(\s*'Olea: per-folder concept read failed \(first-read readout unaffected\)',\s*error,\s*\);\s*\}/,
    );
  });

  it('the readout now reads real landed concepts, not the always-empty map ol-0r92.47 shipped', () => {
    expect(main).toMatch(
      /return buildFirstReadFolderViews\(\s*this\.ingestion\.engine\.list\(\),\s*folders,\s*this\.landedConceptsByFolder,\s*\);/,
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

  // `ol-0r92.71` (`[H-1.8a]`, register row 1.8a): `BulkReviewView` grew a 4th,
  // optional `getRefusals` constructor param whose render surface was already
  // built and tested, but `main.ts` still constructed it with only 3 args —
  // this is the source-level proof the 4th arg now reaches a real provider.
  it("passes lastGenerationRefusals as the getRefusals provider, register row 1.8a's last reachability hop", () => {
    expect(main).toMatch(
      /\(conceptKey\) => void openRegistryEntryFor\(this\.app, \{ conceptKey \}\),\s*\(\) => this\.lastGenerationRefusals,\s*\),/,
    );
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
      /this\.materiality\s*=\s*buildMaterialityWiring\(\{\s*dataHost:\s*this,\s*clock:\s*\{\s*now:\s*\(\)\s*=>\s*this\.now\(\)\.getTime\(\)\s*\},\s*judge:\s*this\.buildMaterialityJudge\(\),/,
    );
  });

  it('the judge helper degrades to null on the same unconfigured-Worker condition as every other AI-gated wiring (F7.8)', () => {
    expect(main).toMatch(
      /private buildMaterialityJudge\(\): WorkerMaterialityJudge \| null \{\s*const transport = this\.retrieval\?\.transport;\s*if \(transport === null \|\| transport === undefined\) return null;\s*return new WorkerMaterialityJudge\(\{ transport \}\);/,
    );
  });

  it('wires the real vault event stream into it, filtered to modify and create events (ol-egov.141.89.11.13: a created file must reach the trigger too)', () => {
    expect(main).toMatch(
      /vault\.watch\(\(event\)\s*=>\s*\{\s*if\s*\(event\.kind\s*!==\s*'modify'\s*&&\s*event\.kind\s*!==\s*'create'\)\s*return;\s*void this\.evaluateMaterialityChange\(vault,\s*event\.path\);/,
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

  it('buildReviewSessionInput (shared by composeReviewSession and extendReviewSession) threads it into the session input', () => {
    // F2.19 (`ol-vr8z`): `assessments` rides immediately after `relations` in
    // the same `OpenReviewSessionInput` object — both signal inputs, one
    // build site (`ol-v7r5.35`'s `buildReviewSessionInput`, shared by the
    // ordinary open and the C5.8 extend path rather than duplicated).
    // `[SESS-8.4]` (`ol-egov.132.4`): `studySessionHolder`/
    // `composeDefaultStudySession` now follow `assessments` in the same
    // object, before the closing brace — see that method's own doc.
    // `ol-egov.141.89.6.54`'s `citationHashStore` spread now rides between
    // `assessments` and `studySessionHolder` too (widened budget below).
    expect(main).toMatch(
      /relations:\s*this\.servedRelationEdges\(\),[\s\S]{0,200}?assessments,[\s\S]{0,1200}?\};/,
    );
  });

  it("the Today panel's instrument source is wired over the shared composed-session holder ([SESS-8.5], ol-egov.132.5)", () => {
    // `[SESS-8.5]` (`ol-egov.132.5`) stopped Today's instrument source
    // running its own `buildReviewSession`-based walk (the "legacy path"
    // `today/data-source.ts`'s own module doc names) — it now reads the
    // shared `studySessionHolder`/`composeDefaultStudySession` port, the same
    // pair `buildReviewSessionInput` threads into the review tab. Test
    // updated alongside `[SESS-8.6]` (`ol-egov.132.6`) after being found
    // stale (`discovered-from ol-egov.132.5`): this call no longer passes
    // `relations`, because the legacy path it would have fed is unreachable
    // in production once both of the other two fields are always supplied.
    expect(main).toMatch(
      /instruments:\s*createVaultInstrumentSource\(\{\s*vault,\s*scheduler,\s*deviceId,\s*now:\s*this\.now,[\s\S]*?studySessionHolder:\s*this\.studySessionHolder,\s*composeDefaultStudySession:\s*\(\)\s*=>\s*this\.composeDefaultStudySession\(\),\s*\}\),/,
    );
  });

  it('imports servedRelations from olea-core, not a local reimplementation', () => {
    expect(main).toMatch(/servedRelations,/);
  });
});

describe('ol-egov.141.8.10 (F1.2): both readAssessments call sites now read through the manual-entry fallback', () => {
  // F1.2: manual course-and-date entry is a fallback where no assessments
  // Base exists or it cannot be read — never the default path. `olea f6f3875`
  // already switched the paper, plan, Grove and retrospective providers to
  // `resolveAssessments` (`assessment/resolve.ts`, `olea-core`); this bead's
  // own report named `main.ts`'s two remaining direct `readAssessments` call
  // sites as pending. With a readable Base every output is unchanged
  // (`resolveAssessments`'s own doc); a blank or unreadable Base now reads her
  // hand-entered assessments instead of nothing.

  it('imports resolveAssessments from olea-core, and no longer imports readAssessments', () => {
    expect(main).toMatch(/resolveAssessments,/);
    expect(main).not.toMatch(/readAssessments/);
  });

  it('no longer imports isStudyPlanConfigured — both call sites that gated on it are gone', () => {
    expect(main).not.toMatch(/isStudyPlanConfigured/);
  });

  it('buildFormatMatchProducer (F4.8) reads through resolveAssessments unconditionally, with no isStudyPlanConfigured early return', () => {
    expect(main).toMatch(
      /const assignmentsConfig = await new ObsidianStudyPlanSettingsStore\(this\)\.load\(\);\s*const assessments = \(await resolveAssessments\(vault, assignmentsConfig\.assignmentsBasePath\)\)\s*\.records;/,
    );
  });

  it('buildReviewSessionInput’s F2.19 assessments read through resolveAssessments unconditionally, with no isStudyPlanConfigured ternary', () => {
    expect(main).toMatch(
      /const assignmentsConfig = await new ObsidianStudyPlanSettingsStore\(this\)\.load\(\);\s*const assessments = \(\s*await resolveAssessments\(wiring\.vault, assignmentsConfig\.assignmentsBasePath\)\s*\)\.records;/,
    );
  });
});

describe('ol-egov.141.89.6.54: buildReviewSessionInput threads the SAME citationHashStore instance into OpenReviewSessionInput', () => {
  // `[D-351]`/`[D-323]`: `open-session.ts`'s `OpenReviewSessionInput.citationHashStore` (new,
  // optional field) makes `readInstrumentStanding`'s pending-revalidation concern a real, wired
  // read once supplied — previously omitted by every caller, so it stayed a genuine, honest gap
  // rather than a guessed clear. `composeDefaultStudySession`/`extendDefaultStudySession` already
  // spread `this.citationHashStore` into their own composer deps for a different consumer
  // (session-builder's own resolver); this bead's own report named `buildReviewSessionInput` — the
  // one production `OpenReviewSessionInput` builder — as the one-line follow-up that threads the
  // SAME instance (constructed once, `main.ts`'s `onload`) into the review tab's own open/extend
  // path too, never a second store. No `safetyUnavailableInstrumentIds` is added alongside it —
  // no real production source exists for that concern yet (see `OpenReviewSessionInput`'s own doc).

  it('spreads this.citationHashStore into the returned OpenReviewSessionInput, omitted rather than null before the store is up', () => {
    const inputBody = main.slice(
      main.indexOf('private async buildReviewSessionInput('),
      main.indexOf('private async composeReviewSession('),
    );
    expect(inputBody).toMatch(
      /assessments,\s*\.\.\.\(this\.citationHashStore \? \{ citationHashStore: this\.citationHashStore \} : \{\}\),/,
    );
    expect(inputBody).not.toMatch(/safetyUnavailableInstrumentIds/);
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

describe("Today's scope reading shares the grove's own population (ol-egov.141.89.11.12, docs/dev/intelligence-build/vew.md item 3)", () => {
  // `today/data-source.ts`'s own module doc named the gap: `createVaultScopeSource`
  // took no `settingsHost`/`relations`, so Today's cross-course scope reading had
  // no F8.5 withdrawal filter, no `ol-2zfj.157` [DOS-I15] read-completeness row and
  // no C7.9 part-of fold — the same three inputs `../grove/provider.ts` already
  // threads — so the two readers could disagree on the very same course. The fix
  // (both fields are optional on `VaultScopeSourceDeps`) stayed dormant until this
  // call site actually passed them; this is the source-level proof that it does.

  it('createVaultScopeSource is given settingsHost and a relations thunk, not called bare', () => {
    expect(main).toMatch(
      /scope:\s*createVaultScopeSource\(\{\s*vault,\s*deviceId,\s*now:\s*this\.now,\s*settingsHost:\s*this,\s*relations:\s*\(\)\s*=>\s*this\.servedRelationEdges\(\),\s*\}\),/,
    );
  });
});

describe("a generation sweep's classified refusals are captured for the bulk-review render surface (ol-0r92.71, [H-1.8a])", () => {
  // `ol-0r92.71`'s own close evidence named the exact remaining gap:
  // `onUnitsLanded` awaited `GenerationSweepReport` and discarded it
  // entirely, so `BulkReviewView`'s already-built `renderRefusals` never
  // had anything real to read. These assertions are the source-level proof
  // that the report's `refusals` field is now captured onto
  // `this.lastGenerationRefusals`, degrading to `[]` on the F7.8 no-op path
  // (`report === null`) rather than a stale prior sweep's refusals.

  it('captures report?.refusals onto this.lastGenerationRefusals inside onUnitsLanded', () => {
    expect(main).toMatch(
      /const report = await this\.generation\.sweep\(\s*units,\s*this\.draftQuizCardsDeps\(\),\s*\{ classifier: this\.knowledgeKind\?\.classifier \?\? null \},\s*formatMatch,\s*\);\s*this\.lastGenerationRefusals = report\?\.refusals \?\? \[\];/,
    );
  });

  it('declares the field typed on the real GenerationRefusalNotice shape, defaulting to empty', () => {
    expect(main).toMatch(
      /private lastGenerationRefusals:\s*readonly GenerationRefusalNotice\[\] = \[\];/,
    );
  });

  it('imports GenerationRefusalNotice from the generation pipeline module', () => {
    expect(main).toMatch(
      /import type \{ GenerationRefusalNotice \} from '\.\/generation\/pipeline\.js';/,
    );
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

  it('[D-214] synthesises exactly one unit sourced from the note itself, with embeddedIn ABSENT — the note is never its own drafting target', () => {
    // `ol-0r92.21` [D-152]: this shape moved into `ingestion/process-now.ts`'s
    // `buildAuthoredNoteUnit`, shared with the manual process-now override
    // (see that file's own test) — asserted against the source it now lives
    // in, since `main.ts` calls it rather than building the literal inline.
    // `[D-214]` (`ol-0r92.45`) removed `embeddedIn` entirely: setting it to
    // the note's own path put the unit on `runGenerationSweep`'s "embedded"
    // branch and made materialization write straight into an authored note
    // — the write INV-6 rules out. Omitting it routes through the bare-drop
    // branch `[D-179]` already built, so Olea drafts into a home note beside
    // this one instead.
    const processNowSource = codeOf('ingestion/process-now.ts');
    expect(processNowSource).toMatch(
      /provenance:\s*\{\s*sourcePath:\s*path,\s*location:\s*\{\s*page:\s*1,\s*charRange:\s*\{\s*start:\s*0,\s*end:\s*currentText\.length\s*\},?\s*\},?\s*\},/,
    );
    expect(processNowSource).not.toMatch(/embeddedIn:\s*\{\s*notePath:\s*path/);
  });

  it('delegates to onUnitsLanded — the SAME F3.3 hook the ingestion path calls, not a second sweep entry point', () => {
    expect(main).toMatch(
      /await this\.onUnitsLanded\(\[buildAuthoredNoteUnit\(path, currentText\)\]\);/,
    );
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

  // `ol-egov.141.89.9.49` (F8.7, `[D-058]`/`[D-274]`, discovered from
  // `ol-egov.141.89.9.47`): `recognitionClaims` used to be hardcoded `[]`
  // because nothing assembled the review-log entries and the
  // concept-to-course join at proposal time. These assert the real seam is
  // wired, not merely written — the same shape this describe block already
  // uses for the detector and the modal host above.

  it('imports the real recognition read and the real claim-copy builder, not stubs', () => {
    expect(main).toMatch(
      /import\s*\{\s*buildRecognitionClaimCopy\s*\}\s*from\s*'\.\/course-setup\/copy\.js'/,
    );
    expect(main).toMatch(
      /import\s*\{\s*readCourseSetupRecognitions\s*\}\s*from\s*'\.\/course-setup\/recognition-source\.js'/,
    );
  });

  it('assembles recognitions for the proposal’s own course code before opening the modal', () => {
    expect(main).toMatch(
      /const recognitions = await readCourseSetupRecognitions\(\s*next\.code,\s*\{\s*vault,\s*deviceId,\s*today:\s*localToday\(this\.now\(\)\),\s*\}\s*\);/,
    );
  });

  it('passes real recognitions through buildRecognitionClaimCopy into recognitionClaims, never a hardcoded empty list', () => {
    expect(main).toMatch(/recognitionClaims:\s*recognitions\.map\(buildRecognitionClaimCopy\),/);
    expect(main).not.toMatch(/recognitionClaims:\s*\[\],/);
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

describe('the vault-watch-to-enqueue glue for the multi-format ingestion path is real (ol-2zfj.38)', () => {
  // `ol-84my`'s own close reason, verbatim: the ENQUEUE debounce and the
  // queue engine both existed, and no production code ever called
  // `IngestionQueueEngine.enqueue()` for a file newly arriving in the vault.
  // Same defect shape as `ol-tuvx`/`ol-odb0.1` above: every unit test for
  // `buildIngestionArrivalWatch` and the engine's own debounce passed while
  // this gap existed, because each supplies its own fake of exactly the
  // seam that was missing here — `main.ts` never calling it at all.

  it('imports the tested composer, not an inline vault.watch handler', () => {
    expect(main).toMatch(
      /import\s*\{\s*buildIngestionArrivalWatch\s*\}\s*from\s*'\.\/ingestion\/arrival-watch\.js'/,
    );
  });

  it('builds the watch against the real engine buildIngestionRunner returned, registered for teardown', () => {
    expect(main).toMatch(
      /this\.register\(\s*buildIngestionArrivalWatch\(\{\s*vault,\s*enqueuer:\s*this\.ingestion\.engine,\s*watch:\s*\(handler\)\s*=>\s*vault\.watch\(handler\),\s*clock:\s*\{\s*now:\s*\(\)\s*=>\s*this\.now\(\)\.getTime\(\)\s*\},\s*\}\),\s*\);/,
    );
  });

  it('constructs the queue engine with the declared ENQUEUE debounce policy', () => {
    expect(codeOf('ingestion/wiring.ts')).toMatch(
      /enqueueDebounce:\s*DEFAULT_ENQUEUE_DEBOUNCE_POLICY,/,
    );
  });
});

describe('the standalone-image vision runner reaches production (ol-15f8 / ol-ua2f, C3.1/C3.3)', () => {
  // `ol-15f8` composed `IngestionWiringDeps.vision` and unit-tested it
  // against fakes, but its own boundary excluded `main.ts`, so the real
  // `buildIngestionRunner` call here still omitted the field — the seam was
  // wired and tested but not reachable. This is the source-level proof that
  // the real call now supplies it, on the same F7.8 (`dataHost`/
  // `createTransport`) terms as every other Worker-backed port in `onload`.

  it('supplies vision.dataHost and vision.createTransport to the real buildIngestionRunner call', () => {
    // `ol-egov.141.89.8.4` slice 4 added a `visionRoute` field after this one
    // (its own describe block below pins it), so the gap to the closing
    // `});` is no longer immediate.
    expect(main).toMatch(
      /this\.ingestion\s*=\s*await buildIngestionRunner\(\{[\s\S]*?vision:\s*\{\s*dataHost:\s*this,\s*createTransport:\s*createRecordingTransport,\s*\},[\s\S]{0,300}?\}\);/,
    );
  });

  it('the vision field is inside the same buildIngestionRunner call, not a second unrelated object literal', () => {
    const match = main.match(/this\.ingestion\s*=\s*await buildIngestionRunner\(\{[\s\S]*?\}\);/);
    expect(match).not.toBeNull();
    expect(match?.[0]).toContain('vision:');
    expect(match?.[0]).toContain('revision:');
  });
});

describe("component 1.6's delivered vision-routing threshold has a real production caller (ol-egov.141.89.8.4 slice 4, [ILB-PER-4] §8 item 2)", () => {
  // `ol-egov.141.89.8.4` slice 4 composed `IngestionWiringDeps.visionRoute`
  // and `vision-route-wiring.ts#buildVisionRouteWiring` and unit-tested them
  // against fakes (`test/ingestion/vision-route-wiring.spec.ts`), but left
  // `main.ts`'s own `buildIngestionRunner` call omitting the field — the same
  // "wired and tested but not reachable" gap the standalone-image vision
  // runner's own describe block above once had. This is the source-level
  // proof the real call now supplies it, on the same F7.8 (`dataHost`/
  // `httpGet`) terms as `obsidianRankWeightsGet`/`obsidianDepthGateGet`.

  it('supplies visionRoute.dataHost and visionRoute.httpGet to the real buildIngestionRunner call', () => {
    expect(main).toMatch(
      /this\.ingestion\s*=\s*await buildIngestionRunner\(\{[\s\S]*?visionRoute:\s*\{\s*dataHost:\s*this,\s*httpGet:\s*obsidianVisionRouteGet,\s*\},\s*\}\);/,
    );
  });

  it('imports the real HTTP GET adapter, not a stub', () => {
    expect(main).toMatch(
      /import\s*\{\s*obsidianVisionRouteGet\s*\}\s*from\s*'\.\/ingestion\/obsidian-vision-route-transport\.js'/,
    );
  });

  it('the visionRoute field is inside the same buildIngestionRunner call, not a second unrelated object literal', () => {
    const match = main.match(/this\.ingestion\s*=\s*await buildIngestionRunner\(\{[\s\S]*?\}\);/);
    expect(match).not.toBeNull();
    expect(match?.[0]).toContain('vision:');
    expect(match?.[0]).toContain('visionRoute:');
  });
});

describe('[D-368]/[D-348] (ol-2zfj.173): the generation drain-order reading is built and auto-tested, but deps.generation stays unsupplied — held for ol-2zfj.171, blocked by D-261', () => {
  // `ol-2zfj.135` [GEN-3.4] already built and tested real `draft`/
  // `hasAnyBuiltKind` implementations, but composing `deps.generation` at
  // all would make the ingestion queue call the Worker's generation task
  // automatically on every material arrival — a new automatic-spend surface
  // while `[D-261]` holds ledger spend at zero. This bead's own
  // `priority-source.ts` reading is built and auto-tested on its own terms
  // (`test/generation/priority-source.spec.ts`) but is equally unreachable
  // until that same hold lifts. This pin exists so a later change that adds
  // `generation:` to the real call — correctly, once `[D-261]` authorises it
  // — fails here and forces this note (and `ol-2zfj.171`'s own acceptance)
  // to be updated alongside it, rather than the gap going stale silently.

  it('does not yet supply deps.generation to the real buildIngestionRunner call', () => {
    const match = main.match(/this\.ingestion\s*=\s*await buildIngestionRunner\(\{[\s\S]*?\}\);/);
    expect(match).not.toBeNull();
    expect(match?.[0]).not.toContain('generation:');
  });
});

describe("retrieve()'s two production callers supply registryOverrides, so alias expansion is actually exercised (ol-r5j4)", () => {
  // `ol-l5og.11`'s own diagnosis: `retrieve()` expands keyword queries with
  // rename aliases when `RetrieveDeps.registryOverrides` is supplied, but
  // neither `draftQuizCardsDeps` nor `composeExplainWhySourceChunks` ever
  // assembled one — the async overrides-store load did not fit either
  // call site's synchronous deps assembly. These are the source-level
  // checks that a cached snapshot now closes both gaps.

  // `ol-egov.141.89.9.56`: the cache primed here is resolved through the
  // canonical-key read, the same way `registry/same-as-identity.ts` and
  // `registry/provider.ts` already read identity-sensitive overrides —
  // otherwise an override keyed on a since-merged concept key would never
  // resolve to the surviving canonical one for this cache's two readers.
  // Supersedes the prior "bare `.load()`" pin: the read now goes through
  // `readConceptKeyCanonicalIndex` first, defaulting honestly (to
  // `EMPTY_REGISTRY_OVERRIDES`) on either step's failure.
  it('primes the cache through readConceptKeyCanonicalIndex, not a bare load()', () => {
    expect(main).toMatch(
      /this\.registryOverridesCache\s*=\s*await readConceptKeyCanonicalIndex\(new ObsidianSource\(this\.app\)\)\s*\.then\(\(canonicalKeys\)\s*=>\s*new ObsidianRegistryOverridesStore\(this\)\.load\(\{\s*canonicalKeys\s*\}\)\)\s*\.catch\(/,
    );
  });

  it('imports readConceptKeyCanonicalIndex from olea-core, not a local reimplementation', () => {
    expect(main).toMatch(/readConceptKeyCanonicalIndex,/);
  });

  it('the registry view refreshes the cache the instant she renames, withdraws or restores a concept', () => {
    expect(main).toMatch(
      /onOverridesChanged:\s*\(overrides\)\s*=>\s*\{\s*this\.registryOverridesCache = overrides;\s*\},/,
    );
  });

  it('draftQuizCardsDeps supplies the cache to retrieve()', () => {
    expect(main).toMatch(
      /embeddingProvider,\s*registryOverrides:\s*this\.registryOverridesCache,\s*\},\s*transport,/,
    );
  });

  it('composeExplainWhySourceChunks supplies the SAME cache to retrieve()', () => {
    expect(main).toMatch(
      /embeddingProvider,\s*registryOverrides:\s*this\.registryOverridesCache,\s*\},\s*\},\s*instrument,\s*\);/,
    );
  });
});

describe('Home and the grove open commands are folded into the shared command module, not direct addCommand calls (ol-2zfj.38)', () => {
  // `docs/dev/surface-register.md` named this as the Class A tidy still owed
  // once `OLEA_COMMAND_REGISTRY_OPEN` (`ol-l5og.11`) proved the pattern —
  // same defect-shape posture this file already takes for every other
  // wiring gap: a command working today is not the same claim as a command
  // reached the way the rest of the palette is.

  it('main.ts no longer calls this.addCommand for olea-home-open or olea-grove-open directly', () => {
    expect(main).not.toMatch(/this\.addCommand\(\{\s*id:\s*'olea-home-open'/);
    expect(main).not.toMatch(/this\.addCommand\(\{\s*id:\s*'olea-grove-open'/);
  });

  it('registerOleaCommands is given real openHome/openGrove handlers instead', () => {
    expect(main).toMatch(/openHome:\s*\(\)\s*=>\s*\{\s*void this\.revealHomeView\(\);\s*\},/);
    expect(main).toMatch(/openGrove:\s*\(\)\s*=>\s*\{\s*void this\.revealGroveView\(\);\s*\},/);
  });
});

describe('the manual process-now timing override is registered and reachable ([D-152], ol-0r92.21; palette door folded by ol-s46v)', () => {
  // The command-palette door used to be a direct `this.addCommand` call,
  // outside `commands/`'s owned paths at the time `ol-0r92.21` shipped it —
  // the same shape `OLEA_COMMAND_REGISTRY_OPEN`/`OLEA_COMMAND_HOME_OPEN` used
  // before their own Class A fold (`docs/dev/surface-register.md`). `ol-s46v`
  // is that fold, completed here: the id and name now live in
  // `register-commands.ts` (asserted directly in that module's own spec),
  // and this file's job is proving `main.ts` no longer registers it directly
  // and instead supplies the real `checkCallback`, unchanged, as a handler.

  it('builds the process-now action once ingestion exists, wired to the real engine and onUnitsLanded', () => {
    expect(main).toMatch(
      /const ingestionForProcessNow = this\.ingestion;\s*this\.processNowAction = createProcessNowAction\(\{\s*vault,\s*enqueuer:\s*ingestionForProcessNow\.engine,\s*tick:\s*\(\)\s*=>\s*ingestionForProcessNow\.engine\.tick\(\),\s*onAuthoredNoteUnits:\s*\(units\)\s*=>\s*this\.onUnitsLanded\(units\),\s*isOnline:\s*\(\)\s*=>\s*navigator\.onLine,\s*\}\);/,
    );
  });

  it('main.ts no longer calls this.addCommand for olea-process-note-now directly', () => {
    expect(main).not.toMatch(/this\.addCommand\(\{\s*id:\s*OLEA_COMMAND_PROCESS_NOTE_NOW/);
    expect(main).not.toMatch(/this\.addCommand\(\{\s*id:\s*'olea-process-note-now'/);
  });

  it('registerOleaCommands is given the real checkCallback instead, identical to the direct registration it replaced — gated on an active, supported file', () => {
    expect(main).toMatch(
      /processNoteNowCheckCallback:\s*\(checking:\s*boolean\)\s*=>\s*\{\s*const file = this\.app\.workspace\.getActiveFile\(\);\s*if \(file === null \|\| !isProcessNowSupported\(file\.path\)\) return false;\s*if \(checking\) return true;\s*void this\.processNoteNow\(file\.path\);\s*return true;\s*\},/,
    );
  });

  it("the note context menu's item reaches the identical processNoteNow method", () => {
    expect(main).toMatch(
      /this\.app\.workspace\.on\('file-menu',\s*\(menu,\s*file\)\s*=>\s*\{\s*if \(!\(file instanceof TFile\) \|\| !isProcessNowSupported\(file\.path\)\) return;/,
    );
    expect(main).toMatch(
      /\.setTitle\('Olea: Process this note now'\)\s*\.setIcon\('refresh-cw'\)\s*\.onClick\(\(\)\s*=>\s*\{\s*void this\.processNoteNow\(file\.path\);/,
    );
  });

  it('processNoteNow delegates to the action and shows the resulting Notice', () => {
    expect(main).toMatch(
      /private async processNoteNow\(path: VaultPath\): Promise<void> \{\s*if \(this\.processNowAction === null\) return;\s*const outcome = await this\.processNowAction\.processNow\(path\);\s*new Notice\(processNowNotice\(outcome\)\);\s*\}/,
    );
  });

  it('the authored-note debounce path and this override share one unit-building function, not two copies', () => {
    expect(main).toMatch(
      /await this\.onUnitsLanded\(\[buildAuthoredNoteUnit\(path, currentText\)\]\);/,
    );
  });

  it('imports the real composer and TFile, not stubs', () => {
    expect(main).toMatch(
      /import\s*\{\s*buildAuthoredNoteUnit,\s*createProcessNowAction,\s*isProcessNowSupported,\s*type ProcessNowAction,\s*processNowNotice,?\s*\}\s*from\s*'\.\/ingestion\/process-now\.js'/,
    );
    expect(main).toMatch(
      /import \{ MarkdownView, Notice, Plugin, TFile, type WorkspaceLeaf \} from 'obsidian';/,
    );
  });
});

describe("[D-171]'s open-source-location hand-off has a real production caller (ol-2zfj.43 / ol-2zfj.47)", () => {
  // ol-2zfj.43's own close evidence named the exact seam not yet crossed:
  // `createObsidianOpenSourceLocationPort` and `openRegistryEntryFor` were
  // complete and unit-tested (`test/registry/*.spec.ts`), but nothing in
  // `main.ts` passed `openSourceLocationPort` into `createLocalRegistryProvider`
  // — the registry's "Open source" action logged an error instead of opening
  // anything. These are the source-level assertions that the seam is crossed.

  it('passes the real Obsidian-backed openSourceLocationPort into createLocalRegistryProvider', () => {
    expect(main).toMatch(
      /openSourceLocationPort:\s*createObsidianOpenSourceLocationPort\(this\.app\),/,
    );
  });

  it('imports the real port composer, not a stub', () => {
    // Names, not order: `ol-r1by`'s `createObsidianAcceptNoteOfferPort` sorts
    // alphabetically ahead of `createObsidianEditInstrumentPort` (biome's
    // `organizeImports`), which the previous exact-sequence regex could not
    // survive — this asserts the same three names, and the new fourth, are
    // all imported from the real port module, independent of their order.
    expect(main).toMatch(/import\s*\{[^}]*\}\s*from\s*'\.\/registry\/obsidian-ports\.js'/);
    const importBlock = main.match(
      /import\s*\{([^}]*)\}\s*from\s*'\.\/registry\/obsidian-ports\.js'/,
    )?.[1];
    expect(importBlock).toBeDefined();
    for (const name of [
      'createObsidianAcceptNoteOfferPort',
      'createObsidianEditInstrumentPort',
      'createObsidianOpenSourceLocationPort',
      'openRegistryEntryFor',
    ]) {
      expect(importBlock).toContain(name);
    }
  });

  it("wires the review view's one-step affordance to the real openRegistryEntryFor, not a no-op", () => {
    expect(main).toMatch(
      /\(instrumentId\)\s*=>\s*void openRegistryEntryFor\(this\.app,\s*\{ instrumentId \}\),/,
    );
  });
});

describe("F8.4a's note-offer accept hand-off has a real production caller ([D-176], ol-r1by)", () => {
  // Same defect shape the `[D-171]` describe block above already proved:
  // `createObsidianAcceptNoteOfferPort` and `createLocalRegistryProvider`'s
  // `acceptNoteOfferPort` dependency are complete and wired to the port's own
  // fallback (`registry/provider.ts`'s "logs and does nothing" default), but
  // that default is exactly what a caller that forgot the one-line addition
  // would silently ship with — this asserts `main.ts` actually crosses that
  // seam with the real Obsidian-backed port, not the logging fallback.
  // `createObsidianAcceptNoteOfferPort` takes `vault` (a `VaultSource`), not
  // `this.app` — see `obsidian-ports.ts`'s own doc on why the write goes
  // through `VaultSource` rather than `app.vault`.
  it('passes the real Obsidian-backed acceptNoteOfferPort into createLocalRegistryProvider', () => {
    expect(main).toMatch(/acceptNoteOfferPort:\s*createObsidianAcceptNoteOfferPort\(vault\),/);
  });
});

describe("component 3.5's plan-policy fetch has a real production caller ([D-167], ol-v7r5.25 / ol-v7r5.27)", () => {
  // Same defect shape this file's own module doc opens with, and the same
  // shape the rank-weights describe block above already proved once:
  // `buildPlanPolicyWiring` and `fetchPlan`'s `readPlanPolicy` dep were
  // complete and tested (`test/plan/plan-policy-wiring.spec.ts`,
  // `test/plan/provider.spec.ts`), while nothing in `main.ts` ever
  // constructed the wiring or threaded it into `createLocalStudyPlanProvider`
  // — ol-v7r5.25's own close evidence recorded this as deliberately deferred
  // to ol-v7r5.27. These assertions are the source-level proof the seam is
  // now crossed.

  it('builds the plan-policy wiring through the tested composer, against the real data host and a real POST adapter', () => {
    expect(main).toMatch(
      /this\.planPolicy\s*=\s*await buildPlanPolicyWiring\(\{\s*dataHost:\s*this,\s*httpPost:/,
    );
  });

  it('imports the real composer and the real HTTP adapter it POSTs over, not stubs', () => {
    expect(main).toMatch(
      /import\s*\{\s*buildPlanPolicyWiring,\s*type PlanPolicyWiring\s*\}\s*from\s*'\.\/plan\/plan-policy-wiring\.js'/,
    );
    expect(main).toMatch(
      /import \{ createObsidianWorkerTransport, obsidianHttpRequest \} from '\.\/worker\/obsidian-transport\.js';/,
    );
  });

  it('threads the fetched policy into the study-plan provider, omitting the key when unconfigured rather than passing undefined (exactOptionalPropertyTypes, F7.8) — same shape as readRankWeights', () => {
    expect(main).toMatch(
      /\.\.\.\(this\.planPolicy\?\.readPlanPolicy\s*\?\s*\{ readPlanPolicy: this\.planPolicy\.readPlanPolicy \}\s*:\s*\{\}\)/,
    );
  });
});

describe('[SESS-14] (ol-egov.132.15): windowDeficitFromReviewLog builds sharesByPlanVersion from the cached plan', () => {
  // Scenario: `features/F2-review.md`, "SESS-14 — the window reads the plan's
  // own shares for a session it actually composed" (olea-service).
  //
  // `session/cluster.ts`'s `pastSessionsFromReviewLog` has taken an optional
  // `sharesByPlanVersion` since SESS-13 (ol-egov.132.14), and that join is
  // unit-tested directly in `packages/core/src/session/cluster.spec.ts`
  // ("entitlement is the plan's share, never the share that was served").
  // What SESS-13 left undone, and this proves at the source level (`main.ts`
  // imports `obsidian` and cannot be instantiated under Vitest — see this
  // file's own module doc), is that `windowDeficitFromReviewLog` actually
  // builds the map at all: before this bead it called
  // `pastSessionsFromReviewLog` with no `sharesByPlanVersion` key present,
  // so the join always took the "unknown version" branch regardless of
  // whether a plan was cached.
  it('pairs the cached plan’s own policyVersion with the same allocation used for currentShares', () => {
    expect(main).toMatch(/const planVersion = this\.review\?\.plan\?\.policyVersion \?\? null;/);
    expect(main).toMatch(
      /const sharesByPlanVersion =\s*planVersion === null \? undefined : new Map\(\[\[planVersion, currentShares\]\]\);/,
    );
  });

  it('threads sharesByPlanVersion into the pastSessionsFromReviewLog call, omitted rather than an empty map when there is no cached plan', () => {
    expect(main).toMatch(
      /const history = pastSessionsFromReviewLog\(input\.entries, \{\s*coursesOfConcept,\s*runningCourses,\s*\.\.\.\(sharesByPlanVersion !== undefined \? \{ sharesByPlanVersion \} : \{\}\),\s*\}\);/,
    );
  });
});

describe('every oracle-ranking caller receives the delivered weights, not just plan/provider.ts (ol-v7r5.61, [IL-D7b])', () => {
  // `ol-v7r5.55` threaded `readRankWeights` through `gap/provider.ts`,
  // `session-builder/provider.ts` and `registry/provider.ts` (client commit
  // `dd8dcf7`), and proved with spies, in each provider's own spec, that the
  // option reaches `composeOracleRanking` when supplied and is omitted when
  // not. What that bead's own close evidence named as still missing —
  // because `main.ts` was a live concurrent lane's file at the time — is
  // that none of `main.ts`'s five construction/call sites actually passed
  // `readRankWeights` in, so every one of these three views and both
  // `composeStudySessionForRequest` calls ran on `DECLARED_FALLBACK_*`
  // in production regardless of whether the Worker was configured.
  //
  // `main.ts` imports `obsidian` and cannot be instantiated under Vitest
  // (this file's own module doc) — a spy on a running instance is not an
  // available instrument here. The same exactOptionalPropertyTypes ternary
  // this file already asserts for `readPlanPolicy` and for the study-plan
  // provider's own `readRankWeights` spread is the proof available at this
  // layer: the truthy branch is the "reaches the provider when configured"
  // half, the `{}` branch is the "absent when not" half, and the assertion
  // pins the exact call site so a future edit to any one of these five sites
  // that drops the spread — while the others keep it, and while the
  // studyPlan-provider assertion above keeps passing — still fails.

  const spread =
    '\\.\\.\\.\\(this\\.rankWeights\\?\\.readRankWeights\\s*\\?\\s*\\{ readRankWeights: this\\.rankWeights\\.readRankWeights \\}\\s*:\\s*\\{\\}\\)';

  it('main.ts:988 — the gap view’s createLocalGapProvider receives it', () => {
    expect(main).toMatch(
      new RegExp(
        `createLocalGapProvider\\(\\{\\s*vault,\\s*deviceId,\\s*settingsHost:\\s*this,\\s*now:\\s*this\\.now,\\s*${spread},[\\s\\S]{0,400}?buildSession:`,
      ),
    );
  });

  it('main.ts:1019 — the session builder view’s createLocalSessionBuilderProvider receives it', () => {
    expect(main).toMatch(
      new RegExp(
        `createLocalSessionBuilderProvider\\(\\{\\s*vault,\\s*deviceId,\\s*settingsHost:\\s*this,\\s*now:\\s*this\\.now,\\s*${spread},[\\s\\S]{0,400}?openExplainBack:`,
      ),
    );
  });

  it('main.ts:1359 — the Home view’s createLocalHomeProvider receives it, the same as the session builder above (ol-egov.141.89.10.40, [D-243], F6.4)', () => {
    // `ol-egov.141.89.10.20` (this describe block's own bead) taught
    // `createLocalHomeProvider` to accept and forward `windowDeficit` and
    // `readRankWeights` to the session-builder provider Home wraps
    // internally, but left the `VIEW_TYPE_OLEA_HOME` construction site
    // itself passing neither — so Home's composed session could disagree
    // with what `VIEW_TYPE_OLEA_SESSION` (Start) composes for the same
    // underlying state. This asserts the same two inputs, wired the same
    // way, reach the Home construction site too.
    // `ol-egov.141.89.5.19` (remainder) added a `citationHashStore` spread
    // between `windowDeficit` and `firstRead` (its own describe block below
    // pins it) — the gap widened from `{0,200}?` to `{0,700}?` to still
    // match past that new spread and its comment.
    expect(main).toMatch(
      new RegExp(
        `createLocalHomeProvider\\(\\{\\s*vault,\\s*deviceId,\\s*settingsHost:\\s*this,\\s*now:\\s*this\\.now,\\s*scheduler,\\s*relations:\\s*\\(\\) => this\\.servedRelationEdges\\(\\),[\\s\\S]{0,300}?plan:\\s*\\(\\) => this\\.review\\?\\.plan \\?\\? null,[\\s\\S]{0,300}?${spread},\\s*windowDeficit: \\(deficitInput\\) => this\\.windowDeficitFromReviewLog\\(deficitInput\\),[\\s\\S]{0,700}?firstRead:`,
      ),
    );
  });

  it('main.ts:1225 — the registry view’s createLocalRegistryProvider receives it', () => {
    expect(main).toMatch(
      new RegExp(
        `createLocalRegistryProvider\\(\\{\\s*vault,\\s*deviceId,\\s*settingsHost:\\s*this,\\s*now:\\s*this\\.now,\\s*${spread},[\\s\\S]{0,400}?editPort:`,
      ),
    );
  });

  it('main.ts:2415 — composeDefaultStudySession’s composeStudySessionForRequest call receives it', () => {
    expect(main).toMatch(
      new RegExp(
        // `ol-egov.141.89.10.14`: the call itself is unchanged; two new
        // statements (retaining `frozenScope`/an initial snapshot) now sit
        // between the call and the `return`, so this pin no longer requires
        // them to be adjacent — see the `ol-egov.141.89.10.14` describe block
        // below for the pin on those two statements themselves.
        // `ol-egov.141.89.5.19` added a `citationHashStore` spread after this
        // one (its own describe block below pins it), so the gap to the
        // closing `},` is no longer immediate.
        `private async composeDefaultStudySession\\(\\): Promise<ComposedStudySession \\| null> \\{[\\s\\S]{0,600}?windowDeficit: \\(deficitInput\\) => this\\.windowDeficitFromReviewLog\\(deficitInput\\),\\s*${spread},[\\s\\S]{0,300}?\\},\\s*\\{ budgetMinutes: DEFAULT_SESSION_BUDGET_MINUTES \\},\\s*now,\\s*\\);[\\s\\S]{0,400}?return result\\?\\.composed\\.full`,
      ),
    );
  });

  it('main.ts:2474 — extendDefaultStudySession’s composeStudySessionForRequest call receives it', () => {
    // `ol-egov.141.89.10.15`'s course pin (below) turned the second argument
    // multi-line, so this pattern matches `budgetMinutes` inside that object
    // rather than the old single-line `{ budgetMinutes: ... }` — the
    // `readRankWeights` spread and the overall call shape are unaffected.
    // `ol-egov.141.89.5.19` added a `citationHashStore` spread after this one
    // (its own describe block below pins it), so the gap to the closing
    // `},` is no longer immediate.
    expect(main).toMatch(
      new RegExp(
        `private async extendDefaultStudySession\\([\\s\\S]{0,600}?windowDeficit: \\(deficitInput\\) => this\\.windowDeficitFromReviewLog\\(deficitInput\\),\\s*${spread},[\\s\\S]{0,300}?\\},\\s*\\{\\s*budgetMinutes: DEFAULT_SESSION_BUDGET_MINUTES,[\\s\\S]{0,200}?\\},\\s*now,\\s*\\);\\s*if \\(result === null\\) return null;`,
      ),
    );
  });

  it('all production callers of composeOracleRanking now receive it — six construction sites (the session-builder view and both composeStudySessionForRequest calls share one provider; Home wraps the session-builder provider too, ol-egov.141.89.10.40)', () => {
    const occurrences = main.match(new RegExp(spread, 'g')) ?? [];
    // The study-plan provider (component 3.3, `[D-110]`, asserted above) plus
    // the five sites `ol-v7r5.61` added, plus the Home construction site
    // `ol-egov.141.89.10.40` adds: 1 + 5 + 1 = 7.
    expect(occurrences.length).toBe(7);
  });
});

describe('[D-351]/[D-330] (ol-egov.141.89.5.19): the pending-revalidation store reaches every direct compose call, so a cited passage awaiting a judge verdict withholds its instrument in production', () => {
  // `session-builder/provider.ts`'s `CreateLocalSessionBuilderProviderDeps
  // .citationHashStore` field doc (added by the same bead this describe
  // block names) says `main.ts` built an `ObsidianCitationHashStore(this)`
  // for a different consumer (`citationRevision`'s wiring) but did not yet
  // thread it into `composeStudySessionForRequest`/
  // `createLocalSessionBuilderProvider` — so `resolveCitationPendingRevalidation`
  // stayed dormant everywhere `main.ts` calls the composer directly. This
  // held the SAME store on `this.citationHashStore` and threaded it into
  // all three of those call sites, the identical `readRankWeights`-shaped
  // ternary the describe block above already pins for a different optional
  // dep, so a caller before `onload` finishes omits the key rather than
  // passing an unassigned value.

  const citationSpread =
    '\\.\\.\\.\\(this\\.citationHashStore \\? \\{ citationHashStore: this\\.citationHashStore \\} : \\{\\}\\)';

  it('this.citationHashStore is the SAME instance buildCitationRevisionWiring receives, constructed once', () => {
    expect(main).toMatch(
      /this\.citationHashStore = new ObsidianCitationHashStore\(this\);\s*this\.citationRevision = buildCitationRevisionWiring\(\{\s*store: this\.citationHashStore,/,
    );
    // One construction, not a second instance built for the session-builder
    // deps — see this file's field doc on why a second instance would be
    // safe but pointless (no per-instance cache to miss).
    expect(main.match(/new ObsidianCitationHashStore\(/g)?.length).toBe(1);
  });

  it('the session builder view’s createLocalSessionBuilderProvider receives it', () => {
    expect(main).toMatch(
      new RegExp(
        `createLocalSessionBuilderProvider\\(\\{\\s*vault,\\s*deviceId,\\s*settingsHost:\\s*this,\\s*now:\\s*this\\.now,[\\s\\S]{0,900}?windowDeficit: \\(deficitInput\\) => this\\.windowDeficitFromReviewLog\\(deficitInput\\),\\s*${citationSpread},\\s*\\}\\),`,
      ),
    );
  });

  it('composeDefaultStudySession’s composeStudySessionForRequest call receives it', () => {
    expect(main).toMatch(
      new RegExp(
        `private async composeDefaultStudySession\\(\\): Promise<ComposedStudySession \\| null> \\{[\\s\\S]{0,1100}?${citationSpread},\\s*\\},\\s*\\{ budgetMinutes: DEFAULT_SESSION_BUDGET_MINUTES \\},\\s*now,\\s*\\);`,
      ),
    );
  });

  it('extendDefaultStudySession’s composeStudySessionForRequest call receives it', () => {
    expect(main).toMatch(
      new RegExp(
        `private async extendDefaultStudySession\\([\\s\\S]{0,1200}?${citationSpread},\\s*\\},\\s*\\{\\s*budgetMinutes: DEFAULT_SESSION_BUDGET_MINUTES,[\\s\\S]{0,200}?\\},\\s*now,\\s*\\);\\s*if \\(result === null\\) return null;`,
      ),
    );
  });

  // `ol-egov.141.89.5.19` remainder: a fourth site — Home's own construction,
  // which wraps `createLocalSessionBuilderProvider` internally
  // (`home/provider.ts`) rather than calling it directly, so it is not one
  // of the "three direct-compose call sites" the test above counts. Without
  // this, Home's preview did not withhold a pending instrument though the
  // session builder did — the exact gap `home/provider.ts`'s
  // `CreateLocalHomeProviderDeps.citationHashStore` doc names.
  it("the Home view's createLocalHomeProvider construction site receives it too", () => {
    expect(main).toMatch(
      new RegExp(
        `windowDeficit: \\(deficitInput\\) => this\\.windowDeficitFromReviewLog\\(deficitInput\\),\\s*${citationSpread},\\s*[\\s\\S]{0,300}?firstRead: \\(\\) => this\\.firstReadFolderViewsFor\\(this\\.tickedCourseFolders\\),\\s*\\}\\);`,
      ),
    );
  });

  // `ol-egov.141.89.6.54` adds a FIFTH occurrence of this same literal spread
  // — `buildReviewSessionInput`'s own construction of `OpenReviewSessionInput`
  // (pinned in that bead's own describe block below) — but for a different
  // concern: it feeds `open-session.ts`'s own `readInstrumentStanding`
  // pending-revalidation READ, never one of the four COMPOSE call sites this
  // block is about. Counted here anyway, since this assertion matches the
  // literal string wherever it occurs; kept at exactly five so a sixth,
  // unaccounted-for occurrence still fails this test.
  it('all four compose call sites (three direct, one via Home) plus the review-tab open/extend site receive it — exactly five occurrences', () => {
    const occurrences = main.match(new RegExp(citationSpread, 'g')) ?? [];
    expect(occurrences.length).toBe(5);
  });
});

describe('ol-egov.141.89.10.15 (bug): extending an outrun session holds the same course it is extending', () => {
  // CONFIRMED bug: `extendDefaultStudySession` used to call
  // `composeStudySessionForRequest` with `{ budgetMinutes: ... }` and no
  // `courseOrTopic`, so `resolveCourseOrTopicFilter` (`session-builder/
  // provider.ts`) returned no restriction and `selectDominantCourse`
  // (`study-session/compose.ts`) reran its filter/urgency/deficit hierarchy
  // fresh, free to land on a different course than `previous`'s own frozen
  // composition — contradicting F2.18/C5.6 and C5.8 as amended ("where she
  // outruns it, C5.8's outrun extends this course's own material"). The
  // behavioural half (a real composition proving the course actually stays
  // pinned across a changed urgency/deficit signal) lives in
  // `test/extend-outrun-course-filter.spec.ts`, since `main.ts` cannot be
  // imported under Vitest (this file's own module doc) — this is the
  // source-level wiring pin that a future edit dropping the pin, or
  // reordering the call so it is computed but never passed, still fails.

  it('derives courseOrTopic from the frozen composition through frozenCourseOrTopicFilter, not inline here', () => {
    expect(main).toMatch(
      /const courseOrTopic = frozenCourseOrTopicFilter\(previous\.dominantCourse\);/,
    );
  });

  it('imports frozenCourseOrTopicFilter from its own obsidian-free module', () => {
    expect(main).toMatch(
      /import \{ frozenCourseOrTopicFilter \} from '\.\/extend-outrun-course-filter\.js';/,
    );
  });

  it("passes the derived courseOrTopic into composeStudySessionForRequest's request argument, omitting the key when undefined (exactOptionalPropertyTypes)", () => {
    expect(main).toMatch(
      /budgetMinutes: DEFAULT_SESSION_BUDGET_MINUTES,\s*\.\.\.\(courseOrTopic !== undefined \? \{ courseOrTopic \} : \{\}\),/,
    );
  });

  it('the courseOrTopic derivation and the composeStudySessionForRequest call both live inside extendDefaultStudySession, not composeDefaultStudySession', () => {
    const extendBody = main.slice(main.indexOf('private async extendDefaultStudySession('));
    expect(extendBody.indexOf('const courseOrTopic = frozenCourseOrTopicFilter')).toBeGreaterThan(
      -1,
    );
    expect(extendBody.indexOf('courseOrTopic !== undefined ? { courseOrTopic }')).toBeGreaterThan(
      extendBody.indexOf('const courseOrTopic = frozenCourseOrTopicFilter'),
    );
    // composeDefaultStudySession (the sibling "open" path) is never given a
    // courseOrTopic restriction — see its own doc for why (no steering on a
    // fresh compose).
    const composeBody = main.slice(
      main.indexOf('private async composeDefaultStudySession('),
      main.indexOf('private async extendDefaultStudySession('),
    );
    expect(composeBody).not.toMatch(/courseOrTopic/);
  });
});

describe('ol-egov.141.89.10.4 (bug, fixed): a second outrun-the-target extend now widens further than the first, instead of landing on the same figure', () => {
  // CONFIRMED bug (filed as a follow-up from `ol-egov.141.89.10.65`'s
  // report): `extendDefaultStudySession` computed `widerBudgetMinutes` off
  // `previous.model.budgetMinutes`, then returned `{ ...previous, model: {
  // ...previous.model, items } }` — spreading the wider `items` but never
  // `budgetMinutes` onto the returned session. F2.17/C5.8 and F2.18 (`the
  // extension is composed under the same plan's shares... where she outruns
  // it, C5.8's outrun extends this course's own material`) say she can keep
  // outrunning the target; this method's own doc says each call widens "by
  // one more DEFAULT_SESSION_BUDGET_MINUTES-sized step" from wherever the
  // session currently stands. With `budgetMinutes` never persisted, a SECOND
  // "keep going" read the same stale figure the first one started from,
  // recomputed the identical `widerBudgetMinutes`, and appended nothing —
  // the outrun silently stalled the second time. The behavioural proof, run
  // through the real `composeStudySessionForRequest`/`extendComposedStudySession`
  // functions this method calls, lives in
  // `test/session-builder/outrun-extend-budget-progression.spec.ts`, since
  // `main.ts` cannot be imported under Vitest (this file's own module doc)
  // — this is the source-level pin that a future edit dropping the
  // `budgetMinutes` update, or reintroducing the old spread, still fails.
  it('persists the widened budget onto the returned session, not only the wider item list', () => {
    const extendBody = main.slice(main.indexOf('private async extendDefaultStudySession('));
    expect(extendBody).toMatch(
      /return \{ \.\.\.previous, model: \{ \.\.\.previous\.model, budgetMinutes: widerBudgetMinutes, items \} \};/,
    );
  });
});

describe('ol-egov.141.89.10.4.1 (bug, fixed): Start’s holder entry passes the COMPOSITION’s own plan, not a fresh re-read', () => {
  // `ol-egov.141.89.10.47` first fixed `enterStudySessionHolderForStart`
  // calling `this.studySessionHolder.enter(now, composed)` with no third
  // argument at all (`StudySessionHolder.enter`, `session/holder.ts`, left
  // the sitting's composition plan uncaptured — captured only lazily, at the
  // first `resolveCompositionPlan` call, in practice the first review-tab
  // open rather than the true entry instant, C5.8/`[D-193]`) by passing
  // `this.review?.plan ?? null`. That fix was itself a second bug, confirmed
  // by `ol-egov.141.89.10.65`'s lane: `this.review?.plan ??
  // null` re-read `this.review.plan` fresh AFTER `composeDefaultStudySession`
  // had already resolved. `refreshCachedStudyPlan` mutates `this.review.plan`
  // in place on its own schedule, so a refresh landing while
  // `composeDefaultStudySession` was still running (it awaits a vault walk, a
  // review-log read and the oracle chain) meant the plan `enter()` stamped
  // onto the sitting could disagree with the plan the composition actually
  // read — the review-log stamp then disagrees with what was composed. Fixed
  // by capturing the plan as a side effect of the SAME getter
  // `composeStudySessionForRequest` calls internally
  // (`this.lastComposedSessionPlan`, that field's own doc), so there is only
  // one read of `wiring.plan` for a given compose, not two independently
  // timed ones.

  it('captures the plan inside composeDefaultStudySession’s own plan getter, into this.lastComposedSessionPlan', () => {
    expect(main).toMatch(
      /plan: \(\) => \{\s*this\.lastComposedSessionPlan = wiring\.plan;\s*return wiring\.plan;\s*\},/,
    );
  });

  it('declares this.lastComposedSessionPlan as a private field, typed to allow the "nothing composed yet" state', () => {
    expect(main).toMatch(
      /private lastComposedSessionPlan: StudyPlanEnvelope \| null \| undefined;/,
    );
  });

  it('enter is called with the captured composition plan, never a fresh this.review?.plan read', () => {
    expect(main).toMatch(
      /if \(composed !== null\)\s*this\.studySessionHolder\.enter\(now, composed, this\.lastComposedSessionPlan\);/,
    );
    expect(main).not.toMatch(
      /this\.studySessionHolder\.enter\(now, composed, this\.review\?\.plan \?\? null\)/,
    );
  });
});

describe('ol-egov.141.89.10.4.1 (open-session half, bug fixed): buildReviewSessionInput supplies composedSessionPlan over this.lastComposedSessionPlan', () => {
  // The Start path above (`enterStudySessionHolderForStart`) was fixed to
  // read `this.lastComposedSessionPlan` instead of a fresh `this.review?.plan`
  // read. `review/open-session.ts`'s OWN fresh-compose branch (opening the
  // review tab directly, holder idle) had the identical defect one layer
  // earlier: `buildReviewSessionInput` supplied `plan: wiring.plan` — a
  // snapshot fixed when this whole input object is built, BEFORE
  // `composeDefaultStudySession` is ever invoked — and `open-session.ts`
  // stamped the fresh sitting from that stale `input.plan` rather than the
  // plan the composition actually read. Fixed by threading a new
  // `composedSessionPlan` port, a closure over the SAME
  // `this.lastComposedSessionPlan` field the Start-path fix above already
  // populates, which `open-session.ts` now reads instead of `input.plan`
  // for a fresh entry (see that module's own doc).

  it('buildReviewSessionInput supplies composedSessionPlan as a closure over this.lastComposedSessionPlan, right after composeDefaultStudySession', () => {
    expect(main).toMatch(
      /composeDefaultStudySession:\s*\(\)\s*=>\s*this\.composeDefaultStudySession\(\),\s*(?:\/\/.*\s*)*composedSessionPlan:\s*\(\)\s*=>\s*this\.lastComposedSessionPlan\s*\?\?\s*null,/,
    );
  });

  it('never re-reads wiring.plan for composedSessionPlan (that would reintroduce the pre-fix race)', () => {
    const buildReviewSessionInputBody = main.slice(
      main.indexOf('private async buildReviewSessionInput('),
      main.indexOf('private async composeReviewSession('),
    );
    expect(buildReviewSessionInputBody).not.toMatch(
      /composedSessionPlan:\s*\(\)\s*=>\s*wiring\.plan/,
    );
  });
});

describe('ol-egov.141.89.10.14 (bug, fixed): the shared session holder now computes real staleness', () => {
  // FIXED: `ol-egov.141.89.10.46` (client 15a222d) exported
  // `session-builder/provider.ts`'s `buildScopeSnapshotAt` (plus its two
  // supporting types), so `main.ts` can now turn a held `FrozenSittingScope`
  // into a fresh `SittingScopeSnapshot` without re-deriving the due/arrival/
  // band logic a second, drifting way ([D-033]). This pins BOTH halves of
  // the fix: `composeDefaultStudySession` now retains the compose result's
  // `frozenScope` (and an initial snapshot) in `sharedSittingFrozenScope`/
  // `sharedSittingFrozenSnapshot` instead of discarding it, and
  // `enterStudySessionHolderForStart` now hands those, plus the sitting's own
  // `enteredAt` and a fresh `now`, to `computeSharedSittingStaleness`
  // (`session/shared-sitting-staleness.ts`) rather than passing literal
  // `false`s. That helper — not `main.ts` — is where the real diffing logic
  // lives, precisely because `main.ts` cannot be imported under Vitest (this
  // file's own module doc): the behavioural half (a material change actually
  // ending a held sitting at next entry, and no change holding it) lives in
  // `test/session/shared-sitting-staleness.spec.ts`, which drives that helper
  // directly. This describe block is the source-level wiring pin confirming
  // `main.ts` actually calls it with the right arguments.

  it('composeDefaultStudySession retains the compose result’s frozenScope and an initial snapshot, rather than discarding them', () => {
    expect(main).toMatch(/this\.sharedSittingFrozenScope = result\?\.frozenScope;/);
    expect(main).toMatch(
      /this\.sharedSittingFrozenSnapshot =\s*result !== null\s*\? await buildScopeSnapshotAt\(\s*result\.frozenScope,\s*localToday\(now\),\s*wiring\.vault\.firstSeen\?\.bind\(wiring\.vault\),\s*\)\s*: undefined;/,
    );
    expect(main).toMatch(/return result\?\.composed\.full \?\? null;/);
  });

  it('enterStudySessionHolderForStart imports and calls computeSharedSittingStaleness with the retained freeze, the sitting’s own enteredAt and now, not literal falses', () => {
    expect(main).toMatch(
      /import \{ computeSharedSittingStaleness \} from '\.\/session\/shared-sitting-staleness\.js';/,
    );
    expect(main).toMatch(
      /const wiring = this\.review;\s*const staleness = await computeSharedSittingStaleness\(\s*\{\s*frozenScope: this\.sharedSittingFrozenScope,\s*frozenSnapshot: this\.sharedSittingFrozenSnapshot,\s*\},\s*sitting\.enteredAt,\s*now,\s*wiring === null \? undefined : wiring\.vault\.firstSeen\?\.bind\(wiring\.vault\),\s*\);/,
    );
    expect(main).toMatch(/staleness,\s*\}\);/);
  });

  it('the staleness object is no longer a literal all-false constant', () => {
    expect(main).not.toMatch(
      /staleness:\s*\{\s*itemsDueInScope:\s*false,\s*materialArrivedInScope:\s*false,\s*assessmentProximityBandCrossedInScope:\s*false,\s*\},/,
    );
  });
});

describe('[ILB-CHG-4] (ol-egov.141.89.5.4), component register row 3.6: the shared holder also treats a newly-pending citation as staleness', () => {
  // FIXED: `ol-egov.141.89.10.14` wired `itemsDueInScope`/`materialArrivedInScope`/
  // `assessmentProximityBandCrossedInScope` to real facts (the describe block
  // above), but that diff never read this chain's own [D-351] pending-
  // revalidation records, so a citation newly known to have changed since the
  // sitting was frozen held the sitting open regardless. `main.ts` cannot be
  // imported under Vitest (this file's own module doc); the real diffing
  // logic (`hasCitationRevisionChangedInScope`) is unit-tested directly in
  // `packages/core/src/concept/revision/session-staleness.spec.ts`, and
  // `session/holder.ts`'s own `materialChangedInScopeSinceFreeze` (which this
  // wiring calls) is unit-tested in `test/session/holder.spec.ts` — both
  // outside this bead's owned paths, read only. This is the source-level
  // wiring pin confirming `enterStudySessionHolderForStart` actually resolves
  // the live pending set (from the SAME `CitationHashStore` `session-builder/
  // provider.ts`'s own resolver reads) and ORs the result into `staleness`
  // before the existing `decide()` call — never a second, independent
  // trigger, and never a substitution of one item mid-session ([D-330]).

  it('imports resolveCitationPendingRevalidation and instrumentIdsInScope from session-builder/provider.js', () => {
    expect(main).toMatch(
      /import \{\s*buildScopeSnapshotAt,\s*composeStudySessionForRequest,\s*createLocalSessionBuilderProvider,\s*type FrozenSittingScope,\s*instrumentIdsInScope,\s*resolveCitationPendingRevalidation,\s*\} from '\.\/session-builder\/provider\.js';/,
    );
  });

  it('computes the live pending-revalidation set from this.citationHashStore over the held sitting’s own frozen scope, omitting the key shape (never a second store) when either is absent', () => {
    expect(main).toMatch(
      /const currentPendingRevalidation =\s*this\.citationHashStore !== null && this\.sharedSittingFrozenScope !== undefined\s*\? await resolveCitationPendingRevalidation\(\s*this\.citationHashStore,\s*instrumentIdsInScope\(this\.sharedSittingFrozenScope\),\s*\)\s*: new Set<string>\(\);/,
    );
  });

  it('calls the holder’s own materialChangedInScopeSinceFreeze with that live set, then ORs the result into materialArrivedInScope before decide()', () => {
    expect(main).toMatch(
      /const citationRevisionChangedInScope =\s*this\.studySessionHolder\.materialChangedInScopeSinceFreeze\(currentPendingRevalidation\);/,
    );
    expect(main).toMatch(
      /staleness: citationRevisionChangedInScope\s*\? \{ \.\.\.staleness, materialArrivedInScope: true \}\s*: staleness,\s*\}\);/,
    );
  });
});

describe('[D-167] the study-plan refresh now has a between-sessions trigger too, not just onload (ol-egov.141.89.10.17)', () => {
  // CONFIRMED bug: `refreshCachedStudyPlan` had exactly one call site,
  // `onload` — a plan built once, cached, and never touched again for the
  // rest of a session, even across a day boundary, contrary to A2.5's "the
  // clock schedules the check ... recomputes about daily" (`[D-167]`). The
  // actual day-boundary predicate is unit-tested directly against real
  // clock values in `test/plan/refresh-schedule.spec.ts`, since it imports
  // no `obsidian`; these are the source-level checks that `main.ts` actually
  // wires that predicate into the recurring tick and back into
  // `refreshCachedStudyPlan`, the same reachability shape this file's own
  // module doc opens with.

  it('seeds a lastCheckedDay state right after the onload refresh, from the real localToday/Date pair', () => {
    expect(main).toMatch(
      /void this\.refreshCachedStudyPlan\(vault, deviceId, studyPlanStore\);[\s\S]{0,300}?const studyPlanRefreshState = \{ lastCheckedDay: localToday\(this\.now\(\)\) \};/,
    );
  });

  it('the ingestion-tick interval evaluates studyPlanRefreshDue on every poll, alongside the other ticked work', () => {
    expect(main).toMatch(
      /void this\.drainPendingMaterialityEdits\(\);[\s\S]{0,300}?const studyPlanRefreshCheckedAt = this\.now\(\);\s*if \(studyPlanRefreshDue\(studyPlanRefreshState\.lastCheckedDay, studyPlanRefreshCheckedAt\)\) \{/,
    );
  });

  it('only re-runs refreshCachedStudyPlan, and only updates lastCheckedDay, when the predicate actually fires — not on every tick', () => {
    expect(main).toMatch(
      /if \(studyPlanRefreshDue\(studyPlanRefreshState\.lastCheckedDay, studyPlanRefreshCheckedAt\)\) \{\s*studyPlanRefreshState\.lastCheckedDay = localToday\(studyPlanRefreshCheckedAt\);\s*void this\.refreshCachedStudyPlan\(vault, deviceId, studyPlanStore\);\s*\}/,
    );
  });

  it('imports the pure predicate from its own testable module, not an inline re-implementation', () => {
    expect(main).toMatch(/import \{ studyPlanRefreshDue \} from '\.\/plan\/refresh-schedule\.js';/);
  });
});

describe('ol-egov.141.89.10.55: a failed Worker call now reaches the usage log too, and the transport measures its own latency', () => {
  // `ol-egov.141.89.10.50` built `buildFailedUsageLogEntry` and the
  // transport's `onCallFailed` plumbing, but `main.ts`'s
  // `createRecordingTransport` passed only the success recorder — the same
  // "built, never wired" defect shape this file's own module doc opens
  // with. These are the source-level checks that the second, failed-call
  // recorder argument is now supplied for real. The round-trip measurement
  // itself is unit-tested directly against a fake, artificially delayed
  // `HttpRequestFn` in `test/worker/transport.spec.ts`, since `transport.ts`
  // imports no `obsidian` and can be loaded under Vitest.

  it('createRecordingTransport now passes a second, failed-call recorder to createObsidianWorkerTransport', () => {
    expect(main).toMatch(
      /createObsidianWorkerTransport\(\s*config,\s*\(entry\) => \{\s*void usageLogStore\.record\(\{ \.\.\.entry, recordedAt: this\.now\(\)\.toISOString\(\) \}\);\s*\},\s*\(entry\) => \{\s*void usageLogStore\.record\(buildFailedUsageLogEntry\(entry, this\.now\(\)\.toISOString\(\)\)\);\s*\},\s*\);/,
    );
  });

  it('imports buildFailedUsageLogEntry from usage/types, not a local reimplementation', () => {
    expect(main).toMatch(/import \{ buildFailedUsageLogEntry \} from '\.\/usage\/types\.js';/);
  });
});

describe("the plugin exposes dataFileHost's atomic readModifyWrite on itself (ol-ppxj.52)", () => {
  // `ol-ppxj.46`'s report (section 3): about nineteen sites construct a
  // store with `this` (the plugin instance) as its host — directly (e.g.
  // `new ObsidianUsageLogStore(this)`), or via `dataHost`/`settingsHost:
  // this` in a wiring deps object — never with `this.dataFileHost` itself.
  // Those seventeen stores now take the atomic `readModifyWrite` path
  // whenever `hasReadModifyWrite` sees it on the host
  // (`retrieval/serializing-data-host.ts`), but until this bead the plugin
  // class had no `readModifyWrite` method of its own, so
  // `hasReadModifyWrite(this)` was false at every one of those production
  // sites and they all still took the honest, non-atomic fallback — this
  // bead's fix makes the store-level migration reachable in production.
  // `main.ts` cannot be instantiated under Vitest (this file's own module
  // doc), so this is the source-level pin that the passthrough method
  // exists, declared right after `override loadData`/`saveData` on the
  // dataFileHost routing. The behavioural proof that a store built with a
  // plugin-shaped host actually takes the atomic path — not just that this
  // method is textually present — lives in
  // `test/retrieval/plugin-shaped-host-atomic-path.spec.ts`, which models
  // the plugin-shaped host with the identical three-method delegate this
  // method plus the existing loadData/saveData overrides give `this`.

  it('declares readModifyWrite as a plain instance method delegating to this.dataFileHost.readModifyWrite', () => {
    expect(main).toMatch(
      /readModifyWrite\(mutate: \(current: unknown\) => unknown \| Promise<unknown>\): Promise<void> \{\s*return this\.dataFileHost\.readModifyWrite\(mutate\);\s*\}/,
    );
  });

  it('is declared right after the override saveData routing, so it sits beside the pair it complements', () => {
    expect(main).toMatch(
      // `codeOf` strips comments before building `main`, so the doc comment
      // between the two methods collapses to whitespace here.
      /override saveData\(data: unknown\): Promise<void> \{\s*return this\.dataFileHost\.saveData\(data\);\s*\}\s*readModifyWrite\(mutate: \(current: unknown\) => unknown \| Promise<unknown>\): Promise<void> \{/,
    );
  });

  it('dataFileHost is the first field declared on the class, so every store construction site — later fields and every onload()-time site alike — sees it already built: no ordering gap for this method to guard', () => {
    expect(main).toMatch(
      /class OleaPlugin extends Plugin \{[\s\S]{0,700}?private readonly dataFileHost = new SerializingDataHost\(\{\s*loadData: \(\) => super\.loadData\(\),\s*saveData: \(data\) => super\.saveData\(data\),\s*\}\);/,
    );
  });
});

// `ol-3ux7.64.27`: `diagnostics-clipboard.ts`'s `DiagnosticsSources.now` and
// `concept/wiring.ts`'s `ReadConceptsAndRelationsOptions.now` both existed
// (`ol-3ux7.64.26`) but neither production call site here threaded
// `this.now` through — so under the workbench simulator, the diagnostics
// report's `generatedAt` and the relation-cache record's `mintedAt`/
// `updatedAt` still read real wall time instead of the simulated instant.
// Source-level pins, same reasoning as every other block in this file:
// `main.ts` cannot be instantiated under Vitest.
describe('the plugin clock reaches diagnostics and the relation-cache sync', () => {
  it('copyDiagnostics threads this.now into DiagnosticsSources', () => {
    expect(main).toMatch(
      /copyDiagnostics: \(\) => \{\s*void copyDiagnosticsToClipboard\(\{\s*pluginVersion: this\.manifest\.version,\s*loadQueue: \(\) => new ObsidianQueueStore\(this\)\.load\(\),\s*loadIndex: \(\) => new ObsidianKeywordIndexStore\(this\)\.load\(\),\s*now: this\.now,\s*\}\);\s*\},/,
    );
  });

  it('the ingestion tick threads this.now into readConceptsAndRelations, so the relation-cache sync sees the simulated clock', () => {
    expect(main).toMatch(
      /const pass = await readConceptsAndRelations\(\s*this\.concept,\s*this\.corpusRelation,\s*this\.corpusRelationStateStore,\s*\{\s*vault,\s*ingestionSessionClosed: true,\s*now: this\.now,/,
    );
  });

  it("setClock's doc comment matches mountPlugin's clock-before-onload ordering, not a post-mount call", () => {
    // `codeOf` strips doc comments, so this one check reads the raw source —
    // the doc comment's TEXT is exactly what this test pins.
    const rawMain = readFileSync(`${srcDir}main.ts`, 'utf8');
    expect(rawMain).toMatch(/mountPlugin`'s own `clock` deps/);
    expect(rawMain).toMatch(/applied BEFORE `onload\(\)` runs/);
    expect(rawMain).not.toMatch(/calls this right after mounting, before any view\s*opens/);
  });
});

// `ol-egov.141.89.9.34` round 2 (`[D-360]`): the queued regrading workflow's
// three call sites — build at startup (judge omitted, activation off by
// construction), enqueue on dispute, and drain on reconnect through the
// gated wrapper, never `engine.tick()` directly. Source-level pins, same
// reasoning as every other block in this file.
describe('[D-360]: the contest-regrade engine is built at startup with judge omitted', () => {
  it('builds this.contestRegradeEngine via createContestRegradeEngine before this.review is assigned', () => {
    const engineIndex = main.indexOf(
      'this.contestRegradeEngine = await createContestRegradeEngine(',
    );
    const reviewIndex = main.indexOf('this.review = {');
    expect(engineIndex).toBeGreaterThan(-1);
    expect(reviewIndex).toBeGreaterThan(-1);
    expect(engineIndex).toBeLessThan(reviewIndex);
  });

  it('passes port, loadDispute, loadRecords and appendCorrectiveRegrade — and no judge', () => {
    const start = main.indexOf('this.contestRegradeEngine = await createContestRegradeEngine(');
    const end = main.indexOf('obsidianDeviceCapability(),', start);
    expect(start).toBeGreaterThan(-1);
    expect(end).toBeGreaterThan(start);
    const call = main.slice(start, end);
    expect(call).toMatch(/port: gradeContestPort,/);
    expect(call).toMatch(
      /loadDispute: \(disputeEventId\) =>\s*this\.findDisputeForContestRegrade\(vault, disputeEventId\),/,
    );
    expect(call).toMatch(
      /loadRecords: \(\) => this\.loadReviewLogEntriesForContestRegrade\(vault\),/,
    );
    expect(call).toMatch(/appendCorrectiveRegrade: \(\) =>/);
    // The one thing this round deliberately omits — see the doc this test
    // cannot read (comments are stripped), and this bead's report.
    expect(call).not.toMatch(/judge:/);
  });

  it('shares one GradeContestPort instance between this.review.ports.gradeContestPort and the engine', () => {
    expect(main).toMatch(
      /const gradeContestPort = createVaultGradeContestPort\(vault, deviceId, \(\) =>\s*isoWithLocalOffset\(this\.now\(\)\),\s*\);/,
    );
    // Both readers use the SAME local, never a second construction.
    expect(main.match(/createVaultGradeContestPort\(/g)?.length).toBe(1);
    expect(main).toMatch(/port: gradeContestPort,/);
    expect(main).toMatch(/gradeContestPort,\s*\n/);
  });
});

describe('[D-360]: the reconnect drain calls the gated wrapper, never engine.tick() directly', () => {
  it('registers runContestRegradeDrain in the same interval as the other per-tick drains', () => {
    const intervalStart = main.indexOf('this.registerInterval(');
    const intervalEnd = main.indexOf('INGESTION_TICK_INTERVAL_MS),\n    );', intervalStart);
    expect(intervalStart).toBeGreaterThan(-1);
    expect(intervalEnd).toBeGreaterThan(intervalStart);
    const interval = main.slice(intervalStart, intervalEnd);
    expect(interval).toMatch(/void this\.tickIngestionAndMaybeRunCorpusRelations\(\);/);
    expect(interval).toMatch(/void this\.runContestRegradeDrain\(\);/);
  });

  it('runContestRegradeDrain calls drainContestRegradeQueue(this.contestRegradeEngine), and nothing in this file calls .tick() on it directly', () => {
    expect(main).toMatch(
      /private async runContestRegradeDrain\(\): Promise<void> \{\s*if \(this\.contestRegradeEngine === null\) return;\s*await drainContestRegradeQueue\(this\.contestRegradeEngine\);\s*\}/,
    );
    expect(main).not.toMatch(/this\.contestRegradeEngine\.tick\(\)/);
  });
});

describe('[D-360]: the enqueue-on-dispute helper is real and reuses enqueueContestRegradeJobOnDispute', () => {
  it('enqueueContestRegradeJobOnDisputeBestEffort reads records fresh and calls the shared enqueue function', () => {
    expect(main).toMatch(
      /private async enqueueContestRegradeJobOnDisputeBestEffort\(\s*vault: VaultSource,\s*dispute: DisputeLogRecord,\s*\): Promise<void> \{\s*const engine = this\.contestRegradeEngine;\s*if \(engine === null\) return;\s*try \{\s*const records = await this\.loadReviewLogEntriesForContestRegrade\(vault\);\s*await enqueueContestRegradeJobOnDispute\(engine, dispute, records\);/,
    );
  });

  // `open-session.ts`'s `ReviewSessionPorts.contestRegradeEnqueuer` and its
  // own field-for-field `new ReviewSession({...})` thread now exist (client
  // commit `d75d3ee`), so the one remaining wire — this file's own `ports`
  // object — is restored here, beside `gradeContestPort`. Activation itself
  // stays off regardless (`this.contestRegradeEngine`'s own
  // `DEFAULT_CONTEST_REGRADE_ACTIVATION` doc above): no paid call is
  // reachable through this yet, only the trigger that will call it once
  // activation flips.
  it('contestRegradeEnqueuer is threaded into ports, beside gradeContestPort, calling the best-effort helper with the same vault', () => {
    // `main` (`codeOf`) strips comments, so this pins the code shape only —
    // not the restored `[D-360]` comment, which stays in the raw source.
    expect(main).toMatch(
      /gradeContestPort,\s*contestRegradeEnqueuer:\s*\{\s*enqueueOnDispute:\s*\(dispute\)\s*=>\s*this\.enqueueContestRegradeJobOnDisputeBestEffort\(vault,\s*dispute\),\s*\},\s*\},/,
    );
  });
});
