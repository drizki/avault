import { describe, it, expect, vi, beforeEach } from 'vitest'
import { Hono } from 'hono'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type ApiResponse = { success: boolean; data?: any; error?: string; details?: string }

const mocks = vi.hoisted(() => ({
  getQueueStats: vi.fn(),
}))

vi.mock('../lib/queue', () => ({
  getQueueStats: mocks.getQueueStats,
}))

vi.mock('../middleware/auth', () => ({
  requireAuth: vi.fn().mockImplementation(async (c, next) => {
    c.set('userId', 'user-123')
    c.set('userRole', 'USER')
    await next()
  }),
}))

import queueRoutes from '../routes/queue'

describe('queue routes', () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let app: Hono<any>

  beforeEach(() => {
    vi.clearAllMocks()
    app = new Hono()
    app.route('/api/queue', queueRoutes)
  })

  describe('GET /api/queue/status', () => {
    it('returns queue statistics', async () => {
      const mockStats = {
        waiting: 5,
        active: 2,
        completed: 100,
        failed: 3,
        delayed: 1,
      }
      mocks.getQueueStats.mockResolvedValue(mockStats)

      const res = await app.request('/api/queue/status')

      expect(res.status).toBe(200)
      const body = await res.json() as ApiResponse
      expect(body.success).toBe(true)
      expect(body.data).toEqual(mockStats)
    })

    it('returns 500 on error', async () => {
      mocks.getQueueStats.mockRejectedValue(new Error('Redis connection failed'))

      const res = await app.request('/api/queue/status')

      expect(res.status).toBe(500)
      const body = await res.json() as ApiResponse
      expect(body.success).toBe(false)
      expect(body.error).toBe('Failed to get queue status')
      expect(body.details).toBe('Redis connection failed')
    })
  })
})
