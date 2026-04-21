import { Command } from '@oclif/core';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { version } = require('../../package.json');

const CLI_DESCRIPTION = {
  name: 'cloudcart',
  version,
  description: 'CloudCart Developer CLI — manage stores, themes, and apps via GraphQL Admin API',
  auth: {
    env_vars: {
      CLOUDCART_CLI_TOKEN: 'Personal Access Token or JWT for non-interactive auth',
      CLOUDCART_CLI_STORE: 'Store URL (e.g., mystore.cloudcart.com)',
    },
    methods: ['token (CLOUDCART_CLI_TOKEN env var)', 'browser (interactive)', 'pat (--token flag)'],
    token_format: 'PATs start with cc_pat_, JWTs are standard Bearer tokens',
  },
  commands: {
    'auth login': {
      description: 'Authenticate with a CloudCart store',
      flags: {
        '--store, -s': { type: 'string', description: 'Store URL' },
        '--token, -t': { type: 'string', description: 'Personal Access Token (skips interactive)' },
      },
      non_interactive: 'cloudcart auth login --store mystore.cloudcart.com --token cc_pat_xxx',
    },
    'auth logout': {
      description: 'Remove stored credentials for a store',
      flags: {
        '--store, -s': { type: 'string', description: 'Store URL to log out from' },
      },
    },
    'auth status': {
      description: 'Show current authentication status',
      flags: {
        '--store, -s': { type: 'string', description: 'Show status for specific store' },
      },
    },
    'app execute': {
      description: 'Execute a GraphQL query against the Admin API',
      flags: {
        '--query, -q': { type: 'string', description: 'Inline GraphQL query' },
        '--file, -f': { type: 'string', description: 'Path to .graphql file' },
        '--variables, -v': { type: 'string', description: 'JSON variables (string or file path)' },
        '--store, -s': { type: 'string', description: 'Store URL' },
        '--json': { type: 'boolean', description: 'Machine-readable JSON output' },
        '--compact-output': { type: 'boolean', description: 'Minified JSON (saves tokens)' },
      },
      stdin: true,
      examples: [
        "cloudcart app execute --query '{ products(first:5) { nodes { id name pricing { from to } } totalCount } }' --json",
        "echo '{ shop { name } }' | cloudcart app execute --compact-output",
      ],
    },
    'app schema': {
      description: 'Fetch the Admin API GraphQL schema',
      flags: {
        '--compact, -c': { type: 'boolean', description: 'SDL format optimized for LLMs' },
        '--search': { type: 'string', description: 'Filter types/fields by search term' },
        '--mutations-only': { type: 'boolean', description: 'Only Mutation type + input types' },
        '--queries-only': { type: 'boolean', description: 'Only Query type + return types' },
        '--types-only': { type: 'boolean', description: 'Type names grouped by kind' },
        '--output, -o': { type: 'string', description: 'Write to file' },
        '--store, -s': { type: 'string', description: 'Store URL' },
        '--json': { type: 'boolean', description: 'Raw JSON introspection' },
      },
      examples: [
        'cloudcart app schema --search product --compact',
        'cloudcart app schema --mutations-only --compact',
        'cloudcart app schema --compact --output schema.graphql',
      ],
    },
    'app validate': {
      description: 'Validate a GraphQL query without executing it',
      flags: {
        '--query, -q': { type: 'string', description: 'Inline query to validate' },
        '--file, -f': { type: 'string', description: 'Path to .graphql file' },
        '--store, -s': { type: 'string', description: 'Store URL' },
        '--json': { type: 'boolean', description: 'JSON validation result' },
      },
      stdin: true,
      examples: [
        "cloudcart app validate --query '{ products { edges { node { titl } } } }' --json",
      ],
    },
    describe: {
      description: 'Output CLI capabilities as machine-readable JSON',
    },
    'llms-context': {
      description: 'Output system prompt / context for AI assistants',
    },
  },
  ai_usage: {
    recommended_flags: ['--json', '--compact-output'],
    schema_discovery: 'cloudcart app schema --search <term> --compact',
    full_schema: 'cloudcart app schema --compact',
    validate_before_execute: 'cloudcart app validate --query <query> --json',
    non_interactive_auth: 'Set CLOUDCART_CLI_TOKEN and CLOUDCART_CLI_STORE env vars',
  },
  exit_codes: {
    0: 'success',
    1: 'general error',
    2: 'usage/argument error',
    3: 'resource not found',
    4: 'authentication/permission denied',
    5: 'conflict',
    6: 'rate limited (retryable)',
    7: 'network error (retryable)',
  },
};

export default class Describe extends Command {
  static override description = 'Output CLI capabilities as machine-readable JSON (for AI assistants)';

  static override examples = [
    '<%= config.bin %> describe',
  ];

  static override flags = {};

  async run(): Promise<void> {
    console.log(JSON.stringify(CLI_DESCRIPTION, null, 2));
  }
}
