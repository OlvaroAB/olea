// `ol-egov.141.89.5.44`, case D4 (PERSISTENCE.md section 3, D; inventory row 13; [D-465]): unchanged
// information across a restart and a re-cut, with controlled model responses, leaves the study plan
// and the plan-policy fingerprint unchanged.
//
// The transcript-to-plan path is composed from the production wiring modules `main.ts` composes,
// with one scripted Worker standing in for every model call: the material read
// (`concepts.extract.v1`), the embeddings (`retrieval.embed.v1`), the grounding judge, question
// drafting (`quiz.generate.v1`), the materiality judge, and the plan-policy calculator
// (`POST /v1/plan-policy`). The scripted model answers by content: the read names a concept in a
// passage containing the concept's words, and a text is embedded by which concept words it holds.
// So the transcript's concept comes from reading the transcript, never from the test, and the same
// words get the same answers. One run of the path, in a session:
//
//   1. the transcript lands (arrival watch, ingestion queue, transcript runner), and the generation
//      sweep runs on the landed units, as `main.ts`'s `onUnitsLanded` runs it;
//   2. the course folder is read for concepts, as `readLandedConceptsForFinishedFolders` reads it
//      once the folder's work drains; the read mints the concepts it finds;
//   3. what the read found is drafted. In production that happens at the course's next landing,
//      since the sweep runs before the read; the run stands that landing in with the transcript's
//      own landed units, the only units whose sweep cites the transcript;
//   4. she accepts every draft offered and answers each new question once (her actions, the same
//      rule in every run);
//   5. the citation pass runs, with transcript part grain on as in production;
//   6. the plan is refreshed through `refreshStudyPlan`, its allocation policy behind the
//      fingerprint gate (`buildPlanPolicyWiring`).
//
// Session one runs the path on the transcript as first exported and refreshes the plan twice: the
// first plan's allocation feeds the second request (the floor share), so the second refresh is the
// standing plan. A restart is a new session over data.json read back from JSON text, the vault's
// files as they are, and every store, index, engine, trigger and wiring built again. Session two
// meets the transcript re-cut while Olea was closed (the same words, every cue boundary moved),
// runs the path once and refreshes the plan.
//
// The second test changes one scripted response in session two (the read also reports a concept the
// lecture names that it did not report before) and shows the plan and the fingerprint change, so
// the first test can fail. The third changes one word of the cited passage in the re-cut, and shows
// the citation pass's route to the plan is live too. Every course, lecture, word and file here is
// invented.
import {
  appendReviewLogRecord,
  type ExtractedUnit,
  enumerateVaultInstruments,
  type ListOptions,
  readReviewLogHistory,
  refreshStudyPlan,
  type Unsubscribe,
  type VaultEvent,
  type VaultPath,
  type VaultSource,
  type WorkerTaskRequest,
  type WorkerTaskTransport,
} from 'olea-core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { buildConceptWiring, readConceptsFromVault } from '../../src/concept/wiring.js';
import { buildGenerationWiring } from '../../src/generation/wiring.js';
import { buildIngestionArrivalWatch } from '../../src/ingestion/arrival-watch.js';
import { ObsidianCitationHashStore } from '../../src/ingestion/materiality/citation-hash-store.js';
import {
  adaptMaterialityJudgeAsRevisionJudge,
  buildCitationRevisionWiring,
  type CitationRevisionActions,
} from '../../src/ingestion/materiality/citation-revision-wiring.js';
import { readTranscriptVersion } from '../../src/ingestion/materiality/transcript-grain.js';
import { WorkerMaterialityJudge } from '../../src/ingestion/materiality/workerJudge.js';
import { ObsidianQueueStore } from '../../src/ingestion/queue-store.js';
import { buildIngestionRunner } from '../../src/ingestion/wiring.js';
import { ObsidianKeywordIndexStore } from '../../src/keyword-index/store.js';
import { buildKeywordIndexWiring } from '../../src/keyword-index/wiring.js';
import { planPolicyFingerprint } from '../../src/plan/plan-policy-fingerprint.js';
import type {
  PlanPolicyHttpPost,
  PlanPolicyRequest,
  PlanPolicyResult,
} from '../../src/plan/plan-policy-provider.js';
import {
  buildPlanPolicyWiring,
  PLAN_POLICY_CACHE_STORAGE_KEY,
} from '../../src/plan/plan-policy-wiring.js';
import { createLocalStudyPlanProvider } from '../../src/plan/provider.js';
import { STUDY_PLAN_SETTINGS_STORAGE_KEY } from '../../src/plan/settings-store.js';
import { ObsidianStudyPlanStore } from '../../src/plan/store.js';
import type { DraftQuizCardsDeps } from '../../src/retrieval/draft-quiz-cards.js';
import { buildRetrievalWiring, SLOT_E_MODEL_ID } from '../../src/retrieval/wiring.js';
import { createVaultSuspendPort } from '../../src/review/ports.js';
import { WORKER_CONFIG_STORAGE_KEY } from '../../src/worker/config-store.js';
import {
  bytesHashOf,
  cue,
  FakeDataHost,
} from '../ingestion/materiality/transcript-fixtures.ol-egov.141.89.5.43.js';

// ---------------------------------------------------------------------------------------------
// The vault: one lecture transcript in a course folder, her own note with a card, an assessment
// ---------------------------------------------------------------------------------------------

const DEVICE = 'olea-devicea0001';
const COURSE = 'COURSEA';
const COURSE_FOLDER = `01 Courses/${COURSE}`;
const TRANSCRIPT = `${COURSE_FOLDER}/Lecture 3/transcript.txt`;
const BASE_PATH = '02 Assignments/Assignments.base';

/** The two concepts the invented lecture teaches, by the names the scripted read gives them. */
const KALOMI = 'Kalomi rule';
const VENIDO = 'Venido line';
const CONCEPT_WORDS = [KALOMI, VENIDO] as const;

/** A vault over a map of text files, listing by folder, with a watch that `emit` drives. */
class EventVault implements VaultSource {
  readonly files = new Map<string, string>();
  private readonly handlers = new Set<(event: VaultEvent) => void>();
  async list(options: ListOptions = {}): Promise<readonly VaultPath[]> {
    const extensions = options.extensions?.map((e) => e.toLowerCase());
    return [...this.files.keys()]
      .filter((p) => options.under === undefined || p.startsWith(`${options.under}/`))
      .filter(
        (p) =>
          extensions === undefined ||
          extensions.includes(p.slice(p.lastIndexOf('.') + 1).toLowerCase()),
      )
      .sort();
  }
  async read(path: VaultPath): Promise<string> {
    const content = this.files.get(path);
    if (content === undefined) throw new Error(`not found: ${path}`);
    return content;
  }
  async readBinary(path: VaultPath): Promise<Uint8Array> {
    return new TextEncoder().encode(await this.read(path));
  }
  async write(path: VaultPath, content: string): Promise<void> {
    this.files.set(path, content);
  }
  async exists(path: VaultPath): Promise<boolean> {
    return this.files.has(path);
  }
  watch(handler: (event: VaultEvent) => void): Unsubscribe {
    this.handlers.add(handler);
    return () => this.handlers.delete(handler);
  }
  /** What a session's watchers see while the vault loads: every file, reported as created. */
  loadAll(): void {
    for (const path of [...this.files.keys()].sort()) {
      for (const handler of this.handlers) handler({ kind: 'create', path });
    }
  }
}

/** The lecture's sentences in order: invented cues, two of them teaching the two concepts. */
function lectureSentences(): readonly string[] {
  const sentences: string[] = [];
  for (let k = 0; k < 12; k += 1) {
    const filler = cue(k).split(/(?<=\.) /);
    if (k === 3) {
      sentences.push(
        'Today we meet the venido line, which marks where the sarute pressure turns.',
        'Above the venido line every ramolu reading flips its sign.',
        ...filler.slice(2),
      );
    } else if (k === 8) {
      sentences.push(
        'The kalomi rule says the sarute pressure stays below the turning point in a closed ramolu.',
        'So the kalomi rule is what we check first in every exercise.',
        ...filler.slice(2),
      );
    } else {
      sentences.push(...filler);
    }
  }
  return sentences;
}

/** A plain-text transcript: the sentences in cues of `perCue`, a blank line between cues. */
function transcriptCutInto(perCue: number): string {
  const sentences = lectureSentences();
  const cues: string[] = [];
  for (let i = 0; i < sentences.length; i += perCue) {
    cues.push(sentences.slice(i, i + perCue).join(' '));
  }
  return `${cues.join('\n\n')}\n`;
}

/** As first exported: seven sentences a cue. */
const ORIGINAL = transcriptCutInto(7);
/** The re-cut: the same words, five sentences a cue, so the cue and part boundaries move. */
const RECUT = transcriptCutInto(5);

function seededVault(): EventVault {
  const vault = new EventVault();
  vault.files.set(TRANSCRIPT, ORIGINAL);
  // Her own note on another topic of the course, with a recall card she wrote and has practised:
  // the course's readiness and evidence volume are then not zero, so a concept added to the
  // course's ranking moves the plan-policy input.
  vault.files.set(
    'Notes/Week 1.md',
    [
      '---',
      'topic: [Sarute pressure]',
      `course: ${COURSE}`,
      '---',
      '',
      'What does the sarute pressure measure::The invented strain a ramolu carries',
      '',
    ].join('\n'),
  );
  vault.files.set(
    BASE_PATH,
    [
      'filters:',
      '  and:',
      '    - file.inFolder("02 Assignments")',
      '    - file.ext == "md"',
      'properties:',
      '  class:',
      '  type:',
      '  weight:',
      '  due:',
      '  status:',
    ].join('\n'),
  );
  vault.files.set(
    '02 Assignments/Midterm.md',
    `---\nclass: ${COURSE}\ntype: Exam\nweight: 30\ndue: 2026-11-20\nstatus: upcoming\n---\n\n# Midterm\n`,
  );
  return vault;
}

function freshHost(): FakeDataHost {
  const host = new FakeDataHost();
  host.blob = {
    [WORKER_CONFIG_STORAGE_KEY]: {
      version: 1,
      baseUrl: 'https://invented-worker.example',
      token: 'invented-token',
    },
    [STUDY_PLAN_SETTINGS_STORAGE_KEY]: { version: 1, assignmentsBasePath: BASE_PATH },
  };
  return host;
}

/** data.json as the next session finds it: what was written, read back from JSON text. */
function restarted(host: FakeDataHost): FakeDataHost {
  const next = new FakeDataHost();
  next.blob = JSON.parse(JSON.stringify(host.blob)) as Record<string, unknown>;
  return next;
}

// ---------------------------------------------------------------------------------------------
// The scripted Worker
// ---------------------------------------------------------------------------------------------

const STAMP = { contractVersion: 1, promptVersion: '1.0.0', modelId: 'invented-model' };

function mentions(text: string, conceptName: string): boolean {
  return text.toLowerCase().includes(conceptName.toLowerCase());
}

/** One axis per concept the text names, and a background axis for a text that names none. */
function embed(text: string): number[] {
  const axes = CONCEPT_WORDS.map((name) => (mentions(text, name) ? 1 : 0));
  const vector = [...axes, axes.some((a) => a === 1) ? 0 : 1];
  const norm = Math.sqrt(vector.reduce((sum, x) => sum + x * x, 0));
  return vector.map((x) => x / norm);
}

class ScriptedWorker {
  /** The concepts the read reports, by name: each in the first passage sent that names it. */
  readsConcepts: readonly string[] = [KALOMI];
  readonly calls: string[] = [];
  readonly policyPosts: PlanPolicyRequest[] = [];

  readonly transport: WorkerTaskTransport = {
    send: async (request: WorkerTaskRequest) => {
      this.calls.push(request.taskId);
      return this.answer(request);
    },
  };

  /** The plan-policy calculator: a fixed rule over the request, as the Worker computes and forgets. */
  readonly httpPost: PlanPolicyHttpPost = async ({ body }) => {
    const request = JSON.parse(body) as PlanPolicyRequest;
    this.policyPosts.push(request);
    const share = request.courses.length === 0 ? 0 : 1 / request.courses.length;
    const result: PlanPolicyResult = {
      asOf: request.asOf,
      rankWeights: {
        proximityHalfLifeDays: 14,
        assessmentWeightDivisor: 100,
        masteryNeedWeight: { seed: 1, sprout: 0.8, sapling: 0.5, tree: 0.2, unknown: 0.6 },
      },
      allocation: request.courses.map((course) => ({
        courseId: course.courseId,
        share,
        minBlockSeconds: 600,
        contributions: [
          { name: 'floor', value: 0.25 },
          { name: 'readiness', value: course.readiness },
        ],
        reason: 'scripted policy',
      })),
      floorsFundable: true,
    };
    return { status: 200, text: JSON.stringify(result) };
  };

  callsOf(taskId: string): number {
    return this.calls.filter((call) => call === taskId).length;
  }

  private answer(request: WorkerTaskRequest): unknown {
    const payload = request.payload as Record<string, unknown>;
    switch (request.taskId) {
      case 'retrieval.embed.v1': {
        const chunks = payload.chunks as readonly { contentHash: string; text: string }[];
        return {
          ok: true,
          stamp: { ...STAMP, modelId: SLOT_E_MODEL_ID },
          result: {
            embeddings: chunks.map((chunk) => ({
              contentHash: chunk.contentHash,
              vector: embed(chunk.text),
            })),
          },
        };
      }
      case 'concepts.extract.v1': {
        const sent = payload.sourceChunks as readonly string[];
        const concepts = this.readsConcepts.flatMap((name) => {
          const at = sent.findIndex((text) => mentions(text, name));
          return at === -1 ? [] : [{ name, anchorIndex: at + 1, aliases: [] }];
        });
        return {
          ok: true,
          stamp: STAMP,
          result: {
            concepts,
            // The Worker numbers the passages it shows; it shows every passage sent.
            numbering: {
              chunks: sent.map((text, i) => ({ sentIndex: i + 1, length: text.length })),
            },
          },
        };
      }
      case 'grounding.judge.v1':
        return { ok: true, stamp: STAMP, result: { supported: true, reason: 'scripted' } };
      case 'quiz.generate.v1':
        return {
          ok: true,
          stamp: STAMP,
          result: {
            questions: [
              {
                stem: `Which invented statement about the ${String(payload.conceptName)} holds?`,
                correctAnswer: 'Alpha',
                distractors: ['Beta', 'Gamma', 'Delta', 'Epsilon'],
                feedback: 'Invented feedback.',
              },
            ],
          },
        };
      case 'materiality.judge.v1':
        return { ok: true, stamp: STAMP, result: { material: true, reason: 'scripted' } };
      default:
        throw new Error(`the scripted Worker has no answer for ${request.taskId}`);
    }
  }
}

// ---------------------------------------------------------------------------------------------
// One session, composed from the modules `main.ts` composes
// ---------------------------------------------------------------------------------------------

const SESSION_ONE_AT = new Date('2026-10-05T09:00:00Z');
const SESSION_TWO_AT = new Date('2026-10-06T09:00:00Z');
/** Every plan is refreshed at one moment, so only what the path derived can differ. */
const PLAN_AT = new Date('2026-10-07T09:00:00Z');

interface PlanRun {
  readonly source: string;
  readonly plan: unknown;
  readonly request: PlanPolicyRequest | undefined;
  readonly fingerprint: string | undefined;
  readonly cachedFingerprint: string | undefined;
}

interface PathRun {
  readonly accepted: number;
  readonly answered: number;
  /** The transcript version this session's landing read (its bytes hash). */
  readonly landedVersion: string | undefined;
  /** How many tracked questions this session's citation pass checked. */
  readonly checked: number;
}

interface Session {
  readonly host: FakeDataHost;
  runPath(): Promise<PathRun>;
  refreshPlan(): Promise<PlanRun>;
}

/** Lets the watchers' asynchronous reads, hashes and enqueues settle. */
async function settle(): Promise<void> {
  for (let i = 0; i < 5; i += 1) await new Promise((resolve) => setTimeout(resolve, 10));
}

/** Her answer to each question she has not answered yet, once, rated good without help. */
async function sheAnswersEachNewQuestion(vault: EventVault, at: Date): Promise<number> {
  const { entries } = await readReviewLogHistory(vault);
  const answered = new Set(
    entries.flatMap((entry) => (entry.kind === 'review' ? [entry.instrumentId] : [])),
  );
  const { records } = await enumerateVaultInstruments(vault, {
    concepts: { stampConceptKeys: true },
  });
  let count = 0;
  for (const record of records) {
    if (answered.has(record.instrumentId)) continue;
    await appendReviewLogRecord(
      vault,
      {
        timestamp: at.toISOString(),
        instrumentId: record.instrumentId,
        instrumentType: record.instrumentType,
        conceptIds: [...record.conceptIds],
        rating: 'good',
        ...(record.instrumentType === 'mcq' ? {} : { supportLevelShown: 'independent' as const }),
        wasUnsure: false,
        durationMs: 1200,
        selectionContext: {
          dueState: 'new',
          examProximity: null,
          yieldRank: null,
          instrumentTypesOffered: [record.instrumentType],
          planVersion: null,
        },
      },
      { deviceId: DEVICE, generateEventId: () => `review-${record.instrumentId}` },
    );
    count += 1;
  }
  return count;
}

async function openSession(
  host: FakeDataHost,
  vault: EventVault,
  worker: ScriptedWorker,
): Promise<Session> {
  const now = () => new Date(Date.now());
  const createTransport = () => worker.transport;
  const retrieval = await buildRetrievalWiring({ dataHost: host, createTransport });
  const keywordIndex = await buildKeywordIndexWiring({
    vault,
    store: new ObsidianKeywordIndexStore(host),
    capability: { canDrain: true },
    watch: (handler) => vault.watch(handler),
  });
  const concept = await buildConceptWiring({ dataHost: host, createTransport });
  const generation = buildGenerationWiring({ vault, deviceId: DEVICE, now });
  const citationHashStore = new ObsidianCitationHashStore(host);
  const citationRevision = buildCitationRevisionWiring({
    store: citationHashStore,
    clock: { now: () => Date.now() },
    judge: adaptMaterialityJudgeAsRevisionJudge(
      new WorkerMaterialityJudge({ transport: worker.transport }),
    ),
    transcriptPartGrain: true,
  });
  const suspendPort = createVaultSuspendPort(vault, DEVICE, now);

  // `main.ts`'s `draftQuizCardsDeps`: the keyword index and the retrieval wiring's cache,
  // provider and transport.
  const draftDeps = (): DraftQuizCardsDeps | null => {
    if (
      retrieval.embeddingCache === null ||
      retrieval.embeddingProvider === null ||
      retrieval.transport === null
    ) {
      return null;
    }
    return {
      retrieve: {
        keywordIndex: keywordIndex.engine.toPersisted(),
        embeddingCache: retrieval.embeddingCache,
        embeddingProvider: retrieval.embeddingProvider,
      },
      transport: retrieval.transport,
    };
  };

  let enqueue: CitationRevisionActions['enqueue'] = async () => undefined;
  const actions: CitationRevisionActions = {
    enqueue: (input) => enqueue(input),
    suspend: (instrumentId, conceptIds) => suspendPort.suspend(instrumentId, conceptIds),
  };
  const landed: { units: readonly ExtractedUnit[]; revisions: ReadonlyMap<string, string> }[] = [];

  // `main.ts`'s `onUnitsLanded`: a changed source's landed text first, then the generation sweep,
  // with no knowledge-kind classifier and no format match.
  const sweep = async (
    units: readonly ExtractedUnit[],
    revisions: ReadonlyMap<string, string>,
  ): Promise<void> => {
    if (revisions.size > 0) {
      await citationRevision.onSourceUnitsLanded(vault, actions, units, revisions);
    }
    await generation.sweep(units, draftDeps(), { classifier: null }, undefined, revisions);
  };

  const { engine } = await buildIngestionRunner({
    vault,
    queueStore: new ObsidianQueueStore(host),
    capability: { canDrain: true },
    revision: { cache: generation.cache, draftDeps, now },
    onUnitsLanded: async (units, revisions) => {
      const sourceRevisions = revisions ?? new Map<string, string>();
      landed.push({ units, revisions: sourceRevisions });
      await sweep(units, sourceRevisions);
    },
  });
  enqueue = (input) => engine.enqueue(input);
  buildIngestionArrivalWatch({
    vault,
    enqueuer: engine,
    watch: (handler) => vault.watch(handler),
    clock: { now: () => Date.now() },
  });

  const studyPlanStore = new ObsidianStudyPlanStore(host);
  const planPolicy = await buildPlanPolicyWiring({ dataHost: host, httpPost: worker.httpPost });
  const readPlanPolicy = planPolicy.readPlanPolicy;
  if (readPlanPolicy === null) throw new Error('the plan-policy wiring was not built');

  return {
    host,
    async runPath() {
      // 1. The vault loads; the transcript's job is queued and drained, past the enqueue debounce.
      const jobsBefore = engine.list().length;
      vault.loadAll();
      await vi.waitFor(() => expect(engine.list().length).toBeGreaterThan(jobsBefore));
      await settle();
      for (let i = 0; i < 20; i += 1) {
        vi.setSystemTime(Date.now() + 60_000);
        await engine.tick();
        if (engine.list().every((job) => job.status === 'done' || job.status === 'failed')) break;
      }
      await settle();
      // 2. The course folder is read.
      const read = await readConceptsFromVault(concept, vault, { under: COURSE_FOLDER });
      expect(read?.outcome).toBe('read');
      // 3. What the read found is drafted at the course's next landing.
      const last = landed.at(-1);
      if (last === undefined) throw new Error('nothing landed for the transcript');
      const landedVersion = last.revisions.get(TRANSCRIPT);
      await sweep(last.units, last.revisions);
      // 4. She accepts every draft offered and answers each new question once.
      const pending = await generation.cache.listPending();
      for (const draft of pending) await generation.acceptPort.accept(draft.draftId, 'accepted');
      const answered = await sheAnswersEachNewQuestion(vault, new Date(Date.now() + 60_000));
      // 5. The citation pass.
      const report = await citationRevision.tick(vault, actions);
      return { accepted: pending.length, answered, landedVersion, checked: report.tracked };
    },
    async refreshPlan() {
      let request: PlanPolicyRequest | undefined;
      const provider = createLocalStudyPlanProvider({
        vault,
        deviceId: DEVICE,
        settingsHost: host,
        now: () => PLAN_AT,
        studyPlanStore,
        readPlanPolicy: async (sent) => {
          request = sent;
          return readPlanPolicy(sent);
        },
        citationHashStore,
      });
      const result = await refreshStudyPlan({
        store: studyPlanStore,
        provider,
        now: () => PLAN_AT,
      });
      const cached = host.blob[PLAN_POLICY_CACHE_STORAGE_KEY] as
        | { readonly fingerprint?: string }
        | undefined;
      return {
        source: result.source,
        plan: result.plan,
        request,
        fingerprint: request === undefined ? undefined : await planPolicyFingerprint(request),
        cachedFingerprint: cached?.fingerprint,
      };
    },
  };
}

interface Outcome {
  readonly sessionOne: PathRun;
  readonly sessionTwo: PathRun;
  readonly standing: PlanRun;
  readonly after: PlanRun;
  /** The key of the concept the read found in the transcript, as its question carries it. */
  readonly transcriptConcept: string | undefined;
  readonly policyPostsInSessionTwo: number;
  readonly judgeCallsInSessionTwo: number;
  readonly withheldAfterRecut: number;
  /** The cited passage after the re-cut: still in the transcript's words, no longer one of its parts. */
  readonly citedPassage: { readonly inWords: boolean; readonly aPart: boolean } | undefined;
}

async function restartAndRecut(
  sessionTwoReads: readonly string[],
  recut: string = RECUT,
): Promise<Outcome> {
  const worker = new ScriptedWorker();
  const vault = seededVault();

  vi.setSystemTime(SESSION_ONE_AT);
  const one = await openSession(freshHost(), vault, worker);
  const sessionOne = await one.runPath();
  await one.refreshPlan();
  const standing = await one.refreshPlan();
  const { records } = await enumerateVaultInstruments(vault, {
    concepts: { stampConceptKeys: true },
  });
  const transcriptConcept = records.find(
    (record) => record.instrumentType === 'mcq' && mentions(record.mcq.stem, KALOMI),
  )?.conceptIds[0];

  // Olea closes; the transcript is re-cut (the same words, every cue boundary moved).
  vault.files.set(TRANSCRIPT, recut);
  vi.setSystemTime(SESSION_TWO_AT);
  worker.readsConcepts = sessionTwoReads;
  const postsBefore = worker.policyPosts.length;
  const judgeCallsBefore = worker.callsOf('materiality.judge.v1');
  const two = await openSession(restarted(one.host), vault, worker);
  const sessionTwo = await two.runPath();
  const after = await two.refreshPlan();

  const anchors = await new ObsidianCitationHashStore(two.host).loadAll();
  const cited = [...anchors.values()].find((anchor) => anchor.sourcePath === TRANSCRIPT);
  const transcriptNow = await readTranscriptVersion(vault, TRANSCRIPT);
  const parts =
    transcriptNow.kind === 'read' ? transcriptNow.version.parts.map((part) => part.spoken) : [];
  return {
    sessionOne,
    sessionTwo,
    standing,
    after,
    transcriptConcept,
    policyPostsInSessionTwo: worker.policyPosts.length - postsBefore,
    judgeCallsInSessionTwo: worker.callsOf('materiality.judge.v1') - judgeCallsBefore,
    withheldAfterRecut: [...anchors.values()].filter(
      (anchor) => anchor.pendingRevalidation !== undefined,
    ).length,
    citedPassage:
      cited === undefined
        ? undefined
        : { inWords: parts.join(' ').includes(cited.text), aPart: parts.includes(cited.text) },
  };
}

function rankedConceptIds(plan: unknown): readonly string[] {
  const body = (plan as { body?: { courses?: { concepts?: { conceptId: string }[] }[] } }).body;
  return (body?.courses ?? []).flatMap((course) =>
    (course.concepts ?? []).map((concept) => concept.conceptId),
  );
}

describe('D4: unchanged information across a restart and a re-cut (ol-egov.141.89.5.44, D-465)', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('the re-cut keeps every word and moves the cue boundaries', () => {
    const words = (text: string) => text.replace(/\s+/g, ' ').trim();
    expect(words(RECUT)).toBe(words(ORIGINAL));
    expect(RECUT.split('\n\n').length).not.toBe(ORIGINAL.split('\n\n').length);
  });

  it('the study plan and the plan-policy fingerprint are unchanged', async () => {
    const outcome = await restartAndRecut([KALOMI]);

    // The path ran: the read found the lecture's concept, its question was drafted from the
    // transcript and accepted, she answered it, and the standing plan ranks it, from the provider.
    expect(outcome.sessionOne).toMatchObject({ accepted: 1, answered: 2 });
    expect(outcome.sessionOne.landedVersion).toBe(await bytesHashOf(ORIGINAL));
    expect(outcome.transcriptConcept).toBeDefined();
    expect(rankedConceptIds(outcome.standing.plan)).toContain(outcome.transcriptConcept);
    expect(outcome.standing.source).toBe('provider');
    expect(outcome.after.source).toBe('provider');
    expect(outcome.standing.request?.courses[0]?.evidenceVolume).toBeGreaterThan(0);
    expect(outcome.after.request).toBeDefined();

    // Session two read the re-cut, and its citation pass checked the transcript's question, whose
    // cited passage is no longer one of the transcript's parts but still stands in its words.
    expect(outcome.sessionTwo.landedVersion).toBe(await bytesHashOf(RECUT));
    expect(outcome.sessionTwo.checked).toBe(1);
    expect(outcome.citedPassage).toEqual({ inWords: true, aPart: false });

    // The re-cut drafts nothing, asks no judge, withholds nothing, and sends no recompute.
    expect(outcome.sessionTwo).toMatchObject({ accepted: 0, answered: 0 });
    expect(outcome.judgeCallsInSessionTwo).toBe(0);
    expect(outcome.withheldAfterRecut).toBe(0);
    expect(outcome.policyPostsInSessionTwo).toBe(0);

    // D4.
    expect(outcome.after.plan).toEqual(outcome.standing.plan);
    expect(outcome.after.fingerprint).toBe(outcome.standing.fingerprint);
    expect(outcome.after.cachedFingerprint).toBe(outcome.standing.fingerprint);
  });

  it('the test can fail: one changed scripted response changes the plan and the fingerprint', async () => {
    // In session two the read also reports the concept the lecture's fourth cue names.
    const outcome = await restartAndRecut([KALOMI, VENIDO]);

    expect(outcome.sessionOne).toMatchObject({ accepted: 1, answered: 2 });
    expect(outcome.sessionTwo).toMatchObject({ accepted: 1, answered: 1 });
    expect(outcome.sessionTwo.landedVersion).toBe(await bytesHashOf(RECUT));
    expect(outcome.after.source).toBe('provider');
    expect(rankedConceptIds(outcome.after.plan)).toHaveLength(
      rankedConceptIds(outcome.standing.plan).length + 1,
    );
    expect(outcome.after.plan).not.toEqual(outcome.standing.plan);
    expect(outcome.after.fingerprint).not.toBe(outcome.standing.fingerprint);
    expect(outcome.policyPostsInSessionTwo).toBe(1);
    expect(outcome.after.cachedFingerprint).toBe(outcome.after.fingerprint);
  });

  it('a re-cut that also changes one word of the cited passage is new information: the judge is asked, the question withheld, and the plan and the fingerprint move', async () => {
    const changed = RECUT.replace('what we check first', 'what we check last');
    expect(changed).not.toBe(RECUT);
    const outcome = await restartAndRecut([KALOMI], changed);

    expect(outcome.sessionTwo.landedVersion).toBe(await bytesHashOf(changed));
    expect(outcome.judgeCallsInSessionTwo).toBe(1);
    expect(outcome.withheldAfterRecut).toBe(1);
    expect(outcome.after.source).toBe('provider');
    expect(outcome.after.plan).not.toEqual(outcome.standing.plan);
    expect(outcome.after.fingerprint).not.toBe(outcome.standing.fingerprint);
  });
});
