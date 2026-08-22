/**
 * The Worker base URL field's UI copy (`ol-k57j`). F7.1 names only the
 * credential ("a pasted token in v0.9"); it does not name a base URL as
 * something she configures, because in the shipped product there is exactly
 * one Worker to talk to. This field exists anyway, alongside the token, for
 * the same reason `WorkerHttpTransport` takes a base URL as configuration
 * rather than a compiled-in constant: this repo also has a local Worker for
 * development (`http://127.0.0.1:8787`, per the service repo's own
 * `CLAUDE.md`), and hard-coding the production URL would make pointing the
 * plugin at it during development require a source edit instead of a
 * settings change. No default is shipped — see `EMPTY_WORKER_CONFIG` in
 * `../worker/config-store.ts` — so an unconfigured install has both fields
 * blank, which reads as "not set up yet," not as a wrong value.
 *
 * Held as pure data for the same reason `token-field-copy.ts` is: assertable
 * without a DOM.
 */

export const BASE_URL_FIELD_NAME = 'Worker base URL';

export const BASE_URL_FIELD_DESCRIPTION =
  "The Olea service's address. Leave blank until you have one — AI features stay off, and cards, review, scheduling and the Today panel work exactly the same either way.";

export const BASE_URL_FIELD_PLACEHOLDER = 'https://olea-service.example.workers.dev';
