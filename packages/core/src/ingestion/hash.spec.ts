import { describe, expect, it } from 'vitest';
import { hashContent, hashText } from './hash.js';

describe('hashContent / hashText — SHA-256, hex-encoded', () => {
  it('produces a 64-character lowercase hex string', async () => {
    const hash = await hashText('lecture 3: basalt weathering');
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it('is deterministic — the same bytes always hash the same', async () => {
    const a = await hashText('slide deck contents');
    const b = await hashText('slide deck contents');
    expect(a).toBe(b);
  });

  it('is sensitive to any byte difference', async () => {
    const a = await hashText('Feldspar');
    const b = await hashText('feldspar');
    expect(a).not.toBe(b);
  });

  it('hashText is UTF-8 encoding of hashContent — same input, same result either way', async () => {
    // The `•` is load-bearing: a multi-byte UTF-8 character is what makes the
    // hashText/hashContent equivalence a real assertion rather than an ASCII tautology.
    const text = 'Moraine • Outwash';
    const viaText = await hashText(text);
    const viaBytes = await hashContent(new TextEncoder().encode(text));
    expect(viaText).toBe(viaBytes);
  });

  it('two independently-computed hashes of identical synced content agree — the mechanism D-002 idempotency relies on', async () => {
    // Simulates the same lecture PDF's bytes arriving via vault sync on a
    // second device: two unrelated calls, same bytes in, same hash out,
    // with no coordination between them.
    const bytes = new TextEncoder().encode('30-slide deck: Sonatina in D');
    const deviceA = await hashContent(bytes);
    const deviceB = await hashContent(new Uint8Array(bytes)); // distinct array instance, same bytes
    expect(deviceA).toBe(deviceB);
  });
});
