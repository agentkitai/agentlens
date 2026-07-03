# Contributing to AgentLens

Thanks for your interest in contributing to AgentLens! This guide will get you from zero to a running dev environment in under 15 minutes.

## Prerequisites

| Tool | Version | Check |
|------|---------|-------|
| [Node.js](https://nodejs.org/) | 20+ | `node -v` |
| [pnpm](https://pnpm.io/) | 10+ | `pnpm -v` |
| [Python](https://python.org/) | 3.10+ (only for `python-sdk`) | `python3 --version` |

## Getting Started

```bash
# 1. Fork & clone
git clone https://github.com/<your-username>/agentlens.git
cd agentlens

# 2. Install dependencies
pnpm install

# 3. Build all packages
pnpm build

# 4. Start dev servers (server + dashboard with hot reload)
pnpm dev
```

The server starts at **http://localhost:3400** and the dashboard at **http://localhost:5173** (proxied to the server).

### Environment Setup

```bash
cp .env.example .env
# Edit .env with your settings — defaults work for local development
```

## Monorepo Structure

```
packages/
├── core/          Shared types, schemas & utilities (@agentkitai/agentlens-core)
├── server/        Hono API server + SQLite backend (@agentkitai/agentlens-server)
├── dashboard/     React + Vite web dashboard (@agentkitai/agentlens-dashboard)
├── cli/           Command-line interface (@agentkitai/agentlens-cli)
├── sdk/           TypeScript SDK (@agentkitai/agentlens-sdk)
├── python-sdk/    Python SDK + auto-instrumentation (agentlensai)
└── mcp/           MCP tool server (@agentkitai/agentlens-mcp)
```

## Development Workflow

### Branch Naming

Use descriptive prefixes:

- `feat/short-description` — new features
- `fix/short-description` — bug fixes
- `docs/short-description` — documentation
- `chore/short-description` — maintenance, deps, CI

### Dev Servers

```bash
# Full stack (server + dashboard)
pnpm dev

# Individual packages
pnpm --filter @agentkitai/agentlens-server dev
pnpm --filter @agentkitai/agentlens-dashboard dev
```

### Working on a Specific Package

Most changes only affect one or two packages. Build dependencies first:

```bash
# Build core (most packages depend on it)
pnpm --filter @agentkitai/agentlens-core build

# Then work on your target package
pnpm --filter @agentkitai/agentlens-server dev
```

## Testing

We use [Vitest](https://vitest.dev/) for all TypeScript packages.

```bash
# Run all tests
pnpm test

# Run tests for a specific package
pnpm --filter @agentkitai/agentlens-server test
pnpm --filter @agentkitai/agentlens-core test

# Watch mode
pnpm --filter @agentkitai/agentlens-server test -- --watch
```

### Python SDK Tests

```bash
cd packages/python-sdk
pip install -e ".[dev]"
pytest
```

## Code Style

- **ESLint** + **Prettier** — run `pnpm lint` to check, `pnpm lint --fix` to auto-fix
- **TypeScript strict mode** — enabled in all packages
- **No `any`** — use proper types or `unknown` with type guards
- Format on save is recommended — configure your editor for Prettier

```bash
# Check everything
pnpm lint
pnpm typecheck
```

## Commit Conventions

We follow [Conventional Commits](https://www.conventionalcommits.org/):

```
feat: add session export endpoint
fix: correct hash chain validation on empty sessions
docs: update API reference for v0.10
chore: bump vitest to 2.x
feat(dashboard): add cost sparkline to session list
fix(python-sdk): handle missing provider gracefully
```

**Types:** `feat` | `fix` | `docs` | `chore` | `refactor` | `test` | `ci`

**Scope** (optional): package name — `core`, `server`, `dashboard`, `cli`, `sdk`, `python-sdk`, `mcp`

## Pull Request Process

1. **Branch** off `main` with proper naming (see above)
2. **Commit** with conventional commit messages
3. **Push** and open a PR against `main`
4. **Fill in** the PR template — describe what and why
5. **CI must pass** — lint, typecheck, tests
6. **Review** — at least one approval required
7. **Merge** — squash merge preferred for clean history

### PR Checklist

- [ ] Tests added/updated for new functionality
- [ ] `pnpm typecheck` passes
- [ ] `pnpm lint` passes
- [ ] `pnpm test` passes
- [ ] Documentation updated if applicable

## Release Process

Releases are handled by maintainers:

### npm Packages

```bash
# Bump versions (follows semver)
pnpm changeset        # describe your changes
pnpm changeset version # apply version bumps
pnpm build
pnpm publish -r       # publish all changed packages
```

### Python SDK (PyPI)

```bash
cd packages/python-sdk
# Update version in pyproject.toml
python -m build
twine upload dist/*
```

## Getting Help

- **Issues** — [github.com/amitpaz/agentlens/issues](https://github.com/amitpaz/agentlens/issues)
- **Discussions** — open an issue tagged `question`

---

Thank you for contributing! 🔍
