import { StorageAdapter } from './adapter.js'
import { google } from 'googleapis'
import type { drive_v3 } from 'googleapis'
import type {
  StorageDestinationInfo,
  StorageFolder,
  UploadFileParams,
  UploadFileResult,
  BackupVersion,
} from '@avault/shared'
import { Transform } from 'stream'

export interface GoogleDriveCredentials {
  access_token: string
  refresh_token: string
  expiry_date: number
}

/**
 * Google Drive adapter for Shared Drives (Google Workspace).
 * Uses OAuth2 authentication and supports team/shared drives.
 */
export class GoogleDriveSharedAdapter extends StorageAdapter {
  provider = 'google_drive_shared'
  private drive: drive_v3.Drive | null = null
  private auth: InstanceType<typeof google.auth.OAuth2> | null = null

  // Folder cache: Map<"destinationId:folderPath", folderId>
  private folderCache: Map<string, string> = new Map()

  async initialize(credentials: GoogleDriveCredentials): Promise<void> {
    const oauth2Client = new google.auth.OAuth2(
      process.env.GOOGLE_CLIENT_ID,
      process.env.GOOGLE_CLIENT_SECRET,
      process.env.GOOGLE_REDIRECT_URI
    )

    oauth2Client.setCredentials({
      access_token: credentials.access_token,
      refresh_token: credentials.refresh_token,
      expiry_date: credentials.expiry_date,
    })

    // Enable automatic token refresh
    oauth2Client.on('tokens', (tokens) => {
      if (tokens.refresh_token) {
        oauth2Client.setCredentials({
          refresh_token: tokens.refresh_token,
        })
      }
    })

    this.auth = oauth2Client
    this.drive = google.drive({ version: 'v3', auth: oauth2Client })
  }

  async listDestinations(): Promise<StorageDestinationInfo[]> {
    if (!this.drive) throw new Error('Adapter not initialized')

    const response = await this.drive.drives.list({
      pageSize: 100,
    })

    return (response.data.drives || []).map((drive) => ({
      // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
      id: drive.id!,
      // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
      name: drive.name!,
      provider: this.provider,
      metadata: {
        colorRgb: drive.colorRgb,
        backgroundImageLink: drive.backgroundImageLink,
      },
    }))
  }

  /**
   * Create a new Shared Drive.
   * @param name Name for the new shared drive
   */
  async createSharedDrive(name: string): Promise<StorageDestinationInfo> {
    if (!this.drive) throw new Error('Adapter not initialized')

    const requestId = `avault-${Date.now()}-${Math.random().toString(36).substring(7)}`

    const response = await this.drive.drives.create({
      requestId,
      requestBody: { name },
    })

    return {
      // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
      id: response.data.id!,
      // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
      name: response.data.name!,
      provider: this.provider,
      metadata: {
        colorRgb: response.data.colorRgb,
        backgroundImageLink: response.data.backgroundImageLink,
      },
    }
  }

  async listFolders(destinationId: string, parentFolderId?: string): Promise<StorageFolder[]> {
    if (!this.drive) throw new Error('Adapter not initialized')

    const parentId = parentFolderId || destinationId

    const response = await this.drive.files.list({
      q: `'${parentId}' in parents and mimeType='application/vnd.google-apps.folder' and trashed=false`,
      driveId: destinationId,
      corpora: 'drive',
      includeItemsFromAllDrives: true,
      supportsAllDrives: true,
      fields: 'files(id, name, createdTime, modifiedTime)',
      orderBy: 'name',
      pageSize: 100,
    })

    return (response.data.files || []).map((folder) => ({
      // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
      id: folder.id!,
      // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
      name: folder.name!,
      // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
      path: folder.name!,
      createdTime: folder.createdTime ? new Date(folder.createdTime) : undefined,
      modifiedTime: folder.modifiedTime ? new Date(folder.modifiedTime) : undefined,
    }))
  }

  /**
   * Pre-build folder structure for all files to avoid redundant API calls during upload.
   * This creates all necessary folders in batch before uploading starts.
   * @param destinationId - The shared drive ID
   * @param rootFolderId - The ID of the root backup folder
   * @param rootFolderName - The name of the root backup folder
   * @param filePaths - Array of relative file paths
   */
  async preBuildFolderStructure(
    destinationId: string,
    rootFolderId: string,
    rootFolderName: string,
    filePaths: string[]
  ): Promise<void> {
    if (!this.drive) throw new Error('Adapter not initialized')

    // Cache the root folder ID
    const rootCacheKey = `${destinationId}:${rootFolderName}`
    this.folderCache.set(rootCacheKey, rootFolderId)

    // Collect all unique directory paths that need to be created
    const directoryPaths = new Set<string>()
    for (const filePath of filePaths) {
      const parts = filePath.split('/').filter((p) => p.length > 0)
      // Collect all parent directory paths
      for (let i = 1; i < parts.length; i++) {
        directoryPaths.add(parts.slice(0, i).join('/'))
      }
    }

    // Sort paths by depth (shortest first) to ensure parents are created before children
    const sortedPaths = Array.from(directoryPaths).sort((a, b) => {
      return a.split('/').length - b.split('/').length
    })

    // Create directories in order (parents before children)
    for (const dirPath of sortedPaths) {
      const fullCacheKey = `${destinationId}:${rootFolderName}/${dirPath}`
      if (this.folderCache.has(fullCacheKey)) {
        continue // Already cached
      }

      const parts = dirPath.split('/')
      const dirName = parts[parts.length - 1]
      const parentPath = parts.slice(0, -1).join('/')

      // Get parent folder ID
      let parentId: string
      if (parentPath === '') {
        parentId = rootFolderId
      } else {
        const parentCacheKey = `${destinationId}:${rootFolderName}/${parentPath}`
        // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
        parentId = this.folderCache.get(parentCacheKey)!
        if (!parentId) {
          throw new Error(`Parent folder not found in cache: ${parentPath}`)
        }
      }

      // Check if folder exists
      const existingFolder = await this.drive.files.list({
        q: `name='${dirName}' and mimeType='application/vnd.google-apps.folder' and '${parentId}' in parents and trashed=false`,
        driveId: destinationId,
        corpora: 'drive',
        includeItemsFromAllDrives: true,
        supportsAllDrives: true,
        fields: 'files(id, name)',
      })

      let folderId: string
      if (existingFolder.data.files && existingFolder.data.files.length > 0) {
        // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
        folderId = existingFolder.data.files[0].id!
      } else {
        // Create folder
        const newFolder = await this.drive.files.create({
          requestBody: {
            name: dirName,
            mimeType: 'application/vnd.google-apps.folder',
            parents: [parentId],
            driveId: destinationId,
          },
          supportsAllDrives: true,
          fields: 'id, name',
        })
        // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
        folderId = newFolder.data.id!
      }

      this.folderCache.set(fullCacheKey, folderId)
    }
  }

  /**
   * Get folder ID from cache.
   */
  private getCachedFolderId(destinationId: string, rootFolderName: string, relativeDirPath: string): string | undefined {
    if (relativeDirPath === '') {
      const rootCacheKey = `${destinationId}:${rootFolderName}`
      return this.folderCache.get(rootCacheKey)
    }
    const cacheKey = `${destinationId}:${rootFolderName}/${relativeDirPath}`
    return this.folderCache.get(cacheKey)
  }

  async uploadFile(params: UploadFileParams): Promise<UploadFileResult> {
    if (!this.drive) throw new Error('Adapter not initialized')

    // Parse fileName for directory structure
    const pathParts = params.fileName.split('/').filter((p) => p.length > 0)
    const actualFileName = pathParts[pathParts.length - 1]
    const directories = pathParts.slice(0, -1)
    const relativeDirPath = directories.join('/')

    // Try to get parent folder ID from cache first (if preBuildFolderStructure was called)
    let parentFolderId: string | undefined = this.getCachedFolderId(params.destinationId, params.folderPath, relativeDirPath)

    // Fallback: if not in cache, find/create folders (for backwards compatibility)
    if (!parentFolderId) {
      // Find the root backup folder
      const foldersResponse = await this.drive.files.list({
        q: `name='${params.folderPath}' and mimeType='application/vnd.google-apps.folder' and '${params.destinationId}' in parents and trashed=false`,
        driveId: params.destinationId,
        corpora: 'drive',
        includeItemsFromAllDrives: true,
        supportsAllDrives: true,
        fields: 'files(id, name)',
      })

      const rootFolder = foldersResponse.data.files?.[0]
      if (!rootFolder) {
        throw new Error(`Folder not found: ${params.folderPath}`)
      }

      // Create nested folders if needed
      // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
      let currentParentId = rootFolder.id!
      for (const dirName of directories) {
        const existingFolder = await this.drive.files.list({
          q: `name='${dirName}' and mimeType='application/vnd.google-apps.folder' and '${currentParentId}' in parents and trashed=false`,
          driveId: params.destinationId,
          corpora: 'drive',
          includeItemsFromAllDrives: true,
          supportsAllDrives: true,
          fields: 'files(id, name)',
        })

        if (existingFolder.data.files && existingFolder.data.files.length > 0) {
          // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
          currentParentId = existingFolder.data.files[0].id!
        } else {
          const newFolder = await this.drive.files.create({
            requestBody: {
              name: dirName,
              mimeType: 'application/vnd.google-apps.folder',
              parents: [currentParentId],
            },
            supportsAllDrives: true,
            fields: 'id, name',
          })
          // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
          currentParentId = newFolder.data.id!
        }
      }
      parentFolderId = currentParentId
    }

    // Ensure parentFolderId is defined at this point
    if (!parentFolderId) {
      throw new Error(`Could not determine parent folder for upload`)
    }

    // Upload with progress tracking
    let bytesUploaded = 0
    const progressStream = new Transform({
      transform(chunk: Buffer, _encoding: string, callback: (error?: Error | null, data?: Buffer) => void) {
        bytesUploaded += chunk.length
        if (params.onProgress) {
          params.onProgress({
            bytesUploaded,
            totalBytes: params.fileSize,
            percentage: Math.round((bytesUploaded / params.fileSize) * 100),
          })
        }
        callback(null, chunk)
      },
    })

    params.fileStream.pipe(progressStream)

    const response = await this.drive.files.create({
      requestBody: {
        name: actualFileName,
        parents: [parentFolderId],
      },
      media: {
        mimeType: params.mimeType,
        body: progressStream,
      },
      supportsAllDrives: true,
      fields: 'id, name, size, mimeType, createdTime',
    })

    return {
      // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
      fileId: response.data.id!,
      // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
      fileName: response.data.name!,
      size: parseInt(response.data.size || '0'),
      path: `${params.folderPath}/${params.fileName}`,
    }
  }

  async createFolder(destinationId: string, name: string, parentFolderId?: string): Promise<StorageFolder> {
    if (!this.drive) throw new Error('Adapter not initialized')

    const parentId = parentFolderId || destinationId

    const response = await this.drive.files.create({
      requestBody: {
        name,
        mimeType: 'application/vnd.google-apps.folder',
        parents: [parentId],
      },
      supportsAllDrives: true,
      fields: 'id, name, mimeType, createdTime, modifiedTime',
    })

    return {
      // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
      id: response.data.id!,
      // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
      name: response.data.name!,
      path: name,
      // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
      createdTime: new Date(response.data.createdTime!),
      // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
      modifiedTime: new Date(response.data.modifiedTime!),
    }
  }

  async renameFolder(_destinationId: string, _folderPath: string, _newName: string): Promise<void> {
    throw new Error('Rename not implemented for Google Drive Shared')
  }

  async deleteFolder(destinationId: string, folderPath: string): Promise<void> {
    if (!this.drive) throw new Error('Adapter not initialized')

    const foldersResponse = await this.drive.files.list({
      q: `name='${folderPath}' and mimeType='application/vnd.google-apps.folder' and '${destinationId}' in parents and trashed=false`,
      driveId: destinationId,
      corpora: 'drive',
      includeItemsFromAllDrives: true,
      supportsAllDrives: true,
      fields: 'files(id, name)',
    })

    const folder = foldersResponse.data.files?.[0]
    if (!folder) {
      throw new Error(`Folder not found: ${folderPath}`)
    }

    await this.drive.files.delete({
      // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
      fileId: folder.id!,
      supportsAllDrives: true,
    })
  }

  async listBackups(destinationId: string, _basePath: string): Promise<BackupVersion[]> {
    if (!this.drive) throw new Error('Adapter not initialized')

    const response = await this.drive.files.list({
      q: `'${destinationId}' in parents and mimeType='application/vnd.google-apps.folder' and trashed=false`,
      driveId: destinationId,
      corpora: 'drive',
      includeItemsFromAllDrives: true,
      supportsAllDrives: true,
      fields: 'files(id, name, createdTime, size)',
      orderBy: 'createdTime desc',
    })

    return (response.data.files || []).map((folder) => ({
      // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
      name: folder.name!,
      // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
      path: folder.name!,
      // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
      createdTime: new Date(folder.createdTime!),
      size: folder.size ? parseInt(folder.size) : undefined,
    }))
  }

  async validateCredentials(): Promise<boolean> {
    try {
      if (!this.drive) return false
      await this.drive.about.get({ fields: 'user' })
      return true
    } catch {
      return false
    }
  }
}
