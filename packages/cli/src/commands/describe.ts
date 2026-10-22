import { Command } from '@oclif/core';

/** What a command's metadata cannot say: input on stdin, the way to run it without a prompt. */
export const COMMAND_NOTES: Record<string, Record<string, unknown>> = {
  'auth login': { non_interactive: 'cloudcart auth login --store mystore.cloudcart.com --token cc_pat_xxx' },
  'app execute': { stdin: true },
  'app validate': { stdin: true },
  'nitrogen init': { prompts: "the project's name when not given, and the store's domain" },
  'nitrogen deploy': {
    token:
      "CLOUDCART_NOVA_TOKEN (in .env or the environment) or --token: the storefront's deployment token, made in the admin on the storefront's Deployments tab, under Deployment tokens",
  },
};

/** The exit codes the commands return. */
export const EXIT_CODES = {
  0: 'success',
  1: 'failure, an answer with GraphQL errors included',
  2: 'usage error: an unknown flag, a missing argument, invalid variables, or a query that does not parse or validate',
  3: 'file not found (app execute and app validate --file)',
  4: 'authentication/permission denied (the store refused the token)',
  6: 'rate limited (retryable; retryAfterSeconds when the store names the wait)',
  7: 'the network, a timeout, or the store unavailable (502, 503, 504): retryable unless the document was a mutation',
};

type Loadable = Command.Loadable;

/** A command's text with oclif's placeholders filled in, as `--help` shows it. */
export function render(text: string, bin: string, id: string): string {
  return text.replaceAll('<%= config.bin %>', bin).replaceAll('<%= command.id %>', id);
}

/** A command's one-line description, if it has one. */
export function summary(command: Loadable, bin: string): string | undefined {
  const text = command.summary ?? command.description;
  return text ? render(text, bin, command.id.replaceAll(':', ' ')) : undefined;
}

/** One command as the CLI has it: its flags, arguments and examples, from oclif's own metadata. */
export function describeCommand(command: Loadable, bin: string): Record<string, unknown> {
  const id = command.id.replaceAll(':', ' ');
  const flags = Object.fromEntries(
    Object.entries(command.flags)
      .filter(([, flag]) => !flag.hidden)
      .map(([name, flag]) => [
        `--${name}${flag.char ? `, -${flag.char}` : ''}`,
        {
          type: flag.type === 'boolean' ? 'boolean' : 'value',
          description: flag.summary ?? flag.description,
          ...(flag.required ? { required: true } : {}),
          ...(flag.type === 'option' && flag.options ? { options: flag.options } : {}),
          ...(['string', 'number', 'boolean'].includes(typeof flag.default) && flag.default !== false ? { default: flag.default } : {}),
        },
      ]),
  );
  const args = Object.fromEntries(
    Object.entries(command.args).map(([name, arg]) => [name, { description: arg.description, ...(arg.required ? { required: true } : {}) }]),
  );
  const examples = (command.examples ?? []).map((example) => render(typeof example === 'string' ? example : example.command, bin, id));
  return {
    description: summary(command, bin),
    ...(Object.keys(args).length ? { args } : {}),
    ...(Object.keys(flags).length ? { flags } : {}),
    ...(examples.length ? { examples } : {}),
    ...COMMAND_NOTES[id],
  };
}

export default class Describe extends Command {
  static override description = 'Output CLI capabilities as machine-readable JSON (for AI assistants)';

  static override examples = [
    '<%= config.bin %> describe',
  ];

  static override flags = {};

  async run(): Promise<void> {
    // Every command the installed CLI has, the plugins' included, so the list cannot drift from the CLI (B-487).
    const commands = Object.fromEntries(
      this.config.commands
        .filter((command) => !command.hidden)
        .sort((a, b) => a.id.localeCompare(b.id))
        .map((command) => [command.id.replaceAll(':', ' '), describeCommand(command, this.config.bin)]),
    );

    console.log(
      JSON.stringify(
        {
          name: this.config.bin,
          version: this.config.version,
          description: "CloudCart Developer CLI — a store's GraphQL Admin API, and Nitrogen storefronts",
          auth: {
            env_vars: {
              CLOUDCART_CLI_TOKEN: 'Personal Access Token or JWT for non-interactive auth',
              CLOUDCART_CLI_STORE: 'Store URL (e.g., mystore.cloudcart.com)',
              CLOUDCART_NOVA_TOKEN: "A storefront's deployment token, for nitrogen deploy",
            },
            methods: [
              'token (CLOUDCART_CLI_TOKEN env var)',
              'pat (auth login --store <store> --token <pat>, no prompt)',
              'browser (auth login, interactive)',
            ],
            token_format: 'PATs start with cc_pat_, JWTs are standard Bearer tokens',
          },
          commands,
          ai_usage: {
            recommended_flags: ['--json', '--compact-output'],
            schema_discovery: 'cloudcart app schema --search <term> --compact',
            full_schema: 'cloudcart app schema --compact',
            validate_without_running:
              'cloudcart app validate --query <query> --json — for a document not run now; app execute needs no validation first, the store refuses an invalid document before running any of it',
            non_interactive_auth: 'Set CLOUDCART_CLI_TOKEN and CLOUDCART_CLI_STORE env vars',
            nitrogen_workflow: [
              'cloudcart nitrogen init <name>',
              'cloudcart nitrogen link --storefront <name>',
              'cloudcart nitrogen env pull',
              'cloudcart nitrogen dev',
              'cloudcart nitrogen build',
              'cloudcart nitrogen deploy',
            ],
          },
          exit_codes: EXIT_CODES,
        },
        null,
        2,
      ),
    );
  }
}
