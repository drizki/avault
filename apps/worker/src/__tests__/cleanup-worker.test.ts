/* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/no-non-null-assertion */
import { describe, it, expect, vi, beforeAll } from 'vitest'

// Mock all external dependencies before importing
const mocks = vi.hoisted(() => {
  const workerOn = vi.fn()
  const workerClose = vi.fn().mockResolvedValue(undefined)
  const connectionQuit = vi.fn().mockResolvedValue(undefined)
  const dbDisconnect = vi.fn().mockResolvedValue(undefined)
  const executeLogCleanup = vi.fn().mockResolvedValue(10)
  const scheduleLogCleanup = vi.fn().mockResolvedValue(undefined)

  let capturedProcessor: ((job: any) => Promise<any>) | null = null

  return {
    workerOn,
    workerClose,
    connectionQuit,
    dbDisconnect,
    executeLogCleanup,
    scheduleLogCleanup,
    getCapturedProcessor: () => capturedProcessor,
    setCapturedProcessor: (p: any) => {
      capturedProcessor = p
    },
  }
})

// Mock bullmq
vi.mock('bullmq', () => ({
  Worker: vi.fn().mockImplementation((name, processor) => {
    mocks.setCapturedProcessor(processor)
    return {
      on: mocks.workerOn,
      close: mocks.workerClose,
    }
  }),
}))

// Mock @avault/shared
vi.mock('@avault/shared', async (importOriginal) => {
  const actual = await importOriginal()
  return {
    ...(actual as object),
    PrismaClient: vi.fn().mockImplementation(() => ({
      $disconnect: mocks.dbDisconnect,
    })),
    createRedisConnection: vi.fn().mockReturnValue({
      quit: mocks.connectionQuit,
    }),
    logger: {
      info: vi.fn(),
      error: vi.fn(),
      warn: vi.fn(),
      debug: vi.fn(),
    },
  }
})

// Mock cleanup-jobs
vi.mock('../lib/cleanup-jobs', () => ({
  executeLogCleanup: mocks.executeLogCleanup,
  scheduleLogCleanup: mocks.scheduleLogCleanup,
}))

describe('cleanup-worker entry point', () => {
  // Import the module once for all tests
  beforeAll(async () => {
    await import('../cleanup-worker')
  })

  it('creates a BullMQ worker for cleanup-jobs queue', async () => {
    const bullmq = await import('bullmq')
    expect(bullmq.Worker).toHaveBeenCalledWith(
      'cleanup-jobs',
      expect.any(Function),
      expect.objectContaining({
        concurrency: 1,
      })
    )
  })

  it('registers worker event handlers', () => {
    expect(mocks.workerOn).toHaveBeenCalledWith('completed', expect.any(Function))
    expect(mocks.workerOn).toHaveBeenCalledWith('failed', expect.any(Function))
    expect(mocks.workerOn).toHaveBeenCalledWith('error', expect.any(Function))
  })

  it('schedules log cleanup on startup', () => {
    expect(mocks.scheduleLogCleanup).toHaveBeenCalled()
  })

  describe('job processing', () => {
    it('captures processor function', () => {
      const processor = mocks.getCapturedProcessor()
      expect(processor).toBeDefined()
      expect(typeof processor).toBe('function')
    })

    it('executes log cleanup for cleanup-old-logs job', async () => {
      const processor = mocks.getCapturedProcessor()
      expect(processor).toBeDefined()

      const mockJob = {
        id: 'job-1',
        name: 'cleanup-old-logs',
      }

      const result = await processor!(mockJob)
      expect(result).toEqual({ deletedCount: 10 })
      expect(mocks.executeLogCleanup).toHaveBeenCalled()
    })

    it('throws error for unknown job type', async () => {
      const processor = mocks.getCapturedProcessor()

      const mockJob = {
        id: 'job-1',
        name: 'unknown-job-type',
      }

      await expect(processor!(mockJob)).rejects.toThrow('Unknown job type: unknown-job-type')
    })
  })

  describe('worker event handlers', () => {
    it('handles completed event', () => {
      // Get the completed handler
      const completedCall = mocks.workerOn.mock.calls.find((call) => call[0] === 'completed')
      expect(completedCall).toBeDefined()

      const [, handler] = completedCall!
      // Should not throw when called
      expect(() => handler({ id: 'job-1' }, { deletedCount: 5 })).not.toThrow()
    })

    it('handles failed event', () => {
      const failedCall = mocks.workerOn.mock.calls.find((call) => call[0] === 'failed')
      expect(failedCall).toBeDefined()

      const [, handler] = failedCall!
      expect(() => handler({ id: 'job-1' }, new Error('Test error'))).not.toThrow()
    })

    it('handles error event', () => {
      const errorCall = mocks.workerOn.mock.calls.find((call) => call[0] === 'error')
      expect(errorCall).toBeDefined()

      const [, handler] = errorCall!
      expect(() => handler(new Error('Worker error'))).not.toThrow()
    })
  })
})
