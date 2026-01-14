/* eslint-disable @typescript-eslint/no-non-null-assertion */
import { describe, it, expect, vi, beforeEach } from 'vitest'

const mocks = vi.hoisted(() => ({
  send: vi.fn(),
  uploadDone: vi.fn(),
  uploadOn: vi.fn(),
}))

vi.mock('@aws-sdk/client-s3', () => ({
  S3Client: vi.fn().mockImplementation(() => ({
    send: mocks.send,
  })),
  ListBucketsCommand: vi.fn().mockImplementation((input) => ({ input, type: 'ListBuckets' })),
  ListObjectsV2Command: vi.fn().mockImplementation((input) => ({ input, type: 'ListObjects' })),
  PutObjectCommand: vi.fn().mockImplementation((input) => ({ input, type: 'PutObject' })),
  DeleteObjectsCommand: vi.fn().mockImplementation((input) => ({ input, type: 'DeleteObjects' })),
  HeadBucketCommand: vi.fn().mockImplementation((input) => ({ input, type: 'HeadBucket' })),
}))

vi.mock('@aws-sdk/lib-storage', () => ({
  Upload: vi.fn().mockImplementation(() => ({
    done: mocks.uploadDone,
    on: mocks.uploadOn,
  })),
}))

import { S3Adapter } from '../s3'

describe('S3Adapter', () => {
  let adapter: S3Adapter

  const mockCredentials = {
    access_key_id: 'AKIAIOSFODNN7EXAMPLE',
    secret_access_key: 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY',
    region: 'us-west-2',
  }

  beforeEach(async () => {
    vi.clearAllMocks()
    adapter = new S3Adapter()
    await adapter.initialize(mockCredentials)
  })

  describe('initialize', () => {
    it('creates S3 client with credentials', async () => {
      const { S3Client } = await import('@aws-sdk/client-s3')

      expect(S3Client).toHaveBeenCalledWith({
        region: 'us-west-2',
        credentials: {
          accessKeyId: 'AKIAIOSFODNN7EXAMPLE',
          secretAccessKey: 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY',
        },
      })
    })

    it('includes custom endpoint when provided', async () => {
      const { S3Client } = await import('@aws-sdk/client-s3')
      const newAdapter = new S3Adapter()

      await newAdapter.initialize({
        ...mockCredentials,
        endpoint: 'https://custom-s3.example.com',
      })

      expect(S3Client).toHaveBeenCalledWith(
        expect.objectContaining({
          endpoint: 'https://custom-s3.example.com',
        })
      )
    })

    it('enables path style when force_path_style is true', async () => {
      const { S3Client } = await import('@aws-sdk/client-s3')
      const newAdapter = new S3Adapter()

      await newAdapter.initialize({
        ...mockCredentials,
        force_path_style: true,
      })

      expect(S3Client).toHaveBeenCalledWith(
        expect.objectContaining({
          forcePathStyle: true,
        })
      )
    })
  })

  describe('listDestinations', () => {
    it('lists all S3 buckets', async () => {
      mocks.send.mockResolvedValue({
        Buckets: [
          { Name: 'bucket-1', CreationDate: new Date('2024-01-01') },
          { Name: 'bucket-2', CreationDate: new Date('2024-02-01') },
        ],
      })

      const destinations = await adapter.listDestinations()

      expect(destinations).toEqual([
        { id: 'bucket-1', name: 'bucket-1', provider: 's3', metadata: { creationDate: new Date('2024-01-01') } },
        { id: 'bucket-2', name: 'bucket-2', provider: 's3', metadata: { creationDate: new Date('2024-02-01') } },
      ])
    })

    it('returns empty array when no buckets', async () => {
      mocks.send.mockResolvedValue({ Buckets: undefined })

      const destinations = await adapter.listDestinations()

      expect(destinations).toEqual([])
    })

    it('throws when adapter not initialized', async () => {
      const uninitializedAdapter = new S3Adapter()

      await expect(uninitializedAdapter.listDestinations()).rejects.toThrow('Adapter not initialized')
    })
  })

  describe('listFolders', () => {
    it('lists folders in bucket root', async () => {
      mocks.send.mockResolvedValue({
        CommonPrefixes: [
          { Prefix: 'folder1/' },
          { Prefix: 'folder2/' },
        ],
      })

      const folders = await adapter.listFolders('my-bucket')

      expect(folders).toEqual([
        { id: 'folder1/', name: 'folder1', path: 'folder1/' },
        { id: 'folder2/', name: 'folder2', path: 'folder2/' },
      ])
    })

    it('lists folders with prefix', async () => {
      mocks.send.mockResolvedValue({
        CommonPrefixes: [
          { Prefix: 'parent/child1/' },
          { Prefix: 'parent/child2/' },
        ],
      })

      const folders = await adapter.listFolders('my-bucket', 'parent')

      expect(folders).toEqual([
        { id: 'parent/child1/', name: 'child1', path: 'parent/child1/' },
        { id: 'parent/child2/', name: 'child2', path: 'parent/child2/' },
      ])
    })

    it('normalizes prefix with trailing slash', async () => {
      mocks.send.mockResolvedValue({ CommonPrefixes: [] })

      await adapter.listFolders('my-bucket', 'path')

      const { ListObjectsV2Command } = await import('@aws-sdk/client-s3')
      expect(ListObjectsV2Command).toHaveBeenCalledWith({
        Bucket: 'my-bucket',
        Prefix: 'path/',
        Delimiter: '/',
      })
    })
  })

  describe('uploadFile', () => {
    it('uploads file to bucket', async () => {
      mocks.uploadDone.mockResolvedValue({})

      const mockStream = { pipe: vi.fn() }
      const result = await adapter.uploadFile({
        destinationId: 'my-bucket',
        folderPath: '',
        fileName: 'backup.tar.gz',
        fileStream: mockStream as unknown as NodeJS.ReadableStream,
        fileSize: 1024,
        mimeType: 'application/gzip',
      })

      expect(result).toEqual({
        fileId: 'backup.tar.gz',
        fileName: 'backup.tar.gz',
        size: 1024,
        path: 'backup.tar.gz',
      })
    })

    it('uploads file to folder path', async () => {
      mocks.uploadDone.mockResolvedValue({})

      const mockStream = { pipe: vi.fn() }
      const result = await adapter.uploadFile({
        destinationId: 'my-bucket',
        folderPath: 'backups/daily',
        fileName: 'backup.tar.gz',
        fileStream: mockStream as unknown as NodeJS.ReadableStream,
        fileSize: 2048,
        mimeType: 'application/gzip',
      })

      expect(result.path).toBe('backups/daily/backup.tar.gz')
    })

    it('calls onProgress during upload', async () => {
      mocks.uploadDone.mockResolvedValue({})

      // Capture the progress handler
      let progressHandler: ((progress: { loaded: number }) => void) | undefined
      mocks.uploadOn.mockImplementation((event: string, handler: (progress: { loaded: number }) => void) => {
        if (event === 'httpUploadProgress') {
          progressHandler = handler
        }
      })

      const mockStream = { pipe: vi.fn() }
      const onProgress = vi.fn()

      // Start upload (but mock uploadDone to trigger progress first)
      const uploadPromise = adapter.uploadFile({
        destinationId: 'my-bucket',
        folderPath: '',
        fileName: 'backup.tar.gz',
        fileStream: mockStream as unknown as NodeJS.ReadableStream,
        fileSize: 1000,
        mimeType: 'application/gzip',
        onProgress,
      })

      // Simulate progress callback
      progressHandler!({ loaded: 500 })

      await uploadPromise

      expect(onProgress).toHaveBeenCalledWith({
        bytesUploaded: 500,
        totalBytes: 1000,
        percentage: 50,
      })
    })
  })

  describe('createFolder', () => {
    it('creates folder placeholder object', async () => {
      mocks.send.mockResolvedValue({})

      const folder = await adapter.createFolder('my-bucket', 'new-folder')

      expect(folder).toMatchObject({
        id: 'new-folder/',
        name: 'new-folder',
        path: 'new-folder/',
      })
    })

    it('creates nested folder', async () => {
      mocks.send.mockResolvedValue({})

      const folder = await adapter.createFolder('my-bucket', 'child', 'parent')

      expect(folder).toMatchObject({
        id: 'parent/child/',
        name: 'child',
        path: 'parent/child/',
      })
    })
  })

  describe('renameFolder', () => {
    it('throws not supported error', async () => {
      await expect(adapter.renameFolder('bucket', 'old', 'new')).rejects.toThrow(
        'Rename not supported for S3-compatible storage'
      )
    })
  })

  describe('deleteFolder', () => {
    it('deletes all objects in folder', async () => {
      mocks.send
        .mockResolvedValueOnce({
          Contents: [
            { Key: 'folder/file1.txt' },
            { Key: 'folder/file2.txt' },
          ],
        })
        .mockResolvedValueOnce({})

      await adapter.deleteFolder('my-bucket', 'folder')

      expect(mocks.send).toHaveBeenCalledTimes(2)
    })

    it('handles empty folder gracefully', async () => {
      mocks.send.mockResolvedValueOnce({ Contents: [] })

      await adapter.deleteFolder('my-bucket', 'empty-folder')

      expect(mocks.send).toHaveBeenCalledTimes(1)
    })
  })

  describe('listBackups', () => {
    it('lists backup folders', async () => {
      mocks.send.mockResolvedValue({
        CommonPrefixes: [
          { Prefix: 'backups/backup-2024-01-01/' },
          { Prefix: 'backups/backup-2024-01-02/' },
        ],
      })

      const backups = await adapter.listBackups('my-bucket', 'backups')

      expect(backups).toEqual([
        { name: 'backup-2024-01-01', path: 'backups/backup-2024-01-01/', createdTime: expect.any(Date) },
        { name: 'backup-2024-01-02', path: 'backups/backup-2024-01-02/', createdTime: expect.any(Date) },
      ])
    })
  })

  describe('validateCredentials', () => {
    it('returns true when credentials are valid', async () => {
      mocks.send.mockResolvedValue({ Buckets: [] })

      const result = await adapter.validateCredentials()

      expect(result).toBe(true)
    })

    it('returns false when credentials are invalid', async () => {
      mocks.send.mockRejectedValue(new Error('Access Denied'))

      const result = await adapter.validateCredentials()

      expect(result).toBe(false)
    })

    it('returns false when adapter not initialized', async () => {
      const uninitializedAdapter = new S3Adapter()

      const result = await uninitializedAdapter.validateCredentials()

      expect(result).toBe(false)
    })
  })

  describe('validateBucketAccess', () => {
    it('returns true when bucket is accessible', async () => {
      mocks.send.mockResolvedValue({})

      const result = await adapter.validateBucketAccess('my-bucket')

      expect(result).toBe(true)
    })

    it('returns false when bucket not accessible', async () => {
      mocks.send.mockRejectedValue(new Error('NotFound'))

      const result = await adapter.validateBucketAccess('nonexistent-bucket')

      expect(result).toBe(false)
    })
  })
})
