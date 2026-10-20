/**
 * `ol-egov.141.89.6.98` (David, 2026-10-20): no separate feedback paragraph.
 * The graded phase's findings region and misconception region ARE the
 * feedback; the Worker's free-text `feedback` (the `[D-318]` experiment seam)
 * still arrives but is never shown, and no "The passage says:" prefix is
 * written anywhere she reads. `ExplainBackModal` cannot be imported under
 * Vitest (see `modal-unable-to-assess.spec.ts`), so the assertions read the
 * source text with comments stripped.
 */

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const pluginSrc = fileURLToPath(new URL('../../src/', import.meta.url));
const coreSrc = fileURLToPath(new URL('../../../core/src/', import.meta.url));

function stripComments(text: string): string {
  return text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
}

const modal = stripComments(readFileSync(`${pluginSrc}explain-back/modal.ts`, 'utf8'));

function bodyBetween(startMarker: string, endMarker: string): string {
  const start = modal.indexOf(startMarker);
  expect(start).toBeGreaterThan(-1);
  const end = modal.indexOf(endMarker, start);
  expect(end).toBeGreaterThan(start);
  return modal.slice(start, end);
}

function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) out.push(...sourceFiles(full));
    else if (name.endsWith('.ts') && !name.endsWith('.spec.ts')) out.push(full);
  }
  return out;
}

describe('the graded phase shows no free-text feedback paragraph', () => {
  const body = bodyBetween('private renderGradedPhase(', 'private renderUnableToAssessPhase(');

  it('never reads the Worker free-text field and creates no feedback paragraph', () => {
    expect(body).not.toMatch(/grading\.feedback/);
    expect(body).not.toContain('olea-explain-back-feedback');
  });

  it('still renders the findings regions and the misconception region with each correction', () => {
    expect(body).toMatch(/this\.renderGradedRegions\(\s*root,\s*prompt,\s*grading\s*\)/);
    expect(body).toContain('EXPLAIN_BACK_MISCONCEPTION_HEADING');
    expect(body).toMatch(/text:\s*candidate\.correction/);
  });

  it('the accepted-phase encouragement never carries the free text either', () => {
    const copy = stripComments(readFileSync(`${pluginSrc}review/copy.ts`, 'utf8'));
    const start = copy.indexOf('export function explainBackFullDepthEncouragement');
    expect(start).toBeGreaterThan(-1);
    const fn = copy.slice(start, copy.indexOf('\n}\n', start));
    expect(fn).not.toMatch(/\.feedback/);
  });
});

describe('the "The passage says:" prefix is written nowhere she reads', () => {
  it('appears in no plugin or core source string', () => {
    const offenders = [...sourceFiles(pluginSrc), ...sourceFiles(coreSrc)].filter((f) =>
      /the passage says\s*:/i.test(stripComments(readFileSync(f, 'utf8'))),
    );
    expect(offenders).toEqual([]);
  });
});
