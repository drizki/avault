# Avault

Backup your NAS or local folder to the cloud.

Avault is a modern, containerized backup solution that automates the process of backing up your local files to cloud storage providers like Google Drive, Amazon S3, and more.

## Features

- **Supported Storage Providers**: Google Drive, Google Cloud Storage, AWS S3, Cloudflare R2, DigitalOcean Spaces
- **Real-time Dashboard**: Live stats, system health, active backups, alerts, and streaming logs
- **Scheduled Backups**: 6 presets + custom cron expressions with next-run tracking
- **Smart Retention**: Keep N versions, retain for X days, or hybrid policies
- **Live Progress**: SSE-powered real-time tracking (files, bytes, speed, current file)
- **Parallel Uploads**: Configurable concurrency for faster backups
- **Stream-based**: Memory-efficient file handling for large datasets
- **Atomic Operations**: Temp folder renamed only after complete upload
- **Multi-user RBAC**: Admin and User roles with isolated data access
- **Secure**: AES-256-GCM encryption, OAuth 2.0, JWT auth, path traversal protection
- **Modern UI**: React 19, shadcn/ui, responsive design, dark mode ready
- **Containerized**: Docker Compose with pre-built multi-arch images (amd64/arm64)

## Quick Start (Docker)

The recommended way to run Avault is with Docker Compose using pre-built images.

### Prerequisites

- Docker and Docker Compose v2
- Google Cloud Console account (for Google Drive OAuth)
- NAS with SMB/CIFS shares mounted on host

### Installation

1. Clone the repository:

```bash
git clone https://github.com/drizki/avault.git
cd avault
```

2. Configure environment:

```bash
cp .env.example .env
```

3. Edit `.env` and set required values:

```bash
# Generate security keys
openssl rand -hex 32    # For ENCRYPTION_KEY
openssl rand -base64 32 # For JWT_SECRET

# Required values:
POSTGRES_PASSWORD=your-secure-password
ENCRYPTION_KEY=<generated-key>
JWT_SECRET=<generated-key>
GOOGLE_CLIENT_ID=<from-google-console>
GOOGLE_CLIENT_SECRET=<from-google-console>
```

4. Mount your NAS (if not already mounted):

```bash
sudo mkdir -p /mnt/nas
sudo mount -t cifs //nas.local/share /mnt/nas -o username=user,password=pass,vers=3.0,ro
```

5. Start the application:

```bash
docker compose up -d
```

6. Access the application at `http://localhost:3000`

### Docker Images

Pre-built images are available on GitHub Container Registry:

```bash
ghcr.io/drizki/avault-backend:latest
ghcr.io/drizki/avault-frontend:latest
ghcr.io/drizki/avault-worker:latest
```

Use a specific version for production:

```bash
AVAULT_VERSION=1.0.0 docker compose up -d
```

## Development Setup

For local development without Docker:

### Prerequisites

- Node.js 20+ and pnpm 9+
- PostgreSQL 16+
- Redis 7+

### Installation

1. Clone and install dependencies:

```bash
git clone https://github.com/drizki/avault.git
cd avault
pnpm install
```

2. Start infrastructure services:

```bash
docker compose up postgres redis -d
```

3. Configure environment:

```bash
cp .env.example .env
# Edit .env with your configuration

# For local development, uncomment DATABASE_URL:
# DATABASE_URL="postgresql://avault:your-password@localhost:5432/avault"
```

4. Set up the database:

```bash
pnpm db:generate
pnpm db:push
```

5. Start development servers:

```bash
pnpm dev  # Starts all services via Turbo
```

Or run each service individually:

```bash
# Terminal 1: Backend API (http://localhost:4000)
pnpm --filter @avault/backend dev

# Terminal 2: Frontend (http://localhost:3000)
pnpm --filter @avault/frontend dev

# Terminal 3: Worker
pnpm --filter @avault/worker dev
```

## Project Structure

```
avault/
├── apps/
│   ├── backend/       # Hono API server (port 4000)
│   ├── frontend/      # React SPA (port 3000)
│   └── worker/        # BullMQ backup worker
├── packages/
│   ├── shared/        # Prisma schema, Zod schemas, types
│   └── storage/       # Cloud storage adapters
├── docker/            # Dockerfiles and nginx config
├── scripts/           # Utility scripts
├── docs/              # Documentation
└── .github/           # CI/CD workflows
```

## Configuration

### Google OAuth Setup

1. Go to [Google Cloud Console](https://console.cloud.google.com/)
2. Create a new project or select existing
3. Enable **Google Drive API**
4. Create **OAuth 2.0 credentials** (Web application)
5. Add authorized redirect URI: `http://localhost:4000/api/auth/callback/google`
6. Copy **Client ID** and **Client Secret** to `.env`

### Environment Variables

See `.env.example` for all available configuration options. Key variables:

| Variable               | Description                                |
| ---------------------- | ------------------------------------------ |
| `AVAULT_VERSION`       | Docker image version tag (default: latest) |
| `POSTGRES_PASSWORD`    | PostgreSQL password (required)             |
| `ENCRYPTION_KEY`       | AES-256 encryption key for credentials     |
| `JWT_SECRET`           | JWT signing secret                         |
| `GOOGLE_CLIENT_ID`     | Google OAuth client ID                     |
| `GOOGLE_CLIENT_SECRET` | Google OAuth client secret                 |
| `NAS_MOUNT_PATH`       | Host path where NAS is mounted             |

### NAS Mount

Mount your NAS share on the Docker host:

```bash
# Example for TrueNAS Scale SMB share
sudo mkdir -p /mnt/nas
sudo mount -t cifs //truenas.local/your-share /mnt/nas \
  -o username=your-user,password=your-password,vers=3.0,ro
```

The NAS is mounted read-only inside containers for security.

## Usage

### 1. Connect Storage

1. Navigate to **Credentials** page
2. Click **Add Google Drive**
3. Authorize with Google
4. Select accessible Shared Drives

### 2. Create Backup Job

1. Go to **Backup Jobs** page
2. Click **New Job**
3. Configure:
   - **Name**: Descriptive job name
   - **Source Path**: Browse NAS folders
   - **Destination**: Select Shared Drive
   - **Schedule**: Cron expression (e.g., `0 2 * * *` for daily at 2 AM)
   - **Retention Policy**:
     - `VERSION_COUNT`: Keep last N backups
     - `DAYS`: Keep backups from last N days
     - `HYBRID`: Combine both policies
4. Save and enable job

### 3. Monitor Backups

- View real-time progress in **Backup Jobs** page
- Check execution history in **History** page
- See queue statistics and active jobs

## Tech Stack

### Backend

- **Hono** - Fast, lightweight web framework
- **Prisma** - Type-safe ORM with PostgreSQL
- **BullMQ** - Redis-based job queue
- **googleapis** - Google Drive API client

### Frontend

- **React 19** - Latest React with modern hooks
- **Vite** - Fast build tool
- **TanStack Router** - Type-safe routing
- **shadcn/ui** - Accessible UI components
- **Tailwind CSS** - Utility-first styling

### Infrastructure

- **Docker** - Containerized deployment
- **PostgreSQL 16** - Relational database
- **Redis 7** - Job queue and caching

## Commands

```bash
# Development
pnpm dev              # Start all dev servers
pnpm build            # Build all packages
pnpm test             # Run tests
pnpm lint             # Run ESLint
pnpm format           # Format with Prettier

# Database
pnpm db:generate      # Generate Prisma client
pnpm db:push          # Push schema to database
pnpm db:studio        # Open Prisma Studio

# Versioning
./scripts/bump-version.sh [major|minor|patch]
```

## CI/CD

The project uses GitHub Actions for continuous integration and deployment:

- **CI Workflow**: Runs on every push/PR - linting, testing, building
- **Release Workflow**: Triggered on version tags - builds and pushes Docker images
- **Dependabot**: Automated dependency updates

### Creating a Release

1. Create release branch:

   ```bash
   git checkout -b release/v1.0.0
   ./scripts/bump-version.sh minor
   ```

2. Update CHANGELOG.md with release notes

3. Merge to main and tag:

   ```bash
   git checkout main
   git merge release/v1.0.0
   git tag -a v1.0.0 -m "Release v1.0.0"
   git push origin main --tags
   ```

4. GitHub Actions automatically builds and pushes Docker images

## Security

- **Credentials**: Encrypted with AES-256-GCM before storing in database
- **Encryption Key**: Must be securely generated and backed up
- **OAuth Tokens**: Automatically refreshed, stored encrypted
- **NAS Access**: Read-only mounts in containers
- **Network**: Services isolated via Docker bridge network

**Important**: Back up your `ENCRYPTION_KEY` to a secure location. Loss of this key means all stored credentials become unrecoverable.

## Architecture

See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for detailed system design.

```
┌─────────────┐      ┌─────────────┐      ┌─────────────┐
│  Frontend   │─────>│   Backend   │─────>│   Worker    │
│  (React)    │<─────│   (Hono)    │      │  (BullMQ)   │
└─────────────┘ HTTP └─────────────┘      └─────────────┘
                          │ │                     │
                          │ └─────────────────────┤
                          v                       v
                    ┌────────────┐       ┌──────────────┐
                    │ PostgreSQL │       │    Redis     │
                    │  Database  │       │  Job Queue   │
                    └────────────┘       └──────────────┘
                                                │
                                                v
                                         ┌─────────────┐
                                         │   NAS       │
                                         │ (SMB Mount) │
                                         └─────────────┘
                                                │
                                                v
                                         ┌─────────────┐
                                         │    Cloud    │
                                         │   Storage   │
                                         └─────────────┘
```

## Contributing

1. Fork the repository
2. Create a feature branch from `develop`
3. Make your changes
4. Run `pnpm lint` and `pnpm test`
5. Submit a pull request

See [CHANGELOG.md](CHANGELOG.md) for version history.

## License

MIT License - see LICENSE file for details.

## Support

- **Issues**: [GitHub Issues](https://github.com/drizki/avault/issues)
- **Documentation**: [docs/](docs/)

## Why another backup tool?

I need it for my own use case.
