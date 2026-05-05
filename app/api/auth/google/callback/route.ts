import { NextRequest } from 'next/server'
import { cookies } from 'next/headers'
import { queryOne } from '@/lib/db'
import { verifyGoogleIdToken } from '@/lib/auth'
import { getRequiredEnv } from '@/lib/env'
import { encryptSession, SESSION_COOKIE_NAME, SESSION_COOKIE_OPTIONS } from '@/lib/session'

interface GoogleTokenResponse {
  access_token: string
  expires_in: number
  refresh_token?: string
  scope: string
  token_type: string
  id_token: string
}

export async function GET(request: NextRequest): Promise<Response> {
  const { searchParams } = request.nextUrl
  const cookieStore = await cookies()

  let googleClientId: string
  let googleClientSecret: string
  let appUrl: string
  try {
    googleClientId = getRequiredEnv('GOOGLE_CLIENT_ID')
    googleClientSecret = getRequiredEnv('GOOGLE_CLIENT_SECRET')
    appUrl = getRequiredEnv('NEXT_PUBLIC_APP_URL')
  } catch (err) {
    console.error('Google callback config error:', err)
    return Response.redirect(new URL('/?auth_error=config', request.url))
  }

  if (searchParams.get('error')) {
    return Response.redirect(new URL('/?auth_error=denied', request.url))
  }

  const code = searchParams.get('code')
  const state = searchParams.get('state')

  if (!code || !state) {
    return Response.redirect(new URL('/?auth_error=missing_code', request.url))
  }

  // Verify state parameter against stored cookie
  const storedState = cookieStore.get('google_oauth_state')?.value
  if (!storedState || storedState !== state) {
    console.error('Google OAuth state mismatch')
    return Response.redirect(new URL('/?auth_error=state_mismatch', request.url))
  }

  try {
    // Exchange authorization code for tokens (RFC 6749 requires form-encoded body)
    const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: googleClientId,
        client_secret: googleClientSecret,
        code,
        grant_type: 'authorization_code',
        redirect_uri: `${appUrl}/api/auth/google/callback`,
      }),
    })

    if (!tokenRes.ok) {
      console.error('Google token exchange failed:', await tokenRes.text())
      return Response.redirect(new URL('/?auth_error=token_exchange', request.url))
    }

    const tokenData: GoogleTokenResponse = await tokenRes.json()
    const { id_token } = tokenData

    // Verify signature + claims and extract user profile from ID token payload.
    const profile = await verifyGoogleIdToken(id_token, googleClientId)
    if (!profile) {
      console.error('Failed to verify Google ID token')
      return Response.redirect(new URL('/?auth_error=invalid_token', request.url))
    }

    if (!profile.emailVerified) {
      console.error('Google account email not verified')
      return Response.redirect(new URL('/?auth_error=email_not_verified', request.url))
    }

    // Upsert user by google_sub; preserve existing refresh_token if Google omits it
    const row = await queryOne<{ id: string }>(
      `INSERT INTO users (google_sub, name, email, profile_picture, provider, strava_athlete_id, access_token, refresh_token, token_expires_at)
       VALUES ($1, $2, $3, $4, 'google', NULL, $5, $6, to_timestamp($7))
       ON CONFLICT (google_sub) WHERE google_sub IS NOT NULL DO UPDATE SET
         name = EXCLUDED.name,
         email = EXCLUDED.email,
         profile_picture = EXCLUDED.profile_picture,
         access_token = EXCLUDED.access_token,
         refresh_token = COALESCE(EXCLUDED.refresh_token, users.refresh_token),
         token_expires_at = EXCLUDED.token_expires_at,
         updated_at = now()
       RETURNING id`,
      [
        profile.sub,
        profile.name,
        profile.email,
        profile.picture || null,
        tokenData.access_token,
        tokenData.refresh_token || null,
        Math.floor(Date.now() / 1000) + tokenData.expires_in,
      ]
    )

    if (!row) {
      return Response.redirect(new URL('/?auth_error=db', request.url))
    }

    // Issue session cookie with provider='google'
    const token = await encryptSession({ userId: row.id, provider: 'google' })
    cookieStore.set(SESSION_COOKIE_NAME, token, SESSION_COOKIE_OPTIONS)

    // Clear the OAuth state cookie
    cookieStore.set('google_oauth_state', '', { maxAge: 0 })

    return Response.redirect(new URL('/', request.url))
  } catch (err) {
    console.error('Google callback error:', err)
    return Response.redirect(new URL('/?auth_error=server', request.url))
  }
}
