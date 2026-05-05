import { cookies } from 'next/headers'
import { createRemoteJWKSet, jwtVerify } from 'jose'
import { queryOne } from '@/lib/db'
import { SESSION_COOKIE_NAME, decryptSession, AuthProvider } from '@/lib/session'

const GOOGLE_JWKS = createRemoteJWKSet(new URL('https://www.googleapis.com/oauth2/v3/certs'))
const GOOGLE_ISSUERS = ['https://accounts.google.com', 'accounts.google.com']

export interface GoogleIdTokenProfile {
  sub: string
  name: string
  email: string
  picture?: string
  emailVerified: boolean
}

export interface SessionUser {
  id: string
  name: string
  profilePicture: string | null
  stravaAthleteId: number | null
  provider: AuthProvider
}

export interface UserCapabilities {
  canPublishAssets: boolean // Any authenticated user
  canCommentAssets: boolean // Any authenticated user
  canUploadGpx: boolean // Any authenticated user
  canUseStrava: boolean // Only Strava-authenticated users
}

export async function verifyGoogleIdToken(
  idToken: string,
  audience: string
): Promise<GoogleIdTokenProfile | null> {
  try {
    const { payload } = await jwtVerify(idToken, GOOGLE_JWKS, {
      issuer: GOOGLE_ISSUERS,
      audience,
    })

    const sub = typeof payload.sub === 'string' ? payload.sub : null
    const name = typeof payload.name === 'string' ? payload.name : null
    const email = typeof payload.email === 'string' ? payload.email : null
    const picture = typeof payload.picture === 'string' ? payload.picture : undefined
    const emailVerified = payload.email_verified === true || payload.email_verified === 'true'

    if (!sub || !name || !email) {
      return null
    }

    return {
      sub,
      name,
      email,
      picture,
      emailVerified,
    }
  } catch {
    return null
  }
}

/**
 * Derives user capabilities from their authentication provider.
 * Any authenticated user can publish/comment/upload GPX.
 * Only Strava-authenticated users can use Strava features.
 */
export function deriveCapabilities(provider: AuthProvider): UserCapabilities {
  return {
    canPublishAssets: true,
    canCommentAssets: true,
    canUploadGpx: true,
    canUseStrava: provider === 'strava',
  }
}

export async function getSessionUserId(): Promise<string | null> {
  const cookieStore = await cookies()
  const token = cookieStore.get(SESSION_COOKIE_NAME)?.value
  if (!token) return null
  const payload = await decryptSession(token)
  return payload?.userId ?? null
}

/**
 * Get the authenticated user's provider from the session JWT.
 * Falls back to deriving from user data if provider isn't in the JWT.
 */
export async function getSessionProvider(): Promise<AuthProvider | null> {
  const cookieStore = await cookies()
  const token = cookieStore.get(SESSION_COOKIE_NAME)?.value
  if (!token) return null

  const payload = await decryptSession(token)
  if (!payload?.userId) return null

  // If provider is in the JWT, use it
  if (payload.provider) return payload.provider

  // Fallback: derive from user's strava_athlete_id
  const user = await getSessionUser()
  return user?.provider ?? null
}

/**
 * Get the authenticated user's capabilities based on their auth provider.
 */
export async function getSessionCapabilities(): Promise<UserCapabilities | null> {
  const provider = await getSessionProvider()
  if (!provider) return null
  return deriveCapabilities(provider)
}

export async function getSessionUser(): Promise<SessionUser | null> {
  const userId = await getSessionUserId()
  if (!userId) return null

  const row = await queryOne<{
    id: string
    name: string
    profile_picture: string | null
    strava_athlete_id: number | null
    provider: string
  }>(
    `SELECT id, name, profile_picture, strava_athlete_id, provider FROM users WHERE id = $1`,
    [userId]
  )

  if (!row) return null

  const provider: AuthProvider =
    row.provider === 'google' || row.provider === 'dev' ? row.provider : 'strava'

  return {
    id: row.id,
    name: row.name,
    profilePicture: row.profile_picture,
    stravaAthleteId: row.strava_athlete_id,
    provider,
  }
}
