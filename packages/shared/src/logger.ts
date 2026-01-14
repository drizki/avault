import pino from 'pino'

const isDevelopment = process.env.NODE_ENV !== 'production'

/**
 * Shared logger instance using pino
 * In development: Pretty-printed, colorized output
 * In production: JSON format for log aggregation
 */
export const logger = pino({
  level: process.env.LOG_LEVEL || 'info',
  transport: isDevelopment
    ? {
        target: 'pino-pretty',
        options: {
          colorize: true,
          translateTime: 'HH:MM:ss Z',
          ignore: 'pid,hostname',
          messageFormat: '{msg}',
          minimumLevel: 'info',
        },
      }
    : undefined,
})

/**
 * Create a child logger with additional context
 */
export function createLogger(context: Record<string, unknown>) {
  return logger.child(context)
}

// Re-export pino types for convenience
export type { Logger } from 'pino'
