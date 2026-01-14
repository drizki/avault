import { describe, it, expect, vi, beforeEach } from 'vitest'

const mocks = vi.hoisted(() => ({
  generateAuthUrl: vi.fn(),
  getToken: vi.fn(),
  setCredentials: vi.fn(),
  userinfoGet: vi.fn(),
}))

vi.mock('googleapis', () => ({
  google: {
    auth: {
      OAuth2: vi.fn().mockImplementation(() => ({
        generateAuthUrl: mocks.generateAuthUrl,
        getToken: mocks.getToken,
        setCredentials: mocks.setCredentials,
      })),
    },
    oauth2: vi.fn().mockReturnValue({
      userinfo: {
        get: mocks.userinfoGet,
      },
    }),
  },
}))

import { GoogleOAuthClient } from '../lib/auth/google'

describe('GoogleOAuthClient', () => {
  const mockConfig = {
    clientId: 'test-client-id',
    clientSecret: 'test-client-secret',
    redirectUri: 'http://localhost:3000/callback',
  }

  let client: GoogleOAuthClient

  beforeEach(() => {
    vi.clearAllMocks()
    client = new GoogleOAuthClient(mockConfig)
  })

  describe('constructor', () => {
    it('creates OAuth2 client with provided config', async () => {
      const { google } = await import('googleapis')
      expect(google.auth.OAuth2).toHaveBeenCalledWith(
        'test-client-id',
        'test-client-secret',
        'http://localhost:3000/callback'
      )
    })
  })

  describe('generateAuthUrl', () => {
    it('generates auth URL with correct scopes', () => {
      mocks.generateAuthUrl.mockReturnValue('https://accounts.google.com/oauth')

      const url = client.generateAuthUrl('state-123')

      expect(mocks.generateAuthUrl).toHaveBeenCalledWith({
        access_type: 'offline',
        scope: [
          'openid',
          'https://www.googleapis.com/auth/userinfo.email',
          'https://www.googleapis.com/auth/userinfo.profile',
        ],
        state: 'state-123',
        prompt: 'consent',
      })
      expect(url).toBe('https://accounts.google.com/oauth')
    })

    it('passes state parameter', () => {
      mocks.generateAuthUrl.mockReturnValue('https://accounts.google.com/oauth?state=custom-state')

      const url = client.generateAuthUrl('custom-state')

      expect(mocks.generateAuthUrl).toHaveBeenCalledWith(
        expect.objectContaining({ state: 'custom-state' })
      )
    })
  })

  describe('exchangeCodeForTokens', () => {
    it('exchanges code for tokens', async () => {
      const mockTokens = {
        access_token: 'ya29.access-token',
        refresh_token: '1//refresh-token',
        expiry_date: 1700000000000,
        token_type: 'Bearer',
        id_token: 'eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCJ9...',
        scope: 'openid email profile',
      }
      mocks.getToken.mockResolvedValue({ tokens: mockTokens })

      const result = await client.exchangeCodeForTokens('auth-code-123')

      expect(mocks.getToken).toHaveBeenCalledWith('auth-code-123')
      expect(result).toEqual({
        access_token: 'ya29.access-token',
        refresh_token: '1//refresh-token',
        expiry_date: 1700000000000,
        token_type: 'Bearer',
        id_token: 'eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCJ9...',
        scope: 'openid email profile',
      })
    })

    it('handles missing optional fields', async () => {
      const mockTokens = {
        access_token: 'ya29.access-token',
        refresh_token: null,
        expiry_date: 1700000000000,
        token_type: null,
        id_token: null,
        scope: null,
      }
      mocks.getToken.mockResolvedValue({ tokens: mockTokens })

      const result = await client.exchangeCodeForTokens('auth-code')

      expect(result).toEqual({
        access_token: 'ya29.access-token',
        refresh_token: undefined,
        expiry_date: 1700000000000,
        token_type: 'Bearer',
        id_token: undefined,
        scope: undefined,
      })
    })

    it('throws on invalid code', async () => {
      mocks.getToken.mockRejectedValue(new Error('invalid_grant'))

      await expect(client.exchangeCodeForTokens('bad-code')).rejects.toThrow('invalid_grant')
    })
  })

  describe('getUserInfo', () => {
    it('fetches user info with access token', async () => {
      const mockUserData = {
        id: 'google-user-123',
        email: 'user@example.com',
        verified_email: true,
        name: 'John Doe',
        given_name: 'John',
        family_name: 'Doe',
        picture: 'https://lh3.googleusercontent.com/photo.jpg',
        locale: 'en',
      }
      mocks.userinfoGet.mockResolvedValue({ data: mockUserData })

      const result = await client.getUserInfo('ya29.access-token')

      expect(mocks.setCredentials).toHaveBeenCalledWith({ access_token: 'ya29.access-token' })
      expect(result).toEqual(mockUserData)
    })

    it('handles missing optional user fields', async () => {
      const mockUserData = {
        id: 'google-user-456',
        email: 'minimal@example.com',
        verified_email: true,
        name: 'Minimal User',
        given_name: null,
        family_name: null,
        picture: 'https://lh3.googleusercontent.com/default.jpg',
        locale: null,
      }
      mocks.userinfoGet.mockResolvedValue({ data: mockUserData })

      const result = await client.getUserInfo('ya29.token')

      expect(result).toEqual({
        id: 'google-user-456',
        email: 'minimal@example.com',
        verified_email: true,
        name: 'Minimal User',
        given_name: '',
        family_name: '',
        picture: 'https://lh3.googleusercontent.com/default.jpg',
        locale: 'en',
      })
    })

    it('throws on API error', async () => {
      mocks.userinfoGet.mockRejectedValue(new Error('API quota exceeded'))

      await expect(client.getUserInfo('token')).rejects.toThrow('API quota exceeded')
    })
  })
})
