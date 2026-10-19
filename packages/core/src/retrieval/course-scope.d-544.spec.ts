/**
 * `[D-544]` (`ol-egov.141.89.3.52`): drafting retrieval is scoped to the course's own reading set,
 * so another course's material never silently satisfies a course's grounding, and a course whose own
 * material is thin keeps its stated refusal.
 *
 * Invented content throughout: courses `C` and `D`, a made-up concept wording, and filler.
 *
 * The embedding space is orthogonal and exact (one axis per text, as `draft-quiz-cards.spec.ts`
 * builds it), so a test can put another course's passage at cosine 1 and this course's at a chosen
 * lower value and see which one the band reads.
 */
import { describe, expect, it } from 'vitest';
import type { IndexedDocument, PersistedKeywordIndex } from '../keyword-index/types.js';
import {
  courseReadingSetResolver,
  frontmatterWikilinkTargets,
  ownCourseScope,
} from './course-reading-set.js';
import { EmbeddingCacheEngine } from './embeddingCache.js';
import { retrieve } from './engine.js';
import type { GroundingJudgePort } from './groundedContext.js';
import { D112_GROUNDING_BAND } from './operating-point.js';
import type {
  EmbeddingCacheStore,
  EmbeddingProvider,
  EmbedRequest,
  EmbedResult,
  PersistedEmbeddingCache,
} from './types.js';

class MemoryEmbeddingCacheStore implements EmbeddingCacheStore {
  private saved: PersistedEmbeddingCache | null = null;
  async load(): Promise<PersistedEmbeddingCache | null> {
    return this.saved;
  }
  async save(cache: PersistedEmbeddingCache): Promise<void> {
    this.saved = cache;
  }
}

const FILLER_COUNT = 40;
const DIM = 4 + FILLER_COUNT;

function unitVector(index: number): number[] {
  const v = new Array(DIM).fill(0);
  v[index] = 1;
  return v;
}

/** Exact vectors by text; an unregistered text is a loud fixture error. */
class LookupEmbeddingProvider implements EmbeddingProvider {
  private readonly vectors = new Map<string, readonly number[]>();
  register(text: string, vector: readonly number[]): void {
    this.vectors.set(text, vector);
  }
  async embed(request: EmbedRequest): Promise<EmbedResult> {
    return {
      vectors: request.texts.map((text) => {
        const vector = this.vectors.get(text);
        if (vector === undefined)
          throw new Error(`no vector registered for ${JSON.stringify(text)}`);
        return vector;
      }),
    };
  }
}

function doc(
  path: string,
  blocks: readonly string[],
  courses: readonly string[] = [],
): IndexedDocument {
  return {
    path,
    courses,
    contentHash: 'unused',
    blocks: blocks.map((text, blockIndex) => ({ blockIndex, kind: 'paragraph' as const, text })),
  };
}

const QUERY = 'tessellite';
/** Course D's long explanation of the wording, the passage that must never ground course C. */
const D_PASSAGE = 'Tessellite is the interlocking crystal habit explained at length in course D.';
/** Course C's own, weaker mention of the wording. */
const C_PASSAGE = 'A passing tessellite remark in course C notes.';

/** Course C's folder holds filler and (optionally) its own mention; course D's folder holds the full explanation. */
function fixture(options: { readonly withCMention: boolean; readonly cCosine?: number }) {
  const provider = new LookupEmbeddingProvider();
  const cCosine = options.cCosine ?? 0.4;
  // Query on axis 0 (with a private residual on axis 1 so it stays unit length when needed).
  provider.register(QUERY, unitVector(0));
  provider.register(D_PASSAGE, unitVector(0)); // cosine 1 to the query
  const cVector = unitVector(0).map((x, i) =>
    i === 0 ? cCosine : i === 2 ? Math.sqrt(1 - cCosine * cCosine) : x,
  );
  provider.register(C_PASSAGE, cVector);
  const cDocs: IndexedDocument[] = [];
  const dDocs: IndexedDocument[] = [];
  for (let i = 0; i < FILLER_COUNT; i++) {
    const text = `unrelated filler passage ${i}`;
    provider.register(text, unitVector(4 + i));
    (i % 2 === 0 ? cDocs : dDocs).push(
      doc(`01 Courses/${i % 2 === 0 ? 'C' : 'D'}/filler ${i}.md`, [text]),
    );
  }
  if (options.withCMention) cDocs.push(doc('01 Courses/C/Week 1.md', [C_PASSAGE]));
  dDocs.push(doc('01 Courses/D/Week 3.md', [D_PASSAGE]));
  const keywordIndex: PersistedKeywordIndex = {
    version: 1,
    documents: [...cDocs, ...dDocs].sort((a, b) => (a.path < b.path ? -1 : 1)),
  };
  return { keywordIndex, provider };
}

async function depsFor(keywordIndex: PersistedKeywordIndex, provider: LookupEmbeddingProvider) {
  const embeddingCache = await EmbeddingCacheEngine.create({
    store: new MemoryEmbeddingCacheStore(),
    provider,
    model: 'fake-model-v1',
  });
  return { keywordIndex, embeddingCache, embeddingProvider: provider };
}

function scopeFor(keywordIndex: PersistedKeywordIndex, course: string) {
  return { scope: ownCourseScope(course), courseOf: courseReadingSetResolver(keywordIndex) };
}

const supportingJudge: GroundingJudgePort = {
  async judge() {
    return { supported: true, reason: 'supported' };
  },
};

describe('[D-544] retrieval scoped to a course draws only on that course reading set', () => {
  it("refuses for course C when only course D's notes explain the wording, though the same call unscoped grounds on D", async () => {
    const { keywordIndex, provider } = fixture({ withCMention: false });
    const deps = await depsFor(keywordIndex, provider);

    const unscoped = await retrieve(deps, QUERY);
    expect(unscoped.status).toBe('grounded');
    if (unscoped.status === 'grounded') {
      expect(unscoped.chunks.map((chunk) => chunk.path)).toContain('01 Courses/D/Week 3.md');
    }

    const scoped = await retrieve(deps, QUERY, { scope: scopeFor(keywordIndex, 'C') });
    expect(scoped.status).toBe('refused');
  });

  it("the band reads only course C's own passages: D's cosine-1 passage cannot lift C's top1 over the lower bar", async () => {
    const { keywordIndex, provider } = fixture({ withCMention: true, cCosine: 0.4 });
    const deps = await depsFor(keywordIndex, provider);

    const unscoped = await retrieve(deps, QUERY, {
      band: D112_GROUNDING_BAND,
      judge: supportingJudge,
    });
    expect(unscoped.status).toBe('grounded');

    const scoped = await retrieve(deps, QUERY, {
      band: D112_GROUNDING_BAND,
      judge: supportingJudge,
      scope: scopeFor(keywordIndex, 'C'),
    });
    expect(scoped).toMatchObject({ status: 'refused', reason: 'below-band' });
  });

  it("where course C's own passage clears the band, it grounds on C's passage alone", async () => {
    const { keywordIndex, provider } = fixture({ withCMention: true, cCosine: 0.9 });
    const deps = await depsFor(keywordIndex, provider);

    const scoped = await retrieve(deps, QUERY, {
      band: D112_GROUNDING_BAND,
      judge: supportingJudge,
      scope: scopeFor(keywordIndex, 'C'),
    });
    expect(scoped.status).toBe('grounded');
    if (scoped.status === 'grounded') {
      expect(scoped.chunks.length).toBeGreaterThan(0);
      for (const chunk of scoped.chunks) expect(chunk.path.startsWith('01 Courses/C/')).toBe(true);
      expect(scoped.chunks.map((chunk) => chunk.text)).not.toContain(D_PASSAGE);
    }
  });

  it('with no scope, every indexed document is a candidate, exactly as before', async () => {
    const { keywordIndex, provider } = fixture({ withCMention: true, cCosine: 0.9 });
    const deps = await depsFor(keywordIndex, provider);
    const result = await retrieve(deps, QUERY, { topK: 2 });
    expect(result.status).toBe('grounded');
    if (result.status === 'grounded') {
      expect(result.chunks.map((chunk) => chunk.path).sort()).toEqual([
        '01 Courses/C/Week 1.md',
        '01 Courses/D/Week 3.md',
      ]);
    }
  });
});

describe('[D-544] the course reading set: the course folder, its own documents and their one-hop closure (F1.3, [D-248])', () => {
  const index: PersistedKeywordIndex = {
    version: 1,
    documents: [
      doc('01 Courses/C/Lecture 1.md', ['See [[Linked by C]] and [[Shared Note|shared]].']),
      doc('01 Courses/C/Lecture 2.md', ['No links here.']),
      doc('01 Courses/C/Filed elsewhere.md', ['Filed in C but declared for D.'], ['D']),
      doc('01 Courses/D/Lecture 1.md', ['See [[Linked by D]] and [[Shared Note#Part]].']),
      doc('Zettelkasten/Linked by C.md', ['a note C links once']),
      doc('Zettelkasten/Linked by D.md', ['a note only D links']),
      doc('Zettelkasten/Shared Note.md', ['a note both courses link']),
      doc('Zettelkasten/Unlinked.md', ['a note no course links']),
      doc('Zettelkasten/Frontmatter only.md', ['linked only from C frontmatter']),
      doc('Papers/C past paper 2024.pdf', ['Question 1 names a wording.'], ['C']),
      doc('Zettelkasten/Second hop.md', ['linked from a closure note, never from a course note']),
      doc('Zettelkasten/Linked by C note.md', ['[[Second hop]]']),
    ],
  };

  it('admits the course folder, the notes its course notes link once, and documents registered to it', () => {
    const courseOf = courseReadingSetResolver(index);
    expect(courseOf('01 Courses/C/Lecture 1.md')).toEqual(['C']);
    expect(courseOf('01 Courses/C/Lecture 2.md')).toEqual(['C']);
    expect(courseOf('Zettelkasten/Linked by C.md')).toEqual(['C']);
    expect(courseOf('Zettelkasten/Shared Note.md')).toEqual(['C', 'D']);
    expect(courseOf('Papers/C past paper 2024.pdf')).toEqual(['C']);
  });

  it('excludes a note only another course links, an unlinked note, and a second hop', () => {
    const courseOf = courseReadingSetResolver(index);
    expect(courseOf('Zettelkasten/Linked by D.md')).toEqual(['D']);
    expect(courseOf('Zettelkasten/Unlinked.md')).toEqual([]);
    expect(courseOf('Zettelkasten/Second hop.md')).toEqual([]);
  });

  it("a note's own course property is believed over the folder it sits in", () => {
    const courseOf = courseReadingSetResolver(index);
    expect(courseOf('01 Courses/C/Filed elsewhere.md')).toEqual(['D']);
  });

  it('a frontmatter link reaches the closure when the host supplies it, and not otherwise', () => {
    expect(courseReadingSetResolver(index)('Zettelkasten/Frontmatter only.md')).toEqual([]);
    const withFrontmatter = courseReadingSetResolver(index, {
      frontmatterLinksFor: (path) =>
        path === '01 Courses/C/Lecture 2.md' ? ['Frontmatter only'] : [],
    });
    expect(withFrontmatter('Zettelkasten/Frontmatter only.md')).toEqual(['C']);
  });

  it('the closure stops silently at the per-course cap', () => {
    const capped = courseReadingSetResolver(index, { closureDocumentCap: 1 });
    expect(capped('Zettelkasten/Linked by C.md')).toEqual(['C']);
    expect(capped('Zettelkasten/Linked by D.md')).toEqual(['D']);
    // Each course's first link filled its cap of one, so the note both link reaches neither.
    expect(capped('Zettelkasten/Shared Note.md')).toEqual([]);
  });

  it('own-course scope admits only the course and no uncoursed document, with nothing to widen it', () => {
    expect(ownCourseScope('C')).toEqual({ courses: ['C'], includeUncoursed: false });
  });
});

describe('[D-544] frontmatterWikilinkTargets reads the shapes a host parser gives a link', () => {
  it('reads a quoted link, an unquoted flow link, a list of links and nested objects', () => {
    expect(frontmatterWikilinkTargets('[[Alpha]]')).toEqual(['Alpha']);
    expect(frontmatterWikilinkTargets([['Beta']])).toEqual(['Beta']);
    expect(frontmatterWikilinkTargets(['[[Gamma]]', 'plain', [['Delta']]])).toEqual([
      'Gamma',
      'Delta',
    ]);
    expect(frontmatterWikilinkTargets({ topic: [['Epsilon']], course: 'C' })).toEqual(['Epsilon']);
    expect(frontmatterWikilinkTargets(['plain'])).toEqual([]);
    expect(frontmatterWikilinkTargets(undefined)).toEqual([]);
  });
});
