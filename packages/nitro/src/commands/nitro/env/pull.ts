import { Command, Flags } from '@oclif/core';
import { resolve } from 'node:path';
import { existsSync, writeFileSync } from 'node:fs';
import { logger, colors, printBanner, getSession, createGraphQLClient } from '@cloudcart/cli-kit';
import { resolveProjectRoot, readProjectConfig } from '../../../lib/project.js';

interface EnvVar {
  key: string;
  value: string;
  environment: string;
  isSecret: boolean;
  isSystem: boolean;
}

interface StorefrontEnvResponse {
  nitroStorefront: {
    id: string;
    name: string;
    novaHostname: string | null;
    publicToken: string | null;
    environmentVariables: EnvVar[];
  } | null;
}

const STOREFRONT_ENV_QUERY = `
  query StorefrontEnv($id: ID!) {
    nitroStorefront(id: $id) {
      id
      name
      novaHostname
      publicToken
      environmentVariables {
        key
        value
        environment
        isSecret
        isSystem
      }
    }
  }
`;

export default class NitroEnvPull extends Command {
  static override description = 'Pull environment variables from a linked CloudCart store';

  static override examples = [
    '<%= config.bin %> nitro env pull',
    '<%= config.bin %> nitro env pull --env production',
    '<%= config.bin %> nitro env pull --force',
  ];

  static override flags = {
    path: Flags.string({ description: 'Path to the Nitro storefront root', default: '.' }),
    env: Flags.string({ description: 'Environment to pull (production, preview, all)', default: 'all' }),
    'env-file': Flags.string({ description: 'Output .env file path', default: '.env' }),
    force: Flags.boolean({ description: 'Overwrite existing .env file', default: false }),
  };

  async run(): Promise<void> {
    const { flags } = await this.parse(NitroEnvPull);
    const root = resolveProjectRoot(flags.path);

    printBanner();

    const config = readProjectConfig(root);
    if (!config.store || !config.storefrontId) {
      logger.error('No store linked. Run `cloudcart nitro link` first.');
      this.exit(1);
    }

    const envFilePath = resolve(root, flags['env-file']);
    if (existsSync(envFilePath) && !flags.force) {
      logger.warn(`${flags['env-file']} already exists. Use --force to overwrite.`);
      return;
    }

    const storeName = config.store as string;
    const storefrontId = config.storefrontId as string;

    logger.info(`Pulling environment variables from ${colors.bold(storeName)}...`);

    // Authenticate and query
    const session = await getSession({ storeUrl: storeName });
    const gql = createGraphQLClient(session);

    const result = await gql.query<StorefrontEnvResponse>(STOREFRONT_ENV_QUERY, { id: storefrontId });
    const storefront = result.data?.nitroStorefront;

    if (!storefront) {
      logger.error(`Storefront not found. It may have been deleted. Run \`cloudcart nitro link\` again.`);
      this.exit(1);
    }

    const envVars: EnvVar[] = storefront.environmentVariables ?? [];

    // Filter by environment
    const targetEnv = flags.env;
    const filtered = envVars.filter(v => {
      if (targetEnv === 'all') return true;
      return v.environment === 'all' || v.environment === targetEnv;
    });

    // Build .env content
    const lines: string[] = [
      `# CloudCart Nitro — Environment Variables`,
      `# Store: ${storeName}`,
      `# Storefront: ${storefront.name}`,
      `# Environment: ${targetEnv}`,
      `# Pulled at: ${new Date().toISOString()}`,
      '',
    ];

    // System variables first
    const systemVars = filtered.filter(v => v.isSystem);
    const customVars = filtered.filter(v => !v.isSystem);

    if (systemVars.length > 0) {
      lines.push('# ── System Variables ──');
      for (const v of systemVars) {
        if (v.isSecret) {
          lines.push(`# ${v.key}=******** (secret — set manually)`);
        } else {
          lines.push(`${v.key}="${v.value}"`);
        }
      }
      lines.push('');
    }

    // Always include PUBLIC_STORE_DOMAIN
    if (!systemVars.some(v => v.key === 'PUBLIC_STORE_DOMAIN')) {
      lines.push(`PUBLIC_STORE_DOMAIN="${storeName}"`);
    }

    // Session secret placeholder if not present
    if (!filtered.some(v => v.key === 'SESSION_SECRET')) {
      lines.push(`SESSION_SECRET="${this.generateSecret()}"`);
    }

    if (customVars.length > 0) {
      lines.push('');
      lines.push('# ── Custom Variables ──');
      for (const v of customVars) {
        if (v.isSecret) {
          lines.push(`# ${v.key}=******** (secret — set manually)`);
        } else {
          lines.push(`${v.key}="${v.value}"`);
        }
      }
    }

    lines.push('');

    writeFileSync(envFilePath, lines.join('\n'));

    const totalVars = filtered.length;
    const secretVars = filtered.filter(v => v.isSecret).length;
    logger.success(`${totalVars} variables written to ${flags['env-file']}`);

    if (secretVars > 0) {
      logger.warn(`${secretVars} secret variable(s) are masked. Set them manually in your .env file.`);
    }
  }

  private generateSecret(): string {
    const bytes = new Uint8Array(24);
    crypto.getRandomValues(bytes);
    return Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('');
  }
}
