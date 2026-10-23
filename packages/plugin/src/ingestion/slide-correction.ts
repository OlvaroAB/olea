/**
 * The slide-correction route (`ol-zjke`, `[D-625]`; functional scope C5.3 "A correction of an answer
 * basis", `[D-467]`, `[D-492]`; where the hold is stored: `[D-473]`).
 *
 * WHAT IT DOES. When a supplied lecture transcript's parts land, core's `slideCorrectionCues` runs on
 * each part. A transcript with no cue sentence costs nothing more: no vault walk, no Worker call. For
 * a cue sentence, the lecture bundles her explicit links form (`lecture-links.ts`) name the decks the
 * transcript may correct; with none, the correction stays unresolved and nothing is asked. The
 * candidates are the active instruments (not suspended, not proven invalid) whose citation names one
 * of those decks, each sent as the slide passage it cites and its own prompt-and-answer text, at most
 * {@link SLIDE_CORRECTION_MAX_CANDIDATES} per call to `slide-correction.judge.v1`. The judgement's two
 * booleans go through core's `reconcileSlideAndSpeech`, and only `correction-may-support-grounding`
 * acts: every candidate the judgement placed on the corrected claim (`yes`) and every one it could
 * not place (`unclear`) is withheld. A `no` leaves its instrument untouched, and an unresolved
 * judgement (not attributable, or not clear) holds nothing and reconciles nothing either way.
 *
 * THE HOLD is a pending-revalidation fact on the instrument's citation anchor with the reason
 * `lecturer-correction` (`materiality/citation-hash-store.ts`). The session builder and the
 * presentation-time check withhold an instrument whose anchor carries a current fact, whatever its
 * reason; the citation pass leaves an anchor holding a reason it does not resolve exactly as it is
 * (`materiality/citation-revision-wiring.ts`, `isReasonThisBuildResolves`), so the hold stands until
 * a reconciliation route ends it (not built here). An instrument with no anchor yet (drafted since
 * the last citation pass) is first given the anchor that pass's first sighting would give it. No new
 * persisted field. The fact is keyed to the correction (the transcript version, its part and the
 * sentence's offsets), so the same version judged again writes nothing new.
 *
 * WHERE THE SLIDE PASSAGE COMES FROM. A deck citation names the deck and its page; nothing persists
 * the cited page's text with the instrument, and its anchor holds its home note's material, not the
 * slide. The caller hands in a reader: in production {@link slidePassageReader} over the keyword
 * index's extracted blocks, which carry each unit's page. A candidate with no text there (a scanned
 * page, a deck this device has not extracted) is counted and not sent.
 *
 * OVER-WITHHOLDING IS THE ACCEPTED COST (`[D-625]`), and an ambiguous remark is never a correction.
 * A Worker that is not configured, or a device that is offline, greys the route out: nothing held,
 * nothing thrown. The report is counts only; nothing here logs text, a path or an id (D-005), and
 * the request carries no path, id or name.
 *
 * Not covered, each a follow-up: a pending draft not yet presented, a new draft resting on the
 * corrected claim after the transcript arrives, and reconciling the grounding so the hold can end.
 */

import { CONTRACT_VERSION, TASK_IDS } from 'olea-contracts';
import {
  type ExtractedUnit,
  enumerateVaultInstruments,
  hashText,
  type LectureBundle,
  type ModelStamp,
  type PersistedKeywordIndex,
  type PersistedStageProducer,
  projectInstrumentValidity,
  readModelStamp,
  readReviewLogHistory,
  reconcileSlideAndSpeech,
  slideCorrectionCues,
  suspendedInstrumentIds,
  type VaultInstrumentRecord,
  type VaultPath,
  type VaultSource,
  type WorkerTaskTransport,
} from 'olea-core';
import { lectureKindOf } from './lecture-links.js';
import type {
  CitationAnchorRecord,
  CitationHashStore,
  PendingReason,
} from './materiality/citation-hash-store.js';
import { stripQuestionBlocks } from './materiality/citation-material.js';
import { citedPassagePath } from './materiality/citation-revision-wiring.js';
import { codeRule, errorName } from './materiality/verdict-provenance.js';

/** The pending reason this route writes (`[D-473]`, `[D-625]`). */
export const LECTURER_CORRECTION_REASON: PendingReason = 'lecturer-correction';

/** `TASK_IDS.SLIDE_CORRECTION_JUDGE`. */
export const SLIDE_CORRECTION_JUDGE_TASK_ID = TASK_IDS.SLIDE_CORRECTION_JUDGE;

/** The request's candidate cap, fixed by the task's wire shape (`olea-contracts`' `tasks.ts`). */
export const SLIDE_CORRECTION_MAX_CANDIDATES = 24;

/** Where a candidate stands against the corrected claim, as the judgement placed it. */
export type RestsOnCorrectedClaim = 'yes' | 'no' | 'unclear';

/** One candidate as the request carries it: the slide passage it cites and its own text. */
export interface SlideCorrectionCandidate {
  readonly slidePassage: string;
  readonly item: string;
}

/** The fixed request of `slide-correction.judge.v1`. Transient; never stored or logged. */
export interface SlideCorrectionJudgeRequest {
  readonly correction: {
    /** The transcript part holding the cue-flagged sentence. */
    readonly passage: string;
    /** The sentence's half-open UTF-16 offsets into `passage`. */
    readonly sentence: { readonly start: number; readonly end: number };
  };
  readonly candidates: readonly SlideCorrectionCandidate[];
}

/** A judgement, one placement per request candidate in request order. */
export interface SlideCorrectionJudgement {
  readonly attributableToLecturer: boolean;
  readonly clear: boolean;
  readonly placements: readonly RestsOnCorrectedClaim[];
  /** The D7.3 stamp the response carried, or `null` when it carried none. Never invented. */
  readonly stamp: ModelStamp | null;
}

/** The judgement port. Throws when a configured Worker fails or answers unusably. */
export interface SlideCorrectionJudgePort {
  judge(request: SlideCorrectionJudgeRequest): Promise<SlideCorrectionJudgement>;
}

/** Anything that went wrong reaching the Worker or reading its reply. Carries no text field. */
export class WorkerSlideCorrectionJudgeError extends Error {
  readonly code: string | undefined;

  constructor(message: string, code?: string) {
    super(message);
    this.name = 'WorkerSlideCorrectionJudgeError';
    this.code = code;
  }
}

/**
 * The production port: the request through the injected Worker transport, the reply read
 * defensively. Shaped like `materiality/workerJudge.ts`'s `WorkerMaterialityJudge`: no retry, no
 * fallback, no state, no logging, and no network call of its own.
 */
export class WorkerSlideCorrectionJudge implements SlideCorrectionJudgePort {
  private readonly transport: WorkerTaskTransport;

  constructor(deps: { readonly transport: WorkerTaskTransport }) {
    this.transport = deps.transport;
  }

  async judge(request: SlideCorrectionJudgeRequest): Promise<SlideCorrectionJudgement> {
    const body = await this.transport.send({
      contractVersion: CONTRACT_VERSION,
      taskId: SLIDE_CORRECTION_JUDGE_TASK_ID,
      payload: {
        correction: {
          passage: request.correction.passage,
          sentence: {
            start: request.correction.sentence.start,
            end: request.correction.sentence.end,
          },
        },
        candidates: request.candidates.map((c) => ({ slidePassage: c.slidePassage, item: c.item })),
      },
    });
    return readSlideCorrectionJudgement(body, request.candidates.length);
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function placementOf(value: unknown): RestsOnCorrectedClaim {
  return value === 'yes' || value === 'no' ? value : 'unclear';
}

/**
 * The Worker's reply to `count` candidates. The two booleans are required (a reply without them
 * throws). A candidate the reply does not place, places twice or places with a value outside the
 * closed set reads `unclear`; an index outside the request is dropped.
 */
export function readSlideCorrectionJudgement(
  body: unknown,
  count: number,
): SlideCorrectionJudgement {
  if (!isRecord(body)) {
    throw new WorkerSlideCorrectionJudgeError('the Worker response was not an object');
  }
  if (body.ok === false) {
    const code = typeof body.code === 'string' ? body.code : undefined;
    throw new WorkerSlideCorrectionJudgeError(
      `the Worker refused the request (${code ?? 'no code'})`,
      code,
    );
  }
  if (body.ok !== true) {
    throw new WorkerSlideCorrectionJudgeError('the Worker response carried no `ok` discriminant');
  }
  const result = body.result;
  if (!isRecord(result)) {
    throw new WorkerSlideCorrectionJudgeError('the Worker response carried no `result` object');
  }
  if (typeof result.attributableToLecturer !== 'boolean' || typeof result.clear !== 'boolean') {
    throw new WorkerSlideCorrectionJudgeError('the Worker response carried no verdict booleans');
  }
  const seen = new Map<number, RestsOnCorrectedClaim>();
  const twice = new Set<number>();
  for (const entry of Array.isArray(result.candidates) ? result.candidates : []) {
    if (!isRecord(entry)) continue;
    const index = entry.index;
    if (typeof index !== 'number' || !Number.isInteger(index) || index < 0 || index >= count) {
      continue;
    }
    if (seen.has(index)) twice.add(index);
    else seen.set(index, placementOf(entry.restsOnCorrectedClaim));
  }
  const placements = Array.from({ length: count }, (_, index) =>
    twice.has(index) ? 'unclear' : (seen.get(index) ?? 'unclear'),
  );
  return {
    attributableToLecturer: result.attributableToLecturer,
    clear: result.clear,
    placements,
    stamp: readModelStamp(body.stamp),
  };
}

/** One supplied transcript whose parts have just landed. */
export interface LandedTranscript {
  readonly path: VaultPath;
  /** The bytes hash of the version its parts were read from, when the landing named one. */
  readonly version?: string;
  /** Its parts, by ordinal, with their text as read. */
  readonly parts: readonly { readonly ordinal: number; readonly text: string }[];
}

/**
 * The transcripts among landed units: units carrying the transcript-part marker (core's
 * `transcriptUnitsForQueue`), grouped by file, with the version the landing named for that file.
 */
export function landedTranscripts(
  units: readonly ExtractedUnit[],
  sourceRevisions?: ReadonlyMap<string, string>,
): readonly LandedTranscript[] {
  const byPath = new Map<VaultPath, { ordinal: number; text: string }[]>();
  for (const unit of units) {
    const location = unit.provenance.location;
    if (location.transcriptPart === undefined) continue;
    const parts = byPath.get(unit.provenance.sourcePath) ?? [];
    parts.push({ ordinal: location.page, text: unit.text });
    byPath.set(unit.provenance.sourcePath, parts);
  }
  return [...byPath].map(([path, parts]) => {
    const version = sourceRevisions?.get(path);
    return {
      path,
      ...(version !== undefined ? { version } : {}),
      parts: [...parts].sort((a, b) => a.ordinal - b.ordinal),
    };
  });
}

/** The decks of every lecture bundle holding `transcriptPath`. Her explicit links only. */
export function linkedDecks(
  bundles: readonly LectureBundle[],
  transcriptPath: VaultPath,
): ReadonlySet<VaultPath> {
  const decks = new Set<VaultPath>();
  for (const bundle of bundles) {
    if (!bundle.members.includes(transcriptPath)) continue;
    for (const member of bundle.members) {
      if (lectureKindOf(member, undefined) === 'deck') decks.add(member);
    }
  }
  return decks;
}

/** The cited slide passage's text for a deck and page, or `undefined` when none is available. */
export type SlidePassageReader = (deckPath: VaultPath, page: number) => string | undefined;

/**
 * The cited slide passage from the keyword index's extracted blocks (`ol-egov.141.89.1.95`: every
 * PDF and deck, text layer only, each block carrying its unit's page). The page's blocks joined, in
 * index order. A deck not in the index, or a page with no text-layer block (a scanned slide), has
 * none. The index holds the file's current version.
 */
export function slidePassageReader(
  index: PersistedKeywordIndex | null | undefined,
): SlidePassageReader {
  const byPath = new Map((index?.documents ?? []).map((doc) => [doc.path, doc] as const));
  return (deckPath, page) => {
    const doc = byPath.get(deckPath);
    if (doc === undefined) return undefined;
    const text = doc.blocks
      .filter((block) => block.location?.page === page)
      .map((block) => block.text)
      .join('\n\n')
      .trim();
    return text.length > 0 ? text : undefined;
  };
}

/** An instrument's own prompt-and-answer text, as the request carries it. */
export function instrumentItemText(record: VaultInstrumentRecord): string {
  if (record.instrumentType === 'qa') {
    return `Question: ${record.card.front}\nAnswer: ${record.card.back}`;
  }
  if (record.instrumentType === 'cloze') {
    const { before, clozeText, after } = record.card;
    return `Question: ${before}[...]${after}\nAnswer: ${clozeText}`;
  }
  return `Question: ${record.mcq.stem}\nAnswer: ${record.mcq.answer}`;
}

export interface SlideCorrectionRouteDeps {
  readonly vault: VaultSource;
  /** The same store the citation pass, the session builder and the presentation check read. */
  readonly store: CitationHashStore;
  /** `null` when the Worker is not configured: the route greys out. */
  readonly judge: SlideCorrectionJudgePort | null;
  readonly clock: { now(): number };
  /** Lecture bundles right now, rebuilt from her links. */
  readonly bundles: () => readonly LectureBundle[];
  readonly slidePassage: SlidePassageReader;
  /** Read once per run; `false` greys the route out like an unconfigured Worker. Default online. */
  readonly isOnline?: () => boolean;
  /**
   * Runs the hold writes so no citation pass reads the store while they land (a pass that took its
   * snapshot first could otherwise write a fact of its own over the hold). Default: runs them as is.
   */
  readonly exclusive?: (writes: () => Promise<void>) => Promise<void>;
}

/** What one run did, as counts only (D-005). */
export interface SlideCorrectionReport {
  /** Sentences the cue flagged across the landed parts. */
  cues: number;
  /** Judge calls made: one per cue sentence per batch of at most 24 candidates. */
  calls: number;
  /** Cue sentences at least one judgement found attributable to the lecturer and clear. */
  judgedCorrection: number;
  /**
   * Cue sentences left unresolved, nothing held for them: no linked deck, no candidate to judge,
   * or every answered judgement not attributable or not clear.
   */
  unresolved: number;
  /** Of `unresolved`: cue sentences whose transcript no note links to a deck (no call made). */
  noLinkedDeck: number;
  /** Instruments withheld because a judgement placed them on the corrected claim. */
  heldYes: number;
  /** Instruments withheld because a judgement could not place them (counted apart). */
  heldUnclear: number;
  /** Candidates on a linked deck whose cited slide has no text available: not sent, not held. */
  candidatesWithoutPassage: number;
  /** Judge calls that failed or answered unusably: nothing held from them. */
  callsFailed: number;
  /** Cue sentences not judged because the Worker is not configured or the device is offline. */
  judgeUnavailable: number;
  /** Anchors written first, because an instrument to hold had none yet (first-sighting baseline). */
  anchorsCreated: number;
  /** Holds that did not land (a failed write, or the store not showing the reason afterwards). */
  holdWritesFailed: number;
  /** The vault walk or her review log could not be read: nothing judged or held. */
  readFailed: number;
}

function blankReport(): SlideCorrectionReport {
  return {
    cues: 0,
    calls: 0,
    judgedCorrection: 0,
    unresolved: 0,
    noLinkedDeck: 0,
    heldYes: 0,
    heldUnclear: 0,
    candidatesWithoutPassage: 0,
    callsFailed: 0,
    judgeUnavailable: 0,
    anchorsCreated: 0,
    holdWritesFailed: 0,
    readFailed: 0,
  };
}

/** True when the run reached every answer it could: nothing greyed out, failed or unwritten. */
export function slideCorrectionFinished(report: SlideCorrectionReport): boolean {
  return (
    report.judgeUnavailable === 0 &&
    report.callsFailed === 0 &&
    report.holdWritesFailed === 0 &&
    report.readFailed === 0
  );
}

interface Candidate {
  readonly record: VaultInstrumentRecord;
  readonly slidePassage: string;
  readonly item: string;
}

interface Hold {
  readonly record: VaultInstrumentRecord;
  readonly placement: 'yes' | 'unclear';
  /** The correction this hold is keyed to (`PendingRevalidation.sinceContentHash`). */
  readonly key: string;
  readonly raisedBy: PersistedStageProducer;
}

/** The active instruments citing one of `decks`, each with its cited slide's text. */
async function candidatesOn(
  deps: SlideCorrectionRouteDeps,
  decks: ReadonlySet<VaultPath>,
  report: SlideCorrectionReport,
): Promise<readonly Candidate[] | undefined> {
  let inactive: Set<string>;
  let records: readonly VaultInstrumentRecord[];
  try {
    // The same fold the citation pass and the presentation path read: a suspended or proven-invalid
    // instrument is not a candidate. An unreadable log is never taken for "none suspended".
    const { entries } = await readReviewLogHistory(deps.vault);
    inactive = new Set(suspendedInstrumentIds(entries));
    for (const instrumentId of projectInstrumentValidity(entries).provenInvalid.keys()) {
      inactive.add(instrumentId);
    }
    records = (
      await enumerateVaultInstruments(deps.vault, { concepts: { stampConceptKeys: true } })
    ).records;
  } catch (error) {
    report.readFailed += 1;
    console.error('Olea: slide-correction could not read the vault', errorName(error));
    return undefined;
  }
  const candidates: Candidate[] = [];
  for (const record of records) {
    const cited = record.sourceProvenance;
    if (cited === undefined || !decks.has(cited.sourcePath)) continue;
    if (inactive.has(record.instrumentId)) continue;
    const slidePassage = deps.slidePassage(cited.sourcePath, cited.location.page)?.trim();
    if (slidePassage === undefined || slidePassage.length === 0) {
      report.candidatesWithoutPassage += 1;
      continue;
    }
    candidates.push({ record, slidePassage, item: instrumentItemText(record) });
  }
  return candidates;
}

function batches<T>(items: readonly T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

/** Writes each hold, then reads the store back: a hold counts only once the store shows it. */
async function writeHolds(
  deps: SlideCorrectionRouteDeps,
  holds: ReadonlyMap<string, Hold>,
  report: SlideCorrectionReport,
): Promise<void> {
  let anchors: ReadonlyMap<string, CitationAnchorRecord>;
  try {
    anchors = await deps.store.loadAll();
  } catch (error) {
    report.holdWritesFailed += holds.size;
    console.error('Olea: slide-correction could not read the citation store', errorName(error));
    return;
  }
  for (const [instrumentId, hold] of holds) {
    try {
      if (!anchors.has(instrumentId)) {
        // Drafted since the last citation pass: the anchor that pass's first sighting would write
        // (whole-note grain; a deck citation carries no passage digest), so the fact has a record.
        const path = citedPassagePath(hold.record);
        await deps.store.save(instrumentId, {
          sourcePath: path,
          text: stripQuestionBlocks(await deps.vault.read(path)),
          conceptIds: hold.record.conceptIds,
          settledBy: codeRule('first-sighting'),
        });
        report.anchorsCreated += 1;
      }
      await deps.store.setPendingRevalidation(
        instrumentId,
        hold.key,
        deps.clock.now(),
        LECTURER_CORRECTION_REASON,
        hold.raisedBy,
      );
    } catch (error) {
      console.error('Olea: slide-correction hold write failed', errorName(error));
    }
  }
  let after: ReadonlyMap<string, CitationAnchorRecord>;
  try {
    after = await deps.store.loadAll();
  } catch (error) {
    report.holdWritesFailed += holds.size;
    console.error('Olea: slide-correction could not read the holds back', errorName(error));
    return;
  }
  for (const [instrumentId, hold] of holds) {
    if (after.get(instrumentId)?.pendingRevalidation?.reason !== LECTURER_CORRECTION_REASON) {
      report.holdWritesFailed += 1;
    } else if (hold.placement === 'yes') {
      report.heldYes += 1;
    } else {
      report.heldUnclear += 1;
    }
  }
}

/**
 * Runs the route for one landed transcript. Never throws: every failure is counted in the report,
 * and a run that could not finish holds only what it wrote (see {@link slideCorrectionFinished}).
 */
export async function applySlideCorrections(
  deps: SlideCorrectionRouteDeps,
  transcript: LandedTranscript,
): Promise<SlideCorrectionReport> {
  const report = blankReport();
  const sites = transcript.parts.flatMap((part) =>
    slideCorrectionCues(part.text).map((sentence) => ({ part, sentence })),
  );
  report.cues = sites.length;
  if (sites.length === 0) return report;

  let decks: ReadonlySet<VaultPath>;
  try {
    decks = linkedDecks(deps.bundles(), transcript.path);
  } catch (error) {
    report.readFailed += 1;
    console.error('Olea: slide-correction could not read lecture links', errorName(error));
    return report;
  }
  if (decks.size === 0) {
    report.noLinkedDeck = sites.length;
    report.unresolved = sites.length;
    return report;
  }

  const judge = deps.judge;
  if (judge === null || !(deps.isOnline?.() ?? true)) {
    report.judgeUnavailable = sites.length;
    return report;
  }

  const candidates = await candidatesOn(deps, decks, report);
  if (candidates === undefined) return report;
  if (candidates.length === 0) {
    report.unresolved = sites.length;
    log(report);
    return report;
  }

  const holds = new Map<string, Hold>();
  for (const { part, sentence } of sites) {
    const key = await hashText(
      [
        LECTURER_CORRECTION_REASON,
        transcript.version ?? (await hashText(part.text)),
        String(part.ordinal),
        `${sentence.start}:${sentence.end}`,
      ].join('\n'),
    );
    let answered = false;
    let correction = false;
    for (const batch of batches(candidates, SLIDE_CORRECTION_MAX_CANDIDATES)) {
      report.calls += 1;
      let judgement: SlideCorrectionJudgement;
      try {
        judgement = await judge.judge({
          correction: {
            passage: part.text,
            sentence: { start: sentence.start, end: sentence.end },
          },
          candidates: batch.map(({ slidePassage, item }) => ({ slidePassage, item })),
        });
      } catch (error) {
        report.callsFailed += 1;
        console.error('Olea: slide-correction judgement failed', errorName(error));
        continue;
      }
      answered = true;
      if (reconcileSlideAndSpeech(judgement) !== 'correction-may-support-grounding') continue;
      correction = true;
      const raisedBy: PersistedStageProducer = {
        kind: 'model',
        seat: 'candidate',
        taskId: SLIDE_CORRECTION_JUDGE_TASK_ID,
        stamp: judgement.stamp,
      };
      batch.forEach((candidate, index) => {
        const placement = judgement.placements[index] ?? 'unclear';
        if (placement === 'no') return;
        const id = candidate.record.instrumentId;
        // Placed on the corrected claim by any judgement wins over "could not place".
        if (holds.get(id)?.placement === 'yes') return;
        holds.set(id, { record: candidate.record, placement, key, raisedBy });
      });
    }
    if (correction) report.judgedCorrection += 1;
    else if (answered) report.unresolved += 1;
  }

  if (holds.size > 0) {
    const exclusive = deps.exclusive ?? ((writes: () => Promise<void>) => writes());
    try {
      await exclusive(() => writeHolds(deps, holds, report));
    } catch (error) {
      report.holdWritesFailed += holds.size;
      console.error('Olea: slide-correction hold writes failed', errorName(error));
    }
  }
  log(report);
  return report;
}

/** One line of counts per run that reached the vault walk (D-005: never text, a path or an id). */
function log(report: SlideCorrectionReport): void {
  console.info(
    `Olea: slide-correction route: ${report.cues} cue(s), ${report.calls} call(s), ` +
      `${report.judgedCorrection} judged a correction, ${report.unresolved} unresolved, ` +
      `${report.heldYes} held on the corrected claim, ${report.heldUnclear} held unplaced, ` +
      `${report.candidatesWithoutPassage} without a slide passage, ${report.callsFailed} failed call(s)`,
  );
}
