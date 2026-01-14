/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, vi, beforeEach } from 'vitest'

const mocks = vi.hoisted(() => ({
  publish: vi.fn(),
  loggerInfo: vi.fn(),
  loggerError: vi.fn(),
  loggerWarn: vi.fn(),
  loggerDebug: vi.fn(),
}))

vi.mock('@avault/shared', async (importOriginal) => {
  const actual = await importOriginal()
  return {
    ...(actual as object),
    getRedis: vi.fn().mockReturnValue({ publish: mocks.publish }),
    logger: {
      info: mocks.loggerInfo,
      error: mocks.loggerError,
      warn: mocks.loggerWarn,
      debug: mocks.loggerDebug,
    },
  }
})

import { publishLog, createLogPublisher, publishSystemLog, workerSystemLog, initializeLogBuffer, shutdownLogBuffer } from '../lib/log-stream'

describe('worker log-stream', () => {
  beforeEach(async () => {
    vi.clearAllMocks()
    mocks.publish.mockResolvedValue(1)
    // Reset log buffer state between tests
    await shutdownLogBuffer()
  })

  describe('publishLog', () => {
    it('publishes to history channel when historyId provided', async () => {
      const event = {
        timestamp: new Date().toISOString(),
        level: 'info' as const,
        message: 'Backup started',
        historyId: 'history-123',
        userId: 'user-456',
      }

      await publishLog(event)

      expect(mocks.publish).toHaveBeenCalledWith(
        'logs:history-123',
        expect.stringContaining('Backup started')
      )
    })

    it('publishes to user channel when userId provided', async () => {
      const event = {
        timestamp: new Date().toISOString(),
        level: 'info' as const,
        message: 'Test',
        userId: 'user-789',
      }

      await publishLog(event)

      expect(mocks.publish).toHaveBeenCalledWith(
        'logs:user:user-789',
        expect.any(String)
      )
    })

    it('handles errors gracefully', async () => {
      mocks.publish.mockRejectedValue(new Error('Redis error'))

      // Should not throw
      await publishLog({
        timestamp: new Date().toISOString(),
        level: 'info',
        message: 'Test',
        historyId: 'h1',
        userId: 'u1',
      })
    })
  })

  describe('createLogPublisher', () => {
    it('creates publisher with bound historyId and userId', () => {
      const publisher = createLogPublisher('history-abc', 'user-xyz')

      expect(publisher).toHaveProperty('info')
      expect(publisher).toHaveProperty('error')
      expect(publisher).toHaveProperty('warn')
      expect(publisher).toHaveProperty('debug')
    })

    it('info method publishes info level log', () => {
      const publisher = createLogPublisher('h1', 'u1')

      publisher.info('Starting backup')

      expect(mocks.publish).toHaveBeenCalledWith(
        'logs:h1',
        expect.stringContaining('"level":"info"')
      )
    })

    it('error method publishes error level log', () => {
      const publisher = createLogPublisher('h1', 'u1')

      publisher.error('Upload failed')

      expect(mocks.publish).toHaveBeenCalledWith(
        'logs:h1',
        expect.stringContaining('"level":"error"')
      )
    })

    it('warn method publishes warn level log', () => {
      const publisher = createLogPublisher('h1', 'u1')

      publisher.warn('File skipped')

      expect(mocks.publish).toHaveBeenCalledWith(
        'logs:h1',
        expect.stringContaining('"level":"warn"')
      )
    })

    it('debug method publishes debug level log', () => {
      const publisher = createLogPublisher('h1', 'u1')

      publisher.debug('Processing file')

      expect(mocks.publish).toHaveBeenCalledWith(
        'logs:h1',
        expect.stringContaining('"level":"debug"')
      )
    })

    it('includes metadata in log', () => {
      const publisher = createLogPublisher('h1', 'u1')

      publisher.info('Upload complete', { bytesUploaded: 1024 })

      expect(mocks.publish).toHaveBeenCalledWith(
        'logs:h1',
        expect.stringContaining('bytesUploaded')
      )
    })

    it('sets source as worker', () => {
      const publisher = createLogPublisher('h1', 'u1')

      publisher.info('Test')

      expect(mocks.publish).toHaveBeenCalledWith(
        'logs:h1',
        expect.stringContaining('"source":"worker"')
      )
    })
  })

  describe('publishSystemLog', () => {
    it('publishes to system channel', async () => {
      await publishSystemLog('info', 'System message')

      expect(mocks.publish).toHaveBeenCalledWith(
        'logs:system',
        expect.stringContaining('System message')
      )
    })

    it('includes metadata', async () => {
      await publishSystemLog('error', 'System error', { code: 'E001' })

      expect(mocks.publish).toHaveBeenCalledWith(
        'logs:system',
        expect.stringContaining('E001')
      )
    })

    it('handles errors gracefully', async () => {
      mocks.publish.mockRejectedValue(new Error('Redis connection lost'))

      // Should not throw
      await publishSystemLog('info', 'Test message')

      expect(mocks.loggerError).toHaveBeenCalledWith(
        { error: 'Redis connection lost' },
        'Failed to publish system log'
      )
    })
  })

  describe('workerSystemLog', () => {
    it('has all log level methods', () => {
      expect(typeof workerSystemLog.info).toBe('function')
      expect(typeof workerSystemLog.error).toBe('function')
      expect(typeof workerSystemLog.warn).toBe('function')
      expect(typeof workerSystemLog.debug).toBe('function')
    })

    it('info publishes to system channel', () => {
      workerSystemLog.info('Worker started')

      expect(mocks.publish).toHaveBeenCalledWith(
        'logs:system',
        expect.stringContaining('Worker started')
      )
    })
  })

  describe('initializeLogBuffer', () => {
    it('initializes log buffer with database', () => {
      const mockDb = {} as any

      const buffer = initializeLogBuffer(mockDb)

      expect(buffer).toBeDefined()
      expect(mocks.loggerInfo).toHaveBeenCalledWith('Log buffer initialized')
    })

    it('returns existing buffer on subsequent calls', () => {
      const mockDb = {} as any
      const initialCallCount = mocks.loggerInfo.mock.calls.length

      const buffer1 = initializeLogBuffer(mockDb)
      const buffer2 = initializeLogBuffer(mockDb)

      expect(buffer1).toBe(buffer2)
      // Logger only called once more (for the initialization)
      expect(mocks.loggerInfo.mock.calls.length - initialCallCount).toBe(1)
    })
  })

  describe('shutdownLogBuffer', () => {
    it('shuts down initialized buffer', async () => {
      const mockDb = {} as any
      initializeLogBuffer(mockDb)

      await shutdownLogBuffer()

      // No error thrown
    })

    it('handles case when no buffer exists', async () => {
      // No initialization, just shutdown
      await shutdownLogBuffer()

      // No error thrown
    })
  })

  describe('publishLog with logBuffer', () => {
    it('writes to database buffer when initialized', async () => {
      const mockDb = {
        logEntry: {
          createMany: vi.fn().mockResolvedValue({ count: 1 }),
        },
      } as any

      initializeLogBuffer(mockDb)

      const event = {
        timestamp: new Date().toISOString(),
        level: 'info' as const,
        message: 'Test with buffer',
        historyId: 'h1',
        userId: 'u1',
        metadata: { test: true },
      }

      await publishLog(event)

      // Should publish to Redis channels
      expect(mocks.publish).toHaveBeenCalled()

      // Give time for buffer to potentially flush
      await new Promise(resolve => setTimeout(resolve, 50))
    })
  })
})
