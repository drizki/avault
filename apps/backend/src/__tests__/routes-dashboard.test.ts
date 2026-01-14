import { describe, it, expect, vi, beforeEach } from 'vitest'
import { Hono } from 'hono'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type ApiResponse = { success: boolean; data?: any; error?: string }

const mocks = vi.hoisted(() => ({
  jobCount: vi.fn(),
  historyGroupBy: vi.fn(),
  historyAggregate: vi.fn(),
  historyFindMany: vi.fn(),
  jobFindMany: vi.fn(),
  credentialFindMany: vi.fn(),
  queryRaw: vi.fn(),
  getQueueStats: vi.fn(),
  backupQueueGetJobs: vi.fn(),
  verifyToken: vi.fn(),
  loggerInfo: vi.fn(),
  loggerError: vi.fn(),
  loggerDebug: vi.fn(),
  loggerWarn: vi.fn(),
  redisPing: vi.fn(),
  redisInfo: vi.fn(),
  redisGet: vi.fn(),
  redisDisconnect: vi.fn(),
}))

vi.mock('@avault/shared', async (importOriginal) => {
  const actual = await importOriginal()
  return {
    ...(actual as object),
    createRedisConnection: vi.fn(),
    Redis: vi.fn().mockImplementation(() => ({
      ping: mocks.redisPing,
      info: mocks.redisInfo,
      get: mocks.redisGet,
      disconnect: mocks.redisDisconnect,
      on: vi.fn(),
      subscribe: vi.fn().mockResolvedValue(undefined),
      unsubscribe: vi.fn().mockResolvedValue(undefined),
      quit: vi.fn().mockResolvedValue(undefined),
    })),
    logger: {
      info: mocks.loggerInfo,
      error: mocks.loggerError,
      debug: mocks.loggerDebug,
      warn: mocks.loggerWarn,
    },
  }
})

vi.mock('../lib/auth/jwt', () => ({
  verifyToken: mocks.verifyToken,
}))

vi.mock('../lib/queue', () => ({
  getQueueStats: mocks.getQueueStats,
  backupQueue: {
    getJobs: mocks.backupQueueGetJobs,
  },
}))

const mockDb = {
  backupJob: {
    count: mocks.jobCount,
    findMany: mocks.jobFindMany,
  },
  backupHistory: {
    groupBy: mocks.historyGroupBy,
    aggregate: mocks.historyAggregate,
    findMany: mocks.historyFindMany,
  },
  storageCredential: {
    findMany: mocks.credentialFindMany,
  },
  $queryRaw: mocks.queryRaw,
}

vi.mock('../middleware/auth', () => ({
  requireAuth: vi.fn().mockImplementation(async (c, next) => {
    c.set('userId', 'user-123')
    c.set('userRole', 'USER')
    c.set('db', mockDb)
    await next()
  }),
}))

import dashboardRoutes from '../routes/dashboard'

describe('dashboard routes', () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let app: Hono<any>

  beforeEach(() => {
    vi.clearAllMocks()
    app = new Hono()
    app.use('*', async (c, next) => {
      c.set('db', mockDb)
      await next()
    })
    app.route('/api/dashboard', dashboardRoutes)
  })

  describe('GET /api/dashboard/stats', () => {
    it('returns aggregated dashboard statistics', async () => {
      mocks.jobCount.mockResolvedValueOnce(10) // total
      mocks.jobCount.mockResolvedValueOnce(8) // enabled
      mocks.historyGroupBy.mockResolvedValueOnce([
        { status: 'SUCCESS', _count: { id: 5 } },
        { status: 'FAILED', _count: { id: 2 } },
        { status: 'RUNNING', _count: { id: 1 } },
      ]) // last24h
      mocks.historyGroupBy.mockResolvedValueOnce([
        { status: 'SUCCESS', _count: { id: 20 } },
        { status: 'FAILED', _count: { id: 5 } },
      ]) // last7d
      mocks.getQueueStats.mockResolvedValue({
        waiting: 2,
        active: 1,
        completed: 100,
        failed: 5,
      })
      mocks.historyAggregate.mockResolvedValue({
        _sum: { bytesUploaded: BigInt(1024 * 1024 * 500) },
      })

      const res = await app.request('/api/dashboard/stats')

      expect(res.status).toBe(200)
      const body = (await res.json()) as ApiResponse
      expect(body.success).toBe(true)
      expect(body.data.jobs.total).toBe(10)
      expect(body.data.jobs.enabled).toBe(8)
      expect(body.data.history.last24h.success).toBe(5)
      expect(body.data.history.last24h.failed).toBe(2)
      expect(body.data.history.last24h.running).toBe(1)
      expect(body.data.history.successRate).toBe(80) // 20/25 = 80%
    })

    it('handles empty statistics', async () => {
      mocks.jobCount.mockResolvedValue(0)
      mocks.historyGroupBy.mockResolvedValue([])
      mocks.getQueueStats.mockResolvedValue({
        waiting: 0,
        active: 0,
        completed: 0,
        failed: 0,
      })
      mocks.historyAggregate.mockResolvedValue({
        _sum: { bytesUploaded: null },
      })

      const res = await app.request('/api/dashboard/stats')

      expect(res.status).toBe(200)
      const body = (await res.json()) as ApiResponse
      expect(body.data.jobs.total).toBe(0)
      expect(body.data.history.successRate).toBe(100) // Default when no history
    })

    it('returns 500 on error', async () => {
      mocks.jobCount.mockRejectedValue(new Error('Database error'))

      const res = await app.request('/api/dashboard/stats')

      expect(res.status).toBe(500)
      const body = (await res.json()) as ApiResponse
      expect(body.error).toBe('Failed to fetch dashboard stats')
    })
  })

  describe('GET /api/dashboard/active', () => {
    it('returns active jobs with progress', async () => {
      mocks.historyFindMany.mockResolvedValue([
        {
          id: 'hist-1',
          status: 'RUNNING',
          startedAt: new Date('2024-01-15T10:00:00Z'),
          filesScanned: 100,
          filesUploaded: 50,
          filesFailed: 0,
          bytesUploaded: BigInt(1024 * 1024),
          job: { id: 'job-1', name: 'Daily Backup' },
        },
      ])
      mocks.backupQueueGetJobs.mockResolvedValue([
        {
          data: { historyId: 'hist-1' },
          progress: {
            filesScanned: 150,
            filesUploaded: 75,
            filesFailed: 2,
            bytesUploaded: 2048 * 1024,
            currentFile: '/data/file.txt',
            uploadSpeed: 1024 * 1024,
          },
        },
      ])

      const res = await app.request('/api/dashboard/active')

      expect(res.status).toBe(200)
      const body = (await res.json()) as ApiResponse
      expect(body.success).toBe(true)
      expect(body.data.jobs).toHaveLength(1)
      expect(body.data.jobs[0].jobName).toBe('Daily Backup')
      expect(body.data.jobs[0].progress.filesScanned).toBe(150) // From queue
      expect(body.data.jobs[0].progress.currentFile).toBe('/data/file.txt')
    })

    it('uses database values when queue progress is missing', async () => {
      mocks.historyFindMany.mockResolvedValue([
        {
          id: 'hist-1',
          status: 'RUNNING',
          startedAt: new Date(),
          filesScanned: 100,
          filesUploaded: 50,
          filesFailed: 0,
          bytesUploaded: BigInt(1024),
          job: { id: 'job-1', name: 'Backup' },
        },
      ])
      mocks.backupQueueGetJobs.mockResolvedValue([]) // No queue jobs

      const res = await app.request('/api/dashboard/active')

      expect(res.status).toBe(200)
      const body = (await res.json()) as ApiResponse
      expect(body.data.jobs[0].progress.filesScanned).toBe(100) // From DB
    })

    it('returns empty array when no active jobs', async () => {
      mocks.historyFindMany.mockResolvedValue([])
      mocks.backupQueueGetJobs.mockResolvedValue([])

      const res = await app.request('/api/dashboard/active')

      expect(res.status).toBe(200)
      const body = (await res.json()) as ApiResponse
      expect(body.data.jobs).toHaveLength(0)
    })

    it('returns 500 on error', async () => {
      mocks.historyFindMany.mockRejectedValue(new Error('DB error'))

      const res = await app.request('/api/dashboard/active')

      expect(res.status).toBe(500)
      const body = (await res.json()) as ApiResponse
      expect(body.error).toBe('Failed to fetch active jobs')
    })
  })

  describe('GET /api/dashboard/upcoming', () => {
    it('returns upcoming scheduled jobs', async () => {
      const nextRunAt = new Date(Date.now() + 3600 * 1000) // 1 hour from now
      mocks.jobFindMany.mockResolvedValue([
        {
          id: 'job-1',
          name: 'Daily Backup',
          schedule: '0 2 * * *',
          nextRunAt,
          destination: { name: 'S3 Bucket', provider: 's3' },
        },
      ])

      const res = await app.request('/api/dashboard/upcoming')

      expect(res.status).toBe(200)
      const body = (await res.json()) as ApiResponse
      expect(body.success).toBe(true)
      expect(body.data.jobs).toHaveLength(1)
      expect(body.data.jobs[0].name).toBe('Daily Backup')
      expect(body.data.jobs[0].nextRunIn).toBeGreaterThan(0)
    })

    it('returns empty array when no upcoming jobs', async () => {
      mocks.jobFindMany.mockResolvedValue([])

      const res = await app.request('/api/dashboard/upcoming')

      expect(res.status).toBe(200)
      const body = (await res.json()) as ApiResponse
      expect(body.data.jobs).toHaveLength(0)
    })

    it('returns 500 on error', async () => {
      mocks.jobFindMany.mockRejectedValue(new Error('DB error'))

      const res = await app.request('/api/dashboard/upcoming')

      expect(res.status).toBe(500)
      const body = (await res.json()) as ApiResponse
      expect(body.error).toBe('Failed to fetch upcoming jobs')
    })
  })

  describe('GET /api/dashboard/chart-data', () => {
    it('returns chart data for default 7d period', async () => {
      const today = new Date()
      const yesterday = new Date(today.getTime() - 24 * 60 * 60 * 1000)

      mocks.historyFindMany.mockResolvedValue([
        {
          startedAt: today,
          status: 'SUCCESS',
          bytesUploaded: BigInt(1024 * 1024),
        },
        {
          startedAt: today,
          status: 'FAILED',
          bytesUploaded: BigInt(0),
        },
        {
          startedAt: yesterday,
          status: 'SUCCESS',
          bytesUploaded: BigInt(2048 * 1024),
        },
      ])

      const res = await app.request('/api/dashboard/chart-data')

      expect(res.status).toBe(200)
      const body = (await res.json()) as ApiResponse
      expect(body.success).toBe(true)
      expect(body.data.period).toBe('7d')
      expect(body.data.daily).toBeDefined()
      expect(Array.isArray(body.data.daily)).toBe(true)
    })

    it('supports 30d period', async () => {
      mocks.historyFindMany.mockResolvedValue([])

      const res = await app.request('/api/dashboard/chart-data?period=30d')

      expect(res.status).toBe(200)
      const body = (await res.json()) as ApiResponse
      expect(body.data.period).toBe('30d')
    })

    it('supports 90d period', async () => {
      mocks.historyFindMany.mockResolvedValue([])

      const res = await app.request('/api/dashboard/chart-data?period=90d')

      expect(res.status).toBe(200)
      const body = (await res.json()) as ApiResponse
      expect(body.data.period).toBe('90d')
    })

    it('returns 500 on error', async () => {
      mocks.historyFindMany.mockRejectedValue(new Error('DB error'))

      const res = await app.request('/api/dashboard/chart-data')

      expect(res.status).toBe(500)
      const body = (await res.json()) as ApiResponse
      expect(body.error).toBe('Failed to fetch chart data')
    })
  })

  describe('GET /api/dashboard/alerts', () => {
    it('returns failed backup alerts', async () => {
      mocks.historyFindMany.mockResolvedValue([
        {
          id: 'hist-1',
          jobId: 'job-1',
          status: 'FAILED',
          startedAt: new Date(),
          errorMessage: 'Connection timeout',
          job: { name: 'Daily Backup' },
        },
      ])
      mocks.credentialFindMany
        .mockResolvedValueOnce([]) // expiring
        .mockResolvedValueOnce([]) // expired

      const res = await app.request('/api/dashboard/alerts')

      expect(res.status).toBe(200)
      const body = (await res.json()) as ApiResponse
      expect(body.success).toBe(true)
      expect(body.data.alerts).toHaveLength(1)
      expect(body.data.alerts[0].type).toBe('backup_failed')
      expect(body.data.alerts[0].severity).toBe('error')
    })

    it('returns expiring credential alerts', async () => {
      const expiresAt = new Date(Date.now() + 3 * 24 * 60 * 60 * 1000) // 3 days
      mocks.historyFindMany.mockResolvedValue([])
      mocks.credentialFindMany
        .mockResolvedValueOnce([
          {
            id: 'cred-1',
            name: 'S3 Key',
            expiresAt,
          },
        ]) // expiring
        .mockResolvedValueOnce([]) // expired

      const res = await app.request('/api/dashboard/alerts')

      expect(res.status).toBe(200)
      const body = (await res.json()) as ApiResponse
      expect(body.data.alerts).toHaveLength(1)
      expect(body.data.alerts[0].type).toBe('credential_expiring')
      expect(body.data.alerts[0].severity).toBe('warning')
    })

    it('returns expired credential alerts', async () => {
      const expiresAt = new Date(Date.now() - 24 * 60 * 60 * 1000) // 1 day ago
      mocks.historyFindMany.mockResolvedValue([])
      mocks.credentialFindMany
        .mockResolvedValueOnce([]) // expiring
        .mockResolvedValueOnce([
          {
            id: 'cred-1',
            name: 'Old Key',
            expiresAt,
          },
        ]) // expired

      const res = await app.request('/api/dashboard/alerts')

      expect(res.status).toBe(200)
      const body = (await res.json()) as ApiResponse
      expect(body.data.alerts).toHaveLength(1)
      expect(body.data.alerts[0].type).toBe('credential_expired')
      expect(body.data.alerts[0].severity).toBe('critical')
    })

    it('sorts alerts by severity and timestamp', async () => {
      const now = new Date()
      mocks.historyFindMany.mockResolvedValue([
        {
          id: 'hist-1',
          jobId: 'job-1',
          status: 'FAILED',
          startedAt: now,
          job: { name: 'Backup' },
        },
      ])
      mocks.credentialFindMany
        .mockResolvedValueOnce([
          {
            id: 'cred-1',
            name: 'Expiring Key',
            expiresAt: new Date(Date.now() + 2 * 24 * 60 * 60 * 1000),
          },
        ])
        .mockResolvedValueOnce([
          {
            id: 'cred-2',
            name: 'Expired Key',
            expiresAt: new Date(Date.now() - 24 * 60 * 60 * 1000),
          },
        ])

      const res = await app.request('/api/dashboard/alerts')

      expect(res.status).toBe(200)
      const body = (await res.json()) as ApiResponse
      expect(body.data.alerts).toHaveLength(3)
      // Critical should be first
      expect(body.data.alerts[0].severity).toBe('critical')
      // Then error
      expect(body.data.alerts[1].severity).toBe('error')
      // Then warning
      expect(body.data.alerts[2].severity).toBe('warning')
    })

    it('returns empty alerts array', async () => {
      mocks.historyFindMany.mockResolvedValue([])
      mocks.credentialFindMany.mockResolvedValue([])

      const res = await app.request('/api/dashboard/alerts')

      expect(res.status).toBe(200)
      const body = (await res.json()) as ApiResponse
      expect(body.data.alerts).toHaveLength(0)
      expect(body.data.unreadCount).toBe(0)
    })

    it('returns 500 on error', async () => {
      mocks.historyFindMany.mockRejectedValue(new Error('DB error'))

      const res = await app.request('/api/dashboard/alerts')

      expect(res.status).toBe(500)
      const body = (await res.json()) as ApiResponse
      expect(body.error).toBe('Failed to fetch alerts')
    })
  })

  describe('GET /api/dashboard/stream (SSE)', () => {
    it('returns 401 when no token provided', async () => {
      const res = await app.request('/api/dashboard/stream')

      expect(res.status).toBe(401)
      const body = (await res.json()) as ApiResponse
      expect(body.error).toBe('Authentication required')
    })

    it('returns 401 when token is invalid', async () => {
      mocks.verifyToken.mockResolvedValue(null)

      const res = await app.request('/api/dashboard/stream?token=invalid-token')

      expect(res.status).toBe(401)
      const body = (await res.json()) as ApiResponse
      expect(body.error).toBe('Invalid or expired token')
    })
  })

  describe('GET /api/dashboard/health', () => {
    beforeEach(() => {
      // Default healthy state
      mocks.queryRaw.mockResolvedValue([{ '?column?': 1 }])
      mocks.redisPing.mockResolvedValue('PONG')
      mocks.redisInfo.mockResolvedValue('used_memory_human:10M')
      mocks.redisGet.mockResolvedValue(String(Date.now()))
      mocks.redisDisconnect.mockResolvedValue(undefined)
      mocks.getQueueStats.mockResolvedValue({ active: 0 })
      mocks.credentialFindMany.mockResolvedValue([])
    })

    it('returns healthy status when all services are up', async () => {
      const res = await app.request('/api/dashboard/health')

      expect(res.status).toBe(200)
      const body = (await res.json()) as ApiResponse
      expect(body.success).toBe(true)
      expect(body.data.overall).toBe('healthy')
      expect(body.data.services.database.status).toBe('up')
      expect(body.data.services.redis.status).toBe('up')
    })

    it('returns critical status when Redis is down', async () => {
      mocks.redisPing.mockRejectedValue(new Error('Connection refused'))

      const res = await app.request('/api/dashboard/health')

      expect(res.status).toBe(200)
      const body = (await res.json()) as ApiResponse
      expect(body.data.services.redis.status).toBe('down')
      expect(body.data.overall).toBe('critical')
    })

    it('returns critical status when worker is down', async () => {
      // Heartbeat is old (more than 60 seconds)
      mocks.redisGet.mockResolvedValue(String(Date.now() - 120000))

      const res = await app.request('/api/dashboard/health')

      expect(res.status).toBe(200)
      const body = (await res.json()) as ApiResponse
      expect(body.data.services.worker.status).toBe('down')
      expect(body.data.overall).toBe('critical')
    })

    it('returns unknown worker status when no heartbeat exists', async () => {
      mocks.redisGet.mockResolvedValue(null)

      const res = await app.request('/api/dashboard/health')

      expect(res.status).toBe(200)
      const body = (await res.json()) as ApiResponse
      expect(body.data.services.worker.status).toBe('unknown')
      expect(body.data.overall).toBe('degraded')
    })

    it('returns degraded status when credentials are expiring', async () => {
      const expiresAt = new Date(Date.now() + 3 * 24 * 60 * 60 * 1000) // 3 days
      mocks.credentialFindMany.mockResolvedValue([
        { id: 'cred-1', name: 'S3', provider: 's3', expiresAt },
      ])

      const res = await app.request('/api/dashboard/health')

      expect(res.status).toBe(200)
      const body = (await res.json()) as ApiResponse
      expect(body.data.services.storage).toHaveLength(1)
      expect(body.data.services.storage[0].status).toBe('expiring')
      expect(body.data.overall).toBe('degraded')
    })

    it('returns expired status for expired credentials', async () => {
      const expiresAt = new Date(Date.now() - 24 * 60 * 60 * 1000) // 1 day ago
      mocks.credentialFindMany.mockResolvedValue([
        { id: 'cred-1', name: 'Old S3', provider: 's3', expiresAt },
      ])

      const res = await app.request('/api/dashboard/health')

      expect(res.status).toBe(200)
      const body = (await res.json()) as ApiResponse
      expect(body.data.services.storage[0].status).toBe('expired')
    })

    it('returns connected status for OAuth providers regardless of expiry', async () => {
      // OAuth providers use auto-renewing refresh tokens
      const expiresAt = new Date(Date.now() - 24 * 60 * 60 * 1000) // Expired
      mocks.credentialFindMany.mockResolvedValue([
        { id: 'cred-1', name: 'Drive', provider: 'google_drive', expiresAt },
      ])

      const res = await app.request('/api/dashboard/health')

      expect(res.status).toBe(200)
      const body = (await res.json()) as ApiResponse
      // OAuth provider should show connected (auto-renew)
      expect(body.data.services.storage[0].status).toBe('connected')
    })

    it('includes Redis memory info', async () => {
      mocks.redisInfo.mockResolvedValue('used_memory_human:256M\nused_memory_peak_human:512M')

      const res = await app.request('/api/dashboard/health')

      expect(res.status).toBe(200)
      const body = (await res.json()) as ApiResponse
      expect(body.data.services.redis.memoryUsed).toBe('256M')
    })

    it('returns 500 on database error', async () => {
      mocks.queryRaw.mockRejectedValue(new Error('Database connection lost'))

      const res = await app.request('/api/dashboard/health')

      expect(res.status).toBe(500)
      const body = (await res.json()) as ApiResponse
      expect(body.error).toBe('Failed to check system health')
    })
  })
})
