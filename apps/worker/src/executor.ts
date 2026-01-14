import { PrismaClient, logger, decrypt } from '@avault/shared'
import type {
  BackupJobExecution,
  BackupExecutionResult,
  BackupJobProgress,
} from '@avault/shared'
import { getStorageAdapter, type StorageAdapter } from '@avault/storage'
import { promises as fs, createReadStream } from 'fs'
import path from 'path'
import crypto from 'crypto'
import { lookup } from 'mime-types'
import { createLogPublisher } from './lib/log-stream'
import pLimit from 'p-limit'

const NAS_MOUNT_PATH = process.env.NAS_MOUNT_PATH || ''
const TEMP_DIR = process.env.TEMP_DIR || '/tmp/avault-backups'

// Upload performance configuration
const CONCURRENT_UPLOADS = parseInt(process.env.CONCURRENT_UPLOADS || '10', 10)
const PROGRESS_THROTTLE_MS = parseInt(process.env.PROGRESS_THROTTLE_MS || '500', 10)
const STREAM_HIGH_WATER_MARK = parseInt(process.env.STREAM_HIGH_WATER_MARK || '1048576', 10) // 1MB default

export async function executeBackupJob(
  db: PrismaClient,
  params: BackupJobExecution,
  userId: string,
  onProgress: (progress: BackupJobProgress) => void
): Promise<BackupExecutionResult> {
  const startTime = Date.now()
  const logStream = createLogPublisher(params.historyId, userId)

  logger.info({
    sourcePath: params.sourcePath,
    destinationId: params.destinationId,
    namePattern: params.namePattern,
  }, 'Starting backup job')

  logStream.info('Starting backup job', {
    sourcePath: params.sourcePath,
    namePattern: params.namePattern,
  })

  const result: BackupExecutionResult = {
    success: false,
    historyId: params.historyId,
    filesScanned: 0,
    filesUploaded: 0,
    filesFailed: 0,
    bytesUploaded: 0,
    duration: 0,
    remotePath: '',
  }

  try {
    // Phase 1: Scan source directory
    logStream.info('Scanning source directory...')
    onProgress({
      historyId: params.historyId,
      status: 'RUNNING',
      filesScanned: 0,
      filesUploaded: 0,
      filesFailed: 0,
      bytesUploaded: 0,
      currentFile: 'Scanning source directory...',
    })

    // Use absolute path if NAS_MOUNT_PATH is empty (local development)
    const fullPath = NAS_MOUNT_PATH ? path.join(NAS_MOUNT_PATH, params.sourcePath) : params.sourcePath
    const fileList = await scanDirectoryWithDetails(fullPath, logStream)
    result.filesScanned = fileList.length

    logger.info({ filesScanned: fileList.length, sourcePath: fullPath }, 'Directory scanned')
    logStream.info(`Found ${fileList.length} files to backup`, { filesScanned: fileList.length })

    if (fileList.length === 0) {
      logStream.error('Error: No files found in source directory')
      throw new Error('No files found in source directory')
    }

    // Phase 2: Initialize storage adapter and get credentials
    logStream.info('Loading credentials and destination...')
    const credential = await db.storageCredential.findUnique({
      where: { id: params.credentialId },
    })

    if (!credential) {
      logStream.error('Error: Credential not found')
      throw new Error('Credential not found')
    }

    const destination = await db.storageDestination.findUnique({
      where: { id: params.destinationId },
    })

    if (!destination) {
      logStream.error('Error: Destination not found')
      throw new Error('Destination not found')
    }

    // Decrypt credentials
    const decryptedData = decrypt(
      credential.encryptedData,
      credential.iv,
      credential.authTag
    )
    const credentialData = JSON.parse(decryptedData)
    logStream.info('Credentials decrypted successfully')

    // Phase 3: Upload files to destination
    logStream.info('Initializing cloud storage adapter...')
    onProgress({
      historyId: params.historyId,
      status: 'UPLOADING',
      filesScanned: fileList.length,
      filesUploaded: 0,
      filesFailed: 0,
      bytesUploaded: 0,
      currentFile: 'Starting upload...',
    })

    // Initialize storage adapter based on provider
    const adapter = getStorageAdapter(credential.provider)
    await adapter.initialize(credentialData)
    logStream.info(`Connected to ${credential.provider}`)

    // Create backup folder
    const backupName = generateBackupName(params.namePattern)
    logStream.info(`Creating backup folder: ${backupName}`)
    const backupFolder = await adapter.createFolder(destination.remoteId, backupName)
    logger.info({ folderId: backupFolder.id, folderName: backupFolder.name }, 'Backup folder created')
    logStream.info(`Backup folder created: ${backupFolder.name}`)

    // Upload files in parallel with concurrency limit
    let uploadedFiles = 0
    let failedFiles = 0
    let totalBytesUploaded = 0
    let lastProgressTime = 0

    const uploadLimit = pLimit(CONCURRENT_UPLOADS)
    logStream.info(`Starting parallel upload of ${fileList.length} files (${CONCURRENT_UPLOADS} concurrent)...`)

    // Pre-build folder structure to avoid redundant API calls (if adapter supports it)
    if (adapter.preBuildFolderStructure) {
      await adapter.preBuildFolderStructure(destination.remoteId, backupFolder.id, backupFolder.name, fileList.map(f => path.relative(fullPath, f.path)))
    }

    // Throttled progress reporter
    const reportProgress = (currentFile?: string, additionalBytes: number = 0) => {
      const now = Date.now()
      if (now - lastProgressTime >= PROGRESS_THROTTLE_MS || !currentFile) {
        lastProgressTime = now
        const currentBytes = totalBytesUploaded + additionalBytes
        onProgress({
          historyId: params.historyId,
          status: 'UPLOADING',
          filesScanned: fileList.length,
          filesUploaded: uploadedFiles,
          filesFailed: failedFiles,
          bytesUploaded: currentBytes,
          currentFile: currentFile || `Uploading ${CONCURRENT_UPLOADS} files in parallel...`,
          uploadSpeed: Math.round(currentBytes / ((now - startTime) / 1000)),
        })
      }
    }

    // Create upload tasks for all files
    const uploadTasks = fileList.map((fileInfo) =>
      uploadLimit(async () => {
        const relativePath = path.relative(fullPath, fileInfo.path)
        const mimeType = lookup(fileInfo.path) || 'application/octet-stream'

        try {
          logger.info({ file: relativePath, size: fileInfo.size }, 'Uploading file')

          const fileStream = createReadStream(fileInfo.path, {
            highWaterMark: STREAM_HIGH_WATER_MARK,
          })

          let fileBytesUploaded = 0
          await adapter.uploadFile({
            destinationId: destination.remoteId,
            folderPath: backupFolder.name,
            fileName: relativePath,
            fileStream,
            fileSize: fileInfo.size,
            mimeType,
            onProgress: (progress) => {
              fileBytesUploaded = progress.bytesUploaded
              reportProgress(relativePath, fileBytesUploaded)
            },
          })

          uploadedFiles++
          totalBytesUploaded += fileInfo.size
          logger.info({ file: relativePath, uploadedFiles, totalFiles: fileList.length }, 'File uploaded')

          // Log every 10 files or at completion to avoid log spam
          if (uploadedFiles % 10 === 0 || uploadedFiles === fileList.length) {
            logStream.info(`Progress: ${uploadedFiles}/${fileList.length} files uploaded`)
          }

          return { success: true, path: relativePath }
        } catch (error: any) {
          failedFiles++
          logger.error({ file: fileInfo.path, error: error.message }, 'Failed to upload file')
          logStream.error(`Error: Failed to upload: ${relativePath} - ${error.message}`)
          return { success: false, path: relativePath, error: error.message }
        }
      })
    )

    // Execute all uploads in parallel (with concurrency limit)
    await Promise.all(uploadTasks)

    // Final progress update
    reportProgress()

    result.filesFailed = failedFiles
    result.filesUploaded = uploadedFiles
    result.bytesUploaded = totalBytesUploaded
    result.remotePath = backupFolder.path

    // Phase 4: Apply retention policy
    logStream.info('Applying retention policy...')
    onProgress({
      historyId: params.historyId,
      status: 'ROTATING',
      filesScanned: fileList.length,
      filesUploaded: uploadedFiles,
      filesFailed: result.filesFailed,
      bytesUploaded: totalBytesUploaded,
      currentFile: 'Applying retention policy...',
    })

    await applyRetentionPolicy(adapter, destination.remoteId, params.retentionPolicy, logStream)

    logger.info({ backupName, remotePath: backupFolder.path, uploadedFiles, failedFiles: result.filesFailed }, 'Backup completed successfully')
    logStream.info(`Backup completed! ${uploadedFiles} files uploaded, ${result.filesFailed} failed`, {
      uploadedFiles,
      failedFiles: result.filesFailed,
      totalBytes: formatBytes(totalBytesUploaded),
      duration: `${Math.round((Date.now() - startTime) / 1000)}s`,
    })

    result.success = true
    result.duration = Date.now() - startTime

    return result
  } catch (error: any) {
    logger.error({ error: error.message, stack: error.stack }, 'Backup job failed')
    logStream.error(`Backup failed: ${error.message}`)
    result.duration = Date.now() - startTime
    result.error = error.message
    return result
  }
}

// Helper: Format bytes for display
function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B'
  const k = 1024
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB']
  const i = Math.floor(Math.log(bytes) / Math.log(k))
  return Math.round((bytes / Math.pow(k, i)) * 100) / 100 + ' ' + sizes[i]
}

// Helper: Scan directory recursively with file details
interface FileInfo {
  path: string
  size: number
}

// OS-specific files to ignore (not hidden files, just OS junk)
const OS_JUNK_FILES = new Set([
  '.DS_Store',        // macOS
  '._.DS_Store',      // macOS extended attributes
  'Thumbs.db',        // Windows
  'thumbs.db',        // Windows (lowercase)
  'desktop.ini',      // Windows
  'Desktop.ini',      // Windows (capitalized)
  '.Spotlight-V100',  // macOS Spotlight
  '.Trashes',         // macOS Trash
  '.TemporaryItems',  // macOS
  '.fseventsd',       // macOS FSEvents
])

const OS_JUNK_DIRECTORIES = new Set([
  '$RECYCLE.BIN',              // Windows Recycle Bin
  'System Volume Information', // Windows System
])

async function scanDirectoryWithDetails(dirPath: string, logStream: any): Promise<FileInfo[]> {
  const files: FileInfo[] = []
  let skippedCount = 0

  async function scan(currentPath: string) {
    try {
      const entries = await fs.readdir(currentPath, { withFileTypes: true })

      for (const entry of entries) {
        const fullPath = path.join(currentPath, entry.name)

        // Skip OS-specific junk directories
        if (entry.isDirectory() && OS_JUNK_DIRECTORIES.has(entry.name)) {
          logger.debug({ path: fullPath }, 'Skipping OS junk directory')
          skippedCount++
          continue
        }

        if (entry.isDirectory()) {
          await scan(fullPath)
        } else if (entry.isFile()) {
          // Skip OS-specific junk files
          if (OS_JUNK_FILES.has(entry.name)) {
            logger.debug({ path: fullPath }, 'Skipping OS junk file')
            skippedCount++
            continue
          }

          try {
            const stats = await fs.stat(fullPath)
            files.push({
              path: fullPath,
              size: stats.size,
            })
          } catch (error: any) {
            logger.error({ path: fullPath, error: error.message }, 'Error getting file stats')
          }
        }
      }
    } catch (error: any) {
      logger.error({ path: currentPath, error: error.message }, 'Error scanning directory')
    }
  }

  await scan(dirPath)

  if (skippedCount > 0) {
    logStream.info(`Skipped ${skippedCount} OS junk files (.DS_Store, Thumbs.db, etc.)`)
  }

  return files
}

// Helper: Generate backup name from pattern
function generateBackupName(pattern: string): string {
  const now = new Date()

  // Generate short hash (6 chars) for uniqueness
  const hash = crypto.randomBytes(3).toString('hex')

  const replacements: Record<string, string> = {
    '{date}': now.toISOString().split('T')[0], // 2026-01-12
    '{datetime}': now.toISOString().replace(/[:.]/g, '-').slice(0, -5), // 2026-01-12T10-30-45
    '{timestamp}': now.getTime().toString(),
    '{year}': now.getFullYear().toString(),
    '{month}': String(now.getMonth() + 1).padStart(2, '0'),
    '{day}': String(now.getDate()).padStart(2, '0'),
    '{hour}': String(now.getHours()).padStart(2, '0'),
    '{minute}': String(now.getMinutes()).padStart(2, '0'),
    '{hash}': hash,
  }

  let name = pattern
  for (const [placeholder, value] of Object.entries(replacements)) {
    name = name.replace(new RegExp(placeholder, 'g'), value)
  }

  return name
}

// Helper: Apply retention policy
async function applyRetentionPolicy(
  adapter: StorageAdapter,
  destinationId: string,
  policy: { type: 'VERSION_COUNT' | 'DAYS' | 'HYBRID'; count?: number; days?: number },
  logStream: any
): Promise<void> {
  try {
    // Get list of all backup folders in the destination
    const backups = await adapter.listBackups(destinationId, '')

    if (backups.length === 0) {
      logger.info('No backups found, skipping retention policy')
      logStream.info('No previous backups found, skipping retention policy')
      return
    }

    // Sort by creation time (newest first)
    backups.sort((a, b) => b.createdTime.getTime() - a.createdTime.getTime())

    logger.info({ totalBackups: backups.length, policy: policy.type }, 'Applying retention policy')
    logStream.info(`Found ${backups.length} existing backups, applying ${policy.type} policy`)

    const toDelete: string[] = []

    if (policy.type === 'VERSION_COUNT' && policy.count) {
      // Keep only the N most recent backups
      if (backups.length > policy.count) {
        toDelete.push(...backups.slice(policy.count).map((b) => b.path))
        logStream.info(`Keeping ${policy.count} most recent backups, removing ${toDelete.length} old backups`)
      }
    } else if (policy.type === 'DAYS' && policy.days) {
      // Keep backups from the last N days
      const cutoffDate = new Date()
      cutoffDate.setDate(cutoffDate.getDate() - policy.days)

      for (const backup of backups) {
        if (backup.createdTime < cutoffDate) {
          toDelete.push(backup.path)
        }
      }
      logStream.info(`Keeping backups from last ${policy.days} days, removing ${toDelete.length} old backups`)
    } else if (policy.type === 'HYBRID' && policy.count && policy.days) {
      // Keep N versions AND anything newer than M days (whichever is more permissive)
      const cutoffDate = new Date()
      cutoffDate.setDate(cutoffDate.getDate() - policy.days)

      const keepByVersion = new Set(backups.slice(0, policy.count).map((b) => b.path))

      for (const backup of backups) {
        const isWithinVersionCount = keepByVersion.has(backup.path)
        const isWithinDays = backup.createdTime >= cutoffDate

        if (!isWithinVersionCount && !isWithinDays) {
          toDelete.push(backup.path)
        }
      }
      logStream.info(`Hybrid policy: keeping ${policy.count} versions OR ${policy.days} days, removing ${toDelete.length} old backups`)
    }

    // Delete old backups
    if (toDelete.length > 0) {
      logger.info({ deleteCount: toDelete.length }, 'Deleting old backups')

      for (const backupPath of toDelete) {
        try {
          await adapter.deleteFolder(destinationId, backupPath)
          logger.info({ backupPath }, 'Deleted old backup')
          logStream.info(`Deleted old backup: ${backupPath}`)
        } catch (error: any) {
          logger.error({ backupPath, error: error.message }, 'Failed to delete old backup')
          logStream.error(`Error: Failed to delete backup: ${backupPath}`)
        }
      }
    } else {
      logger.info('No backups to delete')
      logStream.info('No old backups to delete')
    }
  } catch (error: any) {
    logger.error({ error: error.message }, 'Failed to apply retention policy')
    logStream.error(`Error: Retention policy error: ${error.message}`)
    // Don't throw - retention failure shouldn't fail the entire backup
  }
}
