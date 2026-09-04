/**
 * `seedSimulatorDrafts` — a populated bulk-review state for the simulator
 * (`ol-3ux7.64.19` [WBX-19], the ruling half of the simulator's rich-states
 * work: `docs/dev/simulator-design.md` §6-§7).
 *
 * **The gap this closes.** `BulkReviewView` (`../../../plugin/src/
 * generation/bulk-review-view.js`) reads `DraftCacheStore.listPending()`
 * (`../../../plugin/src/generation/cache-store.js`), which only ever fills
 * from a real F3.3 generation sweep against the Worker — something no
 * simulator world runs automatically. Every world's bulk-review golden
 * therefore showed the same empty state ("Nothing here to review right
 * now.") regardless of world or week, and the surface's own visual chrome
 * has never been exercised against real content.
 *
 * **No invented surface.** This module writes directly into
 * `DRAFT_CACHE_FOLDER` (`.olea/drafts/`) using the EXACT per-record-file-plus-
 * index shape `cache-store.ts` already reads — the same "same storage the
 * real flow writes to" posture `controller.ts`'s `seedSimulatorWorkerConfig`/
 * `seedSimulatorStudyPlanConfig` already take for other settings. Nothing
 * here is a new mechanism `BulkReviewView` does not already know how to
 * read; a viewer who accepts, edits or rejects a seeded draft exercises the
 * real F3.3 accept/edit/reject flow against a real (if seeded) record.
 *
 * **Content-blind, world-shape-agnostic — no vocabulary hardcoded.**
 * Rather than special-casing the fixture vault's nested `01 Courses/<code>/
 * WEEK N/` shape against the persona vaults' flat `01 Courses/<code>/
 * <concept>.md` shape, this scans whatever `05 Zettelkasten/` and
 * `01 Courses/` actually contain: a Zettelkasten note's title is a
 * candidate concept name, and the first course note whose text VERBATIM,
 * word-bounded mentions that title (case-insensitive) — the exact match
 * rule `../../../core/src/tier3-evidence/build.js`'s `findMentionedTerms`
 * already uses for the identical "does this material actually discuss this
 * concept" question — is where the seeded draft is said to come from. A
 * vault with no Zettelkasten notes, or none mentioned anywhere under
 * `01 Courses/`, yields zero candidates and this module writes nothing —
 * the honest "nothing to seed" case, never a fabricated one.
 *
 * **The concept key.** `DraftRecord.conceptIds` must be non-empty
 * (`isDraftRecord`'s own guard) and is used only for the bulk-review row's
 * optional "peek at the source" click-through
 * (`bulk-review-view.ts`'s `conceptIds[0]`) — nothing else in the accept/
 * edit/reject flow depends on it matching what a live read would mint. This
 * module computes the SAME provisional derivation production code does
 * (`provisionalConceptKey`, `olea-core`) from the matched Zettelkasten
 * path, so a seeded draft's peek target is the real note a live read would
 * also resolve to, not a placeholder string.
 *
 * Called once per fresh vault — `SimulatorController.create()` and again
 * from `reset()`, mirroring `seedPersonaHistoryIfNeeded`'s "first open or
 * after Reset" timing — never on an ordinary day-advance remount, so a
 * viewer's own accept/edit/reject decisions during a session are never
 * overwritten by a second seeding pass.
 */

import {
  DEFAULT_COURSES_FOLDER,
  provisionalConceptKey,
  type VaultPath,
  type VaultSource,
} from 'olea-core';
import { DRAFT_CACHE_FOLDER } from '../../../plugin/src/generation/cache-store.js';
import type { DraftRecord } from '../../../plugin/src/generation/types.js';

/** Mirrors `packages/core/src/concept/zettelkasten.ts`'s `DEFAULT_ZETTELKASTEN_FOLDER` — not re-exported from `olea-core`'s package root, so restated here rather than reached into that file's internals. */
const ZETTELKASTEN_FOLDER: VaultPath = '05 Zettelkasten';

const INDEX_PATH: VaultPath = `${DRAFT_CACHE_FOLDER}/index.json`;

/** At most this many drafts are seeded, across however many courses have a match — a populated list, not a flood. */
const MAX_SEEDED_DRAFTS = 4;

export interface DraftSeedCandidate {
  readonly conceptName: string;
  readonly zettelPath: VaultPath;
  readonly sourcePath: VaultPath;
  readonly courseCode: string;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** The course code segment right after `01 Courses/` — `01 Courses/GEOL204/WEEK 1/x.md` -> `GEOL204`, matching `concept/course.ts#courseFromPath`'s own convention. */
function courseCodeFromCoursePath(path: VaultPath): string | undefined {
  const prefix = `${DEFAULT_COURSES_FOLDER}/`;
  if (!path.startsWith(prefix)) return undefined;
  const rest = path.slice(prefix.length);
  const slash = rest.indexOf('/');
  return slash === -1 ? rest : rest.slice(0, slash);
}

function titleFromZettelPath(path: VaultPath): string {
  const name = path.slice(path.lastIndexOf('/') + 1);
  return name.endsWith('.md') ? name.slice(0, -3) : name;
}

/**
 * Every (concept, course note) pair this vault can honestly support a
 * seeded draft for — see this module's own doc for the matching rule.
 * Deterministic given the vault's own content: sorted by Zettelkasten path,
 * then by the first matching course note path, so two runs against the
 * same vault produce the same candidates in the same order.
 */
export async function discoverDraftSeedCandidates(
  vault: Pick<VaultSource, 'list' | 'read'>,
): Promise<readonly DraftSeedCandidate[]> {
  const zettelPaths = [...(await vault.list({ under: ZETTELKASTEN_FOLDER, extensions: ['md'] }))]
    .slice()
    .sort();
  if (zettelPaths.length === 0) return [];

  const coursePaths = [...(await vault.list({ under: DEFAULT_COURSES_FOLDER, extensions: ['md'] }))]
    .slice()
    .sort();
  if (coursePaths.length === 0) return [];

  const courseContents = new Map<VaultPath, string>();
  for (const path of coursePaths) {
    courseContents.set(path, await vault.read(path));
  }

  const candidates: DraftSeedCandidate[] = [];
  for (const zettelPath of zettelPaths) {
    const conceptName = titleFromZettelPath(zettelPath);
    if (conceptName === '') continue;
    const pattern = new RegExp(`\\b${escapeRegExp(conceptName)}\\b`, 'i');
    const matchedCoursePath = coursePaths.find((path) => {
      const text = courseContents.get(path);
      return text !== undefined && pattern.test(text);
    });
    if (matchedCoursePath === undefined) continue;
    const courseCode = courseCodeFromCoursePath(matchedCoursePath);
    if (courseCode === undefined) continue;
    candidates.push({ conceptName, zettelPath, sourcePath: matchedCoursePath, courseCode });
  }
  return candidates;
}

/** Builds one pending `DraftRecord` for a candidate — a generic Q&A stem, never her own wording (INV-3: this runs over the fixture and persona vaults only). */
function buildSeedDraftRecord(
  candidate: DraftSeedCandidate,
  index: number,
  createdAtIso: string,
): DraftRecord {
  const conceptKey = provisionalConceptKey({
    name: candidate.conceptName,
    boundNotePath: candidate.zettelPath,
  });
  return {
    draftId: `sim-seed-draft-${index}`,
    status: 'pending',
    courseCode: candidate.courseCode,
    conceptName: candidate.conceptName,
    conceptIds: [conceptKey],
    sourcePath: candidate.sourcePath,
    createdAt: createdAtIso,
    question: {
      stem: `Which statement best describes ${candidate.conceptName}?`,
      correctAnswer: `It is one of this course's own concepts.`,
      distractors: [
        `It is unrelated to ${candidate.courseCode}.`,
        `It is a scheduling detail, not a concept.`,
      ],
      feedback: `${candidate.conceptName} is discussed in ${candidate.sourcePath}.`,
    },
    provenance: {
      taskId: 'sim-seed',
      promptVersion: 'v0',
      modelId: 'simulator-seed',
    },
    firstServedAt: null,
  };
}

/**
 * Discovers candidates and writes `.olea/drafts/index.json` plus one
 * `.olea/drafts/<draftId>.json` per seeded draft, in the exact shape
 * `cache-store.ts`'s `DraftCacheStore` already reads. A no-op (writes
 * nothing) when {@link discoverDraftSeedCandidates} finds no candidate —
 * the honest empty case, never a fabricated one.
 */
export async function seedSimulatorDrafts(
  vault: Pick<VaultSource, 'list' | 'read' | 'write'>,
  now: () => Date = () => new Date(),
): Promise<number> {
  const candidates = (await discoverDraftSeedCandidates(vault)).slice(0, MAX_SEEDED_DRAFTS);
  if (candidates.length === 0) return 0;

  const createdAtIso = now().toISOString();
  const records = candidates.map((candidate, index) =>
    buildSeedDraftRecord(candidate, index, createdAtIso),
  );

  for (const record of records) {
    await vault.write(
      `${DRAFT_CACHE_FOLDER}/${record.draftId}.json`,
      `${JSON.stringify(record, null, 2)}\n`,
    );
  }

  const index = {
    version: 1 as const,
    entries: records.map((r) => ({
      draftId: r.draftId,
      courseCode: r.courseCode,
      conceptName: r.conceptName,
      status: r.status,
    })),
  };
  await vault.write(INDEX_PATH, `${JSON.stringify(index, null, 2)}\n`);

  return records.length;
}
