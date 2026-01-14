import { Hono, type Context } from 'hono'
import { setCookie, deleteCookie } from 'hono/cookie'
import crypto from 'crypto'
import { getRedis, encrypt } from '@avault/shared'
import { GoogleOAuthClient } from '../lib/auth/google'
import { generateToken, getTokenFromCookie } from '../lib/auth/jwt'
import { SettingsService } from '../lib/settings'
import { requireAuth } from '../middleware/auth'
import type { Env } from '../index'
import { logger } from '@avault/shared'

const auth = new Hono<Env>()

// Validate required environment variables
if (!process.env.GOOGLE_CLIENT_ID) {
  throw new Error('GOOGLE_CLIENT_ID environment variable is required')
}
if (!process.env.GOOGLE_CLIENT_SECRET) {
  throw new Error('GOOGLE_CLIENT_SECRET environment variable is required')
}

// Initialize Google OAuth client
const googleOAuth = new GoogleOAuthClient({
  clientId: process.env.GOOGLE_CLIENT_ID,
  clientSecret: process.env.GOOGLE_CLIENT_SECRET,
  redirectUri: process.env.GOOGLE_REDIRECT_URI || 'http://localhost:4000/api/auth/callback/google',
})

// Use shared Redis connection for OAuth state storage
const redis = getRedis()

/**
 * POST /api/auth/login/google
 * Initialize Google OAuth flow
 */
auth.post('/login/google', async (c) => {
  try {
    // Generate secure state parameter
    const state = crypto.randomBytes(32).toString('hex')

    // Store state in Redis with 10-minute TTL
    await redis.setex(`oauth:state:${state}`, 600, JSON.stringify({
      provider: 'google',
      timestamp: Date.now(),
    }))

    // Generate OAuth URL
    const authUrl = googleOAuth.generateAuthUrl(state)

    return c.json({
      success: true,
      data: {
        authUrl,
        state,
      },
    })
  } catch (error: unknown) {
    logger.error({ error }, 'Failed to initialize Google OAuth')
    return c.json({
      success: false,
      error: 'Failed to initialize authentication',
    }, 500)
  }
})

/**
 * Handle credential OAuth callback (for adding storage credentials)
 */
async function handleCredentialOAuthCallback(c: Context<Env>, code: string, decodedState: Record<string, unknown>) {
  const db = c.get('db')
  const userId = typeof decodedState.userId === 'string' ? decodedState.userId : null
  const provider = typeof decodedState.provider === 'string' ? decodedState.provider : undefined

  if (!userId) {
    return c.redirect(`${process.env.FRONTEND_URL}/credentials?error=invalid_state`)
  }

  // Determine the storage provider type (default to google_drive_shared for backwards compatibility)
  const storageProvider = (provider as string) || 'google_drive_shared'

  // Get friendly provider name for display
  const providerDisplayName = storageProvider === 'google_drive_my_drive'
    ? 'Google Drive (My Drive)'
    : 'Google Drive (Shared)'

  try {
    // Exchange code for tokens
    const tokens = await googleOAuth.exchangeCodeForTokens(code)

    if (!tokens.access_token || !tokens.refresh_token) {
      throw new Error('Missing required tokens')
    }

    // Get user info from Google to create a friendly name
    const googleUser = await googleOAuth.getUserInfo(tokens.access_token)

    // Encrypt credential data
    const credentialData = {
      access_token: tokens.access_token,
      refresh_token: tokens.refresh_token,
      expiry_date: tokens.expiry_date || Date.now() + 3600 * 1000,
      token_type: tokens.token_type || 'Bearer',
      scope: tokens.scope || '',
    }

    const { encryptedData, iv, authTag } = encrypt(JSON.stringify(credentialData))

    // Store credential with the correct provider type
    await db.storageCredential.create({
      data: {
        userId,
        name: `${providerDisplayName} (${googleUser.email})`,
        provider: storageProvider,
        encryptedData,
        iv,
        authTag,
        scopes: tokens.scope || '',
        expiresAt: null, // Refresh token doesn't expire
      },
    })

    logger.info({ userId, email: googleUser.email, provider: storageProvider }, 'Google Drive credential added successfully')

    return c.redirect(`${process.env.FRONTEND_URL}/credentials?success=credential_added`)
  } catch (error: unknown) {
    logger.error({ error: error instanceof Error ? error.message : String(error), provider: storageProvider }, 'Failed to process Google Drive OAuth callback')
    return c.redirect(`${process.env.FRONTEND_URL}/credentials?error=oauth_failed`)
  }
}

/**
 * GET /api/auth/callback/google
 * Handle OAuth callback from Google
 */
auth.get('/callback/google', async (c) => {
  const db = c.get('db')
  const settingsService = new SettingsService(db)

  try {
    const code = c.req.query('code')
    const state = c.req.query('state')

    if (!code || !state) {
      return c.redirect(`${process.env.FRONTEND_URL}/login?error=missing_params`)
    }

    // Check if this is a credential flow (state contains flow type)
    try {
      const decodedState = JSON.parse(Buffer.from(state, 'base64url').toString())
      if (decodedState.flow === 'credential') {
        // Handle credential OAuth flow
        return handleCredentialOAuthCallback(c, code, decodedState)
      }
    } catch {
      // Not a credential flow, continue with normal auth flow
    }

    // Verify state from Redis (for normal auth flow)
    const storedState = await redis.get(`oauth:state:${state}`)
    if (!storedState) {
      return c.redirect(`${process.env.FRONTEND_URL}/login?error=invalid_state`)
    }

    // Delete state (single use)
    await redis.del(`oauth:state:${state}`)

    // Exchange code for tokens
    const tokens = await googleOAuth.exchangeCodeForTokens(code)

    // Get user info from Google
    const googleUser = await googleOAuth.getUserInfo(tokens.access_token)

    // Check if user already exists
    const existingUser = await db.user.findUnique({
      where: {
        provider_providerId: {
          provider: 'google',
          providerId: googleUser.id,
        },
      },
    })

    // If user doesn't exist, check signup permissions
    if (!existingUser) {
      const userCount = await db.user.count()
      const isFirstUser = userCount === 0

      // If not first user, check if signups are allowed
      if (!isFirstUser) {
        const signupsAllowed = await settingsService.areSignupsAllowed()
        if (!signupsAllowed) {
          return c.redirect(`${process.env.FRONTEND_URL}/login?error=signups_disabled`)
        }
      }
    }

    // Determine role (only for new users)
    const userCount = await db.user.count()
    const isFirstUser = userCount === 0
    const role: 'ADMIN' | 'USER' = isFirstUser ? 'ADMIN' : 'USER'

    // Create or update user
    const user = await db.user.upsert({
      where: {
        provider_providerId: {
          provider: 'google',
          providerId: googleUser.id,
        },
      },
      create: {
        email: googleUser.email,
        name: googleUser.name,
        avatarUrl: googleUser.picture,
        provider: 'google',
        providerId: googleUser.id,
        role,
        lastLoginAt: new Date(),
      },
      update: {
        name: googleUser.name,
        avatarUrl: googleUser.picture,
        lastLoginAt: new Date(),
        // Don't update role on subsequent logins
      },
    })

    // Initialize system settings if this is the first user
    if (isFirstUser) {
      await settingsService.set('system.initialized', true)
      await settingsService.initializeDefaults()
    }

    // Generate JWT token
    const token = await generateToken({
      userId: user.id,
      email: user.email,
      role: user.role,
    })

    // Set httpOnly cookie
    setCookie(c, 'auth_token', token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'Lax',
      maxAge: 7 * 24 * 60 * 60, // 7 days
      path: '/',
    })

    // Redirect to frontend dashboard
    return c.redirect(`${process.env.FRONTEND_URL}/auth/callback?success=true`)
  } catch (error: unknown) {
    logger.error({ error }, 'OAuth callback error')
    return c.redirect(`${process.env.FRONTEND_URL}/login?error=auth_failed`)
  }
})

/**
 * POST /api/auth/logout
 * Clear auth cookie
 */
auth.post('/logout', (c) => {
  deleteCookie(c, 'auth_token', {
    path: '/',
  })

  return c.json({
    success: true,
    message: 'Logged out successfully',
  })
})

/**
 * GET /api/auth/me
 * Get current user info (requires authentication)
 */
auth.get('/me', requireAuth, async (c) => {
  const db = c.get('db')
  const userId = c.get('userId')

  try {
    const user = await db.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        email: true,
        name: true,
        avatarUrl: true,
        role: true,
        createdAt: true,
        lastLoginAt: true,
      },
    })

    if (!user) {
      return c.json({
        success: false,
        error: 'User not found',
      }, 404)
    }

    return c.json({
      success: true,
      data: user,
    })
  } catch (error: unknown) {
    logger.error({ error }, 'Failed to fetch user')
    return c.json({
      success: false,
      error: 'Failed to fetch user data',
    }, 500)
  }
})

/**
 * GET /api/auth/status
 * Get system status (initialized, signups allowed)
 * Public endpoint - no auth required
 */
auth.get('/status', async (c) => {
  const db = c.get('db')
  const settingsService = new SettingsService(db)

  try {
    const userCount = await db.user.count()
    const initialized = userCount > 0
    const allowSignups = await settingsService.areSignupsAllowed()

    return c.json({
      success: true,
      data: {
        initialized,
        allowSignups,
      },
    })
  } catch (error: unknown) {
    logger.error({ error }, 'Failed to get auth status')
    return c.json({
      success: false,
      error: 'Failed to get system status',
    }, 500)
  }
})

/**
 * GET /api/auth/token
 * Get token for SSE/WebSocket connections (requires authentication)
 */
auth.get('/token', requireAuth, async (c) => {
  const cookieHeader = c.req.header('cookie')
  const token = getTokenFromCookie(cookieHeader || null)

  if (!token) {
    return c.json({ success: false, error: 'No token found' }, 401)
  }

  return c.json({ success: true, data: { token } })
})

export default auth
