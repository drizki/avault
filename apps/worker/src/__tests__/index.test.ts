/* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/no-non-null-assertion */
import { describe, it, expect, vi, beforeAll } from 'vitest'

// Mock all external dependencies before importing
const mocks = vi.hoisted(() => {
  const workerOn = vi.fn()
  const workerClose = vi.fn().mockResolvedValue(undefined)
  const connectionQuit = vi.fn().mockResolvedValue(undefined)
  const dbDisconnect = vi.fn().mockResolvedValue(undefined)
  const redisSet = vi.fn().mockResolvedValue('OK')
  const redisPublish = vi.fn().mockResolvedValue(1)
  const initializeLogBuffer = vi.fn()
  const shutdownLogBuffer = vi.fn().mockResolvedValue(undefined)
  const executeBackupJob = vi.fn().mockResolvedValue({
    success: true,
    filesScanned: 10,
    filesUploaded: 10,
    filesFailed: 0,
    bytesUploaded: 1024,
    duration: 1000,
    remotePath: '/backup/test',
  })

  let capturedProcessor: ((job: any) => Promise<any>) | null = null

  return {
    workerOn,
    workerClose,
    connectionQuit,
    dbDisconnect,
    redisSet,
    redisPublish,
    initializeLogBuffer,
    shutdownLogBuffer,
    executeBackupJob,
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
  Job: vi.fn(),
}))

// Mock @avault/shared
vi.mock('@avault/shared', async (importOriginal) => {
  const actual = await importOriginal()
  return {
    ...(actual as object),
    PrismaClient: vi.fn().mockImplementation(() => ({
      $disconnect: mocks.dbDisconnect,
      backupJob: {
        findUnique: vi.fn().mockResolvedValue({ userId: 'user-123', name: 'Test Job' }),
        update: vi.fn().mockResolvedValue({}),
      },
      backupHistory: {
        update: vi.fn().mockResolvedValue({}),
      },
    })),
    createRedisConnection: vi.fn().mockReturnValue({
      quit: mocks.connectionQuit,
    }),
    getRedis: vi.fn().mockReturnValue({
      set: mocks.redisSet,
      publish: mocks.redisPublish,
    }),
    logger: {
      info: vi.fn(),
      error: vi.fn(),
      warn: vi.fn(),
      debug: vi.fn(),
    },
    BackupStatus: {
      RUNNING: 'RUNNING',
      SUCCESS: 'SUCCESS',
      FAILED: 'FAILED',
    },
  }
})

// Mock log-stream
vi.mock('../lib/log-stream', () => ({
  initializeLogBuffer: mocks.initializeLogBuffer,
  shutdownLogBuffer: mocks.shutdownLogBuffer,
  workerSystemLog: {
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
  },
}))

// Mock executor
vi.mock('../executor', () => ({
  executeBackupJob: mocks.executeBackupJob,
}))

describe('worker entry point', () => {
  // Import the module once for all tests
  beforeAll(async () => {
    await import('../index')
  })

  it('creates a BullMQ worker', async () => {
    const bullmq = await import('bullmq')
    expect(bullmq.Worker).toHaveBeenCalledWith(
      'backup-jobs',
      expect.any(Function),
      expect.any(Object)
    )
  })

  it('initializes log buffer', () => {
    expect(mocks.initializeLogBuffer).toHaveBeenCalled()
  })

  it('registers worker event handlers', () => {
    expect(mocks.workerOn).toHaveBeenCalledWith('completed', expect.any(Function))
    expect(mocks.workerOn).toHaveBeenCalledWith('failed', expect.any(Function))
    expect(mocks.workerOn).toHaveBeenCalledWith('error', expect.any(Function))
  })

  it('starts heartbeat', () => {
    // Heartbeat should set worker:heartbeat key
    expect(mocks.redisSet).toHaveBeenCalledWith('worker:heartbeat', expect.any(String), 'EX', 60)
  })

  describe('job processing', () => {
    it('captures processor function', () => {
      const processor = mocks.getCapturedProcessor()
      expect(processor).toBeDefined()
      expect(typeof processor).toBe('function')
    })

    it('executes backup job on processor call', async () => {
      const processor = mocks.getCapturedProcessor()
      expect(processor).toBeDefined()

      const mockJob = {
        data: {
          jobId: 'job-1',
          historyId: 'history-1',
          executionParams: {
            sourcePath: '/data',
            destinationId: 'dest-1',
          },
        },
        updateProgress: vi.fn(),
      }

      const result = await processor!(mockJob)
      expect(result.success).toBe(true)
      expect(mocks.executeBackupJob).toHaveBeenCalled()
    })
  })
})
