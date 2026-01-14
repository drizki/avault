import { Queue, QueueEvents, type JobsOptions } from 'bullmq'
import { createRedisConnection, logger, type BackupJobData } from '@avault/shared'

// BullMQ requires its own dedicated Redis connection for proper lifecycle management
const connection = createRedisConnection()

// Create BullMQ queue
export const backupQueue = new Queue<BackupJobData>('backup-jobs', {
  connection,
  defaultJobOptions: {
    attempts: 3, // Retry failed jobs up to 3 times
    backoff: {
      type: 'exponential',
      delay: 5000, // Start with 5 seconds, then 25s, 125s
    },
    removeOnComplete: 100, // Keep last 100 completed jobs
    removeOnFail: 500, // Keep last 500 failed jobs
  },
})

// Queue events for logging
const queueEvents = new QueueEvents('backup-jobs', { connection })

queueEvents.on('completed', ({ jobId }) => {
  logger.info({ jobId }, 'Job completed')
})

queueEvents.on('failed', ({ jobId, failedReason }) => {
  logger.error({ jobId, failedReason }, 'Job failed')
})

// Helper function to add a job to the queue
export async function queueBackupJob(data: BackupJobData, opts?: JobsOptions) {
  try {
    const job = await backupQueue.add('backup', data, opts)
    logger.info({ jobId: data.jobId, queueJobId: job.id }, 'Backup job added to queue')
    return job
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Unknown error'
    logger.error({ error: message, jobId: data.jobId }, 'Failed to queue backup job')
    throw error
  }
}

// Get queue statistics
export async function getQueueStats() {
  const [waiting, active, completed, failed, delayed] = await Promise.all([
    backupQueue.getWaitingCount(),
    backupQueue.getActiveCount(),
    backupQueue.getCompletedCount(),
    backupQueue.getFailedCount(),
    backupQueue.getDelayedCount(),
  ])

  return {
    waiting,
    active,
    completed,
    failed,
    delayed,
    total: waiting + active + completed + failed + delayed,
  }
}

// Cancel a job by its queue job ID
export async function cancelQueueJob(queueJobId: string) {
  try {
    const job = await backupQueue.getJob(queueJobId)
    if (!job) {
      return { success: false, error: 'Job not found in queue' }
    }

    const state = await job.getState()

    if (state === 'completed' || state === 'failed') {
      return { success: false, error: `Job already ${state}` }
    }

    if (state === 'active') {
      // For active jobs, we need to signal cancellation
      // The worker should check for this and stop
      await job.moveToFailed(new Error('Cancelled by user'), 'cancelled')
      logger.info({ queueJobId }, 'Active job cancelled')
    } else {
      // For waiting/delayed jobs, just remove them
      await job.remove()
      logger.info({ queueJobId }, 'Pending job removed')
    }

    return { success: true, state }
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Unknown error'
    logger.error({ error: message, queueJobId }, 'Failed to cancel job')
    return { success: false, error: message }
  }
}

// Find job in queue by historyId
export async function findQueueJobByHistoryId(historyId: string) {
  try {
    // Check active jobs
    const activeJobs = await backupQueue.getActive()
    for (const job of activeJobs) {
      if (job.data.historyId === historyId) {
        return job
      }
    }

    // Check waiting jobs
    const waitingJobs = await backupQueue.getWaiting()
    for (const job of waitingJobs) {
      if (job.data.historyId === historyId) {
        return job
      }
    }

    // Check delayed jobs
    const delayedJobs = await backupQueue.getDelayed()
    for (const job of delayedJobs) {
      if (job.data.historyId === historyId) {
        return job
      }
    }

    return null
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Unknown error'
    logger.error({ error: message, historyId }, 'Failed to find job')
    return null
  }
}

// Get active jobs with details
export async function getActiveJobs() {
  try {
    const jobs = await backupQueue.getActive()
    return jobs.map((job) => ({
      queueJobId: job.id,
      jobId: job.data.jobId,
      historyId: job.data.historyId,
      progress: job.progress,
      timestamp: job.timestamp,
    }))
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Unknown error'
    logger.error({ error: message }, 'Failed to get active jobs')
    return []
  }
}

// Cleanup stuck jobs (jobs that have been active too long)
export async function cleanupStuckJobs(maxAgeMinutes: number = 60) {
  try {
    const activeJobs = await backupQueue.getActive()
    const now = Date.now()
    const maxAge = maxAgeMinutes * 60 * 1000
    let cleanedCount = 0

    for (const job of activeJobs) {
      const jobAge = now - job.timestamp
      if (jobAge > maxAge) {
        await job.moveToFailed(new Error('Job stuck - cleaned up automatically'), 'stuck')
        logger.warn(
          { queueJobId: job.id, jobId: job.data.jobId, ageMinutes: Math.round(jobAge / 60000) },
          'Stuck job cleaned up'
        )
        cleanedCount++
      }
    }

    return { cleanedCount, checkedCount: activeJobs.length }
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Unknown error'
    logger.error({ error: message }, 'Failed to cleanup stuck jobs')
    return { cleanedCount: 0, checkedCount: 0, error: message }
  }
}

// Graceful shutdown
export async function closeQueue() {
  await queueEvents.close()
  await backupQueue.close()
  await connection.quit()
  logger.info('Queue connection closed')
}
