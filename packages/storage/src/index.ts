// Storage adapter base class
export { StorageAdapter } from './adapter.js'

// Factory function
export { getStorageAdapter, isSupportedProvider } from './factory.js'

// Individual adapters
export { GoogleDriveSharedAdapter, type GoogleDriveCredentials } from './google-drive-shared.js'
export { GoogleDriveMyDriveAdapter } from './google-drive-my-drive.js'
export {
  GoogleCloudStorageAdapter,
  type GCSServiceAccountCredentials,
} from './google-cloud-storage.js'
export { S3Adapter, type S3Credentials } from './s3.js'
export {
  S3CompatibleAdapter,
  CloudflareR2Adapter,
  DigitalOceanSpacesAdapter,
  type S3CompatibleCredentials,
} from './s3-compatible.js'
