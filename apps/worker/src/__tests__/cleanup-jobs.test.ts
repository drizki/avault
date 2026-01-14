/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, vi, beforeEach } from 'vitest'

// Use vi.hoisted for mock setup
const mocks = vi.hoisted(() => ({
  queueAdd: vi.fn(),
  queueClose: vi.fn(),
  connectionQuit: vi.fn(),
  dbDeleteMany: vi.fn(),
}))

vi.mock('bullmq', () => ({
  Queue: vi.fn().mockImplementation(() => ({
    add: mocks.queueAdd,
    close: mocks.queueClose,
  })),
}))

vi.mock('@avault/shared', async (importOriginal) => {
  const actual = await importOriginal()
  return {
    ...(actual as object),
    createRedisConnection: vi.fn().mockReturnValue({ quit: mocks.connectionQuit }),
    logger: {
      info: vi.fn(),
      error: vi.fn(),
      warn: vi.fn(),
      debug: vi.fn(),
    },
  }
})

import { scheduleLogCleanup, executeLogCleanup, closeCleanupQueue } from '../lib/cleanup-jobs'

describe('cleanup-jobs', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('scheduleLogCleanup', () => {
    it('adds cleanup job to queue', async () => {
      mocks.queueAdd.mockResolvedValue({ id: 'job-1' })

      await scheduleLogCleanup()

      expect(mocks.queueAdd).toHaveBeenCalledWith(
        'cleanup-old-logs',
        {},
        expect.objectContaining({
          repeat: { pattern: '0 2 * * *' },
          jobId: 'log-cleanup-daily',
        })
      )
    })

    it('throws when queue add fails', async () => {
      mocks.queueAdd.mockRejectedValue(new Error('Queue error'))

      await expect(scheduleLogCleanup()).rejects.toThrow('Queue error')
    })
  })

  describe('executeLogCleanup', () => {
    it('deletes expired logs', async () => {
      const mockDb = {
        logEntry: {
          deleteMany: vi.fn().mockResolvedValue({ count: 50 }),
        },
      }

      const result = await executeLogCleanup(mockDb as any)

      expect(result).toBe(50)
      expect(mockDb.logEntry.deleteMany).toHaveBeenCalledWith({
        where: {
          expiresAt: {
            lte: expect.any(Date),
          },
        },
      })
    })

    it('returns 0 when no logs to delete', async () => {
      const mockDb = {
        logEntry: {
          deleteMany: vi.fn().mockResolvedValue({ count: 0 }),
        },
      }

      const result = await executeLogCleanup(mockDb as any)

      expect(result).toBe(0)
    })

    it('throws when db operation fails', async () => {
      const mockDb = {
        logEntry: {
          deleteMany: vi.fn().mockRejectedValue(new Error('DB error')),
        },
      }

      await expect(executeLogCleanup(mockDb as any)).rejects.toThrow('DB error')
    })
  })

  describe('closeCleanupQueue', () => {
    it('closes queue and connection', async () => {
      mocks.queueClose.mockResolvedValue(undefined)
      mocks.connectionQuit.mockResolvedValue('OK')

      await closeCleanupQueue()

      expect(mocks.queueClose).toHaveBeenCalled()
      expect(mocks.connectionQuit).toHaveBeenCalled()
    })
  })
})
