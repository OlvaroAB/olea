/**
 * `ObsidianStudyPlanSettingsStore` — persists the one setting P5-T07's
 * switch-on needs and cannot default: the vault path of the `.base` file
 * `readAssessments` (F1.1) scans.
 *
 * ## Why this exists at all
 *
 * `buildConceptAssessmentEdges`'s `basePath` is required, with no default —
 * its own doc says so, and correctly: F1.1's own words are that she "already
 * maintains an Obsidian Bases table," not that it lives at one fixed path.
 * The fixture vault keeps it at `02 Assignments/Assignments.base`; nothing in
 * the product may assume a real vault matches that, because F1.3 is explicit
 * that her course folders do not follow one shape either. So a real
 * composition needs this path from somewhere, and until F1.1's own base-file
 * discovery is built, "somewhere" is her, once, in settings — the same
 * "manual entry only as a fallback where no [other path] exists" F1.2 already
 * states for assessment records themselves.
 *
 * ## What an unset path means, and why that is not an error state
 *
 * Empty is the ordinary state for an install that has not configured this
 * yet, or one where she has decided not to. `plan/provider.ts`'s
 * `createLocalStudyPlanProvider` reads this store and, finding nothing
 * usable, fails the fetch the same way an unreachable Worker would —
 * reported through `refreshStudyPlan`'s `reason`, never thrown past it — so
 * F7.8's guarantee holds without this module having to know that: review,
 * scheduling and the Today panel already work with no plan at all (Phase A),
 * exactly as they work with no AI configured.
 *
 * Modelled on `../worker/config-store.ts`'s `ObsidianWorkerConfigStore` —
 * same `ObsidianDataHost` port, own top-level key, read-modify-write on save.
 */

/** The `{ loadData, saveData }` slice of Obsidian's `Plugin` this store needs — see the module doc for why it's spelled out rather than imported. */
export interface ObsidianDataHost {
  loadData(): Promise<unknown>;
  saveData(data: unknown): Promise<void>;
}

/** The top-level key this store owns inside the plugin's single `data.json` blob. */
export const STUDY_PLAN_SETTINGS_STORAGE_KEY = 'studyPlanConfig';

export interface PersistedStudyPlanConfig {
  readonly version: 1;
  /** Vault-relative path to the `.base` file `readAssessments` scans. Blank means "not configured". */
  readonly assignmentsBasePath: string;
}

/** Nothing entered yet, or nothing usable typed — the state a fresh install and a cleared field share. */
export const EMPTY_STUDY_PLAN_CONFIG: PersistedStudyPlanConfig = {
  version: 1,
  assignmentsBasePath: '',
};

function isPersistedStudyPlanConfig(value: unknown): value is PersistedStudyPlanConfig {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as Record<string, unknown>;
  return candidate.version === 1 && typeof candidate.assignmentsBasePath === 'string';
}

/** True once a non-blank path has been entered — the only state in which a plan refresh can attempt a real composition. */
export function isStudyPlanConfigured(config: PersistedStudyPlanConfig): boolean {
  return config.assignmentsBasePath.trim().length > 0;
}

export class ObsidianStudyPlanSettingsStore {
  constructor(private readonly host: ObsidianDataHost) {}

  /** Returns `EMPTY_STUDY_PLAN_CONFIG` — never `null`, never a throw — when nothing usable is stored. */
  async load(): Promise<PersistedStudyPlanConfig> {
    const blob = await this.host.loadData();
    if (typeof blob !== 'object' || blob === null) return EMPTY_STUDY_PLAN_CONFIG;
    const candidate = (blob as Record<string, unknown>)[STUDY_PLAN_SETTINGS_STORAGE_KEY];
    return isPersistedStudyPlanConfig(candidate) ? candidate : EMPTY_STUDY_PLAN_CONFIG;
  }

  async save(config: PersistedStudyPlanConfig): Promise<void> {
    const existing = await this.host.loadData();
    const blob: Record<string, unknown> =
      typeof existing === 'object' && existing !== null
        ? { ...(existing as Record<string, unknown>) }
        : {};
    blob[STUDY_PLAN_SETTINGS_STORAGE_KEY] = config;
    await this.host.saveData(blob);
  }
}
