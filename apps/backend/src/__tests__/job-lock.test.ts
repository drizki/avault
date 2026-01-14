/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, vi, beforeEach } from 'vitest'

const mocks = vi.hoisted(() => ({
  set: vi.fn(),
  del: vi.fn(),
  exists: vi.fn(),
  loggerInfo: vi.fn(),
  loggerError: vi.fn(),
  loggerWarn: vi.fn(),
  loggerDebug: vi.fn(),
}))

vi.mock('@avault/shared', async (importOriginal) => {
  const actual = await importOriginal()
  return {
    ...(actual as object),
    logger: {
      info: mocks.loggerInfo,
      error: mocks.loggerError,
      warn: mocks.loggerWarn,
      debug: mocks.loggerDebug,
    },
  }
})

import { acquireJobLock, releaseJobLock, isJobLocked } from '../lib/scheduler/job-lock'

describe('job-lock', () => {
  const mockRedis = {
    set: mocks.set,
    del: mocks.del,
    exists: mocks.exists,
  }

  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('acquireJobLock', () => {
    it('returns true when lock is acquired successfully', async () => {
      mocks.set.mockResolvedValue('OK')

      const result = await acquireJobLock(mockRedis as any, 'job-123')

      expect(result).toBe(true)
      expect(mocks.set).toHaveBeenCalledWith(
        'scheduler:lock:job-123',
        expect.any(String),
        'EX',
        60, // default TTL of 60 seconds
        'NX'
      )
    })

    it('returns false when lock already exists', async () => {
      mocks.set.mockResolvedValue(null)

      const result = await acquireJobLock(mockRedis as any, 'job-123')

      expect(result).toBe(false)
    })

    it('uses custom TTL when provided', async () => {
      mocks.set.mockResolvedValue('OK')

      await acquireJobLock(mockRedis as any, 'job-456', 30000)

      expect(mocks.set).toHaveBeenCalledWith(
        'scheduler:lock:job-456',
        expect.any(String),
        'EX',
        30,
        'NX'
      )
    })

    it('rounds up TTL to nearest second', async () => {
      mocks.set.mockResolvedValue('OK')

      await acquireJobLock(mockRedis as any, 'job-789', 1500)

      expect(mocks.set).toHaveBeenCalledWith(
        'scheduler:lock:job-789',
        expect.any(String),
        'EX',
        2,
        'NX'
      )
    })

    it('returns false on Redis error', async () => {
      mocks.set.mockRejectedValue(new Error('Connection failed'))

      const result = await acquireJobLock(mockRedis as any, 'job-123')

      expect(result).toBe(false)
      expect(mocks.loggerError).toHaveBeenCalled()
    })

    it('logs debug message on successful lock acquisition', async () => {
      mocks.set.mockResolvedValue('OK')

      await acquireJobLock(mockRedis as any, 'job-abc')

      expect(mocks.loggerDebug).toHaveBeenCalledWith(
        { jobId: 'job-abc', ttl: 60 },
        'Job lock acquired'
      )
    })

    it('logs debug message when already locked', async () => {
      mocks.set.mockResolvedValue(null)

      await acquireJobLock(mockRedis as any, 'job-xyz')

      expect(mocks.loggerDebug).toHaveBeenCalledWith(
        { jobId: 'job-xyz' },
        'Job already locked by another instance'
      )
    })
  })

  describe('releaseJobLock', () => {
    it('deletes the lock key', async () => {
      mocks.del.mockResolvedValue(1)

      await releaseJobLock(mockRedis as any, 'job-123')

      expect(mocks.del).toHaveBeenCalledWith('scheduler:lock:job-123')
    })

    it('logs debug message on release', async () => {
      mocks.del.mockResolvedValue(1)

      await releaseJobLock(mockRedis as any, 'job-456')

      expect(mocks.loggerDebug).toHaveBeenCalledWith({ jobId: 'job-456' }, 'Job lock released')
    })

    it('handles errors gracefully', async () => {
      mocks.del.mockRejectedValue(new Error('Redis error'))

      // Should not throw
      await releaseJobLock(mockRedis as any, 'job-789')

      expect(mocks.loggerError).toHaveBeenCalled()
    })
  })

  describe('isJobLocked', () => {
    it('returns true when lock exists', async () => {
      mocks.exists.mockResolvedValue(1)

      const result = await isJobLocked(mockRedis as any, 'job-123')

      expect(result).toBe(true)
      expect(mocks.exists).toHaveBeenCalledWith('scheduler:lock:job-123')
    })

    it('returns false when lock does not exist', async () => {
      mocks.exists.mockResolvedValue(0)

      const result = await isJobLocked(mockRedis as any, 'job-456')

      expect(result).toBe(false)
    })

    it('returns false on Redis error', async () => {
      mocks.exists.mockRejectedValue(new Error('Redis error'))

      const result = await isJobLocked(mockRedis as any, 'job-789')

      expect(result).toBe(false)
      expect(mocks.loggerError).toHaveBeenCalled()
    })
  })
})
