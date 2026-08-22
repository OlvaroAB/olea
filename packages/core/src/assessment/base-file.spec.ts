import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  extractDeclaredProperties,
  extractExtFilters,
  extractInFolderFilters,
} from './base-file.js';

const BASE_PATH = join(
  import.meta.dirname,
  '..',
  '..',
  'fixtures',
  'vault',
  '02 Assignments',
  'Assignments.base',
);
const baseSource = readFileSync(BASE_PATH, 'utf8');

describe('base-file scan — against the real Assignments.base fixture', () => {
  it('finds the declared source folder', () => {
    expect(extractInFolderFilters(baseSource)).toEqual(['02 Assignments']);
  });

  it('finds the declared extension filter', () => {
    expect(extractExtFilters(baseSource)).toEqual(['md']);
  });

  it('finds the declared note columns, in order, formula column included', () => {
    expect(extractDeclaredProperties(baseSource)).toEqual([
      'class',
      'type',
      'weight',
      'due',
      'status',
      'formula.daysLeft',
    ]);
  });
});

describe('base-file scan — synthetic shapes', () => {
  it('returns an empty list when there is no properties block at all', () => {
    expect(extractDeclaredProperties('filters:\n  and:\n    - file.ext == "md"\n')).toEqual([]);
  });

  it('ignores nested detail lines (displayName) under a declared column', () => {
    const source =
      'properties:\n  weighting:\n    displayName: "Weighting"\n    extra: 1\nviews:\n  - type: table\n';
    expect(extractDeclaredProperties(source)).toEqual(['weighting']);
  });

  it('stops at the first dedent back out of the properties block', () => {
    const source = 'properties:\n  a:\n    displayName: A\n  b:\n    displayName: B\nviews: []\n';
    expect(extractDeclaredProperties(source)).toEqual(['a', 'b']);
  });

  it('handles a properties block that runs to end of file (no trailing views:)', () => {
    const source = 'properties:\n  a:\n    displayName: A\n';
    expect(extractDeclaredProperties(source)).toEqual(['a']);
  });

  it('finds multiple inFolder filters, in source order', () => {
    const source =
      'filters:\n  or:\n    - file.inFolder("Assignments A")\n    - file.inFolder("Assignments B")\n';
    expect(extractInFolderFilters(source)).toEqual(['Assignments A', 'Assignments B']);
  });

  it('finds no filters at all in a .base file that lacks them, without throwing', () => {
    expect(extractInFolderFilters('views:\n  - type: table\n')).toEqual([]);
    expect(extractExtFilters('views:\n  - type: table\n')).toEqual([]);
  });
});
