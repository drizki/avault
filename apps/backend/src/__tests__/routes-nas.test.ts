import { describe, it, expect, vi, beforeEach } from 'vitest'
import { Hono } from 'hono'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type ApiResponse = { success: boolean; data?: any; error?: string; details?: string }

const mocks = vi.hoisted(() => ({
  fsAccess: vi.fn(),
  fsReaddir: vi.fn(),
  fsStat: vi.fn(),
  fsRealpath: vi.fn(),
  loggerDebug: vi.fn(),
  loggerError: vi.fn(),
}))

vi.mock('@avault/shared', async (importOriginal) => {
  const actual = await importOriginal()
  return {
    ...(actual as object),
    logger: {
      debug: mocks.loggerDebug,
      error: mocks.loggerError,
      info: vi.fn(),
      warn: vi.fn(),
    },
  }
})

vi.mock('fs', () => ({
  promises: {
    access: mocks.fsAccess,
    readdir: mocks.fsReaddir,
    stat: mocks.fsStat,
    realpath: mocks.fsRealpath,
  },
}))

vi.mock('../middleware/auth', () => ({
  requireAuth: vi.fn().mockImplementation(async (c, next) => {
    c.set('userId', 'user-123')
    c.set('userRole', 'USER')
    await next()
  }),
}))

// Need to import after mocks
import nasRoutes from '../routes/nas'

describe('nas routes', () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let app: Hono<any>

  beforeEach(() => {
    vi.clearAllMocks()
    process.env.NAS_MOUNT_PATH = '/mnt/nas'
    app = new Hono()
    app.route('/api/nas', nasRoutes)
  })

  describe('GET /api/nas/info', () => {
    it('returns mount path info', async () => {
      const res = await app.request('/api/nas/info')

      expect(res.status).toBe(200)
      const body = await res.json() as ApiResponse
      expect(body.success).toBe(true)
      expect(body.data.mountPath).toBeDefined()
    })
  })

  describe('GET /api/nas/browse', () => {
    it('returns directory listing', async () => {
      mocks.fsAccess.mockResolvedValue(undefined)
      mocks.fsReaddir.mockResolvedValue([
        { name: 'documents', isDirectory: () => true },
        { name: 'photo.jpg', isDirectory: () => false },
      ])
      mocks.fsStat.mockImplementation((itemPath) => {
        if (itemPath.includes('documents')) {
          return Promise.resolve({ isDirectory: () => true, isFile: () => false, mtime: new Date() })
        }
        return Promise.resolve({ isDirectory: () => false, isFile: () => true, size: 1024, mtime: new Date() })
      })

      const res = await app.request('/api/nas/browse?path=/')

      expect(res.status).toBe(200)
      const body = await res.json() as ApiResponse
      expect(body.success).toBe(true)
      expect(body.data.items).toHaveLength(2)
    })

    it('returns 500 when NAS mount not found', async () => {
      mocks.fsAccess.mockRejectedValue(new Error('ENOENT'))

      const res = await app.request('/api/nas/browse?path=/')

      expect(res.status).toBe(500)
      const body = await res.json() as ApiResponse
      expect(body.success).toBe(false)
      expect(body.error).toContain('NAS mount path not found')
    })

    it('returns 403 for path traversal attempt', async () => {
      mocks.fsAccess.mockResolvedValue(undefined)

      const res = await app.request('/api/nas/browse?path=/../../../etc/passwd')

      expect(res.status).toBe(403)
      const body = await res.json() as ApiResponse
      expect(body.success).toBe(false)
      expect(body.error).toContain('Access denied')
    })

    it('returns 403 on permission denied', async () => {
      mocks.fsAccess.mockResolvedValue(undefined)
      mocks.fsReaddir.mockRejectedValue({ code: 'EACCES', message: 'Permission denied' })

      const res = await app.request('/api/nas/browse?path=/')

      expect(res.status).toBe(403)
      const body = await res.json() as ApiResponse
      expect(body.success).toBe(false)
      expect(body.error).toContain('Permission denied')
    })

    it('returns 403 with generic error message for non-permission errors', async () => {
      mocks.fsAccess.mockResolvedValue(undefined)
      mocks.fsReaddir.mockRejectedValue({ code: 'ENOTDIR', message: 'Not a directory' })

      const res = await app.request('/api/nas/browse?path=/')

      expect(res.status).toBe(403)
      const body = await res.json() as ApiResponse
      expect(body.success).toBe(false)
      expect(body.error).toContain('Cannot read directory')
    })

    it('skips unreadable files', async () => {
      mocks.fsAccess.mockResolvedValue(undefined)
      mocks.fsReaddir.mockResolvedValue([
        { name: 'readable', isDirectory: () => true },
        { name: 'unreadable', isDirectory: () => true },
      ])
      mocks.fsStat.mockImplementation((itemPath) => {
        if (itemPath.includes('unreadable')) {
          return Promise.reject(new Error('Permission denied'))
        }
        return Promise.resolve({ isDirectory: () => true, isFile: () => false, mtime: new Date() })
      })

      const res = await app.request('/api/nas/browse?path=/')

      const body = await res.json() as ApiResponse
      expect(body.success).toBe(true)
      expect(body.data.items).toHaveLength(1)
      expect(body.data.items[0].name).toBe('readable')
    })

    it('uses default path when not provided', async () => {
      mocks.fsAccess.mockResolvedValue(undefined)
      mocks.fsReaddir.mockResolvedValue([])

      const res = await app.request('/api/nas/browse')

      const body = await res.json() as ApiResponse
      expect(body.success).toBe(true)
      expect(body.data.path).toBe('/')
    })
  })

  describe('GET /api/nas/stats', () => {
    it('returns stats for empty directory', async () => {
      mocks.fsAccess.mockResolvedValue(undefined)
      mocks.fsReaddir.mockResolvedValue([])

      const res = await app.request('/api/nas/stats?path=/documents')

      expect(res.status).toBe(200)
      const body = await res.json() as ApiResponse
      expect(body.success).toBe(true)
      expect(body.data).toEqual({
        path: '/documents',
        totalSize: '0',
        fileCount: 0,
        directoryCount: 0,
        limitReached: false,
      })
    })

    it('calculates stats for files and directories', async () => {
      mocks.fsAccess.mockResolvedValue(undefined)
      mocks.fsReaddir
        .mockResolvedValueOnce([
          { name: 'file1.txt', isDirectory: () => false },
          { name: 'file2.txt', isDirectory: () => false },
          { name: 'subdir', isDirectory: () => true },
        ])
        .mockResolvedValueOnce([]) // Empty subdir
      mocks.fsStat
        .mockResolvedValueOnce({ isDirectory: () => false, isFile: () => true, size: 1000 })
        .mockResolvedValueOnce({ isDirectory: () => false, isFile: () => true, size: 2000 })
        .mockResolvedValueOnce({ isDirectory: () => true, isFile: () => false })
      // Mock realpath to return paths within mount
      mocks.fsRealpath.mockImplementation(async (p) => p as string)

      const res = await app.request('/api/nas/stats?path=/')

      expect(res.status).toBe(200)
      const body = await res.json() as ApiResponse
      expect(body.success).toBe(true)
      expect(body.data.fileCount).toBe(2)
      expect(body.data.directoryCount).toBe(1)
      expect(body.data.totalSize).toBe('3000')
      expect(body.data.limitReached).toBe(false)
    })

    it('returns 403 for path traversal attempt', async () => {
      mocks.fsAccess.mockResolvedValue(undefined)

      const res = await app.request('/api/nas/stats?path=/../../../etc')

      expect(res.status).toBe(403)
      const body = await res.json() as ApiResponse
      expect(body.success).toBe(false)
      expect(body.error).toContain('Access denied')
    })

    it('returns 500 when NAS mount not found', async () => {
      mocks.fsAccess.mockRejectedValue(new Error('ENOENT'))

      const res = await app.request('/api/nas/stats?path=/documents')

      expect(res.status).toBe(500)
      const body = await res.json() as ApiResponse
      expect(body.success).toBe(false)
      expect(body.error).toContain('NAS mount path not found')
    })
  })
})
