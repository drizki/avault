import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { BrowsePathSchema, logger } from '@avault/shared'
import { requireAuth } from '../middleware/auth'
import type { Env } from '../index'
import { promises as fs } from 'fs'
import path from 'path'

const nas = new Hono<Env>()

// Apply authentication to all routes
nas.use('*', requireAuth)

const NAS_MOUNT_PATH = process.env.NAS_MOUNT_PATH || '/mnt/nas'
// Resolve the mount path once to handle symlinks (e.g., /Users -> /Volumes/Macintosh SSD/Users on macOS)
const RESOLVED_MOUNT_PATH = path.resolve(NAS_MOUNT_PATH)

// Get NAS info (mount path)
nas.get('/info', async (c) => {
  return c.json({
    success: true,
    data: {
      mountPath: RESOLVED_MOUNT_PATH,
    },
  })
})

// Browse NAS filesystem (authenticated users only)
nas.get('/browse', zValidator('query', BrowsePathSchema), async (c) => {
  const { path: requestedPath } = c.req.valid('query')

  try {
    // Check if NAS_MOUNT_PATH exists
    try {
      await fs.access(RESOLVED_MOUNT_PATH)
    } catch {
      return c.json({
        success: false,
        error: `NAS mount path not found: ${NAS_MOUNT_PATH}. Set NAS_MOUNT_PATH in your .env file.`,
      }, 500)
    }

    const fullPath = path.join(RESOLVED_MOUNT_PATH, requestedPath)

    // Security: Ensure path is within NAS mount
    const resolvedPath = path.resolve(fullPath)
    if (!resolvedPath.startsWith(RESOLVED_MOUNT_PATH)) {
      return c.json({
        success: false,
        error: 'Access denied: Path outside NAS mount',
      }, 403)
    }

    // Read directory
    let entries
    try {
      logger.debug({ path: resolvedPath }, 'NAS reading directory')
      entries = await fs.readdir(resolvedPath, { withFileTypes: true })
      logger.debug({ path: resolvedPath, count: entries.length }, 'NAS found entries')
    } catch (readError: unknown) {
      // Permission denied or other read error
      const err = readError instanceof Error && 'code' in readError ? readError as NodeJS.ErrnoException : null
      logger.error({ path: resolvedPath, code: err?.code, message: err?.message }, 'NAS failed to read directory')
      return c.json({
        success: false,
        error: err?.code === 'EACCES' || err?.code === 'EPERM'
          ? `Permission denied: ${resolvedPath}. On macOS, grant Full Disk Access to Terminal in System Preferences > Privacy & Security.`
          : `Cannot read directory: ${err?.message || 'Unknown error'}`,
      }, 403)
    }

    const items = await Promise.all(
      entries.map(async (entry) => {
        const itemPath = path.join(resolvedPath, entry.name)
        // Use resolved mount path for relative calculation
        const relativePath = path.relative(RESOLVED_MOUNT_PATH, itemPath)

        try {
          // Use fs.stat which follows symlinks to get the actual type
          const stats = await fs.stat(itemPath)

          return {
            name: entry.name,
            path: `/${relativePath}`,
            // IMPORTANT: Use stats.isDirectory() instead of entry.isDirectory()
            // entry.isDirectory() returns false for symlinks, but stats follows symlinks
            type: stats.isDirectory() ? 'directory' : 'file',
            size: stats.isFile() ? stats.size : undefined,
            modified: stats.mtime,
          }
        } catch {
          // Skip files we can't read (permission issues, broken symlinks, etc.)
          return null
        }
      })
    )

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const validItems = items.filter(Boolean) as any[]

    // Log stats
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const dirs = validItems.filter((i: any) => i.type === 'directory')
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const files = validItems.filter((i: any) => i.type === 'file')
    logger.debug({ directories: dirs.length, files: files.length }, 'NAS browse result')

    return c.json({
      success: true,
      data: {
        path: requestedPath,
        items: validItems,
      },
    })
  } catch (error: unknown) {
    logger.error({ err: error }, 'NAS browse error')
    const message = error instanceof Error ? error.message : 'Unknown error'
    return c.json({
      success: false,
      error: 'Failed to read directory',
      details: message,
    }, 500)
  }
})

// Get folder stats (size, file count)
nas.get('/stats', zValidator('query', BrowsePathSchema), async (c) => {
  const { path: requestedPath } = c.req.valid('query')

  try {
    // Check if NAS_MOUNT_PATH exists
    try {
      await fs.access(RESOLVED_MOUNT_PATH)
    } catch {
      return c.json({
        success: false,
        error: `NAS mount path not found: ${NAS_MOUNT_PATH}. Set NAS_MOUNT_PATH in your .env file.`,
      }, 500)
    }

    const fullPath = path.join(RESOLVED_MOUNT_PATH, requestedPath)

    // Security: Ensure path is within NAS mount
    const resolvedPath = path.resolve(fullPath)
    if (!resolvedPath.startsWith(RESOLVED_MOUNT_PATH)) {
      return c.json({
        success: false,
        error: 'Access denied: Path outside NAS mount',
      }, 403)
    }

    // Calculate stats recursively with limits to prevent runaway operations
    const MAX_FILES = 100000 // Safety limit
    let fileCount = 0
    let directoryCount = 0
    let totalSize = BigInt(0)
    let limitReached = false

    async function calculateStats(dirPath: string): Promise<void> {
      if (limitReached) return

      let entries
      try {
        entries = await fs.readdir(dirPath, { withFileTypes: true })
      } catch {
        // Skip directories we can't read (permission issues)
        return
      }

      for (const entry of entries) {
        if (limitReached) return
        if (fileCount + directoryCount >= MAX_FILES) {
          limitReached = true
          return
        }

        const itemPath = path.join(dirPath, entry.name)

        try {
          // Use fs.stat which follows symlinks
          const stats = await fs.stat(itemPath)

          // Security: Skip symlinks that point outside mount path
          const realPath = await fs.realpath(itemPath).catch(() => null)
          if (realPath && !realPath.startsWith(RESOLVED_MOUNT_PATH)) {
            continue
          }

          if (stats.isDirectory()) {
            directoryCount++
            // Recurse into subdirectory
            await calculateStats(itemPath)
          } else if (stats.isFile()) {
            fileCount++
            totalSize += BigInt(stats.size)
          }
        } catch {
          // Skip files we can't stat (broken symlinks, permission issues)
          continue
        }
      }
    }

    await calculateStats(resolvedPath)

    return c.json({
      success: true,
      data: {
        path: requestedPath,
        totalSize: totalSize.toString(),
        fileCount,
        directoryCount,
        limitReached,
      },
    })
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Unknown error'
    logger.error({ err: error }, 'NAS stats error')
    return c.json({
      success: false,
      error: 'Failed to calculate directory stats',
      details: message,
    }, 500)
  }
})

export default nas
