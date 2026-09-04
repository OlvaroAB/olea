/**
 * The simulator's provenance badge (`docs/dev/simulator-design.md` §2a, the world descriptor):
 * "a provenance badge is always on screen" naming the loaded world, the
 * simulated date and the transport mode, and it "cannot be dismissed."
 *
 * A separate component from `../badge.ts`'s `renderSyntheticProvisionalBadge`
 * — that badge marks ONE number on a panel as synthetic-provisional; this one
 * marks the whole page's provenance and never disappears. Kept out of
 * `../badge.ts` deliberately: this bead owns `simulator/` and `main.ts` only,
 * and `../badge.ts` is not on that list.
 *
 * This lane only ever constructs a `'FIXTURE'` world (the public repo never
 * holds real-vault or persona-vault content — INV-3). `'REAL (private)'` and
 * `'PERSONA <id>'` are accepted as plain strings so the private build
 * (WBX-3) and a later persona lane can pass them through unchanged; nothing
 * here validates or coins that vocabulary.
 */

export const SIMULATOR_BADGE_SELECTOR = '[data-wb-sim-badge]';

export type SimulatorTransport = 'replay' | 'record' | 'direct';

export interface ProvenanceBadgeState {
  /** `'FIXTURE'`, `'REAL (private)'`, or `'PERSONA <id>'` — see the module doc. */
  readonly world: string;
  /** `YYYY-MM-DD`, the simulator clock's current day. */
  readonly simulatedDate: string;
  readonly transport: SimulatorTransport;
}

/**
 * Renders (or re-renders in place) the badge inside `container`. Idempotent —
 * safe to call on every clock advance/reset — and never removes itself: there
 * is no dismiss affordance anywhere in this module.
 */
export function renderProvenanceBadge(
  container: HTMLElement,
  state: ProvenanceBadgeState,
): HTMLElement {
  let badge = container.querySelector<HTMLElement>(SIMULATOR_BADGE_SELECTOR);
  if (badge === null) {
    badge = container.createDiv({ cls: 'wb-sim-badge' });
    badge.setAttr('data-wb-sim-badge', 'true');
    badge.createSpan({ cls: 'wb-sim-badge-world', attr: { 'data-wb-sim-badge-world': 'true' } });
    badge.createSpan({ cls: 'wb-sim-badge-date', attr: { 'data-wb-sim-badge-date': 'true' } });
    badge.createSpan({
      cls: 'wb-sim-badge-transport',
      attr: { 'data-wb-sim-badge-transport': 'true' },
    });
  }
  const worldEl = badge.querySelector<HTMLElement>('[data-wb-sim-badge-world]');
  const dateEl = badge.querySelector<HTMLElement>('[data-wb-sim-badge-date]');
  const transportEl = badge.querySelector<HTMLElement>('[data-wb-sim-badge-transport]');
  worldEl?.setText(state.world);
  dateEl?.setText(state.simulatedDate);
  transportEl?.setText(state.transport);
  badge.setAttr(
    'title',
    `Simulator — world: ${state.world}, simulated date: ${state.simulatedDate}, transport: ${state.transport}. This label cannot be dismissed.`,
  );
  return badge;
}
