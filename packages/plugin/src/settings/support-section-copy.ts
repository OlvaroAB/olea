/**
 * The settings pane's "Support" section copy — F7.5's other half, the
 * **in-app feedback path** (`ol-p6t02`). The "Copy diagnostics" command
 * (`../commands/diagnostics.ts`, F7.5/Q6.3) is the error-reporting half;
 * this is where "how do I actually tell someone something's wrong" gets an
 * answer instead of being invented ad hoc per bug report.
 *
 * **The link is real, not a placeholder.** `REPORT_ISSUE_URL` points at this
 * plugin's own repository (`git remote -v` in this workspace: `origin
 * https://github.com/OlvaroAB/olea.git`) — public but deliberately
 * not community-listed (A2.6), which does not affect whether its issue
 * tracker works. No new support channel is invented; this reuses the one
 * that already exists for the alpha's single user.
 *
 * Kept as plain strings, not JSX/markup, same reasoning as every other
 * `*-copy.ts` in this folder: `settings-tab.ts` renders these with
 * Obsidian's own `Setting`/`createEl` calls, which need a live DOM this
 * file does not.
 */

export const SUPPORT_SECTION_HEADING = 'Support';

export const SUPPORT_SECTION_INTRO =
  'Olea is alpha software. If something looks wrong, run "Olea: Copy diagnostics" from the command palette first — it copies a content-free snapshot of your environment (versions, index size, queue depth) to help tell an Olea problem apart from a conflict with another plugin — then paste it into your report below.';

export const REPORT_ISSUE_BUTTON_LABEL = 'Report an issue';

export const REPORT_ISSUE_URL = 'https://github.com/OlvaroAB/olea/issues';
