/**
 * Expanded-prompt budgeting (`ol-egov.141.89.3.62`). No service import or filesystem dependency.
 * renderRelationsPrompt / formatEndpoint / formatCandidate below reproduce the three functions
 * in olea-service/src/tasks/conceptsRelations.ts, read on 2026-10-26. Checked against that source
 * after TypeScript transpilation (so quote/formatting differences do not matter).
 *
 * The system prompt's measured UTF-8 size is pinned separately: 9,542 bytes, SHA-256
 * 1c85a8c2f53dfc84d2e02af756b1ff5757a768ebf547cfe2666b44913e94eea0.
 * Source: olea-service/prompts/concepts.relations/system.prompt.md, also read on 2026-10-26.
 * Only its byte size is needed; the private prompt text is not copied into the public client.
 *
 * The delegated source renderer is outside the permitted service-file read scope. Its substitute
 * below uses the entire reserved wrapper allowance around every claim and intervening span.
 * This checks the service's exact surrounding text against a worst-case source-rendering fixture;
 * it does not assert parity with the unread source renderer.
 */

import type { CorpusVerdictRequest, WorkerTaskRequest } from 'olea-core';
import { describe, expect, it } from 'vitest';
import {
  CORPUS_RELATION_REQUEST_CEILING_BYTES,
  CORPUS_RELATIONS_PROMPT_CEILING_BYTES,
  corpusRelationPayloadBytes,
  corpusRelationPromptBytes,
  planCorpusRelationBatches,
  WorkerCorpusRelationVerdict,
  WorkerCorpusRelationVerdictError,
} from '../../src/concept/workerCorpusRelationVerdict.js';
import type { SourceChunkOrigins, SourceOriginFrontmatterHost } from '../../src/source-origin.js';

type Candidate = CorpusVerdictRequest['candidates'][number];
type Endpoint = Candidate['a'];

interface WireEndpoint {
  readonly name: string;
  readonly aliases: readonly string[];
  readonly sourceChunks: readonly string[];
  readonly sourceChunkOrigins?: SourceChunkOrigins;
}

interface DictionaryPayload {
  readonly endpoints: Readonly<Record<string, WireEndpoint>>;
  readonly candidates: readonly { readonly a: string; readonly b: string }[];
}

interface ConceptsRelationsCandidate {
  readonly a: WireEndpoint;
  readonly b: WireEndpoint;
}

interface ConceptsRelationsRequest {
  readonly candidates: readonly ConceptsRelationsCandidate[];
}

const utf8 = new TextEncoder();
const systemPrompt = ' '.repeat(9_542);

/** Deliberately fills all 512 reserved bytes per rendered passage, including separators. */
function renderSourceContextWithOrigins(
  chunks: readonly string[],
  origins?: SourceChunkOrigins,
): string {
  const spans: string[] = [];
  for (const [index, text] of chunks.entries()) {
    let start = 0;
    for (const claim of origins?.[index]?.flaggedClaims ?? []) {
      spans.push(text.slice(start, claim.start), text.slice(claim.start, claim.end));
      start = claim.end;
    }
    spans.push(text.slice(start));
  }
  return spans
    .map((span, index) => {
      const marker = `[${index + 1}] (spoken source, unknown speaker; flagged: inaudible, visual-reference, term-discrepancy)`;
      return marker.padEnd(510, ' ') + span;
    })
    .join('\n\n');
}

function renderRelationsPrompt(payload: ConceptsRelationsRequest): {
  system: string;
  user: string;
} {
  return {
    system: systemPrompt,
    user: [
      "Candidate concept pairs, each with both concepts' own introducing passages:",
      '',
      payload.candidates.map((candidate, i) => formatCandidate(i, candidate)).join('\n\n'),
      '',
      'Return JSON: { "verdicts": [{ "a": string, "b": string, "type": "prerequisite" | ' +
        '"contrasts-with" | "causes", "direction": "a-to-b" | "b-to-a" (prerequisite and ' +
        'causes only, omit for contrasts-with), "confidence": number }, ...] }',
      '"a" and "b" must be copied EXACTLY from the concept names given above — never a passage ' +
        'number, never a paraphrase. Report a verdict only for a pair the material actually ' +
        'supports; omit a pair entirely rather than forcing a type onto it. Report ' +
        '"causes" only where a passage states the causal link or mechanism and which way it ' +
        'runs — never for association, order or one concept being needed to follow the other. ' +
        'verdicts may be an empty array — an honest empty list is always a correct answer when ' +
        'no pair is settled by the material.',
    ].join('\n'),
  };
}

function formatEndpoint(label: string, endpoint: ConceptsRelationsCandidate['a']): string {
  return [
    `Concept ${label}: "${endpoint.name}"${
      endpoint.aliases.length > 0 ? ` (also known as: ${endpoint.aliases.join(', ')})` : ''
    }`,
    `Source material for ${label}:`,
    renderSourceContextWithOrigins(endpoint.sourceChunks, endpoint.sourceChunkOrigins),
  ].join('\n');
}

function formatCandidate(index: number, candidate: ConceptsRelationsCandidate): string {
  return [
    `Pair ${index + 1}:`,
    formatEndpoint('a', candidate.a),
    '',
    formatEndpoint('b', candidate.b),
  ].join('\n');
}

function renderedPromptBytes(payload: DictionaryPayload): number {
  const rendered = renderRelationsPrompt({
    candidates: payload.candidates.map((pair) => {
      const a = payload.endpoints[pair.a];
      const b = payload.endpoints[pair.b];
      if (a === undefined || b === undefined) throw new Error('Unresolved fixture endpoint.');
      return { a, b };
    }),
  });
  return utf8.encode(rendered.system).length + utf8.encode(rendered.user).length;
}

class RecordingTransport {
  readonly sent: WorkerTaskRequest[] = [];
  constructor(
    private readonly reply: (payload: DictionaryPayload) => unknown = () => ({ verdicts: [] }),
  ) {}
  async send(request: WorkerTaskRequest): Promise<unknown> {
    this.sent.push(request);
    return { ok: true, result: this.reply(request.payload as DictionaryPayload) };
  }
}

function endpoint(
  name: string,
  doc = name,
  passageText = 'A synthetic introducing passage.',
): Endpoint {
  return {
    name,
    aliases: [],
    anchor: { sourcePath: `Courses/Synthetic/${doc}.md`, location: { page: 1 } },
    passageText,
  };
}

function hubCandidates(): readonly Candidate[] {
  // A unique-leaf star with only 8,000 ASCII characters per endpoint cannot exceed the prompt
  // limit under a 128k wire limit. Aliases have no schema cap and repeat too: give the hub a large
  // alias so this fixture fits on the wire while its expanded passages + names exceed 511,488.
  const hub = { ...endpoint('hub', 'alpha', 'h'.repeat(8_000)), aliases: ['a'.repeat(36_000)] };
  return Array.from({ length: 10 }, (_, i) => ({
    a: hub,
    b: endpoint(`leaf ${i}`, 'beta', 'l'.repeat(8_000)),
  }));
}

describe('WorkerCorpusRelationVerdict — expanded prompt budget', () => {
  it('mirrors the service ceiling derived from the context and output windows', () => {
    expect(CORPUS_RELATIONS_PROMPT_CEILING_BYTES).toBe(Math.floor(0.75 * (256_000 - 28_672)) * 3);
  });

  it('splits a hub-and-leaf payload that fits on the wire but exceeds the expanded prompt ceiling', async () => {
    const candidates = hubCandidates();
    expect(corpusRelationPayloadBytes(candidates)).toBeLessThan(
      CORPUS_RELATION_REQUEST_CEILING_BYTES,
    );
    expect(corpusRelationPromptBytes(candidates)).toBeGreaterThan(
      CORPUS_RELATIONS_PROMPT_CEILING_BYTES,
    );
    // Even before any wrappers/system text, the real service repeats over 511,488 bytes.
    const repeatedContent = candidates.reduce(
      (sum, pair) =>
        sum +
        utf8.encode(pair.a.passageText + pair.b.passageText + pair.a.aliases.join(', ')).length,
      0,
    );
    expect(repeatedContent).toBeGreaterThan(CORPUS_RELATIONS_PROMPT_CEILING_BYTES);

    const batches = planCorpusRelationBatches(candidates, undefined);
    expect(batches).toHaveLength(2);
    expect(batches.flat()).toEqual(candidates);
    expect(planCorpusRelationBatches(candidates, undefined)).toEqual(batches);

    const transport = new RecordingTransport();
    const response = await new WorkerCorpusRelationVerdict({ transport }).verdict({ candidates });
    expect(response.batchesSent).toBe(batches.length);
    expect(response.failedBatches).toBeUndefined();
    expect(transport.sent).toHaveLength(batches.length);
    for (const [index, batch] of batches.entries()) {
      expect(corpusRelationPayloadBytes(batch)).toBeLessThanOrEqual(
        CORPUS_RELATION_REQUEST_CEILING_BYTES,
      );
      expect(corpusRelationPromptBytes(batch)).toBeLessThanOrEqual(
        CORPUS_RELATIONS_PROMPT_CEILING_BYTES,
      );
      const payload = transport.sent[index]?.payload as DictionaryPayload;
      expect(renderedPromptBytes(payload)).toBeLessThanOrEqual(corpusRelationPromptBytes(batch));
      expect(payload.endpoints.hub?.sourceChunks).toEqual(['h'.repeat(8_000)]);
    }
  });

  const ordinaryCases: { readonly name: string; readonly candidates: readonly Candidate[] }[] = [
    { name: 'one pair', candidates: [{ a: endpoint('a'), b: endpoint('b') }] },
    {
      name: 'multibyte names, aliases and multiline passages',
      candidates: [
        {
          a: {
            ...endpoint('α "quoted"', 'alpha', '第一行\n\nemoji 🧪\n\\ and " and \ud800'),
            aliases: ['別名', '𝛼', 'line\nbreak', ''],
          },
          b: { ...endpoint('β', 'beta', 'é'.repeat(8_000)), aliases: ['beta', 'βήτα'] },
        },
      ],
    },
    {
      name: 'empty and whitespace passages',
      candidates: [{ a: endpoint('empty', 'alpha', ''), b: endpoint('space', 'beta', ' \n\t ') }],
    },
    { name: 'repeated hub aliases and passages', candidates: hubCandidates().slice(0, 8) },
    {
      name: 'three-digit pair numbers',
      candidates: Array.from({ length: 101 }, () => ({ a: endpoint('a'), b: endpoint('b') })),
    },
  ];

  it.each(ordinaryCases)(
    'bounds mirrored service text with full source-wrapper allowances: $name',
    async ({ candidates }) => {
      const transport = new RecordingTransport();
      await new WorkerCorpusRelationVerdict({ transport }).verdict({ candidates });
      expect(transport.sent).toHaveLength(1);
      expect(corpusRelationPromptBytes(candidates)).toBeGreaterThanOrEqual(
        renderedPromptBytes(transport.sent[0]?.payload as DictionaryPayload),
      );
    },
  );

  it('budgets claim splitting and spoken-source annotations for both endpoints on every pair', async () => {
    const text =
      'Its mass is [inaudible]. A usable claim. On this graph, it cools. Another usable claim.';
    const host: SourceOriginFrontmatterHost = {
      frontmatterFor: () => ({ role: 'lecture-transcript' }),
    };
    const hub = endpoint('spoken hub', 'lecture', text);
    const candidates = [
      { a: hub, b: endpoint('spoken leaf 1', 'lecture', text) },
      { a: hub, b: endpoint('spoken leaf 2', 'lecture', text) },
    ];
    const transport = new RecordingTransport();
    await new WorkerCorpusRelationVerdict({ transport, frontmatterHost: host }).verdict({
      candidates,
    });
    const payload = transport.sent[0]?.payload as DictionaryPayload;
    expect(
      payload.endpoints[hub.name]?.sourceChunkOrigins?.[0]?.flaggedClaims?.length,
    ).toBeGreaterThan(1);
    expect(corpusRelationPromptBytes(candidates, host)).toBeGreaterThan(
      corpusRelationPromptBytes(candidates),
    );
    expect(corpusRelationPromptBytes(candidates, host)).toBeGreaterThanOrEqual(
      renderedPromptBytes(payload),
    );
  });

  it('uses the first dictionary entry when a later pair supplies different data for the same name', async () => {
    const hub = { ...endpoint('hub', 'alpha'), aliases: ['a'.repeat(250_000)] };
    const first = { a: hub, b: endpoint('leaf 1', 'beta') };
    const second = { a: endpoint('hub', 'alpha'), b: endpoint('leaf 2', 'beta') };
    expect(corpusRelationPromptBytes([first, second])).toBe(
      corpusRelationPromptBytes([first, { ...second, a: hub }]),
    );
    const batches = planCorpusRelationBatches([first, second], undefined, 1_000_000);
    expect(batches).toEqual([[first], [second]]);
    const transport = new RecordingTransport();
    await new WorkerCorpusRelationVerdict({ transport, requestCeilingBytes: 1_000_000 }).verdict({
      candidates: [first, second],
    });
    expect(transport.sent).toHaveLength(2);
  });

  it.each(['passage', 'alias'] as const)(
    'refuses a single oversized %s locally through the existing error',
    async (field) => {
      const text = 'secret'.repeat(100_000);
      const a = {
        ...endpoint('secret concept'),
        ...(field === 'passage' ? { passageText: text } : { aliases: [text] }),
      };
      const transport = new RecordingTransport();
      const result = new WorkerCorpusRelationVerdict({ transport }).verdict({
        candidates: [{ a, b: endpoint('b') }],
      });
      await expect(result).rejects.toBeInstanceOf(WorkerCorpusRelationVerdictError);
      await expect(result).rejects.toMatchObject({ code: 'prompt-too-large' });
      await expect(result).rejects.not.toThrow('secret');
      expect(transport.sent).toHaveLength(0);
      expect(field === 'passage' ? a.passageText : a.aliases[0]).toBe(text);
    },
  );

  it('reports an oversized singleton in failedBatches and retains valid batches on both sides', async () => {
    const before = { a: endpoint('before a', 'alpha'), b: endpoint('before b', 'alpha') };
    const oversized = {
      a: endpoint('secret a', 'beta', 'secret'.repeat(100_000)),
      b: endpoint('secret b', 'beta'),
    };
    const after = { a: endpoint('after a', 'gamma'), b: endpoint('after b', 'gamma') };
    const candidates = [after, oversized, before];
    expect(planCorpusRelationBatches(candidates, undefined)).toEqual([
      [before],
      [oversized],
      [after],
    ]);
    const transport = new RecordingTransport((payload) => ({
      verdicts: payload.candidates.map((pair) => ({
        ...pair,
        type: 'contrasts-with',
        confidence: 0.8,
      })),
    }));
    const response = await new WorkerCorpusRelationVerdict({ transport }).verdict({ candidates });
    expect(response.failedBatches).toEqual([{ candidates: 1, reason: 'prompt-too-large' }]);
    expect(response.verdicts.map((verdict) => verdict.a)).toEqual(['before a', 'after a']);
    // batchesSent counts the batches the call was split into (verdict.ts's contract); the oversized
    // singleton is one of them, refused locally, so only two reach the transport.
    expect(response.batchesSent).toBe(3);
    expect(transport.sent).toHaveLength(2);
    expect(JSON.stringify(response)).not.toContain('secret');
    expect(JSON.stringify(transport.sent)).not.toContain('secret');
  });

  it('accepts an estimate exactly at the ceiling and refuses one byte above it', async () => {
    const base = { a: { ...endpoint('a'), aliases: [''] }, b: endpoint('b') };
    const remaining = CORPUS_RELATIONS_PROMPT_CEILING_BYTES - corpusRelationPromptBytes([base]);
    const atLimit = { ...base, a: { ...base.a, aliases: ['a'.repeat(remaining)] } };
    expect(corpusRelationPromptBytes([atLimit])).toBe(CORPUS_RELATIONS_PROMPT_CEILING_BYTES);
    const transport = new RecordingTransport();
    const port = new WorkerCorpusRelationVerdict({ transport, requestCeilingBytes: 1_000_000 });
    await port.verdict({ candidates: [atLimit] });
    expect(transport.sent).toHaveLength(1);
    const aboveLimit = { ...atLimit, a: { ...atLimit.a, aliases: [`${atLimit.a.aliases[0]}a`] } };
    await expect(port.verdict({ candidates: [aboveLimit] })).rejects.toMatchObject({
      code: 'prompt-too-large',
    });
    expect(transport.sent).toHaveLength(1);
  });
});
