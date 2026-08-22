/**
 * `testWorkerConnection` — the one real end-to-end path this bead (`ol-k57j`)
 * wires: settings → `WorkerHttpTransport` → a real `POST /v1/task` on the
 * live Worker → a parsed response → an honest message in the settings pane.
 * It is deliberately the smallest useful path rather than a full pipeline
 * (retrieval/quiz/grading are all still unwired — see the bead's own "what
 * NOT to do"), chosen because it proves the seam itself works without
 * requiring any of those other, larger pipelines to be touched.
 *
 * **Zero AI spend, by construction, on every outcome — including a valid
 * token.** It sends the frozen `retrieval.embed.v1` envelope
 * (`olea-core`'s `RETRIEVAL_EMBED_TASK_ID`/`RETRIEVAL_EMBED_CONTRACT_VERSION`)
 * with a deliberately empty `chunks` array. `olea-service`'s
 * `retrievalEmbedRequest` schema requires `chunks` to be non-empty
 * (`z.array(...).min(1)`), and — this is the load-bearing fact — the
 * Worker's `POST /v1/task` handler verifies the bearer token *before* it
 * looks at the task id or validates the payload, for both the chat and the
 * embedding dispatch paths (`olea-service/src/index.ts`,
 * `src/embedDispatch.ts`). So a request built this way can only ever land on
 * one of two outcomes from a reachable Worker: `unauthenticated` (the token
 * is missing or wrong — never reaches payload validation) or
 * `invalid-request` (the token passed, and the payload was rejected exactly
 * as designed) — never the embedding model itself. A real `ok: true` success
 * is not a reachable outcome of this probe on purpose; `authenticated: true`
 * is the signal a valid, reachable configuration produces.
 *
 * Obsidian-free and fully testable: takes an already-constructed
 * `WorkerTaskTransport`, so it works identically against
 * `WorkerHttpTransport` (real) or a fake in tests.
 */

import type { WorkerTaskTransport } from 'olea-core';
import { RETRIEVAL_EMBED_CONTRACT_VERSION, RETRIEVAL_EMBED_TASK_ID } from 'olea-core';

export type TestConnectionOutcome =
  | { readonly reachable: true; readonly authenticated: true }
  | { readonly reachable: true; readonly authenticated: false; readonly message: string }
  | { readonly reachable: false; readonly message: string };

/** Human-readable outcomes, kept as data so they're assertable without a DOM — same convention as `settings/token-field-copy.ts`. */
export const TEST_CONNECTION_MESSAGES = {
  unreachable: 'Could not reach the Worker. Check the base URL and your connection.',
  unauthenticated: 'The Worker rejected the token. Paste a valid Olea service token.',
  unrecognised: 'The Worker responded, but not in a way this check recognises. It may still work.',
} as const;

export async function testWorkerConnection(
  transport: WorkerTaskTransport,
): Promise<TestConnectionOutcome> {
  let body: unknown;
  try {
    body = await transport.send({
      contractVersion: RETRIEVAL_EMBED_CONTRACT_VERSION,
      taskId: RETRIEVAL_EMBED_TASK_ID,
      // Deliberately empty — see the module doc. Never real content: this
      // probe carries nothing of hers by construction.
      payload: { chunks: [] },
    });
  } catch {
    // `WorkerTaskTransport`'s contract: a transport throws only on a
    // genuine network failure or an unparseable body. Either way, nothing
    // came back to inspect.
    return { reachable: false, message: TEST_CONNECTION_MESSAGES.unreachable };
  }

  const response =
    typeof body === 'object' && body !== null ? (body as Record<string, unknown>) : {};

  if (response.ok === false && response.code === 'unauthenticated') {
    return {
      reachable: true,
      authenticated: false,
      message: TEST_CONNECTION_MESSAGES.unauthenticated,
    };
  }
  if (response.ok === false && response.code === 'invalid-request') {
    // Exactly the outcome a reachable Worker with a valid token produces
    // against this deliberately-invalid payload — see the module doc.
    return { reachable: true, authenticated: true };
  }
  // Any other shape — a proxy error page, an unexpected code, `ok: true`
  // (which would mean the Worker's own validation changed underneath this
  // probe) — is reported as uninterpretable, never guessed at as success.
  return { reachable: true, authenticated: false, message: TEST_CONNECTION_MESSAGES.unrecognised };
}

/** One line for `settings-tab.ts` to show after a test — kept here, pure, so the wording is assertable without a DOM. */
export function describeTestConnectionOutcome(outcome: TestConnectionOutcome): string {
  if (!outcome.reachable) return outcome.message;
  if (!outcome.authenticated) return outcome.message;
  return 'Connected. The Worker is reachable and the token is valid.';
}
