import { randomUUID } from 'crypto'
import { logger, type Redis } from '@avault/shared'

const LOCK_PREFIX = 'scheduler:lock:'

/**
 * Acquires a distributed lock for a job to prevent duplicate execution
 * Uses Redis SET NX EX for atomic lock acquisition
 *
 * @param redis - Redis client instance
 * @param jobId - Unique job identifier
 * @param ttl - Lock time-to-live in milliseconds (default: 60000ms / 60s)
 * @returns true if lock acquired, false if already locked
 */
export async function acquireJobLock(
  redis: Redis,
  jobId: string,
  ttl: number = 60000
): Promise<boolean> {
  try {
    const lockKey = `${LOCK_PREFIX}${jobId}`
    const lockValue = randomUUID() // Unique value to ensure only owner can release
    const ttlSeconds = Math.ceil(ttl / 1000)

    // SET NX EX: Set if Not eXists with EXpiration
    const result = await redis.set(lockKey, lockValue, 'EX', ttlSeconds, 'NX')

    if (result === 'OK') {
      logger.debug({ jobId, ttl: ttlSeconds }, 'Job lock acquired')
      return true
    }

    logger.debug({ jobId }, 'Job already locked by another instance')
    return false
  } catch (error: any) {
    logger.error(
      { error: error.message, jobId },
      'Error acquiring job lock'
    )
    return false
  }
}

/**
 * Releases a distributed lock for a job
 *
 * @param redis - Redis client instance
 * @param jobId - Unique job identifier
 */
export async function releaseJobLock(
  redis: Redis,
  jobId: string
): Promise<void> {
  try {
    const lockKey = `${LOCK_PREFIX}${jobId}`
    await redis.del(lockKey)
    logger.debug({ jobId }, 'Job lock released')
  } catch (error: any) {
    logger.error(
      { error: error.message, jobId },
      'Error releasing job lock'
    )
  }
}

/**
 * Checks if a job is currently locked
 *
 * @param redis - Redis client instance
 * @param jobId - Unique job identifier
 * @returns true if locked, false otherwise
 */
export async function isJobLocked(
  redis: Redis,
  jobId: string
): Promise<boolean> {
  try {
    const lockKey = `${LOCK_PREFIX}${jobId}`
    const exists = await redis.exists(lockKey)
    return exists === 1
  } catch (error: any) {
    logger.error(
      { error: error.message, jobId },
      'Error checking job lock'
    )
    return false
  }
}
