/**
 * `createExtractionJobRunner` — the composition seam DF-21 fixes: a
 * `JobRunner` (`types.ts`) built entirely out of already-landed pieces from
 * `../extract/` (P3-T04), so `IngestionQueueEngine.tick()` (P3-T03) actually
 * does something when it drains a job instead of running against a fake.
 *
 * **What this module is not.** It does not reimplement extraction
 * (`extractFromVault` owns that), does not re-derive the text-layer-vs-vision
 * threshold (`routePage`, buried inside each extractor via `threshold.ts`,
 * owns that), and does not duplicate `formatFromExtension` (`registry.ts`
 * owns that). Every one of those stays a single decision made in one place;
 * this module only sequences calls to them and translates the result into
 * the `JobRunOutcome` shape the engine understands.
 *
 * **The job payload vocabulary.** `PersistedJob.payload` is opaque to the
 * engine (see `types.ts`) — this module is what finally gives it meaning.
 * Three kinds, matching the three ways C3/F1.6 name a source arriving:
 *
 * - `'source'` — an already-resolved file + format (F3.1: dropped directly
 *   into the vault, or a single embed a caller resolved some other way).
 * - `'note'` — a note to scan for embedded sources (F1.6) before extracting
 *   anything: discovery, then extraction-per-resolved-embed, in one job.
 * - `'vision-page'` — never enqueued by a caller directly. This runner
 *   creates these itself (see below) as the answer to "what happens to a
 *   page that routes to Slot V."
 *
 * **The vision-routed page, made impossible to drop silently.** `routePage`
 * (via each extractor) can decide a page's text yield is too low to trust —
 * that page needs Slot V, which this package cannot call (no perception/OCR
 * task id exists yet; see `extract/types.ts`'s module doc). Rather than
 * discard that page's routing decision the moment this job returns, the
 * runner enqueues it as a **new, first-class job** back onto the same queue
 * (`JobEnqueuer`, structurally the same `enqueue` method
 * `IngestionQueueEngine` already exposes) with `kind: 'vision-page'` and
 * everything a later submission needs: `sourcePath`, `format`, `page`, and
 * `embeddedIn` for provenance. That job is then just as durable, visible in
 * `QueueSnapshot`, and content-hash-idempotent as any other — the exact
 * opposite of vanishing. `deps.visionRunner`, if supplied, is what actually
 * serves it when the engine drains it later ("the Worker path"); until a
 * real one exists, `vision-page` jobs fail loudly and non-retryably with a
 * named reason rather than being silently accepted and doing nothing.
 *
 * **Tying the knot.** This runner needs to call `enqueue` on the very engine
 * it is a dependency *of* — `IngestionQueueEngine.create` takes the runner
 * as one of `EngineDeps`, so the engine instance does not exist yet at the
 * point the runner is constructed. `deferredEnqueuer()` below is the
 * standard fix: build the enqueuer first, hand it to the runner, construct
 * the engine, then `bind` the enqueuer to the real engine. `enqueue` is never
 * called before the engine exists (`tick()` cannot run before `create`
 * returns), so the ordering is safe by construction.
 */

import { discoverEmbeddedSources, type UnresolvedEmbed } from '../extract/embeds.js';
import { extractFromVault } from '../extract/registry.js';
import type {
  EmbeddedInNote,
  ExtractedUnit,
  ExtractionOutcome,
  ExtractOptions,
  SourceFormat,
} from '../extract/types.js';
import type { VaultPath, VaultSource } from '../vault/types.js';
import { hashText } from './hash.js';
import type {
  EnqueueInput,
  EnqueueResult,
  JobRunner,
  JobRunnerView,
  JobRunOutcome,
} from './types.js';

const KNOWN_FORMATS: ReadonlySet<SourceFormat> = new Set(['pdf', 'pptx', 'docx', 'image']);

/** The subset of `IngestionQueueEngine` this runner needs to enqueue follow-on work. Satisfied structurally — no import of `engine.js` required. */
export interface JobEnqueuer {
  enqueue(input: EnqueueInput): Promise<EnqueueResult>;
}

/** Where every successfully-extracted, text-layer-routed unit goes. The plugin's real implementation forwards to indexing (C2/C3, out of this bead's scope); a test implementation just collects them. */
export interface ExtractedUnitSink {
  /** Called at most once per job, with every unit that job produced. Never called with an empty array — a job that produced nothing simply doesn't call this. */
  receive(units: readonly ExtractedUnit[]): Promise<void>;
}

/** A source already resolved to a path and format — the common shape both `'source'` jobs and each resolved embed inside a `'note'` job extract through. */
interface ResolvedSource {
  readonly sourcePath: VaultPath;
  readonly format: SourceFormat;
  readonly embeddedIn?: EmbeddedInNote;
}

export type ExtractionJobPayload =
  | ({ readonly kind: 'source' } & ResolvedSource)
  | { readonly kind: 'note'; readonly notePath: VaultPath }
  | ({ readonly kind: 'vision-page'; readonly page: number } & ResolvedSource);

/** Not a type predicate: `ResolvedSource` has no index signature, so it can never be a valid narrowing target for a `Record<string, unknown>` parameter (TS2677). Callers narrow via `isExtractionJobPayload` instead, which this function only feeds a boolean into. */
function isResolvedSourceLike(value: Record<string, unknown>): boolean {
  return (
    typeof value.sourcePath === 'string' &&
    typeof value.format === 'string' &&
    KNOWN_FORMATS.has(value.format as SourceFormat)
  );
}

/** Narrows `PersistedJob.payload` (`unknown` by contract) to the shape this runner understands. Anything else is a malformed job, not a crash. */
export function isExtractionJobPayload(value: unknown): value is ExtractionJobPayload {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Record<string, unknown>;
  if (v.kind === 'note') return typeof v.notePath === 'string';
  if (v.kind === 'source') return isResolvedSourceLike(v);
  if (v.kind === 'vision-page') return isResolvedSourceLike(v) && typeof v.page === 'number';
  return false;
}

/** One source that yielded no pages, and which kind of nothing it was — see `ExtractionRunnerDeps.onEmptyExtraction`. */
export interface EmptyExtractionReport {
  readonly sourcePath: VaultPath;
  readonly format: SourceFormat;
  /** Never `'extracted'`: this report is only made for a source with no pages at all. */
  readonly outcome: ExtractionOutcome;
  /** Present only when the source was reached through a note embed (F1.6), so a host can say *where* the dead end was linked from. */
  readonly embeddedIn?: EmbeddedInNote;
}

export interface ExtractionRunnerDeps {
  readonly vault: VaultSource;
  /** How the runner turns a vision-routed page into durable, drainable work rather than dropping it — see the module doc. */
  readonly enqueuer: JobEnqueuer;
  readonly sink: ExtractedUnitSink;
  /** Forwarded verbatim to `extractFromVault` — the *only* tunable, per `ExtractOptions`'s own contract. This module never re-derives a threshold. */
  readonly options?: ExtractOptions;
  /**
   * Serves a `'vision-page'` job when the engine eventually drains one —
   * "the Worker path" the module doc promises. Absent by default: no
   * perception/OCR task id exists yet in `packages/contracts` (see
   * `extract/types.ts`), so until a later task supplies a real one, a
   * drained `vision-page` job fails loudly (`ok: false, retryable: false`)
   * rather than pretending to succeed or silently doing nothing.
   */
  readonly visionRunner?: JobRunner;
  /**
   * Observability hook for a `'note'` job's embeds that `discoverEmbeddedSources`
   * could not resolve (F1.6: genuinely ambiguous or missing, reported rather
   * than guessed). Does not fail the job — a note with one bad link among
   * several good embeds still owes her the ones that resolved. Defaults to a
   * no-op; a host that wants to surface this to her supplies one.
   */
  readonly onUnresolvedEmbed?: (embed: UnresolvedEmbed) => void;
  /**
   * Observability hook for a source that produced **no pages at all**
   * (ol-voen). Fires once per such source, with `ExtractionResult.outcome`
   * saying which kind of nothing it was — see `../extract/types.js`.
   *
   * **Why this exists.** Nine real lecture decks went through this runner,
   * threw nothing, produced no units, and were counted as successes; a
   * real-vault run truthfully reported "0 extraction failures" while nine
   * sources produced nothing. That is a *silent empty*, and it is a worse
   * shape than a failure, because the pipeline reports success and produces
   * nothing. The extractors can now tell the two apart; this is where the
   * runner stops swallowing the distinction.
   *
   * **It does not fail the job, deliberately.** `'no-pages-found'` and
   * `'unreadable'` are properties of the *document*, not transient
   * environment failures, so the retry/backoff machinery D-002 provides has
   * nothing to offer them — retrying reads the same bytes and reaches the
   * same conclusion. And a `'note'` job with one unreachable embed among
   * several good ones still owes her the ones that worked, exactly as it
   * does for an unresolved embed. The honest answer is a report, not a
   * retry. Defaults to a no-op; a host that wants to surface this to her
   * supplies one.
   */
  readonly onEmptyExtraction?: (report: EmptyExtractionReport) => void;
  /**
   * Pre-computed `vault.list()` output, threaded straight through to every
   * `discoverEmbeddedSources` call a `'note'` job makes — see that
   * function's own `knownPaths` doc (`../extract/embeds.js`) for why this
   * exists at all. `runNoteJob` runs once per drained `'note'` job, and a
   * host that enqueues one such job per note (a backlog sweep, or catching
   * up after being offline) would otherwise pay for a full recursive vault
   * walk PER JOB — the exact O(notes x files) shape DF-24 was filed over,
   * one layer up from where it first shipped. Optional and undefined by
   * default so a host that drains a single ad hoc `'note'` job (the common
   * case — most jobs arrive one at a time from a live `create`/`modify`
   * event, not a sweep) stays correct without having to compute a listing
   * it doesn't need. A host doing a multi-note sweep should list once and
   * pass it here; a long-lived host should also be prepared to refresh it
   * between sweeps, since a listing captured before the sweep started goes
   * stale the moment the vault changes underneath it.
   */
  readonly knownPaths?: readonly VaultPath[];
}

/** Deterministic, content-derived id for a vision-page follow-on job: stable across repeated discovery of the same source (so a synced duplicate note/source job never double-enqueues the same page), distinct per page and per embed. */
function visionPageContentHash(
  parentContentHash: string,
  sourcePath: VaultPath,
  page: number,
): Promise<string> {
  return hashText(`vision-page:${parentContentHash}:${sourcePath}:${page}`);
}

function basename(path: VaultPath): string {
  const slash = path.lastIndexOf('/');
  return slash === -1 ? path : path.slice(slash + 1);
}

/** Extracts one already-resolved source, enqueues a follow-on job for every vision-routed page, and returns the units its text-layer-routed pages produced. Shared by `'source'` jobs and each resolved embed of a `'note'` job — the one place either kind of job actually calls `extractFromVault`. */
async function extractResolvedSource(
  deps: ExtractionRunnerDeps,
  parentContentHash: string,
  source: ResolvedSource,
): Promise<readonly ExtractedUnit[]> {
  const result = await extractFromVault(
    deps.vault,
    source.sourcePath,
    source.format,
    deps.options,
    source.embeddedIn,
  );

  if (result.pages.length === 0) {
    deps.onEmptyExtraction?.({
      sourcePath: source.sourcePath,
      format: source.format,
      outcome: result.outcome,
      ...(source.embeddedIn ? { embeddedIn: source.embeddedIn } : {}),
    });
  }

  const units: ExtractedUnit[] = [];
  for (const page of result.pages) {
    if (page.route === 'text-layer') {
      units.push(...page.units);
      continue;
    }
    // route === 'vision': not dropped — enqueued as its own durable job.
    const contentHash = await visionPageContentHash(
      parentContentHash,
      source.sourcePath,
      page.page,
    );
    const visionPayload: ExtractionJobPayload = {
      kind: 'vision-page',
      sourcePath: source.sourcePath,
      format: source.format,
      page: page.page,
      ...(source.embeddedIn ? { embeddedIn: source.embeddedIn } : {}),
    };
    await deps.enqueuer.enqueue({
      contentHash,
      label: `${basename(source.sourcePath)} — page ${page.page} (vision)`,
      payload: visionPayload,
    });
  }
  return units;
}

async function runNoteJob(
  deps: ExtractionRunnerDeps,
  job: JobRunnerView,
  notePath: VaultPath,
): Promise<JobRunOutcome> {
  const { resolved, unresolved } = await discoverEmbeddedSources(
    deps.vault,
    notePath,
    deps.knownPaths,
  );

  for (const embed of unresolved) {
    deps.onUnresolvedEmbed?.(embed);
  }

  const units: ExtractedUnit[] = [];
  for (const embed of resolved) {
    const embedUnits = await extractResolvedSource(deps, job.contentHash, {
      sourcePath: embed.path,
      format: embed.format,
      embeddedIn: embed.embeddedIn,
    });
    units.push(...embedUnits);
  }

  if (units.length > 0) await deps.sink.receive(units);
  return { ok: true };
}

async function runSourceJob(
  deps: ExtractionRunnerDeps,
  job: JobRunnerView,
  source: ResolvedSource,
): Promise<JobRunOutcome> {
  const units = await extractResolvedSource(deps, job.contentHash, source);
  if (units.length > 0) await deps.sink.receive(units);
  return { ok: true };
}

async function runVisionPageJob(
  deps: ExtractionRunnerDeps,
  job: JobRunnerView,
): Promise<JobRunOutcome> {
  if (deps.visionRunner) return deps.visionRunner(job);
  return {
    ok: false,
    retryable: false,
    reason:
      'vision-page job has no visionRunner wired yet (no Slot V/W2 client exists in this build) — DF-21 leaves this job queued and servable, not dropped, for a later task to wire',
  };
}

/**
 * Builds the `JobRunner` `IngestionQueueEngine` drains against. Dispatches on
 * `job.payload`'s `kind` (see `ExtractionJobPayload`); a payload this runner
 * doesn't recognise is a malformed job, reported `ok: false, retryable:
 * false` rather than crashing the engine's `tick()` (see `engine.spec.ts`
 * for what an actually-*throwing* runner does — deliberately different, and
 * deliberately not what this runner does for its own recognised failure
 * modes).
 *
 * Anything thrown by the vault or the extractors (a file deleted between
 * discovery and drain, a transient read error) is caught here and reported
 * `retryable: true` — every one of those is exactly the kind of transient,
 * environment-shaped failure D-002 already has a retry/backoff mechanism
 * for, so retrying is the honest default rather than a hand-rolled
 * special case.
 */
export function createExtractionJobRunner(deps: ExtractionRunnerDeps): JobRunner {
  return async (job: JobRunnerView): Promise<JobRunOutcome> => {
    if (!isExtractionJobPayload(job.payload)) {
      return {
        ok: false,
        retryable: false,
        reason: `unrecognised ingestion job payload for ${job.contentHash}`,
      };
    }

    try {
      switch (job.payload.kind) {
        case 'note':
          return await runNoteJob(deps, job, job.payload.notePath);
        case 'source':
          return await runSourceJob(deps, job, job.payload);
        case 'vision-page':
          return await runVisionPageJob(deps, job);
      }
    } catch {
      // The vault or an extractor threw: a file deleted between discovery
      // and drain, a transient read error, or similar. See the module doc
      // on why the honest default here is retryable rather than a thrown
      // exception left for the engine to deal with. `JobRunOutcome`'s
      // retryable branch carries no `reason` field (only the non-retryable
      // one does, per `types.ts`), so there is nowhere to put the error
      // message without inventing a field the contract doesn't define.
      return { ok: false, retryable: true };
    }
  };
}

/**
 * Ties the knot between a runner (which needs to enqueue follow-on work) and
 * the engine (which needs the runner before it exists) — see the module doc.
 * `enqueue` calls made before `bind` are a programmer error: nothing can
 * reach this runner before `IngestionQueueEngine.create` has returned.
 */
export function deferredEnqueuer(): JobEnqueuer & { bind(target: JobEnqueuer): void } {
  let target: JobEnqueuer | null = null;
  return {
    bind(t: JobEnqueuer): void {
      target = t;
    },
    async enqueue(input: EnqueueInput): Promise<EnqueueResult> {
      if (!target) {
        throw new Error(
          'deferredEnqueuer.enqueue called before bind() — construct the engine first',
        );
      }
      return target.enqueue(input);
    },
  };
}
