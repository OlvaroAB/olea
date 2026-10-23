/**
 * `ol-egov.141.89.6.98` (David, 2026-10-20), as the v0.9 view has it (`[D-603]`, F5.3 as amended;
 * `ol-egov.141.89.6.129`): after an answer the view shows no findings region, no misconception
 * region and no free-text feedback paragraph — it shows her explanation, the passages and the
 * reflection prompts. And no "The passage says:" prefix is written anywhere she reads.
 *
 * Scenarios: `features/F5-explain-it-back.md` (olea-service), "F5.3 / [D-318], [D-603] — no
 * separate feedback paragraph; in v0.9 no findings or misconception region either": the first
 * scenario (rewritten in place) and the third (as written).
 *
 * The first block renders the real view (`./practice-view-harness.ts`, `obsidian` mocked) and
 * checks the comment-stripped source; the second reads every plugin and core source file.
 */

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { EXPLAIN_BACK_SUBMIT_LABEL } from '../../src/explain-back/copy.js';
import {
  INSTRUMENT,
  NOW,
  retrieveFor,
  submit,
  type ViewInternals,
} from './practice-view-harness.js';

vi.mock('obsidian', async () => (await import('./practice-view-harness.js')).fakeObsidian());
vi.mock('../../src/sprig/render-sprig.js', async () => {
  const { FakeEl } = await import('./practice-view-harness.js');
  return { renderSprig: () => new FakeEl('svg') };
});

// The first import of the view (and `olea-core` behind it) can outlast a test's own timeout on a
// loaded machine; it is made once, here, so each test times only its own work.
beforeAll(async () => {
  await import('../../src/explain-back/modal.js');
}, 120_000);

const pluginSrc = fileURLToPath(new URL('../../src/', import.meta.url));
const coreSrc = fileURLToPath(new URL('../../../core/src/', import.meta.url));

function stripComments(text: string): string {
  return text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
}

const modal = stripComments(readFileSync(`${pluginSrc}explain-back/modal.ts`, 'utf8'));

function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) out.push(...sourceFiles(full));
    else if (name.endsWith('.ts') && !name.endsWith('.spec.ts')) out.push(full);
  }
  return out;
}

describe('after an answer, the view shows no findings region, no misconception region and no feedback paragraph', () => {
  it('the passages phase draws none of them', async () => {
    const { ExplainBackModal } = await import('../../src/explain-back/modal.js');
    const view = new ExplainBackModal(
      {} as never,
      {
        retrieveSourceBlocks: retrieveFor,
        generateInstrumentId: () => 'attempt-1',
        now: () => NOW,
      },
      { kind: 'instrument', instrument: INSTRUMENT },
    ) as unknown as ViewInternals;
    view.onOpen();
    await vi.waitFor(() => expect(view.state.phase).toBe('answering'));
    submit(view.contentEl, 'An answer.', EXPLAIN_BACK_SUBMIT_LABEL);
    await vi.waitFor(() => expect(view.state.phase).toBe('passages'));

    const classes = view.contentEl.allClasses();
    for (const cls of [
      'olea-explain-back-region',
      'olea-explain-back-region-omission',
      'olea-explain-back-region-confusion',
      'olea-explain-back-region-covered',
      'olea-explain-back-region-head',
      'olea-explain-back-feedback',
    ]) {
      expect(classes).not.toContain(cls);
    }
    const texts = view.contentEl.texts().join('\n');
    expect(texts).not.toContain("What your notes cover that this didn't");
    expect(texts).not.toContain('Worth a closer look');
  });

  it('the view reads no grading at all: no feedback field, no findings, no misconception candidates', () => {
    expect(modal).not.toMatch(/\.feedback\b/);
    expect(modal).not.toMatch(/missedPoints|citedIssues|misconceptionCandidates/);
    expect(modal).not.toMatch(/renderGradedRegions|renderRegion\b|ExplainBackRegionKind/);
    expect(modal).not.toMatch(
      /EXPLAIN_BACK_MISCONCEPTION_HEADING|EXPLAIN_BACK_MISSED_HEADING|olea-explain-back-feedback/,
    );
  });
});

describe('the "The passage says:" prefix is written nowhere she reads', () => {
  it('appears in no plugin or core source string', { timeout: 60_000 }, () => {
    const offenders = [...sourceFiles(pluginSrc), ...sourceFiles(coreSrc)].filter((f) =>
      /the passage says\s*:/i.test(stripComments(readFileSync(f, 'utf8'))),
    );
    expect(offenders).toEqual([]);
  });
});
