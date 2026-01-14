# CLAUDE.md - Avault Project Guidelines

This file provides guidance for Claude Code when working on the Avault codebase.

## Project Overview

Avault is a self-hosted NAS-to-cloud backup tool, built as a TypeScript monorepo.

### Architecture

```
avault/
├── apps/
│   ├── backend/       # Hono API server (port 4000)
│   ├── frontend/      # React/Vite SPA (port 3000)
│   └── worker/        # BullMQ backup processor
├── packages/
│   ├── shared/        # Prisma ORM, Zod schemas, types, Redis
│   └── storage/       # Cloud storage adapters
├── docker/            # Dockerfiles
└── .github/           # CI/CD workflows
```

## Quick Commands

```bash
# Development
pnpm install              # Install dependencies
pnpm dev                  # Start all dev servers (turbo)
pnpm build                # Build all packages
pnpm test                 # Run tests
pnpm test:watch           # Run tests in watch mode
pnpm lint                 # Run ESLint
pnpm format               # Format with Prettier
pnpm format:check         # Check formatting

# Database
pnpm db:generate          # Generate Prisma client
pnpm db:push              # Push schema to database
pnpm db:studio            # Open Prisma Studio

# Individual apps
pnpm --filter @avault/backend dev
pnpm --filter @avault/frontend dev
pnpm --filter @avault/worker dev

# Docker
docker compose up -d      # Start all services
docker compose down       # Stop all services
docker compose logs -f    # View logs
```

## Tech Stack

- **Runtime**: Node.js >= 20
- **Package Manager**: pnpm 9.15.0 with workspaces
- **Build System**: Turbo
- **Language**: TypeScript 5.7+
- **Backend**: Hono (fast, lightweight web framework)
- **Frontend**: React 19, Vite, TanStack Router, shadcn/ui, Tailwind CSS
- **Database**: PostgreSQL 16 with Prisma ORM
- **Queue**: Redis 7 with BullMQ
- **Testing**: Vitest

## Code Style Guidelines

### General

- Use TypeScript strict mode
- Prefer `const` over `let`, never use `var`
- Use async/await over raw Promises
- Use early returns to reduce nesting
- Destructure objects and arrays when possible

### Naming Conventions

- **Files**: kebab-case (`backup-job.ts`, `use-auth.ts`)
- **Components**: PascalCase (`BackupJobCard.tsx`)
- **Functions/Variables**: camelCase
- **Constants**: SCREAMING_SNAKE_CASE
- **Types/Interfaces**: PascalCase with descriptive names

### TypeScript

- Always define return types for functions
- Use Zod schemas for runtime validation
- Export types from `@avault/shared`
- Avoid `any`, use `unknown` if type is truly unknown

### Backend (Hono)

- Use Zod validator middleware for request validation
- Return consistent JSON responses: `{ success: boolean, data?: T, error?: string }`
- Handle errors with try/catch, log with pino

### Frontend (React)

- Use functional components with hooks
- Prefer composition over inheritance
- Use TanStack Router for type-safe routing
- Use shadcn/ui components (in `src/components/ui/`)
- Keep components small and focused

### Database (Prisma)

- Schema in `packages/shared/prisma/schema.prisma`
- Use migrations for production schema changes
- Always include relevant indexes
- Use transactions for multi-step operations

### Worker (BullMQ)

- Jobs should be idempotent
- Implement graceful shutdown
- Use job progress reporting
- Handle errors and implement retry logic

## Important Files

- `/package.json` - Root workspace config
- `/turbo.json` - Turbo build pipeline
- `/pnpm-workspace.yaml` - Workspace packages
- `/packages/shared/prisma/schema.prisma` - Database schema
- `/apps/backend/src/index.ts` - API entry point
- `/apps/worker/src/index.ts` - Worker entry point
- `/apps/frontend/src/main.tsx` - Frontend entry point

## Environment Variables

Required variables (see `.env.example`):

- `DATABASE_URL` - PostgreSQL connection string
- `REDIS_HOST`, `REDIS_PORT` - Redis connection
- `ENCRYPTION_KEY` - AES-256 key for credential encryption (generate with `openssl rand -hex 32`)
- `JWT_SECRET` - JWT signing secret
- `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` - OAuth credentials

## Testing

- Tests located alongside source files or in `__tests__/` directories
- Use `describe`, `it`, `expect` from Vitest
- Mock external services (Redis, Prisma)
- Run `pnpm test:coverage` for coverage report

## Git Workflow

### Branch Strategy

- **Never commit directly to `main`** - always use feature/fix branches
- Branch naming: `feat/description`, `fix/description`, `chore/description`
- Create PR to `main` for review before merging

### Before Committing

**ALWAYS run these checks before committing:**

```bash
pnpm lint          # Must pass with no errors
pnpm test          # Must pass all tests
pnpm build         # Must build successfully
```

If any check fails, fix the issues before committing.

### Commit Guidelines

- Use conventional commits: `feat:`, `fix:`, `chore:`, `docs:`
- Keep commits focused and atomic
- Tag releases with semver: `v1.0.0`

### Pull Request Guidelines

- **PR Title**: Use shortened conventional commit message as title
  - Example: `fix: enforce strict TypeScript and resolve all build/lint issues`
  - Format: `<type>: <short description>`
- **PR Body**: Include detailed summary with sections explaining changes
- Include test plan and verification results
- Reference any related issues

## Security Considerations

- Never commit `.env` files
- Credentials encrypted with AES-256-GCM before storage
- Use parameterized queries (Prisma handles this)
- Validate all user input with Zod
- NAS mounts should be read-only in containers

## Release Process

1. Create release branch from develop: `git checkout -b release/vX.Y.Z`
2. Run `./scripts/bump-version.sh [major|minor|patch]`
3. Edit CHANGELOG.md - move items from [Unreleased] to new version
4. Commit: `git commit -m "chore: prepare release vX.Y.Z"`
5. Merge to main, tag, push
6. GitHub Actions will build and push Docker images
