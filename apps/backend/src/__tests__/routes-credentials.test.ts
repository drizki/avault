import { describe, it, expect, vi, beforeEach } from 'vitest'
import { Hono } from 'hono'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type ApiResponse = {
  success: boolean
  data?: any
  error?: string
  details?: string
  message?: string
}

const mocks = vi.hoisted(() => ({
  credentialFindMany: vi.fn(),
  credentialFindFirst: vi.fn(),
  credentialDelete: vi.fn(),
  credentialCreate: vi.fn(),
  encrypt: vi.fn(),
  loggerInfo: vi.fn(),
  loggerError: vi.fn(),
  generateAuthUrl: vi.fn(),
}))

vi.mock('@avault/shared', async (importOriginal) => {
  const actual = await importOriginal()
  return {
    ...(actual as object),
    encrypt: mocks.encrypt,
    logger: {
      info: mocks.loggerInfo,
      error: mocks.loggerError,
      warn: vi.fn(),
      debug: vi.fn(),
    },
  }
})

vi.mock('googleapis', () => ({
  google: {
    auth: {
      OAuth2: vi.fn().mockImplementation(() => ({
        generateAuthUrl: mocks.generateAuthUrl,
      })),
    },
  },
}))

const mockDb = {
  storageCredential: {
    findMany: mocks.credentialFindMany,
    findFirst: mocks.credentialFindFirst,
    delete: mocks.credentialDelete,
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

import credentialsRoutes from '../routes/credentials'

describe('credentials routes', () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let app: Hono<any>

  beforeEach(() => {
    vi.clearAllMocks()
    app = new Hono()
    app.use('*', async (c, next) => {
      c.set('db', mockDb)
      await next()
    })
    app.route('/api/credentials', credentialsRoutes)
  })

  describe('GET /api/credentials', () => {
    it('returns list of user credentials', async () => {
      const mockCredentials = [
        { id: 'cred-1', name: 'My S3', provider: 's3', createdAt: new Date() },
        { id: 'cred-2', name: 'My Drive', provider: 'google_drive_shared', createdAt: new Date() },
      ]
      mocks.credentialFindMany.mockResolvedValue(mockCredentials)

      const res = await app.request('/api/credentials')

      expect(res.status).toBe(200)
      const body = (await res.json()) as ApiResponse
      expect(body.success).toBe(true)
      expect(body.data).toHaveLength(2)
    })

    it('only returns user own credentials', async () => {
      mocks.credentialFindMany.mockResolvedValue([])

      await app.request('/api/credentials')

      expect(mocks.credentialFindMany).toHaveBeenCalledWith({
        where: { userId: 'user-123' },
        select: expect.any(Object),
        orderBy: { createdAt: 'desc' },
      })
    })
  })

  describe('GET /api/credentials/:id', () => {
    it('returns single credential', async () => {
      const mockCredential = {
        id: 'cred-1',
        name: 'My S3',
        provider: 's3',
        createdAt: new Date(),
      }
      mocks.credentialFindFirst.mockResolvedValue(mockCredential)

      const res = await app.request('/api/credentials/cred-1')

      expect(res.status).toBe(200)
      const body = (await res.json()) as ApiResponse
      expect(body.success).toBe(true)
      expect(body.data.id).toBe('cred-1')
    })

    it('returns 404 when not found', async () => {
      mocks.credentialFindFirst.mockResolvedValue(null)

      const res = await app.request('/api/credentials/nonexistent')

      expect(res.status).toBe(404)
      const body = (await res.json()) as ApiResponse
      expect(body.error).toBe('Credential not found')
    })
  })

  describe('DELETE /api/credentials/:id', () => {
    it('deletes credential', async () => {
      mocks.credentialFindFirst.mockResolvedValue({ id: 'cred-1', userId: 'user-123' })
      mocks.credentialDelete.mockResolvedValue({})

      const res = await app.request('/api/credentials/cred-1', { method: 'DELETE' })

      expect(res.status).toBe(200)
      const body = (await res.json()) as ApiResponse
      expect(body.success).toBe(true)
      expect(body.message).toBe('Credential deleted successfully')
    })

    it('returns 404 when credential not found', async () => {
      mocks.credentialFindFirst.mockResolvedValue(null)

      const res = await app.request('/api/credentials/nonexistent', { method: 'DELETE' })

      expect(res.status).toBe(404)
    })

    it('returns 500 on delete error', async () => {
      mocks.credentialFindFirst.mockResolvedValue({ id: 'cred-1', userId: 'user-123' })
      mocks.credentialDelete.mockRejectedValue(new Error('DB error'))

      const res = await app.request('/api/credentials/cred-1', { method: 'DELETE' })

      expect(res.status).toBe(500)
    })
  })

  describe('POST /api/credentials/google-drive/auth', () => {
    it('initiates OAuth flow', async () => {
      mocks.generateAuthUrl.mockReturnValue('https://accounts.google.com/oauth')

      const res = await app.request('/api/credentials/google-drive/auth', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ provider: 'google_drive_shared' }),
      })

      expect(res.status).toBe(200)
      const body = (await res.json()) as ApiResponse
      expect(body.success).toBe(true)
      expect(body.data.authUrl).toBe('https://accounts.google.com/oauth')
    })

    it('defaults to google_drive_shared provider', async () => {
      mocks.generateAuthUrl.mockReturnValue('https://accounts.google.com/oauth')

      const res = await app.request('/api/credentials/google-drive/auth', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      })

      expect(res.status).toBe(200)
    })

    it('returns 500 when OAuth flow fails', async () => {
      mocks.generateAuthUrl.mockImplementation(() => {
        throw new Error('OAuth configuration error')
      })

      const res = await app.request('/api/credentials/google-drive/auth', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ provider: 'google_drive_shared' }),
      })

      expect(res.status).toBe(500)
      const body = (await res.json()) as ApiResponse
      expect(body.error).toBe('Failed to initiate OAuth flow')
      expect(mocks.loggerError).toHaveBeenCalled()
    })
  })

  describe('POST /api/credentials/api-key', () => {
    it('creates S3 credential', async () => {
      mocks.encrypt.mockReturnValue({
        encryptedData: 'encrypted',
        iv: 'iv123',
        authTag: 'tag123',
      })
      mocks.credentialCreate.mockResolvedValue({
        id: 'cred-new',
        name: 'My S3',
        provider: 's3',
        createdAt: new Date(),
      })

      const res = await app.request('/api/credentials/api-key', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: 'My S3',
          provider: 's3',
          credentials: {
            access_key_id: 'AKIA...',
            secret_access_key: 'secret...',
            region: 'us-west-2',
          },
        }),
      })

      expect(res.status).toBe(201)
      const body = (await res.json()) as ApiResponse
      expect(body.success).toBe(true)
      expect(body.data.provider).toBe('s3')
    })

    it('rejects invalid provider', async () => {
      const res = await app.request('/api/credentials/api-key', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: 'Test',
          provider: 'google_drive_shared',
          credentials: { access_key_id: 'key', secret_access_key: 'secret' },
        }),
      })

      expect(res.status).toBe(400)
      const body = (await res.json()) as ApiResponse
      expect(body.error).toContain('Invalid provider')
    })

    it('requires access_key_id and secret_access_key', async () => {
      const res = await app.request('/api/credentials/api-key', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: 'Test',
          provider: 's3',
          credentials: { access_key_id: 'key' },
        }),
      })

      expect(res.status).toBe(400)
      const body = (await res.json()) as ApiResponse
      expect(body.error).toContain('secret access key')
    })

    it('requires account_id for R2', async () => {
      const res = await app.request('/api/credentials/api-key', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: 'Test',
          provider: 'cloudflare_r2',
          credentials: { access_key_id: 'key', secret_access_key: 'secret' },
        }),
      })

      expect(res.status).toBe(400)
      const body = (await res.json()) as ApiResponse
      expect(body.error).toContain('account ID')
    })

    it('uses default name when name not provided', async () => {
      mocks.encrypt.mockReturnValue({
        encryptedData: 'encrypted',
        iv: 'iv123',
        authTag: 'tag123',
      })
      mocks.credentialCreate.mockResolvedValue({
        id: 'cred-default',
        name: 's3 Account',
        provider: 's3',
        createdAt: new Date(),
      })

      const res = await app.request('/api/credentials/api-key', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          // No name provided
          provider: 's3',
          credentials: {
            access_key_id: 'AKIA...',
            secret_access_key: 'secret...',
          },
        }),
      })

      expect(res.status).toBe(201)
      expect(mocks.credentialCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            name: 's3 Account',
          }),
        })
      )
    })

    it('creates R2 credential with account_id', async () => {
      mocks.encrypt.mockReturnValue({
        encryptedData: 'encrypted',
        iv: 'iv123',
        authTag: 'tag123',
      })
      mocks.credentialCreate.mockResolvedValue({
        id: 'cred-r2',
        name: 'My R2',
        provider: 'cloudflare_r2',
        createdAt: new Date(),
      })

      const res = await app.request('/api/credentials/api-key', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: 'My R2',
          provider: 'cloudflare_r2',
          credentials: {
            access_key_id: 'key',
            secret_access_key: 'secret',
            account_id: 'cf-account-123',
          },
        }),
      })

      expect(res.status).toBe(201)
    })

    it('returns 500 when database create fails', async () => {
      mocks.encrypt.mockReturnValue({
        encryptedData: 'encrypted',
        iv: 'iv123',
        authTag: 'tag123',
      })
      mocks.credentialCreate.mockRejectedValue(new Error('Database error'))

      const res = await app.request('/api/credentials/api-key', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: 'My S3',
          provider: 's3',
          credentials: {
            access_key_id: 'AKIA...',
            secret_access_key: 'secret...',
            region: 'us-west-2',
          },
        }),
      })

      expect(res.status).toBe(500)
      const body = (await res.json()) as ApiResponse
      expect(body.error).toBe('Failed to create credential')
      expect(body.details).toBe('Database error')
    })
  })

  describe('POST /api/credentials/service-account', () => {
    const validServiceAccount = {
      type: 'service_account',
      project_id: 'my-project',
      private_key: '-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----',
      client_email: 'sa@project.iam.gserviceaccount.com',
    }

    it('creates GCS credential', async () => {
      mocks.encrypt.mockReturnValue({
        encryptedData: 'encrypted',
        iv: 'iv123',
        authTag: 'tag123',
      })
      mocks.credentialCreate.mockResolvedValue({
        id: 'cred-gcs',
        name: 'GCS (my-project)',
        provider: 'google_cloud_storage',
        createdAt: new Date(),
      })

      const res = await app.request('/api/credentials/service-account', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: 'My GCS',
          provider: 'google_cloud_storage',
          credentials: validServiceAccount,
        }),
      })

      expect(res.status).toBe(201)
      const body = (await res.json()) as ApiResponse
      expect(body.success).toBe(true)
    })

    it('parses stringified service account JSON', async () => {
      mocks.encrypt.mockReturnValue({
        encryptedData: 'encrypted',
        iv: 'iv123',
        authTag: 'tag123',
      })
      mocks.credentialCreate.mockResolvedValue({
        id: 'cred-gcs',
        name: 'GCS (my-project)',
        provider: 'google_cloud_storage',
        createdAt: new Date(),
      })

      const res = await app.request('/api/credentials/service-account', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          provider: 'google_cloud_storage',
          credentials: JSON.stringify(validServiceAccount),
        }),
      })

      expect(res.status).toBe(201)
    })

    it('rejects invalid provider', async () => {
      const res = await app.request('/api/credentials/service-account', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          provider: 's3',
          credentials: validServiceAccount,
        }),
      })

      expect(res.status).toBe(400)
      const body = (await res.json()) as ApiResponse
      expect(body.error).toContain('Invalid provider')
    })

    it('rejects invalid JSON', async () => {
      const res = await app.request('/api/credentials/service-account', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          provider: 'google_cloud_storage',
          credentials: 'not-valid-json{',
        }),
      })

      expect(res.status).toBe(400)
      const body = (await res.json()) as ApiResponse
      expect(body.error).toContain('Invalid service account JSON')
    })

    it('rejects invalid service account structure', async () => {
      const res = await app.request('/api/credentials/service-account', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          provider: 'google_cloud_storage',
          credentials: { type: 'user_credentials', project_id: 'test' },
        }),
      })

      expect(res.status).toBe(400)
      const body = (await res.json()) as ApiResponse
      expect(body.error).toContain('Invalid service account JSON structure')
    })

    it('returns 500 when database create fails', async () => {
      mocks.encrypt.mockReturnValue({
        encryptedData: 'encrypted',
        iv: 'iv123',
        authTag: 'tag123',
      })
      mocks.credentialCreate.mockRejectedValue(new Error('Database error'))

      const res = await app.request('/api/credentials/service-account', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: 'My GCS',
          provider: 'google_cloud_storage',
          credentials: validServiceAccount,
        }),
      })

      expect(res.status).toBe(500)
      const body = (await res.json()) as ApiResponse
      expect(body.error).toBe('Failed to create credential')
      expect(body.details).toBe('Database error')
    })
  })
})
