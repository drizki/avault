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

import { publishSystemLog, systemLog } from '../lib/log-stream'

describe('log-stream', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.publish.mockResolvedValue(1)
  })

  describe('publishSystemLog', () => {
    it('publishes event to Redis', async () => {
      const event = {
        timestamp: '2024-01-15T10:00:00Z',
        level: 'info' as const,
        message: 'Test message',
        source: 'backend' as const,
      }

      await publishSystemLog(event)

      expect(mocks.publish).toHaveBeenCalledWith('logs:system', JSON.stringify(event))
    })

    it('includes metadata when provided', async () => {
      const event = {
        timestamp: '2024-01-15T10:00:00Z',
        level: 'error' as const,
        message: 'Error occurred',
        source: 'backend' as const,
        metadata: { errorCode: 'ERR001', stack: 'trace' },
      }

      await publishSystemLog(event)

      expect(mocks.publish).toHaveBeenCalledWith('logs:system', expect.stringContaining('ERR001'))
    })

    it('handles Redis errors gracefully', async () => {
      mocks.publish.mockRejectedValue(new Error('Redis down'))
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

      await publishSystemLog({
        timestamp: '2024-01-15T10:00:00Z',
        level: 'info',
        message: 'Test',
        source: 'backend',
      })

      expect(consoleSpy).toHaveBeenCalledWith('Failed to publish system log:', 'Redis down')
      consoleSpy.mockRestore()
    })

    it('handles non-Error thrown objects', async () => {
      mocks.publish.mockRejectedValue('string error')
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

      await publishSystemLog({
        timestamp: '2024-01-15T10:00:00Z',
        level: 'info',
        message: 'Test',
        source: 'backend',
      })

      expect(consoleSpy).toHaveBeenCalledWith('Failed to publish system log:', 'Unknown error')
      consoleSpy.mockRestore()
    })
  })

  describe('systemLog', () => {
    it('logs info messages', () => {
      systemLog.info('Info message', { key: 'value' })

      expect(mocks.publish).toHaveBeenCalledWith(
        'logs:system',
        expect.stringContaining('"level":"info"')
      )
      expect(mocks.publish).toHaveBeenCalledWith(
        'logs:system',
        expect.stringContaining('"message":"Info message"')
      )
    })

    it('logs error messages', () => {
      systemLog.error('Error message')

      expect(mocks.publish).toHaveBeenCalledWith(
        'logs:system',
        expect.stringContaining('"level":"error"')
      )
    })

    it('logs warn messages', () => {
      systemLog.warn('Warning message')

      expect(mocks.publish).toHaveBeenCalledWith(
        'logs:system',
        expect.stringContaining('"level":"warn"')
      )
    })

    it('logs debug messages', () => {
      systemLog.debug('Debug message')

      expect(mocks.publish).toHaveBeenCalledWith(
        'logs:system',
        expect.stringContaining('"level":"debug"')
      )
    })

    it('includes source as backend', () => {
      systemLog.info('Test')

      expect(mocks.publish).toHaveBeenCalledWith(
        'logs:system',
        expect.stringContaining('"source":"backend"')
      )
    })

    it('includes timestamp', () => {
      systemLog.info('Test')

      expect(mocks.publish).toHaveBeenCalledWith(
        'logs:system',
        expect.stringContaining('"timestamp":')
      )
    })
  })
})
