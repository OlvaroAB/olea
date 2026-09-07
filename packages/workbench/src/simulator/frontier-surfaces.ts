/**
 * The frontier walk's surfaces (`ol-3ux7.5.57.14.8` [MOM-10i], under
 * `ol-3ux7.5.57.14` [MOM-10]; `docs/dev/simulator-design.md` §2a/§4b and
 * `docs/dev/simulator-persona-walkthrough.md`'s frontier section, in the
 * private `olea-service` repo).
 *
 * ==========================================================================
 * WHAT THIS IS, AND WHAT IT DELIBERATELY IS NOT
 * ==========================================================================
 * Every other simulator surface renders the PLUGIN: the real views, mounted
 * against the persisted vault, answered by whatever the transport can serve.
 * This module renders something else and says so on every panel — the
 * **replayed outputs of a frontier term**: the answers Claude tiers gave to
 * every model call of one persona's whole term, written to file, answered
 * out of session, and ingested into `frontier-state/` by
 * `scripts/harness/frontier-replay.mjs` (service repo).
 *
 * That makes this an **upper bar, not a product model** — the exact words
 * every panel carries ({@link FRONTIER_UPPER_BAR_NOTE}), because a reader
 * who forgets it will read a frontier-tier answer as a claim about what the
 * shipped product does. It is not: no routing policy chose these tiers, no
 * cost ceiling bounded them, and nothing here ran inside a slot.
 *
 * ==========================================================================
 * THE ONE RULE THIS MODULE ENFORCES: NEVER INVENT
 * ==========================================================================
 * A surface with no replayed output does not get a plausible placeholder. It
 * gets {@link FrontierSurfaceModel.state} `'unanswered'` and the words the
 * renderer puts on it — the same refusal path the simulator already takes
 * when the transport cannot answer. Round 5 (the plan) had not landed when
 * this module was written; the plan surface therefore renders its refusal,
 * and starts rendering a real plan the moment the build carries one, with no
 * code change here.
 *
 * ==========================================================================
 * SCRUB-BACK
 * ==========================================================================
 * Every replayed item carries the plan point it was answered at
 * (`context.stepIndex`, `context.date`). {@link buildFrontierSurfaceModels}
 * takes the simulator clock's current day and keeps only the items that had
 * ARRIVED by it, so moving the term scrubber moves these surfaces exactly as
 * it moves the plugin's own — the term arriving, never the term rewritten.
 *
 * ==========================================================================
 * PUBLIC BUILD
 * ==========================================================================
 * Nothing here runs unless the dist carries {@link FRONTIER_INDEX_FILE},
 * which only `olea-service/scripts/simulator-build.mjs --frontier-run` ever
 * writes. `loadFrontierSurfaces` returns `null` for every public build and
 * every ordinary private one, the same "a missing dist file means the
 * feature is simply not present" discipline `world.ts` and `seed-events.ts`
 * already keep. INV-3: this package holds no frontier material and cannot —
 * it only ever parses a file a private dist supplied.
 */

/** The dist-root index a frontier build writes. Absent everywhere else. */
export const FRONTIER_INDEX_FILE = 'simulator-frontier.json';

/** Where a frontier build lays the consumed state files, relative to the world base. */
export const FRONTIER_DIR = 'frontier/';

/**
 * The words every panel carries beside the tier that answered it. A constant
 * rather than a string literal per renderer so a test can assert the phrase
 * once and no future panel can quietly ship without it.
 */
export const FRONTIER_UPPER_BAR_NOTE = 'upper bar, not a product model';

/** The five surfaces a frontier term can answer, in walk order (moments A, D, D, C, B). */
export type FrontierSurfaceId = 'grove' | 'cards' | 'assessment' | 'explain-back' | 'plan';

export const FRONTIER_SURFACE_ORDER: readonly FrontierSurfaceId[] = [
  'grove',
  'cards',
  'assessment',
  'explain-back',
  'plan',
];

/** One row of {@link FrontierIndex} — written by the build, never invented here. */
export interface FrontierIndexEntry {
  readonly surface: FrontierSurfaceId;
  /** The panel heading the build chose, e.g. `'Grove — concepts and relations'`. */
  readonly title: string;
  /** The `frontier/` file names this surface reads, in read order. Empty when nothing was carried. */
  readonly files: readonly string[];
  /** The task ids that answered it, e.g. `['concepts.extract.v1']`. */
  readonly taskIds: readonly string[];
  /** The tier that answered it (`'sonnet'`, `'opus'`), or `null` when nothing has. */
  readonly tier: string | null;
  /** How many replayed items the build carried for this surface. `0` means unanswered. */
  readonly answered: number;
}

export interface FrontierIndex {
  /** The world id the frontier run walked — carried through for the panel header, never validated. */
  readonly world: string;
  /** ISO instant the build wrote the index. */
  readonly generatedAt: string;
  readonly surfaces: readonly FrontierIndexEntry[];
}

/** One replayed answer, in `frontier-state/`'s own item shape (`frontier-replay.mjs`). */
export interface FrontierStateItem {
  readonly taskId: string;
  readonly tier?: string;
  readonly round?: number;
  readonly context?: {
    readonly stepIndex?: number;
    readonly date?: string;
    readonly courseCode?: string;
    readonly [key: string]: unknown;
  };
  readonly result?: unknown;
}

/** The index plus every state file it named, as loaded. */
export interface FrontierBundle {
  readonly index: FrontierIndex;
  /** Keyed by the `frontier/` file name the index row named. */
  readonly states: ReadonlyMap<string, readonly FrontierStateItem[]>;
}

const ASOF_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

function isSurfaceId(value: unknown): value is FrontierSurfaceId {
  return typeof value === 'string' && (FRONTIER_SURFACE_ORDER as readonly string[]).includes(value);
}

function isIndexEntry(value: unknown): value is FrontierIndexEntry {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as Record<string, unknown>;
  return (
    isSurfaceId(candidate.surface) &&
    typeof candidate.title === 'string' &&
    Array.isArray(candidate.files) &&
    candidate.files.every((f) => typeof f === 'string') &&
    Array.isArray(candidate.taskIds) &&
    typeof candidate.answered === 'number'
  );
}

/**
 * Best-effort, never-throwing load of the dist's frontier index. `null` for
 * every dist that carries none — see this module's own PUBLIC BUILD note.
 */
export async function loadFrontierIndex(
  fetchFn: typeof fetch,
  base = '/',
): Promise<FrontierIndex | null> {
  try {
    const response = await fetchFn(`${base}${FRONTIER_INDEX_FILE}`);
    if (!response.ok) return null;
    const raw: unknown = await response.json();
    if (typeof raw !== 'object' || raw === null) return null;
    const candidate = raw as Record<string, unknown>;
    if (!Array.isArray(candidate.surfaces)) return null;
    const surfaces = candidate.surfaces.filter(isIndexEntry).map(
      (entry): FrontierIndexEntry => ({
        surface: entry.surface,
        title: entry.title,
        files: entry.files,
        taskIds: entry.taskIds,
        tier: typeof entry.tier === 'string' ? entry.tier : null,
        answered: entry.answered,
      }),
    );
    if (surfaces.length === 0) return null;
    return {
      world: typeof candidate.world === 'string' ? candidate.world : 'unknown',
      generatedAt: typeof candidate.generatedAt === 'string' ? candidate.generatedAt : '',
      surfaces,
    };
  } catch {
    return null;
  }
}

/**
 * One `frontier/<file>` state file's items, or `[]` when it is missing or
 * unreadable. Absence is the unanswered state, never a throw: a file a round
 * has not produced yet is the ordinary case this whole module is shaped
 * around.
 */
export async function loadFrontierStateFile(
  fetchFn: typeof fetch,
  base: string,
  file: string,
): Promise<readonly FrontierStateItem[]> {
  try {
    const response = await fetchFn(`${base}${FRONTIER_DIR}${file}`);
    if (!response.ok) return [];
    const raw: unknown = await response.json();
    if (typeof raw !== 'object' || raw === null) return [];
    const items = (raw as { items?: unknown }).items;
    if (!Array.isArray(items)) return [];
    return items.filter(
      (item): item is FrontierStateItem =>
        typeof item === 'object' &&
        item !== null &&
        typeof (item as { taskId?: unknown }).taskId === 'string',
    );
  } catch {
    return [];
  }
}

/** The index plus every file it names, loaded once per mount. `null` when there is no index. */
export async function loadFrontierSurfaces(
  fetchFn: typeof fetch,
  base = '/',
): Promise<FrontierBundle | null> {
  const index = await loadFrontierIndex(fetchFn, base);
  if (index === null) return null;
  const files = [...new Set(index.surfaces.flatMap((entry) => entry.files))];
  const loaded = await Promise.all(
    files.map(
      async (file): Promise<readonly [string, readonly FrontierStateItem[]]> => [
        file,
        await loadFrontierStateFile(fetchFn, base, file),
      ],
    ),
  );
  return { index, states: new Map(loaded) };
}

/**
 * The items that had ARRIVED by `dayIso` — see this module's SCRUB-BACK
 * note. An item with no `context.date` is kept: it is undated rather than
 * late, and dropping it would make a surface go empty on a technicality
 * about provenance rather than about the term.
 */
export function itemsUpTo(
  items: readonly FrontierStateItem[],
  dayIso: string,
): readonly FrontierStateItem[] {
  if (!ASOF_PATTERN.test(dayIso)) return items;
  return items.filter((item) => {
    const date = item.context?.date;
    return typeof date !== 'string' || !ASOF_PATTERN.test(date) || date <= dayIso;
  });
}

/** One line a surface renders. `detail` is optional supporting text; both come from the replay. */
export interface FrontierEntryLine {
  readonly primary: string;
  readonly detail?: string | undefined;
  /** `YYYY-MM-DD` — the plan point this line arrived at, when the replay recorded one. */
  readonly arrivedOn?: string | undefined;
}

/** A titled group of lines within a surface — a course, a window, a day. */
export interface FrontierGroup {
  readonly heading: string;
  readonly lines: readonly FrontierEntryLine[];
  /** How many lines the replay actually holds for this group, before any display cap. */
  readonly total: number;
}

export interface FrontierSurfaceModel {
  readonly surface: FrontierSurfaceId;
  readonly title: string;
  /** `'answered'` when the replay carried output that had arrived by the walked day; `'unanswered'` otherwise. */
  readonly state: 'answered' | 'unanswered';
  /** The tier that answered it, or `null` — the provenance badge's own text. */
  readonly tier: string | null;
  readonly taskIds: readonly string[];
  readonly groups: readonly FrontierGroup[];
  /** Why nothing is shown, when `state` is `'unanswered'`. Never a placeholder for the answer itself. */
  readonly refusal?: string | undefined;
}

/** How many lines a group renders before it reports the remainder as a count. Declared, display-only. */
export const FRONTIER_GROUP_DISPLAY_CAP = 12;

function capped(lines: readonly FrontierEntryLine[]): FrontierGroup['lines'] {
  return lines.slice(0, FRONTIER_GROUP_DISPLAY_CAP);
}

function group(heading: string, lines: readonly FrontierEntryLine[]): FrontierGroup {
  return { heading, lines: capped(lines), total: lines.length };
}

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : {};
}

function asArray(value: unknown): readonly unknown[] {
  return Array.isArray(value) ? value : [];
}

function text(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() !== '' ? value : undefined;
}

/**
 * Groups the grove: one group per arrival plan point, the concepts that
 * arrived there, plus a relations group carrying the verdicts the relation
 * tier returned. Both are the tiers' own output — no client-side merge, no
 * synthetic graph, nothing derived.
 */
export function buildGroveModel(
  conceptItems: readonly FrontierStateItem[],
  relationItems: readonly FrontierStateItem[],
): { readonly groups: readonly FrontierGroup[]; readonly conceptCount: number } {
  const byDay = new Map<string, FrontierEntryLine[]>();
  const seen = new Set<string>();
  for (const item of [...conceptItems].sort(
    (a, b) => (a.context?.stepIndex ?? 0) - (b.context?.stepIndex ?? 0),
  )) {
    const day = item.context?.date ?? 'undated';
    for (const raw of asArray(asRecord(item.result).concepts)) {
      const name = text(asRecord(raw).name);
      if (name === undefined || seen.has(name)) continue;
      seen.add(name);
      const aliases = asArray(asRecord(raw).aliases).filter(
        (a): a is string => typeof a === 'string',
      );
      const lines = byDay.get(day) ?? [];
      lines.push({
        primary: name,
        detail: aliases.length > 0 ? `also: ${aliases.join(', ')}` : undefined,
        arrivedOn: day === 'undated' ? undefined : day,
      });
      byDay.set(day, lines);
    }
  }

  const relationLines: FrontierEntryLine[] = [];
  for (const item of relationItems) {
    for (const raw of asArray(asRecord(item.result).verdicts)) {
      const verdict = asRecord(raw);
      const a = text(verdict.a);
      const b = text(verdict.b);
      if (a === undefined || b === undefined) continue;
      const type = text(verdict.type) ?? 'related-to';
      const confidence = typeof verdict.confidence === 'number' ? verdict.confidence : null;
      relationLines.push({
        primary: `${a} — ${type} — ${b}`,
        detail: confidence === null ? undefined : `confidence ${confidence.toFixed(2)}`,
        arrivedOn: item.context?.date,
      });
    }
  }

  const groups: FrontierGroup[] = [...byDay.entries()]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([day, lines]) => group(day === 'undated' ? 'Undated' : `Arrived ${day}`, lines));
  if (relationLines.length > 0) groups.push(group('Relations', relationLines));
  return { groups, conceptCount: seen.size };
}

/** Cards, grouped by the course the generation call named. */
export function buildCardsModel(items: readonly FrontierStateItem[]): readonly FrontierGroup[] {
  const byCourse = new Map<string, FrontierEntryLine[]>();
  for (const item of items) {
    const course = item.context?.courseCode ?? 'Unattributed';
    for (const raw of asArray(asRecord(item.result).cards)) {
      const card = asRecord(raw);
      const front = text(card.front);
      if (front === undefined) continue;
      const lines = byCourse.get(course) ?? [];
      lines.push({ primary: front, detail: text(card.back), arrivedOn: item.context?.date });
      byCourse.set(course, lines);
    }
  }
  return [...byCourse.entries()]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([course, lines]) => group(course, lines));
}

/** The assessment ranking, one group per window (a course at a plan point). */
export function buildRankingModel(items: readonly FrontierStateItem[]): readonly FrontierGroup[] {
  const groups: FrontierGroup[] = [];
  for (const item of [...items].sort((a, b) => {
    const byStep = (a.context?.stepIndex ?? 0) - (b.context?.stepIndex ?? 0);
    if (byStep !== 0) return byStep;
    const ca = a.context?.courseCode ?? '';
    const cb = b.context?.courseCode ?? '';
    return ca < cb ? -1 : ca > cb ? 1 : 0;
  })) {
    const rankings = asArray(asRecord(item.result).rankings);
    if (rankings.length === 0) continue;
    const lines: FrontierEntryLine[] = rankings.map((raw, position) => {
      const ranking = asRecord(raw);
      return {
        primary: `${position + 1}. ${text(ranking.conceptName) ?? '(unnamed)'}`,
        detail: text(ranking.reasoning),
        arrivedOn: item.context?.date,
      };
    });
    const course = item.context?.courseCode ?? 'window';
    const day = item.context?.date ?? 'undated';
    groups.push(group(`${course} — ${day}`, lines));
  }
  return groups;
}

/**
 * The explain-back moment: the judge's verdict and its feedback, and the
 * solo-depth tier's level and rationale, each labelled with the task that
 * produced it — the two are different questions and must never be merged
 * into one "grade".
 */
export function buildExplainBackModel(
  items: readonly FrontierStateItem[],
): readonly FrontierGroup[] {
  const judged: FrontierEntryLine[] = [];
  const solo: FrontierEntryLine[] = [];
  for (const item of items) {
    const result = asRecord(item.result);
    if (item.taskId === 'explain-back.judge.v1') {
      const verdict = text(result.verdict);
      if (verdict === undefined) continue;
      const missed = asArray(result.missedPoints).filter((m): m is string => typeof m === 'string');
      judged.push({
        primary: `Verdict: ${verdict}`,
        detail: [
          text(result.feedback),
          missed.length > 0 ? `Missed: ${missed.join('; ')}` : undefined,
        ]
          .filter((part): part is string => part !== undefined)
          .join(' — '),
        arrivedOn: item.context?.date,
      });
    } else if (item.taskId === 'explain-back.solo.v1') {
      const level = text(result.soloLevel);
      if (level === undefined) continue;
      solo.push({
        primary: `Depth: ${level}`,
        detail: text(result.rationale),
        arrivedOn: item.context?.date,
      });
    }
  }
  const groups: FrontierGroup[] = [];
  if (judged.length > 0) groups.push(group('Judge — verdict and rationale', judged));
  if (solo.length > 0) groups.push(group('Solo depth — level and rationale', solo));
  return groups;
}

/**
 * The one composed session at or before the walked day, from `loop.session.v1`
 * items — the latest by `context.date` among what {@link itemsUpTo} already
 * kept. Ties (same date, more than one cycle) keep the last item in arrival
 * order. `null` when no session item is present, so a build with no
 * `sessions.json` adds no group and changes nothing (F9.50/F9.51).
 */
function latestSession(items: readonly FrontierStateItem[]): FrontierStateItem | null {
  let latest: FrontierStateItem | null = null;
  let latestDate = '';
  for (const item of items) {
    const date = item.context?.date;
    if (typeof date !== 'string') continue;
    if (latest === null || date >= latestDate) {
      latest = item;
      latestDate = date;
    }
  }
  return latest;
}

/**
 * The composed-session group: the next thing as the lead line, the
 * allocation sentence, one line per course share, then the ranked items —
 * all from `loop.session.v1`'s own `result`, nothing merged in.
 */
function buildSessionGroup(items: readonly FrontierStateItem[]): FrontierGroup | null {
  const session = latestSession(items);
  if (session === null) return null;
  const result = asRecord(session.result);
  const date = session.context?.date;
  const lines: FrontierEntryLine[] = [];

  const nextThing = asRecord(result.nextThing);
  const nextConcept = text(nextThing.conceptId);
  if (nextConcept !== undefined) {
    const nextCourse = text(nextThing.course);
    lines.push({
      primary: `Next: ${nextConcept}${nextCourse === undefined ? '' : ` (${nextCourse})`}`,
      detail: text(nextThing.reason),
      arrivedOn: date,
    });
  }

  const allocationSentence = text(result.allocationSentence);
  if (allocationSentence !== undefined) {
    lines.push({ primary: allocationSentence, arrivedOn: date });
  }

  for (const raw of asArray(result.courseShares)) {
    const share = asRecord(raw);
    const courseId = text(share.courseId);
    if (courseId === undefined) continue;
    const pct = typeof share.share === 'number' ? `${Math.round(share.share * 100)}%` : undefined;
    const minutes =
      typeof share.seconds === 'number' ? `${Math.round(share.seconds / 60)} min` : undefined;
    const measure = [pct, minutes].filter((p): p is string => p !== undefined).join(', ');
    lines.push({
      primary: `${courseId}${measure === '' ? '' : ` — ${measure}`}`,
      detail: text(share.reason),
      arrivedOn: date,
    });
  }

  for (const raw of asArray(result.items)) {
    const sessionItem = asRecord(raw);
    const concept = text(sessionItem.conceptId);
    if (concept === undefined) continue;
    const rank = typeof sessionItem.rank === 'number' ? `${sessionItem.rank}.` : undefined;
    const type = text(sessionItem.instrumentType);
    const course = text(sessionItem.course);
    const primary = [rank, type, `— ${concept}`, course === undefined ? undefined : `(${course})`]
      .filter((p): p is string => p !== undefined)
      .join(' ');
    lines.push({ primary, detail: text(sessionItem.reason), arrivedOn: date });
  }

  if (lines.length === 0) return null;
  return group(`Session — ${date ?? 'undated'}`, lines);
}

/**
 * The plan: the latest composed session that had arrived by the walked day
 * (when the build carries `loop.session.v1` output — F9.51), then the
 * governor's proposals, and the strain it could not express.
 */
export function buildPlanModel(items: readonly FrontierStateItem[]): readonly FrontierGroup[] {
  const proposals: FrontierEntryLine[] = [];
  const strain: FrontierEntryLine[] = [];
  const sessionItems: FrontierStateItem[] = [];
  for (const item of items) {
    if (item.taskId === 'loop.session.v1') {
      sessionItems.push(item);
      continue;
    }
    const result = asRecord(item.result);
    for (const raw of asArray(result.proposals)) {
      const proposal = asRecord(raw);
      const course = text(proposal.courseId);
      const input = text(proposal.input);
      if (course === undefined || input === undefined) continue;
      const multiplier = typeof proposal.multiplier === 'number' ? proposal.multiplier : null;
      proposals.push({
        primary: `${course} — ${input}${multiplier === null ? '' : ` x${multiplier}`}`,
        detail: text(proposal.reason),
        arrivedOn: item.context?.date,
      });
    }
    for (const raw of asArray(result.strain)) {
      const entry = asRecord(raw);
      const wanted = text(entry.wanted);
      if (wanted === undefined) continue;
      strain.push({
        primary: wanted,
        detail: text(entry.whyInexpressible),
        arrivedOn: item.context?.date,
      });
    }
  }
  const groups: FrontierGroup[] = [];
  const sessionGroup = buildSessionGroup(sessionItems);
  if (sessionGroup !== null) groups.push(sessionGroup);
  if (proposals.length > 0) groups.push(group('Proposals', proposals));
  if (strain.length > 0) groups.push(group('Strain — what the plan could not express', strain));
  return groups;
}

/** The refusal text a surface with no replayed output carries. Never a stand-in answer. */
export function frontierRefusal(entry: FrontierIndexEntry, dayIso: string): string {
  if (entry.answered === 0 || entry.files.length === 0) {
    return `Not yet answered. No replayed output for ${entry.taskIds.join(', ') || 'this surface'} — the round that answers it has not landed in this build.`;
  }
  return `Nothing had arrived by ${dayIso}. This surface's replayed output starts at a later plan point; scrub forward to reach it.`;
}

/**
 * The whole panel at one simulated day — the only function `controller.ts`
 * calls per remount. Order is the index's, filtered to
 * {@link FRONTIER_SURFACE_ORDER}, so the walk always reads A, D, D, C, B.
 */
export function buildFrontierSurfaceModels(
  bundle: FrontierBundle,
  dayIso: string,
): readonly FrontierSurfaceModel[] {
  const byId = new Map(bundle.index.surfaces.map((entry) => [entry.surface, entry]));
  const models: FrontierSurfaceModel[] = [];
  for (const surface of FRONTIER_SURFACE_ORDER) {
    const entry = byId.get(surface);
    if (entry === undefined) continue;
    const filesItems = entry.files.map((file) => itemsUpTo(bundle.states.get(file) ?? [], dayIso));
    let groups: readonly FrontierGroup[] = [];
    if (surface === 'grove')
      groups = buildGroveModel(filesItems[0] ?? [], filesItems[1] ?? []).groups;
    else if (surface === 'cards') groups = buildCardsModel(filesItems.flat());
    else if (surface === 'assessment') groups = buildRankingModel(filesItems.flat());
    else if (surface === 'explain-back') groups = buildExplainBackModel(filesItems.flat());
    else groups = buildPlanModel(filesItems.flat());

    const answered = groups.some((g) => g.lines.length > 0);
    models.push({
      surface,
      title: entry.title,
      state: answered ? 'answered' : 'unanswered',
      tier: entry.tier,
      taskIds: entry.taskIds,
      groups: answered ? groups : [],
      refusal: answered ? undefined : frontierRefusal(entry, dayIso),
    });
  }
  return models;
}

// ---------------------------------------------------------------------------
// Rendering. Draw, do not decide — the same split `shell.ts`'s
// `renderRibbonViews` and `term-scrubber.ts`'s `renderTermScrubber` keep.
// Exercised by Playwright, never by this package's plain-Node Vitest (no
// `document`); the model builders above are what the unit suite asserts.
// ---------------------------------------------------------------------------

export const FRONTIER_PANEL_SELECTOR = '[data-wb-sim-frontier]';
const FRONTIER_STYLE_ID = 'wb-sim-frontier-style';

const FRONTIER_CSS = `
.wb-sim-frontier {
  border: 1px solid var(--background-modifier-border, #444);
  border-radius: 6px;
  margin: 0 0 12px 0;
  padding: 10px 12px;
  font-size: 12px;
  max-height: 42vh;
  overflow-y: auto;
}
.wb-sim-frontier-head { font-weight: 600; margin-bottom: 8px; }
.wb-sim-frontier-surface { margin: 10px 0; }
.wb-sim-frontier-title { font-weight: 600; }
.wb-sim-frontier-badge {
  display: inline-block;
  margin-left: 8px;
  padding: 1px 6px;
  border-radius: 3px;
  border: 1px solid var(--background-modifier-border, #444);
  font-size: 11px;
  text-transform: none;
}
.wb-sim-frontier-refusal { opacity: 0.75; font-style: italic; }
.wb-sim-frontier-group { margin: 6px 0 6px 8px; }
.wb-sim-frontier-group-head { font-weight: 600; opacity: 0.85; }
.wb-sim-frontier-line { margin: 2px 0 2px 8px; }
.wb-sim-frontier-detail { opacity: 0.75; }
.wb-sim-frontier-more { opacity: 0.7; font-style: italic; margin-left: 8px; }
`;

function injectFrontierStyle(doc: Document): void {
  if (doc.getElementById(FRONTIER_STYLE_ID) !== null) return;
  const style = doc.createElement('style');
  style.id = FRONTIER_STYLE_ID;
  style.textContent = FRONTIER_CSS;
  doc.head.appendChild(style);
}

/**
 * The per-surface provenance badge's text: which tier answered this surface,
 * and {@link FRONTIER_UPPER_BAR_NOTE}. A surface nothing answered says so
 * rather than borrowing a neighbour's tier. A composed session carries the
 * literal tier `'none'` (`loop.session.v1` calls no model — F9.51), which
 * reads as its own badge rather than as "answered by none".
 */
export function frontierBadgeText(model: FrontierSurfaceModel): string {
  const answeredBy =
    model.tier === null
      ? 'no tier answered'
      : model.tier === 'none'
        ? 'composed locally, no model call'
        : `answered by ${model.tier}`;
  return `${answeredBy} · ${FRONTIER_UPPER_BAR_NOTE}`;
}

/**
 * Renders (rebuilding in place — cheap, and the models change on every clock
 * move) the frontier panel inside `container`.
 */
export function renderFrontierSurfaces(
  container: HTMLElement,
  world: string,
  models: readonly FrontierSurfaceModel[],
): HTMLElement {
  injectFrontierStyle(container.ownerDocument ?? document);
  let panel = container.querySelector<HTMLElement>(FRONTIER_PANEL_SELECTOR);
  if (panel === null) {
    panel = container.createDiv({
      cls: 'wb-sim-frontier',
      attr: { 'data-wb-sim-frontier': 'true' },
    });
  }
  panel.empty();
  panel.createDiv({
    cls: 'wb-sim-frontier-head',
    text: `Frontier term — ${world}. Every surface below is a replayed model answer: ${FRONTIER_UPPER_BAR_NOTE}.`,
  });

  for (const model of models) {
    const section = panel.createDiv({
      cls: 'wb-sim-frontier-surface',
      attr: {
        'data-wb-sim-frontier-surface': model.surface,
        'data-wb-sim-frontier-state': model.state,
      },
    });
    const title = section.createDiv({ cls: 'wb-sim-frontier-title', text: model.title });
    title.createSpan({
      cls: 'wb-sim-frontier-badge',
      text: frontierBadgeText(model),
      attr: { 'data-wb-sim-frontier-badge': 'true' },
    });
    if (model.state === 'unanswered') {
      section.createDiv({
        cls: 'wb-sim-frontier-refusal',
        text:
          model.refusal ??
          frontierRefusal(
            {
              surface: model.surface,
              title: model.title,
              files: [],
              taskIds: model.taskIds,
              tier: model.tier,
              answered: 0,
            },
            '',
          ),
        attr: { 'data-wb-sim-frontier-refusal': 'true' },
      });
      continue;
    }
    for (const grp of model.groups) {
      const groupEl = section.createDiv({ cls: 'wb-sim-frontier-group' });
      groupEl.createDiv({ cls: 'wb-sim-frontier-group-head', text: grp.heading });
      for (const line of grp.lines) {
        const lineEl = groupEl.createDiv({ cls: 'wb-sim-frontier-line' });
        lineEl.createSpan({ text: line.primary });
        if (line.detail !== undefined) {
          lineEl.createDiv({ cls: 'wb-sim-frontier-detail', text: line.detail });
        }
      }
      if (grp.total > grp.lines.length) {
        groupEl.createDiv({
          cls: 'wb-sim-frontier-more',
          text: `+${grp.total - grp.lines.length} more replayed, not shown`,
        });
      }
    }
  }
  return panel;
}
