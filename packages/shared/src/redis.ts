import Redis from 'ioredis'
import { logger } from './logger'

export interface RedisConfig {
  host: string
  port: number
  password?: string
  maxRetriesPerRequest?: number | null
}

// Singleton connections for different purposes
let defaultConnection: Redis | null = null
let subscriberConnection: Redis | null = null

function getRedisConfig(): RedisConfig {
  return {
    host: process.env.REDIS_HOST || 'localhost',
    port: parseInt(process.env.REDIS_PORT || '6379', 10),
    password: process.env.REDIS_PASSWORD || undefined,
    maxRetriesPerRequest: null,
  }
}

/**
 * Get the default Redis connection (shared singleton)
 * Use this for general Redis operations like caching, state storage, etc.
 */
export function getRedis(): Redis {
  if (!defaultConnection) {
    defaultConnection = new Redis(getRedisConfig())
    defaultConnection.on('error', (err) => {
      logger.error({ error: err.message }, 'Redis connection error')
    })
  }
  return defaultConnection
}

/**
 * Get a subscriber Redis connection (separate from default)
 * Redis pub/sub requires dedicated connections for subscribers
 */
export function getRedisSubscriber(): Redis {
  if (!subscriberConnection) {
    subscriberConnection = new Redis(getRedisConfig())
    subscriberConnection.on('error', (err) => {
      logger.error({ error: err.message }, 'Redis subscriber connection error')
    })
  }
  return subscriberConnection
}

/**
 * Create a new Redis connection (for cases where a dedicated connection is needed)
 * Caller is responsible for managing lifecycle
 */
export function createRedisConnection(config?: Partial<RedisConfig>): Redis {
  const finalConfig = { ...getRedisConfig(), ...config }
  return new Redis(finalConfig)
}

/**
 * Close all managed Redis connections
 * Call this during graceful shutdown
 */
export async function closeRedisConnections(): Promise<void> {
  const promises: Promise<'OK'>[] = []

  if (defaultConnection) {
    promises.push(defaultConnection.quit())
    defaultConnection = null
  }

  if (subscriberConnection) {
    promises.push(subscriberConnection.quit())
    subscriberConnection = null
  }

  await Promise.all(promises)
}

// Re-export Redis type for convenience
export { Redis }
