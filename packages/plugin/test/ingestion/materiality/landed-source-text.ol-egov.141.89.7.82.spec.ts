/**
 * `ol-egov.141.89.7.82` ([D-518]): the in-memory record of each cited file's re-extracted text,
 * by version, that the rewrite reads. The rewrite-path specs beside this one drive it through
 * `CitationRevisionTrigger`; this pins the record's own rules, including the whole-file text a
 * page-less citation would read and the bound on versions set aside. Every string is invented.
 */
import { describe, expect, it } from 'vitest';
import {
  LandedSourceText,
  SET_ASIDE_VERSIONS,
} from '../../../src/ingestion/materiality/landed-source-text.js';

const PATH = 'Synthetic/sample handout.pdf';
const pages = (entries: Record<number, string>) =>
  new Map(Object.entries(entries).map(([page, text]) => [Number(page), text] as const));

describe('the landed text of one file, by version', () => {
  it('holds nothing until a delivery lands', () => {
    const landed = new LandedSourceText();
    expect(landed.size).toBe(0);
    expect(landed.current(PATH)).toBeUndefined();
  });

  it('one delivery is read back exactly as it landed: a page, and the whole file in page order', () => {
    const landed = new LandedSourceText();
    landed.record(PATH, 'h1', pages({ 3: 'three', 1: 'one', 2: '   ' }));
    const current = landed.current(PATH);
    expect(current?.hash).toBe('h1');
    expect(current?.pageText(1)).toBe('one');
    expect(current?.pageText(2)).toBe('   ');
    expect(current?.pageText(4)).toBe('');
    expect(current?.wholeText()).toBe('one\n\n   \n\nthree');
  });

  it('a repeat covering the same pages replaces that delivery whole', () => {
    const landed = new LandedSourceText();
    landed.record(PATH, 'h1', pages({ 1: 'one', 2: 'two' }));
    landed.record(PATH, 'h1', pages({ 1: 'one again', 2: 'two again' }));
    expect(landed.current(PATH)?.wholeText()).toBe('one again\n\ntwo again');
  });

  it('a delivery covering other pages of the same bytes is added beside the others', () => {
    const landed = new LandedSourceText();
    landed.record(PATH, 'h1', pages({ 2: 'image two' }));
    landed.record(PATH, 'h1', pages({ 1: 'one', 2: 'two' }));
    landed.record(PATH, 'h1', pages({ 3: 'image three' }));
    const current = landed.current(PATH);
    // The delivery covering more pages first on a shared page, whatever the order of landing.
    expect(current?.pageText(2)).toBe('two\n\nimage two');
    expect(current?.wholeText()).toBe('one\n\ntwo\n\nimage two\n\nimage three');
  });

  it('other bytes start afresh, and the version they displace comes back with its next delivery', () => {
    const landed = new LandedSourceText();
    landed.record(PATH, 'h2', pages({ 1: 'two:one', 2: 'two:two' }));
    landed.record(PATH, 'h1', pages({ 3: 'one:image' }));
    expect(landed.current(PATH)?.hash).toBe('h1');
    expect(landed.current(PATH)?.wholeText()).toBe('one:image');
    landed.record(PATH, 'h2', pages({ 3: 'two:image' }));
    expect(landed.current(PATH)?.hash).toBe('h2');
    expect(landed.current(PATH)?.wholeText()).toBe('two:one\n\ntwo:two\n\ntwo:image');
  });

  it(`keeps at most ${SET_ASIDE_VERSIONS} displaced versions per file, the most recent`, () => {
    const landed = new LandedSourceText();
    const hashes = Array.from({ length: SET_ASIDE_VERSIONS + 2 }, (_, i) => `h${i}`);
    for (const hash of hashes) landed.record(PATH, hash, pages({ 1: `${hash} text` }));
    // The oldest is gone: its next delivery starts afresh.
    landed.record(PATH, 'h0', pages({ 2: 'h0 image' }));
    expect(landed.current(PATH)?.wholeText()).toBe('h0 image');
    // The most recently displaced is still kept.
    const kept = hashes.at(-1) as string;
    landed.record(PATH, kept, pages({ 2: `${kept} image` }));
    expect(landed.current(PATH)?.wholeText()).toBe(`${kept} text\n\n${kept} image`);
  });

  it('keeps files apart', () => {
    const landed = new LandedSourceText();
    landed.record(PATH, 'h1', pages({ 1: 'one' }));
    landed.record('Synthetic/other.pptx', 'h9', pages({ 1: 'other' }));
    expect(landed.size).toBe(2);
    expect(landed.current(PATH)?.wholeText()).toBe('one');
  });
});
