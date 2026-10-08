import { Command, Flags } from '@oclif/core';
import { resolve } from 'node:path';
import { chmodSync, existsSync, writeFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { logger, colors, printBanner, getSession, createGraphQLClient, promptConfirm, type GraphQLClient, type GraphQLResponse } from '@cloudcart/cli-kit';
import { resolveProjectRoot, readProjectConfig, loadEnvFile } from '../../../lib/project.js';

interface EnvVar {
  key: string;
  value: string;
  environment: string;
  isSecret: boolean;
  isSystem: boolean;
}

interface PrivateToken {
  token: string | null;
  maskedToken: string | null;
}

interface StorefrontEnvResponse {
  nitrogenStorefront: {
    id: string;
    name: string;
    environmentVariables: EnvVar[];
  } | null;
  nitrogenStorefrontPrivateToken: PrivateToken | null;
}

interface RotateResponse {
  nitrogenStorefrontPrivateTokenRotate: PrivateToken | null;
}

const STOREFRONT_ENV_QUERY = `
  query StorefrontEnv($id: ID!) {
    nitrogenStorefront(id: $id) {
      id
      name
      environmentVariables {
        key
        value
        environment
        isSecret
        isSystem
      }
    }
    nitrogenStorefrontPrivateToken(id: $id) {
      token
      maskedToken
    }
  }
`;

const ROTATE_PRIVATE_TOKEN_MUTATION = `
  mutation StorefrontPrivateTokenRotate($id: ID!) {
    nitrogenStorefrontPrivateTokenRotate(id: $id) {
      token
      maskedToken
    }
  }
`;

/** The storefront's server token: CloudCart hands it out only through its own field, to an admin allowed to see it. */
const PRIVATE_TOKEN = 'PRIVATE_STOREFRONT_API_TOKEN';
/** Signs the storefront's session cookie. The deployed storefront's own never leaves CloudCart; locally, one of this machine's. */
const SESSION_SECRET = 'SESSION_SECRET';

/** One line of the .env file: a value, or a commented placeholder when there is none to write. */
type Entry = { key: string; value: string | null; note?: string };

export default class NitrogenEnvPull extends Command {
  static override description = 'Pull environment variables from the linked CloudCart storefront into .env';

  static override examples = [
    '<%= config.bin %> nitrogen env pull',
    '<%= config.bin %> nitrogen env pull --env production',
    '<%= config.bin %> nitrogen env pull --force',
  ];

  static override flags = {
    path: Flags.string({ description: 'Path to the Nitrogen storefront root', default: '.' }),
    env: Flags.string({ description: 'Environment to pull (production, preview, all)', default: 'all' }),
    'env-file': Flags.string({ description: 'Output .env file path', default: '.env' }),
    force: Flags.boolean({ char: 'f', description: 'Overwrite an existing .env file without confirmation', default: false }),
  };

  async run(): Promise<void> {
    const { flags } = await this.parse(NitrogenEnvPull);
    const root = resolveProjectRoot(flags.path);

    printBanner();

    const config = readProjectConfig(root);
    if (!config.store || !config.storefrontId) {
      logger.error('No store linked. Run `cloudcart nitrogen link` first.');
      this.exit(1);
    }

    const storeName = config.store as string;
    const storefrontId = config.storefrontId as string;
    const envFilePath = resolve(root, flags['env-file']);
    const fileExists = existsSync(envFilePath);
    const local = loadEnvFile(envFilePath);
    const interactive = Boolean(process.stdin.isTTY && process.stdout.isTTY);

    logger.info(`Pulling environment variables from ${colors.bold(storeName)}...`);

    const session = await getSession({ storeUrl: storeName });
    const gql = createGraphQLClient(session);

    const result = await gql.query<StorefrontEnvResponse>(STOREFRONT_ENV_QUERY, { id: storefrontId });
    const storefront = result.data?.nitrogenStorefront;

    if (!storefront) {
      logger.error('Storefront not found. It may have been deleted. Run `cloudcart nitrogen link --force` again.');
      this.exit(1);
    }

    const targetEnv = flags.env;
    const pulled = (storefront.environmentVariables ?? []).filter(
      (variable) => targetEnv === 'all' || variable.environment === 'all' || variable.environment === targetEnv,
    );

    // ── The private token ──
    const privateToken = await this.privateToken(gql, storefrontId, result, local[PRIVATE_TOKEN], interactive);

    // ── The file ──
    const system: Entry[] = [];
    const custom: Entry[] = [];

    for (const variable of pulled) {
      if (variable.key === SESSION_SECRET) continue;

      const entry: Entry =
        variable.key === PRIVATE_TOKEN
          ? privateToken
          : variable.isSecret
            ? this.secret(variable.key, local[variable.key])
            : { key: variable.key, value: variable.value };

      (variable.isSystem ? system : custom).push(entry);
    }

    if (!system.some((entry) => entry.key === PRIVATE_TOKEN)) system.push(privateToken);
    if (!system.some((entry) => entry.key === 'PUBLIC_STORE_DOMAIN')) system.push({ key: 'PUBLIC_STORE_DOMAIN', value: storeName });

    const sessionSecret: Entry = {
      key: SESSION_SECRET,
      value: local[SESSION_SECRET] || randomBytes(32).toString('hex'),
      note: 'Signs this machine\'s session cookie. The deployed storefront has its own, which never leaves CloudCart.',
    };

    const known = new Set([...system, ...custom, sessionSecret].map((entry) => entry.key));
    const localOnly: Entry[] = Object.entries(local)
      .filter(([key]) => !known.has(key))
      .map(([key, value]) => ({ key, value }));

    const lines = [
      '# CloudCart Nitrogen — environment variables',
      `# Store: ${storeName}`,
      `# Storefront: ${storefront.name}`,
      `# Environment: ${targetEnv}`,
      `# Pulled at: ${new Date().toISOString()}`,
      '',
      ...section('System variables', system),
      ...section('Local', [sessionSecret]),
      ...section('Custom variables', custom),
      ...section('Local only — not on CloudCart, kept from the previous file', localOnly),
    ];

    // ── What changes ──
    const next: Record<string, string> = {};
    for (const entry of [...system, sessionSecret, ...custom, ...localOnly]) {
      if (entry.value !== null) next[entry.key] = entry.value;
    }

    if (fileExists) {
      const changes = diff(local, next);
      if (changes.length === 0) {
        logger.success(`${flags['env-file']} is already up to date.`);
        return;
      }

      // Keys only: values include tokens.
      console.log();
      for (const change of changes) console.log(`  ${change}`);
      console.log();

      if (!flags.force) {
        if (!interactive) {
          logger.warn(`${flags['env-file']} already exists. Run again with --force to overwrite it.`);
          return;
        }
        if (!(await promptConfirm(`Write these changes to ${flags['env-file']}?`, true))) {
          logger.info('Nothing written.');
          return;
        }
      }
    }

    writeFileSync(envFilePath, lines.join('\n') + '\n', { mode: 0o600 });
    // The file holds the storefront's private token: readable by its owner only.
    chmodSync(envFilePath, 0o600);

    logger.success(`${Object.keys(next).length} variables written to ${flags['env-file']}`);

    const missing = [...system, ...custom].filter((entry) => entry.value === null).map((entry) => entry.key);
    if (missing.length > 0) {
      logger.warn(`Not written, set them in ${flags['env-file']} yourself: ${missing.join(', ')}`);
    }
  }

  /**
   * The storefront's private token, from CloudCart. When CloudCart no longer holds it (a storefront
   * created before tokens were kept), offers to issue a new one; otherwise keeps the one already in
   * the file, if any.
   */
  private async privateToken(
    gql: GraphQLClient,
    storefrontId: string,
    result: GraphQLResponse<StorefrontEnvResponse>,
    current: string | undefined,
    interactive: boolean,
  ): Promise<Entry> {
    const held = result.data?.nitrogenStorefrontPrivateToken;
    const keep = (note: string): Entry =>
      current ? { key: PRIVATE_TOKEN, value: current, note: `${note} Kept the one already in this file.` } : { key: PRIVATE_TOKEN, value: null, note };

    if (held?.token) {
      return { key: PRIVATE_TOKEN, value: held.token };
    }

    const refused = result.errors?.find((error) => error.path?.[0] === 'nitrogenStorefrontPrivateToken');
    if (!held && refused) {
      logger.warn(`Your account cannot see the storefront's private token: ${refused.message}`);
      return keep('Your account cannot see this token.');
    }

    logger.warn('CloudCart no longer holds this storefront\'s private token (it was created before tokens were kept).');

    if (!interactive) {
      logger.info('Run `cloudcart nitrogen env pull` in a terminal to issue a new one.');
      return keep('CloudCart no longer holds this token; run `cloudcart nitrogen env pull` in a terminal to issue a new one.');
    }

    logger.info('A new token replaces it: the current one stops working, so a deployment or server that uses it needs the new one (redeploy).');
    if (!(await promptConfirm('Issue a new private token now?', false))) {
      return keep('CloudCart no longer holds this token.');
    }

    const rotated = await gql.mutation<RotateResponse>(ROTATE_PRIVATE_TOKEN_MUTATION, { id: storefrontId });
    const token = rotated.data?.nitrogenStorefrontPrivateTokenRotate?.token;

    if (!token) {
      logger.error(`Could not issue a new private token: ${rotated.errors?.map((error) => error.message).join('; ') || 'no token returned'}`);
      return keep('Issuing a new token failed.');
    }

    logger.success('Issued a new private token. CloudCart keeps it for the storefront; deployments get it on their next deploy.');
    return { key: PRIVATE_TOKEN, value: token };
  }

  /** A secret CloudCart does not hand out: the value already in the file, or a placeholder. */
  private secret(key: string, current: string | undefined): Entry {
    const note = 'Secret: CloudCart does not hand it out.';
    return current ? { key, value: current, note: `${note} Kept the value already in this file.` } : { key, value: null, note: `${note} Set it yourself.` };
  }
}

function section(title: string, entries: Entry[]): string[] {
  if (entries.length === 0) return [];

  const lines = [`# ── ${title} ──`];
  for (const entry of entries) {
    if (entry.note) lines.push(`# ${entry.note}`);
    lines.push(entry.value === null ? `# ${entry.key}=` : `${entry.key}="${entry.value}"`);
  }
  lines.push('');

  return lines;
}

/** `+ KEY` added, `- KEY` removed, `~ KEY` changed — keys only. */
function diff(before: Record<string, string>, after: Record<string, string>): string[] {
  const changes: string[] = [];

  for (const key of Object.keys(after)) {
    if (!(key in before)) changes.push(colors.success(`+ ${key}`));
    else if (before[key] !== after[key]) changes.push(colors.warning(`~ ${key}`));
  }
  for (const key of Object.keys(before)) {
    if (!(key in after)) changes.push(colors.error(`- ${key}`));
  }

  return changes;
}
