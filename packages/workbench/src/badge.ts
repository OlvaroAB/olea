/**
 * `renderSyntheticProvisionalBadge` — TB-0's cheap second half (`ol-opmb.6`,
 * discovered-from `ol-opmb.4`). Layer A (`olea-service`'s
 * `src/harness/thresholds.ts` branded type) and Layer B
 * (`scripts/check-threshold-provenance.mjs`) already make a number's
 * synthetic provenance structural and fail-closed on the harness side; this
 * is the UI half — a small badge on every workbench panel that renders a
 * number derived from a synthetic run, so a number read off a screen by
 * hand (the copy-by-hand leak shape both INV-3 leaks took) carries its own
 * provenance with it rather than depending on the reader remembering which
 * panel they were looking at.
 *
 * One shared component, one copy string, in the reporting voice this
 * project's own findings/run-report language uses ("measured fact" vs.
 * "inference") — never "fake" or "demo", which read as dismissive rather
 * than as a provenance fact.
 *
 * **Not every panel gets one.** A panel that renders only fixture TEXT —
 * markdown prose, a static label, a "no product view" notice — carries no
 * number to mislabel, so it stays undecorated; adding a badge there would
 * dilute what the badge means everywhere else. The call sites in `main.ts`
 * are exactly the panels already carrying a `wb-illustrative-label` (every
 * one of those exists BECAUSE the panel shows a number computed from
 * invented material) plus the registry surface's per-concept mastery
 * reading, which is F8.4's own synthetic-run number and carries no
 * illustrative label of its own.
 */

const SYNTHETIC_PROVISIONAL_TEXT = 'synthetic — provisional';

/** Stable hook for `e2e/badge.spec.ts` and any future visual check. */
export const SYNTHETIC_BADGE_SELECTOR = '[data-wb-synthetic-badge]';

/** Appends the badge as the last child of `container` — never replaces existing content. */
export function renderSyntheticProvisionalBadge(container: HTMLElement): HTMLElement {
  const badge = container.createSpan({
    cls: 'wb-synthetic-badge',
    text: SYNTHETIC_PROVISIONAL_TEXT,
  });
  badge.setAttr('data-wb-synthetic-badge', 'true');
  badge.setAttr(
    'title',
    'Computed from a synthetic run, not a measurement of the real product against real material.',
  );
  return badge;
}
