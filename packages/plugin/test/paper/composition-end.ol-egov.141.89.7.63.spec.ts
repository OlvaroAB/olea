/**
 * A composition that ends in an error never leaves the composing message ([D-532], ol-egov.141.89.7.63).
 * Scenarios: olea-service features/F4-oracle.md, F4.11 "Why a locked paper is locked", tagged
 * `@auto:plugin/paper/locked-reason.ol-egov.141.89.7.63.spec`. Course A, synthetic.
 * Driven through the real `PaperView` with a fake DOM (see `locked-reason.ol-egov.141.89.7.61.spec.ts`).
 */
import { describe, expect, it, vi } from 'vitest';

vi.mock('obsidian', () => ({
  ItemView: class {
    contentEl: unknown;
    constructor(_leaf: unknown) {
      this.contentEl = (globalThis as { __rootFactory?: () => unknown }).__rootFactory?.();
    }
  },
}));

import {
  AUTHORING_SPEC_CHANGED_SENTENCE,
  UNFINISHED_PAPER_SENTENCE,
} from '../../src/paper/copy.js';
import {
  PracticePaperUnfinishedError,
  type PracticePaperViewDeps,
} from '../../src/paper/provider.js';
import { PaperView } from '../../src/paper/view.js';
import { FakeEl } from './fake-dom.helper.js';

const COMPOSING = 'Composing your practice paper…';

function unfinished(reason: 'service-unavailable' | 'authoring-spec-changed') {
  return new PracticePaperUnfinishedError({
    course: 'COURSEA',
    reason,
    journalId: 'paper-journal-key1:x',
    plannedSlotCount: 3,
    owedSlotCount: 2,
  });
}

async function pressRequest(failure: unknown) {
  const deps: PracticePaperViewDeps = {
    load: async () => ({ kind: 'unlocked-not-pulled', course: 'COURSEA' }),
    requestPaper: async () => {
      throw failure;
    },
    handOffItem: async () => {
      throw new Error('not used');
    },
  };
  const root = new FakeEl('root');
  (globalThis as { __rootFactory?: () => unknown }).__rootFactory = () => root;
  const view = new PaperView({} as never, deps, 'COURSEA');
  await view.refresh();
  const button = root.find('button')[0];
  const unhandled: unknown[] = [];
  const onUnhandled = (reason: unknown) => unhandled.push(reason);
  process.on('unhandledRejection', onUnhandled);
  button?.click();
  await new Promise((resolve) => setTimeout(resolve, 20));
  process.off('unhandledRejection', onUnhandled);
  return { root, unhandled };
}

describe('the ruled sentence for an update during composition', () => {
  it('is verbatim', () => {
    expect(AUTHORING_SPEC_CHANGED_SENTENCE).toBe(
      "Olea was updated while this paper was being written, so it couldn't be finished. Ask again to start a new paper.",
    );
  });
});

describe('a composition that ends in an error, through the paper view', () => {
  it('Olea updated: the composing message is gone, the ruled sentence shows, the request is offered again, and "continue" never shows', async () => {
    const { root } = await pressRequest(unfinished('authoring-spec-changed'));
    const text = root.allText();
    expect(text).not.toContain(COMPOSING);
    expect(text).toContain(AUTHORING_SPEC_CHANGED_SENTENCE);
    expect(text).not.toContain('continue from where it stopped');
    expect(root.find('button')).toHaveLength(1);
  });

  it('an outage keeps the ruled continue sentence and offers the request again', async () => {
    const { root } = await pressRequest(unfinished('service-unavailable'));
    const text = root.allText();
    expect(text).not.toContain(COMPOSING);
    expect(text).toContain(UNFINISHED_PAPER_SENTENCE);
    expect(root.find('button')).toHaveLength(1);
  });

  it('any other failure leaves no composing message, adds no sentence, offers the request again, and still surfaces', async () => {
    const boom = new Error('boom');
    const { root, unhandled } = await pressRequest(boom);
    const text = root.allText();
    expect(text).not.toContain(COMPOSING);
    expect(text).not.toContain('boom');
    expect(root.find('button')).toHaveLength(1);
    expect(unhandled).toContain(boom);
  });
});
