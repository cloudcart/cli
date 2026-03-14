import { getStoreCredentials, getCurrentStore, type StoreCredentials } from './token-store.js';
import { GraphQLClient } from '../api/graphql-client.js';
import { AdminAPI } from '../api/admin-api.js';
import { formatStoreUrl } from '../output/format.js';

export interface Session {
  storeUrl: string;
  credentials: StoreCredentials;
  /** How the session was resolved */
  source: 'env' | 'keychain' | 'config' | 'interactive';
}

export interface GetSessionOptions {
  /** Override store URL */
  storeUrl?: string;
  /** If true, prompt user to log in interactively when no credentials found (default: false) */
  autoPrompt?: boolean;
}

/**
 * Resolve a session. Priority order:
 * 1. CLOUDCART_CLI_TOKEN env var (+ CLOUDCART_CLI_STORE for store URL)
 * 2. OS keychain / config file credentials
 * 3. Interactive login prompt (if autoPrompt is true)
 */
export async function getSession(storeUrlOrOptions?: string | GetSessionOptions): Promise<Session> {
  const options: GetSessionOptions =
    typeof storeUrlOrOptions === 'string'
      ? { storeUrl: storeUrlOrOptions }
      : storeUrlOrOptions ?? {};

  // 1. Check environment variable
  const envToken = process.env.CLOUDCART_CLI_TOKEN;
  if (envToken) {
    const envStore =
      options.storeUrl ??
      process.env.CLOUDCART_CLI_STORE ??
      (await getCurrentStore());

    if (!envStore) {
      throw new Error(
        'CLOUDCART_CLI_TOKEN is set but no store URL found. ' +
        'Set CLOUDCART_CLI_STORE or run `cloudcart auth login` first.',
      );
    }

    const normalizedStore = formatStoreUrl(envStore);
    return {
      storeUrl: normalizedStore,
      credentials: {
        token: envToken.trim(),
        type: envToken.trim().startsWith('cc_pat_') ? 'pat' : 'jwt',
      },
      source: 'env',
    };
  }

  // 2. Check stored credentials (keychain + config file)
  const store = options.storeUrl ?? (await getCurrentStore());

  if (store) {
    const credentials = await getStoreCredentials(store);
    if (credentials) {
      return { storeUrl: store, credentials, source: 'keychain' };
    }
  }

  // 3. Auto-prompt interactive login
  if (options.autoPrompt && process.stdin.isTTY) {
    const { loginWithBrowser } = await import('./login.js');
    const { promptInput } = await import('../ui/prompt.js');
    const { logger } = await import('../output/logger.js');
    const { colors } = await import('../ui/colors.js');

    logger.warn('No active session found. Let\'s log you in.');
    console.log();

    const inputStore =
      store ?? formatStoreUrl(await promptInput('Store URL (e.g., mystore.cloudcart.com):'));

    if (!inputStore) {
      throw new Error('Store URL is required. Run `cloudcart auth login`.');
    }

    const storeUrl = formatStoreUrl(inputStore);

    logger.info(`Opening browser to log in to ${colors.bold(storeUrl)}...`);
    logger.info(colors.dim('Waiting for authentication (times out in 3 minutes)...'));
    console.log();

    const credentials = await loginWithBrowser({ storeUrl });

    logger.success('Authenticated successfully!');
    console.log();

    return { storeUrl, credentials, source: 'interactive' };
  }

  // No credentials and no auto-prompt
  if (!store) {
    throw new Error(
      'No store configured. Run `cloudcart auth login` to authenticate, ' +
      'or set CLOUDCART_CLI_TOKEN and CLOUDCART_CLI_STORE environment variables.',
    );
  }

  throw new Error(
    `No credentials found for ${store}. Run \`cloudcart auth login\` to authenticate, ` +
    'or set CLOUDCART_CLI_TOKEN environment variable.',
  );
}

export function createAdminAPI(session: Session): AdminAPI {
  return new AdminAPI({
    storeUrl: `https://${session.storeUrl}`,
    token: session.credentials.token,
  });
}

export function createGraphQLClient(session: Session): GraphQLClient {
  return new GraphQLClient({
    storeUrl: `https://${session.storeUrl}`,
    token: session.credentials.token,
  });
}
