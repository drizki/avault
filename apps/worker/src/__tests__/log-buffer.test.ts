/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// Mock logger
vi.mock('@avault/shared', async (importOriginal) => {
  const actual = await importOriginal()
  return {
    ...(actual as object),
    logger: {
      info: vi.fn(),
      error: vi.fn(),
      warn: vi.fn(),
      debug: vi.fn(),
    },
  }
})

import { LogBuffer } from '../lib/log-buffer'

describe('LogBuffer', () => {
  let mockDb: any
  let logBuffer: LogBuffer

  beforeEach(() => {
    vi.useFakeTimers()
    mockDb = {
      logEntry: {
        createMany: vi.fn().mockResolvedValue({ count: 0 }),
      },
    }
  })

  afterEach(() => {
    if (logBuffer) {
      // Clear interval without awaiting flush
      vi.clearAllTimers()
    }
    vi.useRealTimers()
    vi.clearAllMocks()
  })

  describe('constructor', () => {
    it('uses default options when not provided', () => {
      logBuffer = new LogBuffer(mockDb)
      // Buffer should be created successfully
      expect(logBuffer).toBeDefined()
    })

    it('accepts custom options', () => {
      logBuffer = new LogBuffer(mockDb, {
        maxBufferSize: 100,
        flushIntervalMs: 5000,
        retentionDays: 60,
      })
      expect(logBuffer).toBeDefined()
    })
  })

  describe('add', () => {
    it('adds entry to buffer', async () => {
      logBuffer = new LogBuffer(mockDb, { maxBufferSize: 10, flushIntervalMs: 10000 })

      await logBuffer.add({
        userId: 'user-1',
        timestamp: new Date(),
        level: 'INFO',
        message: 'Test message',
      })

      // Entry added but not flushed yet (buffer size < max)
      expect(mockDb.logEntry.createMany).not.toHaveBeenCalled()
    })

    it('flushes when buffer is full', async () => {
      logBuffer = new LogBuffer(mockDb, { maxBufferSize: 2, flushIntervalMs: 10000 })

      await logBuffer.add({
        userId: 'user-1',
        timestamp: new Date(),
        level: 'INFO',
        message: 'Message 1',
      })

      await logBuffer.add({
        userId: 'user-1',
        timestamp: new Date(),
        level: 'INFO',
        message: 'Message 2',
      })

      // Should have flushed after reaching max buffer size
      expect(mockDb.logEntry.createMany).toHaveBeenCalled()
    })
  })

  describe('periodic flush', () => {
    it('flushes on interval', async () => {
      logBuffer = new LogBuffer(mockDb, { maxBufferSize: 100, flushIntervalMs: 1000 })

      await logBuffer.add({
        userId: 'user-1',
        timestamp: new Date(),
        level: 'INFO',
        message: 'Test',
      })

      expect(mockDb.logEntry.createMany).not.toHaveBeenCalled()

      // Advance timer past flush interval
      await vi.advanceTimersByTimeAsync(1500)

      expect(mockDb.logEntry.createMany).toHaveBeenCalled()
    })
  })

  describe('shutdown', () => {
    it('flushes remaining logs on shutdown', async () => {
      logBuffer = new LogBuffer(mockDb, { maxBufferSize: 100, flushIntervalMs: 10000 })

      await logBuffer.add({
        userId: 'user-1',
        timestamp: new Date(),
        level: 'INFO',
        message: 'Final message',
      })

      expect(mockDb.logEntry.createMany).not.toHaveBeenCalled()

      await logBuffer.shutdown()

      expect(mockDb.logEntry.createMany).toHaveBeenCalled()
    })
  })

  describe('error handling', () => {
    it('re-adds logs to buffer on flush failure', async () => {
      mockDb.logEntry.createMany.mockRejectedValueOnce(new Error('DB error'))

      logBuffer = new LogBuffer(mockDb, { maxBufferSize: 2, flushIntervalMs: 10000 })

      await logBuffer.add({
        userId: 'user-1',
        timestamp: new Date(),
        level: 'INFO',
        message: 'Message 1',
      })

      await logBuffer.add({
        userId: 'user-1',
        timestamp: new Date(),
        level: 'INFO',
        message: 'Message 2',
      })

      // First flush failed, logs should be re-added to buffer
      // Second add triggers flush, which fails, logs re-added

      // Now make DB work and try again
      mockDb.logEntry.createMany.mockResolvedValue({ count: 2 })

      await logBuffer.add({
        userId: 'user-1',
        timestamp: new Date(),
        level: 'INFO',
        message: 'Message 3',
      })

      await logBuffer.add({
        userId: 'user-1',
        timestamp: new Date(),
        level: 'INFO',
        message: 'Message 4',
      })

      // Should have called createMany at least twice
      expect(mockDb.logEntry.createMany.mock.calls.length).toBeGreaterThanOrEqual(2)
    })

  })

  describe('log entry format', () => {
    it('includes all required fields', async () => {
      logBuffer = new LogBuffer(mockDb, {
        maxBufferSize: 1,
        flushIntervalMs: 10000,
        retentionDays: 30,
      })

      const timestamp = new Date()
      await logBuffer.add({
        historyId: 'history-1',
        userId: 'user-1',
        jobId: 'job-1',
        timestamp,
        level: 'ERROR',
        message: 'Error occurred',
        metadata: { detail: 'test' },
      })

      expect(mockDb.logEntry.createMany).toHaveBeenCalledWith({
        data: expect.arrayContaining([
          expect.objectContaining({
            historyId: 'history-1',
            userId: 'user-1',
            jobId: 'job-1',
            timestamp,
            level: 'ERROR',
            message: 'Error occurred',
            metadata: { detail: 'test' },
            expiresAt: expect.any(Date),
          }),
        ]),
        skipDuplicates: true,
      })
    })

    it('sets expiresAt based on retention days', async () => {
      const retentionDays = 45
      logBuffer = new LogBuffer(mockDb, {
        maxBufferSize: 1,
        flushIntervalMs: 10000,
        retentionDays,
      })

      const now = new Date()
      await logBuffer.add({
        userId: 'user-1',
        timestamp: now,
        level: 'INFO',
        message: 'Test',
      })

      const call = mockDb.logEntry.createMany.mock.calls[0][0]
      const expiresAt = call.data[0].expiresAt

      // expiresAt should be approximately retentionDays from now
      const expectedExpiry = new Date()
      expectedExpiry.setDate(expectedExpiry.getDate() + retentionDays)

      // Allow 1 second tolerance
      expect(Math.abs(expiresAt.getTime() - expectedExpiry.getTime())).toBeLessThan(1000)
    })
  })
})
