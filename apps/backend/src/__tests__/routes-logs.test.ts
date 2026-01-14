import { describe, it, expect, vi, beforeEach } from 'vitest'
import { Hono } from 'hono'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type ApiResponse = { success: boolean; data?: any; error?: string }

const mocks = vi.hoisted(() => ({
  logEntryDeleteMany: vi.fn(),
  logEntryFindMany: vi.fn(),
  backupHistoryFindFirst: vi.fn(),
  verifyToken: vi.fn(),
  loggerInfo: vi.fn(),
  loggerError: vi.fn(),
  loggerDebug: vi.fn(),
}))

vi.mock('@avault/shared', async (importOriginal) => {
  const actual = await importOriginal()
  return {
    ...(actual as object),
    createRedisConnection: vi.fn(),
    logger: {
      info: mocks.loggerInfo,
      error: mocks.loggerError,
      debug: mocks.loggerDebug,
      warn: vi.fn(),
    },
  }
})

vi.mock('../lib/auth/jwt', () => ({
  verifyToken: mocks.verifyToken,
}))

const mockDb = {
  logEntry: {
    deleteMany: mocks.logEntryDeleteMany,
    findMany: mocks.logEntryFindMany,
  },
  backupHistory: {
    findFirst: mocks.backupHistoryFindFirst,
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

import logsRoutes from '../routes/logs'

describe('logs routes', () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let app: Hono<any>

  beforeEach(() => {
    vi.clearAllMocks()
    app = new Hono()
    app.use('*', async (c, next) => {
      c.set('db', mockDb)
      await next()
    })
    app.route('/api/logs', logsRoutes)
  })

  describe('GET /api/logs (SSE stream)', () => {
    it('returns 401 when no token provided', async () => {
      const res = await app.request('/api/logs')

      expect(res.status).toBe(401)
      const body = (await res.json()) as ApiResponse
      expect(body.error).toBe('Authentication required')
    })

    it('returns 401 when token is invalid', async () => {
      mocks.verifyToken.mockResolvedValue(null)

      const res = await app.request('/api/logs?token=invalid-token')

      expect(res.status).toBe(401)
      const body = (await res.json()) as ApiResponse
      expect(body.error).toBe('Invalid or expired token')
    })
  })

  describe('GET /api/logs/:historyId (SSE stream)', () => {
    it('returns 401 when no token provided', async () => {
      const res = await app.request('/api/logs/history-123')

      expect(res.status).toBe(401)
      const body = (await res.json()) as ApiResponse
      expect(body.error).toBe('Authentication required')
    })

    it('returns 401 when token is invalid', async () => {
      mocks.verifyToken.mockResolvedValue(null)

      const res = await app.request('/api/logs/history-123?token=invalid')

      expect(res.status).toBe(401)
      const body = (await res.json()) as ApiResponse
      expect(body.error).toBe('Invalid or expired token')
    })

    it('returns 404 when history entry not found', async () => {
      mocks.verifyToken.mockResolvedValue({ userId: 'user-123' })
      mocks.backupHistoryFindFirst.mockResolvedValue(null)

      const res = await app.request('/api/logs/nonexistent?token=valid-token')

      expect(res.status).toBe(404)
      const body = (await res.json()) as ApiResponse
      expect(body.error).toBe('History entry not found')
    })
  })

  describe('DELETE /api/logs', () => {
    it('deletes all user logs', async () => {
      mocks.logEntryDeleteMany.mockResolvedValue({ count: 50 })

      const res = await app.request('/api/logs', { method: 'DELETE' })

      expect(res.status).toBe(200)
      const body = (await res.json()) as ApiResponse
      expect(body.success).toBe(true)
      expect(body.data.deletedCount).toBe(50)
    })

    it('only deletes user own logs', async () => {
      mocks.logEntryDeleteMany.mockResolvedValue({ count: 0 })

      await app.request('/api/logs', { method: 'DELETE' })

      expect(mocks.logEntryDeleteMany).toHaveBeenCalledWith({
        where: { userId: 'user-123' },
      })
    })

    it('returns 500 on error', async () => {
      mocks.logEntryDeleteMany.mockRejectedValue(new Error('Database error'))

      const res = await app.request('/api/logs', { method: 'DELETE' })

      expect(res.status).toBe(500)
      const body = (await res.json()) as ApiResponse
      expect(body.error).toBe('Failed to delete logs')
    })
  })
})
