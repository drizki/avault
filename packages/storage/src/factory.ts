import { StorageAdapter } from './adapter.js'
import { GoogleDriveSharedAdapter } from './google-drive-shared.js'
import { GoogleDriveMyDriveAdapter } from './google-drive-my-drive.js'
import { GoogleCloudStorageAdapter } from './google-cloud-storage.js'
import { S3Adapter } from './s3.js'
import { S3CompatibleAdapter } from './s3-compatible.js'

/**
 * Factory function to get the appropriate storage adapter for a provider.
 * @param provider The storage provider identifier
 * @returns A new instance of the appropriate adapter
 */
export function getStorageAdapter(provider: string): StorageAdapter {
  switch (provider) {
    // Google Drive adapters
    case 'google_drive':
    case 'google_drive_shared':
      return new GoogleDriveSharedAdapter()

    case 'google_drive_my_drive':
      return new GoogleDriveMyDriveAdapter()

    // Google Cloud Storage
    case 'google_cloud_storage':
      return new GoogleCloudStorageAdapter()

    // Amazon S3
    case 's3':
      return new S3Adapter()

    // S3-compatible providers
    case 'cloudflare_r2':
      return new S3CompatibleAdapter('cloudflare_r2')

    case 'digitalocean_spaces':
      return new S3CompatibleAdapter('digitalocean_spaces')

    default:
      throw new Error(`Unsupported storage provider: ${provider}`)
  }
}

/**
 * Check if a provider is supported.
 */
export function isSupportedProvider(provider: string): boolean {
  const supported = [
    'google_drive',
    'google_drive_shared',
    'google_drive_my_drive',
    'google_cloud_storage',
    's3',
    'cloudflare_r2',
    'digitalocean_spaces',
  ]
  return supported.includes(provider)
}
