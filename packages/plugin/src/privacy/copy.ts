/**
 * F7.4's settings-pane copy (`ol-p6t01`) — every string the "Export &
 * delete your data" section shows her, kept here so it can be tested for
 * honesty (same posture `settings/degradation-statement.ts` and
 * `settings/token-field-copy.ts` already take) without needing a live
 * Obsidian host. `settings-section.ts` only wires these into `Setting`
 * calls; nothing about their wording lives there.
 */

export const PRIVACY_SECTION_HEADING = 'Export & delete your data';

// `[COPY PASS PENDING — ol-egov.141.8.7]` Class B: PRIVACY_SECTION_INTRO, EXPORT_DESCRIPTION and
// DELETE_DESCRIPTION below were widened to name every file Olea itself writes in the vault
// (C6.2a: the whole `.olea/` layer is Olea's own), not only the review and misconception logs
// this section originally described. Written to be true today, without a voice-charter pass
// (`docs/Olea_vocabulary_registry.md` §9) yet. Deliberately NOT claimed: which `data.json`
// settings keys a full delete clears beyond the five cache keys and the device id — that list
// (grove ground streaks, registry overrides, home avoidance among others) is unchanged by this
// bead and is an open decision (see this bead's report); nothing below says "everything" about
// settings, only about the vault-side records and the one server-side connection record.

export const PRIVACY_SECTION_INTRO =
  'Olea keeps everything it writes about your studying — your review history, your ' +
  'misconception history, and every other record it derives from your notes — on this device ' +
  'and inside your vault, plus a small local cache and a connection record on the server. You ' +
  'can export what Olea holds, or delete all of it, at any time.';

export const EXPORT_BUTTON_LABEL = 'Export my data';

export const EXPORT_DESCRIPTION =
  'Bundles your full review history, misconception history, every practice card Olea can find ' +
  'in your notes, and every other record Olea has written for you into one file you can save. ' +
  'Nothing is sent anywhere — the bundle is built and saved on this device.';

/** Shown once the export has been written, naming nothing about *where* — the settings section fills that in, since only it knows the real save path/dialog outcome. */
export const EXPORT_DONE_MESSAGE = 'Export complete.';

export const DELETE_BUTTON_LABEL_IDLE = 'Delete everything';

/** The two-stage confirm: pressing once arms it, pressing again (within the same render) does it. Never a silent single click for something this permanent. */
export const DELETE_BUTTON_LABEL_CONFIRMING = 'Click again to permanently delete';

export const DELETE_DESCRIPTION =
  'Permanently removes your local cache, your review history, your misconception history, ' +
  "every other record in Olea's own folder in your vault, and your connection record on the " +
  'server. This cannot be undone. Your notes and any cards you wrote yourself are never ' +
  'touched — only what Olea itself created.';

export const DELETE_DONE_MESSAGE = "Olea's own files, history and cache have been deleted.";

/**
 * `[COPY PASS PENDING — ol-egov.141.8.7]` Class B: this string, and
 * `deleteCompletionMessage`'s choice of when to show it, are new with the
 * widened full delete (every `.olea/` folder, not only the two logs) and
 * have not yet had a voice-charter pass (`docs/Olea_vocabulary_registry.md`
 * section 9). Written to be honest today — fact plus one available action,
 * no apology performed — not to be the final wording.
 */
export function deletePartialMessage(remainingOleaPathCount: number): string {
  const noun = remainingOleaPathCount === 1 ? 'file' : 'files';
  return (
    `Olea could not remove ${remainingOleaPathCount} of its own ${noun}. ` +
    'Everything else it found was deleted; try Delete everything again.'
  );
}

/**
 * `settings-section.ts` shows `DELETE_DONE_MESSAGE` unconditionally before
 * this bead — true only when the widened full delete's own
 * `remainingOleaPaths` (`full-delete.ts`) actually reads empty. Pulled out
 * as a pure function of that count, not written inline in
 * `settings-section.ts`, because that file needs a real Obsidian host
 * (`Setting`/`createEl`/`Notice`) to exercise at all — see its module doc —
 * and this decision is exactly the kind of logic this folder keeps testable
 * without one.
 */
export function deleteCompletionMessage(remainingOleaPathCount: number): string {
  return remainingOleaPathCount > 0
    ? deletePartialMessage(remainingOleaPathCount)
    : DELETE_DONE_MESSAGE;
}

/**
 * The two button states this section's confirm flow can be in. Kept as a
 * type + a pure label function, not inlined in `settings-section.ts`, so
 * the confirm-then-execute contract (never execute on the first click) is
 * something a test can assert on directly.
 */
export type DeleteConfirmState = 'idle' | 'confirming';

export function deleteButtonLabel(state: DeleteConfirmState): string {
  return state === 'idle' ? DELETE_BUTTON_LABEL_IDLE : DELETE_BUTTON_LABEL_CONFIRMING;
}
