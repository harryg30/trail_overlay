import { NextRequest } from 'next/server'
import { cookies } from 'next/headers'
import { queryOne } from '@/lib/db'
import { getRequiredEnv } from '@/lib/env'
import { encryptSession, SESSION_COOKIE_NAME, SESSION_COOKIE_OPTIONS } from '@/lib/session'

interface StravaTokenResponse {
  access_token: string
  refresh_token: string
  expires_at: number
  athlete: {
    id: number
    firstname: string
    lastname: string
    profile: string
  }
}

export async function GET(request: NextRequest): Promise<Response> {
  const { searchParams } = request.nextUrl

  let stravaClientId: string
  let stravaClientSecret: string
  try {
    stravaClientId = getRequiredEnv('STRAVA_CLIENT_ID')
    stravaClientSecret = getRequiredEnv('STRAVA_CLIENT_SECRET')
  } catch (err) {
    console.error('Strava callback config error:', err)
    return Response.redirect(new URL('/?auth_error=config', request.url))
  }

  if (searchParams.get('error')) {
    return Response.redirect(new URL('/?auth_error=denied', request.url))
  }

  const code = searchParams.get('code')
  if (!code) {
    return Response.redirect(new URL('/?auth_error=missing_code', request.url))
  }

  try {
    // Exchange code for tokens
    const tokenRes = await fetch('https://www.strava.com/oauth/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        client_id: stravaClientId,
        client_secret: stravaClientSecret,
        code,
        grant_type: 'authorization_code',
      }),
    })

    if (!tokenRes.ok) {
      console.error('Strava token exchange failed:', await tokenRes.text())
      return Response.redirect(new URL('/?auth_error=token_exchange', request.url))
    }

    const data: StravaTokenResponse = await tokenRes.json()
    const { athlete, access_token, refresh_token, expires_at } = data
    const name = `${athlete.firstname} ${athlete.lastname}`.trim()

    // Upsert user
    const row = await queryOne<{ id: string }>(
      `INSERT INTO users (strava_athlete_id, name, profile_picture, access_token, refresh_token, token_expires_at)
       VALUES ($1, $2, $3, $4, $5, to_timestamp($6))
       ON CONFLICT (strava_athlete_id) DO UPDATE SET
         name = EXCLUDED.name,
         profile_picture = EXCLUDED.profile_picture,
         access_token = EXCLUDED.access_token,
         refresh_token = EXCLUDED.refresh_token,
         token_expires_at = EXCLUDED.token_expires_at,
         updated_at = now()
       RETURNING id`,
      [athlete.id, name, athlete.profile, access_token, refresh_token, expires_at]
    )

    if (!row) {
      return Response.redirect(new URL('/?auth_error=db', request.url))
    }

    const token = await encryptSession({ userId: row.id, provider: 'strava' })
    const cookieStore = await cookies()
    cookieStore.set(SESSION_COOKIE_NAME, token, SESSION_COOKIE_OPTIONS)

    return Response.redirect(new URL('/', request.url))
  } catch (err) {
    console.error('Strava callback error:', err)
    return Response.redirect(new URL('/?auth_error=server', request.url))
  }
}
