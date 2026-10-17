/** A storefront's variables as the admin API returns them: a secret's value masked. */
export interface StorefrontVariable {
  key: string;
  value: string;
  environment: string;
  isSecret: boolean;
  isSystem: boolean;
}

/** The environments a storefront's variables apply to. `all` is every deployment. */
export const ENVIRONMENTS = ['all', 'production', 'preview'] as const;
export type Environment = (typeof ENVIRONMENTS)[number];

export const STOREFRONT_VARIABLES_QUERY = `
  query StorefrontVariables($id: ID!) {
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
  }
`;

export const SET_VARIABLES_MUTATION = `
  mutation SetStorefrontVariables($id: ID!, $environment: NitrogenEnvironment!, $variables: [NitrogenEnvironmentVariableInput!]!) {
    batchSetNitrogenEnvironmentVariables(storefrontId: $id, environment: $environment, variables: $variables) {
      key
      environment
    }
  }
`;

/**
 * Keys a local `.env` holds that are never pushed: the session secret is this machine's (the deployed
 * storefront has its own), and the store's domain and private token are the platform's, which `env pull`
 * writes even when the storefront has no row for them.
 */
const LOCAL_ONLY: Record<string, string> = {
  SESSION_SECRET: "this machine's; the deployed storefront has its own",
  PUBLIC_STORE_DOMAIN: 'set by CloudCart',
  PRIVATE_STOREFRONT_API_TOKEN: 'set by CloudCart',
};

/** The variables a deployment of `environment` binds: `all` and its own; for `all`, every one. */
export function variablesFor(variables: StorefrontVariable[], environment: Environment): StorefrontVariable[] {
  return variables.filter((variable) => environment === 'all' || variable.environment === 'all' || variable.environment === environment);
}

export interface PushInput {
  key: string;
  value: string;
  isSecret: boolean;
}

export interface PushPlan {
  /** What the mutation sends. */
  send: PushInput[];
  /** Keys new to the environment. */
  added: string[];
  /** Keys whose value differs. */
  changed: string[];
  /** Secret keys: their values come back masked and cannot be compared, so they are sent again. */
  secrets: string[];
  /** How many keys the environment already binds with the same value. */
  unchanged: number;
  /** Keys not sent, with why. */
  skipped: Array<{ key: string; why: string }>;
  /** Custom keys the environment binds that the file does not have: kept, not deleted. */
  remoteOnly: string[];
}

/**
 * Compares a local `.env` with the custom variables a deployment of one environment binds: its own, over
 * those for `all`. A key whose value it already binds is not sent. A new key is a secret unless its name
 * starts with `PUBLIC_` (the starter's prefix for values the browser may see); an existing one keeps its flag.
 */
export function planPush(local: Record<string, string>, remote: StorefrontVariable[], environment: Environment): PushPlan {
  const system = new Set(remote.filter((variable) => variable.isSystem).map((variable) => variable.key));
  const custom = remote.filter((variable) => !variable.isSystem);
  // `all` first, so the environment's own replaces it.
  const current = new Map(
    [...custom.filter((variable) => variable.environment === 'all'), ...custom.filter((variable) => variable.environment === environment)].map(
      (variable) => [variable.key, variable],
    ),
  );
  const plan: PushPlan = { send: [], added: [], changed: [], secrets: [], unchanged: 0, skipped: [], remoteOnly: [] };
  const seen = new Set<string>();

  for (const [name, value] of Object.entries(local)) {
    // CloudCart keeps keys upper-cased.
    const key = name.trim().toUpperCase();
    seen.add(key);

    const why = LOCAL_ONLY[key] ?? (system.has(key) ? 'set by CloudCart' : value === '' ? 'empty' : undefined);
    if (why) {
      plan.skipped.push({ key, why });
      continue;
    }

    const existing = current.get(key);
    if (!existing) {
      plan.added.push(key);
      plan.send.push({ key, value, isSecret: !key.startsWith('PUBLIC_') });
    } else if (existing.isSecret) {
      plan.secrets.push(key);
      plan.send.push({ key, value, isSecret: true });
    } else if (existing.value !== value) {
      plan.changed.push(key);
      plan.send.push({ key, value, isSecret: false });
    } else {
      plan.unchanged += 1;
    }
  }

  plan.remoteOnly = [...current.keys()].filter((key) => !seen.has(key));
  return plan;
}
