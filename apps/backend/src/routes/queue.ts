import { Hono } from 'hono'
import { requireAuth } from '../middleware/auth'
import type { Env } from '../index'
import { getQueueStats } from '../lib/queue'

const queue = new Hono<Env>()

// Apply authentication to all routes
queue.use('*', requireAuth)

// Get queue statistics (authenticated users only)
queue.get('/status', async (c) => {
  try {
    const stats = await getQueueStats()
    return c.json({
      success: true,
      data: stats,
    })
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Unknown error'
    return c.json(
      {
        success: false,
        error: 'Failed to get queue status',
        details: message,
      },
      500
    )
  }
})

export default queue
