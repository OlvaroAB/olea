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
    ['reviewLog', /reviewLog:\s*createVaultReviewLogPort\(vault, deviceId\)/],
    ['suspendPort', /suspendPort:\s*createVaultSuspendPort\(vault, deviceId\)/],
    [
      'explainBackOfferLog',
      /explainBackOfferLog:\s*createVaultExplainBackOfferLogPort\(vault, deviceId\)/,
    ],
    ['editPort', /editPort:\s*createObsidianEditPort\(this\.app\)/],
    ['noteExists', /noteExists:\s*createVaultNoteExistsPort\(vault\)/],
    ['clock', /clock:\s*systemClock/],
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
      /new OleaSettingTab\(\s*this\.app,\s*this,\s*this,\s*createRecordingTransport,\s*\{ vault, deviceId \},\s*headingOfferSetting,?\s*\)/,
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
      /async recordExplainBackSoloGradeAndReview\(params:\s*\{[\s\S]*?\}\):\s*Promise<SoloLevel \| undefined> \{\s*if \(this\.grading === null\) return;\s*const outcome = await recordSoloGradeAndReview\(\s*\{\s*grading:\s*this\.grading,\s*vault:\s*new ObsidianSource\(this\.app\),\s*deviceId:\s*await ensureDeviceId\(this\),\s*now:\s*\(\) => new Date\(\),\s*\},\s*params,\s*\);/,
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
      /async buildExplainBackMisconceptionDigestFor\(\s*conceptIds:\s*readonly string\[\],\s*\):\s*Promise<GradeExplainBackInput\['misconceptionDigest'\]> \{\s*const vault = new ObsidianSource\(this\.app\);\s*const deviceId = await ensureDeviceId\(this\);\s*const store = createVaultMisconceptionStore\(\{ vault, deviceId, now: \(\) => new Date\(\) \}\);\s*const records = \(await store\.load\(\)\) \?\? \[\];\s*return buildMisconceptionDigest\(records, \{ conceptIds: \[\.\.\.conceptIds\] \}\);/,
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
      /private explainBackMasteryStateReader\(\):\s*\(conceptId: string\) => MasteryState \| null \{\s*const vault = new ObsidianSource\(this\.app\);\s*let snapshot: readonly ReviewLogEntry\[\] \| null = null;\s*void readReviewLogHistory\(vault\)\s*\.then\(\(\{ entries \}\) => \{\s*snapshot = entries;\s*\}\)/,
    );
  });

  it('resolves mastery state through computeAllConceptMastery, defaulting to null (unconfirmed) while the snapshot is outstanding', () => {
    expect(main).toMatch(
      /return \(conceptId\) =>\s*snapshot === null\s*\?\s*null\s*:\s*\(computeAllConceptMastery\(snapshot, \[conceptId\]\)\.get\(conceptId\)\?\.state \?\? null\);/,
    );
  });

  it("supplies that reader as ExplainBackModal's getMasteryState dep", () => {
    expect(main).toMatch(/getMasteryState: this\.explainBackMasteryStateReader\(\),/);
  });

  it('imports computeAllConceptMastery from olea-core', () => {
    expect(main).toMatch(/computeAllConceptMastery,/);
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

  it('exposes a production entry point that appends a non-attempt record with the given trigger', () => {
    expect(main).toMatch(
      /private async recordExplainBackNonAttempt\(\s*trigger: NonAttemptLogRecordInput\['trigger'\],\s*params: \{ readonly conceptIds: readonly string\[\]; readonly timestamp: string \},\s*\): Promise<void> \{\s*const vault = new ObsidianSource\(this\.app\);\s*const deviceId = await ensureDeviceId\(this\);\s*await appendNonAttemptRecord\(\s*vault,\s*\{ conceptIds: \[\.\.\.params\.conceptIds\], timestamp: params\.timestamp, trigger \},\s*\{ deviceId \},\s*\);/,
    );
  });

  it("openExplainBackModal takes an optional trigger and resolves 'on-demand' for the 'freeform' seed, the caller's trigger otherwise", () => {
    expect(main).toMatch(
      /private openExplainBackModal\(\s*seed: ExplainBackSeed,\s*trigger\?: ExplainBackOfferTrigger,\s*onClosed\?: \(\) => void,\s*\): void \{\s*const nonAttemptTrigger: ExplainBackOfferTrigger \| undefined =\s*seed\.kind === 'freeform' \? 'on-demand' : trigger;/,
    );
  });

  it('wires recordNonAttempt whenever a trigger was resolved, for either seed kind', () => {
    expect(main).toMatch(
      /\.\.\.\(nonAttemptTrigger !== undefined\s*\?\s*\{\s*recordNonAttempt: \(params: \{ conceptIds: readonly string\[\]; timestamp: string \}\) =>\s*this\.recordExplainBackNonAttempt\(nonAttemptTrigger, params\),\s*\}\s*: \{\}\),/,
    );
  });

  it("the ReviewView construction site forwards review/view.ts's per-banner trigger into openExplainBackModal", () => {
    expect(main).toMatch(
      /\(instrument, trigger\) =>\s*this\.openExplainBackModal\(\{ kind: 'instrument', instrument \}, trigger\),/,
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

describe('a fresh retrieval at accept time feeds the stale-source rejection for real (ol-gavc)', () => {
  // `ol-0r92.89` built `hasExplainBackSourceRevisionChanged`
  // (`explain-back/observation.ts`) and the reject-on-stale guard one layer
  // down (`grading/wiring.ts`), but no production caller set
  // `sourceRevisionStale` — this method is the named missing caller.

  it('re-retrieves the source blocks against the same query the prompt was graded against', () => {
    expect(main).toMatch(
      /private async buildExplainBackObservationContextFor\(params:\s*\{\s*readonly subjectConceptId:\s*string \| null;\s*readonly originInstrumentId:\s*string;\s*readonly sourceBlocks:\s*readonly ExplainBackSourceBlock\[\];\s*readonly query:\s*string;\s*\}\):\s*Promise<AcceptExplainBackGradingWithObservationContext> \{/,
    );
    expect(main).toMatch(
      /const freshSourceBlocks = await this\.composeExplainBackSourceBlocks\(params\.query\);/,
    );
  });

  it('passes the comparison through as sourceRevisionStale, never re-derived downstream', () => {
    expect(main).toMatch(
      /sourceRevisionStale:\s*hasExplainBackSourceRevisionChanged\(\s*params\.sourceBlocks,\s*freshSourceBlocks,\s*\),/,
    );
  });

  it('imports hasExplainBackSourceRevisionChanged alongside the observation-context builder', () => {
    expect(main).toMatch(
      /import\s*\{\s*buildExplainBackObservationContext,\s*hasExplainBackSourceRevisionChanged,\s*\}\s*from\s*'\.\/explain-back\/observation\.js';/,
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

  it('buildReviewSessionInput (shared by composeReviewSession and extendReviewSession) threads it into the session input', () => {
    // F2.19 (`ol-vr8z`): `assessments` rides immediately after `relations` in
    // the same `OpenReviewSessionInput` object — both signal inputs, one
    // build site (`ol-v7r5.35`'s `buildReviewSessionInput`, shared by the
    // ordinary open and the C5.8 extend path rather than duplicated).
    // `[SESS-8.4]` (`ol-egov.132.4`): `studySessionHolder`/
    // `composeDefaultStudySession` now follow `assessments` in the same
    // object, before the closing brace — see that method's own doc.
    expect(main).toMatch(
      /relations:\s*this\.servedRelationEdges\(\),[\s\S]{0,200}?assessments,[\s\S]{0,300}?\};/,
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
      /instruments:\s*createVaultInstrumentSource\(\{\s*vault,\s*scheduler,\s*deviceId,\s*now:\s*\(\)\s*=>\s*new Date\(\),[\s\S]*?studySessionHolder:\s*this\.studySessionHolder,\s*composeDefaultStudySession:\s*\(\)\s*=>\s*this\.composeDefaultStudySession\(\),\s*\}\),/,
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
      /const recognitions = await readCourseSetupRecognitions\(\s*next\.code,\s*\{\s*vault,\s*deviceId,\s*today:\s*localToday\(new Date\(\)\),\s*\}\s*\);/,
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
      /this\.register\(\s*buildIngestionArrivalWatch\(\{\s*vault,\s*enqueuer:\s*this\.ingestion\.engine,\s*watch:\s*\(handler\)\s*=>\s*vault\.watch\(handler\),\s*\}\),\s*\);/,
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
    expect(main).toMatch(
      /this\.ingestion\s*=\s*await buildIngestionRunner\(\{[\s\S]*?vision:\s*\{\s*dataHost:\s*this,\s*createTransport:\s*createRecordingTransport,\s*\},\s*\}\);/,
    );
  });

  it('the vision field is inside the same buildIngestionRunner call, not a second unrelated object literal', () => {
    const match = main.match(/this\.ingestion\s*=\s*await buildIngestionRunner\(\{[\s\S]*?\}\);/);
    expect(match).not.toBeNull();
    expect(match?.[0]).toContain('vision:');
    expect(match?.[0]).toContain('revision:');
  });
});

describe("retrieve()'s two production callers supply registryOverrides, so alias expansion is actually exercised (ol-r5j4)", () => {
  // `ol-l5og.11`'s own diagnosis: `retrieve()` expands keyword queries with
  // rename aliases when `RetrieveDeps.registryOverrides` is supplied, but
  // neither `draftQuizCardsDeps` nor `composeExplainWhySourceChunks` ever
  // assembled one — the async overrides-store load did not fit either
  // call site's synchronous deps assembly. These are the source-level
  // checks that a cached snapshot now closes both gaps.

  it('loads a cached RegistryOverrides snapshot once in onload, defaulting honestly on a read failure', () => {
    expect(main).toMatch(
      /this\.registryOverridesCache\s*=\s*await new ObsidianRegistryOverridesStore\(this\)\s*\.load\(\)\s*\.catch\(/,
    );
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
        `createLocalGapProvider\\(\\{\\s*vault,\\s*deviceId,\\s*settingsHost:\\s*this,\\s*now:\\s*\\(\\) => new Date\\(\\),\\s*${spread},[\\s\\S]{0,400}?buildSession:`,
      ),
    );
  });

  it('main.ts:1019 — the session builder view’s createLocalSessionBuilderProvider receives it', () => {
    expect(main).toMatch(
      new RegExp(
        `createLocalSessionBuilderProvider\\(\\{\\s*vault,\\s*deviceId,\\s*settingsHost:\\s*this,\\s*now:\\s*\\(\\) => new Date\\(\\),\\s*${spread},[\\s\\S]{0,400}?openExplainBack:`,
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
    expect(main).toMatch(
      new RegExp(
        `createLocalHomeProvider\\(\\{\\s*vault,\\s*deviceId,\\s*settingsHost:\\s*this,\\s*now:\\s*\\(\\) => new Date\\(\\),\\s*scheduler,\\s*relations:\\s*\\(\\) => this\\.servedRelationEdges\\(\\),[\\s\\S]{0,300}?plan:\\s*\\(\\) => this\\.review\\?\\.plan \\?\\? null,[\\s\\S]{0,300}?${spread},\\s*windowDeficit: \\(deficitInput\\) => this\\.windowDeficitFromReviewLog\\(deficitInput\\),[\\s\\S]{0,200}?firstRead:`,
      ),
    );
  });

  it('main.ts:1225 — the registry view’s createLocalRegistryProvider receives it', () => {
    expect(main).toMatch(
      new RegExp(
        `createLocalRegistryProvider\\(\\{\\s*vault,\\s*deviceId,\\s*settingsHost:\\s*this,\\s*now:\\s*\\(\\) => new Date\\(\\),\\s*${spread},[\\s\\S]{0,400}?editPort:`,
      ),
    );
  });

  it('main.ts:2415 — composeDefaultStudySession’s composeStudySessionForRequest call receives it', () => {
    expect(main).toMatch(
      new RegExp(
        `private async composeDefaultStudySession\\(\\): Promise<ComposedStudySession \\| null> \\{[\\s\\S]{0,600}?windowDeficit: \\(deficitInput\\) => this\\.windowDeficitFromReviewLog\\(deficitInput\\),\\s*${spread},\\s*\\},\\s*\\{ budgetMinutes: DEFAULT_SESSION_BUDGET_MINUTES \\},\\s*now,\\s*\\);\\s*return result\\?\\.composed\\.full`,
      ),
    );
  });

  it('main.ts:2474 — extendDefaultStudySession’s composeStudySessionForRequest call receives it', () => {
    expect(main).toMatch(
      new RegExp(
        `private async extendDefaultStudySession\\([\\s\\S]{0,600}?windowDeficit: \\(deficitInput\\) => this\\.windowDeficitFromReviewLog\\(deficitInput\\),\\s*${spread},\\s*\\},\\s*\\{ budgetMinutes: DEFAULT_SESSION_BUDGET_MINUTES \\},\\s*now,\\s*\\);\\s*if \\(result === null\\) return null;`,
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
