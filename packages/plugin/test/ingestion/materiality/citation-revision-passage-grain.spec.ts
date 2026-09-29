/**
 * Passage-grain citation revision (`[D-446]` option (a), `ol-egov.141.89.5.32`).
 *
 * The bug: the citation batch pass compared the WHOLE source note, so an edit anywhere in the
 * note put every instrument citing it in front of the judge, and a cited passage that merely moved
 * asked the judge about a pair the targets do not name. The fix: an instrument whose citation
 * carries a passage digest is baselined AT that passage, and each pass finds the passage again by
 * the shared segmentation rule (`olea-core`'s `source/passage-identity.ts`).
 *
 * Row 42 (2026-09-29) asks for moved passages, duplicate passages and segmentation-rule changes to
 * be demonstrated, an ambiguous case to stay unresolved and never be guessed. Row 45 asks that an
 * unresolved or unavailable result withhold protectively while keeping its actual reason, never
 * reading as a claim that a material change was established. Each block below is one of those.
 *
 * Real `ObsidianCitationHashStore` over a fake data host, real `enumerateVaultInstruments`, a
 * scripted judge: the same seams the plugin composes, no `obsidian` import.
 */
import {
  citationStorePath,
  digestPassage,
  type EnqueueInput,
  type ListOptions,
  PASSAGE_RULE_V1,
  type PassageRule,
  type PassageSegment,
  type RevisionJudgePort,
  type Unsubscribe,
  type VaultEvent,
  type VaultPath,
  type VaultSource,
} from 'olea-core';
import { describe, expect, it, vi } from 'vitest';
import {
  type CitationAnchorRecord,
  ObsidianCitationHashStore,
} from '../../../src/ingestion/materiality/citation-hash-store.js';
import { CitationRevisionTrigger } from '../../../src/ingestion/materiality/citation-revision-wiring.js';

class MemoryVaultSource implements VaultSource {
  readonly files = new Map<string, string>();
  constructor(initial: Readonly<Record<string, string>> = {}) {
    for (const [path, content] of Object.entries(initial)) this.files.set(path, content);
  }
  async list(options: ListOptions = {}): Promise<readonly VaultPath[]> {
    const extensions = options.extensions?.map((e) => e.toLowerCase());
    return [...this.files.keys()]
      .filter((p) => {
        if (extensions === undefined) return true;
        return extensions.includes(p.slice(p.lastIndexOf('.') + 1).toLowerCase());
      })
      .sort();
  }
  async read(path: VaultPath): Promise<string> {
    const content = this.files.get(path);
    if (content === undefined) throw new Error(`MemoryVaultSource.read: not found: ${path}`);
    return content;
  }
  async readBinary(): Promise<Uint8Array> {
    throw new Error('not needed');
  }
  async write(path: VaultPath, content: string): Promise<void> {
    this.files.set(path, content);
  }
  async exists(path: VaultPath): Promise<boolean> {
    return this.files.has(path);
  }
  watch(_handler: (event: VaultEvent) => void): Unsubscribe {
    return () => {};
  }
}

class FakeDataHost {
  blob: Record<string, unknown> = {};
  async loadData(): Promise<unknown> {
    return this.blob;
  }
  async saveData(data: unknown): Promise<void> {
    this.blob = data as Record<string, unknown>;
  }
}

const HOME_PATH = 'Zettel/Weathering rates (Olea).md';
const SOURCE_PATH = 'Zettel/Weathering rates.md';
const OTHER_PATH = 'Zettel/Erosion.md';
const THIRD_PATH = 'Zettel/Soils.md';
const MCQ_ID = 'q1';

const BASALT = 'Basalt weathers quickly in humid climates.';
const GRANITE = 'Granite resists weathering far better than basalt does.';
const QUARTZ = 'It is dominated by quartz and feldspar.';
const LIMESTONE = 'Limestone dissolves in weak acid.';
/** The cited passage: a two-line block. */
const PASSAGE = `${GRANITE}\n${QUARTZ}`;

function sourceNote(...blocks: string[]): string {
  return ['# Weathering rates', '', ...blocks.flatMap((block) => [block, '']), ''].join('\n');
}

const SOURCE_TEXT = sourceNote(BASALT, PASSAGE, LIMESTONE);

function homeNote(): string {
  return [
    '---',
    'topic: [Weathering rates]',
    'course: GEO101',
    '---',
    '',
    '```olea-mcq',
    `id: ${MCQ_ID}`,
    'stem: Which mineral is most weathering-resistant?',
    'answer: Quartz',
    'distractor: Olivine',
    'distractor: Feldspar',
    'distractor: Biotite',
    'distractor: Calcite',
    '```',
    '',
  ].join('\n');
}

function sidecar(passageDigest: string | undefined): string {
  return `${JSON.stringify(
    {
      instrumentId: MCQ_ID,
      sourcePath: SOURCE_PATH,
      page: 1,
      ...(passageDigest !== undefined ? { passageDigest } : {}),
      schemaVersion: 2,
    },
    null,
    2,
  )}\n`;
}

async function fixture(
  options: {
    sourceText?: string;
    passage?: string | undefined;
    digest?: string | undefined;
    extra?: Record<string, string>;
  } = {},
) {
  const passage = 'passage' in options ? options.passage : PASSAGE;
  const digest = 'digest' in options ? options.digest : passage && (await digestPassage(passage));
  const vault = new MemoryVaultSource({
    [HOME_PATH]: homeNote(),
    [SOURCE_PATH]: options.sourceText ?? SOURCE_TEXT,
    [citationStorePath(MCQ_ID)]: sidecar(digest),
    ...options.extra,
  });
  const store = new ObsidianCitationHashStore(new FakeDataHost());
  return { vault, store };
}

function actions() {
  return {
    enqueue: vi.fn(async (_input: EnqueueInput) => undefined),
    suspend: vi.fn(async () => undefined),
    onRelocationProposed: vi.fn(),
  };
}

function judgeSaying(material: boolean): RevisionJudgePort & { judge: ReturnType<typeof vi.fn> } {
  return { judge: vi.fn(async () => ({ material, reason: 'scripted' })) };
}

function trigger(
  store: ObsidianCitationHashStore,
  judge: RevisionJudgePort | null,
  extra: { passageRules?: readonly PassageRule[]; isOnline?: () => boolean } = {},
) {
  return new CitationRevisionTrigger({ store, judge, clock: { now: () => 1_000 }, ...extra });
}

async function anchorOf(store: ObsidianCitationHashStore): Promise<CitationAnchorRecord> {
  const record = (await store.loadAll()).get(MCQ_ID);
  if (record === undefined) throw new Error('no anchor recorded');
  return record;
}

describe('baselining at the cited passage', () => {
  it('a citation whose digest names exactly one passage is baselined AT that passage', async () => {
    const { vault, store } = await fixture();
    const report = await trigger(store, null).tick(vault, actions());

    expect(report.newlyBaselined).toBe(1);
    expect(report.passageSeedUnresolved).toBe(0);
    const anchor = await anchorOf(store);
    expect(anchor.text).toBe(PASSAGE);
    expect(anchor.sourcePath).toBe(SOURCE_PATH);
    expect(anchor.passageDigest).toBe(await digestPassage(PASSAGE));
  });

  it('a citation with no digest keeps the whole-note baseline, exactly as before', async () => {
    const { vault, store } = await fixture({ digest: undefined });
    await trigger(store, null).tick(vault, actions());

    const anchor = await anchorOf(store);
    expect(anchor.text).toBe(SOURCE_TEXT);
    expect(anchor.passageDigest).toBeUndefined();
  });

  it('a digest that resolves to no single passage falls back to the whole note and is counted, never guessed', async () => {
    const ambiguousNote = sourceNote(PASSAGE, LIMESTONE, PASSAGE);
    const { vault, store } = await fixture({ sourceText: ambiguousNote });
    const report = await trigger(store, null).tick(vault, actions());

    expect(report.passageSeedUnresolved).toBe(1);
    expect(report.newlyBaselined).toBe(1);
    const anchor = await anchorOf(store);
    expect(anchor.passageDigest).toBeUndefined();
    expect(anchor.text).toBe(ambiguousNote);
  });
});

describe('the bug: an edit elsewhere in the note, or a move, no longer reaches the judge', () => {
  it('editing a DIFFERENT paragraph of the source note makes no judge call and no change', async () => {
    const { vault, store } = await fixture();
    const judge = judgeSaying(true);
    const t = trigger(store, judge);
    await t.tick(vault, actions());

    await vault.write(
      SOURCE_PATH,
      sourceNote('Basalt weathers slowly when it is dry.', PASSAGE, LIMESTONE),
    );
    const a = actions();
    const report = await t.tick(vault, a);

    expect(judge.judge).not.toHaveBeenCalled();
    expect(report.revised + report.refreshed + report.judgeUnavailable + report.stranded).toBe(0);
    expect(a.suspend).not.toHaveBeenCalled();
    const anchor = await anchorOf(store);
    expect(anchor.text).toBe(PASSAGE);
    expect(anchor.pendingRevalidation).toBeUndefined();
  });

  it('adding a new paragraph to the source note makes no judge call', async () => {
    const { vault, store } = await fixture();
    const judge = judgeSaying(true);
    const t = trigger(store, judge);
    await t.tick(vault, actions());

    await vault.write(
      SOURCE_PATH,
      sourceNote(BASALT, PASSAGE, LIMESTONE, 'Schist foliates under pressure.'),
    );
    await t.tick(vault, actions());
    expect(judge.judge).not.toHaveBeenCalled();
  });

  it('a passage that moves within its note is found again with no judge call and no withholding', async () => {
    const { vault, store } = await fixture();
    const judge = judgeSaying(true);
    const t = trigger(store, judge);
    await t.tick(vault, actions());

    await vault.write(SOURCE_PATH, sourceNote(PASSAGE, BASALT, LIMESTONE));
    const report = await t.tick(vault, actions());

    expect(judge.judge).not.toHaveBeenCalled();
    expect(report.revised + report.refreshed + report.stranded + report.relocated).toBe(0);
    const anchor = await anchorOf(store);
    expect(anchor.text).toBe(PASSAGE);
    expect(anchor.pendingRevalidation).toBeUndefined();
  });

  it('a whitespace-only reflow of the passage is refreshed silently', async () => {
    const { vault, store } = await fixture();
    const judge = judgeSaying(true);
    const t = trigger(store, judge);
    await t.tick(vault, actions());

    const reflowed = `${GRANITE}\n  ${QUARTZ}  `;
    await vault.write(SOURCE_PATH, sourceNote(BASALT, reflowed, LIMESTONE));
    const report = await t.tick(vault, actions());

    expect(judge.judge).not.toHaveBeenCalled();
    expect(report.formattingOnly).toBe(1);
    expect((await anchorOf(store)).text).toBe(reflowed);
  });

  it('a markup-only change to the passage (bullets, emphasis) exits free as formatting-only', async () => {
    const bullets = `- ${GRANITE}\n- **${QUARTZ}**`;
    const { vault, store } = await fixture();
    const judge = judgeSaying(true);
    const t = trigger(store, judge);
    await t.tick(vault, actions());

    await vault.write(SOURCE_PATH, sourceNote(BASALT, bullets, LIMESTONE));
    const report = await t.tick(vault, actions());

    expect(judge.judge).not.toHaveBeenCalled();
    expect(report.formattingOnly).toBe(1);
    const anchor = await anchorOf(store);
    expect(anchor.text).toBe(bullets);
    expect(anchor.passageDigest).toBe(await digestPassage(bullets));
  });
});

describe('a moved passage (D-446, row 42)', () => {
  it('a passage that moves to another note heals there silently, with no judge call', async () => {
    const { vault, store } = await fixture({
      extra: { [OTHER_PATH]: sourceNote('Erosion carries sediment.') },
    });
    const judge = judgeSaying(true);
    const t = trigger(store, judge);
    await t.tick(vault, actions());

    await vault.write(SOURCE_PATH, sourceNote(BASALT, LIMESTONE));
    await vault.write(OTHER_PATH, sourceNote('Erosion carries sediment.', PASSAGE));
    const a = actions();
    const report = await t.tick(vault, a);

    expect(judge.judge).not.toHaveBeenCalled();
    expect(report.relocated).toBe(1);
    expect(a.suspend).not.toHaveBeenCalled();
    const anchor = await anchorOf(store);
    expect(anchor.sourcePath).toBe(OTHER_PATH);
    expect(anchor.text).toBe(PASSAGE);
    expect(anchor.pendingRevalidation).toBeUndefined();

    // The next pass starts from where it now stands: unchanged, not relocated again.
    const next = await t.tick(vault, actions());
    expect(next.relocated).toBe(0);
    expect(next.stranded + next.passageAmbiguous).toBe(0);
    expect((await anchorOf(store)).sourcePath).toBe(OTHER_PATH);
  });

  it('a one-line passage that moves into a longer block of another note is still found', async () => {
    const line = 'Solvent containers are not to be stored within 1 m of the hotplate.';
    const { vault, store } = await fixture({
      sourceText: sourceNote(`The bench is cleaned after each session.\n${line}`, LIMESTONE),
      passage: line,
      extra: { [OTHER_PATH]: sourceNote('The extraction fan is checked each Monday.') },
    });
    const judge = judgeSaying(true);
    const t = trigger(store, judge);
    await t.tick(vault, actions());
    expect((await anchorOf(store)).text).toBe(line);

    await vault.write(
      SOURCE_PATH,
      sourceNote('The bench is cleaned after each session.', LIMESTONE),
    );
    await vault.write(
      OTHER_PATH,
      sourceNote(`The extraction fan is checked each Monday.\n${line}`),
    );
    const report = await t.tick(vault, actions());

    expect(report.relocated).toBe(1);
    expect(judge.judge).not.toHaveBeenCalled();
    expect((await anchorOf(store)).sourcePath).toBe(OTHER_PATH);
  });

  it('a passage that is gone, with nothing like it anywhere, is stranded and WITHHELD before it is next presented, with no judge call', async () => {
    const { vault, store } = await fixture();
    const judge = judgeSaying(true);
    const t = trigger(store, judge);
    await t.tick(vault, actions());

    await vault.write(SOURCE_PATH, sourceNote(BASALT, LIMESTONE));
    const a = actions();
    const report = await t.tick(vault, a);

    expect(judge.judge).not.toHaveBeenCalled();
    expect(report.stranded).toBe(1);
    expect(a.suspend).not.toHaveBeenCalled();
    expect(a.enqueue).not.toHaveBeenCalled();
    const anchor = await anchorOf(store);
    // No baseline is adopted: the anchor still names the passage it last saw.
    expect(anchor.text).toBe(PASSAGE);
    expect(anchor.pendingRevalidation?.reason).toBe('passage-missing');
    expect(
      await store.isPendingRevalidationCurrent(
        MCQ_ID,
        anchor.pendingRevalidation?.sinceContentHash ?? '',
      ),
    ).toBe(true);
    // Withholding is protective, not a dispatch: no judge budget is spent on it.
    expect(anchor.pendingRevalidation?.dispatchedAt).toBeUndefined();
  });

  it('the withholding lifts the pass the passage stands again', async () => {
    const { vault, store } = await fixture();
    const t = trigger(store, judgeSaying(true));
    await t.tick(vault, actions());
    await vault.write(SOURCE_PATH, sourceNote(BASALT, LIMESTONE));
    await t.tick(vault, actions());
    expect((await anchorOf(store)).pendingRevalidation?.reason).toBe('passage-missing');

    await vault.write(SOURCE_PATH, SOURCE_TEXT);
    await t.tick(vault, actions());
    const anchor = await anchorOf(store);
    expect(anchor.pendingRevalidation).toBeUndefined();
    expect(anchor.text).toBe(PASSAGE);
  });

  it('a stranded state is re-recorded as a no-op on every pass and never dispatches', async () => {
    const { vault, store } = await fixture();
    const judge = judgeSaying(true);
    const t = trigger(store, judge);
    await t.tick(vault, actions());
    await vault.write(SOURCE_PATH, sourceNote(BASALT, LIMESTONE));
    await t.tick(vault, actions());
    const first = (await anchorOf(store)).pendingRevalidation;
    await t.tick(vault, actions());
    await t.tick(vault, actions());
    expect((await anchorOf(store)).pendingRevalidation).toEqual(first);
    expect(judge.judge).not.toHaveBeenCalled();
  });

  it('a passage moved AND edited into another note is only proposed, never re-pointed, and the item stays withheld', async () => {
    const edited = `${GRANITE}\nIt is dominated by quartz, feldspar and mica.`;
    const { vault, store } = await fixture({
      extra: { [OTHER_PATH]: sourceNote('Erosion carries sediment.') },
    });
    const judge = judgeSaying(true);
    const t = trigger(store, judge);
    await t.tick(vault, actions());

    await vault.write(SOURCE_PATH, sourceNote(BASALT, LIMESTONE));
    await vault.write(OTHER_PATH, sourceNote('Erosion carries sediment.', edited));
    const a = actions();
    const report = await t.tick(vault, a);

    expect(judge.judge).not.toHaveBeenCalled();
    expect(report.relocationProposed).toBe(1);
    expect(a.onRelocationProposed).toHaveBeenCalledTimes(1);
    const anchor = await anchorOf(store);
    expect(anchor.sourcePath).toBe(SOURCE_PATH); // never re-bound on Olea's own authority
    expect(anchor.pendingRevalidation?.reason).toBe('passage-missing');
  });
});

describe('duplicate passages stay unresolved (D-446, row 42)', () => {
  it('a copy of the passage appearing beside the original makes it ambiguous: withheld with that reason, no judge call, nothing chosen', async () => {
    const { vault, store } = await fixture();
    const judge = judgeSaying(true);
    const t = trigger(store, judge);
    await t.tick(vault, actions());

    await vault.write(SOURCE_PATH, sourceNote(BASALT, PASSAGE, LIMESTONE, PASSAGE));
    const a = actions();
    const report = await t.tick(vault, a);

    expect(judge.judge).not.toHaveBeenCalled();
    expect(report.passageAmbiguous).toBe(1);
    expect(report.stranded).toBe(0);
    const anchor = await anchorOf(store);
    expect(anchor.pendingRevalidation?.reason).toBe('passage-ambiguous');
    expect(anchor.text).toBe(PASSAGE);
  });

  it('removing the extra copy resolves it and lifts the withholding', async () => {
    const { vault, store } = await fixture();
    const t = trigger(store, judgeSaying(true));
    await t.tick(vault, actions());
    await vault.write(SOURCE_PATH, sourceNote(BASALT, PASSAGE, LIMESTONE, PASSAGE));
    await t.tick(vault, actions());
    expect((await anchorOf(store)).pendingRevalidation?.reason).toBe('passage-ambiguous');

    await vault.write(SOURCE_PATH, SOURCE_TEXT);
    await t.tick(vault, actions());
    expect((await anchorOf(store)).pendingRevalidation).toBeUndefined();
  });

  it('a passage gone from its note but standing in two other notes is not relocated to either', async () => {
    const { vault, store } = await fixture({
      extra: {
        [OTHER_PATH]: sourceNote('Erosion carries sediment.'),
        [THIRD_PATH]: sourceNote('Soils hold water.'),
      },
    });
    const judge = judgeSaying(true);
    const t = trigger(store, judge);
    await t.tick(vault, actions());

    await vault.write(SOURCE_PATH, sourceNote(BASALT, LIMESTONE));
    await vault.write(OTHER_PATH, sourceNote('Erosion carries sediment.', PASSAGE));
    await vault.write(THIRD_PATH, sourceNote('Soils hold water.', PASSAGE));
    const report = await t.tick(vault, actions());

    expect(report.relocated).toBe(0);
    expect(report.passageAmbiguous).toBe(1);
    expect(judge.judge).not.toHaveBeenCalled();
    const anchor = await anchorOf(store);
    expect(anchor.sourcePath).toBe(SOURCE_PATH);
    expect(anchor.pendingRevalidation?.reason).toBe('passage-ambiguous');
  });
});

describe('an edited passage: the judge sees the passage, and only when it is unmistakable', () => {
  const EDITED = `${GRANITE}\nIt is dominated by quartz, feldspar and biotite.`;

  it('sends the judge the old and new PASSAGE, never the whole note', async () => {
    const { vault, store } = await fixture();
    const judge = judgeSaying(false);
    const t = trigger(store, judge);
    await t.tick(vault, actions());

    await vault.write(SOURCE_PATH, sourceNote('Basalt is a fine-grained rock.', EDITED, LIMESTONE));
    const report = await t.tick(vault, actions());

    expect(judge.judge).toHaveBeenCalledTimes(1);
    expect(judge.judge).toHaveBeenCalledWith({ previousText: PASSAGE, currentText: EDITED });
    expect(report.refreshed).toBe(1);
    // A same-claim verdict advances the anchor to the new passage, and its digest with it.
    const anchor = await anchorOf(store);
    expect(anchor.text).toBe(EDITED);
    expect(anchor.passageDigest).toBe(await digestPassage(EDITED));
    expect(anchor.pendingRevalidation).toBeUndefined();

    // The new passage is then the identity: an unrelated edit afterwards still makes no call.
    await vault.write(SOURCE_PATH, sourceNote('Basalt is dark.', EDITED, LIMESTONE));
    await t.tick(vault, actions());
    expect(judge.judge).toHaveBeenCalledTimes(1);
  });

  it('a changed-claim verdict suspends the instrument and drafts the successor from the passage', async () => {
    const { vault, store } = await fixture();
    const judge = judgeSaying(true);
    const t = trigger(store, judge);
    await t.tick(vault, actions());

    await vault.write(SOURCE_PATH, sourceNote(BASALT, EDITED, LIMESTONE));
    const a = actions();
    const report = await t.tick(vault, a);

    expect(report.revised).toBe(1);
    expect(a.suspend).toHaveBeenCalledWith(MCQ_ID, expect.anything());
    expect(a.enqueue).toHaveBeenCalledTimes(1);
    const enqueued = a.enqueue.mock.calls[0]?.[0] as unknown as {
      payload: { newPassageText: string };
    };
    expect(enqueued.payload.newPassageText).toBe(EDITED);
    expect((await store.loadAll()).has(MCQ_ID)).toBe(false);
  });

  it('two segments that both resemble the edited passage are ambiguous, and nothing is judged', async () => {
    const twin = `${GRANITE}\nIt is dominated by quartz and mica.`;
    const { vault, store } = await fixture();
    const judge = judgeSaying(true);
    const t = trigger(store, judge);
    await t.tick(vault, actions());

    await vault.write(SOURCE_PATH, sourceNote(BASALT, EDITED, twin, LIMESTONE));
    const report = await t.tick(vault, actions());

    expect(judge.judge).not.toHaveBeenCalled();
    expect(report.passageAmbiguous).toBe(1);
    expect((await anchorOf(store)).pendingRevalidation?.reason).toBe('passage-ambiguous');
  });
});

describe('the reason a passage-grain item is withheld stays distinct (D-446 with row 45)', () => {
  it('checking failed, ambiguous and missing each keep their own reason, and none is a confirmed change', async () => {
    // Checking failed: the passage was edited unmistakably and no judge is reachable.
    {
      const { vault, store } = await fixture();
      const t = trigger(store, null);
      await t.tick(vault, actions());
      await vault.write(
        SOURCE_PATH,
        sourceNote(
          BASALT,
          `${GRANITE}\nIt is dominated by quartz, feldspar and biotite.`,
          LIMESTONE,
        ),
      );
      const a = actions();
      const report = await t.tick(vault, a);
      expect(report.judgeUnavailable).toBe(1);
      expect(a.suspend).not.toHaveBeenCalled();
      const pending = (await anchorOf(store)).pendingRevalidation;
      expect(pending).toBeDefined();
      expect(pending?.reason).toBeUndefined(); // awaiting the check, not a passage reason
    }
    // Ambiguous.
    {
      const { vault, store } = await fixture();
      const t = trigger(store, judgeSaying(true));
      await t.tick(vault, actions());
      await vault.write(SOURCE_PATH, sourceNote(PASSAGE, PASSAGE));
      const a = actions();
      await t.tick(vault, a);
      expect((await anchorOf(store)).pendingRevalidation?.reason).toBe('passage-ambiguous');
      expect(a.suspend).not.toHaveBeenCalled();
    }
    // Missing.
    {
      const { vault, store } = await fixture();
      const t = trigger(store, judgeSaying(true));
      await t.tick(vault, actions());
      await vault.write(SOURCE_PATH, sourceNote(BASALT));
      const a = actions();
      await t.tick(vault, a);
      expect((await anchorOf(store)).pendingRevalidation?.reason).toBe('passage-missing');
      expect(a.suspend).not.toHaveBeenCalled();
    }
  });

  it('an offline pass withholds an edited passage as checking-pending without spending the retry budget', async () => {
    const { vault, store } = await fixture();
    let online = true;
    const judge = judgeSaying(false);
    const t = trigger(store, judge, { isOnline: () => online });
    await t.tick(vault, actions());
    online = false;
    await vault.write(
      SOURCE_PATH,
      sourceNote(BASALT, `${GRANITE}\nIt is dominated by quartz, feldspar and biotite.`, LIMESTONE),
    );
    const report = await t.tick(vault, actions());
    expect(report.judgeUnavailable).toBe(1);
    expect(judge.judge).not.toHaveBeenCalled();
    expect((await anchorOf(store)).pendingRevalidation?.dispatchedAt).toBeUndefined();
  });
});

describe('segmentation-rule versions (D-446, row 42)', () => {
  // A later rule for which every line is its own passage. It exists to prove what a rule change
  // does to anchors and citations already written under version 1.
  const RULE_V2: PassageRule = {
    version: 2,
    normalise: (text) => text.replace(/\s+/g, ' ').trim(),
    segment: (source): readonly PassageSegment[] => {
      const segments: PassageSegment[] = [];
      let offset = 0;
      for (const line of source.split('\n')) {
        const normalised = line.replace(/\s+/g, ' ').trim();
        if (normalised.length > 0) {
          segments.push({
            level: 'line',
            kind: 'text',
            start: offset,
            end: offset + line.length,
            text: line,
            normalised,
            lineCount: 1,
          });
        }
        offset += line.length + 1;
      }
      return segments;
    },
  };

  it('a citation digest from a rule this build does not carry is unresolved at first sighting: whole-note baseline, counted, never matched by chance', async () => {
    const { vault, store } = await fixture({ digest: `p9:${'a'.repeat(64)}` });
    const report = await trigger(store, null).tick(vault, actions());
    expect(report.passageSeedUnresolved).toBe(1);
    const anchor = await anchorOf(store);
    expect(anchor.passageDigest).toBeUndefined();
    expect(anchor.text).toBe(SOURCE_TEXT);
  });

  it('the same passage digests differently under each rule, so a version 1 digest never resolves under version 2 by coincidence', async () => {
    const line = 'A single line passage.';
    const v1 = await digestPassage(line, PASSAGE_RULE_V1);
    const v2 = await digestPassage(line, RULE_V2);
    expect(v1).not.toBe(v2);
    const { vault, store } = await fixture({
      sourceText: sourceNote(line, LIMESTONE),
      passage: line,
      digest: v1,
    });
    // Registry holds ONLY version 2: the version 1 digest cannot be read.
    const report = await trigger(store, null, { passageRules: [RULE_V2] }).tick(vault, actions());
    expect(report.passageSeedUnresolved).toBe(1);
  });

  it('an anchor seeded under version 1 keeps working while version 1 stays registered beside a newer rule', async () => {
    const { vault, store } = await fixture();
    const both = [PASSAGE_RULE_V1, RULE_V2] as const;
    const t = trigger(store, judgeSaying(true), { passageRules: both });
    await t.tick(vault, actions());
    expect((await anchorOf(store)).passageDigest?.startsWith('p1:')).toBe(true);

    await vault.write(SOURCE_PATH, sourceNote(LIMESTONE, PASSAGE, BASALT));
    const report = await t.tick(vault, actions());
    expect(report.revised + report.stranded + report.passageRuleUnsupported).toBe(0);
    const anchor = await anchorOf(store);
    expect(anchor.pendingRevalidation).toBeUndefined();
    expect(anchor.passageDigest?.startsWith('p1:')).toBe(true);
  });

  it('when version 1 is retired, an anchor is re-seated under the current rule if its passage is found cleanly there', async () => {
    const line = 'A single line passage.';
    const { vault, store } = await fixture({
      sourceText: sourceNote(line, LIMESTONE),
      passage: line,
    });
    await trigger(store, null).tick(vault, actions()); // baselined under version 1
    expect((await anchorOf(store)).passageDigest?.startsWith('p1:')).toBe(true);

    // A build that no longer carries version 1.
    await vault.write(SOURCE_PATH, sourceNote(LIMESTONE, 'Some new opening.', line));
    const judge = judgeSaying(true);
    const t = trigger(store, judge, { passageRules: [RULE_V2] });
    const report = await t.tick(vault, actions());

    expect(judge.judge).not.toHaveBeenCalled();
    expect(report.passageRuleUnsupported).toBe(0);
    expect(report.revised + report.stranded).toBe(0);
    const anchor = await anchorOf(store);
    // Re-seated on the current rule, the passage itself untouched.
    expect(anchor.passageDigest).toBe(await digestPassage(line, RULE_V2));
    expect(anchor.text).toBe(line);
    expect(anchor.pendingRevalidation).toBeUndefined();
    // A later, real edit is then read under the new rule.
    await vault.write(SOURCE_PATH, sourceNote(LIMESTONE, 'Some new opening.', `${line}  `));
    const later = await t.tick(vault, actions());
    expect(later.formattingOnly).toBe(1);
    expect((await anchorOf(store)).passageDigest).toBe(await digestPassage(line, RULE_V2));
  });

  it('when version 1 is retired and the passage is not a passage under the new rule, it is unresolved with its own reason, and withheld', async () => {
    const { vault, store } = await fixture(); // a two-line BLOCK passage: not a version 2 segment
    await trigger(store, null).tick(vault, actions());

    const judge = judgeSaying(true);
    const report = await trigger(store, judge, { passageRules: [RULE_V2] }).tick(vault, actions());

    expect(judge.judge).not.toHaveBeenCalled();
    expect(report.passageRuleUnsupported).toBe(1);
    expect((await anchorOf(store)).pendingRevalidation?.reason).toBe('passage-rule-unsupported');
  });
});

describe('the legacy grain is untouched', () => {
  it('an instrument whose citation carries no digest still judges the whole note on any edit, as before', async () => {
    const { vault, store } = await fixture({ digest: undefined });
    const judge = judgeSaying(false);
    const t = trigger(store, judge);
    await t.tick(vault, actions());

    await vault.write(
      SOURCE_PATH,
      sourceNote('Basalt weathers slowly when it is dry.', PASSAGE, LIMESTONE),
    );
    const report = await t.tick(vault, actions());

    expect(judge.judge).toHaveBeenCalledTimes(1);
    expect(report.refreshed).toBe(1);
  });
});
