import { describe, it, expect } from 'vitest'
import {
  getStorageAdapter,
  isSupportedProvider,
  GoogleDriveSharedAdapter,
  GoogleDriveMyDriveAdapter,
  GoogleCloudStorageAdapter,
  S3Adapter,
  S3CompatibleAdapter,
  StorageAdapter,
} from '../index'

describe('storage factory', () => {
  describe('getStorageAdapter', () => {
    it('returns GoogleDriveSharedAdapter for google_drive', () => {
      const adapter = getStorageAdapter('google_drive')
      expect(adapter).toBeInstanceOf(GoogleDriveSharedAdapter)
      expect(adapter.provider).toBe('google_drive_shared')
    })

    it('returns GoogleDriveSharedAdapter for google_drive_shared', () => {
      const adapter = getStorageAdapter('google_drive_shared')
      expect(adapter).toBeInstanceOf(GoogleDriveSharedAdapter)
    })

    it('returns GoogleDriveMyDriveAdapter for google_drive_my_drive', () => {
      const adapter = getStorageAdapter('google_drive_my_drive')
      expect(adapter).toBeInstanceOf(GoogleDriveMyDriveAdapter)
      expect(adapter.provider).toBe('google_drive_my_drive')
    })

    it('returns GoogleCloudStorageAdapter for google_cloud_storage', () => {
      const adapter = getStorageAdapter('google_cloud_storage')
      expect(adapter).toBeInstanceOf(GoogleCloudStorageAdapter)
      expect(adapter.provider).toBe('google_cloud_storage')
    })

    it('returns S3Adapter for s3', () => {
      const adapter = getStorageAdapter('s3')
      expect(adapter).toBeInstanceOf(S3Adapter)
      expect(adapter.provider).toBe('s3')
    })

    it('returns S3CompatibleAdapter for cloudflare_r2', () => {
      const adapter = getStorageAdapter('cloudflare_r2')
      expect(adapter).toBeInstanceOf(S3CompatibleAdapter)
      expect(adapter.provider).toBe('cloudflare_r2')
    })

    it('returns S3CompatibleAdapter for digitalocean_spaces', () => {
      const adapter = getStorageAdapter('digitalocean_spaces')
      expect(adapter).toBeInstanceOf(S3CompatibleAdapter)
      expect(adapter.provider).toBe('digitalocean_spaces')
    })

    it('throws for unsupported provider', () => {
      expect(() => getStorageAdapter('dropbox')).toThrow('Unsupported storage provider: dropbox')
      expect(() => getStorageAdapter('')).toThrow('Unsupported storage provider: ')
      expect(() => getStorageAdapter('invalid')).toThrow('Unsupported storage provider: invalid')
    })

    it('returns fresh instances each call', () => {
      const adapter1 = getStorageAdapter('s3')
      const adapter2 = getStorageAdapter('s3')
      expect(adapter1).not.toBe(adapter2)
    })
  })

  describe('isSupportedProvider', () => {
    it('returns true for all supported providers', () => {
      const supported = [
        'google_drive',
        'google_drive_shared',
        'google_drive_my_drive',
        'google_cloud_storage',
        's3',
        'cloudflare_r2',
        'digitalocean_spaces',
      ]

      for (const provider of supported) {
        expect(isSupportedProvider(provider)).toBe(true)
      }
    })

    it('returns false for unsupported providers', () => {
      expect(isSupportedProvider('dropbox')).toBe(false)
      expect(isSupportedProvider('onedrive')).toBe(false)
      expect(isSupportedProvider('')).toBe(false)
      expect(isSupportedProvider('invalid')).toBe(false)
    })
  })

  describe('adapter interface', () => {
    const providers = [
      'google_drive',
      'google_drive_my_drive',
      'google_cloud_storage',
      's3',
      'cloudflare_r2',
    ]

    it.each(providers)('%s adapter implements StorageAdapter interface', (provider) => {
      const adapter = getStorageAdapter(provider)

      // Check it extends StorageAdapter
      expect(adapter).toBeInstanceOf(StorageAdapter)

      // Check required methods exist
      expect(typeof adapter.initialize).toBe('function')
      expect(typeof adapter.listDestinations).toBe('function')
      expect(typeof adapter.listFolders).toBe('function')
      expect(typeof adapter.uploadFile).toBe('function')
      expect(typeof adapter.createFolder).toBe('function')
      expect(typeof adapter.renameFolder).toBe('function')
      expect(typeof adapter.deleteFolder).toBe('function')
      expect(typeof adapter.listBackups).toBe('function')
      expect(typeof adapter.validateCredentials).toBe('function')

      // Check provider property
      expect(typeof adapter.provider).toBe('string')
      expect(adapter.provider.length).toBeGreaterThan(0)
    })
  })
})
