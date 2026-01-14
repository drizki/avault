import 'dotenv/config'
import { serve } from '@hono/node-server'
import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { PrismaClient, getRedis, closeRedisConnections, logger } from '@avault/shared'
import type { StorageAdapter } from '@avault/storage'
import { systemLog } from './lib/log-stream'
import { initScheduler } from './lib/scheduler'

// Import routes
import authRoutes from './routes/auth'
import settingsRoutes from './routes/settings'
import credentialRoutes from './routes/credentials'
import destinationRoutes from './routes/destinations'
import providerRoutes from './routes/providers'
import jobRoutes from './routes/jobs'
import historyRoutes from './routes/history'
import nasRoutes from './routes/nas'
import queueRoutes from './routes/queue'
import logsRoutes from './routes/logs'
import dashboardRoutes from './routes/dashboard'

// Environment variables
const PORT = parseInt(process.env.PORT || '4000', 10)
const NODE_ENV = process.env.NODE_ENV || 'development'

// Validate FRONTEND_URL to prevent open redirect vulnerabilities
const FRONTEND_URL = process.env.FRONTEND_URL || 'http://localhost:3000'
try {
  const url = new URL(FRONTEND_URL)
  if (!['http:', 'https:'].includes(url.protocol)) {
    throw new Error('Invalid protocol')
  }
} catch {
  throw new Error(`FRONTEND_URL must be a valid HTTP/HTTPS URL. Got: ${FRONTEND_URL}`)
}

// Type definitions for Hono context
export type Env = {
  Variables: {
    db: PrismaClient
    userId?: string
    userRole?: string
    storageAdapters: Map<string, StorageAdapter>
  }
}

// Initialize Prisma
const db = new PrismaClient({
  log: NODE_ENV === 'development' ? ['error'] : ['error'],
})

// Get shared Redis connection for scheduler
const schedulerRedis = getRedis()

// Initialize scheduler
const scheduler = initScheduler(db, schedulerRedis)

// Initialize Hono app
const app = new Hono<Env>()

// Global middleware
app.use('*', cors({
  origin: FRONTEND_URL,
  credentials: true,
}))

// Attach Prisma to context
app.use('*', async (c, next) => {
  c.set('db', db)
  c.set('storageAdapters', new Map())
  await next()
})

// Health check
app.get('/', (c) => {
  return c.json({
    name: 'avault-backend',
    version: '0.1.0',
    status: 'running',
    timestamp: new Date().toISOString(),
  })
})

// API routes
app.route('/api/auth', authRoutes)
app.route('/api/settings', settingsRoutes)
app.route('/api/providers', providerRoutes)
app.route('/api/credentials', credentialRoutes)
app.route('/api/destinations', destinationRoutes)
app.route('/api/jobs', jobRoutes)
app.route('/api/history', historyRoutes)
app.route('/api/nas', nasRoutes)
app.route('/api/queue', queueRoutes)
app.route('/api/logs', logsRoutes)
app.route('/api/dashboard', dashboardRoutes)

// Error handler
app.onError((err, c) => {
  logger.error({ err }, 'Global error handler')

  return c.json({
    success: false,
    error: err.message || 'Internal server error',
    details: NODE_ENV === 'development' ? err.stack : undefined,
  }, 500)
})

// 404 handler
app.notFound((c) => {
  return c.json({
    success: false,
    error: 'Not found',
  }, 404)
})

// Start server
systemLog.info(`Starting avault backend on port ${PORT}`)
serve({
  fetch: app.fetch,
  port: PORT,
})

systemLog.info(`Backend server running at http://localhost:${PORT}`)

// Start scheduler after server is running
scheduler.start().then(() => {
  systemLog.info('Backup scheduler started successfully')
}).catch((err: unknown) => {
  systemLog.error('Failed to start backup scheduler', { error: err instanceof Error ? err.message : 'Unknown error' })
})

// Note: Log cleanup is scheduled by the cleanup-worker process
// Run it separately with: pnpm --filter @avault/worker start:cleanup

// Graceful shutdown
const shutdown = async () => {
  logger.info('Shutting down gracefully...')

  // Stop scheduler
  try {
    await scheduler.stop()
    logger.info('Scheduler stopped')
  } catch {
    logger.warn('Scheduler already stopped or not initialized')
  }

  // Close queue
  try {
    const { closeQueue } = await import('./lib/queue')
    await closeQueue()
  } catch {
    logger.warn('Queue not initialized or already closed')
  }

  // Disconnect from database and Redis
  await db.$disconnect()
  await closeRedisConnections()

  process.exit(0)
}

process.on('SIGINT', shutdown)
process.on('SIGTERM', shutdown)

export default app
