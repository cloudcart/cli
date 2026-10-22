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

1. Discover the API: \`cloudcart app schema --search <topic> --compact\` (the schema is kept for an hour; \`--refresh\` reads it again)
2. Execute: \`cloudcart app execute --query '<query>' --compact-output\` — the store checks every document against its schema
   before it runs it and refuses an invalid one without running any of it, so there is no need to validate first
3. Validate only a document that is not run now — a mutation shown for confirmation, a query written into code:
   \`cloudcart app validate --query '<query>' --json\`

## Commands

### Execute GraphQL
\`\`\`bash
# Inline query — grouped sub-types (pricing, flags) keep it short; products are paged through edges
cloudcart app execute --query '{ products(first: 5) { edges { node { id name pricing { from to } flags { active } } } } }' --json

# Pipe from stdin
echo '{ generalSettings { siteName } }' | cloudcart app execute --compact-output

# With variables — INPUT fields are still snake_case (Lighthouse @rename remaps outputs only)
cloudcart app execute --query 'mutation($input: CreateProductInput!) { createProduct(input: $input) { id name } }' --variables '{"input":{"name":"T-Shirt","price":29.99}}' --json

# From file
cloudcart app execute --file query.graphql --json

# A heavy query: wait up to 180 s instead of the default 15 (1–600)
cloudcart app execute --file export.graphql --timeout 180 --json
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
# Checks against the store's schema locally: the document is never sent, so a mutation is safe to check.
# The schema kept from the last hour is used; a document it finds invalid is checked again against a fresh one.
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
- **No validate before execute** — the store refuses an invalid document before running any of it; \`app validate\` is for a document not run now
- **A mutation that timed out or failed with 502, 503 or 504 may have run** — its error says \`retryable: false\`: read the record before sending it again
- **Pagination** — check the list's connection first (see "Lists come in three shapes" below):
  \`\`\`graphql
  # Flat, where the connection has nodes (categories, vendors, pages)
  categories(first: 10) { nodes { id name } totalCount }

  # Cursor form: every cursor list has it, and products, orders and customers have only this one
  products(first: 10) { edges { node { id name } cursor } pageInfo { hasNextPage endCursor total } }
  # Next page:
  products(first: 10, after: "endCursorValue") { edges { node { id name } } }
  \`\`\`
- **Filtering** — many lists take a \`query\` argument for text search: \`products(query: "t-shirt")\`, \`orders\`, \`customers\`, \`categories\`

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

Error types: auth_required, network_error (retryable), timeout and server_unavailable (a 502, 503 or 504; both retryable for a query,
never for a mutation), rate_limited (retryable), http_error (any other refused answer, with the store's message), schema_unavailable,
validation_error, file_not_found, graphql_validation_error, unexpected_error. When the store names a wait (\`Retry-After\`), the error
carries it as \`retryAfterSeconds\`.

Exit codes:
${Object.entries(EXIT_CODES)
  .map(([code, meaning]) => `- ${code}: ${meaning}`)
  .join('\n')}

4, 6 and 7 come from the \`app\` commands; the others exit 1 on any failure.

## GraphQL API Notes

Checked against a store's schema on 2026-10-22; \`app schema --search <name> --compact\` shows any type or field as the store has it.
The schema is the same for every store: what a store's plan does not include is refused when it runs (see Errors).

- **Field naming** — output fields are camelCase (\`urlHandle\`, \`shortDescription\`), but a few older ones are snake_case
  (\`OrderHistory.order_id\`). Fields of input objects are mostly snake_case (\`CreateProductInput\`: \`url_handle\`,
  \`seo_title\`, \`price\`), some camelCase (\`CreateOrderReturnInput.orderId\`, the metafield inputs). The root fields'
  arguments are mostly camelCase, with exceptions: \`products(order_by, order_direction)\`, but \`categories(orderBy, orderDirection)\`.
  Read the names in the schema before writing a mutation.
- **Lists come in three shapes**:
  - \`nodes\` and \`edges\`, with \`totalCount\` — \`categories\`, \`vendors\`, \`pages\` and others;
  - \`edges\` and \`pageInfo\` only — \`products\`, \`orders\`, \`customers\`, \`productVariants\`, \`tags\` and others; the total is
    \`pageInfo { total }\`;
  - pages, not cursors — \`staffMembers\`, \`inventory\`, \`productOptions\`, \`managedFiles\`, \`favoriteProducts\`, \`missingProducts\`:
    \`(page: 1, perPage: 20) { data { id } total currentPage lastPage perPage }\`.

  Cursor lists page with \`first\` and \`after\`.
- **Grouped sub-types** — the heavy types are split into purpose-scoped sub-groups instead of flat fields:
  - \`Product\`: \`pricing\`, \`seo\`, \`flags\`, \`inventory\`, \`parameters\`, \`timestamps\` (so \`pricing { from to }\`, \`seo { title }\`)
  - \`Order\`: \`buyer\`, \`amounts\`, \`statuses\`, \`documents\`, \`notes\`, \`flags\`, \`timestamps\`
  - \`Customer\`: \`contact\`, \`verification\`, \`marketingPrefs\`, \`status\`, \`defaults\`, \`timestamps\`
  - \`CartSettings\`: \`registration\`, \`limits\`, \`defaults\`, \`checkoutFields\`, \`maps\`, \`orders\`, \`abandoned\`, \`legal\`
- **Errors** — each GraphQL error has \`message\`, \`locations\` and \`extensions.agentHint\`: \`reason\` (e.g. \`query_invalid\`),
  \`nextStep\` (what to do about it) and \`exposeToUser\` (whether the hint may be shown to the merchant). A plan's limit comes back
  as \`reason: plan_limit_reached\` with \`extensions.planLimit\` (\`feature\`, \`limit\`, \`used\`, \`remaining\`, \`purchaseUrl\`):
  tell the merchant; retrying does not help.
- **Enums** are written as the schema has them: many values are UPPER_CASE, but the store's own ones are lower case
  (\`ProductType\`: \`simple | multiple | digital | bundle\`; \`YesNo\`: \`yes | no\`).
- **Yes/no fields** — most are \`Boolean\`, but some older models use the \`YesNo\` enum: \`Product.flags\` (\`active\`, \`sale\`,
  \`new\`, …; \`featured\` is an \`Int\`) and inputs such as \`CreateProductInput.active\`. Check the field's type.
- **IDs** are numeric strings (\`"37429"\`), not global IDs.
- **Dates** — \`DateTime\` is \`Y-m-d H:i:s\` (\`2026-07-14 17:56:22\`), not ISO 8601, in the store's own time zone
  (\`generalSettings { timezone }\`) with no offset in the text; \`Date\` is \`Y-m-d\`.
- Queries and mutations go to the same endpoint, \`/api/gql\`.
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
