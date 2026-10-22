import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { buildSchema, introspectionFromSchema } from 'graphql';
import { afterAll, afterEach, beforeEach, describe, it, expect, vi } from 'vitest';

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

/** Set to make the store refuse every request. */
let refusal: Error | undefined;

vi.mock('@cloudcart/cli-kit', async () => {
  // The errors and their exit codes are the real ones; the CLI's folder is a fresh one.
  const { toStructuredError, ExitCode, CLIError } = await vi.importActual<typeof import('@cloudcart/cli-kit')>('@cloudcart/cli-kit');
  const { mkdtempSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  return {
    CLIError,
    CONFIG_DIR: mkdtempSync(join(tmpdir(), 'cc-validate-')),
    getSession: vi.fn(async () => ({ storeUrl: 'shop.example.com' })),
    createGraphQLClient: vi.fn(() => ({
      query: async (document: string) => {
        if (refusal) throw refusal;
        sent.push(document);
        return document.includes('__schema') ? { data: INTROSPECTION } : { data: { productDelete: true } };
      },
    })),
    logger: { info: vi.fn(), error: vi.fn(), success: vi.fn() },
    toStructuredError,
    ExitCode,
  };
});

const { default: AppValidate } = await import('./validate.js');
const { schemaFile } = await import('../../lib/admin-schema.js');
const { CONFIG_DIR } = await import('@cloudcart/cli-kit');

/** Keeps this schema on disk as if `app schema` or `app validate` had read it a minute ago. */
function kept(sdl: string) {
  mkdirSync(join(CONFIG_DIR, 'schema'), { recursive: true });
  writeFileSync(schemaFile('shop.example.com'), JSON.stringify({
    version: 1,
    fetchedAt: new Date(Date.now() - 60_000).toISOString(),
    introspection: introspectionFromSchema(buildSchema(sdl)),
  }));
}

const introspections = () => sent.filter((document) => document.includes('__schema')).length;

let output: string[] = [];

beforeEach(() => {
  sent = [];
  output = [];
  refusal = undefined;
  rmSync(join(CONFIG_DIR, 'schema'), { recursive: true, force: true });
  vi.spyOn(console, 'log').mockImplementation((...args: unknown[]) => void output.push(args.join(' ')));
});

afterEach(() => {
  vi.restoreAllMocks();
});

afterAll(() => rmSync(CONFIG_DIR, { recursive: true, force: true }));

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

describe('app validate, the exit code (B-487)', () => {
  it('is 4 when the store refuses the token, and 3 for a file it cannot read', async () => {
    const { AuthenticationError } = await vi.importActual<typeof import('@cloudcart/cli-kit')>('@cloudcart/cli-kit');
    refusal = new AuthenticationError('Invalid or expired token');
    expect((await check('{ shop { name } }')).code).toBe(4);

    refusal = undefined;
    let code = 0;
    try {
      await new AppValidate(['--file', '/nonexistent/query.graphql', '--json'], config as never).run();
    } catch (error) {
      code = (error as { oclif?: { exit?: number } }).oclif?.exit ?? -1;
    }
    expect(code).toBe(3);
    expect(JSON.parse(output.at(-1)!).errors[0].type).toBe('file_not_found');
  });
});

describe('app validate, the kept schema (B-550)', () => {
  it('reads the schema once: the next check sends nothing to the store', async () => {
    expect((await check('{ shop { name } }')).code).toBe(0);
    expect((await check('{ shop { name } }')).code).toBe(0);
    expect(introspections()).toBe(1);
  });

  it('reads a kept schema again before it calls a document invalid', async () => {
    kept('type Query { shop: Shop } type Shop { id: ID }');
    const { answer, code } = await check('{ shop { name } }');
    expect(code).toBe(0);
    expect(answer.valid).toBe(true);
    expect(introspections()).toBe(1);
  });

  it('reports an error the fresh schema has too, after one read', async () => {
    kept('type Query { shop: Shop } type Shop { name: String! }');
    const { answer, code } = await check('{ shop { nme } }');
    expect(code).toBe(2);
    expect(answer.errors[0].message).toContain('nme');
    expect(introspections()).toBe(1);
  });

  it('reads the store with --refresh even when a schema is kept', async () => {
    kept('type Query { shop: Shop } type Shop { name: String! }');
    let code = 0;
    try {
      await new AppValidate(['--query', '{ shop { name } }', '--json', '--refresh'], config as never).run();
    } catch (error) {
      code = (error as { oclif?: { exit?: number } }).oclif?.exit ?? -1;
    }
    expect(code).toBe(0);
    expect(introspections()).toBe(1);
  });

  it('says the schema could not be read when the store answers its introspection with errors, exit 1', async () => {
    refusal = undefined;
    const { createGraphQLClient } = await import('@cloudcart/cli-kit');
    vi.mocked(createGraphQLClient).mockReturnValueOnce({
      query: async () => ({ errors: [{ message: 'Max query depth should be 10 but got 11.' }] }),
    } as never);
    const { answer, code } = await check('{ shop { name } }');
    expect(code).toBe(1);
    expect(answer.errors[0]).toEqual({ message: 'Could not read the schema: Max query depth should be 10 but got 11.', type: 'schema_unavailable' });
  });
});
