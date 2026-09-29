/**
 * `resolveAnchoredPassage` — the reading half of `[D-446]` option (a) (`ol-egov.141.89.5.32`):
 * where does the passage an instrument cites stand NOW, found by the shared segmentation rule
 * (`olea-core`'s `source/passage-identity.ts`) and never by guessing.
 *
 * ===========================================================================
 * WHAT THE BATCH PASS USED TO DO, AND WHAT THIS CHANGES
 * ===========================================================================
 * `citation-revision-wiring.ts` compared an instrument's WHOLE source note against the whole note
 * it last saw. So an edit anywhere in the note put every instrument citing it in front of the
 * judge, and a cited passage that merely MOVED asked the judge about a pair the targets do not
 * name (the two moved-passage cases of the change-detection development set ended unavailable,
 * with two judge calls each). For an instrument whose citation carries a passage digest, the
 * anchor now holds THE PASSAGE (its text, one segment of the note under the rule) and this
 * function says where that passage stands now. A note edited somewhere else, or the passage
 * moved, is decided here with no judge call; only a passage whose own words changed reaches the
 * judge, and it reaches it as a passage-to-passage pair.
 *
 * ===========================================================================
 * THE LADDER — first rung that answers wins
 * ===========================================================================
 * Scopes are the anchor's last-known note, then the note the citation names (deduplicated;
 * markdown only, present in the vault). Everything is compared under the anchor's own rule
 * version, on the passage text the anchor already holds (no digest is recomputed per segment).
 *  1. EXACT in a scope: exactly one segment with the same normalised text is `present` (a
 *     whitespace-only difference is refreshed silently by the caller); two or more is
 *     `ambiguous` — the same text stands twice and which one was cited cannot be told.
 *  2. CANONICAL in a scope (`canonicalizeForMateriality`: markup and emphasis only): exactly one is
 *     `present`, and the caller treats it as the formatting-only exit; two or more is ambiguous.
 *  3. EXACT elsewhere in the vault: exactly one is `relocated` (`[D-093]`: an exact match elsewhere
 *     heals the citation silently, no judge); two or more is ambiguous.
 *  4. RESEMBLING in a scope: the passage's words were edited. It is identified only if exactly ONE
 *     segment of the same shape resembles it at all (at least the `[D-093]` near-match floor of its
 *     words survive); then it is `present` and the caller judges old against new. Two or more
 *     resemble it: ambiguous, not chosen between.
 *  5. RESEMBLING elsewhere: the same test across the vault; exactly one is a `proposal` (a re-bind
 *     she confirms, never applied on Olea's authority); more than one is ambiguous.
 *  6. Otherwise `missing`.
 * The ruling's own qualification holds throughout: a digest, and this ladder, will not identify
 * every edited passage, and whatever they cannot identify is left `unresolved` with its reason.
 *
 * ===========================================================================
 * RULE VERSIONS
 * ===========================================================================
 * An anchor keeps working under the rule version its digest names while that version stays
 * registered. If it has been retired, the passage is re-found under the current rule from the text
 * the anchor holds — accepted only on a clean exact, canonical or relocated answer, and re-seated
 * on the current version by the caller; anything less is `unresolved` as `rule-unsupported`.
 */

import {
  CURRENT_PASSAGE_RULE,
  currentPassageRule,
  locatePassageByText,
  PASSAGE_RESEMBLANCE_FLOOR,
  PASSAGE_RULES,
  type PassageRule,
  type PassageSegment,
  parsePassageDigest,
  passageRecall,
  type RelocationCandidate,
  type VaultPath,
} from 'olea-core';
import { canonicalizeForMateriality } from './canonical.js';

/** What the resolver needs of the vault; the tick supplies its per-pass, cached reads. */
export interface PassageNotes {
  exists(path: VaultPath): Promise<boolean>;
  /** The note's material: its text with instrument blocks stripped. May throw; an unreadable note is skipped. */
  material(path: VaultPath): Promise<string>;
  /** Every markdown note that may hold a moved passage (Olea's own `.olea/` layer excluded). */
  markdownPaths(): Promise<readonly VaultPath[]>;
}

export interface AnchoredPassage {
  /** The passage text the anchor holds (a segment's raw text). */
  readonly text: string;
  /** The anchor's versioned digest (`p<version>:...`). */
  readonly passageDigest: string;
  /** Where the anchor last saw the passage. */
  readonly anchorPath: VaultPath;
  /** The note the citation itself names (may equal `anchorPath`). */
  readonly citedPath: VaultPath;
}

export type UnresolvedPassageReason = 'missing' | 'ambiguous' | 'rule-unsupported';

export type PassageResolution =
  | {
      readonly kind: 'present';
      readonly sourcePath: VaultPath;
      readonly text: string;
      readonly via: 'exact' | 'canonical' | 'resembling';
      readonly rule: PassageRule;
    }
  | {
      readonly kind: 'relocated';
      readonly sourcePath: VaultPath;
      readonly text: string;
      readonly rule: PassageRule;
    }
  | { readonly kind: 'proposal'; readonly candidate: RelocationCandidate }
  | { readonly kind: 'unresolved'; readonly reason: UnresolvedPassageReason };

interface Located {
  readonly path: VaultPath;
  readonly segment: PassageSegment;
}

function isMarkdownPath(path: VaultPath): boolean {
  return path.toLowerCase().endsWith('.md');
}

function lineCountOf(text: string): number {
  return text.split(/\r\n|\r|\n/).filter((line) => line.trim() !== '').length;
}

/** A single-line passage is compared with single lines; a longer one with whole blocks. Headings and code never stand in for prose. */
function sameShape(oldLineCount: number, candidate: PassageSegment): boolean {
  if (candidate.kind !== 'text') return false;
  return oldLineCount <= 1 ? candidate.lineCount === 1 : candidate.level === 'block';
}

async function segmentsOf(
  notes: PassageNotes,
  path: VaultPath,
  rule: PassageRule,
): Promise<readonly PassageSegment[] | undefined> {
  try {
    return rule.segment(await notes.material(path));
  } catch {
    return undefined;
  }
}

export async function resolveAnchoredPassage(
  anchored: AnchoredPassage,
  notes: PassageNotes,
  rules: readonly PassageRule[] = PASSAGE_RULES,
): Promise<PassageResolution> {
  const digestRule = (() => {
    const parsed = parsePassageDigest(anchored.passageDigest);
    return parsed === null ? undefined : rules.find((rule) => rule.version === parsed.version);
  })();
  const rule = digestRule ?? currentPassageRule(rules.length > 0 ? rules : [CURRENT_PASSAGE_RULE]);
  const retired = digestRule === undefined;

  const normalised = rule.normalise(anchored.text);
  const canonical = canonicalizeForMateriality(anchored.text);
  const oldLineCount = lineCountOf(anchored.text);

  // A retired version is only trusted on a clean answer (see the module doc).
  const settle = (resolution: PassageResolution): PassageResolution => {
    if (!retired) return resolution;
    if (resolution.kind === 'present' && resolution.via === 'resembling') {
      return { kind: 'unresolved', reason: 'rule-unsupported' };
    }
    if (resolution.kind === 'proposal') return { kind: 'unresolved', reason: 'rule-unsupported' };
    if (resolution.kind === 'unresolved') return { kind: 'unresolved', reason: 'rule-unsupported' };
    return resolution;
  };

  const scopePaths: VaultPath[] = [];
  for (const path of [anchored.anchorPath, anchored.citedPath]) {
    if (scopePaths.includes(path) || !isMarkdownPath(path)) continue;
    if (await notes.exists(path)) scopePaths.push(path);
  }
  const scopeSegments = new Map<VaultPath, readonly PassageSegment[]>();
  for (const path of scopePaths) {
    const segments = await segmentsOf(notes, path, rule);
    if (segments !== undefined) scopeSegments.set(path, segments);
  }

  // 1. exact in a scope — the first scope with any match decides.
  for (const [path, segments] of scopeSegments) {
    const found = locatePassageByText(segments, normalised);
    if (found.status === 'unique') {
      return settle({
        kind: 'present',
        sourcePath: path,
        text: found.segment.text,
        via: 'exact',
        rule,
      });
    }
    if (found.status === 'ambiguous') return settle({ kind: 'unresolved', reason: 'ambiguous' });
  }

  // 2. canonical in a scope — formatting-only.
  for (const [path, segments] of scopeSegments) {
    const matches = segments.filter(
      (segment) => canonicalizeForMateriality(segment.text) === canonical,
    );
    if (matches.length === 1 && matches[0] !== undefined) {
      return settle({
        kind: 'present',
        sourcePath: path,
        text: matches[0].text,
        via: 'canonical',
        rule,
      });
    }
    if (matches.length > 1) return settle({ kind: 'unresolved', reason: 'ambiguous' });
  }

  // 3. exact elsewhere — heal silently when unique.
  const otherSegments = new Map<VaultPath, readonly PassageSegment[]>();
  for (const path of await notes.markdownPaths()) {
    if (scopeSegments.has(path)) continue;
    const segments = await segmentsOf(notes, path, rule);
    if (segments !== undefined) otherSegments.set(path, segments);
  }
  const elsewhere: Located[] = [];
  for (const [path, segments] of otherSegments) {
    for (const segment of segments) {
      if (segment.normalised === normalised) elsewhere.push({ path, segment });
    }
  }
  if (elsewhere.length === 1 && elsewhere[0] !== undefined) {
    return settle({
      kind: 'relocated',
      sourcePath: elsewhere[0].path,
      text: elsewhere[0].segment.text,
      rule,
    });
  }
  if (elsewhere.length > 1) return settle({ kind: 'unresolved', reason: 'ambiguous' });

  // 4. resembling in a scope — an edited passage, identified only when nothing else resembles it.
  const resembling = (segment: PassageSegment): boolean =>
    sameShape(oldLineCount, segment) &&
    passageRecall(normalised, segment.normalised) >= PASSAGE_RESEMBLANCE_FLOOR;
  const inScope: Located[] = [];
  for (const [path, segments] of scopeSegments) {
    for (const segment of segments) if (resembling(segment)) inScope.push({ path, segment });
  }
  if (inScope.length === 1 && inScope[0] !== undefined) {
    return settle({
      kind: 'present',
      sourcePath: inScope[0].path,
      text: inScope[0].segment.text,
      via: 'resembling',
      rule,
    });
  }
  if (inScope.length > 1) return settle({ kind: 'unresolved', reason: 'ambiguous' });

  // 5. resembling elsewhere — a proposal to re-bind, never applied here.
  const nearElsewhere: Located[] = [];
  for (const [path, segments] of otherSegments) {
    for (const segment of segments) if (resembling(segment)) nearElsewhere.push({ path, segment });
  }
  if (nearElsewhere.length === 1 && nearElsewhere[0] !== undefined) {
    const { path, segment } = nearElsewhere[0];
    return settle({
      kind: 'proposal',
      candidate: {
        anchor: {
          sourcePath: path,
          location: { page: 1, charRange: { start: segment.start, end: segment.end } },
        },
        text: segment.text,
      },
    });
  }
  if (nearElsewhere.length > 1) return settle({ kind: 'unresolved', reason: 'ambiguous' });

  // 6. nothing.
  return settle({ kind: 'unresolved', reason: 'missing' });
}
