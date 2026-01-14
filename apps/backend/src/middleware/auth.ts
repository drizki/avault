import { Context, Next } from 'hono'
import { verifyToken, getTokenFromCookie } from '../lib/auth/jwt'
import type { Env } from '../index'

/**
 * Require authentication for a route
 * Returns 401 if no valid token is present
 */
export async function requireAuth(
  c: Context<Env>,
  next: Next
): Promise<Response | void> {
  const cookieHeader = c.req.header('cookie')
  const token = getTokenFromCookie(cookieHeader || null)

  if (!token) {
    return c.json({ success: false, error: 'Authentication required' }, 401)
  }

  const payload = await verifyToken(token)

  if (!payload) {
    return c.json({ success: false, error: 'Invalid or expired token' }, 401)
  }

  // Attach user info to context
  c.set('userId', payload.userId)
  c.set('userRole', payload.role)

  await next()
}

/**
 * Require admin role for a route
 * Must be used after requireAuth middleware
 */
export async function requireAdmin(
  c: Context<Env>,
  next: Next
): Promise<Response | void> {
  const userRole = c.get('userRole')

  if (userRole !== 'ADMIN') {
    return c.json(
      { success: false, error: 'Admin access required' },
      403
    )
  }

  await next()
}

/**
 * Optional authentication - extracts user if present, but doesn't block
 */
export async function optionalAuth(
  c: Context<Env>,
  next: Next
): Promise<void> {
  const cookieHeader = c.req.header('cookie')
  const token = getTokenFromCookie(cookieHeader || null)

  if (token) {
    const payload = await verifyToken(token)
    if (payload) {
      c.set('userId', payload.userId)
      c.set('userRole', payload.role)
    }
  }

  await next()
}
