import { logger, getRedis } from '@avault/shared'

export interface SystemLogEvent {
  timestamp: string
  level: 'info' | 'error' | 'warn' | 'debug'
  message: string
  source: 'backend' | 'worker'
  metadata?: Record<string, unknown>
}

/**
 * Publish a system log to Redis for real-time streaming
 */
export async function publishSystemLog(event: SystemLogEvent): Promise<void> {
  try {
    const redis = getRedis()
    await redis.publish('logs:system', JSON.stringify(event))
  } catch (error: unknown) {
    // Don't use logger here to avoid infinite loop
    const message = error instanceof Error ? error.message : 'Unknown error'
    console.error('Failed to publish system log:', message)
  }
}

/**
 * Create a system logger that publishes to both console and Redis
 */
export const systemLog = {
  info: (message: string, metadata?: Record<string, unknown>) => {
    logger.info(metadata || {}, message)
    publishSystemLog({
      timestamp: new Date().toISOString(),
      level: 'info',
      message,
      source: 'backend',
      metadata,
    })
  },
  error: (message: string, metadata?: Record<string, unknown>) => {
    logger.error(metadata || {}, message)
    publishSystemLog({
      timestamp: new Date().toISOString(),
      level: 'error',
      message,
      source: 'backend',
      metadata,
    })
  },
  warn: (message: string, metadata?: Record<string, unknown>) => {
    logger.warn(metadata || {}, message)
    publishSystemLog({
      timestamp: new Date().toISOString(),
      level: 'warn',
      message,
      source: 'backend',
      metadata,
    })
  },
  debug: (message: string, metadata?: Record<string, unknown>) => {
    logger.debug(metadata || {}, message)
    publishSystemLog({
      timestamp: new Date().toISOString(),
      level: 'debug',
      message,
      source: 'backend',
      metadata,
    })
  },
}
