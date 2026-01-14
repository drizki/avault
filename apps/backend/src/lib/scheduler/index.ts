import { logger, type PrismaClient, type Redis, type Prisma } from '@avault/shared'

// Type for backup job with included relations
type BackupJobWithRelations = Prisma.BackupJobGetPayload<{
  include: { destination: true; credential: true }
}>
import { systemLog } from '../log-stream'
import { getNextRunTime } from './cron-utils'
import { acquireJobLock, releaseJobLock } from './job-lock'
import { queueBackupJob } from '../queue'

export class BackupScheduler {
  private intervalId: NodeJS.Timeout | null = null
  private isRunning: boolean = false
  private readonly checkInterval: number
  private readonly lockTTL: number

  constructor(
    private db: PrismaClient,
    private redis: Redis,
    checkInterval?: number
  ) {
    this.checkInterval = checkInterval || parseInt(process.env.SCHEDULER_CHECK_INTERVAL || '60000', 10)
    this.lockTTL = parseInt(process.env.SCHEDULER_LOCK_TTL || '60000', 10)
  }

  /**
   * Starts the scheduler service
   */
  async start(): Promise<void> {
    if (this.intervalId) {
      logger.warn('Scheduler already running')
      return
    }

    logger.info({ checkInterval: this.checkInterval }, 'Starting backup scheduler')

    // Recalculate schedules on startup
    await this.recalculateAllSchedules()

    // Start the scheduler interval
    this.intervalId = setInterval(() => {
      this.tick().catch((err) => {
        logger.error({ error: err.message }, 'Scheduler tick error')
      })
    }, this.checkInterval)

    // Run first tick immediately
    await this.tick()

    logger.info({ checkInterval: this.checkInterval }, 'Backup scheduler started')
  }

  /**
   * Stop the scheduler
   */
  async stop(): Promise<void> {
    if (this.intervalId) {
      clearInterval(this.intervalId)
      this.intervalId = null
    }
    logger.info('Backup scheduler stopped')
  }

  /**
   * Main tick function - checks for due jobs and queues them
   */
  private async tick(): Promise<void> {
    // Prevent overlapping executions
    if (this.isRunning) {
      logger.debug('Scheduler tick skipped - previous tick still running')
      return
    }

    this.isRunning = true

    try {
      const now = new Date()

      // Query all enabled jobs that are due to run
      const dueJobs = await this.db.backupJob.findMany({
        where: {
          enabled: true,
          OR: [
            { nextRunAt: null }, // Never run before
            { nextRunAt: { lte: now } }, // Due to run
          ],
        },
        include: {
          destination: true,
          credential: true,
        },
      })

      logger.info({ dueJobsCount: dueJobs.length }, 'Checking for due jobs')

      // Process each job
      for (const job of dueJobs) {
        await this.processJob(job)
      }
    } catch (error: unknown) {
      logger.error({ error: error instanceof Error ? error.message : String(error) }, 'Error in scheduler tick')
    } finally {
      this.isRunning = false
    }
  }

  /**
   * Process a single job: acquire lock, create history, queue, update timestamps
   * Uses transaction to ensure atomicity and prevent duplicate queue entries
   */
  private async processJob(job: BackupJobWithRelations): Promise<void> {
    try {
      // 1. Try to acquire distributed lock
      const lockAcquired = await acquireJobLock(this.redis, job.id, this.lockTTL)
      if (!lockAcquired) {
        logger.debug({ jobId: job.id }, 'Job already locked by another instance')
        return
      }

      try {
        // Use transaction to ensure atomicity
        const result = await this.db.$transaction(async (tx: Prisma.TransactionClient) => {
          // 2. Double-check job is still enabled and due (defensive programming)
          const currentJob = await tx.backupJob.findUnique({
            where: { id: job.id },
            select: { enabled: true, nextRunAt: true },
          })

          if (!currentJob || !currentJob.enabled) {
            logger.warn({ jobId: job.id }, 'Job disabled during processing, skipping')
            return null
          }

          // 3. Create backup history entry
          const history = await tx.backupHistory.create({
            data: {
              jobId: job.id,
              status: 'PENDING',
              triggerSource: 'SCHEDULED',
              startedAt: new Date(),
              filesScanned: 0,
              filesUploaded: 0,
              filesFailed: 0,
              bytesUploaded: BigInt(0),
            },
          })

          // 4. Calculate next run time
          const nextRunAt = getNextRunTime(job.schedule, new Date())

          // 5. Update job with new timestamps (atomic update)
          await tx.backupJob.update({
            where: { id: job.id },
            data: {
              nextRunAt,
              lastRunAt: new Date(),
            },
          })

          return { history, nextRunAt }
        })

        // If transaction succeeded, queue the job
        if (result) {
          const { history, nextRunAt } = result

          // 6. Queue the job for execution (outside transaction to avoid long locks)
          await queueBackupJob({
            jobId: job.id,
            historyId: history.id,
            executionParams: {
              jobId: job.id,
              historyId: history.id,
              sourcePath: job.sourcePath,
              destinationId: job.destinationId,
              credentialId: job.credentialId,
              namePattern: job.namePattern,
              retentionPolicy: {
                type: job.retentionType,
                count: job.retentionCount || undefined,
                days: job.retentionDays || undefined,
              },
            },
          })

          systemLog.info(`Scheduled job queued: ${job.name}`, {
            jobId: job.id,
            historyId: history.id,
            nextRunAt: nextRunAt?.toISOString(),
          })
        }
      } catch (error: unknown) {
        logger.error(
          { jobId: job.id, error: error instanceof Error ? error.message : String(error), stack: error instanceof Error ? error.stack : undefined },
          'Failed to process scheduled job'
        )
        throw error // Re-throw to ensure lock is released
      } finally {
        // Always release lock
        await releaseJobLock(this.redis, job.id)
      }
    } catch (error: unknown) {
      logger.error(
        { jobId: job.id, error: error instanceof Error ? error.message : String(error) },
        'Error processing scheduled job'
      )
    }
  }

  /**
   * Recalculates nextRunAt for all enabled jobs
   * Called on startup to handle missed runs and initialize schedules
   */
  async recalculateAllSchedules(): Promise<void> {
    try {
      const now = new Date()

      const jobs = await this.db.backupJob.findMany({
        where: {
          enabled: true,
          OR: [
            { nextRunAt: null },
            { nextRunAt: { lt: now } }, // Missed runs
          ],
        },
      })

      logger.info(
        { jobsToRecalculate: jobs.length },
        'Recalculating schedules for jobs'
      )

      let recalculatedCount = 0
      for (const job of jobs) {
        try {
          const nextRunAt = getNextRunTime(job.schedule, new Date())

          await this.db.backupJob.update({
            where: { id: job.id },
            data: { nextRunAt },
          })

          recalculatedCount++
          logger.info({ jobId: job.id, nextRunAt }, 'Recalculated job schedule')
        } catch (error: unknown) {
          logger.error(
            { jobId: job.id, error: error instanceof Error ? error.message : String(error) },
            'Failed to recalculate schedule'
          )
        }
      }

      logger.info({ recalculatedCount }, 'Recalculated schedules for all jobs')
    } catch (error: unknown) {
      logger.error({ error: error instanceof Error ? error.message : String(error) }, 'Error recalculating schedules')
    }
  }
}

// Singleton instance
let schedulerInstance: BackupScheduler | null = null

export function initScheduler(db: PrismaClient, redis: Redis): BackupScheduler {
  if (!schedulerInstance) {
    const checkInterval = parseInt(
      process.env.SCHEDULER_CHECK_INTERVAL || '60000',
      10
    )
    schedulerInstance = new BackupScheduler(db, redis, checkInterval)
  }
  return schedulerInstance
}

export function getScheduler(): BackupScheduler | null {
  return schedulerInstance
}
