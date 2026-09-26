/**
 * `renderManualAssessmentSection` — F1.2's manual entry surface (ol-egov.141.8.10): shown ONLY
 * while no readable Assignments Base exists, never alongside a readable one (`hasReadableAssessmentsBase`,
 * `olea-core`'s `./resolve.ts`). Rendered by `OleaSettingTab.display()` (`./settings-tab.ts`),
 * right after the Assignments Base path field it is a fallback for.
 *
 * **Cannot be unit-tested without a real Obsidian host** — `Setting`/`createEl`/`Notice` all need
 * a live DOM, the same posture every other section on this pane already documents
 * (`../privacy/settings-section.ts`). Every piece of logic that could be wrong — which fields are
 * required, what a row's summary line says, the copy — lives in `manual-assessment-entry-form.ts`
 * and `manual-assessment-entry-field-copy.ts`, both DOM-free and unit-tested. This file is only
 * the wiring between those and the `VaultSource`/`Setting` APIs.
 *
 * **Re-renders its own wrapper element on every add/remove**, never the whole settings pane —
 * so a Remove click does not also reset the Assignments Base path field's live edit state above
 * it. Whether the section itself should disappear because she just typed a new (as yet
 * unverified) Base path is decided once per pane open, from the persisted config
 * `settings-tab.ts` already loaded — see that file's own call site for why a live re-check on
 * every keystroke is not attempted here.
 */

import { Notice, Setting } from 'obsidian';
import {
  addManualAssessmentEntry,
  hasReadableAssessmentsBase,
  listManualAssessmentRecords,
  removeManualAssessmentEntry,
  type VaultSource,
} from 'olea-core';
import {
  MANUAL_ASSESSMENT_ADD_BUTTON_LABEL,
  MANUAL_ASSESSMENT_COURSE_FIELD_NAME,
  MANUAL_ASSESSMENT_COURSE_FIELD_PLACEHOLDER,
  MANUAL_ASSESSMENT_DUE_FIELD_NAME,
  MANUAL_ASSESSMENT_EMPTY_LIST_TEXT,
  MANUAL_ASSESSMENT_REMOVE_BUTTON_LABEL,
  MANUAL_ASSESSMENT_SECTION_DESCRIPTION,
  MANUAL_ASSESSMENT_SECTION_HEADING,
  MANUAL_ASSESSMENT_STATUS_FIELD_NAME,
  MANUAL_ASSESSMENT_STATUS_FIELD_PLACEHOLDER,
  MANUAL_ASSESSMENT_TYPE_FIELD_NAME,
  MANUAL_ASSESSMENT_TYPE_FIELD_PLACEHOLDER,
  MANUAL_ASSESSMENT_WEIGHT_FIELD_NAME,
  MANUAL_ASSESSMENT_WEIGHT_FIELD_PLACEHOLDER,
} from './manual-assessment-entry-field-copy.js';
import {
  describeManualAssessmentEntry,
  EMPTY_MANUAL_ASSESSMENT_FORM_FIELDS,
  type ManualAssessmentFormFields,
  validateManualAssessmentForm,
} from './manual-assessment-entry-form.js';

export interface RenderManualAssessmentSectionDeps {
  readonly vault: VaultSource;
  /** The persisted Assignments Base path, exactly as `plan/settings-store.ts` stores it — blank means "not configured". */
  readonly basePath: string;
  /** Injectable clock for `enteredAt`. Omitted defaults to the real wall clock (`../../core`'s own default). */
  readonly now?: () => string;
}

/**
 * Renders into a dedicated child of `containerEl` (never `containerEl` itself), so a later
 * re-render touches only this section. Renders nothing at all once a readable Base exists — F1.2:
 * "never the default path."
 */
export async function renderManualAssessmentSection(
  containerEl: HTMLElement,
  deps: RenderManualAssessmentSectionDeps,
): Promise<void> {
  const wrapper = containerEl.createDiv({ cls: 'olea-manual-assessment-section' });
  await refresh(wrapper, deps);
}

async function refresh(
  wrapper: HTMLElement,
  deps: RenderManualAssessmentSectionDeps,
): Promise<void> {
  wrapper.empty();

  const readable = await hasReadableAssessmentsBase(deps.vault, deps.basePath);
  if (readable) return;

  new Setting(wrapper).setName(MANUAL_ASSESSMENT_SECTION_HEADING).setHeading();
  wrapper.createEl('p', {
    text: MANUAL_ASSESSMENT_SECTION_DESCRIPTION,
    cls: 'olea-manual-assessment-intro',
  });

  const stored = await listManualAssessmentRecords(deps.vault);
  if (stored.length === 0) {
    wrapper.createEl('p', {
      text: MANUAL_ASSESSMENT_EMPTY_LIST_TEXT,
      cls: 'olea-manual-assessment-empty',
    });
  } else {
    for (const { path, record } of stored) {
      new Setting(wrapper).setName(describeManualAssessmentEntry(record)).addButton((button) => {
        button.setButtonText(MANUAL_ASSESSMENT_REMOVE_BUTTON_LABEL).onClick(() => {
          void (async () => {
            button.setDisabled(true);
            try {
              await removeManualAssessmentEntry(deps.vault, path);
              await refresh(wrapper, deps);
            } catch (error) {
              new Notice(`Olea: could not remove that entry — ${String(error)}`);
              button.setDisabled(false);
            }
          })();
        });
      });
    }
  }

  let fields: ManualAssessmentFormFields = { ...EMPTY_MANUAL_ASSESSMENT_FORM_FIELDS };

  new Setting(wrapper).setName(MANUAL_ASSESSMENT_COURSE_FIELD_NAME).addText((text) => {
    text.setPlaceholder(MANUAL_ASSESSMENT_COURSE_FIELD_PLACEHOLDER);
    text.onChange((value) => {
      fields = { ...fields, course: value };
    });
  });
  new Setting(wrapper).setName(MANUAL_ASSESSMENT_TYPE_FIELD_NAME).addText((text) => {
    text.setPlaceholder(MANUAL_ASSESSMENT_TYPE_FIELD_PLACEHOLDER);
    text.onChange((value) => {
      fields = { ...fields, type: value };
    });
  });
  new Setting(wrapper).setName(MANUAL_ASSESSMENT_WEIGHT_FIELD_NAME).addText((text) => {
    text.setPlaceholder(MANUAL_ASSESSMENT_WEIGHT_FIELD_PLACEHOLDER);
    text.onChange((value) => {
      fields = { ...fields, weight: value };
    });
  });
  new Setting(wrapper).setName(MANUAL_ASSESSMENT_DUE_FIELD_NAME).addText((text) => {
    text.inputEl.type = 'date';
    text.onChange((value) => {
      fields = { ...fields, due: value };
    });
  });
  new Setting(wrapper).setName(MANUAL_ASSESSMENT_STATUS_FIELD_NAME).addText((text) => {
    text.setPlaceholder(MANUAL_ASSESSMENT_STATUS_FIELD_PLACEHOLDER);
    text.onChange((value) => {
      fields = { ...fields, status: value };
    });
  });

  new Setting(wrapper).addButton((button) => {
    button.setButtonText(MANUAL_ASSESSMENT_ADD_BUTTON_LABEL).onClick(() => {
      void (async () => {
        const result = validateManualAssessmentForm(fields);
        if (!result.ok) {
          new Notice(`Olea: ${result.error}`);
          return;
        }
        button.setDisabled(true);
        try {
          await addManualAssessmentEntry(
            deps.vault,
            result.input,
            deps.now !== undefined ? { now: deps.now } : {},
          );
          await refresh(wrapper, deps);
        } catch (error) {
          new Notice(`Olea: could not add that assessment — ${String(error)}`);
          button.setDisabled(false);
        }
      })();
    });
  });
}
