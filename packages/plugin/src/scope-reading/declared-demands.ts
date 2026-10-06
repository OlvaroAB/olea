/**
 * `createDeclaredDemandsReader` — the gap view's `readDeclaredDemands` (`ol-egov.141.89.9.81`,
 * `[D-437]` B5, `[D-349]`): per concept key, the demands the course's assessment declares, read
 * from the examiner-scope reading Olea keeps in its own layer (`[D-429]`).
 *
 * **The join, as ruled (David, 2026-10-04, option b): an explicit part-to-concept link.** A demand
 * is stored per past-paper PART (`PartDemandPayload`, keyed by revision and part id, pinned to the
 * structure reading it read), and an alignment result per (course, revision, concept). The link
 * between them is the aligned result itself: for a past paper its `recordIds` ARE the part ids the
 * alignment judged within scope, and `[D-534]` 2-ii pins them to one structure reading
 * (`AlignmentResultPayload.structureId`). So a part's demand reaches a concept only when a current
 * aligned result for that concept names that part, under the structure that is current now.
 * Passages are never compared: an aligned result's `refs` overlapping a part's instruction can
 * suggest a relationship but does not establish that the part's demand applies to the concept
 * (the ruling's own words). A concept no aligned result names gets nothing.
 *
 * **What becomes a declared demand.** Only a part's `decided` demand, or the two demands of a
 * `compound` part, and only a word of `PAPER_DEMANDS`. An `unsupported` operation, a `cannot-tell`
 * part and a part not yet read are three different things (2026-09-29 ruling, different reasons
 * for unresolved cases), none of them a `PaperDemand`, and none is ever supplied as one.
 *
 * **Absent is not empty.** A concept gets an entry only when at least one demand reached it, so
 * this reader never hands the gap view `[]` ("read, and asks nothing"): it never holds evidence for
 * that claim. A concept with no link, or linked only to parts with no decided demand, is absent,
 * which the gap view reads as not yet known.
 *
 * **Only current readings** (scp.md 3.2, the ATT row: "current revisions"). For each document
 * registered NOW as a past paper (its latest registration event, as the writer reads it), the
 * paper's current revision digest comes from the caller (production: the unit manifest, which
 * re-hashes the bytes; an unknown manifest gives none and the paper is skipped). Readings keyed to
 * any other revision are never looked at. The structure reading must be `current` under the
 * caller's reader policy (`stale-reader` is refused); an alignment result must be `current` (a
 * result naming another structure reads unverified and is refused) and by an accepted reader; a
 * part demand must be `current` against the current structure (`partDemandView`). The alignment
 * digests the view leaves unchecked (closed list, coverage, batch plan, frozen configuration) are
 * deliberately not asked: the ATT row asks current revisions only, and a closed list that grew
 * leaves an aligned result usable (scp.md S.6). Results are read only for the courses the paper is
 * registered to now, the same course the writer named (`main.ts`'s `registeredOutcomesDocumentFor`).
 *
 * **Not applied, because no production fact carries it** (an open question on the bead, `[D-385]`):
 * scp.md 3.2's "current and transitional non-sealed" regime filter. Nothing on the client records
 * a paper's regime or a sealed mark, so every registered past paper counts, as it already does for
 * the ranking's past-paper edges.
 *
 * **Per concept key, not per course.** The gap view's seam (`CreateLocalGapProviderDeps.
 * readDeclaredDemands`) is keyed by concept key, so a concept in two courses carries the demands
 * every course's papers link to it. The closed list sent to alignment is course-only
 * (`./closed-list.ts`), so an aligned result names only a concept of that course.
 *
 * **Reads only.** It loads the projection through SCP's store (`./persistence.ts`,
 * `olea-core`'s `scope-reading-project.ts` views), never re-parsing a log, and writes nothing. No
 * model call, no network (C6). Nothing it reads is logged (D-005).
 *
 * **What turning it on changes.** Nothing while the scope-reading drivers stay off (`[D-534]` 1b,
 * `./drivers.ts`): no part demand and no alignment result is written, so every concept stays
 * absent. Once a ruling turns the drivers on, a concept with a linked demand no qualifying review
 * shows loses the recognition credit on the gap view (`[D-349]`, the attainment chain spec section
 * 2.5), which can move its row: turning the drivers on also turns this on. The replay that
 * measured the wire is `test/scope-reading/declared-demands.replay.spec.ts` (0 rows moved on the
 * synthetic fixtures, none of which holds a scope-reading record).
 *
 * **Reachability (`[D-072]`).** `main.ts` passes {@link declaredDemandsReaderForVault} as the gap
 * view's `readDeclaredDemands` (the `createLocalGapProvider` call under
 * `registerView(VIEW_TYPE_OLEA_GAP, …)`); `../gap/provider.ts`'s `readDeclared` calls it on every
 * load. The session builder's own gap view (`../session-builder/provider.ts`) passes none.
 */

import type { ReviewLogEntry } from 'olea-contracts';
import {
  alignmentResultsForDocument,
  courseFromPath,
  DEFAULT_COURSES_FOLDER,
  PAPER_DEMANDS,
  type PaperDemand,
  partDemandView,
  projectRegisteredFiles,
  type ReadingPolicy,
  readReviewLogHistory,
  type ScopePartDemand,
  type ScopeReadingProjection,
  type ScopeRevisionRef,
  structureView,
  type UnitManifest,
  type VaultPath,
  type VaultSource,
} from 'olea-core';
import { UNVERIFIED_REVISION_DIGEST } from '../../../core/src/ingestion/unit-manifest/projection.js';
import { createScopeReadingPersistence } from './persistence.js';

/** A document registered now as a past paper, with the courses it is registered to. */
export interface RegisteredPastPaper {
  readonly path: VaultPath;
  readonly courses: readonly string[];
}

export interface DeclaredDemandsReaderDeps {
  /** The scope-reading projection: `ScopeReadingPersistence.load` (`./persistence.ts`). */
  readonly loadScopeReadings: () => Promise<ScopeReadingProjection>;
  /** The documents registered NOW as past papers ({@link registeredPastPapersFrom}). */
  readonly registeredPastPapers: () => Promise<readonly RegisteredPastPaper[]>;
  /**
   * Each path's current revision digest. A path left out has no current revision that can be
   * established, and its readings give nothing ({@link currentRevisionsFromManifests}).
   */
  readonly currentRevisions: (
    paths: readonly VaultPath[],
  ) => Promise<ReadonlyMap<VaultPath, string>>;
  /** Reader prompt versions accepted. Omitted: any version, the projection's own default. */
  readonly policy?: ReadingPolicy;
}

const DEMAND_ORDER = new Map<string, number>(PAPER_DEMANDS.map((demand, i) => [demand, i]));

const isPaperDemand = (value: unknown): value is PaperDemand =>
  typeof value === 'string' && DEMAND_ORDER.has(value);

/** The demand words a part's verdict supplies: a decided demand, or both of a compound. Nothing else, ever. */
function demandWordsOf(verdict: ScopePartDemand): readonly PaperDemand[] {
  if (verdict.status === 'decided') return isPaperDemand(verdict.demand) ? [verdict.demand] : [];
  if (verdict.status === 'compound') return verdict.demands.filter(isPaperDemand);
  return [];
}

const readerAccepted = (promptVersion: string | undefined, policy: ReadingPolicy | undefined) =>
  policy?.acceptedReaderVersions === undefined ||
  (promptVersion !== undefined && policy.acceptedReaderVersions.includes(promptVersion));

/**
 * The pure join: per concept key, the declared demands that reach it through a current, explicit
 * part-to-concept link (see the module doc). A concept with none has no entry. Demands are listed
 * once each, in `PAPER_DEMANDS` order.
 */
export function declaredDemandsFromProjection(
  projection: ScopeReadingProjection,
  papers: readonly RegisteredPastPaper[],
  currentRevisions: ReadonlyMap<VaultPath, string>,
  policy?: ReadingPolicy,
): ReadonlyMap<string, readonly PaperDemand[]> {
  const reached = new Map<string, Set<PaperDemand>>();
  for (const paper of papers) {
    const revisionDigest = currentRevisions.get(paper.path);
    if (revisionDigest === undefined || revisionDigest === UNVERIFIED_REVISION_DIGEST) continue;
    const source: ScopeRevisionRef = {
      sourcePath: paper.path,
      documentKind: 'past-paper',
      revisionDigest,
    };
    const structure = structureView(projection, source, policy);
    if (structure.status !== 'current') continue;
    for (const course of new Set(paper.courses)) {
      for (const view of alignmentResultsForDocument(projection, course, source, {})) {
        if (view.status !== 'current') continue;
        if (view.structureId !== structure.structureId) continue;
        if (!readerAccepted(view.provenance?.promptVersion, policy)) continue;
        if (view.result.kind !== 'aligned') continue;
        for (const partId of new Set(view.result.recordIds)) {
          const part = partDemandView(projection, source, partId, policy);
          if (part.status !== 'current') continue;
          const words = demandWordsOf(part.demand);
          if (words.length === 0) continue;
          const set = reached.get(view.conceptKey) ?? new Set<PaperDemand>();
          for (const word of words) set.add(word);
          reached.set(view.conceptKey, set);
        }
      }
    }
  }
  const out = new Map<string, readonly PaperDemand[]>();
  for (const conceptKey of [...reached.keys()].sort()) {
    const demands = [...(reached.get(conceptKey) as Set<PaperDemand>)].sort(
      (a, b) => (DEMAND_ORDER.get(a) as number) - (DEMAND_ORDER.get(b) as number),
    );
    out.set(conceptKey, demands);
  }
  return out;
}

/**
 * The gap view's `readDeclaredDemands`. Throws when a dependency throws: the gap provider reads a
 * failing reader as nothing read, never as "asks nothing" (`../gap/provider.ts`'s `readDeclared`).
 */
export function createDeclaredDemandsReader(
  deps: DeclaredDemandsReaderDeps,
): () => Promise<ReadonlyMap<string, readonly PaperDemand[]>> {
  return async () => {
    const papers = await deps.registeredPastPapers();
    if (papers.length === 0) return new Map();
    const [projection, revisions] = await Promise.all([
      deps.loadScopeReadings(),
      deps.currentRevisions([...new Set(papers.map((paper) => paper.path))].sort()),
    ]);
    return declaredDemandsFromProjection(projection, papers, revisions, deps.policy);
  };
}

export interface VaultDeclaredDemandsDeps {
  readonly vault: VaultSource;
  /** This install's stable device id (`../device/device-id.ts`): names its own scope-reading files. */
  readonly deviceId: string;
  /** The unit manifest's reader boundary (`../grove/unit-manifest-store.ts`'s `manifestsFor`). */
  readonly manifestsFor: (
    paths: readonly VaultPath[],
  ) => Promise<ReadonlyMap<VaultPath, UnitManifest>>;
  readonly coursesFolder?: VaultPath;
  /** Injectable for tests; production reads `readReviewLogHistory(vault)`, as the writer does. */
  readonly reviewLog?: () => Promise<readonly ReviewLogEntry[]>;
}

/**
 * The production composition (`main.ts` passes it to `createLocalGapProvider`): SCP's store over
 * her vault for the readings, her review log's registrations for the papers, and the unit
 * manifest for each paper's current revision, which is the same digest the writer keyed the
 * readings by (`main.ts`'s `scopeReading.readingBasisFor`). The store is opened at each read, so a
 * device id the store refuses fails that read, which the gap view reads as nothing read.
 */
export function declaredDemandsReaderForVault(
  deps: VaultDeclaredDemandsDeps,
): () => Promise<ReadonlyMap<string, readonly PaperDemand[]>> {
  const reviewLog =
    deps.reviewLog ?? (async () => (await readReviewLogHistory(deps.vault)).entries);
  return createDeclaredDemandsReader({
    loadScopeReadings: () =>
      createScopeReadingPersistence({ vault: deps.vault, deviceId: deps.deviceId }).load(),
    registeredPastPapers: async () =>
      registeredPastPapersFrom(await reviewLog(), deps.coursesFolder),
    currentRevisions: async (paths) =>
      currentRevisionsFromManifests(await deps.manifestsFor(paths)),
  });
}

/**
 * The documents whose latest registration is as a past paper, each with its course: the course
 * the registration names, else the one its path sits under. The same rule the writer uses
 * (`main.ts`'s `registeredOutcomesDocumentFor`), so the reader asks for the course the alignment
 * results were written under. A paper with no course is kept with none and gives nothing.
 */
export function registeredPastPapersFrom(
  entries: readonly ReviewLogEntry[],
  coursesFolder: VaultPath = DEFAULT_COURSES_FOLDER,
): readonly RegisteredPastPaper[] {
  return projectRegisteredFiles(entries)
    .filter((spec) => spec.role === 'past-paper')
    .map((spec) => {
      const course = spec.course ?? courseFromPath(spec.path, coursesFolder);
      return { path: spec.path, courses: course === undefined ? [] : [course] };
    });
}

/**
 * The current revision digest of each source the unit manifest could verify. The unknown manifest
 * (a source not yet enumerated this session, or a store that could not load) names no revision,
 * so its source is left out: no current revision, so no reading of it is current.
 */
export function currentRevisionsFromManifests(
  manifests: ReadonlyMap<VaultPath, UnitManifest>,
): ReadonlyMap<VaultPath, string> {
  const out = new Map<VaultPath, string>();
  for (const [path, manifest] of manifests) {
    if (manifest.revisionDigest === UNVERIFIED_REVISION_DIGEST) continue;
    out.set(path, manifest.revisionDigest);
  }
  return out;
}
