import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { SchemaRegistry } from './registry.js';

describe('SchemaRegistry', () => {
  it('registers a schema and returns it by id, validating real input', () => {
    const registry = new SchemaRegistry();
    const pingSchema = z.object({ ok: z.literal(true) });

    registry.register({ id: 'ping.v1', schema: pingSchema, description: 'P0 smoke contract' });

    const entry = registry.get('ping.v1');
    expect(entry).toBeDefined();
    expect(entry?.schema.parse({ ok: true })).toEqual({ ok: true });
    expect(() => entry?.schema.parse({ ok: false })).toThrow();
  });

  it('rejects duplicate registration for the same contract id', () => {
    const registry = new SchemaRegistry();
    const schema = z.object({});
    registry.register({ id: 'dup.v1', schema, description: 'first' });

    expect(() => registry.register({ id: 'dup.v1', schema, description: 'second' })).toThrow(
      /duplicate registration/,
    );
  });

  it('starts empty and lists ids in sorted order', () => {
    const registry = new SchemaRegistry();
    registry.register({ id: 'b.v1', schema: z.object({}), description: 'b' });
    registry.register({ id: 'a.v1', schema: z.object({}), description: 'a' });

    expect(registry.ids()).toEqual(['a.v1', 'b.v1']);
    expect(registry.has('missing.v1')).toBe(false);
  });
});
