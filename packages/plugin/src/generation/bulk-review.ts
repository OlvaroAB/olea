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
 * one call, one group, every still-pending item in it accepted through the
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
import { type SourceMarkerOrigin, sourceMarkerOrigin } from './bulk-review-copy.js';
import type { DraftCacheStore } from './cache-store.js';
import { basenameWithoutExtension } from './review-adapter.js';
import type { DraftRecord } from './types.js';

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
): readonly BulkReviewGroupViewModel[] {
  const pending = records.filter((r) => r.status === 'pending');
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
    // `[D-214]` / `ol-ymew`: origin is derived from the group's oldest
    // item's citation, the same "first" convention `courseCode` above
    // already uses for a per-group aggregate — see `sourceMarkerOrigin`'s
    // own doc for why this is a construction-guaranteed signal, not a
    // filename guess.
    const origin = sourceMarkerOrigin(first.sourceCitation?.sourcePath);
    const sourceMarkerNoteTitle =
      origin === 'authored-note' && first.sourceCitation !== undefined
        ? basenameWithoutExtension(first.sourceCitation.sourcePath)
        : noteTitle;
    groups.push({
      sourcePath,
      noteTitle,
      courseCode: first.courseCode,
      sourceMarkerOrigin: origin,
      sourceMarkerNoteTitle,
      items: sorted.map((r) => ({
        draftId: r.draftId,
        stem: r.question.stem,
        conceptName: r.conceptName,
        createdAt: r.createdAt,
        conceptIds: r.conceptIds,
      })),
    });
  }

  groups.sort((a, b) => {
    const aFirst = a.items[0]?.createdAt ?? '';
    const bFirst = b.items[0]?.createdAt ?? '';
    return aFirst.localeCompare(bFirst);
  });
  return groups;
}

export interface BulkReviewControllerDeps {
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
    this.records = [...(await this.deps.cache.listPending())];
  }

  getViewModel(): BulkReviewViewModel {
    return { groups: buildBulkReviewGroups(this.records) };
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
    const draftIds = this.records.filter((r) => r.sourcePath === sourcePath).map((r) => r.draftId);

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
