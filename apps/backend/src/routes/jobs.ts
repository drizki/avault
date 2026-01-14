import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { CreateBackupJobSchema, UpdateBackupJobSchema, BackupStatus, TriggerSource, logger } from '@avault/shared'
import { requireAuth } from '../middleware/auth'
import type { Env } from '../index'
import { queueBackupJob, findQueueJobByHistoryId, cancelQueueJob, cleanupStuckJobs, getActiveJobs } from '../lib/queue'
import { systemLog } from '../lib/log-stream'
import { getNextRunTime } from '../lib/scheduler/cron-utils'

const jobs = new Hono<Env>()

// Apply authentication to all routes
jobs.use('*', requireAuth)

// List all backup jobs (filtered by user)
jobs.get('/', async (c) => {
  const db = c.get('db')
  const userId = c.get('userId')!

  const allJobs = await db.backupJob.findMany({
    where: { userId },
    include: {
      destination: {
        select: {
          id: true,
          name: true,
          provider: true,
        },
      },
      credential: {
        select: {
          id: true,
          name: true,
          provider: true,
        },
      },
      _count: {
        select: { history: true },
      },
    },
    orderBy: { createdAt: 'desc' },
  })

  return c.json({ success: true, data: allJobs })
})

// ============================================
// STATIC ROUTES (must come before /:id routes)
// ============================================

// Get active queue jobs (for debugging/monitoring)
jobs.get('/queue/active', async (c) => {
  try {
    const activeJobs = await getActiveJobs()
    return c.json({ success: true, data: activeJobs })
  } catch (error: any) {
    return c.json({
      success: false,
      error: 'Failed to get active jobs',
      details: error.message,
    }, 500)
  }
})

// Cleanup stuck jobs (admin action)
jobs.post('/queue/cleanup', async (c) => {
  try {
    const maxAgeMinutes = parseInt(c.req.query('maxAge') || '60', 10)
    const result = await cleanupStuckJobs(maxAgeMinutes)

    return c.json({
      success: true,
      data: result,
      message: `Cleaned up ${result.cleanedCount} stuck jobs out of ${result.checkedCount} active jobs`,
    })
  } catch (error: any) {
    return c.json({
      success: false,
      error: 'Failed to cleanup stuck jobs',
      details: error.message,
    }, 500)
  }
})

// Cancel a running or pending backup job
jobs.post('/history/:historyId/cancel', async (c) => {
  const db = c.get('db')
  const userId = c.get('userId')!
  const historyId = c.req.param('historyId')

  try {
    // Find the history entry and verify ownership
    const history = await db.backupHistory.findFirst({
      where: {
        id: historyId,
        job: { userId },
      },
      include: { job: true },
    })

    if (!history) {
      return c.json({
        success: false,
        error: 'History entry not found',
      }, 404)
    }

    // Check if job is in a cancellable state
    if (history.status === 'SUCCESS' || history.status === 'FAILED' || history.status === 'CANCELLED') {
      return c.json({
        success: false,
        error: `Job already ${history.status.toLowerCase()}`,
      }, 400)
    }

    // Find the job in the queue by historyId
    const queueJob = await findQueueJobByHistoryId(historyId)

    if (queueJob) {
      // Cancel the queue job
      const result = await cancelQueueJob(queueJob.id!)
      if (!result.success) {
        logger.warn({ historyId, error: result.error }, 'Failed to cancel queue job')
      }
    }

    // Update the history status to CANCELLED
    await db.backupHistory.update({
      where: { id: historyId },
      data: {
        status: 'CANCELLED',
        completedAt: new Date(),
        errorMessage: 'Cancelled by user',
      },
    })

    logger.info({ historyId, jobId: history.jobId }, 'Job cancelled by user')

    return c.json({
      success: true,
      message: 'Job cancelled',
    })
  } catch (error: any) {
    logger.error({ error: error.message, historyId }, 'Failed to cancel job')
    return c.json({
      success: false,
      error: 'Failed to cancel job',
      details: error.message,
    }, 500)
  }
})

// ============================================
// DYNAMIC ROUTES (/:id pattern)
// ============================================

// Create backup job (attach userId)
jobs.post('/', zValidator('json', CreateBackupJobSchema), async (c) => {
  const db = c.get('db')
  const userId = c.get('userId')!
  const data = c.req.valid('json')

  try {
    // Calculate initial nextRunAt if job is enabled
    const nextRunAt = data.enabled !== false ? getNextRunTime(data.schedule) : null

    const job = await db.backupJob.create({
      data: {
        ...data,
        userId,
        nextRunAt,
      },
      include: {
        destination: true,
        credential: true,
      },
    })

    logger.info({
      jobId: job.id,
      schedule: job.schedule,
      nextRunAt: job.nextRunAt,
      enabled: job.enabled,
    }, 'Backup job created with schedule')

    return c.json({ success: true, data: job }, 201)
  } catch (error: any) {
    return c.json({
      success: false,
      error: 'Failed to create backup job',
      details: error.message,
    }, 400)
  }
})

// Get single job (user's own only)
jobs.get('/:id', async (c) => {
  const db = c.get('db')
  const userId = c.get('userId')!
  const id = c.req.param('id')

  const job = await db.backupJob.findFirst({
    where: { id, userId },
    include: {
      destination: true,
      credential: true,
      history: {
        orderBy: { startedAt: 'desc' },
        take: 10,
      },
    },
  })

  if (!job) {
    return c.json({ success: false, error: 'Job not found' }, 404)
  }

  return c.json({ success: true, data: job })
})

// Update job (user's own only)
jobs.patch('/:id', zValidator('json', UpdateBackupJobSchema), async (c) => {
  const db = c.get('db')
  const userId = c.get('userId')!
  const id = c.req.param('id')
  const data = c.req.valid('json')

  try {
    // First check if job exists and belongs to user
    const existing = await db.backupJob.findFirst({
      where: { id, userId },
    })

    if (!existing) {
      return c.json({
        success: false,
        error: 'Job not found',
      }, 404)
    }

    // Recalculate nextRunAt if schedule or enabled status changed
    let nextRunAt: Date | null | undefined = undefined
    if (data.schedule !== undefined || data.enabled !== undefined) {
      const newSchedule = data.schedule || existing.schedule
      const newEnabled = data.enabled !== undefined ? data.enabled : existing.enabled

      // Calculate nextRunAt if enabled, otherwise set to null
      nextRunAt = newEnabled ? getNextRunTime(newSchedule) : null
    }

    const job = await db.backupJob.update({
      where: { id },
      data: {
        ...data,
        ...(nextRunAt !== undefined && { nextRunAt }),
      },
      include: {
        destination: true,
        credential: true,
      },
    })

    logger.info({
      jobId: job.id,
      scheduleChanged: !!data.schedule,
      enabledChanged: data.enabled !== undefined,
      nextRunAt: job.nextRunAt,
    }, 'Backup job updated')

    return c.json({ success: true, data: job })
  } catch (error) {
    return c.json({
      success: false,
      error: 'Failed to update job',
    }, 400)
  }
})

// Delete job (user's own only)
jobs.delete('/:id', async (c) => {
  const db = c.get('db')
  const userId = c.get('userId')!
  const id = c.req.param('id')

  try {
    // First check if job exists and belongs to user
    const existing = await db.backupJob.findFirst({
      where: { id, userId },
    })

    if (!existing) {
      return c.json({
        success: false,
        error: 'Job not found',
      }, 404)
    }

    await db.backupJob.delete({ where: { id } })

    return c.json({
      success: true,
      message: 'Job deleted successfully',
    })
  } catch (error) {
    return c.json({
      success: false,
      error: 'Failed to delete job',
    }, 500)
  }
})

// Trigger immediate job run (user's own only)
jobs.post('/:id/run', async (c) => {
  const db = c.get('db')
  const userId = c.get('userId')!
  const id = c.req.param('id')

  try {
    // First check if job exists and belongs to user
    const job = await db.backupJob.findFirst({
      where: { id, userId },
      include: {
        destination: true,
        credential: true,
      },
    })

    if (!job) {
      return c.json({
        success: false,
        error: 'Job not found',
      }, 404)
    }

    // Create a backup history entry
    const history = await db.backupHistory.create({
      data: {
        jobId: job.id,
        status: BackupStatus.PENDING,
        triggerSource: TriggerSource.MANUAL,
        startedAt: new Date(),
        filesScanned: 0,
        filesUploaded: 0,
        filesFailed: 0,
        bytesUploaded: BigInt(0),
      },
    })

    systemLog.info(`Manual job triggered: ${job.name}`, { jobId: job.id, historyId: history.id })

    // Queue the job
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

    return c.json({
      success: true,
      data: {
        jobId: job.id,
        historyId: history.id,
        message: 'Job queued for execution',
      },
    })
  } catch (error: any) {
    logger.error({ error: error.message, jobId: id }, 'Failed to queue job')
    return c.json({
      success: false,
      error: 'Failed to queue job',
      details: error.message,
    }, 500)
  }
})

// Get job history (user's own job only)
jobs.get('/:id/history', async (c) => {
  const db = c.get('db')
  const userId = c.get('userId')!
  const id = c.req.param('id')

  // First check if job exists and belongs to user
  const job = await db.backupJob.findFirst({
    where: { id, userId },
  })

  if (!job) {
    return c.json({
      success: false,
      error: 'Job not found',
    }, 404)
  }

  const history = await db.backupHistory.findMany({
    where: { jobId: id },
    orderBy: { startedAt: 'desc' },
    take: 50,
  })

  return c.json({ success: true, data: history })
})

export default jobs
