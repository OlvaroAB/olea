/**
 * The term check's host lookup (`ol-egov.141.89.8.59`; D-465, `ol-egov.141.89.1.64`): the concept
 * names of a transcript's teaching event, taken from the OTHER members of its lecture bundle (the
 * slides) and the notes that linked them. A candidate term discrepancy is a spoken word nearly
 * matching one of these names. Pure; nothing is stored: bundles and the per-source concept names
 * are handed in fresh each call. A path in no bundle has no terms.
 */
import type { LectureBundle, VaultPath } from 'olea-core';

export function lectureTermsLookup(deps: {
  readonly bundles: () => readonly LectureBundle[];
  readonly conceptNamesBySource: () => ReadonlyMap<VaultPath, readonly string[]>;
  readonly isTranscript: (path: VaultPath) => boolean;
}): (path: VaultPath) => readonly string[] | undefined {
  return (path) => {
    const bundle = deps.bundles().find((b) => b.members.includes(path) || b.via.includes(path));
    if (bundle === undefined) return undefined;
    const names = deps.conceptNamesBySource();
    const terms = new Set<string>();
    for (const other of [...bundle.members, ...bundle.via]) {
      if (other === path || deps.isTranscript(other)) continue;
      for (const name of names.get(other) ?? []) terms.add(name);
    }
    return terms.size > 0 ? [...terms] : undefined;
  };
}
