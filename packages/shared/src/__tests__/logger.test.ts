import { describe, it, expect } from 'vitest'
import { logger, createLogger } from '../logger'

describe('logger', () => {
  it('exports a logger instance', () => {
    expect(logger).toBeDefined()
    expect(typeof logger.info).toBe('function')
    expect(typeof logger.error).toBe('function')
    expect(typeof logger.warn).toBe('function')
    expect(typeof logger.debug).toBe('function')
  })

  describe('createLogger', () => {
    it('creates a child logger with context', () => {
      const childLogger = createLogger({ service: 'test', requestId: '123' })

      expect(childLogger).toBeDefined()
      expect(typeof childLogger.info).toBe('function')
      expect(typeof childLogger.error).toBe('function')
    })

    it('inherits parent logger methods', () => {
      const childLogger = createLogger({ module: 'auth' })

      // Child logger should have all the same methods as parent
      expect(typeof childLogger.info).toBe('function')
      expect(typeof childLogger.warn).toBe('function')
      expect(typeof childLogger.debug).toBe('function')
      expect(typeof childLogger.trace).toBe('function')
    })
  })
})
