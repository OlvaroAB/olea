/**
 * `createLocalGroveProvider` — the production `GroveDataDeps` (F8.1,
 * `[D-134]` Q1, `ol-0r92.17`, real six-state computation `ol-o8eo`).
 *
 * ## What changed from the `ol-0r92.17` stand-in, and why
 *
 * The round-27 host had no core computation to read (`ol-o8eo`'s own
 * description: "no `GroveState` type, no `ground`/`volunteer` value anywhere
 * in the codebase"), so it rendered `buildRegistryModel`'s growth-stage
 * projection with an honest disclaimer that it was Olea's own reading, never
 * F8.1's examiner-declared scope. `olea-core#buildGroveModel` (`./scope/
 * grove.ts`) is that computation now, and this module is the wiring: for
 * each course, gather what `buildGroveModel` needs and read back a real
 * three-way status (`'declared'` / `'inferred'` / `'no-registered-source'`)
 * instead of always rendering the inferred reading.
 *
 * **This is the mechanism `ol-z0j9` (the naming-tension bead) asked for.**
 * That bead flagged that F8.1's own vocabulary forbids the word `grove` for
 * a scope Olea alone inferred, and the round-27 host was exactly that case,
 * unconditionally. `GroveCourseModel`'s `'inferred'` status is what lets a
 * course be told apart from a `'declared'` one — the view now withholds the
 * `grove`-shaped rendering for an inferred course (`./view.ts`) rather than
 * always drawing one. **Whether to rename the view or the command stays
 * David's call** (`ol-z0j9` is still open for that question) — this bead
 * does not touch `VIEW_TYPE_OLEA_GROVE`, the command id, or `GROVE_VIEW_TITLE`.
 *
 * ## The vocabulary tier-3 evidence matches against, and the material-gap caveat this inherits
 *
 * `extractTier3Evidence` can only cite a name that is IN its `vocabulary`
 * option — the vocabulary is the candidate set, not a discovery mechanism —
 * so this module widens it the same way `../concept/extract.ts`'s own tier-3
 * pass does (`[...zettelByTitle.keys(), ...byName.keys()]`): every concept
 * name this run already extracted, topic-derived or Zettelkasten-bound, not
 * only Zettelkasten titles. This is what lets an objectives document that
 * names a `topic:`-only concept actually produce a citation for it.
 *
 * **The trade this makes explicit rather than hides:** a genuinely-absent
 * concept — the examiner's document names something she has NO note, no
 * `topic:` reference and no Zettelkasten title for anywhere — can still never
 * be discovered this way, because nothing puts its name in the vocabulary to
 * match against. `../gap/build.ts`'s own module doc names the identical
 * reachability gap for F4.10's material gap ("reachable through this shape
 * but rare-to-absent in practice against the current pipeline") — this
 * module inherits exactly that limitation, not a new one, and widening
 * extraction's vocabulary is that bead's work, not this one's.
 *
 * ## The reads, and what has to wait on what
 *
 * `buildGroveModel` needs, per course: the vault's `ConceptRecord`s (from
 * `enumerateVaultInstruments`, already walked for instruments too),
 * registered sources and their tier-3 citations (`extractTier3Evidence` —
 * F1.5/F4.1, the denominator's own source), and a growth-stage reading per
 * concept. The last of those is read off `buildRegistryModel`'s own
 * `RegistryConceptEntry.mastery` (C5.4's rollup, computed there already)
 * rather than this module computing a second answer to "what stage is this
 * concept at" — the same "compose once, read here" discipline `../gap/
 * provider.ts` follows for `composeOracleRanking`. `buildRegistryModel` also
 * remains this module's source for F8.5 withdrawal (`pruned`) — a concept
 * pruned from the registry stays off the grove's default reading here too.
 *
 * Five reads — the review log, the instrument/concept walk, the standing
 * offer log, the assessments Base and the registry overrides — depend on
 * none of each other, so they run under one `Promise.all`, matching `../gap/
 * provider.ts`'s own reasoning for paying independent vault reads
 * concurrently rather than serially. `extractTier3Evidence` and
 * `buildRegistryModel` run AFTER: both need `enumeration.concepts` (the
 * former for its widened vocabulary — see below — the latter as an input),
 * so neither can start until that walk resolves.
 *
 * ## The ground-streak, now persisted (F4.5, `ol-0r92.20`)
 *
 * `olea-core#classifyDeclaredConcept` (`./scope/coverage.ts`) needs a
 * `priorGroundStreak` per concept to flag a PERSISTING `ground` reading as a
 * stall rather than an ordinary in-flight one — see that module's doc for why
 * the pure computation cannot hold this itself. `./ground-streak-store.ts`
 * (`ObsidianGroveGroundStreakStore`) is the durable per-install store this
 * closes: the same `data.json` shape `ObsidianRegistryOverridesStore` and
 * `ObsidianStudyPlanSettingsStore` already use, keyed by concept id. `load()`
 * below reads it once, alongside the other independent vault reads, and
 * hands the same map into every course's `buildGroveModel` call (a
 * concept's classification depends only on its own material/instrument/
 * mastery state, never on which course is being built, so one global map
 * serves every course). Only `'declared'`-status courses contribute back —
 * `buildGroveModel`'s `'inferred'`/`'no-registered-source'` branches echo the
 * whole input map unfiltered (see that module's doc), which would
 * reintroduce stale entries for unrelated concepts if merged in — so this
 * module merges `nextGroundStreaks` only from courses that actually computed
 * real cells, then saves the merged result once, replacing the whole stored
 * map (a concept no longer reading `ground` in ANY declared course is
 * correctly absent, its streak reset — see the store's own module doc).
 *
 * **Whole-log mastery, not windowed** — same reasoning `registry/
 * provider.ts` states for its own read: growth stage is a current-state,
 * high-water-mark reading, and a windowed read would understate an old
 * concept's stage.
 *
 * **The standing offer, computed once, filtered per course** — mirrors
 * `home/provider.ts`'s identical computation over the SAME assessments and
 * offer-event reads; the two are not shared into one module because they
 * differ in exactly one line (grouping by course vs. not), and sharing would
 * mean a new file outside either bead's more natural home. Dismissal is
 * delegated to `createLocalRetrospectiveProvider`'s own `markDismissed` —
 * this module does not re-implement the `data.json` append.
 *
 * ## The C7.9 part-of fold, wired (`ol-kghd`)
 *
 * `buildGroveModel`'s `relations` input (`ol-5phn`) was built and tested
 * against `olea-core` directly but never reached a production caller — this
 * module was the gap. `CreateLocalGroveProviderDeps.relations` is the same
 * optional thunk shape `session-builder/provider.ts` already carries;
 * `main.ts`'s construction site passes `() => this.servedRelationEdges()`,
 * the identical `[D-093]`-gated fold `composeReviewSession` and the Today
 * panel's instrument source read. Absent (e.g. in a test that omits it),
 * `deps.relations?.() ?? []` hands `buildGroveModel` an empty edge set,
 * which is a documented no-op on that function's side.
 */

import {
  type AssessmentRecord,
  buildGroveModel,
  buildMaterialPresence,
  buildRegistryModel,
  type ConceptMaterialPresence,
  type ConceptRelation,
  calendarDaysEndingOn,
  createFsrsScheduler,
  discoverEmbeddedSources,
  enumerateVaultInstruments,
  extractTier3Evidence,
  findUnreadableFiles,
  type GroveCourseModel,
  readAssessments,
  readReviewLogHistory,
  reviewLogPath,
  suspendedInstrumentIds,
  type UnreadableFile,
  type VaultPath,
  type VaultSource,
} from 'olea-core';
import type { ObsidianDataHost } from '../plan/settings-store.js';
import { ObsidianStudyPlanSettingsStore } from '../plan/settings-store.js';
import { ObsidianRegistryOverridesStore } from '../registry/overrides-store.js';
import { resolveOfferCards } from '../retrospective/offer-card.js';
import { createRetrospectiveOfferEventLog } from '../retrospective/offer-events.js';
import { createLocalRetrospectiveProvider } from '../retrospective/provider.js';
import { localToday, SCHEDULING_HISTORY_PROBE_DAYS } from '../today/data-source.js';
import { ObsidianGroveGroundStreakStore } from './ground-streak-store.js';
import type { GroveCourseSection, GroveViewState } from './view.js';

/**
 * Same DECLARED shape `registry/provider.ts` and `retrospective/
 * provider.ts` each already carry — a plain-English default
 * (`buildRegistryModel` requires a holding cut to compute vitality), never
 * read by this module: F8.1's grove reads growth stage, not vitality.
 */
const DECLARED_FALLBACK_HOLDING_CUT = 0.8;

export interface CreateLocalGroveProviderDeps {
  readonly vault: VaultSource;
  readonly deviceId: string;
  readonly settingsHost: ObsidianDataHost;
  /** Injected for determinism under test; production passes `() => new Date()`. */
  readonly now: () => Date;
  /** Overridable for tests; defaults to the window every other provider probes by. */
  readonly probeDays?: number;
  /**
   * `ol-kghd`: the served C7.9/C7.10 relation fold — same shape and same
   * `[D-093]` abstention gate as `main.ts`'s `servedRelationEdges()`, which
   * already hands this to `composeReviewSession`, the Today panel's
   * instrument source and `session-builder/provider.ts`'s identical
   * `relations` field. **A thunk, not a value** — `createLocalGroveProvider`
   * is called once per leaf, but `load()` recomputes on every call, so a
   * captured array would go stale the moment a later ingestion tick folds in
   * a new relation batch. Optional and safe to omit: `buildGroveModel`
   * reads an absent/empty edge set as "no part-of fold runs" (`./grove.js`'s
   * own module doc), which is today's unchanged behaviour.
   */
  readonly relations?: () => readonly ConceptRelation[];
}

/** The data half of `GroveViewDeps` — `main.ts` adds `openRetrospective` at the construction site. */
export interface GroveDataDeps {
  readonly load: () => Promise<GroveViewState>;
  readonly dismiss: (assessmentPath: VaultPath) => Promise<void>;
}

/**
 * Tallies `VaultInstrumentRecord.notePath` — `buildMaterialPresence`'s second
 * argument. A note the enumeration never mentions contributes zero, matching
 * `../gap/provider.ts`'s identical helper (duplicated rather than shared: the
 * two files are owned by different beads' `owns` sets, and this is six lines).
 */
function instrumentCountsByNotePath(
  records: readonly { readonly notePath: VaultPath }[],
): ReadonlyMap<VaultPath, number> {
  const counts = new Map<VaultPath, number>();
  for (const record of records) {
    counts.set(record.notePath, (counts.get(record.notePath) ?? 0) + 1);
  }
  return counts;
}

/**
 * `[D-196]`, F1.5(b), F8.1: which F7.9 files, per course, the pipeline
 * reached but could not read.
 *
 * `sourcesReport.sources` (registered — F1.5/F3.1) already carries `course`
 * explicitly and is always reachable by definition, so every one of its
 * non-markdown members is a candidate for `'image-only-no-text'` only.
 * `sourcesReport.skippedNonMarkdown` is F7.9's other half: a binary file
 * register.ts's folder scan found and could not classify (no frontmatter to
 * read), which is exactly the population `'no-reader-for-format'` and
 * `'not-linked'` come from.
 *
 * **Course attribution for a skipped file.** F7.9's folder is flat and
 * carries no course structure (`../../../core/src/source/register.ts`'s own
 * module doc), and a binary carries no `course:` frontmatter, so there is no
 * derivation available as principled as `../../../core/src/concept/
 * course.ts#courseFromPath`. The one non-inventive signal left is her own
 * demonstrated naming habit: every registered research file in the fixture
 * and the real vault alike is named `"<COURSE> <kind> <year>.md"`
 * (`../../../core/src/source/register.spec.ts`). Matching a skipped file's
 * basename against `courseNames` — every course ALREADY known from her
 * concepts, registered sources or assessments, never a name invented here —
 * can only recognise a course, never invent one. **Class B, non-persisted,
 * reversible** (`docs/Olea_v09_implementation_plan.md` §2.7's decision
 * ladder) — flagged for retroactive review rather than escalated, since a
 * wrong match only ever misfiles a file under an existing course's grove,
 * never surfaces a course that doesn't exist. A skipped file matching no
 * known course is a named, deliberate gap: `[D-196]`'s own ruling reasons
 * that a file has "no question to stand beside until a course exists to ask
 * it," and a course this pipeline cannot yet name is exactly that case —
 * follow-up work (most naturally F1.5's still-unbuilt registration UI,
 * which would supply path AND course together) closes it, not a guess here.
 *
 * **Linkage.** A skipped file is not necessarily unlinked: some note may
 * embed it despite it never being registered. `embeddedPaths` below is the
 * same reachability `olea-service/scripts/census-concepts.mjs
 * #findUnembeddedFiles` already computes for the harness census this bead
 * moves into product code (`ol-2zfj.56`) — ported here rather than imported,
 * since that script lives in the other repo and is harness-only.
 */
async function unreadableFilesByCourse(
  vault: VaultSource,
  sourcesReport: Awaited<ReturnType<typeof extractTier3Evidence>>['sourcesReport'],
  courseNames: ReadonlySet<string>,
): Promise<ReadonlyMap<string, readonly UnreadableFile[]>> {
  const [allPaths, notePaths] = await Promise.all([
    vault.list(),
    vault.list({ extensions: ['md'] }),
  ]);
  const embeddedPaths = new Set<VaultPath>();
  for (const notePath of notePaths) {
    const { resolved } = await discoverEmbeddedSources(vault, notePath, allPaths);
    for (const r of resolved) embeddedPaths.add(r.path);
  }

  const linkedPaths = new Set<VaultPath>([
    ...sourcesReport.sources.map((s) => s.path),
    ...embeddedPaths,
  ]);

  const skippedByCourse = new Map<string, VaultPath[]>();
  for (const path of sourcesReport.skippedNonMarkdown) {
    const base = path.slice(path.lastIndexOf('/') + 1);
    const course = [...courseNames].find((name) => base.startsWith(name));
    if (course !== undefined) {
      const list = skippedByCourse.get(course) ?? [];
      list.push(path);
      skippedByCourse.set(course, list);
    }
  }

  const entries = await Promise.all(
    [...courseNames].map(async (course) => {
      const files = [
        ...sourcesReport.sources.filter((s) => s.course === course).map((s) => s.path),
        ...(skippedByCourse.get(course) ?? []),
      ];
      const unreadable = await findUnreadableFiles(vault, { files, linkedPaths });
      return [course, unreadable] as const;
    }),
  );
  return new Map(entries);
}

async function safeAssessmentRecords(
  vault: VaultSource,
  basePath: string,
): Promise<readonly AssessmentRecord[]> {
  try {
    return (await readAssessments(vault, basePath)).records;
  } catch {
    // Not-yet-configured (`assignmentsBasePath === ''`) and an unreadable
    // `.base` file both land here — the grove's concept sections are still
    // real without a single registered assessment, so this module does not
    // let a missing assignments Base sink the whole view the way `registry/
    // provider.ts`'s vault-walk failure legitimately does.
    return [];
  }
}

export function createLocalGroveProvider(deps: CreateLocalGroveProviderDeps): GroveDataDeps {
  const settingsStore = new ObsidianStudyPlanSettingsStore(deps.settingsHost);
  const offerStore = createRetrospectiveOfferEventLog({
    vault: deps.vault,
    deviceId: deps.deviceId,
    now: deps.now,
  });
  // Same store `RegistryView` reads (`registry/overrides-store.ts`) — a
  // concept withdrawn there (F8.5) stays withdrawn here too, rather than
  // this read-only browse reintroducing it through a second, unaware path.
  const overridesStore = new ObsidianRegistryOverridesStore(deps.settingsHost);
  // F4.5/`ol-0r92.20`: the durable ground-streak store — see module doc.
  const groundStreakStore = new ObsidianGroveGroundStreakStore(deps.settingsHost);
  const retrospective = createLocalRetrospectiveProvider({
    vault: deps.vault,
    deviceId: deps.deviceId,
    offerStore,
    settingsHost: deps.settingsHost,
    now: deps.now,
  });
  const scheduler = createFsrsScheduler();

  return {
    async load(): Promise<GroveViewState> {
      try {
        const now = deps.now();
        const today = localToday(now);
        const probeDays = deps.probeDays ?? SCHEDULING_HISTORY_PROBE_DAYS;
        const additionalPaths = calendarDaysEndingOn(today, probeDays).map((day) =>
          reviewLogPath(day, deps.deviceId),
        );
        const { assignmentsBasePath } = await settingsStore.load();

        // `enumerateVaultInstruments` already ran `extractConcepts` internally
        // (`enumeration.concepts`) — this walk cannot start until that one
        // finishes, so it is NOT part of the `Promise.all` below. Everything
        // else is independent and paid concurrently.
        const [
          { entries },
          enumeration,
          offerEvents,
          assessmentRecords,
          overrides,
          priorGroundStreaks,
        ] = await Promise.all([
          readReviewLogHistory(deps.vault, { additionalPaths }),
          enumerateVaultInstruments(deps.vault),
          offerStore.load(),
          safeAssessmentRecords(deps.vault, assignmentsBasePath),
          overridesStore.load(),
          groundStreakStore.load(),
        ]);

        // Match against every concept she already has (topic-derived or
        // Zettelkasten-bound), not only Zettelkasten titles — the same
        // widening `../concept/extract.ts`'s own tier-3 vocabulary makes
        // (`[...zettelByTitle.keys(), ...byName.keys()]`), so an examiner
        // document naming a concept she only ever gave a `topic:` value is
        // still matchable.
        const vocabulary = [...new Set(enumeration.concepts.map((concept) => concept.name))];
        const tier3 = await extractTier3Evidence(deps.vault, { vocabulary });

        const registryModel = buildRegistryModel({
          concepts: enumeration.concepts,
          instrumentRecords: enumeration.records,
          entries,
          scheduler,
          now,
          holdingCut: DECLARED_FALLBACK_HOLDING_CUT,
          overrides,
          suspendedInstrumentIds: suspendedInstrumentIds(entries),
        });

        // F8.5: withdrawn concepts stay off the default grove reading, the
        // same default `RegistryView` draws — never deleted, just excluded
        // from this browse.
        const prunedKeys = new Set(
          registryModel.concepts.filter((entry) => entry.pruned).map((entry) => entry.key),
        );
        const visibleConcepts = enumeration.concepts.filter(
          (concept) => !prunedKeys.has(concept.key),
        );
        const masteryByKey = new Map(
          registryModel.concepts.map((entry) => [entry.key, entry.mastery] as const),
        );
        const materialPresence: ReadonlyMap<string, ConceptMaterialPresence> =
          buildMaterialPresence(
            enumeration.concepts,
            instrumentCountsByNotePath(enumeration.records),
          );

        const courseNames = new Set<string>();
        for (const concept of visibleConcepts)
          for (const course of concept.courses) courseNames.add(course);
        for (const source of tier3.sourcesReport.sources) {
          if (source.course !== undefined) courseNames.add(source.course);
        }
        for (const record of assessmentRecords) {
          if (record.course !== undefined) courseNames.add(record.course);
        }

        // `resolveOfferCards` itself excludes anything not yet passed, or
        // already opened/dismissed (see its own module doc) — every
        // assessment record is handed in unfiltered.
        const allCards = resolveOfferCards(assessmentRecords, offerEvents, now);

        // [D-196], F1.5(b), F8.1: computed once per course, alongside the
        // scope reading rather than inside the render, so a course whose
        // grove never renders (no concepts, no offer cards) still gets a
        // real answer rather than an unattempted one.
        const unreadableByCourse = await unreadableFilesByCourse(
          deps.vault,
          tier3.sourcesReport,
          courseNames,
        );

        // Only `'declared'` courses contribute a real ground-streak reading
        // back — see module doc for why the other two statuses' echoed
        // `nextGroundStreaks` must NOT be merged in here.
        const nextGroundStreaks = new Map<string, number>();
        const courses: GroveCourseSection[] = [...courseNames].sort().map((course) => {
          const courseConcepts = visibleConcepts.filter((concept) =>
            concept.courses.includes(course),
          );
          const built = buildGroveModel({
            course,
            concepts: courseConcepts,
            sources: tier3.sourcesReport.sources,
            citations: tier3.citations,
            materialPresence,
            mastery: masteryByKey,
            priorGroundStreaks,
            relations: deps.relations?.() ?? [],
          });
          const model: GroveCourseModel = built.model;
          if (model.status === 'declared') {
            for (const [conceptKey, streak] of built.nextGroundStreaks) {
              nextGroundStreaks.set(conceptKey, streak);
            }
          }
          return {
            course,
            model,
            offerCards: allCards.filter((card) => card.course === course),
            unreadableFiles: unreadableByCourse.get(course) ?? [],
          };
        });

        await groundStreakStore.save(nextGroundStreaks);

        return { kind: 'model', courses };
      } catch (error) {
        console.error('Olea: could not compose the grove', error);
        return { kind: 'unavailable' };
      }
    },

    async dismiss(assessmentPath: VaultPath): Promise<void> {
      await retrospective.markDismissed(assessmentPath);
    },
  };
}
