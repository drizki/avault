# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

### Changed

### Deprecated

### Removed

### Fixed

### Security

## [0.1.0-alpha.1] - 2025-01-14

### Added

- **Alpha Release**: Initial alpha version for production testing
- All features from [0.1.0] are included
- This is a pre-release version for testing and validation

### Note

This is an alpha release. It includes all core functionality but is intended for testing purposes before the final 0.1.0 release. Please report any issues on GitHub.

## [0.1.0] - 2025-01-14

### Added

#### Authentication & Users

- Google OAuth 2.0 login with automatic token refresh
- User registration with admin-controlled signups
- Role-based access control (ADMIN and USER roles)
- JWT-based session management
- User profile with avatar, email, and last login tracking

#### Dashboard & Monitoring

- Real-time dashboard with SSE (Server-Sent Events) streaming
- Statistics cards: running backups, queue depth, 7-day success rate, data uploaded today
- System health panel with database, Redis, and worker status monitoring
- Active backups panel with live progress (files, bytes, speed, current file)
- 7/30/90-day history chart visualization
- Alerts banner for expired credentials, failed backups, and warnings
- Live system logs panel with copy and clear functionality

#### Storage Providers

- Google Drive Shared Drives (OAuth 2.0)
- Google Drive My Drive (OAuth 2.0)
- Google Cloud Storage (Service Account JSON)
- AWS S3 (API Keys)
- Cloudflare R2 (API Keys)
- DigitalOcean Spaces (API Keys)

#### Backup Jobs

- Full CRUD for backup job management
- NAS filesystem browser with path traversal protection
- Destination browser with folder creation
- 6 preset schedules plus custom cron expression support
- Retention policies: version count, days-based, and hybrid
- Backup naming patterns with {date} and {hash} placeholders
- Manual "run now" trigger
- Job enable/disable toggle
- Job cancellation support

#### Backup Execution

- Stream-based uploads for memory efficiency
- Parallel file uploads (configurable concurrency, default 10)
- Real-time progress tracking with throttled updates
- Automatic retention policy enforcement
- OS junk file filtering (.DS_Store, Thumbs.db, etc.)
- Symlink handling and validation
- Atomic backup operations (temp folder rename on completion)
- Per-backup execution logs

#### History & Logs

- Paginated backup history with filtering by job and status
- Detailed execution stats: files scanned/uploaded/failed, bytes, duration
- Error messages and stack traces for failed jobs
- Trigger source tracking (MANUAL vs SCHEDULED)
- Real-time log streaming per backup job
- Automatic log cleanup with TTL

#### Credential Management

- Encrypted credential storage (AES-256-GCM with IV and auth tag)
- OAuth token automatic refresh
- Credential expiry tracking and alerts
- Support for OAuth, API keys, and service account JSON

#### Destination Management

- Create and browse storage destinations
- Google Drive: create new Shared Drives from UI
- Folder structure browsing and creation
- Support for all storage providers

#### User Interface

- React 19 with TanStack Router
- shadcn/ui component library
- Responsive design (mobile navigation drawer)
- Toast notifications
- Loading states with skeleton placeholders
- Animated panel transitions
- Dark mode ready (Tailwind CSS)

#### Infrastructure

- Hono backend API server
- BullMQ job queue with Redis
- PostgreSQL 16 with Prisma ORM
- Docker Compose deployment with pre-built multi-arch images
- Health checks for all services
- Worker heartbeat monitoring

#### DevOps

- GitHub Actions CI/CD pipeline
- Multi-platform Docker builds (amd64, arm64)
- Semantic versioning with automated image tagging
- Dependabot for dependency updates
- CodeRabbit for AI-powered PR reviews

### Security

- AES-256-GCM encryption for all stored credentials
- JWT-based authentication with secure cookies
- OAuth 2.0 CSRF protection (state parameter validation)
- Path traversal prevention for NAS browsing
- User data isolation (userId-based access control)
- Role-based access control for admin functions
- Read-only NAS mounts in containers
- Non-root container users
- Encrypted token storage with IV and auth tag

[Unreleased]: https://github.com/drizki/avault/compare/v0.1.0-alpha.1...HEAD
[0.1.0-alpha.1]: https://github.com/drizki/avault/compare/v0.1.0...v0.1.0-alpha.1
[0.1.0]: https://github.com/drizki/avault/releases/tag/v0.1.0
