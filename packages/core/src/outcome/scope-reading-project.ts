/**
 * The projection of the scope-reading log (`./scope-reading-log.ts`) and the read-side views over
 * it (`[D-429]`): pure, no I/O, rebuilt from the log's entries on every read (the log is the truth;
 * nothing here is a second copy — ONT-R5's "projection only when read").
 *
 * **What a view refuses to do.** Every view takes what the CALLER says is current — the document's
 * present revision digest, the reader versions it accepts, the digests of the present closed list
 * and coverage — and labels a stored reading against that, never against the newest thing in the
 * log. So:
 *
 * - *No record is unknown, never empty.* A revision with no state record reads `unknown`; only an
 *   explicit `read-states-nothing` record says a document was read and stated nothing, and an owed
 *   extraction reads `pending`. The three are three answers (scp.md 3.1).
 * - *A reading of another revision never speaks for this one.* A structure reading, a part demand or
 *   an alignment result is keyed by revision, so a changed document finds nothing current; the view
 *   says an older one exists (`stale-revision`, `olderRevisionOnly`) without handing it out.
 * - *A reader-version bump invalidates.* A structure reading by a prompt version outside the accepted
 *   set is `stale-reader`: kept, visible, and never `current`.
 * - *A demand is only as current as the structure it was read against.* A part demand names the id of
 *   the structure record it read; when a newer structure replaces that one, the demand is `stale`.
 * - *An alignment result is current only against its digests.* `unverified` names which digest
 *   moved (S.3, scp.md 3.2: "stale reads unverified and counts as pending").
 *
 * The total order, and "newest wins per key", come from the log module; this module only groups the
 * winners and answers questions about them. A stored payload that is not the shape it claims is
 * skipped, so a corrupt line reads as no record rather than as a state.
 */

import { latestEntryPerKey, type ScopeReadingLogEntry } from './scope-reading-log.js';
import type {
  AlignmentCoverageNote,
  AlignmentDigests,
  AlignmentFreshness,
  AlignmentResult,
  AlignmentResultPayload,
  DocumentProcessingState,
  DocumentStatePayload,
  PaperStructurePayload,
  PartDemandPayload,
  ScopeDocumentKind,
  ScopePaperStructure,
  ScopePartDemand,
  ScopeReaderProvenance,
  ScopeSourceRef,
} from './scope-reading-types.js';

// --------------------------------------------------------------------------------------------
// Keys: the identity a newer entry supersedes by
// --------------------------------------------------------------------------------------------

/** What identifies a document revision for a state or structure record. */
export type ScopeRevisionRef = Pick<
  ScopeSourceRef,
  'sourcePath' | 'documentKind' | 'revisionDigest'
>;

export function documentStateKey(source: ScopeRevisionRef): string {
  return JSON.stringify(['state', source.documentKind, source.sourcePath, source.revisionDigest]);
}

export function paperStructureKey(source: ScopeRevisionRef): string {
  return JSON.stringify([
    'structure',
    source.documentKind,
    source.sourcePath,
    source.revisionDigest,
  ]);
}

export function partDemandKey(source: ScopeRevisionRef, partId: string): string {
  return JSON.stringify([
    'demand',
    source.documentKind,
    source.sourcePath,
    source.revisionDigest,
    partId,
  ]);
}

export function alignmentResultKey(
  courseId: string,
  source: ScopeRevisionRef,
  conceptKey: string,
): string {
  return JSON.stringify([
    'alignment',
    courseId,
    source.documentKind,
    source.sourcePath,
    source.revisionDigest,
    conceptKey,
  ]);
}

const documentKey = (kind: ScopeDocumentKind, sourcePath: string): string =>
  JSON.stringify([kind, sourcePath]);

// --------------------------------------------------------------------------------------------
// Shape guards for stored payloads
// --------------------------------------------------------------------------------------------

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);
const isString = (value: unknown): value is string => typeof value === 'string' && value.length > 0;

function isSourceRef(value: unknown): value is ScopeSourceRef {
  return (
    isObject(value) &&
    isString(value.sourcePath) &&
    isString(value.revisionDigest) &&
    (value.documentKind === 'objectives' ||
      value.documentKind === 'past-paper' ||
      value.documentKind === 'stated-scope')
  );
}

function isProvenance(value: unknown): value is ScopeReaderProvenance {
  return (
    isObject(value) &&
    isString(value.task) &&
    isString(value.promptVersion) &&
    isString(value.modelId)
  );
}

const STATE_KINDS = ['registered', 'partly-read', 'pending', 'read-states-nothing', 'recorded'];

export function isDocumentStatePayload(value: unknown): value is DocumentStatePayload {
  return (
    isObject(value) &&
    isSourceRef(value.source) &&
    isObject(value.state) &&
    STATE_KINDS.includes(value.state.kind as string) &&
    (value.provenance === undefined || isProvenance(value.provenance))
  );
}

export function isPaperStructurePayload(value: unknown): value is PaperStructurePayload {
  return (
    isObject(value) &&
    isSourceRef(value.source) &&
    isProvenance(value.provenance) &&
    isObject(value.reading) &&
    Array.isArray(value.reading.sections)
  );
}

export function isPartDemandPayload(value: unknown): value is PartDemandPayload {
  return (
    isObject(value) &&
    isSourceRef(value.source) &&
    isString(value.partId) &&
    isString(value.structureId) &&
    isObject(value.demand) &&
    isString(value.demand.status) &&
    isProvenance(value.provenance)
  );
}

export function isAlignmentResultPayload(value: unknown): value is AlignmentResultPayload {
  return (
    isObject(value) &&
    isSourceRef(value.source) &&
    isString(value.courseId) &&
    isString(value.conceptKey) &&
    isObject(value.result) &&
    isString(value.result.kind) &&
    isObject(value.digests) &&
    isString(value.digests.closedList) &&
    isString(value.digests.coverage) &&
    isString(value.digests.frozenConfiguration) &&
    isObject(value.coverage)
  );
}

// --------------------------------------------------------------------------------------------
// The projection
// --------------------------------------------------------------------------------------------

/** A stored payload with the entry facts a view needs. */
interface Projected<T> {
  readonly payload: T;
  readonly eventId: string;
  readonly recordedAt: string;
}

export interface ScopeReadingLogs {
  readonly documentState: readonly ScopeReadingLogEntry[];
  readonly paperStructure: readonly ScopeReadingLogEntry[];
  readonly alignmentResult: readonly ScopeReadingLogEntry[];
}

/** The newest record per key of each store. Opaque: read it through the views below. */
export interface ScopeReadingProjection {
  readonly states: ReadonlyMap<string, Projected<DocumentStatePayload>>;
  readonly structures: ReadonlyMap<string, Projected<PaperStructurePayload>>;
  readonly partDemands: ReadonlyMap<string, Projected<PartDemandPayload>>;
  readonly alignments: ReadonlyMap<string, Projected<AlignmentResultPayload>>;
  /** documentKey -> the revision digests that have a state record, for "another revision was recorded". */
  readonly stateRevisions: ReadonlyMap<string, ReadonlySet<string>>;
  /** documentKey -> the revision digests that have a structure record. */
  readonly structureRevisions: ReadonlyMap<string, ReadonlySet<string>>;
  /** courseId + documentKey -> the revision digests that have any alignment result. */
  readonly alignmentRevisions: ReadonlyMap<string, ReadonlySet<string>>;
}

function project<T>(
  entries: readonly ScopeReadingLogEntry[],
  kind: string,
  guard: (payload: unknown) => payload is T,
): Map<string, Projected<T>> {
  const out = new Map<string, Projected<T>>();
  for (const [key, entry] of latestEntryPerKey(entries.filter((e) => e.kind === kind))) {
    if (guard(entry.payload)) {
      out.set(key, {
        payload: entry.payload,
        eventId: entry.eventId,
        recordedAt: entry.recordedAt,
      });
    }
  }
  return out;
}

function hasOtherRevision(
  revisions: ReadonlySet<string> | undefined,
  revisionDigest: string,
): boolean {
  return revisions !== undefined && [...revisions].some((digest) => digest !== revisionDigest);
}

function addRevision(index: Map<string, Set<string>>, key: string, revisionDigest: string): void {
  const set = index.get(key) ?? new Set<string>();
  set.add(revisionDigest);
  index.set(key, set);
}

/** Folds the log entries of the three stores into the newest record per key. Pure; independent of the order the entries arrive in. */
export function projectScopeReadings(logs: ScopeReadingLogs): ScopeReadingProjection {
  const states = project(logs.documentState, 'document-state', isDocumentStatePayload);
  const structures = project(logs.paperStructure, 'structure', isPaperStructurePayload);
  const partDemands = project(logs.paperStructure, 'part-demand', isPartDemandPayload);
  const alignments = project(logs.alignmentResult, 'alignment-result', isAlignmentResultPayload);

  const stateRevisions = new Map<string, Set<string>>();
  for (const { payload } of states.values()) {
    addRevision(
      stateRevisions,
      documentKey(payload.source.documentKind, payload.source.sourcePath),
      payload.source.revisionDigest,
    );
  }
  const structureRevisions = new Map<string, Set<string>>();
  for (const { payload } of structures.values()) {
    addRevision(
      structureRevisions,
      documentKey(payload.source.documentKind, payload.source.sourcePath),
      payload.source.revisionDigest,
    );
  }
  const alignmentRevisions = new Map<string, Set<string>>();
  for (const { payload } of alignments.values()) {
    addRevision(
      alignmentRevisions,
      JSON.stringify([payload.courseId, payload.source.documentKind, payload.source.sourcePath]),
      payload.source.revisionDigest,
    );
  }
  return {
    states,
    structures,
    partDemands,
    alignments,
    stateRevisions,
    structureRevisions,
    alignmentRevisions,
  };
}

// --------------------------------------------------------------------------------------------
// Views
// --------------------------------------------------------------------------------------------

export type DocumentStateView =
  /** No record for this revision: not yet known. `otherRevisionsRecorded` says an older or newer revision has one. */
  | { readonly status: 'unknown'; readonly otherRevisionsRecorded: boolean }
  | {
      readonly status: 'known';
      readonly state: DocumentProcessingState;
      readonly provenance?: ScopeReaderProvenance;
      readonly coverageDigest?: string;
      readonly recordedAt: string;
    };

/** The processing state of the CURRENT revision of one document. */
export function documentStateView(
  projection: ScopeReadingProjection,
  current: ScopeRevisionRef,
): DocumentStateView {
  const held = projection.states.get(documentStateKey(current));
  if (held === undefined) {
    return {
      status: 'unknown',
      otherRevisionsRecorded: hasOtherRevision(
        projection.stateRevisions.get(documentKey(current.documentKind, current.sourcePath)),
        current.revisionDigest,
      ),
    };
  }
  const { payload } = held;
  return {
    status: 'known',
    state: payload.state,
    ...(payload.provenance !== undefined ? { provenance: payload.provenance } : {}),
    ...(payload.coverageDigest !== undefined ? { coverageDigest: payload.coverageDigest } : {}),
    recordedAt: held.recordedAt,
  };
}

export interface ReadingPolicy {
  /** Reader prompt versions the caller accepts. Omitted: any version is accepted. */
  readonly acceptedReaderVersions?: readonly string[];
}

const readerAccepted = (
  provenance: ScopeReaderProvenance,
  policy: ReadingPolicy | undefined,
): boolean =>
  policy?.acceptedReaderVersions === undefined ||
  policy.acceptedReaderVersions.includes(provenance.promptVersion);

export type StructureView =
  /** Nothing recorded for the current revision (never read, owed, or read and empty — consult `documentStateView`). */
  | { readonly status: 'absent' }
  /** A reading exists only for another revision. It is not handed out. */
  | { readonly status: 'stale-revision' }
  /** The right revision, read by a version the caller does not accept. Visible, never `current`. */
  | {
      readonly status: 'stale-reader';
      readonly reading: ScopePaperStructure;
      readonly provenance: ScopeReaderProvenance;
      readonly structureId: string;
    }
  | {
      readonly status: 'current';
      readonly reading: ScopePaperStructure;
      readonly provenance: ScopeReaderProvenance;
      /** The id a part-demand record names to say what it read. */
      readonly structureId: string;
    };

/** The paper-structure reading of the current revision, labelled against the caller's policy. */
export function structureView(
  projection: ScopeReadingProjection,
  current: ScopeRevisionRef,
  policy?: ReadingPolicy,
): StructureView {
  const held = projection.structures.get(paperStructureKey(current));
  if (held === undefined) {
    // Only another revision's STRUCTURE record counts: a state record alone is no evidence of a reading.
    return hasOtherRevision(
      projection.structureRevisions.get(documentKey(current.documentKind, current.sourcePath)),
      current.revisionDigest,
    )
      ? { status: 'stale-revision' }
      : { status: 'absent' };
  }
  const { payload, eventId } = held;
  const base = { reading: payload.reading, provenance: payload.provenance, structureId: eventId };
  return readerAccepted(payload.provenance, policy)
    ? { status: 'current', ...base }
    : { status: 'stale-reader', ...base };
}

export type PartDemandView =
  /** No demand record for this part against the current revision: not yet read. Never a verdict. */
  | { readonly status: 'not-yet-read' }
  /** A demand exists but was read against a structure that has since been replaced. Not handed out. */
  | { readonly status: 'stale' }
  | {
      readonly status: 'current';
      readonly demand: ScopePartDemand;
      readonly provenance: ScopeReaderProvenance;
    };

/** One part's demand verdict, current only if it was read against the structure that is current now. */
export function partDemandView(
  projection: ScopeReadingProjection,
  current: ScopeRevisionRef,
  partId: string,
  policy?: ReadingPolicy,
): PartDemandView {
  const held = projection.partDemands.get(partDemandKey(current, partId));
  if (held === undefined) return { status: 'not-yet-read' };
  const structure = structureView(projection, current, policy);
  if (structure.status !== 'current' || structure.structureId !== held.payload.structureId) {
    return { status: 'stale' };
  }
  if (!readerAccepted(held.payload.provenance, policy)) return { status: 'stale' };
  return { status: 'current', demand: held.payload.demand, provenance: held.payload.provenance };
}

/** The digests the caller says are current. Only those supplied are compared; an omitted one is not checked. */
export type AlignmentCurrentDigests = Partial<AlignmentDigests>;

/** Compares one stored result with the digests that are current now. `revisionDigest` is optional here: a keyed lookup already implies the revision. */
export function alignmentFreshness(
  payload: AlignmentResultPayload,
  current: AlignmentCurrentDigests & { readonly revisionDigest?: string },
): AlignmentFreshness {
  const stale: ('revision' | 'closedList' | 'coverage' | 'batchPlan' | 'frozenConfiguration')[] =
    [];
  if (
    current.revisionDigest !== undefined &&
    current.revisionDigest !== payload.source.revisionDigest
  ) {
    stale.push('revision');
  }
  for (const name of ['closedList', 'coverage', 'batchPlan', 'frozenConfiguration'] as const) {
    const now = current[name];
    if (now !== undefined && now !== payload.digests[name]) stale.push(name);
  }
  return stale.length === 0 ? { status: 'current' } : { status: 'unverified', stale };
}

export interface AlignmentQuery {
  readonly courseId: string;
  /** The document at its CURRENT revision. */
  readonly source: ScopeRevisionRef;
  readonly conceptKey: string;
}

export type AlignmentResultView =
  /** No result for this concept against the current revision. `olderRevisionOnly`: an older revision has results, which are not handed out. Not the same as a stored `pending` result. */
  | { readonly status: 'none'; readonly olderRevisionOnly: boolean }
  | {
      readonly status: 'current' | 'unverified';
      readonly conceptKey: string;
      readonly result: AlignmentResult;
      readonly coverage: AlignmentCoverageNote;
      readonly digests: AlignmentDigests;
      readonly provenance?: ScopeReaderProvenance;
      readonly stale: readonly string[];
    };

function viewOfAlignment(
  payload: AlignmentResultPayload,
  currentDigests: AlignmentCurrentDigests,
): Extract<AlignmentResultView, { status: 'current' | 'unverified' }> {
  const freshness = alignmentFreshness(payload, currentDigests);
  return {
    status: freshness.status,
    conceptKey: payload.conceptKey,
    result: payload.result,
    coverage: payload.coverage,
    digests: payload.digests,
    ...(payload.provenance !== undefined ? { provenance: payload.provenance } : {}),
    stale: freshness.status === 'unverified' ? freshness.stale : [],
  };
}

/** One concept's alignment result for the current revision, labelled current or unverified against the caller's digests. */
export function alignmentResultView(
  projection: ScopeReadingProjection,
  query: AlignmentQuery,
  currentDigests: AlignmentCurrentDigests,
): AlignmentResultView {
  const held = projection.alignments.get(
    alignmentResultKey(query.courseId, query.source, query.conceptKey),
  );
  if (held === undefined) {
    return {
      status: 'none',
      olderRevisionOnly: hasOtherRevision(
        projection.alignmentRevisions.get(
          JSON.stringify([query.courseId, query.source.documentKind, query.source.sourcePath]),
        ),
        query.source.revisionDigest,
      ),
    };
  }
  return viewOfAlignment(held.payload, currentDigests);
}

/** Every alignment result for one course's document at its current revision, in concept-key order. */
export function alignmentResultsForDocument(
  projection: ScopeReadingProjection,
  courseId: string,
  source: ScopeRevisionRef,
  currentDigests: AlignmentCurrentDigests,
): readonly Extract<AlignmentResultView, { status: 'current' | 'unverified' }>[] {
  const out: Extract<AlignmentResultView, { status: 'current' | 'unverified' }>[] = [];
  for (const { payload } of projection.alignments.values()) {
    if (
      payload.courseId === courseId &&
      payload.source.documentKind === source.documentKind &&
      payload.source.sourcePath === source.sourcePath &&
      payload.source.revisionDigest === source.revisionDigest
    ) {
      out.push(viewOfAlignment(payload, currentDigests));
    }
  }
  return out.sort((a, b) =>
    a.conceptKey < b.conceptKey ? -1 : a.conceptKey > b.conceptKey ? 1 : 0,
  );
}
