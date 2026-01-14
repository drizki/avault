import { google } from 'googleapis'
import { PrismaClient, decrypt, encrypt, logger } from '@avault/shared'

interface StoredCredentials {
  access_token: string
  refresh_token: string
  expiry_date: number
  token_type: string
  scope: string
}

// All Google provider types that support OAuth token refresh
const GOOGLE_OAUTH_PROVIDERS = [
  'google_drive',
  'google_drive_shared',
  'google_drive_my_drive',
] as const

/**
 * Get valid Google OAuth tokens, refreshing if necessary
 * Returns decrypted credentials with a valid access token
 */
export async function getValidGoogleTokens(
  credentialId: string,
  db: PrismaClient
): Promise<StoredCredentials> {
  // Fetch credential from database
  const credential = await db.storageCredential.findUnique({
    where: { id: credentialId },
  })

  if (!credential || !GOOGLE_OAUTH_PROVIDERS.includes(credential.provider as typeof GOOGLE_OAUTH_PROVIDERS[number])) {
    throw new Error(`Credential not found or invalid provider. Expected one of: ${GOOGLE_OAUTH_PROVIDERS.join(', ')}`)
  }

  // Decrypt stored credentials
  const decryptedData = decrypt(
    credential.encryptedData,
    credential.iv,
    credential.authTag
  )
  const credentials: StoredCredentials = JSON.parse(decryptedData)

  // Check if access token is expired or about to expire (within 5 minutes)
  const now = Date.now()
  const expiryThreshold = now + 5 * 60 * 1000 // 5 minutes

  if (credentials.expiry_date > expiryThreshold) {
    // Token is still valid
    return credentials
  }

  // Token expired or about to expire, refresh it
  logger.info({ credentialId }, 'Refreshing expired Google OAuth token')

  try {
    const oauth2Client = new google.auth.OAuth2(
      process.env.GOOGLE_CLIENT_ID,
      process.env.GOOGLE_CLIENT_SECRET,
      process.env.GOOGLE_REDIRECT_URI
    )

    // Set credentials with refresh token
    oauth2Client.setCredentials({
      refresh_token: credentials.refresh_token,
    })

    // Request new access token
    const { credentials: newTokens } = await oauth2Client.refreshAccessToken()

    // Update stored credentials
    const updatedCredentials: StoredCredentials = {
      access_token: newTokens.access_token!,
      refresh_token: credentials.refresh_token, // Refresh token stays the same
      expiry_date: newTokens.expiry_date!,
      token_type: newTokens.token_type || 'Bearer',
      scope: credentials.scope,
    }

    // Encrypt and save updated credentials
    const { encryptedData, iv, authTag } = encrypt(
      JSON.stringify(updatedCredentials)
    )

    await db.storageCredential.update({
      where: { id: credentialId },
      data: {
        encryptedData,
        iv,
        authTag,
      },
    })

    logger.info({ credentialId }, 'Google OAuth token refreshed successfully')

    return updatedCredentials
  } catch (error: any) {
    logger.error(
      { error: error.message, credentialId },
      'Failed to refresh Google OAuth token'
    )
    throw new Error('Failed to refresh access token. Credential may need re-authorization.')
  }
}
