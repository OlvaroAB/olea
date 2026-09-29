/**
 * The demand-grain re-ask on arrival (`ol-egov.141.89.5.26`, `[D-414]`, `ol-egov.141.89.48`): when
 * material arrives for a concept whose last sufficiency verdict, at the demand its assessment asks
 * for, is not sufficient, the sufficiency question is asked again. The logic that decides which
 * records an arrival touches, and what an answer does to a record, is `olea-core`'s
 * `gap/demand-gap.ts` (pure, reached by its path rather than the barrel while the barrel is held by
 * other lanes); this file is the two production halves around it:
 *
 *  - {@link createRetrievalSufficiencyAsk}, the ONE place the re-check can reach the service, and it
 *    reaches it through the existing, ruled call path: the evidence gate `retrieve` with the same
 *    band, composite veto and real `WorkerGroundingJudge` the card-drafting path uses
 *    (`../retrieval/draft-quiz-cards.ts`), the concept name as the query and the demand as the
 *    judge's intended operation (`[D-437]`, `demandToJudgeOperation`). It stops at the sufficiency
 *    question: **no generative call is ever made from here** (generation on arrival is not built,
 *    `ol-egov.141.89.9.70` item 3 waits on it), and no review-log entry, instrument or reading of
 *    her is written or read.
 *  - {@link createDemandGapReask}, the runner: it takes the processed-revision feed's arrival signal
 *    (`../ingestion/processed-revisions/feed.ts`'s `subscribe`), runs one serial pass at a time with
 *    arrivals that land together sharing a pass, and keeps a re-check that could not run beside its
 *    row with its own reason, in memory only (the ruling names one stored field; a not-run reason is
 *    not it, and after a restart the row simply reads as it was and is asked again on the next
 *    arrival).
 *
 * ## The gate's outcomes stay apart (client c4cb3e4, `[D-441]`, `[D-442]`)
 *
 * Only `judge-rejected` is an insufficiency. Below the composite or band bars is threshold-blocked
 * and not assessed; no hits or below the relevance floor is a retrieval failure; an unreachable judge
 * or an unusable answer is an outage. Each keeps its own reason and none can flip a row to
 * sufficient or write anything (`demand-gap.ts`'s fold). A demand the judge request cannot carry
 * (`interpret-printed-result` has no operation) is not asked at all (`demand-not-askable`): asking
 * it as a general question would let evidence for no particular demand stand in for it.
 *
 * ## When nothing new arrived, the judge is not paid
 *
 * Retrieval is local and cheap; the judge is the paid call. The ask fingerprints exactly what would
 * be sent to the judge and, when that equals the fingerprint the stored verdict was asked over,
 * declines to send it and answers `evidence-unchanged`. An arrival that adds nothing relevant to a
 * concept costs a retrieval and no model call.
 *
 * ## What is not wired here, and where it is recorded
 *
 * The three things that make this reach a student are outside this file's ownership and are recorded
 * on `ol-egov.141.89.5.26`: the composition in `main.ts` (`processedRevisionFeed.subscribe(...)`),
 * the record store with its privacy registration, and the first writer of a record. Until they land
 * no record exists, so no arrival asks anything: today the runner is complete, tested and idle.
 *
 * **INV-1.** No `obsidian` import. **D-005.** Nothing is logged but fixed sentences and an error
 * class: never a path, a course, a concept name or a passage.
 */

import {
  D112_GROUNDING_BAND,
  demandToJudgeOperation,
  type GroundingJudgePort,
  type GroundingJudgeRequest,
  type GroundingJudgeVerdict,
  hashText,
  type JudgeRequestRecord,
  type PaperDemand,
  RECOMMENDED_COMPOSITE_THRESHOLDS,
  type RetrieveDeps,
  retrieve,
  type WorkerTaskTransport,
} from 'olea-core';
import {
  fingerprintJudgedEvidence,
  type ReaskOnArrivalDeps,
  type ReaskReport,
  type RecheckNotRun,
  reaskOnArrival,
  sufficiencyAnswerFromGrounding,
} from 'olea-core/src/gap/demand-gap.js';
import type { ProcessedArrival } from '../ingestion/processed-revisions/feed.js';
import { WorkerGroundingJudge } from '../retrieval/workerGroundingJudge.js';

// ---------------------------------------------------------------------------
// The ask
// ---------------------------------------------------------------------------

export interface RetrievalSufficiencyAskDeps {
  /** Everything `retrieve()` needs: the same assembly the card-drafting path is given. */
  readonly retrieve: RetrieveDeps;
  /** The transport the real `WorkerGroundingJudge` sends `grounding.judge.v1` through: the SAME instance the drafting path uses, or any fake. */
  readonly transport: WorkerTaskTransport;
  /** The digest behind the evidence fingerprint. Defaults to the platform hash every other digest here uses. */
  readonly hash?: (text: string) => Promise<string>;
}

/** Sentinel thrown inside the judge port to decline a paid call when nothing new would be judged. Never leaves this module. */
class EvidenceUnchanged extends Error {}

/**
 * The `ask` the re-ask on arrival is given: one sufficiency question for one concept at one demand,
 * over the evidence gate. See the module doc. Never rejects: any failure is an outage answer.
 */
export function createRetrievalSufficiencyAsk(
  deps: RetrievalSufficiencyAskDeps,
): ReaskOnArrivalDeps['ask'] {
  const hash = deps.hash ?? hashText;
  return async (request) => {
    const operation = demandToJudgeOperation(request.demand);
    if (operation === undefined) return { kind: 'not-run', reason: 'demand-not-askable' };

    let refs: JudgeRequestRecord['refs'] | undefined;
    let judgedFingerprint: string | undefined;
    let unchanged = false;
    const wire = new WorkerGroundingJudge({ transport: deps.transport });
    const judge: GroundingJudgePort = {
      async judge(judgeRequest: GroundingJudgeRequest): Promise<GroundingJudgeVerdict> {
        if (refs === undefined) throw new Error('no judged references were recorded');
        judgedFingerprint = await fingerprintJudgedEvidence(
          { refs, context: judgeRequest.context },
          hash,
        );
        if (judgedFingerprint === request.previousFingerprint) {
          // The evidence about to be judged is the evidence the stored verdict was asked over:
          // decline the paid call. The gate sees a judge that could not answer, and this ask reads
          // the flag, never that refusal.
          unchanged = true;
          throw new EvidenceUnchanged('evidence unchanged');
        }
        return wire.judge(judgeRequest);
      },
    };

    try {
      const grounding = await retrieve(deps.retrieve, request.concept.conceptName, {
        band: D112_GROUNDING_BAND,
        requireComposite: true,
        compositeThresholds: RECOMMENDED_COMPOSITE_THRESHOLDS,
        judge,
        onJudgeRequest: (record) => {
          refs = record.refs;
        },
        intendedOperation: operation,
      });
      if (unchanged) return { kind: 'evidence-unchanged' };
      return sufficiencyAnswerFromGrounding(grounding, judgedFingerprint);
    } catch {
      return { kind: 'not-run', reason: 'check-unavailable' };
    }
  };
}

// ---------------------------------------------------------------------------
// The runner
// ---------------------------------------------------------------------------

export interface DemandGapReask {
  /** The feed's arrival listener. Not awaited by the feed; never throws. Only a readable revision is material. */
  readonly onArrival: (arrival: ProcessedArrival) => void;
  /** Resolves when every pass asked for so far has finished. For tests and shutdown. */
  idle(): Promise<void>;
  /**
   * The last re-check for this concept at this demand that could not run, with its own reason, or
   * `undefined` when the last one ran (or none was attempted this session). Session memory only.
   */
  notRunFor(conceptKey: string, demand: PaperDemand): RecheckNotRun | undefined;
}

function failureClass(error: unknown): string {
  return error instanceof Error ? error.name : 'non-error';
}

const keyOf = (conceptKey: string, demand: string): string => `${conceptKey}\u0000${demand}`;

export function createDemandGapReask(deps: ReaskOnArrivalDeps): DemandGapReask {
  const pendingCourses = new Set<string>();
  const notRun = new Map<string, RecheckNotRun>();
  let tail: Promise<void> = Promise.resolve();
  /** True from the moment a pass is asked for until it starts: arrivals in that window share it. */
  let queued = false;

  const remember = (reports: readonly ReaskReport[]): void => {
    for (const report of reports) {
      const key = keyOf(report.conceptKey, report.demand);
      switch (report.outcome) {
        case 'not-run':
          notRun.set(key, { reason: report.reason });
          break;
        case 'cleared':
        case 'stays':
        case 'evidence-unchanged':
          notRun.delete(key);
          break;
        case 'save-failed':
        case 'concept-unresolved':
          // Not an answer about sufficiency: whatever was known before still stands.
          break;
      }
    }
  };

  const pass = async (): Promise<void> => {
    queued = false;
    const courses = [...pendingCourses];
    pendingCourses.clear();
    remember(await reaskOnArrival(deps, { courses }));
  };

  return {
    onArrival(arrival) {
      if (arrival.state !== 'read') return;
      for (const course of arrival.courses) pendingCourses.add(course);
      if (queued) return;
      queued = true;
      tail = tail.then(pass).catch((error: unknown) => {
        console.error(`Olea: could not re-check a gap on arrival (${failureClass(error)})`);
      });
    },

    async idle() {
      let seen: Promise<void>;
      do {
        seen = tail;
        await seen;
      } while (seen !== tail);
    },

    notRunFor(conceptKey, demand) {
      return notRun.get(keyOf(conceptKey, demand));
    },
  };
}
