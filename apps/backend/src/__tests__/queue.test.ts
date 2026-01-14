/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, vi, beforeEach } from 'vitest'

// Use vi.hoisted to define mocks that work with hoisting
const mocks = vi.hoisted(() => ({
  queueAdd: vi.fn(),
  queueGetJob: vi.fn(),
  queueGetWaitingCount: vi.fn(),
  queueGetActiveCount: vi.fn(),
  queueGetCompletedCount: vi.fn(),
  queueGetFailedCount: vi.fn(),
  queueGetDelayedCount: vi.fn(),
  queueGetActive: vi.fn(),
  queueGetWaiting: vi.fn(),
  queueGetDelayed: vi.fn(),
  queueClose: vi.fn(),
  queueEventsOn: vi.fn(),
  queueEventsClose: vi.fn(),
  connectionQuit: vi.fn(),
}))

vi.mock('bullmq', () => ({
  Queue: vi.fn().mockImplementation(() => ({
    add: mocks.queueAdd,
    getJob: mocks.queueGetJob,
    getWaitingCount: mocks.queueGetWaitingCount,
    getActiveCount: mocks.queueGetActiveCount,
    getCompletedCount: mocks.queueGetCompletedCount,
    getFailedCount: mocks.queueGetFailedCount,
    getDelayedCount: mocks.queueGetDelayedCount,
    getActive: mocks.queueGetActive,
    getWaiting: mocks.queueGetWaiting,
    getDelayed: mocks.queueGetDelayed,
    close: mocks.queueClose,
  })),
  QueueEvents: vi.fn().mockImplementation(() => ({
    on: mocks.queueEventsOn,
    close: mocks.queueEventsClose,
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

// Import after mocks
import {
  queueBackupJob,
  getQueueStats,
  cancelQueueJob,
  findQueueJobByHistoryId,
  getActiveJobs,
  cleanupStuckJobs,
  closeQueue,
} from '../lib/queue/index'

describe('queue management', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('queueBackupJob', () => {
    it('adds job to queue and returns job', async () => {
      const mockJob = { id: 'queue-job-123' }
      mocks.queueAdd.mockResolvedValue(mockJob)

      const jobData = {
        jobId: 'job-1',
        historyId: 'history-1',
        executionParams: {
          jobId: 'job-1',
          historyId: 'history-1',
          sourcePath: '/data',
          destinationId: 'dest-1',
          credentialId: 'cred-1',
          namePattern: 'backup-{date}',
          retentionPolicy: { type: 'VERSION_COUNT' as const, count: 5 },
        },
      }

      const result = await queueBackupJob(jobData)

      expect(mocks.queueAdd).toHaveBeenCalledWith('backup', jobData, undefined)
      expect(result).toBe(mockJob)
    })

    it('passes options to queue', async () => {
      const mockJob = { id: 'queue-job-123' }
      mocks.queueAdd.mockResolvedValue(mockJob)

      const jobData = {
        jobId: 'job-1',
        historyId: 'history-1',
        executionParams: {} as any,
      }
      const opts = { delay: 5000 }

      await queueBackupJob(jobData, opts)

      expect(mocks.queueAdd).toHaveBeenCalledWith('backup', jobData, opts)
    })

    it('throws on queue error', async () => {
      mocks.queueAdd.mockRejectedValue(new Error('Redis connection failed'))

      const jobData = {
        jobId: 'job-1',
        historyId: 'history-1',
        executionParams: {} as any,
      }

      await expect(queueBackupJob(jobData)).rejects.toThrow('Redis connection failed')
    })
  })

  describe('getQueueStats', () => {
    it('returns all queue counts', async () => {
      mocks.queueGetWaitingCount.mockResolvedValue(5)
      mocks.queueGetActiveCount.mockResolvedValue(2)
      mocks.queueGetCompletedCount.mockResolvedValue(100)
      mocks.queueGetFailedCount.mockResolvedValue(3)
      mocks.queueGetDelayedCount.mockResolvedValue(1)

      const stats = await getQueueStats()

      expect(stats).toEqual({
        waiting: 5,
        active: 2,
        completed: 100,
        failed: 3,
        delayed: 1,
        total: 111,
      })
    })
  })

  describe('cancelQueueJob', () => {
    it('returns error when job not found', async () => {
      mocks.queueGetJob.mockResolvedValue(null)

      const result = await cancelQueueJob('nonexistent')

      expect(result).toEqual({ success: false, error: 'Job not found in queue' })
    })

    it('returns error when job already completed', async () => {
      const mockJob = { getState: vi.fn().mockResolvedValue('completed') }
      mocks.queueGetJob.mockResolvedValue(mockJob)

      const result = await cancelQueueJob('queue-job-123')

      expect(result).toEqual({ success: false, error: 'Job already completed' })
    })

    it('returns error when job already failed', async () => {
      const mockJob = { getState: vi.fn().mockResolvedValue('failed') }
      mocks.queueGetJob.mockResolvedValue(mockJob)

      const result = await cancelQueueJob('queue-job-123')

      expect(result).toEqual({ success: false, error: 'Job already failed' })
    })

    it('moves active job to failed', async () => {
      const mockJob = {
        getState: vi.fn().mockResolvedValue('active'),
        moveToFailed: vi.fn().mockResolvedValue(undefined),
      }
      mocks.queueGetJob.mockResolvedValue(mockJob)

      const result = await cancelQueueJob('queue-job-123')

      expect(mockJob.moveToFailed).toHaveBeenCalled()
      expect(result).toEqual({ success: true, state: 'active' })
    })

    it('removes waiting job', async () => {
      const mockJob = {
        getState: vi.fn().mockResolvedValue('waiting'),
        remove: vi.fn().mockResolvedValue(undefined),
      }
      mocks.queueGetJob.mockResolvedValue(mockJob)

      const result = await cancelQueueJob('queue-job-123')

      expect(mockJob.remove).toHaveBeenCalled()
      expect(result).toEqual({ success: true, state: 'waiting' })
    })

    it('handles errors gracefully', async () => {
      mocks.queueGetJob.mockRejectedValue(new Error('Queue connection error'))

      const result = await cancelQueueJob('queue-job-123')

      expect(result).toEqual({ success: false, error: 'Queue connection error' })
    })
  })

  describe('findQueueJobByHistoryId', () => {
    it('finds job in active queue', async () => {
      const targetJob = { data: { historyId: 'target-history' } }
      mocks.queueGetActive.mockResolvedValue([targetJob])
      mocks.queueGetWaiting.mockResolvedValue([])
      mocks.queueGetDelayed.mockResolvedValue([])

      const result = await findQueueJobByHistoryId('target-history')

      expect(result).toBe(targetJob)
    })

    it('finds job in waiting queue', async () => {
      const targetJob = { data: { historyId: 'target-history' } }
      mocks.queueGetActive.mockResolvedValue([])
      mocks.queueGetWaiting.mockResolvedValue([targetJob])
      mocks.queueGetDelayed.mockResolvedValue([])

      const result = await findQueueJobByHistoryId('target-history')

      expect(result).toBe(targetJob)
    })

    it('finds job in delayed queue', async () => {
      const targetJob = { data: { historyId: 'target-history' } }
      mocks.queueGetActive.mockResolvedValue([])
      mocks.queueGetWaiting.mockResolvedValue([])
      mocks.queueGetDelayed.mockResolvedValue([targetJob])

      const result = await findQueueJobByHistoryId('target-history')

      expect(result).toBe(targetJob)
    })

    it('returns null when job not found', async () => {
      mocks.queueGetActive.mockResolvedValue([])
      mocks.queueGetWaiting.mockResolvedValue([])
      mocks.queueGetDelayed.mockResolvedValue([])

      const result = await findQueueJobByHistoryId('nonexistent')

      expect(result).toBeNull()
    })

    it('returns null on error', async () => {
      mocks.queueGetActive.mockRejectedValue(new Error('Queue error'))

      const result = await findQueueJobByHistoryId('target-history')

      expect(result).toBeNull()
    })
  })

  describe('getActiveJobs', () => {
    it('returns formatted active jobs', async () => {
      const jobs = [
        { id: '1', data: { jobId: 'job-1', historyId: 'h-1' }, progress: 25, timestamp: 1000 },
        { id: '2', data: { jobId: 'job-2', historyId: 'h-2' }, progress: 75, timestamp: 2000 },
      ]
      mocks.queueGetActive.mockResolvedValue(jobs)

      const result = await getActiveJobs()

      expect(result).toEqual([
        { queueJobId: '1', jobId: 'job-1', historyId: 'h-1', progress: 25, timestamp: 1000 },
        { queueJobId: '2', jobId: 'job-2', historyId: 'h-2', progress: 75, timestamp: 2000 },
      ])
    })

    it('returns empty array on error', async () => {
      mocks.queueGetActive.mockRejectedValue(new Error('Redis error'))

      const result = await getActiveJobs()

      expect(result).toEqual([])
    })
  })

  describe('cleanupStuckJobs', () => {
    it('cleans up jobs older than threshold', async () => {
      const now = Date.now()
      const oldJob = {
        id: 'old-job',
        data: { jobId: 'job-1' },
        timestamp: now - 2 * 60 * 60 * 1000, // 2 hours ago
        moveToFailed: vi.fn().mockResolvedValue(undefined),
      }
      const recentJob = {
        id: 'recent-job',
        data: { jobId: 'job-2' },
        timestamp: now - 30 * 60 * 1000, // 30 minutes ago
        moveToFailed: vi.fn(),
      }

      mocks.queueGetActive.mockResolvedValue([oldJob, recentJob])

      const result = await cleanupStuckJobs(60) // 60 minute threshold

      expect(oldJob.moveToFailed).toHaveBeenCalled()
      expect(recentJob.moveToFailed).not.toHaveBeenCalled()
      expect(result).toEqual({ cleanedCount: 1, checkedCount: 2 })
    })

    it('returns zeros when no stuck jobs', async () => {
      mocks.queueGetActive.mockResolvedValue([])

      const result = await cleanupStuckJobs()

      expect(result).toEqual({ cleanedCount: 0, checkedCount: 0 })
    })

    it('handles errors gracefully', async () => {
      mocks.queueGetActive.mockRejectedValue(new Error('Redis connection lost'))

      const result = await cleanupStuckJobs()

      expect(result).toEqual({ cleanedCount: 0, checkedCount: 0, error: 'Redis connection lost' })
    })
  })

  describe('closeQueue', () => {
    it('closes all connections', async () => {
      mocks.queueEventsClose.mockResolvedValue(undefined)
      mocks.queueClose.mockResolvedValue(undefined)
      mocks.connectionQuit.mockResolvedValue(undefined)

      await closeQueue()

      expect(mocks.queueEventsClose).toHaveBeenCalled()
      expect(mocks.queueClose).toHaveBeenCalled()
      expect(mocks.connectionQuit).toHaveBeenCalled()
    })
  })
})
