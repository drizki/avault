import { describe, it, expect, beforeEach } from 'vitest'
import { Hono } from 'hono'
import { requireAuth, requireAdmin, optionalAuth } from '../middleware/auth'
import { generateToken } from '../lib/auth/jwt'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type ApiResponse = { success: boolean; data?: any; error?: string; userId?: string; userRole?: string }

describe('auth middleware', () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let app: Hono<any>

  beforeEach(() => {
    app = new Hono()
  })

  describe('requireAuth', () => {
    it('returns 401 when no cookie header', async () => {
      app.use('*', requireAuth)
      app.get('/', (c) => c.json({ success: true }))

      const res = await app.request('/')

      expect(res.status).toBe(401)
      const body = await res.json() as ApiResponse
      expect(body.error).toBe('Authentication required')
    })

    it('returns 401 when no auth_token cookie', async () => {
      app.use('*', requireAuth)
      app.get('/', (c) => c.json({ success: true }))

      const res = await app.request('/', {
        headers: { cookie: 'other_cookie=value' },
      })

      expect(res.status).toBe(401)
    })

    it('returns 401 when token is invalid', async () => {
      app.use('*', requireAuth)
      app.get('/', (c) => c.json({ success: true }))

      const res = await app.request('/', {
        headers: { cookie: 'auth_token=invalid-token' },
      })

      expect(res.status).toBe(401)
      const body = await res.json() as ApiResponse
      expect(body.error).toBe('Invalid or expired token')
    })

    it('allows request with valid token', async () => {
      const token = await generateToken({
        userId: 'user-123',
        email: 'test@example.com',
        role: 'USER',
      })

      app.use('*', requireAuth)
      app.get('/', (c) => c.json({ success: true, userId: c.get('userId') }))

      const res = await app.request('/', {
        headers: { cookie: `auth_token=${token}` },
      })

      expect(res.status).toBe(200)
      const body = await res.json() as ApiResponse
      expect(body.userId).toBe('user-123')
    })

    it('sets userId and userRole in context', async () => {
      const token = await generateToken({
        userId: 'admin-456',
        email: 'admin@example.com',
        role: 'ADMIN',
      })

      app.use('*', requireAuth)
      app.get('/', (c) =>
        c.json({
          userId: c.get('userId'),
          userRole: c.get('userRole'),
        })
      )

      const res = await app.request('/', {
        headers: { cookie: `auth_token=${token}` },
      })

      const body = await res.json() as ApiResponse
      expect(body.userId).toBe('admin-456')
      expect(body.userRole).toBe('ADMIN')
    })
  })

  describe('requireAdmin', () => {
    it('returns 403 when user is not admin', async () => {
      const token = await generateToken({
        userId: 'user-123',
        email: 'user@example.com',
        role: 'USER',
      })

      app.use('*', requireAuth)
      app.use('*', requireAdmin)
      app.get('/', (c) => c.json({ success: true }))

      const res = await app.request('/', {
        headers: { cookie: `auth_token=${token}` },
      })

      expect(res.status).toBe(403)
      const body = await res.json() as ApiResponse
      expect(body.error).toBe('Admin access required')
    })

    it('allows admin users', async () => {
      const token = await generateToken({
        userId: 'admin-123',
        email: 'admin@example.com',
        role: 'ADMIN',
      })

      app.use('*', requireAuth)
      app.use('*', requireAdmin)
      app.get('/', (c) => c.json({ success: true }))

      const res = await app.request('/', {
        headers: { cookie: `auth_token=${token}` },
      })

      expect(res.status).toBe(200)
    })
  })

  describe('optionalAuth', () => {
    it('allows request without token', async () => {
      app.use('*', optionalAuth)
      app.get('/', (c) => c.json({ userId: c.get('userId') || 'anonymous' }))

      const res = await app.request('/')

      expect(res.status).toBe(200)
      const body = await res.json() as ApiResponse
      expect(body.userId).toBe('anonymous')
    })

    it('extracts user when valid token present', async () => {
      const token = await generateToken({
        userId: 'user-789',
        email: 'test@example.com',
        role: 'USER',
      })

      app.use('*', optionalAuth)
      app.get('/', (c) => c.json({ userId: c.get('userId') || 'anonymous' }))

      const res = await app.request('/', {
        headers: { cookie: `auth_token=${token}` },
      })

      expect(res.status).toBe(200)
      const body = await res.json() as ApiResponse
      expect(body.userId).toBe('user-789')
    })

    it('continues without user when token is invalid', async () => {
      app.use('*', optionalAuth)
      app.get('/', (c) => c.json({ userId: c.get('userId') || 'anonymous' }))

      const res = await app.request('/', {
        headers: { cookie: 'auth_token=invalid-token' },
      })

      expect(res.status).toBe(200)
      const body = await res.json() as ApiResponse
      expect(body.userId).toBe('anonymous')
    })
  })
})
