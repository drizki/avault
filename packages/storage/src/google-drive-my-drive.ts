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
 * Google Drive adapter for personal "My Drive" storage.
 * Uses OAuth2 authentication. Unlike Shared Drives, My Drive is the user's
 * personal storage space.
 */
export class GoogleDriveMyDriveAdapter extends StorageAdapter {
  provider = 'google_drive_my_drive'
  private drive: drive_v3.Drive | null = null
  private auth: InstanceType<typeof google.auth.OAuth2> | null = null

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

    // For My Drive, there's only one destination - the root
    // Get user info to personalize the destination name
    const aboutResponse = await this.drive.about.get({
      fields: 'user(displayName, emailAddress)',
    })

    const user = aboutResponse.data.user
    const name = user?.displayName || user?.emailAddress || 'My Drive'

    return [
      {
        id: 'root', // 'root' is the special ID for My Drive root
        name: `My Drive (${name})`,
        provider: this.provider,
        metadata: {
          email: user?.emailAddress,
        },
      },
    ]
  }

  async listFolders(destinationId: string, parentFolderId?: string): Promise<StorageFolder[]> {
    if (!this.drive) throw new Error('Adapter not initialized')

    // Use 'root' for My Drive root, or the specific parent folder
    const parentId = parentFolderId || destinationId

    const response = await this.drive.files.list({
      q: `'${parentId}' in parents and mimeType='application/vnd.google-apps.folder' and trashed=false`,
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

  async uploadFile(params: UploadFileParams): Promise<UploadFileResult> {
    if (!this.drive) throw new Error('Adapter not initialized')

    // Find the backup folder in root
    const foldersResponse = await this.drive.files.list({
      q: `name='${params.folderPath}' and mimeType='application/vnd.google-apps.folder' and 'root' in parents and trashed=false`,
      fields: 'files(id, name)',
    })

    const rootFolder = foldersResponse.data.files?.[0]
    if (!rootFolder) {
      throw new Error(`Folder not found: ${params.folderPath}`)
    }

    // Parse fileName for directory structure
    const pathParts = params.fileName.split('/').filter((p) => p.length > 0)
    const actualFileName = pathParts[pathParts.length - 1]
    const directories = pathParts.slice(0, -1)

    // Create nested folders if needed
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    let currentParentId = rootFolder.id!
    for (const dirName of directories) {
      const existingFolder = await this.drive.files.list({
        q: `name='${dirName}' and mimeType='application/vnd.google-apps.folder' and '${currentParentId}' in parents and trashed=false`,
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
          fields: 'id, name',
        })
        // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
        currentParentId = newFolder.data.id!
      }
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
        parents: [currentParentId],
      },
      media: {
        mimeType: params.mimeType,
        body: progressStream,
      },
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

    // For My Drive, use 'root' if no parent specified
    const parentId = parentFolderId || (destinationId === 'root' ? 'root' : destinationId)

    const response = await this.drive.files.create({
      requestBody: {
        name,
        mimeType: 'application/vnd.google-apps.folder',
        parents: [parentId],
      },
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
    throw new Error('Rename not implemented for Google Drive My Drive')
  }

  async deleteFolder(_destinationId: string, folderPath: string): Promise<void> {
    if (!this.drive) throw new Error('Adapter not initialized')

    // Find folder in root
    const foldersResponse = await this.drive.files.list({
      q: `name='${folderPath}' and mimeType='application/vnd.google-apps.folder' and 'root' in parents and trashed=false`,
      fields: 'files(id, name)',
    })

    const folder = foldersResponse.data.files?.[0]
    if (!folder) {
      throw new Error(`Folder not found: ${folderPath}`)
    }

    await this.drive.files.delete({
      // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
      fileId: folder.id!,
    })
  }

  async listBackups(_destinationId: string, _basePath: string): Promise<BackupVersion[]> {
    if (!this.drive) throw new Error('Adapter not initialized')

    // List folders in root that look like backups
    const response = await this.drive.files.list({
      q: `'root' in parents and mimeType='application/vnd.google-apps.folder' and trashed=false`,
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
