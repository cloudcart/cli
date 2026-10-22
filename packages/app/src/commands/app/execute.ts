import { Command, Flags } from '@oclif/core';
import { readFile } from 'node:fs/promises';
import { Kind, parse } from 'graphql';
import {
  getSession,
  createGraphQLClient,
  logger,
  colors,
  formatJson,
  toStructuredError,
  ExitCode,
} from '@cloudcart/cli-kit';

export default class AppExecute extends Command {
  static override description = 'Execute a GraphQL query against the Admin API';

  static override examples = [
    "<%= config.bin %> app execute --query '{ products(first: 5) { nodes { id name pricing { from to } } totalCount } }'",
    '<%= config.bin %> app execute --file query.graphql',
    "<%= config.bin %> app execute --query 'mutation { ... }' --variables '{\"id\": \"123\"}'",
    "echo '{ shop { name } }' | <%= config.bin %> app execute",
    '<%= config.bin %> app execute --query "{ orders(first: 10) { nodes { id orderNumber statuses { status } amounts { total } } totalCount } }" --json',
  ];

  static override flags = {
    query: Flags.string({
      char: 'q',
      description: 'Inline GraphQL query string',
      exclusive: ['file'],
    }),
    file: Flags.string({
      char: 'f',
      description: 'Path to a .graphql file',
      exclusive: ['query'],
    }),
    variables: Flags.string({
      char: 'v',
      description: 'JSON variables string or path to JSON file',
    }),
    store: Flags.string({
      char: 's',
      description: 'Store URL to execute against',
    }),
    json: Flags.boolean({
      description: 'Output raw JSON (no colors, no status messages)',
      default: false,
    }),
    'compact-output': Flags.boolean({
      description: 'Minified JSON output (no whitespace, saves tokens)',
      default: false,
    }),
    timeout: Flags.integer({
      description: "Seconds to wait for the store's answer (default 60)",
      min: 1,
      max: 600,
    }),
  };

  async run(): Promise<void> {
    const { flags } = await this.parse(AppExecute);
    const jsonMode = flags.json || flags['compact-output'];

    // Get the query from flags, file, or stdin
    let query: string;
    if (flags.query) {
      query = flags.query;
    } else if (flags.file) {
      try {
        query = await readFile(flags.file, 'utf-8');
      } catch {
        this.outputError(jsonMode, 'file_not_found', `Could not read file: ${flags.file}`);
        this.exit(ExitCode.NOT_FOUND);
      }
    } else if (!process.stdin.isTTY) {
      query = await this.readStdin();
      if (!query.trim()) {
        this.outputError(jsonMode, 'usage_error', 'No query received from stdin');
        this.exit(ExitCode.USAGE);
      }
    } else {
      this.outputError(jsonMode, 'usage_error', 'Provide a query with --query, --file, or pipe via stdin');
      this.exit(ExitCode.USAGE);
    }

    // Parse variables
    let variables: Record<string, unknown> | undefined;
    if (flags.variables) {
      try {
        variables = JSON.parse(flags.variables) as Record<string, unknown>;
      } catch {
        try {
          const content = await readFile(flags.variables, 'utf-8');
          variables = JSON.parse(content) as Record<string, unknown>;
        } catch {
          this.outputError(jsonMode, 'invalid_variables', 'Could not parse variables as JSON string or file path');
          this.exit(ExitCode.USAGE);
        }
      }
    }

    try {
      const session = await getSession({ storeUrl: flags.store, autoPrompt: !jsonMode });
      const client = createGraphQLClient(session, { timeoutMs: flags.timeout && flags.timeout * 1000 });

      if (!jsonMode) {
        logger.info(colors.dim(`Executing against ${session.storeUrl}...`));
      }

      // A mutation's failure after it was sent is never called retryable: it may have run (B-549).
      const result = hasMutation(query!)
        ? await client.mutation(query!, variables)
        : await client.query(query!, variables);

      if (jsonMode) {
        // Machine-readable: single JSON object with data and errors
        if (flags['compact-output']) {
          console.log(JSON.stringify(result));
        } else {
          console.log(JSON.stringify(result, null, 2));
        }
      } else {
        if (result.errors) {
          for (const error of result.errors) {
            logger.error(`GraphQL Error: ${error.message}`);
          }
        }
        if (result.data) {
          console.log(formatJson(result.data));
        }
      }

      // An answer with errors is a failed query, whatever data came with it (B-505).
      if (result.errors?.length) this.exit(ExitCode.GENERAL);
    } catch (error) {
      if (error instanceof Error && error.message.startsWith('EEXIT')) throw error;
      if (jsonMode) {
        const structured = toStructuredError(error);
        const output = { data: null, errors: [structured] };
        console.log(flags['compact-output'] ? JSON.stringify(output) : JSON.stringify(output, null, 2));
      } else if (error instanceof Error) {
        logger.error(error.message);
      }
      // The error's class names the exit code: 4 a refused token, 6 rate limited, 7 the network (B-487).
      this.exit(toStructuredError(error).exitCode);
    }
  }

  private outputError(jsonMode: boolean, type: string, message: string): void {
    if (jsonMode) {
      console.log(JSON.stringify({ data: null, errors: [{ type, message, retryable: false }] }));
    } else {
      logger.error(message);
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

/** Whether the document holds a mutation; one that does not parse holds none, since the store runs nothing of it. */
export function hasMutation(document: string): boolean {
  try {
    return parse(document).definitions.some(
      (definition) => definition.kind === Kind.OPERATION_DEFINITION && definition.operation === 'mutation',
    );
  } catch {
    return false;
  }
}
