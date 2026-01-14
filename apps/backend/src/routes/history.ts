import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { BackupHistoryQuerySchema } from '@avault/shared'
import { requireAuth } from '../middleware/auth'
import type { Env } from '../index'

const history = new Hono<Env>()

// Apply authentication to all routes
history.use('*', requireAuth)

// Get all backup history (paginated, filtered by user's jobs)
history.get('/', zValidator('query', BackupHistoryQuerySchema), async (c) => {
  const db = c.get('db')
  const userId = c.get('userId')!
  const { jobId, status, page, pageSize } = c.req.valid('query')

  // Build where clause - must belong to user's jobs
  const where: any = {
    job: {
      userId,
    },
  }
  if (jobId) where.jobId = jobId
  if (status) where.status = status

  const [items, total] = await Promise.all([
    db.backupHistory.findMany({
      where,
      include: {
        job: {
          select: {
            id: true,
            name: true,
            sourcePath: true,
            destination: {
              select: {
                id: true,
                name: true,
                provider: true,
              },
            },
          },
        },
      },
      orderBy: { startedAt: 'desc' },
      take: pageSize,
      skip: (page - 1) * pageSize,
    }),
    db.backupHistory.count({ where }),
  ])

  // Convert BigInt to string for JSON serialization
  const serializedItems = items.map((item) => ({
    ...item,
    bytesUploaded: item.bytesUploaded.toString(),
  }))

  const totalPages = Math.ceil(total / pageSize)

  return c.json({
    success: true,
    data: {
      data: serializedItems,
      pagination: {
        page,
        pageSize,
        total,
        totalPages,
      },
    },
  })
})

// Get single history entry (user's own only)
history.get('/:id', async (c) => {
  const db = c.get('db')
  const userId = c.get('userId')!
  const id = c.req.param('id')

  const entry = await db.backupHistory.findFirst({
    where: {
      id,
      job: {
        userId,
      },
    },
    include: {
      job: true,
    },
  })

  if (!entry) {
    return c.json({ success: false, error: 'History entry not found' }, 404)
  }

  // Convert BigInt to string for JSON serialization
  const serializedEntry = {
    ...entry,
    bytesUploaded: entry.bytesUploaded.toString(),
  }

  return c.json({ success: true, data: serializedEntry })
})

export default history
