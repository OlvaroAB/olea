/**
 * Writes an accepted retrospective into her vault as an Olea-owned note
 * (F8.8, `[D-134]` Q5/Q7: "on acceptance it is written into her vault as a
 * note — an offer accepted, never a silent write (`[D-097]`), and the
 * note's existence is the durable generated-record"). INV-6, absolute: this
 * writes only under `.olea/`, never into anything she authored — same
 * convention `review-log/content-store.ts`'s `.olea/content/`,
 * `generation/cache-store.ts`'s `.olea/drafts/` and `review-log/path.ts`'s
 * `.olea/reviews/` already use.
 *
 * **A plain markdown note, not a JSON content record.**
 * `review-log/content-store.ts`'s `ContentStoreRecord` is a different, more
 * specific kind of generated content (explain-back feedback text, keyed by
 * `contentId`) — its shape does not fit a multi-section reading with three
 * groupings and an overlay, and `[D-097]`'s "written into her vault as a
 * note" reads most naturally as a note she could open and read, not a JSON
 * blob. This module writes markdown directly via `VaultSource.write`,
 * matching `.olea/content/`'s folder convention without reusing its schema.
 *
 * **Never modified after acceptance.** Each call writes a NEW file, named by
 * the assessment path and the moment of acceptance — a retrospective read
 * once and accepted is a record of what she saw then, not a live view that
 * could silently change under her (`C6.2a`'s "immutable" argument for
 * generated content, applied here without importing that module's own
 * write-once enforcement, which is scoped to its own record shape). There is
 * no update/append export in this module — the only way to add words to a
 * kept retrospective is a fresh acceptance, which is a new file.
 *
 * **F8.8 free text (Sep 2026, `[D-190]`).** `ownWords`, when supplied and
 * non-blank, is written verbatim into this SAME note beneath its own
 * heading (`OWN_WORDS_SECTION_HEADING`) — not a second file, not a separate
 * record. `undefined` or blank means nothing is added; this module never
 * invents a placeholder section for an empty line. Nothing downstream reads
 * this section back: it is dead text to every reader in this codebase by
 * construction (grep `RETROSPECTIVE_NOTES_FOLDER`/`OWN_WORDS_SECTION_HEADING`
 * — `note-writer.ts` is the only writer, and no module parses the notes this
 * writes). It is likewise never passed to `../review-log` or any event —
 * `retrospective/offer-events.ts`'s appended records carry only `kind`,
 * `assessmentPath` and `timestamp` (D-005: counts, never content), and this
 * module's own caller (`provider.ts`'s `acceptToVault`) hands `ownWords`
 * only to this file, never to a log.
 */

import type { RetrospectiveReading, VaultPath, VaultSource } from 'olea-core';
import {
  CARRIES_SECTION_HEADING,
  carriesLine,
  conceptLine,
  FADED_SECTION_HEADING,
  HELD_SECTION_HEADING,
  HONESTY_DISCLAIMER,
  OWN_WORDS_SECTION_HEADING,
  RETROSPECTIVE_VIEW_TITLE,
  scopeFactLine,
  scopeOriginLine,
  tooEarlyCountLine,
} from './copy.js';

/** `.olea/` per INV-6 — Olea-owned artifacts only, matching every other generated-content folder in this plugin. */
export const RETROSPECTIVE_NOTES_FOLDER = '.olea/retrospectives';

function slugify(input: string): string {
  return input
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/**
 * Vault-relative path for one accepted retrospective. `acceptedAt` (an
 * ISO-8601 instant) is part of the filename so accepting the SAME
 * assessment's retrospective twice — a real path, since it stays reachable
 * from the course afterward (D-134 Q7) and nothing forbids opening it again
 * — never overwrites the earlier record.
 */
export function retrospectiveNotePath(assessmentPath: VaultPath, acceptedAt: string): VaultPath {
  const acceptedSlug = acceptedAt.replace(/[:.]/g, '-');
  return `${RETROSPECTIVE_NOTES_FOLDER}/${slugify(assessmentPath)}--${acceptedSlug}.md`;
}

/** The note's markdown body — pure, so it is assertable without a vault. */
export function buildRetrospectiveNoteContent(
  reading: RetrospectiveReading,
  acceptedAt: string,
  ownWords?: string,
): string {
  const lines: string[] = [];
  lines.push(`# ${RETROSPECTIVE_VIEW_TITLE}: ${reading.course}`);
  lines.push('');
  lines.push(scopeFactLine(reading));
  lines.push(scopeOriginLine(reading.scopeOrigin));
  lines.push('');
  lines.push(HONESTY_DISCLAIMER);
  lines.push('');

  lines.push(`## ${HELD_SECTION_HEADING}`);
  if (reading.held.length === 0) {
    lines.push('None yet.');
  } else {
    for (const line of reading.held) lines.push(`- ${conceptLine(line)}`);
  }
  lines.push('');

  lines.push(`## ${FADED_SECTION_HEADING}`);
  if (reading.faded.length === 0) {
    lines.push('None.');
  } else {
    for (const line of reading.faded) lines.push(`- ${conceptLine(line)}`);
  }
  lines.push('');

  const tooEarly = tooEarlyCountLine(reading);
  if (tooEarly !== null) {
    lines.push(tooEarly);
    lines.push('');
  }

  if (reading.carries.length > 0) {
    lines.push(`## ${CARRIES_SECTION_HEADING}`);
    for (const line of reading.carries) lines.push(`- ${carriesLine(line)}`);
    lines.push('');
  }

  // `[D-190]`: her own line, if she added one, under its own heading — never
  // invented for a blank/undefined value, and always the last content before
  // the immutability footer, so it reads as an addition to the reading
  // rather than a fourth grouping among the computed ones above.
  const trimmedOwnWords = ownWords?.trim();
  if (trimmedOwnWords !== undefined && trimmedOwnWords !== '') {
    lines.push(`## ${OWN_WORDS_SECTION_HEADING}`);
    lines.push(trimmedOwnWords);
    lines.push('');
  }

  lines.push(`*Accepted ${acceptedAt}. This note is Olea-generated and is never edited in place.*`);
  lines.push('');
  return lines.join('\n');
}

/**
 * Writes the note. Never overwrites — `VaultSource.write` will happily
 * modify an existing path, but `retrospectiveNotePath`'s per-acceptance
 * timestamp already makes a collision vanishingly unlikely; this function
 * still does not special-case it, matching `content-store.ts`'s own
 * "write-once, no read-modify-write dance" posture for generated records.
 */
export async function writeRetrospectiveNote(
  vault: VaultSource,
  reading: RetrospectiveReading,
  now: () => Date = () => new Date(),
  ownWords?: string,
): Promise<VaultPath> {
  const acceptedAt = now().toISOString();
  const path = retrospectiveNotePath(reading.assessmentPath, acceptedAt);
  await vault.write(path, buildRetrospectiveNoteContent(reading, acceptedAt, ownWords));
  return path;
}
