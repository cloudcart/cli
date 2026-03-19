import { Command, Flags } from '@oclif/core';
import { resolve } from 'node:path';
import { logger, colors, printBanner } from '@cloudcart/cli-kit';
import { resolveProjectRoot, validateProject, loadEnvFile, exec } from '../../lib/project.js';

export default class NitroDev extends Command {
  static override description = 'Start a Nitro storefront dev server';

  static override examples = [
    '<%= config.bin %> nitro dev',
    '<%= config.bin %> nitro dev --port 4000',
    '<%= config.bin %> nitro dev --path ./my-store',
  ];

  static override flags = {
    port: Flags.integer({ char: 'p', description: 'Port to run the dev server on', default: 3000 }),
    host: Flags.boolean({ description: 'Expose dev server to the network', default: false }),
    path: Flags.string({ description: 'Path to the Nitro storefront root', default: '.' }),
    'env-file': Flags.string({ description: 'Path to .env file', default: '.env' }),
    codegen: Flags.boolean({ description: 'Run type generation before starting', default: false }),
  };

  async run(): Promise<void> {
    const { flags } = await this.parse(NitroDev);
    const root = resolveProjectRoot(flags.path);
    validateProject(root);

    printBanner();
    const envVars = loadEnvFile(resolve(root, flags['env-file']));

    logger.info(`Starting Nitro dev server in ${colors.bold(root)}...`);

    if (flags.codegen) {
      logger.info('Running type generation...');
      await exec('npx', ['react-router', 'typegen'], root, envVars);
    }

    const args = ['react-router', 'dev', '--port', String(flags.port)];
    if (flags.host) args.push('--host');

    logger.info(`Dev server → ${colors.bold(`http://localhost:${flags.port}`)}`);
    console.log();

    await exec('npx', args, root, { ...envVars, PORT: String(flags.port) });
  }
}
