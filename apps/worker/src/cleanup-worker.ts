import 'dotenv/config'
import { Worker } from 'bullmq'
import { PrismaClient, createRedisConnection, logger } from '@avault/shared'
import { executeLogCleanup, scheduleLogCleanup } from './lib/cleanup-jobs'

// BullMQ requires its own dedicated Redis connection
const connection = createRedisConnection()

// Initialize Prisma
const db = new PrismaClient()

// Create cleanup worker
const cleanupWorker = new Worker(
  'cleanup-jobs',
  async (job) => {
    if (job.name === 'cleanup-old-logs') {
      logger.info({ jobId: job.id }, 'Executing cleanup-old-logs job')
      const deletedCount = await executeLogCleanup(db)
      return { deletedCount }
    }

    throw new Error(`Unknown job type: ${job.name}`)
  },
  {
    connection,
    concurrency: 1, // Run one cleanup job at a time
  }
)

// Worker event handlers
cleanupWorker.on('completed', (job, result) => {
  logger.info({ jobId: job.id, result }, 'Cleanup job completed successfully')
})

cleanupWorker.on('failed', (job, err) => {
  logger.error({ jobId: job?.id, error: err.message }, 'Cleanup job failed')
})

cleanupWorker.on('error', (err) => {
  logger.error({ error: err.message }, 'Cleanup worker error')
})

logger.info('Avault cleanup worker started')

// Schedule the daily cleanup job
scheduleLogCleanup()
  .then(() => {
    logger.info('Log cleanup scheduled (daily at 2 AM)')
  })
  .catch((err) => {
    logger.error({ error: err.message }, 'Failed to schedule log cleanup')
  })

// Graceful shutdown
const shutdown = async () => {
  logger.info('Shutting down cleanup worker gracefully...')
  await cleanupWorker.close()
  await connection.quit()
  await db.$disconnect()
  process.exit(0)
}

process.on('SIGINT', shutdown)
process.on('SIGTERM', shutdown)
