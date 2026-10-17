import type { StoreConnection } from './new-project.js';

/**
 * The store a new project shows before it is linked: CloudCart's demo store. Its public Storefront API token
 * is published here on purpose (Q-74): it reaches no more than the store's own open `/api/sf`, and it
 * belongs to a storefront made only for this, never deployed, so it can be replaced without stopping a live
 * one. The secret scan lets this one value through by its hash.
 */
export const DEMO_STORE: StoreConnection = {
  domain: 'bigrelease.com',
  publicToken: 'H5K4tzRVIacFQZXrN5JPP7wKlYPuKZxdeTVKZXrF2CP2XqEqNlORB1kYXA5HK7LQ',
};
