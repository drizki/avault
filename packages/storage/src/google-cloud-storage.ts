import { StorageAdapter } from './adapter.js'
import { Storage, Bucket } from '@google-cloud/storage'
import type {
  StorageDestinationInfo,
  StorageFolder,
  UploadFileParams,
  UploadFileResult,
  BackupVersion,
} from '@avault/shared'

/**
 * Service account credentials structure.
 * This matches the JSON file downloaded from Google Cloud Console.
 */
export interface GCSServiceAccountCredentials {
  type: 'service_account'
  project_id: string
  private_key_id: string
  private_key: string
  client_email: string
  client_id: string
  auth_uri: string
  token_uri: string
  auth_provider_x509_cert_url: string
  client_x509_cert_url: string
  universe_domain?: string
}

/**
 * Google Cloud Storage adapter.
 * Uses service account authentication (JSON key file).
 */
export class GoogleCloudStorageAdapter extends StorageAdapter {
  provider = 'google_cloud_storage'
  private storage: Storage | null = null
  private projectId: string = ''

  async initialize(credentials: GCSServiceAccountCredentials): Promise<void> {
    if (credentials.type !== 'service_account') {
      throw new Error('Invalid credentials: expected service_account type')
    }

    this.projectId = credentials.project_id

    this.storage = new Storage({
      projectId: credentials.project_id,
      credentials: {
        client_email: credentials.client_email,
        private_key: credentials.private_key,
      },
    })
  }

  async listDestinations(): Promise<StorageDestinationInfo[]> {
    if (!this.storage) throw new Error('Adapter not initialized')

    const [buckets] = await this.storage.getBuckets()

    return buckets.map((bucket: Bucket) => ({
      id: bucket.name,
      name: bucket.name,
      provider: this.provider,
      metadata: {
        location: bucket.metadata.location,
        storageClass: bucket.metadata.storageClass,
        projectId: this.projectId,
      },
    }))
  }

  async listFolders(bucketName: string, prefix?: string): Promise<StorageFolder[]> {
    if (!this.storage) throw new Error('Adapter not initialized')

    const bucket = this.storage.bucket(bucketName)
    const normalizedPrefix = prefix ? (prefix.endsWith('/') ? prefix : `${prefix}/`) : ''

    const [files] = await bucket.getFiles({
      prefix: normalizedPrefix,
      delimiter: '/',
      autoPaginate: false,
    })

    // GCS returns prefixes in the apiResponse, not in files array for delimiter queries
    const [, , apiResponse] = await bucket.getFiles({
      prefix: normalizedPrefix,
      delimiter: '/',
      autoPaginate: false,
    })

    const prefixes = (apiResponse as { prefixes?: string[] })?.prefixes || []

    return prefixes.map((fullPath: string) => {
      const name = fullPath.slice(normalizedPrefix.length).replace(/\/$/, '')
      return {
        id: fullPath,
        name,
        path: fullPath,
      }
    })
  }

  async uploadFile(params: UploadFileParams): Promise<UploadFileResult> {
    if (!this.storage) throw new Error('Adapter not initialized')

    const bucket = this.storage.bucket(params.destinationId)
    const key = params.folderPath
      ? `${params.folderPath}/${params.fileName}`
      : params.fileName

    const file = bucket.file(key)

    return new Promise((resolve, reject) => {
      let bytesUploaded = 0

      const writeStream = file.createWriteStream({
        metadata: {
          contentType: params.mimeType,
        },
        resumable: params.fileSize > 5 * 1024 * 1024, // Use resumable for files > 5MB
      })

      params.fileStream.on('data', (chunk: Buffer) => {
        bytesUploaded += chunk.length
        if (params.onProgress) {
          params.onProgress({
            bytesUploaded,
            totalBytes: params.fileSize,
            percentage: Math.round((bytesUploaded / params.fileSize) * 100),
          })
        }
      })

      params.fileStream
        .pipe(writeStream)
        .on('error', reject)
        .on('finish', () => {
          resolve({
            fileId: key,
            fileName: params.fileName,
            size: params.fileSize,
            path: key,
          })
        })
    })
  }

  async createFolder(bucketName: string, name: string, parentPath?: string): Promise<StorageFolder> {
    if (!this.storage) throw new Error('Adapter not initialized')

    // GCS doesn't have real folders - create a placeholder
    const bucket = this.storage.bucket(bucketName)
    const folderKey = parentPath ? `${parentPath}/${name}/` : `${name}/`

    const file = bucket.file(folderKey)
    await file.save('')

    return {
      id: folderKey,
      name,
      path: folderKey,
      createdTime: new Date(),
      modifiedTime: new Date(),
    }
  }

  async renameFolder(_bucketName: string, _folderPath: string, _newName: string): Promise<void> {
    throw new Error('Rename not supported for Google Cloud Storage')
  }

  async deleteFolder(bucketName: string, folderPath: string): Promise<void> {
    if (!this.storage) throw new Error('Adapter not initialized')

    const bucket = this.storage.bucket(bucketName)
    const prefix = folderPath.endsWith('/') ? folderPath : `${folderPath}/`

    // List and delete all files with the prefix
    await bucket.deleteFiles({
      prefix,
    })
  }

  async listBackups(bucketName: string, basePath: string): Promise<BackupVersion[]> {
    if (!this.storage) throw new Error('Adapter not initialized')

    const bucket = this.storage.bucket(bucketName)
    const prefix = basePath ? `${basePath}/` : ''

    const [, , apiResponse] = await bucket.getFiles({
      prefix,
      delimiter: '/',
      autoPaginate: false,
    })

    const prefixes = (apiResponse as { prefixes?: string[] })?.prefixes || []

    return prefixes.map((fullPath: string) => {
      const name = fullPath.slice(prefix.length).replace(/\/$/, '')
      return {
        name,
        path: fullPath,
        createdTime: new Date(), // GCS doesn't track folder creation time
      }
    })
  }

  async validateCredentials(): Promise<boolean> {
    try {
      if (!this.storage) return false
      // Try to get buckets as a validation
      await this.storage.getBuckets({ maxResults: 1 })
      return true
    } catch {
      return false
    }
  }
}
