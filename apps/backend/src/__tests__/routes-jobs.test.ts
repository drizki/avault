import { describe, it, expect, vi, beforeEach } from 'vitest'
import { Hono } from 'hono'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type ApiResponse = { success: boolean; data?: any; error?: string; message?: string }

const mocks = vi.hoisted(() => ({
  jobFindMany: vi.fn(),
  jobFindFirst: vi.fn(),
  jobCreate: vi.fn(),
  jobUpdate: vi.fn(),
  jobDelete: vi.fn(),
  historyFindMany: vi.fn(),
  historyFindFirst: vi.fn(),
  historyCreate: vi.fn(),
  historyUpdate: vi.fn(),
  getActiveJobs: vi.fn(),
  cleanupStuckJobs: vi.fn(),
  queueBackupJob: vi.fn(),
  findQueueJobByHistoryId: vi.fn(),
  cancelQueueJob: vi.fn(),
  getNextRunTime: vi.fn(),
  systemLogInfo: vi.fn(),
  loggerInfo: vi.fn(),
  loggerWarn: vi.fn(),
  loggerError: vi.fn(),
}))

vi.mock('@avault/shared', async (importOriginal) => {
  const actual = await importOriginal()
  return {
    ...(actual as object),
    logger: {
      info: mocks.loggerInfo,
      warn: mocks.loggerWarn,
      error: mocks.loggerError,
      debug: vi.fn(),
    },
  }
})

vi.mock('../lib/queue', () => ({
  queueBackupJob: mocks.queueBackupJob,
  findQueueJobByHistoryId: mocks.findQueueJobByHistoryId,
  cancelQueueJob: mocks.cancelQueueJob,
  cleanupStuckJobs: mocks.cleanupStuckJobs,
  getActiveJobs: mocks.getActiveJobs,
}))

vi.mock('../lib/log-stream', () => ({
  systemLog: {
    info: mocks.systemLogInfo,
  },
}))

vi.mock('../lib/scheduler/cron-utils', () => ({
  getNextRunTime: mocks.getNextRunTime,
}))

const mockDb = {
  backupJob: {
    findMany: mocks.jobFindMany,
    findFirst: mocks.jobFindFirst,
    create: mocks.jobCreate,
    update: mocks.jobUpdate,
    delete: mocks.jobDelete,
  },
  backupHistory: {
    findMany: mocks.historyFindMany,
    findFirst: mocks.historyFindFirst,
    create: mocks.historyCreate,
    update: mocks.historyUpdate,
  },
}

vi.mock('../middleware/auth', () => ({
  requireAuth: vi.fn().mockImplementation(async (c, next) => {
    c.set('userId', 'user-123')
    c.set('userRole', 'USER')
    c.set('db', mockDb)
    await next()
  }),
}))

import jobsRoutes from '../routes/jobs'

describe('jobs routes', () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let app: Hono<any>

  beforeEach(() => {
    vi.clearAllMocks()
    app = new Hono()
    app.use('*', async (c, next) => {
      c.set('db', mockDb)
      await next()
    })
    app.route('/api/jobs', jobsRoutes)
  })

  describe('GET /api/jobs', () => {
    it('returns list of user jobs', async () => {
      const mockJobs = [
        { id: 'job-1', name: 'Daily Backup', destination: { id: 'dest-1' }, credential: { id: 'cred-1' } },
      ]
      mocks.jobFindMany.mockResolvedValue(mockJobs)

      const res = await app.request('/api/jobs')

      expect(res.status).toBe(200)
      const body = await res.json() as ApiResponse
      expect(body.success).toBe(true)
      expect(body.data).toHaveLength(1)
    })

    it('only returns user own jobs', async () => {
      mocks.jobFindMany.mockResolvedValue([])

      await app.request('/api/jobs')

      expect(mocks.jobFindMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { userId: 'user-123' },
        })
      )
    })
  })

  describe('GET /api/jobs/queue/active', () => {
    it('returns active queue jobs', async () => {
      mocks.getActiveJobs.mockResolvedValue([{ id: '1', name: 'backup' }])

      const res = await app.request('/api/jobs/queue/active')

      expect(res.status).toBe(200)
      const body = await res.json() as ApiResponse
      expect(body.success).toBe(true)
    })

    it('returns 500 on error', async () => {
      mocks.getActiveJobs.mockRejectedValue(new Error('Queue error'))

      const res = await app.request('/api/jobs/queue/active')

      expect(res.status).toBe(500)
    })
  })

  describe('POST /api/jobs/queue/cleanup', () => {
    it('cleans up stuck jobs', async () => {
      mocks.cleanupStuckJobs.mockResolvedValue({ cleanedCount: 2, checkedCount: 5 })

      const res = await app.request('/api/jobs/queue/cleanup', { method: 'POST' })

      expect(res.status).toBe(200)
      const body = await res.json() as ApiResponse
      expect(body.data.cleanedCount).toBe(2)
    })

    it('accepts maxAge parameter', async () => {
      mocks.cleanupStuckJobs.mockResolvedValue({ cleanedCount: 0, checkedCount: 0 })

      await app.request('/api/jobs/queue/cleanup?maxAge=30', { method: 'POST' })

      expect(mocks.cleanupStuckJobs).toHaveBeenCalledWith(30)
    })

    it('returns 500 on cleanup error', async () => {
      mocks.cleanupStuckJobs.mockRejectedValue(new Error('Redis connection failed'))

      const res = await app.request('/api/jobs/queue/cleanup', { method: 'POST' })

      expect(res.status).toBe(500)
      const body = await res.json() as ApiResponse
      expect(body.error).toBe('Failed to cleanup stuck jobs')
    })
  })

  describe('POST /api/jobs/history/:historyId/cancel', () => {
    it('cancels pending job', async () => {
      mocks.historyFindFirst.mockResolvedValue({
        id: 'hist-1',
        status: 'PENDING',
        job: { userId: 'user-123' },
      })
      mocks.findQueueJobByHistoryId.mockResolvedValue({ id: 'queue-1' })
      mocks.cancelQueueJob.mockResolvedValue({ success: true })
      mocks.historyUpdate.mockResolvedValue({})

      const res = await app.request('/api/jobs/history/hist-1/cancel', { method: 'POST' })

      expect(res.status).toBe(200)
      const body = await res.json() as ApiResponse
      expect(body.message).toBe('Job cancelled')
    })

    it('returns 404 when history not found', async () => {
      mocks.historyFindFirst.mockResolvedValue(null)

      const res = await app.request('/api/jobs/history/nonexistent/cancel', { method: 'POST' })

      expect(res.status).toBe(404)
    })

    it('returns 400 when job already completed', async () => {
      mocks.historyFindFirst.mockResolvedValue({
        id: 'hist-1',
        status: 'SUCCESS',
        job: { userId: 'user-123' },
      })

      const res = await app.request('/api/jobs/history/hist-1/cancel', { method: 'POST' })

      expect(res.status).toBe(400)
      const body = await res.json() as ApiResponse
      expect(body.error).toContain('success')
    })

    it('returns 500 when cancellation fails', async () => {
      mocks.historyFindFirst.mockResolvedValue({
        id: 'hist-1',
        status: 'PENDING',
        job: { userId: 'user-123' },
      })
      mocks.findQueueJobByHistoryId.mockRejectedValue(new Error('Queue error'))

      const res = await app.request('/api/jobs/history/hist-1/cancel', { method: 'POST' })

      expect(res.status).toBe(500)
      const body = await res.json() as ApiResponse
      expect(body.error).toBe('Failed to cancel job')
    })

    it('logs warning when queue job cancellation fails but still succeeds', async () => {
      mocks.historyFindFirst.mockResolvedValue({
        id: 'hist-1',
        status: 'PENDING',
        jobId: 'job-1',
        job: { userId: 'user-123' },
      })
      mocks.findQueueJobByHistoryId.mockResolvedValue({ id: 'queue-job-1' })
      mocks.cancelQueueJob.mockResolvedValue({ success: false, error: 'Job already processed' })
      mocks.historyUpdate.mockResolvedValue({})

      const res = await app.request('/api/jobs/history/hist-1/cancel', { method: 'POST' })

      // Should still succeed despite queue job cancellation warning
      expect(res.status).toBe(200)
      const body = await res.json() as ApiResponse
      expect(body.message).toBe('Job cancelled')
      expect(mocks.loggerWarn).toHaveBeenCalled()
    })
  })

  describe('POST /api/jobs', () => {
    it('creates backup job', async () => {
      const credentialId = 'clxxxxxxxxxxxxxxxxx123456'
      const destinationId = 'clxxxxxxxxxxxxxxxxx654321'

      mocks.getNextRunTime.mockReturnValue(new Date())
      mocks.jobCreate.mockResolvedValue({
        id: 'job-new',
        name: 'New Backup',
        schedule: '0 2 * * *',
        destination: {},
        credential: {},
      })

      const res = await app.request('/api/jobs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: 'New Backup',
          sourcePath: '/data',
          destinationId,
          credentialId,
          schedule: '0 2 * * *',
          retentionType: 'VERSION_COUNT',
          retentionCount: 5,
        }),
      })

      expect(res.status).toBe(201)
      const body = await res.json() as ApiResponse
      expect(body.success).toBe(true)
    })

    it('returns 400 when create fails', async () => {
      const credentialId = 'clxxxxxxxxxxxxxxxxx123456'
      const destinationId = 'clxxxxxxxxxxxxxxxxx654321'

      mocks.getNextRunTime.mockReturnValue(new Date())
      mocks.jobCreate.mockRejectedValue(new Error('Foreign key constraint failed'))

      const res = await app.request('/api/jobs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: 'New Backup',
          sourcePath: '/data',
          destinationId,
          credentialId,
          schedule: '0 2 * * *',
          retentionType: 'VERSION_COUNT',
          retentionCount: 5,
        }),
      })

      expect(res.status).toBe(400)
      const body = await res.json() as ApiResponse
      expect(body.error).toBe('Failed to create backup job')
    })
  })

  describe('GET /api/jobs/:id', () => {
    it('returns single job with history', async () => {
      mocks.jobFindFirst.mockResolvedValue({
        id: 'job-1',
        name: 'Daily Backup',
        destination: {},
        credential: {},
        history: [],
      })

      const res = await app.request('/api/jobs/job-1')

      expect(res.status).toBe(200)
      const body = await res.json() as ApiResponse
      expect(body.data.id).toBe('job-1')
    })

    it('returns 404 when not found', async () => {
      mocks.jobFindFirst.mockResolvedValue(null)

      const res = await app.request('/api/jobs/nonexistent')

      expect(res.status).toBe(404)
    })
  })

  describe('PATCH /api/jobs/:id', () => {
    it('updates job', async () => {
      mocks.jobFindFirst.mockResolvedValue({
        id: 'job-1',
        schedule: '0 2 * * *',
        enabled: true,
      })
      mocks.jobUpdate.mockResolvedValue({
        id: 'job-1',
        name: 'Updated Backup',
        destination: {},
        credential: {},
      })

      const res = await app.request('/api/jobs/job-1', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'Updated Backup' }),
      })

      expect(res.status).toBe(200)
      const body = await res.json() as ApiResponse
      expect(body.data.name).toBe('Updated Backup')
    })

    it('recalculates nextRunAt when schedule changes', async () => {
      const newNextRunAt = new Date('2024-01-16T02:00:00Z')
      mocks.jobFindFirst.mockResolvedValue({
        id: 'job-1',
        schedule: '0 2 * * *',
        enabled: true,
      })
      mocks.getNextRunTime.mockReturnValue(newNextRunAt)
      mocks.jobUpdate.mockResolvedValue({
        id: 'job-1',
        schedule: '0 3 * * *',
        nextRunAt: newNextRunAt,
        destination: {},
        credential: {},
      })

      await app.request('/api/jobs/job-1', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ schedule: '0 3 * * *' }),
      })

      expect(mocks.getNextRunTime).toHaveBeenCalledWith('0 3 * * *')
    })

    it('returns 404 when job not found', async () => {
      mocks.jobFindFirst.mockResolvedValue(null)

      const res = await app.request('/api/jobs/nonexistent', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'Test' }),
      })

      expect(res.status).toBe(404)
    })

    it('returns 400 when update fails', async () => {
      mocks.jobFindFirst.mockResolvedValue({
        id: 'job-1',
        schedule: '0 2 * * *',
        enabled: true,
      })
      mocks.jobUpdate.mockRejectedValue(new Error('Database error'))

      const res = await app.request('/api/jobs/job-1', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'Updated Backup' }),
      })

      expect(res.status).toBe(400)
      const body = await res.json() as ApiResponse
      expect(body.error).toBe('Failed to update job')
    })
  })

  describe('DELETE /api/jobs/:id', () => {
    it('deletes job', async () => {
      mocks.jobFindFirst.mockResolvedValue({ id: 'job-1', userId: 'user-123' })
      mocks.jobDelete.mockResolvedValue({})

      const res = await app.request('/api/jobs/job-1', { method: 'DELETE' })

      expect(res.status).toBe(200)
      const body = await res.json() as ApiResponse
      expect(body.message).toBe('Job deleted successfully')
    })

    it('returns 404 when not found', async () => {
      mocks.jobFindFirst.mockResolvedValue(null)

      const res = await app.request('/api/jobs/nonexistent', { method: 'DELETE' })

      expect(res.status).toBe(404)
    })

    it('returns 500 when delete fails', async () => {
      mocks.jobFindFirst.mockResolvedValue({ id: 'job-1', userId: 'user-123' })
      mocks.jobDelete.mockRejectedValue(new Error('Database error'))

      const res = await app.request('/api/jobs/job-1', { method: 'DELETE' })

      expect(res.status).toBe(500)
      const body = await res.json() as ApiResponse
      expect(body.error).toBe('Failed to delete job')
    })
  })

  describe('POST /api/jobs/:id/run', () => {
    it('triggers manual job run', async () => {
      mocks.jobFindFirst.mockResolvedValue({
        id: 'job-1',
        name: 'Daily Backup',
        sourcePath: '/data',
        destinationId: 'dest-1',
        credentialId: 'cred-1',
        namePattern: 'backup-{date}',
        retentionType: 'VERSION_COUNT',
        retentionCount: 5,
        destination: {},
        credential: {},
      })
      mocks.historyCreate.mockResolvedValue({ id: 'hist-new' })
      mocks.queueBackupJob.mockResolvedValue({})

      const res = await app.request('/api/jobs/job-1/run', { method: 'POST' })

      expect(res.status).toBe(200)
      const body = await res.json() as ApiResponse
      expect(body.data.historyId).toBe('hist-new')
    })

    it('returns 404 when job not found', async () => {
      mocks.jobFindFirst.mockResolvedValue(null)

      const res = await app.request('/api/jobs/nonexistent/run', { method: 'POST' })

      expect(res.status).toBe(404)
    })

    it('returns 500 on queue error', async () => {
      mocks.jobFindFirst.mockResolvedValue({
        id: 'job-1',
        name: 'Backup',
        destination: {},
        credential: {},
      })
      mocks.historyCreate.mockResolvedValue({ id: 'hist-new' })
      mocks.queueBackupJob.mockRejectedValue(new Error('Queue unavailable'))

      const res = await app.request('/api/jobs/job-1/run', { method: 'POST' })

      expect(res.status).toBe(500)
    })
  })

  describe('GET /api/jobs/:id/history', () => {
    it('returns job history', async () => {
      mocks.jobFindFirst.mockResolvedValue({ id: 'job-1', userId: 'user-123' })
      mocks.historyFindMany.mockResolvedValue([
        { id: 'hist-1', status: 'SUCCESS' },
        { id: 'hist-2', status: 'FAILED' },
      ])

      const res = await app.request('/api/jobs/job-1/history')

      expect(res.status).toBe(200)
      const body = await res.json() as ApiResponse
      expect(body.data).toHaveLength(2)
    })

    it('returns 404 when job not found', async () => {
      mocks.jobFindFirst.mockResolvedValue(null)

      const res = await app.request('/api/jobs/nonexistent/history')

      expect(res.status).toBe(404)
    })
  })
})
