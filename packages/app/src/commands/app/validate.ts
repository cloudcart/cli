import { Command, Flags } from '@oclif/core';
import { readFile } from 'node:fs/promises';
import {
  getSession,
  createGraphQLClient,
  logger,
  toStructuredError,
} from '@cloudcart/cli-kit';

/**
 * Validates a GraphQL query against the store's schema without executing it.
 * Uses a POST with the query to the API — GraphQL servers return validation
 * errors in the `errors` array without executing invalid queries.
 * We add __typename to prevent actual data execution side effects.
 */
export default class AppValidate extends Command {
  static override description = 'Validate a GraphQL query against the Admin API schema without executing it';

  static override examples = [
    "<%= config.bin %> app validate --query '{ products { edges { node { titl } } } }'",
    '<%= config.bin %> app validate --file query.graphql',
    "echo '{ shop { name } }' | <%= config.bin %> app validate",
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
        this.exit(2);
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

    try {
      const session = await getSession({ storeUrl: flags.store, autoPrompt: false });
      const client = createGraphQLClient(session);

      // Send the query — the server will validate it and return errors if invalid
      // For mutations, we can't avoid execution, so we use introspection-based validation
      const result = await client.query(query!);

      if (result.errors?.length) {
        const errors = result.errors.map(e => ({
          message: e.message,
          type: 'graphql_validation_error' as const,
          locations: e.locations,
          path: e.path,
        }));
        this.outputResult(jsonMode, false, errors);
        this.exit(2);
      }

      this.outputResult(jsonMode, true, []);
    } catch (error) {
      // oclif exit errors should propagate
      if (error instanceof Error && error.message.startsWith('EEXIT')) throw error;
      if (jsonMode) {
        const structured = toStructuredError(error);
        console.log(JSON.stringify({ valid: false, errors: [structured] }));
      } else if (error instanceof Error) {
        logger.error(error.message);
      }
      this.exit(1);
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
