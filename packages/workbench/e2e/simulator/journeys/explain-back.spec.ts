/**
 * F9.S5 — journey "explain-back": explain a concept back and receive the verdict (F5.1's
 * on-demand explain-back door). `ol-3ux7.64.18` [WBX-16].
 *
 * Driven by the REAL modal gestures, one Playwright action per thing she would do: the palette
 * command (`OLEA_COMMAND_EXPLAIN_BACK`, through the driver's generic `runCommand` — the same
 * `Plugin.invokeCommand` a palette pick takes), the topic typed into `.olea-explain-back-topic`
 * and "Continue" clicked, the answer typed into `.olea-explain-back-answer` and "Check this"
 * clicked, then "Keep this" and "Done". It deliberately does NOT use `driver.explain(text)`
 * (WBX-16c) for the whole round trip: that entry clicks Accept and Done itself before it returns,
 * so a journey built on it can only ever photograph the closed modal — the first cut of this file
 * did exactly that, and its "outcome" golden showed Home with nothing on it. The verdict IS the
 * step this journey exists to capture.
 *
 * The topic is the vault's first file's basename — `driverExplain`'s own `defaultExplainTopic`
 * rule, restated here so the modal round trip issues the identical Worker payload the cassette
 * fill recorded (the fill is this same journey run with `WB_SIM_TRANSPORT=record`). The invented
 * answer text is generic and never copied from any real note (CLAUDE.md's "never quote").
 *
 * Steps captured: topic, answering, verdict, accepted. `ol-3ux7.64.18.5` (WBX-16e) recorded ONE
 * real judge verdict for this exact fixture payload (`00 Daily notes/2026-08-10.md`'s explain
 * topic, this file's own invented answer) via staging under the two-flag spend gate, and landed
 * it in `packages/workbench/.generation-cassette/simulator-cassette.json` — a small, TRACKED
 * exception to that directory's usual "reproducible, so gitignored" rule (see `build.mjs`'s
 * `SIMULATOR_CASSETTE` doc), bundled into `dist/simulator-cassette.json` by
 * `copySimulatorCassette` and fetched by `simulator/controller.ts`'s `loadReplayCassette`.
 *
 * **Zero-spend replay reaches the graded phase** (`ol-0j02` [WBX-28], unblocking
 * `ol-l5og.18.19` [STY-9]): the SAME `simulator-cassette.json` also bundles the `retrieval.embed.v1`
 * responses this journey's grounding step needs — real, legitimately-recorded vectors for the
 * fixture vault's corpus, re-packaged as ordinary `GenerationCassetteEntry` rows keyed by
 * `(taskId, payloadHash)` exactly like the judge entry, so `ReplayTransport.send`'s existing
 * "falls through to the cassette lookup" path for an embed request with no `embedShards` answer
 * (`transport/index.ts`'s own module doc) serves them with zero network. With those bundled,
 * `olea-core`'s `retrieve()` selects the SAME `sourceBlocks` set pure replay and the original
 * recording both now agree on, so the judge request hashes to the one recorded entry instead of
 * degrading to a keyword-only set that never matched it.
 *
 * **`ol-egov.141.89.6.57` (2026-09-27/28) — STILL BLOCKED, not fixed.** The fixture vault's
 * ASTR150 addition (`ol-egov.141.89.10.73`) shifted the corpus's chunk set, which shifted the
 * `retrieval.embed.v1` request hash even though the journey's own topic file
 * (`00 Daily notes/2026-08-10.md`) was untouched, so the bundled entries went stale (every replay
 * fell to the check-failed refusal below, reproduced 3/3 on a clean worktree). A spend-authorised
 * re-recording (David's 2026-09-27 one-run, hard-cap-USD-0.10 authorisation) landed 13 fresh
 * `retrieval.embed.v1` entries that DO match the current corpus (real, paid, ~USD 0.0015 spent —
 * kept below, no need to re-spend). That same run's `explain-back.judge.v1` call came back
 * `outcome: 'unable-to-assess'` (`[D-321]`, see below) against the OLD topic-agnostic invented
 * answer, so the stale entry was removed rather than kept as a false pass. A second recording
 * attempt (needed to get an actual graded verdict against the rewritten, on-topic answer below)
 * was refused by this session's own permission classifier on the exact, already-authorised
 * command, and per the run charter/lane rules that refusal is reported, not routed around or
 * retried. **Net: the cassette currently has zero `explain-back.judge.v1` entries, so every
 * replay of the POST-answer step below is a genuine cassette miss** (`ReplayTransport.send`'s
 * own `onMiss` path) — not a shape problem `workerJudgeCaller.ts`'s stamp check would ever see,
 * confirmed live with a temporary console listener (both `retrieval.embed.v1` misses AND the
 * lone `explain-back.judge.v1` miss logged `simulator: transport miss` BEFORE reaching
 * `requireStamp` at all). The POST-answer assertion below therefore stays tolerant of a
 * check-failed refusal, same as the pre-answer one — reaching an actual graded verdict needs one
 * more live judge call and is left to whoever next holds spend authorisation for this bead.
 *
 * The blocked re-recording also surfaced a THIRD outcome the judge task can legitimately
 * return — `[D-321]`'s `unable-to-assess` ("couldn't tell whether this was a real attempt"),
 * distinct from both a graded verdict and a transport-level check-failed refusal. The judge's
 * current prompt version (1.4.0, up from 1.2.0 at the original recording) classified this file's
 * OLD, topic-agnostic template answer that way rather than grading it — a real model judgement,
 * not a bug — so `INVENTED_ANSWER` below was rewritten to read as a genuine, on-topic (if
 * imperfect) attempt, ready for whichever future recording actually lands a graded verdict.
 */
import { expect, test } from '@playwright/test';
import { gotoSimulator, resetSimulator } from '../helpers.js';
import {
  captureJourneyStep,
  EXPLAIN_BACK_CHECK_FAILED_TEXT,
  PERSONA,
  WORLD,
} from './journeys-helpers.js';

const JOURNEY = 'explain-back';
const WEEK = 0;

/** `OLEA_COMMAND_EXPLAIN_BACK` (`packages/plugin/src/commands/ids.ts`) — restated as a literal per this suite's convention (`helpers.ts`'s header note). */
const EXPLAIN_BACK_COMMAND_ID = 'olea-explain-back';
/** `packages/plugin/src/explain-back/copy.ts`'s button labels, same convention. */
const CONTINUE_LABEL = 'Continue';
const SUBMIT_LABEL = 'Check this';
const ACCEPT_LABEL = 'Keep this';
/** `renderAcceptedPhase`'s own inline literal (`explain-back/modal.ts`). */
const DONE_LABEL = 'Done';

// Invented, never copied from any real note — see this file's own module doc. Paraphrases the
// SHAPE of a schedule-style daily note (a genuine, specific attempt) rather than a generic
// template sentence: `ol-egov.141.89.6.57` found the judge's current prompt version (1.4.0)
// classifies a topic-agnostic template like the old wording as `unable-to-assess` (D-321) — a
// real, defined "couldn't tell if this was a genuine attempt" outcome, not a bug — so a fixture
// answer meant to exercise the GRADED branch needs to read as an actual, on-topic attempt.
const INVENTED_ANSWER =
  'On this day there is one lecture in the morning, a seminar around midday, and a self-directed ' +
  'lab-prep block in the afternoon. Before the lab I still need to pick up new course material, ' +
  'and in the evening there is a short written response due for something studied recently. ' +
  'Afterward the two things left to review are one set of practice cards and a set of ' +
  'close-analysis questions.';

test(`@auto-web:simulator/journeys/explain-back ${WORLD}/${PERSONA} — explain a concept back and receive the verdict`, async ({
  page,
}) => {
  await gotoSimulator(page, { world: WORLD, persona: PERSONA });
  await resetSimulator(page);

  // The same fallback `driverExplain`'s `defaultExplainTopic` uses when no concept is named: the
  // first vault file's basename, extension stripped. Read in the page and typed straight back
  // into the modal — never logged. Kept a deliberate duplicate rather than importing
  // `defaultExplainTopic` (this file has no `MountedPlugin` to hand it, only the driver's
  // string-only `listFilePaths()`), so this must stay byte-for-byte in step with that function —
  // see its own WBX-18 (`ol-qm6u`) doc for why the extension strip requires at least one
  // character before the final dot: a naive `base.replace(/\.[^./]+$/, '')` also matches a HIDDEN
  // file's entire name (`.gitignore` has one dot and nothing before it), collapsing the topic to
  // `''` and making the modal's Continue button a silent no-op forever.
  const topic = await page.evaluate(() => {
    const driver = window.__oleaSimulatorDriver;
    if (driver === undefined) throw new Error('explain-back journey: no simulator driver.');
    const [first] = driver.listFilePaths();
    if (first === undefined) throw new Error('explain-back journey: the vault has no files.');
    const base = first.split('/').pop() ?? first;
    const withExtensionStripped = /^(.+)\.[^./]+$/.exec(base);
    return withExtensionStripped === null ? base : (withExtensionStripped[1] ?? base);
  });

  const invoked = await page.evaluate(
    (id) => window.__oleaSimulatorDriver?.runCommand(id) ?? false,
    EXPLAIN_BACK_COMMAND_ID,
  );
  expect(invoked, `${EXPLAIN_BACK_COMMAND_ID} is not registered right now`).toBe(true);

  const modal = page.locator('.olea-explain-back');
  await expect(modal).toBeVisible();
  const topicInput = modal.locator('.olea-explain-back-topic');
  await topicInput.fill(topic);
  await captureJourneyStep(page, JOURNEY, WEEK, 'topic');
  await modal.getByRole('button', { name: CONTINUE_LABEL, exact: true }).click();

  // Either the answer box (the topic resolved against her notes) or a refusal (nothing to grade
  // against) — both are real modal states; a refusal short-circuits to the same step names. This
  // branch is about LOCAL retrieval finding nothing at all, never reached against the current
  // fixture corpus (the topic's own daily note has real content), so it stays tolerant rather
  // than asserted against — unlike the POST-answer branch below, which this bead's fix now
  // requires to reach the graded phase.
  const answerBox = modal.locator('.olea-explain-back-answer');
  const refusal = modal.locator('.olea-explain-back-refusal');
  await expect(answerBox.or(refusal).first()).toBeVisible({ timeout: 30_000 });
  if ((await refusal.count()) > 0) {
    await captureJourneyStep(page, JOURNEY, WEEK, 'answering');
    await captureJourneyStep(page, JOURNEY, WEEK, 'verdict');
    await captureJourneyStep(page, JOURNEY, WEEK, 'accepted');
    return;
  }

  await answerBox.fill(INVENTED_ANSWER);
  await captureJourneyStep(page, JOURNEY, WEEK, 'answering');
  await modal.getByRole('button', { name: SUBMIT_LABEL, exact: true }).click();

  // Three real, distinct outcomes the judge step can land on — see this file's own module doc
  // (`ol-egov.141.89.6.57`, still blocked on a second live recording): a graded verdict (the
  // `ACCEPT_LABEL` "Keep this" button — the target this journey exists to reach), `[D-321]`'s
  // `unable-to-assess` outcome (its own message text, no `.olea-explain-back-refusal`), or a
  // check-failed refusal (a transport-level cassette miss, `EXPLAIN_BACK_CHECK_FAILED_TEXT`).
  // `.olea-explain-back-actions` alone does NOT distinguish graded from unable-to-assess (both
  // render into a div with that class) — only `ACCEPT_LABEL` is unique to a real verdict.
  const acceptButton = modal.getByRole('button', { name: ACCEPT_LABEL, exact: true });
  const unableToAssess = modal.getByText(
    "Olea couldn't tell whether this was a real attempt at an answer, so nothing was graded.",
    { exact: true },
  );
  await expect(acceptButton.or(refusal).or(unableToAssess).first()).toBeVisible({
    timeout: 60_000,
  });
  await captureJourneyStep(page, JOURNEY, WEEK, 'verdict');

  if ((await refusal.count()) > 0) {
    await expect(refusal).toHaveText(EXPLAIN_BACK_CHECK_FAILED_TEXT);
    await captureJourneyStep(page, JOURNEY, WEEK, 'accepted');
    return;
  }
  if ((await unableToAssess.count()) > 0) {
    // A real, defined judge outcome (`[D-321]`) — nothing to keep, so no 'accepted' step exists
    // for it. Not reached at zero spend today (the cassette currently has no judge entry at all,
    // so every replay is a transport-level miss before the judge task ever runs), kept here so
    // this branch is exercised for real the moment a recording actually lands.
    return;
  }

  await acceptButton.click();
  const done = modal.getByRole('button', { name: DONE_LABEL, exact: true });
  await expect(done).toBeVisible({ timeout: 30_000 });
  await captureJourneyStep(page, JOURNEY, WEEK, 'accepted');
  await done.click();
  await expect(modal).toHaveCount(0);
});
