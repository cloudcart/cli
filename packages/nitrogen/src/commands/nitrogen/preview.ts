import { Command, Flags } from '@oclif/core';
import { resolve } from 'node:path';
import { logger, colors, printBanner } from '@cloudcart/cli-kit';
import { resolveProjectRoot, validateProject, loadEnvFile, exec } from '../../lib/project.js';

export default class NitrogenPreview extends Command {
  static override description = 'Preview a Nitrogen storefront production build locally';

  static override examples = [
    '<%= config.bin %> nitrogen preview',
    '<%= config.bin %> nitrogen preview --build',
    '<%= config.bin %> nitrogen preview --port 4000',
  ];

  static override flags = {
    port: Flags.integer({ char: 'p', description: 'Port to run the preview server on', default: 3000 }),
    path: Flags.string({ description: 'Path to the Nitrogen storefront root', default: '.' }),
    build: Flags.boolean({ description: 'Run a production build before previewing', default: false }),
    'env-file': Flags.string({ description: 'Path to .env file', default: '.env' }),
  };

  async run(): Promise<void> {
    const { flags } = await this.parse(NitrogenPreview);
    const root = resolveProjectRoot(flags.path);
    validateProject(root);

    printBanner();
    const envVars = loadEnvFile(resolve(root, flags['env-file']));

    if (flags.build) {
      logger.info('Building before preview...');
      await exec('npx', ['react-router', 'build'], root, { ...envVars, NODE_ENV: 'production' });
      console.log();
    }

    logger.info(`Starting preview server → ${colors.bold(`http://localhost:${flags.port}`)}`);
    console.log();

    await exec('npx', ['vite', 'preview', '--port', String(flags.port)], root, {
      ...envVars, NODE_ENV: 'production',
    });
  }
}
