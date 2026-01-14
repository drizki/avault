import type {
  IStorageAdapter,
  StorageDestinationInfo,
  StorageFolder,
  UploadFileParams,
  UploadFileResult,
  BackupVersion,
} from '@avault/shared'

/**
 * Abstract base class for all storage adapters.
 * Implements the IStorageAdapter interface from @avault/shared.
 */
export abstract class StorageAdapter implements IStorageAdapter {
  abstract provider: string

  /**
   * Initialize the adapter with credentials.
   * @param credentials Provider-specific credentials (OAuth tokens, API keys, etc.)
   */
  abstract initialize(credentials: unknown): Promise<void>

  /**
   * List available destinations (drives, buckets, etc.)
   * @returns Array of destination info objects
   */
  abstract listDestinations(): Promise<StorageDestinationInfo[]>

  /**
   * List folders within a destination.
   * @param destinationId The destination (drive, bucket) ID
   * @param parentPath Optional parent folder path/ID
   * @returns Array of folder objects
   */
  abstract listFolders(destinationId: string, parentPath?: string): Promise<StorageFolder[]>

  /**
   * Upload a file to the destination.
   * @param params Upload parameters including stream, progress callback
   * @returns Upload result with file ID and path
   */
  abstract uploadFile(params: UploadFileParams): Promise<UploadFileResult>

  /**
   * Create a folder in the destination.
   * @param destinationId The destination ID
   * @param name Folder name
   * @param parentPath Optional parent folder path/ID
   * @returns Created folder info
   */
  abstract createFolder(destinationId: string, name: string, parentPath?: string): Promise<StorageFolder>

  /**
   * Rename a folder.
   * @param destinationId The destination ID
   * @param folderPath Current folder path
   * @param newName New folder name
   */
  abstract renameFolder(destinationId: string, folderPath: string, newName: string): Promise<void>

  /**
   * Delete a folder (used for retention cleanup).
   * @param destinationId The destination ID
   * @param folderPath Folder path to delete
   */
  abstract deleteFolder(destinationId: string, folderPath: string): Promise<void>

  /**
   * List backup versions in a destination.
   * @param destinationId The destination ID
   * @param basePath Base path to search for backups
   * @returns Array of backup version info
   */
  abstract listBackups(destinationId: string, basePath: string): Promise<BackupVersion[]>

  /**
   * Validate the current credentials.
   * @returns True if credentials are valid
   */
  abstract validateCredentials(): Promise<boolean>

  /**
   * Optional: Pre-build folder structure for parallel uploads.
   * This is a performance optimization used by some adapters (e.g., Google Drive)
   * to avoid making folder creation API calls during parallel file uploads.
   * @param destinationId The destination ID
   * @param rootFolderId The root folder ID where files will be uploaded
   * @param rootFolderName The root folder name
   * @param filePaths Array of relative file paths
   */
  preBuildFolderStructure?(
    destinationId: string,
    rootFolderId: string,
    rootFolderName: string,
    filePaths: string[]
  ): Promise<void>
}
