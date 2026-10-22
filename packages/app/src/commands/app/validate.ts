import { Command, Flags } from '@oclif/core';
import { readFile } from 'node:fs/promises';
import { buildClientSchema, GraphQLError, parse, validate, type DocumentNode, type IntrospectionQuery } from 'graphql';
import {
  getSession,
  createGraphQLClient,
  logger,
  toStructuredError,
  ExitCode,
} from '@cloudcart/cli-kit';
import { readAdminSchema, SchemaUnavailableError } from '../../lib/admin-schema.js';

/**
 * Validates a GraphQL document against the store's Admin API schema without executing it: the schema is read by
 * introspection (or the copy kept for an hour) and the document is checked here, so a mutation is never sent to the
 * store. A kept copy that finds errors is read again from the store before they are reported, so an old copy never
 * calls a document invalid (B-550).
 */
export default class AppValidate extends Command {
  static override description = 'Validate a GraphQL query against the Admin API schema, locally: the query is never sent to the store';

  static override examples = [
    "<%= config.bin %> app validate --query '{ products { edges { node { titl } } } }'",
    '<%= config.bin %> app validate --file query.graphql',
    "echo '{ generalSettings { siteName } }' | <%= config.bin %> app validate",
  ];

  static override flags = {
    query: Flags.string({
      char: 'q',
      description: 'Inline GraphQL query string to validate',
      exclusive: ['file'],
    }),
    file: Flags.string({
      char: 'f',
      description: 'Path to a .graphql file to validate',
      exclusive: ['query'],
    }),
    store: Flags.string({
      char: 's',
      description: 'Store URL to validate against',
    }),
    json: Flags.boolean({
      description: 'Output validation result as JSON',
      default: false,
    }),
    refresh: Flags.boolean({
      description: 'Read the schema from the store again instead of the copy kept for an hour',
      default: false,
    }),
  };

  async run(): Promise<void> {
    const { flags } = await this.parse(AppValidate);
    const jsonMode = flags.json;

    // Get the query
    let query: string;
    if (flags.query) {
      query = flags.query;
    } else if (flags.file) {
      try {
        query = await readFile(flags.file, 'utf-8');
      } catch {
        this.outputResult(jsonMode, false, [{ message: `Could not read file: ${flags.file}`, type: 'file_not_found' }]);
        this.exit(ExitCode.NOT_FOUND);
      }
    } else if (!process.stdin.isTTY) {
      query = await this.readStdin();
      if (!query.trim()) {
        this.outputResult(jsonMode, false, [{ message: 'No query received from stdin', type: 'usage_error' }]);
        this.exit(2);
      }
    } else {
      this.outputResult(jsonMode, false, [{ message: 'Provide a query with --query, --file, or pipe via stdin', type: 'usage_error' }]);
      this.exit(2);
    }

    // A document that does not parse needs no schema.
    let document: DocumentNode;
    try {
      document = parse(query!);
    } catch (error) {
      if (!(error instanceof GraphQLError)) throw error;
      this.outputResult(jsonMode, false, [{ message: error.message, type: 'graphql_syntax_error', locations: error.locations }]);
      this.exit(2);
    }

    try {
      const session = await getSession({ storeUrl: flags.store, autoPrompt: false });
      const client = createGraphQLClient(session);

      // Only the introspection goes to the store; the document is checked here.
      const schema = await readAdminSchema(session.storeUrl, client, { refresh: flags.refresh });
      let errors = check(schema.introspection, document!);
      if (errors.length && schema.fromCache) {
        errors = check((await readAdminSchema(session.storeUrl, client, { refresh: true })).introspection, document!);
      }

      if (errors.length) {
        this.outputResult(jsonMode, false, errors);
        this.exit(2);
      }

      this.outputResult(jsonMode, true, []);
    } catch (error) {
      // oclif exit errors should propagate
      if (error instanceof Error && error.message.startsWith('EEXIT')) throw error;
      if (error instanceof SchemaUnavailableError) {
        this.outputResult(jsonMode, false, [{ message: error.message, type: 'schema_unavailable' }]);
        this.exit(1);
      }
      if (jsonMode) {
        const structured = toStructuredError(error);
        console.log(JSON.stringify({ valid: false, errors: [structured] }));
      } else if (error instanceof Error) {
        logger.error(error.message);
      }
      // The error's class names the exit code: 4 a refused token, 6 rate limited, 7 the network (B-487).
      this.exit(toStructuredError(error).exitCode);
    }
  }

  private outputResult(
    jsonMode: boolean,
    valid: boolean,
    errors: Array<{ message: string; type?: string; locations?: unknown; path?: unknown }>,
  ): void {
    if (jsonMode) {
      console.log(JSON.stringify({ valid, errors }));
    } else if (valid) {
      logger.success('Query is valid.');
    } else {
      for (const e of errors) {
        logger.error(e.message);
      }
    }
  }

  private readStdin(): Promise<string> {
    return new Promise((resolve, reject) => {
      let data = '';
      process.stdin.setEncoding('utf-8');
      process.stdin.on('data', (chunk) => { data += chunk; });
      process.stdin.on('end', () => resolve(data));
      process.stdin.on('error', reject);
    });
  }
}

/** The document's errors against the schema, as `--json` prints them. */
function check(introspection: IntrospectionQuery, document: DocumentNode) {
  return validate(buildClientSchema(introspection), document).map((e) => ({
    message: e.message,
    type: 'graphql_validation_error' as const,
    locations: e.locations,
  }));
}
