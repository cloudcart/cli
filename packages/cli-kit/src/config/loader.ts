import { readFile } from 'node:fs/promises';
import { parse } from 'smol-toml';

export interface AppConfig {
  name: string;
  client_id?: string;
  application_url?: string;
  handle?: string;
  access_scopes?: {
    scopes: string[];
  };
  auth?: {
    redirect_urls: string[];
  };
  webhooks?: {
    api_version?: string;
    subscriptions?: Array<{
      topics: string[];
      uri: string;
    }>;
  };
  build?: {
    command?: string;
    dev_store_url?: string;
  };
  dev?: {
    command?: string;
    port?: number;
  };
}

export interface ThemeConfig {
  environments: Record<
    string,
    {
      store: string;
      theme_id?: string;
      live?: boolean;
      ignore?: string[];
    }
  >;
}

export async function loadAppConfig(path: string): Promise<AppConfig> {
  const content = await readFile(path, 'utf-8');
  return parse(content) as unknown as AppConfig;
}

export async function loadThemeConfig(path: string): Promise<ThemeConfig> {
  const content = await readFile(path, 'utf-8');
  return parse(content) as unknown as ThemeConfig;
}

export async function findConfigFile(
  dir: string,
  type: 'app' | 'theme',
): Promise<string | null> {
  const filename = type === 'app' ? 'cloudcart.app.toml' : 'cloudcart.theme.toml';
  const { existsSync } = await import('node:fs');
  const { join } = await import('node:path');
  const filePath = join(dir, filename);
  return existsSync(filePath) ? filePath : null;
}
