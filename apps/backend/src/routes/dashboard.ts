import { Hono } from 'hono'
import { stream } from 'hono/streaming'
import { logger, Redis } from '@avault/shared'
import { verifyToken } from '../lib/auth/jwt'
import { requireAuth } from '../middleware/auth'
import { getQueueStats, backupQueue } from '../lib/queue'
import type { Env } from '../index'

const REDIS_HOST = process.env.REDIS_HOST || 'localhost'
const REDIS_PORT = parseInt(process.env.REDIS_PORT || '6379', 10)
const REDIS_PASSWORD = process.env.REDIS_PASSWORD || ''

const dashboard = new Hono<Env>()

// Apply authentication to all routes except SSE stream
dashboard.use('*', async (c, next) => {
  // Skip auth middleware for SSE endpoint (uses token query param)
  if (c.req.path.endsWith('/stream')) {
    return next()
  }
  return requireAuth(c, next)
})

// Get aggregated dashboard statistics
dashboard.get('/stats', async (c) => {
  const db = c.get('db')
  // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
  const userId = c.get('userId')!

  try {
    const now = new Date()
    const last24h = new Date(now.getTime() - 24 * 60 * 60 * 1000)
    const last7d = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000)

    // Fetch all data in parallel
    const [jobsTotal, jobsEnabled, historyLast24h, historyLast7d, queueStats, bytesToday] =
      await Promise.all([
        // Total jobs
        db.backupJob.count({ where: { userId } }),
        // Enabled jobs
        db.backupJob.count({ where: { userId, enabled: true } }),
        // History last 24h grouped by status
        db.backupHistory.groupBy({
          by: ['status'],
          where: {
            job: { userId },
            startedAt: { gte: last24h },
          },
          _count: { id: true },
        }),
        // History last 7d grouped by status
        db.backupHistory.groupBy({
          by: ['status'],
          where: {
            job: { userId },
            startedAt: { gte: last7d },
          },
          _count: { id: true },
        }),
        // Queue stats
        getQueueStats(),
        // Bytes uploaded today
        db.backupHistory.aggregate({
          where: {
            job: { userId },
            startedAt: { gte: last24h },
            status: 'SUCCESS',
          },
          _sum: { bytesUploaded: true },
        }),
      ])

    // Parse 24h stats
    const stats24h = {
      success: 0,
      failed: 0,
      running: 0,
    }
    for (const row of historyLast24h) {
      if (row.status === 'SUCCESS') stats24h.success = row._count.id
      else if (row.status === 'FAILED') stats24h.failed = row._count.id
      else if (['RUNNING', 'UPLOADING', 'PENDING'].includes(row.status)) {
        stats24h.running += row._count.id
      }
    }

    // Parse 7d stats for success rate
    let total7d = 0
    let success7d = 0
    for (const row of historyLast7d) {
      total7d += row._count.id
      if (row.status === 'SUCCESS') success7d = row._count.id
    }
    const successRate = total7d > 0 ? Math.round((success7d / total7d) * 100 * 10) / 10 : 100

    return c.json({
      success: true,
      data: {
        jobs: {
          total: jobsTotal,
          enabled: jobsEnabled,
        },
        history: {
          last24h: stats24h,
          successRate,
          bytesToday: (bytesToday._sum.bytesUploaded || BigInt(0)).toString(),
        },
        queue: queueStats,
      },
    })
  } catch (error: unknown) {
    return c.json(
      {
        success: false,
        error: 'Failed to fetch dashboard stats',
        details: error instanceof Error ? error.message : String(error),
      },
      500
    )
  }
})

// Get currently active/running backups
dashboard.get('/active', async (c) => {
  const db = c.get('db')
  // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
  const userId = c.get('userId')!

  try {
    // Get active jobs from database
    const activeHistory = await db.backupHistory.findMany({
      where: {
        job: { userId },
        status: { in: ['PENDING', 'RUNNING', 'UPLOADING', 'ROTATING'] },
      },
      include: {
        job: {
          select: { id: true, name: true },
        },
      },
      orderBy: { startedAt: 'desc' },
    })

    // Get progress data from BullMQ jobs
    const activeJobs = await backupQueue.getJobs(['active', 'waiting'])
    const progressMap = new Map<string, unknown>()

    for (const job of activeJobs) {
      if (job.data.historyId) {
        const progress = job.progress as unknown
        if (progress && typeof progress === 'object') {
          progressMap.set(job.data.historyId, progress)
        }
      }
    }

    // Combine history with progress
    const jobs = activeHistory.map((h) => {
      const progressData = progressMap.get(h.id)
      const progress =
        typeof progressData === 'object' && progressData !== null
          ? (progressData as Record<string, unknown>)
          : {}
      return {
        historyId: h.id,
        jobId: h.job.id,
        jobName: h.job.name,
        status: h.status,
        startedAt: h.startedAt.toISOString(),
        progress: {
          filesScanned:
            (typeof progress.filesScanned === 'number' ? progress.filesScanned : h.filesScanned) ||
            0,
          filesUploaded:
            (typeof progress.filesUploaded === 'number'
              ? progress.filesUploaded
              : h.filesUploaded) || 0,
          filesFailed:
            (typeof progress.filesFailed === 'number' ? progress.filesFailed : h.filesFailed) || 0,
          bytesUploaded:
            (typeof progress.bytesUploaded === 'number'
              ? progress.bytesUploaded
              : Number(h.bytesUploaded)) || 0,
          currentFile:
            (typeof progress.currentFile === 'string' ? progress.currentFile : null) || null,
          uploadSpeed:
            (typeof progress.uploadSpeed === 'number' ? progress.uploadSpeed : null) || null,
        },
      }
    })

    return c.json({
      success: true,
      data: { jobs },
    })
  } catch (error: unknown) {
    return c.json(
      {
        success: false,
        error: 'Failed to fetch active jobs',
        details: error instanceof Error ? error.message : String(error),
      },
      500
    )
  }
})

// Get system health status
dashboard.get('/health', async (c) => {
  const db = c.get('db')
  // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
  const userId = c.get('userId')!

  try {
    // Check database health
    const dbStart = Date.now()
    await db.$queryRaw`SELECT 1`
    const dbLatency = Date.now() - dbStart

    // Check Redis health
    const redis = new Redis({
      host: REDIS_HOST,
      port: REDIS_PORT,
      password: REDIS_PASSWORD || undefined,
      connectTimeout: 5000,
    })

    let redisStatus = 'down'
    let redisLatency = 0
    let redisMemory = ''

    try {
      const redisStart = Date.now()
      await redis.ping()
      redisLatency = Date.now() - redisStart
      redisStatus = 'up'

      // Get memory info
      const info = await redis.info('memory')
      const memMatch = info.match(/used_memory_human:(\S+)/)
      if (memMatch) redisMemory = memMatch[1]
    } catch {
      redisStatus = 'down'
    } finally {
      redis.disconnect()
    }

    // Check worker heartbeat
    const heartbeatRedis = new Redis({
      host: REDIS_HOST,
      port: REDIS_PORT,
      password: REDIS_PASSWORD || undefined,
    })

    let workerStatus = 'unknown'
    let workerHeartbeat: string | null = null
    let workerActiveJobs = 0

    try {
      const heartbeat = await heartbeatRedis.get('worker:heartbeat')
      if (heartbeat) {
        const lastBeat = parseInt(heartbeat, 10)
        const age = Date.now() - lastBeat
        workerStatus = age < 60000 ? 'up' : 'down'
        workerHeartbeat = new Date(lastBeat).toISOString()
      }

      // Get active job count
      const queueStats = await getQueueStats()
      workerActiveJobs = queueStats.active
    } catch {
      workerStatus = 'unknown'
    } finally {
      heartbeatRedis.disconnect()
    }

    // Check storage credentials health
    const credentials = await db.storageCredential.findMany({
      where: { userId },
      select: {
        id: true,
        name: true,
        provider: true,
        expiresAt: true,
      },
    })

    const storageHealth = credentials.map((cred) => {
      let status: 'connected' | 'expired' | 'expiring' = 'connected'
      // OAuth providers (google_drive) use refresh tokens that auto-renew
      // They should always show as connected
      if (cred.provider !== 'google_drive' && cred.expiresAt) {
        const now = new Date()
        if (cred.expiresAt < now) {
          status = 'expired'
        } else if (cred.expiresAt.getTime() - now.getTime() < 7 * 24 * 60 * 60 * 1000) {
          status = 'expiring'
        }
      }
      return {
        credentialId: cred.id,
        name: cred.name,
        provider: cred.provider,
        status,
        expiresAt: cred.expiresAt?.toISOString() || null,
      }
    })

    // Determine overall health
    let overall: 'healthy' | 'degraded' | 'critical' = 'healthy'
    if (redisStatus === 'down' || workerStatus === 'down') {
      overall = 'critical'
    } else if (workerStatus === 'unknown' || storageHealth.some((s) => s.status !== 'connected')) {
      overall = 'degraded'
    }

    return c.json({
      success: true,
      data: {
        overall,
        services: {
          database: { status: 'up', latencyMs: dbLatency },
          redis: { status: redisStatus, latencyMs: redisLatency, memoryUsed: redisMemory },
          worker: {
            status: workerStatus,
            lastHeartbeat: workerHeartbeat,
            activeJobs: workerActiveJobs,
          },
          storage: storageHealth,
        },
        timestamp: new Date().toISOString(),
      },
    })
  } catch (error: unknown) {
    return c.json(
      {
        success: false,
        error: 'Failed to check system health',
        details: error instanceof Error ? error.message : String(error),
      },
      500
    )
  }
})

// Get upcoming scheduled jobs
dashboard.get('/upcoming', async (c) => {
  const db = c.get('db')
  // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
  const userId = c.get('userId')!

  try {
    const now = new Date()

    const upcomingJobs = await db.backupJob.findMany({
      where: {
        userId,
        enabled: true,
        nextRunAt: { not: null },
      },
      include: {
        destination: {
          select: { name: true, provider: true },
        },
      },
      orderBy: { nextRunAt: 'asc' },
      take: 5,
    })

    const jobs = upcomingJobs.map((job) => ({
      id: job.id,
      name: job.name,
      schedule: job.schedule,
      // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
      nextRunAt: job.nextRunAt!.toISOString(),
      // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
      nextRunIn: Math.max(0, Math.floor((job.nextRunAt!.getTime() - now.getTime()) / 1000)),
      destination: {
        name: job.destination.name,
        provider: job.destination.provider,
      },
    }))

    return c.json({
      success: true,
      data: { jobs },
    })
  } catch (error: unknown) {
    return c.json(
      {
        success: false,
        error: 'Failed to fetch upcoming jobs',
        details: error instanceof Error ? error.message : String(error),
      },
      500
    )
  }
})

// Get chart data for history visualization
dashboard.get('/chart-data', async (c) => {
  const db = c.get('db')
  // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
  const userId = c.get('userId')!
  const period = c.req.query('period') || '7d'

  try {
    const now = new Date()
    let startDate: Date

    switch (period) {
      case '30d':
        startDate = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000)
        break
      case '90d':
        startDate = new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000)
        break
      default:
        startDate = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000)
    }

    // Fetch all history entries in the period
    const history = await db.backupHistory.findMany({
      where: {
        job: { userId },
        startedAt: { gte: startDate },
      },
      select: {
        startedAt: true,
        status: true,
        bytesUploaded: true,
      },
      orderBy: { startedAt: 'asc' },
    })

    // Group by day
    const dailyMap = new Map<
      string,
      { success: number; failed: number; partial: number; bytesUploaded: bigint }
    >()

    for (const entry of history) {
      const dateKey = entry.startedAt.toISOString().split('T')[0]
      const existing = dailyMap.get(dateKey) || {
        success: 0,
        failed: 0,
        partial: 0,
        bytesUploaded: BigInt(0),
      }

      if (entry.status === 'SUCCESS') existing.success++
      else if (entry.status === 'FAILED') existing.failed++
      else if (entry.status === 'PARTIAL_SUCCESS') existing.partial++

      existing.bytesUploaded += entry.bytesUploaded
      dailyMap.set(dateKey, existing)
    }

    // Fill in missing days with zeros
    const daily = []
    const current = new Date(startDate)
    while (current <= now) {
      const dateKey = current.toISOString().split('T')[0]
      const data = dailyMap.get(dateKey) || {
        success: 0,
        failed: 0,
        partial: 0,
        bytesUploaded: BigInt(0),
      }
      daily.push({
        date: dateKey,
        success: data.success,
        failed: data.failed,
        partial: data.partial,
        bytesUploaded: data.bytesUploaded.toString(),
      })
      current.setDate(current.getDate() + 1)
    }

    return c.json({
      success: true,
      data: {
        period,
        daily,
      },
    })
  } catch (error: unknown) {
    return c.json(
      {
        success: false,
        error: 'Failed to fetch chart data',
        details: error instanceof Error ? error.message : String(error),
      },
      500
    )
  }
})

// Get active alerts
dashboard.get('/alerts', async (c) => {
  const db = c.get('db')
  // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
  const userId = c.get('userId')!

  try {
    const now = new Date()
    const last24h = new Date(now.getTime() - 24 * 60 * 60 * 1000)

    const alerts: Array<{
      id: string
      type: string
      severity: 'warning' | 'error' | 'critical'
      title: string
      message: string
      timestamp: string
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      metadata?: Record<string, any>
    }> = []

    // Check for failed backups in last 24h
    const failedBackups = await db.backupHistory.findMany({
      where: {
        job: { userId },
        status: 'FAILED',
        startedAt: { gte: last24h },
      },
      include: {
        job: { select: { name: true } },
      },
      orderBy: { startedAt: 'desc' },
      take: 5,
    })

    for (const backup of failedBackups) {
      alerts.push({
        id: `failed-${backup.id}`,
        type: 'backup_failed',
        severity: 'error',
        title: 'Backup Failed',
        message: `"${backup.job.name}" failed: ${backup.errorMessage || 'Unknown error'}`,
        timestamp: backup.startedAt.toISOString(),
        metadata: { historyId: backup.id, jobId: backup.jobId },
      })
    }

    // Check for expiring credentials
    // Note: OAuth credentials (google_drive) use refresh tokens that auto-renew,
    // so we only check for non-OAuth providers (like S3 API keys) that have actual expiry
    const expiringCredentials = await db.storageCredential.findMany({
      where: {
        userId,
        provider: { notIn: ['google_drive'] }, // OAuth providers auto-refresh
        expiresAt: {
          not: null,
          lte: new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000), // Within 7 days
          gt: now,
        },
      },
    })

    for (const cred of expiringCredentials) {
      // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
      const daysLeft = Math.ceil(
        (cred.expiresAt!.getTime() - now.getTime()) / (24 * 60 * 60 * 1000)
      )
      alerts.push({
        id: `expiring-${cred.id}`,
        type: 'credential_expiring',
        severity: 'warning',
        title: 'Credential Expiring',
        message: `"${cred.name}" expires in ${daysLeft} day${daysLeft === 1 ? '' : 's'}`,
        timestamp: now.toISOString(),
        metadata: { credentialId: cred.id, daysLeft },
      })
    }

    // Check for expired credentials (skip OAuth providers)
    const expiredCredentials = await db.storageCredential.findMany({
      where: {
        userId,
        provider: { notIn: ['google_drive'] }, // OAuth providers auto-refresh
        expiresAt: {
          not: null,
          lt: now,
        },
      },
    })

    for (const cred of expiredCredentials) {
      alerts.push({
        id: `expired-${cred.id}`,
        type: 'credential_expired',
        severity: 'critical',
        title: 'Credential Expired',
        message: `"${cred.name}" has expired and needs to be re-authenticated`,
        // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
        timestamp: cred.expiresAt!.toISOString(),
        metadata: { credentialId: cred.id },
      })
    }

    // Sort alerts by severity (critical first) then timestamp
    const severityOrder = { critical: 0, error: 1, warning: 2 }
    alerts.sort((a, b) => {
      const severityDiff = severityOrder[a.severity] - severityOrder[b.severity]
      if (severityDiff !== 0) return severityDiff
      return new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()
    })

    return c.json({
      success: true,
      data: {
        alerts,
        unreadCount: alerts.length,
      },
    })
  } catch (error: unknown) {
    return c.json(
      {
        success: false,
        error: 'Failed to fetch alerts',
        details: error instanceof Error ? error.message : String(error),
      },
      500
    )
  }
})

// SSE stream for real-time dashboard updates
dashboard.get('/stream', async (c) => {
  // Get token from query parameter (SSE doesn't support custom headers)
  const token = c.req.query('token')

  if (!token) {
    return c.json({ success: false, error: 'Authentication required' }, 401)
  }

  // Verify JWT token
  const payload = await verifyToken(token)
  if (!payload) {
    return c.json({ success: false, error: 'Invalid or expired token' }, 401)
  }

  const userId = payload.userId
  logger.debug({ userId }, 'Dashboard SSE user connected')

  // Set SSE headers
  c.header('Content-Type', 'text/event-stream')
  c.header('Cache-Control', 'no-cache')
  c.header('Connection', 'keep-alive')

  return stream(c, async (stream) => {
    let subscriber: Redis | null = null
    let keepAliveInterval: NodeJS.Timeout | null = null
    let statsInterval: NodeJS.Timeout | null = null
    let healthInterval: NodeJS.Timeout | null = null

    try {
      // Subscribe to Redis channels for real-time updates
      subscriber = new Redis({
        host: REDIS_HOST,
        port: REDIS_PORT,
        password: REDIS_PASSWORD || undefined,
      })

      subscriber.on('error', (err) => {
        logger.error({ err }, 'Dashboard SSE Redis error')
      })

      // Subscribe to dashboard channel for this user
      const dashboardChannel = `dashboard:user:${userId}`
      await subscriber.subscribe(dashboardChannel)
      logger.debug({ dashboardChannel }, 'Dashboard SSE subscribed')

      // Send connection message
      await stream.writeln(`data: ${JSON.stringify({ type: 'connected' })}\n`)

      // Handle incoming Redis messages (job progress, alerts, etc.)
      subscriber.on('message', async (ch, message) => {
        if (ch === dashboardChannel) {
          try {
            await stream.writeln(`data: ${message}\n`)
          } catch (error) {
            logger.error({ err: error }, 'Dashboard SSE error forwarding message')
          }
        }
      })

      // Periodic stats update (every 5 seconds)
      statsInterval = setInterval(async () => {
        try {
          const queueStats = await getQueueStats()
          await stream.writeln(
            `data: ${JSON.stringify({
              type: 'queue:update',
              payload: queueStats,
            })}\n`
          )
        } catch (error) {
          logger.error({ err: error }, 'Dashboard SSE stats update error')
        }
      }, 5000)

      // Periodic health update (every 30 seconds)
      healthInterval = setInterval(async () => {
        try {
          // Quick health check
          const healthRedis = new Redis({
            host: REDIS_HOST,
            port: REDIS_PORT,
            password: REDIS_PASSWORD || undefined,
            connectTimeout: 2000,
          })

          let workerStatus = 'unknown'
          try {
            const heartbeat = await healthRedis.get('worker:heartbeat')
            if (heartbeat) {
              const age = Date.now() - parseInt(heartbeat, 10)
              workerStatus = age < 60000 ? 'up' : 'down'
            }
          } catch {
            workerStatus = 'unknown'
          } finally {
            healthRedis.disconnect()
          }

          await stream.writeln(
            `data: ${JSON.stringify({
              type: 'health:update',
              payload: {
                worker: workerStatus,
                timestamp: new Date().toISOString(),
              },
            })}\n`
          )
        } catch (error) {
          logger.error({ err: error }, 'Dashboard SSE health update error')
        }
      }, 30000)

      // Keep connection alive
      keepAliveInterval = setInterval(async () => {
        try {
          await stream.writeln(': keepalive\n')
        } catch (error) {
          logger.error({ err: error }, 'Dashboard SSE keepalive error')
          if (keepAliveInterval) clearInterval(keepAliveInterval)
        }
      }, 30000)

      // Cleanup on abort
      stream.onAbort(() => {
        logger.debug({ userId }, 'Dashboard SSE client disconnected')
        if (keepAliveInterval) clearInterval(keepAliveInterval)
        if (statsInterval) clearInterval(statsInterval)
        if (healthInterval) clearInterval(healthInterval)
        if (subscriber) {
          subscriber.unsubscribe(dashboardChannel)
          subscriber.quit()
        }
      })

      // Keep stream open indefinitely
      await new Promise(() => {})
    } catch (error) {
      logger.error({ err: error }, 'Dashboard SSE stream error')
      if (keepAliveInterval) clearInterval(keepAliveInterval)
      if (statsInterval) clearInterval(statsInterval)
      if (healthInterval) clearInterval(healthInterval)
      if (subscriber) {
        subscriber.quit()
      }
    }
  })
})

/**
 * GET /api/dashboard/timezone
 * Get the configured system timezone
 */
dashboard.get('/timezone', (c) => {
  const timezone = process.env.TIMEZONE || 'UTC'
  return c.json({
    success: true,
    data: { timezone },
  })
})

export default dashboard
