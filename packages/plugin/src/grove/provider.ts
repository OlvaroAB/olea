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
 */

import {
  type AssessmentRecord,
  buildGroveModel,
  buildMaterialPresence,
  buildRegistryModel,
  type ConceptMaterialPresence,
  calendarDaysEndingOn,
  createFsrsScheduler,
  enumerateVaultInstruments,
  extractTier3Evidence,
  type GroveCourseModel,
  readAssessments,
  readReviewLogHistory,
  reviewLogPath,
  suspendedInstrumentIds,
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
