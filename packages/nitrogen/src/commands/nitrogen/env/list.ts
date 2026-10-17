import { Command, Flags } from '@oclif/core';
import { logger, colors, printBanner, getSession, createGraphQLClient } from '@cloudcart/cli-kit';
import { resolveProjectRoot, readProjectConfig } from '../../../lib/project.js';
import { ENVIRONMENTS, STOREFRONT_VARIABLES_QUERY, variablesFor, type StorefrontVariable } from '../../../lib/storefront-env.js';

interface StorefrontVariablesResponse {
  nitrogenStorefront: { id: string; name: string; environmentVariables: StorefrontVariable[] } | null;
}

export default class NitrogenEnvList extends Command {
  static override description = "List the linked storefront's environment variables on CloudCart; secrets masked";

  static override examples = [
    '<%= config.bin %> nitrogen env list',
    '<%= config.bin %> nitrogen env list --env production',
  ];

  static override flags = {
    path: Flags.string({ description: 'Path to the Nitrogen storefront root', default: '.' }),
    env: Flags.string({ description: 'The variables a deployment of this environment binds (all lists every one)', options: [...ENVIRONMENTS], default: 'all' }),
  };

  async run(): Promise<void> {
    const { flags } = await this.parse(NitrogenEnvList);
    const root = resolveProjectRoot(flags.path);

    printBanner();

    const config = readProjectConfig(root);
    if (!config.store || !config.storefrontId) {
      logger.error('No store linked. Run `cloudcart nitrogen link` first.');
      this.exit(1);
    }

    const storeName = config.store as string;
    const session = await getSession({ storeUrl: storeName });
    const result = await createGraphQLClient(session).query<StorefrontVariablesResponse>(STOREFRONT_VARIABLES_QUERY, {
      id: config.storefrontId,
    });

    const storefront = result.data?.nitrogenStorefront;
    if (!storefront) {
      const reason = result.errors?.map((error) => error.message).join('; ');
      logger.error(reason ? `Could not read the storefront: ${reason}` : 'Storefront not found. It may have been deleted. Run `cloudcart nitrogen link --force` again.');
      this.exit(1);
    }

    const environment = flags.env as (typeof ENVIRONMENTS)[number];
    const variables = variablesFor(storefront.environmentVariables ?? [], environment).sort(
      (a, b) => Number(b.isSystem) - Number(a.isSystem) || a.key.localeCompare(b.key) || a.environment.localeCompare(b.environment),
    );

    logger.info(`Variables of ${colors.bold(storefront.name)} on ${colors.bold(storeName)} (${environment}):\n`);
    if (variables.length === 0) {
      console.log('  None.\n');
      return;
    }

    const width = Math.max(...variables.map((variable) => variable.key.length));
    for (const variable of variables) {
      const kind = [variable.isSystem ? 'system' : 'custom', variable.isSecret ? 'secret' : ''].filter(Boolean).join(', ');
      // CloudCart masks a secret's value; the CLI never prints one either.
      const value = variable.isSecret ? '••••' : variable.value;
      console.log(`  ${variable.key.padEnd(width)}  ${variable.environment.padEnd(10)}  ${value}  ${colors.dim(kind)}`);
    }
    console.log();
  }
}
