import { Command, Flags } from '@oclif/core';
import { resolve } from 'node:path';
import { logger, colors, printBanner } from '@cloudcart/cli-kit';
import { resolveProjectRoot, validateProject, loadEnvFile, exec } from '../../lib/project.js';
import { runCodegen, runGraphqlCodegen, watchCodegen } from '../../lib/codegen.js';

export default class NitrogenDev extends Command {
  static override description = 'Start a Nitrogen storefront dev server';

  static override examples = [
    '<%= config.bin %> nitrogen dev',
    '<%= config.bin %> nitrogen dev --port 4000',
    '<%= config.bin %> nitrogen dev --path ./my-store',
  ];

  static override flags = {
    port: Flags.integer({ char: 'p', description: 'Port to run the dev server on', default: 3000 }),
    host: Flags.boolean({ description: 'Expose dev server to the network', default: false }),
    path: Flags.string({ description: 'Path to the Nitrogen storefront root', default: '.' }),
    'env-file': Flags.string({ description: 'Path to .env file', default: '.env' }),
    codegen: Flags.boolean({
      description: 'Generate the GraphQL query types and the route types before starting, and the GraphQL types again whenever a query changes',
      default: false,
    }),
  };

  async run(): Promise<void> {
    const { flags } = await this.parse(NitrogenDev);
    const root = resolveProjectRoot(flags.path);
    validateProject(root);

    printBanner();
    const envVars = loadEnvFile(resolve(root, flags['env-file']));

    logger.info(`Starting Nitrogen dev server in ${colors.bold(root)}...`);

    // React Router's dev server keeps the route types current itself; the GraphQL types follow the queries here.
    let codegenWatch: { close(): void } | undefined;
    if (flags.codegen) {
      logger.info('Generating the GraphQL query types and the route types...');
      try {
        await runCodegen(root, envVars);
      } catch (error) {
        // The server still starts: the next change to a query runs the codegen again.
        logger.error((error as Error).message);
      }
      codegenWatch = watchCodegen(root, () => runGraphqlCodegen(root, envVars), (error) => logger.error(error.message));
      logger.info('The GraphQL query types follow your queries while the server runs.');
    }

    const args = ['react-router', 'dev', '--port', String(flags.port)];
    if (flags.host) args.push('--host');

    logger.info(`Dev server → ${colors.bold(`http://localhost:${flags.port}`)}`);
    console.log();

    try {
      await exec('npx', args, root, { ...envVars, PORT: String(flags.port) });
    } finally {
      codegenWatch?.close();
    }
  }
}
