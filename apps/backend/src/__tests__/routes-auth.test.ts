import { describe, it, expect, vi, beforeEach } from 'vitest'
import { Hono } from 'hono'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type ApiResponse = { success: boolean; data?: any; error?: string; user?: any; message?: string }

const mocks = vi.hoisted(() => ({
  userFindUnique: vi.fn(),
  userCount: vi.fn(),
  userUpsert: vi.fn(),
  redisSetex: vi.fn(),
  redisGet: vi.fn(),
  redisDel: vi.fn(),
  generateAuthUrl: vi.fn(),
  exchangeCodeForTokens: vi.fn(),
  getUserInfo: vi.fn(),
  generateToken: vi.fn(),
  verifyToken: vi.fn(),
  getTokenFromCookie: vi.fn(),
  settingsAreSignupsAllowed: vi.fn(),
  settingsSet: vi.fn(),
  settingsInitializeDefaults: vi.fn(),
  credentialCreate: vi.fn(),
  encrypt: vi.fn(),
  loggerInfo: vi.fn(),
  loggerError: vi.fn(),
}))

vi.mock('@avault/shared', async (importOriginal) => {
  const actual = await importOriginal()
  return {
    ...(actual as object),
    getRedis: vi.fn().mockReturnValue({
      setex: mocks.redisSetex,
      get: mocks.redisGet,
      del: mocks.redisDel,
    }),
    logger: {
      info: mocks.loggerInfo,
      error: mocks.loggerError,
      warn: vi.fn(),
      debug: vi.fn(),
    },
  }
})

vi.mock('../lib/auth/google', () => ({
  GoogleOAuthClient: vi.fn().mockImplementation(() => ({
    generateAuthUrl: mocks.generateAuthUrl,
    exchangeCodeForTokens: mocks.exchangeCodeForTokens,
    getUserInfo: mocks.getUserInfo,
  })),
}))

vi.mock('../lib/auth/jwt', () => ({
  generateToken: mocks.generateToken,
  verifyToken: mocks.verifyToken,
  getTokenFromCookie: mocks.getTokenFromCookie,
}))

vi.mock('../lib/settings', () => ({
  SettingsService: vi.fn().mockImplementation(() => ({
    areSignupsAllowed: mocks.settingsAreSignupsAllowed,
    set: mocks.settingsSet,
    initializeDefaults: mocks.settingsInitializeDefaults,
  })),
}))

vi.mock('../lib/crypto/encryption', () => ({
  encrypt: mocks.encrypt,
}))

const mockDb = {
  user: {
    findUnique: mocks.userFindUnique,
    count: mocks.userCount,
    upsert: mocks.userUpsert,
  },
  storageCredential: {
    create: mocks.credentialCreate,
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

import authRoutes from '../routes/auth'

describe('auth routes', () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let app: Hono<any>

  beforeEach(() => {
    vi.clearAllMocks()
    app = new Hono()
    app.use('*', async (c, next) => {
      c.set('db', mockDb)
      await next()
    })
    app.route('/api/auth', authRoutes)
  })

  describe('POST /api/auth/login/google', () => {
    it('initiates OAuth flow and returns auth URL', async () => {
      mocks.generateAuthUrl.mockReturnValue('https://accounts.google.com/oauth')
      mocks.redisSetex.mockResolvedValue('OK')

      const res = await app.request('/api/auth/login/google', { method: 'POST' })

      expect(res.status).toBe(200)
      const body = (await res.json()) as ApiResponse
      expect(body.success).toBe(true)
      expect(body.data.authUrl).toBe('https://accounts.google.com/oauth')
      expect(body.data.state).toBeDefined()
    })

    it('stores state in Redis with TTL', async () => {
      mocks.generateAuthUrl.mockReturnValue('https://accounts.google.com/oauth')
      mocks.redisSetex.mockResolvedValue('OK')

      await app.request('/api/auth/login/google', { method: 'POST' })

      expect(mocks.redisSetex).toHaveBeenCalledWith(
        expect.stringMatching(/^oauth:state:/),
        600,
        expect.any(String)
      )
    })

    it('returns 500 on error', async () => {
      mocks.redisSetex.mockRejectedValue(new Error('Redis error'))

      const res = await app.request('/api/auth/login/google', { method: 'POST' })

      expect(res.status).toBe(500)
    })
  })

  describe('POST /api/auth/logout', () => {
    it('clears auth cookie and returns success', async () => {
      const res = await app.request('/api/auth/logout', { method: 'POST' })

      expect(res.status).toBe(200)
      const body = (await res.json()) as ApiResponse
      expect(body.success).toBe(true)
      expect(body.message).toBe('Logged out successfully')
    })

    it('sets cookie deletion header', async () => {
      const res = await app.request('/api/auth/logout', { method: 'POST' })

      const setCookieHeader = res.headers.get('set-cookie')
      expect(setCookieHeader).toContain('auth_token=')
    })
  })

  describe('GET /api/auth/me', () => {
    it('returns current user info', async () => {
      const mockUser = {
        id: 'user-123',
        email: 'test@example.com',
        name: 'Test User',
        avatarUrl: 'https://example.com/avatar.png',
        role: 'USER',
        createdAt: new Date(),
        lastLoginAt: new Date(),
      }
      mocks.userFindUnique.mockResolvedValue(mockUser)

      const res = await app.request('/api/auth/me')

      expect(res.status).toBe(200)
      const body = (await res.json()) as ApiResponse
      expect(body.success).toBe(true)
      expect(body.data.email).toBe('test@example.com')
    })

    it('returns 404 when user not found', async () => {
      mocks.userFindUnique.mockResolvedValue(null)

      const res = await app.request('/api/auth/me')

      expect(res.status).toBe(404)
      const body = (await res.json()) as ApiResponse
      expect(body.error).toBe('User not found')
    })

    it('returns 500 on error', async () => {
      mocks.userFindUnique.mockRejectedValue(new Error('DB error'))

      const res = await app.request('/api/auth/me')

      expect(res.status).toBe(500)
    })
  })

  describe('GET /api/auth/status', () => {
    it('returns initialized status', async () => {
      mocks.userCount.mockResolvedValue(5)
      mocks.settingsAreSignupsAllowed.mockResolvedValue(true)

      const res = await app.request('/api/auth/status')

      expect(res.status).toBe(200)
      const body = (await res.json()) as ApiResponse
      expect(body.success).toBe(true)
      expect(body.data.initialized).toBe(true)
      expect(body.data.allowSignups).toBe(true)
    })

    it('returns not initialized when no users', async () => {
      mocks.userCount.mockResolvedValue(0)
      mocks.settingsAreSignupsAllowed.mockResolvedValue(true)

      const res = await app.request('/api/auth/status')

      const body = (await res.json()) as ApiResponse
      expect(body.data.initialized).toBe(false)
    })

    it('returns signups disabled', async () => {
      mocks.userCount.mockResolvedValue(1)
      mocks.settingsAreSignupsAllowed.mockResolvedValue(false)

      const res = await app.request('/api/auth/status')

      const body = (await res.json()) as ApiResponse
      expect(body.data.allowSignups).toBe(false)
    })

    it('returns 500 on error', async () => {
      mocks.userCount.mockRejectedValue(new Error('DB error'))

      const res = await app.request('/api/auth/status')

      expect(res.status).toBe(500)
    })
  })

  describe('GET /api/auth/token', () => {
    it('returns token from cookie', async () => {
      mocks.getTokenFromCookie.mockReturnValue('jwt-token-123')

      const res = await app.request('/api/auth/token', {
        headers: { cookie: 'auth_token=jwt-token-123' },
      })

      expect(res.status).toBe(200)
      const body = (await res.json()) as ApiResponse
      expect(body.success).toBe(true)
      expect(body.data.token).toBe('jwt-token-123')
    })

    it('returns 401 when no token found', async () => {
      mocks.getTokenFromCookie.mockReturnValue(null)

      const res = await app.request('/api/auth/token')

      expect(res.status).toBe(401)
      const body = (await res.json()) as ApiResponse
      expect(body.error).toBe('No token found')
    })
  })

  describe('GET /api/auth/callback/google', () => {
    it('redirects to login with error when missing code', async () => {
      const res = await app.request('/api/auth/callback/google?state=test-state')

      expect(res.status).toBe(302)
      expect(res.headers.get('location')).toContain('error=missing_params')
    })

    it('redirects to login with error when missing state', async () => {
      const res = await app.request('/api/auth/callback/google?code=test-code')

      expect(res.status).toBe(302)
      expect(res.headers.get('location')).toContain('error=missing_params')
    })

    it('redirects to login with error when state is invalid', async () => {
      mocks.redisGet.mockResolvedValue(null)

      const res = await app.request('/api/auth/callback/google?code=test-code&state=invalid-state')

      expect(res.status).toBe(302)
      expect(res.headers.get('location')).toContain('error=invalid_state')
    })

    it('creates first user as ADMIN', async () => {
      mocks.redisGet.mockResolvedValue(
        JSON.stringify({ provider: 'google', timestamp: Date.now() })
      )
      mocks.redisDel.mockResolvedValue(1)
      mocks.exchangeCodeForTokens.mockResolvedValue({
        access_token: 'access-token',
        refresh_token: 'refresh-token',
        expiry_date: Date.now() + 3600000,
      })
      mocks.getUserInfo.mockResolvedValue({
        id: 'google-123',
        email: 'admin@example.com',
        name: 'Admin User',
        picture: 'https://example.com/avatar.png',
      })
      mocks.userFindUnique.mockResolvedValue(null)
      mocks.userCount.mockResolvedValue(0)
      mocks.settingsAreSignupsAllowed.mockResolvedValue(true)
      mocks.userUpsert.mockResolvedValue({
        id: 'user-new',
        email: 'admin@example.com',
        role: 'ADMIN',
      })
      mocks.settingsSet.mockResolvedValue(undefined)
      mocks.settingsInitializeDefaults.mockResolvedValue(undefined)
      mocks.generateToken.mockResolvedValue('jwt-token')

      const res = await app.request('/api/auth/callback/google?code=valid-code&state=valid-state')

      expect(res.status).toBe(302)
      expect(res.headers.get('location')).toContain('success=true')
      expect(mocks.userUpsert).toHaveBeenCalledWith(
        expect.objectContaining({
          create: expect.objectContaining({
            role: 'ADMIN',
          }),
        })
      )
      expect(mocks.settingsInitializeDefaults).toHaveBeenCalled()
    })

    it('creates subsequent user as USER', async () => {
      mocks.redisGet.mockResolvedValue(
        JSON.stringify({ provider: 'google', timestamp: Date.now() })
      )
      mocks.redisDel.mockResolvedValue(1)
      mocks.exchangeCodeForTokens.mockResolvedValue({
        access_token: 'access-token',
        refresh_token: 'refresh-token',
      })
      mocks.getUserInfo.mockResolvedValue({
        id: 'google-456',
        email: 'user@example.com',
        name: 'Regular User',
        picture: null,
      })
      mocks.userFindUnique.mockResolvedValue(null)
      mocks.userCount.mockResolvedValue(1)
      mocks.settingsAreSignupsAllowed.mockResolvedValue(true)
      mocks.userUpsert.mockResolvedValue({
        id: 'user-new',
        email: 'user@example.com',
        role: 'USER',
      })
      mocks.generateToken.mockResolvedValue('jwt-token')

      const res = await app.request('/api/auth/callback/google?code=valid-code&state=valid-state')

      expect(res.status).toBe(302)
      expect(mocks.userUpsert).toHaveBeenCalledWith(
        expect.objectContaining({
          create: expect.objectContaining({
            role: 'USER',
          }),
        })
      )
    })

    it('rejects signup when signups are disabled', async () => {
      mocks.redisGet.mockResolvedValue(
        JSON.stringify({ provider: 'google', timestamp: Date.now() })
      )
      mocks.redisDel.mockResolvedValue(1)
      mocks.exchangeCodeForTokens.mockResolvedValue({
        access_token: 'access-token',
        refresh_token: 'refresh-token',
      })
      mocks.getUserInfo.mockResolvedValue({
        id: 'google-789',
        email: 'blocked@example.com',
        name: 'Blocked User',
      })
      mocks.userFindUnique.mockResolvedValue(null)
      mocks.userCount.mockResolvedValue(5)
      mocks.settingsAreSignupsAllowed.mockResolvedValue(false)

      const res = await app.request('/api/auth/callback/google?code=valid-code&state=valid-state')

      expect(res.status).toBe(302)
      expect(res.headers.get('location')).toContain('error=signups_disabled')
    })

    it('allows existing user login even when signups disabled', async () => {
      mocks.redisGet.mockResolvedValue(
        JSON.stringify({ provider: 'google', timestamp: Date.now() })
      )
      mocks.redisDel.mockResolvedValue(1)
      mocks.exchangeCodeForTokens.mockResolvedValue({
        access_token: 'access-token',
        refresh_token: 'refresh-token',
      })
      mocks.getUserInfo.mockResolvedValue({
        id: 'google-existing',
        email: 'existing@example.com',
        name: 'Existing User',
      })
      mocks.userFindUnique.mockResolvedValue({
        id: 'user-existing',
        email: 'existing@example.com',
        role: 'USER',
      })
      mocks.userCount.mockResolvedValue(5)
      mocks.userUpsert.mockResolvedValue({
        id: 'user-existing',
        email: 'existing@example.com',
        role: 'USER',
      })
      mocks.generateToken.mockResolvedValue('jwt-token')

      const res = await app.request('/api/auth/callback/google?code=valid-code&state=valid-state')

      expect(res.status).toBe(302)
      expect(res.headers.get('location')).toContain('success=true')
    })

    it('handles credential OAuth flow', async () => {
      const credentialState = Buffer.from(
        JSON.stringify({
          flow: 'credential',
          userId: 'user-123',
          provider: 'google_drive_shared',
        })
      ).toString('base64url')

      mocks.exchangeCodeForTokens.mockResolvedValue({
        access_token: 'access-token',
        refresh_token: 'refresh-token',
        expiry_date: Date.now() + 3600000,
        scope: 'https://www.googleapis.com/auth/drive',
      })
      mocks.getUserInfo.mockResolvedValue({
        id: 'google-123',
        email: 'user@example.com',
      })
      mocks.encrypt.mockReturnValue({
        encryptedData: 'encrypted',
        iv: 'iv',
        authTag: 'tag',
      })
      mocks.credentialCreate.mockResolvedValue({ id: 'cred-new' })

      const res = await app.request(
        `/api/auth/callback/google?code=valid-code&state=${credentialState}`
      )

      expect(res.status).toBe(302)
      expect(res.headers.get('location')).toContain('success=credential_added')
      expect(mocks.credentialCreate).toHaveBeenCalled()
    })

    it('handles credential OAuth failure', async () => {
      const credentialState = Buffer.from(
        JSON.stringify({
          flow: 'credential',
          userId: 'user-123',
          provider: 'google_drive_my_drive',
        })
      ).toString('base64url')

      mocks.exchangeCodeForTokens.mockRejectedValue(new Error('Token exchange failed'))

      const res = await app.request(
        `/api/auth/callback/google?code=invalid-code&state=${credentialState}`
      )

      expect(res.status).toBe(302)
      expect(res.headers.get('location')).toContain('error=oauth_failed')
    })

    it('handles missing userId in credential flow', async () => {
      const credentialState = Buffer.from(
        JSON.stringify({
          flow: 'credential',
          // No userId
        })
      ).toString('base64url')

      const res = await app.request(
        `/api/auth/callback/google?code=valid-code&state=${credentialState}`
      )

      expect(res.status).toBe(302)
      expect(res.headers.get('location')).toContain('error=invalid_state')
    })

    it('handles OAuth error gracefully', async () => {
      mocks.redisGet.mockResolvedValue(
        JSON.stringify({ provider: 'google', timestamp: Date.now() })
      )
      mocks.redisDel.mockResolvedValue(1)
      mocks.exchangeCodeForTokens.mockRejectedValue(new Error('OAuth error'))

      const res = await app.request('/api/auth/callback/google?code=bad-code&state=valid-state')

      expect(res.status).toBe(302)
      expect(res.headers.get('location')).toContain('error=auth_failed')
    })

    it('handles missing access_token in credential OAuth response', async () => {
      const credentialState = Buffer.from(
        JSON.stringify({
          flow: 'credential',
          userId: 'user-123',
          provider: 'google_drive_shared',
        })
      ).toString('base64url')

      mocks.exchangeCodeForTokens.mockResolvedValue({
        // Missing access_token
        refresh_token: 'refresh-token',
      })

      const res = await app.request(
        `/api/auth/callback/google?code=valid-code&state=${credentialState}`
      )

      expect(res.status).toBe(302)
      expect(res.headers.get('location')).toContain('error=oauth_failed')
    })

    it('handles missing refresh_token in credential OAuth response', async () => {
      const credentialState = Buffer.from(
        JSON.stringify({
          flow: 'credential',
          userId: 'user-123',
          provider: 'google_drive_shared',
        })
      ).toString('base64url')

      mocks.exchangeCodeForTokens.mockResolvedValue({
        access_token: 'access-token',
        // Missing refresh_token
      })

      const res = await app.request(
        `/api/auth/callback/google?code=valid-code&state=${credentialState}`
      )

      expect(res.status).toBe(302)
      expect(res.headers.get('location')).toContain('error=oauth_failed')
    })
  })
})
