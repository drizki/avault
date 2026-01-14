import { Hono } from 'hono'
import { stream } from 'hono/streaming'
import { logger, Redis } from '@avault/shared'
import { verifyToken } from '../lib/auth/jwt'
import { requireAuth } from '../middleware/auth'
import type { Env } from '../index'
const REDIS_HOST = process.env.REDIS_HOST || 'localhost'
const REDIS_PORT = parseInt(process.env.REDIS_PORT || '6379', 10)
const REDIS_PASSWORD = process.env.REDIS_PASSWORD || ''

const logs = new Hono<Env>()

// Stream all logs for the authenticated user
logs.get('/', async (c) => {
  // Get token from query parameter (SSE doesn't support custom headers)
  const token = c.req.query('token')
  const limit = parseInt(c.req.query('limit') || '100', 10)

  if (!token) {
    return c.json({ success: false, error: 'Authentication required' }, 401)
  }

  // Verify JWT token
  const payload = await verifyToken(token)
  if (!payload) {
    return c.json({ success: false, error: 'Invalid or expired token' }, 401)
  }

  const userId = payload.userId
  const db = c.get('db')
  logger.debug({ userId }, 'SSE user connected')

  // Set SSE headers
  c.header('Content-Type', 'text/event-stream')
  c.header('Cache-Control', 'no-cache')
  c.header('Connection', 'keep-alive')

  return stream(c, async (stream) => {
    let subscriber: Redis | null = null
    let keepAliveInterval: NodeJS.Timeout | null = null

    try {
      // PHASE 1: Load historical logs from database
      const historicalLogs = await db.logEntry.findMany({
        where: { userId },
        orderBy: { timestamp: 'desc' },
        take: Math.min(limit, 500), // Max 500 historical logs
      })

      // Send historical logs (reverse for chronological order)
      for (const log of historicalLogs.reverse()) {
        const logEvent = {
          timestamp: log.timestamp.toISOString(),
          level: log.level.toLowerCase(),
          message: log.message,
          historyId: log.historyId,
          jobId: log.jobId,
          metadata: log.metadata,
          _historical: true, // Marker for frontend
        }
        await stream.writeln(`data: ${JSON.stringify(logEvent)}\n`)
      }

      // Send transition marker
      await stream.writeln(
        `data: {"type":"historical_complete","count":${historicalLogs.length}}\n`
      )

      // PHASE 2: Subscribe to real-time logs
      subscriber = new Redis({
        host: REDIS_HOST,
        port: REDIS_PORT,
        password: REDIS_PASSWORD || undefined,
      })

      subscriber.on('error', (err) => {
        logger.error({ err }, 'SSE Redis error')
      })

      const userChannel = `logs:user:${userId}`
      const systemChannel = 'logs:system'
      logger.debug({ userChannel, systemChannel }, 'SSE subscribing to channels')

      await subscriber.subscribe(userChannel, systemChannel)

      // Send connection message
      await stream.writeln('data: {"type":"connected"}\n')

      // Handle incoming log messages
      subscriber.on('message', async (ch, message) => {
        if (ch === userChannel || ch === systemChannel) {
          try {
            await stream.writeln(`data: ${message}\n`)
          } catch (error) {
            logger.error({ err: error }, 'SSE error streaming log')
          }
        }
      })

      // Keep connection alive
      keepAliveInterval = setInterval(async () => {
        try {
          await stream.writeln(': keepalive\n')
        } catch (error) {
          logger.error({ err: error }, 'SSE keepalive error')
          if (keepAliveInterval) clearInterval(keepAliveInterval)
        }
      }, 30000) // Send keepalive every 30 seconds

      // Cleanup on abort
      stream.onAbort(() => {
        logger.debug({ userId }, 'SSE client disconnected')
        if (keepAliveInterval) clearInterval(keepAliveInterval)
        if (subscriber) {
          subscriber.unsubscribe(userChannel, systemChannel)
          subscriber.quit()
        }
      })

      // Keep stream open indefinitely
      await new Promise(() => {})
    } catch (error) {
      logger.error({ err: error }, 'SSE stream error')
      if (keepAliveInterval) clearInterval(keepAliveInterval)
      if (subscriber) {
        subscriber.quit()
      }
    }
  })
})

// Stream logs for a specific history ID
logs.get('/:historyId', async (c) => {
  const { historyId } = c.req.param()

  // Get token from query parameter (SSE doesn't support custom headers)
  const token = c.req.query('token')
  const limit = parseInt(c.req.query('limit') || '100', 10)

  if (!token) {
    return c.json({ success: false, error: 'Authentication required' }, 401)
  }

  // Verify JWT token
  const payload = await verifyToken(token)
  if (!payload) {
    return c.json({ success: false, error: 'Invalid or expired token' }, 401)
  }

  const userId = payload.userId
  const db = c.get('db')

  // Verify that this history entry belongs to the user
  const history = await db.backupHistory.findFirst({
    where: {
      id: historyId,
      job: {
        userId,
      },
    },
  })

  if (!history) {
    return c.json({ success: false, error: 'History entry not found' }, 404)
  }

  // Set SSE headers
  c.header('Content-Type', 'text/event-stream')
  c.header('Cache-Control', 'no-cache')
  c.header('Connection', 'keep-alive')

  return stream(c, async (stream) => {
    let subscriber: Redis | null = null
    let keepAliveInterval: NodeJS.Timeout | null = null

    try {
      // PHASE 1: Load historical logs from database
      const historicalLogs = await db.logEntry.findMany({
        where: { historyId },
        orderBy: { timestamp: 'desc' },
        take: Math.min(limit, 1000), // More logs for single history
      })

      // Send historical logs (reverse for chronological order)
      for (const log of historicalLogs.reverse()) {
        const logEvent = {
          timestamp: log.timestamp.toISOString(),
          level: log.level.toLowerCase(),
          message: log.message,
          historyId: log.historyId,
          jobId: log.jobId,
          metadata: log.metadata,
          _historical: true, // Marker for frontend
        }
        await stream.writeln(`data: ${JSON.stringify(logEvent)}\n`)
      }

      // Send transition marker
      await stream.writeln(
        `data: {"type":"historical_complete","count":${historicalLogs.length}}\n`
      )

      // PHASE 2: Subscribe to real-time logs
      subscriber = new Redis({
        host: REDIS_HOST,
        port: REDIS_PORT,
        password: REDIS_PASSWORD || undefined,
      })

      subscriber.on('error', (err) => {
        logger.error({ err }, 'SSE Redis error')
      })

      const channel = `logs:${historyId}`
      logger.debug({ channel }, 'SSE subscribing to channel')

      await subscriber.subscribe(channel)

      // Send connection message
      await stream.writeln('data: {"type":"connected"}\n')

      // Handle incoming log messages
      subscriber.on('message', async (ch, message) => {
        if (ch === channel) {
          try {
            await stream.writeln(`data: ${message}\n`)
          } catch (error) {
            logger.error({ err: error }, 'SSE error streaming log')
          }
        }
      })

      // Keep connection alive
      keepAliveInterval = setInterval(async () => {
        try {
          await stream.writeln(': keepalive\n')
        } catch (error) {
          logger.error({ err: error }, 'SSE keepalive error')
          if (keepAliveInterval) clearInterval(keepAliveInterval)
        }
      }, 30000) // Send keepalive every 30 seconds

      // Cleanup on abort
      stream.onAbort(() => {
        logger.debug({ historyId }, 'SSE client disconnected')
        if (keepAliveInterval) clearInterval(keepAliveInterval)
        if (subscriber) {
          subscriber.unsubscribe(channel)
          subscriber.quit()
        }
      })

      // Keep stream open indefinitely
      await new Promise(() => {})
    } catch (error) {
      logger.error({ err: error }, 'SSE stream error')
      if (keepAliveInterval) clearInterval(keepAliveInterval)
      if (subscriber) {
        subscriber.quit()
      }
    }
  })
})

// Delete all logs for the authenticated user
logs.delete('/', requireAuth, async (c) => {
  const db = c.get('db')
  // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
  const userId = c.get('userId')!

  try {
    const result = await db.logEntry.deleteMany({
      where: { userId },
    })

    return c.json({
      success: true,
      data: { deletedCount: result.count },
    })
  } catch (error: unknown) {
    logger.error({ err: error }, 'Failed to delete logs')
    return c.json({ success: false, error: 'Failed to delete logs' }, 500)
  }
})

export default logs
