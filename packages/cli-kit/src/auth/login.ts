import { createServer } from 'node:http';
import { randomBytes } from 'node:crypto';
import { saveStoreCredentials, type StoreCredentials } from './token-store.js';
import { formatStoreUrl } from '../output/format.js';

export interface PATLoginOptions {
  token: string;
  storeUrl: string;
}

export interface BrowserLoginOptions {
  storeUrl: string;
}

function normalizeStoreUrl(url: string): string {
  return formatStoreUrl(url.trim());
}

export async function loginWithPAT(options: PATLoginOptions): Promise<StoreCredentials> {
  const token = options.token.trim();
  const storeUrl = normalizeStoreUrl(options.storeUrl);

  if (!token.startsWith('cc_pat_')) {
    throw new Error('Invalid token format. Personal Access Tokens should start with "cc_pat_".');
  }

  if (!storeUrl || storeUrl.includes(' ')) {
    throw new Error(`Invalid store URL: "${storeUrl}". Example: mystore.cloudcart.com`);
  }

  const url = `https://${storeUrl}/api/gql`;
  let response: Response;

  try {
    response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        query: '{ __typename }',
      }),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(
      `Could not connect to ${storeUrl}. Check that the store URL is correct and the store is reachable.\n  Details: ${message}`,
    );
  }

  if (response.status === 401 || response.status === 403) {
    throw new Error(
      'Invalid or expired token. Generate a new Personal Access Token from your CloudCart admin panel.',
    );
  }

  if (!response.ok) {
    throw new Error(
      `Store returned an error (HTTP ${response.status}). Check that ${storeUrl} is a valid CloudCart store.`,
    );
  }

  const credentials: StoreCredentials = {
    token,
    type: 'pat',
  };

  await saveStoreCredentials(storeUrl, credentials);

  return credentials;
}

export async function loginWithBrowser(options: BrowserLoginOptions): Promise<StoreCredentials> {
  const storeUrl = normalizeStoreUrl(options.storeUrl);

  if (!storeUrl || storeUrl.includes(' ')) {
    throw new Error(`Invalid store URL: "${storeUrl}". Example: mystore.cloudcart.com`);
  }

  const state = randomBytes(16).toString('hex');

  return new Promise((resolve, reject) => {
    const connections = new Set<import('node:net').Socket>();

    const server = createServer(async (req, res) => {
      try {
        const reqUrl = new URL(req.url ?? '/', `http://localhost`);

        if (reqUrl.pathname !== '/callback') {
          res.writeHead(404);
          res.end('Not found');
          return;
        }

        const token = reqUrl.searchParams.get('token');
        const returnedState = reqUrl.searchParams.get('state');
        const email = reqUrl.searchParams.get('email');

        if (returnedState !== state) {
          res.writeHead(400, { 'Content-Type': 'text/html; charset=utf-8' });
          res.end(authResultPage(false, 'Security mismatch. Please try again from your terminal.'));
          shutdownServer();
          reject(new Error('State mismatch — possible CSRF attack. Please try again.'));
          return;
        }

        if (!token) {
          res.writeHead(400, { 'Content-Type': 'text/html; charset=utf-8' });
          res.end(authResultPage(false, 'No token received. Please try again.'));
          shutdownServer();
          reject(new Error('No token received from the store.'));
          return;
        }

        const credentials: StoreCredentials = {
          token,
          type: 'jwt',
          email: email ?? undefined,
        };

        await saveStoreCredentials(storeUrl, credentials);

        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(authResultPage(true, 'You can close this window and return to your terminal.'), () => {
          shutdownServer();
          resolve(credentials);
        });
      } catch (error) {
        if (!(error instanceof Error && error.message.includes('State mismatch'))) {
          res.writeHead(500, { 'Content-Type': 'text/html; charset=utf-8' });
          res.end(authResultPage(false, 'Something went wrong. Please try again.'));
          shutdownServer();
          reject(error);
        }
      }
    });

    server.on('connection', (socket) => {
      connections.add(socket);
      socket.on('close', () => connections.delete(socket));
    });

    function shutdownServer() {
      server.close();
      for (const socket of connections) {
        socket.destroy();
      }
    }

    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      if (!address || typeof address === 'string') {
        server.close();
        reject(new Error('Failed to start local auth server.'));
        return;
      }

      const port = address.port;
      const loginUrl = `https://${storeUrl}/admin/cli-auth?port=${port}&state=${encodeURIComponent(state)}`;

      // Open browser
      import('node:child_process').then(({ exec }) => {
        const cmd =
          process.platform === 'darwin'
            ? `open "${loginUrl}"`
            : process.platform === 'win32'
              ? `start "" "${loginUrl}"`
              : `xdg-open "${loginUrl}"`;
        exec(cmd);
      });
    });

    // Timeout after 3 minutes
    const timeout = setTimeout(() => {
      shutdownServer();
      reject(new Error('Browser login timed out after 3 minutes. Please try again.'));
    }, 180_000);
    timeout.unref();
  });
}

function cloudCartLogo(color: string): string {
  return `<svg viewBox="0 0 200 37" width="140" height="26"><g><g><g><g><g><g><path fill="${color}" d="M141.648,14.904c3.074-1.307,4.887,1.64,4.887,1.64h5.123c0,0-0.835-6.451-8.941-6.451c0,0-8.098-0.192-8.564,9.632c0,0-0.932,10.563,8.756,11.221c0,0,7.82,0.096,8.751-6.641h-4.47c0,0-1.028,2.17-3.912,2.059c-3.424-0.127-3.818-3.786-3.818-3.786S138.574,16.221,141.648,14.904z"/><path fill="${color}" d="M164.186,10.747c-4.799-0.558-7.869,0.192-9.033,1.544c0,0-1.82,1.684-1.771,3.698c0,0,2.711,1.198,4.843,0c0,0,0.278-1.499,3.308-1.364c0,0,2.327-0.043,2.743,1.364c0,0,0.281,1.401-1.303,1.774c0,0-1.677,0.607-3.072,0.653c0,0-5.631,0.517-6.568,3.226c0,0-1.992,4.633,0.98,7.672c0,0,1.863,2.196,7.729,1.5c0,0,2-0.256,3.599-1.272c0.131-0.028,0.291-0.031,0.461-0.007c0.442,0.38,1.629,1.248,3.16,1.132V15.332C169.26,15.332,168.982,11.311,164.186,10.747z M160.752,26.824c-3.232,0.337-3.214-2.068-3.214-2.068c-0.313-2.291,2.864-2.77,2.864-2.77c1.934-0.484,3.947-1.231,3.947-1.231C165.154,26.716,160.752,26.824,160.752,26.824z"/><path fill="${color}" d="M180.111,11.305c-8.454,0.074-8.803,7.438-8.803,7.438v12.205h5.237V20.495c0.277-3.574,2.591-3.999,2.591-3.999l1.602-0.141c2.869-0.405,2.656-5.051,2.656-5.051H180.111L180.111,11.305z"/><path fill="${color}" d="M191.55,16.561c3.546-0.113,3.368-5.076,3.368-5.076h-5.656V2.602h-1.886c-2.38,0-3.074,3.295-3.074,3.295v11.994v10.032c0.345,3.364,3.074,3.015,3.074,3.015h6.005v-2.877c-0.422-1.265-1.747-1.054-1.747-1.054c-2.026-0.067-2.372-0.625-2.372-0.625v-9.837L191.55,16.561z"/></g><g><path fill="${color}" d="M55.498,14.921c3.074-1.313,4.894,1.632,4.894,1.632h5.123c0,0-0.843-6.451-8.941-6.451c0,0-8.106-0.188-8.567,9.633c0,0-0.935,10.57,8.753,11.225c0,0,7.825,0.094,8.753-6.643h-4.469c0,0-1.027,2.164-3.909,2.06c-3.428-0.133-3.821-3.788-3.821-3.788S52.429,16.229,55.498,14.921z"/><path fill="${color}" d="M67.332,5.377v25.582h5.212V8.561C72.544,8.561,72.544,5.468,67.332,5.377z"/><path fill="${color}" d="M83.417,10.43c-6.075,0-9.103,4.594-9.103,10.262c0,5.672,3.027,10.268,9.103,10.268c5.753,0,9.104-4.596,9.104-10.268C92.521,15.023,89.401,10.43,83.417,10.43z M83.417,26.307c-2.34,0-4.239-2.513-4.239-5.613c0-3.096,1.899-5.609,4.239-5.609c2.338,0,4.237,2.514,4.237,5.609C87.654,23.794,85.755,26.307,83.417,26.307z"/><path fill="${color}" d="M106.305,14.029c0,0,0.189,7.388,0,9.869c-0.188,2.479-3.584,2.803-3.584,2.803c-3.262-0.094-3.308-3.32-3.308-3.32v-12.39h-5.354v12.77c0.047,7.06,8.636,7.198,8.636,7.198c6.074-0.044,7.658-3.742,7.658-3.742c0.889-1.357,0.982-3.508,0.982-3.508V10.991h-1.258C106.907,10.898,106.305,14.029,106.305,14.029z"/><path fill="${color}" d="M131.759,24.584l0.156-23.73c0,0-3.676-1.883-4.793,3.799v7.916c-0.086,0.012-0.168,0.006-0.246,0c-0.481-0.868-1.813-2.465-5.053-2.385c-4.732,0.107-8.554,3.807-8.511,10.51c0,6.178,3.203,10.254,7.896,10.254c2.489,0,4.396-0.238,5.671-1.572c0.3-0.105,0.815-0.198,1.38,0.016c0.549,0.62,1.391,1.279,2.52,1.4c0.078,0.005,0.16,0.012,0.259,0.018c0.03,0,0.063,0.008,0.09,0.008l-0.004-0.008c0.201,0.008,0.452,0,0.791,0.008C131.838,29.465,131.759,26.781,131.759,24.584z M126.164,21.658c0,0.479-0.04,0.971-0.123,1.418c-0.359,1.746-1.818,2.965-3.602,2.965c-2.545,0-4.203-2.111-4.203-5.489c0-3.125,1.41-5.646,4.248-5.646c1.897,0,3.238,1.385,3.598,3.009c0.082,0.369,0.082,0.808,0.082,1.138V21.658z"/></g></g></g></g></g><path fill="#FF5050" d="M36.263,33.857c0,1.636-1.319,2.957-2.954,2.957H2.956C1.327,36.814,0,35.493,0,33.857V3.506c0-1.628,1.327-2.951,2.956-2.951h30.353c1.635,0,2.954,1.322,2.954,2.951V33.857z M21.8,19.266L21.8,19.266c0,0,3.276-3.276,3.292-3.298c1.5-1.5,3.935-1.5,5.436,0l3.051-3.05c-3.183-3.179-8.358-3.179-11.535,0c-0.025,0.021-8.503,8.503-8.503,8.503c-0.724,0.714-1.682,1.104-2.699,1.104c-1.025,0-1.989-0.397-2.717-1.125c-1.497-1.502-1.497-3.938,0-5.433c0.729-0.725,1.691-1.124,2.717-1.124c1.026,0,1.989,0.399,2.717,1.124l3.053-3.05c-1.541-1.539-3.592-2.395-5.77-2.395c-2.18,0-4.229,0.855-5.77,2.395c-3.178,3.18-3.178,8.352,0,11.535c1.541,1.54,3.59,2.389,5.77,2.389l0,0c2.153,0,4.182-0.83,5.716-2.339l0,0L21.8,19.266z M27.807,22.527c-1.025,0-1.988-0.4-2.717-1.129c-0.552-0.547-0.896-1.232-1.041-1.942l-3.305,3.303c0.346,0.604,0.779,1.171,1.295,1.693c1.542,1.54,3.591,2.389,5.768,2.389c2.182,0,4.23-0.849,5.771-2.389l-3.051-3.054C29.798,22.127,28.831,22.527,27.807,22.527z"/></g><path fill="${color}" d="M196.305,7.729c-2.179,0-3.688-1.511-3.688-3.761c0-2.252,1.552-3.782,3.688-3.782c2.139,0,3.695,1.529,3.695,3.782C200,6.218,198.452,7.729,196.305,7.729 M196.305,0.609c-1.752,0-3.152,1.211-3.152,3.346c0,2.139,1.394,3.327,3.152,3.327c1.764,0,3.168-1.199,3.168-3.327C199.473,1.831,198.066,0.609,196.305,0.609 M197.389,5.979l-1.244-1.793h-0.401v1.731h-0.722V1.729h1.264c0.874,0,1.459,0.446,1.459,1.227c0,0.596-0.321,0.992-0.846,1.148l1.199,1.707L197.389,5.979z M196.296,2.395h-0.554v1.229h0.51c0.479,0,0.771-0.194,0.771-0.616c0-0.426-0.258-0.625-0.728-0.625"/></g></svg>`;
}

function authResultPage(success: boolean, message: string): string {
  const title = success ? 'Authentication complete' : 'Authentication failed';
  const subtitle = success
    ? 'Your CLI session has been authorized. You can start using CloudCart CLI commands now.'
    : 'We could not complete the authentication. This may be due to an expired session or a network issue.';

  const statusIcon = success
    ? '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6L9 17l-5-5"/></svg>'
    : '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>';

  return `<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="color-scheme" content="light dark">
<title>CloudCart CLI</title>
<style>
  :root {
    --bg: #f4f4f5;
    --surface: #ffffff;
    --border: #e4e4e7;
    --text-1: #18181b;
    --text-2: #3f3f46;
    --text-3: #71717a;
    --text-4: #a1a1aa;
    --status-bg: ${success ? '#f0fdf4' : '#fef2f2'};
    --status-border: ${success ? '#bbf7d0' : '#fecaca'};
    --status-color: ${success ? '#15803d' : '#b91c1c'};
    --logo-text: #303C4A;
    --code-bg: #f4f4f5;
    --code-color: #52525b;
  }
  @media (prefers-color-scheme: dark) {
    :root {
      --bg: #09090b;
      --surface: #18181b;
      --border: #27272a;
      --text-1: #fafafa;
      --text-2: #d4d4d8;
      --text-3: #a1a1aa;
      --text-4: #52525b;
      --status-bg: ${success ? 'rgba(16,185,129,0.08)' : 'rgba(239,68,68,0.08)'};
      --status-border: ${success ? 'rgba(16,185,129,0.2)' : 'rgba(239,68,68,0.2)'};
      --status-color: ${success ? '#34d399' : '#f87171'};
      --logo-text: #d4d4d8;
      --code-bg: #27272a;
      --code-color: #a1a1aa;
    }
  }
  *, *::before, *::after { margin: 0; padding: 0; box-sizing: border-box; }
  body {
    font-family: -apple-system, BlinkMacSystemFont, 'Inter', 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;
    background: var(--bg);
    color: var(--text-1);
    display: flex;
    align-items: center;
    justify-content: center;
    min-height: 100vh;
    -webkit-font-smoothing: antialiased;
  }
  .page { width: 100%; max-width: 560px; padding: 24px; }
  .logo { margin-bottom: 40px; }
  .card {
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: 16px;
    padding: 48px;
  }
  .status-badge {
    display: inline-flex;
    align-items: center;
    gap: 8px;
    padding: 8px 16px;
    background: var(--status-bg);
    border: 1px solid var(--status-border);
    border-radius: 100px;
    color: var(--status-color);
    font-size: 13px;
    font-weight: 500;
    margin-bottom: 28px;
  }
  h1 {
    font-size: 24px;
    font-weight: 600;
    color: var(--text-1);
    margin-bottom: 12px;
    letter-spacing: -0.02em;
    line-height: 1.3;
  }
  .subtitle {
    font-size: 15px;
    line-height: 1.6;
    color: var(--text-2);
    margin-bottom: 32px;
  }
  .info-section {
    background: var(--bg);
    border: 1px solid var(--border);
    border-radius: 10px;
    padding: 20px 24px;
  }
  .info-row {
    display: flex;
    align-items: center;
    gap: 12px;
    font-size: 13px;
    color: var(--text-3);
  }
  .info-row svg { flex-shrink: 0; color: var(--text-4); }
  .footer {
    margin-top: 24px;
    text-align: center;
    font-size: 12px;
    color: var(--text-4);
  }
</style></head><body>
<div class="page">
  <div class="logo">${cloudCartLogo('var(--logo-text)')}</div>
  <div class="card">
    <div class="status-badge">${statusIcon} ${success ? 'Authorized' : 'Failed'}</div>
    <h1>${title}</h1>
    <p class="subtitle">${subtitle}</p>
    <div class="info-section">
      <div class="info-row">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="4" width="20" height="16" rx="2"/><path d="M7 15h0M2 9.5h20"/></svg>
        ${message}
      </div>
    </div>
  </div>
  <div class="footer">CloudCart Developer CLI</div>
</div>
</body></html>`;
}
