import { describe, expect, it } from 'vitest';
import { DEFAULT_TEXT_LAYER_CHAR_THRESHOLD, routePage } from './threshold.js';

describe('routePage', () => {
  it('routes just below the threshold to vision', () => {
    expect(routePage(DEFAULT_TEXT_LAYER_CHAR_THRESHOLD - 1)).toBe('vision');
  });

  it('routes exactly at the threshold to the text layer — the threshold names the lowest acceptable yield', () => {
    expect(routePage(DEFAULT_TEXT_LAYER_CHAR_THRESHOLD)).toBe('text-layer');
  });

  it('routes just above the threshold to the text layer', () => {
    expect(routePage(DEFAULT_TEXT_LAYER_CHAR_THRESHOLD + 1)).toBe('text-layer');
  });

  it('routes zero characters (the true image-only/scanned-page case) to vision', () => {
    expect(routePage(0)).toBe('vision');
  });

  it('respects a configured threshold override rather than the default', () => {
    expect(routePage(50, 100)).toBe('vision');
    expect(routePage(100, 100)).toBe('text-layer');
    expect(routePage(150, 100)).toBe('text-layer');
  });

  it('the default threshold does not misroute a terse-but-real title slide (44 chars, the fixture PDF)', () => {
    expect(routePage(44)).toBe('text-layer');
  });
});
