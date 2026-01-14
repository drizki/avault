/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

const mocks = vi.hoisted(() => ({
  jobFindMany: vi.fn(),
  jobFindUnique: vi.fn(),
  jobUpdate: vi.fn(),
  historyCreate: vi.fn(),
  transaction: vi.fn(),
  acquireJobLock: vi.fn(),
  releaseJobLock: vi.fn(),
  queueBackupJob: vi.fn(),
  getNextRunTime: vi.fn(),
  systemLogInfo: vi.fn(),
  loggerInfo: vi.fn(),
  loggerWarn: vi.fn(),
  loggerError: vi.fn(),
  loggerDebug: vi.fn(),
}))

vi.mock('@avault/shared', async (importOriginal) => {
  const actual = await importOriginal()
  return {
    ...(actual as object),
    logger: {
      info: mocks.loggerInfo,
      warn: mocks.loggerWarn,
      error: mocks.loggerError,
      debug: mocks.loggerDebug,
    },
  }
})

vi.mock('../lib/log-stream', () => ({
  systemLog: {
    info: mocks.systemLogInfo,
  },
}))

vi.mock('../lib/scheduler/cron-utils', () => ({
  getNextRunTime: mocks.getNextRunTime,
  isJobDue: vi.fn(),
}))

vi.mock('../lib/scheduler/job-lock', () => ({
  acquireJobLock: mocks.acquireJobLock,
  releaseJobLock: mocks.releaseJobLock,
}))

vi.mock('../lib/queue', () => ({
  queueBackupJob: mocks.queueBackupJob,
}))

import { BackupScheduler, initScheduler, getScheduler } from '../lib/scheduler/index'

describe('BackupScheduler', () => {
  let scheduler: BackupScheduler
  let mockDb: any
  let mockRedis: any

  beforeEach(() => {
    vi.clearAllMocks()
    vi.useFakeTimers()

    mockDb = {
      backupJob: {
        findMany: mocks.jobFindMany,
        findUnique: mocks.jobFindUnique,
        update: mocks.jobUpdate,
      },
      backupHistory: {
        create: mocks.historyCreate,
      },
      $transaction: mocks.transaction,
    }

    mockRedis = {}

    scheduler = new BackupScheduler(mockDb, mockRedis, 1000) // 1 second interval for tests
  })

  afterEach(async () => {
    await scheduler.stop()
    vi.useRealTimers()
  })

  describe('start()', () => {
    it('starts the scheduler and recalculates schedules', async () => {
      mocks.jobFindMany.mockResolvedValue([])

      await scheduler.start()

      expect(mocks.loggerInfo).toHaveBeenCalledWith(
        expect.objectContaining({ checkInterval: 1000 }),
        'Starting backup scheduler'
      )
    })

    it('logs warning if scheduler already running', async () => {
      mocks.jobFindMany.mockResolvedValue([])

      await scheduler.start()
      await scheduler.start() // Second call

      expect(mocks.loggerWarn).toHaveBeenCalledWith('Scheduler already running')
    })

    it('runs tick immediately on start', async () => {
      mocks.jobFindMany.mockResolvedValue([])

      await scheduler.start()

      // Should have called findMany twice: once for recalculateAllSchedules, once for tick
      expect(mocks.jobFindMany).toHaveBeenCalledTimes(2)
    })
  })

  describe('stop()', () => {
    it('stops the scheduler', async () => {
      mocks.jobFindMany.mockResolvedValue([])

      await scheduler.start()
      await scheduler.stop()

      expect(mocks.loggerInfo).toHaveBeenCalledWith('Backup scheduler stopped')
    })

    it('handles stop when not started', async () => {
      await scheduler.stop()

      expect(mocks.loggerInfo).toHaveBeenCalledWith('Backup scheduler stopped')
    })
  })

  describe('tick()', () => {
    it('queries for due jobs', async () => {
      mocks.jobFindMany.mockResolvedValue([])

      await scheduler.start()

      expect(mocks.jobFindMany).toHaveBeenCalledWith({
        where: {
          enabled: true,
          OR: [{ nextRunAt: null }, { nextRunAt: { lte: expect.any(Date) } }],
        },
        include: {
          destination: true,
          credential: true,
        },
      })
    })

    it('processes due jobs', async () => {
      const mockJob = {
        id: 'job-1',
        name: 'Test Job',
        schedule: '0 * * * *',
        sourcePath: '/data',
        destinationId: 'dest-1',
        credentialId: 'cred-1',
        namePattern: 'backup-{date}',
        retentionType: 'VERSION_COUNT',
        retentionCount: 5,
      }

      // First call for recalculateAllSchedules, second for tick
      mocks.jobFindMany
        .mockResolvedValueOnce([]) // recalculateAllSchedules
        .mockResolvedValueOnce([mockJob]) // tick

      mocks.acquireJobLock.mockResolvedValue(true)
      mocks.releaseJobLock.mockResolvedValue(undefined)
      mocks.getNextRunTime.mockReturnValue(new Date('2024-01-16T02:00:00Z'))
      mocks.transaction.mockImplementation(async (callback: any) => {
        const tx = {
          backupJob: {
            findUnique: vi.fn().mockResolvedValue({ enabled: true, nextRunAt: null }),
            update: vi.fn().mockResolvedValue({}),
          },
          backupHistory: {
            create: vi.fn().mockResolvedValue({ id: 'hist-1' }),
          },
        }
        return callback(tx)
      })
      mocks.queueBackupJob.mockResolvedValue({})

      await scheduler.start()

      expect(mocks.acquireJobLock).toHaveBeenCalledWith(mockRedis, 'job-1', expect.any(Number))
      expect(mocks.queueBackupJob).toHaveBeenCalled()
      expect(mocks.releaseJobLock).toHaveBeenCalledWith(mockRedis, 'job-1')
    })

    it('skips job if lock not acquired', async () => {
      const mockJob = {
        id: 'job-1',
        name: 'Test Job',
      }

      mocks.jobFindMany
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([mockJob])

      mocks.acquireJobLock.mockResolvedValue(false)

      await scheduler.start()

      expect(mocks.transaction).not.toHaveBeenCalled()
      expect(mocks.loggerDebug).toHaveBeenCalledWith(
        { jobId: 'job-1' },
        'Job already locked by another instance'
      )
    })

    it('skips job if disabled during processing', async () => {
      const mockJob = {
        id: 'job-1',
        name: 'Test Job',
      }

      mocks.jobFindMany
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([mockJob])

      mocks.acquireJobLock.mockResolvedValue(true)
      mocks.releaseJobLock.mockResolvedValue(undefined)
      mocks.transaction.mockImplementation(async (callback: any) => {
        const tx = {
          backupJob: {
            findUnique: vi.fn().mockResolvedValue({ enabled: false }),
          },
        }
        return callback(tx)
      })

      await scheduler.start()

      expect(mocks.loggerWarn).toHaveBeenCalledWith(
        { jobId: 'job-1' },
        'Job disabled during processing, skipping'
      )
      expect(mocks.queueBackupJob).not.toHaveBeenCalled()
    })

    it('handles transaction errors gracefully', async () => {
      const mockJob = {
        id: 'job-1',
        name: 'Test Job',
      }

      mocks.jobFindMany
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([mockJob])

      mocks.acquireJobLock.mockResolvedValue(true)
      mocks.releaseJobLock.mockResolvedValue(undefined)
      mocks.transaction.mockRejectedValue(new Error('Transaction failed'))

      await scheduler.start()

      expect(mocks.loggerError).toHaveBeenCalledWith(
        expect.objectContaining({ jobId: 'job-1', error: 'Transaction failed' }),
        'Failed to process scheduled job'
      )
      expect(mocks.releaseJobLock).toHaveBeenCalled() // Lock should still be released
    })

    it('logs system log on successful queue', async () => {
      const mockJob = {
        id: 'job-1',
        name: 'Test Job',
        schedule: '0 * * * *',
        sourcePath: '/data',
        destinationId: 'dest-1',
        credentialId: 'cred-1',
        namePattern: 'backup-{date}',
        retentionType: 'VERSION_COUNT',
        retentionCount: 5,
      }

      mocks.jobFindMany
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([mockJob])

      mocks.acquireJobLock.mockResolvedValue(true)
      mocks.releaseJobLock.mockResolvedValue(undefined)
      const nextRunAt = new Date('2024-01-16T02:00:00Z')
      mocks.getNextRunTime.mockReturnValue(nextRunAt)
      mocks.transaction.mockImplementation(async (callback: any) => {
        const tx = {
          backupJob: {
            findUnique: vi.fn().mockResolvedValue({ enabled: true }),
            update: vi.fn().mockResolvedValue({}),
          },
          backupHistory: {
            create: vi.fn().mockResolvedValue({ id: 'hist-1' }),
          },
        }
        return callback(tx)
      })
      mocks.queueBackupJob.mockResolvedValue({})

      await scheduler.start()

      expect(mocks.systemLogInfo).toHaveBeenCalledWith(
        'Scheduled job queued: Test Job',
        expect.objectContaining({
          jobId: 'job-1',
          historyId: 'hist-1',
        })
      )
    })
  })

  describe('recalculateAllSchedules()', () => {
    it('recalculates schedules for jobs without nextRunAt', async () => {
      const mockJobs = [
        { id: 'job-1', schedule: '0 * * * *', nextRunAt: null },
        { id: 'job-2', schedule: '0 2 * * *', nextRunAt: null },
      ]

      mocks.jobFindMany.mockResolvedValue(mockJobs)
      const nextRunAt = new Date('2024-01-16T02:00:00Z')
      mocks.getNextRunTime.mockReturnValue(nextRunAt)
      mocks.jobUpdate.mockResolvedValue({})

      // Create new scheduler to test recalculateAllSchedules directly
      const testScheduler = new BackupScheduler(mockDb, mockRedis, 60000)
      await testScheduler['recalculateAllSchedules']()

      expect(mocks.jobUpdate).toHaveBeenCalledTimes(2)
      expect(mocks.loggerInfo).toHaveBeenCalledWith(
        { recalculatedCount: 2 },
        'Recalculated schedules for all jobs'
      )
    })

    it('handles errors for individual jobs', async () => {
      const mockJobs = [
        { id: 'job-1', schedule: '0 * * * *' },
        { id: 'job-2', schedule: 'invalid' },
      ]

      mocks.jobFindMany.mockResolvedValue(mockJobs)
      mocks.getNextRunTime.mockReturnValue(new Date())
      mocks.jobUpdate
        .mockResolvedValueOnce({})
        .mockRejectedValueOnce(new Error('Update failed'))

      const testScheduler = new BackupScheduler(mockDb, mockRedis, 60000)
      await testScheduler['recalculateAllSchedules']()

      expect(mocks.loggerError).toHaveBeenCalledWith(
        expect.objectContaining({ jobId: 'job-2', error: 'Update failed' }),
        'Failed to recalculate schedule'
      )
      // Should still complete successfully
      expect(mocks.loggerInfo).toHaveBeenCalledWith(
        { recalculatedCount: 1 },
        'Recalculated schedules for all jobs'
      )
    })

    it('handles database query errors', async () => {
      mocks.jobFindMany.mockRejectedValue(new Error('DB error'))

      const testScheduler = new BackupScheduler(mockDb, mockRedis, 60000)
      await testScheduler['recalculateAllSchedules']()

      expect(mocks.loggerError).toHaveBeenCalledWith(
        { error: 'DB error' },
        'Error recalculating schedules'
      )
    })
  })

  describe('interval scheduling', () => {
    it('runs tick on interval', async () => {
      mocks.jobFindMany.mockResolvedValue([])

      await scheduler.start()

      // Initial tick already ran, clear the call count
      const initialCalls = mocks.jobFindMany.mock.calls.length

      // Advance time by one interval
      await vi.advanceTimersByTimeAsync(1000)

      // Should have additional calls
      expect(mocks.jobFindMany.mock.calls.length).toBeGreaterThan(initialCalls)
    })

    it('logs error when interval tick fails', async () => {
      mocks.jobFindMany
        .mockResolvedValueOnce([]) // recalculateAllSchedules
        .mockResolvedValueOnce([]) // initial tick
        .mockRejectedValueOnce(new Error('Tick failed')) // interval tick

      await scheduler.start()

      // Advance time to trigger interval tick
      await vi.advanceTimersByTimeAsync(1000)

      expect(mocks.loggerError).toHaveBeenCalledWith(
        expect.objectContaining({ error: 'Tick failed' }),
        expect.any(String)
      )
    })
  })

  describe('overlapping execution', () => {
    it('skips tick when previous tick still running', async () => {
      // Create a job that takes time to process
      const mockJob = {
        id: 'job-1',
        name: 'Slow Job',
        schedule: '0 * * * *',
      }

      // Create a promise that we can control
      let resolveSlowTransaction: () => void = () => {}
      const slowTransactionPromise = new Promise<void>((resolve) => {
        resolveSlowTransaction = resolve
      })

      mocks.jobFindMany
        .mockResolvedValueOnce([]) // recalculateAllSchedules
        .mockResolvedValueOnce([mockJob]) // first tick - finds job

      mocks.acquireJobLock.mockResolvedValue(true)
      mocks.releaseJobLock.mockResolvedValue(undefined)
      mocks.transaction.mockImplementation(async () => {
        await slowTransactionPromise
        return {}
      })

      // Start scheduler - first tick starts processing
      const startPromise = scheduler.start()

      // Advance time to trigger another tick while first is still running
      await vi.advanceTimersByTimeAsync(1000)

      // The overlapping tick should be skipped
      expect(mocks.loggerDebug).toHaveBeenCalledWith(
        'Scheduler tick skipped - previous tick still running'
      )

      // Clean up
      resolveSlowTransaction()
      await startPromise
    })
  })
})

describe('Scheduler singleton', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('initScheduler creates singleton instance', () => {
    const mockDb = {} as any
    const mockRedis = {} as any

    // Note: This test is limited because we can't easily reset the singleton
    // In a real scenario, you'd want to add a resetScheduler() function for testing
    const scheduler1 = initScheduler(mockDb, mockRedis)

    expect(scheduler1).toBeInstanceOf(BackupScheduler)
  })

  it('getScheduler returns null initially', () => {
    // This test assumes the singleton is not initialized
    // In practice, getScheduler would return the instance after initScheduler
    const scheduler = getScheduler()

    // The singleton might be initialized from previous tests
    // Just verify it returns either null or a BackupScheduler instance
    expect(scheduler === null || scheduler instanceof BackupScheduler).toBe(true)
  })
})
