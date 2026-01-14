import { describe, it, expect, vi, beforeEach } from 'vitest'
import { Hono } from 'hono'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type ApiResponse = { success: boolean; data?: any; error?: string; message?: string; details?: string }

const mocks = vi.hoisted(() => ({
  destinationFindMany: vi.fn(),
  destinationFindFirst: vi.fn(),
  destinationCreate: vi.fn(),
  destinationUpdate: vi.fn(),
  destinationDelete: vi.fn(),
  credentialFindFirst: vi.fn(),
  decrypt: vi.fn(),
  getStorageAdapter: vi.fn(),
  adapterInitialize: vi.fn(),
  adapterListDestinations: vi.fn(),
  adapterListFolders: vi.fn(),
  adapterCreateFolder: vi.fn(),
  createSharedDrive: vi.fn(),
  loggerInfo: vi.fn(),
  loggerWarn: vi.fn(),
  loggerError: vi.fn(),
}))

vi.mock('@avault/shared', async (importOriginal) => {
  const actual = await importOriginal()
  return {
    ...(actual as object),
    decrypt: mocks.decrypt,
    logger: {
      info: mocks.loggerInfo,
      warn: mocks.loggerWarn,
      error: mocks.loggerError,
      debug: vi.fn(),
    },
  }
})

vi.mock('@avault/storage', () => ({
  getStorageAdapter: mocks.getStorageAdapter,
  GoogleDriveSharedAdapter: vi.fn().mockImplementation(() => ({
    initialize: mocks.adapterInitialize,
    createSharedDrive: mocks.createSharedDrive,
  })),
}))

const mockDb = {
  storageDestination: {
    findMany: mocks.destinationFindMany,
    findFirst: mocks.destinationFindFirst,
    create: mocks.destinationCreate,
    update: mocks.destinationUpdate,
    delete: mocks.destinationDelete,
  },
  storageCredential: {
    findFirst: mocks.credentialFindFirst,
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

import destinationsRoutes from '../routes/destinations'

describe('destinations routes', () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let app: Hono<any>

  beforeEach(() => {
    vi.clearAllMocks()
    app = new Hono()
    app.use('*', async (c, next) => {
      c.set('db', mockDb)
      await next()
    })
    app.route('/api/destinations', destinationsRoutes)
  })

  describe('GET /api/destinations', () => {
    it('returns list of user destinations', async () => {
      const mockDestinations = [
        { id: 'dest-1', name: 'S3 Bucket', provider: 's3', credential: { id: 'cred-1', name: 'My S3', provider: 's3' } },
      ]
      mocks.destinationFindMany.mockResolvedValue(mockDestinations)

      const res = await app.request('/api/destinations')

      expect(res.status).toBe(200)
      const body = await res.json() as ApiResponse
      expect(body.success).toBe(true)
      expect(body.data).toHaveLength(1)
    })

    it('only returns user own destinations', async () => {
      mocks.destinationFindMany.mockResolvedValue([])

      await app.request('/api/destinations')

      expect(mocks.destinationFindMany).toHaveBeenCalledWith({
        where: { userId: 'user-123' },
        include: expect.any(Object),
        orderBy: { createdAt: 'desc' },
      })
    })
  })

  describe('POST /api/destinations', () => {
    it('creates destination', async () => {
      const credentialId = 'clxxxxxxxxxxxxxxxxx123456' // Valid CUID

      mocks.destinationCreate.mockResolvedValue({
        id: 'dest-new',
        name: 'New Bucket',
        provider: 's3',
        remoteId: 'bucket-1',
        credential: { id: credentialId, name: 'S3', provider: 's3' },
      })

      const res = await app.request('/api/destinations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          credentialId,
          provider: 's3',
          remoteId: 'bucket-1',
          name: 'New Bucket',
        }),
      })

      expect(res.status).toBe(201)
      const body = await res.json() as ApiResponse
      expect(body.success).toBe(true)
    })

    it('returns 400 on validation error', async () => {
      const res = await app.request('/api/destinations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'Invalid' }), // Missing required fields
      })

      expect(res.status).toBe(400)
    })

    it('returns 400 when database create fails', async () => {
      const credentialId = 'clxxxxxxxxxxxxxxxxx123456'
      mocks.destinationCreate.mockRejectedValue(new Error('Foreign key constraint'))

      const res = await app.request('/api/destinations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          credentialId,
          provider: 's3',
          remoteId: 'bucket-1',
          name: 'New Bucket',
        }),
      })

      expect(res.status).toBe(400)
      const body = await res.json() as ApiResponse
      expect(body.error).toBe('Failed to create destination')
      expect(body.details).toBe('Foreign key constraint')
    })
  })

  describe('GET /api/destinations/:id', () => {
    it('returns single destination', async () => {
      mocks.destinationFindFirst.mockResolvedValue({
        id: 'dest-1',
        name: 'My Backup',
        credential: { id: 'cred-1' },
      })

      const res = await app.request('/api/destinations/dest-1')

      expect(res.status).toBe(200)
      const body = await res.json() as ApiResponse
      expect(body.data.id).toBe('dest-1')
    })

    it('returns 404 when not found', async () => {
      mocks.destinationFindFirst.mockResolvedValue(null)

      const res = await app.request('/api/destinations/nonexistent')

      expect(res.status).toBe(404)
    })
  })

  describe('PATCH /api/destinations/:id', () => {
    it('updates destination', async () => {
      mocks.destinationFindFirst.mockResolvedValue({ id: 'dest-1', userId: 'user-123' })
      mocks.destinationUpdate.mockResolvedValue({
        id: 'dest-1',
        name: 'Updated Name',
        credential: { id: 'cred-1' },
      })

      const res = await app.request('/api/destinations/dest-1', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'Updated Name' }),
      })

      expect(res.status).toBe(200)
      const body = await res.json() as ApiResponse
      expect(body.data.name).toBe('Updated Name')
    })

    it('returns 404 when destination not found', async () => {
      mocks.destinationFindFirst.mockResolvedValue(null)

      const res = await app.request('/api/destinations/nonexistent', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'New Name' }),
      })

      expect(res.status).toBe(404)
    })

    it('returns 400 when update fails', async () => {
      mocks.destinationFindFirst.mockResolvedValue({ id: 'dest-1', userId: 'user-123' })
      mocks.destinationUpdate.mockRejectedValue(new Error('Database error'))

      const res = await app.request('/api/destinations/dest-1', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'Updated Name' }),
      })

      expect(res.status).toBe(400)
      const body = await res.json() as ApiResponse
      expect(body.error).toBe('Failed to update destination')
    })
  })

  describe('DELETE /api/destinations/:id', () => {
    it('deletes destination', async () => {
      mocks.destinationFindFirst.mockResolvedValue({ id: 'dest-1', userId: 'user-123' })
      mocks.destinationDelete.mockResolvedValue({})

      const res = await app.request('/api/destinations/dest-1', { method: 'DELETE' })

      expect(res.status).toBe(200)
      const body = await res.json() as ApiResponse
      expect(body.message).toBe('Destination deleted successfully')
    })

    it('returns 404 when not found', async () => {
      mocks.destinationFindFirst.mockResolvedValue(null)

      const res = await app.request('/api/destinations/nonexistent', { method: 'DELETE' })

      expect(res.status).toBe(404)
    })

    it('returns 500 when delete fails', async () => {
      mocks.destinationFindFirst.mockResolvedValue({ id: 'dest-1', userId: 'user-123' })
      mocks.destinationDelete.mockRejectedValue(new Error('Database error'))

      const res = await app.request('/api/destinations/dest-1', { method: 'DELETE' })

      expect(res.status).toBe(500)
      const body = await res.json() as ApiResponse
      expect(body.error).toBe('Failed to delete destination')
    })
  })

  describe('POST /api/destinations/create-drive/:credentialId', () => {
    it('creates shared drive', async () => {
      mocks.credentialFindFirst.mockResolvedValue({
        id: 'cred-1',
        provider: 'google_drive_shared',
        encryptedData: 'enc',
        iv: 'iv',
        authTag: 'tag',
      })
      mocks.decrypt.mockReturnValue(JSON.stringify({ access_token: 'token' }))
      mocks.createSharedDrive.mockResolvedValue({
        id: 'drive-new',
        name: 'New Drive',
      })

      const res = await app.request('/api/destinations/create-drive/cred-1', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'New Drive' }),
      })

      expect(res.status).toBe(201)
      const body = await res.json() as ApiResponse
      expect(body.data.id).toBe('drive-new')
    })

    it('returns 400 when name is missing', async () => {
      const res = await app.request('/api/destinations/create-drive/cred-1', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      })

      expect(res.status).toBe(400)
      const body = await res.json() as ApiResponse
      expect(body.error).toContain('name')
    })

    it('returns 404 when credential not found', async () => {
      mocks.credentialFindFirst.mockResolvedValue(null)

      const res = await app.request('/api/destinations/create-drive/nonexistent', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'Test' }),
      })

      expect(res.status).toBe(404)
    })

    it('rejects non-Google Drive providers', async () => {
      mocks.credentialFindFirst.mockResolvedValue({
        id: 'cred-1',
        provider: 's3',
      })

      const res = await app.request('/api/destinations/create-drive/cred-1', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'Test' }),
      })

      expect(res.status).toBe(400)
      const body = await res.json() as ApiResponse
      expect(body.error).toContain('Google Drive')
    })

    it('returns 500 when drive creation fails', async () => {
      mocks.credentialFindFirst.mockResolvedValue({
        id: 'cred-1',
        provider: 'google_drive_shared',
        encryptedData: 'enc',
        iv: 'iv',
        authTag: 'tag',
      })
      mocks.decrypt.mockReturnValue(JSON.stringify({ access_token: 'token' }))
      mocks.createSharedDrive.mockRejectedValue(new Error('API quota exceeded'))

      const res = await app.request('/api/destinations/create-drive/cred-1', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'New Drive' }),
      })

      expect(res.status).toBe(500)
      const body = await res.json() as ApiResponse
      expect(body.error).toBe('Failed to create Shared Drive')
      expect(body.details).toBe('API quota exceeded')
    })

    it('accepts google_drive provider', async () => {
      mocks.credentialFindFirst.mockResolvedValue({
        id: 'cred-1',
        provider: 'google_drive',
        encryptedData: 'enc',
        iv: 'iv',
        authTag: 'tag',
      })
      mocks.decrypt.mockReturnValue(JSON.stringify({ access_token: 'token' }))
      mocks.createSharedDrive.mockResolvedValue({
        id: 'drive-new',
        name: 'New Drive',
      })

      const res = await app.request('/api/destinations/create-drive/cred-1', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'New Drive' }),
      })

      expect(res.status).toBe(201)
    })
  })

  describe('GET /api/destinations/browse/:credentialId', () => {
    it('lists available destinations', async () => {
      mocks.credentialFindFirst.mockResolvedValue({
        id: 'cred-1',
        provider: 's3',
        encryptedData: 'enc',
        iv: 'iv',
        authTag: 'tag',
      })
      mocks.decrypt.mockReturnValue(JSON.stringify({ access_key_id: 'key' }))
      mocks.getStorageAdapter.mockReturnValue({
        initialize: mocks.adapterInitialize,
        listDestinations: mocks.adapterListDestinations,
      })
      mocks.adapterListDestinations.mockResolvedValue([
        { id: 'bucket-1', name: 'Bucket 1' },
        { id: 'bucket-2', name: 'Bucket 2' },
      ])

      const res = await app.request('/api/destinations/browse/cred-1')

      expect(res.status).toBe(200)
      const body = await res.json() as ApiResponse
      expect(body.data).toHaveLength(2)
    })

    it('returns 404 when credential not found', async () => {
      mocks.credentialFindFirst.mockResolvedValue(null)

      const res = await app.request('/api/destinations/browse/nonexistent')

      expect(res.status).toBe(404)
    })

    it('returns 400 when adapter fails', async () => {
      mocks.credentialFindFirst.mockResolvedValue({
        id: 'cred-1',
        provider: 's3',
        encryptedData: 'enc',
        iv: 'iv',
        authTag: 'tag',
      })
      mocks.decrypt.mockReturnValue(JSON.stringify({}))
      mocks.getStorageAdapter.mockReturnValue({
        initialize: vi.fn().mockRejectedValue(new Error('Invalid credentials')),
      })

      const res = await app.request('/api/destinations/browse/cred-1')

      expect(res.status).toBe(400)
      const body = await res.json() as ApiResponse
      expect(body.error).toContain('not supported')
    })

    it('returns 500 when decryption fails', async () => {
      mocks.credentialFindFirst.mockResolvedValue({
        id: 'cred-1',
        provider: 's3',
        encryptedData: 'enc',
        iv: 'iv',
        authTag: 'tag',
      })
      mocks.decrypt.mockImplementation(() => {
        throw new Error('Decryption failed')
      })

      const res = await app.request('/api/destinations/browse/cred-1')

      expect(res.status).toBe(500)
      const body = await res.json() as ApiResponse
      expect(body.error).toBe('Failed to list available destinations')
    })
  })

  describe('GET /api/destinations/browse/:credentialId/:destinationId/folders', () => {
    it('lists folders in destination', async () => {
      mocks.credentialFindFirst.mockResolvedValue({
        id: 'cred-1',
        provider: 's3',
        encryptedData: 'enc',
        iv: 'iv',
        authTag: 'tag',
      })
      mocks.decrypt.mockReturnValue(JSON.stringify({ access_key_id: 'key' }))
      mocks.getStorageAdapter.mockReturnValue({
        initialize: mocks.adapterInitialize,
        listFolders: mocks.adapterListFolders,
      })
      mocks.adapterListFolders.mockResolvedValue([
        { id: 'folder-1', name: 'Backups', path: '/backups/' },
      ])

      const res = await app.request('/api/destinations/browse/cred-1/bucket-1/folders')

      expect(res.status).toBe(200)
      const body = await res.json() as ApiResponse
      expect(body.data).toHaveLength(1)
    })

    it('supports parent folder parameter', async () => {
      mocks.credentialFindFirst.mockResolvedValue({
        id: 'cred-1',
        provider: 's3',
        encryptedData: 'enc',
        iv: 'iv',
        authTag: 'tag',
      })
      mocks.decrypt.mockReturnValue(JSON.stringify({}))
      mocks.getStorageAdapter.mockReturnValue({
        initialize: mocks.adapterInitialize,
        listFolders: mocks.adapterListFolders,
      })
      mocks.adapterListFolders.mockResolvedValue([])

      await app.request('/api/destinations/browse/cred-1/bucket-1/folders?parentFolderId=parent-123')

      expect(mocks.adapterListFolders).toHaveBeenCalledWith('bucket-1', 'parent-123')
    })

    it('returns 404 when credential not found', async () => {
      mocks.credentialFindFirst.mockResolvedValue(null)

      const res = await app.request('/api/destinations/browse/nonexistent/bucket-1/folders')

      expect(res.status).toBe(404)
    })

    it('returns 400 when adapter fails', async () => {
      mocks.credentialFindFirst.mockResolvedValue({
        id: 'cred-1',
        provider: 's3',
        encryptedData: 'enc',
        iv: 'iv',
        authTag: 'tag',
      })
      mocks.decrypt.mockReturnValue(JSON.stringify({}))
      mocks.getStorageAdapter.mockReturnValue({
        initialize: vi.fn().mockRejectedValue(new Error('Adapter error')),
      })

      const res = await app.request('/api/destinations/browse/cred-1/bucket-1/folders')

      expect(res.status).toBe(400)
      const body = await res.json() as ApiResponse
      expect(body.error).toContain('not supported')
    })

    it('returns 500 when outer error occurs', async () => {
      mocks.credentialFindFirst.mockResolvedValue({
        id: 'cred-1',
        provider: 's3',
        encryptedData: 'enc',
        iv: 'iv',
        authTag: 'tag',
      })
      mocks.decrypt.mockImplementation(() => {
        throw new Error('Decryption failed')
      })

      const res = await app.request('/api/destinations/browse/cred-1/bucket-1/folders')

      expect(res.status).toBe(500)
      const body = await res.json() as ApiResponse
      expect(body.error).toBe('Failed to list folders')
    })
  })

  describe('POST /api/destinations/browse/:credentialId/:destinationId/folders', () => {
    it('creates folder', async () => {
      mocks.credentialFindFirst.mockResolvedValue({
        id: 'cred-1',
        provider: 's3',
        encryptedData: 'enc',
        iv: 'iv',
        authTag: 'tag',
      })
      mocks.decrypt.mockReturnValue(JSON.stringify({}))
      mocks.getStorageAdapter.mockReturnValue({
        initialize: mocks.adapterInitialize,
        createFolder: mocks.adapterCreateFolder,
      })
      mocks.adapterCreateFolder.mockResolvedValue({
        id: 'new-folder',
        name: 'New Folder',
        path: '/new-folder/',
      })

      const res = await app.request('/api/destinations/browse/cred-1/bucket-1/folders', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'New Folder' }),
      })

      expect(res.status).toBe(201)
      const body = await res.json() as ApiResponse
      expect(body.data.name).toBe('New Folder')
    })

    it('returns 400 when name is missing', async () => {
      const res = await app.request('/api/destinations/browse/cred-1/bucket-1/folders', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      })

      expect(res.status).toBe(400)
      const body = await res.json() as ApiResponse
      expect(body.error).toContain('name')
    })

    it('returns 404 when credential not found', async () => {
      mocks.credentialFindFirst.mockResolvedValue(null)

      const res = await app.request('/api/destinations/browse/nonexistent/bucket-1/folders', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'Test Folder' }),
      })

      expect(res.status).toBe(404)
    })

    it('returns 400 when adapter fails', async () => {
      mocks.credentialFindFirst.mockResolvedValue({
        id: 'cred-1',
        provider: 's3',
        encryptedData: 'enc',
        iv: 'iv',
        authTag: 'tag',
      })
      mocks.decrypt.mockReturnValue(JSON.stringify({}))
      mocks.getStorageAdapter.mockReturnValue({
        initialize: vi.fn().mockRejectedValue(new Error('Adapter error')),
      })

      const res = await app.request('/api/destinations/browse/cred-1/bucket-1/folders', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'Test Folder' }),
      })

      expect(res.status).toBe(400)
      const body = await res.json() as ApiResponse
      expect(body.error).toContain('not supported')
    })

    it('returns 500 when outer error occurs', async () => {
      mocks.credentialFindFirst.mockResolvedValue({
        id: 'cred-1',
        provider: 's3',
        encryptedData: 'enc',
        iv: 'iv',
        authTag: 'tag',
      })
      mocks.decrypt.mockImplementation(() => {
        throw new Error('Decryption failed')
      })

      const res = await app.request('/api/destinations/browse/cred-1/bucket-1/folders', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'Test Folder' }),
      })

      expect(res.status).toBe(500)
      const body = await res.json() as ApiResponse
      expect(body.error).toBe('Failed to create folder')
    })

    it('creates folder with parent folder id', async () => {
      mocks.credentialFindFirst.mockResolvedValue({
        id: 'cred-1',
        provider: 's3',
        encryptedData: 'enc',
        iv: 'iv',
        authTag: 'tag',
      })
      mocks.decrypt.mockReturnValue(JSON.stringify({}))
      mocks.getStorageAdapter.mockReturnValue({
        initialize: mocks.adapterInitialize,
        createFolder: mocks.adapterCreateFolder,
      })
      mocks.adapterCreateFolder.mockResolvedValue({
        id: 'new-folder',
        name: 'Subfolder',
        path: '/parent/subfolder/',
      })

      const res = await app.request('/api/destinations/browse/cred-1/bucket-1/folders', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'Subfolder', parentFolderId: 'parent-123' }),
      })

      expect(res.status).toBe(201)
      expect(mocks.adapterCreateFolder).toHaveBeenCalledWith('bucket-1', 'Subfolder', 'parent-123')
    })
  })
})
