import { Queue } from 'bullmq'
import { logger, createRedisConnection, type PrismaClient } from '@avault/shared'

// BullMQ requires its own dedicated Redis connection
const connection = createRedisConnection()

// Create cleanup queue
export const cleanupQueue = new Queue('cleanup-jobs', {
  connection,
  defaultJobOptions: {
    removeOnComplete: 10,
    removeOnFail: 50,
  },
})

/**
 * Schedule daily log cleanup job
 * Runs every day at 2 AM to delete expired logs
 */
export async function scheduleLogCleanup() {
  try {
    await cleanupQueue.add(
      'cleanup-old-logs',
      {},
      {
        repeat: {
          pattern: '0 2 * * *', // Every day at 2 AM
        },
        jobId: 'log-cleanup-daily', // Prevent duplicate jobs
      }
    )

    logger.info('Scheduled daily log cleanup job (2 AM)')
  } catch (error: unknown) {
    logger.error(
      { error: error instanceof Error ? error.message : String(error) },
      'Failed to schedule log cleanup'
    )
    throw error
  }
}

/**
 * Execute log cleanup - delete expired logs from database
 * @param db - Prisma client instance
 * @returns Number of logs deleted
 */
export async function executeLogCleanup(db: PrismaClient): Promise<number> {
  try {
    const now = new Date()

    logger.info('Starting log cleanup job')

    // Delete expired logs
    const result = await db.logEntry.deleteMany({
      where: {
        expiresAt: {
          lte: now,
        },
      },
    })

    logger.info({ deletedCount: result.count }, 'Log cleanup completed')
    return result.count
  } catch (error: unknown) {
    logger.error(
      { error: error instanceof Error ? error.message : String(error) },
      'Log cleanup failed'
    )
    throw error
  }
}

/**
 * Close cleanup queue connection
 */
export async function closeCleanupQueue() {
  await cleanupQueue.close()
  await connection.quit()
  logger.info('Cleanup queue closed')
}
