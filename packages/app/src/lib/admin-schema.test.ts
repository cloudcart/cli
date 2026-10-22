import { mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { buildSchema, introspectionFromSchema } from 'graphql';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';

// The CLI's folder is a fresh one for these tests: nothing is read from or written to the real home.
vi.mock('@cloudcart/cli-kit', async () => {
  const { mkdtempSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  return {
    CLIError: (await vi.importActual<typeof import('@cloudcart/cli-kit')>('@cloudcart/cli-kit'))
      .CLIError,
    CONFIG_DIR: mkdtempSync(join(tmpdir(), 'cc-schema-')),
  };
});

const { CONFIG_DIR } = await import('@cloudcart/cli-kit');
const home = { dir: CONFIG_DIR };
const { readAdminSchema, schemaFile, SCHEMA_MAX_AGE_MS } = await import('./admin-schema.js');

const INTROSPECTION = introspectionFromSchema(buildSchema('type Query { products: [String] }'));

/** A store that answers the introspection and counts how often it was asked. */
function store(answer: unknown = { data: INTROSPECTION }) {
  const query = vi.fn(async () => answer);
  return { query, client: { query } as never };
}

let storeUrl: string;
let n = 0;
beforeEach(() => {
  storeUrl = `shop${++n}.example.com`;
});
afterAll(() => rmSync(home.dir, { recursive: true, force: true }));

describe('the kept schema (B-550)', () => {
  it('reads the store once and keeps the schema for the next call', async () => {
    const { query, client } = store();
    const first = await readAdminSchema(storeUrl, client);
    const second = await readAdminSchema(storeUrl, client);
    expect(query).toHaveBeenCalledTimes(1);
    expect(first.fromCache).toBe(false);
    expect(second.fromCache).toBe(true);
    expect(second.introspection).toEqual(INTROSPECTION);
  });

  it('keeps it beside the sign-ins, the folder 700 and the file 600, with no partial file left', async () => {
    await readAdminSchema(storeUrl, store().client);
    const file = schemaFile(storeUrl);
    expect(file).toBe(join(home.dir, 'schema', `${storeUrl}.json`));
    expect(statSync(join(home.dir, 'schema')).mode & 0o777).toBe(0o700);
    expect(statSync(file).mode & 0o777).toBe(0o600);
    expect(readdirSync(join(home.dir, 'schema')).filter((name) => name.endsWith('.tmp'))).toEqual(
      [],
    );
    expect(JSON.parse(readFileSync(file, 'utf-8'))).toMatchObject({
      version: 1,
      introspection: INTROSPECTION,
    });
  });

  it('reads the store again with refresh', async () => {
    const { query, client } = store();
    await readAdminSchema(storeUrl, client);
    expect((await readAdminSchema(storeUrl, client, { refresh: true })).fromCache).toBe(false);
    expect(query).toHaveBeenCalledTimes(2);
  });

  it('reads the store again after an hour', async () => {
    const { query, client } = store();
    await readAdminSchema(storeUrl, client);
    const kept = JSON.parse(readFileSync(schemaFile(storeUrl), 'utf-8'));
    kept.fetchedAt = new Date(Date.now() - SCHEMA_MAX_AGE_MS - 1000).toISOString();
    writeFileSync(schemaFile(storeUrl), JSON.stringify(kept));
    expect((await readAdminSchema(storeUrl, client)).fromCache).toBe(false);
    expect(query).toHaveBeenCalledTimes(2);
  });

  it('reads the store again for a file of another version, half written, or dated ahead', async () => {
    for (const content of [
      JSON.stringify({
        version: 0,
        fetchedAt: new Date().toISOString(),
        introspection: INTROSPECTION,
      }),
      '{"version":1,"fetchedAt":"',
      JSON.stringify({
        version: 1,
        fetchedAt: new Date(Date.now() + 60_000).toISOString(),
        introspection: INTROSPECTION,
      }),
      JSON.stringify({ version: 1, fetchedAt: new Date().toISOString(), introspection: {} }),
    ]) {
      mkdirSync(join(home.dir, 'schema'), { recursive: true });
      writeFileSync(schemaFile(storeUrl), content);
      const { query, client } = store();
      expect((await readAdminSchema(storeUrl, client)).fromCache).toBe(false);
      expect(query).toHaveBeenCalledTimes(1);
    }
  });

  it('keeps one schema per store, the name made safe', async () => {
    const { query, client } = store();
    await readAdminSchema('127.0.0.1:8443', client);
    await readAdminSchema(storeUrl, client);
    expect(query).toHaveBeenCalledTimes(2);
    expect(schemaFile('127.0.0.1:8443')).toBe(join(home.dir, 'schema', '127.0.0.1_8443.json'));
  });

  it('keeps nothing when the store answers with errors, and says why', async () => {
    const { client } = store({ errors: [{ message: 'Max query depth should be 10 but got 11.' }] });
    await expect(readAdminSchema(storeUrl, client)).rejects.toMatchObject({
      errorType: 'schema_unavailable',
      message: 'Could not read the schema: Max query depth should be 10 but got 11.',
    });
    expect(() => statSync(schemaFile(storeUrl))).toThrow();
  });

  it('still answers when the schema cannot be kept, and leaves no partial file', async () => {
    // A folder where the file should be: the rename fails, the answer still comes.
    const blocked = 'blocked.example.com';
    mkdirSync(schemaFile(blocked), { recursive: true });
    const { query, client } = store();
    expect((await readAdminSchema(blocked, client)).introspection).toEqual(INTROSPECTION);
    expect(query).toHaveBeenCalledTimes(1);
    expect(readdirSync(join(home.dir, 'schema')).filter((name) => name.endsWith('.tmp'))).toEqual(
      [],
    );
  });
});
