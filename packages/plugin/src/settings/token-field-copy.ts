/**
 * The Worker access token field's UI copy and enabled state (F7.2, F7.1).
 * P2-T10 built this field's *shape* only, deliberately dark: a settings row
 * that existed so the pane wouldn't need restructuring once P3 wired it up.
 * `ol-k57j` is that wiring — a real `WorkerTaskTransport` now exists
 * (`../worker/transport.ts`) and can reach the Worker, so a permanently
 * disabled, unsaved token field would no longer be honest; it would say "not
 * built yet" about a thing that now is.
 *
 * The field is live: editable, and what's typed into it is persisted via
 * `../worker/config-store.ts` (`settings-tab.ts` wires `onChange` to a save
 * call — see that file). Two things are unchanged from the dark version on
 * purpose: the value is never logged (see `config-store.ts`'s and
 * `../worker/transport.ts`'s module docs and their "never logs" tests), and
 * this module still holds the field's copy as pure, DOM-free data so its
 * wording is assertable directly — the same discipline the dark version
 * used, now describing a field that does something rather than one that
 * doesn't.
 */

export const TOKEN_FIELD_NAME = 'Worker access token';

export const TOKEN_FIELD_DESCRIPTION =
  'Paste the access token Olea gave you for this device. Stored locally in the plugin data folder — never the vault — and sent only as the request header on calls you make to the Worker; never logged, never shown elsewhere in this pane.';

export const TOKEN_FIELD_PLACEHOLDER = 'Paste your Olea service token';

/** The field is enabled now that a real transport exists — see the module doc. */
export const TOKEN_FIELD_DISABLED = false;
