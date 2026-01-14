import { describe, it, expect, vi, beforeEach } from 'vitest'
import { Hono } from 'hono'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type ApiResponse = { success: boolean; data?: any; error?: string; pagination?: any }

const mocks = vi.hoisted(() => ({
  historyFindMany: vi.fn(),
  historyCount: vi.fn(),
  historyFindFirst: vi.fn(),
  loggerInfo: vi.fn(),
  loggerError: vi.fn(),
}))

vi.mock('@avault/shared', async (importOriginal) => {
  const actual = await importOriginal()
  return {
    ...(actual as object),
    logger: {
      info: mocks.loggerInfo,
      error: mocks.loggerError,
    },
  }
})

const mockDb = {
  backupHistory: {
    findMany: mocks.historyFindMany,
    count: mocks.historyCount,
    findFirst: mocks.historyFindFirst,
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

import historyRoutes from '../routes/history'

describe('history routes', () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let app: Hono<any>

  beforeEach(() => {
    vi.clearAllMocks()
    mocks.historyFindMany.mockResolvedValue([])
    mocks.historyCount.mockResolvedValue(0)

    app = new Hono()
    app.use('*', async (c, next) => {
      c.set('db', mockDb)
      await next()
    })
    app.route('/api/history', historyRoutes)
  })

  describe('GET /api/history', () => {
    it('returns paginated history list', async () => {
      const mockHistory = [
        {
          id: 'hist-1',
          jobId: 'job-1',
          status: 'SUCCESS',
          startedAt: new Date('2024-01-15T10:00:00Z'),
          completedAt: new Date('2024-01-15T10:30:00Z'),
          bytesUploaded: BigInt(1024000),
          job: {
            id: 'job-1',
            name: 'Daily Backup',
            sourcePath: '/data',
            destination: { id: 'dest-1', name: 'S3 Bucket', provider: 's3' },
          },
        },
      ]
      mocks.historyFindMany.mockResolvedValue(mockHistory)
      mocks.historyCount.mockResolvedValue(1)

      const res = await app.request('/api/history')

      expect(res.status).toBe(200)
      const body = (await res.json()) as ApiResponse
      expect(body.success).toBe(true)
      expect(body.data.data).toHaveLength(1)
      expect(body.data.data[0].bytesUploaded).toBe('1024000')
      expect(body.data.pagination).toEqual({
        page: 1,
        pageSize: 20,
        total: 1,
        totalPages: 1,
      })
    })

    it('filters by jobId', async () => {
      const jobId = 'clxxxxxxxxxxxxxxxxx123456' // Valid CUID format
      const res = await app.request(`/api/history?jobId=${jobId}`)
      const body = (await res.json()) as ApiResponse

      expect(res.status).toBe(200)
      expect(body.success).toBe(true)
      expect(mocks.historyFindMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            jobId,
          }),
        })
      )
    })

    it('filters by status', async () => {
      mocks.historyFindMany.mockResolvedValue([])
      mocks.historyCount.mockResolvedValue(0)

      await app.request('/api/history?status=FAILED')

      expect(mocks.historyFindMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            status: 'FAILED',
          }),
        })
      )
    })

    it('handles custom pagination', async () => {
      mocks.historyFindMany.mockResolvedValue([])
      mocks.historyCount.mockResolvedValue(100)

      const res = await app.request('/api/history?page=3&pageSize=10')

      const body = (await res.json()) as ApiResponse
      expect(body.data.pagination).toEqual({
        page: 3,
        pageSize: 10,
        total: 100,
        totalPages: 10,
      })
      expect(mocks.historyFindMany).toHaveBeenCalledWith(
        expect.objectContaining({
          take: 10,
          skip: 20, // (3-1) * 10
        })
      )
    })

    it('only returns user own history', async () => {
      mocks.historyFindMany.mockResolvedValue([])
      mocks.historyCount.mockResolvedValue(0)

      await app.request('/api/history')

      expect(mocks.historyFindMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            job: { userId: 'user-123' },
          }),
        })
      )
    })
  })

  describe('GET /api/history/:id', () => {
    it('returns single history entry', async () => {
      const mockEntry = {
        id: 'hist-1',
        jobId: 'job-1',
        status: 'SUCCESS',
        bytesUploaded: BigInt(2048000),
        job: {
          id: 'job-1',
          name: 'Daily Backup',
        },
      }
      mocks.historyFindFirst.mockResolvedValue(mockEntry)

      const res = await app.request('/api/history/hist-1')

      expect(res.status).toBe(200)
      const body = (await res.json()) as ApiResponse
      expect(body.success).toBe(true)
      expect(body.data.id).toBe('hist-1')
      expect(body.data.bytesUploaded).toBe('2048000')
    })

    it('returns 404 when entry not found', async () => {
      mocks.historyFindFirst.mockResolvedValue(null)

      const res = await app.request('/api/history/nonexistent')

      expect(res.status).toBe(404)
      const body = (await res.json()) as ApiResponse
      expect(body.success).toBe(false)
      expect(body.error).toBe('History entry not found')
    })

    it('only returns user own entry', async () => {
      mocks.historyFindFirst.mockResolvedValue(null)

      await app.request('/api/history/hist-1')

      expect(mocks.historyFindFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            id: 'hist-1',
            job: { userId: 'user-123' },
          }),
        })
      )
    })
  })
})
