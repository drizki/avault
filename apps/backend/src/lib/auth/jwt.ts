import { SignJWT, jwtVerify } from 'jose'

export interface JWTPayload {
  userId: string
  email: string
  role: 'ADMIN' | 'USER'
  iat?: number
  exp?: number
}

// JWT_SECRET is required - fail fast if not configured
if (!process.env.JWT_SECRET) {
  throw new Error(
    'JWT_SECRET environment variable is required. Generate one with: openssl rand -base64 32'
  )
}

const JWT_SECRET = new TextEncoder().encode(process.env.JWT_SECRET)
const JWT_EXPIRY = '7d' // 7 days

/**
 * Generate a JWT token for a user
 */
export async function generateToken(payload: {
  userId: string
  email: string
  role: string
}): Promise<string> {
  const token = await new SignJWT({
    userId: payload.userId,
    email: payload.email,
    role: payload.role,
  })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime(JWT_EXPIRY)
    .sign(JWT_SECRET)

  return token
}

/**
 * Verify and decode a JWT token
 */
export async function verifyToken(token: string): Promise<JWTPayload | null> {
  try {
    const { payload } = await jwtVerify(token, JWT_SECRET)
    return payload as unknown as JWTPayload
  } catch {
    // Token is invalid or expired
    return null
  }
}

/**
 * Extract JWT token from cookie header
 */
export function getTokenFromCookie(cookieHeader: string | null): string | null {
  if (!cookieHeader) return null

  const cookies = cookieHeader.split(';').map((cookie) => cookie.trim())
  const tokenCookie = cookies.find((cookie) => cookie.startsWith('auth_token='))

  if (!tokenCookie) return null

  return tokenCookie.split('=')[1]
}
