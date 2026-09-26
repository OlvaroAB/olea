/**
 * `readConceptsAndRelations` wires the collision-to-proposal step into the real ingestion tick
 * (`[D-295 / CPT-D2]`, `ol-egov.141.89.3.4` [ILB-CPT-4], `docs/dev/intelligence-build/cpt.md`
 * §8). Both halves — `olea-core`'s `proposeSameAsFromMintCollisions` (the concurrent-mint case)
 * and this plugin's own `proposeSameAsForMovedNoteAnchors` (the moved-note-anchor case, landed
 * no-caller by `ol-egov.141.89.3.8`) — already have their OWN unit tests elsewhere
 * (`same-as.spec.ts`, `wiring.spec.ts`, `canonical-key-readers.ol-egov.141.89.9.56.spec.ts`).
 * This file tests only the WIRING: that a real `readConceptsAndRelations` tick actually calls
 * them and that a proposal lands where F8.4a's triage surface already reads it — never a new
 * affordance, never an automatic confirm.
 *
 * Mirrors `corpusRelationWiring.spec.ts`'s fakes and conventions — no `obsidian` import
 * anywhere in this file (INV-1).
 *
 * INV-3: every concept name and every line of vault content below is coined for this file. None
 * is drawn from any real vault.
 */
import type {
  ListOptions,
  Unsubscribe,
  VaultEvent,
  VaultPath,
  VaultSource,
  WorkerTaskRequest,
} from 'olea-core';
import { listSameAsLinkRecords, resolveConceptKey } from 'olea-core';
import { describe, expect, it } from 'vitest';
import { ObsidianCorpusRelationStateStore } from '../../src/concept/corpusRelationStateStore.js';
import {
  buildConceptWiring,
  buildCorpusRelationWiring,
  readConceptsAndRelations,
} from '../../src/concept/wiring.js';
import type { PersistedWorkerConfig } from '../../src/worker/config-store.js';
import { WORKER_CONFIG_STORAGE_KEY } from '../../src/worker/config-store.js';

// ---- shared fakes (mirrors corpusRelationWiring.spec.ts) ------------------

class FakeDataHost {
  blob: unknown = null;
  async loadData(): Promise<unknown> {
    return this.blob;
  }
  async saveData(data: unknown): Promise<void> {
    this.blob = data;
  }
}

function configuredHost(config: PersistedWorkerConfig): FakeDataHost {
  const host = new FakeDataHost();
  host.blob = { [WORKER_CONFIG_STORAGE_KEY]: config };
  return host;
}

const READY_CONFIG: PersistedWorkerConfig = {
  version: 1,
  baseUrl: 'https://worker.example',
  token: 'secret-token',
};

/** `listSameAsLinkRecords` returns `{ path, record }` pairs — this unwraps to just the records, since every test here only cares about the record. */
async function proposedLinks(vault: VaultSource) {
  return (await listSameAsLinkRecords(vault)).map(({ record }) => record);
}

/** A transport that never proposes a concept of its own — every concept this tick sees comes
 * from her filing conventions (topic anchors), not the model, so a fixed empty reply is honest
 * for every task id this tick's stages send. */
function emptyTransport() {
  const calls: WorkerTaskRequest[] = [];
  return {
    calls,
    send: async (request: WorkerTaskRequest) => {
      calls.push(request);
      if (request.taskId === 'concepts.extract.v1') {
        return { ok: true, result: { concepts: [] } };
      }
      return { ok: true, result: { verdicts: [] } };
    },
  };
}

/** Writable, and supports `delete` — the moved-note-anchor test needs a note to genuinely stop
 * existing between the mint and the tick that discovers the orphan, on the SAME vault instance. */
class MemoryVault implements VaultSource {
  private readonly files: Record<string, string> = {};
  constructor(files: Record<string, string> = {}) {
    Object.assign(this.files, files);
  }
  list(options?: ListOptions): Promise<readonly VaultPath[]> {
    let paths = Object.keys(this.files);
    if (options?.under !== undefined) {
      const prefix = `${options.under}/`;
      paths = paths.filter((path) => path === options.under || path.startsWith(prefix));
    }
    if (options?.extensions !== undefined) {
      const exts = options.extensions;
      paths = paths.filter((path) => exts.some((ext) => path.toLowerCase().endsWith(`.${ext}`)));
    }
    return Promise.resolve(paths.sort());
  }
  read(path: VaultPath): Promise<string> {
    const content = this.files[path];
    if (content === undefined) return Promise.reject(new Error(`no such file ${path}`));
    return Promise.resolve(content);
  }
  readBinary(path: VaultPath): Promise<Uint8Array> {
    return this.read(path).then((t) => new TextEncoder().encode(t));
  }
  write(path: VaultPath, content: string): Promise<void> {
    this.files[path] = content;
    return Promise.resolve();
  }
  delete(path: VaultPath): Promise<void> {
    delete this.files[path];
    return Promise.resolve();
  }
  exists(path: VaultPath): Promise<boolean> {
    return Promise.resolve(path in this.files);
  }
  watch(_handler: (event: VaultEvent) => void): Unsubscribe {
    return () => undefined;
  }
}

describe('readConceptsAndRelations wires proposeSameAsFromMintCollisions into the real tick (ol-egov.141.89.3.4)', () => {
  it('a mint-time normalisation collision, this same tick, reaches a proposed same-as link on her existing triage list', async () => {
    // Two course notes cite the same topic under two different case foldings — `extract.ts`'s
    // `byName` accumulator keys by the exact string, so these are two distinct topic candidates,
    // minted as two distinct keys within this one tick, colliding at mint time
    // (`findNormalizationCollisions`) purely because they normalise to the same wording.
    const vault = new MemoryVault({
      '01 Courses/CourseA/Note One.md':
        '---\ntopic: [[Signal Path]]\n---\n\nSome prose about the first wording.\n',
      '01 Courses/CourseA/Note Two.md':
        '---\ntopic: [[signal path]]\n---\n\nSome other prose about the second wording.\n',
    });
    const transport = emptyTransport();
    const conceptWiring = await buildConceptWiring({
      dataHost: configuredHost(READY_CONFIG),
      createTransport: () => transport,
    });
    const corpusWiring = await buildCorpusRelationWiring({
      dataHost: configuredHost(READY_CONFIG),
      createTransport: () => transport,
    });

    const pass = await readConceptsAndRelations(
      conceptWiring,
      corpusWiring,
      new ObsidianCorpusRelationStateStore(new FakeDataHost()),
      { vault, ingestionSessionClosed: true },
    );

    expect(pass).not.toBeNull();

    const links = await proposedLinks(vault);
    expect(links).toHaveLength(1);
    expect(links[0]).toMatchObject({ status: 'proposed', reason: 'normalisation-collision' });
    // Never an automatic confirm — `[D-295]` item 1: "nothing is ever confirmed automatically."
    expect(links.every((link) => link.status === 'proposed')).toBe(true);
  });

  it('proposes nothing new on a second tick over the same, unchanged vault (idempotent, no duplicate proposal)', async () => {
    const vault = new MemoryVault({
      '01 Courses/CourseA/Note One.md':
        '---\ntopic: [[Signal Path]]\n---\n\nSome prose about the first wording.\n',
      '01 Courses/CourseA/Note Two.md':
        '---\ntopic: [[signal path]]\n---\n\nSome other prose about the second wording.\n',
    });
    const transport = emptyTransport();
    const conceptWiring = await buildConceptWiring({
      dataHost: configuredHost(READY_CONFIG),
      createTransport: () => transport,
    });
    const corpusWiring = await buildCorpusRelationWiring({
      dataHost: configuredHost(READY_CONFIG),
      createTransport: () => transport,
    });
    const stateStore = new ObsidianCorpusRelationStateStore(new FakeDataHost());

    await readConceptsAndRelations(conceptWiring, corpusWiring, stateStore, {
      vault,
      ingestionSessionClosed: true,
    });
    await readConceptsAndRelations(conceptWiring, corpusWiring, stateStore, {
      vault,
      ingestionSessionClosed: true,
    });

    const links = await proposedLinks(vault);
    expect(links).toHaveLength(1);
  });
});

describe('readConceptsAndRelations wires proposeSameAsForMovedNoteAnchors into the real tick (ol-egov.141.89.3.4, gap 2 from ol-egov.141.89.3.8)', () => {
  it('an orphaned no-uid note anchor is proposed same-as the freshly-resolved topic key at its recovered name', async () => {
    const vault = new MemoryVault({
      '05 Zettelkasten/Renamed Later.md': 'Her original note text.',
    });
    // Minted directly against THIS vault instance, exactly as `key-store.ts`'s own
    // `resolveConceptKey` would from a prior tick's tier-1 binding — bypassing the extraction
    // walk itself is fine here, since this test's job is the WIRING one hop up, not re-proving
    // tier-1 binding (covered elsewhere).
    const oldKey = await resolveConceptKey(vault, 1, {
      kind: 'note',
      noteUid: null,
      notePath: '05 Zettelkasten/Renamed Later.md',
    });
    // The note is gone by the time the next tick runs — moved, in effect, since nothing else on
    // disk carries `oldKey` any more.
    await vault.delete('05 Zettelkasten/Renamed Later.md');
    // A course note cites the SAME wording (case-folded) as a plain topic — the "freshly
    // resolved candidate" `proposeSameAsForMovedNoteAnchors`'s own doc names.
    await vault.write(
      '01 Courses/CourseA/Notes.md',
      '---\ntopic: [[renamed later]]\n---\n\nSome prose citing the topic by its later wording.\n',
    );

    const transport = emptyTransport();
    const conceptWiring = await buildConceptWiring({
      dataHost: configuredHost(READY_CONFIG),
      createTransport: () => transport,
    });
    const corpusWiring = await buildCorpusRelationWiring({
      dataHost: configuredHost(READY_CONFIG),
      createTransport: () => transport,
    });

    const pass = await readConceptsAndRelations(
      conceptWiring,
      corpusWiring,
      new ObsidianCorpusRelationStateStore(new FakeDataHost()),
      { vault, ingestionSessionClosed: true },
    );

    expect(pass).not.toBeNull();
    const freshCandidate = pass?.read.concepts.find((c) => c.name === 'renamed later');
    expect(freshCandidate).toBeDefined();
    expect(freshCandidate?.key).not.toBe(oldKey); // a genuinely new mint, not a rewrite of the old key.

    const links = await proposedLinks(vault);
    expect(links).toHaveLength(1);
    expect(links[0]).toMatchObject({ status: 'proposed', reason: 'normalisation-collision' });
    expect([links[0]?.keyA, links[0]?.keyB].sort()).toEqual([oldKey, freshCandidate?.key].sort());
  });

  it('proposes nothing when the note has not moved — no orphan to propose against', async () => {
    const vault = new MemoryVault({
      '05 Zettelkasten/Concept One.md': 'Still there.',
    });
    await resolveConceptKey(vault, 1, {
      kind: 'note',
      noteUid: null,
      notePath: '05 Zettelkasten/Concept One.md',
    });
    await vault.write(
      '01 Courses/CourseA/Notes.md',
      '---\ntopic: [[concept one]]\n---\n\nSome prose citing the same wording.\n',
    );

    const transport = emptyTransport();
    const conceptWiring = await buildConceptWiring({
      dataHost: configuredHost(READY_CONFIG),
      createTransport: () => transport,
    });
    const corpusWiring = await buildCorpusRelationWiring({
      dataHost: configuredHost(READY_CONFIG),
      createTransport: () => transport,
    });

    await readConceptsAndRelations(
      conceptWiring,
      corpusWiring,
      new ObsidianCorpusRelationStateStore(new FakeDataHost()),
      { vault, ingestionSessionClosed: true },
    );

    const links = await proposedLinks(vault);
    expect(links).toHaveLength(0);
  });
});
