/**
 * M3 — principle-12 framing for misconceptions ("information and
 * consequence, never verdict"). The single site display strings for a
 * `MisconceptionRecord` come from, the same enforcement mechanism
 * `../mastery/display.ts` uses for F2.11: a view that wants to surface a
 * misconception imports from here, and a view that writes its own sentence
 * instead is visibly doing something this module already does.
 *
 * The two example lines are §4.1's own, verbatim:
 *   ✓ "This one keeps coming back — worth ten minutes with the source."
 *   ✗ "You keep getting this wrong."
 * The design brief (`docs/design/pass3-explainback-sprig/BRIEF.md` in
 * `olea-service`) adds the resolved-state instruction this module also
 * encodes: "quietly earned, not celebratory."
 */

import type { MisconceptionRecord } from './types.js';

/**
 * Phrase fragments this module's own strings must never contain — the
 * mechanical half of M3. `framing.spec.ts` asserts every string this file
 * exports is free of these (case-insensitive), so a future edit that drifts
 * toward a verdict fails a test rather than shipping. This is a floor, not a
 * substitute for the review §4.1 asks for — it catches the literal forbidden
 * example and its closest paraphrases, not every possible verdict-y sentence.
 */
export const FORBIDDEN_VERDICT_PHRASES: readonly string[] = [
  'you keep getting this wrong',
  "you're wrong",
  'you are wrong',
  'you failed',
  'you always',
  'you never',
];

/** Active: a misconception currently believed, first or recurring occurrence. */
function activeLine(record: MisconceptionRecord): string {
  return record.occurrenceCount > 1
    ? 'This one keeps coming back — worth ten minutes with the source.'
    : "Worth a look — here's what the source actually says.";
}

/** Fading: evidenced progress toward correct understanding (M2), not yet confirmed. */
function fadingLine(): string {
  return "You're getting closer on this one.";
}

/** Resolved: quietly earned, not celebratory (design brief). No fanfare, no score. */
function resolvedLine(): string {
  return 'This one settled — no need to revisit unless it resurfaces.';
}

/**
 * The information-and-consequence line for a record's current status.
 * Never a verdict on her (principle 12): every branch describes the
 * evidence, not a judgement of her.
 */
export function misconceptionFramingLine(record: MisconceptionRecord): string {
  switch (record.status) {
    case 'active':
      return activeLine(record);
    case 'fading':
      return fadingLine();
    case 'resolved':
      return resolvedLine();
    default: {
      // Exhaustiveness guard — a new MisconceptionStatus must extend the
      // switch above, not fall through to a default.
      const exhaustive: never = record.status;
      throw new Error(`misconceptionFramingLine: unhandled status ${String(exhaustive)}`);
    }
  }
}
