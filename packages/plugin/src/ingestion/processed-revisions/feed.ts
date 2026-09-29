/**
 * `createProcessedRevisionFeed` — what fills the processed-revision record, and the one thing
 * `main.ts` calls to do it (`ol-egov.141.89.11.27`, `[D-426]`, row 25 of
 * `docs/direction/20260929_decision_sheet_responses.md`). The record itself is `./store.ts`, the
 * rebuild's listing is `./current-revisions.ts`; this is the composition between them and the
 * places a file version is processed. No `obsidian` import (INV-1): `main.ts` hands it the vault,
 * the source reading's reader boundary and the store.
 *
 * ## The processing moments, and what each records
 *
 *  - **A note clears the free checks** ({@link ProcessedRevisionFeed.noteEvaluated}): the result
 *    of `MaterialityTrigger.evaluate`. Recorded when the edit passed the free gates and something
 *    would follow (a verdict of either kind, or no judge to ask, an outage included): *whatever the
 *    judge says*, which is the point of `[D-426]`. Not recorded for `unchanged` (the version was
 *    seen before; it recorded then, or a rebuild will call it unknown), `formatting-only`,
 *    `debounced`, `below-floor`, `no-groundable-content`, or a `stale-response-dropped` answer (a
 *    newer evaluation of the same path already carries the current text and records itself). A
 *    created note's first sighting reaches here through the same call: the first sighting of a note
 *    resolves to `judge-unavailable`, or `no-groundable-content` when it is empty.
 *  - **A drained pending edit** ({@link ProcessedRevisionFeed.noteProcessed}): a below-floor edit
 *    that the periodic drain finally sent to the judge. A real verdict, so a real version.
 *  - **An embedded source is queued** ({@link ProcessedRevisionFeed.observeEnqueues}): a pdf,
 *    slide deck, document or image the queue admitted (`queued`, never `duplicate` or `debounced`)
 *    is recorded `pending`, keyed by the hash the job is keyed by. The day is the day it was queued.
 *  - **An embedded source's job settles** ({@link ProcessedRevisionFeed.jobRan}): the source
 *    reading's fold of that source's manifest becomes the state (`read`, or `unreadable` when a page
 *    failed, was not legible, or **the source yielded nothing**, `[D-426]`; still `pending` while
 *    pages wait for vision). A page reading (`vision-page`) settling can only advance the state of a
 *    version the record already holds; it never starts one.
 *
 * ## Start: rebuild first, and nothing counts before it
 *
 * {@link ProcessedRevisionFeed.start} rereads the vault into the record
 * (`listCurrentRevisions` then `store.rebuild`), which records every file with no row **with an
 * unknown day**. Every moment above waits for that to finish, in the order it arrived. This is what
 * keeps a vault that is opening from being read as a vault that just received everything: Obsidian
 * reports every existing file as `create` while the vault loads, so those files reach the moments
 * above as if they were new, and without this ordering each would be given the day of the start.
 * With it they meet a row that already says "unknown", and an unknown day stays unknown when the
 * same version is processed again (`applyProcessed`). A file that really changes gets a new
 * fingerprint and a day of its own.
 *
 * **A rebuild that could not read the vault does nothing, and so does the rest of the session.**
 * The listing rejects when a course file cannot be read (whole listings only), and the record is
 * left as it was. The vault-load reports would then land with nothing to meet, and would each give
 * a file that was always there the day of the start; so no moment records until a start whose
 * rebuild succeeds. The cost is a session without new arrivals, and it is retried at the next
 * start. The record reads as never rebuilt meanwhile, so Today claims nothing either way.
 *
 * ## What the day is
 *
 * A **processing day**, never an exact arrival time (`store.ts`): the store takes it from its own
 * clock when it writes, and nothing here can pass one.
 *
 * **Never throws, never blocks its caller.** Every method resolves whatever happens; work runs in
 * one serial queue so two events for one path record in the order they arrived. **D-005:** a
 * failure logs a fixed sentence and the error's class, never a path, a course or text.
 */

import {
  courseFromPath,
  DEFAULT_COURSES_FOLDER,
  type EnqueueInput,
  type EnqueueResult,
  type JobEnqueuer,
  type PersistedJob,
  type TickResult,
  type UnitManifest,
  type VaultPath,
  type VaultSource,
} from 'olea-core';
import type { MaterialityEvaluationResult } from '../materiality/wiring.js';
import {
  isHidden,
  isMarkdown,
  listCurrentRevisions,
  processedNoteRevision,
  verifiedManifestRevision,
} from './current-revisions.js';
import type { ObsidianProcessedRevisionStore, ProcessedRevisionInput } from './store.js';

export interface ProcessedRevisionFeedDeps {
  readonly store: Pick<ObsidianProcessedRevisionStore, 'load' | 'recordProcessed' | 'rebuild'>;
  readonly vault: VaultSource;
  /** The source reading's reader boundary (`grove/unit-manifest-store.ts`'s `manifestsFor`). */
  readonly manifestsFor: (
    paths: readonly VaultPath[],
  ) => Promise<ReadonlyMap<VaultPath, UnitManifest>>;
  /** Defaults to F1.3's `DEFAULT_COURSES_FOLDER`. */
  readonly coursesFolder?: VaultPath;
}

export interface ProcessedRevisionFeed {
  /** Rebuilds the record from current content and opens the gate. Idempotent; resolves when done, never rejects. */
  start(): Promise<void>;
  /** A note edit was evaluated by the materiality trigger. Records it when it cleared the free checks. */
  noteEvaluated(
    path: VaultPath,
    currentText: string,
    result: Pick<MaterialityEvaluationResult, 'kind'>,
  ): Promise<void>;
  /** A note version is known to have been processed (a drained pending edit). */
  noteProcessed(path: VaultPath, currentText: string): Promise<void>;
  /** The same enqueuer, recording each embedded source the queue admits as pending. */
  observeEnqueues(inner: JobEnqueuer): JobEnqueuer;
  /** One `engine.tick()` result, with the queue as it stands right after it. */
  jobRan(tick: TickResult, jobs: readonly PersistedJob[]): Promise<void>;
  /** Resolves when every queued record has been written (or given up on). For tests and shutdown. */
  idle(): Promise<void>;
}

/**
 * Which evaluation results are a processing moment. A record keyed by every kind, so a kind added
 * to `MaterialityEvaluationResult` fails the type check until someone decides which side it is on.
 */
const IS_PROCESSING_MOMENT: Readonly<Record<MaterialityEvaluationResult['kind'], boolean>> = {
  unchanged: false,
  'formatting-only': false,
  debounced: false,
  'below-floor': false,
  'no-groundable-content': false,
  // Resolved into one of the outcomes below before `evaluate` returns; if one ever came back, the
  // free checks had cleared and a judge call was to follow.
  'call-judge': true,
  'stale-response-dropped': false,
  'judge-unavailable': true,
  verdict: true,
};

/** The two job payload kinds that name a source file: the whole source, and one page of it read by vision. */
type SourceJobKind = 'source' | 'vision-page';

function sourceTargetOf(
  payload: unknown,
): { readonly kind: SourceJobKind; readonly sourcePath: VaultPath } | null {
  if (typeof payload !== 'object' || payload === null) return null;
  const { kind, sourcePath } = payload as { kind?: unknown; sourcePath?: unknown };
  if ((kind !== 'source' && kind !== 'vision-page') || typeof sourcePath !== 'string') return null;
  return { kind, sourcePath: sourcePath as VaultPath };
}

function failureClass(error: unknown): string {
  return error instanceof Error ? error.name : 'non-error';
}

export function createProcessedRevisionFeed(
  deps: ProcessedRevisionFeedDeps,
): ProcessedRevisionFeed {
  const coursesFolder = deps.coursesFolder ?? DEFAULT_COURSES_FOLDER;

  let openGate!: (rebuilt: boolean) => void;
  /** Resolves `true` once a rebuild has succeeded this session, `false` once one has failed. */
  const gate = new Promise<boolean>((resolve) => {
    openGate = resolve;
  });
  let starting: Promise<void> | null = null;
  let tail: Promise<void> = Promise.resolve();

  /** One serial queue: FIFO, and one failing step never stops the ones behind it. */
  const serial = (work: () => Promise<void>): Promise<void> => {
    const next = tail.then(work, work).catch((error: unknown) => {
      console.error(
        `Olea: could not update the processed-revision record (${failureClass(error)})`,
      );
    });
    tail = next;
    return next;
  };

  /** Waits for the start's rebuild, then records. Nothing is written when the rebuild failed. */
  const record = async (input: ProcessedRevisionInput | null): Promise<void> => {
    if (input === null) return;
    if (!(await gate)) return;
    await deps.store.recordProcessed(input);
  };

  /** A course file the queue would ingest: under the courses folder, not in a hidden folder. */
  const courseOfSource = (path: VaultPath): string | undefined =>
    isHidden(path) ? undefined : courseFromPath(path, coursesFolder);

  const noteProcessed = (path: VaultPath, currentText: string): Promise<void> => {
    if (!isMarkdown(path) || isHidden(path)) return Promise.resolve();
    return serial(async () =>
      record(await processedNoteRevision(path, currentText, 'read', coursesFolder)),
    );
  };

  return {
    start() {
      starting ??= (async () => {
        try {
          const found = await listCurrentRevisions({
            vault: deps.vault,
            manifestsFor: deps.manifestsFor,
            coursesFolder,
          });
          await deps.store.rebuild(found);
          openGate(true);
        } catch (error) {
          console.error(
            `Olea: could not rebuild the processed-revision record; it is left as it was (${failureClass(error)})`,
          );
          openGate(false);
        }
      })();
      return starting;
    },

    noteEvaluated(path, currentText, result) {
      if (!IS_PROCESSING_MOMENT[result.kind]) return Promise.resolve();
      return noteProcessed(path, currentText);
    },

    noteProcessed,

    observeEnqueues(inner) {
      return {
        async enqueue(input: EnqueueInput): Promise<EnqueueResult> {
          const result = await inner.enqueue(input);
          if (result.status === 'queued') {
            const target = sourceTargetOf(input.payload);
            const course = target === null ? undefined : courseOfSource(target.sourcePath);
            if (target !== null && target.kind === 'source' && course !== undefined) {
              void serial(() =>
                record({
                  path: target.sourcePath,
                  courses: [course],
                  fingerprint: input.contentHash,
                  state: 'pending',
                }),
              );
            }
          }
          return result;
        },
      };
    },

    async idle() {
      let seen: Promise<void>;
      do {
        seen = tail;
        await seen;
      } while (seen !== tail);
    },

    jobRan(tick, jobs) {
      if (tick.kind !== 'ran' || tick.outcome === 'deferred') return Promise.resolve();
      // Read the queue now, before anything awaits: it moves on with the next tick.
      const job = jobs.find((candidate) => candidate.contentHash === tick.contentHash);
      const target = job === undefined ? null : sourceTargetOf(job.payload);
      const course = target === null ? undefined : courseOfSource(target.sourcePath);
      if (job === undefined || target === null || course === undefined) return Promise.resolve();
      const jobHash = job.contentHash;

      return serial(async () => {
        const manifest = (await deps.manifestsFor([target.sourcePath])).get(target.sourcePath);
        if (manifest === undefined) {
          // The reading was asked and could not enumerate the source at all: it is unreadable, by
          // the fingerprint the job is keyed by. A page reading of it has nothing to add.
          if (target.kind !== 'source') return;
          await record({
            path: target.sourcePath,
            courses: [course],
            fingerprint: jobHash,
            state: 'unreadable',
          });
          return;
        }
        const verified = verifiedManifestRevision(manifest);
        // Nothing has read these bytes this session: there is nothing to say about them.
        if (verified === null) return;
        if (target.kind === 'source') {
          // The file changed since this job was queued: the newer version records itself.
          if (verified.fingerprint !== jobHash) return;
        } else {
          // A page reading advances a version the record holds; it never starts one.
          const held = (await deps.store.load()).revisions[target.sourcePath];
          if (held === undefined || held.fingerprint !== verified.fingerprint) return;
        }
        await record({ path: target.sourcePath, courses: [course], ...verified });
      });
    },
  };
}
