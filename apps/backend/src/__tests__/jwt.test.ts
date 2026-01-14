import { describe, it, expect } from 'vitest'
import { generateToken, verifyToken, getTokenFromCookie } from '../lib/auth/jwt'

describe('jwt module', () => {
  describe('generateToken', () => {
    it('generates a valid JWT token', async () => {
      const payload = {
        userId: 'user-123',
        email: 'test@example.com',
        role: 'USER',
      }

      const token = await generateToken(payload)

      expect(token).toBeDefined()
      expect(typeof token).toBe('string')
      expect(token.split('.')).toHaveLength(3) // JWT has 3 parts
    })

    it('generates different tokens for different payloads', async () => {
      const token1 = await generateToken({
        userId: 'user-1',
        email: 'user1@example.com',
        role: 'USER',
      })

      const token2 = await generateToken({
        userId: 'user-2',
        email: 'user2@example.com',
        role: 'ADMIN',
      })

      expect(token1).not.toBe(token2)
    })
  })

  describe('verifyToken', () => {
    it('verifies and decodes a valid token', async () => {
      const payload = {
        userId: 'user-123',
        email: 'test@example.com',
        role: 'ADMIN',
      }

      const token = await generateToken(payload)
      const decoded = await verifyToken(token)

      expect(decoded).not.toBeNull()
      expect(decoded?.userId).toBe('user-123')
      expect(decoded?.email).toBe('test@example.com')
      expect(decoded?.role).toBe('ADMIN')
    })

    it('returns null for invalid token', async () => {
      const result = await verifyToken('invalid-token')
      expect(result).toBeNull()
    })

    it('returns null for malformed token', async () => {
      const result = await verifyToken('not.a.valid.jwt.token')
      expect(result).toBeNull()
    })

    it('returns null for empty token', async () => {
      const result = await verifyToken('')
      expect(result).toBeNull()
    })
  })

  describe('getTokenFromCookie', () => {
    it('extracts token from cookie header', () => {
      const cookieHeader = 'auth_token=abc123; other_cookie=xyz'
      const token = getTokenFromCookie(cookieHeader)
      expect(token).toBe('abc123')
    })

    it('returns null when no auth_token cookie', () => {
      const cookieHeader = 'session=xyz; other=123'
      const token = getTokenFromCookie(cookieHeader)
      expect(token).toBeNull()
    })

    it('returns null for null cookie header', () => {
      const token = getTokenFromCookie(null)
      expect(token).toBeNull()
    })

    it('returns null for empty cookie header', () => {
      const token = getTokenFromCookie('')
      expect(token).toBeNull()
    })

    it('handles cookie with spaces', () => {
      const cookieHeader = '  auth_token=mytoken  ; other=value  '
      const token = getTokenFromCookie(cookieHeader)
      expect(token).toBe('mytoken')
    })

    it('handles auth_token as only cookie', () => {
      const cookieHeader = 'auth_token=singletoken'
      const token = getTokenFromCookie(cookieHeader)
      expect(token).toBe('singletoken')
    })
  })
})
