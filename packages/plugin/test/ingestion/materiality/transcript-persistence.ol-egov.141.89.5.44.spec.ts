// Scenarios: features/F1-sources.md, "reconstruction after restart and a reader-version change"
// and the part-grain change cases, here each met across a simulated restart (ol-egov.141.89.5.44;
// D-465, D-467; PERSISTENCE.md 2.2, 2.5, 2.7, 2.9 and section 3: A3, A6 to A9, the plugin half of
// B6, C1 to C7, C9, D1 to D3, the plugin half of E1, and F3 in every case). Test id:
// @auto:plugin/ingestion/materiality/transcript-persistence.ol-egov.141.89.5.44.spec
//
// A RESTART is a new session over the saved state (`transcript-restart-fixtures`): data.json read
// back from JSON, the vault's files as they are, every store and trigger built again. An edit case
// is made while Olea is closed, between two sessions, and the next session's citation pass meets
// it. Besides its own expectation, every edit case checks the anchor's outcome, the number of judge
// calls, which instruments are withheld (so that an unrelated instrument is still served), that her
// review history is unchanged but for the suspension a judged change adds, and that the transcript's
// bytes are unchanged afterwards (F3). Attainment is a fold over that history with withheld evidence
// kept ([D-338]); it is checked here through its input, the history, not by running the fold.
//
// Cases that fail today are pinned with `it.fails` and a name saying why: each turns red when the
// behaviour lands, and is then flipped to a plain `it`. Every transcript is synthetic (invented
// words, "course A"); nothing comes from a real vault.
import {
  findUnreadableFiles,
  hashContent,
  indexDocument,
  readConceptSize,
  type VaultPath,
} from 'olea-core';
import { describe, expect, it } from 'vitest';
import {
  type ResolvedLinksPort,
  readLectureBundles,
  teachingEventResolverFrom,
} from '../../../src/ingestion/lecture-links.js';
import { readTranscriptVersion } from '../../../src/ingestion/materiality/transcript-grain.js';
import {
  bytesHashOf,
  citeTranscriptPart,
  cue,
  FakeDataHost,
  historyAdded,
  historyOf,
  homeNote,
  inventedWord,
  LECTURE,
  MemoryVault,
  partCues,
  seedHistory,
  sidecar,
  spoken,
  transcriptOf,
} from './transcript-fixtures.ol-egov.141.89.5.43.js';
import {
  type CitationSession,
  citationSession,
  ingestionSession,
  keyText,
  manifestLogText,
  restartedHost,
  StoppingCitationStore,
  sidecarText,
} from './transcript-restart-fixtures.ol-egov.141.89.5.44.js';

const T = '01 Courses/COURSEA/Lecture 3/transcript.txt';
const HOME = '01 Courses/COURSEA/Lecture 3/transcript (Olea).md';
const IDS = ['q-four', 'q-two'] as const;
const DAY_ONE = new Date('2026-10-02T10:00:00Z');
const DAY_TWO = new Date('2026-10-03T10:00:00Z');
const DAY_THREE = new Date('2026-10-04T10:00:00Z');

/** q-four cites part 4 and q-two part 2, both drafted from the transcript as it stands. */
async function lectureVault(cues: readonly string[] = LECTURE): Promise<MemoryVault> {
  const vault = new MemoryVault();
  vault.files.set(T, transcriptOf(cues));
  vault.files.set(HOME, homeNote('Invented lecture topic', IDS));
  await citeTranscriptPart(vault, 'q-four', T, 4);
  await citeTranscriptPart(vault, 'q-two', T, 2);
  await seedHistory(vault, IDS);
  return vault;
}

/** The first session: each anchor seeded from its cited part, nothing withheld. Returns what it saved. */
async function firstSession(
  vault?: MemoryVault,
  host: FakeDataHost = new FakeDataHost(),
): Promise<{ vault: MemoryVault; host: FakeDataHost }> {
  const v = vault ?? (await lectureVault());
  const s = citationSession(host);
  await s.pass(v);
  expect(await s.withheld(IDS)).toEqual(new Set());
  const anchors = await s.anchors();
  expect(anchors.get('q-four')?.text).toBe(spoken(partCues(4)));
  expect(anchors.get('q-two')?.text).toBe(spoken(partCues(2)));
  return { vault: v, host };
}

/** The next session, over what the last one saved. */
function nextSession(host: FakeDataHost, now = 2_000): CitationSession {
  return citationSession(restartedHost(host), { now });
}

async function anchorOf(s: CitationSession, id: string) {
  return (await s.anchors()).get(id);
}

/** What every edit case checks besides its own expectation (module doc). */
async function expectEditOutcome(
  s: CitationSession,
  vault: MemoryVault,
  history: readonly string[],
  transcriptAfterEdit: string | undefined,
  expected: {
    readonly judgeCalls: number;
    readonly withheld: readonly string[];
    readonly suspended: readonly string[];
  },
): Promise<void> {
  expect(s.judge.judge).toHaveBeenCalledTimes(expected.judgeCalls);
  expect(await s.withheld(IDS)).toEqual(new Set(expected.withheld));
  expect(historyAdded(history, vault)).toEqual(expected.suspended);
  expect(s.actions.onRelocationProposed).not.toHaveBeenCalled();
  expect(vault.files.get(T)).toBe(transcriptAfterEdit);
}

/** Her links as Obsidian resolves them: `[[name]]` in a Markdown file, to a file in its folder. */
function linksPort(vault: MemoryVault): ResolvedLinksPort {
  const exists = (path: string) => vault.files.has(path) || vault.binaries.has(path);
  return {
    resolvedLinks() {
      const out = new Map<VaultPath, VaultPath[]>();
      for (const [path, text] of vault.files) {
        if (!path.endsWith('.md') || path.startsWith('.olea/')) continue;
        const folder = path.slice(0, path.lastIndexOf('/'));
        const targets = [...text.matchAll(/\[\[([^\]]+)\]\]/g)]
          .map((match) => `${folder}/${match[1]}`)
          .filter(exists);
        if (targets.length > 0) out.set(path, targets);
      }
      return out;
    },
    frontmatterFor(path) {
      const role = vault.files.get(path)?.match(/^---\n[\s\S]*?^role: (.+)$/m)?.[1];
      return role === undefined ? undefined : { role };
    },
  };
}

describe('C: the edit cases, each made while Olea was closed and met by the next session', () => {
  it('C1, a cue inserted outside the cited passages: both present, no judge, both served', async () => {
    const { vault, host } = await firstSession();
    const history = historyOf(vault);
    const edited = transcriptOf([...LECTURE.slice(0, 3), cue(91), ...LECTURE.slice(3)]);
    vault.files.set(T, edited);
    const s = nextSession(host);
    await s.pass(vault);
    expect((await anchorOf(s, 'q-four'))?.text).toBe(spoken(partCues(4)));
    expect((await anchorOf(s, 'q-two'))?.text).toBe(spoken(partCues(2)));
    expect(s.actions.enqueue).not.toHaveBeenCalled();
    await expectEditOutcome(s, vault, history, edited, {
      judgeCalls: 0,
      withheld: [],
      suspended: [],
    });
  });

  it('C1, a cue inserted inside a cited passage: one judge call, old against new, and its verdict applied to that instrument alone', async () => {
    const { vault, host } = await firstSession();
    const history = historyOf(vault);
    const [first, second, third] = partCues(4) as [string, string, string];
    const edited = transcriptOf([
      ...LECTURE.slice(0, 9),
      first,
      cue(92),
      second,
      third,
      ...LECTURE.slice(12),
    ]);
    vault.files.set(T, edited);
    const s = nextSession(host);
    await s.pass(vault);
    expect(s.judge.judge.mock.calls[0]?.[0]).toEqual({
      previousText: spoken(partCues(4)),
      currentText: spoken([first, cue(92), second, third]),
    });
    expect(s.actions.suspend.mock.calls.map((call) => call[0])).toEqual(['q-four']);
    expect(s.actions.enqueue).toHaveBeenCalledTimes(1);
    await expectEditOutcome(s, vault, history, edited, {
      judgeCalls: 1,
      withheld: ['q-four'],
      suspended: ['q-four'],
    });
  });

  it('C2, a cue split in two with the same text: present, no judge', async () => {
    const { vault, host } = await firstSession();
    const history = historyOf(vault);
    const [first, second, third] = partCues(4) as [string, string, string];
    const cut = first.indexOf(' So a ');
    const edited = transcriptOf([
      ...LECTURE.slice(0, 9),
      first.slice(0, cut),
      first.slice(cut + 1),
      second,
      third,
      ...LECTURE.slice(12),
    ]);
    vault.files.set(T, edited);
    const s = nextSession(host);
    await s.pass(vault);
    expect((await anchorOf(s, 'q-four'))?.text).toBe(spoken(partCues(4)));
    await expectEditOutcome(s, vault, history, edited, {
      judgeCalls: 0,
      withheld: [],
      suspended: [],
    });
  });

  it('C3, two cues merged into one: present, no judge', async () => {
    const { vault, host } = await firstSession();
    const history = historyOf(vault);
    const [first, second, third] = partCues(4) as [string, string, string];
    const edited = transcriptOf([
      ...LECTURE.slice(0, 9),
      first,
      `${second}\n${third}`,
      ...LECTURE.slice(12),
    ]);
    vault.files.set(T, edited);
    const s = nextSession(host);
    await s.pass(vault);
    expect((await anchorOf(s, 'q-four'))?.text).toBe(spoken(partCues(4)));
    await expectEditOutcome(s, vault, history, edited, {
      judgeCalls: 0,
      withheld: [],
      suspended: [],
    });
  });

  const corrected = (): string[] => {
    const cues = [...LECTURE];
    cues[10] = (cues[10] as string).replace(inventedWord(10 * 40 + 3 + 17), inventedWord(4000));
    return cues;
  };

  it('C4, a term correction: one region and one judge call with the old and new text; the instrument on an unchanged part is served', async () => {
    const { vault, host } = await firstSession();
    const history = historyOf(vault);
    const cues = corrected();
    const edited = transcriptOf(cues);
    vault.files.set(T, edited);
    const s = nextSession(host);
    await s.pass(vault);
    expect(s.judge.judge.mock.calls[0]?.[0]).toEqual({
      previousText: spoken(partCues(4)),
      currentText: spoken(cues.slice(9, 12)),
    });
    await expectEditOutcome(s, vault, history, edited, {
      judgeCalls: 1,
      withheld: ['q-four'],
      suspended: ['q-four'],
    });
  });

  // PERSISTENCE.md 2.5, the carry rule: a part of the new version whose text equals a part of the
  // previous version keeps that part's concept-extraction state. Not built: the unit manifest store
  // enumerates a changed transcript afresh (`grove/unit-manifest-store.ts`, `ensureEnumerated`,
  // lines 349-419), every part waiting and not extracted. Within one session that is a code gap: the
  // store read the previous version's text when it enumerated it. Across a restart it is more: the
  // reading record keeps no part text or digest (`core/src/ingestion/unit-manifest/records.ts`, the
  // `enumerated` record holds `pages` only), and the previous bytes are gone, so nothing persisted
  // can say which new part equals which old one.
  async function correctedAfterReading(restart: boolean) {
    const vault = await lectureVault();
    const first = await ingestionSession(new FakeDataHost(), vault, DAY_ONE);
    await first.manifests.manifestsFor([T]);
    await first.manifests.recordConceptExtraction([T]);
    vault.files.set(T, transcriptOf(corrected()));
    let store = first.manifests;
    if (restart) {
      store = (await ingestionSession(new FakeDataHost(), vault, DAY_TWO)).manifests;
    } else {
      store.observe({ kind: 'modify', path: T });
    }
    const manifest = (await store.manifestsFor([T])).get(T);
    return manifest?.entries.map((entry) => [entry.page, entry.conceptExtractionState]);
  }

  it.fails('C4 [not built: the carry rule, unit-manifest-store.ts:349-419] within one session, unchanged parts keep their concept-extraction state', async () => {
    expect(await correctedAfterReading(false)).toEqual([
      [1, 'complete'],
      [2, 'complete'],
      [3, 'complete'],
      [4, 'not-started'],
      [5, 'complete'],
      [6, 'complete'],
    ]);
  });

  it.fails('C4 [needs a persisted change: no part identity in the reading record] across a restart, unchanged parts keep their concept-extraction state', async () => {
    expect(await correctedAfterReading(true)).toEqual([
      [1, 'complete'],
      [2, 'complete'],
      [3, 'complete'],
      [4, 'not-started'],
      [5, 'complete'],
      [6, 'complete'],
    ]);
  });

  it('C4, the half that holds: after the correction, the new version is enumerated with every part waiting, never read by omission', async () => {
    const vault = await lectureVault();
    const first = await ingestionSession(new FakeDataHost(), vault, DAY_ONE);
    await first.manifests.manifestsFor([T]);
    await first.manifests.recordConceptExtraction([T]);
    vault.files.set(T, transcriptOf(corrected()));
    const second = await ingestionSession(new FakeDataHost(), vault, DAY_TWO);
    const manifest = (await second.manifests.manifestsFor([T])).get(T);
    expect(manifest?.revisionDigest).toBe(await bytesHashOf(transcriptOf(corrected())));
    expect(manifest?.entries.map((entry) => entry.readingState.kind)).toEqual(
      Array(6).fill('pending'),
    );
  });

  it('C5, a rename seen while running: the anchors are re-keyed and survive the restart; present, no judge, and no new arrival', async () => {
    const vault = await lectureVault();
    const host = new FakeDataHost();
    const ingest = await ingestionSession(host, vault, DAY_ONE);
    await ingest.arrive([T], 1);
    await ingest.drain();
    await firstSession(vault, host);
    const history = historyOf(vault);

    const running = nextSession(host);
    const moved = '01 Courses/COURSEA/Transcripts/lecture three.txt';
    vault.move(T, moved);
    expect(await running.trigger.onSourceRenamed(vault, T, moved)).toBe(2);

    const s = nextSession(running.host, 3_000);
    await s.pass(vault);
    expect([...(await s.anchors()).values()].map((anchor) => anchor.sourcePath)).toEqual([
      moved,
      moved,
    ]);
    expect((await anchorOf(s, 'q-four'))?.text).toBe(spoken(partCues(4)));
    expect(s.judge.judge).not.toHaveBeenCalled();
    expect(await s.withheld(IDS)).toEqual(new Set());
    expect(historyAdded(history, vault)).toEqual([]);

    // The next session's vault load reports the file at its new path: the same bytes, no new job.
    const again = await ingestionSession(restartedHost(s.host), vault, DAY_TWO);
    const jobs = again.engine.list().length;
    await again.arrive([moved], 1);
    expect(again.enqueues).toEqual([{ status: 'duplicate', existingStatus: 'done' }]);
    expect(again.engine.list()).toHaveLength(jobs);
  });

  // PERSISTENCE.md 1.1 row 10 and 2.1: an observed rename moves the processed-revision row and
  // keeps its day. Not built: nothing in `ingestion/processed-revisions/` handles a rename, and the
  // trigger's `onSourceRenamed` moves anchors only. A code gap: the row's shape is unchanged.
  it.fails('C5 [not built: no rename handling in processed-revisions/] a rename seen while running moves the processed-revision row and keeps its day', async () => {
    const vault = await lectureVault();
    const host = new FakeDataHost();
    const first = await ingestionSession(host, vault, DAY_ONE);
    await first.arrive([T], 1);
    await first.drain();
    const row = (await first.revisionsNow()).revisions[T];
    expect(row?.state).toBe('read');
    const moved = '01 Courses/COURSEA/Transcripts/lecture three.txt';
    vault.move(T, moved);
    const second = await ingestionSession(restartedHost(host), vault, DAY_TWO);
    await second.arrive([moved], 1);
    await second.drain();
    expect((await second.revisionsNow()).revisions[moved]).toEqual(row);
  });

  it('C5, a rename while Olea was closed: a delete and a create, so the instruments are withheld and the new path is read as a new file', async () => {
    const { vault, host } = await firstSession();
    const history = historyOf(vault);
    const moved = '01 Courses/COURSEA/Transcripts/transcript.txt';
    vault.move(T, moved);
    const s = nextSession(host);
    await s.pass(vault);
    const anchors = await s.anchors();
    for (const id of IDS) {
      expect(anchors.get(id)?.sourcePath).toBe(T);
      expect(anchors.get(id)?.pendingRevalidation?.reason).toBe('passage-missing');
    }
    expect(s.actions.enqueue).not.toHaveBeenCalled();
    expect(s.actions.suspend).not.toHaveBeenCalled();
    await expectEditOutcome(s, vault, history, undefined, {
      judgeCalls: 0,
      withheld: [...IDS],
      suspended: [],
    });
    expect(vault.files.get(moved)).toBe(transcriptOf(LECTURE));

    // The new path has a reading record of its own, enumerated afresh, every part waiting.
    const ingest = await ingestionSession(restartedHost(s.host), vault, DAY_TWO);
    const manifest = (await ingest.manifests.manifestsFor([moved])).get(moved);
    expect(manifest?.sourcePath).toBe(moved);
    expect(manifest?.entries).toHaveLength(6);
  });

  // PERSISTENCE.md 1.1 row 10: "An unobserved rename makes a new row, so the file reads as newly
  // processed." Not so for the same bytes: the queue dedups by bytes and ignores the path, so the
  // new path's enqueue is a duplicate, and the feed records only an admitted enqueue
  // (`processed-revisions/feed.ts`, `observeEnqueues`, lines 297-322); the start's rebuild lists no
  // `.txt` (`current-revisions.ts`, `listCurrentRevisions`, lines 153-157). A code gap: no field is
  // needed.
  it.fails('C5 [not built: feed.ts:297-322 records only an admitted enqueue] a rename while closed gives the new path a processed-revision row', async () => {
    const vault = await lectureVault();
    const host = new FakeDataHost();
    const first = await ingestionSession(host, vault, DAY_ONE);
    await first.arrive([T], 1);
    await first.drain();
    const moved = '01 Courses/COURSEA/Transcripts/transcript.txt';
    vault.move(T, moved);
    const second = await ingestionSession(restartedHost(host), vault, DAY_TWO);
    await second.arrive([moved], 1);
    await second.drain();
    expect((await second.revisionsNow()).revisions[moved]).toMatchObject({
      state: 'read',
      firstProcessedDay: '2026-10-03',
    });
  });

  it('C6, a re-export over the same file (lineage by edit in place), re-cut: relocated by text, no judge', async () => {
    const { vault, host } = await firstSession();
    const history = historyOf(vault);
    const reExport = LECTURE.map((text, k) =>
      k === 16 ? `${text} An added closing remark.` : text,
    );
    const paired: string[] = [];
    for (let k = 0; k < reExport.length; k += 2) {
      paired.push(`${reExport[k]}\n${reExport[k + 1] ?? ''}`.trim());
    }
    const edited = transcriptOf(paired);
    vault.files.set(T, edited);
    const s = nextSession(host);
    await s.pass(vault);
    expect((await anchorOf(s, 'q-two'))?.text).toBe(spoken(partCues(2)));
    expect((await anchorOf(s, 'q-four'))?.text).toBe(spoken(partCues(4)));
    await expectEditOutcome(s, vault, history, edited, {
      judgeCalls: 0,
      withheld: [],
      suspended: [],
    });
  });

  it('C6, a replacement at a new path with the old file deleted and no declaration: withheld, never moved', async () => {
    const { vault, host } = await firstSession();
    const history = historyOf(vault);
    vault.files.delete(T);
    vault.files.set(
      '01 Courses/COURSEA/Lecture 3/transcript (re-export).txt',
      transcriptOf(LECTURE),
    );
    const s = nextSession(host);
    await s.pass(vault);
    expect([...(await s.anchors()).values()].map((anchor) => anchor.sourcePath)).toEqual([T, T]);
    await expectEditOutcome(s, vault, history, undefined, {
      judgeCalls: 0,
      withheld: [...IDS],
      suspended: [],
    });
  });

  it('C6, a replacement at a new path with the old file kept: the old citations are unchanged and served', async () => {
    const { vault, host } = await firstSession();
    const history = historyOf(vault);
    const before = keyText(host, 'citationRevisionAnchors');
    vault.files.set(
      '01 Courses/COURSEA/Lecture 3/transcript v2.txt',
      transcriptOf([cue(81), ...LECTURE.slice(0, 9)]),
    );
    const s = nextSession(host);
    await s.pass(vault);
    expect(keyText(s.host, 'citationRevisionAnchors')).toBe(before);
    await expectEditOutcome(s, vault, history, transcriptOf(LECTURE), {
      judgeCalls: 0,
      withheld: [],
      suspended: [],
    });
  });

  // PERSISTENCE.md section 3 C6: "the two files are one teaching event (a T6 guard)", that is, the
  // kept file and its re-export change neither a concept's size nor its allocation (PROPOSAL.md 4.5:
  // duplicated content never raises extent). Not so: a teaching event is a lecture bundle, made only
  // by her explicit links (`lecture-links.ts`, `teachingEventResolverFrom`), and an unlinked
  // transcript is its own event (core `concept/size.ts`, `countPassagesByTeachingEvent`, lines
  // 206-225), so the re-export counts again. With a note linking both they are one event (core
  // `concept/repetition-guards.ol-egov.141.89.3.43.spec.ts`). A code gap in the repetition guard
  // (duplicated content at a second path); no persisted change.
  it.fails('C6 [not built: an unlinked kept re-export counts as a second teaching event, core concept/size.ts:206-225] the kept file and its re-export leave the concept size reading where it was', async () => {
    const reExport = '01 Courses/COURSEA/Lecture 3/transcript v2.txt';
    const vault = await lectureVault();
    vault.files.set(reExport, transcriptOf(LECTURE));
    const teachingEventOf = teachingEventResolverFrom(readLectureBundles(linksPort(vault)));
    const note = {
      sourcePath: '01 Courses/COURSEA/notes/an idea.md',
      location: { page: 1, charRange: { start: 0, end: 10 } },
    };
    const part = (sourcePath: VaultPath) => ({
      sourcePath,
      location: { page: 4, charRange: { start: 0, end: 10 }, transcriptPart: {} },
    });
    const before = readConceptSize({
      anchor: note,
      alsoIn: [part(T)],
      sourcePaths: [],
      teachingEventOf,
    });
    const after = readConceptSize({
      anchor: note,
      alsoIn: [part(T), part(reExport)],
      sourcePaths: [],
      teachingEventOf,
    });
    expect(after).toEqual(before);
  });

  it('C7, the cited text now stands twice: withheld as ambiguous, nothing judged; found once again, the hold lifts after a further restart', async () => {
    const { vault, host } = await firstSession();
    const history = historyOf(vault);
    const edited = transcriptOf([...LECTURE, ...partCues(4)]);
    vault.files.set(T, edited);
    const s = nextSession(host);
    await s.pass(vault);
    expect((await anchorOf(s, 'q-four'))?.pendingRevalidation?.reason).toBe('passage-ambiguous');
    await expectEditOutcome(s, vault, history, edited, {
      judgeCalls: 0,
      withheld: ['q-four'],
      suspended: [],
    });

    vault.files.set(T, transcriptOf(LECTURE));
    const third = nextSession(s.host, 3_000);
    await third.pass(vault);
    expect(await third.withheld(IDS)).toEqual(new Set());
    expect(third.judge.judge).not.toHaveBeenCalled();
  });

  it('C9, the file goes back to earlier bytes: the earlier reading record is live again with its readings, and no job is added', async () => {
    const v1 = transcriptOf(LECTURE);
    const v2 = transcriptOf(corrected());
    const vault = await lectureVault();
    const host = new FakeDataHost();
    const first = await ingestionSession(host, vault, DAY_ONE);
    await first.arrive([T], 1);
    await first.drain();
    await first.manifests.manifestsFor([T]);
    await first.manifests.recordTranscriptReading(T, [1, 2]);

    vault.files.set(T, v2);
    const secondHost = restartedHost(host);
    const second = await ingestionSession(secondHost, vault, DAY_TWO);
    await second.arrive([T], 1);
    await second.drain();
    const atV2 = (await second.manifests.manifestsFor([T])).get(T);
    expect(atV2?.revisionDigest).toBe(await bytesHashOf(v2));
    expect(atV2?.entries.filter((entry) => entry.readingState.kind === 'read')).toHaveLength(0);

    vault.files.set(T, v1);
    const third = await ingestionSession(restartedHost(secondHost), vault, DAY_THREE);
    const jobs = third.engine.list();
    expect(jobs).toHaveLength(2);
    await third.arrive([T], 1);
    expect(third.enqueues).toEqual([{ status: 'duplicate', existingStatus: 'done' }]);
    expect(third.engine.list()).toEqual(jobs);
    const atV1 = (await third.manifests.manifestsFor([T])).get(T);
    expect(atV1?.revisionDigest).toBe(await bytesHashOf(v1));
    expect(
      atV1?.entries.filter((entry) => entry.readingState.kind === 'read').map((e) => e.page),
    ).toEqual([1, 2]);
    expect(vault.files.get(T)).toBe(v1);
  });
});

describe('D: restart', () => {
  it('D1, a full persisted state, then a restart: anchors, sidecars, reading records, processed revisions and the queue reconstruct identically, and association is re-derived equal', async () => {
    const vault = await lectureVault();
    vault.binaries.set('01 Courses/COURSEA/Lecture 3/slides.pdf', new Uint8Array([37, 80, 68, 70]));
    vault.files.set(
      '01 Courses/COURSEA/Lecture 3/Lecture 3.md',
      '# Lecture 3\n\n[[transcript.txt]] with [[slides.pdf]].\n',
    );
    const host = new FakeDataHost();
    const first = await ingestionSession(host, vault, DAY_ONE);
    await first.arrive([T], 1);
    await first.drain();
    const manifestBefore = (await first.manifests.manifestsFor([T])).get(T);
    await first.manifests.recordTranscriptReading(T, [1, 2, 3]);
    await firstSession(vault, host);
    const bundlesBefore = readLectureBundles(linksPort(vault));
    expect(bundlesBefore).toEqual([
      {
        members: ['01 Courses/COURSEA/Lecture 3/slides.pdf', T],
        via: ['01 Courses/COURSEA/Lecture 3/Lecture 3.md'],
      },
    ]);
    const saved = {
      anchors: keyText(host, 'citationRevisionAnchors'),
      queue: keyText(host, 'ingestionQueue'),
      revisions: JSON.stringify((await first.revisionsNow()).revisions),
      log: manifestLogText(vault),
      sidecars: sidecarText(vault),
      manifest: (await first.manifests.manifestsFor([T])).get(T),
    };
    expect(manifestBefore?.entries).toHaveLength(6);

    // The restart: the vault load reports the transcript again, and the citation pass runs.
    const restarted = restartedHost(host);
    const second = await ingestionSession(restarted, vault, DAY_TWO);
    await second.arrive([T], 1);
    await second.drain();
    expect(second.enqueues).toEqual([{ status: 'duplicate', existingStatus: 'done' }]);
    expect((await second.manifests.manifestsFor([T])).get(T)).toEqual(saved.manifest);
    const s = citationSession(restarted, { now: 2_000 });
    await s.pass(vault);

    expect(s.judge.judge).not.toHaveBeenCalled();
    expect(await s.withheld(IDS)).toEqual(new Set());
    expect(keyText(restarted, 'citationRevisionAnchors')).toBe(saved.anchors);
    expect(keyText(restarted, 'ingestionQueue')).toBe(saved.queue);
    expect(JSON.stringify((await second.revisionsNow()).revisions)).toBe(saved.revisions);
    expect(manifestLogText(vault)).toBe(saved.log);
    expect(sidecarText(vault)).toBe(saved.sidecars);
    // Association is stored nowhere: re-derived from her links, it is the same.
    expect(readLectureBundles(linksPort(vault))).toEqual(bundlesBefore);
    expect(
      Object.keys(restarted.blob).filter((key) => /lecture|bundle|associat/i.test(key)),
    ).toEqual([]);
    expect(vault.files.get(T)).toBe(transcriptOf(LECTURE));
  });

  it('D2, a rename seen while running, the plugin stopping part-way through re-keying, then a restart: the re-keyed anchor carries on, the other withholds, nothing is healed', async () => {
    const { vault, host } = await firstSession();
    const history = historyOf(vault);
    const moved = '01 Courses/COURSEA/Lecture 3/lecture three.txt';
    vault.move(T, moved);
    const running = citationSession(restartedHost(host), { now: 2_000 });
    const stopping = citationSession(running.host, {
      now: 2_000,
      store: new StoppingCitationStore(running.host, 1),
    });
    expect(await stopping.trigger.onSourceRenamed(vault, T, moved)).toBe(1);

    const s = nextSession(running.host, 3_000);
    await s.pass(vault);
    const anchors = await s.anchors();
    const onNew = IDS.filter((id) => anchors.get(id)?.sourcePath === moved);
    const onOld = IDS.filter((id) => anchors.get(id)?.sourcePath === T);
    expect(onNew).toHaveLength(1);
    expect(onOld).toHaveLength(1);
    expect(anchors.get(onOld[0] as string)?.pendingRevalidation?.reason).toBe('passage-missing');
    expect(anchors.get(onNew[0] as string)?.pendingRevalidation).toBeUndefined();
    expect(await s.withheld(IDS)).toEqual(new Set(onOld));
    expect(s.judge.judge).not.toHaveBeenCalled();
    expect(s.actions.onRelocationProposed).not.toHaveBeenCalled();
    expect(s.actions.suspend).not.toHaveBeenCalled();
    expect(historyAdded(history, vault)).toEqual([]);
    expect(vault.files.get(moved)).toBe(transcriptOf(LECTURE));
  });

  it('D3, a device with no anchor table: seeded where the bytes equal the citation’s recorded version', async () => {
    const vault = await lectureVault();
    // The second device has her vault (sidecars, transcript) but a data.json of its own.
    const deviceTwo = citationSession(new FakeDataHost());
    await deviceTwo.pass(vault);
    expect((await anchorOf(deviceTwo, 'q-four'))?.text).toBe(spoken(partCues(4)));
    expect(await deviceTwo.withheld(IDS)).toEqual(new Set());
    expect(deviceTwo.judge.judge).not.toHaveBeenCalled();
  });

  it('D3, a device with no anchor table, after the transcript changed: withheld there, though the device that saw the change still serves both', async () => {
    const { vault, host } = await firstSession();
    const edited = transcriptOf([...LECTURE.slice(0, 3), cue(91), ...LECTURE.slice(3)]);
    vault.files.set(T, edited);
    const deviceOne = nextSession(host);
    await deviceOne.pass(vault);
    expect(await deviceOne.withheld(IDS)).toEqual(new Set());

    const deviceTwo = citationSession(new FakeDataHost());
    await deviceTwo.pass(vault);
    const anchors = await deviceTwo.anchors();
    for (const id of IDS) {
      expect(anchors.get(id)?.text).toBe('');
      expect(anchors.get(id)?.pendingRevalidation?.reason).toBe('passage-missing');
    }
    expect(await deviceTwo.withheld(IDS)).toEqual(new Set(IDS));
    expect(deviceTwo.judge.judge).not.toHaveBeenCalled();
    expect(vault.files.get(T)).toBe(edited);
  });
});

describe('A: the demonstrations [D-465] requires, across a restart', () => {
  it('A3, a transcript-declared file in a format no reader handles: "no reader for this format", never read, never a transcript with no content', async () => {
    const vtt = '01 Courses/COURSEA/Lecture 5/captions.vtt';
    const vault = new MemoryVault();
    vault.files.set(vtt, 'WEBVTT\n\n00:00:01.000 --> 00:00:04.000\nAn invented caption line.\n');
    const host = new FakeDataHost();
    for (const [session, day] of [
      [host, DAY_ONE],
      [restartedHost(host), DAY_TWO],
    ] as const) {
      const ingest = await ingestionSession(session, vault, day);
      await ingest.arrive([vtt], 0);
      await ingest.drain();
      expect(ingest.enqueues).toEqual([]);
      expect(ingest.engine.list()).toEqual([]);
      const manifests = await ingest.manifests.manifestsFor([vtt]);
      expect(manifests.has(vtt)).toBe(false);
      expect(
        await findUnreadableFiles(vault, { files: [vtt], linkedPaths: new Set([vtt]), manifests }),
      ).toEqual([{ path: vtt, reason: 'no-reader-for-format' }]);
      expect((await ingest.revisionsNow()).revisions[vtt]).toBeUndefined();
    }
    expect(manifestLogText(vault)).toBe('[]');
  });

  it('A6, two transcripts linked from one lecture note, one deleted while closed: its instruments are withheld, never healed onto the other', async () => {
    const vault = await lectureVault();
    const other = '01 Courses/COURSEA/Lecture 3/transcript (captions).txt';
    vault.files.set(other, transcriptOf(LECTURE));
    vault.files.set(
      '01 Courses/COURSEA/Lecture 3/Lecture 3.md',
      '# Lecture 3\n\n[[transcript.txt]] and [[transcript (captions).txt]].\n',
    );
    const { host } = await firstSession(vault);
    const history = historyOf(vault);
    vault.files.delete(T);
    const s = nextSession(host);
    await s.pass(vault);
    expect([...(await s.anchors()).values()].map((anchor) => anchor.sourcePath)).toEqual([T, T]);
    await expectEditOutcome(s, vault, history, undefined, {
      judgeCalls: 0,
      withheld: [...IDS],
      suspended: [],
    });
    expect(vault.files.get(other)).toBe(transcriptOf(LECTURE));
  });

  it('A7, two versions whose part 3 holds different text: the passage is found by its text only', async () => {
    const vault = await lectureVault();
    await citeTranscriptPart(vault, 'q-three', T, 3);
    vault.files.set(HOME, homeNote('Invented lecture topic', [...IDS, 'q-three']));
    const host = new FakeDataHost();
    const first = citationSession(host);
    await first.pass(vault);
    const partThreeBefore = (await anchorOf(first, 'q-three'))?.text;
    expect(partThreeBefore).toBe(spoken(partCues(3)));

    const edited = transcriptOf([cue(93), cue(94), cue(95), ...LECTURE]);
    vault.files.set(T, edited);
    const revisionTwo = await readTranscriptVersion(vault, T);
    if (revisionTwo.kind !== 'read') throw new Error('revision two does not read');
    expect(revisionTwo.version.parts[2]?.spoken).not.toBe(partThreeBefore);

    const s = nextSession(host);
    await s.pass(vault);
    expect(s.judge.judge).not.toHaveBeenCalled();
    expect((await anchorOf(s, 'q-three'))?.text).toBe(partThreeBefore);
    expect(await s.withheld([...IDS, 'q-three'])).toEqual(new Set());
    expect(vault.files.get(T)).toBe(edited);
  });

  it('A8, the cited text also stands in another transcript and the cited file is deleted: withheld as missing, no silent heal, no proposal', async () => {
    const vault = await lectureVault();
    const other = '01 Courses/COURSEA/Lecture 9/recap transcript.txt';
    vault.files.set(other, transcriptOf([cue(70), ...partCues(4), ...partCues(2), cue(71)]));
    const { host } = await firstSession(vault);
    const history = historyOf(vault);
    vault.files.delete(T);
    const s = nextSession(host);
    await s.pass(vault);
    const anchors = await s.anchors();
    for (const id of IDS) {
      expect(anchors.get(id)?.sourcePath).toBe(T);
      expect(anchors.get(id)?.pendingRevalidation?.reason).toBe('passage-missing');
    }
    await expectEditOutcome(s, vault, history, undefined, {
      judgeCalls: 0,
      withheld: [...IDS],
      suspended: [],
    });
  });

  it('A9, a transcript and a deck sharing a stem and so a home note: no association, and a transcript correction leaves the deck’s item untouched', async () => {
    const deck = '01 Courses/COURSEA/Lecture 3/Lecture 3.pdf';
    const transcript = '01 Courses/COURSEA/Lecture 3/Lecture 3.txt';
    const shared = '01 Courses/COURSEA/Lecture 3/Lecture 3.md';
    const deckBytes = new Uint8Array([37, 80, 68, 70, 45, 49, 46, 55]);
    const vault = new MemoryVault();
    vault.binaries.set(deck, deckBytes);
    vault.files.set(transcript, transcriptOf(LECTURE));
    vault.files.set(shared, homeNote('Invented lecture topic', ['q-deck', 'q-talk']));
    vault.files.set(
      '.olea/citations/q-deck.json',
      sidecar({
        instrumentId: 'q-deck',
        sourcePath: deck,
        page: 2,
        sourceRevision: await hashContent(deckBytes),
      }),
    );
    await citeTranscriptPart(vault, 'q-talk', transcript, 4);
    await seedHistory(vault, ['q-deck', 'q-talk']);
    expect(readLectureBundles(linksPort(vault))).toEqual([]);

    const host = new FakeDataHost();
    const first = citationSession(host);
    await first.pass(vault);
    expect(await first.withheld(['q-deck', 'q-talk'])).toEqual(new Set());
    const deckAnchor = keyText(host, 'citationRevisionAnchors');
    expect((JSON.parse(deckAnchor) as Record<string, unknown>)['q-deck']).toBeDefined();
    const history = historyOf(vault);

    const cues = [...LECTURE];
    cues[10] = (cues[10] as string).replace(inventedWord(10 * 40 + 3 + 17), inventedWord(4005));
    vault.files.set(transcript, transcriptOf(cues));
    const s = nextSession(host);
    await s.pass(vault);
    expect(s.judge.judge).toHaveBeenCalledTimes(1);
    expect(s.actions.suspend.mock.calls.map((call) => call[0])).toEqual(['q-talk']);
    expect(await s.withheld(['q-deck'])).toEqual(new Set());
    expect(
      (JSON.parse(keyText(s.host, 'citationRevisionAnchors')) as Record<string, unknown>)['q-deck'],
    ).toEqual((JSON.parse(deckAnchor) as Record<string, unknown>)['q-deck']);
    expect(historyAdded(history, vault)).toEqual(['q-talk']);
    expect(readLectureBundles(linksPort(vault))).toEqual([]);
    expect(vault.binaries.get(deck)).toBe(deckBytes);
  });
});

describe('B6, the plugin half: a byte-identical copy at a second path', () => {
  it('the second job is a duplicate, yet the second path has its own reading record and index document, and no lineage', async () => {
    const copy = '01 Courses/COURSEA/Lecture 3 copy/transcript.txt';
    const vault = await lectureVault();
    vault.files.set(copy, transcriptOf(LECTURE));
    const host = new FakeDataHost();
    const ingest = await ingestionSession(host, vault, DAY_ONE);
    await ingest.arrive([T, copy], 2);
    await ingest.drain();
    expect(ingest.enqueues).toEqual([
      { status: 'queued' },
      { status: 'duplicate', existingStatus: 'queued' },
    ]);
    const manifests = await ingest.manifests.manifestsFor([T, copy]);
    expect(manifests.get(T)?.sourcePath).toBe(T);
    expect(manifests.get(copy)?.sourcePath).toBe(copy);
    expect(manifests.get(copy)?.revisionDigest).toBe(manifests.get(T)?.revisionDigest);
    expect(manifests.get(copy)?.entries).toHaveLength(6);
    const [indexA, indexB] = await Promise.all([
      indexDocument(vault, T),
      indexDocument(vault, copy),
    ]);
    expect(indexA.path).toBe(T);
    expect(indexB.path).toBe(copy);
    expect(indexB.blocks).toEqual(indexA.blocks);

    // No lineage: with the cited file gone, nothing moves onto the copy.
    await firstSession(vault, host);
    vault.files.delete(T);
    const s = nextSession(host);
    await s.pass(vault);
    expect([...(await s.anchors()).values()].map((anchor) => anchor.sourcePath)).toEqual([T, T]);
    expect(await s.withheld(IDS)).toEqual(new Set(IDS));
    expect(s.actions.onRelocationProposed).not.toHaveBeenCalled();
  });
});

describe('E1, the plugin half: a new reader version, with the part rule unchanged', () => {
  it('the transcript is re-read once; the reading record writes nothing; anchors, sidecars, and the processed-revision fingerprint and day are unchanged', async () => {
    const vault = await lectureVault();
    const host = new FakeDataHost();
    const first = await ingestionSession(host, vault, DAY_ONE);
    await first.arrive([T], 1);
    await first.drain();
    await first.manifests.manifestsFor([T]);
    await firstSession(vault, host);
    const row = (await first.revisionsNow()).revisions[T];
    expect(row).toMatchObject({ state: 'read', firstProcessedDay: '2026-10-02' });

    // The next build reads transcripts with a new reader version: the job on record was queued
    // under the one before it.
    const restarted = restartedHost(host);
    const queue = restarted.blob.ingestionQueue as { jobs: { workflowVersion?: string }[] };
    expect(queue.jobs).toHaveLength(1);
    (queue.jobs[0] as { workflowVersion?: string }).workflowVersion = 'transcript-reader:0';
    const saved = {
      anchors: keyText(restarted, 'citationRevisionAnchors'),
      log: manifestLogText(vault),
      sidecars: sidecarText(vault),
      oldJob: JSON.stringify(queue.jobs[0]),
    };

    const second = await ingestionSession(restarted, vault, DAY_TWO);
    await second.arrive([T], 1);
    await second.drain();
    await second.arrive([T], 1);
    expect(second.enqueues).toEqual([
      { status: 'queued' },
      { status: 'duplicate', existingStatus: 'done' },
    ]);
    const jobs = second.engine.list();
    expect(jobs).toHaveLength(2);
    expect(JSON.stringify(jobs[0])).toBe(saved.oldJob);
    expect(jobs[1]).toMatchObject({ status: 'done', attempts: 1 });
    await second.manifests.manifestsFor([T]);
    const s = citationSession(restarted, { now: 2_000 });
    await s.pass(vault);

    expect(manifestLogText(vault)).toBe(saved.log);
    expect(keyText(restarted, 'citationRevisionAnchors')).toBe(saved.anchors);
    expect(sidecarText(vault)).toBe(saved.sidecars);
    expect((await second.revisionsNow()).revisions[T]).toEqual(row);
    expect(s.judge.judge).not.toHaveBeenCalled();
    expect(vault.files.get(T)).toBe(transcriptOf(LECTURE));
  });
});
