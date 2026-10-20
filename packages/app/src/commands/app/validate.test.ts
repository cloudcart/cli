import { buildSchema, introspectionFromSchema } from 'graphql';
import { afterEach, beforeEach, describe, it, expect, vi } from 'vitest';

// A small Admin API: one read and one write.
const INTROSPECTION = introspectionFromSchema(
  buildSchema(`
    type Query { shop: Shop }
    type Shop { name: String! }
    type Mutation { productDelete(id: ID!): Boolean! }
  `),
);

/** Every document the command sent to the store. */
let sent: string[] = [];

vi.mock('@cloudcart/cli-kit', () => ({
  getSession: vi.fn(async () => ({ storeUrl: 'shop.example.com' })),
  createGraphQLClient: vi.fn(() => ({
    query: async (document: string) => {
      sent.push(document);
      return document.includes('__schema') ? { data: INTROSPECTION } : { data: { productDelete: true } };
    },
  })),
  logger: { info: vi.fn(), error: vi.fn(), success: vi.fn() },
  toStructuredError: (err: unknown) => ({
    type: 'unexpected_error',
    message: err instanceof Error ? err.message : String(err),
    retryable: false,
  }),
}));

const { default: AppValidate } = await import('./validate.js');

let output: string[] = [];

beforeEach(() => {
  sent = [];
  output = [];
  vi.spyOn(console, 'log').mockImplementation((...args: unknown[]) => void output.push(args.join(' ')));
});

afterEach(() => {
  vi.restoreAllMocks();
});

const config = { runHook: async () => ({ successes: [], failures: [] }) };
/** Runs the command with `--json` and returns its answer and exit code. */
async function check(document: string): Promise<{ answer: { valid: boolean; errors: Array<{ message: string; type: string }> }; code: number }> {
  let code = 0;
  try {
    await new AppValidate(['--query', document, '--json'], config as never).run();
  } catch (error) {
    code = (error as { oclif?: { exit?: number } }).oclif?.exit ?? -1;
  }
  return { answer: JSON.parse(output.at(-1) ?? '{}'), code };
}

describe('app validate', () => {
  it('checks a mutation against the schema and never sends it to the store', async () => {
    const { answer, code } = await check('mutation { productDelete(id: "1") }');

    expect(answer).toEqual({ valid: true, errors: [] });
    expect(code).toBe(0);
    expect(sent).toHaveLength(1);
    expect(sent[0]).toContain('__schema');
    expect(sent.join()).not.toContain('productDelete');
  });

  it('refuses a field the schema lacks, with exit code 2', async () => {
    const { answer, code } = await check('{ shop { nme } }');

    expect(answer.valid).toBe(false);
    expect(answer.errors[0]).toMatchObject({ type: 'graphql_validation_error' });
    expect(answer.errors[0].message).toContain('Cannot query field "nme" on type "Shop"');
    expect(code).toBe(2);
  });

  it('refuses a document that does not parse before asking the store anything', async () => {
    const { answer, code } = await check('{ shop { name }');

    expect(answer.errors[0]).toMatchObject({ type: 'graphql_syntax_error' });
    expect(code).toBe(2);
    expect(sent).toHaveLength(0);
  });
});

describe('AppValidate', () => {
  it('has the correct description', () => {
    expect(AppValidate.description).toContain('Validate');
  });

  it('defines required flags', () => {
    const flags = AppValidate.flags;
    expect(flags).toHaveProperty('query');
    expect(flags).toHaveProperty('file');
    expect(flags).toHaveProperty('store');
    expect(flags).toHaveProperty('json');
  });

  it('has examples', () => {
    expect(AppValidate.examples.length).toBeGreaterThan(0);
  });

  it('query and file flags are mutually exclusive', () => {
    const queryFlag = AppValidate.flags.query as { exclusive?: string[] };
    const fileFlag = AppValidate.flags.file as { exclusive?: string[] };
    expect(queryFlag.exclusive).toContain('file');
    expect(fileFlag.exclusive).toContain('query');
  });

  it('json flag defaults to false', () => {
    const jsonFlag = AppValidate.flags.json as { default?: boolean };
    expect(jsonFlag.default).toBe(false);
  });
});
