import { Command, Flags, Args } from '@oclif/core';
import { existsSync, mkdirSync, rmSync } from 'node:fs';
import { resolve } from 'node:path';
import { logger, colors, printNitrogenBanner, promptInput, promptSelect, printGradientBar, printInfoBox, printStep } from '@cloudcart/cli-kit';
import { exec } from '../../lib/project.js';
import { packageName, prepareProject, unsupportedNode, type PackageManager, type StoreConnection } from '../../lib/new-project.js';
import { STARTER_REPOSITORY, unpackStarter, type StarterSource } from '../../lib/starter.js';

const MOCK_STORE = 'Mock store (demo data)';
const CONNECT_STORE = 'Connect to a CloudCart store';

export default class NitrogenInit extends Command {
  static override description = 'Create a new Nitrogen storefront project from the CloudCart starter';

  static override examples = [
    '<%= config.bin %> nitrogen init my-store',
    '<%= config.bin %> nitrogen init my-store --quickstart',
    '<%= config.bin %> nitrogen init my-store --template ../my-starter',
  ];

  static override args = {
    name: Args.string({ description: 'Project directory name' }),
  };

  static override flags = {
    quickstart: Flags.boolean({
      description: 'Use defaults (mock store, npm)',
      default: false,
    }),
    'package-manager': Flags.string({
      description: 'Package manager to use',
      options: ['npm', 'pnpm', 'yarn'],
    }),
    template: Flags.string({
      description: `A local git repository to create the project from, instead of the published starter (${STARTER_REPOSITORY}); its last commit is used`,
    }),
    'no-install': Flags.boolean({ description: 'Skip dependency installation', default: false }),
    'no-git': Flags.boolean({ description: 'Skip git initialization', default: false }),
  };

  async run(): Promise<void> {
    const { args, flags } = await this.parse(NitrogenInit);

    printNitrogenBanner();

    // ── Interactive prompts (skipped with --quickstart) ──

    const isQuickstart = flags.quickstart;

    // Project name
    let projectName = args.name;
    if (!projectName && !isQuickstart) {
      projectName = await promptInput('Project name:');
    }
    projectName = projectName?.trim() || 'my-nitrogen-store';
    const projectPath = resolve(projectName);

    if (existsSync(projectPath)) {
      logger.error(`Directory "${projectName}" already exists.`);
      this.exit(1);
    }

    // Store connection
    const storeMode = isQuickstart ? MOCK_STORE : await promptSelect('Store:', [MOCK_STORE, CONNECT_STORE]);
    let store: StoreConnection | undefined;
    if (storeMode === CONNECT_STORE) {
      const domain = (await promptInput('Store domain (e.g., mystore.cloudcart.com):')).trim().replace(/^https?:\/\//, '').replace(/\/$/, '');
      if (domain) store = { domain };
    }

    // Package manager
    let pm = flags['package-manager'] as PackageManager | undefined;
    if (!pm && !isQuickstart) {
      pm = (await promptSelect('Package manager:', ['npm', 'pnpm', 'yarn'])) as PackageManager;
    }
    pm = pm || 'npm';

    const source: StarterSource = flags.template
      ? { kind: 'local', directory: resolve(flags.template) }
      : { kind: 'published' };

    // ── Summary ──

    printInfoBox('Configuration', [
      `Store:      ${colors.bold(store?.domain || storeMode)}`,
      `Package:    ${colors.bold(pm)}`,
      `Starter:    ${colors.bold(source.kind === 'local' ? source.directory : STARTER_REPOSITORY)}`,
      `Path:       ${colors.dim(projectPath)}`,
    ]);
    console.log();

    // ── The starter ──

    printStep(1, source.kind === 'local' ? 'Copying the starter ...' : 'Downloading the starter ...');
    printGradientBar();
    mkdirSync(projectPath, { recursive: true });
    try {
      await unpackStarter(source, projectPath);
      prepareProject(projectPath, { name: packageName(projectPath), packageManager: pm, store });
    } catch (error) {
      // The folder is this run's own, made empty a moment ago: nothing of the developer's is in it.
      rmSync(projectPath, { recursive: true, force: true });
      logger.error((error as Error).message);
      this.exit(1);
    }
    console.log();

    const nodeRange = unsupportedNode(projectPath);
    if (nodeRange) {
      logger.warn(`The starter needs Node.js ${nodeRange}; this is ${process.version}. Switch before installing or running it.`);
      console.log();
    }

    // ── Git ──

    let step = 2;
    if (!flags['no-git']) {
      printStep(step++, 'Initializing git ...');
      await exec('git', ['init', '-q'], projectPath);
      console.log();
    }

    // ── Install ──

    let installed = false;
    if (!flags['no-install']) {
      printStep(step++, 'Installing dependencies. This could take a few minutes ...');
      printGradientBar();
      try {
        await exec(pm, ['install'], projectPath);
        installed = true;
      } catch (error) {
        logger.error(`The install failed (${(error as Error).message}). The project is in ${projectName}: fix the cause, then run \`${pm} install\` there.`);
        this.exit(1);
      }
      console.log();
    }

    // ── Next steps ──

    printGradientBar();
    console.log();
    logger.success(`Created ${colors.bold(projectName)} from the ${source.kind === 'local' ? 'local' : 'published'} starter.`);
    console.log();

    printInfoBox('Next steps', [
      colors.bold(`cd ${projectName}`),
      ...(installed ? [] : [colors.bold(`${pm} install`)]),
      // Without a public token the project reaches no store until it is linked and its variables pulled.
      ...(!store?.publicToken
        ? [
            '',
            colors.dim('Link the project to your storefront and pull its variables:'),
            colors.bold('cloudcart nitrogen link'),
            colors.bold('cloudcart nitrogen env pull'),
          ]
        : []),
      '',
      colors.bold('cloudcart nitrogen dev'),
    ]);
    console.log();
  }
}
