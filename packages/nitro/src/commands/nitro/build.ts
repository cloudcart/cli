import { Command, Flags } from '@oclif/core';
import { resolve } from 'node:path';
import { logger, printBanner } from '@cloudcart/cli-kit';
import { resolveProjectRoot, validateProject, loadEnvFile, exec } from '../../lib/project.js';

export default class NitroBuild extends Command {
  static override description = 'Build a Nitro storefront for production';

  static override examples = [
    '<%= config.bin %> nitro build',
    '<%= config.bin %> nitro build --codegen',
  ];

  static override flags = {
    path: Flags.string({ description: 'Path to the Nitro storefront root', default: '.' }),
    codegen: Flags.boolean({ description: 'Generate types before building', default: false }),
    sourcemap: Flags.boolean({ description: 'Generate source maps', default: false }),
    'env-file': Flags.string({ description: 'Path to .env file', default: '.env' }),
  };

  async run(): Promise<void> {
    const { flags } = await this.parse(NitroBuild);
    const root = resolveProjectRoot(flags.path);
    validateProject(root);

    printBanner();
    const envVars = loadEnvFile(resolve(root, flags['env-file']));

    if (flags.codegen) {
      logger.info('Generating types...');
      await exec('npx', ['react-router', 'typegen'], root, envVars);
    }

    logger.info('Building Nitro storefront for production...');
    console.log();

    await exec('npx', ['react-router', 'build'], root, {
      ...envVars,
      NODE_ENV: 'production',
      ...(flags.sourcemap ? { GENERATE_SOURCEMAP: 'true' } : {}),
    });

    console.log();
    logger.success('Build complete! Output in ./build');
  }
}
