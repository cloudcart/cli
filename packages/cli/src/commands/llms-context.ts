import { Command } from '@oclif/core';
import { EXIT_CODES, summary } from './describe.js';

const CONTEXT = `# CloudCart CLI — AI Assistant Context

> CLI tool for managing CloudCart e-commerce stores via the GraphQL Admin API, and for building and deploying
> Nitrogen storefronts. This context helps AI assistants use the CLI effectively.

## Authentication

Set these environment variables for non-interactive auth:
- CLOUDCART_CLI_TOKEN: Your Personal Access Token (starts with cc_pat_) or JWT
- CLOUDCART_CLI_STORE: Store URL (e.g., mystore.cloudcart.com)

Or sign in once without a prompt: \`cloudcart auth login --store mystore.cloudcart.com --token cc_pat_xxx\`.

## Core Workflow

1. Discover the API: \`cloudcart app schema --search <topic> --compact\`
2. Validate your query: \`cloudcart app validate --query '<query>' --json\`
3. Execute: \`cloudcart app execute --query '<query>' --compact-output\`

## Commands

### Execute GraphQL
\`\`\`bash
# Inline query — prefer the flat \`nodes\` alternative and grouped sub-types
cloudcart app execute --query '{ products(first:5) { nodes { id name pricing { from to } flags { active } } totalCount } }' --json

# Pipe from stdin
echo '{ shop { name } }' | cloudcart app execute --compact-output

# With variables — INPUT fields are still snake_case (Lighthouse @rename remaps outputs only)
cloudcart app execute --query 'mutation($input: CreateProductInput!) { createProduct(input: $input) { id name } }' --variables '{"input":{"name":"T-Shirt","price_from":29.99}}' --json

# From file
cloudcart app execute --file query.graphql --json
\`\`\`

### Explore Schema
\`\`\`bash
# Search for types/fields (saves tokens vs full schema)
cloudcart app schema --search product --compact
cloudcart app schema --search order --compact

# Get all mutations
cloudcart app schema --mutations-only --compact

# Get all queries
cloudcart app schema --queries-only --compact

# Full schema (large, ~45K tokens)
cloudcart app schema --compact

# Type overview
cloudcart app schema --types-only
\`\`\`

### Validate Queries
\`\`\`bash
# Checks against the store's schema locally: the document is never sent, so a mutation is safe to check
cloudcart app validate --query '{ products { edges { node { titl } } } }' --json
# Returns: {"valid":false,"errors":[{"message":"Cannot query field 'titl'...","type":"graphql_validation_error"}]}
\`\`\`

### CLI Self-Description
\`\`\`bash
# Get all commands, flags, and examples as JSON
cloudcart describe
\`\`\`

## Nitrogen storefronts

A Nitrogen storefront is a React Router app on CloudCart's Storefront API, deployed to Nova (CloudCart Edge Hosting).
The storefront is made in the CloudCart admin first; the commands work in the project's folder.

1. \`cloudcart nitrogen init my-store\` — a new project from the CloudCart starter; asks for the store's domain (\`--package-manager\`, \`--no-install\`, \`--no-git\`)
2. \`cloudcart auth login --store mystore.cloudcart.com --token cc_pat_xxx\` — \`link\` and \`env\` use the Admin API sign-in
3. \`cloudcart nitrogen link --storefront <name>\` — links the project to the storefront (\`.cloudcart/project.json\`, no token in it)
4. \`cloudcart nitrogen env pull\` — writes the storefront's variables, its API tokens among them, to \`.env\` (mode 600); asks before overwriting unless \`--force\`
5. \`cloudcart nitrogen dev\` — the dev server on port 3000 (\`--port\`; \`--codegen\` keeps the \`#graphql\` query types current)
6. \`cloudcart nitrogen build\` — the production build (\`--codegen\`); \`cloudcart nitrogen preview\` serves it locally
7. \`cloudcart nitrogen deploy\` — builds and deploys to Nova (\`--preview\` for the preview environment, \`--no-build\`)

Deploying needs the storefront's deployment token in \`CLOUDCART_NOVA_TOKEN\` (in \`.env\` or the environment) or \`--token\`: it is made in the
admin on the storefront's Deployments tab, under Deployment tokens → Create token, and shown once. Without one, \`deploy\` prints the page's address.
The first deploy of an environment waits until its address answers, up to three minutes.

Also: \`nitrogen env list\` (the storefront's variables, secrets masked), \`nitrogen env push\` (the custom variables of \`.env\`; shows the
changes and asks first; deletes nothing), \`nitrogen generate route <name>\` and \`nitrogen generate routes\` (the starter's routes back into
the project; a route the project changed is kept unless \`--force\`).

- **Never print \`.env\` values** — they are the storefront's tokens and secrets; name the keys only
- **A deploy changes the live storefront** — run it when the developer asks for it

## Important Patterns

- **Always use --json or --compact-output** for machine-readable output
- **Search schema before querying** — use \`--search\` to find relevant types instead of loading the full schema
- **Validate before mutating** — use \`app validate\` to catch errors before executing mutations
- **Pagination** — Every manual Connection type exposes BOTH shapes. Prefer \`nodes\` when you don't need cursors (half the payload):
  \`\`\`graphql
  # Flat (preferred for most queries)
  categories(first: 10) { nodes { id name } totalCount }

  # Relay cursor form — for paginated navigation
  categories(first: 10) { edges { node { id name } cursor } pageInfo { hasNextPage endCursor } totalCount }
  # Next page:
  categories(first: 10, after: "endCursorValue") { nodes { id name } }
  \`\`\`
  NOTE: connections auto-generated by \`@paginate(type: CONNECTION)\` (e.g. \`ProductConnection\`) only expose \`edges\`/\`pageInfo\` — use the cursor form there.
- **Filtering** — many queries accept a \`query\` argument for text search: \`products(query: "t-shirt")\`

## Error Handling

Errors in --json mode include semantic types:
\`\`\`json
{
  "data": null,
  "errors": [{
    "type": "auth_required",
    "message": "Authentication failed",
    "retryable": false,
    "hint": "Run cloudcart auth login or set CLOUDCART_CLI_TOKEN"
  }]
}
\`\`\`

Error types: auth_required, network_error (retryable), rate_limited (retryable), validation_error, file_not_found, graphql_validation_error, unexpected_error

Exit codes:
${Object.entries(EXIT_CODES)
  .map(([code, meaning]) => `- ${code}: ${meaning}`)
  .join('\n')}

4, 6 and 7 come from the \`app\` commands; the others exit 1 on any failure.

## GraphQL API Notes

- **Field naming** — OUTPUT fields are camelCase (\`urlHandle\`, \`seoTitle\`, \`priceFrom\`). INPUT fields and mutation arguments are still snake_case (\`url_handle\`, \`seo_title\`, \`price_from\`). Keep this asymmetry in mind when writing mutations.
- **Connections / pagination** — manual connection types (\`CategoryConnection\`, \`OrderConnection\`, etc.) expose BOTH \`nodes: [T!]!\` (flat, preferred) AND \`edges { node cursor }\` (Relay cursor form). Every connection also has \`totalCount: Int!\` — don't dig into \`pageInfo { total }\`. Paginate via \`first\` + \`after\` (cursor-based).
- **Grouped sub-types** — the heavy types are split into purpose-scoped sub-groups instead of flat fields:
  - \`Product\`: \`pricing\`, \`seo\`, \`flags\`, \`inventory\`, \`parameters\`, \`timestamps\`
  - \`Order\`: \`buyer\`, \`amounts\`, \`statuses\`, \`documents\`, \`notes\`, \`flags\`, \`timestamps\`
  - \`Customer\`: \`contact\`, \`verification\`, \`marketingPrefs\`, \`status\`, \`defaults\`, \`timestamps\`
  - \`CartSettings\`: \`registration\`, \`limits\`, \`defaults\`, \`checkoutFields\`, \`maps\`, \`orders\`, \`abandoned\`, \`legal\`
- **Error payloads are lean** — validation errors return the \`message\` + \`path\` + \`locations\` fields. No PHP stack trace by default (set \`LIGHTHOUSE_DEBUG=3\` on the server to re-enable for local dev).
- Enums use UPPER_CASE at definition-time (e.g. \`ProductType: simple | multiple | digital | bundle\`).
- Boolean fields use the \`YesNo\` enum (\`yes\`/\`no\`) on domain models, not native Boolean.
- ID fields are numeric IDs (not GIDs).
- DateTime fields use \`Y-m-d H:i:s\` format (not ISO 8601) and \`Date\` fields use \`Y-m-d\`.
- The API supports both queries and mutations on the same \`/api/gql\` endpoint.
`;

export default class LlmsContext extends Command {
  static override description = 'Output context/instructions for AI assistants working with CloudCart CLI';

  static override examples = [
    '<%= config.bin %> llms-context',
  ];

  static override flags = {};

  async run(): Promise<void> {
    // Every command the installed CLI has, the plugins' included, so the list cannot drift from the CLI (B-487).
    const commands = this.config.commands
      .filter((command) => !command.hidden)
      .map((command) => {
        const text = summary(command, this.config.bin);
        return `- \`${this.config.bin} ${command.id.replaceAll(':', ' ')}\`${text ? ` — ${text}` : ''}`;
      })
      .sort();
    console.log(`${CONTEXT.trim()}\n\n## All commands\n\n${commands.join('\n')}\n\nFlags and examples of each: \`${this.config.bin} describe\`.`);
  }
}
