/**
 * How the unit manifest answers the retire-on-revision rule (`ol-egov.141.89.7.78`; `[D-531]`, ruled
 * B with completeness rules). The rule itself, and the interface this module feeds, are
 * `../../outcome/retire-on-revision.ts`'s; the fold that builds a version's page history is
 * `./projection.ts`'s `outcomeRevisionPagesOf`. Pure: no vault, no clock.
 *
 * **Each stored reading, mapped for the rule.** `[D-531]`: failed or unavailable pages never
 * establish absence. Only a page the reader went over in full counts as read, and only a page that
 * was read and found to hold no text needs no extraction:
 *
 * | Stored reading (`./types.ts`)                       | For the rule        | Why |
 * | --------------------------------------------------- | ------------------- | --- |
 * | `read`, by `text-layer`, `image` or `text-and-image` | `read`              | Read in full; settles once its outcomes are extracted. |
 * | `unreadable: blank-page`                            | `nothing-to-read`   | Read, and nothing is on the page. |
 * | `unreadable: no-text-on-page`                       | `nothing-to-read`   | Read, and no text is on the page (the text layer's furniture-only page lands here too). |
 * | `unreadable: not-legible`                           | `not-read`          | The reading could not make the page out; it may state outcomes. |
 * | `partial`                                           | `not-read`          | Read only in part; the rest may state outcomes. |
 * | `pending` (`queued`, `budget`)                      | `not-read`          | Waiting: never read. |
 * | `unavailable`                                       | `not-read`          | An outage: retried, never a verdict about the page. |
 * | `failed` (any reason, retryable or not)             | `not-read`          | Never read; a failure is not an empty page. |
 * | no state record (an enumerated page nothing read)   | absent from history | The rule treats a page with no state as not read. |
 *
 * This is the same line `./manifest.ts#isFullyRead` draws for reading (read, or unreadable as
 * `blank-page`/`no-text-on-page`), with one more condition the rule adds on top: a `read` page
 * settles only once its outcomes were extracted under the version.
 */

import type { OutcomePageReading } from '../../outcome/retire-on-revision.js';
import type { UnitReadingState } from './types.js';

/** One stored reading, as the retire rule reads it (module doc, the table). */
export function outcomePageReadingOf(state: UnitReadingState): OutcomePageReading {
  switch (state.kind) {
    case 'read':
      return 'read';
    case 'unreadable':
      return state.reason === 'blank-page' || state.reason === 'no-text-on-page'
        ? 'nothing-to-read'
        : 'not-read';
    case 'partial':
    case 'pending':
    case 'unavailable':
    case 'failed':
      return 'not-read';
  }
}
