/**
 * A synthetic note corpus: bodies over the coined vocabulary, and what a
 * tier-3 pass would have reported about the sources behind it
 * (`olea-service`'s `ol-opmb.1` [TB-1]).
 *
 * ## What this derives, and from what
 *
 * `buildGapView` needs two things this package has never produced before:
 * `ConceptMaterialPresence` (what her notes and instruments hold, per
 * concept) and `CoverageScope` (what a tier-3 pass actually managed to read).
 * Both are built here from literal, inspectable data — a handful of
 * `SyntheticNote`s and `SourceCoverage` rows — the same "declared, not
 * discovered" shortcut `curriculum.ts` takes and for the identical reason:
 * this package has no vault to run a real extractor against.
 *
 * `buildMaterialPresence` (`olea-core`'s `gap/build.js`) is reused rather
 * than re-implemented — it is a pure fold over `ConceptRecord[]` plus an
 * instrument count map, and this module's whole job is to supply those two
 * inputs honestly, not to duplicate the fold.
 *
 * ## Which concept gets which gap class, and why
 *
 * `curriculum.ts` ranks four `COURSE_VANTREL` concepts. This module's
 * material map is deliberately uneven across them, so `buildGapView`
 * produces one row of each of the contract's three classes without any
 * per-row special-casing downstream:
 *
 *  - `melspar` — a note, two instruments reachable from it → `mastery-gap`
 *    (F4.3): her material names it, cards exist.
 *  - `dornith` — a note, zero instruments → `coverage-gap` (F4.5): named,
 *    nothing to drill yet, the draft affordance is safe here.
 *  - `kelvane` — **absent from `NOTES` entirely**, despite being ranked by
 *    `curriculum.ts` → `material-gap` (F4.10): the assessment evidence names
 *    it, her material does not. `oracle-scenarios.ts` asserts this row never
 *    carries `'draft-cards'`.
 *  - `tirasp` — a note, one instrument → a second `mastery-gap`, so the view
 *    is never a single instance of a class away from looking hand-picked.
 *
 * ## The deliberately imperfect read (`ol-cvsc`), and its sibling (`ol-jji7` / FP5)
 *
 * `SOURCE_COVERAGE` (the `'mixed'` variant, and `buildCorpus`'s default)
 * always includes one `'unreadable'` row and one `'read-yielded-nothing'` row
 * alongside two ordinary `'read'` ones, so
 * `summariseCoverageScope(...).canStateExhaustiveness` is `false` by
 * construction — the false-reassurance case `ol-cvsc` exists for, on screen
 * rather than only in a unit test.
 *
 * That same construction made the OTHER branch of the exhaustiveness claim —
 * `canStateExhaustiveness: true`, `coverageClosingLine`'s reassuring text —
 * undemonstrated anywhere in this workbench (`ol-opmb.5` [TB-4]'s FP5
 * finding, `ol-jji7`): with the mixed variant as the only corpus, no
 * persona on any day could ever read every source cleanly. `SOURCE_COVERAGE_ALL_READ`
 * and `buildCorpus`'s `'all-read'` variant are that demonstration — the same
 * two past papers plus the lecture notes, none of the two problematic rows —
 * so the positive branch has somewhere to render. The mixed variant stays the
 * default and stays exactly as imperfect as before: this adds a second scope,
 * it does not soften the first.
 *
 * ## INV-3 and N-015
 *
 * Note bodies below are template scaffolding around already-vetted
 * vocabulary tokens (`melspar`, `dornith`, …) — generic connective English
 * ("notes on", "appears in", "see also"), never a real academic sentence, per
 * the parent bead's explicit rejection of that mitigation (an embedding model
 * has no real geometry over invented tokens regardless, so writing real prose
 * would only reintroduce the constituent-word collision risk `vocabulary.ts`
 * exists to avoid, for no compensating benefit). Nothing here is a quality
 * corpus and nothing may be scored as one (N-015; see the parent bead's
 * `SyntheticRunReport` type, which has no field this data could fill in).
 */

import {
  buildMaterialPresence,
  type ConceptMaterialPresence,
  type ConceptRecord,
  conceptRecordSize,
  type SourceCoverage,
  type VaultPath,
} from 'olea-core';
import { CONCEPT_DORNITH, CONCEPT_KELVANE, CONCEPT_MELSPAR, CONCEPT_TIRASP } from './curriculum.js';
import { SYNTHETIC_ID_PREFIX } from './provenance.js';
import { COURSE_VANTREL } from './vocabulary.js';

/** One synthetic note — a body over the coined vocabulary, never real prose. See the module doc. */
export interface SyntheticNote {
  readonly path: VaultPath;
  readonly conceptName: string;
  readonly body: string;
  /** Instruments reachable from this note — `dornith`'s is `0` on purpose (coverage-gap). */
  readonly instrumentCount: number;
}

const NOTE_PATH = (token: string): VaultPath => `${SYNTHETIC_ID_PREFIX}note:${token}`;

/**
 * `kelvane` is deliberately absent — ranked by `curriculum.ts`, named by no
 * note here, which is exactly F4.10's material-gap case: the assessment
 * evidence names a concept her material does not.
 */
export const NOTES: readonly SyntheticNote[] = [
  {
    path: NOTE_PATH('melspar'),
    conceptName: CONCEPT_MELSPAR,
    body: 'Notes on melspar. melspar appears across several vantrel sources and relates to dornith.',
    instrumentCount: 2,
  },
  {
    path: NOTE_PATH('dornith'),
    conceptName: CONCEPT_DORNITH,
    body: 'Notes on dornith. dornith is named here but nothing has been reviewed from it yet.',
    instrumentCount: 0,
  },
  {
    path: NOTE_PATH('tirasp'),
    conceptName: CONCEPT_TIRASP,
    body: 'Notes on tirasp. tirasp is covered in outline form; see also melspar.',
    instrumentCount: 1,
  },
];

/** Past-paper and course-material sources a tier-3 pass would have reported on. See the module doc. */
const SOURCE_PAPER_1: VaultPath = `${SYNTHETIC_ID_PREFIX}source:vantrel:past-paper-1`;
const SOURCE_PAPER_2: VaultPath = `${SYNTHETIC_ID_PREFIX}source:vantrel:past-paper-2`;
const SOURCE_LECTURE_NOTES: VaultPath = `${SYNTHETIC_ID_PREFIX}source:vantrel:lecture-notes`;
const SOURCE_APPENDIX_SCAN: VaultPath = `${SYNTHETIC_ID_PREFIX}source:vantrel:appendix-scan`;
const SOURCE_HANDOUT: VaultPath = `${SYNTHETIC_ID_PREFIX}source:quorbin:handout`;

const PAPER_1_ROW: SourceCoverage = {
  sourcePath: SOURCE_PAPER_1,
  kinds: ['registered-file'],
  role: 'past-paper',
  format: 'pdf',
  duplicateSourcePaths: [],
  courses: [COURSE_VANTREL],
  outcome: 'extracted',
  pages: 5,
  units: 12,
  citations: 3,
  limitations: [],
};

const PAPER_2_ROW: SourceCoverage = {
  sourcePath: SOURCE_PAPER_2,
  kinds: ['registered-file'],
  role: 'past-paper',
  format: 'pdf',
  duplicateSourcePaths: [],
  courses: [COURSE_VANTREL],
  outcome: 'extracted',
  pages: 4,
  units: 9,
  citations: 3,
  limitations: [],
};

const LECTURE_NOTES_ROW: SourceCoverage = {
  sourcePath: SOURCE_LECTURE_NOTES,
  kinds: ['embedded-file'],
  role: 'course-material',
  format: null,
  duplicateSourcePaths: [],
  courses: [COURSE_VANTREL],
  outcome: null,
  pages: 0,
  units: 0,
  citations: 0,
  limitations: [],
};

/** The `ol-cvsc` case: reached, and could not be read. Must never look like a clean zero — see `olea-core`'s `gap/coverage.ts` module doc. Present only in the `'mixed'` variant. */
const APPENDIX_SCAN_ROW: SourceCoverage = {
  sourcePath: SOURCE_APPENDIX_SCAN,
  kinds: ['embedded-file'],
  role: 'course-material',
  format: 'image',
  duplicateSourcePaths: [],
  courses: [COURSE_VANTREL],
  outcome: 'unreadable',
  pages: 0,
  units: 0,
  citations: 0,
  limitations: [],
};

/** Read successfully; there was nothing in it. A different state from 'unreadable' and must not collapse into it. Present only in the `'mixed'` variant. */
const HANDOUT_ROW: SourceCoverage = {
  sourcePath: SOURCE_HANDOUT,
  kinds: ['registered-file'],
  role: 'course-material',
  format: 'pdf',
  duplicateSourcePaths: [],
  courses: ['syn:course:quorbin'],
  outcome: 'empty-document',
  pages: 3,
  units: 0,
  citations: 0,
  limitations: [],
};

/**
 * Five rows, one per `SourceReadState` (`olea-core`'s `gap/coverage.js`) —
 * `'read'` (×2), `'read-yielded-nothing'`, `'unreadable'` — plus the
 * lecture-notes row, so `canStateExhaustiveness` is always `false`. See the
 * module doc.
 */
export const SOURCE_COVERAGE: readonly SourceCoverage[] = [
  PAPER_1_ROW,
  PAPER_2_ROW,
  LECTURE_NOTES_ROW,
  APPENDIX_SCAN_ROW,
  HANDOUT_ROW,
];

/**
 * The same three cleanly-read rows from `SOURCE_COVERAGE`, with the
 * deliberately-unreadable and deliberately-empty rows left out —
 * `canStateExhaustiveness` is always `true` here (`ol-jji7` / FP5). See the
 * module doc's "sibling" section for why this exists alongside
 * `SOURCE_COVERAGE` rather than instead of it.
 */
export const SOURCE_COVERAGE_ALL_READ: readonly SourceCoverage[] = [
  PAPER_1_ROW,
  PAPER_2_ROW,
  LECTURE_NOTES_ROW,
];

/**
 * Human-presentable form of a coined source path (WBF-1, `ol-mxw3`) — same
 * discipline as `vocabulary.ts`'s `conceptDisplayName`/`courseDisplayName`:
 * every word here is already one of this module's own vetted tokens
 * (`vantrel`, `quorbin`) or the same ordinary structural English
 * (`past-paper`, `lecture-notes`, …) `curriculum.ts`'s module doc already
 * uses without a fresh zero-hit check. Declared literally rather than
 * derived from the path string, for the same "declared, not discovered"
 * reason the rest of this corpus is — five fixed sources, five fixed labels.
 *
 * `GapView`'s coverage section renders `CoverageScopeSource.sourcePath`
 * verbatim (`packages/plugin/src/gap/copy.ts`'s `scopeSourceLine`), so this
 * is the same class of leak `conceptDisplayName`/`courseDisplayName` fix —
 * see `packages/workbench/src/oracle/display-names.ts`, which is where this
 * gets applied, same as those two.
 */
const SOURCE_DISPLAY_NAMES: ReadonlyMap<VaultPath, string> = new Map([
  [SOURCE_PAPER_1, 'Vantrel: past paper 1'],
  [SOURCE_PAPER_2, 'Vantrel: past paper 2'],
  [SOURCE_LECTURE_NOTES, 'Vantrel: lecture notes'],
  [SOURCE_APPENDIX_SCAN, 'Vantrel: appendix scan'],
  [SOURCE_HANDOUT, 'Quorbin: handout'],
]);

/** `syn:source:vantrel:past-paper-1` → `'Vantrel: past paper 1'`. Throws on a path this module did not mint, same discipline as `conceptDisplayName`/`courseDisplayName`. */
export function sourceDisplayName(path: VaultPath): string {
  const name = SOURCE_DISPLAY_NAMES.get(path);
  if (name === undefined) {
    throw new Error(
      `olea-synthetic: sourceDisplayName called with an unknown source path: ${path}`,
    );
  }
  return name;
}

export interface SyntheticCorpus {
  readonly notes: readonly SyntheticNote[];
  readonly materialPresence: ReadonlyMap<string, ConceptMaterialPresence>;
  readonly sourceCoverage: readonly SourceCoverage[];
}

/**
 * Which `sourceCoverage` a built corpus carries. `'mixed'` (the default,
 * unchanged from before `ol-jji7`) is the deliberately-imperfect read
 * `ol-cvsc` exists to exercise; `'all-read'` is `SOURCE_COVERAGE_ALL_READ` —
 * the demonstration this bead adds. `notes`/`materialPresence` do not vary by
 * variant: only what a tier-3 pass is said to have read does.
 */
export type CorpusVariant = 'mixed' | 'all-read';

/**
 * The whole corpus, deterministic and unseeded — same discipline as
 * `curriculum.ts`'s `buildCurriculum`. `variant` defaults to `'mixed'`, so
 * every existing caller of `buildCorpus()` is unaffected by this parameter's
 * addition.
 */
export function buildCorpus(variant: CorpusVariant = 'mixed'): SyntheticCorpus {
  const concepts: ConceptRecord[] = NOTES.map((note) => {
    const sourcePaths: readonly VaultPath[] = [note.path];
    return {
      // `ol-63e1`: the RAW synthetic id, never wrapped through
      // `provisionalConceptKey` — `curriculum.ts`'s module doc states this
      // package's self-consistency rule explicitly: every `syn:concept:…` id
      // IS already opaque by construction (`vocabulary.ts`'s
      // `SYNTHETIC_ID_PREFIX`) and a synthetic stream's
      // `ReviewLogRecord.conceptIds` carries it verbatim (`generate.ts`'s
      // `perConceptMastery`). Wrapping it here would silently diverge this
      // corpus's `materialPresence` (keyed by `.key`) from
      // `curriculum.ts`'s edges (`ConceptAssessmentEdge.conceptKey`, also the
      // raw id) — exactly the cross-module mismatch `buildGapView` needs both
      // to agree on.
      key: note.conceptName,
      name: note.conceptName,
      tier: 3,
      courses: [COURSE_VANTREL],
      sourcePaths,
      size: conceptRecordSize({ sourcePaths, boundNotePath: undefined }),
    };
  });
  const instrumentCountsByNotePath = new Map(
    NOTES.map((note) => [note.path, note.instrumentCount]),
  );

  return {
    notes: NOTES,
    materialPresence: buildMaterialPresence(concepts, instrumentCountsByNotePath),
    sourceCoverage: variant === 'all-read' ? SOURCE_COVERAGE_ALL_READ : SOURCE_COVERAGE,
  };
}

/** `kelvane`'s id, restated here for callers that want to assert its material-gap row directly. */
export { CONCEPT_KELVANE };
