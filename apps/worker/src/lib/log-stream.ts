import { logger, getRedis, type PrismaClient } from '@avault/shared'
import { LogBuffer } from './log-buffer'

// Use shared Redis connection
const redis = getRedis()

// Initialize LogBuffer (singleton)
let logBuffer: LogBuffer | null = null

export interface LogEvent {
  timestamp: string
  level: 'info' | 'error' | 'warn' | 'debug'
  message: string
  jobId?: string
  historyId?: string
  userId?: string
  source?: 'backend' | 'worker'
  metadata?: Record<string, unknown>
}

/**
 * Initialize the log buffer for database persistence
 */
export function initializeLogBuffer(db: PrismaClient): LogBuffer {
  if (!logBuffer) {
    logBuffer = new LogBuffer(db, {
      maxBufferSize: parseInt(process.env.LOG_BUFFER_SIZE || '50', 10),
      flushIntervalMs: parseInt(process.env.LOG_FLUSH_INTERVAL_MS || '2000', 10),
      retentionDays: parseInt(process.env.LOG_RETENTION_DAYS || '30', 10),
    })
    logger.info('Log buffer initialized')
  }
  return logBuffer
}

/**
 * Shutdown the log buffer and flush remaining logs
 */
export async function shutdownLogBuffer(): Promise<void> {
  if (logBuffer) {
    await logBuffer.shutdown()
    logBuffer = null
  }
}

/**
 * Publish log to both Redis (real-time) and Database (persistence)
 */
export async function publishLog(event: LogEvent) {
  try {
    const promises: Promise<unknown>[] = []

    // 1. Publish to Redis (real-time streaming)
    if (event.historyId) {
      const historyChannel = `logs:${event.historyId}`
      promises.push(redis.publish(historyChannel, JSON.stringify(event)))
    }

    if (event.userId) {
      const userChannel = `logs:user:${event.userId}`
      promises.push(redis.publish(userChannel, JSON.stringify(event)))
    }

    // 2. Write to database buffer (persistence)
    if (logBuffer && event.userId) {
      promises.push(
        logBuffer.add({
          historyId: event.historyId,
          userId: event.userId,
          jobId: event.jobId,
          timestamp: new Date(event.timestamp),
          level: event.level.toUpperCase() as 'DEBUG' | 'INFO' | 'WARN' | 'ERROR',
          message: event.message,
          metadata: event.metadata,
        })
      )
    }

    await Promise.all(promises)
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Unknown error'
    logger.error({ error: message }, 'Failed to publish log')
  }
}

export function createLogPublisher(historyId: string, userId: string) {
  return {
    info: (message: string, metadata?: Record<string, unknown>) => {
      publishLog({
        timestamp: new Date().toISOString(),
        level: 'info',
        message,
        historyId,
        userId,
        source: 'worker',
        metadata,
      })
    },
    error: (message: string, metadata?: Record<string, unknown>) => {
      publishLog({
        timestamp: new Date().toISOString(),
        level: 'error',
        message,
        historyId,
        userId,
        source: 'worker',
        metadata,
      })
    },
    warn: (message: string, metadata?: Record<string, unknown>) => {
      publishLog({
        timestamp: new Date().toISOString(),
        level: 'warn',
        message,
        historyId,
        userId,
        source: 'worker',
        metadata,
      })
    },
    debug: (message: string, metadata?: Record<string, unknown>) => {
      publishLog({
        timestamp: new Date().toISOString(),
        level: 'debug',
        message,
        historyId,
        userId,
        source: 'worker',
        metadata,
      })
    },
  }
}

/**
 * Publish a system-level log (not tied to a specific job)
 */
export async function publishSystemLog(
  level: LogEvent['level'],
  message: string,
  metadata?: Record<string, unknown>
) {
  try {
    const event = {
      timestamp: new Date().toISOString(),
      level,
      message,
      source: 'worker',
      metadata,
    }
    await redis.publish('logs:system', JSON.stringify(event))
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : 'Unknown error'
    logger.error({ error: msg }, 'Failed to publish system log')
  }
}

export const workerSystemLog = {
  info: (message: string, metadata?: Record<string, unknown>) =>
    publishSystemLog('info', message, metadata),
  error: (message: string, metadata?: Record<string, unknown>) =>
    publishSystemLog('error', message, metadata),
  warn: (message: string, metadata?: Record<string, unknown>) =>
    publishSystemLog('warn', message, metadata),
  debug: (message: string, metadata?: Record<string, unknown>) =>
    publishSystemLog('debug', message, metadata),
}
