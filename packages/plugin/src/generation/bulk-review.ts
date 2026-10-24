/**
 * `BulkReviewController` — F3.3's bulk-review triage path (`ol-jie3`):
 * "a bulk-review path remains available for a student who would rather clear
 * a document's drafts in one sitting; it is the same action at a second
 * density, never a second mental model."
 *
 * Obsidian-free by construction, the same split `review/session.ts` and
 * `retrieval/draft-cards-controller.ts` already use: the DENSITY here is new
 * (a list, grouped by document, not a full-tab one-item-at-a-time flow), the
 * VERDICT MACHINERY is not. Every accept/edit/reject call below reaches the
 * exact same `DraftAcceptPort` (`generation/accept.ts`) that
 * `review/session.ts` calls at first presentation — this module composes no
 * new domain logic, never imports `materialize-mcq.ts` or `olea-core`'s
 * review-log writer, and cannot bypass `accept.ts`'s own idempotence guard
 * because it never writes a verdict except through that port
 * (`bulk-review.spec.ts` asserts the import boundary directly, not just the
 * behaviour).
 *
 * **Grouped by source document (F3.3's own phrasing — "a document's
 * drafts").** `DraftCacheStore.listPending()` returns every pending draft
 * across every course; `buildBulkReviewGroups` groups them by `sourcePath`
 * so a document with many drafts reads as one list she can clear "in one
 * sitting", and a document with a single draft still shows on its own.
 *
 * **`acceptRemainder` is the batch action `ol-p3t07a`'s own acceptance
 * criteria names** ("clearing 40 drafts from one deck must take minutes"):
 * one call, one group, every still-pending item the list shows for it accepted through the
 * same `accept()` this controller already exposes per item — sequentially,
 * not in parallel, so two accepts in the same group never race
 * `cache-store.ts`'s shared `index.json` write within one process (that
 * module's own doc discloses the CROSS-DEVICE version of this race as
 * out of scope; a same-process, sequential caller does not need it closed).
 * One item's write failing does not stop the rest — the result names exactly
 * which ids succeeded and which did not, so a re-run only touches what is
 * still pending.
 *
 * **Keyboard bindings landed (`[D-216]` / `ol-egov.105`).** Move down the
 * list, keep, fix and bin are now real key bindings, resolved by
 * `bulk-review-keymap.ts`'s `resolveBulkReviewKey` and hinted on screen by
 * `bulk-review-view.ts` — the "click-only this round, disclosed (`ol-uxk9`)"
 * caveat this doc used to carry no longer applies. This controller itself
 * stays input-agnostic: `accept`/`editBeforeSaving`/`reject` are the same
 * three methods a click or a key both resolve to, so nothing about this
 * file changed to make the keys work.
 */

import type { DraftAcceptPort } from './accept.js';
import {
  type DeclaredMadeBy,
  type SourceMarkerOrigin,
  sourceMarkerOrigin,
  sourceMarkerText,
} from './bulk-review-copy.js';
import type { DraftCacheStore } from './cache-store.js';
import { basenameWithoutExtension } from './review-adapter.js';
import type { DraftQuestion, DraftRecord } from './types.js';

/**
 * `[D-626]`/`[D-628]` (functional scope F3.3, "The origin named is the note the draft was actually
 * drawn from"; vocabulary registry §34): what a clearing row shows as where a draft came from.
 *  - `line`: a draft drawn from one note — the source line naming that note (`sourceMarkerText`, in
 *    the register its kind and her declaration give). A draft recorded before input notes were keeps
 *    the line its citation gave.
 *  - `sources`: a draft drawn from several notes — the "Sources" label, expanding to one link per
 *    note with the note's title. No one of them is shown as the sole source.
 */
export type BulkReviewOrigin =
  | { readonly kind: 'line'; readonly text: string }
  | {
      readonly kind: 'sources';
      readonly notes: readonly { readonly path: string; readonly title: string }[];
    };

/**
 * The slice of `review/ports.ts`'s `EditPort` this controller actually
 * needs. Kept as its own narrow, structural port — the same "a plain object
 * can satisfy it in tests" reasoning `commands/types.ts`'s `CommandRegistrar`
 * and `review/ports.ts`'s own `NoteExistsPort` already use — rather than
 * requiring a full `ReviewInstrument` (course code, concept ids, options…)
 * just to open a note. `review/obsidian-ports.ts`'s real
 * `createObsidianEditPort(app)` satisfies this structurally, with no
 * adapter: it only ever reads `sourcePath` and `blockId` off whatever it is
 * given.
 */
export interface BulkReviewEditPort {
  edit(instrument: { readonly sourcePath: string; readonly blockId: string | null }): Promise<void>;
}

export interface BulkReviewItemViewModel {
  readonly draftId: string;
  readonly stem: string;
  readonly conceptName: string;
  readonly createdAt: string;
  /**
   * `[D-216]`'s click-through target: `DraftRecord.conceptIds` carried
   * through unchanged so `bulk-review-view.ts` can open the same
   * `REGISTRY_ENTRY_ACTION` affordance `review/view.ts` opens by
   * `instrumentId` — a still-pending draft has no `instrumentId` yet (that
   * only exists once accepted), so the row opens by concept key instead.
   * Every real F3.3 draft carries exactly one (`types.ts`'s own doc on the
   * field), never empty (`isDraftRecord` rejects an empty array).
   */
  readonly conceptIds: readonly string[];
  /**
   * `[STY-0e]` (`ol-l5og.18.5`): carried through from `DraftRecord.question`
   * unchanged so `bulk-review-view.ts` can show the drafted item's own
   * answer alongside its distractor pool — the same content the accepted
   * instrument would show at first presentation, just visible up front
   * here rather than behind a reveal, because the clearing row's whole
   * point is judging a claim before it lands (F3.3). A quiz draft
   * (`DraftQuestion`, from `draftQuizCardsForConcept`) carries its distractor
   * pool; a card draft (`DraftCardContent`, `ol-egov.141.89.105.6`) carries
   * its back here and an empty `distractors`, and the view renders the back
   * beneath the front with no pool and no "correct" mark (`[D-555]`).
   */
  readonly correctAnswer: string;
  readonly distractors: readonly string[];
  /**
   * `[D-555]` (`ol-egov.141.89.105.6`): which kind this row is. `'mcq'` rows are as above. A
   * `'qa'` row is a question-and-answer card draft: `stem` carries its front, `correctAnswer`
   * its back (shown beneath the front, with no "correct" mark) and `distractors` is empty.
   */
  readonly itemType: 'mcq' | 'qa';
  /**
   * `[D-628]`: this draft's own origin, present only when the drafts of its group do not all share
   * one (the group's `origin` is then absent), so no draft is shown a note it was not drawn from.
   */
  readonly origin?: BulkReviewOrigin;
}

export interface BulkReviewGroupViewModel {
  readonly sourcePath: string;
  readonly noteTitle: string;
  readonly courseCode: string;
  /**
   * `[D-214]` / `ol-ymew`: which register the row's source marker renders
   * in — `'reading'` (`[D-216]`'s original case) or `'authored-note'`
   * (a note she wrote herself). Derived once per group, from the group's
   * oldest item's `sourceCitation`, by `bulk-review-copy.ts`'s
   * `sourceMarkerOrigin` — the honest, construction-guaranteed signal that
   * module's own doc explains, never a bare filename guess made here.
   */
  readonly sourceMarkerOrigin: SourceMarkerOrigin;
  /**
   * The title `bulk-review-view.ts` passes to `sourceMarkerText` alongside
   * `sourceMarkerOrigin` above. Equal to `noteTitle` for `'reading'`
   * (unchanged from `[D-216]`). For `'authored-note'`, this is HER note's
   * own title — derived from `sourceCitation.sourcePath`, never from
   * `noteTitle`, which for this origin names the Olea-created, "(Olea)"-
   * suffixed sibling home note (`generation/home-note.ts`'s
   * `homeNotePathForSource`) that the draft actually materializes into.
   * Pointing at the sibling's internal bookkeeping name would leak Olea's
   * own naming convention into a sentence that is supposed to name the note
   * she wrote.
   */
  readonly sourceMarkerNoteTitle: string;
  /**
   * `[D-628]` (`ol-egov.141.89.2.39`): the origin every draft in this group shares, shown once for
   * the group — the source line for one note, the "Sources" list for several. Absent when the
   * drafts' origins differ; each item then carries its own (`BulkReviewItemViewModel.origin`).
   */
  readonly origin?: BulkReviewOrigin;
  readonly items: readonly BulkReviewItemViewModel[];
}

export interface BulkReviewViewModel {
  readonly groups: readonly BulkReviewGroupViewModel[];
}

export interface BulkReviewAcceptRemainderResult {
  readonly accepted: readonly string[];
  readonly failed: readonly { readonly draftId: string; readonly error: unknown }[];
}

/**
 * `ol-egov.141.89.105.6`: a draft the list shows. A pending quiz draft (`question`) or a pending
 * question-and-answer card draft (`card`, `[D-555]`); a record carrying neither cannot be
 * rendered and is not listed. `acceptRemainder` filters by this same predicate, so "Accept the
 * rest" accepts exactly the drafts the list shows.
 */
function isListablePending(r: DraftRecord): boolean {
  if (r.status !== 'pending') return false;
  return r.instrumentType === 'qa' ? r.card !== undefined : r.question !== undefined;
}

function toItemViewModel(r: DraftRecord): BulkReviewItemViewModel {
  const base = {
    draftId: r.draftId,
    conceptName: r.conceptName,
    createdAt: r.createdAt,
    conceptIds: r.conceptIds,
  };
  if (r.instrumentType === 'qa' && r.card !== undefined) {
    return {
      ...base,
      stem: r.card.front,
      correctAnswer: r.card.back,
      distractors: [],
      itemType: 'qa',
    };
  }
  // `isListablePending` guarantees `question` for every non-card record that reaches here.
  const question = r.question as DraftQuestion;
  return {
    ...base,
    stem: question.stem,
    correctAnswer: question.correctAnswer,
    distractors: question.distractors,
    itemType: 'mcq',
  };
}

/**
 * Groups still-`pending` records by `sourcePath`. Both groups and the items
 * within each group are ordered oldest-first (`createdAt`), so the document
 * — and the draft within it — she has been waiting on longest reads first.
 * Filters defensively on `status === 'pending'` even though every real
 * caller already passes `listPending()`'s own output, so this function's own
 * contract does not silently depend on its one caller's discipline
 * (`bulk-review.spec.ts` exercises it directly with a mixed-status input).
 */
export function buildBulkReviewGroups(
  records: readonly DraftRecord[],
  madeByFor?: BulkReviewMadeByLookup,
): readonly BulkReviewGroupViewModel[] {
  const pending = records.filter(isListablePending);
  const bySourcePath = new Map<string, DraftRecord[]>();
  for (const record of pending) {
    const list = bySourcePath.get(record.sourcePath) ?? [];
    list.push(record);
    bySourcePath.set(record.sourcePath, list);
  }

  const groups: BulkReviewGroupViewModel[] = [];
  for (const [sourcePath, items] of bySourcePath) {
    const sorted = [...items].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    const first = sorted[0];
    if (first === undefined) continue; // unreachable — bySourcePath never holds an empty list
    const noteTitle = basenameWithoutExtension(sourcePath);
    // `[D-214]` / `ol-ymew`: the register and title of the group's oldest item's source line, the
    // same "first" convention `courseCode` above already uses for a per-group aggregate — see
    // `sourceMarkerOrigin`'s own doc for why this is a construction-guaranteed signal, not a
    // filename guess. `[D-626]`: for a draft drawn from one note, that note.
    const marker = sourceMarkerOf(first, noteTitle, madeByFor);
    // `[D-628]`: each draft's origin; shown once for the group when every draft shares it, and per
    // draft otherwise.
    const origins = sorted.map((record) => draftOrigin(record, noteTitle, madeByFor));
    const shared = origins.every((origin) => originKey(origin) === originKey(origins[0]));
    groups.push({
      sourcePath,
      noteTitle,
      courseCode: first.courseCode,
      sourceMarkerOrigin: marker.origin,
      sourceMarkerNoteTitle: marker.noteTitle,
      ...(shared && origins[0] !== undefined ? { origin: origins[0] } : {}),
      items: sorted.map((record, index) => {
        const item = toItemViewModel(record);
        const origin = origins[index];
        return shared || origin === undefined ? item : { ...item, origin };
      }),
    });
  }

  groups.sort((a, b) => {
    const aFirst = a.items[0]?.createdAt ?? '';
    const bFirst = b.items[0]?.createdAt ?? '';
    return aFirst.localeCompare(bFirst);
  });
  return groups;
}

/**
 * The register and title of one draft's source line (`[D-214]`, `[D-216]`, `[D-489]`). A draft drawn
 * from one note names that note (`[D-626]`); otherwise its citation decides, as it always did: a
 * note's own title for the two note registers, and the group's note title for a reading.
 */
function sourceMarkerOf(
  record: DraftRecord,
  groupNoteTitle: string,
  madeByFor: BulkReviewMadeByLookup | undefined,
): { readonly origin: SourceMarkerOrigin; readonly noteTitle: string } {
  const only = record.inputNotes?.length === 1 ? record.inputNotes[0] : undefined;
  if (only !== undefined) {
    return {
      origin: sourceMarkerOrigin(only.path, madeByFor?.(only.path)),
      noteTitle: basenameWithoutExtension(only.path),
    };
  }
  const citationPath = record.sourceCitation?.sourcePath;
  const origin = sourceMarkerOrigin(
    citationPath,
    citationPath === undefined ? undefined : madeByFor?.(citationPath),
  );
  return {
    origin,
    noteTitle:
      origin !== 'reading' && citationPath !== undefined
        ? basenameWithoutExtension(citationPath)
        : groupNoteTitle,
  };
}

/**
 * `[D-626]`/`[D-628]`: one draft's origin — the "Sources" list when it was drawn from several notes
 * (in the order they were recorded, which is retrieval order), otherwise its source line.
 */
function draftOrigin(
  record: DraftRecord,
  groupNoteTitle: string,
  madeByFor: BulkReviewMadeByLookup | undefined,
): BulkReviewOrigin {
  const notes = record.inputNotes;
  if (notes !== undefined && notes.length > 1) {
    return {
      kind: 'sources',
      notes: notes.map((note) => ({ path: note.path, title: basenameWithoutExtension(note.path) })),
    };
  }
  const marker = sourceMarkerOf(record, groupNoteTitle, madeByFor);
  return { kind: 'line', text: sourceMarkerText(marker.noteTitle, marker.origin) };
}

/** Two origins are one when they show the same line, or list the same notes (in any order). */
function originKey(origin: BulkReviewOrigin | undefined): string {
  if (origin === undefined) return '';
  if (origin.kind === 'line') return `line\u0000${origin.text}`;
  return `sources\u0000${[...origin.notes.map((note) => note.path)].sort().join('\u0000')}`;
}

/**
 * Her `made-by` declaration for a note path (core's `parseMadeBy` over cached frontmatter), or
 * `undefined` when undeclared or invalid. `[D-489]`: only `'me'` lets the source line say she wrote it.
 */
export type BulkReviewMadeByLookup = (notePath: string) => DeclaredMadeBy | undefined;

export interface BulkReviewControllerDeps {
  /** Omitted, every note she keeps reads "From your notes" (no declaration known). */
  readonly madeByFor?: BulkReviewMadeByLookup;
  /**
   * `[D-626]`/`[D-628]` (`ol-egov.141.89.2.39`): whether a pending draft may be shown — every note it
   * was drawn from still reads as it did when drafted (`input-notes.ts`'s `draftInputNotesHold`,
   * which reads a draft recorded before input notes were as not established). A draft it refuses is
   * withheld from the list, as it is from a review session. Omitted (a test, the workbench), every
   * pending draft is listed; accepting one still goes through the same guard (`accept.ts`).
   */
  readonly holds?: (record: DraftRecord) => Promise<boolean>;
  readonly cache: DraftCacheStore;
  readonly acceptPort: DraftAcceptPort;
  readonly editPort: BulkReviewEditPort;
}

/**
 * The list-density session object `bulk-review-view.ts` renders and
 * mutates — same "logic tested, DOM glue untested" split `review/session.ts`
 * and `review/view.ts` already use for first-presentation review.
 */
export class BulkReviewController {
  private records: DraftRecord[] = [];

  constructor(private readonly deps: BulkReviewControllerDeps) {}

  /**
   * Reads every pending draft fresh from the cache. Call once before
   * rendering — mirrors `ReviewSession.start`'s one-read-then-mutate-in-place
   * shape, so a document's drafts read as they are *now*, not as they were
   * when the tab first opened.
   */
  async load(): Promise<void> {
    const pending = await this.deps.cache.listPending();
    const holds = this.deps.holds;
    if (holds === undefined) {
      this.records = [...pending];
      return;
    }
    const shown = await Promise.all(
      pending.map(async (record) => {
        try {
          return await holds(record);
        } catch {
          return false;
        }
      }),
    );
    this.records = pending.filter((_, index) => shown[index] === true);
  }

  getViewModel(): BulkReviewViewModel {
    return { groups: buildBulkReviewGroups(this.records, this.deps.madeByFor) };
  }

  private removeLocal(draftId: string): void {
    this.records = this.records.filter((r) => r.draftId !== draftId);
  }

  /**
   * Accepts exactly as `review/session.ts`'s `rate`/`mcqAnswer` do at first
   * presentation — same port, same verdict, same materialization. Idempotent
   * against a re-call (double click, a retried render): `DraftAcceptPort`
   * itself no-ops past an already-resolved draft, and this only ever removes
   * a matching local record, which a second call finds already gone.
   */
  async accept(draftId: string): Promise<void> {
    await this.deps.acceptPort.accept(draftId, 'accepted');
    this.removeLocal(draftId);
  }

  /**
   * F3.3/`[D-097]`'s "edit before saving", at bulk density: materializes
   * with verdict `'edited'` (the same call `review/session.ts`'s
   * `acceptEditDraft` makes), then opens the note it just landed in through
   * `editPort` — one tap, no queue, matching the first-presentation
   * guarantee exactly.
   */
  async editBeforeSaving(draftId: string): Promise<void> {
    const record = this.records.find((r) => r.draftId === draftId);
    await this.deps.acceptPort.accept(draftId, 'edited');
    this.removeLocal(draftId);
    // `record` is only absent if the view is acting on an id it never loaded
    // (a bug elsewhere, not a real triage flow) — resolved regardless, but
    // there is nothing to open a note for.
    if (record !== undefined) {
      await this.deps.editPort.edit({ sourcePath: record.sourcePath, blockId: null });
    }
  }

  /** F3.3's "reject prunes" — same port, same no-vault-write guarantee as first-presentation reject. */
  async reject(draftId: string): Promise<void> {
    await this.deps.acceptPort.reject(draftId);
    this.removeLocal(draftId);
  }

  /**
   * `ol-p3t07a`'s own acceptance bar ("clearing 40 drafts from one deck must
   * take minutes"): accepts every still-pending item in `sourcePath`'s
   * group, sequentially, through the same `accept()` above. One failure does
   * not stop the rest.
   */
  async acceptRemainder(sourcePath: string): Promise<BulkReviewAcceptRemainderResult> {
    const draftIds = this.records
      .filter((r) => r.sourcePath === sourcePath && isListablePending(r))
      .map((r) => r.draftId);

    const accepted: string[] = [];
    const failed: { draftId: string; error: unknown }[] = [];
    for (const draftId of draftIds) {
      try {
        await this.accept(draftId);
        accepted.push(draftId);
      } catch (error) {
        failed.push({ draftId, error });
      }
    }
    return { accepted, failed };
  }
}

export function createBulkReviewController(deps: BulkReviewControllerDeps): BulkReviewController {
  return new BulkReviewController(deps);
}
