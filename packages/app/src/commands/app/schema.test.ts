import { describe, it, expect, vi } from 'vitest';
import AppSchema from './schema.js';

vi.mock('@cloudcart/cli-kit', () => ({
  getSession: vi.fn(),
  createGraphQLClient: vi.fn(),
  logger: { info: vi.fn(), error: vi.fn(), success: vi.fn() },
  colors: { dim: (s: string) => s, bold: (s: string) => s },
  toStructuredError: (err: unknown) => ({
    type: 'unexpected_error',
    message: err instanceof Error ? err.message : String(err),
    retryable: false,
  }),
}));

describe('AppSchema', () => {
  it('has the correct description', () => {
    expect(AppSchema.description).toContain('schema');
  });

  it('defines required flags', () => {
    const flags = AppSchema.flags;
    expect(flags).toHaveProperty('store');
    expect(flags).toHaveProperty('output');
    expect(flags).toHaveProperty('compact');
    expect(flags).toHaveProperty('search');
    expect(flags).toHaveProperty('mutations-only');
    expect(flags).toHaveProperty('queries-only');
    expect(flags).toHaveProperty('types-only');
    expect(flags).toHaveProperty('json');
  });

  it('has examples', () => {
    expect(AppSchema.examples.length).toBeGreaterThan(0);
  });

  it('compact flag defaults to false', () => {
    const compactFlag = AppSchema.flags.compact as { default?: boolean };
    expect(compactFlag.default).toBe(false);
  });

  it('json flag defaults to false', () => {
    const jsonFlag = AppSchema.flags.json as { default?: boolean };
    expect(jsonFlag.default).toBe(false);
  });

  // Test the private methods via the class instance
  it('toCompactSDL produces valid SDL-like output', () => {
    const instance = new AppSchema([], {} as never);

    const schema = {
      queryType: { name: 'Query' },
      mutationType: { name: 'Mutation' },
      subscriptionType: null,
      types: [
        {
          kind: 'SCALAR',
          name: 'String',
          description: 'Built-in String',
        },
        {
          kind: 'ENUM',
          name: 'Status',
          enumValues: [
            { name: 'ACTIVE' },
            { name: 'INACTIVE' },
          ],
        },
        {
          kind: 'OBJECT',
          name: 'Product',
          fields: [
            { name: 'id', type: { kind: 'NON_NULL', name: null, ofType: { kind: 'SCALAR', name: 'ID', ofType: null } }, args: [] },
            { name: 'title', type: { kind: 'SCALAR', name: 'String', ofType: null }, args: [] },
          ],
          interfaces: [],
        },
        {
          kind: 'INPUT_OBJECT',
          name: 'ProductInput',
          inputFields: [
            { name: 'title', type: { kind: 'SCALAR', name: 'String', ofType: null } },
          ],
        },
        {
          kind: 'UNION',
          name: 'SearchResult',
          possibleTypes: [
            { kind: 'OBJECT', name: 'Product' },
            { kind: 'OBJECT', name: 'Order' },
          ],
        },
        {
          kind: 'OBJECT',
          name: '__Schema',
          fields: [],
        },
      ],
    };

    // Access private method
    const sdl = (instance as unknown as { toCompactSDL: (s: typeof schema) => string }).toCompactSDL(schema);

    expect(sdl).toContain('# Query root: Query');
    expect(sdl).toContain('# Mutation root: Mutation');
    expect(sdl).toContain('scalar String');
    expect(sdl).toContain('enum Status { ACTIVE | INACTIVE }');
    expect(sdl).toContain('type Product {');
    expect(sdl).toContain('  id: ID!');
    expect(sdl).toContain('  title: String');
    expect(sdl).toContain('input ProductInput {');
    expect(sdl).toContain('union SearchResult = Product | Order');
    // Should not include __Schema (internal type)
    expect(sdl).not.toContain('__Schema');
  });

  it('filterBySearch filters types by name', () => {
    const instance = new AppSchema([], {} as never);

    const schema = {
      queryType: { name: 'Query' },
      mutationType: null,
      subscriptionType: null,
      types: [
        { kind: 'OBJECT', name: 'Product', fields: [{ name: 'id', type: { kind: 'SCALAR', name: 'ID' }, args: [] }] },
        { kind: 'OBJECT', name: 'Order', fields: [{ name: 'id', type: { kind: 'SCALAR', name: 'ID' }, args: [] }] },
        { kind: 'OBJECT', name: 'ProductVariant', fields: [{ name: 'id', type: { kind: 'SCALAR', name: 'ID' }, args: [] }] },
        { kind: 'INPUT_OBJECT', name: 'ProductInput', inputFields: [{ name: 'title', type: { kind: 'SCALAR', name: 'String' } }] },
        { kind: 'OBJECT', name: 'Query', fields: [
          { name: 'products', type: { kind: 'OBJECT', name: 'ProductConnection' }, args: [] },
          { name: 'orders', type: { kind: 'OBJECT', name: 'OrderConnection' }, args: [] },
        ]},
        { kind: 'OBJECT', name: 'ProductConnection', fields: [] },
        { kind: 'OBJECT', name: 'OrderConnection', fields: [] },
      ],
    };

    const filtered = (instance as unknown as { filterBySearch: (s: typeof schema, term: string) => typeof schema }).filterBySearch(schema, 'product');

    const names = filtered.types.map(t => t.name);
    expect(names).toContain('Product');
    expect(names).toContain('ProductVariant');
    expect(names).toContain('ProductInput');
    expect(names).not.toContain('Order');
    expect(names).not.toContain('OrderConnection');
    // Query root should be included (has matching field "products")
    expect(names).toContain('Query');
  });

  it('filterMutations returns only mutation-related types', () => {
    const instance = new AppSchema([], {} as never);

    const schema = {
      queryType: { name: 'Query' },
      mutationType: { name: 'Mutation' },
      subscriptionType: null,
      types: [
        { kind: 'OBJECT', name: 'Query', fields: [{ name: 'products', type: { kind: 'OBJECT', name: 'ProductConnection' }, args: [] }] },
        { kind: 'OBJECT', name: 'Mutation', fields: [
          { name: 'createProduct', type: { kind: 'OBJECT', name: 'Product' }, args: [{ name: 'input', type: { kind: 'INPUT_OBJECT', name: 'CreateProductInput' } }] },
        ]},
        { kind: 'OBJECT', name: 'Product', fields: [] },
        { kind: 'INPUT_OBJECT', name: 'CreateProductInput', inputFields: [{ name: 'title', type: { kind: 'SCALAR', name: 'String' } }] },
        { kind: 'OBJECT', name: 'ProductConnection', fields: [] },
      ],
    };

    const filtered = (instance as unknown as { filterMutations: (s: typeof schema) => typeof schema }).filterMutations(schema);
    const names = filtered.types.map(t => t.name);

    expect(names).toContain('Mutation');
    expect(names).toContain('Product');
    expect(names).toContain('CreateProductInput');
    expect(names).not.toContain('Query');
    expect(names).not.toContain('ProductConnection');
  });

  it('filterQueries returns only query-related types', () => {
    const instance = new AppSchema([], {} as never);

    const schema = {
      queryType: { name: 'Query' },
      mutationType: { name: 'Mutation' },
      subscriptionType: null,
      types: [
        { kind: 'OBJECT', name: 'Query', fields: [
          { name: 'products', type: { kind: 'OBJECT', name: 'ProductConnection' }, args: [{ name: 'first', type: { kind: 'SCALAR', name: 'Int' } }] },
        ]},
        { kind: 'OBJECT', name: 'Mutation', fields: [] },
        { kind: 'OBJECT', name: 'ProductConnection', fields: [] },
        { kind: 'INPUT_OBJECT', name: 'CreateProductInput', inputFields: [] },
      ],
    };

    const filtered = (instance as unknown as { filterQueries: (s: typeof schema) => typeof schema }).filterQueries(schema);
    const names = filtered.types.map(t => t.name);

    expect(names).toContain('Query');
    expect(names).toContain('ProductConnection');
    expect(names).not.toContain('Mutation');
    expect(names).not.toContain('CreateProductInput');
  });

  it('typeRefToString handles nested types', () => {
    const instance = new AppSchema([], {} as never);
    const fn = (instance as unknown as { typeRefToString: (ref: unknown) => string }).typeRefToString.bind(instance);

    expect(fn({ kind: 'SCALAR', name: 'String' })).toBe('String');
    expect(fn({ kind: 'NON_NULL', name: null, ofType: { kind: 'SCALAR', name: 'String' } })).toBe('String!');
    expect(fn({ kind: 'LIST', name: null, ofType: { kind: 'SCALAR', name: 'String' } })).toBe('[String]');
    expect(fn({ kind: 'NON_NULL', name: null, ofType: { kind: 'LIST', name: null, ofType: { kind: 'SCALAR', name: 'Int' } } })).toBe('[Int]!');
    expect(fn(null)).toBe('Unknown');
    expect(fn(undefined)).toBe('Unknown');
  });
});
