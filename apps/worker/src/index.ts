import 'dotenv/config'
import { Worker, Job } from 'bullmq'
import { PrismaClient, BackupStatus, createRedisConnection, getRedis, logger } from '@avault/shared'
import type { BackupJobData } from '@avault/shared'
import { executeBackupJob } from './executor'
import { initializeLogBuffer, shutdownLogBuffer, workerSystemLog } from './lib/log-stream'

// Environment variables
const WORKER_CONCURRENCY = parseInt(process.env.WORKER_CONCURRENCY || '2', 10)

// BullMQ requires its own dedicated Redis connection for proper lifecycle management
const connection = createRedisConnection()

// Use shared Redis connection for publishing dashboard events
const dashboardRedis = getRedis()

// Initialize Prisma
const db = new PrismaClient()

// Initialize log buffer for persistent logging
initializeLogBuffer(db)

// Worker heartbeat - signals to dashboard that worker is alive
let heartbeatInterval: NodeJS.Timeout | null = null

function startHeartbeat() {
  // Send initial heartbeat
  dashboardRedis.set('worker:heartbeat', Date.now().toString(), 'EX', 60)

  // Send heartbeat every 30 seconds
  heartbeatInterval = setInterval(() => {
    dashboardRedis.set('worker:heartbeat', Date.now().toString(), 'EX', 60)
      .catch((err) => logger.error({ err }, 'Failed to send heartbeat'))
  }, 30000)

  logger.info('Worker heartbeat started')
}

// Publish dashboard events to Redis
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function publishDashboardEvent(userId: string, event: any) {
  try {
    await dashboardRedis.publish(`dashboard:user:${userId}`, JSON.stringify(event))
  } catch (err) {
    logger.error({ err }, 'Failed to publish dashboard event')
  }
}

// Create BullMQ worker
const worker = new Worker<BackupJobData>(
  'backup-jobs',
  async (job: Job<BackupJobData>) => {
    const { jobId, historyId, executionParams } = job.data

    logger.info({ jobId, historyId }, 'Starting backup job')
    workerSystemLog.info('Starting backup job', { jobId, historyId })

    try {
      // Fetch the job to get the userId
      const backupJob = await db.backupJob.findUnique({
        where: { id: jobId },
        select: { userId: true },
      })

      if (!backupJob) {
        throw new Error('Backup job not found')
      }

      // Update status to RUNNING
      await db.backupHistory.update({
        where: { id: historyId },
        data: { status: BackupStatus.RUNNING },
      })

      // Fetch job name for dashboard display
      const jobDetails = await db.backupJob.findUnique({
        where: { id: jobId },
        select: { name: true },
      })

      // Notify dashboard that job has started
      await publishDashboardEvent(backupJob.userId, {
        type: 'job:started',
        payload: {
          historyId,
          jobId,
          jobName: jobDetails?.name || 'Unknown Job',
          startedAt: new Date().toISOString(),
        },
      })

      // Execute the backup with userId for log streaming
      const result = await executeBackupJob(db, executionParams, backupJob.userId, (progress) => {
        // Report progress via job.updateProgress
        job.updateProgress(progress)

        // Also publish to dashboard SSE stream
        // Extract historyId from progress to avoid duplication
        const { historyId: _, ...progressData } = progress
        publishDashboardEvent(backupJob.userId, {
          type: 'job:progress',
          payload: {
            historyId,
            jobId,
            jobName: jobDetails?.name || 'Unknown Job',
            ...progressData,
          },
        })
      })

      // Update history with results
      await db.backupHistory.update({
        where: { id: historyId },
        data: {
          status: result.success ? BackupStatus.SUCCESS : BackupStatus.FAILED,
          completedAt: new Date(),
          filesScanned: result.filesScanned,
          filesUploaded: result.filesUploaded,
          filesFailed: result.filesFailed,
          bytesUploaded: BigInt(result.bytesUploaded),
          remotePath: result.remotePath,
          errorMessage: result.error,
        },
      })

      // Update job's lastRunAt
      await db.backupJob.update({
        where: { id: jobId },
        data: { lastRunAt: new Date() },
      })

      // Notify dashboard that job has completed
      await publishDashboardEvent(backupJob.userId, {
        type: 'job:completed',
        payload: {
          historyId,
          jobId,
          jobName: jobDetails?.name || 'Unknown Job',
          status: result.success ? 'SUCCESS' : 'FAILED',
          filesUploaded: result.filesUploaded,
          bytesUploaded: result.bytesUploaded,
          duration: result.duration,
        },
      })

      const statusText = result.success ? 'completed successfully' : 'completed with errors'
      workerSystemLog.info(`Backup job ${statusText}`, {
        jobId,
        filesUploaded: result.filesUploaded,
        filesFailed: result.filesFailed,
      })
      logger.info({ jobId }, 'Backup job completed successfully')

      return result
    } catch (error: unknown) {
      workerSystemLog.error(`Backup job failed: ${error instanceof Error ? error.message : String(error)}`, { jobId })
      logger.error({ jobId, error }, 'Backup job failed')

      await db.backupHistory.update({
        where: { id: historyId },
        data: {
          status: BackupStatus.FAILED,
          completedAt: new Date(),
          errorMessage: error instanceof Error ? error.message : String(error),
          errorStack: error instanceof Error ? error.stack : undefined,
        },
      })

      throw error
    }
  },
  {
    connection,
    concurrency: WORKER_CONCURRENCY,
    removeOnComplete: { count: 100 }, // Keep last 100 completed jobs
    removeOnFail: { count: 500 }, // Keep last 500 failed jobs
  }
)

// Worker event listeners
worker.on('completed', (job) => {
  logger.info({ jobId: job.id }, 'Job completed')
})

worker.on('failed', (job, err) => {
  logger.error({ jobId: job?.id, err }, 'Job failed')
})

worker.on('error', (err) => {
  logger.error({ err }, 'Worker error')
})

// Start heartbeat for dashboard health monitoring
startHeartbeat()

workerSystemLog.info(`Worker started with concurrency: ${WORKER_CONCURRENCY}`)
logger.info({ concurrency: WORKER_CONCURRENCY }, 'Avault worker started')

// Graceful shutdown
const shutdown = async () => {
  logger.info('Shutting down worker gracefully...')

  // Stop heartbeat
  if (heartbeatInterval) {
    clearInterval(heartbeatInterval)
  }

  // Flush remaining logs to database
  await shutdownLogBuffer()

  await worker.close()
  await connection.quit()
  // Note: dashboardRedis is shared, don't close it directly
  await db.$disconnect()
  process.exit(0)
}

process.on('SIGINT', shutdown)
process.on('SIGTERM', shutdown)
