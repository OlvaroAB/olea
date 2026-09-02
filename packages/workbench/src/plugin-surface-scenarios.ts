/**
 * F7 plugin-surface fixture states (`ol-z6x2` [WB-2], `olea-service`'s
 * `features/F7-plugin-surface.md`) — the REAL `OleaSettingTab`
 * (`plugin-surface-bridge.ts`) mounted over an in-memory `ObsidianDataHost`
 * seeded per state and a canned `WorkerTaskTransport`, never a real vault
 * walk or a real HTTP call.
 *
 * **Scope, per the bead brief: only the F7 risk that does NOT live in the
 * Obsidian runtime** — rendered copy, a settings section's conditional
 * presence, and the "Test connection" status line's live text. F7.7's
 * commands/hotkeys/palette entries and the BRAT install path stay `@manual`
 * (`features/F7-plugin-surface.md`) on purpose: running a real command
 * through a real command palette needs a real Obsidian host, which is
 * exactly what this package does not have and is not trying to fake — see
 * the package README's shim ledger before growing the shim for that
 * instead. `OleaSettingTab.display()` itself renders several other
 * sections (study plan, term dates, the base URL/token fields, the Support
 * section) this tranche does not add a scenario for; they render along with
 * everything else because the real component is mounted whole, the same
 * "mount the real thing" discipline every other bridge in this package
 * uses, not because this bead claims coverage of them.
 */

import { TASK_IDS } from 'olea-contracts';
import type { VaultSource, WorkerTaskTransport } from 'olea-core';
import { App, Plugin } from './obsidian-shim/index.js';
import {
  EXPLAIN_BACK_AUDIT_GATE_STORAGE_KEY,
  type ObsidianDataHost,
  OleaSettingTab,
  type PersistedExplainBackAuditGate,
  USAGE_LOG_STORAGE_KEY,
  type UsageLogEntry,
  WORKER_CONFIG_STORAGE_KEY,
  type WorkerConfig,
} from './plugin-surface-bridge.js';
import { MemoryVaultSource } from './vault/memory-source.js';

/**
 * An in-memory `data.json` blob — the same read-modify-write shape every
 * `ObsidianDataHost` store in `packages/plugin/src` already assumes
 * (`worker/config-store.ts`'s module doc), minus a real vault or disk.
 * Returns a fresh copy on every read/write so nothing outside this class can
 * mutate the seed by holding a reference to it.
 */
class MemoryDataHost implements ObsidianDataHost {
  private blob: Record<string, unknown>;

  constructor(seed: Readonly<Record<string, unknown>> = {}) {
    this.blob = { ...seed };
  }

  loadData(): Promise<unknown> {
    return Promise.resolve({ ...this.blob });
  }

  saveData(data: unknown): Promise<void> {
    this.blob =
      typeof data === 'object' && data !== null ? { ...(data as Record<string, unknown>) } : {};
    return Promise.resolve();
  }
}

/** A fixture worker config — a clearly-invented base URL and token, never anything that could read as a real credential. */
const FIXTURE_WORKER_CONFIG: WorkerConfig = {
  baseUrl: 'https://olea-workbench-fixture.example.test',
  token: 'wb-fixture-token',
};

/**
 * A `WorkerTaskTransport` whose `send()` always rejects — `testWorkerConnection`
 * (`worker/test-connection.ts`) catches any throw and reports `reachable:
 * false`, so the exact rejection reason is irrelevant; a small real delay
 * (a `setTimeout`, not a same-tick resolve) is deliberate — it is what
 * makes the button's disabled/"Testing…" interval something a real browser
 * test can actually observe mid-flight, rather than a state that begins and
 * ends within one microtask.
 */
class UnreachableTransport implements WorkerTaskTransport {
  send(): Promise<unknown> {
    return new Promise((_resolve, reject) => {
      setTimeout(() => reject(new Error('workbench fixture: simulated network failure')), 60);
    });
  }
}

/**
 * A `WorkerTaskTransport` whose `send()` resolves with the exact envelope
 * `test-connection.ts`'s own module doc says a reachable Worker with a
 * valid token produces against the deliberately-invalid probe payload:
 * `{ ok: false, code: 'invalid-request' }` — never `ok: true`, which that
 * doc explains is not a reachable outcome of this probe by design.
 */
class ConnectedTransport implements WorkerTaskTransport {
  send(): Promise<unknown> {
    return new Promise((resolve) => {
      setTimeout(() => resolve({ ok: false, code: 'invalid-request' }), 60);
    });
  }
}

export interface PluginSurfaceState {
  readonly id: string;
  readonly label: string;
  readonly note: string;
}

export const PLUGIN_SURFACE_STATES: readonly PluginSurfaceState[] = [
  {
    id: 'plugin-surface-fresh',
    label: 'Fresh install',
    note:
      'A fresh install: no explain-back audit gate ever set (settings/explain-back-audit-gate.ts) ' +
      'and no AI usage ever recorded (usage/log-store.ts). Both conditional sections render nothing.',
  },
  {
    id: 'plugin-surface-gate-set',
    label: 'Explain-back paused (E2b)',
    note:
      'The E2b calibration kill-switch (`[D-127]`, settings/explain-back-audit-gate.ts) is set: ' +
      'the "Explaining back is paused" section renders its exact heading and body, a SECOND, ' +
      'independent reason from the Worker being unconfigured.',
  },
  {
    id: 'plugin-surface-usage-recorded',
    label: 'AI usage recorded',
    note:
      'usage/log-store.ts holds real calls to two task ids, one of them oracle.rank.v1 (Slot O) — ' +
      'the settings pane aggregates them for real (usage/aggregate.ts) and names the cached-input ' +
      'pricing nuance (usage/copy.ts).',
  },
  {
    id: 'plugin-surface-offline',
    label: 'Test connection: unreachable',
    note:
      'A configured base URL/token (worker/config-store.ts) paired with a transport whose send() ' +
      'always fails — pressing "Test connection" runs the real testWorkerConnection ' +
      '(worker/test-connection.ts) against it.',
  },
  {
    id: 'plugin-surface-connected',
    label: 'Test connection: connected',
    note:
      'The same configured base URL/token, paired with a transport that reports the token as valid ' +
      '— pressing "Test connection" runs the real testWorkerConnection end to end.',
  },
];

export function findPluginSurfaceState(id: string): PluginSurfaceState | undefined {
  return PLUGIN_SURFACE_STATES.find((state) => state.id === id);
}

function usageEntry(taskId: string, promptVersion: string, modelId: string): UsageLogEntry {
  return { taskId, promptVersion, modelId, recordedAt: '2026-01-01T00:00:00.000Z' };
}

function seedFor(stateId: string): Record<string, unknown> {
  switch (stateId) {
    case 'plugin-surface-gate-set': {
      const gate: PersistedExplainBackAuditGate = { version: 1, sustainedFailure: true };
      return { [EXPLAIN_BACK_AUDIT_GATE_STORAGE_KEY]: gate };
    }
    case 'plugin-surface-usage-recorded': {
      const entries: UsageLogEntry[] = [
        usageEntry(TASK_IDS.ORACLE_RANK, '1.0.0', 'wb-fixture-model'),
        usageEntry(TASK_IDS.ORACLE_RANK, '1.0.0', 'wb-fixture-model'),
        usageEntry(TASK_IDS.ORACLE_RANK, '1.0.0', 'wb-fixture-model'),
        usageEntry(TASK_IDS.QUIZ_GENERATE, '1.0.0', 'wb-fixture-model'),
      ];
      return { [USAGE_LOG_STORAGE_KEY]: { version: 1, entries } };
    }
    case 'plugin-surface-offline':
    case 'plugin-surface-connected':
      return { [WORKER_CONFIG_STORAGE_KEY]: { version: 1, ...FIXTURE_WORKER_CONFIG } };
    default:
      // 'plugin-surface-fresh', and anything else: nothing ever written.
      return {};
  }
}

function transportFor(stateId: string): (config: WorkerConfig) => WorkerTaskTransport {
  switch (stateId) {
    case 'plugin-surface-offline':
      return () => new UnreachableTransport();
    case 'plugin-surface-connected':
      return () => new ConnectedTransport();
    default:
      // Not clicked in these states — a real caller `createTransport` never
      // has to satisfy against a state where no scenario presses the button.
      return () => new UnreachableTransport();
  }
}

export interface PluginSurfaceScenario {
  readonly state: PluginSurfaceState;
  readonly tab: OleaSettingTab;
}

/**
 * Builds the REAL `OleaSettingTab` for one fixture state — a fresh `App`,
 * `Plugin`, `MemoryDataHost` (seeded per `seedFor`), an empty
 * `MemoryVaultSource` (F7.4's export/delete section renders but this
 * tranche presses neither button — see the module doc) and a canned
 * `createTransport`. Constructing rather than caching: each mount gets its
 * own data host, so no click in one state can leak into another.
 */
export function buildPluginSurfaceScenario(stateId: string): PluginSurfaceScenario {
  const state = findPluginSurfaceState(stateId);
  if (state === undefined) {
    throw new Error(`plugin-surface-scenarios: unknown state ${JSON.stringify(stateId)}`);
  }
  const app = new App();
  const plugin = new Plugin(app);
  const dataHost = new MemoryDataHost(seedFor(stateId));
  const vault: VaultSource = MemoryVaultSource.fromBytes(new Map());
  const tab = new OleaSettingTab(app, plugin, dataHost, transportFor(stateId), {
    vault,
    deviceId: 'wb-fixture-device',
  });
  return { state, tab };
}
