import { Hono } from 'hono'
import { google } from 'googleapis'
import { encrypt, logger } from '@avault/shared'
import { requireAuth } from '../middleware/auth'
import type { Env } from '../index'

const credentials = new Hono<Env>()

// Apply authentication to all routes
credentials.use('*', requireAuth)

// List all credentials (filtered by user)
credentials.get('/', async (c) => {
  const db = c.get('db')
  const userId = c.get('userId')!

  const allCredentials = await db.storageCredential.findMany({
    where: { userId },
    select: {
      id: true,
      name: true,
      provider: true,
      expiresAt: true,
      createdAt: true,
      updatedAt: true,
      // Don't return encrypted data
    },
    orderBy: { createdAt: 'desc' },
  })

  return c.json({
    success: true,
    data: allCredentials,
  })
})

// Get single credential (user's own only)
credentials.get('/:id', async (c) => {
  const db = c.get('db')
  const userId = c.get('userId')!
  const id = c.req.param('id')

  const credential = await db.storageCredential.findFirst({
    where: { id, userId },
    select: {
      id: true,
      name: true,
      provider: true,
      expiresAt: true,
      createdAt: true,
      updatedAt: true,
    },
  })

  if (!credential) {
    return c.json({ success: false, error: 'Credential not found' }, 404)
  }

  return c.json({ success: true, data: credential })
})

// Delete credential (user's own only)
credentials.delete('/:id', async (c) => {
  const db = c.get('db')
  const userId = c.get('userId')!
  const id = c.req.param('id')

  try {
    // First check if credential exists and belongs to user
    const credential = await db.storageCredential.findFirst({
      where: { id, userId },
    })

    if (!credential) {
      return c.json({
        success: false,
        error: 'Credential not found',
      }, 404)
    }

    await db.storageCredential.delete({ where: { id } })

    return c.json({
      success: true,
      message: 'Credential deleted successfully',
    })
  } catch (error) {
    return c.json({
      success: false,
      error: 'Failed to delete credential',
    }, 500)
  }
})

// ============================================================================
// OAuth Flows for Adding Credentials
// ============================================================================

// Initiate Google Drive OAuth flow (supports both Shared Drives and My Drive)
credentials.post('/google-drive/auth', async (c) => {
  const userId = c.get('userId')!

  try {
    // Get the provider type from request body (default to shared for backwards compatibility)
    const body = await c.req.json().catch(() => ({}))
    const provider = body.provider || 'google_drive_shared'

    const oauth2Client = new google.auth.OAuth2(
      process.env.GOOGLE_CLIENT_ID,
      process.env.GOOGLE_CLIENT_SECRET,
      process.env.GOOGLE_REDIRECT_URI
    )

    // Generate state parameter with userId, flow type, and provider
    const state = Buffer.from(
      JSON.stringify({ userId, flow: 'credential', provider })
    ).toString('base64url')

    const authUrl = oauth2Client.generateAuthUrl({
      access_type: 'offline',
      scope: [
        'https://www.googleapis.com/auth/drive',
        'https://www.googleapis.com/auth/drive.file',
        'https://www.googleapis.com/auth/userinfo.email',
      ],
      state,
      prompt: 'consent', // Force consent to get refresh token
    })

    logger.info({ userId, provider }, 'Google Drive OAuth flow initiated')

    return c.json({
      success: true,
      data: { authUrl, state },
    })
  } catch (error: any) {
    logger.error({ error: error.message, userId }, 'Failed to initiate Google Drive OAuth')
    return c.json({
      success: false,
      error: 'Failed to initiate OAuth flow',
    }, 500)
  }
})

// ============================================================================
// API Key Credentials (S3, R2, Spaces, etc.)
// ============================================================================

// Create credential from API keys
credentials.post('/api-key', async (c) => {
  const userId = c.get('userId')!
  const db = c.get('db')

  try {
    const { name, provider, credentials: credentialData } = await c.req.json()

    // Validate provider supports API key auth
    const apiKeyProviders = ['s3', 'cloudflare_r2', 'digitalocean_spaces']
    if (!apiKeyProviders.includes(provider)) {
      return c.json({
        success: false,
        error: 'Invalid provider for API key authentication',
      }, 400)
    }

    // Validate required fields based on provider
    if (!credentialData.access_key_id || !credentialData.secret_access_key) {
      return c.json({
        success: false,
        error: 'Access key ID and secret access key are required',
      }, 400)
    }

    // For Cloudflare R2, account_id is required
    if (provider === 'cloudflare_r2' && !credentialData.account_id) {
      return c.json({
        success: false,
        error: 'Cloudflare account ID is required for R2',
      }, 400)
    }

    // Encrypt credential data
    const { encryptedData, iv, authTag } = encrypt(JSON.stringify(credentialData))

    const credential = await db.storageCredential.create({
      data: {
        userId,
        name: name || `${provider} Account`,
        provider,
        encryptedData,
        iv,
        authTag,
        expiresAt: null, // API keys don't expire
      },
      select: {
        id: true,
        name: true,
        provider: true,
        createdAt: true,
        updatedAt: true,
      },
    })

    logger.info({ userId, provider, credentialId: credential.id }, 'API key credential created')

    return c.json({
      success: true,
      data: credential,
    }, 201)
  } catch (error: any) {
    logger.error({ error: error.message, userId }, 'Failed to create API key credential')
    return c.json({
      success: false,
      error: 'Failed to create credential',
      details: error.message,
    }, 500)
  }
})

// ============================================================================
// Service Account Credentials (Google Cloud Storage)
// ============================================================================

// Create credential from service account JSON
credentials.post('/service-account', async (c) => {
  const userId = c.get('userId')!
  const db = c.get('db')

  try {
    const { name, provider, credentials: credentialData } = await c.req.json()

    // Only GCS uses service accounts currently
    if (provider !== 'google_cloud_storage') {
      return c.json({
        success: false,
        error: 'Invalid provider for service account authentication',
      }, 400)
    }

    // Parse service account JSON if it's a string
    let serviceAccount = credentialData
    if (typeof credentialData === 'string') {
      try {
        serviceAccount = JSON.parse(credentialData)
      } catch {
        return c.json({
          success: false,
          error: 'Invalid service account JSON',
        }, 400)
      }
    }

    // Validate service account structure
    if (serviceAccount.type !== 'service_account' || !serviceAccount.project_id || !serviceAccount.private_key) {
      return c.json({
        success: false,
        error: 'Invalid service account JSON structure',
      }, 400)
    }

    // Encrypt credential data
    const { encryptedData, iv, authTag } = encrypt(JSON.stringify(serviceAccount))

    const friendlyName = name || `GCS (${serviceAccount.project_id})`

    const credential = await db.storageCredential.create({
      data: {
        userId,
        name: friendlyName,
        provider,
        encryptedData,
        iv,
        authTag,
        expiresAt: null, // Service accounts don't expire
      },
      select: {
        id: true,
        name: true,
        provider: true,
        createdAt: true,
        updatedAt: true,
      },
    })

    logger.info({ userId, provider, credentialId: credential.id, projectId: serviceAccount.project_id }, 'Service account credential created')

    return c.json({
      success: true,
      data: credential,
    }, 201)
  } catch (error: any) {
    logger.error({ error: error.message, userId }, 'Failed to create service account credential')
    return c.json({
      success: false,
      error: 'Failed to create credential',
      details: error.message,
    }, 500)
  }
})

export default credentials
