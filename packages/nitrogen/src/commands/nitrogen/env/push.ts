import { Command, Flags } from '@oclif/core';
import { resolve } from 'node:path';
import { existsSync } from 'node:fs';
import { logger, colors, printBanner, getSession, createGraphQLClient, promptConfirm } from '@cloudcart/cli-kit';
import { resolveProjectRoot, readProjectConfig, loadEnvFile } from '../../../lib/project.js';
import {
  ENVIRONMENTS,
  SET_VARIABLES_MUTATION,
  STOREFRONT_VARIABLES_QUERY,
  planPush,
  type Environment,
  type StorefrontVariable,
} from '../../../lib/storefront-env.js';

interface StorefrontVariablesResponse {
  nitrogenStorefront: { id: string; name: string; environmentVariables: StorefrontVariable[] } | null;
}

interface SetVariablesResponse {
  batchSetNitrogenEnvironmentVariables: Array<{ key: string; environment: string }> | null;
}

export default class NitrogenEnvPush extends Command {
  static override description =
    "Push the custom variables of a local .env to the linked storefront on CloudCart, for one environment. Shows what changes and asks first; deletes nothing";

  static override examples = [
    '<%= config.bin %> nitrogen env push',
    '<%= config.bin %> nitrogen env push --env preview',
    '<%= config.bin %> nitrogen env push --env-file .env.production --force',
  ];

  static override flags = {
    path: Flags.string({ description: 'Path to the Nitrogen storefront root', default: '.' }),
    env: Flags.string({ description: 'The environment the variables apply to', options: [...ENVIRONMENTS], default: 'production' }),
    'env-file': Flags.string({ description: 'Source .env file path', default: '.env' }),
    force: Flags.boolean({ char: 'f', description: 'Push without asking', default: false }),
  };

  async run(): Promise<void> {
    const { flags } = await this.parse(NitrogenEnvPush);
    const root = resolveProjectRoot(flags.path);

    printBanner();

    const config = readProjectConfig(root);
    if (!config.store || !config.storefrontId) {
      logger.error('No store linked. Run `cloudcart nitrogen link` first.');
      this.exit(1);
    }

    const envFilePath = resolve(root, flags['env-file']);
    if (!existsSync(envFilePath)) {
      logger.error(`${flags['env-file']} not found.`);
      this.exit(1);
    }

    const storeName = config.store as string;
    const environment = flags.env as Environment;
    const session = await getSession({ storeUrl: storeName });
    const gql = createGraphQLClient(session);

    const result = await gql.query<StorefrontVariablesResponse>(STOREFRONT_VARIABLES_QUERY, { id: config.storefrontId });
    const storefront = result.data?.nitrogenStorefront;
    if (!storefront) {
      const reason = result.errors?.map((error) => error.message).join('; ');
      logger.error(reason ? `Could not read the storefront: ${reason}` : 'Storefront not found. It may have been deleted. Run `cloudcart nitrogen link --force` again.');
      this.exit(1);
    }

    const plan = planPush(loadEnvFile(envFilePath), storefront.environmentVariables ?? [], environment);

    // Keys only: values include secrets.
    console.log();
    for (const key of plan.added) console.log(`  ${colors.success('+')} ${key}`);
    for (const key of plan.changed) console.log(`  ${colors.warning('~')} ${key}`);
    for (const key of plan.secrets) console.log(`  ${colors.warning('~')} ${key} ${colors.dim("(secret: its value can't be compared, sent again)")}`);
    for (const { key, why } of plan.skipped) console.log(`  ${colors.dim(`- ${key} (not sent: ${why})`)}`);
    if (plan.unchanged > 0) console.log(`  ${colors.dim(`${plan.unchanged} unchanged`)}`);
    if (plan.remoteOnly.length > 0) {
      console.log(`  ${colors.dim(`On CloudCart, not in ${flags['env-file']} (kept): ${plan.remoteOnly.join(', ')}`)}`);
    }
    console.log();

    if (plan.send.length === 0) {
      logger.success(`Nothing to push: "${environment}" on ${storeName} already has these values.`);
      return;
    }

    const target = `"${environment}" of ${storefront.name} on ${storeName}`;
    if (!flags.force) {
      if (!(process.stdin.isTTY && process.stdout.isTTY)) {
        logger.error(`Nothing pushed: run again with --force to push ${plan.send.length} variables to ${target} without a question.`);
        this.exit(1);
      }
      if (!(await promptConfirm(`Push ${plan.send.length} variables to ${target}?`, false))) {
        logger.info('Nothing pushed.');
        return;
      }
    }

    const pushed = await gql.mutation<SetVariablesResponse>(SET_VARIABLES_MUTATION, {
      id: config.storefrontId,
      environment: environment.toUpperCase(),
      variables: plan.send,
    });
    const set = pushed.data?.batchSetNitrogenEnvironmentVariables;
    if (!set) {
      logger.error(`Nothing pushed: ${pushed.errors?.map((error) => error.message).join('; ') || 'CloudCart returned no variables.'}`);
      this.exit(1);
    }

    logger.success(`${set.length} variables set for ${target}. The next deploy of "${environment}" binds them: \`cloudcart nitrogen deploy\`.`);
  }
}
