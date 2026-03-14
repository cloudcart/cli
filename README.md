<p align="center">
  <img src="https://assets.cloudcart.com/gate/dist/images/logo.svg" alt="CloudCart" width="300" />
</p>

<h1 align="center">CloudCart CLI</h1>

<p align="center">
  <strong>AI-first developer CLI for managing CloudCart e-commerce stores via the GraphQL Admin API.</strong>
</p>

<p align="center">
  <a href="https://www.npmjs.com/package/@cloudcart/cli"><img src="https://img.shields.io/npm/v/@cloudcart/cli.svg" alt="npm version"></a>
  <a href="https://www.npmjs.com/package/@cloudcart/cli"><img src="https://img.shields.io/npm/dm/@cloudcart/cli.svg" alt="npm downloads"></a>
  <a href="https://github.com/cloudcart/cli/actions/workflows/ci.yml"><img src="https://github.com/cloudcart/cli/actions/workflows/ci.yml/badge.svg" alt="CloudCart CLI"></a>
  <a href="https://github.com/cloudcart/cli/blob/main/LICENSE"><img src="https://img.shields.io/badge/License-MIT-green.svg" alt="License: MIT"></a>
  <img src="https://img.shields.io/badge/Node.js-≥20-339933?logo=node.js&logoColor=white" alt="Node.js">
  <img src="https://img.shields.io/badge/TypeScript-5.7-3178C6?logo=typescript&logoColor=white" alt="TypeScript">
  <a href="https://github.com/cloudcart/cli/issues"><img src="https://img.shields.io/badge/PRs-welcome-brightgreen.svg" alt="PRs Welcome"></a>
</p>

---

CloudCart CLI lets you **query, explore, and manage** your CloudCart store directly from the terminal. Built with an **AI-first design** — every command supports structured output (`--json`, `--compact-output`), and built-in commands like `describe` and `llms-context` give AI assistants full context to operate your store autonomously.

## Features

- **GraphQL Execution** — Run queries and mutations inline, from files, or piped via stdin
- **Schema Explorer** — Search types and fields without loading the full schema (`--search`, `--compact`)
- **Query Validation** — Catch typos and invalid fields before executing
- **Authentication** — PAT (`cc_pat_*`) and JWT support with macOS Keychain storage
- **AI-First Design** — Structured output, self-describing commands, and LLM context built in
- **Monorepo Architecture** — Extensible package structure for apps, themes, and more

## Install

### Homebrew

```bash
brew tap cloudcart/tap
brew install cloudcart
```

### npm / pnpm / yarn / bun

```bash
npm install -g @cloudcart/cli@latest
pnpm add -g @cloudcart/cli@latest
yarn global add @cloudcart/cli@latest
bun add -g @cloudcart/cli@latest
```

### From source

Requires [Node.js](https://nodejs.org/) v20+ and [pnpm](https://pnpm.io/) v9+.

```bash
git clone https://github.com/cloudcart/cli.git
cd cli
pnpm install
pnpm build
```

## Authenticate

```bash
# Option 1: Environment variables (recommended for CI/AI agents)
export CLOUDCART_CLI_TOKEN=cc_pat_your_token
export CLOUDCART_CLI_STORE=mystore.cloudcart.com

# Option 2: Interactive login
cloudcart auth login
```

## What You Can Do

### Query your store

```bash
# Get store info
cloudcart app execute --query '{ shop { name } }' --json

# List products
cloudcart app execute --query '{ products(first: 5) { edges { node { id title price_from } } } }' --compact-output

# Run mutations with variables
cloudcart app execute \
  --query 'mutation($input: CreateProductInput!) { createProduct(input: $input) { id } }' \
  --variables '{"input": {"name": "T-Shirt", "price_from": 29.99}}' \
  --json

# Execute from file
cloudcart app execute --file query.graphql --variables vars.json --json

# Pipe from stdin
echo '{ shop { name } }' | cloudcart app execute --compact-output
```

### Explore the API schema

```bash
# Search for types and fields (saves tokens vs full schema)
cloudcart app schema --search product --compact
cloudcart app schema --search order --compact

# List all mutations or queries
cloudcart app schema --mutations-only --compact
cloudcart app schema --queries-only --compact

# Full schema
cloudcart app schema --compact
```

### Validate before executing

```bash
# Catch field name typos before they hit the API
cloudcart app validate --query '{ products { edges { node { titl } } } }' --json
# => {"valid": false, "errors": [{"message": "Cannot query field 'titl'..."}]}
```

### AI assistant integration

```bash
# Get full CLI description as JSON (for tool discovery)
cloudcart describe

# Get markdown context for AI assistants
cloudcart llms-context
```

## Commands

| Command | Description |
|---------|-------------|
| `cloudcart auth login` | Authenticate with PAT or JWT |
| `cloudcart auth logout` | Clear stored credentials |
| `cloudcart auth status` | Show current auth state |
| `cloudcart app execute` | Run GraphQL queries and mutations |
| `cloudcart app schema` | Explore the Admin API schema |
| `cloudcart app validate` | Validate GraphQL queries |
| `cloudcart describe` | Machine-readable JSON self-description |
| `cloudcart llms-context` | AI assistant context in markdown |

## AI-First Design

CloudCart CLI is designed to be operated by AI assistants as effectively as by humans:

1. **Discover** — `cloudcart app schema --search <topic> --compact` finds relevant types without loading the full schema
2. **Validate** — `cloudcart app validate --query '<query>' --json` catches errors before execution
3. **Execute** — `cloudcart app execute --query '<query>' --json` returns structured, parseable output
4. **Self-describe** — `cloudcart describe` and `cloudcart llms-context` give AI agents full operational context

Every command supports `--json` for structured output and meaningful exit codes for error handling.

## Architecture

```
packages/
  cli/          # @cloudcart/cli — Command definitions (oclif)
  cli-kit/      # @cloudcart/cli-kit — Auth, API client, UI, error handling
  app/          # @cloudcart/app — App commands (execute, schema, validate)
  theme/        # @cloudcart/theme — Theme commands (coming soon)
```

## Contributing

```bash
# Development
pnpm install
pnpm build
pnpm test        # 93 tests across all packages
pnpm dev         # Watch mode
```

## Help

- [Report a bug](https://github.com/cloudcart/cli/issues/new)
- [Request a feature](https://github.com/cloudcart/cli/issues/new)
- [CloudCart Documentation](https://cloudcart.com)

## License

[MIT](LICENSE) — Copyright (c) 2026 CloudCart
