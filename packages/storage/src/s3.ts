import { StorageAdapter } from './adapter.js'
import {
  S3Client,
  ListBucketsCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  DeleteObjectsCommand,
  HeadBucketCommand,
} from '@aws-sdk/client-s3'
import { Upload } from '@aws-sdk/lib-storage'
import type {
  StorageDestinationInfo,
  StorageFolder,
  UploadFileParams,
  UploadFileResult,
  BackupVersion,
} from '@avault/shared'
import type { Readable } from 'stream'

export interface S3Credentials {
  access_key_id: string
  secret_access_key: string
  region: string
  endpoint?: string
  force_path_style?: boolean
}

/**
 * Amazon S3 storage adapter.
 * Also serves as base class for S3-compatible providers.
 */
export class S3Adapter extends StorageAdapter {
  provider = 's3'
  protected client: S3Client | null = null
  protected credentials: S3Credentials | null = null

  async initialize(credentials: S3Credentials): Promise<void> {
    this.credentials = credentials

    const config: ConstructorParameters<typeof S3Client>[0] = {
      region: credentials.region,
      credentials: {
        accessKeyId: credentials.access_key_id,
        secretAccessKey: credentials.secret_access_key,
      },
    }

    if (credentials.endpoint) {
      config.endpoint = credentials.endpoint
    }

    if (credentials.force_path_style) {
      config.forcePathStyle = true
    }

    this.client = new S3Client(config)
  }

  async listDestinations(): Promise<StorageDestinationInfo[]> {
    if (!this.client) throw new Error('Adapter not initialized')

    const response = await this.client.send(new ListBucketsCommand({}))

    return (response.Buckets || []).map((bucket) => ({
      id: bucket.Name!,
      name: bucket.Name!,
      provider: this.provider,
      metadata: {
        creationDate: bucket.CreationDate,
      },
    }))
  }

  async listFolders(bucketName: string, prefix?: string): Promise<StorageFolder[]> {
    if (!this.client) throw new Error('Adapter not initialized')

    const normalizedPrefix = prefix ? (prefix.endsWith('/') ? prefix : `${prefix}/`) : ''

    const response = await this.client.send(
      new ListObjectsV2Command({
        Bucket: bucketName,
        Prefix: normalizedPrefix,
        Delimiter: '/',
      })
    )

    return (response.CommonPrefixes || []).map((prefixObj) => {
      const fullPath = prefixObj.Prefix!
      const name = fullPath.slice(normalizedPrefix.length).replace(/\/$/, '')
      return {
        id: fullPath,
        name,
        path: fullPath,
      }
    })
  }

  async uploadFile(params: UploadFileParams): Promise<UploadFileResult> {
    if (!this.client) throw new Error('Adapter not initialized')

    const key = params.folderPath
      ? `${params.folderPath}/${params.fileName}`
      : params.fileName

    const upload = new Upload({
      client: this.client,
      params: {
        Bucket: params.destinationId,
        Key: key,
        Body: params.fileStream as Readable,
        ContentType: params.mimeType,
      },
    })

    upload.on('httpUploadProgress', (progress) => {
      if (params.onProgress && progress.loaded) {
        params.onProgress({
          bytesUploaded: progress.loaded,
          totalBytes: params.fileSize,
          percentage: Math.round((progress.loaded / params.fileSize) * 100),
        })
      }
    })

    await upload.done()

    return {
      fileId: key,
      fileName: params.fileName,
      size: params.fileSize,
      path: key,
    }
  }

  async createFolder(bucketName: string, name: string, parentPath?: string): Promise<StorageFolder> {
    if (!this.client) throw new Error('Adapter not initialized')

    // S3 doesn't have real folders - we create a placeholder object
    const folderKey = parentPath ? `${parentPath}/${name}/` : `${name}/`

    await this.client.send(
      new PutObjectCommand({
        Bucket: bucketName,
        Key: folderKey,
        Body: '',
      })
    )

    return {
      id: folderKey,
      name,
      path: folderKey,
      createdTime: new Date(),
      modifiedTime: new Date(),
    }
  }

  async renameFolder(_bucketName: string, _folderPath: string, _newName: string): Promise<void> {
    // S3 doesn't support rename - would need to copy all objects and delete originals
    throw new Error('Rename not supported for S3-compatible storage')
  }

  async deleteFolder(bucketName: string, folderPath: string): Promise<void> {
    if (!this.client) throw new Error('Adapter not initialized')

    const prefix = folderPath.endsWith('/') ? folderPath : `${folderPath}/`

    // List all objects with the prefix
    const listResponse = await this.client.send(
      new ListObjectsV2Command({
        Bucket: bucketName,
        Prefix: prefix,
      })
    )

    if (!listResponse.Contents || listResponse.Contents.length === 0) {
      return
    }

    // Delete all objects in batches of 1000 (S3 limit)
    const objectsToDelete = listResponse.Contents.map((obj) => ({ Key: obj.Key! }))

    for (let i = 0; i < objectsToDelete.length; i += 1000) {
      const batch = objectsToDelete.slice(i, i + 1000)
      await this.client.send(
        new DeleteObjectsCommand({
          Bucket: bucketName,
          Delete: { Objects: batch },
        })
      )
    }
  }

  async listBackups(bucketName: string, basePath: string): Promise<BackupVersion[]> {
    if (!this.client) throw new Error('Adapter not initialized')

    const prefix = basePath ? `${basePath}/` : ''

    const response = await this.client.send(
      new ListObjectsV2Command({
        Bucket: bucketName,
        Prefix: prefix,
        Delimiter: '/',
      })
    )

    return (response.CommonPrefixes || []).map((prefixObj) => {
      const fullPath = prefixObj.Prefix!
      const name = fullPath.slice(prefix.length).replace(/\/$/, '')
      return {
        name,
        path: fullPath,
        createdTime: new Date(), // S3 doesn't store folder creation time
      }
    })
  }

  async validateCredentials(): Promise<boolean> {
    try {
      if (!this.client) return false
      // Try to list buckets as a validation check
      await this.client.send(new ListBucketsCommand({}))
      return true
    } catch {
      return false
    }
  }

  /**
   * Validate access to a specific bucket.
   */
  async validateBucketAccess(bucketName: string): Promise<boolean> {
    try {
      if (!this.client) return false
      await this.client.send(new HeadBucketCommand({ Bucket: bucketName }))
      return true
    } catch {
      return false
    }
  }
}
