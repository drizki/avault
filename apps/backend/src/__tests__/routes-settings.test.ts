import { describe, it, expect, vi, beforeEach } from 'vitest'
import { Hono } from 'hono'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type ApiResponse = { success: boolean; data?: any; error?: string }

const mocks = vi.hoisted(() => ({
  settingsGetAll: vi.fn(),
  settingsGet: vi.fn(),
  settingsSet: vi.fn(),
  loggerInfo: vi.fn(),
  loggerError: vi.fn(),
  loggerWarn: vi.fn(),
  loggerDebug: vi.fn(),
}))

vi.mock('@avault/shared', async (importOriginal) => {
  const actual = await importOriginal()
  return {
    ...(actual as object),
    logger: {
      info: mocks.loggerInfo,
      error: mocks.loggerError,
      warn: mocks.loggerWarn,
      debug: mocks.loggerDebug,
    },
  }
})

vi.mock('../lib/settings', () => ({
  SettingsService: vi.fn().mockImplementation(() => ({
    getAll: mocks.settingsGetAll,
    get: mocks.settingsGet,
    set: mocks.settingsSet,
  })),
}))

// Mock auth middleware to allow testing routes directly
vi.mock('../middleware/auth', () => ({
  requireAuth: vi.fn().mockImplementation(async (c, next) => {
    c.set('userId', 'admin-123')
    c.set('userRole', 'ADMIN')
    await next()
  }),
  requireAdmin: vi.fn().mockImplementation(async (c, next) => {
    const role = c.get('userRole')
    if (role !== 'ADMIN') {
      return c.json({ success: false, error: 'Admin access required' }, 403)
    }
    await next()
  }),
}))

import settingsRoutes from '../routes/settings'

describe('settings routes', () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let app: Hono<any>

  beforeEach(() => {
    vi.clearAllMocks()
    app = new Hono()
    app.use('*', async (c, next) => {
      c.set('db', {}) // Mock db
      await next()
    })
    app.route('/api/settings', settingsRoutes)
  })

  describe('GET /api/settings', () => {
    it('returns all settings', async () => {
      const mockSettings = {
        backup_retention_days: 30,
        max_concurrent_jobs: 5,
        notification_enabled: true,
      }
      mocks.settingsGetAll.mockResolvedValue(mockSettings)

      const res = await app.request('/api/settings')

      expect(res.status).toBe(200)
      const body = (await res.json()) as ApiResponse
      expect(body.success).toBe(true)
      expect(body.data).toEqual(mockSettings)
    })

    it('returns 500 on error', async () => {
      mocks.settingsGetAll.mockRejectedValue(new Error('Database error'))

      const res = await app.request('/api/settings')

      expect(res.status).toBe(500)
      const body = (await res.json()) as ApiResponse
      expect(body.success).toBe(false)
      expect(body.error).toBe('Failed to fetch settings')
    })
  })

  describe('GET /api/settings/:key', () => {
    it('returns specific setting by key', async () => {
      mocks.settingsGet.mockResolvedValue(30)

      const res = await app.request('/api/settings/backup_retention_days')

      expect(res.status).toBe(200)
      const body = (await res.json()) as ApiResponse
      expect(body.success).toBe(true)
      expect(body.data).toEqual({
        key: 'backup_retention_days',
        value: 30,
      })
    })

    it('returns 404 when setting not found', async () => {
      mocks.settingsGet.mockResolvedValue(null)

      const res = await app.request('/api/settings/nonexistent_key')

      expect(res.status).toBe(404)
      const body = (await res.json()) as ApiResponse
      expect(body.success).toBe(false)
      expect(body.error).toBe('Setting not found')
    })

    it('returns 500 on error', async () => {
      mocks.settingsGet.mockRejectedValue(new Error('Database error'))

      const res = await app.request('/api/settings/some_key')

      expect(res.status).toBe(500)
      const body = (await res.json()) as ApiResponse
      expect(body.success).toBe(false)
      expect(body.error).toBe('Failed to fetch setting')
    })
  })

  describe('PUT /api/settings/:key', () => {
    it('updates setting value', async () => {
      mocks.settingsSet.mockResolvedValue(undefined)

      const res = await app.request('/api/settings/backup_retention_days', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ value: 60 }),
      })

      expect(res.status).toBe(200)
      const body = (await res.json()) as ApiResponse
      expect(body.success).toBe(true)
      expect(body.data).toEqual({
        key: 'backup_retention_days',
        value: 60,
      })
      expect(mocks.settingsSet).toHaveBeenCalledWith('backup_retention_days', 60, 'admin-123')
    })

    it('returns 400 when value is missing', async () => {
      const res = await app.request('/api/settings/some_key', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      })

      expect(res.status).toBe(400)
      const body = (await res.json()) as ApiResponse
      expect(body.success).toBe(false)
      expect(body.error).toBe('Value is required')
    })

    it('handles boolean values', async () => {
      mocks.settingsSet.mockResolvedValue(undefined)

      const res = await app.request('/api/settings/notifications_enabled', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ value: false }),
      })

      expect(res.status).toBe(200)
      const body = (await res.json()) as ApiResponse
      expect(body.data.value).toBe(false)
    })

    it('handles object values', async () => {
      mocks.settingsSet.mockResolvedValue(undefined)

      const complexValue = { smtp: { host: 'mail.example.com', port: 587 } }
      const res = await app.request('/api/settings/email_config', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ value: complexValue }),
      })

      expect(res.status).toBe(200)
      const body = (await res.json()) as ApiResponse
      expect(body.data.value).toEqual(complexValue)
    })

    it('returns 500 on error', async () => {
      mocks.settingsSet.mockRejectedValue(new Error('Database error'))

      const res = await app.request('/api/settings/some_key', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ value: 'test' }),
      })

      expect(res.status).toBe(500)
      const body = (await res.json()) as ApiResponse
      expect(body.success).toBe(false)
      expect(body.error).toBe('Failed to update setting')
    })
  })
})
