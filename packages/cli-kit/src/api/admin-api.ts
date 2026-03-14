import { GraphQLClient, type GraphQLClientOptions } from './graphql-client.js';
import { RestClient } from './rest-client.js';

export class AdminAPI {
  public graphql: GraphQLClient;
  public rest: RestClient;

  constructor(options: GraphQLClientOptions) {
    this.graphql = new GraphQLClient(options);
    this.rest = new RestClient({
      storeUrl: options.storeUrl,
      token: options.token,
    });
  }
}
