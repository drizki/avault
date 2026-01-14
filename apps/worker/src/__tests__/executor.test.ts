/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, vi, beforeEach } from 'vitest'

const mocks = vi.hoisted(() => ({
  credentialFindUnique: vi.fn(),
  destinationFindUnique: vi.fn(),
  decrypt: vi.fn(),
  getStorageAdapter: vi.fn(),
  adapterInitialize: vi.fn(),
  adapterCreateFolder: vi.fn(),
  adapterUploadFile: vi.fn(),
  adapterListBackups: vi.fn(),
  adapterDeleteFolder: vi.fn(),
  createLogPublisher: vi.fn(),
  logStreamInfo: vi.fn(),
  logStreamError: vi.fn(),
  readdir: vi.fn(),
  stat: vi.fn(),
  createReadStream: vi.fn(),
  loggerInfo: vi.fn(),
  loggerError: vi.fn(),
  loggerDebug: vi.fn(),
  loggerWarn: vi.fn(),
}))

vi.mock('@avault/shared', async (importOriginal) => {
  const actual = await importOriginal()
  return {
    ...(actual as object),
    decrypt: mocks.decrypt,
    logger: {
      info: mocks.loggerInfo,
      error: mocks.loggerError,
      debug: mocks.loggerDebug,
      warn: mocks.loggerWarn,
    },
  }
})

vi.mock('@avault/storage', () => ({
  getStorageAdapter: mocks.getStorageAdapter,
}))

vi.mock('./lib/log-stream', () => ({
  createLogPublisher: mocks.createLogPublisher,
}))

vi.mock('fs', () => ({
  promises: {
    readdir: mocks.readdir,
    stat: mocks.stat,
  },
  createReadStream: mocks.createReadStream,
}))

vi.mock('mime-types', () => ({
  lookup: vi.fn().mockReturnValue('application/octet-stream'),
}))

import { executeBackupJob } from '../executor'

describe('executeBackupJob', () => {
  let mockDb: any
  let mockAdapter: any

  beforeEach(() => {
    vi.clearAllMocks()

    mockDb = {
      storageCredential: {
        findUnique: mocks.credentialFindUnique,
      },
      storageDestination: {
        findUnique: mocks.destinationFindUnique,
      },
    }

    mockAdapter = {
      initialize: mocks.adapterInitialize,
      createFolder: mocks.adapterCreateFolder,
      uploadFile: mocks.adapterUploadFile,
      listBackups: mocks.adapterListBackups,
      deleteFolder: mocks.adapterDeleteFolder,
    }

    // Setup default mocks
    mocks.getStorageAdapter.mockReturnValue(mockAdapter)
    mocks.createLogPublisher.mockReturnValue({
      info: mocks.logStreamInfo,
      error: mocks.logStreamError,
    })
    mocks.createReadStream.mockReturnValue({
      pipe: vi.fn(),
    })
  })

  it('executes backup job successfully', async () => {
    // Setup file system mocks
    mocks.readdir.mockResolvedValue([
      { name: 'file1.txt', isDirectory: () => false, isFile: () => true },
      { name: 'file2.txt', isDirectory: () => false, isFile: () => true },
    ])
    mocks.stat.mockResolvedValue({ size: 1024 })

    // Setup credential and destination
    mocks.credentialFindUnique.mockResolvedValue({
      id: 'cred-1',
      provider: 's3',
      encryptedData: 'encrypted',
      iv: 'iv',
      authTag: 'tag',
    })
    mocks.destinationFindUnique.mockResolvedValue({
      id: 'dest-1',
      remoteId: 'bucket-1',
    })
    mocks.decrypt.mockReturnValue(JSON.stringify({ access_key: 'key' }))

    // Setup adapter mocks
    mocks.adapterInitialize.mockResolvedValue(undefined)
    mocks.adapterCreateFolder.mockResolvedValue({
      id: 'folder-1',
      name: 'backup-2024-01-15',
      path: '/backup-2024-01-15',
    })
    mocks.adapterUploadFile.mockResolvedValue(undefined)
    mocks.adapterListBackups.mockResolvedValue([])

    const onProgress = vi.fn()

    const result = await executeBackupJob(
      mockDb,
      {
        jobId: 'job-1',
        historyId: 'hist-1',
        sourcePath: '/test/data',
        destinationId: 'dest-1',
        credentialId: 'cred-1',
        namePattern: 'backup-{date}',
        retentionPolicy: { type: 'VERSION_COUNT', count: 5 },
      },
      'user-123',
      onProgress
    )

    expect(result.success).toBe(true)
    expect(result.filesScanned).toBe(2)
    expect(result.filesUploaded).toBe(2)
    expect(result.filesFailed).toBe(0)
    expect(onProgress).toHaveBeenCalled()
  })

  it('fails when no files found in source', async () => {
    mocks.readdir.mockResolvedValue([])

    const onProgress = vi.fn()

    const result = await executeBackupJob(
      mockDb,
      {
        jobId: 'job-1',
        historyId: 'hist-1',
        sourcePath: '/empty/dir',
        destinationId: 'dest-1',
        credentialId: 'cred-1',
        namePattern: 'backup-{date}',
        retentionPolicy: { type: 'VERSION_COUNT', count: 5 },
      },
      'user-123',
      onProgress
    )

    expect(result.success).toBe(false)
    expect(result.error).toBe('No files found in source directory')
  })

  it('fails when credential not found', async () => {
    mocks.readdir.mockResolvedValue([
      { name: 'file.txt', isDirectory: () => false, isFile: () => true },
    ])
    mocks.stat.mockResolvedValue({ size: 100 })
    mocks.credentialFindUnique.mockResolvedValue(null)

    const onProgress = vi.fn()

    const result = await executeBackupJob(
      mockDb,
      {
        jobId: 'job-1',
        historyId: 'hist-1',
        sourcePath: '/test',
        destinationId: 'dest-1',
        credentialId: 'cred-1',
        namePattern: 'backup-{date}',
        retentionPolicy: { type: 'VERSION_COUNT', count: 5 },
      },
      'user-123',
      onProgress
    )

    expect(result.success).toBe(false)
    expect(result.error).toBe('Credential not found')
  })

  it('fails when destination not found', async () => {
    mocks.readdir.mockResolvedValue([
      { name: 'file.txt', isDirectory: () => false, isFile: () => true },
    ])
    mocks.stat.mockResolvedValue({ size: 100 })
    mocks.credentialFindUnique.mockResolvedValue({
      id: 'cred-1',
      provider: 's3',
      encryptedData: 'encrypted',
      iv: 'iv',
      authTag: 'tag',
    })
    mocks.destinationFindUnique.mockResolvedValue(null)
    mocks.decrypt.mockReturnValue(JSON.stringify({}))

    const onProgress = vi.fn()

    const result = await executeBackupJob(
      mockDb,
      {
        jobId: 'job-1',
        historyId: 'hist-1',
        sourcePath: '/test',
        destinationId: 'dest-1',
        credentialId: 'cred-1',
        namePattern: 'backup-{date}',
        retentionPolicy: { type: 'VERSION_COUNT', count: 5 },
      },
      'user-123',
      onProgress
    )

    expect(result.success).toBe(false)
    expect(result.error).toBe('Destination not found')
  })

  it('handles upload failures gracefully', async () => {
    mocks.readdir.mockResolvedValue([
      { name: 'file1.txt', isDirectory: () => false, isFile: () => true },
      { name: 'file2.txt', isDirectory: () => false, isFile: () => true },
    ])
    mocks.stat.mockResolvedValue({ size: 1024 })
    mocks.credentialFindUnique.mockResolvedValue({
      id: 'cred-1',
      provider: 's3',
      encryptedData: 'enc',
      iv: 'iv',
      authTag: 'tag',
    })
    mocks.destinationFindUnique.mockResolvedValue({
      id: 'dest-1',
      remoteId: 'bucket-1',
    })
    mocks.decrypt.mockReturnValue(JSON.stringify({}))
    mocks.adapterInitialize.mockResolvedValue(undefined)
    mocks.adapterCreateFolder.mockResolvedValue({
      id: 'folder-1',
      name: 'backup',
      path: '/backup',
    })
    // First upload succeeds, second fails
    mocks.adapterUploadFile
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error('Upload failed'))
    mocks.adapterListBackups.mockResolvedValue([])

    const onProgress = vi.fn()

    const result = await executeBackupJob(
      mockDb,
      {
        jobId: 'job-1',
        historyId: 'hist-1',
        sourcePath: '/test',
        destinationId: 'dest-1',
        credentialId: 'cred-1',
        namePattern: 'backup-{date}',
        retentionPolicy: { type: 'VERSION_COUNT', count: 5 },
      },
      'user-123',
      onProgress
    )

    // Job should still complete (partial success)
    expect(result.success).toBe(true)
    expect(result.filesUploaded).toBe(1)
    expect(result.filesFailed).toBe(1)
  })

  it('skips OS junk directories', async () => {
    mocks.readdir.mockResolvedValue([
      { name: 'file.txt', isDirectory: () => false, isFile: () => true },
      { name: '$RECYCLE.BIN', isDirectory: () => true, isFile: () => false },
      { name: 'System Volume Information', isDirectory: () => true, isFile: () => false },
    ])
    mocks.stat.mockResolvedValue({ size: 100 })
    mocks.credentialFindUnique.mockResolvedValue({
      id: 'cred-1',
      provider: 's3',
      encryptedData: 'enc',
      iv: 'iv',
      authTag: 'tag',
    })
    mocks.destinationFindUnique.mockResolvedValue({
      id: 'dest-1',
      remoteId: 'bucket-1',
    })
    mocks.decrypt.mockReturnValue(JSON.stringify({}))
    mocks.adapterInitialize.mockResolvedValue(undefined)
    mocks.adapterCreateFolder.mockResolvedValue({
      id: 'folder-1',
      name: 'backup',
      path: '/backup',
    })
    mocks.adapterUploadFile.mockResolvedValue(undefined)
    mocks.adapterListBackups.mockResolvedValue([])

    const onProgress = vi.fn()

    const result = await executeBackupJob(
      mockDb,
      {
        jobId: 'job-1',
        historyId: 'hist-1',
        sourcePath: '/test',
        destinationId: 'dest-1',
        credentialId: 'cred-1',
        namePattern: 'backup-{date}',
        retentionPolicy: { type: 'VERSION_COUNT', count: 5 },
      },
      'user-123',
      onProgress
    )

    // Only file.txt should be scanned (OS junk directories skipped)
    expect(result.filesScanned).toBe(1)
    expect(result.filesUploaded).toBe(1)
    expect(mocks.loggerDebug).toHaveBeenCalledWith(
      expect.objectContaining({ path: expect.stringContaining('$RECYCLE.BIN') }),
      'Skipping OS junk directory'
    )
  })

  it('handles file stat errors gracefully', async () => {
    mocks.readdir.mockResolvedValue([
      { name: 'file1.txt', isDirectory: () => false, isFile: () => true },
      { name: 'file2.txt', isDirectory: () => false, isFile: () => true },
    ])
    // First file succeeds, second file fails to stat
    mocks.stat
      .mockResolvedValueOnce({ size: 100 })
      .mockRejectedValueOnce(new Error('Permission denied'))
    mocks.credentialFindUnique.mockResolvedValue({
      id: 'cred-1',
      provider: 's3',
      encryptedData: 'enc',
      iv: 'iv',
      authTag: 'tag',
    })
    mocks.destinationFindUnique.mockResolvedValue({
      id: 'dest-1',
      remoteId: 'bucket-1',
    })
    mocks.decrypt.mockReturnValue(JSON.stringify({}))
    mocks.adapterInitialize.mockResolvedValue(undefined)
    mocks.adapterCreateFolder.mockResolvedValue({
      id: 'folder-1',
      name: 'backup',
      path: '/backup',
    })
    mocks.adapterUploadFile.mockResolvedValue(undefined)
    mocks.adapterListBackups.mockResolvedValue([])

    const onProgress = vi.fn()

    const result = await executeBackupJob(
      mockDb,
      {
        jobId: 'job-1',
        historyId: 'hist-1',
        sourcePath: '/test',
        destinationId: 'dest-1',
        credentialId: 'cred-1',
        namePattern: 'backup-{date}',
        retentionPolicy: { type: 'VERSION_COUNT', count: 5 },
      },
      'user-123',
      onProgress
    )

    // Only file1.txt should be successfully scanned
    expect(result.filesScanned).toBe(1)
    expect(mocks.loggerError).toHaveBeenCalledWith(
      expect.objectContaining({ error: 'Permission denied' }),
      'Error getting file stats'
    )
  })

  it('skips OS junk files', async () => {
    mocks.readdir.mockResolvedValue([
      { name: 'file.txt', isDirectory: () => false, isFile: () => true },
      { name: '.DS_Store', isDirectory: () => false, isFile: () => true },
      { name: 'Thumbs.db', isDirectory: () => false, isFile: () => true },
    ])
    mocks.stat.mockResolvedValue({ size: 100 })
    mocks.credentialFindUnique.mockResolvedValue({
      id: 'cred-1',
      provider: 's3',
      encryptedData: 'enc',
      iv: 'iv',
      authTag: 'tag',
    })
    mocks.destinationFindUnique.mockResolvedValue({
      id: 'dest-1',
      remoteId: 'bucket-1',
    })
    mocks.decrypt.mockReturnValue(JSON.stringify({}))
    mocks.adapterInitialize.mockResolvedValue(undefined)
    mocks.adapterCreateFolder.mockResolvedValue({
      id: 'folder-1',
      name: 'backup',
      path: '/backup',
    })
    mocks.adapterUploadFile.mockResolvedValue(undefined)
    mocks.adapterListBackups.mockResolvedValue([])

    const onProgress = vi.fn()

    const result = await executeBackupJob(
      mockDb,
      {
        jobId: 'job-1',
        historyId: 'hist-1',
        sourcePath: '/test',
        destinationId: 'dest-1',
        credentialId: 'cred-1',
        namePattern: 'backup-{date}',
        retentionPolicy: { type: 'VERSION_COUNT', count: 5 },
      },
      'user-123',
      onProgress
    )

    // Only file.txt should be scanned (OS junk files skipped)
    expect(result.filesScanned).toBe(1)
    expect(result.filesUploaded).toBe(1)
  })

  it('applies VERSION_COUNT retention policy', async () => {
    mocks.readdir.mockResolvedValue([
      { name: 'file.txt', isDirectory: () => false, isFile: () => true },
    ])
    mocks.stat.mockResolvedValue({ size: 100 })
    mocks.credentialFindUnique.mockResolvedValue({
      id: 'cred-1',
      provider: 's3',
      encryptedData: 'enc',
      iv: 'iv',
      authTag: 'tag',
    })
    mocks.destinationFindUnique.mockResolvedValue({
      id: 'dest-1',
      remoteId: 'bucket-1',
    })
    mocks.decrypt.mockReturnValue(JSON.stringify({}))
    mocks.adapterInitialize.mockResolvedValue(undefined)
    mocks.adapterCreateFolder.mockResolvedValue({
      id: 'folder-1',
      name: 'backup',
      path: '/backup',
    })
    mocks.adapterUploadFile.mockResolvedValue(undefined)
    // Return 5 existing backups, policy is to keep 3
    mocks.adapterListBackups.mockResolvedValue([
      { path: '/backup-1', createdTime: new Date('2024-01-15') },
      { path: '/backup-2', createdTime: new Date('2024-01-14') },
      { path: '/backup-3', createdTime: new Date('2024-01-13') },
      { path: '/backup-4', createdTime: new Date('2024-01-12') },
      { path: '/backup-5', createdTime: new Date('2024-01-11') },
    ])
    mocks.adapterDeleteFolder.mockResolvedValue(undefined)

    const onProgress = vi.fn()

    await executeBackupJob(
      mockDb,
      {
        jobId: 'job-1',
        historyId: 'hist-1',
        sourcePath: '/test',
        destinationId: 'dest-1',
        credentialId: 'cred-1',
        namePattern: 'backup-{date}',
        retentionPolicy: { type: 'VERSION_COUNT', count: 3 },
      },
      'user-123',
      onProgress
    )

    // Should delete 2 oldest backups (backup-4 and backup-5)
    expect(mocks.adapterDeleteFolder).toHaveBeenCalledTimes(2)
  })

  it('applies DAYS retention policy', async () => {
    mocks.readdir.mockResolvedValue([
      { name: 'file.txt', isDirectory: () => false, isFile: () => true },
    ])
    mocks.stat.mockResolvedValue({ size: 100 })
    mocks.credentialFindUnique.mockResolvedValue({
      id: 'cred-1',
      provider: 's3',
      encryptedData: 'enc',
      iv: 'iv',
      authTag: 'tag',
    })
    mocks.destinationFindUnique.mockResolvedValue({
      id: 'dest-1',
      remoteId: 'bucket-1',
    })
    mocks.decrypt.mockReturnValue(JSON.stringify({}))
    mocks.adapterInitialize.mockResolvedValue(undefined)
    mocks.adapterCreateFolder.mockResolvedValue({
      id: 'folder-1',
      name: 'backup',
      path: '/backup',
    })
    mocks.adapterUploadFile.mockResolvedValue(undefined)

    // Create dates relative to now
    const now = new Date()
    const twoDaysAgo = new Date(now.getTime() - 2 * 24 * 60 * 60 * 1000)
    const tenDaysAgo = new Date(now.getTime() - 10 * 24 * 60 * 60 * 1000)
    const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000)

    mocks.adapterListBackups.mockResolvedValue([
      { path: '/backup-1', createdTime: twoDaysAgo },
      { path: '/backup-2', createdTime: tenDaysAgo },
      { path: '/backup-3', createdTime: thirtyDaysAgo },
    ])
    mocks.adapterDeleteFolder.mockResolvedValue(undefined)

    const onProgress = vi.fn()

    await executeBackupJob(
      mockDb,
      {
        jobId: 'job-1',
        historyId: 'hist-1',
        sourcePath: '/test',
        destinationId: 'dest-1',
        credentialId: 'cred-1',
        namePattern: 'backup-{date}',
        retentionPolicy: { type: 'DAYS', days: 7 },
      },
      'user-123',
      onProgress
    )

    // Should delete backups older than 7 days
    expect(mocks.adapterDeleteFolder).toHaveBeenCalledTimes(2)
  })

  it('handles retention policy errors gracefully', async () => {
    mocks.readdir.mockResolvedValue([
      { name: 'file.txt', isDirectory: () => false, isFile: () => true },
    ])
    mocks.stat.mockResolvedValue({ size: 100 })
    mocks.credentialFindUnique.mockResolvedValue({
      id: 'cred-1',
      provider: 's3',
      encryptedData: 'enc',
      iv: 'iv',
      authTag: 'tag',
    })
    mocks.destinationFindUnique.mockResolvedValue({
      id: 'dest-1',
      remoteId: 'bucket-1',
    })
    mocks.decrypt.mockReturnValue(JSON.stringify({}))
    mocks.adapterInitialize.mockResolvedValue(undefined)
    mocks.adapterCreateFolder.mockResolvedValue({
      id: 'folder-1',
      name: 'backup',
      path: '/backup',
    })
    mocks.adapterUploadFile.mockResolvedValue(undefined)
    // Make listBackups fail
    mocks.adapterListBackups.mockRejectedValue(new Error('Retention error'))

    const onProgress = vi.fn()

    const result = await executeBackupJob(
      mockDb,
      {
        jobId: 'job-1',
        historyId: 'hist-1',
        sourcePath: '/test',
        destinationId: 'dest-1',
        credentialId: 'cred-1',
        namePattern: 'backup-{date}',
        retentionPolicy: { type: 'VERSION_COUNT', count: 5 },
      },
      'user-123',
      onProgress
    )

    // Should still succeed - retention failure shouldn't fail the backup
    expect(result.success).toBe(true)
    expect(mocks.loggerError).toHaveBeenCalledWith(
      expect.objectContaining({ error: 'Retention error' }),
      'Failed to apply retention policy'
    )
  })

  it('handles individual backup deletion failures gracefully', async () => {
    mocks.readdir.mockResolvedValue([
      { name: 'file.txt', isDirectory: () => false, isFile: () => true },
    ])
    mocks.stat.mockResolvedValue({ size: 100 })
    mocks.credentialFindUnique.mockResolvedValue({
      id: 'cred-1',
      provider: 's3',
      encryptedData: 'enc',
      iv: 'iv',
      authTag: 'tag',
    })
    mocks.destinationFindUnique.mockResolvedValue({
      id: 'dest-1',
      remoteId: 'bucket-1',
    })
    mocks.decrypt.mockReturnValue(JSON.stringify({}))
    mocks.adapterInitialize.mockResolvedValue(undefined)
    mocks.adapterCreateFolder.mockResolvedValue({
      id: 'folder-1',
      name: 'backup',
      path: '/backup',
    })
    mocks.adapterUploadFile.mockResolvedValue(undefined)
    // Return more backups than retention count
    mocks.adapterListBackups.mockResolvedValue([
      { path: '/backup-1', createdTime: new Date('2024-01-15') },
      { path: '/backup-2', createdTime: new Date('2024-01-14') },
      { path: '/backup-3', createdTime: new Date('2024-01-13') },
      { path: '/backup-4', createdTime: new Date('2024-01-12') },
    ])
    // Make deleteFolder fail for one backup
    mocks.adapterDeleteFolder.mockRejectedValue(new Error('Delete failed'))

    const onProgress = vi.fn()

    const result = await executeBackupJob(
      mockDb,
      {
        jobId: 'job-1',
        historyId: 'hist-1',
        sourcePath: '/test',
        destinationId: 'dest-1',
        credentialId: 'cred-1',
        namePattern: 'backup-{date}',
        retentionPolicy: { type: 'VERSION_COUNT', count: 2 },
      },
      'user-123',
      onProgress
    )

    // Backup should still succeed even if old backup deletion fails
    expect(result.success).toBe(true)
    expect(mocks.loggerError).toHaveBeenCalledWith(
      expect.objectContaining({ error: 'Delete failed' }),
      'Failed to delete old backup'
    )
  })

  it('applies HYBRID retention policy', async () => {
    mocks.readdir.mockResolvedValue([
      { name: 'file.txt', isDirectory: () => false, isFile: () => true },
    ])
    mocks.stat.mockResolvedValue({ size: 100 })
    mocks.credentialFindUnique.mockResolvedValue({
      id: 'cred-1',
      provider: 's3',
      encryptedData: 'enc',
      iv: 'iv',
      authTag: 'tag',
    })
    mocks.destinationFindUnique.mockResolvedValue({
      id: 'dest-1',
      remoteId: 'bucket-1',
    })
    mocks.decrypt.mockReturnValue(JSON.stringify({}))
    mocks.adapterInitialize.mockResolvedValue(undefined)
    mocks.adapterCreateFolder.mockResolvedValue({
      id: 'folder-1',
      name: 'backup',
      path: '/backup',
    })
    mocks.adapterUploadFile.mockResolvedValue(undefined)

    // Create dates for hybrid policy test
    const now = new Date()
    const oneDayAgo = new Date(now.getTime() - 1 * 24 * 60 * 60 * 1000)
    const fiveDaysAgo = new Date(now.getTime() - 5 * 24 * 60 * 60 * 1000)
    const tenDaysAgo = new Date(now.getTime() - 10 * 24 * 60 * 60 * 1000)
    const twentyDaysAgo = new Date(now.getTime() - 20 * 24 * 60 * 60 * 1000)
    const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000)

    mocks.adapterListBackups.mockResolvedValue([
      { path: '/backup-1', createdTime: oneDayAgo },      // Keep (within version count)
      { path: '/backup-2', createdTime: fiveDaysAgo },    // Keep (within version count)
      { path: '/backup-3', createdTime: tenDaysAgo },     // Keep (within version count OR days)
      { path: '/backup-4', createdTime: twentyDaysAgo },  // Delete (outside count and days)
      { path: '/backup-5', createdTime: thirtyDaysAgo },  // Delete (outside count and days)
    ])
    mocks.adapterDeleteFolder.mockResolvedValue(undefined)

    const onProgress = vi.fn()

    await executeBackupJob(
      mockDb,
      {
        jobId: 'job-1',
        historyId: 'hist-1',
        sourcePath: '/test',
        destinationId: 'dest-1',
        credentialId: 'cred-1',
        namePattern: 'backup-{date}',
        retentionPolicy: { type: 'HYBRID', count: 3, days: 14 },
      },
      'user-123',
      onProgress
    )

    // Should delete backups outside both version count AND days
    // backup-4 and backup-5 are both older than 14 days AND beyond the top 3
    expect(mocks.adapterDeleteFolder).toHaveBeenCalledTimes(2)
  })

  it('logs when no backups need to be deleted', async () => {
    mocks.readdir.mockResolvedValue([
      { name: 'file.txt', isDirectory: () => false, isFile: () => true },
    ])
    mocks.stat.mockResolvedValue({ size: 100 })
    mocks.credentialFindUnique.mockResolvedValue({
      id: 'cred-1',
      provider: 's3',
      encryptedData: 'enc',
      iv: 'iv',
      authTag: 'tag',
    })
    mocks.destinationFindUnique.mockResolvedValue({
      id: 'dest-1',
      remoteId: 'bucket-1',
    })
    mocks.decrypt.mockReturnValue(JSON.stringify({}))
    mocks.adapterInitialize.mockResolvedValue(undefined)
    mocks.adapterCreateFolder.mockResolvedValue({
      id: 'folder-1',
      name: 'backup',
      path: '/backup',
    })
    mocks.adapterUploadFile.mockResolvedValue(undefined)
    // Return fewer backups than retention count
    mocks.adapterListBackups.mockResolvedValue([
      { path: '/backup-1', createdTime: new Date('2024-01-15') },
    ])

    const onProgress = vi.fn()

    const result = await executeBackupJob(
      mockDb,
      {
        jobId: 'job-1',
        historyId: 'hist-1',
        sourcePath: '/test',
        destinationId: 'dest-1',
        credentialId: 'cred-1',
        namePattern: 'backup-{date}',
        retentionPolicy: { type: 'VERSION_COUNT', count: 5 },
      },
      'user-123',
      onProgress
    )

    expect(result.success).toBe(true)
    // Shouldn't try to delete any backups
    expect(mocks.adapterDeleteFolder).not.toHaveBeenCalled()
    expect(mocks.loggerInfo).toHaveBeenCalledWith('No backups to delete')
  })

  it('handles directory scan errors gracefully', async () => {
    mocks.readdir.mockRejectedValue(new Error('Permission denied'))

    const onProgress = vi.fn()

    const result = await executeBackupJob(
      mockDb,
      {
        jobId: 'job-1',
        historyId: 'hist-1',
        sourcePath: '/protected',
        destinationId: 'dest-1',
        credentialId: 'cred-1',
        namePattern: 'backup-{date}',
        retentionPolicy: { type: 'VERSION_COUNT', count: 5 },
      },
      'user-123',
      onProgress
    )

    expect(result.success).toBe(false)
    expect(result.error).toBe('No files found in source directory')
  })

  it('reports progress during execution', async () => {
    mocks.readdir.mockResolvedValue([
      { name: 'file.txt', isDirectory: () => false, isFile: () => true },
    ])
    mocks.stat.mockResolvedValue({ size: 100 })
    mocks.credentialFindUnique.mockResolvedValue({
      id: 'cred-1',
      provider: 's3',
      encryptedData: 'enc',
      iv: 'iv',
      authTag: 'tag',
    })
    mocks.destinationFindUnique.mockResolvedValue({
      id: 'dest-1',
      remoteId: 'bucket-1',
    })
    mocks.decrypt.mockReturnValue(JSON.stringify({}))
    mocks.adapterInitialize.mockResolvedValue(undefined)
    mocks.adapterCreateFolder.mockResolvedValue({
      id: 'folder-1',
      name: 'backup',
      path: '/backup',
    })
    mocks.adapterUploadFile.mockResolvedValue(undefined)
    mocks.adapterListBackups.mockResolvedValue([])

    const onProgress = vi.fn()

    await executeBackupJob(
      mockDb,
      {
        jobId: 'job-1',
        historyId: 'hist-1',
        sourcePath: '/test',
        destinationId: 'dest-1',
        credentialId: 'cred-1',
        namePattern: 'backup-{date}',
        retentionPolicy: { type: 'VERSION_COUNT', count: 5 },
      },
      'user-123',
      onProgress
    )

    // Should report progress at various stages
    expect(onProgress).toHaveBeenCalled()

    // Check for different status phases
    const calls = onProgress.mock.calls
    const statuses = calls.map((c) => c[0].status)
    expect(statuses).toContain('RUNNING') // Scanning phase
    expect(statuses).toContain('UPLOADING') // Upload phase
    expect(statuses).toContain('ROTATING') // Retention phase
  })

  it('scans nested directories', async () => {
    // First call returns a directory
    mocks.readdir
      .mockResolvedValueOnce([
        { name: 'subdir', isDirectory: () => true, isFile: () => false },
        { name: 'root.txt', isDirectory: () => false, isFile: () => true },
      ])
      // Second call (subdir) returns a file
      .mockResolvedValueOnce([
        { name: 'nested.txt', isDirectory: () => false, isFile: () => true },
      ])

    mocks.stat.mockResolvedValue({ size: 100 })
    mocks.credentialFindUnique.mockResolvedValue({
      id: 'cred-1',
      provider: 's3',
      encryptedData: 'enc',
      iv: 'iv',
      authTag: 'tag',
    })
    mocks.destinationFindUnique.mockResolvedValue({
      id: 'dest-1',
      remoteId: 'bucket-1',
    })
    mocks.decrypt.mockReturnValue(JSON.stringify({}))
    mocks.adapterInitialize.mockResolvedValue(undefined)
    mocks.adapterCreateFolder.mockResolvedValue({
      id: 'folder-1',
      name: 'backup',
      path: '/backup',
    })
    mocks.adapterUploadFile.mockResolvedValue(undefined)
    mocks.adapterListBackups.mockResolvedValue([])

    const onProgress = vi.fn()

    const result = await executeBackupJob(
      mockDb,
      {
        jobId: 'job-1',
        historyId: 'hist-1',
        sourcePath: '/test',
        destinationId: 'dest-1',
        credentialId: 'cred-1',
        namePattern: 'backup-{date}',
        retentionPolicy: { type: 'VERSION_COUNT', count: 5 },
      },
      'user-123',
      onProgress
    )

    // Should find both root.txt and nested.txt
    expect(result.filesScanned).toBe(2)
  })
})

describe('preBuildFolderStructure', () => {
  let mockDb: any

  beforeEach(() => {
    vi.clearAllMocks()
    mockDb = {
      storageCredential: {
        findUnique: mocks.credentialFindUnique,
      },
      storageDestination: {
        findUnique: mocks.destinationFindUnique,
      },
    }

    mocks.createLogPublisher.mockReturnValue({
      info: mocks.logStreamInfo,
      error: mocks.logStreamError,
    })
  })

  it('calls preBuildFolderStructure when adapter supports it', async () => {
    mocks.readdir.mockResolvedValue([
      { name: 'file.txt', isDirectory: () => false, isFile: () => true },
    ])
    mocks.stat.mockResolvedValue({ size: 100 })
    mocks.credentialFindUnique.mockResolvedValue({
      id: 'cred-1',
      provider: 's3',
      encryptedData: 'enc',
      iv: 'iv',
      authTag: 'tag',
    })
    mocks.destinationFindUnique.mockResolvedValue({
      id: 'dest-1',
      remoteId: 'bucket-1',
    })
    mocks.decrypt.mockReturnValue(JSON.stringify({}))

    const mockPreBuild = vi.fn().mockResolvedValue(undefined)
    mocks.getStorageAdapter.mockReturnValue({
      initialize: vi.fn().mockResolvedValue(undefined),
      createFolder: vi.fn().mockResolvedValue({
        id: 'folder-1',
        name: 'backup',
        path: '/backup',
      }),
      uploadFile: vi.fn().mockResolvedValue(undefined),
      listBackups: vi.fn().mockResolvedValue([]),
      preBuildFolderStructure: mockPreBuild,
    })

    const result = await executeBackupJob(
      mockDb,
      {
        jobId: 'job-1',
        historyId: 'hist-1',
        sourcePath: '/test',
        destinationId: 'dest-1',
        credentialId: 'cred-1',
        namePattern: 'backup-{date}',
        retentionPolicy: { type: 'VERSION_COUNT', count: 5 },
      },
      'user-123',
      vi.fn()
    )

    expect(result.success).toBe(true)
    expect(mockPreBuild).toHaveBeenCalled()
  })
})

describe('generateBackupName', () => {
  let mockDb: any

  beforeEach(() => {
    vi.clearAllMocks()
    mockDb = {
      storageCredential: {
        findUnique: mocks.credentialFindUnique,
      },
      storageDestination: {
        findUnique: mocks.destinationFindUnique,
      },
    }

    mocks.createLogPublisher.mockReturnValue({
      info: mocks.logStreamInfo,
      error: mocks.logStreamError,
    })
  })

  it('generates backup name with date pattern', async () => {
    mocks.readdir.mockResolvedValue([
      { name: 'file.txt', isDirectory: () => false, isFile: () => true },
    ])
    mocks.stat.mockResolvedValue({ size: 100 })
    mocks.credentialFindUnique.mockResolvedValue({
      id: 'cred-1',
      provider: 's3',
      encryptedData: 'enc',
      iv: 'iv',
      authTag: 'tag',
    })
    mocks.destinationFindUnique.mockResolvedValue({
      id: 'dest-1',
      remoteId: 'bucket-1',
    })
    mocks.decrypt.mockReturnValue(JSON.stringify({}))
    mocks.getStorageAdapter.mockReturnValue({
      initialize: vi.fn().mockResolvedValue(undefined),
      createFolder: vi.fn().mockResolvedValue({
        id: 'folder-1',
        name: 'backup-2024-01-15',
        path: '/backup-2024-01-15',
      }),
      uploadFile: vi.fn().mockResolvedValue(undefined),
      listBackups: vi.fn().mockResolvedValue([]),
    })

    const onProgress = vi.fn()

    const result = await executeBackupJob(
      mockDb,
      {
        jobId: 'job-1',
        historyId: 'hist-1',
        sourcePath: '/test',
        destinationId: 'dest-1',
        credentialId: 'cred-1',
        namePattern: 'backup-{date}',
        retentionPolicy: { type: 'VERSION_COUNT', count: 5 },
      },
      'user-123',
      onProgress
    )

    expect(result.remotePath).toMatch(/backup-/)
  })
})

describe('upload progress tracking', () => {
  let mockDb: any

  beforeEach(() => {
    vi.clearAllMocks()
    mockDb = {
      storageCredential: {
        findUnique: mocks.credentialFindUnique,
      },
      storageDestination: {
        findUnique: mocks.destinationFindUnique,
      },
    }

    mocks.createLogPublisher.mockReturnValue({
      info: mocks.logStreamInfo,
      error: mocks.logStreamError,
    })
  })

  it('tracks upload progress via onProgress callback', async () => {
    mocks.readdir.mockResolvedValue([
      { name: 'file.txt', isDirectory: () => false, isFile: () => true },
    ])
    mocks.stat.mockResolvedValue({ size: 1024 })
    mocks.credentialFindUnique.mockResolvedValue({
      id: 'cred-1',
      provider: 's3',
      encryptedData: 'enc',
      iv: 'iv',
      authTag: 'tag',
    })
    mocks.destinationFindUnique.mockResolvedValue({
      id: 'dest-1',
      remoteId: 'bucket-1',
    })
    mocks.decrypt.mockReturnValue(JSON.stringify({}))

    // Create an uploadFile mock that invokes the onProgress callback
    const mockUploadFile = vi.fn().mockImplementation(async (params: any) => {
      // Simulate progress callback
      if (params.onProgress) {
        params.onProgress({ bytesUploaded: 512 })
        params.onProgress({ bytesUploaded: 1024 })
      }
      return undefined
    })

    mocks.getStorageAdapter.mockReturnValue({
      initialize: vi.fn().mockResolvedValue(undefined),
      createFolder: vi.fn().mockResolvedValue({
        id: 'folder-1',
        name: 'backup',
        path: '/backup',
      }),
      uploadFile: mockUploadFile,
      listBackups: vi.fn().mockResolvedValue([]),
    })

    const onProgress = vi.fn()

    const result = await executeBackupJob(
      mockDb,
      {
        jobId: 'job-1',
        historyId: 'hist-1',
        sourcePath: '/test',
        destinationId: 'dest-1',
        credentialId: 'cred-1',
        namePattern: 'backup-{date}',
        retentionPolicy: { type: 'VERSION_COUNT', count: 5 },
      },
      'user-123',
      onProgress
    )

    expect(result.success).toBe(true)
    expect(mockUploadFile).toHaveBeenCalled()
    // Progress should have been reported
    expect(onProgress).toHaveBeenCalled()
  })
})

describe('successful backup with bytesUploaded', () => {
  let mockDb: any

  beforeEach(() => {
    vi.clearAllMocks()
    mockDb = {
      storageCredential: {
        findUnique: mocks.credentialFindUnique,
      },
      storageDestination: {
        findUnique: mocks.destinationFindUnique,
      },
    }

    mocks.createLogPublisher.mockReturnValue({
      info: mocks.logStreamInfo,
      error: mocks.logStreamError,
    })
  })

  it('tracks bytes uploaded in result', async () => {
    mocks.readdir.mockResolvedValue([
      { name: 'file.txt', isDirectory: () => false, isFile: () => true },
    ])
    mocks.stat.mockResolvedValue({ size: 1048576 }) // 1 MB
    mocks.credentialFindUnique.mockResolvedValue({
      id: 'cred-1',
      provider: 's3',
      encryptedData: 'enc',
      iv: 'iv',
      authTag: 'tag',
    })
    mocks.destinationFindUnique.mockResolvedValue({
      id: 'dest-1',
      remoteId: 'bucket-1',
    })
    mocks.decrypt.mockReturnValue(JSON.stringify({}))
    mocks.getStorageAdapter.mockReturnValue({
      initialize: vi.fn().mockResolvedValue(undefined),
      createFolder: vi.fn().mockResolvedValue({
        id: 'folder-1',
        name: 'backup',
        path: '/backup',
      }),
      uploadFile: vi.fn().mockResolvedValue(undefined),
      listBackups: vi.fn().mockResolvedValue([]),
    })

    const result = await executeBackupJob(
      mockDb,
      {
        jobId: 'job-1',
        historyId: 'hist-1',
        sourcePath: '/test',
        destinationId: 'dest-1',
        credentialId: 'cred-1',
        namePattern: 'backup-{date}',
        retentionPolicy: { type: 'VERSION_COUNT', count: 5 },
      },
      'user-123',
      vi.fn()
    )

    expect(result.success).toBe(true)
    expect(result.bytesUploaded).toBe(1048576)
    expect(result.filesUploaded).toBe(1)
  })
})
