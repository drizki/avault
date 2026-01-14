import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { CreateDestinationSchema, UpdateDestinationSchema, decrypt, logger } from '@avault/shared'
import { getStorageAdapter, GoogleDriveSharedAdapter } from '@avault/storage'
import { requireAuth } from '../middleware/auth'
import type { Env } from '../index'

const destinations = new Hono<Env>()

// Apply authentication to all routes
destinations.use('*', requireAuth)

// List all destinations (filtered by user)
destinations.get('/', async (c) => {
  const db = c.get('db')
  // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
  const userId = c.get('userId')!

  const allDestinations = await db.storageDestination.findMany({
    where: { userId },
    include: {
      credential: {
        select: {
          id: true,
          name: true,
          provider: true,
        },
      },
    },
    orderBy: { createdAt: 'desc' },
  })

  return c.json({ success: true, data: allDestinations })
})

// Create destination (attach userId)
destinations.post('/', zValidator('json', CreateDestinationSchema), async (c) => {
  const db = c.get('db')
  // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
  const userId = c.get('userId')!
  const data = c.req.valid('json')

  try {
    const destination = await db.storageDestination.create({
      data: {
        ...data,
        userId,
      },
      include: {
        credential: {
          select: {
            id: true,
            name: true,
            provider: true,
          },
        },
      },
    })

    return c.json({ success: true, data: destination }, 201)
  } catch (error: unknown) {
    return c.json(
      {
        success: false,
        error: 'Failed to create destination',
        details: error instanceof Error ? error.message : String(error),
      },
      400
    )
  }
})

// Get single destination (user's own only)
destinations.get('/:id', async (c) => {
  const db = c.get('db')
  // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
  const userId = c.get('userId')!
  const id = c.req.param('id')

  const destination = await db.storageDestination.findFirst({
    where: { id, userId },
    include: {
      credential: {
        select: {
          id: true,
          name: true,
          provider: true,
        },
      },
    },
  })

  if (!destination) {
    return c.json({ success: false, error: 'Destination not found' }, 404)
  }

  return c.json({ success: true, data: destination })
})

// Update destination (user's own only)
destinations.patch('/:id', zValidator('json', UpdateDestinationSchema), async (c) => {
  const db = c.get('db')
  // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
  const userId = c.get('userId')!
  const id = c.req.param('id')
  const data = c.req.valid('json')

  try {
    // First check if destination exists and belongs to user
    const existing = await db.storageDestination.findFirst({
      where: { id, userId },
    })

    if (!existing) {
      return c.json(
        {
          success: false,
          error: 'Destination not found',
        },
        404
      )
    }

    const destination = await db.storageDestination.update({
      where: { id },
      data,
      include: {
        credential: {
          select: {
            id: true,
            name: true,
            provider: true,
          },
        },
      },
    })

    return c.json({ success: true, data: destination })
  } catch {
    return c.json(
      {
        success: false,
        error: 'Failed to update destination',
      },
      400
    )
  }
})

// Delete destination (user's own only)
destinations.delete('/:id', async (c) => {
  const db = c.get('db')
  // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
  const userId = c.get('userId')!
  const id = c.req.param('id')

  try {
    // First check if destination exists and belongs to user
    const existing = await db.storageDestination.findFirst({
      where: { id, userId },
    })

    if (!existing) {
      return c.json(
        {
          success: false,
          error: 'Destination not found',
        },
        404
      )
    }

    await db.storageDestination.delete({ where: { id } })

    return c.json({
      success: true,
      message: 'Destination deleted successfully',
    })
  } catch {
    return c.json(
      {
        success: false,
        error: 'Failed to delete destination',
      },
      500
    )
  }
})

// ============================================================================
// Browse and Create Available Destinations
// ============================================================================

// Create a new Shared Drive (Google Drive only)
destinations.post('/create-drive/:credentialId', async (c) => {
  const db = c.get('db')
  // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
  const userId = c.get('userId')!
  const credentialId = c.req.param('credentialId')

  try {
    const { name } = await c.req.json()

    if (!name || typeof name !== 'string' || name.trim().length === 0) {
      return c.json(
        {
          success: false,
          error: 'Drive name is required',
        },
        400
      )
    }

    logger.info({ credentialId, userId, name }, 'Creating new Shared Drive')

    // Verify credential belongs to user
    const credential = await db.storageCredential.findFirst({
      where: { id: credentialId, userId },
    })

    if (!credential) {
      logger.warn({ credentialId, userId }, 'Credential not found or unauthorized')
      return c.json(
        {
          success: false,
          error: 'Credential not found',
        },
        404
      )
    }

    // Only Google Drive Shared supports creating new drives
    if (credential.provider !== 'google_drive' && credential.provider !== 'google_drive_shared') {
      return c.json(
        {
          success: false,
          error: 'Only Google Drive Shared Drives supports creating new drives',
        },
        400
      )
    }

    logger.info({ credentialId, provider: credential.provider }, 'Decrypting credential...')

    // Decrypt credential data
    const decryptedData = decrypt(credential.encryptedData, credential.iv, credential.authTag)
    const credentialData = JSON.parse(decryptedData)

    logger.info({ credentialId }, 'Initializing Google Drive adapter...')
    const adapter = new GoogleDriveSharedAdapter()
    await adapter.initialize(credentialData)

    logger.info({ credentialId, name }, 'Creating Shared Drive...')
    const newDrive = await adapter.createSharedDrive(name.trim())

    logger.info(
      { credentialId, driveId: newDrive.id, name: newDrive.name },
      'Shared Drive created successfully'
    )

    return c.json(
      {
        success: true,
        data: newDrive,
      },
      201
    )
  } catch (error: unknown) {
    logger.error(
      {
        error: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : undefined,
        credentialId,
      },
      'Failed to create Shared Drive'
    )
    return c.json(
      {
        success: false,
        error: 'Failed to create Shared Drive',
        details: error instanceof Error ? error.message : String(error),
      },
      500
    )
  }
})

// List available destinations for a credential (e.g., Google Drive Shared Drives)
destinations.get('/browse/:credentialId', async (c) => {
  const db = c.get('db')
  // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
  const userId = c.get('userId')!
  const credentialId = c.req.param('credentialId')

  logger.info({ credentialId, userId }, 'Browsing destinations for credential')

  try {
    // Verify credential belongs to user
    const credential = await db.storageCredential.findFirst({
      where: { id: credentialId, userId },
    })

    if (!credential) {
      logger.warn({ credentialId, userId }, 'Credential not found or unauthorized')
      return c.json(
        {
          success: false,
          error: 'Credential not found',
        },
        404
      )
    }

    logger.info({ credentialId, provider: credential.provider }, 'Found credential, decrypting...')

    // Decrypt credential data
    const decryptedData = decrypt(credential.encryptedData, credential.iv, credential.authTag)
    const credentialData = JSON.parse(decryptedData)

    logger.info(
      { credentialId, provider: credential.provider },
      'Credential decrypted successfully'
    )

    // Use factory to get the appropriate adapter
    try {
      logger.info(
        { credentialId, provider: credential.provider },
        'Initializing storage adapter...'
      )
      const adapter = getStorageAdapter(credential.provider)
      await adapter.initialize(credentialData)

      logger.info({ credentialId }, 'Fetching available destinations...')
      const availableDestinations = await adapter.listDestinations()

      logger.info(
        { credentialId, count: availableDestinations.length },
        'Successfully fetched destinations'
      )

      return c.json({
        success: true,
        data: availableDestinations,
      })
    } catch (adapterError: unknown) {
      logger.error(
        {
          error: adapterError instanceof Error ? adapterError.message : String(adapterError),
          provider: credential.provider,
        },
        'Failed to initialize adapter'
      )
      return c.json(
        {
          success: false,
          error: `Provider ${credential.provider} not supported for browsing`,
          details: adapterError instanceof Error ? adapterError.message : String(adapterError),
        },
        400
      )
    }
  } catch (error: unknown) {
    logger.error(
      {
        error: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : undefined,
        credentialId,
      },
      'Failed to browse destinations'
    )
    return c.json(
      {
        success: false,
        error: 'Failed to list available destinations',
        details: error instanceof Error ? error.message : String(error),
      },
      500
    )
  }
})

// Browse folders within a destination (e.g., folders inside a Shared Drive)
destinations.get('/browse/:credentialId/:destinationId/folders', async (c) => {
  const db = c.get('db')
  // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
  const userId = c.get('userId')!
  const credentialId = c.req.param('credentialId')
  const destinationId = c.req.param('destinationId')
  const parentFolderId = c.req.query('parentFolderId')

  try {
    // Verify credential belongs to user
    const credential = await db.storageCredential.findFirst({
      where: { id: credentialId, userId },
    })

    if (!credential) {
      return c.json(
        {
          success: false,
          error: 'Credential not found',
        },
        404
      )
    }

    // Decrypt credential data
    const decryptedData = decrypt(credential.encryptedData, credential.iv, credential.authTag)
    const credentialData = JSON.parse(decryptedData)

    // Use factory to get the appropriate adapter
    try {
      const adapter = getStorageAdapter(credential.provider)
      await adapter.initialize(credentialData)

      const folders = await adapter.listFolders(destinationId, parentFolderId || undefined)

      return c.json({
        success: true,
        data: folders,
      })
    } catch (adapterError: unknown) {
      return c.json(
        {
          success: false,
          error: `Provider ${credential.provider} not supported for folder browsing`,
          details: adapterError instanceof Error ? adapterError.message : String(adapterError),
        },
        400
      )
    }
  } catch (error: unknown) {
    logger.error(
      {
        error: error instanceof Error ? error.message : String(error),
        credentialId,
        destinationId,
      },
      'Failed to browse folders'
    )
    return c.json(
      {
        success: false,
        error: 'Failed to list folders',
        details: error instanceof Error ? error.message : String(error),
      },
      500
    )
  }
})

// Create a new folder in a destination
destinations.post('/browse/:credentialId/:destinationId/folders', async (c) => {
  const db = c.get('db')
  // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
  const userId = c.get('userId')!
  const credentialId = c.req.param('credentialId')
  const destinationId = c.req.param('destinationId')

  try {
    const { name, parentFolderId } = await c.req.json()

    if (!name || typeof name !== 'string' || name.trim().length === 0) {
      return c.json(
        {
          success: false,
          error: 'Folder name is required',
        },
        400
      )
    }

    // Verify credential belongs to user
    const credential = await db.storageCredential.findFirst({
      where: { id: credentialId, userId },
    })

    if (!credential) {
      return c.json(
        {
          success: false,
          error: 'Credential not found',
        },
        404
      )
    }

    // Decrypt credential data
    const decryptedData = decrypt(credential.encryptedData, credential.iv, credential.authTag)
    const credentialData = JSON.parse(decryptedData)

    // Use factory to get the appropriate adapter
    try {
      const adapter = getStorageAdapter(credential.provider)
      await adapter.initialize(credentialData)

      const folder = await adapter.createFolder(
        destinationId,
        name.trim(),
        parentFolderId || undefined
      )

      return c.json(
        {
          success: true,
          data: folder,
        },
        201
      )
    } catch (adapterError: unknown) {
      return c.json(
        {
          success: false,
          error: `Provider ${credential.provider} not supported for folder creation`,
          details: adapterError instanceof Error ? adapterError.message : String(adapterError),
        },
        400
      )
    }
  } catch (error: unknown) {
    logger.error(
      {
        error: error instanceof Error ? error.message : String(error),
        credentialId,
        destinationId,
      },
      'Failed to create folder'
    )
    return c.json(
      {
        success: false,
        error: 'Failed to create folder',
        details: error instanceof Error ? error.message : String(error),
      },
      500
    )
  }
})

export default destinations
