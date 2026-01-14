import { Hono } from 'hono'
import { logger } from '@avault/shared'
import { SettingsService } from '../lib/settings'
import { requireAuth, requireAdmin } from '../middleware/auth'
import type { Env } from '../index'

const settings = new Hono<Env>()

// All settings routes require admin authentication
settings.use('*', requireAuth, requireAdmin)

/**
 * GET /api/settings
 * Get all system settings (admin only)
 */
settings.get('/', async (c) => {
  const db = c.get('db')
  const settingsService = new SettingsService(db)

  try {
    const allSettings = await settingsService.getAll()

    return c.json({
      success: true,
      data: allSettings,
    })
  } catch (error: unknown) {
    logger.error({ error }, 'Failed to fetch settings')
    return c.json(
      {
        success: false,
        error: 'Failed to fetch settings',
      },
      500
    )
  }
})

/**
 * GET /api/settings/:key
 * Get a specific setting by key (admin only)
 */
settings.get('/:key', async (c) => {
  const db = c.get('db')
  const key = c.req.param('key')
  const settingsService = new SettingsService(db)

  try {
    const value = await settingsService.get(key, null)

    if (value === null) {
      return c.json(
        {
          success: false,
          error: 'Setting not found',
        },
        404
      )
    }

    return c.json({
      success: true,
      data: {
        key,
        value,
      },
    })
  } catch (error: unknown) {
    logger.error({ error }, 'Failed to fetch setting')
    return c.json(
      {
        success: false,
        error: 'Failed to fetch setting',
      },
      500
    )
  }
})

/**
 * PUT /api/settings/:key
 * Update a setting by key (admin only)
 */
settings.put('/:key', async (c) => {
  const db = c.get('db')
  const key = c.req.param('key')
  const userId = c.get('userId')

  try {
    const body = await c.req.json()
    const { value } = body

    if (value === undefined) {
      return c.json(
        {
          success: false,
          error: 'Value is required',
        },
        400
      )
    }

    const settingsService = new SettingsService(db)
    await settingsService.set(key, value, userId)

    return c.json({
      success: true,
      data: {
        key,
        value,
      },
    })
  } catch (error: unknown) {
    logger.error({ error }, 'Failed to update setting')
    return c.json(
      {
        success: false,
        error: 'Failed to update setting',
      },
      500
    )
  }
})

export default settings
