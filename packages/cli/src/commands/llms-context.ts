import { Command } from '@oclif/core';

const CONTEXT = `# CloudCart CLI — AI Assistant Context

> CLI tool for managing CloudCart e-commerce stores via the GraphQL Admin API.
> This context helps AI assistants use the CLI effectively.

## Authentication

Set these environment variables for non-interactive auth:
- CLOUDCART_CLI_TOKEN: Your Personal Access Token (starts with cc_pat_) or JWT
- CLOUDCART_CLI_STORE: Store URL (e.g., mystore.cloudcart.com)

## Core Workflow

1. Discover the API: \`cloudcart app schema --search <topic> --compact\`
2. Validate your query: \`cloudcart app validate --query '<query>' --json\`
3. Execute: \`cloudcart app execute --query '<query>' --compact-output\`

## Commands

### Execute GraphQL
\`\`\`bash
# Inline query
cloudcart app execute --query '{ products(first:5) { edges { node { id title price_from } } } }' --json

# Pipe from stdin
echo '{ shop { name } }' | cloudcart app execute --compact-output

# With variables
cloudcart app execute --query 'mutation($input: CreateProductInput!) { createProduct(input: $input) { id } }' --variables '{"input":{"name":"T-Shirt","price_from":29.99}}' --json

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
# Catches field name typos and invalid syntax before execution
cloudcart app validate --query '{ products { edges { node { titl } } } }' --json
# Returns: {"valid":false,"errors":[{"message":"Cannot query field 'titl'...","type":"graphql_validation_error"}]}
\`\`\`

### CLI Self-Description
\`\`\`bash
# Get all commands, flags, and examples as JSON
cloudcart describe
\`\`\`

## Important Patterns

- **Always use --json or --compact-output** for machine-readable output
- **Search schema before querying** — use \`--search\` to find relevant types instead of loading the full schema
- **Validate before mutating** — use \`app validate\` to catch errors before executing mutations
- **Pagination** — Relay-style connections with cursor pagination:
  \`\`\`graphql
  products(first: 10) { edges { node { id name } } pageInfo { hasNextPage endCursor total } }
  # Next page:
  products(first: 10, after: "endCursorValue") { edges { node { id name } } pageInfo { hasNextPage endCursor } }
  \`\`\`
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

Exit codes: 0=success, 1=general, 2=usage, 3=not_found, 4=auth, 5=conflict, 6=rate_limited, 7=network

## GraphQL API Notes

- The API uses Relay-style connections: \`edges { node { ... } }\` + \`pageInfo { hasNextPage endCursor total currentPage lastPage }\`
- Paginate with \`first\` + \`after\` (cursor-based)
- Enums use UPPER_CASE (e.g., ProductType: simple | multiple | digital | bundle)
- Boolean fields use YesNo enum (yes/no), not native Boolean, for domain fields
- ID fields are numeric IDs (not GIDs)
- DateTime fields use ISO 8601 format
- The API supports both queries and mutations on the same /api/gql endpoint
`;

export default class LlmsContext extends Command {
  static override description = 'Output context/instructions for AI assistants working with CloudCart CLI';

  static override examples = [
    '<%= config.bin %> llms-context',
  ];

  static override flags = {};

  async run(): Promise<void> {
    console.log(CONTEXT.trim());
  }
}
