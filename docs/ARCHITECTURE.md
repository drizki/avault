# Avault Architecture

This document provides a comprehensive overview of Avault's system architecture, design decisions, and implementation details.

## Table of Contents

1. [System Overview](#system-overview)
2. [Technology Stack](#technology-stack)
3. [Architecture Patterns](#architecture-patterns)
4. [Data Models](#data-models)
5. [Storage Abstraction](#storage-abstraction)
6. [Backup Execution Flow](#backup-execution-flow)
7. [Security Design](#security-design)
8. [API Specification](#api-specification)
9. [WebSocket Events](#websocket-events)
10. [Deployment](#deployment)
11. [CI/CD Pipeline](#cicd-pipeline)

---

## System Overview

Avault is a self-hosted tool that automatically backs up your NAS to cloud storage providers. The system emphasizes:

- **Reliability**: Job queue with retry logic, atomic operations
- **Security**: Encrypted credential storage, OAuth 2.0, read-only NAS access
- **Scalability**: Queue-based architecture, configurable worker concurrency
- **User Experience**: Real-time progress updates, intuitive web UI
- **Extensibility**: Storage provider abstraction for easy additions

### High-Level Architecture

```
┌──────────────────────────────────────────────────────────────────┐
│                         Client Layer                              │
│  ┌────────────────────────────────────────────────────────────┐  │
│  │  React 19 SPA (Port 3000)                                  │  │
│  │  - TanStack Router for routing                             │  │
│  │  - shadcn/ui components                                    │  │
│  │  - WebSocket client for real-time updates                 │  │
│  │  - Vite dev server proxies /api to backend                │  │
│  └────────────────────────────────────────────────────────────┘  │
└──────────────────────────────────────────────────────────────────┘
                              │ HTTP + WebSocket
                              ▼
┌──────────────────────────────────────────────────────────────────┐
│                      Application Layer                            │
│  ┌────────────────────────────────────────────────────────────┐  │
│  │  Hono API Server (Port 4000)                               │  │
│  │  - REST API endpoints                                      │  │
│  │  - WebSocket server (Socket.io alternative coming)        │  │
│  │  - OAuth 2.0 flow handler                                 │  │
│  │  - Job scheduler (node-cron)                              │  │
│  │  - Middleware: CORS, logging, Prisma injection            │  │
│  └────────────────────────────────────────────────────────────┘  │
└──────────────────────────────────────────────────────────────────┘
                     │                              │
                     │ Enqueue Jobs                 │ Read/Write
                     ▼                              ▼
┌─────────────────────────────────┐    ┌──────────────────────────┐
│     Job Queue Layer             │    │     Data Layer           │
│  ┌──────────────────────────┐   │    │  ┌────────────────────┐  │
│  │  Redis (Port 6379)       │   │    │  │  PostgreSQL DB   │  │
│  │  - BullMQ job queue      │   │    │  │  - Credentials     │  │
│  │  - Pub/sub for events    │   │    │  │  - Destinations    │  │
│  └──────────────────────────┘   │    │  │  - Backup jobs     │  │
└─────────────────────────────────┘    │  │  - History         │  │
                     │                  │  └────────────────────┘  │
                     │ Process Jobs     └──────────────────────────┘
                     ▼
┌──────────────────────────────────────────────────────────────────┐
│                       Worker Layer                                │
│  ┌────────────────────────────────────────────────────────────┐  │
│  │  BullMQ Worker (Configurable concurrency)                  │  │
│  │  - Backup executor                                         │  │
│  │  - Storage adapter manager                                 │  │
│  │  - Progress reporter (WebSocket events)                    │  │
│  │  - Retry logic with exponential backoff                    │  │
│  └────────────────────────────────────────────────────────────┘  │
└──────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌──────────────────────────────────────────────────────────────────┐
│                      Storage Layer                                │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐           │
│  │  NAS (SMB)   │  │ Google Drive │  │  Amazon S3   │  ...      │
│  │  (Read-only) │  │ (OAuth 2.0)  │  │ (IAM/Access) │           │
│  └──────────────┘  └──────────────┘  └──────────────┘           │
└──────────────────────────────────────────────────────────────────┘
```

---

## Technology Stack

### Backend (apps/backend)

| Technology | Purpose |
|------------|---------|
| **Hono** | Lightweight, fast web framework with excellent TypeScript support |
| **@hono/node-server** | Node.js adapter for Hono |
| **@hono/zod-validator** | Request validation with Zod schemas |
| **Prisma** | Type-safe ORM with SQLite database |
| **BullMQ** | Redis-based job queue (queue management in backend) |
| **node-cron** | Cron-based job scheduling |
| **googleapis** | Official Google Drive API client |
| **ioredis** | Redis client for Node.js |

### Worker (apps/worker)

| Technology | Purpose |
|------------|---------|
| **BullMQ** | Job processor with concurrency control |
| **Prisma** | Database access for status updates |
| **googleapis** | Google Drive file operations |
| **ioredis** | Redis connection for BullMQ |
| **Node.js Streams** | Memory-efficient file uploads |

### Frontend (apps/frontend)

| Technology | Purpose |
|------------|---------|
| **React 19** | UI library with latest features (use hook, etc.) |
| **Vite** | Fast build tool and dev server |
| **TanStack Router** | Type-safe routing with file-based routing |
| **shadcn/ui** | Accessible, customizable UI components |
| **Radix UI** | Headless UI primitives (via shadcn/ui) |
| **Tailwind CSS** | Utility-first styling |
| **Lucide React** | Icon library |
| **Geist Mono** | Monospace font for headings/decorative text |
| **Inter** | Sans-serif font for body/UI text |

### Shared (packages/shared)

| Technology | Purpose |
|------------|---------|
| **Prisma** | Database schema and client generator |
| **Zod** | Runtime validation schemas |
| **TypeScript** | Shared types and interfaces |

---

## Architecture Patterns

### 1. Monorepo Structure

Avault uses a pnpm workspace monorepo with Turbo for build caching:

- **Shared code**: Common schemas, types, and Prisma client in `packages/shared`
- **Service isolation**: Each app (`backend`, `frontend`, `worker`) is independent
- **Dependency management**: Workspace protocol (`workspace:*`) for internal packages
- **Build caching**: Turbo caches builds across services

### 2. Storage Provider Abstraction

The `IStorageAdapter` interface allows plugging in different cloud providers:

```typescript
interface IStorageAdapter {
  provider: string
  initialize(credentials: any): Promise<void>
  listDestinations(): Promise<StorageDestination[]>
  uploadFile(params: UploadFileParams): Promise<UploadFileResult>
  createFolder(...): Promise<StorageFolder>
  deleteFolder(...): Promise<void>
  listBackups(...): Promise<BackupVersion[]>
  validateCredentials(): Promise<boolean>
}
```

**Implementations:**
- `GoogleDriveAdapter` - For Google Workspace Shared Drives
- `S3Adapter` - For S3-compatible storage (coming soon)
- `DropboxAdapter` - For Dropbox (coming soon)

### 3. Job Queue Pattern

**Why BullMQ?**
- Reliable: Redis-backed persistent queue
- Retries: Exponential backoff on failures
- Concurrency: Process N jobs simultaneously
- Progress: Report upload progress to frontend
- Scalability: Add more workers horizontally

**Job Flow:**
1. User creates/schedules backup job in UI
2. Backend validates and stores job in database
3. node-cron triggers job at scheduled time (or manual trigger)
4. Backend enqueues job data to BullMQ
5. Worker picks up job, executes backup
6. Worker reports progress via WebSocket
7. Worker updates database with results

### 4. Atomic Backup Operations

To prevent partial backups from appearing as complete:

1. **Temporary folder**: Create folder with `.tmp-` prefix
2. **Upload files**: Stream files into temporary folder
3. **Atomic rename**: Rename `.tmp-Backup-2026-01-12` → `Backup-2026-01-12`
4. **Retention cleanup**: Delete old versions per policy

If backup fails mid-upload, temporary folder remains and is cleaned up on next run.

### 5. Stream-Based Uploads

Instead of loading entire files into memory:

```typescript
const fileStream = fs.createReadStream(filePath)
await storageAdapter.uploadFile({
  fileStream,
  fileSize,
  onProgress: (progress) => {
    // Report progress
  }
})
```

Benefits:
- Handles files larger than available RAM
- Immediate upload start (no buffering delay)
- Progress tracking during upload

---

## Data Models

### Database Schema (Prisma)

#### StorageCredential

Stores encrypted OAuth tokens or API keys for cloud providers.

```prisma
model StorageCredential {
  id            String   @id @default(cuid())
  name          String
  provider      String   // "google_drive", "s3", "dropbox"

  encryptedData String   // AES-256-GCM encrypted JSON
  iv            String   // Initialization vector
  authTag       String   // Authentication tag

  scopes        String?  // OAuth scopes
  expiresAt     DateTime?

  createdAt     DateTime @default(now())
  updatedAt     DateTime @updatedAt
}
```

**Encrypted Data Format:**

- **Google Drive**: `{ access_token, refresh_token, expiry_date, token_type, scope }`
- **S3**: `{ access_key_id, secret_access_key, region, endpoint? }`

#### StorageDestination

References a specific storage location (Shared Drive, S3 bucket, etc.).

```prisma
model StorageDestination {
  id           String   @id @default(cuid())
  provider     String
  remoteId     String   // Drive ID, bucket name, etc.
  name         String
  folderPath   String?  // Optional subfolder

  credentialId String
  credential   StorageCredential @relation(...)

  createdAt    DateTime @default(now())
  updatedAt    DateTime @updatedAt
}
```

#### BackupJob

Scheduled backup configuration.

```prisma
model BackupJob {
  id             String   @id @default(cuid())
  name           String
  description    String?

  sourcePath     String   // NAS path: /photos/2024
  destinationId  String
  credentialId   String

  schedule       String   // Cron: "0 2 * * *"

  retentionType  RetentionType
  retentionCount Int?
  retentionDays  Int?

  namePattern    String   // "Backup-{date}"

  enabled        Boolean  @default(true)
  lastRunAt      DateTime?
  nextRunAt      DateTime?

  createdAt      DateTime @default(now())
  updatedAt      DateTime @updatedAt
}
```

#### BackupHistory

Execution log for each backup run.

```prisma
model BackupHistory {
  id            String   @id @default(cuid())
  jobId         String
  status        BackupStatus

  startedAt     DateTime
  completedAt   DateTime?

  filesScanned  Int      @default(0)
  filesUploaded Int      @default(0)
  filesFailed   Int      @default(0)
  bytesUploaded BigInt   @default(0)

  remotePath    String?  // Final backup folder name
  errorMessage  String?
  errorStack    String?

  createdAt     DateTime @default(now())
}
```

### Enums

```prisma
enum RetentionType {
  VERSION_COUNT  // Keep last N versions
  DAYS           // Keep backups from last N days
  HYBRID         // Keep N versions AND anything < M days
}

enum BackupStatus {
  PENDING
  RUNNING
  UPLOADING
  ROTATING       // Applying retention policy
  SUCCESS
  PARTIAL_SUCCESS
  FAILED
  CANCELLED
}
```

---

## Storage Abstraction

### Provider Registration

Each storage provider implements the `IStorageAdapter` interface:

```typescript
// apps/backend/src/lib/storage/google-drive.ts
export class GoogleDriveAdapter extends StorageAdapter {
  provider = 'google_drive'

  async initialize(credentials: GoogleDriveCredentials) {
    // Set up OAuth client
  }

  async listDestinations() {
    // List shared drives
  }

  async uploadFile(params: UploadFileParams) {
    // Use googleapis to upload with resumable API
  }

  // ... other methods
}
```

### Provider Factory

```typescript
function createStorageAdapter(provider: string): StorageAdapter {
  switch (provider) {
    case 'google_drive':
      return new GoogleDriveAdapter()
    case 's3':
      return new S3Adapter()
    case 'dropbox':
      return new DropboxAdapter()
    default:
      throw new Error(`Unknown provider: ${provider}`)
  }
}
```

### Credential Decryption

```typescript
import crypto from 'crypto'

function decryptCredentials(
  encryptedData: string,
  iv: string,
  authTag: string,
  key: Buffer
): any {
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(iv, 'hex'))
  decipher.setAuthTag(Buffer.from(authTag, 'hex'))

  let decrypted = decipher.update(encryptedData, 'hex', 'utf8')
  decrypted += decipher.final('utf8')

  return JSON.parse(decrypted)
}
```

---

## Backup Execution Flow

### Phase 1: Job Scheduling

1. **Cron triggers** at scheduled time
2. **Backend** loads job from database
3. **Backend** creates `BackupHistory` record (status: `PENDING`)
4. **Backend** enqueues job to BullMQ with:
   - `jobId`
   - `historyId`
   - `executionParams` (source, destination, credentials, retention)

### Phase 2: Worker Processing

1. **Worker** picks up job from queue
2. **Worker** updates history status to `RUNNING`
3. **Worker** loads and decrypts credentials
4. **Worker** initializes storage adapter

### Phase 3: Directory Scanning

1. Recursively traverse NAS source path
2. Collect all files with metadata (size, modified time)
3. Calculate total size
4. Update history: `filesScanned`

### Phase 4: Folder Creation

1. Generate backup folder name: `"Backup-2026-01-12"` (from `namePattern`)
2. Create temporary folder: `".tmp-Backup-2026-01-12"`
3. Store temporary folder ID

### Phase 5: File Upload

```typescript
for (const file of files) {
  const fileStream = fs.createReadStream(file.path)

  await storageAdapter.uploadFile({
    destinationId: job.destinationId,
    folderPath: temporaryFolderId,
    fileName: file.name,
    fileStream,
    fileSize: file.size,
    mimeType: file.mimeType,
    onProgress: (progress) => {
      // Update history bytesUploaded
      // Emit WebSocket event to frontend
    }
  })

  // Update history: filesUploaded++
}
```

**Status**: `UPLOADING`

### Phase 6: Finalization

1. **Atomic rename**: `.tmp-Backup-2026-01-12` → `Backup-2026-01-12`
2. **Status**: `ROTATING`

### Phase 7: Retention Cleanup

1. List all backup versions in destination
2. Apply retention policy:
   - **VERSION_COUNT**: Keep only last N versions
   - **DAYS**: Delete backups older than N days
   - **HYBRID**: Keep N versions OR anything < M days old
3. Delete old backup folders

### Phase 8: Completion

1. Update history:
   - `status`: `SUCCESS` or `FAILED`
   - `completedAt`: Current timestamp
   - `remotePath`: Final folder name
2. Update job `lastRunAt`
3. Emit completion event to frontend

---

## Security Design

### 1. Credential Encryption

**Algorithm**: AES-256-GCM (authenticated encryption)

**Storage**:
```
encryptedData = encrypt(JSON.stringify(credentials), key, iv)
authTag = GCM authentication tag
```

**Key Management**:
- **ENCRYPTION_KEY**: 32-byte (256-bit) key from environment variable
- Generate with: `openssl rand -hex 32`
- **Critical**: Back up this key securely (password manager, encrypted USB)
- If lost: All stored credentials become unrecoverable (users must re-authenticate)

### 2. OAuth 2.0 Flow (Google Drive)

1. **Authorization URL**: Backend generates state token, builds OAuth URL
2. **User authorization**: User logs in to Google, grants permissions
3. **Callback**: Google redirects to backend with `code` and `state`
4. **Token exchange**: Backend exchanges code for `access_token` and `refresh_token`
5. **Storage**: Encrypt tokens and store in database
6. **Refresh**: Automatically refresh `access_token` when expired

**Scopes**:
- Recommended: `https://www.googleapis.com/auth/drive.file` (only files created by app)
- Alternative: `https://www.googleapis.com/auth/drive` (full access - use cautiously)

### 3. NAS Access

- **Read-only mounts**: Container volumes mounted with `:ro` flag
- **No write permissions**: Worker cannot modify source data
- **Path validation**: Backend validates all paths are within NAS_MOUNT_PATH

### 4. Network Security

- **Docker bridge**: Services communicate via internal network
- **Exposed ports**: Only frontend (3000) and backend (4000) exposed to host
- **CORS**: Backend restricts origins to FRONTEND_URL

### 5. Database Security

- **SQLite file permissions**: Set to `600` (owner read/write only)
- **Encrypted credentials**: Even if database is stolen, credentials are useless without ENCRYPTION_KEY
- **Backup database**: Include `avault.db` in your backup strategy

---

## API Specification

### Authentication

#### `POST /api/auth/google/init`

Initialize Google OAuth flow.

**Request**:
```json
{
  "name": "My Google Drive Account"
}
```

**Response**:
```json
{
  "success": true,
  "data": {
    "authUrl": "https://accounts.google.com/o/oauth2/v2/auth?...",
    "state": "random-state-string"
  }
}
```

#### `GET /api/auth/google/callback`

OAuth callback endpoint (handles redirect from Google).

**Query Params**:
- `code`: Authorization code
- `state`: State token

**Redirects to**: `${FRONTEND_URL}/auth/callback?success=true`

### Credentials

#### `GET /api/credentials`

List all stored credentials (without sensitive data).

**Response**:
```json
{
  "success": true,
  "data": [
    {
      "id": "clx123...",
      "name": "My Google Drive",
      "provider": "google_drive",
      "expiresAt": "2026-02-12T00:00:00.000Z",
      "createdAt": "2026-01-12T10:30:00.000Z"
    }
  ]
}
```

#### `DELETE /api/credentials/:id`

Revoke and delete credentials.

### Destinations

#### `GET /api/destinations`

List all configured storage destinations.

#### `POST /api/destinations`

Create a new destination.

**Request**:
```json
{
  "credentialId": "clx123...",
  "provider": "google_drive",
  "remoteId": "0ABcd1234...",
  "name": "Company Shared Drive",
  "folderPath": "/backups"
}
```

### Backup Jobs

#### `GET /api/jobs`

List all backup jobs.

#### `POST /api/jobs`

Create a new backup job.

**Request**:
```json
{
  "name": "Daily Photos Backup",
  "description": "Backup photos folder daily at 2 AM",
  "sourcePath": "/photos/2024",
  "destinationId": "clx456...",
  "credentialId": "clx123...",
  "schedule": "0 2 * * *",
  "retentionType": "VERSION_COUNT",
  "retentionCount": 7,
  "namePattern": "Photos-{date}",
  "enabled": true
}
```

#### `POST /api/jobs/:id/run`

Trigger immediate job execution (bypasses schedule).

### History

#### `GET /api/history`

Get paginated backup execution history.

**Query Params**:
- `jobId`: Filter by job ID (optional)
- `status`: Filter by status (optional)
- `limit`: Results per page (default: 20, max: 100)
- `offset`: Pagination offset (default: 0)

### NAS Browser

#### `GET /api/nas/browse?path=/photos`

Browse NAS filesystem.

**Response**:
```json
{
  "success": true,
  "data": {
    "path": "/photos",
    "items": [
      {
        "name": "2024",
        "path": "/photos/2024",
        "type": "directory",
        "modified": "2024-12-01T00:00:00.000Z"
      },
      {
        "name": "family.jpg",
        "path": "/photos/family.jpg",
        "type": "file",
        "size": 2048576,
        "modified": "2024-11-15T10:30:00.000Z"
      }
    ]
  }
}
```

---

## WebSocket Events

(WebSocket implementation coming soon - currently placeholder)

### Server → Client Events

#### `backup:progress`

Real-time upload progress.

```json
{
  "type": "backup:progress",
  "payload": {
    "jobId": "clx789...",
    "historyId": "clx012...",
    "status": "UPLOADING",
    "filesScanned": 1523,
    "filesUploaded": 487,
    "filesFailed": 2,
    "bytesUploaded": 524288000,
    "currentFile": "/photos/IMG_1234.jpg",
    "uploadSpeed": 10485760,
    "estimatedTimeRemaining": 3600
  },
  "timestamp": 1736691600000
}
```

#### `backup:status`

Status change notification.

```json
{
  "type": "backup:status",
  "payload": {
    "jobId": "clx789...",
    "historyId": "clx012...",
    "status": "SUCCESS",
    "message": "Backup completed successfully"
  },
  "timestamp": 1736691700000
}
```

#### `queue:stats`

Job queue statistics.

```json
{
  "type": "queue:stats",
  "payload": {
    "waiting": 3,
    "active": 2,
    "completed": 156,
    "failed": 4
  },
  "timestamp": 1736691800000
}
```

---

## Deployment

### Docker Architecture

Avault uses a multi-container Docker architecture with pre-built images:

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                            Docker Compose                                    │
│                                                                             │
│  ┌─────────────────┐  ┌─────────────────┐  ┌─────────────────┐             │
│  │    Frontend     │  │    Backend      │  │     Worker      │             │
│  │    (nginx)      │  │    (Node.js)    │  │   (BullMQ)      │             │
│  │   Port 3000     │  │   Port 4000     │  │                 │             │
│  │   Static SPA    │──│   REST API      │──│   Job Processor │             │
│  │   API Proxy     │  │   OAuth         │  │                 │             │
│  └─────────────────┘  └─────────────────┘  └─────────────────┘             │
│           │                    │                    │                       │
│           │                    │                    │                       │
│           └────────────────────┼────────────────────┘                       │
│                                │                                             │
│                    ┌───────────┴───────────┐                                │
│                    │                       │                                │
│           ┌────────▼────────┐    ┌────────▼────────┐                       │
│           │   PostgreSQL    │    │      Redis      │                       │
│           │    Port 5432    │    │    Port 6379    │                       │
│           └─────────────────┘    └─────────────────┘                       │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

### Container Images

Pre-built multi-platform images (amd64, arm64) are published to GitHub Container Registry:

| Image | Base | Purpose |
|-------|------|---------|
| `ghcr.io/drizki/avault-backend` | node:20-alpine | Hono API server |
| `ghcr.io/drizki/avault-frontend` | nginx:alpine | Static SPA with API proxy |
| `ghcr.io/drizki/avault-worker` | node:20-alpine | BullMQ job processor |

### Multi-Stage Dockerfile Structure

Each Dockerfile uses a 4-stage build process:

1. **base**: Install pnpm via corepack
2. **deps**: Install dependencies with frozen lockfile
3. **builder**: Build TypeScript, generate Prisma client
4. **runner**: Minimal production image with non-root user

Example build sizes:
- Backend: ~200MB
- Frontend: ~30MB (nginx + static files)
- Worker: ~200MB

### Production Deployment

1. Clone repository and configure environment:
   ```bash
   git clone https://github.com/drizki/avault.git
   cd avault
   cp .env.example .env
   # Edit .env with production values
   ```

2. Start all services:
   ```bash
   docker compose up -d
   ```

3. Verify deployment:
   ```bash
   docker compose ps
   docker compose logs -f
   ```

### Environment Variables

All services share environment configuration via `.env` file:

| Variable | Service | Description |
|----------|---------|-------------|
| `AVAULT_VERSION` | All | Docker image tag (default: latest) |
| `POSTGRES_USER` | PostgreSQL | Database username |
| `POSTGRES_PASSWORD` | PostgreSQL | Database password (required) |
| `POSTGRES_DB` | PostgreSQL | Database name |
| `REDIS_PASSWORD` | Redis | Redis password (optional) |
| `ENCRYPTION_KEY` | Backend, Worker | AES-256 key for credentials |
| `JWT_SECRET` | Backend | JWT signing secret |
| `GOOGLE_CLIENT_ID` | Backend, Worker | OAuth client ID |
| `GOOGLE_CLIENT_SECRET` | Backend, Worker | OAuth client secret |
| `NAS_MOUNT_PATH` | Worker | Host path to NAS mount |
| `WORKER_CONCURRENCY` | Worker | Parallel job count |

### Volume Mounts

| Volume | Container Path | Purpose |
|--------|---------------|---------|
| `postgres-data` | `/var/lib/postgresql/data` | Database persistence |
| `redis-data` | `/data` | Redis AOF persistence |
| `${NAS_MOUNT_PATH}` | `/nas:ro` | NAS read-only access |

### Health Checks

All services include health checks:

- **PostgreSQL**: `pg_isready` every 10s
- **Redis**: `redis-cli ping` every 10s
- **Backend**: HTTP GET `/api/health` every 30s
- **Frontend**: HTTP GET `/` every 30s

### Scaling

The worker service can be scaled horizontally:

```bash
docker compose up -d --scale worker=3
```

Each worker instance processes `WORKER_CONCURRENCY` jobs simultaneously.

### Development Mode

For local development, use infrastructure services only:

```bash
docker compose up postgres redis -d
pnpm dev  # Runs all apps locally via Turbo
```

### Monitoring

- **Container logs**: `docker compose logs -f [service]`
- **Prisma Studio**: `pnpm db:studio`
- **Redis CLI**: `docker compose exec redis redis-cli`
- **PostgreSQL**: `docker compose exec postgres psql -U avault`

---

## Performance Considerations

### 1. Concurrency

- **Worker concurrency**: `WORKER_CONCURRENCY` environment variable
- Default: 2 simultaneous backups
- Increase for more powerful hardware
- Consider network bandwidth and API rate limits

### 2. Memory Usage

- **Stream-based uploads**: Constant memory regardless of file size
- **Worker memory**: ~100MB base + ~50MB per concurrent job
- **Backend memory**: ~50MB base
- **Frontend**: Static assets, minimal runtime

### 3. Database Performance

- **PostgreSQL 16**: Production-grade relational database
- **Indexes**: Added on frequently queried columns (jobId, status, etc.)
- **Migrations**: Use Prisma migrations for schema changes
- **Connection pooling**: Prisma handles connection management

### 4. Rate Limiting

Google Drive API quotas:
- **Queries per day**: 1,000,000,000 (unlikely to hit)
- **Queries per 100 seconds per user**: 1,000
- **Recommendation**: Add exponential backoff on 429 errors

---

## Future Enhancements

1. **Multi-user support**: Add user authentication and RBAC
2. **Client-side encryption**: Encrypt files before upload
3. **Backup verification**: Hash-based integrity checks
4. **Notification channels**: Email, Discord, Slack webhooks
5. **Bandwidth throttling**: Limit upload speed
6. **Incremental backups**: Only upload changed files
7. **Deduplication**: Skip duplicate files across backups
8. **Backup restore UI**: Download files from cloud storage
9. **Metrics dashboard**: Prometheus + Grafana integration
10. **Mobile app**: React Native companion app

---

## CI/CD Pipeline

### GitHub Actions Workflows

The project uses three GitHub Actions workflows:

#### CI Workflow (ci.yml)

Triggered on push and pull requests to `main` and `develop` branches:

1. **Lint**: ESLint and Prettier checks
2. **Test**: Vitest with PostgreSQL and Redis services
3. **Build**: TypeScript compilation and Vite build
4. **Docker Build Test**: Verify Dockerfiles build successfully (PR only)

#### Release Workflow (release.yml)

Triggered on semantic version tags (`v*.*.*`):

1. Build multi-platform Docker images (amd64, arm64)
2. Push to GitHub Container Registry with version tags
3. Extract changelog and create GitHub Release

Image tagging strategy:
- `1.2.3` - Exact version
- `1.2` - Minor version (latest patch)
- `1` - Major version (latest minor)
- `latest` - Most recent release

#### Dependabot Auto-merge (dependabot-auto.yml)

Automatically approves and merges patch-level dependency updates.

### Versioning

The project follows [Semantic Versioning](https://semver.org/):

- **MAJOR**: Breaking changes
- **MINOR**: New features, backwards compatible
- **PATCH**: Bug fixes, backwards compatible

### Release Process

1. Create release branch from develop:
   ```bash
   git checkout develop
   git checkout -b release/v1.2.0
   ```

2. Bump version:
   ```bash
   ./scripts/bump-version.sh minor
   ```

3. Update CHANGELOG.md with release notes

4. Merge to main and tag:
   ```bash
   git checkout main
   git merge release/v1.2.0
   git tag -a v1.2.0 -m "Release v1.2.0"
   git push origin main --tags
   ```

5. GitHub Actions builds and publishes Docker images

### Changelog

The project maintains a changelog following [Keep a Changelog](https://keepachangelog.com/) format in `CHANGELOG.md`.

---

**Last Updated**: January 14, 2025
