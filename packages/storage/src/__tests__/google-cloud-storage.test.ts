/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, vi, beforeEach } from 'vitest'

const mocks = vi.hoisted(() => ({
  getBuckets: vi.fn(),
  bucket: vi.fn(),
  getFiles: vi.fn(),
  file: vi.fn(),
  save: vi.fn(),
  deleteFiles: vi.fn(),
  createWriteStream: vi.fn(),
}))

vi.mock('@google-cloud/storage', () => ({
  Storage: vi.fn().mockImplementation(() => ({
    getBuckets: mocks.getBuckets,
    bucket: mocks.bucket,
  })),
  Bucket: vi.fn(),
}))

import { GoogleCloudStorageAdapter } from '../google-cloud-storage'

describe('GoogleCloudStorageAdapter', () => {
  let adapter: GoogleCloudStorageAdapter
  const credentials = {
    type: 'service_account' as const,
    project_id: 'test-project',
    private_key_id: 'key-id',
    private_key: '-----BEGIN PRIVATE KEY-----\ntest\n-----END PRIVATE KEY-----',
    client_email: 'test@test-project.iam.gserviceaccount.com',
    client_id: '123456789',
    auth_uri: 'https://accounts.google.com/o/oauth2/auth',
    token_uri: 'https://oauth2.googleapis.com/token',
    auth_provider_x509_cert_url: 'https://www.googleapis.com/oauth2/v1/certs',
    client_x509_cert_url: 'https://www.googleapis.com/robot/v1/metadata/x509/test',
  }

  beforeEach(() => {
    vi.clearAllMocks()
    adapter = new GoogleCloudStorageAdapter()

    // Setup default bucket mock
    mocks.bucket.mockReturnValue({
      getFiles: mocks.getFiles,
      file: mocks.file,
      deleteFiles: mocks.deleteFiles,
    })

    mocks.file.mockReturnValue({
      save: mocks.save,
      createWriteStream: mocks.createWriteStream,
    })
  })

  describe('initialize()', () => {
    it('initializes with valid service account credentials', async () => {
      await adapter.initialize(credentials)

      // Should not throw
      expect(adapter['projectId']).toBe('test-project')
    })

    it('throws error for invalid credential type', async () => {
      const invalidCreds = { ...credentials, type: 'oauth' as any }

      await expect(adapter.initialize(invalidCreds)).rejects.toThrow(
        'Invalid credentials: expected service_account type'
      )
    })
  })

  describe('listDestinations()', () => {
    it('throws error if not initialized', async () => {
      await expect(adapter.listDestinations()).rejects.toThrow('Adapter not initialized')
    })

    it('returns list of buckets', async () => {
      await adapter.initialize(credentials)

      mocks.getBuckets.mockResolvedValue([
        [
          {
            name: 'bucket-1',
            metadata: { location: 'US', storageClass: 'STANDARD' },
          },
          {
            name: 'bucket-2',
            metadata: { location: 'EU', storageClass: 'NEARLINE' },
          },
        ],
      ])

      const destinations = await adapter.listDestinations()

      expect(destinations).toHaveLength(2)
      expect(destinations[0]).toEqual({
        id: 'bucket-1',
        name: 'bucket-1',
        provider: 'google_cloud_storage',
        metadata: {
          location: 'US',
          storageClass: 'STANDARD',
          projectId: 'test-project',
        },
      })
    })
  })

  describe('listFolders()', () => {
    it('throws error if not initialized', async () => {
      await expect(adapter.listFolders('bucket-1')).rejects.toThrow('Adapter not initialized')
    })

    it('lists folders in bucket root', async () => {
      await adapter.initialize(credentials)

      mocks.getFiles.mockResolvedValue([
        [], // files
        null, // nextQuery
        { prefixes: ['backups/', 'archives/'] }, // apiResponse
      ])

      const folders = await adapter.listFolders('bucket-1')

      expect(folders).toHaveLength(2)
      expect(folders[0]).toEqual({
        id: 'backups/',
        name: 'backups',
        path: 'backups/',
      })
    })

    it('lists folders with prefix', async () => {
      await adapter.initialize(credentials)

      mocks.getFiles.mockResolvedValue([
        [],
        null,
        { prefixes: ['data/subdir1/', 'data/subdir2/'] },
      ])

      const _folders = await adapter.listFolders('bucket-1', 'data')

      expect(mocks.getFiles).toHaveBeenCalledWith({
        prefix: 'data/',
        delimiter: '/',
        autoPaginate: false,
      })
    })

    it('handles empty folder list', async () => {
      await adapter.initialize(credentials)

      mocks.getFiles.mockResolvedValue([[], null, {}])

      const folders = await adapter.listFolders('bucket-1')

      expect(folders).toEqual([])
    })
  })

  describe('createFolder()', () => {
    it('throws error if not initialized', async () => {
      await expect(adapter.createFolder('bucket-1', 'new-folder')).rejects.toThrow(
        'Adapter not initialized'
      )
    })

    it('creates a folder (placeholder object)', async () => {
      await adapter.initialize(credentials)
      mocks.save.mockResolvedValue(undefined)

      const folder = await adapter.createFolder('bucket-1', 'new-folder')

      expect(folder).toEqual({
        id: 'new-folder/',
        name: 'new-folder',
        path: 'new-folder/',
        createdTime: expect.any(Date),
        modifiedTime: expect.any(Date),
      })
      expect(mocks.file).toHaveBeenCalledWith('new-folder/')
      expect(mocks.save).toHaveBeenCalledWith('')
    })

    it('creates a nested folder', async () => {
      await adapter.initialize(credentials)
      mocks.save.mockResolvedValue(undefined)

      await adapter.createFolder('bucket-1', 'subfolder', 'parent')

      expect(mocks.file).toHaveBeenCalledWith('parent/subfolder/')
    })
  })

  describe('deleteFolder()', () => {
    it('throws error if not initialized', async () => {
      await expect(adapter.deleteFolder('bucket-1', 'folder')).rejects.toThrow(
        'Adapter not initialized'
      )
    })

    it('deletes all files with folder prefix', async () => {
      await adapter.initialize(credentials)
      mocks.deleteFiles.mockResolvedValue(undefined)

      await adapter.deleteFolder('bucket-1', 'backup-folder')

      expect(mocks.deleteFiles).toHaveBeenCalledWith({
        prefix: 'backup-folder/',
      })
    })

    it('handles folder path with trailing slash', async () => {
      await adapter.initialize(credentials)
      mocks.deleteFiles.mockResolvedValue(undefined)

      await adapter.deleteFolder('bucket-1', 'folder/')

      expect(mocks.deleteFiles).toHaveBeenCalledWith({
        prefix: 'folder/',
      })
    })
  })

  describe('listBackups()', () => {
    it('throws error if not initialized', async () => {
      await expect(adapter.listBackups('bucket-1', '')).rejects.toThrow('Adapter not initialized')
    })

    it('lists backup folders in bucket', async () => {
      await adapter.initialize(credentials)

      mocks.getFiles.mockResolvedValue([
        [],
        null,
        { prefixes: ['backup-2024-01-15/', 'backup-2024-01-14/'] },
      ])

      const backups = await adapter.listBackups('bucket-1', '')

      expect(backups).toHaveLength(2)
      expect(backups[0]).toEqual({
        name: 'backup-2024-01-15',
        path: 'backup-2024-01-15/',
        createdTime: expect.any(Date),
      })
    })

    it('lists backups with base path', async () => {
      await adapter.initialize(credentials)

      mocks.getFiles.mockResolvedValue([
        [],
        null,
        { prefixes: ['backups/backup-1/', 'backups/backup-2/'] },
      ])

      const _backups = await adapter.listBackups('bucket-1', 'backups')

      expect(mocks.getFiles).toHaveBeenCalledWith({
        prefix: 'backups/',
        delimiter: '/',
        autoPaginate: false,
      })
    })
  })

  describe('validateCredentials()', () => {
    it('returns false if not initialized', async () => {
      const result = await adapter.validateCredentials()
      expect(result).toBe(false)
    })

    it('returns true for valid credentials', async () => {
      await adapter.initialize(credentials)
      mocks.getBuckets.mockResolvedValue([[]])

      const result = await adapter.validateCredentials()

      expect(result).toBe(true)
      expect(mocks.getBuckets).toHaveBeenCalledWith({ maxResults: 1 })
    })

    it('returns false when API call fails', async () => {
      await adapter.initialize(credentials)
      mocks.getBuckets.mockRejectedValue(new Error('Invalid credentials'))

      const result = await adapter.validateCredentials()

      expect(result).toBe(false)
    })
  })

  describe('renameFolder()', () => {
    it('throws not supported error', async () => {
      await adapter.initialize(credentials)

      await expect(adapter.renameFolder('bucket-1', 'old-name', 'new-name')).rejects.toThrow(
        'Rename not supported for Google Cloud Storage'
      )
    })
  })

  describe('uploadFile()', () => {
    it('throws error if not initialized', async () => {
      const mockStream = { pipe: vi.fn(), on: vi.fn() } as any

      await expect(
        adapter.uploadFile({
          destinationId: 'bucket-1',
          folderPath: 'backup',
          fileName: 'test.txt',
          fileStream: mockStream,
          fileSize: 100,
          mimeType: 'text/plain',
        })
      ).rejects.toThrow('Adapter not initialized')
    })

    it('uploads file to bucket', async () => {
      await adapter.initialize(credentials)

      const mockWriteStream = {
        on: vi.fn().mockImplementation((event, callback) => {
          if (event === 'finish') {
            setTimeout(callback, 0)
          }
          return mockWriteStream
        }),
      }
      mocks.createWriteStream.mockReturnValue(mockWriteStream)

      const mockFileStream = {
        pipe: vi.fn().mockReturnValue(mockWriteStream),
        on: vi.fn().mockReturnThis(),
      }

      const result = await adapter.uploadFile({
        destinationId: 'bucket-1',
        folderPath: 'backup',
        fileName: 'test.txt',
        fileStream: mockFileStream as any,
        fileSize: 100,
        mimeType: 'text/plain',
      })

      expect(result).toEqual({
        fileId: 'backup/test.txt',
        fileName: 'test.txt',
        size: 100,
        path: 'backup/test.txt',
      })
    })

    it('uploads file without folder path', async () => {
      await adapter.initialize(credentials)

      const mockWriteStream = {
        on: vi.fn().mockImplementation((event, callback) => {
          if (event === 'finish') {
            setTimeout(callback, 0)
          }
          return mockWriteStream
        }),
      }
      mocks.createWriteStream.mockReturnValue(mockWriteStream)

      const mockFileStream = {
        pipe: vi.fn().mockReturnValue(mockWriteStream),
        on: vi.fn().mockReturnThis(),
      }

      const result = await adapter.uploadFile({
        destinationId: 'bucket-1',
        folderPath: '',
        fileName: 'root-file.txt',
        fileStream: mockFileStream as any,
        fileSize: 50,
        mimeType: 'text/plain',
      })

      expect(result.path).toBe('root-file.txt')
    })

    it('handles upload errors', async () => {
      await adapter.initialize(credentials)

      const mockWriteStream = {
        on: vi.fn().mockImplementation((event, callback) => {
          if (event === 'error') {
            setTimeout(() => callback(new Error('Upload failed')), 0)
          }
          return mockWriteStream
        }),
      }
      mocks.createWriteStream.mockReturnValue(mockWriteStream)

      const mockFileStream = {
        pipe: vi.fn().mockReturnValue(mockWriteStream),
        on: vi.fn().mockReturnThis(),
      }

      await expect(
        adapter.uploadFile({
          destinationId: 'bucket-1',
          folderPath: 'backup',
          fileName: 'test.txt',
          fileStream: mockFileStream as any,
          fileSize: 100,
          mimeType: 'text/plain',
        })
      ).rejects.toThrow('Upload failed')
    })
  })
})
