/**
 * The settings pane's graceful-degradation statement (F7.8, P2-T10). See
 * `../../../../olea-service/docs/Olea_alpha_functional_scope.md` for the
 * clause itself.
 *
 * F7.8 requires four things of this build, and the two strings below are
 * written to satisfy all four: that the smart half can be turned off
 * outright; that four capabilities — cards, review, scheduling, the Today
 * panel — go on working with no AI whatever; that the guarantee is put to the
 * user in settings rather than left implicit; and that the same guarantee
 * doubles as the answer when the Worker cannot be reached.
 *
 * **These are the product's wording of that promise, not the contract's.** The
 * clause is a spec sentence and reads like one; what ships here is written for
 * a person opening a settings pane.
 *
 * **`[STALE-AI1]` (`ol-egov.141.8.5`): the previous body claimed "AI features
 * are not yet available in this build."** That was true for the whole of P2,
 * when no Worker transport existed at all, but it went stale the moment
 * `ol-k57j` shipped a real `WorkerTaskTransport`
 * (`../worker/transport.ts`/`../worker/obsidian-transport.ts`) with a live
 * "Test connection" check (`../worker/test-connection.ts`) right below this
 * statement in the same pane — the two disagreed in front of her. What is
 * actually true today, established from the wiring code rather than from any
 * document: every AI-backed feature (card generation —
 * `../generation/wiring.ts:100`; explain-back grading —
 * `../grading/wiring.ts:289`; retrieval/embeddings —
 * `../retrieval/wiring.ts:114`; concept reading and knowledge-kind
 * classification — `../concept/wiring.ts:186,334`) is composed at startup
 * behind the SAME `isWorkerConfigured` check (`../worker/config-store.ts:55`
 * — true once both a base URL and a token are non-blank) and resolves to
 * `null`, not a crash, when it fails; `main.ts` (`this.grading`/`this.concept`
 * `=== null`) then refuses each call honestly rather than attempting it. A
 * live transport call that fails outright (offline, a bad URL) is caught
 * per-call and treated as "revisit later," never a throw that reaches her
 * (`../generation/pipeline.ts`'s `runGenerationSweep`, the `catch` around its
 * drafting call). So the accurate claim is conditional, not flat in either
 * direction: AI is available once a base URL and token are entered below and
 * the connection succeeds, and it greys out — without breaking anything else
 * — when unconfigured, switched off, or unreachable. Kept in this module
 * rather than paraphrased ad hoc in `settings-tab.ts` so that one wording is
 * reviewable and testable in one place. Kept as two plain strings, not
 * JSX/markup, because `settings-tab.ts` renders them with Obsidian's own
 * `Setting`/`createEl` calls.
 */

export const DEGRADATION_STATEMENT_HEADING = 'Olea works without AI';

export const DEGRADATION_STATEMENT_BODY =
  'Cards, review, scheduling, and the Today panel are the core of Olea, and all of them always work with no AI connection at all. AI is an optional layer on top for things like generating cards or explaining a topic: it switches on once you paste a Worker access token and base URL below and the connection succeeds, and switching it off, leaving it unconfigured, or losing the connection to it never stops the rest of Olea from working.';
