/**
 * The store's Admin API schema, read by introspection: `app schema` prints it and `app validate` checks a
 * document against it without sending the document. Both keep it on disk for an hour, so an assistant's every
 * search or check does not download the whole schema again (4 MB on a real store, B-550).
 */
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { IntrospectionQuery } from 'graphql';
import { CONFIG_DIR, CLIError, type GraphQLClient } from '@cloudcart/cli-kit';

/** A kept schema is read again from the store after this long. */
export const SCHEMA_MAX_AGE_MS = 60 * 60 * 1000;

/** Raised when the query below changes, so a schema an older CLI kept is read again. */
const CACHE_VERSION = 1;

export interface AdminSchema {
  introspection: IntrospectionQuery;
  /** Whether it came from the disk rather than the store */
  fromCache: boolean;
  fetchedAt: Date;
}

/** The store answered the introspection with errors, or with no schema. */
export class SchemaUnavailableError extends CLIError {
  constructor(message: string) {
    super(`Could not read the schema: ${message}`, {
      type: 'schema_unavailable',
      retryable: false,
    });
    this.name = 'SchemaUnavailableError';
  }
}

/** The store's schema: the one kept on disk while it is under an hour old, unless `refresh`, else the store's. */
export async function readAdminSchema(
  storeUrl: string,
  client: GraphQLClient,
  options?: { refresh?: boolean },
): Promise<AdminSchema> {
  const file = schemaFile(storeUrl);
  const kept = options?.refresh ? undefined : await readKept(file);
  if (kept) return kept;

  const result = await client.query(INTROSPECTION_QUERY);
  const introspection = result.data as IntrospectionQuery | undefined;
  if (result.errors?.length || !introspection?.__schema) {
    throw new SchemaUnavailableError(
      result.errors?.map((e) => e.message).join('; ') || 'the store returned no schema.',
    );
  }

  const fetchedAt = new Date();
  await keep(file, { version: CACHE_VERSION, fetchedAt: fetchedAt.toISOString(), introspection });
  return { introspection, fromCache: false, fetchedAt };
}

/** One file per store, its name made safe for the file system. */
export function schemaFile(storeUrl: string): string {
  return join(CONFIG_DIR, 'schema', `${storeUrl.toLowerCase().replace(/[^a-z0-9.-]/g, '_')}.json`);
}

interface KeptSchema {
  version: number;
  fetchedAt: string;
  introspection: IntrospectionQuery;
}

/** The kept schema, if there is one of this version, under an hour old and whole; anything else is read again. */
async function readKept(file: string): Promise<AdminSchema | undefined> {
  let kept: Partial<KeptSchema>;
  try {
    kept = JSON.parse(await readFile(file, 'utf-8')) as Partial<KeptSchema>;
  } catch {
    return undefined;
  }
  const fetchedAt = new Date(kept.fetchedAt ?? NaN);
  const age = Date.now() - fetchedAt.getTime();
  if (
    kept.version !== CACHE_VERSION ||
    !(age >= 0 && age < SCHEMA_MAX_AGE_MS) ||
    !kept.introspection?.__schema
  ) {
    return undefined;
  }
  return { introspection: kept.introspection, fromCache: true, fetchedAt };
}

/**
 * Writes through a file of its own, renamed into place, so a command reading at the same time never sees half a
 * schema. A schema that cannot be kept (a read-only home) is only read again next time.
 */
async function keep(file: string, kept: KeptSchema): Promise<void> {
  const partial = `${file}.${process.pid}.${Date.now()}.tmp`;
  try {
    await mkdir(join(file, '..'), { recursive: true, mode: 0o700 });
    await writeFile(partial, JSON.stringify(kept), { mode: 0o600 });
    await rename(partial, file);
  } catch {
    // The schema is still answered, only not kept.
    await rm(partial, { force: true }).catch(() => {});
  }
}

// Standard GraphQL introspection query
export const INTROSPECTION_QUERY = `
  query IntrospectionQuery {
    __schema {
      queryType { name }
      mutationType { name }
      subscriptionType { name }
      types {
        ...FullType
      }
      directives {
        name
        description
        locations
        args { ...InputValue }
      }
    }
  }

  fragment FullType on __Type {
    kind
    name
    description
    fields(includeDeprecated: true) {
      name
      description
      args { ...InputValue }
      type { ...TypeRef }
      isDeprecated
      deprecationReason
    }
    inputFields { ...InputValue }
    interfaces { ...TypeRef }
    enumValues(includeDeprecated: true) {
      name
      description
      isDeprecated
      deprecationReason
    }
    possibleTypes { ...TypeRef }
  }

  fragment InputValue on __InputValue {
    name
    description
    type { ...TypeRef }
    defaultValue
  }

  fragment TypeRef on __Type {
    kind
    name
    ofType {
      kind
      name
      ofType {
        kind
        name
        ofType {
          kind
          name
          ofType {
            kind
            name
            ofType {
              kind
              name
              ofType {
                kind
                name
              }
            }
          }
        }
      }
    }
  }
`;
