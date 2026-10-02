/**
 * Where a source passage came from, for the request field `sourceChunkOrigins`
 * (`ol-egov.141.89.8.56`, D-465; the contract is `olea-contracts`' `tasks.ts`).
 *
 * One home for the rule every request builder that sends `sourceChunks` applies, so the
 * seven source-reading tasks cannot drift apart:
 *  - a passage from a supplied lecture transcript gets `{ kind: 'transcript', speakerRole }`;
 *  - the role is read through `attributeTranscript`. A part carries no speaker label (parts are
 *    document-grain), so it is `unknown`; a label-bearing caller would get `lecturer` or
 *    `other-speaker` from the same function;
 *  - every other passage gets `null`;
 *  - when NO passage is a transcript the field is omitted entirely, so a request with no
 *    transcript is byte-identical to what it was before this field existed;
 *  - only a role ever travels: never a speaker name, a label or a path.
 *
 * Flags (`inaudible` and the rest) come from the reader and are not set here (T10,
 * `ol-egov.141.89.1.64`).
 *
 * "Is a transcript" is decided the way the reader decides it (`resolveTranscriptFormat`): a
 * `.txt` file (the formats this build can read) is one; a `.md` is one only when its cached frontmatter `role`
 * declares it, which needs the optional `host`. Without a host a `.md` reads as not a transcript
 * (today's request).
 */

import type { TranscriptSourceChunkOrigin, TranscriptSpeakerRole } from 'olea-contracts';
import {
  attributeTranscript,
  isTranscriptRole,
  resolveTranscriptFormat,
  type TranscriptSpeaker,
  type VaultPath,
} from 'olea-core';

/** The one method this file needs from the host's metadata cache (INV-1: no `obsidian` import). */
export interface SourceOriginFrontmatterHost {
  frontmatterFor(path: VaultPath): Record<string, unknown> | undefined;
}

export type SourceChunkOrigins = readonly (TranscriptSourceChunkOrigin | null)[];

const ROLE_BY_SPEAKER: Record<TranscriptSpeaker, TranscriptSpeakerRole> = {
  lecturer: 'lecturer',
  'student-or-question': 'other-speaker',
  'unknown-speaker': 'unknown',
};

/** Whether `path` is a supplied lecture transcript. Synchronous, from the path and cached frontmatter alone. */
export function isSuppliedTranscriptPath(
  path: string,
  host?: SourceOriginFrontmatterHost,
): boolean {
  const vaultPath = path as VaultPath;
  if (path.toLowerCase().endsWith('.md')) {
    const raw = host?.frontmatterFor(vaultPath)?.role;
    return typeof raw === 'string' && isTranscriptRole(raw);
  }
  return resolveTranscriptFormat(vaultPath).kind === 'transcript';
}

/** The origin of one passage: its transcript origin, or `null`. */
export function sourceChunkOriginOf(
  path: string,
  text: string,
  host?: SourceOriginFrontmatterHost,
): TranscriptSourceChunkOrigin | null {
  if (!isSuppliedTranscriptPath(path, host)) return null;
  const speaker = attributeTranscript([{ text }]).passages[0]?.speaker ?? 'unknown-speaker';
  return { kind: 'transcript', speakerRole: ROLE_BY_SPEAKER[speaker] };
}

/**
 * The aligned origins for a list of passages, or `undefined` when none is a transcript (the field
 * is then omitted so the request is unchanged).
 */
export function sourceChunkOriginsOf(
  passages: readonly { readonly path: string; readonly text: string }[],
  host?: SourceOriginFrontmatterHost,
): SourceChunkOrigins | undefined {
  const origins = passages.map((p) => sourceChunkOriginOf(p.path, p.text, host));
  return origins.some((o) => o !== null) ? origins : undefined;
}

/** `sourceChunkOriginsOf` as a spreadable fragment: `{}` or `{ sourceChunkOrigins }`. */
export function sourceChunkOriginsFragment(
  passages: readonly { readonly path: string; readonly text: string }[],
  host?: SourceOriginFrontmatterHost,
): { readonly sourceChunkOrigins?: SourceChunkOrigins } {
  const origins = sourceChunkOriginsOf(passages, host);
  return origins === undefined ? {} : { sourceChunkOrigins: origins };
}
