/**
 * F7.4's settings-pane copy (`ol-p6t01`) — every string the "Export &
 * delete your data" section shows her, kept here so it can be tested for
 * honesty (same posture `settings/degradation-statement.ts` and
 * `settings/token-field-copy.ts` already take) without needing a live
 * Obsidian host. `settings-section.ts` only wires these into `Setting`
 * calls; nothing about their wording lives there.
 */

export const PRIVACY_SECTION_HEADING = 'Export & delete your data';

export const PRIVACY_SECTION_INTRO =
  'Olea keeps your review history, misconception history and a local cache ' +
  'on this device and inside your vault (never on the server beyond a small ' +
  'per-device connection record). You can export what Olea holds, or delete ' +
  'all of it, at any time.';

export const EXPORT_BUTTON_LABEL = 'Export my data';

export const EXPORT_DESCRIPTION =
  'Bundles your full review history, misconception history and every ' +
  'practice card Olea can find in your notes into one file you can save. ' +
  'Nothing is sent anywhere — the bundle is built and saved on this device.';

/** Shown once the export has been written, naming nothing about *where* — the settings section fills that in, since only it knows the real save path/dialog outcome. */
export const EXPORT_DONE_MESSAGE = 'Export complete.';

export const DELETE_BUTTON_LABEL_IDLE = 'Delete everything';

/** The two-stage confirm: pressing once arms it, pressing again (within the same render) does it. Never a silent single click for something this permanent. */
export const DELETE_BUTTON_LABEL_CONFIRMING = 'Click again to permanently delete';

export const DELETE_DESCRIPTION =
  'Permanently removes your local cache, your review history, your ' +
  'misconception history, and your connection record on the server. This ' +
  'cannot be undone. Your notes and any cards you wrote yourself are never ' +
  'touched — only what Olea itself created.';

export const DELETE_DONE_MESSAGE = 'Everything Olea kept has been deleted.';

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
