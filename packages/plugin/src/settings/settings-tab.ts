/**
 * `OleaSettingTab` — the settings pane: the F7.8 degradation statement, and
 * the Worker connection fields (F7.1/F7.2) `ol-k57j` wires to a real
 * transport. Through P2-T10 the token row was permanently dark (disabled,
 * unsaved, "not available yet"); `ol-k57j` built a real
 * `WorkerTaskTransport` (`../worker/transport.ts`), so both fields are live
 * now — editable, persisted via `../worker/config-store.ts` — and a "Test
 * connection" button proves the seam actually reaches the Worker (see
 * `../worker/test-connection.ts`'s module doc for why that check spends
 * nothing, on every outcome including a valid token).
 *
 * Implements the classic imperative `display()` override rather than
 * Obsidian 1.13's newer declarative `getSettingDefinitions()` API: this
 * plugin's `minAppVersion` (manifest.json) is 1.9.10, and 1.13's own
 * typings say `display()` is "a fallback for plugins that need to support
 * Obsidian versions older than 1.13.0" — exactly this plugin's situation.
 *
 * **Cannot be unit-tested without a real Obsidian host** — `Setting` and
 * `createEl` need a live DOM Obsidian provides, same reasoning as
 * `vault/obsidian-source.ts`. Kept thin on purpose: every piece of logic
 * that *could* be wrong — the field copy, the persisted-config shape, the
 * connection-test protocol and its three-way outcome — lives in a plain,
 * DOM-free module with its own test file (`degradation-statement.ts`,
 * `token-field-copy.ts`, `base-url-field-copy.ts`,
 * `support-section-copy.ts`, `../worker/config-store.ts`,
 * `../worker/test-connection.ts`); this file is only the wiring between
 * those and Obsidian's `Setting` API. See `@manual` scenarios in
 * `features/F7-plugin-surface.md` for how the rendered pane is actually
 * checked.
 *
 * **The "Support" section at the bottom (F7.5, `ol-p6t02`) is the in-app
 * feedback path** — a link to this plugin's own issue tracker, alongside a
 * pointer at the "Olea: Copy diagnostics" command (F7.5/Q6.3,
 * `../commands/diagnostics.ts`) that gathers what a report needs without
 * naming any vault content.
 */

import type { App, Plugin } from 'obsidian';
import { PluginSettingTab, Setting } from 'obsidian';
import type { CalendarDay, VaultSource, WorkerTaskTransport } from 'olea-core';
import { ObsidianStudyPlanSettingsStore } from '../plan/settings-store.js';
import { renderPrivacySection } from '../privacy/settings-section.js';
import { ObsidianTermWindowStore } from '../today/term-window-store.js';
import { renderUsageSection } from '../usage/settings-section.js';
import type { ObsidianDataHost, PersistedWorkerConfig } from '../worker/config-store.js';
import { ObsidianWorkerConfigStore } from '../worker/config-store.js';
import { describeTestConnectionOutcome, testWorkerConnection } from '../worker/test-connection.js';
import type { WorkerConfig } from '../worker/transport.js';
import {
  ASSIGNMENTS_BASE_PATH_FIELD_DESCRIPTION,
  ASSIGNMENTS_BASE_PATH_FIELD_NAME,
  ASSIGNMENTS_BASE_PATH_FIELD_PLACEHOLDER,
} from './assignments-base-path-field-copy.js';
import {
  BASE_URL_FIELD_DESCRIPTION,
  BASE_URL_FIELD_NAME,
  BASE_URL_FIELD_PLACEHOLDER,
} from './base-url-field-copy.js';
import {
  DEGRADATION_STATEMENT_BODY,
  DEGRADATION_STATEMENT_HEADING,
} from './degradation-statement.js';
import {
  EXPLAIN_BACK_AUDIT_GATE_BODY,
  EXPLAIN_BACK_AUDIT_GATE_HEADING,
  isExplainBackKilled,
  ObsidianExplainBackAuditGateStore,
} from './explain-back-audit-gate.js';
import {
  REPORT_ISSUE_BUTTON_LABEL,
  REPORT_ISSUE_URL,
  SUPPORT_SECTION_HEADING,
  SUPPORT_SECTION_INTRO,
} from './support-section-copy.js';
import {
  TERM_DATES_FIELD_DESCRIPTION,
  TERM_DATES_SECTION_HEADING,
  TERM_DATES_SKIP_BUTTON_LABEL,
  TERM_DATES_SKIP_DESCRIPTION,
  TERM_END_FIELD_NAME,
  TERM_START_FIELD_NAME,
} from './term-dates-field-copy.js';
import {
  TOKEN_FIELD_DESCRIPTION,
  TOKEN_FIELD_DISABLED,
  TOKEN_FIELD_NAME,
  TOKEN_FIELD_PLACEHOLDER,
} from './token-field-copy.js';

export class OleaSettingTab extends PluginSettingTab {
  private readonly configStore: ObsidianWorkerConfigStore;
  private readonly studyPlanConfigStore: ObsidianStudyPlanSettingsStore;
  /** F7.8's E2b kill-switch (`ol-g3a0.1`, `[D-127]`) — see `explain-back-audit-gate.ts`'s module doc. */
  private readonly explainBackAuditGateStore: ObsidianExplainBackAuditGateStore;
  /** F7.2's term-dates ask (`[D-147]`, `ol-0r92.6`) — same store `today/data-source.ts`'s rhythm reading reads; this class is `save`/`skip`'s production caller. */
  private readonly termWindowStore: ObsidianTermWindowStore;
  /** Kept for the F7.3 usage section (`ol-p3t09`), which reads its own `data.json` key through the same host. */
  private readonly dataHost: ObsidianDataHost;

  constructor(
    app: App,
    plugin: Plugin,
    dataHost: ObsidianDataHost,
    /** Injected rather than imported directly, so this file never has to import `obsidian`'s `requestUrl` itself — `main.ts` supplies the real `createObsidianWorkerTransport`. */
    private readonly createTransport: (config: WorkerConfig) => WorkerTaskTransport,
    /** F7.4's export/delete section (`ol-p6t01`) — vault + device id, minted after the tab would otherwise be constructed, so `main.ts` supplies them here. */
    private readonly privacy: { readonly vault: VaultSource; readonly deviceId: string },
  ) {
    super(app, plugin);
    this.configStore = new ObsidianWorkerConfigStore(dataHost);
    // Same `data.json` blob, its own top-level key (`plan/settings-store.ts`)
    // — this field is unrelated to the Worker connection above (P5-T07's
    // ranking needs no model call), which is why it renders in its own
    // section rather than inside the "AI" one.
    this.studyPlanConfigStore = new ObsidianStudyPlanSettingsStore(dataHost);
    this.explainBackAuditGateStore = new ObsidianExplainBackAuditGateStore(dataHost);
    this.termWindowStore = new ObsidianTermWindowStore(dataHost);
    this.dataHost = dataHost;
  }

  override display(): void {
    const { containerEl } = this;
    containerEl.empty();

    new Setting(containerEl).setName(DEGRADATION_STATEMENT_HEADING).setHeading();
    containerEl.createEl('p', {
      text: DEGRADATION_STATEMENT_BODY,
      cls: 'olea-degradation-statement',
    });

    new Setting(containerEl).setName('Study plan').setHeading();

    // Async for the same reason `renderWorkerFields` is: `display()` itself
    // must stay synchronous (Obsidian calls it directly on tab open), and
    // every field renders independently of the other's load completing.
    void this.renderStudyPlanFields(containerEl);

    // F7.2's term-dates ask (`[D-147]`, `ol-0r92.6`): a calendar fact, not a
    // study preference — its own heading, distinct from "Study plan" above,
    // per the amended clause's own framing.
    new Setting(containerEl).setName(TERM_DATES_SECTION_HEADING).setHeading();
    void this.renderTermDatesFields(containerEl);

    new Setting(containerEl).setName('AI').setHeading();
    void this.renderWorkerFields(containerEl);

    // F7.8's E2b kill-switch (`ol-g3a0.1`, `[D-127]`) — a SECOND, honestly
    // worded reason explaining back may be greyed, distinct from the
    // degradation statement above. Renders nothing when the gate is clear
    // (the common case, and the only case until `ol-g3a0`'s audit exists to
    // set it) — see `explain-back-audit-gate.ts`'s module doc.
    void this.renderExplainBackAuditGate(containerEl);

    // F7.3 usage view (`ol-p3t09`) — informational in v0.9, the future quota
    // surface. Same async-render terms as the field renderers above.
    void renderUsageSection(containerEl, this.dataHost);

    // F7.4 export + full delete (`ol-p6t01`) — a settings-pane section, the
    // only clause-consistent surface (F7.7's command set has no entry for it).
    renderPrivacySection(containerEl, {
      app: this.app,
      vault: this.privacy.vault,
      dataHost: this.dataHost,
      deviceId: this.privacy.deviceId,
    });

    // F7.5's in-app feedback path (`ol-p6t02`) — pairs with the "Olea: Copy
    // diagnostics" command (F7.5/Q6.3), which is the error-reporting half.
    new Setting(containerEl).setName(SUPPORT_SECTION_HEADING).setHeading();
    containerEl.createEl('p', { text: SUPPORT_SECTION_INTRO, cls: 'olea-support-intro' });
    new Setting(containerEl).addButton((button) => {
      button.setButtonText(REPORT_ISSUE_BUTTON_LABEL).onClick(() => {
        window.open(REPORT_ISSUE_URL, '_blank', 'noopener');
      });
    });
  }

  private async renderStudyPlanFields(containerEl: HTMLElement): Promise<void> {
    const config = await this.studyPlanConfigStore.load();
    let assignmentsBasePath = config.assignmentsBasePath;

    new Setting(containerEl)
      .setName(ASSIGNMENTS_BASE_PATH_FIELD_NAME)
      .setDesc(ASSIGNMENTS_BASE_PATH_FIELD_DESCRIPTION)
      .addText((text) => {
        text.setPlaceholder(ASSIGNMENTS_BASE_PATH_FIELD_PLACEHOLDER);
        text.setValue(assignmentsBasePath);
        text.onChange((value) => {
          assignmentsBasePath = value;
          void this.studyPlanConfigStore.save({ version: 1, assignmentsBasePath });
        });
      });
  }

  /**
   * F7.2's term-dates ask (`[D-147]`, `ol-0r92.6`): the settings side of the
   * same ask `today/view.ts`'s quiet pointer opens. One editable field pair
   * plus a skip affordance — not a first-run modal (proposal §2) — and
   * every change writes straight through `ObsidianTermWindowStore`, the
   * same read-and-persist-on-change pattern `renderStudyPlanFields` and
   * `renderWorkerFields` already use.
   *
   * A half-filled pair (one bound entered, the other still blank) writes
   * nothing: `resolveTermBoundary` already treats a half pair identically to
   * "never asked" (`term-window-store.ts`'s own doc), so persisting one
   * mid-edit would only ever be superseded by the completed pair or left as
   * a state nothing downstream can read. Clearing both bounds back to
   * blank calls `clear()`, not `skip()` — deleting what she entered is a
   * correction to the same field, never a decline (Class B default; see
   * `term-window-store.ts`'s `clear()` doc).
   */
  private async renderTermDatesFields(containerEl: HTMLElement): Promise<void> {
    const persisted = await this.termWindowStore.load();
    let start: CalendarDay | null = persisted?.start ?? null;
    let end: CalendarDay | null = persisted?.end ?? null;

    const sync = async (): Promise<void> => {
      if (start !== null && end !== null) {
        await this.termWindowStore.save({ start, end });
      } else if (start === null && end === null) {
        await this.termWindowStore.clear();
      }
      // Else: one bound filled, the other not — leave the store as it was
      // until the pair completes; see this method's doc.
    };

    new Setting(containerEl)
      .setName(TERM_START_FIELD_NAME)
      .setDesc(TERM_DATES_FIELD_DESCRIPTION)
      .addText((text) => {
        text.inputEl.type = 'date';
        if (start !== null) text.setValue(start);
        text.onChange((value) => {
          start = value === '' ? null : (value as CalendarDay);
          void sync();
        });
      });

    new Setting(containerEl).setName(TERM_END_FIELD_NAME).addText((text) => {
      text.inputEl.type = 'date';
      if (end !== null) text.setValue(end);
      text.onChange((value) => {
        end = value === '' ? null : (value as CalendarDay);
        void sync();
      });
    });

    new Setting(containerEl).setDesc(TERM_DATES_SKIP_DESCRIPTION).addButton((button) => {
      button.setButtonText(TERM_DATES_SKIP_BUTTON_LABEL).onClick(() => {
        void this.termWindowStore.skip();
      });
    });
  }

  /** F7.8's E2b kill-switch (`ol-g3a0.1`, `[D-127]`) — see this class's `display()` call site and `explain-back-audit-gate.ts`'s module doc. */
  private async renderExplainBackAuditGate(containerEl: HTMLElement): Promise<void> {
    const gate = await this.explainBackAuditGateStore.load();
    if (!isExplainBackKilled(gate)) return;
    new Setting(containerEl).setName(EXPLAIN_BACK_AUDIT_GATE_HEADING).setHeading();
    containerEl.createEl('p', {
      text: EXPLAIN_BACK_AUDIT_GATE_BODY,
      cls: 'olea-explain-back-audit-gate',
    });
  }

  private async renderWorkerFields(containerEl: HTMLElement): Promise<void> {
    const config: PersistedWorkerConfig = await this.configStore.load();
    let baseUrl = config.baseUrl;
    let token = config.token;

    const save = async (): Promise<void> => {
      await this.configStore.save({ version: 1, baseUrl, token });
    };

    new Setting(containerEl)
      .setName(BASE_URL_FIELD_NAME)
      .setDesc(BASE_URL_FIELD_DESCRIPTION)
      .addText((text) => {
        text.setPlaceholder(BASE_URL_FIELD_PLACEHOLDER);
        text.setValue(baseUrl);
        text.onChange((value) => {
          baseUrl = value;
          void save();
        });
      });

    new Setting(containerEl)
      .setName(TOKEN_FIELD_NAME)
      .setDesc(TOKEN_FIELD_DESCRIPTION)
      .setDisabled(TOKEN_FIELD_DISABLED)
      .addText((text) => {
        text.setPlaceholder(TOKEN_FIELD_PLACEHOLDER);
        text.setDisabled(TOKEN_FIELD_DISABLED);
        text.inputEl.type = 'password';
        text.setValue(token);
        text.onChange((value) => {
          token = value;
          void save();
        });
      });

    const statusEl = containerEl.createEl('p', { cls: 'olea-worker-test-status' });

    new Setting(containerEl)
      .setName('Test connection')
      .setDesc(
        'Checks that the base URL is reachable and the token is valid. Makes no AI call and spends no quota, whatever the outcome — see the module doc on testWorkerConnection.',
      )
      .addButton((button) => {
        button.setButtonText('Test connection').onClick(() => {
          void (async () => {
            button.setDisabled(true);
            statusEl.setText('Testing…');
            try {
              const transport = this.createTransport({ baseUrl, token });
              const outcome = await testWorkerConnection(transport);
              statusEl.setText(describeTestConnectionOutcome(outcome));
            } finally {
              button.setDisabled(false);
            }
          })();
        });
      });
  }
}
