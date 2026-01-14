/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { encrypt } from '@avault/shared'

// Mock googleapis
const mockRefreshAccessToken = vi.fn()
const mockSetCredentials = vi.fn()

vi.mock('googleapis', () => ({
  google: {
    auth: {
      OAuth2: vi.fn().mockImplementation(() => ({
        setCredentials: mockSetCredentials,
        refreshAccessToken: mockRefreshAccessToken,
      })),
    },
  },
}))

import { getValidGoogleTokens } from '../lib/auth/token-refresh'

describe('token-refresh', () => {
  const mockCredentials = {
    access_token: 'old-access-token',
    refresh_token: 'test-refresh-token',
    expiry_date: Date.now() + 3600000, // 1 hour from now
    token_type: 'Bearer',
    scope: 'https://www.googleapis.com/auth/drive',
  }

  const createMockDb = (credential: unknown) => ({
    storageCredential: {
      findUnique: vi.fn().mockResolvedValue(credential),
      update: vi.fn().mockResolvedValue({}),
    },
  })

  const createEncryptedCredential = (creds: typeof mockCredentials, provider: string) => {
    const encrypted = encrypt(JSON.stringify(creds))
    return {
      id: 'cred-123',
      provider,
      encryptedData: encrypted.encryptedData,
      iv: encrypted.iv,
      authTag: encrypted.authTag,
    }
  }

  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('provider validation', () => {
    it('accepts google_drive provider', async () => {
      const validCreds = { ...mockCredentials, expiry_date: Date.now() + 3600000 }
      const encryptedCred = createEncryptedCredential(validCreds, 'google_drive')
      const mockDb = createMockDb(encryptedCred)

      const result = await getValidGoogleTokens('cred-123', mockDb as any)

      expect(result.access_token).toBe('old-access-token')
    })

    it('accepts google_drive_shared provider', async () => {
      const validCreds = { ...mockCredentials, expiry_date: Date.now() + 3600000 }
      const encryptedCred = createEncryptedCredential(validCreds, 'google_drive_shared')
      const mockDb = createMockDb(encryptedCred)

      const result = await getValidGoogleTokens('cred-123', mockDb as any)

      expect(result.access_token).toBe('old-access-token')
    })

    it('accepts google_drive_my_drive provider', async () => {
      const validCreds = { ...mockCredentials, expiry_date: Date.now() + 3600000 }
      const encryptedCred = createEncryptedCredential(validCreds, 'google_drive_my_drive')
      const mockDb = createMockDb(encryptedCred)

      const result = await getValidGoogleTokens('cred-123', mockDb as any)

      expect(result.access_token).toBe('old-access-token')
    })

    it('rejects invalid provider', async () => {
      const encryptedCred = createEncryptedCredential(mockCredentials, 's3')
      const mockDb = createMockDb(encryptedCred)

      await expect(getValidGoogleTokens('cred-123', mockDb as any))
        .rejects.toThrow('Credential not found or invalid provider')
    })

    it('throws when credential not found', async () => {
      const mockDb = createMockDb(null)

      await expect(getValidGoogleTokens('nonexistent', mockDb as any))
        .rejects.toThrow('Credential not found or invalid provider')
    })
  })

  describe('token expiry handling', () => {
    it('returns existing token when not expired', async () => {
      const futureExpiry = Date.now() + 3600000 // 1 hour from now
      const validCreds = { ...mockCredentials, expiry_date: futureExpiry }
      const encryptedCred = createEncryptedCredential(validCreds, 'google_drive')
      const mockDb = createMockDb(encryptedCred)

      const result = await getValidGoogleTokens('cred-123', mockDb as any)

      expect(result.access_token).toBe('old-access-token')
      expect(result.expiry_date).toBe(futureExpiry)
      // Should NOT call OAuth refresh
      expect(mockRefreshAccessToken).not.toHaveBeenCalled()
    })

    it('refreshes token when expired', async () => {
      const pastExpiry = Date.now() - 60000 // 1 minute ago
      const expiredCreds = { ...mockCredentials, expiry_date: pastExpiry }
      const encryptedCred = createEncryptedCredential(expiredCreds, 'google_drive')
      const mockDb = createMockDb(encryptedCred)

      const newExpiry = Date.now() + 3600000
      mockRefreshAccessToken.mockResolvedValue({
        credentials: {
          access_token: 'new-access-token',
          expiry_date: newExpiry,
          token_type: 'Bearer',
        },
      })

      const result = await getValidGoogleTokens('cred-123', mockDb as any)

      expect(result.access_token).toBe('new-access-token')
      expect(result.refresh_token).toBe('test-refresh-token') // Preserved
      expect(mockDb.storageCredential.update).toHaveBeenCalledWith({
        where: { id: 'cred-123' },
        data: expect.objectContaining({
          encryptedData: expect.any(String),
          iv: expect.any(String),
          authTag: expect.any(String),
        }),
      })
    })

    it('refreshes token when expiring within 5 minutes', async () => {
      const soonExpiry = Date.now() + 2 * 60 * 1000 // 2 minutes from now
      const soonExpiringCreds = { ...mockCredentials, expiry_date: soonExpiry }
      const encryptedCred = createEncryptedCredential(soonExpiringCreds, 'google_drive')
      const mockDb = createMockDb(encryptedCred)

      const newExpiry = Date.now() + 3600000
      mockRefreshAccessToken.mockResolvedValue({
        credentials: {
          access_token: 'refreshed-token',
          expiry_date: newExpiry,
          token_type: 'Bearer',
        },
      })

      const result = await getValidGoogleTokens('cred-123', mockDb as any)

      expect(result.access_token).toBe('refreshed-token')
      expect(mockRefreshAccessToken).toHaveBeenCalled()
    })
  })

  describe('error handling', () => {
    it('throws user-friendly error when refresh fails', async () => {
      const expiredCreds = { ...mockCredentials, expiry_date: Date.now() - 60000 }
      const encryptedCred = createEncryptedCredential(expiredCreds, 'google_drive')
      const mockDb = createMockDb(encryptedCred)

      mockRefreshAccessToken.mockRejectedValue(new Error('invalid_grant'))

      await expect(getValidGoogleTokens('cred-123', mockDb as any))
        .rejects.toThrow('Failed to refresh access token. Credential may need re-authorization.')
    })
  })
})
